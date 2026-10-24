import * as THREE from 'three';
import { GLSL_NOISE } from '../world/sky.js';

const VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`;

// The aurora is raymarched through a thin slab of "sky plane" heights. Each curtain is a wavy
// line on that plane; marching upward through the slab gives the tall, folded curtain look.
const FRAG = (steps) => /* glsl */ `
#define STEPS ${steps}
uniform float uTime; uniform float uIntensity; uniform float uCurtains;
uniform float uPink; uniform float uRed; uniform float uCorona; uniform vec2 uCamXZ;
varying vec3 vDir;
${GLSL_NOISE}

void main(){
  vec3 d = normalize(vDir);
  if (d.y < 0.015 || uIntensity < 0.002) discard;
  float t = uTime;
  vec3 green = vec3(0.22, 1.0, 0.52);
  vec3 top = mix(vec3(0.42, 0.62, 0.86), vec3(0.95, 0.38, 0.72), uPink);
  vec3 red = vec3(1.0, 0.16, 0.22);
  vec2 dir = d.xz / d.y;

  // Curtains are near-vertical sheets, so their shape (fold, width, rays, pulse) is sampled once
  // at mid height and reused for every step. Only the distance to the sheet changes per step.
  float base[4]; float fold[4]; float wid[4]; float amp[4];
  vec2 pm = uCamXZ + dir * 2.2;
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    float wgt = clamp(uCurtains - fi, 0.0, 1.0);
    base[i] = -1.35 + fi * 0.72;
    fold[i] = sin(pm.x * 0.33 + t * 0.045 + fi * 2.1) * 0.5
            + (vnoise(vec2(pm.x * 0.22 + t * 0.025, fi * 7.0)) - 0.5) * 1.5
            + sin(pm.x * 1.3 - t * 0.11 + fi) * 0.1;
    wid[i] = 0.13 + 0.12 * vnoise(vec2(pm.x * 0.7, t * 0.08 + fi * 3.0));
    float rays = 0.55 + 0.45 * vnoise(vec2(pm.x * 7.0 + t * 0.3, fi * 3.0 + t * 0.05));
    float pulse = 0.6 + 0.4 * sin(t * 0.55 + pm.x * 0.45 + fi * 1.7);
    float along = smoothstep(-7.0, -3.5, pm.x + sin(fi * 1.3) * 2.5) * smoothstep(7.0, 3.5, pm.x - cos(fi * 2.1) * 2.5);
    amp[i] = rays * pulse * along * wgt;
  }

  vec3 col = vec3(0.0);
  float jitter = hash12(gl_FragCoord.xy + fract(t) * 61.0);
  for (int s = 0; s < STEPS; s++){
    float hn = (float(s) + jitter) / float(STEPS);
    float hh = mix(1.0, 3.4, hn);
    float py = uCamXZ.y + dir.y * hh;
    float dens = 0.0;
    for (int i = 0; i < 4; i++){
      if (amp[i] <= 0.0) continue;
      float dz = py - (base[i] + fold[i]);
      float w2 = wid[i] * wid[i];
      dens += (exp(-dz * dz / w2) + 0.45 * exp(-dz * dz / (w2 * 12.0))) * amp[i];
    }
    float prof = smoothstep(0.0, 0.07, hn) * exp(-hn * 2.0);
    vec3 c = mix(green, top, smoothstep(0.3, 0.85, hn) * (0.35 + 0.65 * uPink));
    c = mix(c, red, uRed * smoothstep(0.25, 0.75, hn));
    col += c * dens * prof;
  }
  col *= (3.1 / float(STEPS)) * uIntensity * smoothstep(0.015, 0.22, d.y);

  // Corona: rays converging on the point overhead.
  if (uCorona > 0.001){
    float zen = smoothstep(0.7, 0.96, d.y) * (1.0 - smoothstep(0.985, 1.0, d.y) * 0.7);
    float az = atan(d.z, d.x);
    float r = vnoise(vec2(az * 6.0, t * 0.2)) * vnoise(vec2(az * 15.0 + 4.0, t * 0.33));
    r = smoothstep(0.15, 0.7, r);
    float halo = smoothstep(0.9, 1.0, d.y) * 0.25;
    vec3 cc = mix(green, top, 0.3 + 0.5 * (1.0 - zen));
    col += cc * (r * 0.4 + halo) * zen * uCorona * uIntensity;
  }
  // Soft roll-off keeps bright displays coloured instead of clipping to white.
  col = 1.0 - exp(-col * 1.15);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Aurora {
  constructor(scene, steps = 16) {
    this.uniforms = {
      uTime: { value: 0 }, uIntensity: { value: 0 }, uCurtains: { value: 1 },
      uPink: { value: 0 }, uRed: { value: 0 }, uCorona: { value: 0 }, uCamXZ: { value: new THREE.Vector2() },
    };
    this.scene = scene;
    this.steps = steps;
    this.build();
    this.tint = new THREE.Color(0x3cff9a);
    this.smooth = { vis: 0, curtains: 1, pink: 0, red: 0, corona: 0 };
  }
  build() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.material.dispose(); }
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG(this.steps), uniforms: this.uniforms,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1700, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.52), mat);
    this.mesh.renderOrder = -2;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  setSteps(steps) { if (steps !== this.steps) { this.steps = steps; this.build(); } }

  update(dt, t, camera, state) {
    const k = Math.min(1, dt * 0.6); // ease so changes feel like slow breathing, not switches
    const s = this.smooth;
    s.vis += (state.vis - s.vis) * k;
    s.curtains += (state.curtains - s.curtains) * k * 0.5;
    s.pink += (state.pink - s.pink) * k;
    s.red += (state.red - s.red) * k;
    s.corona = state.corona;
    const u = this.uniforms;
    u.uTime.value = t;
    u.uIntensity.value = s.vis;
    u.uCurtains.value = s.curtains;
    u.uPink.value = s.pink;
    u.uRed.value = s.red;
    u.uCorona.value = s.corona;
    u.uCamXZ.value.set(camera.position.x * 0.00067, camera.position.z * 0.00027);
    this.mesh.position.copy(camera.position);
    this.mesh.visible = s.vis > 0.003;
    this.tint.setRGB(0.22, 1.0, 0.52).lerp(new THREE.Color(1, 0.2, 0.3), s.red * 0.6);
    return s.vis;
  }
}
