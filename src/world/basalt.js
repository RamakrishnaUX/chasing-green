// Shared pieces for the natural rock landmarks: the coast's basalt cliffs, sea stacks, arches and
// column fields (Reynisfjara, Dyrhólaey, Stuðlagil, Hvítserkur, Arnarstapi...).
//
// Everything here is built once at load as plain geometry: one material for all the basalt (so a
// landmark's rock bakes into one draw call), one instanced mesh per field of columns, and no
// per-frame work at all.
import * as THREE from 'three';
import { createTerrainMaterial } from './materials.js';
import { createNoise2D } from './noise.js';

const noise = createNoise2D(4242);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- Materials ----------
let basaltMat = null, sandMat = null, columnMat = null;
// The terrain shader (grass on ledges and tops, layered rock on the faces, the scanned textures
// on the realistic look), with its rock pulled from the mountains' warm brown to the near-black,
// cool grey of fresh basalt. One program, shared by every basalt landmark.
export function basaltRock() {
  if (basaltMat) return basaltMat;
  const m = createTerrainMaterial();
  const base = m.onBeforeCompile, key = m.customProgramCacheKey?.() || 'terrain';
  m.customProgramCacheKey = () => `${key}-basalt`;
  m.onBeforeCompile = (shader, r) => {
    base(shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `{
      float bz = clamp(tRockW + tEarthW * 0.5, 0.0, 1.0) * (1.0 - tSnowW);
      float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.9, 0.95, 1.03) * 0.62, bz * 0.85);
    }
    #include <emissivemap_fragment>`);
  };
  basaltMat = m;
  return m;
}
// Black sand laid over the land: the terrain shader again (its black-sand layer, glossy where the
// waves wet it), drawn just in front of the ground it covers.
export function sandMaterial() {
  if (sandMat) return sandMat;
  sandMat = createTerrainMaterial();
  sandMat.polygonOffset = true; sandMat.polygonOffsetFactor = -2; sandMat.polygonOffsetUnits = -6;
  return sandMat;
}
// Basalt columns: flat hexagonal facets, coloured per column; the realistic look adds its
// scanned rock to it (hd.js detailScene) like any grey rock.
export function columnMaterial() {
  if (!columnMat) { columnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0, flatShading: true }); columnMat.userData.landShadow = true; }
  return columnMat;
}

