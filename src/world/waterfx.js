// Water you disturb: ripple rings spreading over lakes and the sea, and the helicopter's
// downwash on open water (a ring of wind-roughened water racing out from under it, rings
// spreading from the centre, mist and spray blown out sideways).
import * as THREE from 'three';
import { Spray, dropTexture, mistTexture } from '../vehicle/boat.js';

const MAX_RINGS = 48;

// Ripple rings: one instanced quad each, drawn as a wave front (a bright crest with a dark
// trough just inside it) that widens, softens and fades as it spreads.
function ringMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: 1 } }]),
    vertexShader: `
      attribute vec4 iA; attribute vec4 iB; // iA: x, y, z, born. iB: speed, life, strength, r0.
      uniform float uTime; varying vec2 vP; varying float vAge, vStr, vR;
      #include <fog_pars_vertex>
      void main() {
        float age = uTime - iA.w, r = iB.w + iB.x * age;
        vAge = clamp(age / iB.y, 0.0, 1.0); vStr = iB.z; vR = r; vP = position.xz * 1.3;
        vec4 mvPosition = modelViewMatrix * vec4(iA.xyz + vec3(position.x * r * 1.3, 0.0, position.z * r * 1.3), 1.0);
        if (age < 0.0 || age > iB.y) mvPosition = vec4(0.0, 0.0, 10.0, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uLight; varying vec2 vP; varying float vAge, vStr, vR;
      #include <fog_pars_fragment>
      void main() {
        float d = length(vP);
        float w = (0.035 + 0.09 * vAge) * max(1.0, 3.0 / max(vR, 0.5));
        float crest = exp(-pow((d - 1.0) / w, 2.0));
        float trough = exp(-pow((d - 1.0 + w * 1.6) / w, 2.0));
        float fade = vStr * pow(1.0 - vAge, 1.6) * smoothstep(0.0, 0.08, vAge);
        float a = (crest * 0.55 + trough * 0.35) * fade;
        if (a < 0.004) discard;
        vec3 c = mix(vec3(0.0), vec3(0.86, 0.92, 0.96) * uLight, crest / (crest + trough + 1e-4));
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
}

// The patch of water under a hovering helicopter: darker and roughened, with streaks of
// wind-driven chop and flecks of white racing outward from the middle.
function washMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uStrength: { value: 0 }, uLight: { value: 1 } }]),
    vertexShader: `
      varying vec2 vP;
      #include <fog_pars_vertex>
      void main() { vP = position.xz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uStrength, uLight; varying vec2 vP;
      #include <fog_pars_fragment>
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float r = length(vP), ang = atan(vP.y, vP.x);
        if (r > 1.0) discard;
        // Streaks running outward: noise stretched along the radius, sliding out over time.
        // Gusts racing outward (broad, soft), and fine chop over them that the white breaks out of.
        float s = n(vec2(ang * 9.0, r * 3.0 - uTime * 2.2)) * 0.6 + n(vec2(ang * 19.0 + 3.0, r * 6.0 - uTime * 3.0)) * 0.4;
        vec2 flow = vP - normalize(vP + 1e-4) * uTime * 0.35;
        float chop = n(flow * 26.0) * n(flow * 47.0 + 7.0);
        // Strongest in a ring where the downwash turns and runs out along the water.
        float band = smoothstep(0.08, 0.35, r) * (1.0 - smoothstep(0.55, 1.0, r));
        float dark = (0.18 + 0.22 * s) * band + 0.08 * (1.0 - smoothstep(0.0, 0.3, r));
        float white = smoothstep(0.62, 0.9, chop * 1.6 * s + s * 0.25) * band * 0.55;
        float a = (dark + white) * uStrength;
        if (a < 0.004) discard;
        vec3 c = mix(vec3(0.01, 0.02, 0.025), vec3(0.9, 0.94, 0.96) * uLight, white / (dark + white + 1e-4));
        gl_FragColor = vec4(c, min(0.85, a));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
}

