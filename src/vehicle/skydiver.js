// Skydiving from the helicopter: the man you walk as jumps from the side door, falls face down
// with his pack on, opens a ram-air canopy, flies it down and lands on his feet.
//
// Phases: exit (stepping off the skid into the airflow), freefall, deploy (the canopy streams out
// and inflates), canopy, and landing (a stand-up or a roll, while the canopy collapses).
//
// Free fall: about 200 km/h belly down. Left and right turn him (a dipped shoulder); forward
// sweeps his arms back and straightens his legs to track (glide forward, fall a little faster);
// back spreads him out to slow the fall.
// Under the canopy: about 10 m/s forward and 5 m/s down. The toggles (left and right) turn it and,
// held, wind it into a spiral that comes down much faster; forward pulls the front risers (faster
// and steeper); back is the brakes, and pulled just before the ground, the flare: forward speed
// becomes lift for a moment and the landing is soft. The game's wind drifts both.
//
// Nothing can go wrong for good:
// - an automatic opener fires once the ground (under him or ahead along his path) is closer than
//   the canopy needs to open at his speed, plus a margin;
// - opened late, or landed fast, he rolls and stands up;
// - he never lands in water, on a roof, or on a slope too steep to stand on: he is put on the
//   nearest ground he can stand on (the shore, beside the building, the foot of the slope);
// - ground contact is checked along his whole path each frame, so at 55 m/s and 20 frames a
//   second he cannot pass through the ground or a roof.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { groundAt, heightAt, waterLevelAt, BOUNDS } from '../world/terrain.js';
import { clamp, lerp } from '../world/noise.js';
import { aim, reach, frameQuat, setWorldQuat, turnWorld, wpos, wquat, CURL } from './driver.js';

const G = 9.81;
export const MIN_JUMP = 300; // metres above the ground to jump from
const OPEN_PROMPT = 650; // below this, "open your parachute"
const DEPLOY_T = 2.6; // seconds from pull to a flying canopy
const VT = { box: 54, track: 49, flat: 45 }; // terminal fall speeds, m/s
const TRACK = 22; // forward speed tracking, m/s
// The canopy: a 20 m2 (215 sq ft) nine-cell wing carrying 95 kg. Lift and drag coefficients at trim,
// full brakes and full front risers. They give about 11.5 m/s along a path 23 degrees down (10.5
// forward, 4.6 down) at trim, 5.3 and 2.8 in deep brakes, 12.4 and 5.6 on the risers.
const AERO = { m: 95, S: 20, rho: 1.2, cl: [0.54, 1.9, 0.385], cd: [0.234, 1.0, 0.183] };
const LINE_STRETCH = 0.45; // seconds from the pull until the lines are stretched
const INFLATE = 1.5; // seconds for the canopy to inflate (the slider holds it back)
const HIP = 0.95; // hips above the feet, standing
const LINE = 5.0; // harness to the canopy's underside
const SPAN = 7.2, CHORD = 2.6, CELLS = 9, ARC = 0.78;

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- The canopy ----------
// A nine-cell ram-air wing, as a sport canopy is built: an arc of fat, pillowy cells (the top skin
// bulges up between the ribs, the bottom a little down), a thick airfoil with the cell mouths open
// across the front and the dark rib walls seen inside them, tapering a little to the tips. Its lines
// run from four points along each rib, join in cascades, and come down to four risers at his
// shoulders through the slider; the steering lines gather from the tail to his hands.
// Built in its own frame: origin at the harness, +y up, +z forward, +x his left.
const TMAX = 0.17; // thickness, as a share of the chord
function airfoil(u) { // thickness through the chord (metres at the root), u from the nose (0) to the tail (1)
  const t = 1.48 * Math.sqrt(Math.max(u, 0)) - 0.63 * u - 1.76 * u * u + 1.42 * u * u * u - 0.51 * u ** 4;
  return CHORD * TMAX * t / 0.5;
}
const chordAt = (s) => 1 - 0.16 * s * s; // a little narrower at the tips
function ribPoint(s, u, h) { // s: across the span (-1..1), u: along the chord, h: up from the chord line
  const th = s * ARC / 2, R = SPAN / ARC, k = chordAt(s);
  const n = new THREE.Vector3(Math.sin(th), Math.cos(th), 0);
  const base = new THREE.Vector3(R * Math.sin(th), LINE - R * (1 - Math.cos(th)), CHORD * k * (0.4 - u) + CHORD * 0.06 * (1 - k));
  return base.addScaledVector(n, h * k);
}
// The scheme: cells from the left tip to the right one.
const SCHEME = [0x1c2a4a, 0xf2efe6, 0xc8231d, 0xf2efe6, 0xc8231d, 0xf2efe6, 0xc8231d, 0xf2efe6, 0x1c2a4a].map((c) => new THREE.Color(c));
function buildCanopy() {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const pos = [], col = [], idx = [];
  const NU = 20, SUB = 6; // chord samples; span samples per cell
  const cols = CELLS * SUB + 1, tm = airfoil(0.3);
  const push = (p, c, shade = 1) => { pos.push(p.x, p.y, p.z); col.push(c.r * shade, c.g * shade, c.b * shade); };
  for (const surface of ['top', 'bottom']) {
    const start = pos.length / 3;
    for (let j = 0; j < cols; j++) {
      const s = j / (cols - 1) * 2 - 1, cell = Math.min(CELLS - 1, Math.floor(j / SUB)), within = (j - cell * SUB) / SUB;
      // A cell is a fabric tube held in at its ribs: rounder near the middle, flat at the tail.
      const lobe = Math.sin(Math.PI * within);
      const c = SCHEME[cell];
      for (let i = 0; i <= NU; i++) {
        const u = surface === 'bottom' ? 0.07 + (i / NU) ** 1.2 * 0.93 : (i / NU) ** 1.35;
        const t = airfoil(u), fill = t / tm;
        const h = surface === 'top' ? t * 0.8 + lobe * 0.075 * fill : -t * 0.2 - lobe * 0.03 * fill;
        // The underside is in its own shadow, a little darker.
        push(ribPoint(s, u, h), c, surface === 'top' ? 1 : 0.82);
      }
    }
    for (let j = 0; j < cols - 1; j++) for (let i = 0; i < NU; i++) {
      const a = start + j * (NU + 1) + i, b = a + NU + 1;
      if (surface === 'top') idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // The ribs: the cell walls, dark inside (seen through the mouths), the end ones in the tip colour.
  for (let r = 0; r <= CELLS; r++) {
    const s = r / CELLS * 2 - 1, start = pos.length / 3, end = r === 0 || r === CELLS;
    const c = end ? SCHEME[r === 0 ? 0 : CELLS - 1] : new THREE.Color(0x3a3c40);
    for (let i = 0; i <= NU; i++) {
      const u = (i / NU) ** 1.35, t = airfoil(u);
      push(ribPoint(s, u, t * 0.8), c, end ? 0.9 : 1); push(ribPoint(s, Math.max(u, 0.07), -t * 0.2), c, end ? 0.9 : 1);
    }
    for (let i = 0; i < NU; i++) { const a = start + i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Ripstop nylon: a soft, slightly glossy fabric.
  const wing = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
  wing.castShadow = true; wing.receiveShadow = true;
  // The wing's own pivot is the middle of its underside, so it can be scaled as it inflates.
  const pivot = new THREE.Group(); pivot.position.set(0, LINE, 0);
  wing.position.set(0, -LINE, 0);
  pivot.add(wing); group.add(pivot);
  // Line attachments: four along each rib (A, B, C, D) on the bottom skin.
  const ribs = [];
  for (let r = 0; r <= CELLS; r++) { const s = r / CELLS * 2 - 1; ribs.push({ left: s > 0, pts: [0.1, 0.32, 0.56, 0.8].map((u) => ribPoint(s, u, -airfoil(u) * 0.2)) }); }
  const tails = { left: [0.95, 0.75, 0.55].map((s) => ribPoint(s, 0.99, 0)), right: [-0.95, -0.75, -0.55].map((s) => ribPoint(s, 0.99, 0)) };
  const nSeg = ribs.length * 6 + 4 + 8;
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nSeg * 6), 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x9c9890, transparent: true, opacity: 0.8 }));
  lines.frustumCulled = false;
  group.add(lines);
  // The risers (dark webbing) and the slider (a square of canopy fabric the lines run through).
  const riserGeo = new THREE.BufferGeometry();
  riserGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 6), 3));
  const risers = new THREE.LineSegments(riserGeo, new THREE.LineBasicMaterial({ color: 0x1a1c20 }));
  risers.frustumCulled = false; group.add(risers);
  const slider = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8231d, roughness: 0.7, side: THREE.DoubleSide }));
  group.add(slider);
  // The deployment bag, seen for a moment as the lines stretch out.
  const bag = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.22, 0.2, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0x1d2633, roughness: 0.8 }));
  group.add(bag);
  return { group, pivot, wing, lines, risers, slider, ribs, tails, bag };
}

