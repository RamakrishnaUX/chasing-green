import * as THREE from 'three';
import { loadGLTF } from './gltf.js';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp } from './noise.js';

// Real animal models, rigged and animated (Sketchfab; authors and licences in the README and in
// Settings). Each species is fetched the first time it is needed and cleaned beforehand
// (tools in the README): no saddle, slimmed meshes, only the bones and clips we use, and a
// low-poly copy of each mesh for far away.
//
// The nearest animals of each species are full rigs, each with its own skeleton playing its clips
// (crossfaded idle, graze, walk, trot, run), with the neck bent on top to graze or turn to watch you
// and, for the sheep (whose model has no walk), legs swung by code. Farther ones are instanced
// copies of the low-poly mesh baked in a few poses (standing, grazing, four steps of the walk).
// Coats are the model's own texture recoloured per animal by its brightness, so a bay, a grey and a
// palomino horse keep the same shading and hair. Seals are a scan, bent in the vertex shader to lift
// and turn the head; puffins are a scan too, standing or laid flat with wings added to fly; whales and
// dolphins play their swim cycle.

const SPECS = {
  // speed: ground speed of each clip at normal rate, in model units a second (measured from the
  // planted hooves, or the root motion we take out). neck, head: bones bent to graze and to look round.
  // pts: lower legs (fraction of height) and face (beyond this z, in model units) that take the
  // third colour; tint: meshes coloured with the coat or hair colour; gain: darkens the coat;
  // wide: broader than the model (the Icelandic horse is stockier than this one).
  horse: { scale: 0.09, wide: 1.08, eyeAt: [0.1, 0.3], speed: { walk: 9.93, run: 42.6 }, runAt: 2.4, neck: ['BN_Neck_00', 'BN_Neck_01', 'BN_Neck_02', 'BN_Neck_03'], head: 'BN_Head_00', tint: { Horse: 'coat', Hair: 'hair' }, paint: true, gain: 1.15, pts: { legs: 0.27 }, tack: /Saddle|Bridle/, near: 6 },
  sheep: { scale: 1.4, eyeAt: [0.06, 0.12], sheen: 0.7, speed: {}, neck: ['Neck'], head: 'Head', tint: { '*': 'coat' }, pts: { legs: 0.36, face: 0.3 }, near: 14, stride: 0.42,
    legs: { up: ['FrontUpLegL', 'FrontUpLegR', 'BackUpLegL', 'BackUpLegR'], low: ['FrontLowLegL', 'FrontLowLegR', 'BackLowLegL', 'BackLowLegR'] } },
  fox: { scale: 0.62, sheen: 0.6, speed: { walk: 1.3 }, neck: ['Neck1', 'Neck2', 'Neck3'], head: 'Head', tint: { '*': 'coat' }, eyes: ['EyeL', 'EyeR'], near: 3 },
  reindeer: { scale: 0.8, sheen: 0.4, eyeAt: [0.08, 0.22],  speed: { walk: 1.68, trot: 7.84, run: 12.6 }, root: 'RigRoot', neck: ['RigNeck1', 'RigNeck2', 'RigNeck3'], head: 'RigHead', tint: { Head: 'coat', Body: 'coat' }, gain: 1.35, near: 8 },
  seal: { scale: 0.84, yaw: -Math.PI / 2 },
  puffin: { scale: 0.12 }, // a scan of a standing bird, about 29 cm tall
  humpback: { scale: 0.47, yaw: -Math.PI / 2, center: true, shade: 0.5 }, // its texture is pale for a humpback
  orca: { scale: 0.113, center: true },
  dolphin: { scale: 0.52, center: true },
};
// Sheep legs, by code (the model has no walk): each hoof is placed, and the two bones of the leg
// bent to reach it (two-bone inverse kinematics), so a hoof stays planted on the ground while the
// body passes over it, then lifts in an arc and comes down ahead, and knees and hocks fold the way
// they really do (the way each leg already bends at rest). Each leg's place in the stride: a
// four-beat walk, and a trot with the diagonal pairs together (front-left, front-right, hind-left,
// hind-right).
const GAIT = { walk: [0.25, 0.75, 0, 0.5], trot: [0, 0.5, 0.5, 0] };
// The sheep's gait at ground speed v: how far a stride, how much a trot, how long each hoof is down
// (duty) and how high it lifts. The stride lengthens with speed, so a running sheep reaches out
// rather than pattering.
export function sheepGait(v, stride) {
  const trot = clamp((v - 1.2) / 1.0, 0, 1);
  return { stride: stride * (1 + 0.55 * Math.max(0, v - 0.8)), trot, duty: lerp(0.64, 0.46, trot), lift: lerp(0.07, 0.11, trot) };
}
const IK = { H: new THREE.Vector3(), K: new THREE.Vector3(), T: new THREE.Vector3(), tip: new THREE.Vector3(), d: new THREE.Vector3(), n: new THREE.Vector3(), p: new THREE.Vector3(), o: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion(), pq: new THREE.Quaternion() };
// Turn bone b (in the world) by the rotation that takes direction from to direction to.
function turnBone(b, from, to) {
  IK.q.setFromUnitVectors(from, to);
  b.parent.getWorldQuaternion(IK.pq);
  b.quaternion.premultiply(IK.pq).premultiply(IK.q).premultiply(IK.pq.invert());
  b.updateMatrixWorld(true);
}
// Bend leg L (its upper and lower bones, and the hoof's place in the lower bone) so the hoof is at T.
function reach(bones, L, T) {
  const U = bones[L.up], D = bones[L.low];
  U.getWorldPosition(IK.H); D.getWorldPosition(IK.K); IK.tip.copy(L.tip); D.localToWorld(IK.tip);
  const a = IK.K.distanceTo(IK.H), b = IK.tip.distanceTo(IK.K);
  // The plane the leg bends in now, and which side of the hip-to-hoof line the knee is.
  IK.a.subVectors(IK.K, IK.H); IK.b.subVectors(IK.tip, IK.H);
  IK.n.crossVectors(IK.a, IK.b);
  if (IK.n.lengthSq() < 1e-10) IK.n.set(1, 0, 0); else IK.n.normalize();
  IK.d.subVectors(T, IK.H);
  const dist = clamp(IK.d.length(), Math.abs(a - b) * 1.02 + 1e-4, (a + b) * 0.999);
  IK.d.normalize();
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  IK.p.crossVectors(IK.n, IK.d).normalize();
  IK.o.copy(IK.b).normalize(); IK.o.multiplyScalar(IK.a.dot(IK.o)); IK.o.subVectors(IK.a, IK.o); // the knee's offset now
  if (IK.p.dot(IK.o) < 0) IK.p.negate();
  // Upper bone: toward where the knee must be.
  IK.K.copy(IK.H).addScaledVector(IK.d, a * cosA).addScaledVector(IK.p, a * sinA);
  IK.a.normalize(); IK.b.subVectors(IK.K, IK.H).normalize();
  turnBone(U, IK.a, IK.b);
  // Lower bone: from the knee to the hoof's place.
  D.getWorldPosition(IK.K); IK.tip.copy(L.tip); D.localToWorld(IK.tip);
  IK.a.subVectors(IK.tip, IK.K).normalize();
  IK.T.copy(IK.H).addScaledVector(IK.d, dist);
  IK.b.subVectors(IK.T, IK.K).normalize();
  turnBone(D, IK.a, IK.b);
}
// All four hooves at stride phase p (0 to 1), blending walk into trot; amount fades the stride in
// and out as it starts and stops. groundY: the ground under the animal (the body may bob above it).
function sheepFeet(K, root, bones, p, g, amount, groundY) {
  root.updateMatrixWorld(true);
  const offs = g.trot > 0.5 ? GAIT.trot : GAIT.walk, half = (g.stride * g.duty) / 2;
  for (let i = 0; i < K.legs.length; i++) {
    const L = K.legs[i], u = (p + offs[i]) % 1;
    let dz, dy = 0;
    if (u < g.duty) dz = half - (2 * half * u) / g.duty;
    else { const w = (u - g.duty) / (1 - g.duty), e = w * w * (3 - 2 * w); dz = -half + 2 * half * e; dy = g.lift * Math.sin(Math.PI * w); }
    IK.T.copy(L.rest); IK.T.z += (dz * amount) / root.scale.z;
    root.localToWorld(IK.T);
    IK.T.y = groundY + L.rest.y * root.scale.y + dy * amount;
    reach(bones, L, IK.T.clone());
  }
}
const NEAR = 70;
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), M = new THREE.Matrix4(), C = new THREE.Color();
const E = new THREE.Euler(0, 0, 0, 'YXZ'), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);

