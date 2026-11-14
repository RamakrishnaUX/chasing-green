// Landmarks rebuilt from photographs once the island grew (WS 3.36) and left room around them:
// Eldhraun's moss-wrapped lava hummocks, the Hverir geothermal field, and the two lava fissures,
// Grjótagjá (warm water in a cave along the rift) and Silfra (clear spring water between the plates).
//
// The land-like parts (moss, lava walls) use the terrain shader, so on the realistic look they carry
// the same scanned lava moss and rock as the ground around them. Each is a handful of meshes, built
// once, with no per-frame work beyond the steam and the mud.
import * as THREE from 'three';
import { createTerrainMaterial, createWaterMaterial } from './materials.js';
import { basaltRock, sweepGeometry, masked } from './basalt.js';
import { createNoise2D, mulberry32 } from './noise.js';

const nA = createNoise2D(7131), nB = createNoise2D(2207), nC = createNoise2D(5519);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (i, j, s = 0) => { const n = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
const std = (color, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
const keep = (m, cast = true) => { m.userData.keepShape = true; m.castShadow = cast; m.receiveShadow = true; return m; };

// Cushions of moss over a jumble of lava: jittered cells, each a rounded mound of its own height,
// so between them run the dark cracks of the lava below. Height above the land, in metres.
function hummocks(x, z, cell, lo, hi) {
  const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
  let h = 0, crack = 1e9;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj;
    const cx = (i + 0.2 + hash(i, j, 1) * 0.6) * cell, cz = (j + 0.2 + hash(i, j, 2) * 0.6) * cell;
    const r = cell * (0.62 + hash(i, j, 3) * 0.3), d = Math.hypot((x - cx) * (0.8 + hash(i, j, 4) * 0.4), z - cz) / r;
    if (d < 1) h = Math.max(h, (lo + (hi - lo) * hash(i, j, 5)) * Math.pow(1 - d * d, 0.45));
    crack = Math.min(crack, d);
  }
  return { h, crack };
}

// A heightfield laid over the land in the landmark's frame: y(x, z) and the terrain shader's masks
// (black sand, lava, ice) per point. Cells with nothing on them are left out.
function sheet(kit, { x0, x1, z0, z1, step, y, mask, material }) {
  const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
  const pos = [], col = [], idx = [], used = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (i / nx) * (x1 - x0), z = z0 + (j / nz) * (z1 - z0);
    const m = mask(x, z);
    pos.push(x, y(x, z, m), z);
    col.push(m[0], m[1], m[2]);
    used.push(m[0] + m[1] + m[2] > 0.01 || m[3]);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if (!(used[a] || used[b] || used[c] || used[d])) continue;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return keep(new THREE.Mesh(g, material), false);
}

// Keep the grass field (which grows from the land underneath) out of an area, as a cover of circles.
function clearGrassRect(kit, x0, x1, z0, z1, r = 9, keepIn = () => true) {
  for (let x = x0; x <= x1; x += r * 1.2) for (let z = z0; z <= z1; z += r * 1.2) if (keepIn(x, z)) kit.clearGrass(x, z, r);
}

// A strip of water along a curve, its uv running 0 to 1 across, so the water shader's bowl depth
// is deepest down the middle and shallow at the edges.
function waterStrip(kit, curve, halfWidth, level, mat) {
  const pos = [], uv = [], idx = [], S = 48;
  for (let i = 0; i <= S; i++) {
    const t = i / S, P = curve.getPointAt(t), T = curve.getTangentAt(t), w = halfWidth(t), y = level(P.x, P.z, t);
    pos.push(P.x - T.z * w, y, P.z + T.x * w, P.x + T.z * w, y, P.z - T.x * w);
    uv.push(0, 0.5, 1, 0.5);
    if (i) idx.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// ---------- Eldhraun ----------
// The 1783 Laki lava, a field of knobbly hummocks a metre or two high, every one of them buried
// under a deep, spongy coat of grey-green woolly moss (Racomitrium) that runs to the horizon.
// A narrow trail of dark cinder wanders in from the lay-by; stepping off it is forbidden (the moss
// takes decades to heal), so there is a rope along it.
export function buildEldhraun(kit) {
  const g = new THREE.Group();
  const trailX = (z) => Math.sin(z * 0.07) * 6 + Math.sin(z * 0.19) * 1.5;
  const W = kit.quality === 'low' ? 46 : 62, D = kit.quality === 'low' ? 70 : 96, step = kit.quality === 'low' ? 0.9 : 0.55;
  const mat = createTerrainMaterial();
  mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
  const field = sheet(kit, {
    x0: -W, x1: W, z0: -D, z1: -5, step, material: mat,
    mask: (x, z) => {
      // Ragged edge: the field fades out into the lava plain, and stops short of the road.
      const r = Math.hypot(x / W, (z + D / 2) / (D / 2));
      const edge = 1 - sstep(0.72, 1.0, r + nA(x * 0.05, z * 0.05) * 0.18);
      const road = sstep(6.5, 11, kit.roadDist(x, z));
      const onTrail = 1 - sstep(0.9, 1.6, Math.abs(x - trailX(z)));
      const k = edge * road;
      return [onTrail * k * 0.85, k, 0, 0];
    },
    y: (x, z, m) => {
      const k = m[1];
      const { h } = hummocks(x + 400, z + 400, 2.7, 0.6, 2.2);
      const knob = nB(x * 0.9, z * 0.9) * 0.12 + nC(x * 2.3, z * 2.3) * 0.05; // the moss's own lumpy pile
      const down = 1 - m[0] / 0.85 * 0.9; // the trail is trodden flat
      return kit.ground(x, z) + 0.03 + (h * down + knob) * k * (0.6 + 0.4 * sstep(0.2, 0.6, k));
    },
  });
  g.add(field);
  clearGrassRect(kit, -W, W, -D, -6, 9, (x, z) => Math.hypot(x / W, (z + D / 2) / (D / 2)) < 1.05);
  // Broken lava breaking through the moss here and there: the odd dark spur or slab.
  const rock = basaltRock(), rand = mulberry32(83);
  for (let i = 0; i < (kit.quality === 'low' ? 6 : 14); i++) {
    const x = (rand() - 0.5) * W * 1.4, z = -12 - rand() * (D - 20);
    if (Math.abs(x - trailX(z)) < 3 || kit.roadDist(x, z) < 10) continue;
    const s = 0.8 + rand() * 1.4, y0 = kit.ground(x, z);
    const geo = sweepGeometry([[x - s, y0 - 0.4, z], [x, y0 + s * 0.7, z + s * 0.3], [x + s * 1.2, y0 - 0.4, z + s * 0.2]], { w: () => s * 1.1, h: () => s * 0.9, K: 12, seed: i * 3.7, rough: 0.35 });
    g.add(keep(new THREE.Mesh(masked(geo, () => [0, 0.25, 0]), rock)));
  }
  // Rope and low posts along the trail.
  const post = std(0x5a4632, 0.9), rope = std(0xc8b48a, 0.8);
  const pts = [];
  for (let z = -8; z > -D + 18; z -= 3.2) {
    for (const s of [-1, 1]) {
      const x = trailX(z) + s * 1.35, y = kit.ground(x, z);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 6), post);
      p.position.set(x, y + 0.4, z); p.castShadow = true; g.add(p);
      pts.push([s, x, y + 0.7, z]);
    }
  }
  for (const s of [-1, 1]) {
    const line = pts.filter((p) => p[0] === s).map((p) => new THREE.Vector3(p[1], p[2], p[3]));
    if (line.length > 1) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), line.length * 3, 0.02, 4), rope));
  }
  return g;
}

