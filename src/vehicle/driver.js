// The driver: the same man you walk as, at the wheel whenever you are in a car. He is posed by
// hand each frame rather than animated:
// - He sits on the car's own seat: its cushion, backrest and roof are found by casting rays
//   into the car, his hips go just into the cushion and in front of the backrest, and his back leans
//   back as far as it can while his hands still reach the wheel (upright, or a little forward,
//   in a car whose wheel is far off). His feet rest on the floor in front, knees bent.
// - His hands hold the rim at ten to two. Each hand is set from the grip itself: the rim runs
//   across the palm, the palm faces the hub, the thumb lies over the top, and the hand carries
//   on from the forearm; the fingers then close round the rim. The twist from forearm to hand
//   is mostly taken by the forearm, as a real one does, so the wrist does not wring.
// - The hands turn with the wheel and, past about 70 degrees, slide on it rather than cross.
// He is drawn at the scale of the car he drives (the cars are scaled up from their models'
// own, roughly true, sizes to set them against each other; he grows with them, so he keeps
// his proportions to the car). All the distances below follow his size.
// He is seen from outside the car; from the driver's seat (the camera is where his eyes are)
// he is not drawn.
//
// On the cafe racer he rides instead (see ride): astride the saddle, leaning forward over the
// tank to the clip-on bars, hands round the grips (turning with the bars), feet on the pegs,
// head up to look down the road, in an open leather helmet with goggles.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const GRIP = 0.25; // a little above quarter to three: radians above the horizontal on the rim
const SLIDE = 1.2; // how far (radians) the hands go round with the wheel before sliding
const CURL = [1.3, 1.5, 1.0]; // finger joints, knuckle to tip (radians)
const THUMB = [0, 0.45, 0.35]; // thumb joints (the first is aimed instead)
const DIAG = 0.7; // how diagonally the rim may cross the palm (as a share along it)
const FOREARM_TWIST = 1; // share of the wrist's twist taken by the forearm (a real one turns along its length)
// Seating poses to try, as [lean back (radians), forward on the cushion (metres)]; the most
// natural (a slight recline, well back on the seat) that reaches the wheel and keeps his head
// under the roof is used.
const POSES = [];
for (let l = -0.3; l < 0.81; l += 0.05) for (let f = 0; f < 0.37; f += 0.03) POSES.push([l, f]);
const poseCost = ([l, f]) => Math.abs(l - 0.2) + f * 2 + Math.max(0, -l) * 3;
// Riding: forward lean (radians) and how far forward on the saddle (metres); the most natural is
// a lean of about 40 degrees, well back on the seat.
const RIDES = [];
for (let l = 0.2; l < 1.31; l += 0.05) for (let f = -0.12; f < 0.13; f += 0.04) RIDES.push([l, f]);
const rideCost = ([l, f]) => Math.abs(l - 0.7) + Math.abs(f) * 2;
const PEG = [0.2, 0.34, -0.2]; // the foot pegs (x either side, height, along the bike), at the model's own size

const V = () => new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const wpos = (o) => o.getWorldPosition(V());
const wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

