import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// ---------- The cinematic look (realistic look on desktop) ----------
// A modern game's picture: a film tone curve with real contrast and colour, light with weight and
// direction, the sun's rays raking through the haze, warm highlights against cool shadows.

// AgX on its own is a neutral base: it rolls bright sky and snow off like film, but leaves the
// picture flat and grey, like an ungraded camera file. Blender's "Punchy" look is the standard
// grade on top of it: a power curve in AgX's log space (deeper shadows, firmer mid-tones) and more
// colour. It is applied inside the tone mapper, where it cannot clip.
export function installLook({ power = 1.3, sat = 1.32 } = {}) {
  const C = THREE.ShaderChunk;
  if (C.tonemapping_pars_fragment.includes('cgLook')) return;
  C.tonemapping_pars_fragment = C.tonemapping_pars_fragment
    .replace('vec3 AgXToneMapping( vec3 color ) {', `vec3 cgLook( vec3 v ) {
  float luma = dot( v, vec3( 0.2126, 0.7152, 0.0722 ) );
  v = pow( max( v, vec3( 0.0 ) ), vec3( ${power.toFixed(3)} ) );
  return luma + ${sat.toFixed(3)} * ( v - luma );
}
vec3 AgXToneMapping( vec3 color ) {`)
    .replace('// v = agxLook(v, look);', 'color = cgLook( color );');
}

// ---------- Sun rays ----------
// Light shafts streaming from the sun through gaps in clouds, ridges and the car: the bright sky
// around the sun is blurred towards it at half resolution (Mitchell, GPU Gems 3, ch. 13), so
// anything standing in front of the sun cuts dark gaps in the glow. Only the sky's bright part
// near the sun feeds it, so snow and white walls elsewhere do not stream.
const SHAFT = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uThreshold: { value: 1.6 }, uReach: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAspect; uniform float uThreshold; uniform float uReach;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 bright(vec2 uv){
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (!(c.r == c.r)) return vec3(0.0);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Only light near the sun streams.
      vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
      float near = exp(-dot(d, d) / (uReach * uReach));
      return min(c, vec3(8.0)) * smoothstep(uThreshold, uThreshold * 2.2, l) * near;
    }
    void main(){
      const int N = 40;
      vec2 delta = (vUv - uSun) * (0.92 / float(N));
      vec2 uv = vUv - delta * h(gl_FragCoord.xy); // jitter, so the steps blend into a smooth fan
      float decay = 1.0, w = 0.0;
      vec3 sum = vec3(0.0);
      for (int i = 0; i < N; i++) {
        sum += bright(uv) * decay; w += decay;
        decay *= 0.955; uv -= delta;
      }
      gl_FragColor = vec4(sum / w, 1.0);
    }`,
};
const SHAFT_COMP = {
  uniforms: { tDiffuse: { value: null }, tShafts: { value: null }, uStrength: { value: 0 }, uTint: { value: new THREE.Color(1, 0.86, 0.66) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tShafts; uniform float uStrength; uniform vec3 uTint;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 s = texture2D(tShafts, vUv).rgb;
      // Screen-blend in linear light: the rays brighten the haze, never burn it out.
      c.rgb += s * uTint * uStrength;
      gl_FragColor = c;
    }`,
};

export class SunShaftsPass extends Pass {
  constructor(width, height) {
    super();
    this.rt = new THREE.WebGLRenderTarget(Math.max(1, width >> 1), Math.max(1, height >> 1), { type: THREE.HalfFloatType, depthBuffer: false });
    this.shaftMat = new THREE.ShaderMaterial({ ...SHAFT, uniforms: THREE.UniformsUtils.clone(SHAFT.uniforms), depthTest: false, depthWrite: false });
    this.compMat = new THREE.ShaderMaterial({ ...SHAFT_COMP, uniforms: THREE.UniformsUtils.clone(SHAFT_COMP.uniforms), depthTest: false, depthWrite: false });
    this.compMat.uniforms.tShafts.value = this.rt.texture;
    this.quad = new FullScreenQuad(this.shaftMat);
    this.strength = 0;
    this._v = new THREE.Vector3();
  }
  // The sun's place on screen and how strongly it shines this frame (0 hides the pass).
  setSun(camera, sunDir, strength, tint) {
    const v = this._v.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    const fwd = camera.getWorldDirection(this._f ||= new THREE.Vector3()).dot(sunDir);
    this.shaftMat.uniforms.uSun.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    // Fade out as the sun swings behind you or far off the edge of the frame.
    const off = Math.max(Math.abs(v.x), Math.abs(v.y));
    const k = THREE.MathUtils.smoothstep(fwd, 0.05, 0.35) * (1 - THREE.MathUtils.smoothstep(off, 1.1, 2.2));
    this.strength = strength * k;
    if (tint) this.compMat.uniforms.uTint.value.copy(tint);
  }
  setSize(w, h) {
    this.rt.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.shaftMat.uniforms.uAspect.value = w / Math.max(1, h);
  }
  render(renderer, writeBuffer, readBuffer) {
    if (this.strength < 0.002) {
      // Nothing to add: copy through so the chain stays intact.
      this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
      this.compMat.uniforms.uStrength.value = 0;
    } else {
      this.shaftMat.uniforms.tDiffuse.value = readBuffer.texture;
      this.quad.material = this.shaftMat;
      renderer.setRenderTarget(this.rt);
      this.quad.render(renderer);
      this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
      this.compMat.uniforms.uStrength.value = this.strength;
    }
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.rt.dispose(); this.shaftMat.dispose(); this.compMat.dispose(); this.quad.dispose(); }
}
