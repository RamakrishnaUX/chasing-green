import * as THREE from 'three';
import { roadPaths, heightAt, roadHalfWidth, deckAt } from './terrain.js';
import { mulberry32 } from './noise.js';

// ---------- Particles ----------
let sprite = null;
function softSprite() {
  if (sprite) return sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprite = new THREE.CanvasTexture(c);
  return sprite;
}

// A pool of simple particles with gravity and drag, drawn as soft sprites.
export class Particles {
  // fadeNear: [from, to] metres from the eye over which particles fade in, so a cloud the camera
  // sits in does not cover the view.
  constructor(scene, { count = 500, color = 0xffffff, size = 0.5, opacity = 0.6, gravity = 9, drag = 1.5, fadeNear = null }) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.gravity = gravity;
    this.drag = drag;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ color, size, map: softSprite(), transparent: true, opacity, depthWrite: false, sizeAttenuation: true });
    if (fadeNear) this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>\nvNear = smoothstep(${fadeNear[0].toFixed(1)}, ${fadeNear[1].toFixed(1)}, -mvPosition.z);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
        .replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.a *= vNear;\n#include <premultiplied_alpha_fragment>');
    };
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -9999;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, count, spread, life = 0.9) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = vy * (0.6 + Math.random() * 0.8);
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.8);
    }
  }
  update(dt) {
    const p = this.pos, v = this.vel;
    const dr = Math.max(0, 1 - this.drag * dt);
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      v[i * 3 + 1] -= this.gravity * dt;
      v[i * 3] *= dr; v[i * 3 + 1] *= dr; v[i * 3 + 2] *= dr;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (this.life[i] <= 0) p[i * 3 + 1] = -9999;
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- Puddles ----------
// Rain puddles on the tarmac, drawn as water rather than a stain: each reflects the sky, more
// at a low angle (as from the driver's seat) and hardly at all looking straight down, where the
// wet black tarmac shows through; the sun glints off it; a breeze ruffles it; its edge is
// ragged and soft, and the tarmac round it is darkened by the wet. Driving through sends rings
// across it. All the puddles are one mesh with one material.
const MAX_RIPPLES = 8;
export class Puddles {
  constructor(scene, count = 110) {
    const r = mulberry32(5150);
    this.list = [];
    const paved = roadPaths.filter((p) => p.type === 'paved');
    const pos = [], loc = [], seed = [], idx = [];
    let tries = 0;
    while (this.list.length < count && tries < count * 10) {
      tries++;
      const path = paved[Math.floor(r() * paved.length)];
      const i = Math.floor(r() * (path.pts.length - 1));
      const a = path.pts[i], b = path.pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const t = r();
      const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      const hw = roadHalfWidth('paved');
      const lat = (r() * 2 - 1) * (hw - 1.2);
      const x = a.x + (b.x - a.x) * t + nx * lat, z = a.z + (b.z - a.z) * t + nz * lat;
      if (this.list.some((q) => Math.hypot(q.x - x, q.z - z) < 25)) continue;
      if (deckAt(x, z) != null) continue;
      const rx = 1.0 + r() * 1.8, rz = 0.7 + r() * 1.1;
      const rot = Math.atan2(b.x - a.x, b.z - a.z);
      // A quad 1.6 times the puddle each way, room for the damp halo; its corners on the road.
      const E = 1.6, c = Math.cos(rot), sn = Math.sin(rot), base = pos.length / 3, sd = r();
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = u * rz * E, lz = v * rx * E; // lx across the road, lz along it
        const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
        pos.push(wx, heightAt(wx, wz) + 0.17, wz); loc.push(u * E, v * E); seed.push(sd);
      }
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      this.list.push({ x, z, rx, rz, rot });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
    this.nextRipple = 0;
    // The game's own physical material, so it reflects the real sky (the scene's environment,
    // clouds and all) with the right Fresnel, and is lit and fogged like everything else. On
    // top: the ragged outline, the damp halo, a breeze ruffling it and rings from wheels.
    this.uniforms = { uTime: { value: 0 }, uRip: { value: this.ripples }, uRainP: { value: 0 } };
    const mat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.03, metalness: 0, envMapIntensity: 1.15, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aLocal; attribute float aSeed; varying vec2 vLocal; varying float vSeed; varying vec3 vWp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = aLocal; vSeed = aSeed; vWp = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform vec4 uRip[${MAX_RIPPLES}]; varying vec2 vLocal; varying float vSeed; varying vec3 vWp;
          float pH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float pN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(pH(i), pH(i + vec2(1, 0)), f.x), mix(pH(i + vec2(0, 1)), pH(i + vec2(1, 1)), f.x), f.y); }
          uniform float uRainP;
          vec2 pRain(vec2 p, float t) { vec2 g = vec2(0.0);
            for (int k = 0; k < 2; k++) { vec2 q = p * 2.6 + float(k) * 0.37, c = floor(q), f = fract(q) - 0.5;
              float h = pH(c + float(k) * 7.0); vec2 o = vec2(pH(c + 3.1), pH(c + 5.7)) - 0.5;
              float ph = fract(t * 1.4 + h); vec2 d = f - o * 0.6; float r = length(d), e = r - ph * 0.4;
              g += (r > 1e-3 ? d / r : vec2(0.0)) * exp(-e * e * 1000.0) * sin(e * 95.0) * (1.0 - ph); }
            return g; }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          // The outline: an ellipse made ragged by a few lobes and some noise.
          float pAng = atan(vLocal.y, vLocal.x);
          float pWob = 0.13 * sin(pAng * 3.0 + vSeed * 6.3) + 0.08 * sin(pAng * 5.0 + vSeed * 11.0) + 0.05 * sin(pAng * 9.0 + vSeed * 3.0);
          float pD = length(vLocal) / (1.0 + pWob + (pN(vWp.xz * 1.4 + vSeed * 30.0) - 0.5) * 0.24);
          float pWater = 1.0 - smoothstep(0.84, 1.0, pD);
          float pDamp = 1.0 - smoothstep(0.95, 1.5, pD + (pN(vWp.xz * 2.6 + 5.0) - 0.5) * 0.35);
          if (pWater + pDamp < 0.004) discard;
          roughnessFactor = mix(0.55, 0.03, pWater);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // A breeze barely moving it: the reflection should hold still, just shivering a little.
            vec2 g = vec2(sin(vWp.x * 9.0 + uTime * 2.1 + sin(vWp.z * 3.0)), sin(vWp.z * 8.0 - uTime * 1.7 + sin(vWp.x * 4.0))) * 0.0025;
            g += (vec2(pN(vWp.xz * 11.0 + uTime * 0.8), pN(vWp.xz * 11.0 - uTime * 0.7 + 9.0)) - 0.5) * 0.006;
            for (int i = 0; i < ${MAX_RIPPLES}; i++) {
              vec4 R = uRip[i]; float age = uTime - R.z;
              if (R.w <= 0.0 || age < 0.0 || age > 2.2) continue;
              vec2 dv = vWp.xz - R.xy; float r = length(dv), k = r - age * 1.7;
              g += (r > 0.001 ? dv / r : vec2(0.0)) * exp(-k * k * 10.0) * sin(k * 16.0) * R.w * (1.0 - age / 2.2) * 0.12;
            }
            g += pRain(vWp.xz, uTime) * uRainP * 0.35;
            normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz * pWater);
          }`)
        .replace('#include <opaque_fragment>', `
          // Water is clear: the tarmac under it shows, darkened by the wet, with what the water
          // reflects laid over it (dst * (1 - a) + reflection). The damp halo only darkens.
          float pEdge = smoothstep(0.0, 0.25, 1.0 - pD);
          float pK = pWater * mix(0.45, 0.62, pEdge);
          float pA = pK + pDamp * (1.0 - pWater) * 0.45 * (1.0 - pK);
          gl_FragColor = vec4(outgoingLight * pWater * mix(0.6, 1.0, pEdge) / max(pA, 1e-3), pA);`);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.renderOrder = 1; this.mesh.userData.noAO = true; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }
  // Rings across the puddle from (x, z), strength 0 to 1.
  ripple(x, z, strength = 0.7) {
    const R = this.ripples[this.nextRipple]; this.nextRipple = (this.nextRipple + 1) % MAX_RIPPLES;
    R.set(x, z, this.uniforms.uTime.value, strength);
  }
  // Each frame: the time, for the breeze and the rings.
  update(t, rain = 0) { this.uniforms.uTime.value = t; this.uniforms.uRainP.value = rain; }
  // True if a world point is inside any puddle.
  at(x, z) {
    for (const q of this.list) {
      const dx = x - q.x, dz = z - q.z;
      if (dx * dx + dz * dz > 16) continue;
      const c = Math.cos(q.rot), s = Math.sin(q.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c; // lz along road
      if ((lx * lx) / (q.rz * q.rz) + (lz * lz) / (q.rx * q.rx) < 1.1) return true;
    }
    return false;
  }
}

// ---------- Snowfall ----------
// Flakes in a box around the camera that wrap as it moves. Intensity 0..1 fades them in and out.
// One layer of flakes. Flakes stay put in the world apart from falling and drifting, and wrap
// round a box that follows the camera, so driving carries you through them. Flakes right in
// front of the eye fade out: they would be big blurry blobs, or inside a closed cabin.
class FlakeLayer {
  constructor(scene, count, box, lift, size) {
    this.n = count; this.box = box; this.lift = lift;
    this.pos = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * box.x;
      this.pos[i * 3 + 1] = (Math.random() - 0.5) * box.y;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * box.z;
      this.seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ color: 0xf4f8fb, size, map: softSprite(), transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    this.fade = { value: 0.4 };
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFade = this.fade;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFade;\nvarying float vNear;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvNear = smoothstep(uFade, uFade * 2.0, -mvPosition.z);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
        .replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.a *= vNear;\n#include <premultiplied_alpha_fragment>');
    };
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.anchor = null;
  }
  update(dt, eye, intensity, wind, fade) {
    this.fade.value = fade;
    this.mat.opacity = 0.75 * Math.min(1, intensity);
    this.points.geometry.setDrawRange(0, Math.round(this.n * Math.min(1, intensity * 1.2)));
    const c = { x: eye.x, y: eye.y + this.lift, z: eye.z };
    const d = this.anchor ? { x: c.x - this.anchor.x, y: c.y - this.anchor.y, z: c.z - this.anchor.z } : { x: 0, y: 0, z: 0 };
    this.anchor = c;
    const p = this.pos, b = this.box, hx = b.x / 2, hy = b.y / 2, hz = b.z / 2;
    const wx = (wind?.x || 0) * 0.08, wz = (wind?.z || 0) * 0.08, now = performance.now() * 0.001;
    const wrap = (v, h, size) => ((v + h) % size + size) % size - h;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i], k = i * 3;
      p[k] = wrap(p[k] + (Math.sin(s * 6.28 + now * (0.5 + s)) * 0.6 + wx) * dt - d.x, hx, b.x);
      p[k + 1] = wrap(p[k + 1] - (1.4 + s * 1.8) * dt - d.y, hy, b.y);
      p[k + 2] = wrap(p[k + 2] + (Math.cos(s * 4.1 + now * 1.3) * 0.6 + wz) * dt - d.z, hz, b.z);
    }
    this.points.position.set(c.x, c.y, c.z);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// Snow showers: a wide sparse layer gives depth, and a dense layer of finer flakes close to the
// camera keeps snow visible right in front of the car, including from the hood and cockpit.
export class SnowFall {
  constructor(scene, count = 2200) {
    this.layers = [
      new FlakeLayer(scene, count, { x: 70, y: 36, z: 70 }, 10, 0.32),
      new FlakeLayer(scene, Math.round(count * 0.7), { x: 24, y: 14, z: 24 }, 3, 0.17),
    ];
    this.intensity = 0;
  }
  // fade: flakes nearer the eye than this (in metres) fade out, so none fall inside the cabin.
  update(dt, camera, target, wind, fade = 0.4) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.4);
    const on = this.intensity > 0.01;
    for (const l of this.layers) {
      l.points.visible = on;
      if (on) l.update(dt, camera.position, this.intensity, wind, fade);
      else l.anchor = null;
    }
  }
}

// ---------- Rain ----------
// Streaks falling through a box that follows the camera, slanted by the wind and stretched by
// their speed, fading out close to the eye (so none fall inside the cabin), with drops bursting
// on the ground round about. Intensity 0 to 1.
export class RainFall {
  constructor(scene, count = 2600) {
    this.n = count; this.box = { x: 46, y: 26, z: 46 };
    this.p = new Float32Array(count * 3); this.speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.p[i * 3] = (Math.random() - 0.5) * this.box.x; this.p[i * 3 + 1] = (Math.random() - 0.5) * this.box.y; this.p[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      this.speed[i] = 8 + Math.random() * 3;
    }
    this.pos = new Float32Array(count * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 0 }, uFade: { value: 0.6 }, uLight: { value: 1 } }]),
      vertexShader: `uniform float uFade; varying float vNear;
        #include <fog_pars_vertex>
        void main() { vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          vNear = smoothstep(uFade, uFade * 2.5, -mvPosition.z);
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uOpacity, uLight; varying float vNear;
        #include <fog_pars_fragment>
        void main() { gl_FragColor = vec4(vec3(0.78, 0.83, 0.88) * (0.35 + 0.65 * uLight), uOpacity * vNear);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
    });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false; this.lines.visible = false; this.lines.userData.noAO = true;
    scene.add(this.lines);
    this.splash = new Particles(scene, { count: Math.round(count * 0.25), color: 0xdfe8ee, size: 0.14, opacity: 0.7, gravity: 9, drag: 2 });
    this.intensity = 0; this.anchor = null; this.carry = 0;
  }
  // target: how hard it should be raining here; wind: { x, z }; fade: metres from the eye that
  // stay clear; light: 0 at night to 1 by day; groundAt(x, z): for the splashes.
  update(dt, eye, target, wind, fade, light, groundAt) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.35);
    const I = this.intensity, on = I > 0.01;
    this.lines.visible = on;
    this.mat.uniforms.uOpacity.value = 0.32 * Math.min(1, I * 1.4);
    this.mat.uniforms.uFade.value = fade; this.mat.uniforms.uLight.value = light;
    this.splash.mat.opacity = 0.6 * light + 0.15;
    if (on) {
      const b = this.box, hx = b.x / 2, hy = b.y / 2, hz = b.z / 2, c = { x: eye.x, y: eye.y + 4, z: eye.z };
      const d = this.anchor ? { x: c.x - this.anchor.x, y: c.y - this.anchor.y, z: c.z - this.anchor.z } : { x: 0, y: 0, z: 0 };
      this.anchor = c;
      const wx = (wind?.x || 0) * 0.35, wz = (wind?.z || 0) * 0.35, live = Math.round(this.n * Math.min(1, I * 1.2));
      const wrap = (v, h, size) => ((v + h) % size + size) % size - h;
      const P = this.p, out = this.pos;
      for (let i = 0; i < this.n; i++) {
        const k = i * 3, o = i * 6, v = this.speed[i];
        P[k] = wrap(P[k] + wx * dt - d.x, hx, b.x); P[k + 1] = wrap(P[k + 1] - v * dt - d.y, hy, b.y); P[k + 2] = wrap(P[k + 2] + wz * dt - d.z, hz, b.z);
        const x = c.x + P[k], y = c.y + P[k + 1], z = c.z + P[k + 2], L = 0.055;
        out[o] = x; out[o + 1] = y; out[o + 2] = z;
        out[o + 3] = x - wx * L; out[o + 4] = y + v * L; out[o + 5] = z - wz * L;
      }
      this.lines.geometry.setDrawRange(0, live * 2);
      this.lines.geometry.attributes.position.needsUpdate = true;
      // Drops bursting where they land, all round you.
      this.carry += I * 320 * dt;
      for (; this.carry >= 1; this.carry--) {
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 16, x = eye.x + Math.cos(a) * r, z = eye.z + Math.sin(a) * r;
        this.splash.emit(x, groundAt(x, z) + 0.03, z, 0, 1.1, 0, 1, 0.9, 0.18);
      }
    }
    this.splash.update(dt);
  }
}

