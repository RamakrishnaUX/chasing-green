import * as THREE from 'three';
import { roadPaths, heightAt, coastAt, waterLevelAt, lavaMask, glacierMask, roadHalfWidth, roadDistAt } from './terrain.js';
import { mulberry32, clamp } from './noise.js';
import { createGrassMaterial, surfaceUniforms } from './materials.js';

// A tussock: a fan of thin blades, darker at the root.
function tuftGeometry() {
  const pos = [], col = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + Math.random() * 0.4;
    const lean = 0.25 + Math.random() * 0.25;
    const h = 0.7 + Math.random() * 0.5;
    const w = 0.07;
    const cx = Math.cos(a), cz = Math.sin(a);
    const px = -cz * w, pz = cx * w;
    pos.push(px, 0, pz, -px, 0, -pz, cx * lean, h, cz * lean);
    col.push(0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1, 1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Point normals up so tufts light like the ground they stand on.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

const WINTER = [0xc4994f, 0xa8823f, 0xd2ad66, 0x8f7a46].map((c) => new THREE.Color(c));
const SUMMER = [0x8fa33e, 0x7a9236, 0xa5b04c, 0x6c8a35].map((c) => new THREE.Color(c));

export class Scatter {
  constructor(scene, { grass, rocks, obstacles = null }) {
    this.obstacles = obstacles;
    this.rand = mulberry32(4242);
    this.grassMesh = null;
    this.grassPick = [];
    if (grass > 0) this.buildGrass(scene, grass);
    if (rocks > 0) this.buildRocks(scene, rocks);
  }

  // Random point near a road, weighted by road length.
  sample(minOff, maxOff) {
    const r = this.rand;
    const path = roadPaths[Math.floor(r() * roadPaths.length)];
    const i = Math.floor(r() * (path.pts.length - 1));
    const a = path.pts[i], b = path.pts[i + 1];
    const t = r();
    const x0 = a.x + (b.x - a.x) * t, z0 = a.z + (b.z - a.z) * t;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
    const off = (roadHalfWidth(path.type) + minOff + Math.pow(r(), 1.6) * (maxOff - minOff)) * (r() < 0.5 ? -1 : 1);
    return { x: x0 + nx * off, z: z0 + nz * off };
  }

  usable(x, z, maxSlope) {
    const h = heightAt(x, z);
    if (h < waterLevelAt(x, z) + 0.25) return null;
    if (coastAt(x, z) < 14 && h < 4) return null; // black sand
    if (glacierMask(x, z) > 0.2) return null;
    const s = Math.abs(heightAt(x + 1.5, z) - h) + Math.abs(heightAt(x, z + 1.5) - h);
    if (s > maxSlope) return null;
    return h;
  }

  buildGrass(scene, count) {
    const geo = tuftGeometry();
    const mesh = new THREE.InstancedMesh(geo, createGrassMaterial(), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let n = 0, tries = 0;
    while (n < count && tries < count * 4) {
      tries++;
      const { x, z } = this.sample(2.2, 46);
      const h = this.usable(x, z, 1.4);
      if (h == null || h > 20) continue;
      const lava = lavaMask(x, z);
      if (lava > 0.5 && this.rand() < 0.7) continue;
      const s = 1.0 + this.rand() * 1.1;
      q.setFromAxisAngle(up, this.rand() * 6.28);
      m.compose(v.set(x, h - 0.05, z), q, sc.set(s, s * (0.8 + this.rand() * 0.5), s));
      mesh.setMatrixAt(n, m);
      this.grassPick.push({ k: Math.floor(this.rand() * 4), h, shade: 0.85 + this.rand() * 0.3, m: m.clone() });
      n++;
    }
    mesh.count = n;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.frustumCulled = false;
    this.grassMesh = mesh;
    scene.add(mesh);
  }

  // Grass colour follows the season, and tufts above the snow line are tucked away in winter.
  setSeason(season) {
    if (!this.grassMesh) return;
    const pal = season === 'Summer' ? SUMMER : WINTER;
    const snowLine = surfaceUniforms.uSnowLine.value;
    const c = new THREE.Color();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this.grassPick.forEach((g, i) => {
      const buried = g.h > snowLine - 2;
      c.copy(pal[g.k]).multiplyScalar(g.shade);
      this.grassMesh.setColorAt(i, c);
      this.grassMesh.setMatrixAt(i, buried ? hidden : g.m);
    });
    this.grassMesh.instanceColor.needsUpdate = true;
    this.grassMesh.instanceMatrix.needsUpdate = true;
  }

  buildRocks(scene, count) {
    // Weathered boulder: a lumpy sphere, flattened, so it sits into the ground.
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.22 * Math.sin(x * 3.1 + 1.3) * Math.sin(z * 2.7) + 0.12 * Math.sin(y * 5.3 + x * 2.0);
      p.setXYZ(i, x * n, y * n * 0.75, z * n);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler();
    const tones = [0x4a4643, 0x5c544b, 0x6b6359, 0x3a3836, 0x57524c].map((c) => new THREE.Color(c));
    // Rocks come in clusters: around cliff feet, on slopes, along the coast and in lava fields.
    // Never on a road or its gravel shoulder, and only a few on flat grass.
    let n = 0, tries = 0;
    let cx = 0, cz = 0, left = 0;
    while (n < count && tries < count * 14) {
      tries++;
      if (left <= 0) {
        const c = this.sample(14, 70);
        const slope = Math.abs(heightAt(c.x + 4, c.z) - heightAt(c.x - 4, c.z)) + Math.abs(heightAt(c.x, c.z + 4) - heightAt(c.x, c.z - 4));
        const rough = Math.min(1, slope / 3) + lavaMask(c.x, c.z) + (coastAt(c.x, c.z) < 30 ? 0.5 : 0);
        if (this.rand() > 0.15 + rough) continue; // flat grass: rarely
        cx = c.x; cz = c.z; left = 3 + Math.floor(this.rand() * 7);
      }
      const x = cx + (this.rand() - 0.5) * 14, z = cz + (this.rand() - 0.5) * 14;
      left--;
      if (roadDistAt(x, z) < 9) continue; // keep the road and shoulders clear
      const h = this.usable(x, z, 3);
      if (h == null) continue;
      const s = clamp(0.3 + Math.pow(this.rand(), 2) * 2.1, 0.3, 2.4);
      q.setFromEuler(e.set(this.rand() * 3, this.rand() * 3, this.rand() * 3));
      m.compose(v.set(x, h + s * 0.2, z), q, sc.set(s, s * (0.5 + this.rand() * 0.4), s * (0.8 + this.rand() * 0.4)));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, tones[Math.floor(this.rand() * tones.length)]);
      // Anything bigger than a pebble is solid: you hit it rather than float over it.
      if (s > 0.45) this.obstacles?.addCircle(x, z, s * 0.95, 'rock');
      n++;
    }
    mesh.count = n;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}