// The container on his back: a rounded black pack with a red handle at the bottom.
function buildPack() {
  const g = new THREE.Group();
  g.userData.dynamic = true;
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.5, 0.17, 3, 0.05), new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.7 }));
  body.castShadow = true; g.add(body);
  const flap = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.08, 0.04, 2, 0.015), new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.6 }));
  flap.position.set(0, 0.14, -0.09); g.add(flap);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc8231d, roughness: 0.5 }));
  handle.position.set(-0.06, -0.24, -0.06); g.add(handle);
  return g;
}

// Bones by name (the person model is on a Mixamo rig).
export function bonesOf(man) {
  const bone = {};
  man.traverse((o) => { if (o.isBone) bone[o.name.replace(/_\d+$/, '').replace(/^mixamorig:?/, '')] = o; });
  return bone;
}
// Put the pack and helmet on a man, each frame, from his bones (world space, whatever his rig).
const _l = V(), _u = V(), _f = V();
export function fitGear(bone, pack, helmet) {
  if (!bone) return;
  if (pack) {
    _l.copy(wpos(bone.LeftArm)).sub(wpos(bone.RightArm)).normalize();
    _u.copy(wpos(bone.Neck)).sub(wpos(bone.Hips)).normalize();
    _f.crossVectors(_l, _u).normalize();
    _u.crossVectors(_f, _l).normalize();
    pack.position.copy(wpos(bone.Spine1)).lerp(wpos(bone.Spine2), 0.5).addScaledVector(_f, -0.2).addScaledVector(_u, 0.02);
    pack.quaternion.copy(frameQuat(UP, FWD, _u, _f));
  }
  if (helmet) {
    const head = wpos(bone.Head), top = wpos(bone.HeadTop_End), up = top.clone().sub(head), len = up.length();
    up.normalize();
    const fwd = FWD.clone().applyQuaternion(wquat(bone.Head)); fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    helmet.position.copy(head).addScaledVector(up, len * 0.62).addScaledVector(fwd, -0.01);
    helmet.quaternion.copy(frameQuat(UP, FWD, up, fwd));
  }
}

export class Skydiver {
  constructor(scene) {
    this.scene = scene;
    this.state = 'off';
    this.pos = V(); this.vel = V();
    this.heading = 0; this.agl = 0; this.speed = 0;
    this.root = new THREE.Group(); this.root.visible = false; this.root.userData.dynamic = true;
    scene.add(this.root);
    this.canopy = buildCanopy(); this.canopy.group.visible = false; scene.add(this.canopy.group);
    this.pack = buildPack(); this.pack.visible = false; scene.add(this.pack);
    this.helmet = new THREE.Group(); this.helmet.visible = false; this.helmet.userData.dynamic = true; scene.add(this.helmet);
    this.obstacles = null;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.ready = Promise.all([
      loader.loadAsync(`${import.meta.env.BASE_URL}models/person.glb`).then((g) => {
        const man = g.scene;
        man.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
        this.root.add(man);
        this.bone = bonesOf(man);
        this.rest = new Map(Object.values(this.bone).map((o) => [o, o.quaternion.clone()]));
        man.updateMatrixWorld(true);
        this.hipsLocal = this.root.worldToLocal(wpos(this.bone.Hips));
      }),
      loader.loadAsync(`${import.meta.env.BASE_URL}models/helmet.glb`).then((g) => {
        g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.helmet.add(g.scene);
      }),
    ]).then(() => true).catch((e) => { console.warn('Skydiver did not load:', e); return false; });
    this.loaded = false; this.ready.then((ok) => { this.loaded = ok; });
  }

