import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';

// Removes bad pixels (NaN or infinity from very bright sun glints) before bloom can smear them
// into black blocks, and caps extreme highlights so they bloom softly instead of overflowing.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 v = c.rgb;
      bool bad = !(v.r == v.r) || !(v.g == v.g) || !(v.b == v.b) || any(greaterThan(abs(v), vec3(6.0e4)));
      if (bad) v = vec3(1.0);
      gl_FragColor = vec4(min(max(v, vec3(0.0)), vec3(24.0)), 1.0);
    }`,
};

// Final look: soft bloom on bright things (sun, aurora, headlights), then a light film grade.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.28 },
    uSat: { value: 1.06 },
    uContrast: { value: 1.05 },
    uLift: { value: new THREE.Vector3(0.0, 0.004, 0.012) }, // cool the shadows a touch
    uGain: { value: new THREE.Vector3(1.0, 0.99, 0.97) },
    uTime: { value: 0 },
    uGrain: { value: 0.018 },
    uSharp: { value: 0 },
    uTexel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSat; uniform float uContrast;
    uniform vec3 uLift; uniform vec3 uGain; uniform float uTime; uniform float uGrain;
    uniform float uSharp; uniform vec2 uTexel;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec3(0.5);
      // Contrast-adaptive sharpening (after AMD's CAS): crisper detail where contrast is low, left
      // alone at hard edges so nothing rings. It restores the bite a picture loses when it is drawn
      // below the screen's own resolution and stretched to fit.
      if (uSharp > 0.0) {
        vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
        vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
        vec3 mn = min(min(min(n, s), min(e, w)), c), mx = max(max(max(n, s), max(e, w)), c);
        vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
        vec3 wt = amp * (-1.0 / mix(8.0, 5.0, uSharp));
        c = clamp((c + (n + s + e + w) * wt) / (1.0 + 4.0 * wt), 0.0, 1.0);
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      c = c * uGain + uLift * (1.0 - c);
      vec2 q = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      c += (h(vUv * 1000.0 + fract(uTime) * 37.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, { samples = 4, ao = false, aoSamples = 12 } = {}) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    if (ao) {
      // Ground-truth ambient occlusion: shade in corners, under cars, between rocks.
      // At half resolution: occlusion is soft shading that the denoise pass blurs anyway, and the
      // pass draws the whole scene again for its normals and depth, so a quarter of the pixels took
      // its cost from about a fifth of the frame to a few percent with no visible change.
      this.ao = new GTAOPass(scene, camera, Math.ceil(size.x / 2), Math.ceil(size.y / 2));
      const aoSize = this.ao.setSize.bind(this.ao);
      this.ao.setSize = (w, h) => aoSize(Math.ceil(w / 2), Math.ceil(h / 2));
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.75;
      this.ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1, thickness: 1, scale: 1, samples: aoSamples, distanceFallOff: 1, screenSpaceRadius: false });
      this.composer.addPass(this.ao);
      // The occlusion pass draws the scene again for its normals and depth. Grass blades and far
      // boulders add little shading there and a lot of triangles, so they sit that pass out. So do
      // glows deeper in the scene, listed in scene.userData.noAO: drawn solid, they leave a dark square.
      const aoRender = this.ao.render.bind(this.ao);
      this.ao.render = (...args) => {
        const out = scene.children.filter((o) => o.userData.noAO && o.visible);
        for (const o of scene.userData.noAO || []) if (o.visible) out.push(o);
        for (const o of out) o.visible = false;
        aoRender(...args);
        for (const o of out) o.visible = true;
      };
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    // Depth of field, for photo mode only (off otherwise: it draws the scene a second time).
    this.bokeh = new BokehPass(scene, camera, { focus: 40, aperture: 0.0002, maxblur: 0.008 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.renderer = renderer;
  }
  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setPixelRatio(1);
    this.composer.setSize(size.x, size.y);
  }
  render(t, { aurora = 0, dark = 0 } = {}) {
    this.grade.uniforms.uTime.value = t;
    // Sharpen more when the picture is stretched onto a denser screen.
    const size = this.renderer.getDrawingBufferSize(this._size ||= new THREE.Vector2());
    this.grade.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    this.grade.uniforms.uSharp.value = this.renderer.getPixelRatio() < devicePixelRatio - 0.05 ? 0.6 : 0.3;
    // The aurora glows more at night; daytime bloom stays subtle.
    this.bloom.strength = 0.12 + aurora * 0.55 * dark;
    this.bloom.threshold = dark > 0.5 ? 0.55 : 0.97;
    // By day the bloom is barely visible but costs a stack of full-screen passes: skip it
    // until dusk, when the lights and the aurora need the glow.
    this.bloom.enabled = dark > 0.2 || aurora > 0.05;
    this.composer.render();
  }
}