// ---------- Columns ----------
let hexGeo = null;
// A hexagonal prism of unit corner radius and height, base at y = 0, open underneath (it is
// always planted). Pointed along z, so a hexagonal grid with neighbours along x at sqrt(3) * r
// packs flat face to flat face.
export function hexColumnGeometry() {
  if (hexGeo) return hexGeo;
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
  g.translate(0, 0.5, 0);
  const bottom = g.groups[2];
  g.setIndex(Array.from(g.index.array.slice(0, bottom.start)));
  g.clearGroups();
  hexGeo = g;
  return g;
}
// An instanced field of columns. cols: [{ x, y, z, h, r, ry, tx, tz, c: THREE.Color }] in the
// parent's frame: base at (x, y, z), height h, corner radius r, turned ry, tilted tx / tz.
export function columnField(cols) {
  const mesh = new THREE.InstancedMesh(hexColumnGeometry(), columnMaterial(), cols.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
  cols.forEach((c, i) => {
    e.set(c.tx || 0, c.ry || 0, c.tz || 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(v.set(c.x, c.y, c.z), q, s.set(c.r, c.h, c.r));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.c);
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.keepShape = true;
  return mesh;
}
// Basalt tones as display colours: fresh basalt is a near-black blue-grey, and columns side by
// side differ only a little (a touch lighter where weathered, the odd one rusty or lichened).
export function basaltTone(rand, { rust = 0, lichen = 0, light = 0, base = [0.19, 0.2, 0.215], spread = 0.16 } = {}) {
  const c = new THREE.Color().setRGB(base[0], base[1], base[2], THREE.SRGBColorSpace);
  c.multiplyScalar(1 - spread / 2 + rand() * spread + light);
  if (rand() < rust) c.lerp(new THREE.Color().setRGB(0.36, 0.25, 0.17, THREE.SRGBColorSpace), 0.2 + rand() * 0.25);
  if (rand() < lichen) c.lerp(new THREE.Color().setRGB(0.36, 0.38, 0.28, THREE.SRGBColorSpace), 0.12 + rand() * 0.15);
  return c;
}

// ---------- Massifs ----------
// A rock massif from its plan: cliffs all round (with ledges, buttresses and any dents asked for)
// under a rounded grassy top. Built as rings: N points round a superellipse outline, F rings up
// the face from its foot to the lip, then T rings in across the top to a centre point.
//   cx, cz, ax, az, p: the outline (centre, half-widths, squareness); wob: how ragged it is
//   warp(z): sideways shift by z (bends the plan); lip(x, z): cliff-top height; top(x, z): the
//   top's height inside; foot(x, z): the face's base (below ground or seabed); inset(x, z, y, t):
//   set the face back by this much (t: 0 at the foot to 1 at the lip); lean: how far the face
//   leans back by the top.
// Returns the geometry, and edge(z, side): the outline's x at that z (side -1 west, +1 east).
export function massifGeometry(spec) {
  const { cx, cz, ax, az, p = 2.4, N = 160, F = 18, T = 7, wob = 0.08, lean = 1.2, seed = 0, topShape = 0 } = spec;
  const warp = spec.warp || (() => 0), inset = spec.inset || (() => 0);
  const M = F + 1 + T, pos = new Float32Array((N * M + 1) * 3);
  const outline = [];
  let w = 0;
  const put = (x, y, z) => { pos[w++] = x; pos[w++] = y; pos[w++] = z; };
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const R = Math.pow(Math.pow(Math.abs(c) / ax, p) + Math.pow(Math.abs(s) / az, p), -1 / p);
    const arc = a * (ax + az) * 0.5;
    const r = R * (1 + wob * (noise(arc * 0.05 + seed, 1.3) * 0.7 + noise(arc * 0.16 + seed, 5.1) * 0.3));
    const ox = c * r, oz = s * r, ex = cx + ox + warp(cz + oz), ez = cz + oz;
    outline.push([ex, ez]);
    const lip = spec.lip(ex, ez), foot = spec.foot(ex, ez);
    for (let j = 0; j <= F; j++) {
      const t = j / F, y = foot + (lip - foot) * t;
      // Ledges of stacked flows and the odd buttress, then whatever the builder sets back.
      const relief = (Math.sin(y * 1.1 + noise(arc * 0.08, y * 0.05 + seed) * 3) * 0.5 + 0.5) * 0.5 + noise(arc * 0.12 + 3, y * 0.09) * 0.7;
      const d = lean * t * t + relief * Math.min(1, t * 5) + inset(ex, ez, y, t);
      const k = Math.max(0.05, (r - d) / r), z = cz + oz * k;
      put(cx + ox * k + warp(z), y, z);
    }
    // In across the top: a sharp rim, then a rounded rise to the middle.
    for (let j = 1; j <= T; j++) {
      // topShape 0: a sharp rim, then a rounded rise (a plateau); above 0: slopes all the way
      // up to the ridge, concave by that power (a mountain's grassy flanks over its cliff).
      const f = j / (T + 1), k = topShape ? 1 - f * 0.98 - 0.02 : 1 - f * f * 0.98 - 0.02, z = cz + oz * k, x = cx + ox * k + warp(z);
      const rise = topShape ? 1 - Math.pow(1 - f, topShape) : 1 - Math.pow(1 - f, 2.2);
      put(x, lerp(lip + 0.2, spec.top(x, z), rise) + noise(x * 0.15, z * 0.15) * 0.4 * f, z);
    }
  }
  put(cx + warp(cz), spec.top(cx + warp(cz), cz), cz);
  const idx = [];
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    for (let m = 0; m < M - 1; m++) {
      const a = i * M + m, b = i2 * M + m, c = a + 1, d = b + 1;
      idx.push(a, c, d, a, d, b);
    }
    idx.push(i * M + M - 1, N * M, i2 * M + M - 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  orient(g);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  g.computeVertexNormals();
  // grassy (0 to 1): turf clings to slopes steeper than the terrain shader would grass over, so
  // the top's normals are bent toward the sky by this much (the cliff below keeps its own).
  if (spec.grassy) {
    const nr = g.attributes.normal, minY = 0.55 + 0.3 * spec.grassy;
    for (let i = 0; i < N; i++) for (let m = F + 2; m < M; m++) {
      const v = i * M + m, ny = nr.getY(v);
      if (ny >= minY) continue;
      const h = Math.hypot(nr.getX(v), nr.getZ(v)) || 1, k = Math.sqrt(1 - minY * minY) / h;
      nr.setXYZ(v, nr.getX(v) * k, minY, nr.getZ(v) * k);
    }
  }
  const edge = (z, side) => {
    let best = null;
    for (let i = 0; i < N; i++) {
      const [x0, z0] = outline[i], [x1, z1] = outline[(i + 1) % N];
      if ((z0 - z) * (z1 - z) > 0 || z0 === z1) continue;
      const x = x0 + (x1 - x0) * (z - z0) / (z1 - z0);
      if (best === null || (side < 0 ? x < best : x > best)) best = x;
    }
    return best;
  };
  return { geometry: g, edge };
}

// Flip the winding if the first side face looks inward (the generators above wind one way for a
// right-handed sweep; this keeps them honest whatever the sweep direction).
function orient(g) {
  const p = g.attributes.position, ix = g.index.array;
  let dot = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), ctr = new THREE.Vector3();
  g.computeBoundingBox(); g.boundingBox.getCenter(ctr);
  for (let t = 0; t < ix.length; t += 3 * 7) {
    a.fromBufferAttribute(p, ix[t]); b.fromBufferAttribute(p, ix[t + 1]); c.fromBufferAttribute(p, ix[t + 2]);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const m = a.add(b).add(c).multiplyScalar(1 / 3).sub(ctr);
    m.y = 0;
    dot += n.x * m.x + n.z * m.z;
  }
  if (dot < 0) for (let t = 0; t < ix.length; t += 3) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; }
}

// ---------- Sea stacks ----------
// A spire of basalt: an irregular, fluted prism (the vertical ribs of its columnar jointing, the
// horizontal ledges of its flows) narrowing to a ragged point. Several make one stack.
//   x, z: foot centre; foot, top: heights (local); rx, rz: half-widths at the foot; lean: [x, z]
//   offset of the tip; sharp: 0 (blunt, flat-topped) to 1 (a needle); seed.
export function spireGeometry({ x, z, foot, top, rx, rz, lean = [0, 0], sharp = 0.7, seed = 0, K = 26, ribs = 0.07, rot = 0 }) {
  const H = top - foot, rings = Math.max(6, Math.round(H / 0.9));
  const pos = [];
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, y = foot + H * t;
    // Narrowing: steady below, then quickly into the point.
    const taper = (1 - 0.35 * t) * (1 - sharp * Math.pow(t, 3.2)) * (t > 0.999 ? 0.08 : 1);
    const lx = lean[0] * t * t, lz = lean[1] * t * t;
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2;
      const n = noise(Math.cos(a) * 1.3 + seed, y * 0.11 + Math.sin(a) * 1.3) * 0.22 + noise(a * 3 + seed * 2, y * 0.4) * 0.07;
      const rib = (k % 2 ? 1 : -0.6) * ribs;
      const ledge = Math.max(0, Math.sin(y * 1.3 + noise(a + seed, y * 0.07) * 2.5)) * 0.06;
      const f = taper * (1 + n + rib + ledge);
      const px = Math.cos(a) * rx * f, pz = Math.sin(a) * rz * f;
      pos.push(x + lx + px * cr - pz * sr, y, z + lz + px * sr + pz * cr);
    }
  }
  pos.push(x + lean[0], top + 0.4, z + lean[1]);
  const idx = [], tip = (rings + 1) * K;
  for (let j = 0; j < rings; j++) for (let k = 0; k < K; k++) {
    const k2 = (k + 1) % K, a = j * K + k, b = j * K + k2, c = a + K, d = b + K;
    idx.push(a, d, c, a, b, d);
  }
  for (let k = 0; k < K; k++) idx.push(rings * K + k, rings * K + ((k + 1) % K), tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orient(g);
  return g;
}

