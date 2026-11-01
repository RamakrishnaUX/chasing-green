import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Animal models, built in code: bodies are lofted through anatomical cross-sections (a horse's
// withers, barrel and rump; a sheep's woolly fleece; a whale's head, throat pleats and tail
// stock), legs come in two jointed segments with hooves, and each vertex carries
//   color: a fixed colour, or a shade for the coat or hair colour (per animal),
//   aKind: how much of the coat (x) and hair (y) colour it takes,
//   aFur:  how long the fur is there (fur shells grow out along the normal by this much).
// The material shades it all: coat and hair colours per animal, fine grain, soft fur sheen,
// seal spots, and fur shells.

const V3 = THREE.Vector3;
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Small 3D value noise for lumps (wool, tubercles) and markings.
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t) => t * t * (3 - 2 * t), u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// Smooth a list of sections with Catmull-Rom so the surface flows between them.
function smooth(secs, sub) {
  const keys = Object.keys(secs[0]), out = [];
  for (let i = 0; i < secs.length - 1; i++) {
    const p0 = secs[Math.max(0, i - 1)], p1 = secs[i], p2 = secs[i + 1], p3 = secs[Math.min(secs.length - 1, i + 2)];
    for (let s = 0; s < sub; s++) { const t = s / sub, o = {}; for (const k of keys) o[k] = cr(p0[k] ?? p1[k], p1[k], p2[k], p3[k] ?? p2[k], t); out.push(o); }
  }
  out.push({ ...secs[secs.length - 1] });
  return out;
}

const C = new THREE.Color();
// Colours are written as on screen (sRGB), like the hex values.
function paint(st) { if (Array.isArray(st.c)) C.setRGB(st.c[0], st.c[1], st.c[2], THREE.SRGBColorSpace); else C.set(st.c ?? 0xffffff); return C; }

// A closed tube through cross-sections along a path in the y-z plane.
//   secs: [{ y, z, w, hu, hl, p }] centre, half-width, half-height above and below, roundness (2 = ellipse)
//   style(u, th, v) -> { c, k, h, f }: colour (fixed or shade), coat weight, hair weight, fur length
//   bump(u, th, v) -> outward displacement in metres
export function loft(secs, { seg = 20, sub = 3, x = 0, style = () => ({ c: 0xffffff, k: 1 }), bump = null } = {}) {
  const S = smooth(secs, sub), R = S.length;
  const pos = [], col = [], kind = [], fur = [], idx = [];
  const centres = S.map((s) => new V3(x, s.y, s.z));
  const right = new V3(1, 0, 0), t = new V3(), up = new V3(), v = new V3(), rad = new V3();
  const push = (p, st) => { pos.push(p.x, p.y, p.z); paint(st); col.push(C.r, C.g, C.b); kind.push(st.k ?? 0, st.h ?? 0); fur.push(st.f ?? 0); };
  for (let i = 0; i < R; i++) {
    const s = S[i];
    t.subVectors(centres[Math.min(R - 1, i + 1)], centres[Math.max(0, i - 1)]).normalize();
    up.set(0, t.z, -t.y).normalize();
    const p = s.p || 2, u = i / (R - 1);
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2, cx = Math.cos(th), sy = Math.sin(th);
      const ex = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / p) * s.w;
      const ey = Math.sign(sy) * Math.pow(Math.abs(sy), 2 / p) * (sy > 0 ? s.hu : s.hl);
      v.copy(centres[i]).addScaledVector(right, ex).addScaledVector(up, ey);
      if (bump) { rad.copy(right).multiplyScalar(cx).addScaledVector(up, sy).normalize(); v.addScaledVector(rad, bump(u, th, v)); }
      push(v, style(u, th, v));
    }
  }
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
    idx.push(a, c, b, b, c, d);
  }
  // Caps, wound to match the sides.
  for (const [ri, end] of [[0, false], [R - 1, true]]) {
    const ci = pos.length / 3, cc = centres[ri];
    push(cc, style(ri / (R - 1), -Math.PI / 2, cc));
    for (let j = 0; j < seg; j++) {
      const a = ri * seg + j, b = ri * seg + ((j + 1) % seg);
      if (end) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  return finish(pos, col, kind, fur, idx);
}

function finish(pos, col, kind, fur, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 2));
  g.setAttribute('aFur', new THREE.Float32BufferAttribute(fur, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Make sure normals face out: the highest vertex of a closed shape faces up.
  const P = g.attributes.position, N = g.attributes.normal;
  let top = 0; for (let i = 1; i < P.count; i++) if (P.getY(i) > P.getY(top)) top = i;
  if (N.getY(top) < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const s = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = s; } g.computeVertexNormals(); }
  return g;
}

// Any three.js geometry, painted and ready to merge.
export function prim(geo, st, m = null) {
  if (m) geo.applyMatrix4(m);
  const g = geo.index ? geo : geo;
  g.deleteAttribute('uv'); if (g.attributes.uv1) g.deleteAttribute('uv1');
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  paint(st);
  const col = new Float32Array(n * 3), kind = new Float32Array(n * 2), fur = new Float32Array(n);
  for (let i = 0; i < n; i++) { col.set([C.r, C.g, C.b], i * 3); kind.set([st.k ?? 0, st.h ?? 0], i * 2); fur[i] = st.f ?? 0; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 2));
  g.setAttribute('aFur', new THREE.BufferAttribute(fur, 1));
  return g;
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(sx, sy, sz));
const join = (parts) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
const tube = (pts, r, st) => prim(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new V3(...p))), 16, r, 6), st);

