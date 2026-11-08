import * as THREE from 'three';

// The night sky as water sees it. By day the water reflects the baked sky environment; after
// dusk that fades out, and it never held the aurora, the moon or the stars. So a small cube of
// just the sky (the sky dome, the clouds and the aurora, all on SKY_LAYER) is drawn round the
// camera, a couple of faces each frame, and the water materials add it as a mirror reflection
// at night (nightSky uniforms; see materials.js and effects.js). On calm water far off, the
// aurora and the moon come back upside down; close by, ripples break them up.
export const SKY_LAYER = 3;
export const nightSky = { uNightSky: { value: null }, uNightRefl: { value: 0 } };

// The faces water can see (not straight down): +x, -x, +y, +z, -z.
const FACES = [0, 1, 2, 4, 5];

export const NIGHT_SKY_GLSL = /* glsl */ `
uniform samplerCube uNightSky; uniform float uNightRefl;
// The night sky mirrored in a surface with this view-space normal, by Fresnel: faint looking
// straight down, strong at a grazing angle.
vec3 nightMirror(vec3 n) {
  if (uNightRefl < 0.002) return vec3(0.0);
  vec3 v = normalize(vViewPosition);
  // Still water at night: the ripples only wobble the mirror image, they do not scatter it.
  n = normalize(mix(n, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, 0.6));
  vec3 r = inverseTransformDirection(reflect(-v, n), viewMatrix);
  r.y = abs(r.y);
  // (A little stronger than real Fresnel close in, as the eye expects of calm water at night.)
  float fr = 0.07 + 0.93 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0);
  // The sky shaders write display colours (no tone mapping of their own): back to light first.
  return pow(textureCube(uNightSky, r).rgb, vec3(2.2)) * fr * uNightRefl * 1.6;
}`;

export class SkyReflection {
  constructor(renderer, size = 128) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
    this.cam = new THREE.CubeCamera(1, 5000, this.rt);
    for (const c of this.cam.children) c.layers.set(SKY_LAYER);
    nightSky.uNightSky.value = this.rt.texture;
    this.next = 0; this.primed = false;
    // Set by the governor (perf.js): faces redrawn per update (0: the reflection is off), and how
    // many frames apart.
    this.faces = 2; this.every = 1; this.n = 0;
  }
  // Each frame: where the eye is, and how strongly the night sky shows in the water (0 by day).
  update(scene, position, strength) {
    if (this.off || !this.faces) strength = 0; // testing: chasingGreen.skyRefl.off = true
    nightSky.uNightRefl.value = strength;
    if (strength < 0.01) { this.primed = false; return; }
    if (this.primed && this.n++ % this.every) return;
    const r = this.renderer, prev = r.getRenderTarget(), auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    this.cam.position.copy(position);
    this.cam.updateMatrixWorld();
    if (!this.primed) { this.cam.update(r, scene); this.primed = true; } // all six the first time (sets the faces up too)
    else {
      for (let k = 0; k < this.faces; k++) {
        const i = FACES[this.next]; this.next = (this.next + 1) % FACES.length;
        r.setRenderTarget(this.rt, i);
        r.render(scene, this.cam.children[i]);
      }
    }
    r.setRenderTarget(prev);
    r.shadowMap.autoUpdate = auto;
  }
}
