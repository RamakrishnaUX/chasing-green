import * as THREE from 'three';
import { clamp, lerp } from '../world/noise.js';
import { waterLevelAt } from '../world/terrain.js';

// Boat mode. In water too deep to wade, a hull drops out from under the car, the wheels fold up
// flat onto its deck, and an outboard motor trims down at the stern with navigation lights on. In the
// shallows it all folds away again. One kit fits every vehicle: it is sized from the wheels and
// the body's length, in world units (a model built small and scaled up keeps its wheel pivots
// in its own units, so the fold is divided by that scale).

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// The order things happen in as the morph runs from 0 (car) to 1 (boat).
export const stages = (t) => ({ hull: smooth(0, 0.5, t), fold: smooth(0.3, 0.8, t), jet: smooth(0.6, 1, t), flare: 1 - smooth(0.25, 0.55, t) });

// The hull's paint, as horizontal bands up its side (see hullGeometry for how v is laid out):
// antifouling below the water, a mint boot stripe at the waterline, navy topsides, a mint
// pinstripe, a white sheer band and a charcoal rub rail along the top.
function paintTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const band = (v0, v1, col) => { g.fillStyle = col; g.fillRect(0, Math.round((1 - v1) * 512), 4, Math.round((v1 - v0) * 512)); };
  band(0, 0.47, '#6e2620'); band(0.47, 0.535, '#66dfb0'); band(0.535, 0.79, '#14263a');
  band(0.79, 0.81, '#a2f6d3'); band(0.81, 0.955, '#eef0ec'); band(0.955, 1, '#2a2d31');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
  return t;
}

