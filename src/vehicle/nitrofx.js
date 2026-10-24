// Nitro you can see: from each of the two exhausts a white-hot core, a green-teal flame and
// a soft glow, a light that tints the road behind the car, and streaks that hang in the air
// for a moment as the car pulls away from them.
import * as THREE from 'three';

const TRAIL_LIFE = 0.32; // seconds a streak point lingers
const TRAIL_MAX = 40;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(200,255,235,0.8)');
  grad.addColorStop(0.6, 'rgba(60,220,190,0.25)');
  grad.addColorStop(1, 'rgba(40,180,200,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

export class NitroFX {
  constructor(scene, root) {
    this.scene = scene;
    this.root = root;
    this.level = 0; // eases toward 1 while boosting
    const tex = glowTexture();
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xeafff7, opacity: 0, ...add });
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0x22d6b0, opacity: 0, ...add });
    this.glowMat = new THREE.SpriteMaterial({ map: tex, color: 0x4cefc6, opacity: 0, ...add });
    const core = new THREE.ConeGeometry(0.075, 0.7, 14, 1, true);
    core.rotateX(-Math.PI / 2); core.translate(0, 0, -0.35);
    const flame = new THREE.ConeGeometry(0.17, 1.6, 16, 1, true);
    flame.rotateX(-Math.PI / 2); flame.translate(0, 0, -0.8);
    this.pipes = [0, 1].map(() => {
      const g = new THREE.Group();
      const c = new THREE.Mesh(core, this.coreMat);
      const f = new THREE.Mesh(flame, this.flameMat);
      const s = new THREE.Sprite(this.glowMat);
      s.scale.setScalar(2);
      g.add(f, c, s);
      root.add(g);
      return { g, core: c, flame: f, glow: s, trail: [] };
    });
    this.light = new THREE.PointLight(0x3fe6c0, 0, 9, 1.6);
    root.add(this.light);

    // Streak ribbons live in the world, so the car leaves them behind.
    this.trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, ...add });
    this.ribbons = this.pipes.map(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < TRAIL_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, this.trailMat);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });

    // Sparks: tiny bright points flicked out of the pipes.
    const n = 160;
    this.spark = { n, next: 0, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n) };
    for (let i = 0; i < n; i++) this.spark.pos[i * 3 + 1] = -9999;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.spark.pos, 3));
    this.sparkPts = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x8ff5d8, size: 0.24, map: tex, sizeAttenuation: true, ...add }));
    this.sparkPts.frustumCulled = false;
    scene.add(this.sparkPts);
    this.tmp = new THREE.Vector3();
  }

  // Twin pipes: mirror the model's exhaust across the centre line (a centre pipe splits in two).
  place(exhaust) {
    const [x, y, z] = exhaust;
    const off = Math.abs(x) > 0.2 ? Math.abs(x) : 0.32;
    this.pipes[0].g.position.set(-off, y, z);
    this.pipes[1].g.position.set(off, y, z);
    this.light.position.set(0, y + 0.2, z - 1.2);
    for (const p of this.pipes) p.trail.length = 0;
  }

  update(dt, boosting, speed) {
    dt = dt || 0;
    this.level += ((boosting ? 1 : 0) - this.level) * Math.min(1, dt * (boosting ? 14 : 6));
    const L = this.level, on = L > 0.02;
    const flick = () => 0.8 + Math.random() * 0.4;
    this.coreMat.opacity = L * 0.95;
    this.flameMat.opacity = L * 0.9;
    this.glowMat.opacity = L * 0.9;
    this.light.intensity = L * (5 + Math.random() * 2);
    const stretch = 0.8 + Math.min(1, speed / 40) * 0.9;
    for (const p of this.pipes) {
      p.g.visible = on;
      p.core.scale.set(1, 1, stretch * flick());
      p.flame.scale.set(0.9 + Math.random() * 0.25, 0.9 + Math.random() * 0.25, stretch * flick());
      p.glow.scale.setScalar(1.6 + L * 0.9 + Math.random() * 0.35);
    }
    // Streak points and sparks, in world space.
    const s = this.spark;
    this.root.updateMatrixWorld();
    this.pipes.forEach((p, k) => {
      for (const q of p.trail) q.age += dt;
      while (p.trail.length && p.trail[p.trail.length - 1].age > TRAIL_LIFE) p.trail.pop();
      if (on) {
        p.g.getWorldPosition(this.tmp);
        p.trail.unshift({ x: this.tmp.x, y: this.tmp.y, z: this.tmp.z, age: 0, w: L });
        if (p.trail.length > TRAIL_MAX) p.trail.length = TRAIL_MAX;
        for (let j = 0; j < 2; j++) {
          const i = s.next; s.next = (s.next + 1) % s.n;
          s.pos[i * 3] = this.tmp.x; s.pos[i * 3 + 1] = this.tmp.y; s.pos[i * 3 + 2] = this.tmp.z;
          s.vel[i * 3] = (Math.random() - 0.5) * 3; s.vel[i * 3 + 1] = Math.random() * 1.5; s.vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
          s.life[i] = 0.2 + Math.random() * 0.25;
        }
      }
      this.writeRibbon(this.ribbons[k], p.trail);
    });
    for (let i = 0; i < s.n; i++) {
      if (s.life[i] <= 0) continue;
      s.life[i] -= dt;
      if (s.life[i] <= 0) { s.pos[i * 3 + 1] = -9999; continue; }
      s.pos[i * 3] += s.vel[i * 3] * dt; s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt; s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
    }
    this.sparkPts.geometry.attributes.position.needsUpdate = true;
  }

  // A flat ribbon that tapers and fades along the trail: mint at the pipe, cyan-blue at the tail.
  writeRibbon(mesh, trail) {
    const pos = mesh.geometry.attributes.position.array, col = mesh.geometry.attributes.color.array;
    const n = trail.length;
    for (let i = 0; i < TRAIL_MAX; i++) {
      const o = i * 6;
      if (i >= n || n < 2) { for (let j = 0; j < 6; j++) { pos[o + j] = 0; col[o + j] = 0; } continue; }
      const a = trail[Math.max(0, i - 1)], b = trail[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const q = trail[i], t = q.age / TRAIL_LIFE, fade = Math.max(0, 1 - t) * q.w;
      const w = 0.2 * (1 - t * 0.7);
      pos[o] = q.x - dz * w; pos[o + 1] = q.y; pos[o + 2] = q.z + dx * w;
      pos[o + 3] = q.x + dz * w; pos[o + 4] = q.y; pos[o + 5] = q.z - dx * w;
      const r = (0.25 - t * 0.15) * fade, g = (0.95 - t * 0.3) * fade, bl = (0.75 + t * 0.25) * fade;
      col[o] = col[o + 3] = r; col[o + 1] = col[o + 4] = g; col[o + 2] = col[o + 5] = bl;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
  }
}