// A leg segment hanging from the origin: sections from the top (y = 0) down.
const leg = (secs, style, seg = 12) => loft(secs.map(([y, w, h]) => ({ y, z: 0, w, hu: h, hl: h })), { seg, sub: 2, style });

// ---------------- Land animals ----------------
// Each returns the parts of a rig: torso, head (on a pivot at the base of the neck), the upper
// and lower leg segments, hip positions, segment lengths, and fur shell settings.

export function horse() {
  const coat = (shade = 1, f = 0.018) => () => ({ c: [shade, shade, shade], k: 1, f });
  const torso = join([
    loft([
      { y: 1.05, z: -0.86, w: 0.08, hu: 0.08, hl: 0.08 },
      { y: 1.08, z: -0.76, w: 0.27, hu: 0.24, hl: 0.27 },
      { y: 1.09, z: -0.52, w: 0.35, hu: 0.29, hl: 0.36 },
      { y: 1.06, z: -0.18, w: 0.37, hu: 0.27, hl: 0.42 },
      { y: 1.08, z: 0.18, w: 0.36, hu: 0.31, hl: 0.4 },
      { y: 1.13, z: 0.46, w: 0.31, hu: 0.33, hl: 0.37 },
      { y: 1.1, z: 0.66, w: 0.21, hu: 0.26, hl: 0.3 },
      { y: 1.06, z: 0.76, w: 0.05, hu: 0.06, hl: 0.06 },
    ], { seg: 24, style: (u, th) => ({ c: [0.9 + 0.12 * Math.sin(th) * 0.5, 0.9 + 0.06 * Math.sin(th), 0.9], k: 1, f: 0.02 }) }),
    // A long, full tail of thick hair.
    loft([
      { y: 1.14, z: -0.8, w: 0.06, hu: 0.06, hl: 0.06 }, { y: 1.02, z: -0.94, w: 0.09, hu: 0.08, hl: 0.08 },
      { y: 0.72, z: -1.02, w: 0.11, hu: 0.1, hl: 0.1 }, { y: 0.4, z: -1.03, w: 0.1, hu: 0.09, hl: 0.09 }, { y: 0.24, z: -1.02, w: 0.03, hu: 0.03, hl: 0.03 },
    ], { seg: 12, style: () => ({ c: [1, 1, 1], h: 1 }), bump: (u, th) => 0.018 * Math.sin(th * 7 + u * 9) }),
  ]);
  // Neck and head on a pivot at the base of the neck: arched neck, broad jowl, tapering face.
  const head = join([
    loft([
      { y: -0.05, z: -0.08, w: 0.19, hu: 0.27, hl: 0.27 },
      { y: 0.2, z: 0.16, w: 0.15, hu: 0.21, hl: 0.21 },
      { y: 0.4, z: 0.36, w: 0.11, hu: 0.15, hl: 0.15 },
      { y: 0.5, z: 0.48, w: 0.1, hu: 0.12, hl: 0.16 },
      { y: 0.4, z: 0.64, w: 0.1, hu: 0.11, hl: 0.15 },
      { y: 0.22, z: 0.8, w: 0.075, hu: 0.085, hl: 0.1 },
      { y: 0.1, z: 0.9, w: 0.068, hu: 0.07, hl: 0.075 },
      { y: 0.06, z: 0.94, w: 0.03, hu: 0.03, hl: 0.03 },
    ], { seg: 20, style: (u) => ({ c: u > 0.88 ? [0.62, 0.6, 0.58] : [0.95, 0.95, 0.95], k: 1, f: u < 0.5 ? 0.016 : 0.006 }) }),
    // Eyes, nostrils, ears.
    ...[-1, 1].flatMap((s) => [
      prim(new THREE.SphereGeometry(0.028, 10, 8), { c: 0x0c0a09 }, M(s * 0.085, 0.43, 0.6)),
      prim(new THREE.SphereGeometry(0.018, 8, 6), { c: 0x16110f }, M(s * 0.04, 0.12, 0.93)),
      prim(new THREE.ConeGeometry(0.035, 0.13, 8), { c: [0.9, 0.9, 0.9], k: 1 }, M(s * 0.06, 0.6, 0.46, -0.2, 0, -s * 0.2)),
    ]),
    // A thick mane along the crest, falling to one side in locks, and a forelock over the face.
    (() => {
      const g = loft([
        { y: 0.2, z: -0.12, w: 0.035, hu: 0.03, hl: 0.03 },
        { y: 0.36, z: 0.08, w: 0.05, hu: 0.05, hl: 0.17 },
        { y: 0.5, z: 0.28, w: 0.05, hu: 0.05, hl: 0.17 },
        { y: 0.6, z: 0.44, w: 0.045, hu: 0.045, hl: 0.13 },
        { y: 0.62, z: 0.5, w: 0.02, hu: 0.02, hl: 0.03 },
      ], { seg: 16, sub: 4, style: () => ({ c: [1, 1, 1], h: 1 }), bump: (u, th) => (Math.sin(th) < -0.2 ? 0.02 * Math.sin(u * 60) : 0) });
      g.applyMatrix4(M(0.03, 0, 0, 0, 0, -0.28)); return g;
    })(),
    loft([{ y: 0.6, z: 0.5, w: 0.04, hu: 0.03, hl: 0.03 }, { y: 0.56, z: 0.6, w: 0.05, hu: 0.025, hl: 0.025 }, { y: 0.47, z: 0.68, w: 0.03, hu: 0.015, hl: 0.015 }], { seg: 10, style: () => ({ c: [1, 1, 1], h: 1 }) }),
  ]);
  const legStyle = (pt) => (u) => ({ c: [0.92, 0.92, 0.92], k: 1 - pt(u), h: pt(u), f: 0.008 });
  const legU = leg([[0, 0.1, 0.12], [-0.18, 0.085, 0.1], [-0.36, 0.06, 0.07], [-0.46, 0.055, 0.06]], legStyle((u) => sstep(0.6, 1, u) * 0.6));
  const legL = join([
    leg([[0, 0.055, 0.06], [-0.18, 0.042, 0.05], [-0.32, 0.044, 0.05], [-0.37, 0.055, 0.058], [-0.42, 0.048, 0.052]], legStyle(() => 1)),
    prim(new THREE.CylinderGeometry(0.052, 0.062, 0.07, 12), { c: 0x26221f }, M(0, -0.455, 0.01)),
  ]);
  return {
    torso, head, legU, legL, neckPivot: [0, 1.22, 0.55], Lu: 0.46, Ll: 0.42,
    hips: [[0.17, 0.92, 0.42], [-0.17, 0.92, 0.42], [0.16, 0.95, -0.56], [-0.16, 0.95, -0.56]],
    graze: 1.25, alert: -0.15, fur: { len: 1, density: 260, shells: 4 },
  };
}