// ---------- Rain on the windscreen ----------
// Seen from the driver's seat: drops land on the glass and gather, run down it when slow and are
// pushed up and aside by the wind at speed, and the wipers sweep them away. Drawn on a canvas
// over the top of the view, faded out toward the dashboard.
export class Windscreen {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.drops = []; this.wipe = 0; this.carry = 0; this.on = false;
  }
  update(dt, rain, speed, show) {
    const c = this.c, g = this.g;
    const want = show && (rain > 0.02 || this.drops.length);
    if (!want) { if (this.on) { g.clearRect(0, 0, c.width, c.height); this.on = false; c.hidden = true; this.drops.length = 0; } return; }
    if (!this.on) { this.on = true; c.hidden = false; }
    const W = (c.width = Math.round(c.clientWidth * Math.min(2, devicePixelRatio))), H = (c.height = Math.round(c.clientHeight * Math.min(2, devicePixelRatio)));
    const k = W / 1400;
    this.carry += rain * (70 + speed * 4) * dt;
    for (; this.carry >= 1 && this.drops.length < 260; this.carry--) this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.75, r: (2 + Math.random() * 5) * k, t: 0 });
    // Slow, they creep down; fast, the airflow drives them up and out toward the edges.
    const up = Math.min(1, speed / 18);
    for (const d of this.drops) {
      d.t += dt;
      if (d.r > 4.5 * k || up > 0.2) {
        d.y += (d.r * (1 - up) * 14 - up * (40 + speed * 6) * k) * dt;
        d.x += (d.x - W / 2) / W * up * 90 * k * dt;
      }
    }
    // The wipers: a sweep every so often, quicker in heavier rain, clearing what it passes.
    this.wipe += dt * (0.4 + rain * 0.9);
    let blade = -1;
    if (this.wipe % 1 < 0.35) {
      const ph = (this.wipe % 1) / 0.35, ang = Math.PI * (ph < 0.5 ? ph * 2 : (1 - ph) * 2);
      blade = ang;
      const px = W * 0.5, py = H * 1.05, len = H * 1.0;
      this.drops = this.drops.filter((d) => { const a = Math.atan2(py - d.y, d.x - px); return Math.abs(a - (Math.PI - ang)) > 0.08 || Math.hypot(d.x - px, d.y - py) > len; });
    }
    this.drops = this.drops.filter((d) => d.y > -20 && d.y < H && d.x > -20 && d.x < W + 20);
    g.clearRect(0, 0, W, H);
    for (const d of this.drops) {
      // A bead: a dark rim, a bright fleck where it catches the light.
      const gr = g.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.35, d.r * 0.1, d.x, d.y, d.r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.35, 'rgba(210,225,235,0.18)'); gr.addColorStop(0.85, 'rgba(20,28,34,0.28)'); gr.addColorStop(1, 'rgba(20,28,34,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(d.x, d.y, d.r * (1 + up * 0.3), d.r * (1 - up * 0.2), 0, 0, Math.PI * 2); g.fill();
    }
    if (blade >= 0) {
      const px = W * 0.5, py = H * 1.05, a = Math.PI - blade;
      g.strokeStyle = 'rgba(8,10,12,0.85)'; g.lineWidth = 7 * k; g.lineCap = 'round';
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * H * 1.0, py - Math.sin(a) * H * 1.0); g.stroke();
    }
  }
}

