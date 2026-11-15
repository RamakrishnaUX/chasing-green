import * as THREE from 'three';
import { nozzleGeometry, NOZZLE_TAIL, NOZZLE_TIP } from '../world/stations.js';
import { reach, wpos } from './driver.js';
import { bonesOf } from './skydiver.js';

// Filling up by hand. Press Refuel under a station's roof and the driver gets out at his door,
// walks round to the pump, lifts the nozzle out of its holster (its hose coming with it), walks
// back to the car's filler (the side facing the pump; the top of the tank on the bike), and holds
// the nozzle in it while the tank fills. Full (or stopped with Refuel again), he takes it back,
// hangs it up and gets back in. He walks on the walker's own legs and clips (walker.js), steered
// along a few waypoints; only his right arm is posed on top, by reach (driver.js).
//
// Phases: out, toPump, take, toCap, fill, toPump2, hang, toDoor, in.

const HOSE = 3.6; // metres of hose: it hangs slack near the pump and lies on the ground near the car
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (u) => u * u * (3 - 2 * u);

export class RefuelScene {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.phase = '';
    this.nozzle = new THREE.Mesh(nozzleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }));
    this.nozzle.castShadow = true; this.nozzle.visible = false; this.nozzle.matrixAutoUpdate = false;
    this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.55, metalness: 0.1 });
    this.hose = new THREE.Mesh(new THREE.BufferGeometry(), this.hoseMat);
    this.hose.castShadow = true; this.hose.visible = false; this.hose.frustumCulled = false;
    scene.add(this.nozzle, this.hose);
    this.nozzleM = new THREE.Matrix4();
  }

  // car: the Jeep; walker: already standing at the car (walker.enter); face: the pump face
  // (stations.faceNear); stations: to lift and hang the nozzle; ground(x, z): the ground's height.
  begin({ car, walker, face, stations, ground, onFill, onDone }) {
    this.car = car; this.walker = walker; this.face = face; this.stations = stations; this.ground = ground;
    this.onFill = onFill; this.onDone = onDone;
    this.bones = walker.man ? bonesOf(walker.man) : null;
    const h = car.heading, f = new THREE.Vector3(Math.sin(h), 0, Math.cos(h)), l = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
    const B = walker.car || { cx: 0, cz: 0, hx: 1, hz: 2.2, top: 1.6 };
    const at = (x, z) => new THREE.Vector3(car.pos.x + l.x * x + f.x * z, 0, car.pos.z + l.z * x + f.z * z);
    // Which side of the car the pump is on (+1 his door's side, the car's left).
    const fp = face.root;
    const sgn = Math.sign((fp.x - car.pos.x) * l.x + (fp.z - car.pos.z) * l.z) || 1;
    const bike = !!car.model.bike;
    // The filler: on the bike the top of the tank; on a car low on its rear quarter, pump side.
    this.cap = bike
      ? at(0, B.cz + B.hz * 0.12).setY(car.pos.y + B.top * 0.74)
      : at(sgn * (B.hx - 0.02) + B.cx, B.cz - B.hz * 0.5).setY(car.pos.y + Math.min(1.05, B.top * 0.5));
    this.out = l.clone().multiplyScalar(sgn); // away from the car at the filler
    const capStand = bike ? at(sgn * (B.hx + B.cx + 0.4), B.cz + B.hz * 0.05) : at(sgn * (B.hx + B.cx + 0.5), B.cz - B.hz * 0.5);
    const door = at(B.hx + B.cx + 0.55, B.cz + B.hz * 0.12);
    const pump = new THREE.Vector3(face.stand.x, 0, face.stand.z);
    // Round the back when the pump is on the other side from his door.
    const round = sgn < 0 ? [at(B.hx + B.cx + 0.7, B.cz - B.hz - 0.7), at(-(B.hx + B.cx) - 0.7, B.cz - B.hz - 0.7)] : [];
    const face2car = Math.atan2(-this.out.x, -this.out.z);
    this.paths = {
      toPump: { pts: [...round, pump], facing: face.stand.heading },
      toCap: { pts: [capStand], facing: face2car },
      toPump2: { pts: [pump], facing: face.stand.heading },
      toDoor: { pts: [...round.slice().reverse(), door], facing: car.heading },
    };
    walker.pos.set(door.x, ground(door.x, door.z), door.z);
    walker.heading = car.heading + Math.PI / 2;
    this.active = true; this.go('out');
    this.carry = 0; // 1 while the nozzle is in his hand
    this.armW = 0;
    this.filling = false;
    // The shot: from ahead of the car and out past the pump, looking back across the two, so the
    // whole errand is in view.
    const mid = pump.clone().lerp(capStand, 0.5);
    const ahead = f.clone();
    // Down the gap between the car and the pump, from ahead of the car and a little above: the
    // car on one side, the pump on the other, and him in between.
    const toLane = new THREE.Vector3(face.n.x, 0, face.n.z);
    this.shot = {
      eye: mid.clone().addScaledVector(ahead, 5.6).addScaledVector(toLane, 0.5).setY(car.pos.y + 2.5),
      at: mid.clone().addScaledVector(ahead, -1.2).setY(car.pos.y + 0.85),
    };
  }

  go(phase) { this.phase = phase; this.t = 0; this.wp = 0; this.arrived = false; this.holdT = 0; }

  // What the walker is told to do this frame: walk toward the next waypoint (steered by setting his
  // heading), slowing to stop on the last, then turning to face what he came for.
  input(dt) {
    const W = this.walker, P = this.paths[this.phase];
    const inp = { throttle: 0, steer: 0, walk: true };
    if (!P) return inp;
    const tgt = P.pts[Math.min(this.wp, P.pts.length - 1)];
    const dx = tgt.x - W.pos.x, dz = tgt.z - W.pos.z, d = Math.hypot(dx, dz);
    const last = this.wp >= P.pts.length - 1;
    // Held up (the car or a post in the way) for too long: he steps the last bit.
    if (this.t > 9) { const end = P.pts[P.pts.length - 1]; W.pos.x = end.x; W.pos.z = end.z; W.heading = P.facing; W.fwd = 0; this.arrived = true; return inp; }
    if (!last && d < 0.45) { this.wp++; return this.input(dt); }
    if (last && d < 0.12) {
      W.fwd = 0;
      const turn = wrap(P.facing - W.heading);
      W.heading += Math.sign(turn) * Math.min(Math.abs(turn), dt * 4.5);
      if (Math.abs(turn) < 0.08 && W.speedSmooth < 0.2) this.arrived = true;
      return inp;
    }
    const want = Math.atan2(dx, dz), turn = wrap(want - W.heading);
    W.heading += Math.sign(turn) * Math.min(Math.abs(turn), dt * 5);
    // Turn on the spot first if it is well behind him; slow for the last half metre.
    inp.throttle = Math.abs(turn) > 1.2 ? 0.15 : last ? Math.max(0.3, Math.min(1, d / 0.7)) : 1;
    if (last && d < 0.5) W.fwd = Math.min(W.fwd, 0.3 + d * 2);
    return inp;
  }

  // After the walker has moved and been animated: the phase clock, his arm, the nozzle and the hose.
  // fuelFull(): whether the tank is full.
  update(dt, { fuelFull }) {
    if (!this.active) return;
    this.t += dt;
    const ph = this.phase;
    if (ph === 'out' && this.t > 0.45) this.go('toPump');
    else if (this.paths[ph] && this.arrived) {
      this.arrived = false;
      this.go(ph === 'toPump' ? 'take' : ph === 'toCap' ? 'fill' : ph === 'toPump2' ? 'hang' : 'in');
      if (this.phase === 'fill') { this.filling = true; this.onFill?.(true); }
      if (this.phase === 'in') { this.finish(); return; }
    } else if (ph === 'take' && this.t > 1.15) this.go('toCap');
    else if (ph === 'hang' && this.t > 1.0) this.go('toDoor');
    else if (ph === 'fill') {
      if (this.filling && fuelFull()) { this.filling = false; this.onFill?.(false); }
      if (!this.filling && this.t > 0.6 && (this.holdT += dt) > 0.6) this.go('toPump2');
    }
    this.pose(dt);
  }

  // Stop filling (Refuel pressed again): he takes the nozzle back.
  stop() { if (this.phase === 'fill' && this.filling) { this.filling = false; this.onFill?.(false); } }

  // Called off from outside (a tow, a jump, another vehicle): the nozzle goes straight back.
  abort() {
    if (!this.active) return;
    this.active = false;
    this.nozzle.visible = this.hose.visible = false;
    this.stations.holster(this.face, true);
    if (this.filling) { this.filling = false; this.onFill?.(false); }
  }

  // Done or called off: hang the nozzle up and hand back to the car.
  finish() {
    this.active = false;
    this.nozzle.visible = this.hose.visible = false;
    this.stations.holster(this.face, true);
    if (this.filling) { this.filling = false; this.onFill?.(false); }
    this.onDone?.();
  }

  pose(dt) {
    const W = this.walker, B = this.bones, ph = this.phase, t = this.t;
    const rest = this.face.nozzle; // the nozzle in its holster (world)
    // Where the nozzle is: in the holster, in his hand, or in the filler.
    let inHand = this.carry;
    if (ph === 'take' && t > 0.55 && !this.carry) { this.carry = 1; this.stations.holster(this.face, false); inHand = 1; }
    if (ph === 'hang' && t > 0.55 && this.carry) { this.carry = 0; this.stations.holster(this.face, true); inHand = 0; }
    this.nozzle.visible = this.hose.visible = !!inHand;
    // His right arm: how much it is posed (reaching for the holster, carrying, holding it in the
    // filler) and where to.
    let want = 0, target = null;
    const fwd = _v.set(Math.sin(W.heading), 0, Math.cos(W.heading)).clone();
    const left = new THREE.Vector3(Math.cos(W.heading), 0, -Math.sin(W.heading));
    const carryAt = W.pos.clone().addScaledVector(fwd, 0.32).addScaledVector(left, -0.24).setY(W.pos.y + 0.98);
    if (ph === 'take' || ph === 'hang') {
      // Out to the holster and back: there by 0.45 s, back to carrying by the end.
      const grip = new THREE.Vector3().setFromMatrixPosition(rest);
      const u = ph === 'take' ? t : t; // same shape both ways
      const k = u < 0.45 ? ease(u / 0.45) : u < 0.65 ? 1 : 1 - ease((u - 0.65) / 0.45);
      target = grip.clone().lerp(carryAt, 1 - k);
      want = 1;
    } else if (this.carry && ph !== 'fill') { target = carryAt; want = 0.85; }
    else if (ph === 'fill') {
      // The nozzle sits in the filler, spout in; his hand on its grip.
      const z = this.out.clone().negate().multiplyScalar(Math.cos(0.6)).addScaledVector(UP, -Math.sin(0.6)).normalize();
      const y = new THREE.Vector3().crossVectors(z, new THREE.Vector3().crossVectors(UP, z)).normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      _m.makeBasis(x, y, z);
      const tip = NOZZLE_TIP.clone().applyMatrix4(_m);
      const k = ease(Math.min(1, t / 0.5));
      const inCap = this.cap.clone().sub(tip);
      this.fillM = _m.clone().setPosition(inCap);
      target = inCap.clone().lerp(carryAt, 1 - k);
      want = 1;
    }
    this.armW += (want - this.armW) * Math.min(1, dt * 8);
    if (B && target && this.armW > 0.01) {
      const arm = B.RightArm, fore = B.RightForeArm, hand = B.RightHand;
      const q0 = [arm.quaternion.clone(), fore.quaternion.clone()];
      const sh = wpos(arm), side = sh.clone().sub(wpos(B.Spine2 || B.Spine)).setY(0).normalize();
      const pole = side.multiplyScalar(0.7).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.2);
      // The wrist a little short of the grip, so the palm closes round it.
      const wrist = target.clone().addScaledVector(UP, 0.03).addScaledVector(target.clone().sub(sh).normalize(), -0.06);
      reach(arm, fore, hand, wrist, pole);
      arm.quaternion.slerpQuaternions(q0[0], arm.quaternion.clone(), this.armW);
      fore.quaternion.slerpQuaternions(q0[1], fore.quaternion.clone(), this.armW);
      arm.updateMatrixWorld(true);
    }
    // The nozzle's own place: its grip in his hand (carrying, spout forward and down), easing into
    // the filler while he fills.
    if (inHand && B) {
      const hp = wpos(B.RightHand);
      const z = fwd.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(UP, -Math.sin(0.5)).normalize();
      const y = new THREE.Vector3().crossVectors(z, new THREE.Vector3().crossVectors(UP, z)).normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      const held = new THREE.Matrix4().makeBasis(x, y, z).setPosition(hp.x, hp.y - 0.03, hp.z);
      let M = held;
      if (ph === 'fill' && this.fillM) {
        const k = ease(Math.min(1, t / 0.5));
        M = lerpMatrix(held, this.fillM, k);
      }
      if (ph === 'take' && t < 0.8) M = lerpMatrix(rest, held, ease(Math.min(1, (t - 0.55) / 0.25)));
      if (ph === 'hang' && t > 0.3) M = lerpMatrix(held, rest, ease(Math.min(1, (t - 0.3) / 0.25)));
      this.nozzle.matrix.copy(M); this.nozzle.matrixWorld.copy(M);
      this.updateHose(M);
    }
  }

  // The hose from the pump to the nozzle's tail: slack hangs down from the pump, and what is left
  // over lies along the forecourt.
  updateHose(M) {
    const root = this.face.root, tail = NOZZLE_TAIL.clone().applyMatrix4(M);
    const back = new THREE.Vector3(0, 0, -1).transformDirection(M);
    const n = new THREE.Vector3(this.face.n.x, 0, this.face.n.z);
    const d = root.distanceTo(tail), slack = Math.max(0.05, HOSE - d);
    const g0 = this.ground(root.x, root.z) + 0.02;
    const a = root.clone().addScaledVector(n, 0.08).setY(root.y - 0.25);
    const mid = root.clone().lerp(tail, 0.5);
    mid.y = Math.max(g0, Math.min(root.y, tail.y) - slack * 0.45);
    const b = tail.clone().addScaledVector(back, 0.14).addScaledVector(UP, -0.08);
    const curve = new THREE.CatmullRomCurve3([root, a, mid, b, tail]);
    const geo = new THREE.TubeGeometry(curve, 30, 0.016, 6, false);
    this.hose.geometry.dispose();
    this.hose.geometry = geo;
  }
}

// Between two placements (position and turn), k from 0 to 1.
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _s = new THREE.Vector3();
function lerpMatrix(A, Bm, k) {
  A.decompose(_pa, _qa, _s); Bm.decompose(_pb, _qb, _s);
  return new THREE.Matrix4().compose(_pa.lerp(_pb, k), _qa.slerp(_qb, k), _s.set(1, 1, 1));
}