  get active() { return this.state !== 'off'; }
  get falling() { return this.state === 'exit' || this.state === 'freefall'; }
  get kmh() { return Math.round(this.speed * 3.6); }

  // What he lands on: the land, a landform or rock, a roof, or the water.
  floor(x, z) {
    const land = Math.max(groundAt(x, z), this.obstacles ? this.obstacles.topAt(x, z) : -Infinity);
    const wl = waterLevelAt(x, z);
    return land < wl - 0.3 ? { y: wl, water: true } : { y: land, water: false };
  }

  // Off the helicopter's side door, facing out, carrying its speed.
  start(heli) {
    const h = heli.heading, lx = Math.cos(h), lz = -Math.sin(h); // its left
    this.pos.set(heli.pos.x + lx * 1.5, heli.pos.y + 0.9, heli.pos.z + lz * 1.5);
    this.vel.set(heli.vel.x + lx * 2.6, heli.vel.y, heli.vel.z + lz * 2.6);
    this.heading = Math.atan2(lx, lz);
    this.state = 'exit'; this.t = 0;
    this.d = 0; this.auto = false; this.prompted = false;
    this.bank = 0; this.toggles = [0, 0]; this.yaw = 0;
    this.tilt = { track: 0, flat: 0, roll: 0 };
    this.cn = { V: 1, gam: 0, r: 0, phi: 0, theta: 0, brel: 0, side: 0, tl: 0, tr: 0, rf: 0, f: 0 };
    this.collapse = -1;
    this.root.visible = true; this.pack.visible = true; this.helmet.visible = true;
    this.canopy.group.visible = false;
    this.agl = this.pos.y - this.floor(this.pos.x, this.pos.z).y;
    this.events = [];
  }

  open(auto = false) {
    if (!this.falling) return false;
    this.state = 'deploy'; this.t = 0; this.d = 0; this.auto = auto;
    // The canopy takes over from the body: its flight path from the way he was moving through the
    // air, his body still face down (brel) and rolled as he was, the canopy a little off heading.
    const F = V().set(Math.sin(this.heading), 0, Math.cos(this.heading)), L = V().set(F.z, 0, -F.x);
    const w = this.windNow || V(), va = this.vel.clone().sub(w), along = va.dot(F);
    const pitch = 0.08 - 0.2 * clamp(this.tilt.track, 0, 1) + 0.06 * clamp(this.tilt.flat, 0, 1);
    this.cn = { V: Math.max(2, Math.hypot(along, va.y)), gam: Math.atan2(va.y, Math.max(0.1, along)), r: (Math.random() - 0.5) * 0.5, phi: this.tilt.roll * 0.35, theta: 0, brel: Math.PI / 2 - pitch, side: va.dot(L), tl: 0.5, tr: 0.5, rf: 0, f: 0 };
    this.stowed = true; this.stowedT = 1;
    this.canopy.group.visible = true;
    this.events.push({ type: 'open', auto, agl: Math.round(this.agl) });
    return true;
  }