export class WaterFx {
  constructor(scene, { low = false } = {}) {
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const ig = new THREE.InstancedBufferGeometry().copy(geo);
    ig.instanceCount = MAX_RINGS;
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4).fill(-1e5), 4);
    this.iB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4), 4);
    ig.setAttribute('iA', this.iA); ig.setAttribute('iB', this.iB);
    this.rings = new THREE.Mesh(ig, ringMaterial());
    this.rings.frustumCulled = false; this.rings.renderOrder = 2; this.rings.userData.noAO = true;
    scene.add(this.rings);
    this.next = 0; this.time = 0;
    this.wash = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), washMaterial());
    this.wash.visible = false; this.wash.renderOrder = 2; this.wash.userData.noAO = true;
    scene.add(this.wash);
    this.drops = new Spray(scene, { count: low ? 300 : 700, map: dropTexture(), opacity: 0.9, gravity: 9.8, drag: 0.9, grow: 1.2 });
    this.mist = new Spray(scene, { count: low ? 160 : 360, map: mistTexture(), opacity: 0.1, gravity: -0.15, drag: 1.4, grow: 2.2 });
    this.carry = { ring: 0, mist: 0, drop: 0 };
  }

  // A ripple ring at (x, y, z): strength 0 to 1, starting radius r0, spreading at speed m/s.
  ring(x, y, z, strength = 0.6, { r0 = 0.4, speed = 1.6, life = 2.6 } = {}) {
    const i = this.next; this.next = (this.next + 1) % MAX_RINGS;
    this.iA.setXYZW(i, x, y + 0.03, z, this.time);
    this.iB.setXYZW(i, speed, life, Math.min(1, strength), r0);
    this.iA.needsUpdate = this.iB.needsUpdate = true;
  }
  count(key, rate, dt) { const c = this.carry[key] + rate * dt, k = Math.floor(c); this.carry[key] = c - k; return k; }

  // Each frame. wash: { x, z, strength, radius, y } over water, or null. light: 0 at night to 1 by day.
  update(dt, camera, heightPx, light, wash) {
    this.time += dt;
    const m = this.rings.material.uniforms; m.uTime.value = this.time; m.uLight.value = light;
    const scale = heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const c = new THREE.Color(0xf2f6f7).multiplyScalar(light);
    for (const s of [this.drops, this.mist]) { s.mat.uniforms.uScale.value = scale; s.mat.uniforms.color.value.copy(c); }
    const W = this.wash.material.uniforms;
    const target = wash ? wash.strength : 0;
    W.uStrength.value += (target - W.uStrength.value) * Math.min(1, dt * 3);
    W.uTime.value = this.time; W.uLight.value = light;
    this.wash.visible = W.uStrength.value > 0.01;
    if (wash) {
      const R = wash.radius, s = wash.strength, y = wash.y;
      this.wash.position.set(wash.x, y + 0.04, wash.z); this.wash.scale.setScalar(R);
      // Rings from under the rotor, a few a second, quicker and stronger the closer it hovers.
      for (let k = this.count('ring', 2.5 * s, dt); k > 0; k--) this.ring(wash.x, y, wash.z, 0.5 + 0.5 * s, { r0: R * 0.15, speed: 3 + 4 * s, life: 3.2 });
      // Mist and spray thrown out flat along the water from the ring where the wash turns.
      for (let k = this.count('mist', 26 * s, dt); k > 0; k--) {
        const a = Math.random() * Math.PI * 2, rr = R * (0.3 + 0.35 * Math.random()), out = 5 + 9 * s;
        this.mist.emit(wash.x + Math.cos(a) * rr, y + 0.3, wash.z + Math.sin(a) * rr, Math.cos(a) * out, 0.6 + Math.random() * 1.2, Math.sin(a) * out, 1.6 + Math.random(), 1.6 + Math.random() * 1.6);
      }
      for (let k = this.count('drop', 60 * s, dt); k > 0; k--) {
        const a = Math.random() * Math.PI * 2, rr = R * (0.25 + 0.3 * Math.random()), out = 3 + 6 * s * Math.random();
        this.drops.emit(wash.x + Math.cos(a) * rr, y + 0.1, wash.z + Math.sin(a) * rr, Math.cos(a) * out, 0.8 + Math.random() * 1.6, Math.sin(a) * out, 0.5 + Math.random() * 0.4, 0.18 + Math.random() * 0.22);
      }
    }
    this.drops.update(dt); this.mist.update(dt);
  }
}