// Icelandic sheep: a deep, lumpy fleece; a clean face and legs; many carry curled horns.
export function sheep() {
  // Fleece in locks: a lumpy surface at two scales.
  const wool = (u, th, v) => 0.07 * noise3(v.x * 9, v.y * 9, v.z * 9) + 0.03 * noise3(v.x * 24, v.y * 24, v.z * 24) - 0.04;
  const torso = loft([
    { y: 0.68, z: -0.56, w: 0.12, hu: 0.12, hl: 0.12 },
    { y: 0.7, z: -0.46, w: 0.31, hu: 0.29, hl: 0.3 },
    { y: 0.7, z: -0.15, w: 0.38, hu: 0.33, hl: 0.36 },
    { y: 0.71, z: 0.18, w: 0.37, hu: 0.33, hl: 0.35 },
    { y: 0.74, z: 0.42, w: 0.27, hu: 0.29, hl: 0.29 },
    { y: 0.72, z: 0.52, w: 0.08, hu: 0.08, hl: 0.08 },
  ], { seg: 44, sub: 7, style: () => ({ c: [1, 1, 1], k: 1, f: 0.05 }), bump: wool });
  const face = (u) => ({ c: [0.95, 0.95, 0.95], k: u < 0.38 ? 1 : 0, h: u < 0.38 ? 0 : 1, f: u < 0.38 ? 0.04 : 0 });
  const headParts = [
    loft([
      { y: -0.02, z: -0.04, w: 0.17, hu: 0.18, hl: 0.18 },
      { y: 0.12, z: 0.1, w: 0.14, hu: 0.15, hl: 0.15 },
      { y: 0.2, z: 0.2, w: 0.085, hu: 0.1, hl: 0.1 },
      { y: 0.13, z: 0.32, w: 0.07, hu: 0.08, hl: 0.08 },
      { y: 0.04, z: 0.42, w: 0.052, hu: 0.055, hl: 0.06 },
      { y: 0.01, z: 0.46, w: 0.02, hu: 0.02, hl: 0.02 },
    ], { seg: 18, style: face, bump: (u, th, v) => (u < 0.35 ? wool(u, th, v) : 0) }),
    ...[-1, 1].flatMap((s) => [
      prim(new THREE.SphereGeometry(0.02, 8, 6), { c: 0x0b0908 }, M(s * 0.07, 0.2, 0.27)),
      prim(new THREE.SphereGeometry(1, 10, 6), { c: [0.9, 0.9, 0.9], h: 1 }, M(s * 0.11, 0.23, 0.17, 0, s * 0.4, s * 0.5, 0.07, 0.022, 0.035)),
      prim(new THREE.SphereGeometry(0.011, 6, 4), { c: 0x141010 }, M(s * 0.022, 0.05, 0.455)),
    ]),
  ];
  // Curled horns, added on some heads.
  const horns = join([-1, 1].map((s) => tube([[s * 0.05, 0.25, 0.2], [s * 0.13, 0.33, 0.12], [s * 0.2, 0.3, 0.02], [s * 0.21, 0.18, 0.04], [s * 0.15, 0.12, 0.14], [s * 0.12, 0.17, 0.2]], 0.026, { c: 0xb5a385 })));
  const legU = leg([[0, 0.085, 0.09], [-0.12, 0.06, 0.065], [-0.22, 0.035, 0.038]], (u) => ({ c: [1, 1, 1], k: u < 0.5 ? 1 : 0, h: u < 0.5 ? 0 : 1, f: u < 0.5 ? 0.03 : 0 }), 10);
  const legL = join([
    leg([[0, 0.033, 0.035], [-0.12, 0.026, 0.03], [-0.19, 0.03, 0.033]], () => ({ c: [0.95, 0.95, 0.95], h: 1 }), 10),
    prim(new THREE.CylinderGeometry(0.03, 0.036, 0.04, 10), { c: 0x221d1a }, M(0, -0.215, 0.006)),
  ]);
  return {
    torso, head: join(headParts), horns, legU, legL, neckPivot: [0, 0.8, 0.42], Lu: 0.22, Ll: 0.23,
    hips: [[0.16, 0.45, 0.3], [-0.16, 0.45, 0.3], [0.16, 0.45, -0.32], [-0.16, 0.45, -0.32]],
    graze: 1.05, alert: -0.1, fur: { len: 1, density: 120, shells: 5 },
  };
}

