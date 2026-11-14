import * as THREE from 'three';

// What flies off in a crash. Three kinds of thing, each one draw call:
//
// - Sparks: white-hot streaks drawn along their own motion (a spark is a fleck of metal so hot it
//   leaves a trail in the eye), cooling through yellow and orange to a dull red as they fly,
//   falling under gravity and skipping off the ground. Shaved off by metal grinding on stone or
//   steel, so they fly on with the car's own speed and fan out along the face.
// - Debris: real little solids that tumble, bounce, slide and come to rest, then lie on the ground
//   a while before sinking away: glass that glints, flakes of the car's own paint, black trim, and
//   chips of whatever was hit (basalt, concrete).
// - Dust: soft billows that burst out, swell and drift with the wind, lit from the sun's side.
//
// Everything is pooled (no allocation while driving) and the counts are kept low on phones.

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _ax = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Sparks ----------
const SPARK_VS = /* glsl */`
attribute vec3 aHead;
attribute vec3 aTail;
attribute float aHeat;
attribute float aWidth;
uniform float uPx;
varying float vSide;
varying float vHeat;
varying float vAlong;
void main() {
  vec4 h = modelViewMatrix * vec4(aHead, 1.0);
  vec4 t = modelViewMatrix * vec4(aTail, 1.0);
  vec3 d = h.xyz - t.xyz;
  vec3 p = mix(t.xyz, h.xyz, position.y);
  vec3 side = cross(d, normalize(-p));
  float sl = length(side);
  side = sl > 1e-6 ? side / sl : vec3(1.0, 0.0, 0.0);
  // Never thinner than about a pixel and a half, so a far spark still reads.
  float w = max(aWidth, uPx * 3.2 * max(-p.z, 0.1));
  p += side * position.x * w;
  // Round the ends a touch past the head and tail.
  p += normalize(d + vec3(0.0, 1e-5, 0.0)) * (position.y - 0.5) * w * 1.5;
  vSide = position.x; vHeat = aHeat; vAlong = position.y;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;
const SPARK_FS = /* glsl */`
varying float vSide;
varying float vHeat;
varying float vAlong;
void main() {
  if (vHeat <= 0.0) discard;
  // A thin white-hot core inside a wider orange glow, brightest at the head.
  float x = vSide;
  float core = exp(-x * x * 16.0), halo = exp(-x * x * 2.5);
  float along = mix(0.15, 1.0, vAlong * vAlong);
  // Black-body-ish: dull red, orange, yellow, white as it gets hotter.
  vec3 hot = mix(vec3(1.0, 0.36, 0.04), vec3(1.0, 0.78, 0.36), smoothstep(0.25, 0.65, vHeat));
  hot = mix(hot, vec3(1.0, 0.95, 0.8), smoothstep(0.7, 1.0, vHeat));
  vec3 glow = mix(vec3(0.6, 0.08, 0.0), vec3(1.0, 0.38, 0.05), smoothstep(0.0, 0.5, vHeat));
  float k = smoothstep(0.0, 0.15, vHeat);
  vec3 c = (hot * core * 1.35 + glow * halo * 0.45 * vHeat) * along * k;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Sparks {
  constructor(scene, n) {
    this.n = n; this.next = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.floor = new Float32Array(n);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.head = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tail = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.heat = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.width = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aHead', this.head); g.setAttribute('aTail', this.tail); g.setAttribute('aHeat', this.heat); g.setAttribute('aWidth', this.width);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 0.002 } }, vertexShader: SPARK_VS, fragmentShader: SPARK_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.live = 0;
  }
  emit(x, y, z, vx, vy, vz, floor) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = rnd(0.35, 1.1);
    this.floor[i] = floor;
    this.width.array[i] = rnd(0.02, 0.045);
  }
  update(dt, ground) {
    const p = this.p, v = this.v, H = this.head.array, T = this.tail.array, K = this.heat.array;
    const dr = Math.max(0, 1 - 0.55 * dt);
    let top = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { K[i] = 0; continue; }
      this.life[i] -= dt;
      const j = i * 3;
      v[j + 1] -= 9.8 * dt;
      v[j] *= dr; v[j + 1] *= dr; v[j + 2] *= dr;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      // Skip off the ground, losing heat and speed with each bounce.
      const gy = ground(p[j], p[j + 2]) + this.floor[i];
      if (p[j + 1] < gy) {
        p[j + 1] = gy;
        if (v[j + 1] < 0) { v[j + 1] *= -0.32; v[j] *= 0.62; v[j + 2] *= 0.62; this.life[i] -= 0.06; }
      }
      const u = Math.max(0, this.life[i] / this.max[i]);
      K[i] = this.life[i] > 0 ? Math.pow(u, 0.7) : 0;
      // The trail: where it was a few hundredths of a second ago (longer when it is fast).
      const st = 0.022 + 0.018 * u;
      H[j] = p[j]; H[j + 1] = p[j + 1]; H[j + 2] = p[j + 2];
      T[j] = p[j] - v[j] * st; T[j + 1] = p[j + 1] - v[j + 1] * st; T[j + 2] = p[j + 2] - v[j + 2] * st;
      top = i + 1;
    }
    this.live = top;
    this.mesh.geometry.instanceCount = top;
    if (top) { this.head.needsUpdate = this.tail.needsUpdate = this.heat.needsUpdate = this.width.needsUpdate = true; }
  }
}

