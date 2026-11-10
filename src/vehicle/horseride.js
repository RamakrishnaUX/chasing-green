import * as THREE from 'three';
import { groundAt, waterLevelAt } from '../world/terrain.js';
import { clamp, lerp } from '../world/noise.js';
import { reach, aim, wpos } from './driver.js';
import { bonesOf } from './skydiver.js';

// Riding a horse. On foot beside one of the horses grazing in the fields, E (or Ride on a phone)
// puts you in the saddle: it is saddled and bridled, and you sit it with your feet in the stirrups
// and the reins in your hands. Forward walks it on; held, it picks up into a canter and then a
// gallop. The gait follows the speed (the clips are played at the pace it covers the ground, so
// hooves do not skate): a walk to about 2.4 m/s, then the gallop clip, slow for a canter and up to
// a full gallop at 10 m/s (36 km/h). Shift keeps it at a walk. Steering turns it (tighter when
// slow, and on the spot when stopped); back slows it, and once it has stopped, backs it up a few
// steps. Space (a slide up from Go) jumps. It will not go into water deeper than its belly or up a
// slope steeper than it can climb. E again and you get down beside it, and it stays there to graze.
//
// The horse is the wildlife's own animal (its rig and clips, wildlife.js and animalRigs.js), driven
// from here instead of by its herd; the rider is the walker's man, posed in the saddle each frame
// after the horse's rig has moved: hips on the seat, legs reaching to the stirrups, hands to the
// reins above the withers, leaning forward into a gallop.
const WALK = 1.6, TOP = 10, ACCEL = 2.6, DECEL = 3.2, BRAKE = 6.5, BACK = 0.7;
const DEEP = 0.95; // water this deep stops it (belly height)
const STEEP = 0.85; // rise per metre it will not climb
const JUMP_T = 0.85, JUMP_H = 0.75;