// ---------- Hverir ----------
// The geothermal field under Námafjall: bare clay stained cream, ochre, rust and sulphur yellow,
// crusted white round the vents; fumaroles roaring out of cairns of altered rock; grey mud pots
// boiling; a rope-lined path across it all. Everything on it is from photographs of the place.
export function buildHverir(kit) {
  const g = new THREE.Group();
  const R = 58;
  const vents = [[-14, -16, 2.8, 2.9], [7, -24, 2.2, 2.5], [20, -10, 2.5, 2.7], [-26, -34, 2, 2.3], [-3, -42, 3, 3.2], [24, -38, 1.8, 2.1]];
  const pots = [[-4, -12, 2.6], [12, -14, 1.8], [-18, -26, 2.2], [6, -33, 3.1], [16, -26, 1.5]];
  const near = (list, x, z) => { let d = 1e9, k = null; for (const v of list) { const e = Math.hypot(x - v[0], z - v[1]) - (v[2] || 0); if (e < d) { d = e; k = v; } } return { d, k }; };
  const pathX = (z) => Math.sin(z * 0.05 + 0.6) * 5;
  // Ground: a fine sheet tinted by hand (vertex colours on a plain material, so the realistic look's
  // grass scans cannot turn it green), raised a little round each vent and dished at each pot.
  const nx = kit.quality === 'low' ? 110 : 190, pos = [], col = [], idx = [];
  // Picked from photographs (display colours, so converted to the linear values the shader mixes).
  const C = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  const c = new THREE.Color(), cream = C(0.78, 0.68, 0.53), ochre = C(0.74, 0.53, 0.3), rust = C(0.6, 0.33, 0.18);
  const sulphur = C(0.86, 0.78, 0.36), crust = C(0.86, 0.85, 0.8), mudC = C(0.4, 0.39, 0.38), wet = C(0.38, 0.32, 0.26);
  const path = C(0.42, 0.37, 0.32);
  for (let j = 0; j <= nx; j++) for (let i = 0; i <= nx; i++) {
    const x = -R + (2 * R * i) / nx, z = -R * 1.5 + (2 * R * j) / nx * 0.75 + R * 0.5;
    const rr = Math.hypot(x / R, (z + 26) / (R * 0.75));
    const v = near(vents, x, z), p = near(pots, x, z);
    let y = kit.ground(x, z) + 0.06;
    if (v.d < 3) y += (1 - sstep(-v.k[2], 3, v.d)) * 0.7; // the vent's own mound of sinter
    if (p.d < 0) y -= 0.35 * sstep(0, -p.k[2], p.d) + 0.1; // the pot's dish
    if (kit.roadDist(x, z) < 6.5) y -= 0.5;
    pos.push(x, y, z);
    const n1 = nA(x * 0.06, z * 0.06), n2 = nB(x * 0.17, z * 0.17), n3 = nC(x * 0.5, z * 0.5);
    c.copy(cream).lerp(ochre, sstep(-0.2, 0.6, n1)).lerp(rust, sstep(0.25, 0.75, n2) * 0.7);
    c.lerp(crust, sstep(0.55, 0.9, n3) * 0.3);
    c.lerp(sulphur, (1 - sstep(0.5, 5, v.d)) * (0.55 + 0.35 * n3));
    c.lerp(crust, (1 - sstep(-1, 1.5, v.d)) * 0.6);
    c.lerp(wet, (1 - sstep(0, 3, p.d)) * 0.6);
    c.lerp(mudC, 1 - sstep(-0.6, 0.4, p.d));
    c.lerp(path, (1 - sstep(1.1, 1.7, Math.abs(x - pathX(z)))) * 0.85);
    c.multiplyScalar(0.92 + n3 * 0.06);
    // Out at the rim the stains fade into the land's own colour (drawn transparent by alpha).
    const a = 1 - sstep(0.75, 1.0, rr + n1 * 0.12);
    col.push(c.r, c.g, c.b, a);
  }
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, d = cc + 1;
    if (col[a * 4 + 3] + col[b * 4 + 3] + col[cc * 4 + 3] + col[d * 4 + 3] < 0.01) continue;
    idx.push(a, cc, b, b, cc, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const groundMat = std(0xffffff, 0.97, { vertexColors: true, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  groundMat.userData.noDetail = true;
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true; ground.renderOrder = -1;
  ground.userData.notGround = true; ground.userData.keepShape = true;
  g.add(ground);
  clearGrassRect(kit, -R, R, -R, 10, 9, (x, z) => Math.hypot(x / R, (z + 26) / (R * 0.75)) < 0.95);

  // Fumaroles: a cairn of pale, altered rock, yellow-crusted where the gas comes out, roaring steam.
  const rand = mulberry32(611);
  const stoneGeo = new THREE.IcosahedronGeometry(1, 1);
  { const p = stoneGeo.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + 0.22 * Math.sin(p.getX(i) * 4.1 + 1) * Math.sin(p.getZ(i) * 3.7) + 0.12 * Math.sin(p.getY(i) * 5.3); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k); } stoneGeo.computeVertexNormals(); }
  let total = 0; const counts = vents.map(([, , r, h]) => { const n = Math.round(r * h * 9); total += n; return n; });
  const stones = new THREE.InstancedMesh(stoneGeo, std(0xffffff, 0.92), total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3(), e = new THREE.Euler();
  let k = 0;
  vents.forEach(([vx, vz, r, h], vi) => {
    const base = kit.ground(vx, vz);
    for (let n = 0; n < counts[vi]; n++) {
      // Stacked in a rough cone, bigger stones low down, open at the top where the gas vents.
      const t = Math.pow(rand(), 0.8), a = rand() * Math.PI * 2, rad = r * (1 - t * 0.78) * (0.55 + rand() * 0.45);
      const sz = (0.28 + rand() * 0.32) * (1.25 - t * 0.55);
      v3.set(vx + Math.cos(a) * rad, base + 0.2 + t * h, vz + Math.sin(a) * rad);
      q.setFromEuler(e.set(rand() * 3, rand() * 6, rand() * 3));
      s3.set(sz * (0.8 + rand() * 0.5), sz, sz * (0.8 + rand() * 0.5));
      stones.setMatrixAt(k, m4.compose(v3, q, s3));
      const top = sstep(0.55, 1, t);
      c.setRGB(0.6, 0.55, 0.47, THREE.SRGBColorSpace).multiplyScalar(0.75 + rand() * 0.4).lerp(rust, rand() < 0.3 ? 0.45 : 0).lerp(sulphur, top * (0.4 + rand() * 0.5)).lerp(crust, rand() < 0.15 ? 0.5 : 0);
      stones.setColorAt(k++, c);
    }
    // The plume: dense and fast at the mouth, billowing and thinning as it climbs.
    const s = kit.makeMist(kit.quality === 'low' ? 70 : 170, 3, 26);
    s.material = s.material.clone(); s.material.opacity = 0.5; s.material.size = 7;
    s.position.set(vx, base + h + 0.2, vz);
    g.add(s); kit.steam(s, 2.2);
  });
  stones.castShadow = stones.receiveShadow = true;
  stones.userData.keepShape = true;
  g.add(stones);

  // Mud pots: boiling grey mud, slick and glossy, plopping up in domes that burst.
  const mud = std(0x6d6b67, 0.32, { envMapIntensity: 0.8 });
  const bubbles = [];
  for (const [x, z, r] of pots) {
    const y = kit.ground(x, z) - 0.18;
    const surf = new THREE.Mesh(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2), mud);
    surf.position.set(x, y, z); surf.receiveShadow = true; g.add(surf);
    for (let n = 0; n < Math.round(r * 2); n++) {
      const a = rand() * 6.28, d = rand() * r * 0.75;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mud);
      b.position.set(x + Math.cos(a) * d, y, z + Math.sin(a) * d);
      b.userData.phase = rand() * 6; b.userData.rate = 0.8 + rand() * 1.4; b.userData.dynamic = true;
      bubbles.push(b); g.add(b);
    }
    const s = kit.makeMist(30, r * 1.6, 5);
    s.material = s.material.clone(); s.material.opacity = 0.22; s.material.size = 4;
    s.position.set(x, y, z); g.add(s); kit.steam(s, 0.8);
  }
  kit.update((dt, t) => {
    for (const b of bubbles) {
      const ph = (t * b.userData.rate + b.userData.phase) % 1;
      const sz = ph < 0.85 ? sstep(0, 0.85, ph) : 0; // swells, then bursts
      b.scale.set(0.3 + sz * 1.1, 0.15 + sz * 1.3, 0.3 + sz * 1.1);
    }
  });

  // Rope fence along both sides of the path, on short timber posts.
  const post = std(0x6a5440, 0.9), rope = std(0xd8c9a2, 0.8);
  for (const side of [-1, 1]) {
    const line = [];
    for (let z = -6; z > -R * 1.05; z -= 3) {
      const x = pathX(z) + side * 1.6, y = kit.ground(x, z);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 6), post);
      p.position.set(x, y + 0.45, z); p.castShadow = true; g.add(p);
      line.push(new THREE.Vector3(x, y + 0.75, z));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), line.length * 3, 0.018, 4), rope));
  }
  // The warning sign at the start.
  const sign = new THREE.Group();
  sign.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), post).translateY(0.7));
  sign.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.05), std(0xe8d24a, 0.6)).translateY(1.45));
  sign.position.set(pathX(-5) + 2.4, kit.ground(pathX(-5) + 2.4, -5), -5);
  g.add(sign);
  return g;
}

