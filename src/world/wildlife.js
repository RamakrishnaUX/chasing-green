import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, waterLevelAt, roadDistAt, shoreDistAt } from './terrain.js';
import { toWorld } from './geo.js';
import { mulberry32, clamp, lerp } from './noise.js';
import * as Models from './animalModels.js';

// Wildlife, each where and when it really lives. On land: sheep roaming free in summer and
// autumn, Icelandic horses, reindeer only in the east, an arctic fox whose eyes catch the
// headlights. On the shore: seals at Jökulsárlón, Diamond Beach and Ytri Tunga, and puffins on
// Dyrhólaey's cliffs in summer. At sea: humpbacks in Skjálfandi Bay from spring to autumn, orcas
// off Snæfellsnes in winter, and white-beaked dolphins that come to ride a boat's bow wave.
//
// Land animals are spawned in cells around the player from a seed, so the same flock is in the
// same field when you come back. The models (animalModels.js) are rigged in parts: a torso, a
// head on its neck pivot (it lowers to graze and turns to watch you), and legs in two jointed
// segments walking a four-beat gait. Each part is one instanced mesh per species, with coat and
// hair colours per animal, and fur shells on the nearest few.

const M4 = new THREE.Matrix4(), MB = new THREE.Matrix4(), MH = new THREE.Matrix4(), ML = new THREE.Matrix4(), MT = new THREE.Matrix4();
const Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color(), V = new THREE.Vector3();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

// Puffins stay simple: on the cliffs they are specks against the sky.
function piece(geo, color, at = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)));
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const puffinShape = () => mergeGeometries([
  piece(new THREE.SphereGeometry(1, 12, 9), 0x15171a, [0, 0, 0], [0.12, 0.13, 0.19]),
  piece(new THREE.SphereGeometry(1, 12, 9), 0xf2f2ee, [0, -0.02, 0.08], [0.09, 0.1, 0.12]),
  piece(new THREE.ConeGeometry(0.05, 0.1, 6), 0xe8642a, [0, 0.03, 0.24], [1, 0.8, 1], [Math.PI / 2, 0, 0]),
  piece(new THREE.BoxGeometry(0.46, 0.02, 0.11), 0x15171a, [0, 0.04, 0])]);

// Herd animals: model, colours [coat, hair, lower legs] (hair: mane, tail, face; the lower legs
// default to the hair colour, but a horse has dark legs only if bay, dun or black), and habits. flee: how close a car or a walker gets before they move off.
const HERD = {
  sheep: { cap: 140, model: Models.sheep, walk: 0.8, run: 3.2, flee: 14, stride: 0.75, horns: 0.45,
    looks: [[0xf1ece0, 0xe9e4d9], [0xf1ece0, 0xe9e4d9], [0xf1ece0, 0xe9e4d9], [0xf1ece0, 0x2e2824], [0x2a2522, 0x1e1a18], [0x6d4c33, 0x4b3322], [0x9a948b, 0x3b3633]] },
  horse: { cap: 60, model: Models.horse, walk: 1.1, run: 5, flee: 9, stride: 1.6,
    looks: [[0x6b3f24, 0x15100d], [0x8a4a25, 0x6e3519, 0x8a4a25], [0x8a4a25, 0xdcc79e, 0x8a4a25], [0x1f1a17, 0x141110], [0xb9b5ae, 0x8c8882, 0xa9a59e], [0xcfa86c, 0xefe6cf, 0xcfa86c], [0xae8e64, 0x2a211b], [0xe4e0d6, 0xdcd8ce, 0xe4e0d6]] },
  reindeer: { cap: 60, model: Models.reindeer, walk: 1.0, run: 7, flee: 38, stride: 1.5, looks: [[0x6c5d4c, 0x3a3029], [0x7a6b59, 0x40362d], [0x5f5446, 0x332b25]] },
  fox: { cap: 14, model: Models.fox, walk: 1.4, run: 6, flee: 26, stride: 0.6, looks: [[0xf2f1ec, 0xe2dfd8]] },
  seal: { cap: 30, model: Models.seal, walk: 0.5, run: 1.6, flee: 22, stride: 1, looks: [[0x5f6466, 0], [0x6b6359, 0], [0x7c8183, 0]] },
};
const FOX_SUMMER = [[0x5e4634, 0x3a2a1f], [0x5e4634, 0x3a2a1f], [0x4a4b52, 0x34353b]];
// Each leg's place in a four-beat walk: front-left, front-right, hind-left, hind-right.
const GAIT = [0.25, 0.75, 0, 0.5];

