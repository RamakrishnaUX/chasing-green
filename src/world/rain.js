import * as THREE from 'three';
import { headlightUniforms, LAMP_GLSL } from './effects.js';

// Rain, built from how real rain behaves.
//
// - Drops come in real sizes (0.5 to 5 mm, mostly small, more big ones the harder it rains, after
//   Marshall and Palmer) and each falls at its own terminal speed (Gunn and Kinzer: about 4 m/s for
//   a 1 mm drop, 9 m/s for a big one), carried sideways by the wind.
// - Each is drawn as the streak it makes in one exposure, along its motion relative to the camera,
//   so from a moving car the rain rushes at you and slants back; its real width (a pixel or less
//   further than a few metres, so far drops thin into a grey veil), and soft and wide close to the
//   eye, out of focus. They light up against the dark, glow when the sun is behind them, and catch
//   the headlights.
// - Everything runs on the GPU: drops are fixed in the world and wrap round a box that follows the
//   camera, so driving carries you through them; a near box and a far one for depth.
// - The car keeps the rain off what is under it: drops stop on its roof, bonnet and glass (a height
//   map of its top, rendered from above), burst there in small splashes that ride along with it,
//   and none fall under it or inside the cabin.
// - Drops landing on the ground burst into a crown with droplets flung out of it, all round you.

// ---------- The car's shelter ----------
// The car's top as seen from straight above: r = height, g/b = the surface's slope, a = covered.
export const carShelter = {
  uShelterInv: { value: new THREE.Matrix4() },
  uShelterMap: { value: null },
  uShelterBox: { value: new THREE.Vector4(0, 0, 1, 1) }, // min x, min z, size x, size z (car frame)
  uShelterY: { value: new THREE.Vector2(0, 1) }, // min y, range
  uShelterOn: { value: 0 },
};
const SHELTER_GLSL = /* glsl */ `
uniform mat4 uShelterInv; uniform sampler2D uShelterMap; uniform vec4 uShelterBox; uniform vec2 uShelterY; uniform float uShelterOn;
float sheltered(vec3 wp) {
  if (uShelterOn < 0.5) return 0.0;
  vec3 l = (uShelterInv * vec4(wp, 1.0)).xyz;
  vec2 uv = (l.xz - uShelterBox.xy) / uShelterBox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  vec4 s = texture2D(uShelterMap, uv);
  if (s.a < 0.5) return 0.0;
  float top = uShelterY.x + s.r * uShelterY.y;
  return (l.y < top + 0.02 && l.y > uShelterY.x - 1.5) ? 1.0 : 0.0;
}`;