// A broken block of lava: a blocky, slightly flattened lump with sharp-ish fractured faces.
function blockGeometry(s, rand) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, k = [rand() * 9, rand() * 9, rand() * 9];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Squared off a little toward a block, then roughened.
    const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)), f = 0.85 + 0.15 / Math.max(0.6, m);
    const n = 1 + nA(x * 1.7 + k[0], z * 1.7 + y + k[1]) * 0.18 + nB(x * 4 + k[2], y * 4 - z) * 0.06;
    p.setXYZ(i, x * f * n * s, y * f * n * s * 0.7, z * f * n * s * 1.1);
  }
  g.rotateY(rand() * 6.28);
  g.computeVertexNormals();
  return g;
}

// ---------- Fissures (Grjótagjá, Silfra) ----------
// A crack where the American and Eurasian plates pull apart: two lips of rough lava facing each
// other across a gap, their tops mossy, dropping sheer to water. path: the crack's centre line
// (local x, z); gap(t): width of the crack; lip(t): how high the walls stand above the land.
function fissureWalls(kit, path, { gap, lip, foot, wall = 4.5, seed = 0 }) {
  const g = new THREE.Group(), rock = basaltRock();
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  for (let i = 0; i <= 12; i++) { const P = curve.getPointAt(i / 12); kit.clearGrass(P.x, P.z, gap(i / 12) / 2 + wall * 2.2); }
  for (const side of [-1, 1]) {
    const pts = [];
    const S = 24;
    for (let i = 0; i <= S; i++) {
      const t = i / S, P = curve.getPointAt(t), T = curve.getTangentAt(t);
      const nx = -T.z * side, nz = T.x * side;
      const off = gap(t) / 2 + wall / 2 + nA(t * 6 + seed, side * 3) * 0.6;
      const x = P.x + nx * off, z = P.z + nz * off;
      pts.push([x, kit.ground(x, z) + (lip(t) + foot) / 2 + nB(t * 9 + seed, side) * 0.3, z]);
    }
    // Swept as a craggy block from the crack's floor to its lip, the side away from the crack
    // ramped down into the land; moss over the tops.
    const geo = masked(sweepGeometry(pts, { w: () => wall, h: (t) => lip(t) - foot, K: 26, seed: seed + side * 5, rough: 0.4, ramp: side }));
    // Lava moss over everything gentle enough to hold it; the sheer faces stay bare basalt.
    geo.computeVertexNormals();
    const nr = geo.attributes.normal, cl = geo.attributes.color;
    for (let i = 0; i < nr.count; i++) cl.setY(i, sstep(0.45, 0.8, nr.getY(i)));
    g.add(keep(new THREE.Mesh(geo, rock)));
    // Broken blocks along the lip and fallen into the crack.
    const rand = mulberry32(Math.round(seed * 100) + side);
    for (let i = 0; i < 16; i++) {
      const t = rand(), P = curve.getPointAt(t), T = curve.getTangentAt(t), nx = -T.z * side, nz = T.x * side;
      const fallen = rand() < 0.3, off = fallen ? gap(t) * (rand() - 0.5) * 0.6 : gap(t) / 2 + 0.4 + rand() * wall * 0.7;
      const x = P.x + nx * off, z = P.z + nz * off, s = 0.5 + rand() * 1.1;
      const y = fallen ? kit.ground(x, z) + foot * 0.2 : kit.ground(x, z) + lip(t) - s * 0.3;
      const b = blockGeometry(s, rand);
      b.translate(x, y, z);
      g.add(keep(new THREE.Mesh(masked(b, () => [0, rand() < 0.5 ? 0.7 : 0, 0]), rock)));
    }
  }
  return g;
}

