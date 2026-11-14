// Waterfalls, built to behave like real falling water.
//
// - The sheet follows a ballistic path off the lip (horizontal speed v0, gravity), so heavy rivers
//   arc out and thin ones drop close to the rock. Its texture travels with the water: it is
//   sampled at (position along the lip, time of flight - time), so features fall at the right
//   speed and stretch as the water accelerates, exactly as streaks do in a real fall.
// - Water leaves the lip glassy and dark, takes in air as it falls and turns white, and lower down
//   breaks into ropes with gaps; the edges fray. It is lit by the scene (sun, sky, shadows, the
//   environment reflection on the glassy part) and glows where the sun shines through it.
// - Spray, mist and the foam on the pool are animated entirely on the GPU: no per-frame CPU work.
// - A rainbow appears in the spray where the physics puts one: 42 degrees from the point
//   opposite the sun.
// - Cliffs are layered lava flows: ledges, overhangs, columns, wet dark rock beside the water and
//   moss where the spray keeps it damp.
import * as THREE from 'three';
import { surfaceUniforms, rockMaterial, createTerrainMaterial, createPoolMaterial } from './materials.js';
import { fogSun, HD } from './hd.js';
import { mulberry32, createNoise2D, clamp } from './noise.js';
import { waterTex } from './water.js';

// Shared uniforms so every waterfall dims at night and picks up aurora light.
export const waterUniforms = { uTime: { value: 0 }, uLight: { value: 1 }, uTint: { value: new THREE.Color(0x000000) } };
// The light that unlit effects (spray, mist) use: the sun's colour and the sky's, the wind.
export const fallLight = {
  uSunCol: { value: new THREE.Color(3, 2.85, 2.6) }, uAmb: { value: new THREE.Color(0.75, 0.8, 0.86) },
  uWind: { value: new THREE.Vector3() }, uViewH: { value: 800 },
};
export function updateFalls(env) {
  if (env.light) { fallLight.uSunCol.value.copy(env.light.sun); fallLight.uAmb.value.copy(env.light.amb); waterTex.uSunCol.value.copy(env.light.sun); waterTex.uAmbCol.value.copy(env.light.amb); }
  if (env.wind) fallLight.uWind.value.set(env.wind.x * 0.35, 0, env.wind.z * 0.35);
}
const G = 9.8;

