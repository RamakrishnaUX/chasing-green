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
};

const GLSL = /* glsl */ `
uniform float uDirt, uBase, uGround; uniform vec3 uDirtColor; uniform mat4 uCarInv;
varying vec3 vCarL; varying float vCarY;
float cvh(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float cvn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cvh(i), cvh(i + vec3(1,0,0)), f.x), mix(cvh(i + vec3(0,1,0)), cvh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cvh(i + vec3(0,0,1)), cvh(i + vec3(1,0,1)), f.x), mix(cvh(i + vec3(0,1,1)), cvh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float gAmt;`;

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
          .replace('#include <common>', '#include <common>\nuniform mat4 uCarInv; varying vec3 vCarL; varying float vCarY;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ vec4 gw = modelMatrix * vec4(transformed, 1.0); vCarL = (uCarInv * gw).xyz; vCarY = gw.y; }');
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
          }`)
          .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - gAmt * 0.85;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - gAmt;\n#endif');
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
