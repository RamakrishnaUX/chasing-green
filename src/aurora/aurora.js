import * as THREE from 'three';
import { GLSL_NOISE } from '../world/sky.js';
import { SKY_LAYER } from '../world/skyreflect.js';

const VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`;

// The aurora is raymarched through a thin slab of "sky plane" heights. Each curtain is a wavy
// line on that plane; marching upward through the slab gives the tall, folded curtain look.
const FRAG = (steps) => /* glsl */ `
#define STEPS ${steps}
uniform float uTime; uniform float uIntensity; uniform float uCurtains;
uniform float uPink; uniform float uRed; uniform float uCorona; uniform vec2 uCamXZ;
// Substorm phase: growth (a quiet arc), breakup (fast, bright, overhead), diffuse and pulsing
// patches (recovery). uFlow is the curtains' own clock: it runs fast in a breakup, slow otherwise.
uniform float uFlow; uniform float uGrowth; uniform float uBreak; uniform float uDiffuse; uniform float uPulse;
varying vec3 vDir;
${GLSL_NOISE}

// One layer of pulsating patches: which blobs are lit changes at each beat k, with a soft switch.
float patchOn(vec2 q, float k){
  float a = vnoise(q + floor(k) * 7.13), b = vnoise(q + (floor(k) + 1.0) * 7.13);
  return smoothstep(0.5, 0.66, mix(a, b, smoothstep(0.0, 0.3, fract(k))));
}