// A planing hull: deep-V aft, a raked bow that rises and narrows to a point, a chine flat and a
// spray rail each side, and a rubbing strake. The car sits on a flat cockpit floor at the
// gunwale, and a crowned foredeck covers the bow ahead of it.
// bowAt: where (0 to 1, transom to stem) the bow starts to narrow and rise. Origin at the
// gunwale amidships, so scaling y grows it downward from under the body. wl: the waterline.
function hullGeometry(halfW, z0, z1, depth, wl, bowAt) {
  const N = 44, rings = [];
  const shape = (u) => {
    const b = Math.max(0, (u - bowAt) / (1 - bowAt));
    const w = halfW * Math.pow(Math.cos(b * Math.PI / 2), 0.7) * (u < 0.04 ? 0.97 + u * 0.75 : 1);
    const sweep = clamp((u - 0.3) / 0.7, 0, 1);
    const top = 0.02 + 0.1 * sweep * sweep + 0.34 * Math.pow(b, 1.5);
    const keel = lerp(-depth, top - 0.1, Math.pow(b, 1.35));
    const chine = Math.max(keel, lerp(-depth * 0.66, top - 0.16, Math.pow(b, 1.15)));
    return { b, w, top, keel, chine };
  };
  for (let i = 0; i <= N; i++) {
    const u = i / N, z = z0 + (z1 - z0) * u, { w, top, keel, chine } = shape(u);
    const wly = clamp(wl, chine, top - 0.12), rail = (chine + keel) / 2;
    // Port side, gunwale down to the keel (the starboard side mirrors it).
    const side = [[w, top], [w * 1.012, top - 0.045], [w * 0.995, top - 0.1], [w * 0.955, wly], [w * 0.93, chine],
      [w * 0.83, chine - 0.012], [w * 0.5, rail + 0.01], [w * 0.45, rail - 0.012], [0, keel]];
    // v: the paint bands. Below the waterline it runs 0 to 0.5 from keel to water; above, 0.5 to 1
    // from water to gunwale, so the stripes keep to the sheer as it sweeps up to the bow.
    const v = (y) => (y <= wly ? 0.5 * clamp((y - keel) / Math.max(1e-3, wly - keel), 0, 1) : 0.5 + 0.5 * clamp((y - wly) / Math.max(1e-3, top - wly), 0, 1));
    const pts = [...side.map(([x, y]) => [-x, y]), ...side.slice(0, -1).reverse().map(([x, y]) => [x, y])];
    rings.push(pts.map(([x, y]) => ({ p: new THREE.Vector3(x, y, z), v: v(y), u })));
  }
  const pos = [], uv = [], push = (q) => { pos.push(q.p.x, q.p.y, q.p.z); uv.push(0.5, q.v); };
  const M = rings[0].length;
  for (let i = 0; i < N; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let j = 0; j < M - 1; j++) { push(A[j]); push(A[j + 1]); push(B[j + 1]); push(A[j]); push(B[j + 1]); push(B[j]); }
  }
  // Transom: strips across between matching points each side, so its paint lines up with the sides.
  const T = rings[0], H = (M - 1) / 2;
  for (let j = 0; j < H; j++) { const a = T[j], b = T[j + 1], c = T[M - 2 - j], d = T[M - 1 - j]; push(a); push(d); push(c); push(a); push(c); push(b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return { geo: g, shape };
}

// A surface across the hull's top between two stations: flat (the cockpit floor) or crowned
// (the foredeck), following the sheer.
function deckGeometry(shape, z0, z1, u0, u1, crown, inset, flat = null) {
  const pos = [], N = 24, K = 8;
  const at = (u, k) => { const s = shape(u), x = (k / K * 2 - 1) * s.w * inset; return new THREE.Vector3(x, (flat ?? s.top) + crown * (1 - (x / Math.max(1e-3, s.w)) ** 2), z0 + (z1 - z0) * u); };
  for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) {
    const ua = u0 + (u1 - u0) * i / N, ub = u0 + (u1 - u0) * (i + 1) / N;
    const a = at(ua, k), b = at(ua, k + 1), c = at(ub, k + 1), d = at(ub, k);
    for (const q of [a, c, b, a, d, c]) pos.push(q.x, q.y, q.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// The cockpit's inner sides: white, from the floor up to the gunwale, each side.
function linerGeometry(shape, z0, z1, u1, floor) {
  const pos = [], N = 30;
  for (const sx of [-1, 1]) for (let i = 0; i < N; i++) {
    const ua = u1 * i / N, ub = u1 * (i + 1) / N, A = shape(ua), B = shape(ub), za = z0 + (z1 - z0) * ua, zb = z0 + (z1 - z0) * ub;
    const a = [sx * A.w * 0.975, floor, za], b = [sx * A.w * 0.975, A.top - 0.005, za], c = [sx * B.w * 0.975, B.top - 0.005, zb], d = [sx * B.w * 0.975, floor, zb];
    for (const q of [a, b, c, a, c, d]) pos.push(...q);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A box with rounded edges and corners (radius r), for the cowling.
function roundedBox(w, h, d, r) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 6, 6), p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    v.sub(c).normalize().multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// An outboard motor, built at size s: a glossy black cowling with a mint stripe, the
// midsection, the leg down to the gearcase, the anti-ventilation plate, a skeg and a
// three-blade propeller. Its origin is the clamp bracket on the transom; it hangs aft (-z).
function outboard(s, drop) {
  const g = new THREE.Group();
  const black = new THREE.MeshPhysicalMaterial({ color: 0x0f1216, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.45, metalness: 0.5 });
  const mint = new THREE.MeshStandardMaterial({ color: 0x66dfb0, roughness: 0.4, emissive: 0x0d3326 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.18, metalness: 1 });
  const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  // Cowling: a tall rounded pod, its back swept round, with a mint stripe and a grey lower pan.
  const cw = 0.4 * s, ch = 0.52 * s, cl = 0.6 * s, cy = 0.3 * s, cz = -0.36 * s;
  mesh(roundedBox(cw, ch, cl, 0.14 * s), black, 0, cy, cz);
  mesh(roundedBox(cw * 1.04, 0.12 * s, cl * 1.03, 0.05 * s), grey, 0, cy - ch / 2 + 0.03 * s, cz);
  mesh(new THREE.BoxGeometry(cw * 1.005, 0.03 * s, cl * 0.62), mint, 0, cy + 0.06 * s, cz - 0.04 * s);
  // Clamp bracket on the transom.
  mesh(new THREE.BoxGeometry(0.2 * s, 0.22 * s, 0.1 * s), grey, 0, 0, -0.05 * s);
  // Midsection and leg down to the gearcase, deep enough to reach below the hull.
  const legTop = cy - ch / 2 - 0.02 * s, legLen = legTop + drop - 0.06;
  const leg = mesh(new THREE.BoxGeometry(0.11 * s, legLen, 0.2 * s), grey, 0, legTop - legLen / 2, -0.33 * s);
  leg.geometry = roundedBox(0.11 * s, legLen, 0.22 * s, 0.05 * s);
  // Anti-ventilation plate, gearcase torpedo and skeg.
  mesh(new THREE.BoxGeometry(0.3 * s, 0.016, 0.34 * s), grey, 0, -drop + 0.11, -0.35 * s);
  const torp = new THREE.CapsuleGeometry(0.06 * s, 0.24 * s, 6, 14); torp.rotateX(Math.PI / 2);
  mesh(torp, grey, 0, -drop, -0.34 * s);
  mesh(new THREE.BoxGeometry(0.022 * s, 0.15 * s, 0.16 * s), grey, 0, -drop - 0.11 * s, -0.31 * s);
  // Propeller: a hub and three pitched blades, spun about the shaft.
  const prop = new THREE.Group(); prop.position.set(0, -drop, -0.56 * s); g.add(prop);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.045 * s, 0.09 * s, 12).rotateX(Math.PI / 2), steel); prop.add(hub);
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), steel);
    blade.scale.set(0.045 * s, 0.11 * s, 0.01 * s); blade.position.set(0, 0.1 * s, 0); blade.rotation.y = 0.55;
    const arm = new THREE.Group(); arm.rotation.z = k * Math.PI * 2 / 3; arm.add(blade); prop.add(arm);
  }
  return { g, prop };
}

