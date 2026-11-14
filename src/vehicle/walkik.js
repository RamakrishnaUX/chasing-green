import * as THREE from 'three';
import { bonesOf } from './skydiver.js';
import { setWorldQuat, turnWorld, aim, reach, frameQuat, wpos, CURL } from './driver.js';
import { clamp, lerp, smoothstep } from '../world/noise.js';

// The person's body on real ground, by inverse kinematics on top of the Mixamo clips
// (walker.js decides where he is; this decides where his hands and feet go).
//
// - Walking and standing: each foot is put on the ground actually under it, a step or a slope,
//   not on the flat plane the clip was made on. The hips drop to whichever foot is lower, so on
//   stairs the back leg reaches down to its step while the front knee bends onto the next, and
//   the swing foot lifts clear of the step ahead. Each planted foot lies along the slope. Uphill
//   he leans into it from the waist; downhill he sits back a little.
// - Climbing a face: hand over hand. Each hand and foot grips a hold on the rock itself (found by
//   feeling along the face at that height). Diagonal pairs move in turn (right hand then left
//   foot, left hand then right foot), each lifting off the rock and reaching up to the next hold
//   while the other three stay planted; his hips stay in close to the wall and sway towards the
//   planted side, and he looks up to where he is reaching. Fingers close round each hold.
// - Over the top (mantle): both hands on the lip, he presses up, his chest folding over the edge,
//   brings one knee up onto the top, then stands and walks on.
//
// Every bone the solver touches is first saved as the clip posed it, so the solved pose can be
// blended in and out by weight (stepping onto a face, letting go, landing).

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ANKLE = 0.095; // the ankle's height above the sole, standing (measured off the rig)