// ---------- Skid marks ----------
// Dark rubber laid on the tarmac (and pale scuffs on gravel) where a tyre slides: a strip from
// each rear wheel, the newest overwriting the oldest once the pool is full.
const SKID_MAX = 1600;
export class SkidMarks {
  constructor(scene) {
    this.pos = new Float32Array(SKID_MAX * 6 * 3); this.col = new Float32Array(SKID_MAX * 6 * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.userData.noAO = true;
    scene.add(this.mesh);
    this.next = 0; this.used = 0; this.last = new Map();
  }
  // A wheel (key) at (x, y, z), heading h, sliding by s (0 to 1); paved: black rubber, else a scuff.
  mark(key, x, y, z, h, s, paved) {
    const L = this.last.get(key);
    if (s < 0.25) { this.last.delete(key); return; }
    if (!L) { this.last.set(key, { x, y, z, h }); return; }
    if (Math.hypot(x - L.x, z - L.z) < 0.35) return;
    if (Math.hypot(x - L.x, z - L.z) > 12) { this.last.set(key, { x, y, z, h }); return; }
    const w = 0.13, ax = Math.cos(L.h) * w, az = -Math.sin(L.h) * w, bx = Math.cos(h) * w, bz = -Math.sin(h) * w;
    const q = [[L.x - ax, L.y, L.z - az], [L.x + ax, L.y, L.z + az], [x + bx, y, z + bz], [L.x - ax, L.y, L.z - az], [x + bx, y, z + bz], [x - bx, y, z - bz]];
    const i = this.next, a = Math.min(0.75, s) * (paved ? 0.8 : 0.4), c = paved ? 0.02 : 0.32;
    q.forEach((v, k) => { this.pos.set(v, (i * 6 + k) * 3); this.col.set([c, c * 0.95, c * 0.9, a], (i * 6 + k) * 4); });
    this.next = (this.next + 1) % SKID_MAX; this.used = Math.min(SKID_MAX, this.used + 1);
    const g = this.mesh.geometry;
    g.setDrawRange(0, this.used * 6);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
    this.last.set(key, { x, y, z, h });
  }
}

// ---------- Wet tyre tracks ----------
// Out of a puddle or the water, each tyre prints a dark wet track on the road that thins as the
// tyre dries over the next dozen metres or so, and the whole track dries away over half a minute.
const WET_MAX = 1200;
export class WetTracks {
  constructor(scene) {
    this.pos = new Float32Array(WET_MAX * 6 * 3); this.born = new Float32Array(WET_MAX * 6).fill(-1e4); this.wet = new Float32Array(WET_MAX * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aBorn', new THREE.BufferAttribute(this.born, 1));
    g.setAttribute('aWet', new THREE.BufferAttribute(this.wet, 1));
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `attribute float aBorn; attribute float aWet; uniform float uTime; varying float vA;
        #include <fog_pars_vertex>
        void main() { vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          vA = aWet * (1.0 - smoothstep(4.0, 30.0, uTime - aBorn));
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vA;
        #include <fog_pars_fragment>
        void main() { if (vA < 0.004) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, vA * 0.42);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.userData.noAO = true;
    scene.add(this.mesh);
    this.next = 0; this.used = 0; this.last = new Map();
  }
  update(t) { this.uniforms.uTime.value = t; }
  // Wheel key at (x, y, z), heading h, how wet the tyre still is (0 to 1), now t (seconds).
  mark(key, x, y, z, h, wet, t) {
    const L = this.last.get(key);
    if (wet < 0.03) { this.last.delete(key); return; }
    if (!L) { this.last.set(key, { x, y, z, h, wet }); return; }
    const d = Math.hypot(x - L.x, z - L.z);
    if (d < 0.4) return;
    if (d > 12) { this.last.set(key, { x, y, z, h, wet }); return; }
    const w = 0.14, ax = Math.cos(L.h) * w, az = -Math.sin(L.h) * w, bx = Math.cos(h) * w, bz = -Math.sin(h) * w;
    const q = [[L.x - ax, L.y, L.z - az, L.wet], [L.x + ax, L.y, L.z + az, L.wet], [x + bx, y, z + bz, wet], [L.x - ax, L.y, L.z - az, L.wet], [x + bx, y, z + bz, wet], [x - bx, y, z - bz, wet]];
    const i = this.next;
    q.forEach((v, k) => { const o = i * 6 + k; this.pos.set([v[0], v[1], v[2]], o * 3); this.wet[o] = v[3]; this.born[o] = t; });
    this.next = (this.next + 1) % WET_MAX; this.used = Math.min(WET_MAX, this.used + 1);
    const g = this.mesh.geometry;
    g.setDrawRange(0, this.used * 6);
    g.attributes.position.needsUpdate = g.attributes.aBorn.needsUpdate = g.attributes.aWet.needsUpdate = true;
    this.last.set(key, { x, y, z, h, wet });
  }
}
