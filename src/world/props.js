import * as THREE from 'three';
import { roadPaths, heightAt, coastAt, waterLevelAt, lavaMask, glacierMask, sandMask, roadHalfWidth, roadDistAt } from './terrain.js';
import { mulberry32 } from './noise.js';

// Farms, fences and birch groves: the lived-in detail along Icelandic country roads.

const wall = new THREE.MeshStandardMaterial({ color: 0xebe7dc, roughness: 0.85 });
const wallTimber = new THREE.MeshStandardMaterial({ color: 0x7b3b2a, roughness: 0.8 });
const roofRed = new THREE.MeshStandardMaterial({ color: 0xa3281e, roughness: 0.55, metalness: 0.35 });
const roofGrey = new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.5, metalness: 0.4 });
const windowMat = new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.1, metalness: 0.6, emissive: 0xffc070, emissiveIntensity: 0 });
const fenceMat = new THREE.MeshStandardMaterial({ color: 0x9b8f7c, roughness: 0.95 });
const barkMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 });
export const propMaterials = { windowMat };

function gableRoof(w, d, h, overhang = 0.35) {
  // A prism: triangle profile extruded along the building depth.
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - overhang, 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  g.translate(0, 0, -(d + overhang * 2) / 2);
  return g;
}

function house({ w, d, h, roof, wallM = wall, rand }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallM);
  body.position.y = h / 2;
  body.userData.solid = true;
  const r = new THREE.Mesh(gableRoof(w, d, w * 0.42), roof);
  r.position.y = h;
  g.add(body, r);
  // Concrete plinth reaching down into the ground, so the house never floats on a slope.
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 2.2, d + 0.3), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.95 }));
  plinth.position.y = -0.8;
  g.add(plinth);
  const chim = new THREE.Mesh(new THREE.BoxGeometry(0.55, w * 0.32 + 0.8, 0.55), new THREE.MeshStandardMaterial({ color: 0x8c8580, roughness: 0.9 }));
  chim.position.set(w * 0.2, h + w * 0.26, -d * 0.25);
  g.add(chim);
  const frameM = new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: 0.6 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.1), new THREE.MeshStandardMaterial({ color: [0xa3281e, 0x2f6d4a, 0x35506b][Math.floor(rand() * 3)], roughness: 0.6 }));
  door.position.set(-w * 0.2, 1.0, d / 2 + 0.03);
  g.add(door);
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.8), new THREE.MeshStandardMaterial({ color: 0x77797c, roughness: 0.9 }));
  step.position.set(-w * 0.2, 0.15, d / 2 + 0.45);
  g.add(step);
  // Windows on the long sides, framed, with glazing bars.
  const n = Math.max(2, Math.floor(d / 2.6));
  for (let i = 0; i < n; i++) {
    for (const side of [-1, 1]) {
      const z = -d / 2 + (i + 0.5) * (d / n);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.05), frameM);
      frame.position.set(side * (w / 2 + 0.03), h * 0.55, z);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.85), windowMat);
      win.position.set(side * (w / 2 + 0.05), h * 0.55, z);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.05), frameM);
      bar.position.set(side * (w / 2 + 0.07), h * 0.55, z);
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.85), frameM);
      bar2.position.set(side * (w / 2 + 0.07), h * 0.62, z);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 1.15), frameM);
      sill.position.set(side * (w / 2 + 0.1), h * 0.55 - 0.62, z);
      g.add(frame, win, bar, bar2, sill);
    }
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.rotation.y = rand() * 0.2;
  return g;
}

function birch(rand) {
  const g = new THREE.Group();
  const h = 3.5 + rand() * 3;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, h, 5), barkMat);
  trunk.position.y = h / 2;
  trunk.userData.solidCircle = 0.4;
  trunk.userData.kind = 'tree';
  g.add(trunk);
  // Autumn crown: gold, amber or still green.
  const hue = [0xa8822c, 0xbf9a3c, 0x9a6526, 0x66722f][Math.floor(rand() * 4)];
  const crownMat = new THREE.MeshStandardMaterial({ color: hue, roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + rand() * 0.45, 1), crownMat);
    c.position.set((rand() - 0.5) * 1.1, h * (0.55 + i * 0.16), (rand() - 0.5) * 1.1);
    c.scale.set(1, 1.6, 1);
    g.add(c);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

