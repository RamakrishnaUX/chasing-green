import * as THREE from 'three';

// Buildings: shared materials, procedural surface textures and a geometry batcher.
//
// Every house, block and church is written straight into one vertex buffer per material
// (positions, normals, metre-scaled UVs and a colour per vertex), so a whole town draws in about
// six calls however many windows, gutters and fence pickets it has, and a landmark's parts merge
// with bakeStatic as before. The materials are made once and shared island-wide; colour comes
// from the vertices, surface relief from small canvas textures (corrugated iron, lap boards,
// weathering streaks, concrete), so nothing per building is a separate material.

const TAU = Math.PI * 2;
const _c = new THREE.Color(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();

// ---------- Surface textures (made once) ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { srgb = false, rx = 1, ry = 1, clampT = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.repeat.set(rx, ry); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// A normal map from a height profile across u (profile(t), t in 0..1 over one tile).
function profileNormal(n, profile, k, alongV = false) {
  const [c, g] = alongV ? canvas(4, n) : canvas(n, 4);
  const img = g.createImageData(c.width, c.height);
  for (let i = 0; i < n; i++) {
    const t = i / n, d = (profile(t + 0.5 / n) - profile(t - 0.5 / n)) * n * k;
    _n.set(-d, 0, 1).normalize();
    for (let j = 0; j < 4; j++) {
      // Canvas rows run top to bottom, v bottom to top (flipY), so a profile along v is mirrored.
      const p = alongV ? ((n - 1 - i) * 4 + j) * 4 : (j * n + i) * 4;
      if (alongV) { img.data[p] = 128; img.data[p + 1] = (_n.x * 0.5 + 0.5) * 255; }
      else { img.data[p] = (_n.x * 0.5 + 0.5) * 255; img.data[p + 1] = 128; }
      img.data[p + 2] = _n.z * 255; img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
// Weathering for painted walls: faint run-off streaks, a darker splash band near the ground (the
// texture spans -2..7 m of height and is clamped), and blotches. Near white: it multiplies the paint.
function grimeWall() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = hash(i, 1) * 256, w = 1 + hash(i, 2) * 5, y0 = hash(i, 3) * 120, len = 30 + hash(i, 4) * 140;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, 'rgba(70,64,58,0)'); gr.addColorStop(0.3, `rgba(70,64,58,${0.04 + hash(i, 5) * 0.07})`); gr.addColorStop(1, 'rgba(70,64,58,0)');
    g.fillStyle = gr; g.fillRect(x, y0, w, len);
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,85,75,${0.02 + hash(i, 9) * 0.03})`; g.beginPath(); g.arc(hash(i, 7) * 256, hash(i, 8) * 256, 6 + hash(i, 6) * 26, 0, TAU); g.fill(); }
  // Splash zone: the bottom of the canvas is the bottom of the wall.
  const gr = g.createLinearGradient(0, 256, 0, 190);
  gr.addColorStop(0, 'rgba(60,55,48,0.32)'); gr.addColorStop(1, 'rgba(60,55,48,0)');
  g.fillStyle = gr; g.fillRect(0, 190, 256, 66);
  return c;
}
// Roof weathering: rust and dirt streaks running down the slope, darker towards the eaves.
function grimeRoof() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const y = hash(i, 11) * 256, h = 1 + hash(i, 12) * 4, x0 = hash(i, 13) * 256, len = 40 + hash(i, 14) * 160;
    const rust = hash(i, 15) < 0.4;
    g.fillStyle = rust ? `rgba(120,62,30,${0.05 + hash(i, 16) * 0.12})` : `rgba(40,38,36,${0.04 + hash(i, 16) * 0.08})`;
    g.fillRect(x0, y, len, h);
  }
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(60,58,50,${0.03 + hash(i, 19) * 0.05})`; g.beginPath(); g.ellipse(hash(i, 17) * 256, hash(i, 18) * 256, 30, 8, 0, 0, TAU); g.fill(); }
  return c;
}
// Concrete: soft blotches and fine speckle around a light grey.
function concreteTex() {
  const [c, g] = canvas(256, 256);
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = 0.88 + 0.06 * Math.sin(x * 0.05 + Math.sin(y * 0.04) * 2) * Math.sin(y * 0.045 + 1.3) + (hash(x, y) - 0.5) * 0.08;
    const p = (y * 256 + x) * 4; img.data[p] = img.data[p + 1] = img.data[p + 2] = Math.max(0, Math.min(255, v * 255)); img.data[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

let MATS = null;
// Ribs and boards are a few centimetres apart: once one spans under a couple of pixels the relief
// would shimmer into moiré, so it fades out by how many ribs a pixel covers (perRepeat: ribs per
// texture repeat). The mip maps keep the colour; only the bumps go.
function fadeRelief(mat, perRepeat, key) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>',
      THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;',
        `mapN.xy *= normalScale * (1.0 - smoothstep(0.18, 0.42, length(fwidth(vNormalMapUv)) * ${perRepeat.toFixed(1)}));`));
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
// Window glass for towns: dark by day; at night each pane glows in its own vertex colour (black
// panes stay dark), scaled by emissiveIntensity (Towns.setNight).
function litGlass() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.08, metalness: 0.6, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vec3(0.05, 0.065, 0.08);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor;');
  };
  m.customProgramCacheKey = () => 'arch-litglass';
  return m;
}
export function archMats() {
  if (MATS) return MATS;
  const corr = tex(profileNormal(64, (t) => Math.sin(t * TAU * 2), 0.09), { rx: 6.5 });
  const lap = tex(profileNormal(64, (t) => { const f = ((t % 1) + 1) % 1; return f < 0.92 ? f * 0.6 : (1 - f) * 6.9; }, 0.012, true), { ry: 5 });
  const wallG = tex(grimeWall(), { srgb: true, rx: 1 / 7, ry: 1 / 9, clampT: true }); wallG.offset.set(0, 2 / 9);
  const roofG = tex(grimeRoof(), { srgb: true, rx: 1 / 9, ry: 1 / 7 });
  const conc = tex(concreteTex(), { srgb: true, rx: 1 / 4, ry: 1 / 4 });
  const S = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  MATS = {
    clad: S({ map: wallG, normalMap: corr, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.48, metalness: 0.05 }), // corrugated iron walls
    board: S({ map: wallG, normalMap: lap, normalScale: new THREE.Vector2(1, 1), roughness: 0.72 }), // timber boards (lap or, with swapped UVs, vertical)
    roof: S({ map: roofG, normalMap: corr, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.42, metalness: 0.2 }), // corrugated roofing
    paint: S({ roughness: 0.5 }), // trims, frames, doors, fences, gutters, railings
    concrete: S({ map: conc, roughness: 0.92 }), // foundations, steps, chimneys, blocks
    glass: litGlass(),
    far: S({ roughness: 0.6 }), // distant towns: plain shapes
    hidden: new THREE.MeshBasicMaterial({ visible: false }),
  };
  fadeRelief(MATS.clad, 2, 'arch-clad'); fadeRelief(MATS.roof, 2, 'arch-roof'); fadeRelief(MATS.board, 1, 'arch-board');
  for (const m of Object.values(MATS)) m.userData.noDetail = true;
  return MATS;
}
// Glass for landmark buildings: warm glow at night through the landmark's nightLit.
let LM_GLASS = null;
export function lmGlass(kit) {
  if (!LM_GLASS) LM_GLASS = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.08, metalness: 0.6, emissive: 0xffc46b, emissiveIntensity: 0 });
  kit.nightLit(LM_GLASS, 1.3);
  return LM_GLASS;
}

// ---------- Frames ----------
// A placement: parent * translate(x, y, z) * rotate (yaw ry, then pitch rx, roll rz).
export function frame(parent, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Matrix4().makeRotationFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  m.setPosition(x, y, z);
  return parent ? parent.clone().multiply(m) : m;
}

