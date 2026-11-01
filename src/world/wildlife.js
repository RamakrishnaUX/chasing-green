import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, waterLevelAt, roadDistAt, shoreDistAt } from './terrain.js';
import { toWorld } from './geo.js';
import { mulberry32, clamp, lerp } from './noise.js';

// Wildlife, each where and when it really lives. On land: sheep roaming free in summer and
// autumn, Icelandic horses, reindeer only in the east, an arctic fox whose eyes catch the
// headlights. On the shore: seals at Jökulsárlón, Diamond Beach and Ytri Tunga, and puffins on
// Dyrhólaey's cliffs in summer. At sea: humpbacks in Skjálfandi Bay from spring to autumn, orcas
// off Snæfellsnes in winter, and white-beaked dolphins that come to ride a boat's bow wave.
//
// Land animals are spawned in cells around the player from a seed, so the same flock is in the
// same field when you come back. Herd animals share one instanced body mesh and one instanced
// leg mesh per species, so a whole valley of sheep costs two draw calls.

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color(), V = new THREE.Vector3();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------- Shapes, built from primitives and painted with vertex colours ----------
function piece(geo, color, at = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)));
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const ball = () => new THREE.SphereGeometry(1, 12, 9);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const cyl = (r0, r1, h, s = 7) => new THREE.CylinderGeometry(r0, r1, h, s);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const merge = (...parts) => mergeGeometries(parts);

// A humpback's fluke: two swept-back lobes with a notch, dark above and pale below. Laid flat,
// trailing back from the tail stock at the origin.
function fluke(span) {
  const half = [[0.6, 0.05], [1.4, 0.32], [2.2, 0.92], [1.75, 1.02], [1.2, 0.94], [0.6, 1.06], [0.16, 1.05]];
  const sh = new THREE.Shape(); sh.moveTo(0, -0.1);
  for (const [x, y] of half) sh.lineTo(x * span / 4.4, y);
  sh.lineTo(0, 0.82);
  for (const [x, y] of [...half].reverse()) sh.lineTo(-x * span / 4.4, y);
  sh.closePath();
  const geo = (d) => { const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false }); g.rotateX(-Math.PI / 2); return g; };
  return [piece(geo(0.07), 0x2b3036, [0, 0.0, 0]), piece(geo(0.05), 0xd9dcdc, [0, -0.07, 0])];
}

// Legs hang from the hip: the origin is at the top.
const legGeo = (r, color) => piece(cyl(r, r * 0.8, 1, 6), color, [0, -0.5, 0]);

