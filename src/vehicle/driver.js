// The driver: the same man you walk as, sitting at the wheel with both hands on it. He is posed
// by hand rather than animated: his back upright, his thighs along the seat and his feet down on
// the pedals, and each arm reaching its hand to the rim (two-bone reach, elbows down and out).
// The hands hold the wheel at ten to two and turn with it; past about 70 degrees they slide on
// the rim rather than cross. He is seen from outside; from the driver's seat (where the camera
// is his eyes) he is not drawn.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const B = (n) => `mixamorig${n}`; // bone names lose their ":" in three.js
const GRIP = 0.3, SLIDE = 1.2, CURL = -1.1; // ten to two (radians above the horizontal); how far the hands go round with the wheel

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
      man.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      this.group.add(man);
      const bone = {};
      man.traverse((o) => { if (o.isBone) bone[o.name.replace(/_\d+$/, '').replace(/^mixamorig:?/, '')] = o; });
      this.bone = bone;
      this.rest = new Map(Object.values(bone).map((o) => [o, o.quaternion.clone()]));
      // Where the head sits above the feet in his own frame, standing.
      man.updateMatrixWorld(true);
      this.headRest = this.group.worldToLocal(bone.Head.getWorldPosition(new THREE.Vector3()));
    }).catch((e) => console.warn('Driver did not load:', e));
  }

  // Each frame. car: the Jeep; on: whether he is in it; inside: the view is from his seat.
  update(car, on, inside) {
    on = on && !inside;
    const i = car.interior, steer = i?.steer;
    const show = !!(on && this.bone && steer && steer.parent);
    if (this.group.parent !== car.body) car.body.add(this.group);
    this.group.visible = show;
    if (!show) return;
    const bone = this.bone, body = car.body, mount = steer.parent;
    for (const [o, q] of this.rest) o.quaternion.copy(q);
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
    for (const s of ['Left', 'Right']) {
      const hip = bone[s + 'UpLeg'].getWorldPosition(new THREE.Vector3());
      const foot = body.localToWorld(body.worldToLocal(hip.clone()).add(new THREE.Vector3(0, -(seat.legDown ?? 0.55), seat.legOut ?? 0.62)));
      reach(bone[s + 'UpLeg'], bone[s + 'Leg'], bone[s + 'Foot'], foot, toWorld(0, 1, 0.6));
      aim(bone[s + 'Foot'], bone[s + 'ToeBase'], toWorld(0, -0.35, 1));
    }
    // Hands on the rim, turning with the wheel up to SLIDE either way.
    const turn = THREE.MathUtils.clamp(steer.rotation.z, -SLIDE, SLIDE), R = this.rimR;
    for (const [s, ang, out] of [['Left', GRIP, 1], ['Right', Math.PI - GRIP, -1]]) {
      const t = ang + turn;
      // A point on the rim, a hand's breadth short so the palm (not the wrist) is on it.
      const grip = mount.localToWorld(new THREE.Vector3(Math.cos(t) * R * 0.92, Math.sin(t) * R * 0.92, 0.045));
      reach(bone[s + 'Arm'], bone[s + 'ForeArm'], bone[s + 'Hand'], grip, toWorld(out * 0.7, -1, -0.2));
      (this.miss ||= {})[s] = +bone[s + 'Hand'].getWorldPosition(_b).distanceTo(grip).toFixed(3); // how far short the hand is (for checking)
      // The hand lies along the rim's tangent, fingers round it.
      const tangent = mount.localToWorld(new THREE.Vector3(-Math.sin(t) * out, Math.cos(t) * out, 0)).sub(mount.getWorldPosition(new THREE.Vector3()));
      const fwd = bone[s + 'Hand'].getWorldPosition(new THREE.Vector3()).sub(bone[s + 'ForeArm'].getWorldPosition(new THREE.Vector3())).normalize();
      aim(bone[s + 'Hand'], bone[s + 'HandMiddle1'], fwd.multiplyScalar(0.6).add(tangent.normalize().multiplyScalar(-0.4 * out)));
      // Fingers closed round the rim.
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (const j of [1, 2, 3]) bone[s + 'Hand' + f + j]?.quaternion.multiply(_q.setFromAxisAngle(_a.set(0, 0, 1), CURL * out * (j === 1 ? 0.8 : 1)));
      bone[s + 'Hand'].updateMatrixWorld(true);
    }
  }
}
