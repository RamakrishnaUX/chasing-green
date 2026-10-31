import * as THREE from 'three';
import { clamp, lerp } from '../world/noise.js';
import { waterLevelAt } from '../world/terrain.js';

// Boat mode. In water too deep to wade, a hull drops out from under the car, the wheels fold up
// flat onto its deck, and a water jet and navigation lights come out at the stern. In the
// shallows it all folds away again. One kit fits every vehicle: it is sized from the wheels and
// the body's length, in world units (a model built small and scaled up keeps its wheel pivots
// in its own units, so the fold is divided by that scale).

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// The order things happen in as the morph runs from 0 (car) to 1 (boat).
export const stages = (t) => ({ hull: smooth(0, 0.5, t), fold: smooth(0.3, 0.8, t), jet: smooth(0.6, 1, t), flare: 1 - smooth(0.25, 0.55, t) });

// A hard-chine V-hull with a flat deck the car sits in: orange rubbing strake, white topsides,
// dark bottom. Origin at the gunwale, so scaling y grows it downward from under the body.
function hullGeometry(halfW, z0, z1, depth) {
  const N = 28, pos = [], col = [];
  const C = { o: new THREE.Color(0xe2532a), w: new THREE.Color(0xeeefeb), n: new THREE.Color(0x1a2632), d: new THREE.Color(0x2a2d31) };
  const segCol = ['o', 'w', 'n', 'n', 'n', 'n', 'w', 'o'];
  const rings = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, z = z0 + (z1 - z0) * u, b = Math.max(0, (u - 0.66) / 0.34);
    const w = halfW * (1 - Math.pow(b, 1.7) * 0.95) * (u < 0.06 ? 0.97 + u / 2 : 1);
    const top = 0.16 * b * b, keel = -depth + (depth + 0.08) * Math.pow(b, 1.5), ch = lerp(keel, top, 0.4);
    const boot = Math.max(ch + 0.01, Math.min(-depth * 0.55, top - 0.1));
    rings.push([[-w, top], [-w * 0.995, top - 0.09], [-w * 0.965, boot], [-w * 0.93, ch], [0, keel], [w * 0.93, ch], [w * 0.965, boot], [w * 0.995, top - 0.09], [w, top]]
      .map(([x, y]) => new THREE.Vector3(x, y, z)));
  }
  const tri = (a, b, c, k) => { for (const v of [a, b, c]) { pos.push(v.x, v.y, v.z); col.push(C[k].r, C[k].g, C[k].b); } };
  for (let i = 0; i < N; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let j = 0; j < 8; j++) { tri(A[j], A[j + 1], B[j + 1], segCol[j]); tri(A[j], B[j + 1], B[j], segCol[j]); }
    tri(A[0], A[8], B[8], 'd'); tri(A[0], B[8], B[0], 'd'); // deck
  }
  const T = rings[0], ctr = new THREE.Vector3(0, -depth * 0.12, T[0].z);
  for (let j = 0; j < 8; j++) tri(ctr, T[j + 1], T[j], 'w'); // transom
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildBoatKit(model) {
  const MS = model.scale || 1, R = model.R * MS;
  // Body length from everything but the wheels, in the model's outer (world-sized) frame.
  model.group.updateMatrixWorld(true);
  // The hull's width comes from the long panels only, so mirrors and badges do not count.
  const pivots = new Set(model.wheels.map((w) => w.pivot)), box = new THREE.Box3(), body = new THREE.Box3(), inv = model.group.matrixWorld.clone().invert(), tmp = new THREE.Box3();
  model.group.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (pivots.has(p)) return;
    tmp.setFromObject(o).applyMatrix4(inv); box.union(tmp);
    if (tmp.max.z - tmp.min.z > 1.5) body.union(tmp);
  });
  const track = Math.max(...model.wheels.map((w) => Math.abs(w.x)));
  const halfW = Math.max(track + 0.22, body.max.x + 0.14), depth = R * 1.8, gunwale = R + R * 0.9;
  const z0 = box.min.z + 0.15, z1 = box.max.z + 0.3;

  const group = new THREE.Group();
  group.userData.dynamic = true; // never merged: it scales and moves
  const hull = new THREE.Mesh(hullGeometry(halfW, z0, z1, depth), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide }));
  hull.position.y = gunwale; hull.castShadow = hull.receiveShadow = true;
  group.add(hull);
  // Water jet with a steering bucket.
  const jet = new THREE.Group(), metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.3 });
  const casing = new THREE.CylinderGeometry(0.15, 0.19, 0.42, 18); casing.rotateX(Math.PI / 2);
  const noz = new THREE.CylinderGeometry(0.1, 0.14, 0.2, 18); noz.rotateX(Math.PI / 2);
  const jb = new THREE.Mesh(casing, new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.4 })); jb.castShadow = true; jet.add(jb);
  const bucket = new THREE.Mesh(noz, metal); bucket.position.z = -0.28; jet.add(bucket);
  group.add(jet);
  // Navigation lights: red to port, green to starboard, white at the stern.
  const nav = [[-halfW * 0.93, gunwale + 0.05, z1 - 1.1, 0xff2a2a], [halfW * 0.93, gunwale + 0.05, z1 - 1.1, 0x2aff5c], [0, gunwale + 0.1, z0 + 0.12, 0xffffff]].map(([x, y, z, c]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0 }));
    m.position.set(x, y, z); group.add(m); return m;
  });
  model.group.add(group);
  for (const w of model.wheels) w.baseX = w.pivot.position.x;
  // Fender flares, when the model marks them, tuck away as the wheels fold.
  const flares = [];
  model.group.traverse((o) => { if (o.userData.flare) flares.push(o); });

  const apply = (t) => {
    const s = stages(t);
    group.visible = t > 0.005;
    hull.visible = s.hull > 0.01;
    hull.scale.set(lerp(0.78, 1, s.hull), lerp(0.04, 1, s.hull), lerp(0.9, 1, s.hull));
    jet.visible = s.jet > 0.01;
    jet.position.set(0, lerp(gunwale - 0.2, gunwale - depth * 0.72, s.jet), lerp(z0 + 0.3, z0 - 0.15, s.jet));
    for (const n of nav) n.material.emissiveIntensity = s.jet * 4;
    for (const f of flares) { f.visible = s.flare > 0.01; f.scale.setScalar(Math.max(s.flare, 0.01)); }
  };
  apply(0);
  return {
    group, apply, bucket, R, MS, halfW, z0, z1,
    // Where the water sits on the hull, as a height above the car's ground line.
    waterline: gunwale - depth * 0.58,
    // How far the wheel pivots rise to lie flat on the deck, in the model's own units.
    lift: (gunwale + 0.2 - R) / MS,
    inset: 0.06 / MS,
  };
}

