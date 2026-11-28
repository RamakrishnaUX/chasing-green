import * as THREE from 'three';
import { surfaceUniforms } from '../world/materials.js';
import { nearestRoad, roadHalfWidth } from '../world/terrain.js';

// The road's cross-section as terrain.js builds it (its ribbon) and materials.js lifts it: the lane
// 0.13 m over the land, the shoulder 0.15, rising in winter by up to 0.32 to a ploughed snow bank at
// its outer edge (SHOULDER wide), where the ribbon drops straight down to the land.
const SHOULDER = 1.1, BANK = 0.32;
// What the ground under the sheet already includes of the road there (roadLiftAt in terrain.js).
const liftAt = (d, hw) => d <= hw ? 0.13 : d <= hw + SHOULDER ? 0.13 - 0.05 * (d - hw) / SHOULDER : d <= hw + SHOULDER + 0.25 ? 0.08 : 0;

// The red the brake lights throw on the ground behind the car. Not a scene light (every lit pixel
// pays for every light, see setNightLights in main.js) but a thin sheet laid over the ground behind
// the tail: a grid whose points are set on the ground each frame, so it follows the road over a
// crest or a dip, drawn additively. Its shader lights it as each lamp would: brightest a little
// behind the bumper, where the lamp's rearward beam first meets the road, fading with distance as
// light does (inverse square, and the cosine of the angle it comes in at). When the brakes go on
// the glow spreads out from the car over a quarter of a second, and lets go as quickly.
// Faint by day, as it is on a real road; plain at dusk and after dark, and stronger on a wet road.
// At night the tail lights alone leave a dim red behind the car, which the brakes then brighten.

const COLS = 11, ROWS = 15; // grid points across and back: ~0.5 m apart

const vert = /* glsl */`
attribute vec2 aLocal;
varying vec2 vLocal;
#include <fog_pars_vertex>
void main() {
  vLocal = aLocal;
  vec4 mvPosition = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */`
