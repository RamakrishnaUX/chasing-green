// Build the person on foot: node tools/person/process.mjs
// Character: "Man In Coat - Human Rigged Model" by Saitam (CC BY 4.0), an Adobe Fuse model on a
// Mixamo rig, downloaded to downloads/coat. Motion: the Mixamo clips in "ETB Animated" by
// Royaleyourdad (CC BY 4.0), downloaded to downloads/etb. Both rigs are Mixamo's, so a clip moves
// the coat man once its tracks are pointed at his bones by name (Sketchfab adds a different
// number to each bone name in each file, which is dropped to match them). The two skeletons'
// rest poses differ by a few degrees a bone (more at the feet, shoulders and hands), and copying
// each bone's turn straight across adds those errors up along every limb: he leaned back on bent
// knees and his limbs looked rubbery. So the clips are retargeted: each bone keeps the same turn
// in the world, away from its own rest pose, as the clip's bone makes away from the clip's. The
// hips' track is scaled to his height and held in place, so the game moves him, not the clip.
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
// (Clip 6 is a walk backwards: the planted foot slides forward. It is the step back.)
const CLIPS = JSON.parse(process.env.CLIPS || '{"7":"idle","5":"walk","6":"back","1":"run","2":"jump","3":"kneel"}');

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('downloads/coat/scene.gltf');
const src = await io.read('downloads/etb/scene.gltf');
const root = doc.getRoot();
const base = (n) => n.replace(/_\d+$/, '').replace(/^mixamorig:?/, ''); // one name per joint, whichever file

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
// Swimming, from two more Mixamo clips on their own characters (CC BY 4.0, by Appsbypaulhamilton):
// a front crawl ("Warrior Swimming") and treading water ("Treading Water (2)").
const EXTRA = [['downloads/swimcrawl/scene.gltf', 'swim'], ['downloads/treadwater/scene.gltf', 'tread']];

// Quaternions [x, y, z, w].
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (a) => [-a[0], -a[1], -a[2], a[3]];
const qnorm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const slerp = (a, b, t) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const bb = d < 0 ? b.map((v) => -v) : b; return qnorm(a.map((v, i) => v + (bb[i] - v) * t)); };
// The rotation of a 4x4 (column-major) matrix, scale taken out.
const rotOf = (m) => {
  const c = [0, 1, 2].map((k) => { const l = Math.hypot(m[k * 4], m[k * 4 + 1], m[k * 4 + 2]); return [m[k * 4] / l, m[k * 4 + 1] / l, m[k * 4 + 2] / l]; });
  const [m00, m10, m20] = c[0], [m01, m11, m21] = c[1], [m02, m12, m22] = c[2], tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); q = [(m21 - m12) * k, (m02 - m20) * k, (m10 - m01) * k, 0.25 / k]; }
  else if (m00 > m11 && m00 > m22) { const k = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * k, (m01 + m10) / k, (m02 + m20) / k, (m21 - m12) / k]; }
  else if (m11 > m22) { const k = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / k, 0.25 * k, (m12 + m21) / k, (m02 - m20) / k]; }
  else { const k = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / k, (m12 + m21) / k, 0.25 * k, (m10 - m01) / k]; }
  return qnorm(q);
};
// Each joint's rest (bind) turn in the world: the skinned mesh's, then the inverse bind matrix's.
const bindOf = (rootOf, skin) => {
  const mesh = rootOf.listNodes().find((n) => n.getSkin() === skin), M = rotOf(mesh.getWorldMatrix()), ibm = skin.getInverseBindMatrices(), out = new Map();
  skin.listJoints().forEach((j, i) => out.set(j, qmul(M, qinv(rotOf(ibm.getElement(i, []))))));
  return out;
};
// The value of a channel at time t (linear keys; rotations slerped).
const sample = (ch, t) => {
  const s = ch.getSampler(), T = s.getInput().getArray(), V = s.getOutput().getArray(), n = ch.getTargetPath() === 'rotation' ? 4 : 3;
  const at = (i) => Array.from(V.slice(i * n, i * n + n));
  if (t <= T[0] || T.length === 1) return at(0);
  if (t >= T[T.length - 1]) return at(T.length - 1);
  let i = 1; while (T[i] < t) i++;
  const u = (t - T[i - 1]) / (T[i] - T[i - 1]), a = at(i - 1), b = at(i);
  return n === 4 ? slerp(a, b, u) : a.map((v, k) => v + (b[k] - v) * u);
};