// Grjótagjá: a long, low fissure ridge of black lava running across the land near Mývatn, mossy
// along its broken lips, and partway along it a dark opening where you climb down to a cave of warm,
// impossibly blue water, steam curling out of the crack. (Bathing stopped when the 1970s eruptions
// made it too hot; it is about 43 °C now.)
export function buildGrjotagja(kit) {
  const g = new THREE.Group();
  const path = [[-46, -22], [-24, -18], [0, -15], [22, -16], [44, -21]];
  const gap = (t) => 1.4 + 2.6 * Math.exp(-Math.pow((t - 0.5) / 0.12, 2)) + nC(t * 7, 1) * 0.3;
  const lip = (t) => 2.2 + 1.3 * Math.sin(t * Math.PI) + nC(t * 5, 2) * 0.5;
  g.add(fissureWalls(kit, path, { gap, lip, foot: -1.5, wall: 3.4, seed: 1.7 }));
  // The cave: a roof of lava bridging the crack in its widest part, the opening a black slot under it.
  const rock = basaltRock();
  const y0 = kit.ground(0, -15);
  const roof = sweepGeometry([[-6, y0 + 2.6, -14.6], [-2, y0 + 3.4, -15.2], [3, y0 + 3.3, -15.1], [7, y0 + 2.5, -14.8]], { w: () => 7.5, h: () => 1.6, K: 20, seed: 9.1, rough: 0.35 });
  g.add(keep(new THREE.Mesh(masked(roof, () => [0, 0.6, 0]), rock)));
  // Darkness inside the cave: a soft black backdrop under the roof.
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(9, 4), std(0x050607, 1));
  dark.position.set(0.5, y0 + 1.2, -16.4); g.add(dark);
  // The water: glowing turquoise down in the crack, clearest under the roof.
  const water = createWaterMaterial(0x2bb0d8, { roughness: 0.02, ripple: 0.12, shallow: [0.2, 0.72, 0.85], deep: [0.01, 0.2, 0.42], foam: 0, glow: 0.45, clarity: 0.12, bowl: 4 });
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  g.add(waterStrip(kit, curve, (t) => gap(t) / 2 + 0.5, (x, z) => kit.ground(x, z) + 0.3, water));
  // Steam drifting out of the crack.
  for (const [x, z, n] of [[0, -15, 50], [-14, -17, 20], [16, -15.5, 20]]) {
    const s = kit.makeMist(n, 4, 6);
    s.material = s.material.clone(); s.material.opacity = 0.2; s.material.size = 3.5;
    s.position.set(x, kit.ground(x, z) + 0.6, z); g.add(s); kit.steam(s, 0.5);
  }
  // A warm glow from the water at night.
  const glow = new THREE.PointLight(0x5fd0ff, 0, 14, 2);
  glow.position.set(0, y0 + 1.5, -15); g.add(glow);
  kit.update((dt, t, env) => { glow.intensity = (env.dark || 0) * 6; });
  return g;
}