// Points on the horse (model at its game size, standing at the origin facing +z): the seat, the
// stirrup irons, and where the hands hold the reins. Each is kept in the frame of the bone it moves
// with (measured from the horse model: the saddle's lowest point along its middle, the irons'
// treads, a hand's width above the withers).
const SEAT = new THREE.Vector3(0, 1.52, -0.17);
const IRON = new THREE.Vector3(0.36, 0.83, -0.08);
const REIN = new THREE.Vector3(0.12, 1.56, 0.33);

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export class HorseRide {
  constructor({ wildlife, walker }) {
    this.wildlife = wildlife; this.walker = walker;
    this.a = null; // the animal being ridden
    this.v = 0; this.held = 0; this.jumpT = -1; this.jumpHeld = false; this.lean = 0; this.blocked = null;
  }
  get on() { return !!this.a; }
  get speed() { return Math.abs(this.v); }

  // The nearest horse within reach of someone standing at pos (to its body, not its middle) that has
  // a full rig (one close enough to be drawn up close), or null.
  near(pos, r = 2.4) {
    let best = null, bd = r;
    for (const a of this.wildlife.animals) {
      if (a.sp !== 'horse' || !a._rig || a.ridden) continue;
      const fx = Math.sin(a.heading), fz = Math.cos(a.heading), dx = pos.x - a.x, dz = pos.z - a.z;
      const along = clamp(dx * fx + dz * fz, -0.9, 0.9), d = Math.hypot(dx - fx * along, dz - fz * along) - 0.42;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  mount(a) {
    this.a = a; a.ridden = true; a.state = 'ride'; a.alert = false; a.hy = 0;
    this.wildlife.ridden = a; this.wildlife.keep(a);
    this.v = 0; this.held = 0; this.jumpT = -1; this.lean = 0; this.blocked = null;
    this.walker.setSitting(false);
    this.walker.root.visible = true;
    this.bones = null; this.seat = null;
  }

  // Off on the side away from the reins' hand (the left, as riders do), a step clear of its body.
  // Returns where to stand.
  dismount() {
    const a = this.a; if (!a) return null;
    const side = a.heading + Math.PI / 2;
    const x = a.x + Math.sin(side) * 1.2, z = a.z + Math.cos(side) * 1.2;
    a.ridden = false; a.state = 'graze'; a.timer = 6; a.hx = a.x; a.hz = a.z; a.moving = false; a.v = 0; a.clip = null; a.dir = 1;
    const A = a._rig; if (A?.tack) for (const m of A.tack) m.visible = false;
    this.wildlife.ridden = null;
    this.wildlife.keep(a); // it stays where you left it, not back in its old field
    this.a = null; this.v = 0;
    return { x, z, heading: a.heading };
  }

  update(dt, input) {
    const a = this.a; if (!a || !dt) return;
    const thr = input.throttle, steer = input.steer;
    // Forward held: a walk, then building to a canter and a gallop; Shift keeps the walk.
    if (thr > 0) this.held += dt; else this.held = Math.max(0, this.held - dt * 4);
    let target = 0;
    if (thr > 0) target = input.walk ? WALK : this.held < 0.7 ? WALK : Math.min(TOP, WALK + (this.held - 0.7) * 3.2);
    else if (thr < 0) target = this.v > 0.3 ? 0 : -BACK;
    const rate = target > this.v ? (this.v < 0 ? BRAKE : ACCEL) : thr < 0 && this.v > 0 ? BRAKE : DECEL;
    this.v += clamp(target - this.v, -rate * dt, rate * dt);
    // Turning: tighter when slow, on the spot when stopped (it walks round).
    const sp = Math.abs(this.v), turn = (sp < 0.2 ? 1.1 : lerp(1.5, 0.7, clamp(sp / TOP, 0, 1))) * steer;
    a.heading += turn * dt;
    // Move, unless the way ahead is too deep or too steep.
    const fx = Math.sin(a.heading), fz = Math.cos(a.heading), step = this.v * dt;
    const nx = a.x + fx * step, nz = a.z + fz * step;
    const g0 = groundAt(a.x, a.z), g1 = groundAt(nx, nz), look = Math.sign(step) * 1.2;
    const ahead = groundAt(a.x + fx * look, a.z + fz * look), deep = waterLevelAt(nx, nz) - g1;
    this.blocked = null;
    if (deep > DEEP) this.blocked = 'deep';
    else if (Math.abs(look) > 0 && (ahead - g0) / Math.abs(look) > STEEP) this.blocked = 'steep';
    if (this.blocked) this.v = 0;
    else { a.x = nx; a.z = nz; }
    // A jump: once per press, at more than a walk.
    const jk = !!input.jump;
    if (jk && !this.jumpHeld && this.jumpT < 0 && this.v > 1.2) this.jumpT = 0;
    this.jumpHeld = jk;
    let lift = 0;
    if (this.jumpT >= 0) { this.jumpT += dt; const u = this.jumpT / JUMP_T; if (u >= 1) this.jumpT = -1; else lift = JUMP_H * Math.sin(Math.PI * u); }
    a.y = groundAt(a.x, a.z) + lift;
    // For its rig (animalRigs.drive): the gait follows the speed; backwards plays the walk in reverse.
    a.moving = sp > 0.05 || Math.abs(steer) > 0.1;
    a.v = Math.max(sp, a.moving ? 0.7 : 0);
    a.dir = this.v < -0.05 ? -1 : 1;
    a.clip = this.jumpT >= 0 ? 'jump' : null;
    a.state = 'ride'; a.alert = false; a.dist = 0;
    this.lean = lerp(this.lean, clamp((this.v - 2) / 8, 0, 1), Math.min(1, dt * 3));
    // The walker goes where the horse goes (camera, wildlife, footprints and the rest follow him).
    const w = this.walker;
    w.pos.set(a.x, a.y, a.z); w.heading = a.heading; w.speedSmooth = sp;
  }

  // Sit the rider: after the horse's rig has been posed this frame.
  pose(dt) {
    const a = this.a, A = a?._rig, w = this.walker;
    if (!A || !w.man) return;
    if (A.tack) for (const m of A.tack) m.visible = true;
    // Bones on the horse that carry the seat, irons and reins, and those points in their frames.
    if (this.seatFor !== A) {
      this.seatFor = A;
      const find = (n) => Object.values(A.bones).find((b) => b.name.startsWith(n));
      const spine = find('BN_Spine_02'), neck = find('BN_Neck_00'), stL = find('BN_L_Stirrup'), stR = find('BN_R_Stirrup');
      // At rest, standing at the origin: the points in each bone's frame.
      const r = A.root, keep = { p: r.position.clone(), q: r.quaternion.clone() };
      A.mixer.stopAllAction(); A.actions.idle.reset().play(); A.mixer.setTime(0);
      r.position.set(0, 0, 0); r.quaternion.identity(); r.updateMatrixWorld(true);
      const local = (b, p) => b.worldToLocal(p.clone());
      this.pts = {
        seat: { b: spine, p: local(spine, SEAT) },
        Left: { b: stL || spine, p: local(stL || spine, IRON) }, Right: { b: stR || spine, p: local(stR || spine, new THREE.Vector3(-IRON.x, IRON.y, IRON.z)) },
        reinL: { b: neck, p: local(neck, REIN) }, reinR: { b: neck, p: local(neck, new THREE.Vector3(-REIN.x, REIN.y, REIN.z)) },
      };
      r.position.copy(keep.p); r.quaternion.copy(keep.q); r.updateMatrixWorld(true);
      A.cur = null; // let its clip be picked again
    }
    const at = (k) => this.pts[k].b.localToWorld(_v.copy(this.pts[k].p)).clone();
    A.root.updateMatrixWorld(true);
    // His own idle underneath (breathing, the head moving a little); legs and arms are placed below.
    if (w.actions) { for (const [n, act] of Object.entries(w.actions)) act.setEffectiveWeight(n === 'idle' ? 1 : 0); w.mixer.update(dt); }
    const B = (this.bones ||= bonesOf(w.man));
    w.man.rotation.set(0, 0, 0); w.man.position.set(0, 0, 0);
    w.root.position.set(a.x, a.y, a.z); w.root.rotation.set(0, a.heading, 0);
    // Leaning forward into the canter and gallop, from the hips.
    B.Hips.quaternion.premultiply(_q.setFromAxisAngle(_w.set(1, 0, 0), 0.08 + this.lean * 0.38));
    if (B.Neck) B.Neck.quaternion.premultiply(_q.setFromAxisAngle(_w.set(1, 0, 0), -this.lean * 0.2));
    w.root.updateMatrixWorld(true);
    // Hips on the seat.
    const seat = at('seat'), hips = wpos(B.Hips);
    w.root.position.add(seat.sub(hips)).add(_w.set(0, 0.09, 0)).add(_v.set(Math.sin(a.heading), 0, Math.cos(a.heading)).multiplyScalar(-0.05));
    w.root.updateMatrixWorld(true);
    const toW = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(_w.set(0, 1, 0), a.heading);
    // Legs round its sides, feet in the irons, heels down; elbows in, hands low on the reins.
    for (const s of ['Left', 'Right']) {
      const out = s === 'Left' ? 1 : -1;
      reach(B[s + 'UpLeg'], B[s + 'Leg'], B[s + 'Foot'], at(s), toW(out * 0.55, 0.1, 1));
      if (B[s + 'ToeBase']) aim(B[s + 'Foot'], B[s + 'ToeBase'], toW(out * 0.25, -0.15, 1).normalize());
      reach(B[s + 'Arm'], B[s + 'ForeArm'], B[s + 'Hand'], at(s === 'Left' ? 'reinL' : 'reinR'), toW(out * 0.6, -0.8, -0.4));
    }
  }
}
