// Build the person: node tools/person/process.mjs (after convert.mjs)
// Character: "David" from Mixamo, in a fitted hoodie, joggers and trainers, on Mixamo's own rig.
// Motion: Mixamo clips downloaded on David himself (idle, walk, walk back, run, jump, kneel, swim,
// tread water, three climbs, hanging and driving), so each clip drives his skeleton exactly as it
// was captured, with no retargeting between rest poses (the earlier coat man's clips came from
// another character, and his long coat was a stiff shell his legs swung inside). convert.mjs turns
// the FBX files into downloads/david/david.glb, in metres with the hips held in place; this makes it
// light enough for the game: lighter meshes, WebP pictures, compressed geometry.
// Needs, not saved to package.json:
// npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp@0.33
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, resample, weld, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(process.env.IN || 'downloads/david/david.glb');
const root = doc.getRoot();

for (const mat of root.listMaterials()) {
  mat.setMetallicFactor(0).setRoughnessFactor(0.82);
  // The hair and lashes are cut out by their alpha (drawn solid, so they sort with the rest).
  if (/hair/i.test(mat.getName())) mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
  else mat.setAlphaMode('OPAQUE').setDoubleSided(false);
}

// Fewer triangles where it does not show: the error is a share of each mesh's size, small enough
// that the face, hands and folds keep their shape. The hair's cards are left as they are.
const RATIO = +(process.env.RATIO || 0.35), ERROR = +(process.env.ERROR || 0.002);
const count = (p) => p.getAttribute('POSITION').getCount();
await doc.transform(weld());
let before = 0, after = 0;
for (const m of root.listMeshes()) {
  for (const p of m.listPrimitives()) {
    const n = count(p); before += n;
    if (!/hair|eyelash/i.test(m.getName())) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: RATIO, error: ERROR, lockBorder: true });
    after += count(p);
    console.log(' ', m.getName(), n, '->', count(p));
  }
}
console.log('vertices', before, '->', after);

await doc.transform(
  resample(), prune(), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 84 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const out = process.env.OUT || 'public/models/person.glb';
await io.write(out, doc);
console.log('wrote', out, fs.statSync(out).size, 'bytes');
