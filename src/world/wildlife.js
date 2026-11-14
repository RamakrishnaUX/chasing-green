import * as THREE from 'three';
import { heightAt, waterLevelAt, roadDistAt, shoreDistAt, groundAt } from './terrain.js';
import { toWorld } from './geo.js';
import { mulberry32, clamp, lerp } from './noise.js';
import { AnimalRigs, sheepGait } from './animalRigs.js';

// Wildlife, each where and when it really lives. On land: sheep roaming free in summer and
// autumn, Icelandic horses, reindeer only in the east, an arctic fox whose eyes catch the
// headlights. On the shore: seals at Jökulsárlón, Diamond Beach and Ytri Tunga, and puffins on
// Dyrhólaey's cliffs in summer. At sea: humpbacks in Skjálfandi Bay from spring to autumn, orcas
// off Snæfellsnes in winter, and white-beaked dolphins that come to ride a boat's bow wave.
//
// Land animals are spawned in cells around the player from a seed, so the same flock is in the
// same field when you come back. They are drawn by animalRigs.js: real rigged models, the nearest
// of each species animated (grazing, watching you, walking, trotting, running) and the rest as
// instances in baked poses, each with its own coat colour.

const V = new THREE.Vector3();
const EYES = [new THREE.Vector3(), new THREE.Vector3()];