const first = srcRoot.listAnimations().filter((a) => a.getName().startsWith('Armature|'));
first.sort((a, b) => a.getName().localeCompare(b.getName()));
const buffer = root.listBuffers()[0];
const tgtHips = [...bones.values()].find((n) => /Hips/.test(n.getName()));
const tgtBind = bindOf(root, root.listSkins().find((k) => k.listJoints().includes(tgtHips)));
const kids = (n) => n.listChildren();
function retarget(srcRoot, a, name, scale, drift = false) {
  // The clip's own skeleton (the pack has eight) and its rest turns.
  const chans = new Map(), srcBones = new Map();
  for (const ch of a.listChannels()) { const n = ch.getTargetNode(); srcBones.set(base(n.getName()), n); chans.set(n.getName() + '|' + ch.getTargetPath(), ch); }
  const srcHips = [...srcBones.values()].find((n) => /Hips/.test(n.getName()));
  const srcBind = bindOf(srcRoot, srcRoot.listSkins().find((k) => k.listJoints().includes(srcHips)));
  const times = [...new Set(a.listChannels().flatMap((ch) => [...ch.getSampler().getInput().getArray()]))].sort((x, y) => x - y);
  const out = new Map(); // target bone -> rotations, flat
  const hipsT = [];
  const srcUp = rotOf(srcHips.getParentNode().getWorldMatrix()), tgtUp = rotOf(tgtHips.getParentNode().getWorldMatrix());
  for (const t of times) {
    // The clip's bones' turns in the world.
    const sw = new Map();
    const walkSrc = (n, parent) => { const ch = chans.get(n.getName() + '|rotation'); const w = qmul(parent, ch ? qnorm(sample(ch, t)) : n.getRotation()); sw.set(base(n.getName()), w); for (const c of kids(n)) walkSrc(c, w); };
    walkSrc(srcHips, srcUp);
    // His: the same turn away from rest, then each back into its parent's frame.
    const walkTgt = (n, parent) => {
      const k = base(n.getName()), sb = srcBones.get(k) || [...srcBind.keys()].find((j) => base(j.getName()) === k);
      let w;
      if (sw.has(k) && sb && srcBind.has(sb) && tgtBind.has(n)) w = qmul(qmul(sw.get(k), qinv(srcBind.get(sb))), tgtBind.get(n));
      else w = qmul(parent, n.getRotation());
      const local = qnorm(qmul(qinv(parent), w));
      if (!out.has(n)) out.set(n, []);
      out.get(n).push(...local);
      for (const c of kids(n)) walkTgt(c, w);
    };
    walkTgt(tgtHips, tgtUp);
    const ht = chans.get(srcHips.getName() + '|translation');
    if (ht) hipsT.push(...sample(ht, t));
  }
  const anim = doc.createAnimation(name);
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
  const add = (node, path, arr) => {
    const output = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array(arr)).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  };
  for (const [node, arr] of out) if (/mixamorig/.test(node.getName())) add(node, 'rotation', arr);
  if (hipsT.length) {
    // In place: hold the first frame's position across the ground, keep the bounce, scaled. A clip
    // that travels (the crawl swims forward through the water) keeps its sway and the surge of each
    // stroke, with the steady travel taken out and the hips back over the origin; its pace (metres a
    // second at his size) is what the game plays it against.
    const x0 = hipsT[0], z0 = hipsT[2], zN = hipsT[hipsT.length - 1], T = times[times.length - 1] - times[0];
    if (drift) console.log('    pace', ((zN - z0) * scale * 0.01 / T).toFixed(3), 'm/s over', T.toFixed(2), 's');
    for (let k = 0; k < hipsT.length; k += 3) {
      const u = (times[k / 3] - times[0]) / T;
      hipsT[k] = (drift ? hipsT[k] : x0) * scale; hipsT[k + 1] *= scale;
      hipsT[k + 2] = drift ? (hipsT[k + 2] - (z0 + (zN - z0) * u)) * scale : z0 * scale;
    }
    add(tgtHips, 'translation', hipsT);
  }
  console.log(' ', name, '<-', a.getName(), anim.listChannels().length, 'channels,', times.length, 'keys', 'hips y', hipsT.length ? [Math.min(...hipsT.filter((_, k) => k % 3 === 1)).toFixed(3), Math.max(...hipsT.filter((_, k) => k % 3 === 1)).toFixed(3)] : '-');
}
for (const [i, name] of Object.entries(CLIPS)) if (first[+i]) retarget(srcRoot, first[+i], name, scale);
for (const [file, name] of EXTRA) {
  const r = (await io.read(file)).getRoot(), hips = r.listNodes().find((n) => /Hips_\d+$/.test(n.getName()));
  retarget(r, r.listAnimations()[0], name, hipsY(root.listNodes()) / hips.getTranslation()[1], true);
}

await doc.transform(
  resample(), prune(), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 84 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const out = process.env.OUT || 'public/models/person.glb';
await io.write(out, doc);
console.log('wrote', out, fs.statSync(out).size, 'bytes');