// Reindeer: grey-brown, a pale belly and rump, a shaggy white mane under the neck, dark legs and
// face, and big branching antlers.
export function reindeer() {
  const torso = loft([
    { y: 0.98, z: -0.66, w: 0.09, hu: 0.09, hl: 0.09 },
    { y: 1.0, z: -0.56, w: 0.24, hu: 0.24, hl: 0.25 },
    { y: 0.99, z: -0.25, w: 0.29, hu: 0.25, hl: 0.31 },
    { y: 0.99, z: 0.15, w: 0.29, hu: 0.27, hl: 0.31 },
    { y: 1.04, z: 0.42, w: 0.24, hu: 0.28, hl: 0.3 },
    { y: 1.0, z: 0.56, w: 0.06, hu: 0.06, hl: 0.06 },
  ], { seg: 24, style: (u, th) => {
    const belly = sstep(-0.45, -0.85, Math.sin(th)), rump = sstep(0.16, 0.04, u) * sstep(-0.5, 0.2, Math.sin(th));
    const pale = Math.max(belly, rump);
    return { c: [0.86 + 0.1 * pale, 0.83 + 0.1 * pale, 0.78 + 0.12 * pale], k: 1 - pale * 0.85, f: 0.025 };
  } });
  const head = join([
    loft([
      { y: -0.05, z: -0.08, w: 0.16, hu: 0.22, hl: 0.24 },
      { y: 0.16, z: 0.12, w: 0.12, hu: 0.15, hl: 0.2 },
      { y: 0.32, z: 0.3, w: 0.095, hu: 0.11, hl: 0.12 },
      { y: 0.34, z: 0.42, w: 0.09, hu: 0.1, hl: 0.12 },
      { y: 0.2, z: 0.6, w: 0.075, hu: 0.08, hl: 0.09 },
      { y: 0.12, z: 0.72, w: 0.07, hu: 0.07, hl: 0.075 },
      { y: 0.1, z: 0.76, w: 0.02, hu: 0.02, hl: 0.02 },
    ], { seg: 20, style: (u, th) => {
      const mane = u < 0.45 ? sstep(-0.1, -0.7, Math.sin(th)) : 0, face = sstep(0.42, 0.55, u);
      return { c: [0.96 - 0.1 * face, 0.95 - 0.1 * face, 0.92 - 0.1 * face], k: (1 - mane) * (1 - face), h: face, f: 0.02 + mane * 0.05 };
    }, bump: (u, th, v) => (u < 0.45 ? 0.05 * sstep(-0.2, -0.8, Math.sin(th)) * (0.5 + noise3(v.x * 20, v.y * 20, v.z * 20)) : 0) }),
    ...[-1, 1].flatMap((s) => [
      prim(new THREE.SphereGeometry(0.024, 8, 6), { c: 0x0b0908 }, M(s * 0.085, 0.36, 0.45)),
      prim(new THREE.SphereGeometry(1, 10, 6), { c: [0.9, 0.88, 0.85], k: 1 }, M(s * 0.1, 0.45, 0.32, 0.3, s * 0.3, s * 0.5, 0.04, 0.09, 0.025)),
      // Antlers: a main beam sweeping back and up, then forward, with tines; a flattened brow tine.
      tube([[s * 0.05, 0.45, 0.36], [s * 0.18, 0.7, 0.24], [s * 0.3, 1.0, 0.18], [s * 0.34, 1.28, 0.3], [s * 0.28, 1.42, 0.44]], 0.022, { c: 0xc7b796 }),
      tube([[s * 0.24, 0.9, 0.2], [s * 0.3, 0.96, 0.36], [s * 0.32, 1.0, 0.46]], 0.015, { c: 0xc7b796 }),
      tube([[s * 0.32, 1.2, 0.26], [s * 0.42, 1.34, 0.22], [s * 0.48, 1.45, 0.24]], 0.013, { c: 0xc7b796 }),
      tube([[s * 0.31, 1.34, 0.38], [s * 0.36, 1.5, 0.42]], 0.012, { c: 0xc7b796 }),
      tube([[s * 0.07, 0.5, 0.38], [s * 0.08, 0.56, 0.52], [s * 0.06, 0.52, 0.62]], 0.016, { c: 0xc7b796 }),
      prim(new THREE.BoxGeometry(0.012, 0.09, 0.12), { c: 0xc7b796 }, M(s * 0.06, 0.53, 0.6, -0.3, 0, 0)),
    ]),
  ]);
  const legU = leg([[0, 0.08, 0.1], [-0.2, 0.06, 0.075], [-0.38, 0.04, 0.05]], (u) => ({ c: [0.9, 0.9, 0.9], k: 1 - u * 0.6, h: u * 0.6, f: 0.012 }));
  const legL = join([
    leg([[0, 0.04, 0.05], [-0.25, 0.032, 0.04], [-0.42, 0.036, 0.042]], () => ({ c: [0.85, 0.85, 0.85], h: 1, f: 0.01 })),
    // Broad, splayed hooves for snow, with dewclaws.
    prim(new THREE.CylinderGeometry(0.045, 0.06, 0.06, 12), { c: 0x1d1a17 }, M(0, -0.45, 0.02)),
  ]);
  return {
    torso, head, legU, legL, neckPivot: [0, 1.1, 0.48], Lu: 0.38, Ll: 0.45,
    hips: [[0.15, 0.85, 0.38], [-0.15, 0.85, 0.38], [0.15, 0.86, -0.48], [-0.15, 0.86, -0.48]],
    graze: 1.1, alert: -0.2, fur: { len: 1, density: 200, shells: 4 },
  };
}

