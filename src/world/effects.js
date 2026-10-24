import * as THREE from 'three';
import { roadPaths, heightAt, roadHalfWidth, deckAt } from './terrain.js';
import { createWaterMaterial } from './materials.js';
import { mulberry32 } from './noise.js';

// ---------- Particles ----------
let sprite = null;
function softSprite() {
  if (sprite) return sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprite = new THREE.CanvasTexture(c);
  return sprite;
}

// A pool of simple particles with gravity and drag, drawn as soft sprites.
export class Particles {
  constructor(scene, { count = 500, color = 0xffffff, size = 0.5, opacity = 0.6, gravity = 9, drag = 1.5 }) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.gravity = gravity;
    this.drag = drag;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ color, size, map: softSprite(), transparent: true, opacity, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -9999;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, count, spread, life = 0.9) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = vy * (0.6 + Math.random() * 0.8);
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.8);
    }
  }
  update(dt) {
    const p = this.pos, v = this.vel;
    const dr = Math.max(0, 1 - this.drag * dt);
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      v[i * 3 + 1] -= this.gravity * dt;
      v[i * 3] *= dr; v[i * 3 + 1] *= dr; v[i * 3 + 2] *= dr;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (this.life[i] <= 0) p[i * 3 + 1] = -9999;
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- Puddles ----------
// Rain puddles on the tarmac: irregular, mirror-like, and you can hear and see the splash.
export class Puddles {
  constructor(scene, count = 110) {
    const r = mulberry32(5150);
    this.list = [];
    const mat = createWaterMaterial(0x101a20, { roughness: 0.42, ripple: 0.25, depthAware: false, foam: 0, shallow: [0.05, 0.06, 0.07], deep: [0.03, 0.035, 0.04] });
    // A soft wet sheen that blends into the asphalt, not a mirror of the bright sky.
    mat.envMapIntensity = 0.3;
    mat.transparent = true;
    mat.opacity = 0.7;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -6;
    mat.polygonOffsetUnits = -6;
    const paved = roadPaths.filter((p) => p.type === 'paved');
    let tries = 0;
    while (this.list.length < count && tries < count * 10) {
      tries++;
      const path = paved[Math.floor(r() * paved.length)];
      const i = Math.floor(r() * (path.pts.length - 1));
      const a = path.pts[i], b = path.pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const t = r();
      const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      const hw = roadHalfWidth('paved');
      const lat = (r() * 2 - 1) * (hw - 1.2);
      const x = a.x + (b.x - a.x) * t + nx * lat, z = a.z + (b.z - a.z) * t + nz * lat;
      if (this.list.some((q) => Math.hypot(q.x - x, q.z - z) < 25)) continue;
      if (deckAt(x, z) != null) continue;
      const rx = 1.0 + r() * 1.8, rz = 0.7 + r() * 1.1;
      const rot = Math.atan2(b.x - a.x, b.z - a.z);
      // Irregular outline.
      const shape = new THREE.Shape();
      const seg = 18, k1 = r() * 6, k2 = r() * 6;
      for (let s = 0; s <= seg; s++) {
        const ang = (s / seg) * Math.PI * 2;
        const w = 1 + 0.18 * Math.sin(ang * 3 + k1) + 0.1 * Math.sin(ang * 5 + k2);
        const px = Math.cos(ang) * rz * w, py = Math.sin(ang) * rx * w;
        if (s === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
      }
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, heightAt(x, z) + 0.17, z);
      m.rotation.y = rot;
      m.receiveShadow = true;
      scene.add(m);
      this.list.push({ x, z, rx, rz, rot });
    }
  }
  // True if a world point is inside any puddle.
  at(x, z) {
    for (const q of this.list) {
      const dx = x - q.x, dz = z - q.z;
      if (dx * dx + dz * dz > 16) continue;
      const c = Math.cos(q.rot), s = Math.sin(q.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c; // lz along road
      if ((lx * lx) / (q.rz * q.rz) + (lz * lz) / (q.rx * q.rx) < 1.1) return true;
    }
    return false;
  }
}

// ---------- Snowfall ----------
// Flakes in a box around the camera that wrap as it moves. Intensity 0..1 fades them in and out.
export class SnowFall {
  constructor(scene, count = 2200) {
    this.n = count;
    this.box = { x: 70, y: 36, z: 70 };
    this.pos = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.pos[i * 3 + 1] = Math.random() * this.box.y;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      this.seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ color: 0xf4f8fb, size: 0.32, map: softSprite(), transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.intensity = 0;
    this.anchor = new THREE.Vector3();
  }
  update(dt, camera, target, wind) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.4);
    this.points.visible = this.intensity > 0.01;
    if (!this.points.visible) return;
    this.mat.opacity = 0.75 * Math.min(1, this.intensity);
    this.points.geometry.setDrawRange(0, Math.round(this.n * Math.min(1, this.intensity * 1.2)));
    this.anchor.copy(camera.position);
    const p = this.pos, b = this.box, wx = (wind?.x || 0) * 0.08, wz = (wind?.z || 0) * 0.08;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i];
      p[i * 3] += (Math.sin(s * 6.28 + performance.now() * 0.001 * (0.5 + s)) * 0.6 + wx) * dt;
      p[i * 3 + 1] -= (1.4 + s * 1.8) * dt;
      p[i * 3 + 2] += (Math.cos(s * 4.1 + performance.now() * 0.0013) * 0.6 + wz) * dt;
      if (p[i * 3 + 1] < -2) p[i * 3 + 1] += b.y;
    }
    // Keep the box centred on the camera without teleporting flakes: offset the whole cloud.
    this.points.position.set(this.anchor.x, this.anchor.y - 8, this.anchor.z);
    const sx = b.x / 2, sz = b.z / 2;
    for (let i = 0; i < this.n; i++) {
      if (p[i * 3] > sx) p[i * 3] -= b.x; else if (p[i * 3] < -sx) p[i * 3] += b.x;
      if (p[i * 3 + 2] > sz) p[i * 3 + 2] -= b.z; else if (p[i * 3 + 2] < -sz) p[i * 3 + 2] += b.z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