const EAST_X = toWorld(65, -15.8).x; // reindeer live east of about here
const CELL = 220;

export class Wildlife {
  constructor(scene, { low = false, fur = !low } = {}) {
    this.scene = scene;
    this.low = low;
    this.cells = new Map();
    this.animals = [];
    this.time = 0;
    this.seen = new Set();
    this.events = [];
    this.manageClock = 0;
    this.mats = {
      base: Models.animalMaterial({}),
      // Wet skin: a little gloss, but dark skin must stay dark rather than mirror the sky.
      seal: Models.animalMaterial({ rough: 0.55, sheen: 0.1, clear: 0.12, spots: 0.6, grain: 14, env: 0.5 }),
      whale: Models.animalMaterial({ rough: 0.55, sheen: 0, clear: 0.2, grain: 5, env: 0.28 }),
    };
    this.herd = {};
    for (const [sp, H] of Object.entries(HERD)) {
      const cap = Math.round(H.cap * (low ? 0.5 : 1)), R = H.model();
      const mat = sp === 'seal' ? this.mats.seal : this.mats.base;
      const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      const G = { R, cap, list: [], coat: attr(cap), hair: attr(cap), legCoat: attr(cap * 4), legHair: attr(cap * 4), shells: [] };
      const part = (geo, n, coat, hair) => {
        geo.setAttribute('iCoat', coat); geo.setAttribute('iHair', hair);
        const m = new THREE.InstancedMesh(geo, mat, n);
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
        scene.add(m); return m;
      };
      G.torso = part(R.torso, cap, G.coat, G.hair);
      G.head = part(R.head, cap, G.coat, G.hair);
      if (R.horns) G.horns = part(R.horns, cap, G.coat, G.hair);
      if (R.legU) { G.legU = part(R.legU, cap * 4, G.legCoat, G.legHair); G.legL = part(R.legL, cap * 4, G.legCoat, G.legHair); }
      // Fur shells over the body and head of the nearest animals: layers of strands, each sharing
      // the part's geometry and instance matrices.
      if (R.fur && fur) for (let k = 1; k <= R.fur.shells; k++) {
        const sm = Models.animalMaterial({ shell: k / R.fur.shells, density: R.fur.density });
        for (const base of [G.torso, G.head]) {
          const sh = new THREE.InstancedMesh(base.geometry, sm, cap);
          sh.instanceMatrix = base.instanceMatrix; sh.frustumCulled = false; sh.count = 0; sh.receiveShadow = true; sh.userData.noAO = true;
          scene.add(sh); G.shells.push(sh);
        }
      }
      this.herd[sp] = G;
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
    this.puffins = new THREE.InstancedMesh(puffinShape(), this.mats.base, 40);
    this.puffins.frustumCulled = false; this.puffins.count = 0;
    scene.add(this.puffins);
    // Over the sea cliffs of the Dyrhólaey headland, where its arch stands (south of the landmark).
    { const d = toWorld(63.392, -19.13); this.puffinSpot = { x: d.x - 12, z: d.z + 70 }; }
    // Sea animals: a few single meshes each.
    this.whales = [];
    this.dolphins = [];
    const dGeo = Models.dolphin();
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(dGeo, this.mats.whale); m.visible = false; m.castShadow = true; scene.add(m); this.dolphins.push({ mesh: m, phase: i * 1.7, active: false, off: [[-2.2, 4], [2.2, 5.5], [-1.2, 8], [1.4, 10.5]][i], lx: 0, lz: 0, leap: 0 }); }
    this.dolphinPod = { on: false, slow: 0, cooldown: 0 };
    this.whaleGeo = { humpback: Models.humpback(), orca: Models.orca() };
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
            out.push({ sp, x: ax, z: az, hx: ax, hz: az, heading: r() * Math.PI * 2, state: 'graze', timer: r() * 6, look: H.looks[Math.floor(r() * H.looks.length)], horned: r() < (H.horns || 0), step: r() * 10, roam: sp === 'sheep' ? 18 : 12 });
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
      for (let k = before; k < out.length; k++) out[k].look = winter ? HERD.fox.looks[0] : FOX_SUMMER[Math.floor(r() * FOX_SUMMER.length)];
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
        list.push({ sp: 'seal', x, z, hx: x, hz: z, heading: r() * Math.PI * 2, state: 'rest', timer: r() * 10, look: HERD.seal.looks[Math.floor(r() * 3)], step: r() * 10, inWater: false, away: 0 });
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
        const mesh = new THREE.Mesh(this.whaleGeo[sp], this.mats.whale); mesh.visible = false; mesh.castShadow = true; this.scene.add(mesh);
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
        // One full gait cycle per stride, longer when running, so hooves do not skate.
        a.step += (step * Math.PI * 2) / (H.stride * (a.state === 'flee' ? 1.8 : 1));
        a.moving = true;
      }
    }
    a.y = heightAt(a.x, a.z);
    // Head: down to graze with a little chewing nod, up to walk, raised and turned to watch
    // something close.
    const R = this.herd[a.sp].R, alert = d < H.flee * 2.4 && a.state !== 'flee';
    let hp = 0.05, hy = 0;
    if (a.state === 'graze') hp = alert ? R.alert : R.graze + Math.sin(this.time * 3.1 + a.step) * 0.05;
    if (alert && !a.moving) { let t = Math.atan2(threat.x - a.x, threat.z - a.z) - a.heading; t = Math.atan2(Math.sin(t), Math.cos(t)); hy = clamp(t, -0.85, 0.85); }
    if (a.moving) hp = a.state === 'flee' ? -0.05 : 0.18 + Math.sin(a.step * 2) * 0.05;
    const k = Math.min(1, dt * 2.5);
    a.hp = lerp(a.hp ?? hp, hp, k); a.hy = lerp(a.hy ?? 0, hy, k);
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
    s.y = s.inWater ? wl - 0.3 + Math.max(0, Math.sin(this.time * 0.7 + s.step)) * 0.12 : Math.max(heightAt(s.x, s.z), wl);
    // On land a seal lies with its head down, lifting it now and then to look round.
    const lift = s.inWater ? -0.35 : -0.05 - Math.max(0, Math.sin(this.time * 0.35 + s.step)) * 0.55;
    s.hp = lerp(s.hp ?? lift, lift, Math.min(1, dt * 2)); s.hy = Math.sin(this.time * 0.2 + s.step * 3) * 0.35;
  }

  draw(ctx) {
    const { pos, car, dark } = ctx;
    for (const G of Object.values(this.herd)) G.list.length = 0;
    const near = (a) => (a.dist = Math.hypot(a.x - pos.x, a.z - pos.z)) < 420;
    for (const a of this.animals) if (near(a)) this.herd[a.sp].list.push(a);
    for (const s of this.sealSpots()) if (near(s)) this.herd.seal.list.push(s);
    let eye = 0;
    // Headlights: the car's facing, for the fox's eyeshine.
    const hx = car ? Math.sin(car.heading) : 0, hz = car ? Math.cos(car.heading) : 1;
    for (const [sp, G] of Object.entries(this.herd)) {
      const R = G.R;
      G.list.sort((p, q) => p.dist - q.dist); // nearest first, so fur shells go to the closest
      const n = Math.min(G.list.length, G.cap);
      let close = 0;
      for (let k = 0; k < n; k++) {
        const a = G.list[k];
        if (a.dist < 30 && k < 6) close = k + 1; // fur on the closest few
        // Torso.
        const bob = a.moving ? Math.abs(Math.sin(a.step * 2)) * (a.state === 'flee' ? 0.06 : 0.022) : 0;
        const sc = sp === 'seal' && a.inWater ? 0.85 : 1;
        E.set(0, a.heading, 0); Q.setFromEuler(E); P.set(a.x, a.y + bob, a.z); S.set(sc, sc, sc);
        MB.compose(P, Q, S); G.torso.setMatrixAt(k, MB);
        // Head on its neck pivot.
        MH.makeRotationFromEuler(E.set(a.hp || 0, a.hy || 0, 0)); MH.setPosition(R.neckPivot[0], R.neckPivot[1], R.neckPivot[2]);
        M4.multiplyMatrices(MB, MH); G.head.setMatrixAt(k, M4);
        if (G.horns) G.horns.setMatrixAt(k, a.horned ? M4 : HIDE);
        C.set(a.look[0]); G.coat.setXYZ(k, C.r, C.g, C.b);
        C.set(a.look[1]); G.hair.setXYZ(k, C.r, C.g, C.b);
        // Eyeshine: a fox caught in the headlights looks back with two bright green-gold eyes.
        if (sp === 'fox' && eye < 26) {
          const fx = a.x - pos.x, fz = a.z - pos.z, fd = Math.hypot(fx, fz) || 1;
          const inBeam = car ? clamp(((fx * hx + fz * hz) / fd - 0.85) / 0.12, 0, 1) * (1 - clamp((fd - 25) / 60, 0, 1)) : 0;
          const look = Math.max(0, Math.cos(Math.atan2(-fx, -fz) - a.heading - (a.hy || 0)));
          const glow = Math.min(1.5, inBeam * look * dark * 3);
          const ep = this.eyes.geometry.attributes.position, ec = this.eyes.geometry.attributes.color;
          for (const s of [-1, 1]) {
            V.set(s * 0.048, 0.14, 0.215).applyMatrix4(M4);
            ep.setXYZ(eye, V.x, V.y, V.z); ec.setXYZ(eye, 0.55 * glow, 1.1 * glow, 0.3 * glow); eye++;
          }
        }
        // Legs: the upper segment swings from the hip or shoulder; the lower one folds at the knee
        // (forward legs) or hock (hind legs) while it is lifted.
        if (G.legU) {
          const run = a.state === 'flee', amp = a.moving ? (run ? 0.62 : 0.32) : 0, fold = a.moving ? (run ? 1.1 : 0.7) : 0;
          for (let li = 0; li < 4; li++) {
            const ph = a.step + GAIT[li] * Math.PI * 2, swing = Math.sin(ph) * amp, lift = Math.max(0, Math.cos(ph)) * fold;
            const hip = R.hips[li], j = k * 4 + li;
            ML.makeRotationX(swing); ML.setPosition(hip[0], hip[1], hip[2]);
            M4.multiplyMatrices(MB, ML); G.legU.setMatrixAt(j, M4);
            MT.makeRotationX(li < 2 ? lift : -lift * 0.7); MT.setPosition(0, -R.Lu, 0);
            M4.multiply(MT); G.legL.setMatrixAt(j, M4);
            C.set(a.look[0]); G.legCoat.setXYZ(j, C.r, C.g, C.b);
            C.set(a.look[2] ?? a.look[1]); G.legHair.setXYZ(j, C.r, C.g, C.b);
          }
        }
        this.noticed(sp, a.x, a.y + 0.6, a.z, ctx, 90);
      }
      G.torso.count = G.head.count = n;
      if (G.horns) G.horns.count = n;
      if (G.legU) G.legU.count = G.legL.count = n * 4;
      for (const sh of G.shells) sh.count = close;
      for (const m of [G.torso, G.head, G.horns, G.legU, G.legL]) if (m) m.instanceMatrix.needsUpdate = true;
      G.coat.needsUpdate = G.hair.needsUpdate = G.legCoat.needsUpdate = G.legHair.needsUpdate = true;
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
