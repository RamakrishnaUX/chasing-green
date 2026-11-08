import * as THREE from 'three';

// Car wash brushes made of strips. Each brush is a slim shaft packed with rows of soft foam strips.
// Standing still the strips hang limp off the shaft like a mop; spinning, they fling straight out
// and trail a little behind the turn, fluttering. Against a car they fold over and lie along its
// panels instead of passing through it: every strip is worked out in the vertex shader, step by
// step from the shaft out, and each step that would end up inside the car is pushed back out onto
// its surface (the car is two rounded boxes, its body and its cabin, measured from its model).
//
// Only the wash nearest the eye has brushes (there is never more than one in sight): one set is
// moved to it. The overhead brush rides up and down over the car, as real ones do.

const SEGS = 6; // steps along a strip

// Strips round a shaft whose axis is the local y axis, from y = 0 to y = length.
function brushGeometry(length, { rows, around, seed = 1 }) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const strip = [], tint = [], idx = [];
  let v = 0;
  for (let r = 0; r < rows; r++) {
    const y = ((r + 0.5) / rows) * length;
    for (let a = 0; a < around; a++) {
      const ang = ((a + (r % 2) * 0.5 + (rnd() - 0.5) * 0.35) / around) * Math.PI * 2;
      const rr = rnd();
      // Mostly blue foam, a few grey and white strips in among them.
      const c = (rr < 0.06 ? [0.8, 0.82, 0.85] : rr < 0.16 ? [0.32, 0.36, 0.42] : [0.05 + rnd() * 0.04, 0.2 + rnd() * 0.08, 0.52 + rnd() * 0.12]).map((x) => Math.pow(x, 2.2)); // sRGB to linear
      const len = 0.88 + rnd() * 0.2, jitter = rnd();
      for (let i = 0; i <= SEGS; i++) {
        for (const side of [-0.5, 0.5]) {
          strip.push(ang, y, side, i);
          tint.push(c[0], c[1], c[2], len * 0.5 + Math.floor(jitter * 1000)); // fraction: half the length; whole: a random number
        }
        if (i < SEGS) { const k = v + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      v += (SEGS + 1) * 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(strip.length / 4 * 3), 3));
  g.setAttribute('aStrip', new THREE.Float32BufferAttribute(strip, 4));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, length / 2, 0), length / 2 + 1.2);
  return g;
}

