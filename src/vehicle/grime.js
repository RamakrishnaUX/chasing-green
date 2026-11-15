import * as THREE from 'three';

// Dirt on the car. It builds up from the wheels: a band of mud or dust along the sills, arches
// and lower doors, splashes and spots above it, rising further up the body as it gets worse. The
// paint goes matte under it. Rain rinses it off slowly and deep water washes most of it away.
//
// uDirt: how dirty, 0 (clean) to 1 (caked). uColor: what it is (pale dust off gravel, dark mud
// off wet ground, black grit off the sand, grey slush in winter), blended as the car picks up new
// dirt. uBase: dirt that never washes off (the realistic look's built-in cars have a little road
// grime even when clean). The pattern is fixed to the car (uCarInv takes the world into the car's
// own frame); the height is measured from the ground under it (uGround).
export const grime = {
  uDirt: { value: 0 },
  uDirtColor: { value: new THREE.Color().setRGB(0.36, 0.3, 0.22, THREE.SRGBColorSpace) },
  uBase: { value: 0 },
  uGround: { value: 0 },
  uCarInv: { value: new THREE.Matrix4() },
  // Rain on the car (CarRain in rain.js drives these): how wet it is (0 to 1), how hard rain is
  // landing on it now, how far the beads on top have been blown back and the runs down the
  // sides have crept, a clock for the fresh hits, and whether the outside of the glass shows
  // its drops (not from the driver's seat, where the windscreen draws its own).
  uCarWet: { value: 0 }, uCarRain: { value: 0 }, uSlide: { value: 0 }, uRun: { value: 0 }, uRTime: { value: 0 }, uGlassWet: { value: 1 },
};

const GLSL = /* glsl */ `
uniform float uDirt, uBase, uGround; uniform vec3 uDirtColor; uniform mat4 uCarInv;
varying vec3 vCarL; varying float vCarY;
float cvh(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float cvn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cvh(i), cvh(i + vec3(1,0,0)), f.x), mix(cvh(i + vec3(0,1,0)), cvh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cvh(i + vec3(0,0,1)), cvh(i + vec3(1,0,1)), f.x), mix(cvh(i + vec3(0,1,1)), cvh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float gAmt;
uniform float uCarWet, uCarRain, uSlide, uRun, uRTime, uGlassWet;
varying vec3 vCarN;
// Water on the car: wGrad tilts the surface (in the car's frame), wBead is how much of this spot
// is a bead or a run of water.
vec3 wGrad; float wBead;
// Beads in one plane: q in metres, s cells per metre, amt the share of cells holding one.
// Returns the dome's tilt in the plane (xy) and whether this spot is in a bead (z).
vec3 wBeads(vec2 q, float s, float amt, float sd) {
  vec2 g = q * s, c = floor(g), f = fract(g);
  if (cvh(vec3(c, sd)) > amt) return vec3(0.0);
  vec2 o = vec2(cvh(vec3(c, sd + 1.3)), cvh(vec3(c, sd + 2.7))) * 0.4 + 0.3;
  float r = mix(0.1, 0.27, cvh(vec3(c, sd + 4.1)));
  vec2 d = (f - o) / r; float rr = dot(d, d);
  if (rr >= 1.0) return vec3(0.0);
  return vec3(d * 0.9, 1.0);
}
// Runs of water trickling down a vertical face: q.x across it, q.y up it.
vec3 wRuns(vec2 q, float t, float sd) {
  float col = q.x * 7.0, c = floor(col);
  float h = cvh(vec3(c, sd, 3.0));
  float x = fract(col) - 0.5 - (h - 0.5) * 0.5;
  float w = mix(0.05, 0.11, cvh(vec3(c, sd, 7.0)));
  float seg = fract(q.y * (0.7 + h) + t * (0.5 + h) + h * 9.0);
  float on = smoothstep(0.0, 0.04, seg) * smoothstep(0.45, 0.3, seg) * step(0.45, h);
  float k = smoothstep(w, w * 0.4, abs(x)) * on;
  return vec3(clamp(x / w, -1.0, 1.0) * 0.8 * k, 0.0, k);
}
void wetCar(vec3 p, vec3 n) {
  wGrad = vec3(0.0); wBead = 0.0;
  if (uCarWet < 0.01) return;
  vec3 an = abs(n), w = an * an * an * an; w /= dot(w, vec3(1.0));
  // Beads smaller than a couple of pixels fade into a plain wet sheen, so they never sparkle.
  float fw = length(fwidth(p));
  float near1 = 1.0 - smoothstep(0.012, 0.03, fw), near2 = 1.0 - smoothstep(0.005, 0.012, fw);
  if (w.y > 0.02 && n.y > 0.0) {
    // On top: round beads, blown back toward the tail at speed.
    vec2 q = p.xz + vec2(0.0, uSlide);
    vec3 b1 = wBeads(q, 13.0, uCarWet * 0.6, 1.0) * near1;
    vec3 b2 = wBeads(q + 7.3, 31.0, uCarWet * 0.7, 2.0) * near2;
    vec3 b = b1.z > 0.0 ? b1 : b2;
    wGrad += vec3(b.x, 0.0, b.y) * w.y; wBead += b.z * w.y;
  }
  for (int k = 0; k < 2; k++) {
    // On the sides: beads drawn out downward as they creep, and runs of water.
    float wk = k == 0 ? w.x : w.z;
    if (wk < 0.02) continue;
    vec2 q = k == 0 ? p.zy : p.xy;
    vec3 b = wBeads(vec2(q.x, q.y * 0.6 + uRun * 0.25), 16.0, uCarWet * 0.4, 3.0 + float(k)) * near1;
    vec3 r = wRuns(q, uRun, float(k)) * near1 * smoothstep(0.3, 0.8, uCarWet);
    vec3 s = b.z > 0.0 ? vec3(b.x, b.y / 0.6, b.z) : r;
    wGrad += (k == 0 ? vec3(0.0, s.y, s.x) : vec3(s.x, s.y, 0.0)) * wk; wBead += s.z * wk;
  }
  if (uCarRain > 0.02 && n.y > 0.35) {
    // Fresh drops landing on top: a ring spreading from each.
    vec2 g = p.xz * 9.0, c = floor(g), f = fract(g) - 0.5;
    float ph = fract(uRTime * (0.8 + uCarRain * 1.6) + cvh(vec3(c, 11.0)));
    vec2 d = f - (vec2(cvh(vec3(c, 12.0)), cvh(vec3(c, 13.0))) - 0.5) * 0.5;
    float r = length(d), e = r - ph * 0.45;
    vec2 gr = (r > 1e-3 ? d / r : vec2(0.0)) * exp(-e * e * 600.0) * (1.0 - ph) * step(ph, 0.6) * 0.6 * near2 * uCarRain * smoothstep(0.35, 0.8, n.y);
    wGrad += vec3(gr.x, 0.0, gr.y);
  }
  wBead = clamp(wBead, 0.0, 1.0);
}
// Tilts the view-space normal by the water's shape.
vec3 wetTilt() { return mat3(viewMatrix) * (transpose(mat3(uCarInv)) * wGrad); }`;