// Set a bone's world rotation.
function setWorldQuat(bone, q) {
  bone.parent.getWorldQuaternion(_q).invert();
  bone.quaternion.copy(_q.multiply(q));
  bone.updateMatrixWorld(true);
}
// Turn a bone about a world axis.
function turnWorld(bone, axis, angle) {
  setWorldQuat(bone, _q2.setFromAxisAngle(axis, angle).multiply(wquat(bone)));
}
// Turn a bone so the line from it to its child points along dir (world), by the smallest turn.
function aim(bone, child, dir) {
  const cur = wpos(child).sub(wpos(bone)).normalize(), want = dir.clone().normalize();
  const axis = V().crossVectors(cur, want);
  if (axis.lengthSq() < 1e-10) return;
  turnWorld(bone, axis.normalize(), cur.angleTo(want));
}
// Two-bone reach: upper -> lower -> end, the end placed on target, the middle joint bent towards
// pole (a world direction). Returns how far short it fell.
function reach(upper, lower, end, target, pole) {
  const S = wpos(upper), a = S.distanceTo(wpos(lower)), b = wpos(lower).distanceTo(wpos(end));
  const d = V().subVectors(target, S), L = THREE.MathUtils.clamp(d.length(), 0.01, (a + b) * 0.999);
  d.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const perp = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
  const elbow = S.clone().addScaledVector(d, a * cosA).addScaledVector(perp, a * sinA);
  aim(upper, lower, elbow.sub(S));
  aim(lower, end, target.clone().sub(wpos(lower)));
  return wpos(end).distanceTo(target);
}
// A rotation taking the frame (f1, p1, f1 x p1) onto (f2, p2, f2 x p2).
function frameQuat(f1, p1, f2, p2) {
  _m.makeBasis(f1, p1, V().crossVectors(f1, p1));
  _m2.makeBasis(f2, p2, V().crossVectors(f2, p2));
  return new THREE.Quaternion().setFromRotationMatrix(_m2.multiply(_m.transpose()));
}
// The angle a rotation turns about an axis (its twist about it).
function twistAbout(q, axis) {
  const d = axis.x * q.x + axis.y * q.y + axis.z * q.z;
  return 2 * Math.atan2(d, q.w);
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
      man.updateMatrixWorld(true);
      // Each hand's own frame: which way the fingers point and which way the palm faces (in the
      // rest pose the palms face down), in the hand bone's frame.
      this.handFrame = {};
      for (const s of ['Left', 'Right']) {
        const h = bone[s + 'Hand'], inv = wquat(h).invert();
        const f = wpos(bone[s + 'HandMiddle1']).sub(wpos(h)).normalize().applyQuaternion(inv);
        const p = new THREE.Vector3(0, -1, 0).applyQuaternion(inv);
        p.addScaledVector(f, -p.dot(f)).normalize();
        this.handFrame[s] = { f, p };
      }
      this.armLen = wpos(bone.LeftArm).distanceTo(wpos(bone.LeftForeArm)) + wpos(bone.LeftForeArm).distanceTo(wpos(bone.LeftHand));
    }).catch((e) => console.warn('Driver did not load:', e));
    // His helmet for the bike ("moto helmet" by sayedgamal655, CC BY 4.0; tools/cars/bike.mjs):
    // centred on its shell, facing +z.
    this.helmet = new THREE.Group();
    this.helmet.userData.dynamic = true;
    this.helmet.visible = false;
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/helmet.glb`).then((g) => {
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.helmet.add(g.scene);
    }).catch((e) => console.warn('Helmet did not load:', e));
  }

  // Where he sits in this car (in the car's frame): found once per car by casting rays from
  // behind the wheel down onto the cushion, back onto the backrest and down to the floor.
  seatOf(car, hub, size) {
    const body = car.body, meshes = [];
    body.traverse((o) => {
      if (!o.isMesh || this.group.getObjectById(o.id) || car.interior.steer.getObjectById(o.id)) return;
      if (o.material?.userData?.glass || o.material?.transparent || o.material?.name === 'mirror') return;
      meshes.push(o);
    });
    const rc = new THREE.Raycaster(), inv = body.matrixWorld.clone().invert();
    const cast = (from, dir, test) => {
      rc.set(body.localToWorld(from.clone()), dir.clone().transformDirection(body.matrixWorld));
      rc.far = 3.5;
      for (const h of rc.intersectObjects(meshes, false)) {
        const p = h.point.clone().applyMatrix4(inv);
        const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).transformDirection(inv) : V();
        if (test(p, n)) return p;
      }
      return null;
    };
    // The lowest of all the hits along a ray that pass the test.
    const lowest = (from, test) => {
      let best = null;
      cast(from, new THREE.Vector3(0, -1, 0), (p, n) => { if (test(p, n) && (!best || p.y < best.y)) best = p; return false; });
      return best;
    };
    // The floor of the footwell, under the wheel; then the cushion: the lowest upward-facing
    // surface behind the wheel that stands 15 to 60 cm off that floor (higher hits are the
    // seat's rolled edges and the top of the backrest; lower ones, the floor).
    let floorY = Infinity;
    for (const dz of [-0.2, -0.1, 0]) {
      const f = lowest(new THREE.Vector3(hub.x, hub.y - 0.1, hub.z + dz), (p, n) => n.y > 0.5 && p.y > hub.y - 1.4);
      if (f) floorY = Math.min(floorY, f.y);
    }
    if (floorY === Infinity) floorY = hub.y - 0.9;
    let cushion = null;
    for (const dz of [0.4, 0.5, 0.6, 0.7]) {
      const c = lowest(new THREE.Vector3(hub.x, hub.y + 0.4, hub.z - dz), (p, n) => n.y > 0.5 && p.y > floorY + 0.15 && p.y < floorY + 0.6);
      if (c && (!cushion || c.y < cushion.y)) cushion = c;
    }
    // A sports car's seat sits nearly on the floor: then the lowest surface behind the wheel.
    if (!cushion) for (const dz of [0.4, 0.5, 0.6]) {
      const c = lowest(new THREE.Vector3(hub.x, hub.y + 0.4, hub.z - dz), (p, n) => n.y > 0.5 && p.y < hub.y - 0.2);
      if (c && (!cushion || c.y < cushion.y)) cushion = c;
    }
    // The backrest: facing forward, just behind the cushion (not the seats further back).
    const back = cushion && cast(new THREE.Vector3(hub.x, cushion.y + 0.3, cushion.z + 0.1), new THREE.Vector3(0, 0, -1), (p, n) => p.z < cushion.z + 0.05 && p.z > cushion.z - 0.6 && n.z > 0.3);
    // The roof over the seat, as a height every 5 cm along the car (none: open above).
    const roof = [];
    if (cushion) for (let z = cushion.z - 0.3; z < hub.z + 0.1; z += 0.05) {
      const r = cast(new THREE.Vector3(hub.x, cushion.y + 0.3, z), new THREE.Vector3(0, 1, 0), (p) => p.y > cushion.y + 0.45);
      roof.push([z, r ? r.y : Infinity]);
    }
    // The front of the footwell: the first wall ahead at ankle height.
    const front = cast(new THREE.Vector3(hub.x, floorY + 0.12 * size, (cushion ? cushion.z : hub.z - 0.5)), new THREE.Vector3(0, 0, 1), (p, n) => n.z < -0.3);
    return {
      cushion, back, roof, front: front ? front.z : Infinity,
      hip: cushion ? new THREE.Vector3(hub.x, cushion.y + 0.03 * size, back ? Math.min(back.z + 0.15 * size, hub.z - 0.32 * size) : cushion.z) : null,
      floor: floorY,
    };
  }

  // Each frame. car: the Jeep; on: whether he is in it; inside: the view is from his seat (where
  // he is not drawn).
  update(car, on, inside) {
    if (car.model.bike) return this.ride(car, on, inside);
    this.helmet.visible = false;
    const i = car.interior, steer = i?.steer;
    const show = !!(on && !inside && this.bone && steer && steer.parent);
    if (this.group.parent !== car.body) car.body.add(this.group);
    this.group.visible = show;
    if (!show) return;
    const bone = this.bone, body = car.body, mount = steer.parent;
    const cfg = { lean: null, ...(i.seat || {}) };
    // His size: the car's own scale (see the top).
    const size = (car.model.size ?? car.model.scale ?? 1) * (cfg.size ?? 1);
    this.group.scale.setScalar(size);
    for (const [o, q] of this.rest) o.quaternion.copy(q);
    body.updateWorldMatrix(true, false);
    const hubL = body.worldToLocal(wpos(mount));
    // The wheel's size and the seat, once per car.
    if (this.wheelFor !== steer) {
      this.wheelFor = steer;
      const z = steer.rotation.z; steer.rotation.z = 0; steer.updateMatrixWorld(true);
      this.rimR = Math.max(0.12, new THREE.Box3().setFromObject(steer, true).getSize(V()).x * 0.45);
      steer.rotation.z = z; steer.updateMatrixWorld(true);
      this.seat = this.seatOf(car, hubL, size);
    }
    const toW = (x, y, z) => new THREE.Vector3(x, y, z).transformDirection(body.matrixWorld);
    const R = this.rimR, hub = wpos(mount), col = new THREE.Vector3(0, 0, 1).applyQuaternion(wquat(mount));
    const turn = THREE.MathUtils.clamp(steer.rotation.z, -SLIDE, SLIDE);
    const grip = cfg.grip ?? GRIP;
    const grips = { Left: grip + turn, Right: Math.PI - grip + turn }, grips0 = { Left: grip, Right: Math.PI - grip };
    const rimPoint = (t) => mount.localToWorld(new THREE.Vector3(Math.cos(t) * R, Math.sin(t) * R, 0));

    // Sit him: hips on the seat, back leaning as far as his reach allows. If he cannot reach
    // sitting upright against the backrest, he sits forward on the cushion first, and only
    // then leans in.
    const hip0 = this.seat.hip || new THREE.Vector3(hubL.x, hubL.y - 0.35, hubL.z - 0.5), hipL = hip0.clone();
    const place = (lean, fwd = 0) => {
      hipL.copy(hip0).z += fwd * size;
      for (const o of [bone.Hips, bone.Neck]) o.quaternion.copy(this.rest.get(o));
      this.group.position.set(0, 0, 0); this.group.updateMatrixWorld(true);
      bone.Hips.quaternion.premultiply(_q.setFromAxisAngle(X, -lean));
      bone.Neck.quaternion.premultiply(_q.setFromAxisAngle(X, lean * 0.8));
      this.group.updateMatrixWorld(true);
      const h = this.group.worldToLocal(wpos(bone.Hips)).multiplyScalar(size);
      this.group.position.set(hipL.x - h.x, hipL.y - h.y, hipL.z - h.z);
      this.group.updateMatrixWorld(true);
    };
    // How far a pose falls short: of reach (to the grips with the wheel straight) and of
    // headroom (the top of his cap under the roof).
    const short = () => {
      let m = 0;
      for (const s of ['Left', 'Right']) m += Math.max(0, wpos(bone[s + 'Arm']).distanceTo(rimPoint(grips0[s])) - this.armLen * size * 1.04);
      // The roof over his head (his cap is about 10 cm across).
      const top = body.worldToLocal(wpos(bone.HeadTop_End));
      let over = Infinity;
      const rf = this.seat.roof;
      if (rf.length) {
        const tz = THREE.MathUtils.clamp(top.z, rf[0][0], rf[rf.length - 1][0]); // past the ends: the nearest height measured
        for (const [z, y] of rf) if (Math.abs(z - tz) < 0.1) over = Math.min(over, y);
      }
      return m + Math.max(0, top.y - (over - 0.015)); // the end bone is the top of his cap
    };
    if (this.poseFor !== steer) {
      // Chosen once per car: the cheapest pose that fits, or the one that misses least.
      this.poseFor = steer;
      let best = null, bestCost = Infinity;
      for (const pose of cfg.lean != null ? POSES.filter((q) => Math.abs(q[0] - cfg.lean) < 0.026) : POSES) {
        place(...pose);
        const c = short() * 100 + poseCost(pose);
        if (c < bestCost) { bestCost = c; best = pose; }
      }
      this.pose = best; place(...best); this.short = +short().toFixed(3);
    }
    place(...this.pose);
    this.lean = this.pose[0];

    // Legs: thighs along the seat, feet on the floor in front (short of the footwell's front).
    for (const s of ['Left', 'Right']) {
      const hip = body.worldToLocal(wpos(bone[s + 'UpLeg']));
      const foot = body.localToWorld(new THREE.Vector3(hip.x, this.seat.floor + 0.09 * size, Math.min(hip.z + 0.62 * size, this.seat.front - 0.29 * size)));
      reach(bone[s + 'UpLeg'], bone[s + 'Leg'], bone[s + 'Foot'], foot, toW(0, 1, 0.5));
      aim(bone[s + 'Foot'], bone[s + 'ToeBase'], toW(0, -0.25, 1));
    }

    // Hands on the rim.
    this.miss = {};
    for (const s of ['Left', 'Right']) {
      const t = grips[s], G = rimPoint(t);
      const tangent = mount.localToWorld(new THREE.Vector3(-Math.sin(t), Math.cos(t), 0)).sub(hub).normalize();
      // The grip: the hand carries on from the forearm (so the wrist hardly bends) with the rim
      // across the palm, square to it or a little diagonal, as a real hand holds a wheel; the
      // palm is turned so the thumb lies over the top of the rim. The wrist sits back along the
      // hand from the rim and off it by the palm's thickness. Where the forearm points depends
      // on where the wrist goes, so this settles over a few passes.
      const out = s === 'Left' ? 1 : -1, F = V(), P = V(), wrist = V(), up = toW(0, 1, 0);
      let d = G.clone().sub(wpos(bone[s + 'Arm'])).normalize();
      for (let k = 0; k < 3; k++) {
        const along = d.dot(tangent);
        F.copy(d).addScaledVector(tangent, -along).normalize().addScaledVector(tangent, THREE.MathUtils.clamp(along, -DIAG, DIAG)).normalize();
        P.crossVectors(tangent, F); P.addScaledVector(F, -P.dot(F)).normalize();
        const thumb = s === 'Left' ? V().crossVectors(P, F) : V().crossVectors(F, P);
        if (thumb.dot(up) < 0) P.negate();
        wrist.copy(G).addScaledVector(F, -0.075 * size).addScaledVector(P, -0.032 * size);
        this.miss[s] = +reach(bone[s + 'Arm'], bone[s + 'ForeArm'], bone[s + 'Hand'], wrist, toW(out * 0.8, -1, -0.3)).toFixed(3);
        d = wpos(bone[s + 'Hand']).sub(wpos(bone[s + 'ForeArm'])).normalize();
      }
      // The hand's turn, from its own frame onto the grip's; the forearm takes most of the twist.
      const hf = this.handFrame[s], want = frameQuat(hf.f, hf.p, F, P);
      const fa = bone[s + 'ForeArm'], axis = wpos(bone[s + 'Hand']).sub(wpos(fa)).normalize();
      const rel = want.clone().multiply(wquat(bone[s + 'Hand']).invert()); // world turn the hand still needs
      turnWorld(fa, axis, twistAbout(rel, axis) * (this.twist ?? FOREARM_TWIST));
      setWorldQuat(bone[s + 'Hand'], want);
      // Fingers drawn together (the rest pose fans them out) and closed round the rim, each
      // joint towards the palm; the thumb comes round the near side of the rim to meet them.
      const palm = hf.p.clone().applyQuaternion(wquat(bone[s + 'Hand']));
      const along = wpos(bone[s + 'HandMiddle2']).sub(wpos(bone[s + 'HandMiddle1'])).normalize();
      for (const f of ['Index', 'Ring', 'Pinky']) aim(bone[s + 'Hand' + f + 1], bone[s + 'Hand' + f + 2], along.clone().lerp(wpos(bone[s + 'Hand' + f + 2]).sub(wpos(bone[s + 'Hand' + f + 1])).normalize(), 0.25));
      aim(bone[s + 'HandThumb1'], bone[s + 'HandThumb2'], F.clone().multiplyScalar(0.55).addScaledVector(palm, 0.55).addScaledVector(tangent, out * 0.0).normalize());
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (const j of [1, 2, 3]) {
        const b = bone[s + 'Hand' + f + j], next = bone[s + 'Hand' + f + (j + 1)];
        if (!b || !next || (f === 'Thumb' && j === 1)) continue;
        const d = wpos(next).sub(wpos(b)).normalize(), axis2 = V().crossVectors(d, palm);
        if (axis2.lengthSq() < 1e-6) continue;
        turnWorld(b, axis2.normalize(), (f === 'Thumb' ? THUMB : CURL)[j - 1]);
      }
    }

  }

  // Riding the bike. Found once per bike: the grips (in the bars' own frame, so the hands go
  // round with them) and the saddle (cast down onto the seat).
  ride(car, on, inside) {
    const steer = car.interior?.steer, body = car.body;
    const show = !!(on && !inside && this.bone && steer);
    if (this.group.parent !== body) body.add(this.group);
    if (this.helmet.parent !== body) body.add(this.helmet);
    this.group.visible = this.helmet.visible = show;
    if (!show) return;
    const bone = this.bone;
    this.group.scale.setScalar(1);
    for (const [o, q] of this.rest) o.quaternion.copy(q);
    body.updateWorldMatrix(true, true);
    const toW = (x, y, z) => new THREE.Vector3(x, y, z).transformDirection(body.matrixWorld);
    if (this.bikeFor !== steer) {
      this.bikeFor = steer; this.ridePose = null;
      // The grips, with the bars straight: each one's middle and its line (pointing outward),
      // in the bars' frame. (The left grip is on his left, +x.)
      const z0 = steer.rotation.z; steer.rotation.z = 0; steer.updateMatrixWorld(true);
      const side = { Left: [], Right: [] }, v = V(), inv = steer.matrixWorld.clone().invert(), toBody = body.matrixWorld.clone().invert();
      steer.traverse((o) => {
        if (!o.isMesh || !/grip/i.test(o.material?.name || '')) return;
        const P = o.geometry.attributes.position;
        for (let k = 0; k < P.count; k++) { v.fromBufferAttribute(P, k).applyMatrix4(o.matrixWorld); const b = v.clone().applyMatrix4(toBody); side[b.x > 0 ? 'Left' : 'Right'].push(v.clone().applyMatrix4(inv)); }
      });
      this.grips = {};
      for (const [s2, pts] of Object.entries(side)) {
        if (!pts.length) continue;
        const c = pts.reduce((a, p) => a.add(p), V()).divideScalar(pts.length);
        let far = pts[0]; for (const p of pts) if (p.distanceTo(c) > far.distanceTo(c)) far = p;
        // The end further from the bike's middle is the outer one.
        const ends = [far, pts.reduce((a, p) => (p.distanceTo(far) > a.distanceTo(far) ? p : a), far)];
        const out = ends.map((e) => e.clone().applyMatrix4(steer.matrixWorld).applyMatrix4(toBody));
        const axis = Math.abs(out[0].x) > Math.abs(out[1].x) ? ends[0].clone().sub(ends[1]) : ends[1].clone().sub(ends[0]);
        // Hands grip a little in from the outer end.
        this.grips[s2] = { c: c.clone().addScaledVector(axis.clone().normalize(), 0.015), axis: axis.normalize() };
      }
      steer.rotation.z = z0; steer.updateMatrixWorld(true);
      // The saddle: the top of the seat, cast down just behind the tank.
      const meshes = [];
      body.traverse((o) => { if (o.isMesh && !this.group.getObjectById(o.id) && !this.helmet.getObjectById(o.id) && !steer.getObjectById(o.id) && !o.material?.transparent) meshes.push(o); });
      const rc = new THREE.Raycaster();
      let seat = null;
      for (const z of [-0.3, -0.35, -0.4]) {
        rc.set(body.localToWorld(new THREE.Vector3(0, 2, z)), toW(0, -1, 0)); rc.far = 2;
        const h = rc.intersectObjects(meshes, false)[0];
        if (h) { const p2 = body.worldToLocal(h.point.clone()); if (!seat || p2.y < seat.y) seat = p2; }
      }
      this.saddle = seat || new THREE.Vector3(0, 0.8, -0.35);
    }
    const G = {};
    for (const s2 of ['Left', 'Right']) if (this.grips[s2]) G[s2] = { p: steer.localToWorld(this.grips[s2].c.clone()), axis: this.grips[s2].axis.clone().transformDirection(steer.matrixWorld) };

    // Sit him: hips on the saddle, the body leaning forward over the tank, the head raised.
    const hipL = V();
    const place = (lean, fwd) => {
      for (const o of [bone.Hips, bone.Neck, bone.Head]) o.quaternion.copy(this.rest.get(o));
      this.group.position.set(0, 0, 0); this.group.updateMatrixWorld(true);
      bone.Hips.quaternion.premultiply(_q.setFromAxisAngle(X, lean));
      bone.Neck.quaternion.premultiply(_q.setFromAxisAngle(X, -lean * 0.55));
      bone.Head.quaternion.premultiply(_q.setFromAxisAngle(X, -lean * 0.35));
      this.group.updateMatrixWorld(true);
      hipL.set(0, this.saddle.y + 0.07, this.saddle.z + fwd);
      const h = this.group.worldToLocal(wpos(bone.Hips));
      this.group.position.set(hipL.x - h.x, hipL.y - h.y, hipL.z - h.z);
      this.group.updateMatrixWorld(true);
    };
    const short = () => { let m = 0; for (const s2 of ['Left', 'Right']) if (G[s2]) m += Math.max(0, wpos(bone[s2 + 'Arm']).distanceTo(G[s2].p) - this.armLen * 0.97); return m; };
    if (!this.ridePose) {
      let best = null, bc = Infinity;
      for (const pose of RIDES) { place(...pose); const c = short() * 100 + rideCost(pose); if (c < bc) { bc = c; best = pose; } }
      this.ridePose = best; place(...best); this.short = +short().toFixed(3);
    }
    place(...this.ridePose);
    this.lean = this.ridePose[0];

    // Legs: knees bent forward along the tank, feet on the pegs.
    for (const s2 of ['Left', 'Right']) {
      const out = s2 === 'Left' ? 1 : -1;
      const k = car.model.size || 1; // the bike is drawn larger than its model; he is not
      reach(bone[s2 + 'UpLeg'], bone[s2 + 'Leg'], bone[s2 + 'Foot'], body.localToWorld(new THREE.Vector3(out * PEG[0] * k, PEG[1] * k + 0.08, PEG[2] * k)), toW(out * 0.35, 0.25, 1));
      aim(bone[s2 + 'Foot'], bone[s2 + 'ToeBase'], toW(out * 0.15, -0.3, 1));
    }

    // Hands round the grips: the palm over the top, the thumb round underneath toward the bike's
    // middle, the hand carrying on from the forearm; then the fingers close.
    this.miss = {};
    for (const s2 of ['Left', 'Right']) {
      if (!G[s2]) continue;
      const g = G[s2], T = g.axis, inward = T.clone().negate(), F = V(), P = V(), wrist = V();
      let d = g.p.clone().sub(wpos(bone[s2 + 'Arm'])).normalize();
      for (let k = 0; k < 3; k++) {
        F.copy(d).addScaledVector(T, -d.dot(T)).normalize();
        P.crossVectors(T, F); P.addScaledVector(F, -P.dot(F)).normalize();
        const thumb = s2 === 'Left' ? V().crossVectors(P, F) : V().crossVectors(F, P);
        if (thumb.dot(inward) < 0) P.negate();
        wrist.copy(g.p).addScaledVector(F, -0.07).addScaledVector(P, -0.03);
        this.miss[s2] = +reach(bone[s2 + 'Arm'], bone[s2 + 'ForeArm'], bone[s2 + 'Hand'], wrist, toW((s2 === 'Left' ? 1 : -1) * 0.9, -0.6, -0.4)).toFixed(3);
        d = wpos(bone[s2 + 'Hand']).sub(wpos(bone[s2 + 'ForeArm'])).normalize();
      }
      const hf = this.handFrame[s2], want = frameQuat(hf.f, hf.p, F, P);
      const fa = bone[s2 + 'ForeArm'], ax = wpos(bone[s2 + 'Hand']).sub(wpos(fa)).normalize();
      turnWorld(fa, ax, twistAbout(want.clone().multiply(wquat(bone[s2 + 'Hand']).invert()), ax));
      setWorldQuat(bone[s2 + 'Hand'], want);
      const palm = hf.p.clone().applyQuaternion(wquat(bone[s2 + 'Hand']));
      const along = wpos(bone[s2 + 'HandMiddle2']).sub(wpos(bone[s2 + 'HandMiddle1'])).normalize();
      for (const f of ['Index', 'Ring', 'Pinky']) aim(bone[s2 + 'Hand' + f + 1], bone[s2 + 'Hand' + f + 2], along.clone().lerp(wpos(bone[s2 + 'Hand' + f + 2]).sub(wpos(bone[s2 + 'Hand' + f + 1])).normalize(), 0.25));
      aim(bone[s2 + 'HandThumb1'], bone[s2 + 'HandThumb2'], F.clone().multiplyScalar(0.55).addScaledVector(palm, 0.55).normalize());
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (const j of [1, 2, 3]) {
        const b = bone[s2 + 'Hand' + f + j], next = bone[s2 + 'Hand' + f + (j + 1)];
        if (!b || !next || (f === 'Thumb' && j === 1)) continue;
        const dd = wpos(next).sub(wpos(b)).normalize(), a2 = V().crossVectors(dd, palm);
        if (a2.lengthSq() < 1e-6) continue;
        turnWorld(b, a2.normalize(), (f === 'Thumb' ? THUMB : CURL)[j - 1] * 0.9);
      }
    }

    // The helmet on his head: its shell centred over the crown, square to his head.
    const head = wpos(bone.Head), top = wpos(bone.HeadTop_End), up = top.clone().sub(head), len = up.length();
    up.normalize();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(wquat(bone.Head)); fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const want = frameQuat(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), up, fwd);
    const at = head.clone().addScaledVector(up, len * (this.helmetUp ?? 0.62)).addScaledVector(fwd, this.helmetFwd ?? -0.01);
    this.helmet.position.copy(body.worldToLocal(at));
    this.helmet.quaternion.copy(wquat(body).invert().multiply(want));
    this.helmet.scale.setScalar(this.helmetScale ?? 1);
  }
}