  // The nearest spot he can stand on: dry, not a roof, not too steep. Rings outward to maxR.
  standable(x, z, maxR = 400) {
    const ok = (px, pz) => {
      const land = heightAt(px, pz), wl = waterLevelAt(px, pz);
      if (land < wl - 0.2) return false;
      const g = groundAt(px, pz), top = this.obstacles ? this.obstacles.topAt(px, pz) : -Infinity;
      if (top > g + 0.4) return false;
      const sl = Math.max(Math.abs(groundAt(px + 1.5, pz) - groundAt(px - 1.5, pz)), Math.abs(groundAt(px, pz + 1.5) - groundAt(px, pz - 1.5))) / 3;
      return sl < 0.7;
    };
    if (ok(x, z)) return { x, z, moved: false };
    for (let r = 3; r <= maxR; r += r < 60 ? 3 : r < 400 ? 8 : 20) {
      const n = Math.max(12, Math.min(48, Math.round(r / 3)));
      let best = null;
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) { best = { x: px, z: pz, moved: true }; break; } }
      if (best) return best;
    }
    return null;
  }

  // Each frame. input: { throttle, steer, open } ; returns the events of this frame.
  update(dt, input, wind) {
    const ev = this.events = [];
    if (this.state === 'off') { this.animateCollapse(dt); return ev; }
    if (dt <= 0) { this.pose(0); return ev; }
    this.t += dt;
    const fwd = input?.throttle || 0, turn = input?.steer || 0;
    if (input?.open && this.falling) this.open(false);
    const wx = wind ? wind.x * 0.6 : 0, wz = wind ? wind.z * 0.6 : 0;
    (this.windNow ||= V()).set(wx, 0, wz);
    // Sub-steps of at most a metre and 1/120 s, so contact is never skipped and the springs and
    // pendulums below stay steady at any frame rate.
    const n = Math.max(1, Math.ceil(Math.hypot(this.vel.x, this.vel.y, this.vel.z) * dt / 1.0), Math.ceil(dt * 120));
    const h = dt / n;
    for (let s = 0; s < n && this.state !== 'landed' && this.state !== 'off'; s++) {
      this.step(h, fwd, turn, wx, wz);
      if (this.contact()) break;
    }
    if (this.state === 'landed') this.landing(dt, wx, wz);
    this.speed = this.vel.length();
    this.pose(dt);
    this.animateCollapse(dt);
    return ev;
  }

  // A critically damped (or lightly underdamped) spring: obj[key] towards target, at natural
  // frequency w and damping ratio z. Smooth, with no kinks, whatever the input does.
  spring(obj, key, target, w, z, h) {
    const v = key + 'V';
    const vel = obj[v] || 0;
    obj[v] = vel + (w * w * (target - (obj[key] || 0)) - 2 * z * w * vel) * h;
    obj[key] = obj[key] || 0;
    obj[key] += obj[v] * h;
  }

  // The wing's lift and drag coefficients for the toggles (tl, tr: 0 up to 1 at the hips) and the
  // front risers (rf), blended between trim, full brakes and full risers. One toggle down drags
  // that side (the turn) and adds a little to both.
  coeffs(tl, tr, rf) {
    const b = Math.min(tl, tr) + 0.3 * Math.abs(tl - tr), bb = Math.pow(clamp(b, 0, 1), 1.2), k = rf * (1 - b);
    return {
      cl: AERO.cl[0] + (AERO.cl[1] - AERO.cl[0]) * bb + (AERO.cl[2] - AERO.cl[0]) * k,
      cd: AERO.cd[0] + (AERO.cd[1] - AERO.cd[0]) * Math.pow(clamp(b, 0, 1), 1.6) + (AERO.cd[2] - AERO.cd[0]) * k + 0.07 * Math.abs(tl - tr),
      b,
    };
  }

  step(h, fwd, turn, wx, wz) {
    const st = this.state;
    const F = V().set(Math.sin(this.heading), 0, Math.cos(this.heading)), Lh = V().set(F.z, 0, -F.x);
    if (st === 'exit' || st === 'freefall') {
      if (st === 'exit' && this.t > 0.8) this.state = 'freefall';
      const k = st === 'exit' ? 0.3 : 1; // a moment to settle before the controls bite
      // Body position changes are springs (arms and legs take a moment to move), and a turn builds
      // up and dies away (a body has inertia), so free fall never snaps.
      this.spring(this.tilt, 'track', Math.max(0, fwd) * k, 5, 1, h);
      this.spring(this.tilt, 'flat', Math.max(0, -fwd) * k, 5, 1, h);
      this.yaw += (turn * k * 1.35 - this.yaw) * Math.min(1, h / 0.45);
      this.spring(this.tilt, 'roll', clamp(this.yaw / 1.35, -1, 1), 6, 0.9, h);
      this.heading = wrap(this.heading + this.yaw * h);
      const tk = clamp(this.tilt.track, 0, 1), fl = clamp(this.tilt.flat, 0, 1);
      const vt = lerp(lerp(VT.box, VT.track, tk), VT.flat, fl);
      const vy = -this.vel.y;
      this.vel.y -= G * (1 - Math.sign(vy) * (vy / vt) ** 2) * h;
      // Sideways: the air slows him to the wind's drift; tracking drives him forward.
      const tx = wx + F.x * TRACK * tk, tz = wz + F.z * TRACK * tk;
      const rate = 0.35 + 0.4 * tk;
      this.vel.x += (tx - this.vel.x) * Math.min(1, h * rate); this.vel.z += (tz - this.vel.z) * Math.min(1, h * rate);
      // The automatic opener, and the prompt: the ground under him or ahead along his path.
      let g = this.floor(this.pos.x, this.pos.z).y;
      for (const t of [1, 2, 3]) g = Math.max(g, this.floor(this.pos.x + this.vel.x * t, this.pos.z + this.vel.z * t).y);
      const above = this.pos.y - g, fall = Math.max(0, -this.vel.y);
      if (!this.prompted && above < OPEN_PROMPT && this.t > 1.5) { this.prompted = true; this.events.push({ type: 'prompt' }); }
      // (An opening takes about 130 m from full speed: this leaves the canopy flying 40 m up or more.)
      if (above < fall * DEPLOY_T * 0.8 + 60) { this.open(true); }
    } else if (st === 'deploy' || st === 'canopy') {
      // ---- The canopy in flight: a wing on a pendulum. ----
      // Controls: hands pull the toggles (both down: brakes; one: a turn) and push the front risers,
      // each a spring, so a key press becomes a smooth pull of about half a second. The canopy
      // opens with its brakes stowed (half brakes); they are released once it flies.
      const C = this.cn;
      const stowed = this.stowed ? 0.5 : 0;
      // Holding the brakes pulls both toggles down progressively, about a second to the hips, as a
      // canopy pilot flares: the lift builds as the speed bleeds off, and the wing planes out.
      // Letting go, the hands go back up faster.
      const bkT = Math.max(0, -fwd);
      C.bk = (C.bk || 0) + clamp(bkT - (C.bk || 0), -2.2 * h, 0.95 * h);
      const tlT = Math.max(stowed, C.bk, Math.max(0, turn)), trT = Math.max(stowed, C.bk, Math.max(0, -turn));
      this.spring(C, 'tl', tlT, 9, 1, h); this.spring(C, 'tr', trT, 9, 1, h);
      this.spring(C, 'rf', st === 'canopy' ? Math.max(0, fwd) : 0, 6, 1, h);
      C.tl = clamp(C.tl, 0, 1); C.tr = clamp(C.tr, 0, 1); C.rf = clamp(C.rf, 0, 1);
      this.toggles[0] = C.tl; this.toggles[1] = C.tr;
      // Opening: the pilot chute drags the bag out until line stretch, then the canopy inflates,
      // slowed by the slider so the opening shock stays near 3 g.
      let fe = 1, extraCD = 0;
      if (st === 'deploy') {
        if (this.t > LINE_STRETCH) C.f = Math.min(1, C.f + h / INFLATE);
        fe = smooth(0, 1, C.f);
        extraCD = 1.1 * 4 * fe * (1 - fe); // a half-open canopy is mostly drag
        this.d = this.t < LINE_STRETCH ? 0.2 * this.t / LINE_STRETCH : 0.2 + 0.8 * C.f; // for the visuals
        if (C.f >= 1) { this.state = 'canopy'; this.events.push({ type: 'flying' }); this.stowedT = 0.7; }
      } else if (this.stowed) { this.stowedT -= h; if (this.stowedT <= 0) this.stowed = false; }
      const co = this.coeffs(C.tl, C.tr, C.rf);
      // Pulling the brakes first pitches the wing nose up (more lift at once); the drag of the
      // deflected tail builds over about 0.4 s. That is what lets a flare plane out for a moment.
      C.cdl = C.cdl == null ? co.cd : C.cdl + (co.cd - C.cdl) * Math.min(1, h / (co.cd > C.cdl ? 0.4 : 0.3));
      const q = 0.5 * AERO.rho * C.V * C.V * AERO.S;
      let Lf = q * co.cl * fe * fe, Df = q * (C.cdl * fe + extraCD) + (st === 'deploy' && this.t <= LINE_STRETCH ? 0.5 * AERO.rho * C.V * C.V * 0.25 : 0);
      const cap = 3.2 * AERO.m * G, tot = Math.hypot(Lf, Df);
      if (tot > cap) { Lf *= cap / tot; Df *= cap / tot; }
      // Turning: the toggle difference yaws the wing, the faster it flies the quicker; held down a
      // while, the bank deepens, the wing drops its nose and speeds up, and the turn tightens itself
      // (a spiral). The edge of the map turns it gently back.
      const delta = C.tl - C.tr, Vh = Math.max(1, C.V * Math.cos(C.gam));
      const spiral = 0.9 * clamp((Math.abs(C.phi) - 0.45) / 0.5, 0, 1);
      const m = 400, ox = Math.max(0, BOUNDS.minX - m - this.pos.x) - Math.max(0, this.pos.x - BOUNDS.maxX - m), oz = Math.max(0, BOUNDS.minZ - m - this.pos.z) - Math.max(0, this.pos.z - BOUNDS.maxZ - m);
      const edge = ox || oz ? clamp(wrap(Math.atan2(ox, oz) - this.heading), -0.5, 0.5) : 0;
      const rCmd = clamp(1.15 * delta * (Vh / 10.5) * (1 - 0.4 * co.b) * (1 + spiral) + edge, -2.4, 2.4) * fe;
      C.r += (rCmd - C.r) * Math.min(1, h / 0.55);
      this.heading = wrap(this.heading + C.r * h);
      // The pendulums: he hangs 5 m under the wing. Sideways he swings out into the bank a turn
      // needs (tan bank = speed x turn rate / g), lagging a little and settling without a jolt;
      // fore and aft he swings against the wing's surges (forward when it brakes, back when it dives).
      const phiEq = -Math.atan(Vh * C.r / G);
      this.spring(C, 'phi', phiEq, 1.7, 0.55, h);
      C.phi = clamp(C.phi, -1.15, 1.15);
      // Flight path: speed along it, and the angle it makes with the horizontal. Lift (tilted by the
      // bank) bends the path up; gravity bends it down and drives the speed; drag slows it. So a
      // quick pull of both toggles near the ground turns the speed into lift and levels the path for a
      // moment (the flare), and a bank sinks it faster.
      const Vprev = C.V * Math.cos(C.gam);
      const dV = -Df / AERO.m - G * Math.sin(C.gam);
      // Pitch damping: as the path curves up the wing meets the air at a smaller angle and lifts
      // less, and more as it curves down, so a flare planes out instead of ballooning and dropping.
      const Ld = Lf * clamp(1 - 0.45 * (C.dGam || 0), 0.5, 1.5);
      const dGam = (Ld * Math.cos(C.phi) - AERO.m * G * Math.cos(C.gam)) / (AERO.m * Math.max(1.5, C.V));
      C.dGam = dGam;
      C.V = Math.max(1.5, C.V + dV * h);
      C.gam = clamp(C.gam + dGam * h, -Math.PI * 0.55, 0.6);
      const aH = (C.V * Math.cos(C.gam) - Vprev) / h;
      this.spring(C, 'theta', clamp(aH / G, -0.7, 0.7) * fe, 1.4, 0.35, h);
      // His body swings from belly-down to hanging under the lines once they stretch.
      if (st === 'deploy' && this.t > LINE_STRETCH) this.spring(C, 'brel', 0, 2.6, 0.5, h);
      else if (st === 'canopy') this.spring(C, 'brel', 0, 2.6, 0.5, h);
      C.side *= Math.exp(-h / 0.8); // any sideways slip dies away
      this.bank = C.phi;
      const vh = C.V * Math.cos(C.gam);
      this.vel.set(F.x * vh + Lh.x * C.side + wx, C.V * Math.sin(C.gam), F.z * vh + Lh.z * C.side + wz);
    }
    this.pos.addScaledVector(this.vel, h);
  }

  // Touching down: whatever is under his feet (or his belly, falling).
  contact() {
    const f = this.floor(this.pos.x, this.pos.z), flying = this.state === 'canopy' || this.state === 'deploy';
    this.agl = this.pos.y - (flying ? HIP : 0.35) - f.y;
    if (this.agl > 0) return false;
    const vy = -this.vel.y, hs = Math.hypot(this.vel.x, this.vel.z);
    // How it went: a gentle touchdown is run out on his feet; a firmer one bends his knees deep
    // first; a fast one (or one still falling) is a forward roll.
    // (An unflared canopy comes in at 4.6 m/s down; a good flare at 3 to 4 m takes that to under 1.5.)
    const kind = this.state !== 'canopy' || vy >= 4.2 || hs >= 11 ? 'hard' : vy >= 3 ? 'firm' : 'soft';
    // Anywhere he cannot stand (water, a roof, a steep slope), he is put on the nearest ground he can.
    const ok = this.standable(this.pos.x, this.pos.z, 0);
    const spot = ok || this.standable(this.pos.x, this.pos.z, f.water ? 3000 : 400) || { x: this.pos.x, z: this.pos.z, moved: false };
    this.state = 'landed'; this.t = 0;
    this.landKind = kind; this.landedSoft = kind !== 'hard'; this.water = f.water;
    this.spot = { x: spot.x, z: spot.z, y: groundAt(spot.x, spot.z), moved: spot.moved };
    // The run-out: along the way he was moving over the ground, at that speed.
    this.run = kind === 'hard' ? hs * 0.35 : hs;
    this.runDir = hs > 0.1 ? V().set(this.vel.x / hs, 0, this.vel.z / hs) : V().set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.crouch = kind === 'firm' ? 1 : kind === 'soft' ? clamp(vy / 3, 0.15, 0.65) : 0; this.crouchV = 0;
    this.stride = 0;
    this.pos.y = f.y + (kind === 'hard' ? 0.45 : HIP);
    // The canopy flies on past him, then sinks and settles.
    this.wingAt = wpos(this.bone.Spine2).add(V().set(0, LINE, 0).applyQuaternion(this.canopy.group.quaternion));
    this.wingVel = this.vel.clone();
    this.vel.set(0, 0, 0);
    this.events.push({ type: 'touchdown', kind, soft: kind !== 'hard', water: f.water, moved: spot.moved, vy: +vy.toFixed(1), hs: +hs.toFixed(1), roof: !f.water && this.obstacles && this.obstacles.topAt(this.pos.x, this.pos.z) > heightAt(this.pos.x, this.pos.z) + 0.4 });
    this.collapse = 0; this.collapseHeading = this.heading;
    if (f.water || spot.moved) this.canopy.group.visible = false;
    return true;
  }

  // On the ground: running out the speed (steps in time with it, knees giving and straightening),
  // or rolling; then he is down and on his feet.
  landing(dt) {
    if (this.water || this.spot.moved) { if (this.t > 0.1) this.finish(); return; }
    const kind = this.landKind;
    if (kind === 'hard') {
      this.run = Math.max(0, this.run - 3 * dt);
      this.step2(this.runDir, this.run * dt);
      this.pos.y = this.floor(this.pos.x, this.pos.z).y + 0.45;
      if (this.t >= 1.0) this.finish();
      return;
    }
    this.run = Math.max(0, this.run - (kind === 'firm' ? 6.5 : 5.5) * dt);
    this.step2(this.runDir, this.run * dt);
    this.stride += this.run * dt / 0.95;
    // Knees: held a moment, then straightening.
    if (this.t > (kind === 'firm' ? 0.3 : 0.15)) this.spring(this, 'crouch', 0, 6, 1, dt);
    this.pos.y = this.floor(this.pos.x, this.pos.z).y + HIP - this.crouch * 0.38;
    if (this.run < 0.05 && this.crouch < 0.04 && this.t > 0.6) this.finish();
  }
  // Move along the ground, stopping at anything too tall to step onto.
  step2(dir, d) {
    if (d <= 0) return;
    const nx = this.pos.x + dir.x * d, nz = this.pos.z + dir.z * d;
    if (this.floor(nx, nz).y > this.floor(this.pos.x, this.pos.z).y + 0.4) { this.run = 0; return; }
    this.pos.x = nx; this.pos.z = nz;
  }
  finish() {
    // Where he stands: here, unless he was set somewhere else (water, a roof, a slope).
    if (!this.spot.moved) {
      const s = this.standable(this.pos.x, this.pos.z, 400) || { x: this.pos.x, z: this.pos.z, moved: false };
      this.spot = { x: s.x, z: s.z, y: groundAt(s.x, s.z), moved: s.moved };
    }
    this.state = 'off';
    this.root.visible = false;
    this.canopy.lines.visible = this.canopy.risers.visible = this.canopy.slider.visible = false;
    this.events.push({ type: 'down', spot: this.spot, heading: this.heading, soft: this.landKind !== 'hard', kind: this.landKind, water: this.water });
  }

  // Put everything away (boarded, travelled, switched).
  stop() {
    this.state = 'off'; this.root.visible = false; this.canopy.group.visible = false;
    this.pack.visible = false; this.helmet.visible = false; this.collapse = -1;
  }

  // The canopy after touchdown: it carries on over his head with the speed it had, losing it to
  // drag, sinks as it loses its pressure, nods forward as it comes down and lies flat on the
  // ground, deflated. It is packed away a while later.
  animateCollapse(dt) {
    if (this.collapse < 0) return;
    this.collapse += dt;
    const c = this.canopy, t = this.collapse;
    if (!c.group.visible) { this.collapse = -1; return; }
    const w = this.wingAt, v = this.wingVel;
    v.x *= Math.exp(-dt / 0.7); v.z *= Math.exp(-dt / 0.7);
    v.y = Math.max(-3.5, v.y - 2.6 * dt);
    w.addScaledVector(v, dt);
    const gy = this.floor(w.x, w.z).y + 0.12;
    if (w.y <= gy) { w.y = gy; v.set(0, 0, 0); }
    c.group.position.copy(w);
    const nod = 0.45 * Math.sin(Math.PI * clamp(t / 1.8, 0, 1));
    c.group.quaternion.setFromAxisAngle(UP, this.collapseHeading).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), nod));
    c.pivot.position.set(0, 0, 0); c.pivot.rotation.set(0, 0, 0);
    const k = smooth(0.15, 1.7, t);
    c.pivot.scale.set(lerp(1, 0.92, k), lerp(1, 0.07, k), lerp(1, 0.95, k));
    c.lines.material.opacity = 0.8 * (1 - smooth(0.6, 1.4, t));
    if (t > 1.4) c.lines.visible = c.risers.visible = c.slider.visible = false;
    if (t > 9) { c.group.visible = false; this.collapse = -1; }
  }

  // ---------- The body, posed by hand ----------
  // frame: the jumper's own axes. T: from hips to head; B: the way his belly faces; L: his left.
  placeBody(T, B) {
    this.root.quaternion.copy(frameQuat(UP, FWD, T, B));
    this.root.position.set(0, 0, 0); this.root.updateMatrixWorld(true);
    const hip = wpos(this.bone.Hips);
    this.root.position.copy(this.pos).sub(hip);
    this.root.updateMatrixWorld(true);
  }
  pose(dt) {
    if (!this.bone || this.state === 'off') return;
    const bone = this.bone, C = this.cn;
    for (const [o, q] of this.rest) o.quaternion.copy(q);
    const F = V().set(Math.sin(this.heading), 0, Math.cos(this.heading)), U = UP.clone();
    const st = this.state;
    const tk = clamp(this.tilt.track, 0, 1), fl = clamp(this.tilt.flat, 0, 1);
    // How flat he is: 0 hanging (in the door, under the canopy), 1 face down in free fall.
    let flat = 0, Tq, Bq;
    if (st === 'exit' || st === 'freefall') {
      flat = st === 'exit' ? smooth(0.05, 0.75, this.t) : 1;
      // Free-fall body frame: torso along the heading (head a little up), belly down, rolled for turns.
      const pitch = 0.08 - 0.2 * tk + 0.06 * fl;
      const T = F.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(U, Math.sin(pitch));
      let B = U.clone().multiplyScalar(-Math.cos(pitch)).addScaledVector(F, Math.sin(pitch));
      const roll = this.tilt.roll * 0.35;
      B = B.clone().multiplyScalar(Math.cos(roll)).addScaledVector(V().crossVectors(T, B), Math.sin(roll)).normalize();
      // In the door he stands, then rolls into it.
      const Tc = U.clone(), Bc = F.clone();
      Tq = T.clone().lerp(Tc, 1 - flat).normalize(); Bq = B.clone().lerp(Bc, 1 - flat).normalize();
    } else {
      // Under the lines: banked with the turn (phi, about his forward axis) and pitched by the fore
      // and aft swing plus, while the canopy opens, how far he still is from hanging (brel).
      let phi = C.phi, beta = C.theta + C.brel;
      if (st === 'landed') {
        const k = smooth(0, 0.4, this.t);
        phi = lerp(C.phi, 0, k);
        beta = this.landKind === 'hard' ? lerp(beta, 0.2, k) : lerp(beta, 0.12 + this.crouch * 0.28 + Math.min(this.run, 6) * 0.03, k);
      }
      flat = clamp(C.brel / (Math.PI / 2), 0, 1);
      const Uc = U.clone().applyAxisAngle(F, phi);
      Tq = Uc.clone().multiplyScalar(Math.cos(beta)).addScaledVector(F, Math.sin(beta)).normalize();
      Bq = F.clone().multiplyScalar(Math.cos(beta)).addScaledVector(Uc, -Math.sin(beta)).normalize();
    }
    Bq.addScaledVector(Tq, -Bq.dot(Tq)).normalize();
    this.placeBody(Tq, Bq);
    const Lb = V().crossVectors(Tq, Bq); // his left, in this pose
    const bd = (t, b, l) => V().addScaledVector(Tq, t).addScaledVector(Bq, b).addScaledVector(Lb, l).normalize();
    const blend = (bn, child, target, w) => {
      if (w <= 0.001) return;
      const cur = wpos(child).sub(wpos(bn)).normalize();
      aim(bn, child, cur.lerp(target, w).normalize());
    };
    // Head: in free fall the crown points ahead and up, so he looks at the horizon.
    blend(bone.Neck, bone.Head, bd(0.85, -0.5, 0), flat * 0.6);
    blend(bone.Head, bone.HeadTop_End, bd(0.62, -0.78, 0), flat);
    const onFeet = st === 'landed' && this.landKind !== 'hard';
    for (const side of ['Left', 'Right']) {
      const s = side === 'Left' ? 1 : -1;
      // Free fall: arms out and bent forward (the box), swept back to track, further forward to slow.
      const upper = bd(lerp(lerp(0.22, -0.85, tk), 0.55, fl), -0.3, s * lerp(lerp(0.93, 0.35, tk), 0.8, fl));
      const fore = bd(lerp(lerp(0.95, -0.95, tk), 0.85, fl), lerp(-0.2, -0.12, tk), s * lerp(-0.08, 0.15, tk));
      const thigh = bd(lerp(-0.9, -0.98, tk), -0.18, s * lerp(lerp(0.34, 0.12, tk), 0.48, fl));
      const shin = bd(lerp(-0.12, -0.97, tk), lerp(-0.98, -0.12, tk), s * 0.1);
      if (flat > 0) {
        blend(bone[side + 'Arm'], bone[side + 'ForeArm'], upper, flat);
        blend(bone[side + 'ForeArm'], bone[side + 'Hand'], fore, flat);
        blend(bone[side + 'UpLeg'], bone[side + 'Leg'], thigh, flat);
        blend(bone[side + 'Leg'], bone[side + 'Foot'], shin, flat);
        blend(bone[side + 'Foot'], bone[side + 'ToeBase'], bd(-0.8, -0.45, 0), flat);
      }
      if (flat < 1) {
        // Under the canopy: hands on the toggles at the rear risers, pulled down to turn or flare;
        // legs hanging, knees a little bent, together and forward for the landing. On the ground he
        // lets go and his arms come down to his sides.
        const w = 1 - flat, tg = st === 'canopy' || st === 'landed' || st === 'deploy' ? this.toggles[s > 0 ? 0 : 1] : 0;
        const sh = wpos(bone[side + 'Arm']);
        const high = sh.clone().addScaledVector(Tq, 0.3).addScaledVector(Lb, s * 0.12).addScaledVector(Bq, 0.1);
        const low = wpos(bone.Hips).addScaledVector(Tq, 0.12).addScaledVector(Lb, s * 0.24).addScaledVector(Bq, 0.12);
        const hand = high.lerp(low, tg);
        if (st === 'landed') hand.lerp(wpos(bone.Hips).addScaledVector(Tq, -0.18).addScaledVector(Lb, s * 0.3).addScaledVector(Bq, 0.06), smooth(0.25, 0.9, this.t));
        if (w >= 0.999) reach(bone[side + 'Arm'], bone[side + 'ForeArm'], bone[side + 'Hand'], hand, V().addScaledVector(Lb, s).addScaledVector(Bq, -0.3).normalize());
        else blend(bone[side + 'Arm'], bone[side + 'ForeArm'], V().subVectors(hand, sh).normalize(), w);
        if (onFeet) {
          // On his feet: each foot on the ground, stepping in turn while he runs out his speed;
          // the knees bend as the hips come down.
          const gy = this.floor(this.pos.x, this.pos.z).y, ph = this.stride * Math.PI + (s > 0 ? 0 : Math.PI);
          const amp = clamp(this.run / 4, 0, 1);
          const along = Math.sin(ph) * 0.42 * amp + 0.05, lift = Math.max(0, Math.cos(ph)) * 0.16 * amp;
          const hip = wpos(bone[side + 'UpLeg']);
          const foot = V().set(hip.x, gy + 0.09 + lift, hip.z).addScaledVector(F, along).addScaledVector(V().crossVectors(U, F), s * 0.04);
          reach(bone[side + 'UpLeg'], bone[side + 'Leg'], bone[side + 'Foot'], foot, F);
          aim(bone[side + 'Foot'], bone[side + 'ToeBase'], V().addScaledVector(F, 1).addScaledVector(U, -0.25).normalize());
        } else {
          const ready = st === 'canopy' ? clamp(1 - (this.agl - 2) / 10, 0, 1) : st === 'landed' ? 1 : 0;
          blend(bone[side + 'UpLeg'], bone[side + 'Leg'], bd(-0.9, lerp(0.28, 0.4, ready), s * lerp(0.1, 0.04, ready)), w);
          blend(bone[side + 'Leg'], bone[side + 'Foot'], bd(-1, lerp(-0.12, 0.05, ready), 0), w);
        }
        // Fists round the toggles (relaxing once he lets go).
        const grip = st === 'landed' ? 1 - smooth(0.25, 0.9, this.t) : 1;
        for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (const j of [1, 2, 3]) {
          const b = bone[side + 'Hand' + f + j], nx = bone[side + 'Hand' + f + (j + 1)];
          if (!b || !nx) continue;
          const d = V().subVectors(wpos(nx), wpos(b)).normalize(), ax = V().crossVectors(d, Lb.clone().multiplyScalar(-s));
          if (ax.lengthSq() < 1e-6) continue;
          turnWorld(b, ax.normalize(), CURL[j - 1] * w * 0.8 * grip);
        }
      }
    }
    // A hard landing: a forward roll about his left-right axis.
    if (st === 'landed' && this.landKind === 'hard' && !this.water) {
      const k = clamp(this.t / 1.0, 0, 1), turn = Math.PI * 2 * smooth(0, 1, k);
      const Lw = V().crossVectors(UP, F).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(Lw, turn);
      this.root.quaternion.premultiply(q);
      this.root.position.set(0, 0, 0); this.root.updateMatrixWorld(true);
      const centre = this.pos.clone().setY(this.pos.y + Math.sin(turn / 2) * 0.1), spine = wpos(this.bone.Spine1);
      this.root.position.copy(centre).sub(spine);
      this.root.updateMatrixWorld(true);
    }
    fitGear(bone, this.pack, this.helmet);
    this.placeCanopy();
  }

  // The canopy over his head: on the lines from the harness, banked and swinging with him,
  // inflating as it opens (the wing itself stays nearly level as he swings under it); its lines
  // run to his shoulders and the steering lines to his hands.
  placeCanopy() {
    const c = this.canopy, st = this.state, C = this.cn;
    if (!c.group.visible || st === 'off') return;
    const bone = this.bone;
    const harness = wpos(bone.Spine2);
    const d = st === 'deploy' ? this.d : 1;
    if (this.collapse < 0) {
      c.group.position.copy(harness);
      const X = new THREE.Vector3(1, 0, 0);
      c.group.quaternion.setFromAxisAngle(UP, this.heading).multiply(new THREE.Quaternion().setFromAxisAngle(FWD, C.phi)).multiply(new THREE.Quaternion().setFromAxisAngle(X, C.theta));
      // Opening: the bag rides up on the pilot chute as the lines pay out; at line stretch the
      // canopy spreads and inflates.
      const up = smooth(0, 0.2, d), spread = smooth(0.2, 1, d), settle = Math.sin(clamp((d - 0.7) / 0.3, 0, 1) * Math.PI) * 0.05;
      c.pivot.position.set(0, lerp(0.3, LINE, up), 0);
      const co = this.coeffs(C.tl, C.tr, C.rf);
      c.pivot.rotation.set(-C.theta * 0.85 - 0.12 * co.b + 0.08 * C.rf, 0, 0);
      c.pivot.scale.set(lerp(0.06, 1, spread) + settle, lerp(0.15, 1, spread), lerp(0.25, 1, spread));
      c.wing.visible = d > 0.12;
      c.bag.visible = d < 0.3;
      c.bag.position.set(0, lerp(0.3, LINE + 0.6, up) + (d > 0.2 ? (d - 0.2) * 6 : 0), -0.2);
      c.lines.visible = d > 0.05; c.lines.material.opacity = 0.8;
    }
    if (!c.lines.visible) return;
    c.group.updateMatrixWorld(true);
    // Lines: from the rib attachments (through the wing's pivot) into cascades, then to the tops of
    // the risers, which run down to his shoulders; the steering lines gather to his hands.
    const inv = c.group.matrixWorld.clone().invert();
    const shL = wpos(bone.LeftArm).applyMatrix4(inv), shR = wpos(bone.RightArm).applyMatrix4(inv);
    const handL = wpos(bone.LeftHand).applyMatrix4(inv), handR = wpos(bone.RightHand).applyMatrix4(inv);
    const rise = lerp(0.12, 0.55, smooth(0.3, 0.9, d)); // the slider comes down as it opens
    // The riser tops: above his shoulders along the lines (in the canopy's own frame, up is along them).
    const top = (sh, f) => sh.clone().add(V().set(0, 0.55, f));
    const tops = { left: [top(shL, 0.07), top(shL, -0.07)], right: [top(shR, 0.07), top(shR, -0.07)] };
    const P = c.lines.geometry.attributes.position, m = c.pivot.matrix, wm = c.wing.matrix;
    c.pivot.updateMatrix(); c.wing.updateMatrix();
    const W = (p) => p.clone().applyMatrix4(wm).applyMatrix4(m);
    let i = 0;
    const put = (A, a, b) => { A.setXYZ(i++, a.x, a.y, a.z); A.setXYZ(i++, b.x, b.y, b.z); };
    for (const rb of c.ribs) {
      const [pa, pb, pc, pd] = rb.pts.map(W), [front, rear] = tops[rb.left ? 'left' : 'right'];
      const c1 = pa.clone().add(pb).multiplyScalar(0.5).lerp(front, 0.3), c2 = pc.clone().add(pd).multiplyScalar(0.5).lerp(rear, 0.3);
      put(P, pa, c1); put(P, pb, c1); put(P, c1, front); put(P, pc, c2); put(P, pd, c2); put(P, c2, rear);
    }
    for (const [side, hand] of [['left', handL], ['right', handR]]) {
      const tp = c.tails[side].map(W), mid = tp.reduce((a, b) => a.add(b), V()).multiplyScalar(1 / tp.length).lerp(tops[side][1], 0.35);
      for (const t of tp) put(P, t, mid);
      put(P, mid, hand);
    }
    while (i < P.count) P.setXYZ(i++, 0, 0, 0);
    P.needsUpdate = true;
    // Risers and slider.
    const R = c.risers.geometry.attributes.position; i = 0;
    put(R, shL, tops.left[0]); put(R, shL, tops.left[1]); put(R, shR, tops.right[0]); put(R, shR, tops.right[1]);
    R.needsUpdate = true;
    c.slider.position.copy(shL).add(shR).multiplyScalar(0.5).add(V().set(0, rise + 0.02, 0));
    c.slider.visible = d > 0.25 && this.collapse < 0;
    c.risers.visible = c.lines.visible;
  }
}