// ---------- Debris ----------
// A chunk shape, with its corners pulled about a little so no two kinds look machined.
function rough(geo, amt, seed) {
  const P = geo.attributes.position;
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const moved = new Map();
  for (let i = 0; i < P.count; i++) {
    const key = `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`;
    let d = moved.get(key);
    if (!d) { d = [r() * amt, r() * amt, r() * amt]; moved.set(key, d); }
    P.setXYZ(i, P.getX(i) + d[0], P.getY(i) + d[1], P.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}
function shardGeometry() {
  // A thin sliver of glass: an uneven triangle with a little thickness.
  const a = [0, 0, 0.6], b = [-0.45, 0, -0.4], c = [0.5, 0, -0.25], t = 0.06;
  const v = [];
  const tri = (p, q, r) => v.push(...p, ...q, ...r);
  const up = (p) => [p[0], t, p[2]];
  tri(a, c, b); tri(up(a), up(b), up(c));
  for (const [p, q] of [[a, b], [b, c], [c, a]]) { tri(p, q, up(q)); tri(p, up(q), up(p)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
const DEBRIS = {
  // Each: pool size (desktop), geometry, material, half thickness (to sit it on the ground), and
  // how it falls (drag, bounce).
  glass: { n: 90, geo: () => shardGeometry(), mat: () => new THREE.MeshStandardMaterial({ color: 0xd9eef2, metalness: 0.95, roughness: 0.06, transparent: true, opacity: 0.8, envMapIntensity: 2.2 }), lift: 0.004, drag: 0.6, bounce: 0.28, slide: 0.55 },
  paint: { n: 70, geo: () => rough(new THREE.BoxGeometry(1, 0.12, 0.7, 2, 1, 2), 0.18, 7), mat: () => new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.35 }), lift: 0.008, drag: 0.9, bounce: 0.2, slide: 0.5 },
  chip: { n: 140, geo: () => rough(new THREE.IcosahedronGeometry(0.5, 0), 0.35, 11), mat: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }), lift: 0.3, drag: 0.15, bounce: 0.3, slide: 0.35 },
};

class Debris {
  constructor(scene, kind, n) {
    const D = DEBRIS[kind];
    this.D = D; this.n = n; this.next = 0;
    this.mesh = new THREE.InstancedMesh(D.geo(), D.mat(), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = kind === 'chip';
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    this.q = Array.from({ length: n }, () => new THREE.Quaternion());
    this.w = new Float32Array(n * 3); // spin axis * rate
    this.size = new Float32Array(n); this.life = new Float32Array(n); this.rest = new Uint8Array(n); this.floor = new Float32Array(n);
    this.col = new THREE.Color();
  }
  emit(x, y, z, vx, vy, vz, size, color, floor, life = rnd(7, 11)) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.q[i].setFromEuler(new THREE.Euler(rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)));
    const spin = rnd(6, 22);
    _ax.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(spin);
    this.w[i * 3] = _ax.x; this.w[i * 3 + 1] = _ax.y; this.w[i * 3 + 2] = _ax.z;
    this.size[i] = size; this.life[i] = life; this.rest[i] = 0; this.floor[i] = floor;
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor.needsUpdate = true;
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;
  }
  update(dt, ground) {
    const p = this.p, v = this.v, w = this.w, D = this.D;
    const dr = Math.max(0, 1 - D.drag * dt);
    let any = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      any = true;
      this.life[i] -= dt;
      if (!this.rest[i]) {
        v[j + 1] -= 9.8 * dt;
        v[j] *= dr; v[j + 1] *= dr; v[j + 2] *= dr;
        p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
        const rate = Math.hypot(w[j], w[j + 1], w[j + 2]);
        if (rate > 1e-3) { _ax.set(w[j] / rate, w[j + 1] / rate, w[j + 2] / rate); _q.setFromAxisAngle(_ax, rate * dt); this.q[i].premultiply(_q); }
        const gy = ground(p[j], p[j + 2]) + this.floor[i] + D.lift * this.size[i] * 8;
        if (p[j + 1] < gy) {
          p[j + 1] = gy;
          if (v[j + 1] < 0) v[j + 1] *= -D.bounce;
          // Rubbing along the ground slows it and its spin.
          v[j] *= D.slide; v[j + 2] *= D.slide;
          w[j] *= 0.55; w[j + 1] *= 0.55; w[j + 2] *= 0.55;
          if (Math.abs(v[j + 1]) < 0.6 && Math.hypot(v[j], v[j + 2]) < 0.35) {
            this.rest[i] = 1;
            // Lie flat-ish: settle towards its nearest face-down orientation.
            _v.set(0, 1, 0).applyQuaternion(this.q[i]);
            _q.setFromUnitVectors(_v, _s.set(0, Math.sign(_v.y || 1), 0));
            this.q[i].premultiply(_q);
          }
        }
      }
      // Sinks away at the end of its time.
      const k = this.size[i] * Math.min(1, this.life[i] / 0.8);
      _s.set(k, k, k);
      _v.set(p[j], p[j + 1] - (this.life[i] < 0.8 ? (0.8 - this.life[i]) * 0.05 : 0), p[j + 2]);
      _m.compose(_v, this.q[i], _s);
      this.mesh.setMatrixAt(i, _m);
    }
    if (any || this.mesh.count) this.mesh.instanceMatrix.needsUpdate = true;
    if (!any) this.mesh.count = 0;
  }
}

