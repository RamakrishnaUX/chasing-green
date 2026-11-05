// Prepare the cafe racer and its rider's helmet for the game: node tools/cars/bike.mjs
// Needs the same packages as process.mjs (not saved to package.json).
//
// The bike ("Cafe Racer" by Andrei Milin, CC BY 4.0) comes facing +x, all in one material, so it
// is cut up by shape:
// - turned to face +z with the tyres on y = 0 and the origin halfway between the axles;
// - each wheel is every piece (a run of triangles joined at their corners) lying wholly inside
//   a cylinder round its axle: tyre, rim, spokes, hub and disc;
// - the steering is every piece lying wholly within a slab round the steering axis: fork, clamps,
//   bars, levers, headlamp and indicators. It is saved as "steer", placed on the axis with its +z
//   along it, so the game turns it about z (and hangs the front wheel on it); the grips (the ends
//   of the bars) are kept on it for the rider's hands;
// - the headlamp's lens becomes a lamp of its own, so it shines at night.
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
// ================= The bike =================
// "Cafe Racer" by Andrei Milin (milinam2002), CC BY 4.0: a yellow-tanked cafe racer with a brown
// bench seat, flat bars and fat tyres, all in one material, at its true size (2.2 m long).
{
  const doc = await io.read('downloads/caferacer/cafe_racer.glb');
  await doc.transform(dequantize());
  const root = doc.getRoot();
  const parts = bake(doc);
  // Every piece's bounds, to find the tyres: the two pieces that stand on the ground.
  const tyres = [];
  for (const part of parts) {
    const p = part.prim, pos = p.getAttribute('POSITION'), piece = piecesOf(p), B = new Map(), v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const r = piece(i); if (!B.has(r)) B.set(r, []); B.get(r).push(v.slice()); }
    for (const pts of B.values()) { const b = bounds(pts); if (b.mn[1] < 0.02 && b.mx[1] - b.mn[1] > 0.5) tyres.push(b); }
  }
  if (tyres.length !== 2) throw new Error('expected two tyres, found ' + tyres.length);
  tyres.sort((a, b) => b.mx[0] - a.mx[0]);
  const ctr = (b) => b.mn.map((v, i) => (v + b.mx[i]) / 2);
  const [cF, cR] = tyres.map(ctr), tyreR = tyres.reduce((s, b) => s + (b.mx[1] - b.mn[1]) / 4, 0);
  const groundY = Math.min(...tyres.map((b) => b.mn[1])), midX = (cF[0] + cR[0]) / 2, midZ = (cF[2] + cR[2]) / 2;
  // The steering axis: through the middles of the lower and upper fork clamps (a 22 degree rake,
  // the front axle 5 cm ahead of it, as on a real fork).
  const A = [0.82, 0.805], Bp = [0.735, 1.015], dl = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), dir = [(Bp[0] - A[0]) / dl, (Bp[1] - A[1]) / dl];
  console.log('  axles', [cF, cR].map((c) => c.map((v) => +v.toFixed(3))), 'tyre r', tyreR.toFixed(3), 'rake', (Math.atan2(-dir[0], dir[1]) * 180 / Math.PI).toFixed(1));
  // Into the game's frame: x' = -(z - midZ), y' = y - ground, z' = x - midX (front is +z).
  const M = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, midZ, -groundY, -midX, 1];
  for (const p of parts) transformPrimitive(p.prim, M);
  const G = (x, y) => [x - midX, y - groundY]; // a side-view point (x, y) into the game's (z, y)
  const [fz, fy] = G(cF[0], cF[1]), [rz, ry] = G(cR[0], cR[1]), [az, ay] = G(...A), ad = [dir[0], dir[1]];
  // The headlamp's lens: the forward-facing triangles across the front of the lamp, made a lamp of
  // its own so it shines at night.
  const lamp = doc.createMaterial('lamp').setBaseColorFactor([1, 0.97, 0.9, 1]);
  for (const part of [...parts]) {
    const p = part.prim, pos = p.getAttribute('POSITION'), arr = p.getIndices().getArray(), a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], keep = [], moved = [];
    const [lz0, ly0] = G(0.94, 0.9), [lz1, ly1] = G(1.0, 1.08), lx0 = -(-0.21 - midZ), lx1 = -(-0.02 - midZ);
    for (let t = 0; t < arr.length; t += 3) {
      pos.getElement(arr[t], a); pos.getElement(arr[t + 1], b); pos.getElement(arr[t + 2], c);
      const m = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), len = Math.hypot((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz) || 1;
      const front = m[2] > lz0 && m[2] < lz1 && m[1] > ly0 && m[1] < ly1 && m[0] > Math.min(lx0, lx1) && m[0] < Math.max(lx0, lx1) && Math.abs(nz / len) > 0.6;
      (front ? moved : keep).push(arr[t], arr[t + 1], arr[t + 2]);
    }
    if (!moved.length) continue;
    const q = p.clone(); for (const s of q.listSemantics()) q.setAttribute(s, p.getAttribute(s).clone());
    q.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(moved)).setBuffer(p.getIndices().getBuffer())).setMaterial(lamp);
    p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(p.getIndices().getBuffer()));
    compactPrimitive(p); compactPrimitive(q); parts.push({ prim: q, names: part.names, mat: 'lamp' });
    console.log('  headlamp lens', moved.length / 3, 'triangles');
  }
  // Wheels.
  const wheel = { F: [], R: [] };
  for (const [k, cz, cy] of [['F', fz, fy], ['R', rz, ry]]) for (const part of [...parts]) {
    if (part.wheel || part.steer) continue;
    const w = take(doc, part, (v) => Math.abs(v[0]) < 0.11 && Math.hypot(v[1] - cy, v[2] - cz) < tyreR * 1.04);
    if (w) { w.wheel = k; parts.push(w); wheel[k].push(w.prim); }
  }
  // Steering: within 25 cm of the axis (fork, clamps, bars, levers, headlamp and indicators), ahead
  // of the tank.
  const near = (v) => { const dz = v[2] - az, dy = v[1] - ay; return Math.abs(dz * ad[1] - dy * ad[0]) < 0.25 && v[2] > G(0.5, 0)[0] && v[1] > 0.15; };
  const steerParts = [];
  for (const part of [...parts]) {
    if (part.wheel || part.steer) continue;
    const s = take(doc, part, near);
    if (s) { s.steer = true; parts.push(s); steerParts.push(s.prim); }
  }
  // The grips, for the rider's hands. They are the outer ends of the handlebar itself (the widest
  // piece in the steering, spanning the bike): on each side, its last 13 cm, as a middle and a line
  // pointing outward. (The flat levers in front of them run across the bike too, but are not the
  // bar.) Left is +x.
  let bar = null;
  for (const p of steerParts) {
    const pos = p.getAttribute('POSITION'), piece = piecesOf(p), B = new Map(), v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const r = piece(i); if (!B.has(r)) B.set(r, []); B.get(r).push(v.slice()); }
    for (const pts of B.values()) { const b = bounds(pts); if (!bar || b.mx[0] - b.mn[0] > bar.w) bar = { w: b.mx[0] - b.mn[0], pts, b }; }
  }
  const grips = {};
  for (const [side, sg] of [['Left', 1], ['Right', -1]]) {
    const end = sg > 0 ? bar.b.mx[0] : bar.b.mn[0], pts = bar.pts.filter((v) => (v[0] - end) * -sg < 0.13);
    const b = bounds(pts);
    grips[side] = { c: b.mn.map((v, k) => (v + b.mx[k]) / 2), axis: [sg, 0, 0] };
    console.log('  grip', side, grips[side].c.map((v) => +v.toFixed(3)), 'bar', bar.w.toFixed(3), 'across, thickness', (b.mx[1] - b.mn[1]).toFixed(3));
  }

  const scene = root.listScenes()[0];
  for (const n of scene.listChildren()) scene.removeChild(n);
  const body = doc.createMesh('body');
  for (const p of parts) if (!p.wheel && !p.steer && p.prim.getIndices().getCount()) body.addPrimitive(p.prim);
  scene.addChild(doc.createNode('body').setMesh(body));
  // The steering: on the axis, level with the top clamp, its +z up the axis.
  const piv = [0, ...G(...Bp).reverse()];
  const n = [0, ad[1], ad[0]];
  const ax = [-n[1], n[0], 0], sn = Math.hypot(...ax), cs = n[2], a2 = Math.atan2(sn, cs), u = sn > 1e-6 ? ax.map((x) => x / sn) : [1, 0, 0];
  const q = [...u.map((x) => x * Math.sin(a2 / 2)), Math.cos(a2 / 2)];
  const [x, y, z, w] = q, R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
  const t = [0, 1, 2].map((a) => -(R[0][a] * piv[0] + R[1][a] * piv[1] + R[2][a] * piv[2]));
  const Mx = [R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, t[0], t[1], t[2], 1];
  const sm = doc.createMesh('steer');
  for (const p of steerParts) { transformPrimitive(p, Mx); sm.addPrimitive(p); }
  // Grips are kept in the bike's frame (with the bars straight), with the pivot.
  scene.addChild(doc.createNode('steer').setMesh(sm).setTranslation(piv).setRotation(q).setExtras({ pivot: piv, axis: n, grips }));
  for (const [k, ps] of Object.entries(wheel)) {
    const b = bounds(verts(ps)), c = [0, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2];
    const mesh = doc.createMesh('wheel_' + k);
    for (const p of ps) { transformPrimitive(p, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -c[0], -c[1], -c[2], 1]); mesh.addPrimitive(p); }
    scene.addChild(doc.createNode('wheel_' + k).setMesh(mesh).setTranslation(c));
    console.log('  wheel_' + k, c.map((v) => +v.toFixed(3)), 'r', ((b.mx[1] - b.mn[1]) / 2).toFixed(3), ps.length, 'parts');
  }
  console.log('  steer', piv.map((v) => +v.toFixed(3)), 'axis', n.map((v) => +v.toFixed(3)), steerParts.length, 'parts');
  await doc.transform(prune(), dedup(), weld(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 84 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
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
