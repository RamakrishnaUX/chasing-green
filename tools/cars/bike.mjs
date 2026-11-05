// Prepare the cafe racer and its rider's helmet for the game: node tools/cars/bike.mjs
// Needs the same packages as process.mjs (not saved to package.json).
//
// The bike ("moto guzzi v-twin" by Yakpower, CC BY 4.0) comes facing +x with its parts grouped
// by material, not by part: both tyres share one, the fork, bars and spokes sit in the chrome
// and engine ones. So it is cut up by shape:
// - turned to face +z with the tyres on y = 0 and the origin halfway between the axles;
// - each wheel is every piece (a run of triangles joined at their corners) lying wholly inside
//   a cylinder round its axle: tyre, rim, spokes, hub and disc;
// - the steering is every piece lying wholly within a slab round the steering axis (found from
//   the fork tubes): fork, clamps, clip-on bars, levers and the front mudguard. The fairing, its
//   headlamp and screen stay on the frame, as on the real bike. It is saved as "steer", placed on
//   the axis with its +z along it, so the game turns it about z (and hangs the front wheel on it);
// - the maker's names and badges are painted out of the textures (filled in from the paint
//   round them), and the tyre maker's lettering from the sidewalls.
// The helmet ("moto helmet" by sayedgamal655, CC BY 4.0), an open-face leather helmet with
// goggles, loses its two side badges and most of its triangles, and is centred on the shell.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, dequantize, transformPrimitive, weld, compactPrimitive, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// Every primitive baked into world space, with the names of the nodes above it.
function bake(doc) {
  const parts = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const names = []; for (let p = node; p; p = p.getParentNode?.()) names.push(p.getName());
    for (const p of mesh.listPrimitives()) {
      const q = p.clone();
      for (const s of q.listSemantics()) q.setAttribute(s, p.getAttribute(s).clone());
      if (p.getIndices()) q.setIndices(p.getIndices().clone());
      for (const s of q.listSemantics()) if (/TEXCOORD_[1-9]|COLOR_|JOINTS|WEIGHTS/.test(s)) q.setAttribute(s, null);
      transformPrimitive(q, node.getWorldMatrix());
      parts.push({ prim: q, names: names.join(' '), mat: p.getMaterial()?.getName() || '' });
    }
  }
  return parts;
}
// The pieces of a primitive (runs of triangles joined at their corners, matched by position as
// seams split vertices): gives each vertex's piece.
function piecesOf(p) {
  const pos = p.getAttribute('POSITION'), arr = p.getIndices().getArray(), v = [0, 0, 0];
  const key = [], up = new Map();
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const k = v.map((x) => x.toFixed(4)).join(); key.push(k); up.set(k, k); }
  const find = (a) => { while (up.get(a) !== a) { up.set(a, up.get(up.get(a))); a = up.get(a); } return a; };
  for (let t = 0; t < arr.length; t += 3) { const a = find(key[arr[t]]); up.set(find(key[arr[t + 1]]), a); up.set(find(key[arr[t + 2]]), a); }
  return (i) => find(key[i]);
}
// Split a part's triangles by piece: test(vertex) must hold for every vertex of a piece for the
// piece to go. Returns the moved part, or null.
function take(doc, part, test) {
  const p = part.prim, pos = p.getAttribute('POSITION'), idx = p.getIndices();
  const arr = idx.getArray(), piece = piecesOf(p), out = new Set(), v = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); if (!test(v)) out.add(piece(i)); }
  const keep = [], moved = [];
  for (let t = 0; t < arr.length; t += 3) (out.has(piece(arr[t])) ? keep : moved).push(arr[t], arr[t + 1], arr[t + 2]);
  if (!moved.length) return null;
  const q = p.clone();
  for (const s of q.listSemantics()) q.setAttribute(s, p.getAttribute(s).clone());
  q.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(moved)).setBuffer(idx.getBuffer()));
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(idx.getBuffer()));
  compactPrimitive(p); compactPrimitive(q);
  return { prim: q, names: part.names, mat: part.mat };
}
const verts = (prims) => { const out = [], v = [0, 0, 0]; for (const p of prims) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) out.push(a.getElement(i, v).slice()); } return out; };
const bounds = (pts) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const v of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } return { mn, mx }; };

