// Prepare a car from Sketchfab for the game: node tools/cars/process.mjs <kind>
// Bakes every part into one car-sized model facing +z, with its wheels as four separate nodes
// (wheel_FL, wheel_FR, wheel_RL, wheel_RR, each centred on its axle) so the game can spin and
// steer them, the ground under the tyres at y = 0 and the origin halfway between the axles.
// Headlamp and tail-lamp materials are renamed "lamp" and "tail" so the game can light them.
// Wheels come either from the model's own wheel parts (by node name) or, where they are merged
// into the chassis, are cut out of it: every triangle within a wheel's radius of its axle.
// Needs, not saved to package.json:
// npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp@0.33
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, dequantize, transformPrimitive, weld, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

const CARS = {
  // "Fictional supercar - V12 Goblin" by ollitei (CC BY 4.0).
  // Its green lived in a Sketchfab-only clear-coat shell: painted orange here, as the game's supercar.
  race: { src: 'downloads/goblin/scene.gltf', length: 4.55, drop: /shadow|clearcoat/i, paint: { re: /car_body/, color: [1, 0.3, 0.02], metal: 0.55, diffuse: 'downloads/goblin/textures/car_body_diffuse.png', spec: 'downloads/goblin/textures/car_body_specularGlossiness.png' },
    wheels: { FL: /rotation_FL/, FR: /rotation_FR/, RL: /rotation_BL/, RR: /rotation_BR/ },
    // Its lamp lenses are part of the glass.
    split: [{ mat: /car_glass/, box: { min: [-1.2, 0, 1.7], max: [1.2, 0.75, 3] }, to: 'lamp' }, { mat: /car_glass/, box: { min: [-1.2, 0, -3], max: [1.2, 0.95, -1.6] }, to: 'tail' }] },
  // "Retro Car" by pisarenok (CC BY 4.0), after a 1930s Lincoln. The two spares on the wings stay put.
  vintage: { src: 'downloads/retro/scene.glb', length: 5.0, lamps: /^Fars/,
    wheels: { FL: /Wheel(_Center)?_1_low/, FR: /Wheel(_Center)?_6_low/, RL: /Wheel(_Center)?_3_low/, RR: /Wheel(_Center)?_4_low/ },
    // The lenses of the two round lamps on stalks at the back.
    split: [{ mat: /Lincoln1/, box: { min: [0.46, 0.77, -2.34], max: [0.64, 0.94, -2.27] }, to: 'tail' }, { mat: /Lincoln1/, box: { min: [-0.64, 0.77, -2.34], max: [-0.46, 0.94, -2.27] }, to: 'tail' }] },
  // "Volkswagen Kombi Micro Bus" by winterborn (CC BY 4.0). Its wheels are part of the chassis.
  camper: { src: 'downloads/kombi/scene.glb', length: 4.28, lamps: /headlight/i,
    cut: { radius: 1.42, width: 1.3, centres: { FL: [2.81, 4.42], FR: [-2.81, 4.42], RL: [2.81, -5.1], RR: [-2.81, -5.1] } },
    // Front and rear lamps share one glass; the rear ones turn red. The maker's badge on the nose comes off.
    split: [{ mat: /^lamp$/, box: { min: [-2, -1, -3], max: [2, 3, 0] }, to: 'tail' }],
    strip: [{ min: [-0.16, 0.76, 1.9], max: [0.16, 1.08, 2.06] }] },
};
const kind = process.argv[2];
const C = CARS[kind];
if (!C) { console.log('kinds:', Object.keys(CARS).join(', ')); process.exit(1); }

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(C.src);
await doc.transform(dequantize());
const root = doc.getRoot();