// Arctic fox: compact and fluffy, short legs, small rounded ears, and a big bushy tail.
export function fox() {
  const torso = join([
    loft([
      { y: 0.33, z: -0.3, w: 0.07, hu: 0.07, hl: 0.07 },
      { y: 0.33, z: -0.22, w: 0.14, hu: 0.14, hl: 0.14 },
      { y: 0.33, z: 0.02, w: 0.16, hu: 0.15, hl: 0.16 },
      { y: 0.35, z: 0.22, w: 0.14, hu: 0.15, hl: 0.15 },
      { y: 0.36, z: 0.3, w: 0.06, hu: 0.06, hl: 0.06 },
    ], { seg: 18, style: () => ({ c: [1, 1, 1], k: 1, f: 0.035 }) }),
    loft([
      { y: 0.36, z: -0.26, w: 0.05, hu: 0.05, hl: 0.05 }, { y: 0.3, z: -0.4, w: 0.09, hu: 0.09, hl: 0.09 },
      { y: 0.2, z: -0.56, w: 0.1, hu: 0.1, hl: 0.1 }, { y: 0.13, z: -0.7, w: 0.07, hu: 0.07, hl: 0.07 }, { y: 0.12, z: -0.76, w: 0.02, hu: 0.02, hl: 0.02 },
    ], { seg: 14, style: () => ({ c: [1, 1, 1], k: 1, f: 0.05 }) }),
  ]);
  const head = join([
    loft([
      { y: -0.02, z: -0.04, w: 0.1, hu: 0.11, hl: 0.11 },
      { y: 0.08, z: 0.06, w: 0.1, hu: 0.1, hl: 0.1 },
      { y: 0.12, z: 0.13, w: 0.1, hu: 0.09, hl: 0.08 },
      { y: 0.09, z: 0.22, w: 0.055, hu: 0.05, hl: 0.05 },
      { y: 0.07, z: 0.29, w: 0.025, hu: 0.025, hl: 0.025 },
    ], { seg: 16, style: () => ({ c: [1, 1, 1], k: 1, f: 0.03 }) }),
    ...[-1, 1].flatMap((s) => [
      prim(new THREE.SphereGeometry(0.015, 8, 6), { c: 0x080706 }, M(s * 0.048, 0.14, 0.2)),
      prim(new THREE.ConeGeometry(0.035, 0.07, 8), { c: [1, 1, 1], k: 1 }, M(s * 0.06, 0.22, 0.1, -0.15, 0, -s * 0.25)),
    ]),
    prim(new THREE.SphereGeometry(0.016, 8, 6), { c: 0x0c0a09 }, M(0, 0.075, 0.295)),
  ]);
  const legU = leg([[0, 0.04, 0.045], [-0.1, 0.03, 0.035], [-0.14, 0.025, 0.028]], () => ({ c: [1, 1, 1], k: 1, f: 0.02 }), 10);
  const legL = leg([[0, 0.022, 0.024], [-0.08, 0.018, 0.02], [-0.11, 0.024, 0.03]], () => ({ c: [0.95, 0.95, 0.95], h: 1, f: 0.015 }), 10);
  return {
    torso, head, legU, legL, neckPivot: [0, 0.38, 0.24], Lu: 0.14, Ll: 0.12,
    hips: [[0.07, 0.26, 0.17], [-0.07, 0.26, 0.17], [0.07, 0.26, -0.18], [-0.07, 0.26, -0.18]],
    graze: 0.7, alert: -0.3, fur: { len: 1, density: 300, shells: 5 },
  };
}