// ---- Painting out marks: masked pixels are filled in from the ones round them (each repeatedly
// set to the mean of its neighbours, so the paint's shading carries on across). ----
function fill(data, W, H, C, [x0, y0, x1, y1], masked) {
  const m = new Uint8Array(W * H);
  for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) if (masked(x, y)) m[y * W + x] = 1;
  // Grown by two pixels, to take the soft edge of the lettering too.
  for (let k = 0; k < 2; k++) { const g = m.slice(); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; if (!m[i] && (m[i - 1] || m[i + 1] || m[i - W] || m[i + W])) g[i] = 1; } m.set(g); }
  for (let y = Math.max(1, y0 - 3); y < Math.min(H - 1, y1 + 3); y++) for (let x = Math.max(1, x0 - 3); x < Math.min(W - 1, x1 + 3); x++) if (x < x0 || x >= x1 || y < y0 || y >= y1) m[y * W + x] = 0;
  // A first guess, so even the middle of a big patch starts from the paint and not the mark:
  // along each row, the clean pixels either side, blended by distance.
  for (let y = y0; y < y1; y++) {
    let x = x0;
    while (x < x1) {
      if (!m[y * W + x]) { x++; continue; }
      let a = x; while (a < x1 && m[y * W + a]) a++;
      const L = x - 1, Rr = a; // clean either side (the box's edge is never masked)
      for (let k = x; k < a; k++) { const t = (k - L) / (Rr - L); for (let c = 0; c < C; c++) data[(y * W + k) * C + c] = data[(y * W + L) * C + c] * (1 - t) + data[(y * W + Rr) * C + c] * t; }
      x = a;
    }
  }
  for (let it = 0; it < 500; it++) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x; if (!m[i]) continue;
      for (let c = 0; c < C; c++) data[i * C + c] = (data[(i - 1) * C + c] + data[(i + 1) * C + c] + data[(i - W) * C + c] + data[(i + W) * C + c]) / 4;
    }
  }
}
// Marks, by material, as boxes in that material's base-colour texture (pixels at its own size);
// "paint": only the pixels that are not the red paint (the tank's eagle and lettering), else the
// whole box (name plates, embossed caps, the brake maker's name).
const MARKS = {
  tanknewlivery: [[700, 505, 805, 698, 'paint'], [930, 505, 1020, 675, 'paint'], [455, 957, 519, 993, 'paint']],
  seat_fender_mat: [[1088, 876, 1280, 916], [1094, 940, 1286, 981], [1304, 908, 1409, 945], [1700, 1776, 1895, 1830]],
  mat_cockpit: [[1690, 235, 1955, 322]],
  engine_mat: [[545, 1395, 700, 1428], [612, 1874, 756, 1912], [878, 1000, 948, 1070]],
};
async function paintOut(doc) {
  const done = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    const marks = MARKS[m.getName()]; if (!marks) continue;
    const base = m.getBaseColorTexture(), baseW = base.getSize()[0];
    for (const [slot, t] of [['base', base], ['mr', m.getMetallicRoughnessTexture()], ['nrm', m.getNormalTexture()]]) {
      if (!t || done.has(t)) continue; done.add(t);
      const { data, info } = await sharp(t.getImage()).raw().toBuffer({ resolveWithObject: true });
      const f = new Float32Array(data), s = info.width / baseW, C = info.channels, W = info.width;
      for (const [a, b, c, d, mode] of marks) {
        const box = [a, b, c, d].map((v) => Math.round(v * s));
        // The red paint: strong red, little green or blue (read from the base colour).
        const red = (x, y) => { const i = (y * W + x) * C; return f[i] > 110 && f[i + 1] < 0.45 * f[i] && f[i + 2] < 0.45 * f[i]; };
        let masked = () => true;
        if (mode === 'paint') {
          if (slot === 'base') masked = (x, y) => !red(x, y);
          else { const bm = m.__paintMask; masked = (x, y) => bm?.has(`${Math.floor(x / s)},${Math.floor(y / s)}`) ?? true; }
        }
        if (mode === 'paint' && slot === 'base') { const set = m.__paintMask || (m.__paintMask = new Set()); for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) if (!red(x, y)) set.add(`${x},${y}`); }
        fill(f, W, info.height, C, box, masked);
      }
      const outB = Buffer.from(f.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
      t.setImage(await sharp(outB, { raw: info }).png().toBuffer()).setMimeType('image/png');
    }
    console.log('  painted out', marks.length, 'marks on', m.getName());
  }
  // The tyre maker's name, the model and the size, in a ring on the sidewall: the ring is
  // redrawn from a clean stretch of itself (the rubber's grain runs the same way all round).
  const tyre = doc.getRoot().listMaterials().find((m) => m.getName() === 'mat_backtyre001');
  for (const t of [tyre.getBaseColorTexture(), tyre.getNormalTexture(), tyre.getMetallicRoughnessTexture()]) {
    if (!t) continue;
    const { data, info } = await sharp(t.getImage()).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, C = info.channels, k = W / 512, cx = W / 2, cy = H / 2, src = Buffer.from(data);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - cx, y - cy) / k; if (r < 188 || r > 256) continue;
      const th = Math.atan2(y - cy, x - cx) * 180 / Math.PI;
      if (th > 126 && th < 154) continue; // the clean stretch, lower left
      const ts = (140 + 12 * Math.sin(th * 0.21 + r * 0.07)) * Math.PI / 180;
      const sx = Math.round(cx + Math.cos(ts) * r * k), sy = Math.round(cy + Math.sin(ts) * r * k);
      for (let c = 0; c < C; c++) data[(y * W + x) * C + c] = src[(sy * W + sx) * C + c];
    }
    t.setImage(await sharp(data, { raw: info }).png().toBuffer()).setMimeType('image/png');
  }
  console.log('  tyre sidewalls cleared');
}