export class Props {
  constructor(scene, { farms = 34, landmarks = [], keepClear = [], obstacles = null } = {}) {
    this.rand = mulberry32(2024);
    const r = this.rand;
    const sites = [];
    const avoid = landmarks.map((l) => ({ x: l.x, z: l.z }));
    let tries = 0;
    const fencePosts = [];
    while (sites.length < farms && tries < farms * 60) {
      tries++;
      const path = roadPaths[Math.floor(r() * roadPaths.length)];
      if (path.type !== 'paved') continue;
      const i = Math.floor(r() * (path.pts.length - 2)) + 1;
      const a = path.pts[i], b = path.pts[i + 1];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
      const side = r() < 0.5 ? -1 : 1;
      const off = roadHalfWidth('paved') + 16 + r() * 22;
      const x = a.x + nx * off * side, z = a.z + nz * off * side;
      const h = heightAt(x, z);
      if (h < waterLevelAt(x, z) + 1 || h > 18) continue;
      if (coastAt(x, z) < 25 || sandMask(x, z, h) > 0.1 || lavaMask(x, z) > 0.2 || glacierMask(x, z) > 0) continue;
      const slope = Math.abs(heightAt(x + 6, z) - heightAt(x - 6, z)) + Math.abs(heightAt(x, z + 6) - heightAt(x, z - 6));
      if (slope > 2.2) continue;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 90)) continue;
      if (avoid.some((s) => Math.hypot(s.x - x, s.z - z) < 70)) continue;
      if (keepClear.some((s) => Math.hypot(s.x - x, s.z - z) < 160)) continue;
      if (roadDistAt(x, z) < 26) continue; // the barn and groves sit around the house, so keep the whole farm back
      sites.push({ x, z, h, face: Math.atan2(-nx * side, -nz * side), nx: nx * side, nz: nz * side, a, b });
    }

    for (const s of sites) {
      const g = new THREE.Group();
      g.position.set(s.x, s.h - 0.3, s.z);
      g.rotation.y = s.face;
      const main = house({ w: 6 + r() * 2, d: 8 + r() * 3, h: 3.2 + r() * 1.2, roof: r() < 0.8 ? roofRed : roofGrey, rand: r });
      g.add(main);
      if (r() < 0.8) {
        // Barn or outbuilding.
        const barn = house({ w: 8 + r() * 3, d: 12 + r() * 6, h: 4 + r() * 1.5, roof: r() < 0.6 ? roofRed : roofGrey, wallM: r() < 0.3 ? wallTimber : wall, rand: r });
        barn.position.set(10 + r() * 4, 0, -4 + r() * 8);
        g.add(barn);
      }
      // A shelterbelt of birch behind the house.
      const trees = 3 + Math.floor(r() * 6);
      for (let t = 0; t < trees; t++) {
        const tree = birch(r);
        // Local +z faces the road, so the grove goes behind the house (negative z).
        const tx = -10 + t * 3.2 + r() * 1.5, tz = -9 - r() * 9;
        tree.position.set(tx, heightAt(s.x + tx, s.z + tz) - s.h + 0.3, tz);
        g.add(tree);
      }
      g.traverse((m) => { if (m.isMesh && m.parent !== g) { /* children follow ground approximately */ } });
      scene.add(g);
      obstacles?.addFromObject(g, 'wall');
      // Fence along the road frontage of the farm.
      const fdir = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
      const fx = Math.sin(fdir), fz = Math.cos(fdir);
      const fOff = roadHalfWidth('paved') + 5.5;
      const cx = s.a.x + s.nx * fOff, cz = s.a.z + s.nz * fOff;
      const len = 60 + r() * 80;
      for (let d = -len / 2; d <= len / 2; d += 3.2) {
        const px = cx + fx * d, pz = cz + fz * d;
        if (roadDistAt(px, pz) < roadHalfWidth('paved') + 3.5) continue;
        fencePosts.push([px, heightAt(px, pz), pz]);
      }
    }
    this.buildFence(scene, fencePosts);
    this.sites = sites;
  }

  buildFence(scene, posts) {
    if (!posts.length) return;
    const geo = new THREE.BoxGeometry(0.1, 1.2, 0.1);
    geo.translate(0, 0.6, 0);
    const mesh = new THREE.InstancedMesh(geo, fenceMat, posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, y, z], i) => { m.makeTranslation(x, y - 0.05, z); mesh.setMatrixAt(i, m); });
    mesh.castShadow = true;
    scene.add(mesh);
    // Two strands of wire between neighbouring posts.
    const pts = [];
    for (let i = 1; i < posts.length; i++) {
      const [ax, ay, az] = posts[i - 1], [bx, by, bz] = posts[i];
      if (Math.hypot(bx - ax, bz - az) > 4) continue;
      for (const hy of [0.55, 1.05]) pts.push(ax, ay + hy, az, bx, by + hy, bz);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x6b6660, transparent: true, opacity: 0.7 })));
  }

  // Farm windows glow after dark.
  setNight(dark) { windowMat.emissiveIntensity = dark > 0.5 ? 1.2 : 0; }
}