// Harbour seal: a long, smooth, spotted body lying on the shore, with a rounded head.
export function seal() {
  const torso = join([
    loft([
      { y: 0.16, z: -0.98, w: 0.04, hu: 0.03, hl: 0.03 },
      { y: 0.17, z: -0.86, w: 0.11, hu: 0.08, hl: 0.08 },
      { y: 0.2, z: -0.55, w: 0.24, hu: 0.17, hl: 0.15 },
      { y: 0.24, z: -0.1, w: 0.32, hu: 0.24, hl: 0.21 },
      { y: 0.26, z: 0.3, w: 0.28, hu: 0.23, hl: 0.21 },
      { y: 0.3, z: 0.55, w: 0.17, hu: 0.17, hl: 0.15 },
      { y: 0.32, z: 0.66, w: 0.05, hu: 0.05, hl: 0.05 },
    ], { seg: 24, style: (u, th) => ({ c: [0.95 + 0.25 * sstep(-0.3, -0.9, Math.sin(th)), 0.95 + 0.25 * sstep(-0.3, -0.9, Math.sin(th)), 0.95 + 0.25 * sstep(-0.3, -0.9, Math.sin(th))], k: 1 }) }),
    // Hind flippers held together, fore flippers at the sides.
    ...[-1, 1].flatMap((s) => [
      prim(new THREE.SphereGeometry(1, 12, 8), { c: [0.8, 0.8, 0.8], k: 1 }, M(s * 0.07, 0.15, -1.06, 0, s * 0.25, 0, 0.07, 0.025, 0.17)),
      prim(new THREE.SphereGeometry(1, 12, 8), { c: [0.8, 0.8, 0.8], k: 1 }, M(s * 0.28, 0.08, 0.35, 0, s * 0.5, s * 0.3, 0.05, 0.025, 0.14)),
    ]),
  ]);
  const head = join([
    loft([
      { y: -0.02, z: -0.06, w: 0.16, hu: 0.15, hl: 0.14 },
      { y: 0.04, z: 0.06, w: 0.15, hu: 0.14, hl: 0.12 },
      { y: 0.06, z: 0.16, w: 0.12, hu: 0.11, hl: 0.1 },
      { y: 0.04, z: 0.25, w: 0.075, hu: 0.065, hl: 0.07 },
      { y: 0.03, z: 0.3, w: 0.03, hu: 0.03, hl: 0.03 },
    ], { seg: 18, style: () => ({ c: [0.9, 0.9, 0.9], k: 1 }) }),
    ...[-1, 1].flatMap((s) => [prim(new THREE.SphereGeometry(0.032, 10, 8), { c: 0x060505 }, M(s * 0.075, 0.11, 0.17)), prim(new THREE.SphereGeometry(0.012, 6, 4), { c: 0x0f0d0c }, M(s * 0.02, 0.05, 0.3))]),
  ]);
  return { torso, head, neckPivot: [0, 0.32, 0.62], graze: 0, alert: -0.5, fur: null };
}

// ---------------- Sea animals ----------------
// Whale skin: smooth and glossy; markings from position on the body.

// A humpback's fluke: two swept-back lobes with a notch, dark above, pale and patterned below.
function flukeGeo(span, top, under) {
  const half = [[0.6, 0.05], [1.4, 0.32], [2.2, 0.92], [1.75, 1.02], [1.2, 0.94], [0.6, 1.06], [0.16, 1.05]];
  const sh = new THREE.Shape(); sh.moveTo(0, -0.1);
  for (const [x, y] of half) sh.lineTo((x * span) / 4.4, y * span / 4.4);
  sh.lineTo(0, 0.82 * span / 4.4);
  for (const [x, y] of [...half].reverse()) sh.lineTo((-x * span) / 4.4, y * span / 4.4);
  sh.closePath();
  const geo = (d) => { const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: d * 0.4, bevelSize: 0.03 * span / 4.4, bevelSegments: 2 }); g.rotateX(-Math.PI / 2); return g; };
  return [prim(geo(0.05 * span / 4.4), { c: top }, M(0, 0.01, 0)), prim(geo(0.03 * span / 4.4), { c: under }, M(0, -0.05 * span / 4.4, 0))];
}
// A flat fin lofted along z, then placed: w is half the chord, hu/hl its thickness.
const fin = (secs, style, place, bump) => { const g = loft(secs, { seg: 14, style, bump }); g.applyMatrix4(place); return g; };