// The wake: a ribbon laid on the water behind the stern, bright along its edges, spreading and
// fading as it ages.
export class Wake {
  constructor(scene, n = 80) {
    this.n = n; this.trail = []; this.clock = 0; this.time = 0;
    const c = document.createElement('canvas'); c.width = 128; c.height = 8;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 128, 0);
    [[0, 0], [0.06, 0.9], [0.16, 0.18], [0.5, 0.1], [0.84, 0.18], [0.94, 0.9], [1, 0]].forEach(([o, a]) => g.addColorStop(o, `rgba(255,255,255,${a})`));
    x.fillStyle = g; x.fillRect(0, 0, 128, 8);
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 8);
    const uv = new Float32Array(n * 4), idx = [];
    for (let i = 0; i < n; i++) uv.set([0, 0, 1, 0], i * 4);
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.visible = false;
    this.mesh.userData.noAO = true;
    scene.add(this.mesh);
  }
  // stern: world position of the jet; on: whether the boat is moving through water.
  update(dt, stern, heading, on) {
    this.time += dt; this.clock += dt;
    const T = this.trail;
    if (on && this.clock > 0.12) {
      this.clock = 0;
      T.unshift({ x: stern.x, z: stern.z, h: heading, y: waterLevelAt(stern.x, stern.z) + 0.04, t: this.time });
      if (T.length > this.n) T.pop();
    }
    while (T.length && this.time - T[T.length - 1].t > 8) T.pop();
    this.mesh.visible = T.length > 1;
    if (!this.mesh.visible) return;
    this.col.fill(0);
    T.forEach((s, i) => {
      const age = this.time - s.t, hw = 0.9 + age * 0.75, a = Math.max(0, 1 - age / 8) * Math.min(1, i / 4) * 0.55;
      const px = Math.cos(s.h) * hw, pz = -Math.sin(s.h) * hw;
      this.pos.set([s.x - px, s.y, s.z - pz, s.x + px, s.y, s.z + pz], i * 6);
      this.col.set([1, 1, 1, a, 1, 1, 1, a], i * 8);
    });
    const last = (T.length - 1) * 6;
    for (let i = T.length; i < this.n; i++) this.pos.copyWithin(i * 6, last, last + 6);
    this.geo.attributes.position.needsUpdate = this.geo.attributes.color.needsUpdate = true;
  }
  clear() { this.trail.length = 0; this.mesh.visible = false; }
}
