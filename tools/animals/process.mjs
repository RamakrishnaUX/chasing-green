// Clean a downloaded animal for the game: node tools/animals/process.mjs <name>, with its settings
// in models.json: { src, out, drop: regex of meshes to remove, clips: {newName: oldName}, texN: normal map size, paintMask: material to build a paint mask for, animTol: keyframe tolerance, level: meshopt level,
// ratio: {meshRegex: r}, lod: r, lodSkip: regex, error, join: weld a scan's chunks into one mesh,
// tex: max texture size, normals: keep normal maps }. Needs, not saved to package.json:
// npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp@0.33
// Drops unused bones and still tracks, slims the meshes, adds a low-poly copy of each mesh for
// far-away instances (name suffix "_lod"), shrinks textures to WebP, and writes one compressed GLB.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplifyPrimitive, textureCompress, meshopt, resample, joinPrimitives, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import { weldQuantized, smoothNormals } from './weldq.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./models.json', import.meta.url), 'utf8'))[process.argv[2]];
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(C.src);
const root = doc.getRoot();
const log = (...a) => console.log(...a);

// Meshes we do not want (saddles, teeth, bubbles...).
if (C.drop) for (const node of root.listNodes()) { const m = node.getMesh(); if (m && new RegExp(C.drop).test(m.getName() + ' ' + node.getName())) { node.setMesh(null); } }
// Spec-gloss and fancy extensions to plain base colour.
for (const mat of root.listMaterials()) {
  const sg = mat.getExtension('KHR_materials_pbrSpecularGlossiness');
  if (sg) { mat.setBaseColorTexture(sg.getDiffuseTexture()); mat.setBaseColorFactor(sg.getDiffuseFactor()); mat.setMetallicFactor(0); mat.setRoughnessFactor(0.85); }
  for (const e of mat.listExtensions()) { mat.setExtension(e.extensionName, null); e.dispose(); }
  if (!C.normals) mat.setNormalTexture(null);
  mat.setEmissiveTexture(null); mat.setEmissiveFactor([0, 0, 0]); mat.setMetallicRoughnessTexture(null); mat.setOcclusionTexture(null);
  mat.setMetallicFactor(0); mat.setRoughnessFactor(Math.max(0.5, mat.getRoughnessFactor()));
}
// Clips: keep and rename the ones we use.
if (C.clips) {
  const want = new Map(Object.entries(C.clips).map(([k, v]) => [v, k]));
  for (const a of root.listAnimations()) { if (want.has(a.getName())) a.setName(want.get(a.getName())); else { for (const c of a.listChannels()) c.dispose(); for (const sm of a.listSamplers()) { sm.getInput()?.dispose(); sm.getOutput()?.dispose(); sm.dispose(); } a.dispose(); } }
}
await doc.transform(prune());

// Bones: keep those that carry weight, and their parents.
for (const skin of root.listSkins()) {
  const joints = skin.listJoints();
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  const prims = [];
  for (const node of root.listNodes()) if (node.getSkin() === skin && node.getMesh()) prims.push(...node.getMesh().listPrimitives());
  const keep = new Set(), j4 = [], w4 = [];
  for (const p of prims) { const J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); if (!J) continue;
    for (let i = 0; i < J.getCount(); i++) { J.getElement(i, j4); W.getElement(i, w4); for (let k = 0; k < 4; k++) if (w4[k] > 0) keep.add(joints[j4[k]]); } }
  // Unskinned meshes hanging off a bone (antlers) keep that bone.
  for (const n of root.listNodes()) if (n.getMesh() && !n.getSkin()) { let p = parentOf.get(n); while (p) { if (joints.includes(p)) keep.add(p); p = parentOf.get(p); } }
  for (const j of [...keep]) { let p = parentOf.get(j); while (p && joints.includes(p)) { keep.add(p); p = parentOf.get(p); } }
  const kept = joints.filter((j) => keep.has(j));
  if (kept.length === joints.length) { log('bones', joints.length); continue; }
  const remap = joints.map((j) => kept.indexOf(j));
  const ibm = skin.getInverseBindMatrices(), old = ibm.getArray(), nu = new Float32Array(kept.length * 16);
  kept.forEach((j, i) => { const o = joints.indexOf(j) * 16; nu.set(old.subarray(o, o + 16), i * 16); });
  ibm.setArray(nu);
  for (const j of joints) skin.removeJoint(j);
  for (const j of kept) skin.addJoint(j);
  const done = new Set();
  for (const p of prims) { const J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); if (!J || done.has(J)) continue; done.add(J);
    for (let i = 0; i < J.getCount(); i++) { J.getElement(i, j4); W.getElement(i, w4); for (let k = 0; k < 4; k++) j4[k] = w4[k] > 0 ? remap[j4[k]] : 0; J.setElement(i, j4); } }
  for (const j of joints) if (!keep.has(j) && !j.listChildren().some((c) => keep.has(c))) j.dispose();
  log('bones', joints.length, '->', kept.length);
}
// Still tracks: fold into the rest pose when every clip agrees, then drop.
const anims = root.listAnimations();
const constOf = (ch) => { const o = ch.getSampler().getOutput().getArray(), n = ch.getSampler().getOutput().getElementSize();
  for (let i = n; i < o.length; i++) if (Math.abs(o[i] - o[i % n]) > 1e-4) return null; return Array.from(o.subarray(0, n)); };
