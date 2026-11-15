// The other players in a room (room.js), drawn as they are: their car or bike with them at the
// wheel, their helicopter, or them on foot, swimming or falling under a canopy. No physics runs for
// them here: each one is shown a little in the past (DELAY), between the last two states they sent,
// so they move smoothly however the network delivers.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildVehicleModel, whenModel } from '../vehicle/models.js';
import { buildInterior, turnWheel } from '../vehicle/interiors.js';
import { buildBoatKit, stages } from '../vehicle/boat.js';
import { Driver } from '../vehicle/driver.js';
import { Heli } from '../vehicle/heli.js';
import { loadGLTF } from '../world/gltf.js';

const DELAY = 0.15; // seconds behind the newest state: one and a half sends, so there is nearly always a next one
const STALE = 12; // seconds without a word before a player is taken off the island
// The walker's clips and his pace (walker.js), so feet keep to the ground here too.
const CLIPS = ['idle', 'walk', 'run', 'fall', 'kneel', 'swim', 'tread'];
const RUN_PACE = 5.0, WALK_PACE = 1.55, STEP_AT = { walk: 0.225, run: 0.217 };
// Person states as sent (main.js personState).
export const P = { walk: 0, swim: 1, fall: 2, climb: 3, sit: 4, ride: 5, sky: 6 };
// Name tag and map colours, one per player in the order they arrive.
export const COLORS = ['#ffb547', '#ff6fa8', '#b58cff', '#5fd3ff', '#9be15d', '#ff8a5c', '#f2e86d'];

let personFile = null;
const person = () => (personFile ||= loadGLTF(`${import.meta.env.BASE_URL}models/person.glb`));