export function humpback() {
  const DARK = [0.11, 0.12, 0.14], WHITE = [0.86, 0.88, 0.89];
  const body = loft([
    { y: 0, z: -6.0, w: 0.22, hu: 0.42, hl: 0.42 },
    { y: 0, z: -4.8, w: 0.5, hu: 0.72, hl: 0.68 },
    { y: 0, z: -2.9, w: 1.02, hu: 1.04, hl: 1.12 },
    { y: -0.05, z: -0.6, w: 1.3, hu: 1.18, hl: 1.36 },
    { y: -0.1, z: 1.8, w: 1.34, hu: 1.12, hl: 1.42 },
    { y: -0.2, z: 3.7, w: 1.18, hu: 0.86, hl: 1.32 },
    { y: -0.3, z: 5.1, w: 0.92, hu: 0.56, hl: 0.98 },
    { y: -0.36, z: 6.1, w: 0.55, hu: 0.32, hl: 0.55 },
    { y: -0.38, z: 6.55, w: 0.18, hu: 0.12, hl: 0.2 },
  ], {
    seg: 56, sub: 8,
    style: (u, th, v) => {
      const sy = Math.sin(th);
      // Throat pleats: pale grooves under the head and chest; a mottled pale belly.
      const pleats = v.z > 0.5 ? sstep(-0.45, -0.75, sy) : 0;
      const belly = sstep(-0.55, -0.9, sy) * (0.4 + 0.6 * noise3(v.x * 1.2, v.y * 1.2, v.z * 0.6));
      let w = Math.max(pleats * (0.55 + 0.45 * Math.cos(th * 70)), belly * 0.8);
      w *= 0.85 + 0.15 * noise3(v.x * 4, v.y * 4, v.z * 4);
      return { c: [DARK[0] + (WHITE[0] - DARK[0]) * w, DARK[1] + (WHITE[1] - DARK[1]) * w, DARK[2] + (WHITE[2] - DARK[2]) * w] };
    },
    bump: (u, th, v) => {
      const sy = Math.sin(th);
      // Tubercles: knobs over the top of the head and jaw; grooves along the throat.
      const knobs = v.z > 3.3 && sy > 0.2 ? 0.07 * sstep(0.72, 0.9, noise3(v.x * 3.2, v.y * 3.2, v.z * 3.2)) : 0;
      const groove = v.z > 0.5 && sy < -0.45 ? -0.025 * (0.5 + 0.5 * Math.cos(th * 70)) : 0;
      return knobs + groove;
    },
  });
  // Long white flippers with a scalloped leading edge; a small hump of a dorsal fin.
  const flipper = (s) => fin([
    { y: 0, z: 0, w: 0.36, hu: 0.11, hl: 0.11 }, { y: 0, z: 1.2, w: 0.42, hu: 0.09, hl: 0.09 }, { y: 0, z: 2.6, w: 0.3, hu: 0.06, hl: 0.06 },
    { y: 0, z: 3.6, w: 0.15, hu: 0.04, hl: 0.04 }, { y: 0, z: 3.95, w: 0.04, hu: 0.02, hl: 0.02 },
  ], (u, th) => { const top = Math.sin(th) > 0.3 ? 0.45 : 0; return { c: [WHITE[0] - top * 0.5, WHITE[1] - top * 0.5, WHITE[2] - top * 0.5] }; },
  M(s * 1.15, -0.75, 3.0, 0.35, s * (Math.PI / 2 + 0.55), 0), (u, th) => (s * Math.cos(th) > 0.6 ? 0.05 * Math.max(0, Math.sin(u * 30)) : 0));
  const dorsal = fin([{ y: 1.05, z: -2.4, w: 0.07, hu: 0.0, hl: 0.0 }, { y: 1.2, z: -2.15, w: 0.07, hu: 0.2, hl: 0.25 }, { y: 1.1, z: -1.8, w: 0.06, hu: 0.25, hl: 0.3 }, { y: 1.0, z: -1.5, w: 0.02, hu: 0.02, hl: 0.02 }],
    () => ({ c: DARK }), new THREE.Matrix4());
  return join([body, flipper(1), flipper(-1), dorsal, ...flukeGeo(4.6, DARK, WHITE).map((g) => g.translate(0, 0, -6.05))]);
}

export function orca() {
  const BLACK = [0.02, 0.022, 0.025], WHITE = [0.92, 0.93, 0.92], GREY = [0.42, 0.44, 0.46];
  const body = loft([
    { y: 0, z: -3.35, w: 0.16, hu: 0.32, hl: 0.3 },
    { y: 0, z: -2.5, w: 0.42, hu: 0.62, hl: 0.58 },
    { y: 0, z: -1.0, w: 0.82, hu: 0.92, hl: 0.95 },
    { y: 0, z: 0.6, w: 0.9, hu: 0.92, hl: 1.0 },
    { y: -0.05, z: 2.0, w: 0.72, hu: 0.7, hl: 0.82 },
    { y: -0.12, z: 2.9, w: 0.46, hu: 0.42, hl: 0.52 },
    { y: -0.16, z: 3.35, w: 0.16, hu: 0.14, hl: 0.18 },
  ], {
    seg: 56, sub: 9,
    style: (u, th, v) => {
      const sy = Math.sin(th), side = Math.abs(Math.cos(th));
      let c = BLACK;
      const chin = v.z > 1.4 && sy < -0.35, belly = sy < -0.65 && v.z > -1.4;
      const flank = v.z > -2.7 && v.z < -0.9 && sy < 0.05 && sy > -0.8 && side > 0.45;
      const dx = (v.z - 2.15) / 0.5, dy = (v.y - 0.33) / 0.16; // eye patch, above and behind the eye
      const patch = side > 0.55 && dx * dx + dy * dy < 1;
      if (chin || belly || flank || patch) c = WHITE;
      if (sy > 0.82 && v.z > -1.4 && v.z < -0.3) c = GREY; // saddle patch behind the fin
      return { c };
    },
  });
  const dorsal = loft([{ y: 0.8, z: 0.15, w: 0.08, hu: 0.5, hl: 0.5 }, { y: 1.4, z: -0.05, w: 0.06, hu: 0.32, hl: 0.32 }, { y: 2.1, z: -0.25, w: 0.04, hu: 0.15, hl: 0.15 }, { y: 2.55, z: -0.4, w: 0.02, hu: 0.04, hl: 0.04 }], { seg: 10, style: () => ({ c: BLACK }) });
  const paddle = (s) => fin([{ y: 0, z: 0, w: 0.25, hu: 0.06, hl: 0.06 }, { y: 0, z: 0.5, w: 0.33, hu: 0.05, hl: 0.05 }, { y: 0, z: 0.9, w: 0.24, hu: 0.04, hl: 0.04 }, { y: 0, z: 1.05, w: 0.06, hu: 0.02, hl: 0.02 }],
    () => ({ c: BLACK }), M(s * 0.7, -0.55, 1.6, 0.3, s * (Math.PI / 2 + 0.6), 0));
  return join([body, dorsal, paddle(1), paddle(-1), ...flukeGeo(2.2, BLACK, WHITE).map((g) => g.translate(0, 0, -3.3))]);
}