// Every part, baked into world space, each with the names of the nodes above it.
const parts = [];
const chain = (n) => { const out = []; for (let p = n; p; p = p.getParentNode?.()) out.push(p.getName()); return out.join(' '); };
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const names = chain(node);
  if (C.drop && C.drop.test(names)) continue;
  for (const p of mesh.listPrimitives()) {
    const q = p.clone();
    for (const s of q.listSemantics()) q.setAttribute(s, p.getAttribute(s).clone());
    if (p.getIndices()) q.setIndices(p.getIndices().clone());
    for (const s of q.listSemantics()) if (/TEXCOORD_[1-9]|COLOR_|TANGENT|JOINTS|WEIGHTS/.test(s)) q.setAttribute(s, null);
    transformPrimitive(q, node.getWorldMatrix());
    parts.push({ prim: q, names });
  }
}

// Wheels: by name, or cut out of the chassis around each axle.
const wheelOf = {};
if (C.wheels) {
  for (const part of parts) for (const [k, re] of Object.entries(C.wheels)) if (re.test(part.names)) { (wheelOf[k] ||= []).push(part.prim); part.wheel = k; }
} else {
  const { radius, width, centres } = C.cut;
  const y0 = Math.min(...parts.map((pt) => { const a = pt.prim.getAttribute('POSITION'); let m = Infinity; const v = []; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); m = Math.min(m, v[1]); } return m; }));
  for (const part of [...parts]) {
    const p = part.prim, pos = p.getAttribute('POSITION'), idx = p.getIndices();
    if (!idx) continue;
    const arr = idx.getArray(), keep = [], into = Object.fromEntries(Object.keys(centres).map((k) => [k, []]));
    const v = [0, 0, 0], c = [0, 0, 0];
    for (let t = 0; t < arr.length; t += 3) {
      c[0] = c[1] = c[2] = 0;
      for (let j = 0; j < 3; j++) { pos.getElement(arr[t + j], v); c[0] += v[0] / 3; c[1] += v[1] / 3; c[2] += v[2] / 3; }
      let hit = null;
      for (const [k, [x, z]] of Object.entries(centres)) if (Math.abs(c[0] - x) < width / 2 && Math.hypot(c[1] - (y0 + radius), c[2] - z) < radius * 1.08) hit = k;
      (hit ? into[hit] : keep).push(arr[t], arr[t + 1], arr[t + 2]);
    }
    if (keep.length === arr.length) continue;
    for (const [k, list] of Object.entries(into)) {
      if (!list.length) continue;
      const w = p.clone();
      for (const sem of w.listSemantics()) w.setAttribute(sem, p.getAttribute(sem).clone()); // its own copy: it moves apart from the body
      w.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(idx.getBuffer()));
      parts.push({ prim: w, names: part.names, wheel: k }); (wheelOf[k] ||= []).push(w);
    }
    p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(idx.getBuffer()));
  }
  // Each piece keeps only the vertices it uses.
  for (const part of parts) compactPrimitive(part.prim);
}
for (const k of ['FL', 'FR', 'RL', 'RR']) if (!wheelOf[k]?.length) throw new Error('no wheel ' + k);

// Bounds of a set of primitives.
const bounds = (prims) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], v = []; for (const p of prims) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], v[j]); mx[j] = Math.max(mx[j], v[j]); } } } return { mn, mx }; };
const centre = (b) => b.mn.map((v, i) => (v + b.mx[i]) / 2);
const all = bounds(parts.map((p) => p.prim));
const wc = Object.fromEntries(Object.entries(wheelOf).map(([k, ps]) => { const b = bounds(ps); return [k, { c: centre(b), r: (b.mx[1] - b.mn[1]) / 2 }]; }));
// Front is +z when the front axle has the larger z; otherwise turn it round.
const flip = wc.FL.c[2] < wc.RL.c[2] ? -1 : 1;
const s = C.length / (all.mx[2] - all.mn[2]);
const r = (wc.FL.r + wc.RL.r) / 2;
const midX = (wc.FL.c[0] + wc.FR.c[0]) / 2, midZ = (wc.FL.c[2] + wc.RL.c[2]) / 2, groundY = (wc.FL.c[1] + wc.RL.c[1]) / 2 - r;
// x' = flip (x - midX) s, y' = (y - groundY) s, z' = flip (z - midZ) s
const M = [flip * s, 0, 0, 0, 0, s, 0, 0, 0, 0, flip * s, 0, -flip * s * midX, -s * groundY, -flip * s * midZ, 1];
for (const p of parts) transformPrimitive(p.prim, M);

