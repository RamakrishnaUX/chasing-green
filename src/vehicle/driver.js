// The driver: the same man you walk as, sitting at the wheel with both hands on it. He is posed
// by hand rather than animated: his back upright, his thighs along the seat and his feet down on
// the pedals, and each arm reaching its hand to the rim (two-bone reach, elbows down and out).
// The hands hold the wheel at ten to two and turn with it; past about 70 degrees they slide on
// the rim rather than cross: wrists behind the rim, palms turned in towards the hub, fingers
// closed round it. From the driver's seat you see your own forearms and hands on the wheel: his
// head and legs fold away, and everything behind a plane just in front of his chest, or below
// the wheel (his lap), is cut off.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const B = (n) => `mixamorig${n}`; // bone names lose their ":" in three.js
const GRIP = 0.3, SLIDE = 1.2;
const CURL = [0.9, 1.25, 1.0]; // finger joints, knuckle to tip (radians) // ten to two (radians above the horizontal); how far the hands go round with the wheel

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// Turn a bone so the line from it to its child points along dir (world), by the smallest turn.
function aim(bone, child, dir) {
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _c.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_c, _d.copy(dir).normalize());
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(_q);
  bone.parent.getWorldQuaternion(_q).invert();
  bone.quaternion.copy(_q.multiply(_q2));
  bone.updateMatrixWorld(true);
}

// Turn a bone about a world axis.
function turnWorld(bone, axis, angle) {
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(_q.setFromAxisAngle(axis, angle));
  bone.parent.getWorldQuaternion(_q).invert();
  bone.quaternion.copy(_q.multiply(_q2));
  bone.updateMatrixWorld(true);
}

// Two-bone reach: upper -> lower -> end, the end placed on target, the middle joint bent
// towards pole (a world direction).
function reach(upper, lower, end, target, pole) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(lower.getWorldPosition(_a)), b = _a.distanceTo(end.getWorldPosition(_b));
  const d = _c.subVectors(target, S), L = THREE.MathUtils.clamp(d.length(), 0.01, (a + b) * 0.999);
  d.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const perp = _e.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
  const elbow = new THREE.Vector3().copy(S).addScaledVector(d, a * cosA).addScaledVector(perp, a * sinA);
  aim(upper, lower, elbow.clone().sub(S));
  aim(lower, end, _d.copy(target).sub(lower.getWorldPosition(_a)));
}