// ---------- Arches ----------
// A rock bridge swept along a path: a craggy rounded block of cross-section w (across) by h
// (deep), its top flat enough to carry grass. Planted at both ends (path points below the
// ground), it leaves an opening under its middle. path: [[x, y, z], ...] through the middle of the
// section; widths/heights may vary along it: w(t), h(t).
// ramp: -1 or 1, a side (along the section's width) that slopes down to the land instead of
// standing as a cliff (a canyon wall whose back is the plateau).
export function sweepGeometry(path, { w, h, K = 28, seed = 0, rough = 0.18, plane = null, ramp = 0 }) {
  const curve = new THREE.CatmullRomCurve3(path.map((q) => new THREE.Vector3(...q)), false, 'centripetal');
  const L = curve.getLength(), S = Math.max(12, Math.round(L / 0.8));
  const pos = [], up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i <= S; i++) {
    const t = i / S, P = curve.getPointAt(t), Tn = curve.getTangentAt(t);
    // plane: a fixed side direction, for an arch swept within one upright plane (legs and all).
    if (plane) side.set(...plane); else side.crossVectors(Tn, up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    nrm.crossVectors(side, Tn).normalize();
    const W = w(t), Hh = h(t);
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      // A squarish section (a superellipse), flatter on top.
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 0.55), sy = Math.sign(s) * Math.pow(Math.abs(s), s > 0 ? 0.3 : 0.6);
      const n = 1 + noise(a * 2 + seed, t * L * 0.12) * rough + noise(a * 6 - seed, t * L * 0.35) * rough * 0.4;
      let ox = sx * W * 0.5 * n, oy = sy * Hh * 0.5 * (s > 0 ? 1 : n);
      if (ramp && sx * ramp > 0) { const f = Math.abs(sx); ox *= 1 + 2.6 * f; oy = Math.min(oy, Hh * 0.5 - f * Hh * 1.05); }
      pos.push(P.x + side.x * ox + nrm.x * oy, P.y + side.y * ox + nrm.y * oy, P.z + side.z * ox + nrm.z * oy);
    }
  }
  const idx = [];
  for (let i = 0; i < S; i++) for (let k = 0; k < K; k++) {
    const k2 = (k + 1) % K, a = i * K + k, b = i * K + k2, c = a + K, d = b + K;
    idx.push(a, c, d, a, d, b);
  }
  // Close both ends (they are buried, but shadows see them).
  const c0 = pos.length / 3; { const P = curve.getPointAt(0); pos.push(P.x, P.y, P.z); }
  const c1 = pos.length / 3; { const P = curve.getPointAt(1); pos.push(P.x, P.y, P.z); }
  for (let k = 0; k < K; k++) { const k2 = (k + 1) % K; idx.push(c0, k2, k, c1, S * K + k, S * K + k2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Outward is away from the path, not from the bounding box: check one mid-path face.
  const pa = g.attributes.position, ix = g.index.array, mid = Math.floor(S / 2) * K * 6;
  const A = new THREE.Vector3().fromBufferAttribute(pa, ix[mid]), B = new THREE.Vector3().fromBufferAttribute(pa, ix[mid + 1]), C = new THREE.Vector3().fromBufferAttribute(pa, ix[mid + 2]);
  const fn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
  const out = A.clone().sub(curve.getPointAt(0.5));
  if (fn.dot(out) < 0) for (let t = 0; t < ix.length; t += 3) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; }
  return g;
}