// ---------- Streaks ----------
function streakMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uBox: { value: new THREE.Vector3(40, 24, 40) }, uCenter: { value: new THREE.Vector3() },
        uFallT: { value: 0 }, uDrift: { value: new THREE.Vector2() }, uWind: { value: new THREE.Vector3() },
        uCamVel: { value: new THREE.Vector3() }, uExposure: { value: 0.034 }, uLambda: { value: 2 },
        uViewport: { value: new THREE.Vector2(1280, 800) }, uFade: { value: 0.5 }, uRange: { value: new THREE.Vector4(0, 0, 18, 22) },
        uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunGlow: { value: 0 },
        uCoc: { value: 8 },
      }]),
      ...headlightUniforms, ...carShelter,
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; attribute vec2 aCorner;
      uniform vec3 uBox, uCenter, uWind, uCamVel; uniform vec2 uDrift, uViewport; uniform vec4 uRange;
      uniform float uFallT, uExposure, uLambda, uFade, uCoc;
      varying vec2 vUv; varying float vA; varying float vLit; varying vec3 vWp;
      ${LAMP_GLSL}
      ${SHELTER_GLSL}
      #include <fog_pars_vertex>
      void main() {
        // Size from the drop-size spectrum, speed from the size.
        float D = clamp(0.45 - log(1.0 - aSeed.w * 0.985) / uLambda, 0.45, 5.0);
        float vt = max(2.2, 9.65 - 10.3 * exp(-0.6 * D));
        vec3 p = aSeed.xyz * uBox;
        p.y -= vt * uFallT;
        // Small drops follow every eddy; big ones less so.
        p.xz += uDrift * (1.0 + (aSeed.x - 0.5) * 0.12);
        vec3 lo = uCenter - uBox * 0.5;
        vec3 wp = mod(p - lo, uBox) + lo;
        vec3 vel = vec3(uWind.x, -vt, uWind.z) * vec3(mix(0.85, 1.05, clamp(1.0 / D, 0.0, 1.0)), 1.0, mix(0.85, 1.05, clamp(1.0 / D, 0.0, 1.0)));
        vec3 rel = vel - uCamVel;
        vec4 h = viewMatrix * vec4(wp, 1.0);
        vec4 t = viewMatrix * vec4(wp - rel * uExposure, 1.0);
        if (t.z > -0.08 && h.z < -0.08) t = mix(h, t, (h.z + 0.08) / (h.z - t.z));
        float depth = -h.z;
        float horiz = length(wp.xz - cameraPosition.xz);
        // Real width in pixels; close drops are out of focus, wider and fainter.
        float pxPerM = uViewport.y * 0.5 * projectionMatrix[1][1] / max(depth, 0.05);
        float wPhys = D * 0.001 * pxPerM;
        // Focused some way off: the blur circle grows as 1/depth closer in, spreading the drop's
        // light over a wider, fainter streak.
        float coc = uCoc * max(0.0, 1.0 / depth - 0.08);
        float wPx = max(wPhys, 1.0) + coc;
        vA = pow(min(wPhys, 1.0), 0.35) * pow(1.0 / (1.0 + coc), 0.8) * (0.55 + 0.45 * clamp(D / 2.5, 0.0, 1.0));
        vA *= smoothstep(uFade, uFade * 2.2, depth) * smoothstep(uRange.x, uRange.y, horiz) * (1.0 - smoothstep(uRange.z, uRange.w, horiz));
        vA *= 1.0 - sheltered(wp);
        if (depth < 0.05 || vA < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
        vec4 ch = projectionMatrix * h, ct = projectionMatrix * t;
        vec2 sh = ch.xy / ch.w, st = ct.xy / ct.w;
        vec2 d = (sh - st) * uViewport * 0.5; float len = length(d);
        vec2 dir = len > 1e-4 ? d / len : vec2(0.0, 1.0), perp = vec2(-dir.y, dir.x);
        // A streak shorter than it is wide is spread over its length, so energy is kept.
        vA *= min(1.0, (len + wPx) / max(wPx * 2.0, 1.0)) * 0.7 + 0.3;
        vec4 c = aCorner.y < 0.5 ? ch : ct;
        vec2 off = perp * aCorner.x * wPx * 0.5 + dir * (aCorner.y < 0.5 ? 0.5 : -0.5) * wPx;
        c.xy += off / (uViewport * 0.5) * c.w;
        gl_Position = c;
        vUv = aCorner; vWp = wp;
        vLit = lampLit(wp);
        vec4 mvPosition = h;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uSun; uniform float uOpacity, uSunGlow;
      varying vec2 vUv; varying float vA; varying float vLit; varying vec3 vWp;
      #include <fog_pars_fragment>
      void main() {
        float across = 1.0 - vUv.x * vUv.x;
        // Brightest at the leading end, thinning toward the tail.
        float along = mix(1.0, 0.35, vUv.y);
        vec3 v = normalize(vWp - cameraPosition);
        float glow = pow(max(dot(v, uSun), 0.0), 6.0) * uSunGlow;
        // In a headlight beam every drop shines: they are lit far brighter than the dark around.
        vec3 col = uColor * (1.0 + glow * 2.5) + vec3(1.0, 0.96, 0.88) * vLit * 3.0;
        float a = across * across * along * min(1.0, vA * (1.0 + vLit * 2.5)) * uOpacity * (1.0 + vLit * 1.5 + glow);
        if (a < 0.002) discard;
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
}

class StreakLayer {
  constructor(scene, count, box, range) {
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, 1, 1, -1, 1], 2));
    quad.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seed[i] = Math.random();
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    quad.instanceCount = 0;
    this.n = count;
    this.mat = streakMaterial();
    this.mat.uniforms.uBox.value.copy(box);
    this.mat.uniforms.uRange.value.copy(range);
    this.mesh = new THREE.Mesh(quad, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 4; this.mesh.userData.noAO = true;
    scene.add(this.mesh);
  }
}

