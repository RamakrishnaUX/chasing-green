// Screen colours in, scene light out.
//
// The sky is art-directed the way Slow Roads does it: a pale clear blue on the horizon deepening to a
// rich blue by about 30 degrees up, with distant land fading into the same colours. Those colours are
// chosen as they should look on screen. But everything the scene draws passes through the tone curve
// (AgX with the Punchy look, or ACES) and the grade (levels, warm highlights, S-curve), which turned a
// physically lit sky grey-cyan and milky. So each wanted screen colour is run backwards through that
// exact chain (skytoneMath.js) to the scene light that lands on it, and kept in a small 3D table that
// the sky shader and the fog both read, so a far hill and the sky behind it land on the same colour.
import * as THREE from 'three';
import { N, clamp01, plainTable } from './skytoneMath.js';

export class SkyTone {
  // look: the power and saturation installLook put into the AgX curve (null for none). The tone
  // curve, exposure and grade are read once, here: photo mode's exposure should still brighten or
  // darken the sky like everything else, not be cancelled by it.
  constructor(renderer, post, look = null) {
    const U = post?.grade.uniforms, v3 = (v) => [v.x, v.y, v.z];
    this.params = {
      tm: renderer.toneMapping === THREE.AgXToneMapping ? 'agx' : renderer.toneMapping === THREE.ACESFilmicToneMapping ? 'aces' : 'linear',
      exposure: renderer.toneMappingExposure,
      look: renderer.toneMapping === THREE.AgXToneMapping ? look : null,
      grade: U ? {
        sat: U.uSat.value, contrast: U.uContrast.value, gain: v3(U.uGain.value), lift: v3(U.uLift.value), black: U.uBlack.value, white: U.uWhite.value,
        vibrance: U.uVibrance.value, split: U.uSplit.value, shadowTint: v3(U.uShadowTint.value), highTint: v3(U.uHighTint.value), curve: U.uCurve.value,
      } : null,
    };
    this.texture = new THREE.Data3DTexture(new Uint16Array(N * N * N * 4), N, N, N);
    const t = this.texture;
    t.type = THREE.HalfFloatType; t.format = THREE.RGBAFormat;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.unpackAlignment = 1;
    // Uncorrected until the worker's table arrives (during the loading screen, a second or two).
    this.set(plainTable());
    this.ready = new Promise((resolve) => {
      try {
        const worker = new Worker(new URL('./skytoneWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => { this.set(data); worker.terminate(); resolve(true); };
        worker.onerror = (e) => { console.warn('Sky colours: the table did not build; the sky is uncorrected.', e); worker.terminate(); resolve(false); };
        worker.postMessage(this.params);
      } catch (e) { console.warn('Sky colours: no worker; the sky is uncorrected.', e); resolve(false); }
    });
  }
  set(lut) {
    this.lut = lut;
    const half = this.texture.image.data;
    for (let i = 0; i < lut.length; i++) half[i] = THREE.DataUtils.toHalfFloat(lut[i]);
    this.texture.needsUpdate = true;
    this.version = (this.version || 0) + 1;
  }
  // Screen colour (sRGB, 0 to 1, an array or a THREE.Color holding sRGB values) to scene light,
  // read from the table exactly as the shader reads it.
  toScene(srgb, out = new THREE.Color()) {
    const s = Array.isArray(srgb) ? srgb : [srgb.r, srgb.g, srgb.b];
    const p = s.map((x) => clamp01(x) * (N - 1)), i0 = p.map((x) => Math.min(N - 2, Math.floor(x))), f = p.map((x, k) => x - i0[k]);
    let r = 0, g = 0, b = 0;
    for (let c = 0; c < 8; c++) {
      const dr = c & 1, dg = (c >> 1) & 1, db = (c >> 2) & 1;
      const w = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2]);
      if (w === 0) continue;
      const i = (((i0[2] + db) * N + i0[1] + dg) * N + i0[0] + dr) * 4;
      r += this.lut[i] * w; g += this.lut[i + 1] * w; b += this.lut[i + 2] * w;
    }
    return out.setRGB(2 ** r, 2 ** g, 2 ** b, THREE.LinearSRGBColorSpace);
  }
}
// The same lookup in GLSL: c is a screen colour, sRGB 0 to 1.
export const TONE_GLSL = /* glsl */ `
uniform highp sampler3D uTone;
vec3 toScene(vec3 c){ return exp2(texture(uTone, clamp(c, 0.0, 1.0) * ${((N - 1) / N).toFixed(6)} + ${(0.5 / N).toFixed(6)}).rgb); }`;