// Herd animals: colours [coat, hair, points] (a horse's hair is its mane and tail, and its lower
// legs take the points colour, dark only if bay, dun or black; a sheep's face and legs take its
// hair colour), and habits. flee: how close a car (or someone running) gets before they run off;
// shy: how close someone walking gets before they amble a few steps away. stride: ground covered in
// one walk cycle, so far-off ones step in time. body: half its length and its girth, in metres,
// which nobody on foot walks through. A horse flees at a gallop.
// Eyeshine colours by animal.
const EYESHINE = { fox: [0.55, 1.1, 0.3], sheep: [0.6, 1.0, 0.55], horse: [0.35, 0.95, 0.85], reindeer: [0.3, 0.55, 1.2] };
const HERD = {
  sheep: { cap: 140, walk: 0.8, run: 3.2, flee: 14, shy: 5, stride: 0.42, body: [0.55, 0.32],
    looks: [[0xf1ece0, 0xe9e4d9], [0xf1ece0, 0xe9e4d9], [0xf1ece0, 0xe9e4d9], [0xf1ece0, 0x2e2824], [0x2a2522, 0x1e1a18], [0x6d4c33, 0x4b3322], [0x9a948b, 0x3b3633]] },
  horse: { cap: 60, walk: 1.1, run: 7, flee: 9, shy: 1.6, stride: 1.55, body: [0.95, 0.42],
    // [coat, mane, lower legs, paint]: paint 1 keeps the white patches (skewbald, piebald).
    looks: [[0x6b3f24, 0x15100d], [0x8a4a25, 0x6e3519, 0x8a4a25], [0x8a4a25, 0xdcc79e, 0x8a4a25], [0x1f1a17, 0x141110], [0x8f8b85, 0x5f5b57, 0x77736d], [0xcfa86c, 0xefe6cf, 0xcfa86c], [0xae8e64, 0x2a211b], [0xe4e0d6, 0xdcd8ce, 0xe4e0d6], [0x7a4424, 0x3a2416, 0x7a4424, 1], [0x1f1a17, 0x2a2420, 0x1f1a17, 1]] },
  reindeer: { cap: 60, walk: 1.0, run: 7, flee: 38, shy: 20, stride: 1.34, body: [0.8, 0.38], looks: [[0x6c5d4c, 0x3a3029], [0x7a6b59, 0x40362d], [0x5f5446, 0x332b25]] },
  fox: { cap: 14, walk: 1.2, run: 2.4, flee: 26, shy: 12, stride: 0.74, body: [0.38, 0.16], looks: [[0xf2f1ec, 0xe2dfd8]] },
  seal: { cap: 30, walk: 0.5, run: 1.6, flee: 22, shy: 22, stride: 1, body: [0.75, 0.32], looks: [[0xb4b4b4], [0xbcb0a4], [0x9ea4a8]] }, // tints over the real coat
};
const FOX_SUMMER = [[0x5e4634, 0x3a2a1f], [0x5e4634, 0x3a2a1f], [0x4a4b52, 0x34353b]];
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
    this.rigs = new AnimalRigs(scene, { low });
    this.herd = {};
    for (const [sp, H] of Object.entries(HERD)) this.herd[sp] = { cap: Math.round(H.cap * (low ? 0.5 : 1)), list: [] };
    // Fox eyes: two glints each, lit when the headlights fall on them. Drawn as points of a fixed
    // size on screen, so they show as bright pinpoints from far down the road, as eyeshine does.
    {
      const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d');
      const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(120 * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(120 * 3), 3));
      this.eyes = new THREE.Points(geo, new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, vertexColors: true, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      this.eyes.frustumCulled = false;
      scene.add(this.eyes);
    }
    // Puffins: a colony standing along the clifftops, found the first time you come near, and a flock.
    this.colony = null; this.colonyScan = null; this.flock = [];
    this.puffinCap = { stand: low ? 20 : 40, fly: low ? 18 : 36 };
    // Over the sea cliffs of the Dyrhólaey headland, where its arch stands (south of the landmark).
    { const d = toWorld(63.392, -19.13); this.puffinSpot = { x: d.x - 12, z: d.z + 70 }; }
    // Sea animals: a rig each, made once its model is in.
    this.whales = [];
    this.dolphins = [];
    for (let i = 0; i < 4; i++) this.dolphins.push({ sw: null, phase: i * 1.7, active: false, off: [[-6, 10], [6.5, 13], [-9, 17], [8.5, 21]][i], lx: 0, lz: 0, leap: 0 });
    this.dolphinPod = { on: false, slow: 0, cooldown: 0 };
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
            out.push({ sp, x: ax, z: az, hx: ax, hz: az, heading: r() * Math.PI * 2, state: 'graze', timer: r() * 6, look: H.looks[Math.floor(r() * H.looks.length)], step: r() * 10, roam: sp === 'sheep' ? 18 : 12 });
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

  // Load and ready every animal now (while the island loads), so none arrives mid-drive.
  preload(onEach) {
    const caps = { seal: this.herd.seal.cap, puffinStand: this.puffinCap.stand, puffinFly: this.puffinCap.fly };
    for (const sp of ['sheep', 'horse', 'reindeer', 'fox']) caps[sp] = this.herd[sp]?.cap ?? 60;
    return this.rigs.preload(caps, onEach);
  }

  ensureWhales(month, pos) {
    const key = month >= 3 && month <= 9 ? 'summer' : 'winter';
    if (this.whaleSeason === key) return;
    // Their grounds, and the model only once the player is within a few kilometres.
    const sp = key === 'summer' ? 'humpback' : 'orca';
    const ground = key === 'summer' ? this.whaleGround(66.09, -17.52) : this.whaleGround(64.99, -23.26);
    if (ground && Math.hypot(ground.x - pos.x, ground.z - pos.z) > 4000) return;
    if (ground && !this.rigs.ready(sp)) { this.rigs.want(sp); return; }
    this.whaleSeason = key;
    for (const w of this.whales) this.scene.remove(w.mesh);
    this.whales = [];
    const add = (sp, ground, n) => {
      if (!ground) return;
      for (let i = 0; i < n; i++) {
        const sw = this.rigs.swimmer(sp);
        this.whales.push({ sp, mesh: sw.mesh, mixer: sw.mixer, len: sw.length, g: ground, ang: i * 2.1, rad: (sp === 'orca' ? 45 : 80) + i * 18, cycle: (sp === 'orca' ? 26 : 50) + i * 7, t: i * 13, blew: false });
      }
    };
    // Humpbacks feed in Skjálfandi Bay off Húsavík from April to October; in winter orcas follow
    // the herring into the fjords on the north side of Snæfellsnes.
    add(sp, ground, sp === 'humpback' ? 2 : 4);
  }

  // ---------- Update ----------
  // ctx: { pos, car, camera, clock, dark }
  update(dt, ctx) {
    this.time += dt;
    const { pos, car, clock } = ctx;
    const month = clock.month;
    this.manageClock -= dt;
    if (this.manageClock <= 0) { this.manage(pos, month); this.manageClock = 1; }
    this.ensureWhales(month, pos);
    // What is coming: a car on the move, someone running, or someone walking (or standing about).
    const kind = ctx.walking ? ((ctx.walkSpeed || 0) > 2.4 ? 'run' : 'walk') : 'car';
    const threat = { x: pos.x, z: pos.z, kind, moving: car ? Math.abs(car.vF) > 1 || ctx.walking : true };
    for (const a of this.animals) this.behave(a, dt, threat);
    for (const s of this.sealSpots()) if (Math.abs(s.x - pos.x) < 700 && Math.abs(s.z - pos.z) < 700) this.behaveSeal(s, dt, threat);
    this.draw(dt, ctx);
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
    // A horse being ridden, and one left where its rider got down, go with you or stay where they
    // are, not back to their field (until you are far away).
    this.kept = (this.kept || []).filter((a) => a === this.ridden || Math.hypot(a.x - pos.x, a.z - pos.z) < 600);
    for (const a of this.kept) for (const list of this.cells.values()) { const i = list.indexOf(a); if (i >= 0) list.splice(i, 1); }
    this.animals = [...this.cells.values()].flat().concat(this.kept);
  }
  // Keep an animal where it is (see manage).
  keep(a) { (this.kept ||= []); if (!this.kept.includes(a)) this.kept.push(a); }

  behave(a, dt, threat) {
    if (a.ridden) return; // moved by the rider (horseride.js)
    const H = HERD[a.sp];
    const dx = a.x - threat.x, dz = a.z - threat.z, d = Math.hypot(dx, dz);
    // A car or a runner sends them off at a run; someone walking up, a few unhurried steps aside.
    const calm = threat.kind === 'walk', near = calm ? H.shy : threat.kind === 'run' ? H.flee * 0.75 : H.flee;
    a.retarget = (a.retarget || 0) - dt;
    // Already moving off but still being closed on (say, followed): off again, away from them.
    const chased = a.state === 'flee' && d < near * 0.6 && a.retarget <= 0;
    if (d < near && threat.moving && (a.state !== 'flee' || chased)) {
      // Away from whatever is coming, to somewhere they can stand.
      const ang = Math.atan2(dx, dz), far = calm ? H.shy + 4 : H.flee + 12;
      const pace = calm ? H.walk * 1.6 : H.run;
      pick: for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) for (const k of [1, 0.5]) {
        const tx = a.x + Math.sin(ang + off) * far * k, tz = a.z + Math.cos(ang + off) * far * k;
        if (this.landOK(tx, tz, 0)) { a.tx = tx; a.tz = tz; a.state = 'flee'; a.pace = chased ? Math.max(a.pace || 0, pace) : pace; a.retarget = 0.6; break pick; }
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
      const sp = a.state === 'flee' ? a.pace || H.run : H.walk, ex = a.tx - a.x, ez = a.tz - a.z, e = Math.hypot(ex, ez);
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
        // One full gait cycle per stride, so far-off ones step in time (a sheep's lengthens with speed).
        a.step += (step * Math.PI * 2) / (a.sp === 'sheep' ? sheepGait(step / Math.max(dt, 1e-3), H.stride).stride : H.stride);
        a.v = step / Math.max(dt, 1e-3);
        a.moving = true;
      }
    }
    a.y = heightAt(a.x, a.z);
    // Something close: head up from the grass and turned to watch it.
    a.alert = d < H.flee * 2.4 && a.state !== 'flee';
    let hy = 0;
    if (a.alert && !a.moving) { let t = Math.atan2(threat.x - a.x, threat.z - a.z) - a.heading; t = Math.atan2(Math.sin(t), Math.cos(t)); hy = clamp(t, -0.85, 0.85); }
    a.hy = lerp(a.hy ?? 0, hy, Math.min(1, dt * 2.5));
  }

  // Someone on foot at pos (radius r) is kept out of every animal's body: a capsule along it.
  pushOut(pos, r) {
    const push = (a) => {
      if (a.ridden) return;
      const B = HERD[a.sp].body, dx = pos.x - a.x, dz = pos.z - a.z;
      if (Math.abs(dx) > 3 || Math.abs(dz) > 3 || pos.y > (a.y ?? pos.y) + 1.6) return;
      const fx = Math.sin(a.heading), fz = Math.cos(a.heading), along = clamp(dx * fx + dz * fz, -B[0], B[0]);
      const cx = a.x + fx * along, cz = a.z + fz * along, ox = pos.x - cx, oz = pos.z - cz, o = Math.hypot(ox, oz), need = B[1] + r;
      if (o >= need) return;
      const nx = o > 1e-4 ? ox / o : -fz, nz = o > 1e-4 ? oz / o : fx;
      pos.x = cx + nx * need; pos.z = cz + nz * need;
    };
    for (const a of this.animals) push(a);
    for (const s of this.sealList || []) push(s);
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

  draw(dt, ctx) {
    const { pos, car, dark } = ctx;
    for (const G of Object.values(this.herd)) G.list.length = 0;
    const near = (a) => (a.dist = Math.hypot(a.x - pos.x, a.z - pos.z)) < 420;
    for (const a of this.animals) if (near(a)) this.herd[a.sp].list.push(a);
    for (const s of this.sealSpots()) if (near(s)) this.herd.seal.list.push(s);
    let eye = 0;
    // Headlights: the car's facing, for the fox's eyeshine.
    const hx = car ? Math.sin(car.heading) : 0, hz = car ? Math.cos(car.heading) : 1;
    const ep = this.eyes.geometry.attributes.position, ec = this.eyes.geometry.attributes.color;
    for (const [sp, G] of Object.entries(this.herd)) {
      G.list.sort((p, q) => p.dist - q.dist); // nearest first: they get the full rigs
      const list = G.list.length > G.cap ? G.list.slice(0, G.cap) : G.list;
      if (sp === 'seal') { if (list.length) this.rigs.drawSeals(list, G.cap); else if (this.rigs.seals) this.rigs.seals.visible = false; }
      else if (list.length) this.rigs.drawHerd(sp, list, dt, G.cap);
      else this.rigs.hideHerd(sp);
      for (const a of list) {
        // Eyeshine: an animal caught in the headlights looking back shows two bright points, each
        // in its own colour (the mirror behind the retina): green-gold for a fox, pale green for a
        // sheep, blue-green for a horse, and a reindeer's turn deep blue in the winter dark.
        // Full beam reaches twice as far down the road.
        const tint = EYESHINE[sp];
        if (tint && eye < 118 && a.dist < 200 && this.rigs.eyesAt(sp, a, EYES)) {
          const fx = a.x - pos.x, fz = a.z - pos.z, fd = Math.hypot(fx, fz) || 1, reach = ctx.highBeam ? 150 : 70;
          const inBeam = car ? clamp(((fx * hx + fz * hz) / fd - (ctx.highBeam ? 0.9 : 0.85)) / 0.1, 0, 1) * (1 - clamp((fd - reach * 0.4) / (reach * 0.6), 0, 1)) : 0;
          const look = Math.max(0, Math.cos(Math.atan2(-fx, -fz) - a.heading - (a.hy || 0)));
          const glow = Math.min(1.5, inBeam * look * dark * 3);
          if (glow > 0.02) for (const e of EYES) { ep.setXYZ(eye, e.x, e.y, e.z); ec.setXYZ(eye, tint[0] * glow, tint[1] * glow, tint[2] * glow); eye++; }
        }
        if (this.rigs.ready(sp)) this.noticed(sp, a.x, a.y + 0.6, a.z, ctx, 90);
      }
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
      let x = w.g.x + Math.cos(w.ang) * w.rad, z = w.g.z + Math.sin(w.ang) * w.rad;
      // They give a boat (or the car on the shore) a wide berth: a whale whose path comes close
      // swings out round it, smoothly, so it never surfaces alongside.
      const keep = w.sp === 'orca' ? 35 : 55;
      let px = 0, pz = 0;
      if (car) { const ex = x - car.pos.x, ez = z - car.pos.z, e = Math.hypot(ex, ez) || 1; if (e < keep) { px = (ex / e) * (keep - e); pz = (ez / e) * (keep - e); } }
      const kk = Math.min(1, dt * 2);
      w.ox = lerp(w.ox || 0, px, kk); w.oz = lerp(w.oz || 0, pz, kk);
      x += w.ox; z += w.oz;
      // A boat coming on faster than it can swing out: it stays down until the boat has passed.
      const tooClose = car && Math.hypot(x - car.pos.x, z - car.pos.z) < keep * 0.7;
      const heading = Math.atan2(-Math.sin(w.ang), Math.cos(w.ang)); // along the loop
      const wl = waterLevelAt(x, z), u = (w.t % w.cycle) / w.cycle, surf = 0.22; // the last 22% of each cycle is at the surface
      if (far || u < 1 - surf || (tooClose && !w.mesh.visible)) { w.mesh.visible = false; w.blew = false; continue; }
      const s = (u - (1 - surf)) / surf; // 0..1 through the surfacing
      // The blowhole is about a third of the body ahead of the middle.
      if (!w.blew && s > 0.08) { w.blew = true; this.spout(x + Math.sin(heading) * w.len * 0.33, wl + 0.5, z + Math.cos(heading) * w.len * 0.33, w.sp === 'humpback'); }
      const len = w.len * 0.55;
      w.mixer.update(dt);
      // Rise and roll forward over a low arc. A humpback then tips down and sinks as it dives, so
      // only the tail stock and the fluke lift clear of the water, nearly upright.
      let pitch, y;
      if (w.sp === 'humpback') {
        pitch = s < 0.55 ? lerp(-0.12, 0.25, s / 0.55) : lerp(0.25, 1.4, (s - 0.55) / 0.45);
        y = wl - 2.3 + Math.sin(Math.PI * Math.min(1, s * 1.6)) * 1.25 - Math.max(0, s - 0.55) * 9;
      } else {
        pitch = lerp(-0.18, 0.35, s);
        y = wl - 1.75 + Math.sin(Math.PI * Math.min(1, s * 1.15)) * 1.05 - Math.max(0, s - 0.7) * 3;
      }
      w.mesh.visible = true;
      w.mesh.position.set(x - Math.sin(heading) * len * 0.2 * s, y, z - Math.cos(heading) * len * 0.2 * s);
      w.mesh.rotation.set(pitch, heading, 0, 'YXZ');
      this.noticed(w.sp, x, wl + 1, z, ctx, 450);
    }
    // Dolphins: a pod joins a boat out at sea once it is going properly, swims alongside a few
    // boat-lengths off (close enough to see, not under the hull),
    // porpoising and now and then leaping, and drifts off when the boat slows or nears land.
    const P2 = this.dolphinPod;
    P2.cooldown -= dt;
    const afloat = car && car.boatOn && car.boat > 0.9, sp = car ? car.vF : 0;
    const offshore = car ? -shoreDistAt(car.pos.x, car.pos.z) : 0;
    if (afloat && offshore > 10) this.rigs.want('dolphin'); // fetch the model while the boat heads out
    if (!P2.on && afloat && sp > 7 && offshore > 30 && P2.cooldown <= 0 && this.rigs.ready('dolphin')) {
      for (const d of this.dolphins) if (!d.sw) d.sw = this.rigs.swimmer('dolphin');
      P2.on = true; P2.slow = 0;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      // They come up from behind, each on its own side of the wake.
      for (const d of this.dolphins) { d.active = true; d.lx = car.pos.x - fx * 25 + fz * d.off[0] * 1.3; d.lz = car.pos.z - fz * 25 - fx * d.off[0] * 1.3; d.leap = 0; }
    }
    if (P2.on) {
      P2.slow = (!afloat || sp < 4 || offshore < 15) ? P2.slow + dt : 0;
      if (P2.slow > 4) { P2.on = false; P2.cooldown = 40; }
    }
    for (const d of this.dolphins) {
      if (!d.sw) continue;
      const mesh = d.sw.mesh;
      if (!d.active) { mesh.visible = false; continue; }
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
      d.sw.mixer.update(dt * (1 + v * 0.06)); // tail beats quicken with speed
      if (d.leap <= 0 && Math.random() < dt * 0.06) d.leap = 1;
      d.leap = Math.max(0, d.leap - dt * 0.8);
      const wl = waterLevelAt(d.lx, d.lz), arc = Math.sin(d.phase), amp = 0.75 + (d.leap > 0 ? 1.4 * Math.sin(Math.PI * d.leap) : 0);
      const y = wl - 0.55 + Math.max(-0.3, arc) * amp;
      mesh.visible = y > wl - 1.2;
      mesh.position.set(d.lx, y, d.lz);
      mesh.rotation.set(-Math.cos(d.phase) * 0.55, car.heading, 0, 'YXZ');
      if (!P2.on && Math.hypot(d.lx - car.pos.x, d.lz - car.pos.z) > 120) d.active = false;
      if (mesh.visible) this.noticed('dolphin', d.lx, y, d.lz, ctx, 60);
    }
  }

  // Puffins nest on the cliffs at Dyrhólaey from May to August: they stand about in little groups
  // along the clifftops, turning their heads, and a flock wheels round the arch and the stacks.
  birds(dt, ctx) {
    const { pos, clock } = ctx, m = clock.month, spot = this.puffinSpot;
    const near = Math.hypot(spot.x - pos.x, spot.z - pos.z) < 600;
    if (!(m >= 4 && m <= 7) || !near) { this.rigs.hidePuffins(); return; }
    if (!this.colony) { this.scanColony(spot); return; }
    for (const b of this.colony) {
      // A bird's head snaps from one look to the next, now and then down at the grass.
      b.next -= dt;
      if (b.next <= 0) {
        b.next = 0.5 + Math.random() * 3.5;
        b.tHy = (Math.random() - 0.5) * 2.6; b.tNod = Math.random() < 0.15 ? 0.55 : (Math.random() - 0.5) * 0.25;
        if (Math.random() < 0.06) b.tHead = b.base + (Math.random() - 0.5) * 1.8; // shuffles round
      }
      const k = Math.min(1, dt * 14);
      b.hy += (b.tHy - b.hy) * k; b.nod += (b.tNod - b.nod) * k; b.heading += (b.tHead - b.heading) * Math.min(1, dt * 3);
    }
    // Fast and low over the sea, then up past the clifftops; never into the rock.
    const cx = spot.x + 10, cz = spot.z + 2;
    if (!this.flock.length) for (let i = 0; i < this.puffinCap.fly; i++) {
      const r = 50 + (i % 7) * 6, v = 15 + (i % 5) * 1.5, a = i * 2.4;
      this.flock.push({ a, r, rz: r * 0.75, w: v / r, ph: i * 1.7, x: cx + Math.cos(a) * r, y: 40, z: cz + Math.sin(a) * r * 0.75, heading: 0, pitch: 0, bank: 0, flap: 0, ahead: 0, look: (i % 8) * 0.03 });
    }
    for (const b of this.flock) {
      b.a += b.w * dt;
      const x = cx + Math.cos(b.a) * b.r, z = cz + Math.sin(b.a) * b.rz;
      // The highest ground over the next few seconds of its path (every 2 m), so it climbs before a cliff.
      if ((b.look -= dt) <= 0) {
        b.look = 0.25; b.ahead = -Infinity;
        for (let t = 0, st = 2 / (b.w * b.r); t <= 5; t += st) { const a = b.a + b.w * t; b.ahead = Math.max(b.ahead, groundAt(cx + Math.cos(a) * b.r, cz + Math.sin(a) * b.rz)); }
      }
      const want = Math.max(7 + 17 * (0.5 + 0.5 * Math.sin(b.a * 1.3 + b.ph)) + (b.ph % 4) * 3, b.ahead + 4);
      const y = Math.max(b.y + clamp((want - b.y) * 1.2, -9, 12) * dt, groundAt(x, z) + 2);
      const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz);
      if (d > 1e-4 && dt > 0) {
        const hd = Math.atan2(dx, dz), turn = Math.atan2(Math.sin(hd - b.heading), Math.cos(hd - b.heading)) / dt, v = d / dt;
        b.heading = hd;
        b.bank += (clamp(-Math.atan(v * turn / 9.8), -0.8, 0.8) - b.bank) * Math.min(1, dt * 3);
        b.pitch += (clamp(-Math.atan2(y - b.y, d), -0.5, 0.5) - b.pitch) * Math.min(1, dt * 4);
      }
      b.x = x; b.y = y; b.z = z;
      b.flap = 0.2 + 0.85 * Math.sin(this.time * 31 + b.ph); // about five beats a second
    }
    if (this.rigs.drawPuffins(this.colony, this.flock, this.puffinCap.stand, this.puffinCap.fly)) this.noticed('puffin', spot.x, 30, spot.z, ctx, 160);
  }

  // Where puffins stand: high ground (the arch's grassy top, the sea stacks) with a drop of more than
  // 5 m within 3 m, and flat behind. Searched once, some rows a frame; then the colony is placed
  // there in little groups, facing the sea.
  scanColony(spot) {
    const R = 110, s = (this.colonyScan ||= { dz: -R, rims: [] });
    for (let k = 0; k < 10 && s.dz <= R; k++, s.dz += 2) for (let dx = -R; dx <= R; dx += 2) {
      const x = spot.x + dx, z = spot.z + s.dz, h = groundAt(x, z);
      if (h < waterLevelAt(x, z) + 6) continue;
      let drop = 0, dir = 0;
      for (let j = 0; j < 8; j++) { const a = (j * Math.PI) / 4, d = h - groundAt(x + Math.cos(a) * 3, z + Math.sin(a) * 3); if (d > drop) { drop = d; dir = a; } }
      if (drop > 5 && Math.abs(groundAt(x - Math.cos(dir) * 2.5, z - Math.sin(dir) * 2.5) - h) < 1) s.rims.push({ x, z, h, dir });
    }
    if (s.dz <= R) return;
    const rnd = mulberry32(1874), rims = s.rims, colony = [], centres = [];
    for (let i = rims.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rims[i], rims[j]] = [rims[j], rims[i]]; }
    for (const r of rims) {
      if (colony.length >= this.puffinCap.stand) break;
      if (centres.some((c) => Math.hypot(c.x - r.x, c.z - r.z) < 12)) continue;
      centres.push(r);
      const n = 3 + Math.floor(rnd() * 5), tx = -Math.sin(r.dir), tz = Math.cos(r.dir);
      for (let i = 0; i < n * 3 && colony.length < this.puffinCap.stand; i++) {
        const along = (rnd() - 0.5) * 4, back = rnd() * 1.5;
        const x = r.x + tx * along - Math.cos(r.dir) * back, z = r.z + tz * along - Math.sin(r.dir) * back, y = groundAt(x, z);
        if (Math.abs(y - r.h) > 0.6 || colony.some((b) => Math.hypot(b.x - x, b.z - z) < 0.45)) continue;
        const heading = Math.atan2(Math.cos(r.dir), Math.sin(r.dir)) + (rnd() - 0.5) * 1.6;
        colony.push({ x, y, z, heading, base: heading, tHead: heading, hy: 0, tHy: 0, nod: 0, tNod: 0, next: rnd() * 3 });
        if (colony.filter((b) => Math.hypot(b.x - r.x, b.z - r.z) < 4).length >= n) break;
      }
    }
    this.colony = colony;
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