const SHAPES = {
  sheep: () => merge(
    piece(ball(), 0xf2efe6, [0, 0.74, 0], [0.43, 0.41, 0.63]),
    piece(ball(), 0xf2efe6, [0.16, 0.98, 0.2], [0.2, 0.16, 0.22]), piece(ball(), 0xf2efe6, [-0.16, 0.98, -0.18], [0.2, 0.16, 0.22]),
    piece(ball(), 0x2d2723, [0, 0.9, 0.66], [0.14, 0.16, 0.22]),
    piece(box(0.17, 0.04, 0.07), 0x2d2723, [0, 0.97, 0.6]),
    piece(ball(), 0xf2efe6, [0, 0.8, -0.63], [0.08, 0.08, 0.08])),
  horse: () => merge(
    piece(ball(), 0xffffff, [0, 1.05, 0], [0.42, 0.46, 0.86]),
    piece(ball(), 0xffffff, [0, 1.08, 0.52], [0.38, 0.42, 0.4]),
    // Arched neck, head angled down, a dark muzzle, ears, and a thick mane down the neck.
    piece(cyl(0.15, 0.25, 0.82), 0xffffff, [0, 1.44, 0.8], [1, 1, 1], [0.55, 0, 0]),
    piece(ball(), 0xffffff, [0, 1.74, 1.08], [0.13, 0.14, 0.2]),
    piece(box(0.19, 0.2, 0.46), 0xffffff, [0, 1.62, 1.2], [1, 1, 1], [1.0, 0, 0]),
    piece(ball(), 0x3a2e27, [0, 1.46, 1.32], [0.1, 0.1, 0.12]),
    piece(cone(0.04, 0.12, 5), 0xffffff, [0.06, 1.9, 1.02]), piece(cone(0.04, 0.12, 5), 0xffffff, [-0.06, 1.9, 1.02]),
    piece(box(0.08, 0.8, 0.15), 0x2a201a, [0, 1.53, 0.67], [1, 1, 1], [0.55, 0, 0]),
    piece(cyl(0.05, 0.13, 0.78), 0x2a201a, [0, 0.82, -0.92], [1, 1, 1], [-0.35, 0, 0])),
  reindeer: () => merge(
    piece(ball(), 0x6e6253, [0, 1.04, 0], [0.38, 0.43, 0.78]),
    piece(cyl(0.15, 0.24, 0.55), 0xd8d2c4, [0, 1.3, 0.62], [1, 1, 1], [0.9, 0, 0]),
    piece(box(0.18, 0.2, 0.44), 0x584d41, [0, 1.52, 0.9], [1, 1, 1], [0.5, 0, 0]),
    piece(ball(), 0xe2ddd0, [0, 1.0, -0.66], [0.24, 0.26, 0.16]),
    ...[-1, 1].flatMap((s) => [
      piece(cyl(0.022, 0.035, 0.75), 0xb6a487, [s * 0.14, 1.95, 0.8], [1, 1, 1], [-0.35, 0, -s * 0.45]),
      piece(cyl(0.018, 0.026, 0.35), 0xb6a487, [s * 0.26, 2.12, 0.95], [1, 1, 1], [0.6, 0, -s * 0.2]),
      piece(cyl(0.018, 0.026, 0.3), 0xb6a487, [s * 0.32, 2.25, 0.72], [1, 1, 1], [-0.7, 0, -s * 0.6]),
    ])),
  fox: () => merge(
    piece(ball(), 0xffffff, [0, 0.33, 0], [0.17, 0.18, 0.36]),
    piece(ball(), 0xffffff, [0, 0.43, 0.38], [0.13, 0.12, 0.15]),
    piece(cone(0.055, 0.15), 0xffffff, [0, 0.41, 0.55], [1, 1, 1], [Math.PI / 2, 0, 0]),
    piece(cone(0.05, 0.11), 0xffffff, [0.07, 0.56, 0.35]), piece(cone(0.05, 0.11), 0xffffff, [-0.07, 0.56, 0.35]),
    piece(ball(), 0xffffff, [0, 0.3, -0.45], [0.1, 0.1, 0.3], [0.3, 0, 0])),
  // A harbour seal lying on the shore: a long mottled body, a rounded head with a dark muzzle,
  // fore flippers at its sides and the hind flippers held together behind.
  seal: () => merge(
    piece(ball(), 0x46494b, [0, 0.24, 0], [0.31, 0.24, 0.92]),
    piece(ball(), 0x6a6c6b, [0, 0.14, 0.05], [0.27, 0.13, 0.8]),
    piece(ball(), 0x3f4244, [0, 0.33, 0.86], [0.15, 0.14, 0.18]),
    piece(ball(), 0x34383a, [0, 0.3, 1.0], [0.07, 0.06, 0.07]),
    piece(ball(), 0x26292b, [0.15, 0.36, 0.25], [0.07, 0.03, 0.09]), piece(ball(), 0x26292b, [-0.12, 0.37, -0.25], [0.08, 0.03, 0.1]), piece(ball(), 0x26292b, [0.05, 0.38, -0.5], [0.05, 0.03, 0.06]),
    piece(ball(), 0x383b3d, [0.3, 0.08, 0.38], [0.05, 0.03, 0.16], [0, -0.5, 0]), piece(ball(), 0x383b3d, [-0.3, 0.08, 0.38], [0.05, 0.03, 0.16], [0, 0.5, 0]),
    piece(ball(), 0x323537, [0.08, 0.18, -1.0], [0.06, 0.04, 0.22], [0, 0.2, 0]), piece(ball(), 0x323537, [-0.08, 0.18, -1.0], [0.06, 0.04, 0.22], [0, -0.2, 0])),
  puffin: () => merge(
    piece(ball(), 0x15171a, [0, 0, 0], [0.12, 0.13, 0.19]),
    piece(ball(), 0xf2f2ee, [0, -0.02, 0.08], [0.09, 0.1, 0.12]),
    piece(cone(0.05, 0.1, 6), 0xe8642a, [0, 0.03, 0.24], [1, 0.8, 1], [Math.PI / 2, 0, 0]),
    piece(box(0.46, 0.02, 0.11), 0x15171a, [0, 0.04, 0])),
  humpback: () => merge(
    piece(ball(), 0x2b3036, [0, 0, 0], [1.35, 1.25, 6.2]),
    piece(ball(), 0x3a4048, [0, 0.35, 4.2], [1.15, 0.6, 2.0]),
    piece(box(3.6, 0.16, 0.85), 0xd5d9da, [1.9, -0.55, 2.4], [1, 1, 1], [0, 0.45, -0.35]),
    piece(box(3.6, 0.16, 0.85), 0xd5d9da, [-1.9, -0.55, 2.4], [1, 1, 1], [0, -0.45, 0.35]),
    piece(cone(0.35, 0.6, 6), 0x2b3036, [0, 1.25, -2.4]),
    piece(cyl(0.72, 0.28, 1.8, 8), 0x2b3036, [0, 0, -6.0], [1, 1, 0.7], [Math.PI / 2, 0, 0]),
    ...fluke(4.4).map((g) => g.translate(0, 0, -6.9))),
  orca: () => merge(
    piece(ball(), 0x101215, [0, 0, 0], [0.92, 1.0, 3.5]),
    piece(ball(), 0xf0f0ec, [0, -0.45, 0.6], [0.62, 0.45, 2.3]),
    piece(ball(), 0xf0f0ec, [0.55, 0.38, 2.1], [0.22, 0.14, 0.42]), piece(ball(), 0xf0f0ec, [-0.55, 0.38, 2.1], [0.22, 0.14, 0.42]),
    piece(box(0.14, 1.7, 0.75), 0x101215, [0, 1.65, -0.1], [1, 1, 1], [-0.22, 0, 0]),
    piece(box(2.1, 0.1, 0.65), 0x101215, [0, 0, -3.6])),
  dolphin: () => merge(
    piece(ball(), 0x3b4046, [0, 0, 0], [0.32, 0.36, 1.35]),
    piece(ball(), 0xcfd4d6, [0, -0.04, -0.25], [0.31, 0.25, 0.62]),
    piece(cone(0.1, 0.32, 7), 0x3b4046, [0, -0.05, 1.45], [1, 1, 1], [Math.PI / 2, 0, 0]),
    piece(box(0.06, 0.42, 0.32), 0x2e3236, [0, 0.42, -0.1], [1, 1, 1], [-0.35, 0, 0]),
    piece(box(0.72, 0.05, 0.26), 0x2e3236, [0, 0, -1.4])),
};