const lerpAngle = (a, b, t) => a + (((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * t;
function mix(a, b, t, angles) {
  if (!a || !b) return b || a;
  // A jump (a round's line-up, a fast travel) is shown as one: never slid across the land between.
  if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 25) return t < 0.5 ? a : b;
  const out = new Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = angles.includes(i) ? lerpAngle(a[i], b[i], t) : a[i] + (b[i] - a[i]) * t;
  return out;
}
// A model's materials are shared with the car you drive, whose dirt (grime.js) is drawn in your
// car's own frame: each remote car gets its own plain copies.
function ownMaterials(group) {
  const copies = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => copies.get(m) || copies.set(m, m.clone()).get(m)) : (copies.get(o.material) || copies.set(o.material, o.material.clone()).get(o.material));
  });
}
// A soft round glow for the lamps at night (no real light: a new light makes every shader rebuild).
let glowTex = null;
function glow(color) {
  if (!glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  s.userData.noBox = true;
  return s;
}

class Remote {
  constructor(set, peer, color) {
    this.set = set; this.peer = peer; this.color = color;
    this.snaps = []; // { t, s }, oldest first
    this.root = new THREE.Group();
    this.root.userData.dynamic = true;
    set.scene.add(this.root);
    this.car = null; this.carKind = null; this.wantKind = null;
    this.heli = null; this.man = null; this.driver = null;
    this.view = { mode: 'chase', ride: 'car' }; // as last shown
    this.pos = new THREE.Vector3(); this.heading = 0; // where they are now (for the tag, the map and bumping)
    this.carAt = null; this.manAt = null; // circles others bump against
    this.stride = 0;
    this.tag = document.createElement('div');
    this.tag.className = 'peer-tag';
    this.tag.style.setProperty('--c', color);
    this.tag.innerHTML = '<b></b><span></span>';
    set.tags.append(this.tag);
    this.rename();
  }
  rename() { this.tag.firstChild.textContent = this.peer.name; }
  push(s, now) {
    this.snaps.push({ t: now, s });
    while (this.snaps.length > 12) this.snaps.shift();
  }

  // ---- What they are in ----
  ensureCar(kind) {
    if (this.carKind === kind || this.wantKind === kind) return;
    this.wantKind = kind;
    // The model in their garage may still be on its way here: it comes once in, never a stand-in.
    whenModel(kind).then(() => {
      if (this.gone || this.wantKind !== kind) return;
      this.dropCar();
      const model = buildVehicleModel(kind);
      ownMaterials(model.group);
      const kit = model.bike ? null : buildBoatKit(model);
      kit?.apply(0);
      const interior = buildInterior(kind, model);
      model.group.add(interior.group);
      interior.group.visible = !interior.closed;
      if (interior.outside) model.group.add(interior.outside);
      const root = new THREE.Group();
      root.add(model.group);
      this.root.add(root);
      const box = new THREE.Box3().setFromObject(model.group), size = box.getSize(new THREE.Vector3());
      const lamps = [glow(0xfff2dc), glow(0xfff2dc)], tails = [glow(0xff2a1a), glow(0xff2a1a)];
      const [hx, hy, hz] = model.headlight, ex = Math.max(0.35, size.x * 0.33);
      lamps.forEach((l, i) => { l.position.set((i ? 1 : -1) * (model.bike ? 0 : ex), hy, hz + 0.05); model.group.add(l); });
      tails.forEach((l, i) => { l.position.set((i ? 1 : -1) * (model.bike ? 0 : ex), hy * 0.95, box.min.z - 0.02); model.group.add(l); });
      if (model.bike) { lamps[1].visible = false; tails[1].visible = false; }
      this.car = { model, body: model.group, interior, root, kit, wheels: model.wheels, lamps, tails, hx: size.x / 2, hz: size.z / 2, cz: (box.min.z + box.max.z) / 2 };
      this.carKind = kind;
      this.driver ||= new Driver();
    });
  }
  dropCar() {
    if (!this.car) return;
    if (this.driver) { this.driver.group.parent?.remove(this.driver.group); this.driver.helmet.parent?.remove(this.driver.helmet); }
    this.root.remove(this.car.root);
    this.car.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach((m) => m.dispose()); } });
    this.car = null; this.carKind = null;
  }
  ensureHeli() {
    if (this.heli) return;
    this.heli = new Heli(this.set.scene);
    this.heli.root.userData.dynamic = true;
  }
  ensureMan() {
    if (this.man || this.manLoading) return;
    this.manLoading = true;
    person().then((g) => {
      if (this.gone) return;
      const man = cloneSkinned(g.scene);
      man.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      const mixer = new THREE.AnimationMixer(man), actions = {}, weights = {};
      for (const name of CLIPS) {
        const clip = g.animations.find((c) => c.name === name);
        if (!clip) continue;
        const a = mixer.clipAction(clip); a.play(); a.setEffectiveWeight(name === 'idle' ? 1 : 0);
        actions[name] = a; weights[name] = name === 'idle' ? 1 : 0;
      }
      const holder = new THREE.Group(); holder.add(man); this.root.add(holder);
      this.man = { root: holder, mixer, actions, weights };
    });
  }

  // ---- Each frame ----
  update(dt, now, env) {
    const S = this.snaps;
    if (!S.length) { this.root.visible = false; this.tag.hidden = true; return; }
    // The two states either side of the moment shown (DELAY ago), or the newest held for a moment.
    const at = now - DELAY;
    let a = S[0], b = S[0];
    for (let i = S.length - 1; i >= 0; i--) if (S[i].t <= at) { a = S[i]; b = S[i + 1] || S[i]; break; }
    const u = b === a ? 0 : Math.min(1, (at - a.t) / Math.max(1e-3, b.t - a.t));
    const sa = a.s, sb = b.s, s = u < 0.5 ? sa : sb;
    this.view = { mode: s.m, ride: s.r };
    this.root.visible = true;
    const c = sa.c && sb.c ? mix(sa.c, sb.c, u, [3]) : (s.c || null);
    const h = sa.h && sb.h ? mix(sa.h, sb.h, u, [3]) : (s.h || null);
    const p = sa.p && sb.p ? mix(sa.p, sb.p, u, [3]) : (s.p || null);
    const driving = s.r === 'car' && (s.m === 'chase' || s.m === 'lookup');
    const onFoot = s.m === 'walk' || s.m === 'sky';

    // The car: driven, or parked where they left it while they walk.
    if (c && s.r === 'car') {
      this.ensureCar(s.k);
      if (this.car) this.poseCar(c, dt, driving, env);
    } else if (this.car) this.car.root.visible = false;
    if (!(c && s.r === 'car')) this.carAt = null;
    // The helicopter: flown, flying itself to pick them up, or standing.
    if (h && s.r === 'heli') {
      this.ensureHeli();
      const H = this.heli;
      H.root.visible = true;
      H.pos.set(h[0], h[1], h[2]); H.heading = h[3]; H.pitch = h[4]; H.roll = h[5]; H.rpm = h[6];
      H.engineOn = H.rpm > 0.05; H.landed = !!(s.hl); H.dark = env.dark; H.t += dt;
      H.sync(dt);
      this.carAt = { x: h[0], z: h[2], r: 4.5, y: h[1] };
    } else if (this.heli) this.heli.root.visible = false;
    // Them, on foot (or in the air under their canopy).
    if (p && onFoot) {
      this.ensureMan();
      if (this.man) this.poseMan(p, dt);
      this.manAt = { x: p[0], z: p[2], r: 0.4, y: p[1] };
    } else { if (this.man) this.man.root.visible = false; this.manAt = null; }

    const at3 = onFoot && p ? p : driving && c ? c : h || c || p;
    if (at3) { this.pos.set(at3[0], at3[1], at3[2]); this.heading = at3[3]; }
    this.tagUpdate(env, onFoot ? 2.2 : s.r === 'heli' ? 3.6 : 2.4);
  }

  poseCar(c, dt, driving, env) {
    const C = this.car, [x, y, z, heading, pitch, roll, by, vF, steer, boat] = c;
    C.root.visible = true;
    C.root.position.set(x, y, z);
    C.root.rotation.set(0, heading, 0);
    C.body.rotation.set(pitch, 0, roll);
    C.body.position.y = by;
    const fold = C.kit ? stages(boat).fold : 0;
    C.kit?.apply(boat);
    const R = C.model.R, MS = C.model.scale || 1;
    for (const w of C.wheels) {
      w.spin.rotation.x += (vF * dt) / (R * MS) * (1 - fold);
      if (w.front && !C.model.bike) w.pivot.rotation.y = steer * (1 - fold);
    }
    turnWheel(C.interior, steer);
    // Lamps: the faces glow a little by day and bright at night, with a halo after dark.
    C.model.lightMat.emissiveIntensity = 0.4 + env.dark * 1.4;
    C.model.tailMat.emissiveIntensity = 0.4 + env.dark * 0.6;
    const on = driving ? env.dark : 0;
    for (const l of C.lamps) { l.material.opacity = on * 0.9; l.scale.setScalar(1.4 + on * 1.2); }
    for (const l of C.tails) { l.material.opacity = on * 0.55; l.scale.setScalar(0.6 + on * 0.5); }
    // At the wheel while driving; out of the car (and shown on foot) otherwise.
    if (this.driver) {
      C.root.updateMatrixWorld(true);
      try { this.driver.update(C, driving, false); } catch { /* his seat is found on a later frame */ }
    }
    // Two circles along the body for bumping into.
    const fx = Math.sin(heading), fz = Math.cos(heading), off = Math.max(0, C.hz - C.hx);
    this.carAt = { x: x + fx * C.cz, z: z + fz * C.cz, r: C.hx, fx, fz, off, y };
  }

  poseMan(p, dt) {
    const M = this.man, [x, y, z, heading, v, st] = p, state = Math.round(st);
    M.root.visible = true;
    M.root.position.set(x, y, z);
    M.root.rotation.y = heading;
    if (state === P.swim) M.root.position.y += Math.sin(performance.now() / 1000 * 2.1) * 0.03;
    // The same blend the walker uses (walker.js animate), driven by the speed they sent.
    const want = { idle: 0, walk: 0, run: 0, fall: 0, kneel: 0, swim: 0, tread: 0 }, A = M.actions;
    if (state === P.sit) want.kneel = 1;
    else if (state === P.swim) { want.swim = Math.min(1, Math.max(0, (v - 0.15) / 0.45)); want.tread = 1 - want.swim; }
    else if (state === P.fall || state === P.sky) want.fall = 1;
    else if (state === P.climb) want.idle = 1;
    else {
      if (v >= 1.9) { want.run = Math.min(1, (v - 1.9) / 1.5); want.walk = 1 - want.run; }
      else if (v >= 0.1) want.walk = Math.min(1, v / 0.5);
      want.idle = 1 - want.walk - want.run;
      if (A.walk && A.run) {
        const wd = A.walk.getClip().duration, rd = A.run.getClip().duration;
        this.stride = (this.stride + v * dt / (WALK_PACE * wd + (RUN_PACE * rd - WALK_PACE * wd) * want.run)) % 1;
        A.walk.timeScale = 0; A.run.timeScale = 0;
        A.walk.time = ((this.stride + STEP_AT.walk) % 1) * wd;
        A.run.time = ((this.stride + STEP_AT.run) % 1) * rd;
      }
    }
    const k = Math.min(1, dt * 8);
    for (const name of CLIPS) {
      if (!A[name]) continue;
      M.weights[name] += (want[name] - M.weights[name]) * k;
      A[name].setEffectiveWeight(M.weights[name]);
    }
    M.mixer.update(dt);
  }

  // The name over their head, fading with distance; the distance itself once they are far off.
  tagUpdate(env, lift) {
    const v = this.set.v.set(this.pos.x, this.pos.y + lift, this.pos.z);
    const d = env.camera.position.distanceTo(v);
    v.project(env.camera);
    const show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && d < 4000 && !env.hideTags;
    if (this.tag.hidden === show) this.tag.hidden = !show;
    if (!show) return;
    const fade = d < 600 ? 1 : Math.max(0.55, 1 - (d - 600) / 3000);
    this.tag.style.transform = `translate3d(${((v.x + 1) / 2 * env.w).toFixed(1)}px, ${((1 - v.y) / 2 * env.h).toFixed(1)}px, 0) translate(-50%, -100%)`;
    this.tag.style.opacity = fade.toFixed(2);
    const label = d > 120 ? (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`) : '';
    if (this.tag.lastChild.textContent !== label) this.tag.lastChild.textContent = label;
  }

  dispose() {
    this.gone = true;
    this.dropCar();
    if (this.heli) { this.set.scene.remove(this.heli.root); this.heli = null; }
    this.set.scene.remove(this.root);
    this.tag.remove();
  }
}

export class Remotes {
  constructor(scene) {
    this.scene = scene;
    this.list = new Map();
    this.v = new THREE.Vector3();
    this.tags = document.createElement('div');
    this.tags.className = 'peer-tags';
    this.tags.setAttribute('aria-hidden', 'true');
    document.body.append(this.tags);
    this.nColor = 0;
  }
  add(peer) {
    if (this.list.has(peer.id)) return this.list.get(peer.id);
    const r = new Remote(this, peer, COLORS[this.nColor++ % COLORS.length]);
    this.list.set(peer.id, r);
    return r;
  }
  remove(id) { const r = this.list.get(id); if (!r) return; r.dispose(); this.list.delete(id); }
  clear() { for (const id of [...this.list.keys()]) this.remove(id); }
  state(peer, s) { (this.list.get(peer.id) || this.add(peer)).push(s, performance.now() / 1000); }
  update(dt, env) {
    const now = performance.now() / 1000;
    for (const r of this.list.values()) {
      if (now - r.peer.last / 1000 > STALE) { r.root.visible = false; r.tag.hidden = true; r.carAt = r.manAt = null; continue; }
      r.update(dt, now, env);
    }
  }
  // Keep a body (a circle at x, z of radius rad, standing at height y) out of everyone else. Returns
  // the push it took, or null.
  pushOut(pos, rad, y = pos.y) {
    let hit = null;
    for (const r of this.list.values()) {
      for (const o of [r.carAt, r.manAt]) {
        if (!o || Math.abs(o.y - y) > 3) continue;
        // A car is a capsule: the nearest point on its middle line, then a circle round that.
        let cx = o.x, cz = o.z;
        if (o.off) {
          const t = Math.max(-o.off, Math.min(o.off, (pos.x - o.x) * o.fx + (pos.z - o.z) * o.fz));
          cx += o.fx * t; cz += o.fz * t;
        }
        const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz), min = rad + o.r;
        if (d >= min) continue;
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0, push = min - d;
        pos.x += nx * push; pos.z += nz * push;
        hit = { nx, nz, push, peer: r.peer };
      }
    }
    return hit;
  }
  // Dots for the map: where each player is, their colour and heading.
  marks() { return [...this.list.values()].filter((r) => r.root.visible).map((r) => ({ x: r.pos.x, z: r.pos.z, heading: r.heading, color: r.color, name: r.peer.name })); }
}
