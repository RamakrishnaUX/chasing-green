import * as THREE from 'three';
import { createWaterMaterial } from './materials.js';

// Strokkur, as it really erupts. The geyser is a pool of hot water about 11 m across over a narrow
// vent. Between eruptions the water in the vent breathes, rising and sinking a little. Before an
// eruption it surges once or twice, then a smooth turquoise dome of water swells over the vent,
// a metre and a half high in half a second (steam rising from below lifts the water), and tears
// open: the first water flies out and up as sheets and clumps from the dome's skin, and the
// column follows, 15 to 30 m high, for a second or two in pulses, with steam boiling out round it.
// The water rains back down onto the sinter and into the pool, the pool is sucked down into the
// vent (it gurgles and drains to the vent's throat), and then refills over the next quarter of a
// minute, while the steam cloud climbs, spreads and drifts off on the wind. Now and then a second,
// smaller eruption follows a few seconds after the first. (The real one erupts every 5 to 10
// minutes; here every minute or so, so you need not wait long.)
//
// The water and the steam are particles drawn on the GPU, each moving on its own ballistic path
// from when and where it left the vent (no work per particle on the processor): position, speed,
// size and how see-through it is are all worked out in the shader from the time since the
// eruption began.

const JET_N = 3200, STEAM_N = 300, G = 9.81;
const R_POOL = 5.4, LEVEL = 0.28; // the pool's radius and its water level (local height)

const hash = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

const COMMON = /* glsl */ `
uniform float uT; uniform float uPower; uniform vec2 uWind; uniform float uLight; uniform float uViewH;
float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hh(i), hh(i+vec2(1,0)), f.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), f.x), f.y); }
`;

// The water: launched from the vent (or, the first wave, from the dome's skin) at aLaunch seconds
// into the eruption with velocity aVel, under gravity and a little air drag, pushed by the wind as
// it breaks up. A clump grows and thins as it falls, and is gone where it lands.
const JET_VERT = COMMON + /* glsl */ `
attribute vec3 aVel; attribute vec4 aInfo; // x launch time, y size, z seed, w first wave (0/1)
varying float vA; varying float vSeed; varying float vLit;
void main(){
  float t = uT - aInfo.x;
  vec3 v = aVel * vec3(1.0, uPower, 1.0) * mix(1.0, uPower, 0.5);
  // Drag: horizontal speed bleeds away, the climb a little sooner than in a vacuum.
  float k = 0.35, drag = (1.0 - exp(-k * max(t, 0.0))) / k;
  vec3 p = position + vec3(v.x * drag, v.y * t - 0.5 * ${G.toFixed(2)} * t * t - 0.06 * v.y * t * t, v.z * drag);
  p.xz += uWind * 0.18 * t * t;
  float up = v.y / ${G.toFixed(2)};
  float life = up + sqrt(max(0.0, up * up + 2.0 * max(position.y, 0.0) / ${G.toFixed(2)})) + 0.4;
  float age = clamp(t / life, 0.0, 1.0);
  float alive = step(0.0, t) * step(t, life) * step(-0.3, p.y);
  // Dense and white rising, breaking into thinner spray as it comes down; gone as it lands.
  vA = alive * mix(0.85, 0.22, smoothstep(0.3, 0.95, age)) * smoothstep(-0.3, 0.6, p.y) * mix(1.0, 0.55, aInfo.w);
  vSeed = aInfo.z;
  vLit = 0.55 + 0.45 * smoothstep(0.0, 18.0, p.y); // the column's foot is in its own shade
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aInfo.y * (1.0 + 1.3 * age) * alive;
  gl_PointSize = min(700.0, size * projectionMatrix[1][1] * uViewH * 0.5 / max(0.5, -mv.z));
}`;
const JET_FRAG = COMMON + /* glsl */ `
varying float vA; varying float vSeed; varying float vLit;
void main(){
  if (vA < 0.004) discard;
  vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.0;
  // Torn white water, wisps and threads rather than a ball: noise cut into the sprite, turned
  // differently in each, so neighbours run together into one column.
  float an = vSeed * 6.2831, cs = cos(an), sn = sin(an);
  vec2 r = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
  float n = nn(r * 4.0 + vSeed * 31.0) * 0.5 + nn(r * 9.0 - vSeed * 17.0) * 0.3 + nn(r * 19.0 + vSeed * 5.0) * 0.2;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * smoothstep(0.32, 0.72, n + (1.0 - d) * 0.25) * vA;
  if (a < 0.01) discard;
  // As bright as white things in the sun are here (about 2.5 before the tone curve), or it reads grey.
  vec3 c = vec3(0.88, 0.94, 1.0) * (0.22 + 2.5 * uLight) * vLit * (0.88 + 0.2 * n);
  gl_FragColor = vec4(c, a);
}`;