// ---------- Batcher ----------
// Faces of a box: normal, then two tangents whose cross product is the normal (so corners
// (-,-) (+,-) (+,+) (-,+) wind outwards).
const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
export const SKIP = { px: 1, nx: 2, py: 4, ny: 8, pz: 16, nz: 32 };
export class Batch {
  constructor() { this.by = new Map(); }
  _b(mat) { let b = this.by.get(mat); if (!b) { b = { p: [], n: [], u: [], c: [], i: [] }; this.by.set(mat, b); } return b; }
  // A box of size (sx, sy, sz) centred at (x, y, z) in frame F (optionally turned by o.ry/rx/rz).
  // UVs are in metres: walls (u across, v = height in the frame), roof slabs (o.uv 'r': u along
  // the ridge, v down the slope) or swapped (o.uv 's', for vertical boards). o.skip: faces to drop.
  box(mat, F, x, y, z, sx, sy, sz, color = 0xffffff, o = {}) {
    const b = this._b(mat);
    const M = (o.ry || o.rx || o.rz) ? frame(F, x, y, z, o.ry || 0, o.rx || 0, o.rz || 0) : _m.copy(F).multiply(new THREE.Matrix4().makeTranslation(x, y, z));
    const ox = o.ry || o.rx || o.rz ? 0 : x, oy = y, oz = o.ry || o.rx || o.rz ? 0 : z;
    _nm.getNormalMatrix(M);
    _c.set(color);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, uv = o.uv || 'w', du = o.du || 0;
    for (let f = 0; f < 6; f++) {
      if (o.skip && (o.skip >> f) & 1) continue;
      const [N, T1, T2] = FACES[f];
      const base = b.p.length / 3;
      _n.set(N[0], N[1], N[2]).applyMatrix3(_nm).normalize();
      for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = (N[0] + T1[0] * s1 + T2[0] * s2) * hx, ly = (N[1] + T1[1] * s1 + T2[1] * s2) * hy, lz = (N[2] + T1[2] * s1 + T2[2] * s2) * hz;
        _v.set(lx, ly, lz).applyMatrix4(M);
        b.p.push(_v.x, _v.y, _v.z); b.n.push(_n.x, _n.y, _n.z); b.c.push(_c.r, _c.g, _c.b);
        const px = lx + ox, py = ly + oy, pz = lz + oz;
        let u, v;
        if (f < 2) { u = pz; v = py; } else if (f < 4) { u = px; v = pz; } else { u = px; v = py; }
        if (uv === 'r' && (f === 2 || f === 3)) { u = pz; v = px; }
        if (uv === 's') { const t = u; u = v; v = t; }
        b.u.push(u + du, v);
      }
      b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // A flat polygon (convex, points in order, counter-clockwise seen from the front) in frame F.
  // UVs: (x or z, y) by the polygon's facing, so siding continues over gables.
  poly(mat, F, pts, color = 0xffffff, o = {}) {
    const b = this._b(mat), base = b.p.length / 3;
    const a = new THREE.Vector3(...pts[0]), e1 = new THREE.Vector3(...pts[1]).sub(a), e2 = new THREE.Vector3(...pts[2]).sub(a);
    const nl = e1.cross(e2).normalize();
    _nm.getNormalMatrix(F); _n.copy(nl).applyMatrix3(_nm).normalize(); _c.set(color);
    for (const q of pts) {
      _v.set(q[0], q[1], q[2]).applyMatrix4(F);
      b.p.push(_v.x, _v.y, _v.z); b.n.push(_n.x, _n.y, _n.z); b.c.push(_c.r, _c.g, _c.b);
      let u = Math.abs(nl.x) > 0.5 ? q[2] : q[0], v = q[1];
      if (o.uv === 's') { const t = u; u = v; v = t; }
      b.u.push(u + (o.du || 0), v);
    }
    for (let k = 1; k < pts.length - 1; k++) b.i.push(base, base + k, base + k + 1);
  }
  // Any BufferGeometry placed by F, in one colour (its own UVs scaled by o.uvScale, if any).
  geo(mat, g, F, color = 0xffffff, o = {}) {
    const b = this._b(mat), base = b.p.length / 3;
    const P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv, s = o.uvScale || 1;
    _nm.getNormalMatrix(F); _c.set(color);
    for (let k = 0; k < P.count; k++) {
      _v.fromBufferAttribute(P, k).applyMatrix4(F); b.p.push(_v.x, _v.y, _v.z);
      if (Nn) _n.fromBufferAttribute(Nn, k).applyMatrix3(_nm).normalize(); else _n.set(0, 1, 0);
      b.n.push(_n.x, _n.y, _n.z); b.c.push(_c.r, _c.g, _c.b);
      b.u.push(U ? U.getX(k) * s : 0, U ? U.getY(k) * s : 0);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) b.i.push(base + g.index.getX(k));
    else for (let k = 0; k < P.count; k++) b.i.push(base + k);
  }
  // One mesh per material, added to group.
  flush(group, { shadows = true } = {}) {
    const out = [];
    for (const [mat, b] of this.by) {
      if (!b.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.setIndex(b.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.i, 1) : new THREE.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadows && mat !== MATS?.glass; m.receiveShadow = shadows;
      group.add(m); out.push(m);
    }
    this.by.clear();
    return out;
  }
}

// ---------- Parts ----------
// A window on a wall: centred at (x, z) in F with its sill at height y, facing out along the
// wall's normal (ry turns local +z to that normal). Frame ring proud of the wall, glass set back
// inside it, glazing bars, a sill with a drip edge and (head) a little cornice.
// style: 't' (two casements under a transom, the commonest), '6' (six panes), 'p' (one pane), 'a' (arched top).
export function addWindow(B, M, F, x, y, z, ry, ww, wh, { frame: fc = 0xf4f3ee, glass = 0, style = 't', head = false, sill = true, low = false, depth = 0.09, glassMat = M.glass } = {}) {
  const W = frameAt(F, x, y, z, ry);
  const t = 0.085;
  B.box(glassMat, W, 0, wh / 2, -0.005, ww - t, wh - t, 0.03, glass, { skip: SKIP.nz });
  B.box(M.paint, W, -ww / 2 + t / 2, wh / 2, depth / 2 - 0.02, t, wh, depth, fc, { skip: SKIP.nz });
  B.box(M.paint, W, ww / 2 - t / 2, wh / 2, depth / 2 - 0.02, t, wh, depth, fc, { skip: SKIP.nz });
  B.box(M.paint, W, 0, wh - t / 2, depth / 2 - 0.02, ww - 2 * t, t, depth, fc, { skip: SKIP.nz });
  if (!sill) B.box(M.paint, W, 0, t / 2, depth / 2 - 0.02, ww - 2 * t, t, depth, fc, { skip: SKIP.nz });
  if (!low) {
    const bar = 0.045, bd = depth * 0.6;
    if (style === 't') {
      const ty = wh * 0.7;
      B.box(M.paint, W, 0, ty, bd / 2 - 0.02, ww - 2 * t, bar * 1.3, bd, fc, { skip: SKIP.nz });
      B.box(M.paint, W, 0, ty / 2, bd / 2 - 0.02, bar * 1.4, ty, bd, fc, { skip: SKIP.nz });
    } else if (style === '6') {
      B.box(M.paint, W, 0, wh / 2, bd / 2 - 0.02, bar, wh - 2 * t, bd, fc, { skip: SKIP.nz });
      for (const k of [1 / 3, 2 / 3]) B.box(M.paint, W, 0, t + (wh - 2 * t) * k, bd / 2 - 0.02, ww - 2 * t, bar, bd, fc, { skip: SKIP.nz });
    }
  }
  if (sill) B.box(M.paint, W, 0, -0.02, 0.07, ww + 0.14, 0.07, 0.17, fc, { skip: SKIP.nz });
  if (head) {
    B.box(M.paint, W, 0, wh + 0.06, 0.05, ww + 0.2, 0.1, 0.12, fc, { skip: SKIP.nz });
    if (!low) B.box(M.paint, W, 0, wh + 0.13, 0.065, ww + 0.28, 0.04, 0.15, fc, { skip: SKIP.nz });
  }
}
function frameAt(F, x, y, z, ry) { return frame(F, x, y, z, ry); }

// A pitched roof over walls of width w (across, x) and depth d (along, z), eaves at height y0,
// ridge rise r above them: two corrugated slabs with overhangs, a ridge cap, fascia and barge
// boards, soffits, and (gutters) half-round gutters. Returns the slope angle.
export function addRoof(B, M, F, { w, d, y0, r, ov = 0.4, gov = 0.3, roof, trim = 0xf4f3ee, gutter = 0x9ea4a8, gutters = true, low = false, t = 0.07, du = 0, skipGable = false }) {
  const hw = w / 2, a = Math.atan2(r, hw), ca = Math.cos(a), ta = Math.tan(a);
  const L = (hw + ov) / ca + 0.04, D = d + 2 * gov;
  const dark = _c.set(roof).multiplyScalar(0.72).getHex();
  for (const sx of [-1, 1]) {
    // Slab frame: x down the slope from the ridge, y out of the roof.
    const mx = sx * ((hw + ov) / 2 - 0.02 * ca), my = y0 + r - ((hw + ov) / 2) * ta;
    const Sf = frame(F, mx, my, 0, 0, 0, -sx * a);
    B.box(M.roof, Sf, 0, t / 2, 0, L, t, D, roof, { uv: 'r', du });
    // Fascia board on the eave edge, soffit under the overhang, barge boards up the gables.
    const ex = sx * (hw + ov), ey = y0 - ov * ta;
    B.box(M.paint, F, ex - sx * 0.02, ey - 0.06, 0, 0.04, 0.2, D, trim);
    if (!low) B.box(M.paint, F, sx * (hw + ov / 2), ey - 0.02, 0, ov, 0.03, d + 2 * gov - 0.02, trim, { skip: SKIP.py });
    if (!skipGable) for (const sz of [-1, 1]) B.box(M.paint, Sf, 0, -0.06, sz * (D / 2 - 0.02), L, 0.24, 0.05, trim);
    if (gutters) {
      const gx = sx * (hw + ov + 0.06), gy = ey - 0.14;
      B.box(M.paint, F, gx, gy, 0, 0.13, 0.1, D - 0.04, gutter);
      if (!low) B.box(M.paint, F, gx + sx * 0.06, gy + 0.05, 0, 0.025, 0.04, D - 0.04, gutter); // the rolled lip
    }
  }
  // Ridge cap: a folded strip along the top.
  for (const sx of [-1, 1]) B.box(M.roof, F, sx * 0.11 * ca, y0 + r + t * 0.9 + 0.04 - 0.11 * Math.sin(a), 0, 0.26, 0.04, D + 0.04, dark, { rz: -sx * a, uv: 'r' });
  return a;
}
// Gable-end wall triangles of a w-wide, d-deep box with eaves at y0 and rise r.
export function addGables(B, mat, F, w, d, y0, r, color, o = {}) {
  const hw = w / 2;
  B.poly(mat, F, [[-hw, y0, d / 2], [hw, y0, d / 2], [0, y0 + r, d / 2]], color, o);
  B.poly(mat, F, [[hw, y0, -d / 2], [-hw, y0, -d / 2], [0, y0 + r, -d / 2]], color, o);
}
// Stairs up to a door: from the ground (gy below the sill, local y) up to y = 0, running out
// along +z of frame D (whose origin is the threshold). Concrete treads and (rail) railings.
export function addSteps(B, M, D, rise, width, { rail = 0x2c2f33, low = false, railings = true } = {}) {
  const n = Math.max(1, Math.round(rise / 0.18)), h = rise / n, land = 0.9;
  // Landing at the door, then the flight.
  B.box(M.concrete, D, 0, -rise / 2 - 0.1, land / 2, width, rise + 0.2, land, 0xa9a7a2);
  for (let i = 1; i < n; i++) {
    const top = -i * h;
    B.box(M.concrete, D, 0, (top - rise) / 2 - 0.1, land + (i - 0.5) * 0.28, width, top + rise + 0.2, 0.28, 0xa9a7a2, { skip: SKIP.nz });
  }
  if (!railings || rise < 0.5 || low) return;
  const run = land + (n - 1) * 0.28;
  for (const sx of [-1, 1]) {
    const x = sx * (width / 2 - 0.05);
    for (const [z, y] of [[0.05, 0], [land - 0.05, 0], [run - 0.05, -rise + h]]) B.box(M.paint, D, x, y + 0.45, z, 0.045, 0.9, 0.045, rail);
    B.box(M.paint, D, x, 0.9, land / 2, 0.05, 0.05, land, rail);
    const sl = Math.atan2(rise - h, run - land), len = Math.hypot(rise - h, run - land);
    if (len > 0.1) B.box(M.paint, D, x, 0.9 - (rise - h) / 2, land + (run - land) / 2 - 0.05, 0.05, 0.05, len, rail, { rx: sl });
  }
}

// ---------- Palettes (real Icelandic houses) ----------
// Corrugated iron paint: white and cream most of all, then pastels, the old red, black-tarred and greys.
export const WALLS = [0xf3f1ea, 0xf3f1ea, 0xece4cf, 0xe9dfb8, 0xd6e3e6, 0xc9dccd, 0xdfe7ee, 0xb33a2c, 0xf0d78c, 0x9fbecc, 0x2a2c2f, 0x8c9599, 0xe7cfc0, 0x7c9a6e];
export const ROOFS = [0xa3281e, 0xa3281e, 0x8e2a22, 0x2f6d4a, 0x35506b, 0x3b3f44, 0x23262a, 0x6b7378, 0x2c5a3f];
const DOORS = [0xa3281e, 0x2f6d4a, 0x35506b, 0x1f1f22, 0xc9a24a, 0xf4f3ee, 0x6a3d24];
const FRAMES_ON_WHITE = [0x2f6d4a, 0xa3281e, 0x35506b];
const pick = (rand, a) => a[Math.floor(rand() * a.length)];
const WARM = [0xffc46b, 0xffd896, 0xffb050, 0xffe8c0, 0xf0a860];
export const litColor = (rand, p = 0.5) => (rand() < p ? pick(rand, WARM) : 0x000000);

// ---------- A town house ----------
// s: { w (across, x), d (along, z), wallH, floors, lift (floor above the lowest ground), face (the
// road side, ±1 in x), wall, roof } in frame F (origin at floor level, centre of the footprint).
// ground(lx, lz): the ground height in F. Returns extra solid boxes (porch) in F coords.
export function addHouse(B, M, F, s, rand, { low = false, ground = () => -s.lift, glassMat = M.glass } = {}) {
  const { w, d, wallH, face } = s, hw = w / 2, hd = d / 2;
  const timber = rand() < 0.16;
  const wallMat = timber ? M.board : M.clad;
  const dark = s.wall === 0x2a2c2f || s.wall === 0xb33a2c || s.wall === 0x8c9599 || s.wall === 0x7c9a6e;
  const trim = s.wall === 0xf3f1ea && rand() < 0.3 ? pick(rand, FRAMES_ON_WHITE) : 0xf4f3ee;
  const wstyle = rand() < 0.6 ? 't' : rand() < 0.65 ? '6' : 'p';
  const head = rand() < 0.45;
  const du = rand() * 40;
  const gutter = rand() < 0.5 ? 0x9ea4a8 : rand() < 0.5 ? trim : s.roof;
  // Pitch: steeper on the one-and-a-half storey houses with their attic rooms.
  const pitch = (s.floors === 1 ? 38 + rand() * 10 : 28 + rand() * 12) * Math.PI / 180, r = hw * Math.tan(pitch);
  // Concrete foundation from below the ground to the floor, slightly proud of the walls.
  const base = -s.lift - 0.5;
  B.box(M.concrete, F, 0, (base - 0.0) / 2 + 0.06, 0, w + 0.14, -base + 0.12, d + 0.14, dark ? 0x8f8d88 : 0xb3b0aa, { skip: SKIP.ny });
  if (!low && s.lift > 0.15) B.box(M.concrete, F, 0, 0.1, 0, w + 0.2, 0.06, d + 0.2, 0x9b9893, { skip: SKIP.ny }); // drip ledge
  // Walls and gables.
  B.box(wallMat, F, 0, wallH / 2, 0, w, wallH, d, s.wall, { skip: SKIP.py | SKIP.ny, du });
  addGables(B, wallMat, F, w, d, wallH, r, s.wall, { du });
  const a = addRoof(B, M, F, { w, d, y0: wallH, r, roof: s.roof, trim, gutter, low, du });
  // Corner boards and a frieze under the eaves.
  if (!timber || rand() < 0.5) for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(M.paint, F, sx * (hw + 0.01), wallH / 2, sz * (hd + 0.01), 0.16, wallH, 0.16, trim, { skip: SKIP.ny });
  if (!low) for (const sx of [-1, 1]) B.box(M.paint, F, sx * (hw + 0.02), wallH - 0.14, 0, 0.04, 0.26, d, trim, { skip: SKIP.ny | SKIP.py });
  if (s.shop) B.box(M.paint, F, face * (hw + 0.06), 2.85, 0, 0.1, 0.42, d * 0.85, s.sign ?? 0x2a2c2f);
  // Downpipes at the ends of each gutter, with a shoe at the foot.
  if (!low) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (rand() < 0.35) continue;
    const px = sx * (hw + 0.12), pz = sz * (hd - 0.12), top = wallH - 0.4 * Math.tan(a) - 0.16, foot = ground(px, pz) + 0.05;
    B.box(M.paint, F, px, (top + foot) / 2, pz, 0.08, top - foot, 0.08, gutter);
    B.box(M.paint, F, px + sx * 0.12, top + 0.02, pz, 0.24, 0.07, 0.07, gutter);
    B.box(M.paint, F, px + sx * 0.08, foot + 0.04, pz, 0.2, 0.06, 0.09, gutter);
  }
  // The door: on the road side, in one of the window bays.
  const bays = Math.max(2, Math.floor(d / 2.1)), bayZ = (k) => -hd + (k + 0.5) * (d / bays);
  const doorBay = rand() < 0.5 ? 0 : bays - 1;
  const dz = bays > 2 && rand() < 0.4 ? bayZ(Math.floor(bays / 2)) : bayZ(doorBay);
  const porch = s.floors === 2 && rand() < 0.45;
  const lit = rand() < 0.75 ? 0.5 : 0.2;
  const glassC = () => litColor(rand, lit);
  const winH = (f) => (f === 0 ? 1.3 : 1.2) + (s.floors === 1 ? 0.05 : 0);
  const sillY = (f) => (f === 0 ? 0.9 : wallH / s.floors + 0.8);
  const floorsWithWin = s.floors;
  // Long-side windows.
  for (const sx of [-1, 1]) for (let f = 0; f < floorsWithWin; f++) for (let k = 0; k < bays; k++) {
    const z = bayZ(k);
    if (sx === face && f === 0 && Math.abs(z - dz) < 0.6) continue;
    if (sx === face && f === 0 && porch && Math.abs(z - dz) < 1.5) continue;
    if (s.shop && sx === face && f === 0) {
      // Shop front: a big display window in each bay under a sign board.
      addWindow(B, M, F, sx * (hw + 0.005), 0.45, z, sx * Math.PI / 2, d / bays - 0.45, 2.05, { frame: 0x2a2c2f, glass: litColor(rand, 0.9), style: 'p', low, glassMat, depth: 0.12 });
      continue;
    }
    addWindow(B, M, F, sx * (hw + 0.005), sillY(f), z, sx * Math.PI / 2, 1.0, winH(f), { frame: trim, glass: glassC(), style: wstyle, head, low, glassMat });
  }
  // Gable-end windows, and attic windows up in the gables.
  for (const sz of [-1, 1]) {
    for (let f = 0; f < s.floors; f++) {
      const xs = w > 6.4 ? [-w / 4, w / 4] : [0];
      for (const x of xs) addWindow(B, M, F, x, sillY(f), sz * (hd + 0.005), sz > 0 ? 0 : Math.PI, 0.95, winH(f), { frame: trim, glass: glassC(), style: wstyle, head, low, glassMat });
    }
    if (r > 1.7) addWindow(B, M, F, 0, wallH + r * 0.22, sz * (hd + 0.005), sz > 0 ? 0 : Math.PI, 0.8, Math.min(1.1, r * 0.42), { frame: trim, glass: glassC(), style: wstyle === 'p' ? 'p' : 't', low, glassMat });
  }
  // Basement windows in a tall foundation.
  if (!low && s.lift > 0.75) for (const sx of [-1, 1]) for (let k = 0; k < bays; k++) {
    if (sx === face && Math.abs(bayZ(k) - dz) < 1.6) continue;
    addWindow(B, M, F, sx * (hw + 0.075), -s.lift + 0.25, bayZ(k), sx * Math.PI / 2, 0.8, Math.min(0.5, s.lift - 0.35), { frame: trim, glass: glassC(), style: 'p', sill: false, low, depth: 0.06, glassMat });
  }
  // Dormer (kvistur) on the road slope of a steep attic roof.
  const dwH = 1.5, dwR = 0.7, set = 0.5;
  if (!low && s.floors === 1 && r > set * Math.tan(a) + dwH + dwR + 0.35 && rand() < 0.55) {
    const dw = 2.1, xf = face * (hw - set), yb = wallH + set * Math.tan(a);
    const depthIn = Math.min(hw - set - 0.15, (dwH + dwR) / Math.tan(a) + 0.35);
    // D: origin on the slope at the dormer's face, z out towards the road, x along the house.
    const D = frame(F, xf, 0, 0, face > 0 ? Math.PI / 2 : -Math.PI / 2);
    B.box(wallMat, D, 0, yb - 0.3 + (dwH + 0.3) / 2, -depthIn / 2, dw, dwH + 0.3, depthIn, s.wall, { skip: SKIP.ny | SKIP.nz | SKIP.py, du });
    B.poly(wallMat, D, [[-dw / 2, yb + dwH, 0], [dw / 2, yb + dwH, 0], [0, yb + dwH + dwR, 0]], s.wall, { du });
    addRoof(B, M, frame(D, 0, 0, -depthIn / 2 + 0.15), { w: dw, d: depthIn + 0.3, y0: yb + dwH, r: dwR, ov: 0.22, gov: 0, roof: s.roof, trim, gutters: false, low, du });
    for (const sx2 of [-1, 1]) B.box(M.paint, D, sx2 * (dw / 2 + 0.01), yb - 0.3 + (dwH + 0.3) / 2, 0.01, 0.14, dwH + 0.3, 0.14, trim);
    addWindow(B, M, D, 0, yb + 0.2, 0.005, 0, 1.0, 1.05, { frame: trim, glass: glassC(), style: wstyle, low, glassMat });
  }
  // Chimney through the ridge, rendered concrete with a cap.
  if (rand() < 0.75) {
    const cz = (rand() < 0.5 ? -1 : 1) * hd * (0.2 + rand() * 0.3), cx = (rand() - 0.5) * 0.6;
    const ytop = wallH + r + 0.75, yb = wallH + r - 1.2;
    B.box(M.concrete, F, cx, (ytop + yb) / 2, cz, 0.55, ytop - yb, 0.55, dark ? 0x9a9792 : 0xc9c6c0, { skip: SKIP.ny });
    B.box(M.concrete, F, cx, ytop + 0.05, cz, 0.7, 0.1, 0.7, 0x8d8a85);
    if (!low) B.box(M.paint, F, cx, ytop + 0.22, cz, 0.18, 0.25, 0.18, 0x2a2b2d, { skip: SKIP.ny });
  }
  // Front door with its frame, a transom light and steps (or an enclosed porch).
  const doorC = pick(rand, DOORS);
  const solids = [];
  let doorF, doorRise = Math.max(0.15, -ground(face * (hw + 1.2), dz));
  if (porch) {
    const pw = 2.2, pdp = 1.7, ph = 2.75;
    const P = frame(F, face * (hw + pdp / 2), 0, dz, face > 0 ? Math.PI / 2 : -Math.PI / 2);
    // In P: z out towards the road, x along the house.
    B.box(M.concrete, P, 0, (-s.lift - 0.5) / 2 + 0.06, 0, pw + 0.14, s.lift + 0.62, pdp + 0.14, 0xb3b0aa, { skip: SKIP.ny });
    B.box(wallMat, P, 0, ph / 2, 0, pw, ph, pdp, s.wall, { skip: SKIP.ny | SKIP.py | SKIP.nz, du });
    addGables(B, wallMat, P, pw, pdp, ph, 0.8, s.wall, { du });
    addRoof(B, M, frame(P, 0, 0, -0.15), { w: pw, d: pdp + 0.3, y0: ph, r: 0.8, ov: 0.25, gov: 0.15, roof: s.roof, trim, gutters: false, low, du });
    doorF = frame(P, 0, 0, pdp / 2 + 0.005, 0);
    solids.push({ x: face * (hw + pdp / 2), z: dz, hx: pdp / 2, hz: pw / 2 });
    doorRise = Math.max(0.15, -ground(face * (hw + pdp + 1), dz));
    for (const sx2 of [-1, 1]) B.box(M.paint, P, sx2 * (pw / 2 + 0.01), ph / 2, pdp / 2 + 0.01, 0.14, ph, 0.14, trim, { skip: SKIP.ny });
  } else {
    doorF = frame(F, face * (hw + 0.005), 0, dz, face > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (rand() < 0.6) B.box(M.paint, doorF, 0, 2.55, 0.45, 1.7, 0.09, 0.9, rand() < 0.5 ? trim : 0x3a3d42); // canopy
  }
  B.box(M.paint, doorF, 0, 1.03, -0.01, 0.92, 2.06, 0.06, doorC, { skip: SKIP.nz });
  if (!low) for (const y of [0.55, 1.45]) B.box(M.paint, doorF, 0, y, 0.025, 0.62, 0.6, 0.03, _c.set(doorC).multiplyScalar(0.8).getHex(), { skip: SKIP.nz });
  B.box(M.paint, doorF, 0.33, 1.0, 0.05, 0.04, 0.16, 0.05, 0xc8c2b0); // handle
  for (const sx2 of [-1, 1]) B.box(M.paint, doorF, sx2 * 0.52, 1.2, 0.03, 0.12, 2.4, 0.08, trim, { skip: SKIP.nz });
  B.box(M.paint, doorF, 0, 2.4, 0.03, 1.16, 0.1, 0.08, trim, { skip: SKIP.nz });
  B.box(glassMat, doorF, 0, 2.2, 0.0, 0.92, 0.28, 0.03, glassC(), { skip: SKIP.nz });
  B.box(M.paint, doorF, 0, 2.08, 0.03, 0.92, 0.06, 0.07, trim, { skip: SKIP.nz });
  addSteps(B, M, doorF, doorRise, 1.4, { low, rail: dark ? 0xf4f3ee : 0x2c2f33 });
  // A picket fence along the road side with a gate gap at the path.
  if (!low && s.fence) {
    const fx = face * (hw + (porch ? 3.4 : 3.0)), z0 = -hd - 1.5, z1 = hd + 1.5, fc = s.fenceColor;
    for (let z = z0; z <= z1 + 1e-6; z += 0.17) {
      if (Math.abs(z - dz) < 0.65) continue;
      const g0 = ground(fx, z);
      B.box(M.paint, F, fx, g0 + 0.45, z, 0.03, 0.95, 0.085, fc, { skip: SKIP.ny });
    }
    for (const [za, zb] of [[z0, dz - 0.65], [dz + 0.65, z1]]) {
      const zm = (za + zb) / 2, g0 = ground(fx, zm);
      for (const y of [0.25, 0.7]) B.box(M.paint, F, fx - face * 0.035, g0 + y, zm, 0.04, 0.07, zb - za, fc);
      for (const z of [za, zb]) B.box(M.paint, F, fx - face * 0.05, ground(fx, z) + 0.55, z, 0.09, 1.1, 0.09, fc, { skip: SKIP.ny });
    }
    solids.push({ x: fx, z: (z0 + dz - 0.65) / 2, hx: 0.06, hz: (dz - 0.65 - z0) / 2 }, { x: fx, z: (dz + 0.65 + z1) / 2, hx: 0.06, hz: (z1 - dz - 0.65) / 2 });
  }
  return { solids, rise: r };
}

// ---------- A Reykjavík apartment block ----------
// s: { w (x), d (z), floors, lift, wall, accent, pitched }. Painted concrete, floor bands, rows of
// windows, stacked balconies on the +z side, a stairwell entrance, a parapet or a low iron roof.
export function addBlock(B, M, F, s, rand, { low = false } = {}) {
  const { w, d, floors } = s, hw = w / 2, hd = d / 2, FH = 2.85, H = floors * FH + 0.4;
  const base = -s.lift - 0.5;
  B.box(M.concrete, F, 0, base / 2 + 0.25, 0, w + 0.1, -base + 0.5, d + 0.1, 0x8f8c87, { skip: SKIP.ny });
  B.box(M.concrete, F, 0, 0.5 + H / 2, 0, w, H, d, s.wall, { skip: SKIP.ny });
  // Floor bands (slab edges) wrap round.
  if (!low) for (let f = 1; f < floors; f++) B.box(M.concrete, F, 0, f * FH + 0.5, 0, w + 0.07, 0.2, d + 0.07, s.accent, { skip: SKIP.ny | SKIP.py });
  if (s.pitched) {
    addRoof(B, M, F, { w, d, y0: H + 0.5, r: hw * Math.tan(0.24), ov: 0.55, gov: 0.4, roof: s.roof, trim: 0xe9e7e0, low });
    addGables(B, M.concrete, F, w, d, H + 0.5, hw * Math.tan(0.24), s.wall);
  } else {
    // Parapet with a metal coping, and a lift housing and vents on the roof.
    B.box(M.concrete, F, 0, H + 0.5 + 0.3, 0, w, 0.6, d, s.wall, { skip: SKIP.ny });
    B.box(M.paint, F, 0, H + 0.5 + 0.63, 0, w + 0.12, 0.06, d + 0.12, 0x8d9296);
    if (!low) {
      B.box(M.concrete, F, -hw * 0.3, H + 1.5, 0, 2.6, 1.6, 2.4, s.wall, { skip: SKIP.ny });
      for (const x of [hw * 0.35, hw * 0.55]) B.box(M.paint, F, x, H + 1.35, -hd * 0.3, 0.5, 0.5, 0.5, 0x7d8286, { skip: SKIP.ny });
    }
  }
  const glassC = () => litColor(rand, 0.55), fc = s.frame;
  // Long faces (±z): bays of windows; balconies on +z above the ground floor.
  const nb = Math.max(2, Math.floor(w / 3.1)), bx = (k) => -hw + (k + 0.5) * (w / nb);
  const stair = Math.floor(nb / 2);
  for (const sz of [-1, 1]) for (let f = 0; f < floors; f++) for (let k = 0; k < nb; k++) {
    const x = bx(k), y = f * FH + 0.5 + 0.95, ry = sz > 0 ? 0 : Math.PI, z = sz * (hd + 0.005);
    if (sz < 0 && k === stair) {
      // Stairwell: the entrance at the bottom, narrow landing windows half a floor up.
      if (f === 0) continue;
      addWindow(B, M, F, x, y - FH / 2 + 0.2, z, ry, 0.8, 1.2, { frame: fc, glass: glassC(), style: 'p', low });
      continue;
    }
    const balcony = sz > 0 && f > 0 && k % 2 === 0;
    if (balcony) {
      // Balcony door beside a window, a slab, and a parapet panel.
      addWindow(B, M, F, x - 0.55, y - 0.85, z, ry, 0.9, 2.15, { frame: fc, glass: glassC(), style: 'p', sill: false, low });
      addWindow(B, M, F, x + 0.6, y, z, ry, 1.2, 1.3, { frame: fc, glass: glassC(), style: 'p', low });
      const by = f * FH + 0.5, bd = 1.35, bw = w / nb - 0.3;
      B.box(M.concrete, F, x, by - 0.08, sz * (hd + bd / 2), bw, 0.16, bd, s.accent);
      B.box(M.paint, F, x, by + 0.5, sz * (hd + bd - 0.03), bw, 0.95, 0.06, s.balcony);
      if (!low) {
        for (const ex of [-1, 1]) B.box(M.paint, F, x + ex * (bw / 2 - 0.03), by + 0.5, sz * (hd + bd / 2), 0.06, 0.95, bd - 0.06, s.balcony);
        B.box(M.paint, F, x, by + 1.0, sz * (hd + bd - 0.03), bw + 0.04, 0.05, 0.1, 0x8d9296);
      }
    } else {
      addWindow(B, M, F, x, y, z, ry, 1.5, 1.35, { frame: fc, glass: glassC(), style: k % 2 ? 'p' : 't', low });
    }
  }
  // Gable ends (±x): a couple of smaller windows a floor.
  const ne = Math.max(1, Math.floor(d / 4.2));
  for (const sx of [-1, 1]) for (let f = 0; f < floors; f++) for (let k = 0; k < ne; k++) {
    const z = -hd + (k + 0.5) * (d / ne);
    addWindow(B, M, F, sx * (hw + 0.005), f * FH + 0.5 + 1.0, z, sx * Math.PI / 2, 1.0, 1.25, { frame: fc, glass: glassC(), style: 't', low });
  }
  // Entrance: glazed doors under a concrete canopy, steps and a lamp.
  const E = frame(F, bx(stair), 0.5, -hd - 0.005, Math.PI);
  B.box(M.paint, E, 0, 1.15, 0.0, 1.8, 2.3, 0.1, 0x3a3d42, { skip: SKIP.nz });
  B.box(M.glass, E, 0, 1.12, 0.04, 1.5, 2.05, 0.04, litColor(rand, 0.9), { skip: SKIP.nz });
  B.box(M.concrete, E, 0, 2.6, 0.8, 2.8, 0.18, 1.6, s.accent);
  addSteps(B, M, E, Math.max(0.2, s.lift + 0.5), 2.6, { low });
}

// ---------- Far versions (one material, plus lit windows) ----------
export function addFarHouse(B, M, F, s, rand) {
  const hw = s.w / 2, r = hw * Math.tan((s.floors === 1 ? 42 : 34) * Math.PI / 180);
  B.box(M.far, F, 0, (s.wallH - s.lift - 0.4) / 2, 0, s.w, s.wallH + s.lift + 0.4, s.d, s.wall, { skip: SKIP.ny });
  addGables(B, M.far, F, s.w, s.d, s.wallH, r, s.wall);
  const a = Math.atan2(r, hw), L = (hw + 0.4) / Math.cos(a);
  for (const sx of [-1, 1]) B.box(M.far, F, sx * (hw + 0.4) / 2, s.wallH + r - ((hw + 0.4) / 2) * Math.tan(a) + 0.04, 0, L, 0.08, s.d + 0.6, s.roof, { rz: -sx * a, skip: SKIP.ny });
  const bays = Math.max(2, Math.floor(s.d / 2.1));
  for (const sx of [-1, 1]) for (let f = 0; f < s.floors; f++) for (let k = 0; k < bays; k++) {
    B.box(M.glass, F, sx * (hw + 0.02), (f === 0 ? 0.9 : s.wallH / s.floors + 0.8) + 0.65, -s.d / 2 + (k + 0.5) * (s.d / bays), 0.04, 1.2, 0.85, litColor(rand, 0.45), { skip: SKIP.ny | SKIP.py });
  }
}
export function addFarBlock(B, M, F, s, rand) {
  const H = s.floors * 2.85 + 0.9;
  B.box(M.far, F, 0, (H - s.lift - 0.4) / 2, 0, s.w, H + s.lift + 0.4, s.d, s.wall, { skip: SKIP.ny });
  const nb = Math.max(2, Math.floor(s.w / 3.1));
  for (const sz of [-1, 1]) for (let f = 0; f < s.floors; f++) for (let k = 0; k < nb; k++) {
    B.box(M.glass, F, -s.w / 2 + (k + 0.5) * (s.w / nb), f * 2.85 + 0.5 + 1.6, sz * (s.d / 2 + 0.02), 1.4, 1.3, 0.04, litColor(rand, 0.5), { skip: SKIP.ny | SKIP.py });
  }
}

// ---------- Landmark parts ----------
const ARCH_CACHE = new Map();
function archGeos(w, h, t, pointed) {
  const key = `${w}|${h}|${t}|${pointed}`;
  if (ARCH_CACHE.has(key)) return ARCH_CACHE.get(key);
  const outline = (p, w2, h2, y0) => {
    // Round arch: half circle on the jambs. Pointed (lancet): two arcs of radius w meeting at the apex.
    const hw = w2 / 2;
    if (pointed) {
      const hs = h2 - w2 * 0.866;
      p.moveTo(-hw, y0); p.lineTo(hw, y0); p.lineTo(hw, hs);
      p.absarc(-hw, hs, w2, 0, Math.PI / 3, false);
      p.absarc(hw, hs, w2, (2 * Math.PI) / 3, Math.PI, false);
      p.lineTo(-hw, y0);
    } else {
      p.moveTo(-hw, y0); p.lineTo(hw, y0); p.lineTo(hw, h2 - hw); p.absarc(0, h2 - hw, hw, 0, Math.PI, false); p.lineTo(-hw, y0);
    }
    return p;
  };
  const shape = outline(new THREE.Shape(), w, h, 0);
  shape.holes.push(outline(new THREE.Path(), w - 2 * t, h - t, t));
  const frameG = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false, curveSegments: 10 });
  const glassG = new THREE.ShapeGeometry(outline(new THREE.Shape(), w - 2 * t, h - t, t), 10);
  const r = { frameG, glassG };
  ARCH_CACHE.set(key, r);
  return r;
}
// An arched (or pointed) window or door light: frame, glass, glazing bars and a sill.
export function addArchWindow(B, M, F, x, y, z, ry, w, h, { pointed = false, frame: fc = 0xf4f3ee, glassMat, glass = 0xffc46b, bars = true, sill = true, t = 0.09, fill = null } = {}) {
  const W = frame(F, x, y, z, ry), { frameG, glassG } = archGeos(w, h, t, pointed);
  B.geo(M.paint, frameG, frame(W, 0, 0, -0.02), fc);
  B.geo(fill ? M.paint : glassMat, glassG, frame(W, 0, 0, 0.012), fill ?? glass);
  if (bars && !fill) {
    const spring = pointed ? h - w * 0.866 : h - w / 2;
    B.box(M.paint, W, 0, (h - t) / 2 + t / 2, 0.02, 0.04, h - t * 1.5, 0.04, fc);
    for (const k of [0.33, 0.66]) B.box(M.paint, W, 0, t + (spring - t) * k, 0.02, w - 2 * t, 0.04, 0.04, fc);
  }
  if (sill) B.box(M.paint, W, 0, -0.03, 0.06, w + 0.16, 0.07, 0.16, fc);
}
// A hidden box that the landmark registers as a solid wall (collectColliders reads userData.solid).
export function solidBox(group, x, y, z, w, h, d, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), archMats().hidden);
  m.position.set(x, y, z); m.rotation.y = ry; m.userData.solid = true; m.castShadow = false;
  group.add(m);
  return m;
}
const SPIRE_CACHE = new Map();
function spireGeo(r, h, sides) {
  const k = `${r}|${h}|${sides}`;
  if (!SPIRE_CACHE.has(k)) { const g = new THREE.ConeGeometry(r, h, sides, 1, true); g.rotateY(Math.PI / sides); SPIRE_CACHE.set(k, g.toNonIndexed()); SPIRE_CACHE.get(k).computeVertexNormals(); }
  return SPIRE_CACHE.get(k);
}
// A spire of `sides` faces, its foot at y, with a ball and cross on top.
export function addSpire(B, M, F, x, y, z, r, h, sides, color, { cross = 0xd8b84a, base = null } = {}) {
  B.geo(M.paint, spireGeo(r, h, sides), frame(F, x, y + h / 2, z), color);
  if (base !== null) B.box(M.paint, F, x, y - 0.06, z, r * 2 * Math.cos(Math.PI / sides) + 0.2, 0.14, r * 2 * Math.cos(Math.PI / sides) + 0.2, base);
  B.box(M.paint, F, x, y + h + 0.1, z, 0.16, 0.2, 0.16, cross);
  B.box(M.paint, F, x, y + h + 0.75, z, 0.07, 1.1, 0.07, cross);
  B.box(M.paint, F, x, y + h + 0.95, z, 0.5, 0.07, 0.07, cross);
}
// A belfry opening: a dark arched hole with louvre slats.
function addLouvre(B, M, F, x, y, z, ry, w, h, fc) {
  addArchWindow(B, M, F, x, y, z, ry, w, h, { frame: fc, fill: 0x1b1c1e, bars: false });
  const W = frame(F, x, y, z, ry);
  for (let yy = 0.2; yy < h - w / 2; yy += 0.18) B.box(M.paint, W, 0, yy, 0.03, w - 0.16, 0.035, 0.05, 0x6b6e70, { rx: -0.6 });
}