export function buildBoatKit(model) {
  const MS = model.scale || 1, R = model.R * MS;
  // Body length from everything but the wheels, in the model's outer (world-sized) frame.
  model.group.updateMatrixWorld(true);
  // The hull's width comes from the long panels only, so mirrors and badges do not count.
  const pivots = new Set(model.wheels.map((w) => w.pivot)), box = new THREE.Box3(), body = new THREE.Box3(), inv = model.group.matrixWorld.clone().invert(), tmp = new THREE.Box3();
  model.group.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (pivots.has(p)) return;
    tmp.setFromObject(o).applyMatrix4(inv); box.union(tmp);
    if (tmp.max.z - tmp.min.z > 1.5) body.union(tmp);
  });
  const track = Math.max(...model.wheels.map((w) => Math.abs(w.x)));
  const halfW = Math.max(track + 0.22, body.max.x + 0.14), depth = R * 1.8, gunwale = R + R * 0.9;
  // The hull runs from just behind the car's tail to a bow well ahead of its nose.
  const z0 = box.min.z + 0.05, z1 = box.max.z + Math.max(1.5, halfW * 1.5);
  const nose = (box.max.z + 0.04 - z0) / (z1 - z0), bowAt = Math.max(0.5, nose - 0.04);
  const wlLocal = -depth * 0.58;

  const group = new THREE.Group();
  group.userData.dynamic = true; // never merged: it scales and moves
  const hullG = new THREE.Group(); hullG.position.y = gunwale; group.add(hullG);
  const { geo, shape } = hullGeometry(halfW, z0, z1, depth, wlLocal, bowAt);
  const hull = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: paintTexture(), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide }));
  hull.castShadow = hull.receiveShadow = true; hullG.add(hull);
  // Teak cockpit floor under the car, and a white crowned foredeck ahead of it.
  const floor = new THREE.Mesh(deckGeometry(shape, z0, z1, 0, nose, 0, 0.97, 0.02), new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.75 }));
  floor.receiveShadow = true; hullG.add(floor);
  const liner = new THREE.Mesh(linerGeometry(shape, z0, z1, nose, 0.02), new THREE.MeshStandardMaterial({ color: 0xe9ebe6, roughness: 0.4, side: THREE.DoubleSide }));
  liner.receiveShadow = true; hullG.add(liner);
  const fore = new THREE.Mesh(deckGeometry(shape, z0, z1, nose, 1, 0.07, 1.0), new THREE.MeshPhysicalMaterial({ color: 0xf1f2ee, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 }));
  fore.castShadow = fore.receiveShadow = true; hullG.add(fore);
  // A stainless bow rail round the foredeck on short stanchions.
  const steel = new THREE.MeshStandardMaterial({ color: 0xd5dade, roughness: 0.15, metalness: 1 });
  const railPts = [], stan = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16, side = t < 0.5 ? -1 : 1, f = t < 0.5 ? t * 2 : (1 - t) * 2; // 0 at the aft ends, 1 at the stem
    const u = lerp(nose + 0.02, 0.97, f), sh = shape(u);
    const p = new THREE.Vector3(side * sh.w * 0.86 * (f > 0.98 ? 0 : 1), sh.top + 0.3, z0 + (z1 - z0) * u);
    if (k === 8) p.x = 0;
    railPts.push(p);
    if (k % 4 === 0) stan.push(p);
  }
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 48, 0.016, 6), steel); rail.castShadow = true; hullG.add(rail);
  for (const p of stan) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.3, 6), steel); m.position.set(p.x, p.y - 0.15, p.z); hullG.add(m); }
  // The outboard, on the transom, sized to the boat. It tilts up out of the way while the hull
  // folds out, then trims down into the water.
  const os = clamp(halfW / 1.05, 0.8, 1.25);
  const ob = outboard(os, depth + 0.1), bucket = new THREE.Group(); // bucket: steered with the wheel (jeep.js)
  bucket.add(ob.g); const tilt = new THREE.Group(); tilt.add(bucket); group.add(tilt);
  tilt.position.set(0, gunwale + 0.02, z0 - 0.02);
  // Navigation lights: red to port, green to starboard on the foredeck, white on a short mast at
  // the stern.
  const nav = [[-1, 0xff2a2a], [1, 0x2aff5c]].map(([sx, c]) => {
    const u = lerp(nose, 1, 0.45), sh = shape(u);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0 }));
    m.position.set(sx * sh.w * 0.9, gunwale + sh.top + 0.05, z0 + (z1 - z0) * u); group.add(m); return m;
  });
  const sternLight = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 }));
  sternLight.position.set(halfW * 0.7, gunwale + 0.62, z0 + 0.12); group.add(sternLight); nav.push(sternLight);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), steel); mast.position.set(halfW * 0.7, gunwale + 0.31, z0 + 0.12); group.add(mast);
  model.group.add(group);
  for (const w of model.wheels) w.baseX = w.pivot.position.x;
  // Fender flares, when the model marks them, tuck away as the wheels fold.
  const flares = [];
  model.group.traverse((o) => { if (o.userData.flare) flares.push(o); });

  const apply = (t) => {
    const s = stages(t);
    group.visible = t > 0.005;
    hullG.visible = s.hull > 0.01;
    hullG.scale.set(lerp(0.78, 1, s.hull), lerp(0.04, 1, s.hull), lerp(0.9, 1, s.hull));
    tilt.visible = s.jet > 0.01;
    tilt.rotation.x = lerp(1.25, 0, s.jet); // tilted up, then trimmed down
    for (const n of nav) n.material.emissiveIntensity = s.jet * 4;
    mast.visible = sternLight.visible = s.jet > 0.01;
    for (const f of flares) { f.visible = s.flare > 0.01; f.scale.setScalar(Math.max(s.flare, 0.01)); }
  };
  apply(0);
  return {
    group, apply, bucket, prop: ob.prop, R, MS, halfW, z0, z1,
    // Where the water sits on the hull, as a height above the car's ground line.
    waterline: gunwale + wlLocal,
    // Height of the car's top above its ground line.
    height: box.max.y,
    // How far the wheel pivots rise to lie flat on the deck, in the model's own units.
    lift: (gunwale + 0.2 - R) / MS,
    inset: 0.06 / MS,
  };
}