const byTarget = new Map();
for (const a of anims) for (const ch of a.listChannels()) {
  if (!ch.getTargetNode()) { ch.dispose(); continue; }
  const k = ch.getTargetNode(); if (!byTarget.has(k)) byTarget.set(k, {});
  const t = byTarget.get(k); (t[ch.getTargetPath()] ||= []).push(ch);
}
let dropC = 0, keptC = 0;
for (const [node, paths] of byTarget) for (const [path, chs] of Object.entries(paths)) {
  const vals = chs.map(constOf);
  if (chs.length === anims.length && vals.every((v) => v && v.every((x, i) => Math.abs(x - vals[0][i]) < 1e-4))) {
    if (path === 'rotation') node.setRotation(vals[0]); else if (path === 'translation') node.setTranslation(vals[0]); else if (path === 'scale') node.setScale(vals[0]);
    for (const c of chs) c.dispose(); dropC += chs.length;
  } else keptC += chs.length;
}
if (anims.length) log('tracks dropped', dropC, 'kept', keptC);
// Their keyframes too: a dropped track's sampler (and its data) would otherwise stay in the file.
for (const a of root.listAnimations()) { const live = new Set(a.listChannels().map((c) => c.getSampler())); for (const sm of a.listSamplers()) if (!live.has(sm)) { const i = sm.getInput(), o = sm.getOutput(); sm.dispose(); if (o && !o.listParents().some((p) => p !== root)) o.dispose(); if (i && !i.listParents().some((p) => p !== root)) i.dispose(); } }