// Coat colour from the texture's brightness: the coat, hair or lower-leg colour times how light the
// texture is there against its typical brightness, so markings and shading stay. A paint coat
// (the horse's texture is a skewbald) is read three ways: white patches (pale and grey), the coat
// (darker and coloured), and bare skin (pink: muzzle, gums), which keeps its own colour. Each patch
// is shaded against its own typical brightness, so a solid bay keeps the folds of the white patches
// too, and a paint horse keeps them white.
//
// Lighting, up close: a soft sheen (light caught in the tips of the hair, brightest at grazing
// angles, as fur and wool look against the light), and the belly and the insides of the legs a
// little darker (the sky reaches them less).
const TINT_VS = `attribute float aPts; varying float vPts; varying float vUnder;
#ifdef TINT_INST
attribute vec3 iCoat; attribute vec3 iHair; attribute vec3 iPts; attribute float iPaint; varying vec3 vCoat; varying vec3 vHair; varying vec3 vPtsC; varying float vPaint;
#endif
`;
// role: coat or hair. ref: { ref, refW } typical brightness of the coat and of white patches.
// opt: { paint, sheen, low }.
function tintMaterial(src, role, ref, instanced, opt = {}) {
  const fancy = !opt.low && !instanced;
  const base = { map: src.map, normalMap: src.normalMap, aoMap: opt.paint && role === 'coat' ? src.aoMap : null, aoMapIntensity: 0, roughness: role === 'hair' ? 0.62 : 0.86, metalness: 0, alphaTest: src.alphaTest, side: src.alphaTest > 0 ? THREE.DoubleSide : THREE.FrontSide, envMapIntensity: 0.5 };
  const m = fancy ? new THREE.MeshPhysicalMaterial({ ...base, sheen: role === 'hair' ? 0.08 : opt.sheen ?? 0.3, sheenRoughness: 0.75, sheenColor: new THREE.Color(0.5, 0.48, 0.45), specularIntensity: role === 'hair' ? 0.45 : 0.2 }) : new THREE.MeshStandardMaterial(base);
  if (src.normalMap) m.normalScale.set(1.2, 1.2);
  const u = m.userData.tint = { uCoat: { value: new THREE.Color(1, 1, 1) }, uHair: { value: new THREE.Color(1, 1, 1) }, uPts: { value: new THREE.Color(1, 1, 1) }, uPaint: { value: 0 }, uRef: { value: ref.ref }, uRefW: { value: ref.refW } };
  const paint = opt.paint && role === 'coat' && !!src.aoMap;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.defines = { ...s.defines, ...(instanced ? { TINT_INST: '' } : {}), ...(paint ? { TINT_PAINT: '' } : {}) };
    s.vertexShader = TINT_VS + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vPts = aPts; vUnder = normal.y;
#ifdef TINT_INST
vCoat = iCoat; vHair = iHair; vPtsC = iPts; vPaint = iPaint;
#endif`);
    s.fragmentShader = `uniform vec3 uCoat; uniform vec3 uHair; uniform vec3 uPts; uniform float uPaint; uniform float uRef; uniform float uRefW; varying float vPts; varying float vUnder;
#ifdef TINT_INST
varying vec3 vCoat; varying vec3 vHair; varying vec3 vPtsC; varying float vPaint;
#define COAT vCoat
#define HAIR vHair
#define PTS vPtsC
#define PAINT vPaint
#else
#define COAT uCoat
#define HAIR uHair
#define PTS uPts
#define PAINT uPaint
#endif
` + s.fragmentShader.replace('#include <map_fragment>', `
  vec4 tex = texture2D(map, vMapUv);
  float lum = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
  ${role === 'hair' ? `vec3 col = HAIR * pow(lum / uRef, 0.6);` : `
  vec3 tint = mix(COAT, PTS, vPts);
  #ifdef TINT_PAINT
    // The paint mask (tools/animals/process.mjs): shading over two, white patch, bare skin.
    vec3 pm = texture2D(aoMap, vAoMapUv).rgb;
    float shade = pm.r * 2.0 / uRef, white = pm.g, skin = pm.b;
    vec3 col = mix(tint * shade, vec3(0.86, 0.85, 0.82) * min(shade, 1.15), white * PAINT);
    col = mix(col, tex.rgb, skin);
  #else
    vec3 col = tint * (lum / uRef);
  #endif`}
  // Under the belly and between the legs: less sky.
  col *= mix(0.72, 1.0, smoothstep(-0.85, 0.15, vUnder));
  diffuseColor *= vec4(min(col, vec3(1.0)), tex.a);`);
  };
  m.customProgramCacheKey = () => `tint2-${role}-${instanced ? 1 : 0}-${paint ? 1 : 0}-${fancy ? 1 : 0}`;
  return m;
}

// Typical brightness of a texture (median luminance of its painted pixels, in linear light).
// A mesh's geometry in plain floats (the models come quantised), in the template's frame.
function plainGeo(m) {
  const src = m.geometry, g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) {
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  return g.applyMatrix4(m.matrixWorld);
}

function medianLum(tex) {
  const img = tex.image, c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data, lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  // As the shader sorts them: white patches (pale, hardly coloured), bare skin, and the coat.
  const L = [], W = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = lin(d[i]), gg = lin(d[i + 1]), b = lin(d[i + 2]), l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    if (l <= 0.01) continue;
    const mx = Math.max(r, gg, b), sat = (mx - Math.min(r, gg, b)) / mx;
    if (b - gg > 0.02 && l > 0.08) continue;
    (sat < 0.23 && l > 0.085 ? W : L).push(l);
  }
  const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
  const all = med([...L, ...W]) || 0.5, coat = L.length > W.length * 0.15 ? med(L) : all;
  return { all, ref: coat, refW: med(W) || all };
}

// One species: the loaded model, normalised (facing +z, feet at y = 0, real size), its clips,
// materials, bones to bend, and baked poses for the far instances.
class Kind {
  constructor(sp, gltf, { low }) {
    const S = SPECS[sp];
    this.sp = sp; this.S = S; this.low = low;
    const src = gltf.scene;
    src.rotation.y = S.yaw || 0;
    const holder = this.template = new THREE.Group();
    holder.add(src); holder.scale.set(S.scale * (S.wide || 1), S.scale, S.scale);
    this.clips = {};
    for (const c of gltf.animations) {
      // Root motion out: the animal is moved by the game, the clip only works the legs.
      if (S.root) for (const t of c.tracks) if (t.name.startsWith(S.root) && t.name.endsWith('.position')) {
        const v = t.values; for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
      }
      this.clips[c.name] = c;
    }
    // Rest pose for measuring: the first frame of idle (or of anything).
    const clip0 = this.clips.idle || this.clips.swim || gltf.animations[0];
    const mixer = clip0 ? new THREE.AnimationMixer(src) : null;
    if (mixer) { mixer.clipAction(clip0).play(); mixer.update(0); }
    holder.updateMatrixWorld(true);
    const meshes = []; src.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const box = new THREE.Box3();
    for (const m of meshes) if (!/_lod$/.test(m.name)) this.eachVertex(m, (v) => box.expandByPoint(v), 3);
    // Centred on the animal's position (and on its feet, for those on land).
    const c = box.getCenter(new THREE.Vector3()), shift = new THREE.Vector3(-c.x, S.center ? -c.y : -box.min.y, -c.z);
    src.position.add(V.copy(shift).divide(holder.scale));
    holder.updateMatrixWorld(true);
    box.translate(shift);
    this.box = box;
    // Points (lower legs, face) for the third colour, from where each vertex is at rest.
    const Hh = box.max.y;
    if (S.tint) for (const m of meshes) {
      const n = m.geometry.attributes.position.count, a = new Float32Array(n);
      if (S.pts) this.eachVertex(m, (v, i) => {
        let w = S.pts.legs ? clamp((S.pts.legs * Hh - v.y) / (0.08 * Hh), 0, 1) : 0;
        if (S.pts.face) w = Math.max(w, clamp((v.z - S.pts.face * S.scale - shift.z) / 0.06, 0, 1));
        a[i] = w;
      });
      m.geometry.setAttribute('aPts', new THREE.BufferAttribute(a, 1));
    }
    // Materials: tinted (per animal up close, per instance far away) or the model's own.
    this.mats = new Map();
    for (const m of meshes) {
      const role = S.tint ? (S.tint[m.material.name] ?? S.tint['*'] ?? null) : null;
      if (!this.mats.has(m.material.name)) {
        const L = role && m.material.map ? medianLum(m.material.map) : { all: 1, ref: 1, refW: 1 }, gain = S.gain || 1;
        // A paint coat's mask is already shading against the typical brightness: only the gain.
        const ref = S.paint && m.material.aoMap ? { ref: gain, refW: gain } : { ref: L.all * gain, refW: L.all * gain };
        const opt = { paint: S.paint, sheen: S.sheen, low: this.low };
        // Eyes are wet and glossy; tack is leather. Other untinted fur and skin is matt: the sky's
        // reflection must not wash them out.
        if (!role) {
          if (/cornea|eye/i.test(m.material.name)) { m.material.roughness = 0.05; m.material.envMapIntensity = 1.2; }
          else { m.material.envMapIntensity = 0.35; m.material.roughness = Math.max(m.material.roughness, S.tack?.test(m.material.name) ? 0.55 : 0.7); }
          if (S.shade) m.material.color.multiplyScalar(S.shade);
        }
        this.mats.set(m.material.name, role ? { role, near: tintMaterial(m.material, role, ref, false, opt), far: tintMaterial(m.material, role, ref, true, opt) } : { role: null, near: m.material, far: m.material });
      }
      m.material = this.mats.get(m.material.name).near;
      m.castShadow = true; m.receiveShadow = true;
    }
    // Bones to bend: their axes for nodding (side to side across the body) and turning (up), in
    // each bone's own frame, and which way lowers the head.
    const bone = (name) => { let b = null; src.traverse((o) => { if (!b && o.isBone && (o.name === name || o.name.startsWith(name + '_'))) b = o; }); return b; };
    const axes = (b) => {
      b.getWorldQuaternion(Q).invert();
      return { pitch: X.clone().applyQuaternion(Q).normalize(), yaw: Y.clone().applyQuaternion(Q).normalize(), rest: b.quaternion.clone() };
    };
    this.neck = (S.neck || []).map(bone).filter(Boolean).map((b) => ({ name: b.name, ...axes(b) }));
    this.head = S.head && bone(S.head) ? { name: bone(S.head).name, ...axes(bone(S.head)) } : null;
    if (this.neck.length) {
      // Grazing: the neck swings down from its base (a) and straightens or bends along its length
      // (b, each further bone), keeping the poll forward of where it was, until the poll is about
      // a head's length off the ground; then the head tips at the poll until the muzzle is on the
      // grass. Searched once, on the model.
      const nb = this.neck.map((n) => bone(n.name)), hb = this.head && bone(this.head.name), tip = this.noseTip(meshes);
      const set = (a, b, q) => {
        nb.forEach((bn, i) => bn.quaternion.copy(this.neck[i].rest).multiply(Q2.setFromAxisAngle(this.neck[i].pitch, i === 0 ? a : b)));
        if (hb) hb.quaternion.copy(this.head.rest).multiply(Q2.setFromAxisAngle(this.head.pitch, q));
        holder.updateMatrixWorld(true);
      };
      const measure = (a, b, q) => {
        set(a, b, q);
        const poll = (hb || nb[nb.length - 1]).getWorldPosition(new THREE.Vector3()), nose = tip ? this.vertexAt(tip.mesh, tip.i).clone() : poll.clone();
        set(0, 0, 0);
        return { poll, nose };
      };
      const m0 = measure(0, 0, 0), headLen = m0.nose.distanceTo(m0.poll);
      const sg = (this.pitchSign = measure(0.2, 0, 0).nose.y < m0.nose.y ? 1 : -1);
      let best = Infinity, p = { a: 0, b: 0 };
      for (let a = 0; a <= 1.8; a += 0.06) for (let b = -0.3; b <= 0.5; b += 0.05) {
        const { poll } = measure(a * sg, b * sg, 0);
        const cost = Math.abs(poll.y - headLen * 0.8) + Math.max(0, m0.poll.z - poll.z) * 3 + Math.abs(b) * 0.05;
        if (cost < best) { best = cost; p = { a: a * sg, b: b * sg }; }
      }
      let q = 0;
      if (hb) {
        const qs = measure(p.a, p.b, 0.2).nose.y < measure(p.a, p.b, 0).nose.y ? 1 : -1;
        best = Infinity;
        for (let t = 0; t <= 1.6; t += 0.04) { const y = measure(p.a, p.b, t * qs).nose.y, c = Math.abs(y - 0.04 * Hh); if (c < best) { best = c; q = t * qs; } }
      }
      this.graze = { a: p.a, b: p.b, q };
    }
    // Legs placed by code (sheep): each leg's two bones, where its hoof is (under the lower joint,
    // on the ground) in the lower bone's frame, and that place at rest in the animal's frame.
    if (S.legs) {
      this.legUp = S.legs.up.map(bone).map((b) => ({ name: b.name, ...axes(b) }));
      this.legLow = S.legs.low.map(bone).map((b) => ({ name: b.name, ...axes(b) }));
      holder.updateMatrixWorld(true);
      this.legs = this.legUp.map((U, i) => {
        const D = bone(this.legLow[i].name), lp = D.getWorldPosition(new THREE.Vector3()), tipW = new THREE.Vector3(lp.x, 0.012, lp.z);
        return { up: U.name, low: D.name, tip: D.worldToLocal(tipW.clone()), rest: holder.worldToLocal(tipW.clone()) };
      });
    }
    // Eyes (fox eyeshine), at rest, in the animal's own frame.
    if (S.eyes) { holder.updateMatrixWorld(true); this.eyes = S.eyes.map((n) => bone(n)?.getWorldPosition(new THREE.Vector3())).filter(Boolean); }
    // Animals without eye bones: two points either side, a little ahead of the head bone.
    else if (S.eyeAt && S.head && bone(S.head)) {
      holder.updateMatrixWorld(true);
      const h = bone(S.head).getWorldPosition(new THREE.Vector3()), [half, fwd] = S.eyeAt;
      this.eyes = [new THREE.Vector3(h.x - half, h.y, h.z + fwd), new THREE.Vector3(h.x + half, h.y, h.z + fwd)];
    }
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(src); }
    this.bent = [...this.neck, ...(this.head ? [this.head] : []), ...(this.legUp || []), ...(this.legLow || [])];
    this.actors = [];
    this.far = null;
  }

  // Each vertex of a mesh where it is now (skinned), in the template's frame.
  eachVertex(m, fn, step = 1) {
    const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i += step) fn(this.vertexAt(m, i), i);
  }
  vertexAt(m, i) {
    V.fromBufferAttribute(m.geometry.attributes.position, i);
    if (m.isSkinnedMesh) m.applyBoneTransform(i, V);
    return V.applyMatrix4(m.matrixWorld);
  }
  noseTip(meshes) {
    let best = null, z = -Infinity;
    for (const m of meshes) if (!/_lod$/.test(m.name) && m.material.userData.tint) this.eachVertex(m, (v, i) => { if (v.z > z) { z = v.z; best = { mesh: m, i }; } }, 2);
    return best;
  }

  // A full rig for one animal close by.
  actor(scene) {
    const root = cloneRig(this.template), mats = new Map();
    const bones = {};
    let tack = null;
    root.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (!o.isMesh) return;
      if (/_lod$/.test(o.name)) { o.visible = false; return; }
      o.frustumCulled = false;
      // Saddle and bridle: only on a horse being ridden (see setTack).
      if (this.S.tack?.test(o.name + ' ' + o.material.name)) { o.visible = false; (tack ||= []).push(o); return; }
      // Its own copy of each tinted material, with its own colours, sharing the compiled shader.
      const base = o.material, t = base.userData.tint;
      if (!t) return;
      if (!mats.has(base)) {
        const c = base.clone(), u = { uCoat: { value: new THREE.Color() }, uHair: { value: new THREE.Color() }, uPts: { value: new THREE.Color() }, uPaint: { value: 0 }, uRef: t.uRef, uRefW: t.uRefW };
        c.userData.tint = u;
        c.onBeforeCompile = (s, r) => { base.onBeforeCompile(s, r); Object.assign(s.uniforms, u); };
        c.customProgramCacheKey = base.customProgramCacheKey;
        mats.set(base, c);
      }
      o.material = mats.get(base);
    });
    const meshes = []; root.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    const A = { root, bones, meshes, tack, mats: [...mats.values()], mixer: new THREE.AnimationMixer(root), actions: {}, cur: null, a: null, pitch: 0, yaw: 0, gait: 0, acc: 0 };
    for (const [name, clip] of Object.entries(this.clips)) A.actions[name] = A.mixer.clipAction(clip);
    root.visible = false;
    scene.add(root);
    this.actors.push(A);
    return A;
  }

  // Far instances: the low-poly meshes baked into a few poses.
  bakeFar(scene, cap) {
    const rig = cloneRig(this.template), mixer = new THREE.AnimationMixer(rig), poses = [];
    const lods = []; rig.traverse((o) => { if (o.isMesh && /_lod$/.test(o.name)) lods.push(o); });
    if (!lods.length) rig.traverse((o) => { if (o.isMesh && o.material.userData.tint) lods.push(o); });
    const bones = {}; rig.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    const pose = (clip, t, graze, legs = -1) => {
      mixer.stopAllAction();
      for (const B of this.bent) bones[B.name].quaternion.copy(B.rest);
      if (clip) { const a = mixer.clipAction(clip); a.play(); mixer.setTime(t); }
      if (legs >= 0 && this.legs) { rig.updateMatrixWorld(true); sheepFeet(this, rig, bones, legs, sheepGait(this.S.walkSpeed || 0.8, this.S.stride), 1, 0); }
      if (graze && this.graze) {
        for (const n of this.neck) { const b = bones[n.name]; b.quaternion.multiply(Q2.setFromAxisAngle(n.pitch, n === this.neck[0] ? this.graze.a : this.graze.b)); }
        if (this.head) { const b = bones[this.head.name]; b.quaternion.multiply(Q2.setFromAxisAngle(this.head.pitch, this.graze.q)); }
      }
      rig.updateMatrixWorld(true);
      const parts = [], mats = [];
      for (const m of lods) {
        const g = m.geometry, n = g.attributes.position.count, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { V.fromBufferAttribute(g.attributes.position, i); if (m.isSkinnedMesh) m.applyBoneTransform(i, V); V.applyMatrix4(m.matrixWorld); pos.set([V.x, V.y, V.z], i * 3); }
        const b = new THREE.BufferGeometry();
        b.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        b.setAttribute('uv', g.attributes.uv);
        b.setAttribute('aPts', g.attributes.aPts || new THREE.BufferAttribute(new Float32Array(n), 1));
        b.setIndex(g.index); b.computeVertexNormals();
        parts.push(b); mats.push(this.mats.get(this.matName(m)).far);
      }
      return { geo: mergeGeometries(parts, true), mats };
    };
    const idle = this.clips.idle, walk = this.clips.walk;
    poses.push(pose(idle, 0, false)); // standing
    poses.push(this.clips.graze ? pose(this.clips.graze, this.clips.graze.duration * 0.3, false) : pose(idle, 0, true)); // grazing
    // Four steps of the walk (for the sheep, its legs swung by code).
    for (let k = 0; k < 4; k++) poses.push(walk ? pose(walk, (walk.duration * k) / 4, false) : pose(idle, 0, false, k / 4));
    const inst = (n) => new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    this.far = poses.map(({ geo, mats }) => {
      geo.setAttribute('iCoat', inst(cap)); geo.setAttribute('iHair', inst(cap)); geo.setAttribute('iPts', inst(cap)); geo.setAttribute('iPaint', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      const im = new THREE.InstancedMesh(geo, mats, cap);
      im.count = 0; im.visible = false; im.frustumCulled = false; im.receiveShadow = true; // too far off for a shadow to show
      scene.add(im); return im;
    });
  }
  matName(m) { for (const [name, v] of this.mats) if (v.near === m.material || v.far === m.material) return name; return m.material.name; }
}

export class AnimalRigs {
  constructor(scene, { low = false } = {}) {
    this.scene = scene;
    this.low = low;
    this.kinds = {};
    this.loading = {};
    this.seals = null;
    // warm(object): builds an object's shaders in the background and resolves when they are
    // ready (set by the game). A species shows once its shaders are built, a moment after it
    // arrives, instead of stalling the game the first time it is drawn.
    this.warm = null;
  }
  ready(sp) { return !!this.kinds[sp]; }
  // Fetch a species the first time it is wanted.
  want(sp) {
    if (this.kinds[sp] || this.loading[sp]) return;
    this.loading[sp] = loadGLTF(`${import.meta.env.BASE_URL}models/${sp}.glb`)
      .then((g) => {
        const K = new Kind(sp, g, { low: this.low }), done = () => { this.kinds[sp] = K; };
        return this.warm ? this.warm(K.template).then(done, done) : done();
      })
      .catch((e) => console.warn('animal model', sp, e));
  }

  // The far herd's baked poses and their own (instanced) shaders: built in the background (or
  // while the island loads, by preload), drawn once ready. Resolves when they are.
  prepFar(K, cap) {
    K.bakeFar(this.scene, cap);
    K.farReady = !this.warm;
    return this.warm ? Promise.all(K.far.map((im) => this.warm(im))).finally(() => { K.farReady = true; }) : Promise.resolve();
  }

  // Everything an animal needs, made while the island loads instead of the first time one comes
  // into view: each model fetched and its pictures decoded one at a time (several at once was a
  // spike of memory, and iPhone closes a page that spikes), shaders built, far herds baked, the
  // seals' and puffins' instances made. caps: { herd species: cap, seal, puffinStand, puffinFly }.
  async preload(caps, onEach) {
    const order = ['sheep', 'horse', 'reindeer', 'fox', 'seal', 'puffin', 'dolphin', 'humpback', 'orca'];
    for (const sp of order) {
      this.want(sp);
      await this.loading[sp];
      onEach?.(sp);
    }
    const jobs = [];
    for (const sp of ['sheep', 'horse', 'reindeer', 'fox']) { const K = this.kinds[sp]; if (K && !K.far) jobs.push(this.prepFar(K, caps[sp])); }
    if (this.kinds.seal && !this.seals) { this.seals = this.makeSeals(this.kinds.seal, caps.seal); if (this.warm) jobs.push(this.warm(this.seals)); }
    if (this.kinds.puffin && !this.puffins) { this.puffins = this.makePuffins(this.kinds.puffin, caps.puffinStand, caps.puffinFly); if (this.warm) for (const m of Object.values(this.puffins)) if (m?.isObject3D) jobs.push(this.warm(m)); }
    await Promise.all(jobs);
  }

  // A herd species: the nearest as full rigs, the rest as baked instances.
  // list: animals sorted nearest first, each { x, y, z, heading, dist, state, moving, v, alert, hy, look, step }.
  drawHerd(sp, list, dt, cap) {
    this.want(sp);
    const K = this.kinds[sp];
    if (!K) return false;
    if (!K.far) this.prepFar(K, cap);
    const nMax = Math.round(K.S.near * (this.low ? 0.45 : 1)), near = this.low ? 45 : NEAR;
    const want = new Set();
    for (const a of list) { if (want.size >= nMax || a.dist > near) break; want.add(a); }
    // Let go of animals that have moved off, then give a rig to each new one.
    for (const A of K.actors) if (A.a && !want.has(A.a)) { A.a._rig = null; A.a = null; A.root.visible = false; if (A.tack) for (const m of A.tack) m.visible = false; }
    for (const a of want) {
      if (a._rig && a._rig.kind === K) continue;
      const A = K.actors.find((x) => !x.a) || K.actor(this.scene);
      A.kind = K; A.a = a; a._rig = A; A.cur = null; A.pitch = 0; A.yaw = 0;
      A.mixer.stopAllAction();
      for (const m of A.mats) { const t = m.userData.tint; t.uCoat.value.set(a.look[0]); t.uHair.value.set(a.look[1] ?? a.look[0]); t.uPts.value.set(a.look[2] ?? a.look[1] ?? a.look[0]); t.uPaint.value = a.look[3] ?? 0; }
    }
    for (const A of K.actors) if (A.a) this.drive(K, A, dt);
    // Far ones: one instance each, in the pose nearest to what it is doing.
    const counts = K.far.map(() => 0);
    for (const a of list) {
      if (a._rig || !K.farReady || counts.reduce((s, c) => s + c, 0) >= cap) continue;
      const k = a.moving ? 2 + (Math.floor((a.step / (Math.PI * 2)) * 4) & 3) : a.state === 'graze' && !a.alert ? 1 : 0;
      const im = K.far[k], j = counts[k]++;
      E.set(0, a.heading, 0); Q.setFromEuler(E); P.set(a.x, a.y, a.z);
      im.setMatrixAt(j, M.compose(P, Q, S));
      const g = im.geometry.attributes;
      C.set(a.look[0]); g.iCoat.setXYZ(j, C.r, C.g, C.b);
      C.set(a.look[1] ?? a.look[0]); g.iHair.setXYZ(j, C.r, C.g, C.b);
      C.set(a.look[2] ?? a.look[1] ?? a.look[0]); g.iPts.setXYZ(j, C.r, C.g, C.b);
      g.iPaint.setX(j, a.look[3] ?? 0);
    }
    K.far.forEach((im, k) => {
      im.count = counts[k]; im.visible = counts[k] > 0;
      if (counts[k]) { im.instanceMatrix.needsUpdate = true; for (const n of ['iCoat', 'iHair', 'iPts', 'iPaint']) im.geometry.attributes[n].needsUpdate = true; }
    });
    return true;
  }

  // One rig: place it, pick and blend its clip, then bend the neck (and swing the legs).
  drive(K, A, dt) {
    const a = A.a, S = K.S;
    A.root.visible = true;
    A.root.position.set(a.x, a.y, a.z);
    // Only those close enough for their shadow to matter cast one.
    const shadow = a.dist < 32;
    if (A.shadow !== shadow) { A.shadow = shadow; for (const m of A.meshes) m.castShadow = shadow; }
    A.root.rotation.set(0, a.heading, 0); // all three, so a turn left in x or z can never flip it
    const v = a.moving ? a.v || 0 : 0;
    let clip = 'idle', rate = 1;
    if (a.moving && v > 0.05) {
      if (S.speed.run && v > (S.runAt ?? 6.5)) clip = 'run';
      else if (S.speed.trot && v > 2.4) clip = 'trot';
      else if (S.speed.walk) clip = 'walk';
      if (S.speed[clip]) rate = clamp(v / (S.speed[clip] * S.scale), 0.45, 2.5);
    } else if (a.state === 'graze' && !a.alert && K.clips.graze) clip = 'graze';
    // Set from outside (a ridden horse jumping).
    if (a.clip && A.actions[a.clip]) { clip = a.clip; rate = 1.15; }
    if (!A.actions[clip]) clip = 'idle';
    const act = A.actions[clip];
    if (A.cur !== act) {
      act.reset().play();
      if (A.cur) { act.crossFadeFrom(A.cur, A.cur ? 0.35 : 0, false); } else act.time = Math.random() * act.getClip().duration;
      A.cur = act;
    }
    act.timeScale = rate * (a.dir || 1); // a ridden horse backing up plays its walk in reverse
    // Rigs further off are stepped at half rate: nobody sees the difference at that size.
    A.acc += dt;
    if (a.dist > 35 && A.acc < 1 / 30) return;
    // Bones we bend go back to rest first: a clip only sets the bones it has tracks for, and the
    // bend would otherwise pile up frame on frame.
    for (const B of K.bent) A.bones[B.name].quaternion.copy(B.rest);
    A.mixer.update(A.acc); const step = A.acc; A.acc = 0;
    // Neck: down to graze (if the clip does not), up a touch and turned to watch something close.
    const grazing = a.state === 'graze' && !a.alert && !a.moving && !K.clips.graze;
    const k = Math.min(1, step * 2.2);
    A.pitch = lerp(A.pitch, grazing ? 1 : 0, k * 0.8);
    A.lift = lerp(A.lift || 0, a.alert && !a.moving ? -0.18 * (K.pitchSign || 1) : 0, k);
    A.yaw = lerp(A.yaw, a.alert && !a.moving ? a.hy || 0 : 0, k);
    const G = K.graze || { a: 0, b: 0, q: 0 }, chew = 1 + 0.06 * Math.sin(performance.now() / 320 + a.step) * A.pitch;
    for (const N of K.neck) {
      A.bones[N.name].quaternion.multiply(Q2.setFromAxisAngle(N.pitch, (N === K.neck[0] ? G.a : G.b) * A.pitch + A.lift / K.neck.length)).multiply(Q2.setFromAxisAngle(N.yaw, A.yaw / K.neck.length));
    }
    if (K.head) {
      A.bones[K.head.name].quaternion.multiply(Q2.setFromAxisAngle(K.head.pitch, G.q * A.pitch * chew));
    }
    // Sheep legs: each hoof planted and pushed back, then lifted and swung forward; a walk that
    // turns into a trot as it speeds up, the body rising and dipping a little with each step.
    if (K.legs) {
      const moving = a.moving && v > 0.05, g = sheepGait(v, S.stride);
      A.gait = (A.gait + (moving ? (v * step) / g.stride : 0)) % 1;
      A.legAmp = lerp(A.legAmp || 0, moving ? 1 : 0, Math.min(1, step * 6));
      A.root.position.y += (lerp(0.012, 0.03, g.trot) * (0.5 + 0.5 * Math.cos(A.gait * Math.PI * 4)) - lerp(0.012, 0.03, g.trot)) * A.legAmp;
      sheepFeet(K, A.root, A.bones, A.gait, g, A.legAmp, a.y);
    }
  }
  hideHerd(sp) {
    const K = this.kinds[sp]; if (!K) return;
    for (const A of K.actors) { if (A.a) A.a._rig = null; A.a = null; A.root.visible = false; }
    if (K.far) for (const im of K.far) { im.count = 0; im.visible = false; }
  }
  // Fox eyes, in world space, for an animal at (x, y, z) facing heading.
  eyesAt(sp, a, out) {
    const K = this.kinds[sp]; if (!K?.eyes) return 0;
    E.set(0, a.heading, 0); Q.setFromEuler(E);
    K.eyes.forEach((e, i) => out[i].copy(e).applyQuaternion(Q).add(V.set(a.x, a.y, a.z)));
    return K.eyes.length;
  }

  // Seals: the scanned seal as instances, its head lifted and turned in the vertex shader.
  drawSeals(list, cap) {
    this.want('seal');
    const K = this.kinds.seal;
    if (!K) return false;
    if (!this.seals) this.seals = this.makeSeals(K, cap);
    const im = this.seals, pose = im.geometry.attributes.iPose, tint = im.geometry.attributes.iCoat;
    const n = Math.min(list.length, cap);
    for (let j = 0; j < n; j++) {
      const s = list[j], sc = s.inWater ? 0.85 : 1;
      E.set(0, s.heading, 0); Q.setFromEuler(E); P.set(s.x, s.y + (s.inWater ? -0.25 : 0), s.z); V.set(sc, sc, sc);
      im.setMatrixAt(j, M.compose(P, Q, V));
      pose.setXYZ(j, s.hp || 0, s.hy || 0, 0);
      C.set(s.look[0]); tint.setXYZ(j, C.r, C.g, C.b);
    }
    im.count = n; im.visible = n > 0;
    im.instanceMatrix.needsUpdate = pose.needsUpdate = tint.needsUpdate = true;
    return true;
  }
  makeSeals(K, cap) {
    let mesh = null; K.template.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
    K.template.updateMatrixWorld(true);
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geo.setAttribute('iPose', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('iCoat', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3));
    const box = K.box, len = box.max.z - box.min.z, neck = box.max.z - len * 0.24, tail = box.min.z + len * 0.2, hgt = box.max.y;
    const mat = mesh.material.clone();
    mat.roughness = 0.62; mat.envMapIntensity = 0.3; // wet, but dark
    mat.onBeforeCompile = (s) => {
      s.vertexShader = `attribute vec3 iPose; attribute vec3 iCoat; varying vec3 vTint;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
` + s.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  // Head: lift (iPose.x, negative raises it) and turn (iPose.y) about the neck; the hind flippers
  // rise a little with it, as a resting seal bends into a banana.
  float wHead = smoothstep(${(neck - len * 0.08).toFixed(3)}, ${(neck + len * 0.06).toFixed(3)}, position.z);
  float wTail = smoothstep(${(tail + len * 0.05).toFixed(3)}, ${(tail - len * 0.15).toFixed(3)}, position.z);
  mat3 headR = rotY(iPose.y * wHead) * rotX(iPose.x * wHead);
  mat3 tailR = rotX(iPose.x * 0.5 * wTail);
  objectNormal = headR * tailR * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec3 pivH = vec3(0.0, ${(hgt * 0.45).toFixed(3)}, ${neck.toFixed(3)}), pivT = vec3(0.0, ${(hgt * 0.2).toFixed(3)}, ${tail.toFixed(3)});
  transformed = headR * (transformed - pivH) + pivH;
  transformed = tailR * (transformed - pivT) + pivT;
  vTint = iCoat;`);
      s.fragmentShader = 'varying vec3 vTint;\n' + s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= vTint;');
    };
    mat.customProgramCacheKey = () => 'seal-bend';
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
    this.scene.add(im);
    return im;
  }

  // Puffins: the scanned bird as instances. Standing ones turn and dip the head (vertex shader);
  // flying ones are the low-poly copy laid flat with its head straight, and short dark wings that
  // whirr, as a puffin's do (they hardly glide).
  // stand: [{ x, y, z, heading, hy, nod }], fly: [{ x, y, z, heading, pitch, bank, flap }].
  drawPuffins(stand, fly, capStand, capFly) {
    this.want('puffin');
    const K = this.kinds.puffin;
    if (!K) return false;
    if (!this.puffins) this.puffins = this.makePuffins(K, capStand, capFly);
    const { sit, air } = this.puffins, pose = sit.geometry.attributes.iPose, flap = air.geometry.attributes.iFlap;
    const n = Math.min(stand.length, capStand);
    for (let j = 0; j < n; j++) {
      const b = stand[j];
      E.set(0, b.heading, 0); Q.setFromEuler(E); P.set(b.x, b.y, b.z);
      sit.setMatrixAt(j, M.compose(P, Q, S.set(1, 1, 1)));
      pose.setXY(j, b.nod, b.hy);
    }
    sit.count = n; sit.visible = n > 0;
    const m = Math.min(fly.length, capFly);
    for (let j = 0; j < m; j++) {
      const b = fly[j];
      E.set(b.pitch, b.heading, b.bank); Q.setFromEuler(E); P.set(b.x, b.y, b.z);
      air.setMatrixAt(j, M.compose(P, Q, S.set(1, 1, 1)));
      flap.setX(j, b.flap);
    }
    air.count = m; air.visible = m > 0;
    sit.instanceMatrix.needsUpdate = pose.needsUpdate = air.instanceMatrix.needsUpdate = flap.needsUpdate = true;
    return true;
  }
  hidePuffins() { if (this.puffins) this.puffins.sit.visible = this.puffins.air.visible = false; }
  makePuffins(K, capStand, capFly) {
    let body = null, lod = null;
    K.template.traverse((o) => { if (o.isMesh) { if (/_lod$/.test(o.name)) lod = o; else body = o; } });
    K.template.updateMatrixWorld(true);
    const H = K.box.max.y;
    // The neck, where the head turns, and which way the scan's head looks (it is turned aside): the
    // beak tip is the point of the head farthest out from the neck.
    const sitGeo = plainGeo(body), p = sitGeo.attributes.position;
    const neck = new THREE.Vector3(); let nn = 0, far = 0, look = 0;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.64 * H && y < 0.7 * H) { neck.x += p.getX(i); neck.z += p.getZ(i); nn++; } }
    neck.set(neck.x / nn, 0.68 * H, neck.z / nn);
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.7 * H) {
      const dx = p.getX(i) - neck.x, dz = p.getZ(i) - neck.z;
      if (dx * dx + dz * dz > far) { far = dx * dx + dz * dz; look = Math.atan2(dx, dz); }
    }
    const h0 = (0.6 * H).toFixed(4), h1 = (0.74 * H).toFixed(4), fix = (-look).toFixed(4);
    const piv = `vec3(${neck.x.toFixed(4)}, ${neck.y.toFixed(4)}, ${neck.z.toFixed(4)})`;
    const ROT = `mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
`;
    const base = body.material;
    base.roughness = 0.8; base.envMapIntensity = 0.3;

    // Standing: the head straightened, then dipped (iPose.x) and turned (iPose.y) about the neck.
    sitGeo.setAttribute('iPose', new THREE.InstancedBufferAttribute(new Float32Array(capStand * 2), 2));
    const sitMat = base.clone();
    sitMat.onBeforeCompile = (s) => {
      s.vertexShader = 'attribute vec2 iPose;\n' + ROT + s.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  float wHead = smoothstep(${h0}, ${h1}, position.y);
  mat3 headR = rotY(iPose.y * wHead) * rotX(iPose.x * wHead) * rotY(${fix} * wHead);
  objectNormal = headR * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed = headR * (transformed - ${piv}) + ${piv};`);
    };
    sitMat.customProgramCacheKey = () => 'puffin-sit';
    const sit = new THREE.InstancedMesh(sitGeo, sitMat, capStand);
    sit.count = 0; sit.frustumCulled = false; sit.castShadow = true; sit.receiveShadow = true;

    // Flying: the low-poly copy with its head straightened and raised in line with the body, tipped
    // forward to lie flat (head first, belly down, feet trailing), centred, with a pair of wings.
    const g = plainGeo(lod), gp = g.attributes.position, gn = g.attributes.normal;
    const Rh = new THREE.Matrix3(), m4 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), TILT = 1.45;
    for (let i = 0; i < gp.count; i++) {
      const w = THREE.MathUtils.smoothstep(gp.getY(i), 0.6 * H, 0.74 * H);
      if (!w) continue;
      Rh.setFromMatrix4(m4.makeRotationX(-TILT * w).multiply(m2.makeRotationY(-look * w)));
      V.fromBufferAttribute(gp, i).sub(neck).applyMatrix3(Rh).add(neck); gp.setXYZ(i, V.x, V.y, V.z);
      V.fromBufferAttribute(gn, i).applyMatrix3(Rh); gn.setXYZ(i, V.x, V.y, V.z);
    }
    g.translate(0, -0.45 * H, -neck.z).applyMatrix4(m4.makeRotationX(TILT));
    g.computeBoundingBox();
    const fb = g.boundingBox, len = fb.max.z - fb.min.z, half = (fb.max.x - fb.min.x) / 2;
    g.translate(0, -(fb.max.y + fb.min.y) / 2, -(fb.max.z + fb.min.z) / 2);
    g.setAttribute('aWing', new THREE.BufferAttribute(new Float32Array(gp.count), 1));
    // Wings: narrow and pointed, swept back from the shoulder; aWing is the side times how far out.
    const zs = len * 0.12, ys = (fb.max.y - fb.min.y) * 0.18, x0 = half * 0.55, span = 0.22, wp = [], wn = [], wa = [];
    const st = [0, 0.35, 0.7, 1].map((t) => { const le = zs + 0.02 - t * 0.045, ch = 0.075 * (1 - 0.78 * t); return [x0 + t * span, le, le - ch, t]; });
    for (const side of [1, -1]) for (const up of [1, -1]) for (let k = 0; k < 3; k++) {
      const [xa, la, ta, sa] = st[k], [xb, lb, tb, sb] = st[k + 1];
      let quad = [[xa, la, sa], [xb, lb, sb], [xb, tb, sb], [xa, la, sa], [xb, tb, sb], [xa, ta, sa]];
      if (side * up < 0) quad = [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]];
      for (const [x, z, t] of quad) { wp.push(side * x, ys, z); wn.push(0, up, 0); wa.push(side * (0.001 + t)); }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(wp.length / 3 * 2), 2));
    wg.setAttribute('aWing', new THREE.Float32BufferAttribute(wa, 1));
    const airGeo = mergeGeometries([g.index ? g.toNonIndexed() : g, wg]);
    airGeo.setAttribute('iFlap', new THREE.InstancedBufferAttribute(new Float32Array(capFly), 1));
    const airMat = base.clone();
    airMat.onBeforeCompile = (s) => {
      s.vertexShader = 'attribute float aWing; attribute float iFlap; varying float vWing;\n' + ROT + s.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  // Each wing swings about the body's long axis at its root, the tip a little more.
  float side = sign(aWing), wOut = abs(aWing);
  mat3 wingR = rotZ(side * iFlap * (0.85 + 0.3 * wOut) * step(0.0005, wOut));
  objectNormal = wingR * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec3 root = vec3(side * ${x0.toFixed(4)}, ${ys.toFixed(4)}, transformed.z);
  transformed = wingR * (transformed - root) + root;
  vWing = wOut;`);
      s.fragmentShader = 'varying float vWing;\n' + s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  if (vWing > 0.0005) diffuseColor.rgb = vec3(0.008, 0.008, 0.009);`);
    };
    airMat.customProgramCacheKey = () => 'puffin-fly';
    const air = new THREE.InstancedMesh(airGeo, airMat, capFly);
    air.count = 0; air.frustumCulled = false; air.receiveShadow = true;
    this.scene.add(sit, air);
    return { sit, air };
  }

  // Whales and dolphins: a rig playing its swim cycle. Returns null until the model is in.
  swimmer(sp) {
    this.want(sp);
    const K = this.kinds[sp];
    if (!K) return null;
    const root = cloneRig(K.template);
    root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; if (/_lod$/.test(o.name)) o.visible = false; } });
    const outer = new THREE.Group(); outer.add(root); outer.visible = false;
    this.scene.add(outer);
    const mixer = new THREE.AnimationMixer(root), clip = K.clips.swim;
    if (clip) { const a = mixer.clipAction(clip); a.play(); a.time = Math.random() * clip.duration; }
    return { mesh: outer, mixer, length: K.box.max.z - K.box.min.z };
  }
}