// Lamps.
for (const m of root.listMaterials()) { if (C.lamps?.test(m.getName())) m.setName('lamp'); else if (C.tails?.test(m.getName())) m.setName('tail'); }

// The triangles of a body part, each with its centre on the finished car.
const eachTri = (p, fn) => { const pos = p.getAttribute('POSITION'), arr = p.getIndices().getArray(), v = [0, 0, 0], c = [0, 0, 0]; for (let t = 0; t < arr.length; t += 3) { c[0] = c[1] = c[2] = 0; for (let j = 0; j < 3; j++) { pos.getElement(arr[t + j], v); c[0] += v[0] / 3; c[1] += v[1] / 3; c[2] += v[2] / 3; } fn(t, c); } };
const setTris = (p, list) => p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(p.getIndices().getBuffer()));
const inBox = (c, b) => c.every((v, i) => v >= b.min[i] && v <= b.max[i]);
// Lamp lenses that share a material with something else (glass, or the front and rear lamps
// together) move to a "lamp" or "tail" material of their own, chosen by where they sit.
for (const S of C.split || []) for (const part of [...parts]) {
  const p = part.prim;
  if (part.wheel || !p.getIndices() || !S.mat.test(p.getMaterial()?.getName() || '')) continue;
  const arr = p.getIndices().getArray(), keep = [], moved = [];
  eachTri(p, (t, c) => (inBox(c, S.box) ? moved : keep).push(arr[t], arr[t + 1], arr[t + 2]));
  if (!moved.length) continue;
  const q = p.clone();
  for (const sem of q.listSemantics()) q.setAttribute(sem, p.getAttribute(sem).clone());
  // (Coloured, so the two new materials are not merged as duplicates.)
  setTris(q, moved).setMaterial(doc.createMaterial(S.to).setBaseColorFactor(S.to === 'tail' ? [0.6, 0.05, 0.05, 1] : [1, 0.97, 0.9, 1])); setTris(p, keep);
  compactPrimitive(p); compactPrimitive(q);
  parts.push({ prim: q, names: part.names });
}
// Badges: pieces of the body (runs of triangles joined at their corners) that lie wholly inside
// a box are taken off.
for (const b of C.strip || []) for (const part of parts) {
  const p = part.prim;
  if (part.wheel || !p.getIndices()) continue;
  const pos = p.getAttribute('POSITION'), arr = p.getIndices().getArray(), v = [0, 0, 0];
  const key = [], up = new Map();
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const k = v.map((x) => x.toFixed(4)).join(); key.push(k); up.set(k, k); }
  const find = (a) => { while (up.get(a) !== a) { up.set(a, up.get(up.get(a))); a = up.get(a); } return a; };
  for (let t = 0; t < arr.length; t += 3) { const a = find(key[arr[t]]); up.set(find(key[arr[t + 1]]), a); up.set(find(key[arr[t + 2]]), a); }
  const outside = new Set();
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); if (!inBox(v, b)) outside.add(find(key[i])); }
  const keep = [];
  for (let t = 0; t < arr.length; t += 3) if (outside.has(find(key[arr[t]]))) keep.push(arr[t], arr[t + 1], arr[t + 2]);
  if (keep.length < arr.length) { console.log('  stripped', (arr.length - keep.length) / 3, 'triangles'); setTris(p, keep); compactPrimitive(p); }
}