// Vík (and Ísafjörður) church: white rendered walls with corner pilasters and a cornice, lancet
// windows, a red corrugated roof with gutters, and a square front tower with louvred belfry
// openings under a steep four-sided spire. Same footprint as before: nave 6 x 10 at z = -1,
// tower 2.6 square at z = 5.
export function townChurch(kit, c, { roof = 0xa3281e, walls = 0xf2f0ea } = {}) {
  const M = archMats(), B = new Batch(), F = new THREE.Matrix4(), glass = lmGlass(kit);
  const white = walls, trim = 0xf7f6f2, stone = 0xb8b5ae;
  const NW = 6, ND = 10, NH = 4.2, NZ = -1, TW = 2.6, TH = 7.5, TZ = 5;
  const Fn = frame(null, 0, 0, NZ);
  B.box(M.concrete, Fn, 0, -0.45, 0, NW + 0.2, 1.3, ND + 0.2, stone, { skip: SKIP.ny });
  B.box(M.concrete, Fn, 0, NH / 2, 0, NW, NH, ND, white, { skip: SKIP.ny | SKIP.py });
  addGables(B, M.concrete, Fn, NW, ND, NH, 2.8, white);
  addRoof(B, M, Fn, { w: NW, d: ND, y0: NH, r: 2.8, ov: 0.35, gov: 0.25, roof, trim, gutter: 0xa9adb0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(M.concrete, Fn, sx * (NW / 2 - 0.12), NH / 2, sz * (ND / 2 - 0.12), 0.45, NH, 0.45, trim, { skip: SKIP.ny });
  for (const sx of [-1, 1]) B.box(M.concrete, Fn, sx * (NW / 2 + 0.04), NH - 0.15, 0, 0.12, 0.3, ND + 0.1, trim);
  for (const sx of [-1, 1]) for (const z of [-3, 0, 3]) addArchWindow(B, M, Fn, sx * (NW / 2 + 0.01), 1.4, z, sx * Math.PI / 2, 0.85, 2.1, { pointed: true, glassMat: glass, frame: trim });
  addArchWindow(B, M, Fn, 0, NH + 0.4, -ND / 2 - 0.01, Math.PI, 0.6, 1.3, { pointed: true, glassMat: glass, frame: trim });
  // Tower.
  B.box(M.concrete, F, 0, -0.45, TZ, TW + 0.25, 1.3, TW + 0.25, stone, { skip: SKIP.ny });
  B.box(M.concrete, F, 0, TH / 2, TZ, TW, TH, TW, white, { skip: SKIP.ny });
  for (const y of [NH - 0.15, TH - 2.6]) B.box(M.concrete, F, 0, y, TZ, TW + 0.12, 0.18, TW + 0.12, trim);
  B.box(M.concrete, F, 0, TH + 0.08, TZ, TW + 0.35, 0.22, TW + 0.35, trim);
  for (const [sx, sz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
    addLouvre(B, M, F, sx * (TW / 2 + 0.01), TH - 2.2, TZ + sz * (TW / 2 + 0.01), ry, 0.8, 1.6, trim);
    if (sz !== -1) addArchWindow(B, M, F, sx * (TW / 2 + 0.01), 4.6, TZ + sz * (TW / 2 + 0.01), ry, 0.45, 1.0, { pointed: true, glassMat: glass, frame: trim, bars: false });
  }
  addSpire(B, M, F, 0, TH + 0.18, TZ, 1.95, 4.5, 4, roof, { cross: 0xf2f2ee });
  // Pointed double door with a white surround, and steps.
  const D = frame(F, 0, 0, TZ + TW / 2 + 0.01);
  addArchWindow(B, M, D, 0, 0, 0.0, 0, 1.25, 2.5, { pointed: true, frame: trim, fill: 0x5a2a20, sill: false, t: 0.12 });
  B.box(M.paint, D, 0, 1.0, 0.04, 0.03, 2.0, 0.03, 0x2a1a14);
  addSteps(B, M, D, 0.45, 2.2, { railings: false });
  B.flush(c);
  solidBox(c, 0, NH / 2, NZ, NW, NH, ND);
  solidBox(c, 0, TH / 2, TZ, TW, TH, TW);
}

// Húsavíkurkirkja (1907, Rögnvaldur Ólafsson): a cross-shaped timber church in the Swiss chalet
// style, white lap boards with red-brown trim and window frames, steep green roofs over the nave
// and transepts, and a tall front tower whose spire rises from four little gables. Footprint about
// the old one's (nave 7 x 13), with transepts.
export function husavikChurch(kit, c) {
  const M = archMats(), B = new Batch(), glass = lmGlass(kit);
  const wall = 0xf1efe8, roof = 0x2e6a4a, trim = 0x8e2a22, stone = 0xa9a69f;
  const NW = 7, ND = 13, NH = 4.8, NZ = -1.5, pitch = 50 * Math.PI / 180;
  const Fn = frame(null, 0, 0, NZ), Ft = frame(null, 0, 0, NZ - 1.5, Math.PI / 2);
  const rN = NW / 2 * Math.tan(pitch), TWd = 5.6, rT = TWd / 2 * Math.tan(pitch);
  for (const [Fx, w, d, r] of [[Fn, NW, ND, rN], [Ft, TWd, 14, rT]]) {
    B.box(M.concrete, Fx, 0, -0.4, 0, w + 0.16, 1.2, d + 0.16, stone, { skip: SKIP.ny });
    B.box(M.board, Fx, 0, NH / 2, 0, w, NH, d, wall, { skip: SKIP.ny | SKIP.py });
    addGables(B, M.board, Fx, w, d, NH, r, wall);
    addRoof(B, M, Fx, { w, d, y0: NH, r, ov: 0.45, gov: 0.35, roof, trim, gutter: trim });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(M.paint, Fx, sx * (w / 2 + 0.01), NH / 2, sz * (d / 2 + 0.01), 0.18, NH, 0.18, trim, { skip: SKIP.ny });
    B.box(M.paint, Fx, 0, 0.12, 0, w + 0.06, 0.2, d + 0.06, trim, { skip: SKIP.ny | SKIP.py });
    // Decorative king posts in the gables (the chalet style's carved bargeboards).
    for (const sz of [-1, 1]) {
      B.box(M.paint, Fx, 0, NH + r * 0.45, sz * (d / 2 + 0.3), 0.12, r * 0.9, 0.1, trim);
      B.box(M.paint, Fx, 0, NH + 0.1, sz * (d / 2 + 0.06), w + 0.1, 0.16, 0.12, trim);
    }
  }
  // Nave windows between the transept and the ends; transept ends; round windows in the gables.
  for (const sx of [-1, 1]) for (const z of [-5.2, 1.6, 3.9]) addArchWindow(B, M, Fn, sx * (NW / 2 + 0.01), 1.3, z, sx * Math.PI / 2, 0.9, 2.4, { glassMat: glass, frame: trim });
  for (const sx of [-1, 1]) {
    for (const z of [-1.1, 1.1]) addArchWindow(B, M, Ft, z, 1.3, sx * 7.01, sx > 0 ? 0 : Math.PI, 0.85, 2.4, { glassMat: glass, frame: trim });
    addArchWindow(B, M, Ft, 0, NH + 0.5, sx * 7.01, sx > 0 ? 0 : Math.PI, 0.9, 0.9, { glassMat: glass, frame: trim, bars: false });
  }
  addArchWindow(B, M, Fn, 0, NH + 0.6, -ND / 2 - 0.01, Math.PI, 0.9, 1.4, { glassMat: glass, frame: trim });
  // Tower: board walls, a louvred belfry with a balcony rail, four small gables and the spire.
  const TW = 3.2, TH = 11, TZ = NZ + ND / 2 + TW / 2 - 0.4, F = new THREE.Matrix4();
  B.box(M.concrete, F, 0, -0.4, TZ, TW + 0.2, 1.2, TW + 0.2, stone, { skip: SKIP.ny });
  B.box(M.board, F, 0, TH / 2, TZ, TW, TH, TW, wall, { skip: SKIP.ny });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(M.paint, F, sx * (TW / 2 + 0.01), TH / 2, TZ + sz * (TW / 2 + 0.01), 0.18, TH, 0.18, trim, { skip: SKIP.ny });
  for (const y of [NH, TH - 2.9, TH]) B.box(M.paint, F, 0, y, TZ, TW + 0.16, 0.2, TW + 0.16, trim);
  const faces = [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]];
  for (const [sx, sz, ry] of faces) {
    const px = sx * (TW / 2 + 0.01), pz = TZ + sz * (TW / 2 + 0.01);
    addLouvre(B, M, F, px, TH - 2.6, pz, ry, 0.9, 2.0, trim);
    if (sz !== -1) addArchWindow(B, M, F, px, NH + 0.8, pz, ry, 0.7, 1.6, { glassMat: glass, frame: trim });
    // A little gable on each face at the foot of the spire.
    const G = frame(F, px * 1.0, TH, pz - TZ + TZ, ry);
    const hw = TW / 2 + 0.05;
    B.poly(M.board, G, [[-hw, 0, 0.02], [hw, 0, 0.02], [0, 1.6, 0.02]], wall);
    for (const s of [-1, 1]) B.box(M.roof, G, s * hw / 2, 0.8 + 0.05, -0.3, Math.hypot(hw, 1.6) + 0.15, 0.06, 0.9, roof, { rz: -s * Math.atan2(1.6, hw), uv: 'r' });
  }
  addSpire(B, M, F, 0, TH + 0.1, TZ, TW * 0.55, 11, 8, roof, { cross: 0xf2f2ee });
  // Front door in the tower: double doors with a round-arched light.
  const D = frame(F, 0, 0, TZ + TW / 2 + 0.01);
  addArchWindow(B, M, D, 0, 0, 0, 0, 1.4, 2.8, { frame: trim, fill: 0x6a3d24, sill: false, t: 0.13 });
  B.box(M.paint, D, 0, 1.1, 0.04, 0.03, 2.2, 0.03, 0x2a1a14);
  addSteps(B, M, D, 0.5, 2.4, { railings: false });
  B.flush(c);
  solidBox(c, 0, NH / 2, NZ, NW, NH, ND);
  solidBox(c, 0, NH / 2, NZ - 1.5, 14, NH, TWd);
  solidBox(c, 0, TH / 2, TZ, TW, TH, TW);
}

// Búðakirkja: a small black-tarred timber church (vertical boards) on a grey foundation, black
// roof, white six-pane windows, a white classical door surround with a pediment, and a small black
// belfry with white trim and a pyramid cap. Nave 5.6 x 9.5 at z = -1.
export function budirChurch(kit, g) {
  const M = archMats(), B = new Batch(), glass = lmGlass(kit);
  const black = 0x17181b, white = 0xf4f4f0, roof = 0x1c1d20;
  const W = 5.6, D = 9.5, H = 4.2, r = 2.2, Fn = frame(null, 0, 0, -1);
  B.box(M.concrete, Fn, 0, -0.35, 0, W + 0.2, 1.0, D + 0.2, 0xb9bcc0, { skip: SKIP.ny });
  B.box(M.board, Fn, 0, H / 2 + 0.15, 0, W, H - 0.3, D, black, { skip: SKIP.ny | SKIP.py, uv: 's' });
  addGables(B, M.board, Fn, W, D, H, r, black, { uv: 's' });
  // Battens over the board joints.
  for (const sz of [-1, 1]) for (let x = -W / 2 + 0.35; x < W / 2; x += 0.45) B.box(M.board, Fn, x, H / 2 + 0.15, sz * (D / 2 + 0.02), 0.07, H - 0.3, 0.04, black, { uv: 's' });
  for (const sx of [-1, 1]) for (let z = -D / 2 + 0.35; z < D / 2; z += 0.45) B.box(M.board, Fn, sx * (W / 2 + 0.02), H / 2 + 0.15, z, 0.04, H - 0.3, 0.07, black, { uv: 's' });
  addRoof(B, M, Fn, { w: W, d: D, y0: H, r, ov: 0.3, gov: 0.25, roof, trim: white, gutters: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(M.paint, Fn, sx * (W / 2 + 0.03), H / 2 + 0.15, sz * (D / 2 + 0.03), 0.16, H - 0.3, 0.16, white, { skip: SKIP.ny });
  for (const sx of [-1, 1]) for (const z of [-3, -0.5, 2]) addWindow(B, M, Fn, sx * (W / 2 + 0.03), 1.45, z, sx * Math.PI / 2, 0.85, 1.25, { frame: white, style: '6', glassMat: glass, glass: 0xffffff });
  addWindow(B, M, Fn, 0, H + 0.3, -D / 2 - 0.03, Math.PI, 0.6, 0.8, { frame: white, style: '6', glassMat: glass });
  // Door surround: pilasters, lintel and pediment.
  const Dd = frame(Fn, 0, 0, D / 2 + 0.03);
  B.box(M.paint, Dd, 0, 1.15, 0.03, 1.1, 2.3, 0.06, 0xf6f6f2);
  for (const k of [-1, 1]) B.box(M.paint, Dd, k * 0.25, 1.15, 0.065, 0.4, 2.1, 0.02, 0xe8e8e4);
  for (const sx of [-1, 1]) B.box(M.paint, Dd, sx * 0.78, 1.35, 0.08, 0.22, 2.7, 0.16, white);
  B.box(M.paint, Dd, 0, 2.8, 0.1, 1.9, 0.22, 0.2, white);
  B.poly(M.paint, Dd, [[-1.05, 2.92, 0.19], [1.05, 2.92, 0.19], [0, 3.47, 0.19]], white);
  B.box(M.paint, Dd, 0, 2.95, 0.1, 2.1, 0.06, 0.18, white);
  addSteps(B, M, Dd, 0.35, 1.8, { railings: false });
  // Belfry on the front of the ridge.
  const bz = D / 2 - 1.4, by = H + 0.6;
  B.box(M.board, Fn, 0, by + 1.3, bz, 1.5, 2.6, 1.5, black, { uv: 's', skip: SKIP.ny });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(M.paint, Fn, sx * 0.76, by + 1.6, bz + sz * 0.76, 0.1, 2.0, 0.1, white);
  B.box(M.paint, Fn, 0, by + 2.6, bz, 1.7, 0.12, 1.7, white);
  for (const [sx, sz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) addLouvre(B, M, Fn, sx * 0.76, by + 1.3, bz + sz * 0.76, ry, 0.55, 1.0, white);
  addSpire(B, M, Fn, 0, by + 2.66, bz, 1.12, 1.6, 4, roof, { cross: white });
  B.flush(g);
  solidBox(g, 0, H / 2, -1, W, H, D);
}

// A town house or shop for a landmark street, standing on the ground at (x, z) with its road side
// facing face (±1 in x). Returns its group (a solid box for the walls).
export function streetHouse(kit, x, z, { w = 6, d = 8, h = 3.2, wall = 0xf3f1ea, roof = 0xa3281e, face = 1, shop = false, rot = 0 } = {}) {
  const M = archMats(), B = new Batch(), g = new THREE.Group();
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const toL = (lx, lz) => [x + cs * lx + sn * lz, z - sn * lx + cs * lz];
  let lo = Infinity, hi = -Infinity;
  for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const [px, pz] = toL(cx * w / 2, cz * d / 2); const gy = kit.ground(px, pz); lo = Math.min(lo, gy); hi = Math.max(hi, gy); }
  const y = hi + 0.25;
  const floors = h > 4.2 ? 2 : 1;
  const s = { w, d, floors, wallH: h, lift: y - lo, face, wall, roof, shop };
  const F = frame(null, x, y, z, rot);
  addHouse(B, M, F, s, kit.rand, { ground: (lx, lz) => { const [px, pz] = toL(lx, lz); return kit.ground(px, pz) - y; }, glassMat: lmGlass(kit) });
  B.flush(g);
  solidBox(g, x, y + h / 2 - 0.5, z, w, h + 1, d, rot);
  return g;
}
