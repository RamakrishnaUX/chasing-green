// Clean a downloaded animal for the game: node tools/animals/process.mjs <name>, with its settings
// in models.json: { src, out, drop: regex of meshes to remove, clips: {newName: oldName},
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
  for (const a of root.listAnimations()) { if (want.has(a.getName())) a.setName(want.get(a.getName())); else a.dispose(); }
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
  resample(), prune(), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [C.tex || 1024, C.tex || 1024], quality: 82 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
for (const mesh of root.listMeshes()) log(' ', mesh.getName(), mesh.listPrimitives().map((p) => (p.getIndices() ? p.getIndices().getCount() / 3 : 0) + 't').join(','));
log('clips', root.listAnimations().map((a) => a.getName()).join(','), '| tex', root.listTextures().map((t) => t.getSize().join('x')).join(','));
await io.write(C.out, doc);
log('size', (fs.statSync(C.out).size / 1e6).toFixed(2) + 'MB');