// ================= The bike =================
{
  const doc = await io.read('downloads/guzzi/moto_guzzi_v-twin.glb');
  await doc.transform(dequantize());
  const root = doc.getRoot();
  const parts = bake(doc);
  // The side stand is modelled down, on the ground: its leg comes off (the bracket stays), so the
  // bike is ridden with it up.
  for (const part of parts) {
    const s = take(doc, part, (v) => v[0] > -0.38 && v[0] < -0.23 && v[1] > -0.04 && v[1] < 0.185 && v[2] > -0.28 && v[2] < -0.11);
    if (s) console.log('  side stand off:', s.prim.getIndices().getCount() / 3, 'triangles');
  }
  // Axles from the tyres (one primitive holding both), the ground under them.
  const tyreV = verts(parts.filter((p) => p.mat === 'mat_backtyre001').map((p) => p.prim));
  const fb = bounds(tyreV.filter((v) => v[0] > 0)), rb = bounds(tyreV.filter((v) => v[0] < 0));
  const axF = [(fb.mn[0] + fb.mx[0]) / 2, (fb.mn[1] + fb.mx[1]) / 2], axR = [(rb.mn[0] + rb.mx[0]) / 2, (rb.mn[1] + rb.mx[1]) / 2];
  const tyreR = ((fb.mx[1] - fb.mn[1]) + (rb.mx[1] - rb.mn[1])) / 4;
  const groundY = Math.min(fb.mn[1], rb.mn[1]), midX = (axF[0] + axR[0]) / 2;
  // The steering axis, from the two fork tubes: their joint centre line (in the side view).
  const tubes = [];
  for (const part of parts) {
    if (part.mat !== 'engine_mat') continue;
    const p = part.prim, pos = p.getAttribute('POSITION'), piece = piecesOf(p), B = new Map(), v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const r = piece(i); if (!B.has(r)) B.set(r, []); B.get(r).push(v.slice()); }
    for (const pts of B.values()) { const b = bounds(pts); if (b.mn[0] > 0.28 && b.mx[0] < 0.74 && b.mn[1] > 0.24 && b.mx[1] < 0.88 && Math.abs((b.mn[2] + b.mx[2]) / 2) > 0.03 && Math.abs((b.mn[2] + b.mx[2]) / 2) < 0.12 && Math.hypot(b.mx[0] - b.mn[0], b.mx[1] - b.mn[1]) > 0.5) tubes.push(...pts); }
  }
  const c2 = [0, 1].map((k) => tubes.reduce((s, v) => s + v[k], 0) / tubes.length);
  let sxx = 0, sxy = 0, syy = 0; for (const v of tubes) { const a = v[0] - c2[0], b = v[1] - c2[1]; sxx += a * a; sxy += a * b; syy += b * b; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); let dir = [Math.cos(ang), Math.sin(ang)]; if (dir[1] < 0) dir = dir.map((x) => -x);
  console.log('  axles', axF.map((v) => +v.toFixed(3)), axR.map((v) => +v.toFixed(3)), 'tyre r', tyreR.toFixed(3), 'fork tubes', tubes.length, 'pts, rake', (Math.atan2(-dir[0], dir[1]) * 180 / Math.PI).toFixed(1), 'deg');

  // Into the game's frame: x' = -z, y' = y - ground, z' = x - midX (front is +z).
  const M = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, -groundY, -midX, 1];
  for (const p of parts) transformPrimitive(p.prim, M);
  const G = (x, y) => [x - midX, y - groundY]; // a side-view point into the game's (z, y)
  const [fz, fy] = G(...axF), [rz, ry] = G(...axR), [az, ay] = G(...c2), ad = [dir[0], dir[1]]; // axis point and direction (z, y)

  // Wheels.
  const wheel = { F: [], R: [] };
  for (const [k, cz, cy] of [['F', fz, fy], ['R', rz, ry]]) for (const part of [...parts]) {
    if (part.wheel || part.steer) continue;
    const w = take(doc, part, (v) => Math.abs(v[0]) < 0.11 && Math.hypot(v[1] - cy, v[2] - cz) < tyreR * 1.04);
    if (w) { w.wheel = k; parts.push(w); wheel[k].push(w.prim); }
  }
  // Steering: within 21 cm of the axis, ahead of the tank, but never the fairing, its lamp or screen.
  const near = (v) => { const dz = v[2] - az, dy = v[1] - ay; return Math.abs(dz * ad[1] - dy * ad[0]) < 0.21 && v[2] > G(0.2, 0)[0] && v[1] > 0.12; };
  const steerParts = [];
  for (const part of [...parts]) {
    if (part.wheel || part.steer || /tanknewlivery|headlight_glass|light_mat/.test(part.mat) || /headlight_5|glass_mesh/.test(part.names)) continue;
    const s = take(doc, part, near);
    if (s) { s.steer = true; parts.push(s); steerParts.push(s.prim); }
  }
  for (const m of root.listMaterials()) if (m.getName() === 'light_mat_exp') m.setName('lamp');
  await paintOut(doc);

  const scene = root.listScenes()[0];
  for (const n of scene.listChildren()) scene.removeChild(n);
  const body = doc.createMesh('body');
  for (const p of parts) if (!p.wheel && !p.steer && p.prim.getIndices().getCount()) body.addPrimitive(p.prim);
  scene.addChild(doc.createNode('body').setMesh(body));
  // The steering: on the axis, level with the top of the fork, its +z up the axis.
  const piv = [0, ay + ad[1] * 0.25, az + ad[0] * 0.25];
  const n = [0, ad[1], ad[0]]; // the axis in the game's frame (x, y, z)
  const ax = [-n[1], n[0], 0], sn = Math.hypot(...ax), cs = n[2], a2 = Math.atan2(sn, cs), u = sn > 1e-6 ? ax.map((x) => x / sn) : [1, 0, 0];
  const q = [...u.map((x) => x * Math.sin(a2 / 2)), Math.cos(a2 / 2)];
  const [x, y, z, w] = q, R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
  const t = [0, 1, 2].map((a) => -(R[0][a] * piv[0] + R[1][a] * piv[1] + R[2][a] * piv[2]));
  const Mx = [R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, t[0], t[1], t[2], 1];
  const sm = doc.createMesh('steer');
  for (const p of steerParts) { transformPrimitive(p, Mx); sm.addPrimitive(p); }
  scene.addChild(doc.createNode('steer').setMesh(sm).setTranslation(piv).setRotation(q).setExtras({ pivot: piv, axis: n }));
  for (const [k, ps] of Object.entries(wheel)) {
    const b = bounds(verts(ps)), c = [0, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2];
    const mesh = doc.createMesh('wheel_' + k);
    for (const p of ps) { transformPrimitive(p, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -c[0], -c[1], -c[2], 1]); mesh.addPrimitive(p); }
    scene.addChild(doc.createNode('wheel_' + k).setMesh(mesh).setTranslation(c));
    console.log('  wheel_' + k, c.map((v) => +v.toFixed(3)), 'r', ((b.mx[1] - b.mn[1]) / 2).toFixed(3), ps.length, 'parts');
  }
  console.log('  steer', piv.map((v) => +v.toFixed(3)), 'axis', n.map((v) => +v.toFixed(3)), steerParts.length, 'parts');
  await doc.transform(prune(), dedup(), weld(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 84 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write('public/models/car_bike.glb', doc);
  console.log('bike bytes', fs.statSync('public/models/car_bike.glb').size);
}

// ================= The helmet =================
{
  const doc = await io.read('downloads/helmet/moto_helmet.glb');
  await doc.transform(dequantize());
  const root = doc.getRoot();
  const parts = bake(doc);
  // The two side badges (a maker's bar-and-shield) come off: their own material.
  const scene = root.listScenes()[0];
  for (const n of scene.listChildren()) scene.removeChild(n);
  const keep = parts.filter((p) => !/Leather_Full_Grain_Black/.test(p.mat));
  console.log('  helmet: dropped', parts.length - keep.length, 'badge parts of', parts.length);
  // The badges sat on dark mounts printed into the leather on each side: covered with leather
  // copied from a clean stretch, grain and all.
  const leather = root.listMaterials().find((m) => /01_Leather/.test(m.getName()))?.getBaseColorTexture();
  if (leather) {
    const { data, info } = await sharp(leather.getImage()).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, C = info.channels, k = W / 4096, f = new Float32Array(data), src = Float32Array.from(data);
    const lum = (i) => 0.3 * src[i] + 0.59 * src[i + 1] + 0.11 * src[i + 2];
    const [gx, gy] = [2220 * k, 520 * k]; // clean leather, for the grain
    for (const [cx, cy, rx, ry] of [[2820, 1570, 190, 160], [2020, 3565, 195, 165]].map((e) => e.map((v) => v * k))) {
      const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
      const box = [cx - rx, cy - ry, cx + rx, cy + ry].map(Math.round);
      // Dark pixels take the clean leather's own pixels (grain and all), fully where darkest and
      // blending out by 110 in brightness, so the mount leaves no edge.
      for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) {
        const i = (y * W + x) * C; if (!inside(x, y)) continue;
        const w = Math.max(0, Math.min(1, (110 - lum(i)) / 45)); if (!w) continue;
        const j = (Math.round(gy + (y - cy) * 0.8) * W + Math.round(gx + (x - cx) * 0.8)) * C;
        for (let c = 0; c < 3; c++) f[i + c] = f[i + c] * (1 - w) + src[j + c] * w;
      }
    }
    leather.setImage(await sharp(Buffer.from(f.map((v) => Math.max(0, Math.min(255, Math.round(v))))), { raw: info }).png().toBuffer()).setMimeType('image/png');
    // The mounts are in its shading maps too (roughness, relief, shadow): filled in the same.
    const lm = root.listMaterials().find((m) => /01_Leather/.test(m.getName()));
    for (const t of new Set([lm.getMetallicRoughnessTexture(), lm.getNormalTexture(), lm.getOcclusionTexture()].filter(Boolean))) {
      const { data: d2, info: i2 } = await sharp(t.getImage()).raw().toBuffer({ resolveWithObject: true });
      const g = new Float32Array(d2), k2 = i2.width / 4096;
      for (const [cx, cy, rx, ry] of [[2820, 1570, 200, 170], [2020, 3565, 205, 175]].map((e) => e.map((v) => v * k2))) {
        fill(g, i2.width, i2.height, i2.channels, [cx - rx, cy - ry, cx + rx, cy + ry].map(Math.round), (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1);
      }
      t.setImage(await sharp(Buffer.from(g.map((v) => Math.max(0, Math.min(255, Math.round(v))))), { raw: i2 }).png().toBuffer()).setMimeType('image/png');
    }
    console.log('  helmet: badge mounts filled in');
  }
  // Centred on the shell (the leather), and sized to fit a head: 26 cm across the shell.
  const shell = bounds(verts(keep.filter((p) => /01_Leather/.test(p.mat)).map((p) => p.prim)));
  const c = shell.mn.map((v, i) => (v + shell.mx[i]) / 2), s = 0.26 / Math.min(shell.mx[0] - shell.mn[0], shell.mx[2] - shell.mn[2]);
  const mesh = doc.createMesh('helmet');
  // It comes turned 45 degrees: its goggles face (-x, +z). Turned to face +z.
  const k = Math.SQRT1_2, Ry = [k, 0, -k, 0, 0, 1, 0, 0, k, 0, k, 0, 0, 0, 0, 1];
  for (const p of keep) { transformPrimitive(p.prim, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -c[0] * s, -c[1] * s, -c[2] * s, 1]); transformPrimitive(p.prim, Ry); mesh.addPrimitive(p.prim); }
  scene.addChild(doc.createNode('helmet').setMesh(mesh));
  await doc.transform(prune(), dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.18, error: 0.002 }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 84 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write('public/models/helmet.glb', doc);
  console.log('helmet: shell scale', s.toFixed(4), 'bytes', fs.statSync('public/models/helmet.glb').size);
}