const VERT_HEAD = /* glsl */ `
attribute vec4 aStrip; attribute vec4 aTint;
uniform float uSpin, uRate, uCore, uLen, uWidth, uTime, uCarOn, uFloor;
uniform vec3 uGrav;
uniform mat4 uToCar;
uniform vec3 uBodyC, uBodyH, uCabC, uCabH;
varying vec3 vTint; varying float vT;
float bSd(vec3 p, vec3 c, vec3 h, float r) { vec3 q = abs(p - c) - h + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float carSd(vec3 pl) {
  vec3 p = (uToCar * vec4(pl, 1.0)).xyz;
  return min(bSd(p, uBodyC, uBodyH, 0.16), bSd(p, uCabC, uCabH, 0.22)) - 0.025;
}
vec3 carN(vec3 p) {
  const vec2 k = vec2(1.0, -1.0); const float e = 0.03;
  return normalize(k.xyy * carSd(p + k.xyy * e) + k.yyx * carSd(p + k.yyx * e) + k.yxy * carSd(p + k.yxy * e) + k.xxx * carSd(p + k.xxx * e));
}
vec3 bPos; vec3 bNrm;
void brushStrip() {
  float ang = aStrip.x + uSpin, idx = aStrip.w;
  float len = fract(aTint.w) * 2.0 * uLen, rnd = floor(aTint.w) / 1000.0;
  vec3 A = vec3(0.0, 1.0, 0.0), R = vec3(cos(ang), 0.0, sin(ang));
  vec3 T = vec3(-sin(ang), 0.0, cos(ang)) * sign(uRate + 1e-4);
  float fling = smoothstep(0.0, 1.0, abs(uRate) / 7.0);
  // Gravity across the shaft makes strips hang; along it (the upright brushes), they slump down it.
  vec3 G = normalize(uGrav);
  vec3 p = R * uCore + A * aStrip.y, dir = R, segDir = R;
  float ds = len / ${SEGS.toFixed(1)};
  for (int i = 0; i < ${SEGS}; i++) {
    if (float(i) >= idx) break;
    float s = (float(i) + 0.5) / ${SEGS.toFixed(1)};
    float flap = sin(uTime * (11.0 + rnd * 6.0) + rnd * 40.0 + s * 3.0) * fling * 0.22 * s;
    vec3 d = R * (0.3 + 1.7 * fling) + G * (1.0 - fling * 0.92) * (0.5 + s * 1.6) - T * fling * (0.25 + 0.6 * s) + (T * flap + A * flap * 0.6);
    d = normalize(d);
    vec3 q = p + d * ds;
    if (uCarOn > 0.5) {
      float sd = carSd(q);
      // Inside the car: push the end of the step back out onto the panel, so the strip folds
      // over and lies along it, smeared back against the turn.
      if (sd < 0.0) { vec3 n = carN(q); q -= n * sd; q -= T * sd * 0.6; }
    }
    // And they lie on the ground rather than through it.
    q -= G * max(0.0, dot(q, G) - (uFloor - 0.03));
    segDir = normalize(q - p + 1e-5);
    p = q;
  }
  vec3 H = normalize(mix(R, T, fling) + 1e-4);
  vec3 W = cross(segDir, H);
  W = length(W) < 1e-3 ? A : normalize(W);
  bPos = p + W * aStrip.z * uWidth * (1.0 - 0.45 * idx / ${SEGS.toFixed(1)}); // tapering to the tip
  bNrm = normalize(cross(W, segDir));
  vTint = aTint.rgb * mix(0.35, 1.0, smoothstep(0.0, 3.0, idx)); // dark in the dense middle
  vT = idx / ${SEGS.toFixed(1)};
}`;

function brushMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  mat.customProgramCacheKey = () => 'wash-brush';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <beginnormal_vertex>', 'brushStrip();\nvec3 objectNormal = bNrm;')
      .replace('#include <begin_vertex>', 'vec3 transformed = bPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;\nvarying vec3 vTint; varying float vT;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vTint * mix(1.0, 0.62, uWet);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.85, 0.32, uWet);');
  };
  return mat;
}

// The car as two rounded boxes in its own frame (forward +z): the body to the bonnet line and the
// cabin above it. Measured once per model from its vertices.
function measureCar(body) {
  body.updateMatrixWorld(true);
  const inv = body.matrixWorld.clone().invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  const bb = new THREE.Box3(); const pts = [];
  // Only what is drawn: the cockpit's own parts (hidden from outside) are left out.
  body.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.isSkinnedMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const P = o.geometry.attributes.position, step = Math.max(1, Math.floor(P.count / 1500));
    for (let i = 0; i < P.count; i += step) { v.fromBufferAttribute(P, i).applyMatrix4(m); bb.expandByPoint(v); pts.push(v.x, v.y, v.z); }
  });
  const min = bb.min, max = bb.max, L = max.z - min.z, H = max.y - min.y;
  // Height profile along the car: the highest point in each slice.
  const N = 12, top = new Array(N).fill(min.y);
  for (let i = 0; i < pts.length; i += 3) { const k = Math.min(N - 1, Math.floor(((pts[i + 2] - min.z) / L) * N)); if (Math.abs(pts[i]) < (max.x - min.x) * 0.4) top[k] = Math.max(top[k], pts[i + 1]); }
  const sorted = [...top].sort((a, b) => a - b), bonnet = Math.min(sorted[Math.floor(N * 0.3)], min.y + H * 0.62);
  const roofLine = bonnet + (max.y - bonnet) * 0.5;
  let c0 = N, c1 = -1;
  top.forEach((t, k) => { if (t > roofLine) { c0 = Math.min(c0, k); c1 = Math.max(c1, k); } });
  if (c1 < 0) { c0 = 0; c1 = N - 1; }
  const halfW = (max.x - min.x) / 2;
  const z0 = min.z + (c0 / N) * L, z1 = min.z + ((c1 + 1) / N) * L;
  return {
    body: { c: new THREE.Vector3((min.x + max.x) / 2, (min.y + 0.12 + bonnet) / 2, (min.z + max.z) / 2), h: new THREE.Vector3(halfW * 0.97, (bonnet - min.y - 0.12) / 2, L / 2 * 0.98) },
    cab: { c: new THREE.Vector3((min.x + max.x) / 2, (bonnet + max.y) / 2 - 0.05, (z0 + z1) / 2), h: new THREE.Vector3(halfW * 0.88, (max.y - bonnet) / 2, (z1 - z0) / 2) },
    // The roof height over a point along the car (for the overhead brush), and its length.
    topAt: (z) => (z < min.z || z > max.z ? -Infinity : z >= z0 && z <= z1 ? max.y : bonnet),
  };
}