// The steam: carried up with the column, then rising on its own heat, slowing, spreading and
// drifting off downwind, thinning to nothing over a quarter of a minute.
const STEAM_VERT = COMMON + /* glsl */ `
attribute vec4 aInfo; attribute vec3 aDir; // aInfo: x launch time, y start size, z seed, w height it is carried to
varying float vA; varying float vSeed;
void main(){
  float t = uT - aInfo.x, life = 14.0 + aInfo.z * 8.0;
  float carried = aInfo.w * uPower * (1.0 - exp(-t / 0.9));      // up with the column
  float rise = 0.7 * t;                                          // then on its own heat
  vec3 p = position + vec3(aDir.x * (1.0 - exp(-t / 3.0)) * 4.0, carried + rise, aDir.z * (1.0 - exp(-t / 3.0)) * 4.0);
  p.xz += uWind * (0.9 * t + 0.03 * t * t);
  float age = clamp(t / life, 0.0, 1.0);
  float alive = step(0.0, t) * step(t, life);
  vA = alive * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.2, 1.0, age)) * 0.13;
  vSeed = aInfo.z;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (aInfo.y + 7.0 * sqrt(age)) * alive;
  gl_PointSize = min(900.0, size * projectionMatrix[1][1] * uViewH * 0.5 / max(0.5, -mv.z));
}`;
const STEAM_FRAG = COMMON + /* glsl */ `
varying float vA; varying float vSeed;
void main(){
  if (vA < 0.003) discard;
  vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.0;
  float n = nn(q * 3.0 + vSeed * 13.0 + uT * 0.05) * 0.55 + nn(q * 7.0 - vSeed * 7.0) * 0.3 + nn(q * 15.0 + vSeed) * 0.15;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - smoothstep(0.0, 1.0, d)) * smoothstep(0.25, 0.8, n) * 1.6 * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.9, 0.93, 0.97) * (0.2 + 1.9 * uLight), a);
}`;

function points(geo, vert, frag, uniforms) {
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false; // it reaches far above where it starts
  p.userData.dynamic = true;
  p.visible = false;
  return p;
}