const VERT = 'uniform mat4 uCarInv; varying vec3 vCarL; varying float vCarY; varying vec3 vCarN;';
const VERT_MAIN = '{ vec4 gw = modelMatrix * vec4(transformed, 1.0); vCarL = (uCarInv * gw).xyz; vCarY = gw.y; vCarN = mat3(uCarInv) * normalize(mat3(modelMatrix) * objectNormal); }';

// Drops on the outside of the windows: the same beads, runs and fresh hits as on the paint, as
// little clear lenses on the glass.
export function applyGlassWet(group) {
  const done = new Set();
  group.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of [].concat(o.material)) {
      if (!mat || done.has(mat) || !mat.userData?.glass || mat.userData.wet || !mat.isMeshStandardMaterial) continue;
      done.add(mat); mat.userData.wet = true;
      const own = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : null;
      const key = `car-glass-wet-${mat.type}-${own ? mat.customProgramCacheKey() : ''}`;
      mat.customProgramCacheKey = () => key;
      mat.onBeforeCompile = (shader, renderer) => {
        own?.call(mat, shader, renderer);
        Object.assign(shader.uniforms, grime);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERT}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${GLSL}`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          wetCar(vCarL, normalize(vCarN)); wBead *= uGlassWet; wGrad *= uGlassWet;
          roughnessFactor = mix(roughnessFactor, 0.02, wBead);
          diffuseColor.a = mix(diffuseColor.a, min(1.0, diffuseColor.a + 0.08), wBead);
          diffuseColor.rgb += wBead * 0.015;`)
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 wNV = wetTilt();\nnormal = normalize(normal + wNV);')
          .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = normalize(clearcoatNormal + wNV);\n#endif');
      };
    }
  });
}