void main(){
  vec3 d = normalize(vDir);
  if (d.y < 0.015 || uIntensity < 0.002) discard;
  float t = uFlow;
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
    // Growth: one smooth arc low in the north. Breakup: the curtains fold hard and sweep overhead.
    base[i] = -1.35 + fi * 0.72 - uGrowth * 0.3 + uBreak * 0.6;
    float folding = (1.0 - 0.7 * uGrowth) * (1.0 + 0.9 * uBreak);
    fold[i] = (sin(pm.x * 0.33 + t * 0.045 + fi * 2.1) * 0.5
            + (vnoise(vec2(pm.x * 0.22 + t * 0.025, fi * 7.0)) - 0.5) * 1.5
            + sin(pm.x * 1.3 - t * 0.11 + fi) * 0.1) * folding;
    wid[i] = (0.13 + 0.12 * vnoise(vec2(pm.x * 0.7, t * 0.08 + fi * 3.0))) * (1.0 + 0.3 * uGrowth + 1.8 * uDiffuse);
    float rays = 0.55 + 0.45 * vnoise(vec2(pm.x * 7.0 + t * 0.3, fi * 3.0 + t * 0.05));
    rays = mix(pow(rays, 1.0 + 1.5 * uBreak), 0.85, max(uGrowth * 0.8, uDiffuse * 0.7));
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
    // Pulsating patches: soft blobs of sky that switch on and off every few seconds. Two layers on
    // different beats, so patches do not all blink together.
    // In a breakup the curtains flicker, fast and uneven along their length, as the electrons
    // raining in come and go several times a second.
    dens *= 1.0 + uBreak * 0.5 * (vnoise(vec2(pm.x * 2.7 + float(s) * 0.13, uTime * 9.0)) - 0.5);
    if (uPulse > 0.001) {
      vec2 q = vec2(pm.x, py) * 1.3;
      float on = max(patchOn(q, uTime / 3.1), patchOn(q + 9.0, uTime / 4.7 + 0.5));
      dens *= mix(1.0, 0.12 + 2.0 * on, uPulse);
    }
    float prof = smoothstep(0.0, 0.07, hn) * exp(-hn * 2.0);
    vec3 c = mix(green, top, smoothstep(0.3, 0.85, hn) * (0.35 + 0.65 * uPink));
    c = mix(c, red, uRed * smoothstep(0.25, 0.75, hn));
    // A strong breakup flushes the lower border magenta (nitrogen), a thin fringe under the green.
    c = mix(c, vec3(1.0, 0.24, 0.66), uBreak * (0.3 + 0.7 * uPink) * (1.0 - smoothstep(0.0, 0.1, hn)) * 0.85);
    col += c * dens * prof;
  }
  col *= (3.1 / float(STEPS)) * uIntensity * smoothstep(0.015, 0.22, d.y);
  // At high Kp a faint red glow hangs high above the curtains (oxygen at 250 km and up).
  col += red * uRed * 0.06 * uIntensity * smoothstep(0.3, 0.7, d.y) * (0.6 + 0.4 * vnoise(dir * 0.8 + t * 0.02));
  // A breakup is far brighter than the arc before it, and shimmers.
  col *= 1.0 + uBreak * (0.7 + 0.18 * sin(uFlow * 9.0 + dir.x * 3.0));

  // Corona: when the curtains are right overhead, perspective draws their rays together into
  // one point near the zenith, so the sky looks like a crown of light. Narrow rays all round,
  // each flaring and fading on its own, light streaming along them toward the centre; green low,
  // turning violet and, at high Kp, red toward the radiant point, which is itself dim.
  if (uCorona > 0.001){
    float y = d.y, az = atan(d.z, d.x);
    float zen = smoothstep(0.5, 0.92, y);
    float ray = vnoise(vec2(az * 9.0 + t * 0.04, t * 0.1)) * 0.6 + vnoise(vec2(az * 31.0 - t * 0.07, 3.0 + t * 0.15)) * 0.5;
    float r = pow(smoothstep(0.38, 0.85, ray), 1.4);
    float stream = 0.55 + 0.45 * sin((1.0 - y) * 42.0 + t * 2.6 + ray * 7.0);
    float centre = 1.0 - smoothstep(0.975, 0.998, y) * 0.8;
    vec3 cc = mix(green, mix(top, red, uRed * 0.6), smoothstep(0.72, 0.97, y));
    col += cc * r * stream * zen * centre * uCorona * uIntensity * 1.5;
    col += cc * smoothstep(0.93, 0.99, y) * 0.12 * uCorona * uIntensity; // a soft glow round the point
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
      uFlow: { value: 0 }, uGrowth: { value: 0 }, uBreak: { value: 0 }, uDiffuse: { value: 0 }, uPulse: { value: 0 },
    };
    this.scene = scene;
    this.steps = steps;
    this.build();
    this.tint = new THREE.Color(0x3cff9a);
    this.smooth = { vis: 0, curtains: 1, pink: 0, red: 0, corona: 0, growth: 0, breakup: 0, diffuse: 0, pulse: 0 };
    this.flow = null;
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
    this.mesh.layers.enable(SKY_LAYER); // mirrored in the water at night
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
    // Substorm phase. A still (dt 0, such as a postcard) with no phase shows a lively display.
    const still = !dt;
    const ph = { growth: state.growth ?? 0, breakup: state.breakup ?? (still ? 0.5 : 0), diffuse: state.diffuse ?? 0, pulse: state.pulse ?? 0 };
    if (still) Object.assign(s, ph);
    else {
      s.growth += (ph.growth - s.growth) * k;
      s.breakup += (ph.breakup - s.breakup) * Math.min(1, dt * 2.5); // a breakup is sudden
      s.diffuse += (ph.diffuse - s.diffuse) * k * 0.5;
      s.pulse += (ph.pulse - s.pulse) * k * 0.5;
    }
    // The curtains' own clock: slow and calm in growth and recovery, racing in a breakup.
    if (this.flow == null || still) this.flow = t;
    else this.flow += dt * (1 - 0.5 * s.growth + 2.2 * s.breakup - 0.35 * s.diffuse);
    const u = this.uniforms;
    u.uFlow.value = this.flow; u.uGrowth.value = s.growth; u.uBreak.value = s.breakup; u.uDiffuse.value = s.diffuse; u.uPulse.value = s.pulse;
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