export class WashBrushes {
  // where(s): the gantry's frame at station s (position and heading); low: fewer strips.
  constructor(scene, { low = false } = {}) {
    const dens = low ? 0.7 : 1;
    this.group = new THREE.Group(); this.group.visible = false;
    scene.add(this.group);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.4, metalness: 0.6 });
    this.brushes = [];
    const mk = (length, rows, around, grav, place) => {
      const u = {
        uSpin: { value: 0 }, uRate: { value: 0 }, uCore: { value: 0.13 }, uLen: { value: 0.98 }, uWidth: { value: 0.055 },
        uTime: { value: 0 }, uCarOn: { value: 0 }, uGrav: { value: grav.clone() }, uToCar: { value: new THREE.Matrix4() },
        uBodyC: { value: new THREE.Vector3() }, uBodyH: { value: new THREE.Vector3() }, uCabC: { value: new THREE.Vector3() }, uCabH: { value: new THREE.Vector3() },
        uWet: { value: 0 }, uFloor: { value: 0.1 },
      };
      const holder = new THREE.Group();
      const mesh = new THREE.Mesh(brushGeometry(length, { rows: Math.round(rows * dens), around: Math.round(around * dens), seed: this.brushes.length + 3 }), brushMaterial(u));
      mesh.frustumCulled = true; mesh.receiveShadow = true; mesh.userData.noAO = true;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, length + 0.3, 10).translate(0, length / 2, 0), shaftMat);
      holder.add(mesh, shaft); place(holder); this.group.add(holder);
      const b = { holder, mesh, u, length, spin: 0, rate: 0 };
      this.brushes.push(b);
      return b;
    };
    // Two upright either side of the lane (strips slump down the shaft at rest), one across the top.
    this.left = mk(2.5, 44, 28, new THREE.Vector3(0, -1, 0), (h) => h.position.set(-1.85, 0.1, -0.4));
    this.right = mk(2.5, 44, 28, new THREE.Vector3(0, -1, 0), (h) => h.position.set(1.85, 0.1, -0.4));
    this.left.dir = 1; this.right.dir = -1;
    // The top brush's shaft runs across the lane: its local y is the world's -x, so down is local -x.
    this.top = mk(4.1, 70, 28, new THREE.Vector3(-1, 0, 0), (h) => { h.rotation.z = Math.PI / 2; h.position.set(2.05, 2.35, 0.6); });
    this.top.dir = 1; this.topY = 2.35; this.topV = 0;
    this.at = null; this.wet = 0; this.carFor = null; this.car = null;
    this.m = new THREE.Matrix4(); this.v = new THREE.Vector3();
  }

  // Each frame. near: the station nearest the eye if it is close (or null); active: the wash the
  // car is in ({ s }) or null; body: the car body (for contact); emit(x, y, z, vx, vy, vz): water
  // flung off the strips.
  update(dt, t, near, active, body, emit) {
    if (near !== this.at) {
      this.at = near;
      if (near) { this.group.position.set(near.x, near.y, near.z); this.group.rotation.y = near.heading; this.group.updateMatrixWorld(true); for (const b of this.brushes) { b.rate = 0; } }
    }
    this.group.visible = !!near;
    if (!near) return;
    const on = !!active && active.s === near.s;
    this.wet = on ? Math.min(1, this.wet + dt * 0.8) : Math.max(0, this.wet - dt / 90);
    let car = null;
    if (body && on) {
      if (this.carFor !== body) { this.carFor = body; this.car = measureCar(body); }
      car = this.car;
      body.updateMatrixWorld();
    }
    const inv = car ? this.m.copy(body.matrixWorld).invert() : null;
    // The overhead brush rides on the car: just clear of the roof or bonnet beneath it.
    let topTarget = 2.35;
    if (car) {
      const p = this.v.set(0, this.topY, 0.6); this.group.localToWorld(p); p.applyMatrix4(inv);
      const roof = car.topAt(p.z);
      if (roof > -Infinity) topTarget = Math.min(2.35, Math.max(1.0, this.topY + (roof + 0.72 - p.y)));
    }
    // A critically damped spring (about 0.5 s), so it lifts smoothly over the windscreen.
    const k = 40, c = 2 * Math.sqrt(k);
    this.topV += (k * (topTarget - this.topY) - c * this.topV) * dt; this.topY += this.topV * dt;
    this.top.holder.position.y = this.topY; this.top.u.uFloor.value = this.topY;
    for (const b of this.brushes) {
      b.rate += ((on ? 9 * b.dir : 0) - b.rate) * Math.min(1, dt * (on ? 1.6 : 0.6));
      b.spin += b.rate * dt;
      const u = b.u;
      u.uSpin.value = b.spin; u.uRate.value = b.rate; u.uTime.value = t; u.uWet.value = this.wet;
      u.uCarOn.value = car ? 1 : 0;
      if (car) {
        b.holder.updateMatrixWorld(true);
        u.uToCar.value.multiplyMatrices(inv, b.mesh.matrixWorld);
        u.uBodyC.value.copy(car.body.c); u.uBodyH.value.copy(car.body.h); u.uCabC.value.copy(car.cab.c); u.uCabH.value.copy(car.cab.h);
      }
      // Water flung off the tips, along the turn, while the brush is wet and spinning.
      const sp = Math.abs(b.rate);
      if (emit && this.wet > 0.2 && sp > 2) {
        for (let n = Math.floor(dt * 70 * (sp / 9) + Math.random()); n > 0; n--) {
          const a = Math.random() * Math.PI * 2 + b.spin, y = Math.random() * b.length, r = 0.9;
          const lp = this.v.set(Math.cos(a) * r, y, Math.sin(a) * r);
          const tx = -Math.sin(a) * Math.sign(b.rate), tz = Math.cos(a) * Math.sign(b.rate), vt = sp * 0.75;
          b.mesh.localToWorld(lp);
          const dir = new THREE.Vector3(tx * vt + Math.cos(a) * 1.5, 0, tz * vt + Math.sin(a) * 1.5).transformDirection(b.mesh.matrixWorld).multiplyScalar(vt);
          emit(lp.x, lp.y, lp.z, dir.x, dir.y + 0.6, dir.z);
        }
      } else if (emit && this.wet > 0.3 && Math.random() < dt * 6 * this.wet) {
        // Dripping once it stops.
        const a = Math.random() * Math.PI * 2, y = Math.random() * b.length;
        const lp = this.v.set(Math.cos(a) * 0.35, y, Math.sin(a) * 0.35); b.mesh.localToWorld(lp);
        emit(lp.x, lp.y - 0.4, lp.z, 0, -0.5, 0);
      }
    }
  }
}