function jetGeometry() {
  const pos = new Float32Array(JET_N * 3), vel = new Float32Array(JET_N * 3), info = new Float32Array(JET_N * 4);
  for (let i = 0; i < JET_N; i++) {
    const r = (k) => hash(i, k), first = i < JET_N * 0.28;
    const a = r(1) * Math.PI * 2;
    if (first) {
      // The dome's skin tearing open: from all over the dome, flung out and up along its surface.
      const el = Math.acos(1 - r(2) * 0.95), R = 1.5;
      const nx = Math.sin(el) * Math.cos(a), ny = Math.cos(el), nz = Math.sin(el) * Math.sin(a);
      pos.set([nx * R, LEVEL + ny * 1.3, nz * R], i * 3);
      const sp = 6 + r(3) * 9;
      vel.set([nx * sp * 0.32 + (r(4) - 0.5) * 0.6, 8 + ny * 9 + r(5) * 5, nz * sp * 0.32 + (r(6) - 0.5) * 0.6], i * 3);
      info.set([r(7) * 0.12, 0.32 + r(8) * 0.5, r(9), 1], i * 4);
    } else {
      // The column: out of the vent in pulses over a second and a half, the first the fastest.
      const rr = Math.sqrt(r(2)) * 0.85;
      pos.set([Math.cos(a) * rr, LEVEL + r(3) * 0.6, Math.sin(a) * rr], i * 3);
      const u = Math.pow(r(4), 1.7), launch = 0.05 + u * 1.5;
      const pulse = 0.75 + 0.25 * Math.cos(launch * 9.0);
      const vy = (15 + r(5) * 9) * (1.05 - 0.45 * u) * pulse;
      const spread = (0.15 + Math.pow(r(6), 2.5) * 1.15) * (1 + (1 - pulse) * 1.2);
      vel.set([Math.cos(a + r(10)) * spread, vy, Math.sin(a + r(10)) * spread], i * 3);
      info.set([launch, 0.3 + r(8) * 0.55, r(9), 0], i * 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  return g;
}

function steamGeometry() {
  const pos = new Float32Array(STEAM_N * 3), dir = new Float32Array(STEAM_N * 3), info = new Float32Array(STEAM_N * 4);
  for (let i = 0; i < STEAM_N; i++) {
    const r = (k) => hash(i + 5000, k), a = r(1) * Math.PI * 2, rr = r(2) * 0.9;
    pos.set([Math.cos(a) * rr, LEVEL + 0.5, Math.sin(a) * rr], i * 3);
    dir.set([Math.cos(a) * r(3), 0, Math.sin(a) * r(3)], i * 3);
    // Carried to anywhere up the column, most low down; set off over the first two seconds.
    info.set([r(4) * 2.0, 1.2 + r(5) * 1.6, r(6), 2 + Math.pow(r(7), 1.2) * 24], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  return g;
}

// The sinter round the pool: a low, pale apron rising to a lip, a shallow bowl inside it, and the
// vent's throat in the middle going down out of sight. Wet ground is darker and browner.
function sinter() {
  const prof = [[13, -0.35], [9, 0.02], [6.4, 0.3], [5.75, 0.38], [5.35, 0.3], [3.8, 0.1], [2.1, -0.08], [1.35, -0.55], [1.05, -1.6], [0.95, -3.2]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 72, 0, Math.PI * 2);
  const P = g.attributes.position, col = new Float32Array(P.count * 3), c = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
    const n = 0.5 + 0.5 * Math.sin(a * 7 + r * 1.3) * Math.sin(a * 3 - r * 0.7);
    if (r < 5.4) c.setRGB(0.66, 0.71, 0.69).lerp(new THREE.Color(0.36, 0.44, 0.46), THREE.MathUtils.smoothstep(r, 2.4, 1.0)); // under the water: pale silica, darker down the throat
    else if (r < 6.6) c.setRGB(0.83, 0.81, 0.75).lerp(new THREE.Color(0.62, 0.55, 0.45), n * 0.4); // the lip: white sinter, rust where it stays wet
    else c.setRGB(0.6, 0.55, 0.47).lerp(new THREE.Color(0.42, 0.37, 0.31), n * 0.6 + THREE.MathUtils.smoothstep(r, 7, 12) * 0.3); // the apron, wet with run-off
    c.convertSRGBToLinear();
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }));
  m.userData.keepShape = true;
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function buildGeyser(kit) {
  const g = new THREE.Group();
  g.add(sinter());

  // The rope round it, on short posts, as at the real one.
  const post = new THREE.CylinderGeometry(0.05, 0.06, 0.9, 6), rope = new THREE.CylinderGeometry(0.015, 0.015, 1, 4);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 0.9 }), ropeMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.9 });
  const NP = 18, RP = 8.2;
  for (let k = 0; k < NP; k++) {
    const a = (k / NP) * Math.PI * 2, b = ((k + 1) / NP) * Math.PI * 2;
    const x = Math.cos(a) * RP, z = Math.sin(a) * RP, y = kit.ground(x, z);
    const p = new THREE.Mesh(post, postMat); p.position.set(x, y + 0.45, z); g.add(p);
    const x2 = Math.cos(b) * RP, z2 = Math.sin(b) * RP, y2 = kit.ground(x2, z2);
    const r = new THREE.Mesh(rope, ropeMat), L = Math.hypot(x2 - x, z2 - z);
    r.scale.y = L; r.position.set((x + x2) / 2, (y + y2) / 2 + 0.75, (z + z2) / 2);
    r.rotation.set(0, -Math.atan2(z2 - z, x2 - x), Math.PI / 2);
    g.add(r);
  }

  // The pool: deep blue over the vent, pale turquoise over the white silica of the bowl.
  const poolMat = createWaterMaterial(0x2a9fc4, { roughness: 0.04, ripple: 0.45, shallow: [0.3, 0.72, 0.8], deep: [0.0, 0.16, 0.36], depthAware: false, foam: 0, glow: 0.12, bowl: 4.5 });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(R_POOL, 64), poolMat);
  pool.rotation.x = -Math.PI / 2; pool.position.y = LEVEL;
  pool.userData.dynamic = true;
  g.add(pool);
  // Foam where the column came down, spreading and fading across the pool.
  const foamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uAmt: { value: 0 }, uTime: kit.waterUniforms.uTime, uLight: kit.waterUniforms.uLight },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uAmt; uniform float uTime; uniform float uLight; varying vec2 vUv;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hh(i), hh(i+vec2(1,0)), f.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), f.x), f.y); }
      void main(){ vec2 q = vUv - 0.5; float r = length(q) * 2.0;
        float n = nn(q * 18.0 + uTime * 0.6) * 0.6 + nn(q * 41.0 - uTime) * 0.4;
        float a = smoothstep(0.45, 0.8, n) * (1.0 - smoothstep(0.75, 1.0, r)) * uAmt;
        gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * (0.35 + 0.7 * uLight), a * 0.85); }`,
  });
  const foam = new THREE.Mesh(new THREE.CircleGeometry(R_POOL, 48), foamMat);
  foam.rotation.x = -Math.PI / 2; foam.position.y = LEVEL + 0.02;
  foam.userData.dynamic = true; foam.visible = false;
  g.add(foam);

  // The dome of water: a little more than half a sphere, so it bulges out over the vent like a
  // real bubble, glassy and turquoise, lit from inside by the pool, trembling as it swells.
  const wob = { value: 0 }, domeTime = kit.waterUniforms.uTime;
  const domeMat = new THREE.MeshStandardMaterial({ color: 0x4fc3df, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.88, emissive: 0x0b6782, emissiveIntensity: 0.55, envMapIntensity: 1.6 });
  domeMat.customProgramCacheKey = () => 'geyser-dome';
  domeMat.onBeforeCompile = (s) => {
    s.uniforms.uWob = wob; s.uniforms.uTime = domeTime;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWob; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float wv = sin(position.x * 5.1 + uTime * 23.0) * sin(position.z * 4.7 - uTime * 19.0) + 0.5 * sin(position.y * 9.0 + uTime * 31.0);
        transformed += normal * wv * uWob;`);
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.58), domeMat);
  dome.position.y = LEVEL - 0.05; dome.visible = false; dome.userData.dynamic = true;
  g.add(dome);

  // The eruption's water and steam, and a second set for a follow-up eruption.
  const uViewH = { value: 900 };
  const uni = () => ({ uT: { value: -1 }, uPower: { value: 1 }, uWind: { value: new THREE.Vector2() }, uLight: kit.waterUniforms.uLight, uViewH });
  const jetGeo = jetGeometry(), steamGeo = steamGeometry();
  const bursts = [0, 1].map(() => {
    const jet = points(jetGeo, JET_VERT, JET_FRAG, uni()), steam = points(steamGeo, STEAM_VERT, STEAM_FRAG, uni());
    g.add(steam, jet);
    return { jet, steam, t: -1, power: 1 };
  });

  // The hot pool steams all the time, more in cold air.
  const mist = kit.makeMist(70, 4.5, 7);
  mist.material = mist.material.clone(); mist.material.opacity = 0.2; mist.material.size = 4.5;
  mist.position.y = LEVEL + 0.3;
  g.add(mist); kit.steam(mist, 0.7);

  // The cycle. wait -> warn (surges, then the dome) -> burst -> drain and refill -> wait.
  let phase = 'wait', timer = 20 + kit.rand() * 25, level = LEVEL, second = -1, sinceBurst = 1e9;
  const bump = (x, a, b) => (x <= a || x >= b ? 0 : Math.sin(Math.PI * (x - a) / (b - a)));
  const start = (b, power) => { b.t = 0; b.power = power; b.jet.visible = b.steam.visible = true; kit.emit('geyser-erupt'); };
  kit.update((dt, t, env) => {
    uViewH.value = (globalThis.innerHeight || 900) * Math.min(2, globalThis.devicePixelRatio || 1);
    // The wind in the landmark's own frame, for the spray and the steam.
    const wx = env.wind?.x || 0, wz = env.wind?.z || 0, lw = [wx * kit.cs - wz * kit.sn, wx * kit.sn + wz * kit.cs];
    timer -= dt; sinceBurst += dt;
    let domeH = 0, domeR = 1;
    if (phase === 'wait') {
      // The vent breathes: the water heaves up and sinks back every few seconds, more as the
      // eruption nears, with a small swell over the vent now and then.
      const near = 1 - Math.min(1, timer / 12);
      domeH = 0.12 * near * Math.max(0, Math.sin(t * 2.1)) * (0.6 + 0.4 * Math.sin(t * 0.7));
      domeR = 0.9;
      if (timer <= 0) { phase = 'warn'; timer = 2.4; kit.emit('geyser-warning'); }
    } else if (phase === 'warn') {
      const k = 2.4 - timer;
      // Two surges, then the dome: up to 1.5 m in half a second, widening as it swells.
      domeH = 0.4 * bump(k, 0.0, 0.7) + 0.55 * bump(k, 0.9, 1.6);
      domeR = 1.0 + 0.2 * (domeH > 0 ? 1 : 0);
      if (k > 1.75) { const s = Math.min(1, (k - 1.75) / 0.6); const e = 1 - Math.pow(1 - s, 2.2); domeH = 0.15 + 1.4 * e; domeR = 1.15 + 0.5 * e; }
      if (timer <= 0) {
        phase = 'erupt'; sinceBurst = 0;
        start(bursts[0], 0.85 + kit.rand() * 0.35);
        second = kit.rand() < 0.3 ? 2.5 + kit.rand() * 2 : -1;
      }
    }
    // A follow-up eruption, smaller, out of the half-drained pool.
    if (second > 0 && sinceBurst >= second) { start(bursts[1], 0.5 + kit.rand() * 0.25); second = -1; }
    if (phase === 'erupt') {
      // The pool, thrown out and sucked down into the vent, gurgling, then filling up again.
      const s = sinceBurst;
      const down = THREE.MathUtils.smoothstep(s, 0.8, 3.0), up = THREE.MathUtils.smoothstep(s, 5, 24);
      level = LEVEL - 0.85 * down * (1 - up) + 0.04 * Math.sin(s * 9) * down * (1 - up);
      foamMat.uniforms.uAmt.value = THREE.MathUtils.smoothstep(s, 1.0, 2.2) * (1 - THREE.MathUtils.smoothstep(s, 3, 9));
      if (s > 26) { phase = 'wait'; timer = 40 + kit.rand() * 50; level = LEVEL; }
    }
    pool.position.y = level; foam.position.y = level + 0.02; foam.visible = foamMat.uniforms.uAmt.value > 0.01;
    // The dome rises out of the water's surface, trembling more the bigger it grows.
    dome.visible = domeH > 0.01;
    if (dome.visible) { dome.scale.set(domeR, domeH, domeR); dome.position.y = level - 0.05; wob.value = 0.012 + 0.03 * domeH; }
    for (const b of bursts) {
      if (b.t < 0) continue;
      b.t += dt;
      for (const p of [b.jet, b.steam]) { const u = p.material.uniforms; u.uT.value = b.t; u.uPower.value = b.power; u.uWind.value.set(lw[0], lw[1]); }
      b.jet.visible = b.t < 7;
      b.steam.visible = b.t < 24;
      if (b.t > 24) b.t = -1;
    }
  });
  // For testing from the console: erupt now (the vent's breathing and the warning first).
  g.userData.erupt = () => { phase = 'wait'; timer = 0; };
  return g;
}