uniform vec3 uLampA, uLampB; // lamps in the car's frame: x across, y height above the ground, z the tail
uniform float uGain, uReach, uWet;
uniform vec3 uColor;
varying vec2 vLocal;
#include <fog_pars_fragment>
// Light from one lamp at a point on the ground: inverse square, the cosine at the ground, and the
// lamp's own beam, which points rearward and gives less the further down it has to aim.
float lamp(vec3 L, vec2 p) {
  vec3 d = vec3(p.x - L.x, -L.y, L.z - p.y); // from the lamp to the ground point; z = distance behind
  float r2 = dot(d, d), r = sqrt(r2);
  float beam = pow(max(d.z / r, 0.0), 1.3);
  return beam * (L.y / r) * (L.y * L.y / r2); // times the height squared, so a low or high lamp peaks alike
}
void main() {
  float e = 0.5 * (lamp(uLampA, vLocal) + lamp(uLampB, vLocal));
  // At most about 0.3 (linear) behind each lamp at night: a red wash, not a spotlight. It spreads
  // out to uReach behind the tail.
  float back = uLampA.z - vLocal.y;
  float edge = 1.0 - smoothstep(uReach * 0.35, uReach, back);
  float side = 1.0 - smoothstep(1.2, 2.6, abs(vLocal.x) - abs(uLampA.x));
  float g = e * 2.4 * edge * side * smoothstep(-0.15, 0.25, back) * uGain * (1.0 + 0.9 * uWet);
  vec3 col = uColor * g;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class BrakeGlow {
  constructor(scene) {
    const n = COLS * ROWS;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLocal', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const idx = [];
    for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c, b = a + 1, d = a + COLS, e = d + 1;
      idx.push(a, b, d, b, e, d); // facing up
    }
    geo.setIndex(idx);
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uLampA: { value: new THREE.Vector3() }, uLampB: { value: new THREE.Vector3() },
      uGain: { value: 0 }, uReach: { value: 6 }, uColor: { value: new THREE.Color(1, 0.05, 0.025) },
    }]);
    this.uniforms.uWet = surfaceUniforms.uWet;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, fog: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      // Pulled further forward than the road (materials.js: -4, -12), so where the two meet, as
      // along the top of a snow bank, the glow stays on top.
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -16,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; // its points move every frame; it is small and only drawn when lit
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 2; // over the car's contact shadow
    // Out of the occlusion pass (post.js): drawn solid there, the sheet hovering over the ground
    // shaded its whole area, a dark slab behind the car wherever the snow is bright.
    this.mesh.userData.noAO = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.brake = 0; // how far the brake lights are on, eased
    this.spread = 0; // how far the glow has spread out from the car, 0..1
    this.lamps = null;
  }

  // Find the tail lamps on a freshly built model (before it is merged or added to the car), in the
  // car's frame. Lamps either side become the two light sources; a single centre lamp (the bike) is
  // used for both; a full-width light bar is treated as a lamp at each end.
  fit(group, tailMat) {
    group.updateMatrixWorld(true);
    const pts = [], box = new THREE.Box3();
    group.traverse((o) => {
      if (!o.isMesh || o.material !== tailMat) return;
      box.setFromObject(o);
      const w = box.max.x - box.min.x, y = (box.min.y + box.max.y) / 2, z = box.min.z, cx = (box.min.x + box.max.x) / 2;
      if (w > 0.8) pts.push([cx - w * 0.32, y, z], [cx + w * 0.32, y, z]);
      else pts.push([cx, y, z]);
    });
    const all = new THREE.Box3().setFromObject(group);
    let L = pts.filter((p) => p[0] < -0.15), R = pts.filter((p) => p[0] > 0.15);
    const avg = (s) => [s.reduce((a, p) => a + p[0], 0) / s.length, s.reduce((a, p) => a + p[1], 0) / s.length, Math.min(...s.map((p) => p[2]))];
    let a, b;
    if (L.length && R.length) { a = avg(L); b = avg(R); }
    else if (pts.length) { a = b = avg(pts); }
    else { const hw = (all.max.x - all.min.x) * 0.36, y = all.min.y + (all.max.y - all.min.y) * 0.45; a = [-hw, y, all.min.z]; b = [hw, y, all.min.z]; }
    // The light leaves from the lamp's face, a touch behind the body.
    const z = Math.min(a[2], b[2]) - 0.02;
    this.lamps = [new THREE.Vector3(a[0], Math.max(0.35, a[1]), z), new THREE.Vector3(b[0], Math.max(0.35, b[1]), z)];
    this.uniforms.uLampA.value.copy(this.lamps[0]);
    this.uniforms.uLampB.value.copy(this.lamps[1]);
    // The grid: from under the bumper to as far back as the glow can reach, a little wider than the car.
    const half = Math.max(Math.abs(a[0]), Math.abs(b[0])) + 2.6, z0 = z + 0.35, z1 = z - 8.5;
    const loc = this.mesh.geometry.attributes.aLocal;
    this.step = Math.hypot((2 * half) / (COLS - 1), (z0 - z1) / (ROWS - 1)); // the widest gap between points (a cell's diagonal)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      loc.setXY(r * COLS + c, -half + (2 * half * c) / (COLS - 1), z0 + ((z1 - z0) * r) / (ROWS - 1));
    }
    loc.needsUpdate = true;
  }

  // braking: 0 or 1. dark: 0 day .. 1 night. heightAt(x, z): the ground. show: whether the car is out.
  update(dt, { braking, dark, x, z, heading, heightAt, show }) {
    const k = dt ? 1 - Math.exp(-dt * (braking > this.brake ? 28 : 14)) : 1;
    this.brake += (braking - this.brake) * k;
    // Spreads out from the car while the brakes are on; draws back in once they are off and faded.
    this.spread = braking ? Math.min(1, this.spread + (dt || 1) * 4) : this.brake < 0.05 ? 0 : this.spread;
    // The tail lights alone after dark, then the brakes: faint by day, plain by night.
    const lamp = dark * 0.2 + this.brake;
    const gain = lamp * (0.14 + 0.86 * dark);
    this.mesh.visible = show && !!this.lamps && gain > 0.004;
    if (!this.mesh.visible) return;
    const ease = 1 - (1 - this.spread) ** 3;
    const wet = surfaceUniforms.uWet.value;
    this.uniforms.uGain.value = gain;
    // The reach: the tail lights' own short pool, out to the brakes' fuller one as it spreads.
    this.uniforms.uReach.value = (3.4 + 3.6 * ease * Math.min(1, this.brake * 1.5)) * (1 + 0.35 * wet);
    // Lay the grid on the ground under where it falls.
    const fx = Math.sin(heading), fz = Math.cos(heading), rx = fz, rz = -fx;
    const pos = this.mesh.geometry.attributes.position, loc = this.mesh.geometry.attributes.aLocal;
    // On a road the sheet also climbs the shoulder and its snow bank, which rise above the ground
    // the car reads: laid on that ground it ran under them, and the red was cut off along the
    // sides of the road. The grid's points are up to ~0.9 m apart and the bank ends in a wall, so each
    // point takes the highest the road reaches within that much of it: the sheet then passes over
    // the top of the bank instead of through it (and floats a little over the land just past it,
    // which an additive glow never shows).
    const r = nearestRoad(x, z, 14);
    let ax = 0, az = 0, nx = 0, nz = 0, hw = 0, bank = 0;
    if (r) {
      const s = r.seg, len = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
      ax = s.ax; az = s.az; nx = -(s.bz - s.az) / len; nz = (s.bx - s.ax) / len; hw = roadHalfWidth(r.type);
      bank = THREE.MathUtils.smoothstep(surfaceUniforms.uRoadSnow.value, 0.1, 0.5) * BANK;
    }
    const W = hw + SHOULDER, reach = this.step;
    for (let i = 0; i < pos.count; i++) {
      const u = loc.getX(i), v = loc.getY(i);
      const wx = x + rx * u + fx * v, wz = z + rz * u + fz * v;
      let y = heightAt(wx, wz);
      if (r) {
        const d = Math.abs((wx - ax) * nx + (wz - az) * nz);
        const top = Math.min(d + reach, W);
        if (d - reach < W && top > hw) y = Math.max(y, y - liftAt(d, hw) + 0.18 + bank * (top - hw) / SHOULDER);
      }
      pos.setXYZ(i, wx, y + 0.04, wz);
    }
    pos.needsUpdate = true;
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