// Climbing: metres climbed per full cycle of four limb moves, and each limb's move as a share of
// the cycle (diagonal pairs, the foot starting a little after its hand). HI: how high above the
// feet line (walker.pos.y) each hold is taken, at the moment it is gripped; LAT: how far out to
// the side (left positive). Hands grip at the wrist's reach; feet stand on the toe.
export const CYCLE = 0.4;
const LIMBS = [
  { k: 'RH', hand: true, side: 'Right', a: 0.0, b: 0.34, hi: 1.74, lat: -0.24 },
  { k: 'LF', hand: false, side: 'Left', a: 0.14, b: 0.46, hi: 0.36, lat: 0.15 },
  { k: 'LH', hand: true, side: 'Left', a: 0.5, b: 0.84, hi: 1.74, lat: 0.24 },
  { k: 'RF', hand: false, side: 'Right', a: 0.64, b: 0.96, hi: 0.36, lat: -0.15 },
];
// A little variety in where each hold is, the same every time for a given move.
const jitter = (n, s) => { const x = Math.sin(n * 12.9898 + s * 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };

export class Body {
  constructor(man) {
    this.man = man;
    const b = (this.b = bonesOf(man));
    this.legs = ['Left', 'Right'].map((s) => ({ s, up: b[s + 'UpLeg'], mid: b[s + 'Leg'], end: b[s + 'Foot'], toe: b[s + 'ToeBase'], off: null }));
    this.arms = ['Left', 'Right'].map((s) => ({ s, up: b[s + 'Arm'], mid: b[s + 'ForeArm'], end: b[s + 'Hand'] }));
    man.updateMatrixWorld(true);
    this.armLen = wpos(b.LeftArm).distanceTo(wpos(b.LeftForeArm)) + wpos(b.LeftForeArm).distanceTo(wpos(b.LeftHand));
    // The hand's own frame (fingers along, palm out of it), read in the bind pose: a T-pose,
    // fingers straight out to the side, palms down.
    man.updateMatrixWorld(true);
    this.handFrame = {};
    for (const s of ['Left', 'Right']) {
      const h = b[s + 'Hand'], inv = h.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.handFrame[s] = { f: wpos(b[s + 'HandMiddle1']).sub(wpos(h)).normalize().applyQuaternion(inv), p: new THREE.Vector3(0, -1, 0).applyQuaternion(inv) };
    }
    this.fingers = {};
    for (const s of ['Left', 'Right']) {
      this.fingers[s] = [];
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (const j of [1, 2, 3]) {
        const bone = b[s + 'Hand' + f + j], next = b[s + 'Hand' + f + (j + 1)];
        if (bone && next && !(f === 'Thumb' && j === 1)) this.fingers[s].push({ bone, next, amt: f === 'Thumb' ? 0.35 : CURL[j - 1] * 0.75 });
      }
    }
    // What the solver may write: the hips (place and turn), the spine and head, both legs and
    // both arms, the hands and fingers. Grouped so each group can be weighted on its own.
    const spine = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'].map((n) => b[n]);
    const leg = this.legs.flatMap((l) => [l.up, l.mid, l.end, l.toe]);
    const arm = this.arms.flatMap((a) => [a.up, a.mid, a.end]).concat(Object.values(this.fingers).flat().map((f) => f.bone));
    this.groups = { hips: [b.Hips], spine, leg, arm };
    this.saved = new Map();
    for (const bone of [b.Hips, ...spine, ...leg, ...arm]) this.saved.set(bone, new THREE.Quaternion());
    this.hipsPos = new THREE.Vector3();
    this.hipY = null; // the hips' height, smoothed
    this.lean = 0; // radians forward from the waist, smoothed
    this.holds = null; // climbing: { RH, LH, RF, LF } -> { pos, from, to, cycle }
  }

  // Keep the clip's pose, before anything is solved, to blend from.
  save() {
    for (const [bone, q] of this.saved) q.copy(bone.quaternion);
    this.hipsPos.copy(this.b.Hips.position);
  }
  // Mix the solved pose back towards the saved one: w per group (1 keeps the solve).
  blend(w) {
    for (const [g, bones] of Object.entries(this.groups)) {
      const k = typeof w === 'number' ? w : w[g] ?? 0;
      if (k >= 1) continue;
      for (const bone of bones) bone.quaternion.slerpQuaternions(this.saved.get(bone), bone.quaternion.clone(), k);
      if (g === 'hips') this.b.Hips.position.lerpVectors(this.hipsPos, this.b.Hips.position.clone(), k);
    }
    this.man.updateMatrixWorld(true);
  }

  // Move the hips by a world offset.
  shiftHips(d) {
    const H = this.b.Hips, w = wpos(H).add(d);
    H.position.copy(H.parent.worldToLocal(w));
    H.updateMatrixWorld(true);
  }

  // Lean the trunk forward (positive) or back about the left axis, the head kept level.
  leanTrunk(left, a) {
    const b = this.b;
    turnWorld(b.Spine, left, a * 0.45);
    turnWorld(b.Spine1, left, a * 0.35);
    turnWorld(b.Spine2, left, a * 0.2);
    turnWorld(b.Neck, left, -a * 0.6);
  }

  // Walking and standing on real ground. root: the walker's root (its world position is the feet
  // line the clip stands on); ground(x, z): the height under a foot; grade: rise over run ahead.
  feet(root, heading, ground, dt, grade, w = 1) {
    if (w <= 0.001) { this.hipY = null; for (const l of this.legs) l.off = null; return; }
    this.save();
    const f = V().set(Math.sin(heading), 0, Math.cos(heading)), left = V().set(f.z, 0, -f.x);
    const y0 = root.position.y, k = Math.min(1, dt * 20);
    const ankles = [];
    for (const l of this.legs) {
      const a = wpos(l.end), t = wpos(l.toe), lift = a.y - y0 - ANKLE;
      let g = Math.max(ground(a.x, a.z), ground(t.x, t.z));
      // Swinging through: lift clear of whatever is just ahead of the toe (the next step).
      if (lift > 0.03) g = Math.max(g, ground(t.x + f.x * 0.16, t.z + f.z * 0.16));
      const off = clamp(g - y0, -0.55, 0.55);
      l.off = l.off == null ? off : lerp(l.off, off, k);
      ankles.push({ a, t, lift });
    }
    // The hips drop to the lower foot (never so far the knee folds), smoothed in the world so a
    // step in the feet line does not jolt them.
    const want = y0 + clamp(Math.min(this.legs[0].off, this.legs[1].off), -0.45, 0.4);
    this.hipY = this.hipY == null ? want : lerp(this.hipY, want, Math.min(1, dt * 12));
    // Into a slope: forward from the waist going up (more the steeper and faster), back a touch
    // going down.
    const leanWant = clamp(grade, -0.6, 1.2) * (grade > 0 ? 0.32 : 0.2);
    this.lean = lerp(this.lean, leanWant, Math.min(1, dt * 5));
    this.shiftHips(V().set(0, this.hipY - y0, 0));
    if (Math.abs(this.lean) > 0.005) this.leanTrunk(left, this.lean);
    this.legs.forEach((l, i) => {
      const { a, lift } = ankles[i];
      const target = a.clone(); target.y += l.off;
      const fq = l.end.getWorldQuaternion(new THREE.Quaternion());
      const side = i === 0 ? left : left.clone().negate();
      reach(l.up, l.mid, l.end, target, f.clone().addScaledVector(side, 0.12));
      setWorldQuat(l.end, fq);
      // A planted foot lies along the slope under it (not across a step's edge).
      if (lift < 0.04) {
        const p = wpos(l.end), gF = ground(p.x + f.x * 0.12, p.z + f.z * 0.12), gB = ground(p.x - f.x * 0.12, p.z - f.z * 0.12);
        if (Math.abs(gF - gB) < 0.1) turnWorld(l.end, left, -clamp(Math.atan2(gF - gB, 0.24), -0.35, 0.35));
      }
    });
    this.blend(w);
  }

  // Climbing: plan the holds for this point in the cycle. phase counts cycles climbed (each
  // CYCLE metres up). Holds are found on the face itself along the heading.
  plan(root, heading, ground, phase, reset = false) {
    const f = V().set(Math.sin(heading), 0, Math.cos(heading)), left = V().set(f.z, 0, -f.x);
    const p0 = root.position;
    // The face at height y, lat to the side: the first point straight ahead where the rock is at
    // least that high; above the top of the face, the lip.
    const holdAt = (y, lat) => {
      let top = -Infinity, topD = 0.4;
      for (let d = 0; d <= 1.3; d += 0.04) {
        const x = p0.x + f.x * d + left.x * lat, z = p0.z + f.z * d + left.z * lat, g = ground(x, z);
        if (g >= y) return V().set(x - f.x * 0.02, y, z - f.z * 0.02);
        if (g > top + 0.02) { top = g; topD = d; }
      }
      return V().set(p0.x + f.x * (topD + 0.08) + left.x * lat, top, p0.z + f.z * (topD + 0.08) + left.z * lat);
    };
    if (reset || !this.holds) this.holds = {};
    for (const L of LIMBS) {
      const c = Math.floor(phase - L.a), end = c + L.b, H = (this.holds[L.k] ||= { pos: null, cycle: null, from: V(), to: V() });
      const ideal = () => holdAt(p0.y + (end - phase) * CYCLE + L.hi + jitter(c, L.a) * 0.06, L.lat + jitter(c, L.b) * 0.05);
      if (!H.pos) {
        // Starting out: every limb already on a hold, as if planted at the end of its last move.
        const back = phase >= end ? phase - end : phase - (end - 1);
        H.to.copy(holdAt(p0.y - back * CYCLE + L.hi, L.lat));
        if (!L.hand) H.to.y = Math.max(H.to.y, ground(H.to.x, H.to.z));
        H.pos = H.to.clone(); H.cycle = phase < end ? c - 1 : c; H.from.copy(H.to);
        continue;
      }
      if (phase < end) {
        // Moving: off the old hold, out from the rock and up to the new one.
        if (H.cycle !== c) { H.from.copy(H.pos); H.to.copy(ideal()); H.cycle = c; }
        const s = smoothstep(0, 1, (phase - (c + L.a)) / (L.b - L.a));
        H.pos.lerpVectors(H.from, H.to, s).addScaledVector(f, -(L.hand ? 0.12 : 0.1) * Math.sin(Math.PI * s));
        H.moving = s;
      } else {
        if (H.cycle !== c) { H.to.copy(ideal()); H.cycle = c; H.from.copy(H.to); }
        H.pos.copy(H.to); H.moving = 0;
      }
    }
    return this.holds;
  }

  // The climbing pose from the planned holds. sway: the hips' lean towards the planted side.
  climb(root, heading, ground, phase, w = 1) {
    this.save();
    const b = this.b, f = V().set(Math.sin(heading), 0, Math.cos(heading)), left = V().set(f.z, 0, -f.x);
    const H = this.holds, p0 = root.position;
    // Hips in close to the rock: the face's distance at hip height, the hips a hand off it.
    const hy = p0.y + 0.86;
    let dFace = 0.6;
    for (let d = 0; d <= 0.9; d += 0.04) if (ground(p0.x + f.x * d, p0.z + f.z * d) >= hy) { dFace = d; break; }
    const u = phase - Math.floor(phase), sway = Math.sin(u * Math.PI * 2) * 0.07;
    const hips = wpos(b.Hips), want = V().set(p0.x + f.x * (dFace - 0.3), hy + Math.sin(u * Math.PI * 4) * 0.025, p0.z + f.z * (dFace - 0.3)).addScaledVector(left, sway);
    this.shiftHips(want.sub(hips));
    // Chest a little away from the rock, head tipped back to look up the face.
    turnWorld(b.Spine, left, -0.04); turnWorld(b.Spine2, left, 0.08);
    turnWorld(b.Neck, left, -0.22); turnWorld(b.Head, left, -0.14);
    this.limbsTo(f, left, { RH: H.RH.pos, LH: H.LH.pos, RF: H.RF.pos, LF: H.LF.pos }, { RH: H.RH.moving, LH: H.LH.moving });
    this.blend(w);
  }

  // Arms and legs onto their holds: hands at the wrist just under and off each hold, palms on the
  // rock, fingers closed round it unless reaching; feet on the toe, knees toward the rock.
  // flat: the hands pressing down on a ledge (palms flat on it, fingers forward) rather than
  // gripping holds on a face.
  limbsTo(f, left, T, reaching = {}, flat = false) {
    const b = this.b;
    for (const a of this.arms) {
      const s = a.s, k = s[0] + 'H', side = s === 'Left' ? left : left.clone().negate(), hold = T[k];
      if (!hold) continue;
      const wrist = flat ? hold.clone().addScaledVector(UP, 0.05).addScaledVector(f, -0.07) : hold.clone().addScaledVector(UP, -0.07).addScaledVector(f, -0.06);
      reach(a.up, a.mid, a.end, wrist, flat ? f.clone().multiplyScalar(-1).addScaledVector(side, 0.6) : f.clone().multiplyScalar(-0.5).addScaledVector(UP, -1).addScaledVector(side, 0.7));
      // Fingers up over the hold and into the rock, palm against it (or flat on a ledge).
      const F = flat ? f.clone().addScaledVector(side, 0.25).normalize() : UP.clone().multiplyScalar(0.55).addScaledVector(f, 0.8).normalize();
      const P = flat ? UP.clone().negate() : f.clone().addScaledVector(UP, -0.35).normalize();
      P.addScaledVector(F, -P.dot(F)).normalize();
      const hf = this.handFrame[s];
      setWorldQuat(a.end, frameQuat(hf.f, hf.p, F, P));
      const grip = flat ? 0.15 : 1 - (reaching[k] ? Math.sin(Math.PI * reaching[k]) : 0);
      const palm = P.clone();
      for (const fg of this.fingers[s]) {
        const d = wpos(fg.next).sub(wpos(fg.bone)).normalize(), ax = V().crossVectors(d, palm);
        if (ax.lengthSq() > 1e-6) turnWorld(fg.bone, ax.normalize(), fg.amt * grip);
      }
    }
    for (const l of this.legs) {
      const k = l.s[0] + 'F', side = l.s === 'Left' ? left : left.clone().negate(), hold = T[k];
      if (!hold) continue;
      const ankle = hold.clone().addScaledVector(UP, ANKLE).addScaledVector(f, -0.13);
      reach(l.up, l.mid, l.end, ankle, f.clone().addScaledVector(side, 0.45));
      aim(l.end, l.toe, f.clone().addScaledVector(UP, -0.3));
    }
  }

  // Over the top. u: 0 to 1 through the press-up (the feet line rising to the lip); v: 0 to 1
  // through stepping on (after it). top: the lip's height; d: its distance ahead of the feet
  // line; hands: where both hands went on the lip.
  mantle(root, heading, ground, M, w = 1) {
    this.save();
    const b = this.b, f = V().set(Math.sin(heading), 0, Math.cos(heading)), left = V().set(f.z, 0, -f.x);
    const p0 = root.position, u = M.u, v = M.v, e = smoothstep(0, 1, u);
    // Hips: from hanging below the lip up to just over it, in against the edge; then up to
    // standing as he steps on.
    // Hips rise to the lip just off the rock, then come up over it to standing as he steps on.
    const press = lerp(M.y0 + 0.86, Math.max(M.top + 0.04, M.y0 + 0.86 - 0.1), e);
    const hipUp = v > 0 ? lerp(M.top + 0.04, p0.y + 0.86, smoothstep(0, 1, v)) : press;
    const reachIn = lerp(M.d - 0.32, M.d - 0.2, e);
    const hips = wpos(b.Hips), want = V().set(M.x + f.x * reachIn, hipUp, M.z + f.z * reachIn);
    if (v > 0) want.set(p0.x, hipUp, p0.z);
    this.shiftHips(want.sub(hips));
    // The chest folds over the lip as he presses up, so his shoulders come over his hands, then
    // straightens as he stands.
    const fold = lerp(0.15, 0.95, smoothstep(0.15, 0.85, u)) * (1 - smoothstep(0.1, 0.85, v));
    this.leanTrunk(left, fold);
    turnWorld(b.Head, left, -0.25 * (1 - v));
    // Hands stay on the lip until he is up; one knee comes up onto the top, then the other foot.
    const T = {};
    if (v < 0.45) {
      T.RH = M.hands[0]; T.LH = M.hands[1];
      // Both hands must reach the lip: whatever the arms fall short by, the body comes in closer.
      let short = 0; const toward = V();
      this.arms.forEach((a, i) => {
        const w = (i === 0 ? T.LH : T.RH).clone().addScaledVector(UP, 0.05).addScaledVector(f, -0.07), d = w.distanceTo(wpos(a.up));
        if (d - this.armLen * 0.97 > short) { short = d - this.armLen * 0.97; toward.copy(w).sub(wpos(a.up)).normalize(); }
      });
      if (short > 0) this.shiftHips(toward.multiplyScalar(short));
    }
    if (v < 0.05) {
      T.LF = M.feet[1];
      T.RF = u < 0.55 ? M.feet[0] : M.feet[0].clone().lerp(V().set(M.x + f.x * (M.d + 0.2), M.top, M.z + f.z * (M.d + 0.2)).addScaledVector(left, -0.14), smoothstep(0.55, 0.95, u));
    }
    this.limbsTo(f, left, T, {}, true);
    const wArm = 1 - smoothstep(0.25, 0.45, v), wLeg = 1 - smoothstep(0, 0.05, v);
    this.blend({ hips: w, spine: w, arm: w * wArm, leg: w * wLeg });
  }
}