// Herd animals: size, legs, habits. flee: how close a car or a walker gets before they move off.
const HERD = {
  sheep: { cap: 140, leg: [0.045, 0x2d2723], hip: 0.52, legs: [[0.19, 0.33], [-0.19, 0.33], [0.19, -0.33], [-0.19, -0.33]], walk: 0.8, run: 3.2, flee: 14, graze: 0.14, colors: [0xf4f1e8, 0xf4f1e8, 0xf4f1e8, 0xe9e2d2, 0x8a6a4e, 0x3a312b] },
  horse: { cap: 60, leg: [0.07, 0x2a201a], hip: 0.86, legs: [[0.22, 0.6], [-0.22, 0.6], [0.22, -0.55], [-0.22, -0.55]], walk: 1.1, run: 5, flee: 9, graze: 0.2, colors: [0x8a4b2a, 0x5b3a26, 0xb9b6b0, 0x2b2420, 0xd2ae78, 0xe6e1d8, 0x6e4a33] },
  reindeer: { cap: 60, leg: [0.05, 0x4a4035], hip: 0.86, legs: [[0.19, 0.55], [-0.19, 0.55], [0.19, -0.5], [-0.19, -0.5]], walk: 1.0, run: 7, flee: 38, graze: 0.18, colors: [0xffffff] },
  fox: { cap: 14, leg: [0.03, 0x3a3430], hip: 0.25, legs: [[0.08, 0.2], [-0.08, 0.2], [0.08, -0.2], [-0.08, -0.2]], walk: 1.4, run: 6, flee: 26, graze: 0.08, colors: [0xefefea] },
  seal: { cap: 30, leg: null, hip: 0, legs: [], walk: 0.5, run: 1.6, flee: 22, graze: 0, colors: [0xffffff, 0xd8cdbd, 0xaeb0ae] },
};

const EAST_X = toWorld(65, -15.8).x; // reindeer live east of about here
const CELL = 220;