export class Driver {
  constructor() {
    this.group = new THREE.Group();
    this.group.userData.dynamic = true;
    this.group.visible = false;
    this.ready = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/person.glb`).then((g) => {
      const man = g.scene;
      // The cut for the driver's own view (far away, so cutting nothing, otherwise).
      this.clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6); this.lap = this.clip.clone();
      man.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.material = o.material.clone(); o.material.clippingPlanes = [this.clip, this.lap]; } });
      this.group.add(man);
      const bone = {};
      man.traverse((o) => { if (o.isBone) bone[o.name.replace(/_\d+$/, '').replace(/^mixamorig:?/, '')] = o; });
      this.bone = bone;
      this.rest = new Map(Object.values(bone).map((o) => [o, o.quaternion.clone()]));
      // Where the head sits above the feet in his own frame, standing.
      man.updateMatrixWorld(true);
      // Which way each palm faces in the bone's own frame (in the rest pose, the palms face down).
      this.palm = {};
      for (const s of ['Left', 'Right']) this.palm[s] = new THREE.Vector3(0, -1, 0).applyQuaternion(bone[s + 'Hand'].getWorldQuaternion(new THREE.Quaternion()).invert());
      this.headRest = this.group.worldToLocal(bone.Head.getWorldPosition(new THREE.Vector3()));
    }).catch((e) => console.warn('Driver did not load:', e));
  }

  // Each frame. car: the Jeep; on: whether he is in it; inside: the view is from his seat.
  update(car, on, inside) {
    const i = car.interior, steer = i?.steer;
    const show = !!(on && this.bone && steer && steer.parent);
    if (this.group.parent !== car.body) car.body.add(this.group);
    this.group.visible = show;
    if (!show) return;
    const bone = this.bone, body = car.body, mount = steer.parent;
    for (const [o, q] of this.rest) o.quaternion.copy(q);
    // From his own seat: no head or legs (the camera is where his eyes are, his lap is below).
    const fold = inside ? 1e-3 : 1;
    bone.Head.scale.setScalar(fold); bone.LeftUpLeg.scale.setScalar(fold); bone.RightUpLeg.scale.setScalar(fold);
    // The wheel: its centre and size in the car's frame, from the turning part's bounds.
    if (this.wheelFor !== steer) {
      this.wheelFor = steer;
      // Measured straight ahead: across the car, the box is as wide as the rim.
      const z = steer.rotation.z; steer.rotation.z = 0; steer.updateMatrixWorld(true);
      this.rimR = Math.max(0.12, new THREE.Box3().setFromObject(steer, true).getSize(_a).x * 0.45);
      steer.rotation.z = z; steer.updateMatrixWorld(true);
    }
    body.updateWorldMatrix(true, false);
    const toWorld = (x, y, z) => body.localToWorld(new THREE.Vector3(x, y, z)).sub(body.getWorldPosition(new THREE.Vector3())).normalize();
    const C = body.worldToLocal(mount.getWorldPosition(new THREE.Vector3()));
    // Sit him so his shoulders are an arm's reach behind the wheel and his head above it; in a
    // low car he leans back (seat.lean, radians) to keep his head under the roof.
    const seat = { up: 0.35, back: 0.3, lean: 0.08, ...(i.seat || {}) };
    this.group.position.set(0, 0, 0); this.group.updateMatrixWorld(true);
    bone.Hips.quaternion.premultiply(_q.setFromAxisAngle(_a.set(1, 0, 0), -seat.lean));
    bone.Neck.quaternion.premultiply(_q.setFromAxisAngle(_a.set(1, 0, 0), seat.lean * 0.7));
    this.group.updateMatrixWorld(true);
    const head = this.group.worldToLocal(bone.Head.getWorldPosition(new THREE.Vector3()));
    this.group.position.set(C.x - head.x, C.y + seat.up - head.y, C.z - seat.back - head.z);
    this.group.updateMatrixWorld(true);
    this.C = C;
    // Legs: thighs along the seat, shins down to the pedals.
    if (!inside) for (const s of ['Left', 'Right']) {
      const hip = bone[s + 'UpLeg'].getWorldPosition(new THREE.Vector3());
      const foot = body.localToWorld(body.worldToLocal(hip.clone()).add(new THREE.Vector3(0, -(seat.legDown ?? 0.55), seat.legOut ?? 0.62)));
      reach(bone[s + 'UpLeg'], bone[s + 'Leg'], bone[s + 'Foot'], foot, toWorld(0, 1, 0.6));
      aim(bone[s + 'Foot'], bone[s + 'ToeBase'], toWorld(0, -0.35, 1));
    }
    // Hands on the rim, turning with the wheel up to SLIDE either way.
    const turn = THREE.MathUtils.clamp(steer.rotation.z, -SLIDE, SLIDE), R = this.rimR;
    for (const [s, ang, out] of [['Left', GRIP, 1], ['Right', Math.PI - GRIP, -1]]) {
      const t = ang + turn;
      // The wheel's frame in the world: its centre, the column (pointing away from him), and
      // from the centre out to this hand's place on the rim.
      const hub = mount.getWorldPosition(new THREE.Vector3());
      const col = mount.localToWorld(new THREE.Vector3(0, 0, 1)).sub(hub).normalize();
      const outward = mount.localToWorld(new THREE.Vector3(Math.cos(t), Math.sin(t), 0)).sub(hub).normalize();
      // The wrist sits just behind the rim and a little outside it, so the hand closes round it.
      const wrist = hub.clone().addScaledVector(outward, R + 0.025).addScaledVector(col, -0.075);
      reach(bone[s + 'Arm'], bone[s + 'ForeArm'], bone[s + 'Hand'], wrist, toWorld(out * 0.7, -1, -0.2));
      (this.miss ||= {})[s] = +bone[s + 'Hand'].getWorldPosition(_b).distanceTo(wrist).toFixed(3); // how far short the hand is (for checking)
      // The hand points on past the rim, carrying on from the forearm; the palm faces the hub.
      const fore = bone[s + 'Hand'].getWorldPosition(new THREE.Vector3()).sub(bone[s + 'ForeArm'].getWorldPosition(new THREE.Vector3())).normalize();
      const F = col.clone().add(fore.multiplyScalar(0.6)).addScaledVector(outward, -0.3).normalize();
      aim(bone[s + 'Hand'], bone[s + 'HandMiddle1'], F);
      const want = outward.clone().negate().addScaledVector(F, outward.dot(F)).normalize();
      const now = this.palm[s].clone().applyQuaternion(bone[s + 'Hand'].getWorldQuaternion(new THREE.Quaternion()));
      now.addScaledVector(F, -now.dot(F)).normalize();
      turnWorld(bone[s + 'Hand'], F, Math.atan2(_c.crossVectors(now, want).dot(F), now.dot(want)));
      // Fingers closed round the rim, each joint towards the palm; the thumb round the other side.
      const P = this.palm[s].clone().applyQuaternion(bone[s + 'Hand'].getWorldQuaternion(new THREE.Quaternion()));
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (const j of [1, 2, 3]) {
        const b = bone[s + 'Hand' + f + j], next = bone[s + 'Hand' + f + (j + 1)];
        if (!b || !next) continue;
        const d = next.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
        const axis = _d.crossVectors(d, P);
        if (axis.lengthSq() < 1e-6) continue;
        turnWorld(b, axis.normalize(), f === 'Thumb' ? 0.35 : CURL[j - 1]);
      }
    }
    // From his own seat, everything behind a plane just in front of his chest is cut away.
    if (inside) {
      const sh = bone.LeftArm.getWorldPosition(new THREE.Vector3()).add(bone.RightArm.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
      const n = toWorld(0, 0, 1);
      this.clip.normal.copy(n); this.clip.constant = -n.dot(sh) - (seat.chest ?? 0.17);
      // ...and his lap, below the wheel.
      const up = toWorld(0, 1, 0); this.lap.normal.copy(up); this.lap.constant = -up.dot(mount.getWorldPosition(_a)) + (seat.lap ?? 0.22);
    } else { this.clip.set(_a.set(0, 1, 0), 1e6); this.lap.set(_a, 1e6); }
  }
}