// ---------- Dust ----------
let puffTex = null;
function puffTexture() {
  if (puffTex) return puffTex;
  // A soft, lumpy billow: many overlapping blobs, densest in the middle.
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  let s = 4242;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 90; k++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * S * 0.28, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, rad = S * (0.03 + r() * 0.12);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(255,255,255,${0.12 + r() * 0.16})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  // Fade to nothing well inside the edge, so no puff ever shows the square it is drawn on.
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.45, 'rgba(0,0,0,0.8)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, S, S);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}
const PUFF_VS = /* glsl */`
attribute vec3 aPos;
attribute vec4 aPuff; // size, alpha, rotation, unused
attribute vec3 aCol;
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
varying vec3 vN;
void main() {
  vec4 c = modelViewMatrix * vec4(aPos, 1.0);
  float s = aPuff.x, r = aPuff.z;
  vec2 q = vec2(position.x * cos(r) - position.y * sin(r), position.x * sin(r) + position.y * cos(r));
  c.xy += q * s;
  vUv = position.xy + 0.5;
  vN = normalize(vec3(position.xy * 1.6, 0.6)); // a sphere's normal, for lighting the billow
  // Thin out as it nears the eye, so a cloud the camera is in never covers the view.
  vA = aPuff.y * smoothstep(1.5, 5.0, -c.z); vCol = aCol;
  gl_Position = projectionMatrix * c;
}`;
const PUFF_FS = /* glsl */`
uniform sampler2D uTex;
uniform vec3 uSunView;
uniform vec3 uSun;
uniform vec3 uAmb;
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
varying vec3 vN;
void main() {
  float t = texture2D(uTex, vUv).a;
  float a = t * vA;
  if (a < 0.003) discard;
  // Lit on the side towards the sun, shaded under, a little light through the thin edges.
  float l = max(dot(vN, uSunView), 0.0);
  vec3 c = vCol * (uAmb + uSun * (0.25 + 0.75 * l));
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
class Dust {
  constructor(scene, n) {
    this.n = n; this.next = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    this.age = new Float32Array(n); this.life = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n); this.spin = new Float32Array(n);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.puff = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.pos); g.setAttribute('aPuff', this.puff); g.setAttribute('aCol', this.col);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: puffTexture() }, uSunView: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Color(0.9, 0.85, 0.75) }, uAmb: { value: new THREE.Color(0.45, 0.48, 0.52) } },
      vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, size, color, alpha = 0.5, life = rnd(2.2, 4)) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = size * 0.35; this.s1[i] = size * rnd(1.6, 2.4); this.a0[i] = alpha; this.spin[i] = rnd(-0.6, 0.6);
    this.puff.array[i * 4 + 2] = rnd(0, 6.3);
    const C = this.col.array; C[i * 3] = color.r; C[i * 3 + 1] = color.g; C[i * 3 + 2] = color.b;
    this.col.needsUpdate = true;
  }
  update(dt, wind) {
    const p = this.p, v = this.v, P = this.pos.array, U = this.puff.array;
    let top = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) { U[i * 4 + 1] = 0; continue; }
      const j = i * 3;
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      // Bursts out fast, then hangs in the air and drifts.
      const dr = Math.exp(-dt * 3.2);
      v[j] = wind.x + (v[j] - wind.x) * dr; v[j + 1] = 0.25 + (v[j + 1] - 0.25) * dr; v[j + 2] = wind.z + (v[j + 2] - wind.z) * dr;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      P[j] = p[j]; P[j + 1] = p[j + 1]; P[j + 2] = p[j + 2];
      U[i * 4] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - Math.exp(-this.age[i] * 2.2));
      U[i * 4 + 1] = this.a0[i] * Math.min(1, this.age[i] / 0.06) * Math.pow(1 - u, 1.6);
      U[i * 4 + 2] += this.spin[i] * dt * (1 - u);
      top = i + 1;
    }
    this.mesh.geometry.instanceCount = top;
    if (top) this.pos.needsUpdate = this.puff.needsUpdate = true;
  }
}

// What a thing is made of decides what comes off it.
const STUFF = {
  rock: { sparks: 1, chip: [0x4a4744, 0x5b5650, 0x3a3836, 0x6b645a], dust: 0xa8a197 },
  cliff: { sparks: 1, chip: [0x4a4744, 0x5b5650, 0x3a3836, 0x6b645a], dust: 0xa8a197 },
  wall: { sparks: 1.3, chip: [0x9a958c, 0xb4ada2, 0x7d7870], dust: 0xc4bdb0 },
};

export class CrashFX {
  // ground(x, z): height of the land there. small: a phone (fewer of everything).
  constructor(scene, { ground, small = false }) {
    this.ground = ground;
    const k = small ? 0.5 : 1;
    this.sparks = new Sparks(scene, Math.round(520 * k));
    this.glass = new Debris(scene, 'glass', Math.round(DEBRIS.glass.n * k));
    this.paint = new Debris(scene, 'paint', Math.round(DEBRIS.paint.n * k));
    this.chip = new Debris(scene, 'chip', Math.round(DEBRIS.chip.n * k));
    this.dust = new Dust(scene, Math.round(90 * k));
    this.small = small;
    this.carry = 0;
    this._c = new THREE.Color(); this._c2 = new THREE.Color();
    this.wind = new THREE.Vector3();
  }

  // A hit. e: { x, y, z: where (world), nx, nz: the face's outward normal, vx, vz: the car's
  // velocity before, speed: closing speed (m/s), slide: speed along the face, kind, paint: the car's
  // colour, floor: height of the road above the land there, glass: whether glass broke }.
  hit(e) {
    const S = STUFF[e.kind] || STUFF.wall, s = Math.min(1, e.speed / 22), k = this.small ? 0.55 : 1;
    const tx = -e.nz, tz = e.nx, along = e.vx * tx + e.vz * tz;
    const fl = e.floor;
    // Sparks: shaved off with the car's speed along the face, sprayed out off it and upwards.
    const nS = Math.round((14 + 90 * s) * S.sparks * k);
    for (let i = 0; i < nS; i++) {
      const out = rnd(0.5, 4) + e.speed * rnd(0.05, 0.25), sl = along * rnd(0.3, 1.05) + rnd(-3, 3) * (0.4 + s);
      this.sparks.emit(e.x + rnd(-0.25, 0.25), e.y + rnd(-0.2, 0.25), e.z + rnd(-0.25, 0.25),
        e.nx * out + tx * sl, rnd(0.5, 3.5) + e.speed * rnd(0.03, 0.18), e.nz * out + tz * sl, fl);
    }
    // Chips of the thing hit, kicked back out of the face.
    const nC = Math.round((3 + 22 * s) * k);
    for (let i = 0; i < nC; i++) {
      this._c.set(S.chip[(Math.random() * S.chip.length) | 0]).multiplyScalar(rnd(0.8, 1.15));
      const out = rnd(1, 5) * (0.4 + s);
      this.chip.emit(e.x + rnd(-0.3, 0.3), e.y + rnd(-0.1, 0.4), e.z + rnd(-0.3, 0.3),
        e.nx * out + tx * (along * rnd(0.1, 0.5) + rnd(-2, 2)), rnd(1, 5) * (0.5 + s), e.nz * out + tz * (along * rnd(0.1, 0.5) + rnd(-2, 2)),
        rnd(0.025, 0.09) * (0.6 + s), this._c, fl);
    }
    // Flakes of paint and bits of trim from the car, and glass when it breaks.
    if (e.speed > 6) {
      const nP = Math.round((2 + 18 * s) * k);
      for (let i = 0; i < nP; i++) {
        const dark = Math.random() < 0.35;
        this._c.copy(dark ? this._c2.setRGB(0.03, 0.03, 0.035) : e.paint);
        const out = rnd(0.5, 3.5);
        this.paint.emit(e.x + rnd(-0.3, 0.3), e.y + rnd(0, 0.4), e.z + rnd(-0.3, 0.3),
          e.vx * rnd(0.2, 0.6) + e.nx * out + rnd(-1.5, 1.5), rnd(1.5, 5) * (0.4 + s), e.vz * rnd(0.2, 0.6) + e.nz * out + rnd(-1.5, 1.5),
          rnd(0.05, 0.13), this._c, fl);
      }
    }
    if (e.glass) {
      const nG = Math.round((20 + 50 * s) * k);
      this._c.setRGB(0.85, 0.95, 0.97);
      for (let i = 0; i < nG; i++) {
        const out = rnd(0.3, 2.5);
        this.glass.emit(e.x + rnd(-0.5, 0.5), e.y + rnd(0.1, 0.9), e.z + rnd(-0.5, 0.5),
          e.vx * rnd(0.3, 0.75) + e.nx * out + rnd(-1.8, 1.8), rnd(0.8, 4.5), e.vz * rnd(0.3, 0.75) + e.nz * out + rnd(-1.8, 1.8),
          rnd(0.025, 0.07), this._c, fl);
      }
    }
    // A burst of dust: from the face and from under the car.
    const nD = Math.round((2 + 9 * s) * (this.small ? 0.6 : 1));
    this._c.set(S.dust);
    for (let i = 0; i < nD; i++) {
      const out = rnd(0.5, 3) * (0.5 + s);
      this.dust.emit(e.x + rnd(-0.6, 0.6), e.y + rnd(-0.3, 0.5), e.z + rnd(-0.6, 0.6),
        e.nx * out + e.vx * rnd(0.05, 0.3) + rnd(-1, 1), rnd(0.3, 2), e.nz * out + e.vz * rnd(0.05, 0.3) + rnd(-1, 1),
        rnd(0.9, 1.6) * (0.6 + s), this._c, rnd(0.25, 0.45) * (0.5 + 0.5 * s));
    }
  }

  // Grinding along a face, every frame it lasts: a steady spray of sparks and a little grit.
  grind(e, dt) {
    if (e.slide < 1.5) return;
    const S = STUFF[e.kind] || STUFF.wall, s = Math.min(1, e.slide / 20);
    this.carry += dt * (60 + 340 * s) * S.sparks * (this.small ? 0.5 : 1);
    const tx = -e.nz, tz = e.nx, along = e.vx * tx + e.vz * tz;
    while (this.carry >= 1) {
      this.carry -= 1;
      const out = rnd(0.3, 2.5);
      this.sparks.emit(e.x + rnd(-0.3, 0.3), e.y + rnd(-0.15, 0.2), e.z + rnd(-0.3, 0.3),
        e.nx * out + along * rnd(0.55, 1.05) * tx + rnd(-1, 1), rnd(0.3, 2.8), e.nz * out + along * rnd(0.55, 1.05) * tz + rnd(-1, 1), e.floor);
    }
    if (Math.random() < dt * 14 * s) {
      this._c.set(S.dust);
      this.dust.emit(e.x, e.y, e.z, e.nx + e.vx * 0.15, rnd(0.2, 0.8), e.nz + e.vz * 0.15, rnd(0.6, 1.1), this._c, 0.22);
    }
    if (Math.random() < dt * 10 * s) {
      this._c.set(S.chip[(Math.random() * S.chip.length) | 0]);
      this.chip.emit(e.x, e.y, e.z, e.nx * rnd(1, 3) + along * 0.4 * tx, rnd(1, 3), e.nz * rnd(1, 3) + along * 0.4 * tz, rnd(0.02, 0.05), this._c, e.floor);
    }
  }

  // Each frame. camera: for the spark width and the dust lighting; light: { sun: Color, amb: Color,
  // sunDir: Vector3 (world) }; wind: { x, z } (m/s).
  update(dt, camera, light, wind) {
    const g = this.ground;
    if (camera) {
      const H = camera.isPerspectiveCamera ? 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) : 1;
      this.sparks.mat.uniforms.uPx.value = H / Math.max(200, this._viewH || 800);
    }
    this.sparks.update(dt, g);
    this.glass.update(dt, g); this.paint.update(dt, g); this.chip.update(dt, g);
    if (light) {
      const U = this.dust.mat.uniforms;
      U.uSun.value.copy(light.sun); U.uAmb.value.copy(light.amb);
      if (camera) U.uSunView.value.copy(light.sunDir).transformDirection(camera.matrixWorldInverse);
    }
    this.wind.set(wind?.x || 0, 0, wind?.z || 0);
    this.dust.update(dt, this.wind);
  }
  setViewHeight(px) { this._viewH = px; }
}
