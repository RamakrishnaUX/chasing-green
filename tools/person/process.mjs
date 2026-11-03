// Build the person on foot: node tools/person/process.mjs
// Character: "Man In Coat - Human Rigged Model" by Saitam (CC BY 4.0), an Adobe Fuse model on a
// Mixamo rig, downloaded to downloads/coat. Motion: the Mixamo clips in "ETB Animated" by
// Royaleyourdad (CC BY 4.0), downloaded to downloads/etb. Both rigs are Mixamo's, so a clip moves
// the coat man once its tracks are pointed at his bones by name (Sketchfab adds a different
// number to each bone name in each file, which is dropped to match them). The hips' track is
// scaled to his height and held in place, so the game moves him, not the clip.
// Needs, not saved to package.json:
// npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 sharp@0.33
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

// The clips, by their place in the pack (the pack holds eight copies of the character, each
// with the same eight clips; the first copy's are used), and the names the game knows them by.
const CLIPS = JSON.parse(process.env.CLIPS || '{"7":"idle","6":"walk","1":"run","2":"jump","3":"kneel"}');

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('downloads/coat/scene.gltf');
const src = await io.read('downloads/etb/scene.gltf');
const root = doc.getRoot();
const base = (n) => n.replace(/_\d+$/, '');

// Spec-gloss to plain PBR: the diffuse becomes the base colour; normal maps stay.
for (const mat of root.listMaterials()) {
  const sg = mat.getExtension('KHR_materials_pbrSpecularGlossiness');
  if (sg) { mat.setBaseColorTexture(sg.getDiffuseTexture()); mat.setBaseColorFactor(sg.getDiffuseFactor()); }
  for (const e of mat.listExtensions()) { mat.setExtension(e.extensionName, null); e.dispose(); }
  mat.setMetallicFactor(0); mat.setRoughnessFactor(0.85); mat.setMetallicRoughnessTexture(null); mat.setOcclusionTexture(null);
  mat.setEmissiveTexture(null); mat.setEmissiveFactor([0, 0, 0]);
  // Drawn solid, with a cut-out for the lashes: blended, the mouth and eyes inside the head showed
  // through the skin.
  mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
}
for (const a of root.listAnimations()) a.dispose();

// His bones by plain name, and the height of his hips and the source's, to scale the hips' track.
const bones = new Map();
for (const n of root.listNodes()) if (/mixamorig/.test(n.getName())) bones.set(base(n.getName()), n);
const srcRoot = src.getRoot();
const hipsY = (nodes) => nodes.find((n) => /mixamorig:Hips_/.test(n.getName())).getTranslation()[1];
const srcHips = srcRoot.listNodes().filter((n) => /mixamorig:Hips_/.test(n.getName()));
const scale = hipsY(root.listNodes()) / hipsY(srcHips);
console.log('hips scale', scale.toFixed(3));

const first = srcRoot.listAnimations().filter((a) => a.getName().startsWith('Armature|'));
first.sort((a, b) => a.getName().localeCompare(b.getName()));
const buffer = root.listBuffers()[0];
for (const [i, name] of Object.entries(CLIPS)) {
  const a = first[+i];
  if (!a) continue;
  const anim = doc.createAnimation(name);
  for (const ch of a.listChannels()) {
    const target = bones.get(base(ch.getTargetNode().getName()));
    const path = ch.getTargetPath();
    if (!target || path === 'scale') continue;
    const s = ch.getSampler();
    const input = doc.createAccessor().setType('SCALAR').setArray(s.getInput().getArray().slice()).setBuffer(buffer);
    let out = s.getOutput().getArray().slice();
    if (path === 'translation') {
      if (!/Hips/.test(target.getName())) continue; // only the hips move; the other bones keep their own lengths
      // In place: hold the first frame's position across the ground, keep the bounce, scaled.
      const x0 = out[0], z0 = out[2];
      for (let k = 0; k < out.length; k += 3) { out[k] = x0 * scale; out[k + 1] *= scale; out[k + 2] = z0 * scale; }
    }
    const output = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(out).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(path).setSampler(sampler));
  }
  console.log(' ', name, '<-', a.getName(), anim.listChannels().length, 'channels');
}

await doc.transform(
  resample(), prune(), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 84 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const out = process.env.OUT || 'public/models/person.glb';
await io.write(out, doc);
console.log('wrote', out, fs.statSync(out).size, 'bytes');