// ---------- Water around a boat ----------
// Textures are drawn once from periodic value noise, so the foam tiles along the wake.
function tileNoise(PX, PY, seed) {
  const h = (i, j) => { i = ((i % PX) + PX) % PX; j = ((j % PY) + PY) % PY; const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
// Repeats every px cells across and py cells along.
function fbmTile(px, py, oct, seed) {
  const n = [];
  for (let k = 0; k < oct; k++) n.push(tileNoise(px << k, py << k, seed + k));
  return (x, y) => { let s = 0, a = 0.5, f = 1, w = 0; for (let k = 0; k < oct; k++) { s += a * n[k](x * f, y * f); w += a; a *= 0.5; f *= 2; } return s / w; };
}
// White, with fn(u, v) as its alpha. A data texture keeps the white exact where the alpha is low
// (a canvas would darken it there, leaving grey fringes). Row 0 is v = 0.
function alphaTex(w, h, fn, repeat) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(clamp(fn(x / w, y / h), 0, 1) * 255);
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  if (repeat) t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
// Foam streaked along the wake, laced with holes, soft at both edges; tiles along its length.
function foamTexture() {
  const big = fbmTile(4, 16, 4, 3), lace = fbmTile(16, 64, 3, 11);
  return alphaTex(128, 512, (u, v) => {
    const edge = smooth(0, 0.28, u) * (1 - smooth(0.72, 1, u));
    const f = smooth(0.38, 0.72, big(u * 4, v * 16)) * smooth(0.28, 0.55, lace(u * 16, v * 64));
    return edge * (0.12 + 0.88 * f);
  }, true);
}
// Foam hugging the hull: a thin collar along the sides, piling up at the bow, churned at the stern.
function ringTexture(a, b) {
  const n = fbmTile(8, 16, 4, 21);
  return alphaTex(128, 256, (u, v) => {
    const px = u * 2 - 1, py = 1 - v * 2; // v = 0 is the bow end of the plane
    const r = py > 0 ? Math.hypot(px / a, py / b) : Math.pow(Math.pow(Math.abs(px / a), 4) + Math.pow(Math.abs(py / b), 4), 0.25);
    const d = r - 1, bow = smooth(0.1, 1, py), w = 0.05 + 0.16 * bow;
    let s = d < -0.02 ? 0 : Math.exp(-(((d - 0.05) / w) ** 2));
    s += smooth(-b, -1, py) * (1 - smooth(0.15, a * 1.1, Math.abs(px))) * 0.9; // churn behind the stern
    return s * (0.3 + 0.7 * smooth(0.35, 0.7, n(u * 8, v * 16)));
  }, false);
}
// Sprites: a burst of droplets, and a soft cloud of mist.
function dropTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const r = Math.sqrt(Math.random()) * 22, a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3.2;
    const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r, gr = g.createRadialGradient(x, y, 0, x, y, s);
    gr.addColorStop(0, `rgba(255,255,255,${0.9 - r / 40})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function mistTexture() {
  const n = fbmTile(4, 4, 4, 41);
  return alphaTex(64, 64, (u, v) => { const r = Math.hypot(u - 0.5, v - 0.5) * 2; return (1 - smooth(0.2, 1, r)) * (0.35 + 0.65 * n(u * 4, v * 4)); }, false);
}

// Particles that fade and grow as they age, drawn with fog and lit by the time of day.
class Spray {
  constructor(scene, { count, map, opacity, gravity, drag, grow }) {
    Object.assign(this, { n: count, gravity, drag, grow, opacity, next: 0 });
    this.pos = new Float32Array(count * 3).fill(-9999); this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count); this.max = new Float32Array(count); this.size0 = new Float32Array(count);
    this.size = new Float32Array(count); this.alpha = new Float32Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: map }, color: { value: new THREE.Color(0xf2f7f9) }, uScale: { value: 500 } }]),
      vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
        #include <fog_pars_vertex>
        void main() { vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * uScale / max(0.5, -mvPosition.z); vA = aAlpha;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA;
        #include <fog_pars_fragment>
        void main() { float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.004) discard; gl_FragColor = vec4(color, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 3; this.points.userData.noAO = true;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.max[i] = life; this.size0[i] = size;
  }
  update(dt) {
    const p = this.pos, v = this.vel, dr = Math.max(0, 1 - this.drag * dt);
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i]) { this.alpha[i] = 0; any = true; } continue; }
      any = true;
      this.life[i] -= dt;
      v[i * 3 + 1] -= this.gravity * dt;
      v[i * 3] *= dr; v[i * 3 + 1] *= dr; v[i * 3 + 2] *= dr;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      this.alpha[i] = this.opacity * Math.min(1, t * 8) * Math.pow(1 - t, 1.3);
      this.size[i] = this.size0[i] * (1 + this.grow * t);
    }
    if (any) { const a = this.points.geometry.attributes; a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true; }
  }
}

// Everything a boat does to the water: the foam collar round the hull, the wake (a churned
// trail straight behind and two arms spreading at the Kelvin angle, 19.5 degrees), the rooster
// tail off the jet, spray sheets off the bow and a drift of mist.
const KELVIN = Math.tan((19.47 * Math.PI) / 180);
export class BoatWater {
  constructor(scene, { low = false } = {}) {
    this.n = 90; this.trail = []; this.clock = 0; this.time = 0; this.carry = { drop: 0, mist: 0, bow: 0 };
    this.light = 1;
    // Three ribbons: left arm, wash, right arm.
    const n = this.n, R = 3;
    this.pos = new Float32Array(R * n * 6); this.col = new Float32Array(R * n * 8);
    const uv = new Float32Array(R * n * 4), idx = [];
    for (let r = 0; r < R; r++) for (let i = 0; i < n - 1; i++) { const b = (r * n + i) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    this.uv = uv;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.geo = geo;
    // Foam is brighter than the water around it, so it is drawn unlit and dimmed with the daylight.
    this.wake = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: foamTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.wake.frustumCulled = false; this.wake.renderOrder = 2; this.wake.visible = false; this.wake.userData.noAO = true;
    scene.add(this.wake);
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 }));
    this.ring.renderOrder = 2; this.ring.visible = false; this.ring.userData.noAO = true;
    scene.add(this.ring);
    this.drops = new Spray(scene, { count: low ? 450 : 1000, map: dropTexture(), opacity: 0.95, gravity: 9.8, drag: 0.7, grow: 1.4 });
    this.mist = new Spray(scene, { count: low ? 140 : 320, map: mistTexture(), opacity: 0.07, gravity: -0.1, drag: 1.8, grow: 1.8 });
  }

  // Fit the foam collar to this boat (called when the car changes).
  fit(K) {
    if (this.ringFor === K) return;
    this.ringFor = K;
    const w = K.halfW * 2 * 1.7, l = (K.z1 - K.z0) * 1.4;
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(0, 0, (K.z0 + K.z1) / 2);
    this.ring.material.map?.dispose();
    this.ring.material.map = ringTexture(1 / 1.7, 1 / 1.4); this.ring.material.needsUpdate = true;
  }

  // Emit about rate*dt particles a frame, carrying the fraction over.
  count(key, rate, dt) { const c = this.carry[key] + rate * dt, k = Math.floor(c); this.carry[key] = c - k; return k; }

  update(dt, car, camera, heightPx) {
    this.time += dt; this.clock += dt;
    const K = car.kit; this.fit(K);
    const afloat = car.boatOn && car.boat > 0.7, sp = Math.max(0, car.vF), boost = car.boosting ? 1 : 0;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = fz, rz = -fx;
    const wl = waterLevelAt(car.pos.x, car.pos.z);
    const L = this.light, c = new THREE.Color(0xf2f6f7).multiplyScalar(L);
    this.drops.mat.uniforms.color.value.copy(c); this.mist.mat.uniforms.color.value.copy(c);
    this.wake.material.color.copy(c); this.ring.material.color.copy(c);
    const scale = heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.drops.mat.uniforms.uScale.value = this.mist.mat.uniforms.uScale.value = scale;

    // Foam collar: faint when drifting, thick at speed.
    const ringA = afloat ? 0.3 + 0.6 * clamp(sp / 10, 0, 1) : 0;
    this.ring.material.opacity += (ringA - this.ring.material.opacity) * Math.min(1, dt * 3);
    this.ring.visible = this.ring.material.opacity > 0.01;
    this.ring.position.set(car.pos.x, wl + 0.035, car.pos.z); this.ring.rotation.y = car.heading;

    // Wake samples from the stern.
    const sx = car.pos.x + fx * K.z0, sz = car.pos.z + fz * K.z0, T = this.trail;
    if (T[0] && Math.hypot(sx - T[0].x, sz - T[0].z) > 40) T.length = 0; // the car was moved across the map
    if (afloat && sp > 0.8 && this.clock > 0.1) {
      this.clock = 0;
      const prev = T[0], d = prev ? Math.hypot(sx - prev.x, sz - prev.z) : 0;
      T.unshift({ x: sx, z: sz, h: car.heading, v: sp, y: waterLevelAt(sx, sz) + 0.04, t: this.time, s: (prev?.s ?? 0) + d });
      if (T.length > this.n) T.pop();
    }
    while (T.length && this.time - T[T.length - 1].t > 9) T.pop();
    this.ribbons(K);

    // Spray.
    if (afloat && sp > 1) {
      const sy = wl + 0.15, jx = sx - fx * 0.3, jz = sz - fz * 0.3;
      // Rooster tail: a plume thrown up and back off the jet, heavier on nitro.
      for (let k = this.count('drop', (30 + sp * 12) * (1 + boost * 1.5), dt); k > 0; k--) {
        const back = sp * (0.45 + Math.random() * 0.25) + 2, up = 2.6 + Math.random() * 2.4 + sp * 0.16 * (1 + boost * 0.6), side = (Math.random() - 0.5) * 2.2;
        this.drops.emit(jx + (Math.random() - 0.5) * 0.4, sy, jz + (Math.random() - 0.5) * 0.4, fx * sp - fx * back + rx * side, up, fz * sp - fz * back + rz * side, 0.8 + Math.random() * 0.6, 0.35 + Math.random() * 0.35);
      }
      for (let k = this.count('mist', (2 + sp * 0.45) * (1 + boost), dt); k > 0; k--) {
        this.mist.emit(jx, sy + 0.3, jz, fx * sp * 0.6 - fx * 2 + (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.2, fz * sp * 0.6 - fz * 2 + (Math.random() - 0.5) * 1.5, 1.2 + Math.random() * 0.8, 1.2 + Math.random() * 1.0);
      }
      // Bow spray: sheets thrown out to each side once it is going, more in a turn on the outside.
      if (sp > 4) for (const s of [-1, 1]) {
        const turn = 1 + Math.max(0, -s * car.steerVis) * 2;
        const bz = K.z1 - (K.z1 - K.z0) * 0.3, bx = car.pos.x + fx * bz + rx * s * K.halfW * 0.85, bzz = car.pos.z + fz * bz + rz * s * K.halfW * 0.85;
        for (let k = this.count('bow', sp * 3 * turn * (1 + boost * 0.8), dt / 2); k > 0; k--) {
          const out = 1.6 + sp * 0.18 * Math.random();
          this.drops.emit(bx, wl + 0.1, bzz, fx * sp * 0.55 + rx * s * out, 1.2 + Math.random() * (0.8 + sp * 0.07), fz * sp * 0.55 + rz * s * out, 0.5 + Math.random() * 0.4, 0.25 + Math.random() * 0.25);
        }
      }
    }
    this.drops.update(dt); this.mist.update(dt);
  }

  ribbons(K) {
    const T = this.trail, n = this.n;
    this.wake.visible = T.length > 1;
    if (!this.wake.visible) return;
    this.col.fill(0);
    const put = (r, i, x, y, z, px, pz, hw, a, s) => {
      const b = (r * n + i) * 2;
      this.pos.set([x - px * hw, y, z - pz * hw, x + px * hw, y, z + pz * hw], b * 3);
      this.col.set([1, 1, 1, a, 1, 1, 1, a], b * 4);
      this.uv.set([0, s, 1, s], b * 2);
    };
    T.forEach((p, i) => {
      const age = this.time - p.t, px = Math.cos(p.h), pz = -Math.sin(p.h), fadeIn = Math.min(1, i / 3);
      const v = clamp(p.v / 4, 0, 1), sV = (p.s - this.time * 0.6) / 7;
      // Wash: the churned trail straight behind, widening and settling.
      put(1, i, p.x, p.y + 0.004, p.z, px, pz, K.halfW * 0.8 + age * 0.85, Math.pow(Math.max(0, 1 - age / 5.5), 1.5) * v * fadeIn * 0.95, sV);
      // Arms: the bow waves, running out at the Kelvin angle as they age.
      const off = K.halfW * 0.9 + p.v * age * KELVIN;
      const aA = Math.pow(Math.max(0, 1 - age / 9), 1.3) * v * fadeIn * 0.75, hwA = 0.35 + age * 0.22;
      put(0, i, p.x - px * off, p.y, p.z - pz * off, px, pz, hwA, aA, sV * 1.6);
      put(2, i, p.x + px * off, p.y, p.z + pz * off, px, pz, hwA, aA, sV * 1.6 + 0.37);
    });
    // Collapse the unused tail of each ribbon onto its last point.
    for (let r = 0; r < 3; r++) {
      const last = (r * n + T.length - 1) * 6;
      for (let i = T.length; i < n; i++) this.pos.copyWithin((r * n + i) * 6, last, last + 6);
    }
    const a = this.geo.attributes; a.position.needsUpdate = a.color.needsUpdate = a.uv.needsUpdate = true;
  }

  clear() { this.trail.length = 0; this.wake.visible = false; }
}
