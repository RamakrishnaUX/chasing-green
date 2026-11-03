// Prepare the helicopter for the game: node tools/heli/process.mjs
// Source: "Elicopter SMURD Romania" by solid3DDD (CC BY 4.0), downloaded to downloads/heli.
// Run livery.mjs first (it writes downloads/heli/body_clean.png without the agency markings).
// Keeps the moving parts as their own nodes (blade_0 the main rotor, blade_tail_2 the
// Fenestron fan, doors), slims each mesh, keeps the PBR maps at sizes that suit how close
// each part is seen, and writes public/models/heli.glb. Needs, not saved to package.json:
// npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp@0.33
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplifyPrimitive, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('downloads/heli/scene.gltf');
const root = doc.getRoot();

// The clean livery.
for (const t of root.listTextures()) if (/BODY_baseColor/.test(t.getURI())) t.setImage(fs.readFileSync('downloads/heli/body_clean.png'));
for (const t of root.listTextures()) t.setName(t.getURI().replace(/^.*\//, '').replace(/\.\w+$/, ''));

for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) for (const s of p.listSemantics()) if (/TEXCOORD_[1-9]|COLOR_|TANGENT/.test(s)) p.setAttribute(s, null);
await doc.transform(prune(), dedup(), weld());

// How much of each mesh to keep, by the name of the node above it.
const RATIO = [[/^blade_0/, 0.35], [/^blade_tail/, 0.5], [/^BODY/, 0.5], [/^glass/, 0.6], [/^spot/, 0.4], [/^turbine/, 0.5], [/^door/, 0.6]];
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const owner = node.getParentNode()?.getName() || node.getName();
  const r = RATIO.find(([re]) => re.test(owner))?.[1] ?? 1;
  if (r < 1) for (const p of mesh.listPrimitives()) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: r, error: 0.0015, lockBorder: true });
}

// Textures: the body is seen close and large; the frame and cabin less so.
const SIZE = { BODY_baseColor: 2048, BODY_normal: 1024, BODY_metallicRoughness: 512, interior_baseColor: 2048, interior_normal: 1024, interior_metallicRoughness: 512, frame_baseColor: 1024, frame_normal: 1024, frame_metallicRoughness: 512 };
const tx = [];
for (const [name, s] of Object.entries(SIZE)) tx.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [s, s], quality: 85, pattern: new RegExp('^' + name + '$') }));
await doc.transform(prune(), dedup(), ...tx, meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

let tris = 0;
for (const node of root.listNodes()) { const m = node.getMesh(); if (!m) continue; const t = m.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0); tris += t; console.log(' ', node.getParentNode()?.getName(), t); }
await io.write('public/models/heli.glb', doc);
console.log('triangles', tris, 'bytes', fs.statSync('public/models/heli.glb').size);