export function applyGrime(group) {
  const done = new Set();
  group.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of [].concat(o.material)) {
      if (!mat || done.has(mat)) continue;
      done.add(mat);
      if (!mat.isMeshStandardMaterial || mat.transparent || mat.userData?.glass || mat.userData?.grime) continue;
      if (mat.emissive && Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b) * (mat.emissiveIntensity ?? 1) > 0.05) continue;
      mat.userData.grime = true;
      // A material with its own shader changes (the camper's two-tone paint) keeps them: the dirt
      // goes on after, and the pair is compiled as its own program.
      const own = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : null;
      const key = `car-grime-${mat.type}-${own ? mat.customProgramCacheKey() : ''}`;
      mat.customProgramCacheKey = () => key;
      mat.onBeforeCompile = (shader, renderer) => {
        own?.call(mat, shader, renderer);
        Object.assign(shader.uniforms, grime);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERT}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${GLSL}`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          {
            float h = vCarY - uGround;
            float cn = cvn(vCarL * 3.1) * 0.6 + cvn(vCarL * 11.0 + 5.0) * 0.4;
            float d = max(uDirt, uBase);
            // A solid coat low down (sills, arches, the bottom of the doors), a patchy band above it
            // reaching higher the dirtier the car is, and spatters thrown above that.
            float reach = mix(0.5, 1.4, uDirt);
            float coat = smoothstep(reach * 0.55, reach * 0.2, h + (cn - 0.5) * 0.35);
            float band = max(coat, smoothstep(reach, reach * 0.4, h + (cn - 0.5) * 0.6) * smoothstep(0.32, 0.62, cn + d * 0.25));
            float spat = smoothstep(0.74, 0.86, cvn(vCarL * 17.0 + 2.0)) * smoothstep(reach * 1.9, reach, h) * smoothstep(0.15, 0.6, uDirt);
            gAmt = clamp(max(band * min(1.0, d * 1.6), spat * 0.85), 0.0, 1.0);
            // Darker where it is thick, lighter as it dries out at the edges.
            vec3 dc = uDirtColor * mix(1.12, 0.82, smoothstep(0.4, 1.0, band));
            diffuseColor.rgb = mix(diffuseColor.rgb, dc, gAmt * 0.94);
            roughnessFactor = mix(roughnessFactor, 0.93, gAmt);
            // Wet: a film of water glosses the paint and darkens anything rough (tyres, plastic,
            // canvas) and the dirt; beads are clear, smooth lenses, a little darker under them.
            wetCar(vCarL, normalize(vCarN));
            float r0 = roughnessFactor;
            roughnessFactor = mix(roughnessFactor, min(roughnessFactor, mix(0.2, 0.55, smoothstep(0.5, 0.95, r0))), uCarWet);
            roughnessFactor = mix(roughnessFactor, 0.03, wBead);
            diffuseColor.rgb *= mix(1.0, 0.8, wBead) * mix(1.0, mix(0.94, 0.66, max(gAmt, smoothstep(0.5, 0.9, r0))), uCarWet);
          }`)
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 wNV = wetTilt();\nnormal = normalize(normal + wNV);')
          .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = normalize(clearcoatNormal + wNV);\n#endif')
          .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - gAmt * 0.85;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - gAmt;\nmaterial.clearcoatRoughness = mix(material.clearcoatRoughness, 0.03, wBead);\n#endif');
      };
    }
  });
}

// Dirt the car is picking up. Rates are per second at speed; colours as picked from a photo (sRGB).
const KIND = {
  gravel: { rate: 0.012, color: [0.58, 0.5, 0.4] }, // pale grey-brown dust
  moss: { rate: 0.02, color: [0.24, 0.18, 0.12] }, // dark peaty mud
  snow: { rate: 0.012, color: [0.62, 0.62, 0.62] }, // grey slush
  sand: { rate: 0.018, color: [0.13, 0.13, 0.14] }, // black volcanic grit
  ford: { rate: 0.06, color: [0.36, 0.3, 0.22] }, // river silt
  wetroad: { rate: 0.004, color: [0.24, 0.22, 0.2] }, // road spray
  slush: { rate: 0.009, color: [0.55, 0.54, 0.52] }, // winter road
};

// Each frame while driving. surface: the jeep's surface; sp: m/s; depth: water at the wheels;
// rain 0..1; wet: how wet the ground is; roadSnow 0..1. Returns true when it changed enough to save.
export function updateGrime(state, { dt, surface, sp, depth, rain, wet, roadSnow, boat }) {
  let kind = null;
  if (depth > 0.05 && depth < 0.6) kind = 'ford';
  else if (surface === 'paved') kind = roadSnow > 0.3 ? 'slush' : wet > 0.3 ? 'wetroad' : null;
  else if (surface === 'gravel') kind = roadSnow > 0.3 ? 'slush' : 'gravel';
  else if (surface === 'moss') kind = 'moss';
  else if (KIND[surface]) kind = surface;
  const before = state.dirt;
  if (kind && sp > 2) {
    const k = KIND[kind];
    let add = k.rate * Math.min(1, sp / 15) * dt * (kind === 'gravel' && wet > 0.3 ? 1.6 : 1);
    add *= 1 - state.dirt * 0.6; // it builds up quickly at first, then more slowly
    const c = state.color, w = add / Math.max(0.05, state.dirt + add);
    // Wet gravel turns its dust to mud.
    const col = kind === 'gravel' && wet > 0.3 ? KIND.moss.color : k.color;
    for (let i = 0; i < 3; i++) c[i] += (col[i] - c[i]) * w;
    state.dirt = Math.min(1, state.dirt + add);
  }
  // Washing: deep water and the boat take most of it, rain rinses it slowly.
  if (depth > 0.6 || boat > 0.5) state.dirt = Math.max(0, state.dirt - dt * 0.18);
  if (rain > 0.05) state.dirt = Math.max(0, state.dirt - dt * 0.0035 * rain);
  grime.uDirt.value = state.dirt;
  setDirtColor(state.color);
  return Math.abs(state.dirt - (state.saved ?? 0)) > 0.04 || (before > 0 && state.dirt === 0 && state.saved !== 0);
}

export function setDirtColor(c) { grime.uDirtColor.value.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); }