// ---------- Splashes ----------
// A drop bursting on a surface: a thin crown rising and falling back, and a few droplets flung out
// of it in arcs. Each is a small upright card facing the camera, drawn in the shader; the card can
// ride along with what was hit (a moving car).
const SPLASH_LIFE = 0.28;
class Splashes {
  constructor(scene, count) {
    this.n = count; this.next = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -0.25, 1, -0.25, 1, 1, -1, 1], 2));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = new Float32Array(count * 4).fill(0); this.b = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) this.a[i * 4 + 3] = -100;
    this.attrA = new THREE.InstancedBufferAttribute(this.a, 4).setUsage(THREE.DynamicDrawUsage);
    this.attrB = new THREE.InstancedBufferAttribute(this.b, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.attrA); g.setAttribute('aV', this.attrB);
    g.instanceCount = count;
    // Everything about one splash at this moment (its crown, where each droplet is) is the same
    // across its card, so it is worked out per vertex; each pixel only measures distances.
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.8 }, uViewH: { value: 800 } }]), ...headlightUniforms },
      vertexShader: /* glsl */ `
        attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aV;
        uniform float uTime, uViewH;
        varying vec2 vL; varying vec4 vCrown; varying vec4 vQ01; varying vec4 vQ23; varying vec4 vR; varying float vFade; varying float vLit;
        ${LAMP_GLSL}
        #include <fog_pars_vertex>
        float hs(float n, float sd) { return fract(sin(n * 78.233 + sd * 431.7) * 43758.5453); }
        void main() {
          float t = uTime - aP.w, age = t / ${SPLASH_LIFE.toFixed(2)};
          if (age < 0.0 || age > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float size = fract(aV.w), sd = floor(aV.w) / 1024.0, k = 0.6 + size;
          vec3 c = aP.xyz + aV.xyz * t;
          vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]) + vec3(1e-4, 0.0, 0.0));
          vec2 hsz = vec2(0.1, 0.07) * k;
          vec3 wp = c + right * aCorner.x * hsz.x + vec3(0.0, aCorner.y * hsz.y, 0.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float px = 1.0 / (uViewH * 0.5 * projectionMatrix[1][1] / max(-mvPosition.z, 0.05)); // metres per pixel
          // The crown: a thin sheet thrown up in a ring, seen from the side as a cup that widens,
          // rises and falls back within a sixth of a second.
          float ct = clamp(t / 0.16, 0.0, 1.0);
          vCrown = vec4((0.008 + 0.045 * sqrt(ct)) * k, 0.032 * k * sin(3.14159 * ct), max(0.0016 * k, px * 0.9), ct);
          // Droplets flung from the crown's rim: out and up, falling back under gravity.
          vec2 q[4]; float rr[4];
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float a = hs(fi, sd) * 6.2832, vh = (0.3 + 0.6 * hs(fi + 9.1, sd)) * k, vy = (0.3 + 0.65 * hs(fi + 3.7, sd)) * sqrt(k);
            float tau = t - 0.02 - 0.03 * hs(fi + 5.3, sd);
            q[i] = vec2(cos(a) * (vCrown.x * 0.8 + vh * max(tau, 0.0)), vy * max(tau, 0.0) - 4.9 * tau * tau);
            rr[i] = (tau <= 0.0 || q[i].y < -0.004) ? 0.0 : max((0.0009 + 0.0011 * hs(fi + 1.9, sd)) * k, px * 0.7) * (0.85 + 0.3 * sin(a));
          }
          vQ01 = vec4(q[0], q[1]); vQ23 = vec4(q[2], q[3]); vR = vec4(rr[0], rr[1], rr[2], rr[3]);
          vL = aCorner * hsz; vFade = 1.0 - smoothstep(0.7, 1.0, age);
          vLit = lampLit(c);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying vec2 vL; varying vec4 vCrown; varying vec4 vQ01; varying vec4 vQ23; varying vec4 vR; varying float vFade; varying float vLit;
        #include <fog_pars_fragment>
        float dot2(vec2 v) { return dot(v, v); }
        float drop(vec2 q, float r) { return r > 0.0 ? exp(-dot2(vL - q) / (r * r)) : 0.0; }
        void main() {
          float r = vCrown.x, hc = vCrown.y, thick = vCrown.z, crown = 0.0;
          if (hc > 0.002) {
            float y = vL.y / hc;
            float dx = (abs(vL.x) - mix(r * 0.55, r, clamp(y, 0.0, 1.0))) / thick, dy = (vL.y - hc) / thick;
            float wall = exp(-dx * dx) * step(0.0, y) * step(y, 1.05);
            float rim = exp(-dy * dy) * step(abs(vL.x), r) * 0.35;
            crown = max(wall * (0.4 + 0.6 * y), rim) * (1.0 - vCrown.w * 0.6);
          }
          float drops = drop(vQ01.xy, vR.x) + drop(vQ01.zw, vR.y) + drop(vQ23.xy, vR.z) + drop(vQ23.zw, vR.w);
          float a = clamp(crown + drops, 0.0, 1.0) * uOpacity * vFade;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * 1.15 + vec3(1.0, 0.96, 0.88) * vLit * 1.6, a * (1.0 + vLit));
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.userData.noAO = true;
    scene.add(this.mesh);
    this.dirty = false; this.lastEmit = -1;
  }
  // size 0..0.99: how big the drop was (and so the crown).
  emit(x, y, z, vx, vy, vz, size, time) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    const o = i * 4;
    this.a[o] = x; this.a[o + 1] = y; this.a[o + 2] = z; this.a[o + 3] = time;
    this.b[o] = vx; this.b[o + 1] = vy; this.b[o + 2] = vz; this.b[o + 3] = Math.floor(Math.random() * 1024) + Math.min(0.99, size);
    this.dirty = true; this.lastEmit = time;
  }
  update(time) {
    this.mat.uniforms.uTime.value = time;
    this.mesh.visible = time - this.lastEmit < SPLASH_LIFE + 0.05;
    if (this.dirty) { this.attrA.needsUpdate = true; this.attrB.needsUpdate = true; this.dirty = false; }
  }
}

// ---------- Rain ----------
export class RainFall {
  constructor(scene, { low = false } = {}) {
    this.near = new StreakLayer(scene, low ? 12000 : 32000, new THREE.Vector3(40, 22, 40), new THREE.Vector4(-1, 0, 15, 20));
    this.far = new StreakLayer(scene, low ? 4000 : 10000, new THREE.Vector3(150, 60, 150), new THREE.Vector4(14, 20, 62, 74));
    // A dense layer just round the eye, where single drops show best.
    this.close = new StreakLayer(scene, low ? 3000 : 8000, new THREE.Vector3(16, 10, 16), new THREE.Vector4(-1, 0, 5.5, 7.8));
    this.far.mat.uniforms.uCoc.value = 0;
    this.layers = [this.close, this.near, this.far];
    this.splash = new Splashes(scene, low ? 1400 : 3200);
    this.intensity = 0; this.fallT = 0; this.drift = new THREE.Vector2(); this.carry = 0; this.time = 0;
    this.camVel = new THREE.Vector3(); this.lastEye = null;
  }
  // target: how hard it should rain here (0 to 1); wind {x, z} m/s; fade: metres in front of the
  // eye kept clear (inside a cabin); light: 0 at night to 1 by day; groundAt(x, z): the surface
  // under a drop; opts: { camera, env (THREE.Color, the light in the air), sun (direction), sunUp,
  // car (CarRain, for drops landing on it) }.
  update(dt, eye, target, wind, fade, light, groundAt, opts = {}) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.35);
    const I = this.intensity, on = I > 0.01;
    this.time += dt;
    for (const L of this.layers) L.mesh.visible = on;
    // The camera's own motion, for streaks seen from a moving car.
    if (this.lastEye && dt > 0) {
      const vx = (eye.x - this.lastEye.x) / dt, vy = (eye.y - this.lastEye.y) / dt, vz = (eye.z - this.lastEye.z) / dt;
      const jump = Math.hypot(vx, vy, vz) > 120;
      const k = jump ? 0 : Math.min(1, dt * 12);
      if (jump) this.camVel.set(0, 0, 0); else this.camVel.set(this.camVel.x + (vx - this.camVel.x) * k, this.camVel.y + (vy - this.camVel.y) * k, this.camVel.z + (vz - this.camVel.z) * k);
    }
    this.lastEye = { x: eye.x, y: eye.y, z: eye.z };
    if (on) {
      // Gusts: the wind's own swings plus a quicker flutter, so the slant keeps changing.
      const gust = 1 + 0.25 * Math.sin(this.time * 0.9) * Math.sin(this.time * 0.37 + 1.3);
      const wx = (wind?.x || 0) * gust, wz = (wind?.z || 0) * gust;
      this.fallT = (this.fallT + dt) % 600;
      this.drift.x = (this.drift.x + wx * dt) % 1500; this.drift.y = (this.drift.y + wz * dt) % 1500;
      // Light rain is mostly fine drops; a downpour has big ones.
      const lambda = 3.2 - I * 1.9;
      const env = opts.env || new THREE.Color(0.75, 0.78, 0.82);
      const vp = opts.viewport || { x: innerWidth, y: innerHeight };
      for (const L of this.layers) {
        const u = L.mat.uniforms;
        u.uCenter.value.set(eye.x, eye.y + (L === this.far ? 14 : L === this.close ? 2 : 5), eye.z);
        u.uFallT.value = this.fallT; u.uDrift.value.copy(this.drift); u.uWind.value.set(wx, 0, wz);
        u.uCamVel.value.copy(this.camVel); u.uLambda.value = lambda; u.uFade.value = fade;
        u.uViewport.value.set(vp.x, vp.y);
        u.uColor.value.copy(env).multiplyScalar(0.55 + 0.75 * light);
        u.uOpacity.value = (L === this.far ? 0.55 : 0.9) * Math.min(1, 0.35 + I * 0.9);
        if (opts.sun) u.uSun.value.copy(opts.sun);
        u.uSunGlow.value = (opts.sunUp ?? 0) * light;
        L.mesh.geometry.instanceCount = Math.round(L.n * Math.min(1, I * 1.1));
      }
      // Drops bursting on the ground: more near you, where they show, and mostly in front.
      const fwd = opts.forward ? Math.atan2(opts.forward.x, opts.forward.z) : null;
      this.carry += I * 1200 * dt;
      const car = opts.car;
      for (; this.carry >= 1; this.carry--) {
        const nearOne = Math.random() < 0.65;
        const r = nearOne ? Math.sqrt(1.2 + Math.random() * 80) : Math.sqrt(81 + Math.random() * 450);
        const a = fwd == null ? Math.random() * Math.PI * 2 : fwd + (Math.random() - 0.5) * Math.PI * 1.25;
        const x = eye.x + Math.sin(a) * r, z = eye.z + Math.cos(a) * r;
        if (car?.covers(x, z)) continue;
        const D = 0.45 - Math.log(1 - Math.random() * 0.985) / lambda;
        this.splash.emit(x, groundAt(x, z) + 0.005, z, 0, 0, 0, Math.min(0.99, D / 4), this.time);
      }
      car?.rainOn(dt, I, this.splash, this.time, { x: wx, z: wz }, lambda);
      this.splash.mat.uniforms.uColor.value.copy(env).multiplyScalar(0.55 + 0.75 * light);
      this.splash.mat.uniforms.uOpacity.value = 0.75;
      this.splash.mat.uniforms.uViewH.value = vp.y;
    }
    this.splash.update(this.time);
  }
}

// ---------- Rain on the car ----------
// Where the drops land on the car, and what the water does there. The car's top is rendered once
// from straight above (height and slope per 4 to 5 cm) whenever the car changes. Each frame drops
// strike it at the rate rain falls on each bit of it: a bonnet facing up gets the rain falling on
// it, a windscreen leaning forward sweeps up far more as the car drives into the rain. Each strike
// bursts into a small splash carried along with the car. Standing still the water collects and
// drips off the edges; at speed it streams off the back in a fine mist. The paint's own wetness
// (beads, runs and fresh hits) is drawn by grime.js from uCarWet and friends.
const NX = 48, NZ = 96;
export class CarRain {
  constructor() {
    this.model = null; this.cells = []; this.edges = []; this.wet = 0; this.carry = 0; this.drip = 0; this.mist = 0;
    this.inv = new THREE.Matrix4(); this.mat = new THREE.Matrix4(); this.vel = new THREE.Vector3(); this.lastPos = null;
    this.tmp = new THREE.Vector3(); this.on = false;
    // From the driver's seat (main.js): the cabin, on his side of the windscreen's plane (plane: a
    // Vector4, normal and offset in the car's frame) and below his eye (top), where no drop bursts
    // and nothing drips, so no water shows inside.
    this.cabin = null;
  }
  inCabin(c) { const k = this.cabin; return !!k && c.y < k.top && k.plane.x * c.x + k.plane.y * c.y + k.plane.z * c.z + k.plane.w > -0.05; }
  // Render the car's top from above into a height map (once per car).
  build(renderer, jeep) {
    const body = jeep.body, parent = body.parent, rot = body.rotation.clone();
    const holder = new THREE.Scene();
    holder.add(body); body.rotation.set(0, 0, 0); body.updateMatrixWorld(true);
    // Only what is drawn: the car carries a few hidden helpers that reach well past its ends.
    const box = new THREE.Box3(), part = new THREE.Box3();
    body.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry?.attributes.position) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    });
    const pad = 0.04;
    box.min.x -= pad; box.min.z -= pad; box.max.x += pad; box.max.z += pad;
    const minY = box.min.y, rangeY = Math.max(0.5, box.max.y - box.min.y + 0.05);
    const cam = new THREE.OrthographicCamera(box.min.x, box.max.x, -box.min.z, -box.max.z, 0.01, rangeY + 2);
    cam.position.set(0, box.max.y + 1, 0); cam.up.set(0, 0, -1); cam.lookAt(0, box.min.y - 5, 0); cam.updateMatrixWorld(true);
    // Camera looks straight down, screen right = +x, screen up = -z.
    cam.left = box.min.x; cam.right = box.max.x; cam.top = -box.min.z; cam.bottom = -box.max.z; cam.updateProjectionMatrix();
    holder.overrideMaterial = new THREE.ShaderMaterial({
      uniforms: { uY: { value: new THREE.Vector2(minY, rangeY) } },
      vertexShader: 'varying vec3 vN; varying float vY; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'uniform vec2 uY; varying vec3 vN; varying float vY; void main(){ vec3 n = normalize(vN); if (n.y < 0.0) n = -n; gl_FragColor = vec4(clamp((vY - uY.x) / uY.y, 0.0, 1.0), n.x * 0.5 + 0.5, n.z * 0.5 + 0.5, 1.0); }',
      side: THREE.DoubleSide,
    });
    const rt = new THREE.WebGLRenderTarget(NX, NZ, { depthBuffer: true });
    const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha(), prevAuto = renderer.autoClear;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.autoClear = true; renderer.clear();
    renderer.render(holder, cam);
    const px = new Uint8Array(NX * NZ * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, NX, NZ, px);
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevClear, prevA); renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadow;
    rt.dispose(); holder.overrideMaterial.dispose();
    parent.add(body); body.rotation.copy(rot); body.updateMatrixWorld(true);
    // Reorder so u runs along +x and v along +z.
    const data = new Uint8Array(NX * NZ * 4);
    const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
    this.cells = []; this.edges = [];
    const top = new Float32Array(NX * NZ).fill(-99);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const src = ((NZ - 1 - j) * NX + i) * 4, dst = (j * NX + i) * 4; // row 0 of the read is z max
      for (let c = 0; c < 4; c++) data[dst + c] = px[src + c];
      if (px[src + 3] > 127) {
        const y = minY + (px[src] / 255) * rangeY;
        top[j * NX + i] = y;
        const nx = px[src + 1] / 127.5 - 1, nz = px[src + 2] / 127.5 - 1, ny = Math.sqrt(Math.max(0.02, 1 - nx * nx - nz * nz));
        this.cells.push({ x: box.min.x + (i + 0.5) / NX * sx, y, z: box.min.z + (j + 0.5) / NZ * sz, nx, ny, nz });
      }
    }
    // Edges the water runs off: a covered cell beside a drop of more than 12 cm.
    for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const y = top[j * NX + i]; if (y < -50 || y - minY < 0.35) continue;
      const lower = Math.min(top[j * NX + i - 1], top[j * NX + i + 1], top[(j - 1) * NX + i], top[(j + 1) * NX + i]);
      if (y - lower > 0.12) this.edges.push({ x: box.min.x + (i + 0.5) / NX * sx, y, z: box.min.z + (j + 0.5) / NZ * sz });
    }
    this.topY = box.max.y; this.rear = box.min.z; this.halfW = Math.max(-box.min.x, box.max.x);
    const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
    carShelter.uShelterMap.value?.dispose();
    carShelter.uShelterMap.value = tex;
    carShelter.uShelterBox.value.set(box.min.x, box.min.z, sx, sz);
    carShelter.uShelterY.value.set(minY, rangeY);
    this.box = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
    this.model = jeep.model;
  }
  // Each frame. show: the car is in the world (not hidden while flying elsewhere).
  update(dt, renderer, jeep, show) {
    if (show && jeep.model !== this.model) this.build(renderer, jeep);
    this.on = show && !!this.model;
    carShelter.uShelterOn.value = this.on ? 1 : 0;
    if (!this.on) { this.lastPos = null; return; }
    jeep.root.updateMatrixWorld();
    this.mat.copy(jeep.root.matrixWorld); this.inv.copy(this.mat).invert();
    carShelter.uShelterInv.value.copy(this.inv);
    if (this.lastPos && dt > 0) {
      const k = Math.min(1, dt * 10);
      this.vel.x += ((jeep.pos.x - this.lastPos.x) / dt - this.vel.x) * k;
      this.vel.y += ((jeep.pos.y - this.lastPos.y) / dt - this.vel.y) * k;
      this.vel.z += ((jeep.pos.z - this.lastPos.z) / dt - this.vel.z) * k;
      if (this.vel.length() > 150) this.vel.set(0, 0, 0);
    }
    this.lastPos = { x: jeep.pos.x, y: jeep.pos.y, z: jeep.pos.z };
  }
  // Is the world point (x, z) under the car's top?
  covers(x, z) {
    if (!this.on) return false;
    const e = this.inv.elements, lx = e[0] * x + e[8] * z + e[12], lz = e[2] * x + e[10] * z + e[14];
    return lx > this.box.minX && lx < this.box.maxX && lz > this.box.minZ && lz < this.box.maxZ;
  }
  world(c, out) { return out.set(c.x, c.y, c.z).applyMatrix4(this.mat); }
  // Drops striking the car this frame, and the water running off it.
  rainOn(dt, I, splash, time, wind, lambda) {
    if (!this.on || !this.cells.length || dt <= 0) return;
    // The rain's velocity relative to the car, in the car's frame.
    const e = this.inv.elements;
    const rvx = wind.x - this.vel.x, rvz = wind.z - this.vel.z, rvy = -7 - this.vel.y;
    const lx = e[0] * rvx + e[4] * rvy + e[8] * rvz, ly = e[1] * rvx + e[5] * rvy + e[9] * rvz, lz = e[2] * rvx + e[6] * rvy + e[10] * rvz;
    const rel = Math.hypot(lx, ly, lz), ux = -lx / rel, uy = -ly / rel, uz = -lz / rel;
    // Strike rate scales with how fast the car sweeps through the rain (7 m/s is still).
    const maxFlux = rel / 7;
    const area = (this.box.maxX - this.box.minX) * (this.box.maxZ - this.box.minZ);
    this.carry += I * 32 * area * maxFlux * dt;
    this.carry = Math.min(this.carry, 600);
    const out = this.tmp;
    for (; this.carry >= 1; this.carry--) {
      const c = this.cells[(Math.random() * this.cells.length) | 0];
      if (Math.random() > Math.max(0, c.nx * ux + c.ny * uy + c.nz * uz) || this.inCabin(c)) continue;
      this.world(c, out);
      const D = 0.45 - Math.log(1 - Math.random() * 0.985) / lambda;
      // The splash's droplets keep most of the car's speed; the air takes the rest.
      splash.emit(out.x, out.y + 0.004, out.z, this.vel.x * 0.85, this.vel.y, this.vel.z * 0.85, Math.min(0.99, D / 6), time);
    }
  }
  // The water on the car once it is wet: drips off the edges when slow, a mist off the back at
  // speed. drops/mist: Spray pools (waterfx.js).
  shed(dt, wet, rain, drops, mist) {
    if (!this.on || dt <= 0 || wet < 0.05) return;
    const sp = Math.hypot(this.vel.x, this.vel.z), out = this.tmp;
    if (sp < 4 && this.edges.length) {
      this.drip += wet * (6 + rain * 30) * (1 - sp / 4) * dt;
      for (; this.drip >= 1; this.drip--) {
        const c = this.edges[(Math.random() * this.edges.length) | 0];
        if (this.inCabin(c)) continue;
        this.world(c, out);
        drops.emit(out.x, out.y - 0.02, out.z, this.vel.x, -0.3, this.vel.z, 0.9, 0.05 + Math.random() * 0.03);
      }
    }
    if (sp > 9) {
      this.mist += wet * Math.min(1, (sp - 9) / 18) * (8 + rain * 20) * dt;
      for (; this.mist >= 1; this.mist--) {
        out.set((Math.random() - 0.5) * this.halfW * 1.6, this.topY * (0.55 + Math.random() * 0.4), this.rear - 0.1).applyMatrix4(this.mat);
        mist.emit(out.x, out.y, out.z, this.vel.x * 0.55, 0.2, this.vel.z * 0.55, 0.9 + Math.random() * 0.6, 0.7 + Math.random() * 0.6);
      }
    }
  }
}