for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) for (const s of p.listSemantics()) if (/TEXCOORD_[1-9]|COLOR_|TANGENT/.test(s)) p.setAttribute(s, null);
// Scans split into chunks: one primitive, welded by position and UV, with smooth normals.
if (C.join) for (const node of root.listNodes()) {
  const meshes = root.listNodes().filter((n) => n.getMesh() && n.getSkin() === node.getSkin() && (n.getSkin() || n.getParentNode() === node.getParentNode()));
  if (meshes.length < 2 || meshes[0] !== node) continue;
  const prims = meshes.map((n) => n.getMesh().listPrimitives()[0]);
  for (const p of prims) p.setAttribute('NORMAL', null);
  const joined = joinPrimitives(prims);
  log('welded to', weldQuantized(doc, joined, C.weldq || {}), 'verts'); smoothNormals(doc, joined);
  const m = doc.createMesh(node.getMesh().getName()).addPrimitive(joined); node.setMesh(m);
  for (const n of meshes.slice(1)) n.setMesh(null);
}
await doc.transform(prune(), dedup(), ...(C.join ? [] : [weld()]));
// A paint coat (paintMask: material name): a mask the game recolours by, stored in the material's
// occlusion slot (the game reads it itself; there is no baked occlusion). Red: shading, the
// texture's brightness against the typical brightness of what is there (coat or white patch), over
// two; green: white patch; blue: bare skin (pink: muzzle, gums), which keeps its own colour. Along
// the edge of a patch the texture is part one, part the other: the shading there is filled in
// from either side, so no line shows when the coat is recoloured solid.
if (C.paintMask) {
  const mat = root.listMaterials().find((m) => m.getName() === C.paintMask), tex = mat.getBaseColorTexture();
  const N = 1024, { data } = await sharp(Buffer.from(tex.getImage())).resize(N, N).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const L = new Float32Array(N * N), Wm = new Float32Array(N * N), Km = new Float32Array(N * N);
  const coat = [], white = [];
  for (let i = 0; i < N * N; i++) {
    const r = lin(data[i * 3]), g = lin(data[i * 3 + 1]), b = lin(data[i * 3 + 2]), l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), sat = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
    L[i] = l; Wm[i] = (1 - sm(0.16, 0.3, sat)) * sm(0.05, 0.12, l); Km[i] = sm(0.004, 0.03, b - g) * sm(0.06, 0.14, l);
    if (l > 0.01 && Km[i] < 0.5) (Wm[i] > 0.5 ? white : coat).push(l);
  }
  const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1] || 0.3; };
  const ref = med(coat), refW = med(white);
  const S = new Float32Array(N * N), edge = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) S[i] = L[i] / (ref + (refW - ref) * Wm[i]);
  // The edge band: anywhere within 3 px of a change between coat and patch, or itself in between.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, w = Wm[i] > 0.5;
    let e = Wm[i] > 0.15 && Wm[i] < 0.85;
    for (let dy = -3; dy <= 3 && !e; dy++) for (let dx = -3; dx <= 3 && !e; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < N && yy < N && (Wm[yy * N + xx] > 0.5) !== w) e = true; }
    edge[i] = e ? 1 : 0;
  }
  // Fill the band from the shading around it (a blur that counts only pixels outside the band).
  const R = 6, out = S.slice();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x; if (!edge[i]) continue;
    let s = 0, n = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const j = yy * N + xx; if (edge[j]) continue; const k = Math.exp(-(dx * dx + dy * dy) / (R * R * 0.5)); s += S[j] * k; n += k; }
    if (n > 0) out[i] = s / n;
  }
  const px = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) { px[i * 3] = Math.round(Math.min(1, out[i] / 2) * 255); px[i * 3 + 1] = Math.round(Wm[i] * 255); px[i * 3 + 2] = Math.round(Km[i] * 255); }
  const png = await sharp(px, { raw: { width: N, height: N, channels: 3 } }).png().toBuffer();
  const mask = doc.createTexture('paintMask').setImage(new Uint8Array(png)).setMimeType('image/png');
  mat.setOcclusionTexture(mask);
  log('paint mask: coat', ref.toFixed(3), 'white', refW.toFixed(3), 'edge px', edge.reduce((a, b) => a + b, 0));
}
// Slim each mesh, and add the low-poly copy.
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) if (!p.getIndices()) weldPrimitive(p, {});
const ratioOf = (name) => { for (const [re, r] of Object.entries(C.ratio || {})) if (new RegExp(re).test(name)) return r; return 1; };
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh || /_lod$/.test(mesh.getName())) continue;
  const r = ratioOf(mesh.getName());
  for (const p of mesh.listPrimitives()) { if (r < 1) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: r, error: C.error || 0.002, lockBorder: false }); }
  if (C.lod && !(C.lodSkip && new RegExp(C.lodSkip).test(mesh.getName()))) {
    const lm = doc.createMesh(mesh.getName() + '_lod');
    for (const p of mesh.listPrimitives()) { const q = p.clone(); for (const s of q.listSemantics()) q.setAttribute(s, p.getAttribute(s).clone()); q.setIndices(p.getIndices().clone());
      simplifyPrimitive(q, { simplifier: MeshoptSimplifier, ratio: C.lod / Math.max(r, 0.01), error: 0.02, lockBorder: false }); lm.addPrimitive(q); }
    const ln = doc.createNode(node.getName() + '_lod').setMesh(lm).setSkin(node.getSkin()).setMatrix(node.getMatrix());
    (node.getParentNode() || root.listScenes()[0]).addChild(ln);
  }
}
await doc.transform(
  resample({ tolerance: C.animTol || 1e-4 }), prune(), dedup(),
  // texN: a smaller size for normal maps (fine detail that holds up at half the colour's size).
  ...(C.texN ? [textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /normal/, resize: [C.texN, C.texN], quality: 82 })] : []),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [C.tex || 1024, C.tex || 1024], quality: 82 }),
  meshopt({ encoder: MeshoptEncoder, level: C.level || 'medium' }),
);
for (const mesh of root.listMeshes()) log(' ', mesh.getName(), mesh.listPrimitives().map((p) => (p.getIndices() ? p.getIndices().getCount() / 3 : 0) + 't').join(','));
log('clips', root.listAnimations().map((a) => a.getName()).join(','), '| tex', root.listTextures().map((t) => t.getSize().join('x')).join(','));
await io.write(C.out, doc);
log('size', (fs.statSync(C.out).size / 1e6).toFixed(2) + 'MB');