export function dolphin() {
  const DARK = [0.08, 0.09, 0.1], PALE = [0.72, 0.74, 0.76], WHITE = [0.88, 0.89, 0.9];
  const body = loft([
    { y: 0, z: -1.32, w: 0.05, hu: 0.1, hl: 0.1 },
    { y: 0, z: -1.0, w: 0.14, hu: 0.2, hl: 0.19 },
    { y: 0, z: -0.3, w: 0.3, hu: 0.33, hl: 0.33 },
    { y: 0, z: 0.4, w: 0.31, hu: 0.33, hl: 0.33 },
    { y: 0.02, z: 1.0, w: 0.2, hu: 0.22, hl: 0.21 },
    { y: -0.02, z: 1.22, w: 0.1, hu: 0.1, hl: 0.11 },
    { y: -0.04, z: 1.42, w: 0.055, hu: 0.05, hl: 0.06 },
    { y: -0.04, z: 1.48, w: 0.02, hu: 0.02, hl: 0.02 },
  ], {
    seg: 40, sub: 8,
    style: (u, th, v) => {
      const sy = Math.sin(th);
      let c = DARK;
      if (v.z > -1.0 && v.z < -0.1 && sy > -0.3 && sy < 0.55) c = PALE; // the pale blaze along the flank
      if (sy < -0.5 && v.z > -0.9) c = WHITE;
      if (v.z > 1.2) c = WHITE; // white beak
      return { c };
    },
  });
  const dorsal = loft([{ y: 0.3, z: 0.05, w: 0.035, hu: 0.16, hl: 0.16 }, { y: 0.5, z: -0.08, w: 0.025, hu: 0.09, hl: 0.09 }, { y: 0.64, z: -0.24, w: 0.012, hu: 0.03, hl: 0.03 }], { seg: 8, style: () => ({ c: DARK }) });
  const flip = (s) => fin([{ y: 0, z: 0, w: 0.08, hu: 0.02, hl: 0.02 }, { y: 0, z: 0.22, w: 0.07, hu: 0.015, hl: 0.015 }, { y: 0, z: 0.34, w: 0.02, hu: 0.01, hl: 0.01 }], () => ({ c: DARK }), M(s * 0.25, -0.15, 0.55, 0.4, s * (Math.PI / 2 + 0.7), 0));
  return join([body, dorsal, flip(1), flip(-1), ...flukeGeo(0.8, DARK, PALE).map((g) => g.translate(0, 0, -1.3))]);
}

// ---------------- Material ----------------
const NOISE = /* glsl */ `
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z); }`;

// Coat and hair colours per animal (instanced attributes iCoat, iHair), fine grain, soft fur
// sheen, optional seal spots and wet gloss, and fur shells: shell (0..1) is this layer's height,
// pushed out along the normal by the vertex's fur length; strands are thinned out layer by layer.
export function animalMaterial({ rough = 0.85, sheen = 0.25, clear = 0, spots = 0, shell = -1, density = 200, grain = 30, env = 0.8 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: rough, metalness: 0, sheen, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xd8d4cc), clearcoat: clear, clearcoatRoughness: 0.45, envMapIntensity: env });
  const isShell = shell >= 0;
  m.userData.uniforms = { uShell: { value: shell }, uDensity: { value: density }, uSpots: { value: spots }, uGrain: { value: grain } };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, m.userData.uniforms);
    s.vertexShader = 'attribute vec2 aKind; attribute float aFur; attribute vec3 iCoat; attribute vec3 iHair;\nuniform float uShell; varying vec3 vObj; varying float vFur;\n' + s.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vFur = aFur;' + (isShell ? '\ntransformed += objectNormal * uShell * aFur;' : ''))
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nvColor.rgb = color.rgb * ((1.0 - aKind.x - aKind.y) + iCoat * aKind.x + iHair * aKind.y);\n#endif');
    s.fragmentShader = 'uniform float uShell; uniform float uDensity; uniform float uSpots; uniform float uGrain; varying vec3 vObj; varying float vFur;\n' + NOISE + '\n' + s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  // Fine grain in the coat or skin.
  float g = vnoise3(vObj * uGrain) * 0.6 + vnoise3(vObj * uGrain * 4.3) * 0.4;
  diffuseColor.rgb *= 0.84 + 0.3 * g;
  // Seal spots: dark irregular rings and blotches.
  if (uSpots > 0.0) { float sp = vnoise3(vObj * 22.0 + 3.0) * 0.7 + vnoise3(vObj * 7.0) * 0.3; diffuseColor.rgb *= 1.0 - uSpots * (smoothstep(0.6, 0.66, sp) - 0.55 * smoothstep(0.7, 0.76, sp)); }
  ${isShell ? `
  // Fur strands: each shell keeps fewer, thinner strands; roots are darker than tips.
  if (vFur < 0.001) discard;
  vec3 q = vObj * uDensity;
  float h = hash13(floor(q)), d = length(fract(q) - 0.5);
  if (h < uShell * 0.9 || d > 0.62 * (1.0 - uShell * 0.85)) discard;
  diffuseColor.rgb *= mix(0.62, 1.06, uShell);` : ''}`);
  };
  m.customProgramCacheKey = () => `animal-${isShell ? 'shell' : 'base'}`;
  return m;
}