// ---------- A tiling noise texture, made once ----------
// Four independent channels of periodic fractal noise. Shaders read it instead of hashing noise
// per pixel (one filtered lookup in place of dozens of hashes).
let noiseTexture = null;
export function fallNoise() {
  if (noiseTexture) return noiseTexture;
  const N = 256, data = new Uint8Array(N * N * 4);
  const lattice = (P, seed) => { const r = mulberry32(seed), a = new Float32Array(P * P); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
  const vn = (a, P, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a00 = a[y0 * P + x0], a10 = a[y0 * P + x1], a01 = a[y1 * P + x0], a11 = a[y1 * P + x1];
    return (a00 + (a10 - a00) * fx) * (1 - fy) + (a01 + (a11 - a01) * fx) * fy;
  };
  // [periods, weights, ridged]
  const chans = [
    [[4, 8, 16, 32], [0.5, 0.26, 0.15, 0.09], false],
    [[8, 16, 32, 64], [0.45, 0.28, 0.17, 0.1], false],
    [[4, 8, 16, 32], [0.5, 0.25, 0.15, 0.1], true],
    [[32, 64, 128], [0.5, 0.3, 0.2], false],
  ];
  const lats = chans.map(([ps], c) => ps.map((P, k) => lattice(P, 101 + c * 17 + k * 5)));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    for (let c = 0; c < 4; c++) {
      const [ps, ws, ridged] = chans[c];
      let v = 0;
      for (let k = 0; k < ps.length; k++) {
        let s = vn(lats[c][k], ps[k], x / N * ps[k], y / N * ps[k]);
        if (ridged) s = 1 - Math.abs(s * 2 - 1);
        v += s * ws[k];
      }
      // Stretch contrast a little so thresholds in the shaders bite.
      v = clamp((v - 0.5) * 1.6 + 0.5, 0, 1);
      data[(y * N + x) * 4 + c] = Math.round(v * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  noiseTexture = t;
  return t;
}

// ---------- Lips ----------
// A lip is a list of points along the edge the water leaves, each with the horizontal direction
// the water goes (n). Local frame: +z faces the viewer.
export function straightLip(width, y = 0, z = 0, n = null) {
  const cols = n || Math.max(6, Math.round(width * 1.4));
  const pts = [];
  for (let i = 0; i <= cols; i++) pts.push({ x: (i / cols - 0.5) * width, y, z, nx: 0, nz: 1 });
  return pts;
}
// An arc of lip round (cx, cz), radius R, from angle a0 to a1 (0 = toward -z, the back), water
// flowing toward the centre (a horseshoe).
export function arcLip(R, a0, a1, y = 0, cx = 0, cz = 0, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n), sx = Math.sin(a), sz = -Math.cos(a);
    pts.push({ x: cx + sx * R, y, z: cz + sz * R, nx: -sx, nz: -sz });
  }
  return pts;
}

// ---------- The falling sheet ----------
// drop: how far the water falls (number, or a function of the lip point). v0: speed over the
// lip in m/s. spread: how much the sheet fans out sideways per metre fallen. approach: metres of
// glassy river shown running up to the lip.
export function sheetGeometry(lip, { drop, v0 = 2, rows = 24, spread = 0.06, approach = 2, wobble = 0 } = {}) {
  const cols = lip.length;
  const s = [0];
  for (let i = 1; i < cols; i++) s.push(s[i - 1] + Math.hypot(lip[i].x - lip[i - 1].x, lip[i].z - lip[i - 1].z));
  const L = s[cols - 1] || 1;
  const pos = [], uv = [], fall = [], idx = [];
  const AR = 3; // rows above the lip
  const R = AR + rows + 1;
  for (let i = 0; i < cols; i++) {
    const p = lip[i];
    const a = lip[Math.max(0, i - 1)], b = lip[Math.min(cols - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const D = typeof drop === 'function' ? drop(p, i) : drop;
    const T = Math.sqrt(2 * Math.max(D, 0.1) / G);
    const side = s[i] / L * 2 - 1;
    const v = v0 * (1 + wobble * Math.sin(i * 1.7) * 0.3);
    for (let r = 0; r < R; r++) {
      let x, y, z, tau, d;
      if (r < AR) {
        // Running up to the lip: flat, glassy, speeding up.
        const k = 1 - r / AR, back = approach * k;
        x = p.x - p.nx * back; z = p.z - p.nz * back; y = p.y + 0.06 * k;
        tau = -back / Math.max(v, 0.5); d = -back;
      } else {
        const k = (r - AR) / rows, t = T * Math.pow(k, 0.85);
        const h = v * t; d = 0.5 * G * t * t; tau = t;
        const lat = side * spread * d;
        x = p.x + p.nx * h + tx * lat; z = p.z + p.nz * h + tz * lat; y = p.y - d;
      }
      pos.push(x, y, z);
      uv.push(s[i], d);
      fall.push(tau, d, Math.min(s[i], L - s[i]) + Math.max(d, 0) * spread, Math.max(d, 0) / Math.max(D, 0.1));
    }
  }
  for (let i = 0; i < cols - 1; i++) for (let r = 0; r < R - 1; r++) {
    const a = i * R + r, b = (i + 1) * R + r;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const sheetMats = new Map();
// color: the river's own colour as it goes over (clear blue-green, or milky grey-brown for
// glacial rivers). aerate: metres of fall to turn mostly white. gap: how see-through the gaps
// between ropes are (1 = solid sheet). flow: speed of the pattern (1 = true speed).
export function sheetMaterial({ color = 0x2f5458, aerate = 3, gap = 0.35, flow = 1, scale = 1, opacity = 1, breakup = 0 } = {}) {
  const key = [color, aerate, gap, flow, scale, opacity, breakup].join('|');
  if (sheetMats.has(key)) return sheetMats.get(key);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const u = {
    uNoise: { value: fallNoise() }, uWater: { value: new THREE.Color(color) }, uAerate: { value: aerate },
    uGap: { value: gap }, uFlow: { value: flow }, uScale: { value: scale }, uOpacity: { value: opacity }, uBreak: { value: breakup },
  };
  m.userData.localShading = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, waterUniforms, { uSunDir: surfaceUniforms.uSunDir, uSunCol: fallLight.uSunCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFall; varying vec4 vFall; varying vec2 vFU; varying vec3 vFW; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFall = aFall; vFU = uv;
        // Waves running down the sheet: it bulges and thins as surges of water pass.
        float wv = max(aFall.y, 0.0);
        transformed += objectNormal * (sin(uv.x * 0.7 + (aFall.x - uTime) * 6.0) * 0.07 + sin(uv.x * 2.1 - (aFall.x - uTime) * 10.0) * 0.035) * clamp(wv * 0.5, 0.0, 1.0) * (1.0 + wv * 0.02);`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uNoise; uniform vec3 uWater; uniform float uAerate, uGap, uFlow, uScale, uOpacity, uTime, uLight, uBreak;
        uniform vec3 uTint, uSunDir, uSunCol;
        varying vec4 vFall; varying vec2 vFU; varying vec3 vFW;
        float fAer; float fRope;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float tau = vFall.x, dd = vFall.y, edge = vFall.z, k = vFall.w;
          float ph = tau - uTime * uFlow;
          float x = vFU.x * uScale;
          vec4 A = texture2D(uNoise, vec2(x * 0.045, ph * 0.33));
          vec4 B = texture2D(uNoise, vec2(x * 0.13 + 0.31, ph * 0.9 + 0.17));
          vec4 C = texture2D(uNoise, vec2(x * 0.41 + 0.7, ph * 2.6 + 0.4));
          float aer = 1.0 - exp(-max(dd, 0.0) / uAerate);
          // Surges: the whole river pulses a little, so brightness travels down in waves.
          float surge = A.r;
          float streak = A.g * 0.4 + B.r * 0.35 + C.a * 0.25;
          float rope = smoothstep(0.32, 0.72, streak * 0.85 + surge * 0.3 - 0.08);
          fAer = aer; fRope = rope;
          // Glassy river going over: its own colour, with darker and lighter flow lines.
          vec3 glass = uWater * (0.55 + 0.7 * B.g) ;
          // White water: bright where ropes are thick, greyer in the thin spray between.
          vec3 white = vec3(0.86, 0.9, 0.93) * (0.72 + 0.36 * streak + 0.12 * C.r);
          float wht = clamp(aer * (0.75 + 0.35 * rope) + C.b * 0.12 * step(0.0, dd), 0.0, 1.0);
          diffuseColor.rgb = mix(glass, white, wht);
          // Ragged edges, ropes with gaps lower down, the sheet thinning to spray at the foot.
          float fray = (B.b - 0.5) * 1.6 + (C.g - 0.5) * 0.6;
          float a = smoothstep(0.0, 0.35 + 0.9 * aer, edge + fray * (0.3 + 0.7 * aer));
          a *= mix(1.0, mix(uGap, 1.0, rope), smoothstep(0.5, 6.0, dd));
          a *= mix(0.92, 1.0, aer);
          a *= smoothstep(-2.5, -0.8, dd);                  // the river fades in above the lip
          a *= 1.0 - smoothstep(0.86, 1.0, k) * (1.0 - 0.6 * rope); // breaking up into the boil
          // A long free fall comes apart: lower down the water is clumps and streamers in spray.
          a *= mix(1.0, mix(0.08, 0.85, rope * rope), smoothstep(0.25, 0.9, k) * uBreak);
          diffuseColor.a *= clamp(a, 0.0, 1.0) * uOpacity;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.07, 0.6, fAer);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Sun shining through aerated water toward the eye; aurora light on the spray at night.
          vec3 vd = normalize(vFW - cameraPosition);
          float through = pow(max(dot(vd, uSunDir), 0.0), 5.0);
          totalEmissiveRadiance += uSunCol * through * (0.18 + 0.25 * fRope) * fAer;
          totalEmissiveRadiance += uTint * 0.6 * fAer;
        }`);
  };
  m.customProgramCacheKey = () => 'fall-sheet';
  sheetMats.set(key, m);
  return m;
}

export function makeSheet(lip, geo = {}, mat = {}) {
  const mesh = new THREE.Mesh(sheetGeometry(lip, geo), sheetMaterial(mat));
  mesh.renderOrder = 2;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.notGround = true;
  return mesh;
}

// ---------- Spray, mist and rainbow (GPU-animated points) ----------
const PARTICLE_VERT = /* glsl */ `
uniform float uTime, uLife, uSpeed, uRise, uSize, uGrav, uDrag, uViewH, uOpacity, uKind;
uniform vec3 uA, uB, uOut, uWind;
attribute vec4 aSeed;
varying float vA; varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  float life = uLife * (0.55 + 0.9 * aSeed.y);
  float age = mod(uTime + aSeed.x * 61.0, life);
  float k = age / life;
  vec3 base = mix(uA, uB, position.x);
  vec3 side = normalize(cross(uOut, vec3(0.0, 1.0, 0.0)) + 1e-4);
  vec3 p;
  if (uKind < 0.5) {
    // Droplets thrown out of the impact: ballistic, with drag.
    vec3 v = (uOut * (0.4 + position.y) + side * (position.z - 0.5) * 1.2 + vec3(0.0, uRise * (0.3 + aSeed.z), 0.0)) * uSpeed;
    float tt = (1.0 - exp(-uDrag * age)) / uDrag;
    p = base + v * tt + vec3(0.0, -0.5 * uGrav * age * age, 0.0) + uWind * age;
    p.y = max(p.y, base.y - 0.2);
    vA = (1.0 - k) * smoothstep(0.0, 0.08, k);
  } else {
    // Mist: billows up and out, slows, spreads and drifts off on the wind.
    vec3 dir = normalize(uOut * (0.3 + position.y * 0.9) + side * (position.z - 0.5) * 1.4 + vec3(0.0, uRise * (0.6 + aSeed.z * 0.8), 0.0));
    float travel = uSpeed * life * (1.0 - exp(-2.2 * k)) * 0.45;
    p = base + dir * travel + uWind * age * 1.6;
    vA = pow(sin(3.14159 * k), 1.2);
  }
  vW = (modelMatrix * vec4(p, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float sz = uSize * (uKind < 0.5 ? (0.6 + 0.8 * aSeed.w) : (0.35 + 1.3 * k) * (0.6 + 0.8 * aSeed.w));
  gl_PointSize = sz * projectionMatrix[1][1] * uViewH * 0.5 / max(-mvPosition.z, 0.5);
  // Thin out right in front of the eye, so walking into the spray doesn't fill the screen.
  vA *= uOpacity * smoothstep(uKind < 0.5 ? 1.0 : 3.0, uKind < 0.5 ? 4.0 : 16.0, -mvPosition.z);
  #include <fog_vertex>
}`;
const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uSunCol, uAmb, uSunDir, uTint; uniform float uLight, uKind;
varying float vA; varying vec3 vW;
#include <common>
#include <fog_pars_fragment>
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  // Droplets: small soft dots. Mist: a gaussian puff with no visible edge.
  float a = vA * (uKind < 0.5 ? (1.0 - r2) * (1.0 - r2) : (exp(-r2 * 3.2) - 0.04) * 1.04);
  vec3 vd = normalize(vW - cameraPosition);
  // Water droplets scatter strongly forward: bright looking toward the sun.
  float fwd = pow(max(dot(vd, uSunDir), 0.0), 6.0);
  vec3 col = uAmb * 0.85 + uSunCol * (0.16 + 0.55 * fwd) + uTint * 0.8;
  gl_FragColor = vec4(col * max(uLight, 0.15), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// One emitter: kind 'spray' or 'mist'. a, b: ends of the impact line (local); out: the way spray
// is thrown (local, horizontal-ish).
export function makeSpray(kind, { a, b, out = [0, 0, 1], count = 200, life = 3, speed = 4, rise = 1, size = 0.3, opacity = 0.5, grav = 6, drag = 1.2 }) {
  const n = Math.max(4, Math.round(count));
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  const r = mulberry32(n * 7 + Math.round(size * 100));
  for (let i = 0; i < n; i++) {
    pos[i * 3] = r(); pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r();
    seed[i * 4] = r(); seed[i * 4 + 1] = r(); seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), O = new THREE.Vector3(...out).normalize();
  const reach = speed * life * 0.8 + Math.max(A.distanceTo(B), 1) + size * 4;
  g.boundingSphere = new THREE.Sphere(A.clone().add(B).multiplyScalar(0.5), reach);
  const mist = kind === 'mist';
  const mat = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, transparent: true, depthWrite: false, fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), fogSunDir: { value: fogSun.dir }, fogSunColor: { value: fogSun.color },
      uTime: waterUniforms.uTime, uLight: waterUniforms.uLight, uTint: waterUniforms.uTint,
      uSunCol: fallLight.uSunCol, uAmb: fallLight.uAmb, uSunDir: surfaceUniforms.uSunDir, uWind: fallLight.uWind, uViewH: fallLight.uViewH,
      uA: { value: A }, uB: { value: B }, uOut: { value: O }, uLife: { value: life }, uSpeed: { value: speed }, uRise: { value: rise },
      uSize: { value: size }, uGrav: { value: grav }, uDrag: { value: drag }, uOpacity: { value: opacity }, uKind: { value: mist ? 1 : 0 },
    },
  });
  const pts = new THREE.Points(g, mat);
  pts.renderOrder = mist ? 4 : 3;
  pts.userData.dynamic = true;
  pts.onBeforeRender = (renderer) => {
    const t = renderer.getRenderTarget();
    fallLight.uViewH.value = t ? t.height : renderer.getContext().drawingBufferHeight;
  };
  return pts;
}

// A rainbow in the spray: drawn on an upright quad facing out from the falls, it shows the bow
// only where the eye looks 40 to 42 degrees from the point opposite the sun, and only where the
// spray is thick (a soft blob over the quad).
const RAINBOW_FRAG = /* glsl */ `
uniform vec3 uSunDir; uniform float uLight, uStrength; varying vec2 vUv; varying vec3 vW;
#include <common>
#include <fog_pars_fragment>
vec3 spectrum(float t){ // 0 violet .. 1 red
  return clamp(vec3(abs(t * 6.0 - 4.0) - 1.0, 2.0 - abs(t * 6.0 - 2.5), 2.0 - abs(t * 6.0 - 1.2)), 0.0, 1.0);
}
void main(){
  vec3 vd = normalize(vW - cameraPosition);
  float ang = degrees(acos(clamp(dot(vd, -uSunDir), -1.0, 1.0)));
  float t = (ang - 40.4) / 2.0;
  float band = smoothstep(-0.15, 0.1, t) * smoothstep(1.15, 0.9, t);
  vec2 q = vUv * 2.0 - 1.0;
  // The spray is thickest low down near the foot of the falls.
  vec2 qb = vec2(q.x, (q.y + 0.35) * 1.4);
  float blob = pow(max(1.0 - dot(qb, qb), 0.0), 2.0);
  float sunOk = smoothstep(0.02, 0.12, uSunDir.y) * smoothstep(0.78, 0.6, uSunDir.y);
  vec3 col = spectrum(clamp(t, 0.0, 1.0)) * band * blob * sunOk * uStrength * uLight;
  // a faint secondary bow, reversed, near 51 degrees
  float t2 = (ang - 50.2) / 3.0;
  col += spectrum(1.0 - clamp(t2, 0.0, 1.0)) * smoothstep(-0.1, 0.1, t2) * smoothstep(1.1, 0.9, t2) * blob * sunOk * uStrength * 0.3 * uLight;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function makeRainbow(w, h, strength = 0.25) {
  if (!HD.on) strength *= 0.4; // without the realistic look's tone curve it would glare
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: RAINBOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uSunDir: surfaceUniforms.uSunDir, uLight: waterUniforms.uLight, uStrength: { value: strength } },
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.renderOrder = 5; m.userData.notGround = true;
  return m;
}

// ---------- The pool ----------
// The pool's water is one surface (createPoolMaterial in materials.js) that knows how far each
// point is from where the falls hit it: boiling white there, rings and drifting lace spreading out,
// clear and dark beyond. (It used to be a flat pool under a separate white sheet of foam, which from
// most angles covered the whole pool like a disc of snow.)

// An irregular pool outline round a centre: rx across, rz out from the falls.
function poolOutline(cx, cz, rx, rz, seed, n = 48) {
  const nz = createNoise2D(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.16 * nz(Math.cos(a) * 1.3, Math.sin(a) * 1.3) + 0.07 * nz(Math.cos(a) * 3.1 + 5, Math.sin(a) * 3.1);
    pts.push(new THREE.Vector2(cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k));
  }
  return pts;
}

// Pool water, foam and all. Returns a group; y is the water level (local).
export function makePool({ cx = 0, cz = 4, rx = 8, rz = 6, y = 0.15, impact, color = 0x1d4a50, reach = 4, boil = 2.2, seed = 3, tint, lip = 10 } = {}) {
  const g = new THREE.Group();
  const outline = poolOutline(cx, cz, rx, rz, seed);
  const [x0, z0, x1, z1] = impact;
  // A polar grid inside the outline: each vertex carries its distance from the impact line, along
  // it, and in from the rim, so the shader's fields are smooth.
  const RN = 16, AN = outline.length;
  const pos = [], pi = [], idx = [];
  const segLen = Math.hypot(x1 - x0, z1 - z0) || 1;
  const distToImpact = (x, z) => {
    const t = clamp(((x - x0) * (x1 - x0) + (z - z0) * (z1 - z0)) / (segLen * segLen), 0, 1);
    const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
    return [Math.hypot(x - px, z - pz), t * segLen];
  };
  for (let a = 0; a < AN; a++) {
    const o = outline[a], R = Math.hypot(o.x - cx, o.y - cz);
    for (let r = 0; r <= RN; r++) {
      // Rings bunched toward the rim, where the depth and the bank's foam change fastest.
      const k = 1 - Math.pow(1 - r / RN, 1.6);
      const x = cx + (o.x - cx) * k, z = cz + (o.y - cz) * k;
      const [d, along] = distToImpact(x, z);
      pos.push(x, 0, z);
      pi.push(d, along, (1 - k) * R);
    }
  }
  for (let a = 0; a < AN; a++) {
    const b = (a + 1) % AN;
    for (let r = 0; r < RN; r++) {
      const i0 = a * (RN + 1) + r, i1 = b * (RN + 1) + r;
      idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPI', new THREE.Float32BufferAttribute(pi, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  const c = new THREE.Color(color);
  const shallow = tint?.shallow || [c.r * 2.2, c.g * 2.0, c.b * 1.9].map((v) => Math.min(v, 0.9));
  const deep = tint?.deep || [c.r * 0.25, c.g * 0.35, c.b * 0.4];
  // Glacial and silty water is thick with rock flour: you see only a little way into it.
  const clarity = tint ? 1.4 : 0.55;
  const depth = clamp(Math.min(rx, rz) * 0.3, 1.2, 4);
  const water = new THREE.Mesh(geo, createPoolMaterial({ shallow, deep, reach, boil, depth, clarity, impact, lip }));
  water.position.y = y;
  water.receiveShadow = true;
  water.userData.notGround = true;
  g.add(water);
  return g;
}

// ---------- Rock ----------
// The terrain shader's masks: r = dark wet rock / black sand, g = moss, b = ice.
// Cliff: a wall standing up from a base line, built of stacked lava flows. path: base-line points
// in local x/z, left to right, the face looking +n (toward the pool). Each point may carry:
//   top: the lip height there; wet (0..1): the water runs here; overhang: metres the top leans out;
//   cave: metres the foot is hollowed back.
// Options: below (how far into the ground), back (plateau depth), bands (lava-flow thickness),
// columns (column width; 0 for none), relief (metres of roughness), moss (0..1), seed.
export function cliffGeometry(path, { below = 4, back = 16, bands = 2.2, columns = 0, relief = 1, moss = 0.5, seed = 1, NV = 40, ledgeMoss = 0.7, colour, backSlope = 0.9 } = {}) {
  const nz = createNoise2D(seed * 977 + 13);
  const n = (x, y) => nz(x, y);
  const NU = path.length;
  const pos = [], col = [], idx = [];
  const rows = NV + 1;
  // Cumulative distance along the path, for noise coordinates.
  const s = [0];
  for (let i = 1; i < NU; i++) s.push(s[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  for (let i = 0; i < NU; i++) {
    const p = path[i];
    const a = path[Math.max(0, i - 1)], b = path[Math.min(NU - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    // Outward normal: the path runs left to right as seen from the pool, so out is (tz, -tx) rotated.
    const ox = -tz, oz = tx;
    const top = p.top, base = (p.base ?? 0) - below, wet = p.wet || 0, over = p.overhang || 0, cave = p.cave || 0, lean = p.lean || 0;
    const u = s[i];
    const plateauBack = back * (0.75 + 0.3 * (n(u * 0.05, 9) * 0.5 + 0.5));
    for (let j = 0; j < rows; j++) {
      const v = j / NV;
      let y, out, c = [0, 0, 0];
      if (v <= 0.62) {
        // The face, foot to lip.
        const t = v / 0.62;
        y = base + (top - base) * t;
        const yh = y - base;
        // Lava flows: each band a near-vertical riser with a ledge on top that sticks out a little
        // and a shadowed notch under it. Bands wander up and down across the face.
        const bw = n(u * 0.03, 2.1) * 1.4 + n(u * 0.11, 5.3) * 0.4;
        const bt = (y + bw) / bands, bi = Math.floor(bt), bf = bt - bi;
        const thick = 0.55 + 0.45 * (n(bi * 1.7, 3.3) * 0.5 + 0.5);
        const ledge = Math.pow(bf, 6) * 0.9 * thick - (bf < 0.12 ? (0.12 - bf) * 3.2 : 0);
        let r = ledge * relief;
        // Columns: vertical ribs, faceted, in the thicker flows.
        if (columns > 0) {
          const cx = u / columns + n(bi * 0.7, 1.1) * 0.5;
          const cf = cx - Math.floor(cx);
          r += (Math.abs(cf - 0.5) * -0.8 + 0.2) * relief * thick;
        }
        r += n(u * 0.18, y * 0.18) * 0.7 * relief + n(u * 0.6, y * 0.5) * 0.25 * relief;
        // Calm and smooth where the water pours: polished, dark, wet.
        r *= 1 - wet * 0.65;
        out = r + (1 - t) * (1 - t) * 0.6;
        // Overhang at the top and a cave at the foot (Seljalandsfoss).
        out += over * THREE.MathUtils.smoothstep(t, 0.35, 1.0);
        out -= cave * Math.pow(1 - THREE.MathUtils.smoothstep(t, 0.0, 0.55), 1.5);
        out -= 0.8 * t + lean * t; // the face leans back a little (a slope where lean is large)
        // Masks: wet dark rock beside and behind the water; moss on ledges in the spray, and on
        // damp lower faces; none on the bare risers.
        const spray = clamp(wet * 1.4 + (p.spray || 0), 0, 1);
        const ledgeTop = bf > 0.86 ? 1 : 0;
        c[0] = clamp(wet * 0.9 + spray * 0.25 * (1 - t), 0, 1);
        c[1] = clamp((moss * (0.35 + 0.65 * (n(u * 0.2, y * 0.15) * 0.5 + 0.5)) * (ledgeTop * ledgeMoss + (1 - ledgeMoss) * 0.6) + spray * 0.5 * (1 - wet)) * (1 - wet * 0.8), 0, 1);
        if (colour) c = colour(u, y, bi, bf, c) || c;
      } else if (v <= 0.8) {
        // The top, running back from the lip: grass over the edge.
        const t = (v - 0.62) / 0.18;
        // A channel where the river runs to the lip.
        y = top + n(u * 0.08, t * 3) * 0.5 * (1 - wet) - 0.3 * t - wet * 0.6;
        out = -0.8 + over - lean - plateauBack * t;
        c = [wet * 0.5 * (1 - t), moss * 0.25, 0];
      } else {
        // Down the back to the land.
        const t = (v - 0.8) / 0.2;
        y = top + (base - top) * (t * t * (3 - 2 * t));
        out = -0.8 + over - lean - plateauBack - (top - base) * backSlope * t - 1;
        c = [0, moss * 0.2, 0];
      }
      pos.push(p.x + ox * out, y, p.z + oz * out);
      col.push(...c);
    }
  }
  for (let i = 0; i < NU - 1; i++) for (let j = 0; j < NV; j++) {
    const a = i * rows + j, b = a + rows;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeCliff(path, opts = {}) {
  const m = new THREE.Mesh(cliffGeometry(path, opts), opts.material || rockMaterial());
  m.castShadow = m.receiveShadow = true;
  m.userData.keepShape = true; // already shaped; the realistic look's weathering would only blur it
  return m;
}

// A path for a cliff: points along a curve (fn(t) -> {x, z} for t in 0..1), with the lip height
// easing to nothing over the ends so the cliff runs out into the land.
export function cliffPath(n, fn, { top, ends = 0.18, wetAt, overhang = 0, cave = 0, spray, lean } = {}) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = fn(t);
    const e = Math.min(t, 1 - t) / ends;
    const k = e >= 1 ? 1 : Math.pow(e * e * (3 - 2 * e), 0.6);
    const h = typeof top === 'function' ? top(t, p) : top;
    const wet = wetAt ? wetAt(t, p) : 0;
    pts.push({ x: p.x, z: p.z, top: Math.max(0.5, h * k), wet, overhang: (typeof overhang === 'function' ? overhang(t, p) : overhang) * k, cave: (typeof cave === 'function' ? cave(t, p) : cave), spray: spray ? spray(t, p) : 0, lean: lean ? lean(t, p) : 0 });
  }
  return pts;
}

// Boulders: lumpy, rock-shaded, half buried, scattered in an area (callers give positions).
const boulderGeos = [];
export function boulder(size, rand) {
  if (boulderGeos.length < 6) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position, nz = createNoise2D(boulderGeos.length * 31 + 7);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.22 * nz(x * 1.3 + y, z * 1.3) + 0.1 * nz(x * 3 - z, y * 3);
      p.setXYZ(i, x * k * 1.15, y * k * 0.7, z * k);
    }
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3).map((_, i) => (i % 3 === 0 ? 0.55 : i % 3 === 1 ? 0.25 : 0)), 3));
    boulderGeos.push(geo);
  }
  const m = new THREE.Mesh(boulderGeos[Math.floor(rand() * boulderGeos.length)], rockMaterial());
  m.scale.setScalar(size); m.rotation.set(rand() * 0.4, rand() * 6.28, rand() * 0.4);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// A material for cliffs that need their own colours painted over the rock (Hengifoss's red clay):
// the terrain shader, with the vertex colour's blue channel used as a "paint" weight mixing in
// uPaint. (Ice is never wanted on these cliffs, so the blue mask is free.)
const paintMats = new Map();
export function paintedRock(paint, band = 4) {
  const key = paint + '|' + band;
  if (paintMats.has(key)) return paintMats.get(key);
  const m = createTerrainMaterial();
  const prev = m.onBeforeCompile;
  const col = new THREE.Color(paint);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uPaint = { value: col };
    sh.uniforms.uBand = { value: band };
    // Thin layers of old soil baked red between lava flows: stripes in world height, wandering a
    // little, on most flows (vColor.b marks the faces that carry them).
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPaint; uniform float uBand;')
      .replace(/(\* cloudShade\(vWPos\);)/, `$1
        {
          float by = vWPos.y + (g_n(vWPos.xz * 0.035) - 0.5) * 3.0 + (g_n(vWPos.xz * 0.2) - 0.5) * 0.35;
          float bf = fract(by / uBand), layer = floor(by / uBand);
          float keep = step(0.25, fract(sin(layer * 12.9898) * 43758.5453));
          float thick = 0.06 + 0.06 * fract(sin(layer * 78.233) * 9631.7);
          float pw = vColor.b * keep * smoothstep(0.0, 0.015, bf) * smoothstep(thick, thick * 0.6, bf);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * (0.7 + 0.6 * tNF) * cloudShade(vWPos), pw);
        }`);
  };
  // The blue mask must not also turn the rock to ice: zero it before the terrain colour reads it.
  const prev2 = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev2(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace(/terrainColor\(vColor,/g, 'terrainColor(vec3(vColor.rg, 0.0),');
  };
  const baseKey = m.customProgramCacheKey?.() || 'terrain';
  m.customProgramCacheKey = () => baseKey + '-paint';
  paintMats.set(key, m);
  return m;
}