// Silfra: a narrow crack in the lava where glacial meltwater, filtered for decades through the
// rock, wells up so clear you can see a hundred metres: deep blue over pale boulders between dark
// walls, with the divers' platform and steel steps down into it at the near end.
export function buildSilfra(kit) {
  const g = new THREE.Group();
  const path = [[1, -6], [-1, -20], [2, -34], [-2, -50], [1, -64]];
  const gap = (t) => 3.4 + 2.4 * sstep(0.55, 1, t) + nC(t * 6, 4) * 0.5;
  const lip = (t) => 2.4 + nC(t * 4, 5) * 0.5;
  g.add(fissureWalls(kit, path, { gap, lip, foot: -2.5, wall: 3.6, seed: 3.3 }));
  // The bed: pale, rounded boulders seen through the water.
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const rand = mulberry32(214), n = 70;
  const boulderGeo = new THREE.IcosahedronGeometry(1, 1);
  const boulders = new THREE.InstancedMesh(boulderGeo, std(0xffffff, 0.75), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = rand(), P = curve.getPointAt(t), T = curve.getTangentAt(t), w = (rand() - 0.5) * gap(t) * 0.8, s = 0.3 + rand() * 0.8;
    v3.set(P.x - T.z * w, kit.ground(P.x, P.z) + s * 0.2, P.z + T.x * w);
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 6, rand() * 3));
    boulders.setMatrixAt(i, m4.compose(v3, q, s3.set(s, s * 0.6, s * (0.8 + rand() * 0.4))));
    boulders.setColorAt(i, c.setRGB(0.42, 0.44, 0.42).multiplyScalar(0.7 + rand() * 0.5).lerp(new THREE.Color(0.25, 0.33, 0.2), rand() < 0.3 ? 0.4 : 0));
  }
  boulders.receiveShadow = true; boulders.userData.keepShape = true;
  g.add(boulders);
  // The water itself: very clear, turning a deep sapphire where the crack is deepest.
  const water = createWaterMaterial(0x1f8fb0, { roughness: 0.02, ripple: 0.15, shallow: [0.12, 0.55, 0.68], deep: [0.0, 0.06, 0.28], clarity: 0.09, foam: 0, bowl: 14 });
  g.add(waterStrip(kit, curve, (t) => gap(t) / 2 + 0.7, (x, z) => kit.ground(x, z) + 0.9, water));
  // The entry: a timber platform at the crack's head and steel steps down into the water.
  const steel = std(0x8d9296, 0.35, { metalness: 0.8 }), deck = std(0x6b5137, 0.85);
  const y0 = Math.max(kit.ground(1, -4), kit.ground(1, -2));
  const plat = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 3), deck);
  plat.position.set(1, y0 + 0.15, -3); plat.castShadow = plat.receiveShadow = true; g.add(plat);
  for (let i = 0; i < 6; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.3), steel);
    st.position.set(1, y0 - i * 0.32, -4.7 - i * 0.32); g.add(st);
  }
  for (const s of [-0.62, 0.62]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.8, 6), steel);
    rail.position.set(1 + s, y0 - 0.2, -5.6); rail.rotation.x = Math.PI / 4; g.add(rail);
  }
  return g;
}