// The new car: one body, four wheels.
const scene = root.listScenes()[0];
for (const n of scene.listChildren()) scene.removeChild(n);
const body = doc.createMesh('body');
for (const p of parts) if (!p.wheel) body.addPrimitive(p.prim);
scene.addChild(doc.createNode('body').setMesh(body));
for (const [k, ps] of Object.entries(wheelOf)) {
  const b = bounds(ps), c = centre(b);
  const mesh = doc.createMesh('wheel_' + k);
  for (const p of ps) { transformPrimitive(p, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -c[0], -c[1], -c[2], 1]); mesh.addPrimitive(p); }
  scene.addChild(doc.createNode('wheel_' + k).setMesh(mesh).setTranslation(c));
  console.log(' ', 'wheel_' + k, c.map((v) => +v.toFixed(3)), 'r', ((b.mx[1] - b.mn[1]) / 2).toFixed(3));
}
// Spec-gloss to metal-rough: the diffuse colour and texture become the base colour, the gloss the
// roughness, and see-through diffuse (glass) stays see-through.
for (const m of root.listMaterials()) {
  const e = m.getExtension('KHR_materials_pbrSpecularGlossiness');
  if (e) {
    m.setBaseColorTexture(e.getDiffuseTexture()); m.setBaseColorFactor(e.getDiffuseFactor());
    m.setMetallicFactor(0); m.setRoughnessFactor(1 - e.getGlossinessFactor() * 0.7); m.setMetallicRoughnessTexture(null);
    if (e.getDiffuseFactor()[3] < 0.99) m.setAlphaMode('BLEND');
    m.setExtension(e.extensionName, null);
  }
}
// Paint. In a spec-gloss model metallic paint has a black diffuse and its colour in the specular
// map, so the paint is found there: where the specular is strong and the diffuse dark, the base
// colour becomes the paint and the surface metallic; elsewhere the diffuse stays. Roughness
// comes from the gloss.
for (const m of root.listMaterials()) {
  if (!C.paint?.re.test(m.getName()) || !C.paint.spec) continue;
  const dif = await sharp(fs.readFileSync(C.paint.diffuse)).resize(2048, 1024).ensureAlpha().raw().toBuffer();
  const spec = await sharp(fs.readFileSync(C.paint.spec)).resize(2048, 1024).ensureAlpha().raw().toBuffer();
  const base = Buffer.alloc(2048 * 1024 * 3), mr = Buffer.alloc(2048 * 1024 * 3);
  const [pr, pg, pb] = C.paint.color.map((c) => Math.round(Math.pow(c, 1 / 2.2) * 255));
  for (let i = 0, j = 0; i < dif.length; i += 4, j += 3) {
    const ls = (spec[i] + spec[i + 1] + spec[i + 2]) / 765, ld = (dif[i] + dif[i + 1] + dif[i + 2]) / 765;
    const k = Math.max(0, Math.min(1, (ls - 0.12) / 0.12)) * (ld < 0.12 ? 1 : 0);
    const shade = 0.75 + 0.25 * Math.min(1, ls / 0.4);
    base[j] = dif[i] + (pr * shade - dif[i]) * k; base[j + 1] = dif[i + 1] + (pg * shade - dif[i + 1]) * k; base[j + 2] = dif[i + 2] + (pb * shade - dif[i + 2]) * k;
    mr[j] = 255; mr[j + 1] = Math.round(255 * (1 - (spec[i + 3] / 255) * 0.85)); mr[j + 2] = Math.round(255 * k * C.paint.metal);
  }
  const png = (b) => sharp(b, { raw: { width: 2048, height: 1024, channels: 3 } }).png().toBuffer();
  m.getBaseColorTexture().setImage(await png(base)).setMimeType('image/png');
  m.setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(1).setRoughnessFactor(1);
  m.setMetallicRoughnessTexture(doc.createTexture('paint_mr').setImage(await png(mr)).setMimeType('image/png'));
}

await doc.transform(prune(), dedup(), weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 84 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const out = `public/models/car_${kind}.glb`;
await io.write(out, doc);
const fin = bounds(body.listPrimitives());
console.log(kind, 'flip', flip, 'scale', s.toFixed(4), 'size', fin.mx.map((v, i) => +(v - fin.mn[i]).toFixed(2)), 'bytes', fs.statSync(out).size);