// Terrain-shader meshes need a (zeroed) colour attribute: their masks (black sand, lava, ice).
export function masked(g, mask = null) {
  if (!g.index && !g.attributes.position) return g;
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  if (mask) for (let i = 0; i < n; i++) { const m = mask(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)); c[i * 3] = m[0]; c[i * 3 + 1] = m[1]; c[i * 3 + 2] = m[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// ---------- Black sand ----------
// A sheet of black sand draped over the land (local frame): a grid over [x0, x1] x [z0, z1] at
// ground(x, z) + lift, its sand fading by amount(x, z, y) (0 to 1; at 0 it paints as the land
// beneath, so the edge is seamless). Cells wholly under the sea are left out.
export function sandSheet(ground, { x0, x1, z0, z1, step = 1.5, amount, lift = 0.05, sea = -Infinity }) {
  const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
  const pos = [], col = [], idx = [], wet = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (i / nx) * (x1 - x0), z = z0 + (j / nz) * (z1 - z0), y = ground(x, z);
    pos.push(x, y + lift, z);
    col.push(amount(x, z, y), 0, 0);
    wet.push(y < sea - 0.4);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if (wet[a] && wet[b] && wet[c] && wet[d]) continue;
    if (col[a * 3] + col[b * 3] + col[c * 3] + col[d * 3] < 0.01) continue;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, sandMaterial());
  m.receiveShadow = true;
  m.userData.notGround = true; // it is the ground
  m.userData.keepShape = true;
  return m;
}

export { sstep, lerp, noise as basaltNoise };