export class Wildlife {
  constructor(scene, { low = false } = {}) {
    this.scene = scene;
    this.low = low;
    this.cells = new Map();
    this.animals = [];
    this.time = 0;
    this.seen = new Set();
    this.events = [];
    this.manageClock = 0;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    // Instanced herd meshes: a body and a leg per species.
    this.herd = {};
    for (const [sp, H] of Object.entries(HERD)) {
      const cap = Math.round(H.cap * (low ? 0.5 : 1));
      const body = new THREE.InstancedMesh(SHAPES[sp](), mat, cap);
      body.castShadow = true; body.frustumCulled = false; body.count = 0;
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      scene.add(body);
      let legs = null;
      if (H.leg) {
        legs = new THREE.InstancedMesh(legGeo(...H.leg), mat, cap * 4);
        legs.castShadow = true; legs.frustumCulled = false; legs.count = 0;
        scene.add(legs);
      }
      this.herd[sp] = { body, legs, cap, list: [] };
    }
    // Fox eyes: two glints each, lit when the headlights fall on them. Drawn as points of a fixed
    // size on screen, so they show as bright pinpoints from far down the road, as eyeshine does.
    {
      const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d');
      const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(28 * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(28 * 3), 3));
      this.eyes = new THREE.Points(geo, new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, vertexColors: true, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      this.eyes.frustumCulled = false;
      scene.add(this.eyes);
    }
    // Puffins: one instanced flock.
    this.puffins = new THREE.InstancedMesh(SHAPES.puffin(), mat, 40);
    this.puffins.frustumCulled = false; this.puffins.count = 0;
    scene.add(this.puffins);
    // Over the sea cliffs of the Dyrhólaey headland, where its arch stands (south of the landmark).
    { const d = toWorld(63.392, -19.13); this.puffinSpot = { x: d.x - 12, z: d.z + 70 }; }
    // Sea animals: a few single meshes each.
    this.whales = [];
    this.dolphins = [];
    const dGeo = SHAPES.dolphin();
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(dGeo, mat); m.visible = false; m.castShadow = true; scene.add(m); this.dolphins.push({ mesh: m, phase: i * 1.7, active: false, off: [[-2.2, 4], [2.2, 5.5], [-1.2, 8], [1.4, 10.5]][i], lx: 0, lz: 0, leap: 0 }); }
    this.dolphinPod = { on: false, slow: 0, cooldown: 0 };
    this.whaleGeo = { humpback: SHAPES.humpback(), orca: SHAPES.orca() };
    this.mat = mat;
    this.seals = [];
    this.blow = this.makeBlow();
  }

  // Spouts: a short column of spray when a whale breathes out.
  makeBlow() {
    const n = 240, pos = new Float32Array(n * 3).fill(-9999), vel = new Float32Array(n * 3), life = new Float32Array(n);
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.4, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.55, depthWrite: false, color: 0xeef3f5 }));
    pts.frustumCulled = false; this.scene.add(pts);
    return { pts, pos, vel, life, n, next: 0 };
  }
  spout(x, y, z, big) {
    const B = this.blow;
    for (let k = 0; k < (big ? 70 : 30); k++) {
      const i = B.next; B.next = (B.next + 1) % B.n;
      B.pos.set([x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5], i * 3);
      B.vel.set([(Math.random() - 0.5) * 1.6, (big ? 7 : 4) + Math.random() * 3, (Math.random() - 0.5) * 1.6], i * 3);
      B.life[i] = 1.6 + Math.random();
    }
  }

  // ---------- Habitat ----------
  // A spot that suits a land animal: dry, gently sloping, not in water, off the road.
  landOK(x, z, roadMin) {
    const h = heightAt(x, z);
    if (h < waterLevelAt(x, z) + 0.4 || shoreDistAt(x, z) < 12) return false;
    if (roadDistAt(x, z) < roadMin) return false;
    const sl = Math.abs(heightAt(x + 3, z) - h) + Math.abs(heightAt(x, z + 3) - h);
    return sl < 1.4;
  }

  // What lives in cell (i, j) this month: decided from a seed, so it is the same each visit.
  fill(i, j, month) {
    const r = mulberry32((i * 73856093) ^ (j * 19349663) ^ 0x51f15e);
    const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
    const out = [];
    const summer = month >= 4 && month <= 9, winter = month >= 10 || month <= 3;
    const tryHerd = (sp, chance, nMin, nMax, roadMin, roadMax) => {
      if (r() > chance) return;
      for (let t = 0; t < 10; t++) {
        const x = cx + (r() - 0.5) * CELL, z = cz + (r() - 0.5) * CELL, rd = roadDistAt(x, z);
        if (rd > roadMax || !this.landOK(x, z, roadMin)) continue;
        const n = nMin + Math.floor(r() * (nMax - nMin + 1)), H = HERD[sp];
        for (let k = 0; k < n; k++) {
          for (let u = 0; u < 6; u++) {
            const ax = x + (r() - 0.5) * 26, az = z + (r() - 0.5) * 26;
            if (!this.landOK(ax, az, roadMin * 0.5)) continue;
            out.push({ sp, x: ax, z: az, hx: ax, hz: az, heading: r() * Math.PI * 2, state: 'graze', timer: r() * 6, color: H.colors[Math.floor(r() * H.colors.length)], step: r() * 10, roam: sp === 'sheep' ? 18 : 12 });
            break;
          }
        }
        return;
      }
    };
    if (summer) tryHerd('sheep', 0.5, 3, 7, 4, 140);
    else tryHerd('sheep', 0.12, 3, 5, 10, 90); // most are in for the winter, a few stay out
    tryHerd('horse', 0.22, 3, 6, 14, 160);
    if (cx > EAST_X) tryHerd('reindeer', winter ? 0.45 : 0.3, 4, 9, 20, 400);
    if (r() < 0.12) {
      const before = out.length;
      tryHerd('fox', 1, 1, 1, 8, 220);
      for (let k = before; k < out.length; k++) out[k].color = winter ? 0xf0f0ec : (r() < 0.7 ? 0x6e5641 : 0x4a4a50);
    }
    return out;
  }

  // Seals hauled out where they really are, on a strip of shore just above the water.
  sealSpots() {
    if (this.sealList) return this.sealList;
    const anchors = [[64.076, -16.215, 6], [64.024, -16.175, 5], [64.80, -23.08, 6]];
    const list = [];
    anchors.forEach(([lat, lon, n], a) => {
      const c = toWorld(lat, lon), r = mulberry32(900 + a);
      let placed = 0;
      for (let t = 0; t < 400 && placed < n; t++) {
        const x = c.x + (r() - 0.5) * 160, z = c.z + (r() - 0.5) * 160;
        const s = shoreDistAt(x, z), h = heightAt(x, z), wl = waterLevelAt(x, z);
        if (s < 1.5 || s > 6 || h < wl + 0.15 || h > wl + 2.5) continue;
        list.push({ sp: 'seal', x, z, hx: x, hz: z, heading: r() * Math.PI * 2, state: 'rest', timer: r() * 10, color: HERD.seal.colors[Math.floor(r() * 3)], step: r() * 10, inWater: false, away: 0 });
        placed++;
      }
    });
    return (this.sealList = list);
  }

  // Whale grounds: a spot of deep water near each anchor, found once.
  whaleGround(lat, lon) {
    const c = toWorld(lat, lon);
    for (let rad = 0; rad < 900; rad += 30) for (let a = 0; a < 12; a++) {
      const x = c.x + Math.cos(a * 0.52) * rad, z = c.z + Math.sin(a * 0.52) * rad;
      if (shoreDistAt(x, z) < -140 && waterLevelAt(x, z) - heightAt(x, z) > 6) return { x, z };
    }
    return null;
  }

  ensureWhales(month) {
    const key = month >= 3 && month <= 9 ? 'summer' : 'winter';
    if (this.whaleSeason === key) return;
    this.whaleSeason = key;
    for (const w of this.whales) this.scene.remove(w.mesh);
    this.whales = [];
    const add = (sp, ground, n) => {
      if (!ground) return;
      for (let i = 0; i < n; i++) {
        const mesh = new THREE.Mesh(this.whaleGeo[sp], this.mat); mesh.visible = false; mesh.castShadow = true; this.scene.add(mesh);
        this.whales.push({ sp, mesh, g: ground, ang: i * 2.1, rad: (sp === 'orca' ? 45 : 80) + i * 18, cycle: (sp === 'orca' ? 26 : 50) + i * 7, t: i * 13, blew: false });
      }
    };
    // Humpbacks feed in Skjálfandi Bay off Húsavík from April to October; in winter orcas follow
    // the herring into the fjords on the north side of Snæfellsnes.
    if (key === 'summer') add('humpback', this.whaleGround(66.09, -17.52), 2);
    else add('orca', this.whaleGround(64.99, -23.26), 4);
  }

  // ---------- Update ----------
  // ctx: { pos, car, camera, clock, dark }
  update(dt, ctx) {
    this.time += dt;
    const { pos, car, clock } = ctx;
    const month = clock.month;
    this.manageClock -= dt;
    if (this.manageClock <= 0) { this.manage(pos, month); this.manageClock = 1; }
    this.ensureWhales(month);
    const threat = { x: pos.x, z: pos.z, moving: car ? Math.abs(car.vF) > 1 || ctx.walking : true };
    for (const a of this.animals) this.behave(a, dt, threat);
    for (const s of this.sealSpots()) if (Math.abs(s.x - pos.x) < 700 && Math.abs(s.z - pos.z) < 700) this.behaveSeal(s, dt, threat);
    this.draw(ctx);
    this.sea(dt, ctx);
    this.birds(dt, ctx);
    this.stepBlow(dt);
    const ev = this.events; this.events = [];
    return ev;
  }

  // Keep the cells near the player populated; forget the far ones.
  manage(pos, month) {
    const ci = Math.floor(pos.x / CELL), cj = Math.floor(pos.z / CELL), R = this.low ? 1 : 2;
    const keep = new Set();
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
      const k = `${i},${j},${month}`; keep.add(k);
      if (!this.cells.has(k)) this.cells.set(k, this.fill(i, j, month));
    }
    for (const k of this.cells.keys()) if (!keep.has(k)) this.cells.delete(k);
    this.animals = [...this.cells.values()].flat();
  }

  behave(a, dt, threat) {
    const H = HERD[a.sp];
    const dx = a.x - threat.x, dz = a.z - threat.z, d = Math.hypot(dx, dz);
    if (d < H.flee && threat.moving && a.state !== 'flee') {
      // Move off, away from whatever is coming, to somewhere they can stand.
      let ang = Math.atan2(dx, dz);
      for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
        const tx = a.x + Math.sin(ang + off) * (H.flee + 12), tz = a.z + Math.cos(ang + off) * (H.flee + 12);
        if (this.landOK(tx, tz, 0)) { a.tx = tx; a.tz = tz; a.state = 'flee'; break; }
      }
    }
    a.timer -= dt;
    if (a.state === 'graze' && a.timer <= 0) {
      // Wander a few steps now and then, never far from home.
      const ang = Math.random() * Math.PI * 2, r = 3 + Math.random() * a.roam;
      const tx = a.hx + Math.sin(ang) * r, tz = a.hz + Math.cos(ang) * r;
      if (this.landOK(tx, tz, a.sp === 'sheep' ? 0 : 4)) { a.tx = tx; a.tz = tz; a.state = 'walk'; }
      a.timer = 4 + Math.random() * 10;
    }
    a.moving = false;
    if (a.state === 'walk' || a.state === 'flee') {
      const sp = a.state === 'flee' ? H.run : H.walk, ex = a.tx - a.x, ez = a.tz - a.z, e = Math.hypot(ex, ez);
      if (e < 0.4) {
        // After running off they settle where they stopped.
        if (a.state === 'flee') { a.hx = a.x; a.hz = a.z; }
        a.state = 'graze'; a.timer = 3 + Math.random() * 8;
      }
      else {
        const want = Math.atan2(ex, ez); let t = want - a.heading; t = Math.atan2(Math.sin(t), Math.cos(t));
        a.heading += clamp(t, -dt * 3, dt * 3);
        const step = Math.min(e, sp * dt * Math.max(0.2, Math.cos(t)));
        a.x += Math.sin(a.heading) * step; a.z += Math.cos(a.heading) * step;
        a.step += step * (a.sp === 'horse' || a.sp === 'reindeer' ? 2.4 : 3.6);
        a.moving = true;
      }
    }
    a.y = heightAt(a.x, a.z);
  }

  behaveSeal(s, dt, threat) {
    const d = Math.hypot(s.x - threat.x, s.z - threat.z);
    if (!s.inWater && d < HERD.seal.flee && threat.moving) s.state = 'flee';
    if (s.state === 'flee') {
      // Shuffle down into the water: toward the nearest shore.
      const e = 2, gx = shoreDistAt(s.x + e, s.z) - shoreDistAt(s.x - e, s.z), gz = shoreDistAt(s.x, s.z + e) - shoreDistAt(s.x, s.z - e);
      const L = Math.hypot(gx, gz) || 1;
      s.heading = Math.atan2(-gx / L, -gz / L);
      s.x -= (gx / L) * HERD.seal.run * dt; s.z -= (gz / L) * HERD.seal.run * dt;
      s.step += dt * 6;
      if (waterLevelAt(s.x, s.z) - heightAt(s.x, s.z) > 0.6) { s.inWater = true; s.state = 'swim'; s.away = 0; }
    } else if (s.state === 'swim') {
      // Bob offshore until it is quiet again, then haul back out.
      s.away += dt;
      if (s.away > 25 && d > 70) { s.x = s.hx; s.z = s.hz; s.inWater = false; s.state = 'rest'; }
    }
    const wl = waterLevelAt(s.x, s.z);
    s.y = s.inWater ? wl - 0.32 + Math.max(0, Math.sin(this.time * 0.7 + s.step)) * 0.12 : Math.max(heightAt(s.x, s.z), wl);
  }

  draw(ctx) {
    const { pos, car, dark } = ctx;
    for (const H of Object.values(this.herd)) H.list.length = 0;
    for (const a of this.animals) {
      const dd = Math.hypot(a.x - pos.x, a.z - pos.z);
      if (dd < 420) this.herd[a.sp].list.push(a);
    }
    for (const s of this.sealSpots()) if (Math.hypot(s.x - pos.x, s.z - pos.z) < 420) this.herd.seal.list.push(s);
    let eye = 0;
    // Headlights: the car's facing and whether its lights are on.
    const hx = car ? Math.sin(car.heading) : 0, hz = car ? Math.cos(car.heading) : 1;
    for (const [sp, G] of Object.entries(this.herd)) {
      const H = HERD[sp], n = Math.min(G.list.length, G.cap);
      G.body.count = n; if (G.legs) G.legs.count = n * 4;
      for (let k = 0; k < n; k++) {
        const a = G.list[k];
        const grazing = a.state === 'graze' && sp !== 'seal' ? H.graze * (0.6 + 0.4 * Math.sin(this.time * 0.6 + a.step)) : 0;
        const bob = a.moving ? Math.abs(Math.sin(a.step)) * 0.04 : 0;
        // A seal in the water shows only its head; on land it lies along the shore, lifting its head.
        const sealLift = sp === 'seal' && !a.inWater ? -0.08 + Math.max(0, Math.sin(this.time * 0.35 + a.step)) * 0.18 : 0;
        E.set(grazing - sealLift, a.heading, 0);
        Q.setFromEuler(E); P.set(a.x, a.y + bob, a.z); S.set(1, 1, 1);
        if (sp === 'seal' && a.inWater) S.set(0.7, 0.7, 0.7);
        M4.compose(P, Q, S); G.body.setMatrixAt(k, M4);
        C.set(a.color); G.body.setColorAt(k, C);
        if (G.legs) {
          H.legs.forEach(([lx, lz], li) => {
            const swing = a.moving ? Math.sin(a.step + (li === 0 || li === 3 ? 0 : Math.PI)) * (a.state === 'flee' ? 0.5 : 0.32) : 0;
            const ch = Math.cos(a.heading), sh = Math.sin(a.heading);
            P.set(a.x + lx * ch + lz * sh, a.y + bob + H.hip, a.z - lx * sh + lz * ch);
            E.set(swing, a.heading, 0); Q.setFromEuler(E); S.set(1, H.hip, 1);
            M4.compose(P, Q, S); G.legs.setMatrixAt(k * 4 + li, M4);
          });
        }
        // Eyeshine: a fox caught in the headlights looks back with two bright green-gold eyes.
        if (sp === 'fox' && eye < 26) {
          const fx = a.x - pos.x, fz = a.z - pos.z, fd = Math.hypot(fx, fz) || 1;
          const inBeam = car ? clamp(((fx * hx + fz * hz) / fd - 0.85) / 0.12, 0, 1) * (1 - clamp((fd - 25) / 60, 0, 1)) : 0;
          const look = Math.max(0, Math.cos(Math.atan2(-fx, -fz) - a.heading));
          const glow = Math.min(1.5, inBeam * look * dark * 3);
          const ch = Math.cos(a.heading), sh = Math.sin(a.heading);
          const ep = this.eyes.geometry.attributes.position, ec = this.eyes.geometry.attributes.color;
          for (const s of [-1, 1]) {
            ep.setXYZ(eye, a.x + s * 0.05 * ch + 0.57 * sh, a.y + 0.46, a.z - s * 0.05 * sh + 0.57 * ch);
            ec.setXYZ(eye, 0.55 * glow, 1.1 * glow, 0.3 * glow); eye++;
          }
        }
        this.noticed(sp, a.x, a.y + 0.6, a.z, ctx, 90);
      }
      G.body.instanceMatrix.needsUpdate = true; if (G.body.instanceColor) G.body.instanceColor.needsUpdate = true;
      if (G.legs) G.legs.instanceMatrix.needsUpdate = true;
    }
    const eg = this.eyes.geometry;
    eg.setDrawRange(0, eye);
    eg.attributes.position.needsUpdate = eg.attributes.color.needsUpdate = true;
  }

  // Report a species the first time the player can see it up close.
  noticed(sp, x, y, z, ctx, range) {
    if (this.seen.has(sp)) return;
    const { pos, camera } = ctx;
    if (Math.hypot(x - pos.x, z - pos.z) > range) return;
    V.set(x, y, z).project(camera);
    if (V.z < 1 && Math.abs(V.x) < 0.85 && Math.abs(V.y) < 0.85) { this.seen.add(sp); this.events.push(sp); }
  }

  sea(dt, ctx) {
    const { pos, car } = ctx;
    // Whales swim slow loops round their ground, under water most of the time, and every cycle
    // come up: a blow, the long dark back rolling over, and (humpbacks) the tail lifting to dive.
    for (const w of this.whales) {
      const far = Math.hypot(w.g.x - pos.x, w.g.z - pos.z) > 1500;
      w.t += dt;
      w.ang += dt * (w.sp === 'orca' ? 0.06 : 0.03);
      const x = w.g.x + Math.cos(w.ang) * w.rad, z = w.g.z + Math.sin(w.ang) * w.rad;
      const heading = Math.atan2(-Math.sin(w.ang), Math.cos(w.ang)); // along the loop
      const wl = waterLevelAt(x, z), u = (w.t % w.cycle) / w.cycle, surf = 0.22; // the last 22% of each cycle is at the surface
      if (far || u < 1 - surf) { w.mesh.visible = false; w.blew = false; continue; }
      const s = (u - (1 - surf)) / surf; // 0..1 through the surfacing
      if (!w.blew && s > 0.08) { w.blew = true; this.spout(x + Math.sin(heading) * (w.sp === 'orca' ? 2.6 : 4.5), wl + 0.5, z + Math.cos(heading) * (w.sp === 'orca' ? 2.6 : 4.5), w.sp === 'humpback'); }
      const len = w.sp === 'orca' ? 3.5 : 6.2;
      // Rise and roll forward over a low arc. A humpback then tips down and sinks as it dives, so
      // only the tail stock and the fluke lift clear of the water, nearly upright.
      let pitch, y;
      if (w.sp === 'humpback') {
        pitch = s < 0.55 ? lerp(-0.12, 0.25, s / 0.55) : lerp(0.25, 1.4, (s - 0.55) / 0.45);
        y = wl - 1.1 + Math.sin(Math.PI * Math.min(1, s * 1.6)) * 1.0 - Math.max(0, s - 0.55) * 9;
      } else {
        pitch = lerp(-0.18, 0.35, s);
        y = wl - 1.1 + Math.sin(Math.PI * Math.min(1, s * 1.15)) * 1.05 - Math.max(0, s - 0.7) * 3;
      }
      w.mesh.visible = true;
      w.mesh.position.set(x - Math.sin(heading) * len * 0.2 * s, y, z - Math.cos(heading) * len * 0.2 * s);
      w.mesh.rotation.set(pitch, heading, 0, 'YXZ');
      this.noticed(w.sp, x, wl + 1, z, ctx, 450);
    }
    // Dolphins: a pod joins a boat out at sea once it is going properly, rides the bow wave,
    // porpoising and now and then leaping, and drifts off when the boat slows or nears land.
    const P2 = this.dolphinPod;
    P2.cooldown -= dt;
    const afloat = car && car.boatOn && car.boat > 0.9, sp = car ? car.vF : 0;
    const offshore = car ? -shoreDistAt(car.pos.x, car.pos.z) : 0;
    if (!P2.on && afloat && sp > 7 && offshore > 30 && P2.cooldown <= 0) {
      P2.on = true; P2.slow = 0;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      for (const d of this.dolphins) { d.active = true; d.lx = car.pos.x - fx * 25 + (Math.random() - 0.5) * 10; d.lz = car.pos.z - fz * 25; d.leap = 0; }
    }
    if (P2.on) {
      P2.slow = (!afloat || sp < 4 || offshore < 15) ? P2.slow + dt : 0;
      if (P2.slow > 4) { P2.on = false; P2.cooldown = 40; }
    }
    for (const d of this.dolphins) {
      if (!d.active) { d.mesh.visible = false; continue; }
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = fz, rz = -fx;
      let tx = car.pos.x + rx * d.off[0] + fx * d.off[1], tz = car.pos.z + rz * d.off[0] + fz * d.off[1];
      if (!P2.on) { tx = d.lx + fx * 60 + rx * d.off[0] * 8; tz = d.lz + fz * 60 + rz * d.off[0] * 8; }
      const k = Math.min(1, dt * (P2.on ? 1.2 : 0.3));
      const px = d.lx, pz = d.lz;
      // Riding the bow they keep pace with the boat and only ease into their place beside it.
      if (P2.on) { d.lx += (fx * car.vF + rx * car.vL) * dt; d.lz += (fz * car.vF + rz * car.vL) * dt; }
      d.lx += (tx - d.lx) * k; d.lz += (tz - d.lz) * k;
      const v = Math.hypot(d.lx - px, d.lz - pz) / Math.max(dt, 1e-3);
      d.phase += dt * (2.2 + v * 0.08);
      if (d.leap <= 0 && Math.random() < dt * 0.06) d.leap = 1;
      d.leap = Math.max(0, d.leap - dt * 0.8);
      const wl = waterLevelAt(d.lx, d.lz), arc = Math.sin(d.phase), amp = 0.75 + (d.leap > 0 ? 1.4 * Math.sin(Math.PI * d.leap) : 0);
      const y = wl - 0.55 + Math.max(-0.3, arc) * amp;
      d.mesh.visible = y > wl - 1.2;
      d.mesh.position.set(d.lx, y, d.lz);
      d.mesh.rotation.set(-Math.cos(d.phase) * 0.55, car.heading, 0, 'YXZ');
      if (!P2.on && Math.hypot(d.lx - car.pos.x, d.lz - car.pos.z) > 120) d.active = false;
      if (d.mesh.visible) this.noticed('dolphin', d.lx, y, d.lz, ctx, 60);
    }
  }

  // Puffins nest on the cliffs at Dyrhólaey from May to August: a flock wheels off the edge.
  birds(dt, ctx) {
    const { pos, clock } = ctx, m = clock.month, spot = this.puffinSpot;
    const near = Math.hypot(spot.x - pos.x, spot.z - pos.z) < 600;
    if (!(m >= 4 && m <= 7) || !near) { this.puffins.count = 0; return; }
    const n = this.low ? 18 : 36, base = Math.max(heightAt(spot.x, spot.z), 0) + 14; // about the clifftop
    this.puffins.count = n;
    for (let i = 0; i < n; i++) {
      const r = 18 + (i % 6) * 6, sp = 0.35 + (i % 5) * 0.06, a = this.time * sp + i * 2.4;
      const x = spot.x + Math.cos(a) * r, z = spot.z + Math.sin(a) * r * 0.7, y = base + 6 + Math.sin(a * 2 + i) * 3 + (i % 4) * 2;
      const flap = 0.55 + 0.45 * Math.abs(Math.sin(this.time * 18 + i));
      E.set(0, Math.atan2(-Math.sin(a), Math.cos(a) * 0.7), Math.sin(a) * 0.3); Q.setFromEuler(E);
      P.set(x, y, z); S.set(0.7 * flap + 0.4, 1.1, 1.1);
      M4.compose(P, Q, S); this.puffins.setMatrixAt(i, M4);
    }
    this.puffins.instanceMatrix.needsUpdate = true;
    this.noticed('puffin', spot.x, base + 8, spot.z, ctx, 160);
  }

  stepBlow(dt) {
    const B = this.blow; let any = false;
    for (let i = 0; i < B.n; i++) {
      if (B.life[i] <= 0) continue;
      any = true; B.life[i] -= dt;
      B.vel[i * 3 + 1] -= 4 * dt;
      for (let k = 0; k < 3; k++) { B.vel[i * 3 + k] *= 1 - dt * 0.8; B.pos[i * 3 + k] += B.vel[i * 3 + k] * dt; }
      if (B.life[i] <= 0) B.pos[i * 3 + 1] = -9999;
    }
    if (any) B.pts.geometry.attributes.position.needsUpdate = true;
  }
}

// What the player is told the first time they see each one.
export const WILDLIFE_NOTES = {
  sheep: 'Sheep. Iceland has around 400,000, and they roam free in the hills all summer.',
  horse: 'Icelandic horses: small, tough, and kept a pure breed for a thousand years.',
  reindeer: 'Reindeer. They live wild only here in the east, brought over from Norway in the 1700s.',
  fox: 'An arctic fox, Iceland’s only native land mammal. White in winter, brown in summer.',
  seal: 'Seals, hauled out on the shore. Get too close and they slip back into the water.',
  humpback: 'A humpback whale. They feed in Skjálfandi Bay from spring to autumn.',
  orca: 'Orcas! In winter they follow the herring into the fjords of Snæfellsnes.',
  dolphin: 'White-beaked dolphins, riding your bow wave.',
  puffin: 'Puffins. They nest on these cliffs from May to August.',
};
