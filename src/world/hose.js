import * as THREE from 'three';

// A fuel hose as a rope of fixed length: a chain of points kept a set distance apart (Verlet), with
// gravity, a little stiffness (a rubber hose bends round in a loop rather than folding), friction
// where it lies on the ground, and whatever it must stay out of (the pump, the kerb, the car, the
// person) pushing it out. Both ends are held: at the pump, leaving it outward and down, and at the
// nozzle's tail, leaving it backward; the point next to each end is held too, so the hose leaves
// each the way a real one does instead of hinging there.
//
// stations.js settles one at rest (the nozzle in its holster) to draw every pump's hose; refuel.js
// starts the one in use from that same shape, so the hose never changes as it is picked up.

export const HOSE_R = 0.016; // its radius
const G = -9.8;
const STEP = 1 / 240; // fixed substep (s)
const ITER = 10; // constraint passes a substep

export class Hose {
  // n points over len metres.
  constructor(n, len) {
    this.n = n; this.len = len; this.seg = len / (n - 1);
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.o = Array.from({ length: n }, () => new THREE.Vector3());
    this._p = Array.from({ length: n }, () => new THREE.Vector3()); this._o = Array.from({ length: n }, () => new THREE.Vector3()); this._L = new Float32Array(n);
    this.acc = 0;
    this.minR = 0.14; this.stiff = 0.0008; // the tightest bend (radius, m) and the pull towards straight
    this.stretch = 0; // how far the chain is over length (m), when pulled taut
  }
  // Start from a list of points (any spacing): resampled along its length to the chain's.
  init(pts) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const tot = L[L.length - 1];
    for (let i = 0, k = 0; i < this.n; i++) {
      const s = (tot * i) / (this.n - 1);
      while (k < pts.length - 2 && L[k + 1] < s) k++;
      const u = (s - L[k]) / Math.max(1e-6, L[k + 1] - L[k]);
      this.p[i].lerpVectors(pts[k], pts[k + 1], Math.min(1, Math.max(0, u)));
      this.o[i].copy(this.p[i]);
    }
    return this;
  }
  // Pay out or wind in at the pump end to a new length: the hose slides out of (or into) the pump
  // there, the rest of it staying where it lies (each point takes the place of the hose now that
  // far from the pump), new hose coming straight out along aDir from a.
  resize(len, a, aDir) {
    const d = len - this.len;
    if (Math.abs(d) < 1e-5) return;
    const P = this.p, O = this.o, n = this.n, L = this._L, oldP = this._p, oldO = this._o, seg = len / (n - 1);
    L[0] = 0;
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + P[i].distanceTo(P[i - 1]);
    for (let i = 0; i < n; i++) { oldP[i].copy(P[i]); oldO[i].copy(O[i]); }
    // Along the old hose as it lies, which may be a little over its length when pulled: measured
    // in that, so the far end lands where it was and not a few centimetres short of the nozzle
    // (which the links then snatched back each time it was paid out or wound in).
    const fit = L[n - 1] / this.len;
    for (let i = 2, k = 0; i < n - 2; i++) {
      // Where this point's hose was, along the old hose. Wound in, the hose by the pump keeps its
      // shape and what goes in is taken up over the next half metre or so: taken straight off the
      // end it tugged the first few points in by a centimetre every frame and they sprang back,
      // a shiver at the pump all the way back to it.
      const w = d < 0 ? Math.min(1, Math.max(0, (i * seg - 0.08) / 0.6)) : 1;
      const s = (i * seg - d * w * w * (3 - 2 * w)) * fit;
      if (s <= 0) { P[i].copy(a).addScaledVector(aDir, i * seg); O[i].copy(P[i]); continue; }
      while (k < n - 2 && L[k + 1] < s) k++;
      const u = Math.min(1, (s - L[k]) / Math.max(1e-6, L[k + 1] - L[k]));
      // The same blend of the old positions and of the old previous positions, so the hose keeps
      // the velocity it had there and gains none.
      P[i].lerpVectors(oldP[k], oldP[k + 1], u);
      O[i].lerpVectors(oldO[k], oldO[k + 1], u);
    }
    this.len = len; this.seg = seg;
  }
  copyFrom(pts) { for (let i = 0; i < this.n; i++) { this.p[i].copy(pts[i]); this.o[i].copy(pts[i]); } return this; }

  // Run for dt seconds. a, aDir: the pump end and the way it leaves the pump (unit); b, bDir: the
  // nozzle end and the way it leaves the nozzle (unit). collide(p, r, i): push point i, p (a
  // Vector3, changed in place), out of anything solid, returning true if it touched the ground
  // (friction).
  step(dt, a, aDir, b, bDir, collide) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const n = this.n, s = this.seg, p = this.p, o = this.o;
    // The tightest it bends: a radius, whatever the links' length (two links turning by s / R).
    const lim = 2 * s * Math.cos(Math.min(1.2, s / (2 * this.minR)));
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (let i = 2; i < n - 2; i++) {
        const q = p[i], v = _v.subVectors(q, o[i]).multiplyScalar(this.floor?.[i] ? 0.6 : 0.985);
        o[i].copy(q);
        q.add(v); q.y += G * STEP * STEP;
      }
      p[0].copy(a); p[1].copy(a).addScaledVector(aDir, s);
      p[n - 1].copy(b); p[n - 2].copy(b).addScaledVector(bDir, s);
      for (let it = 0; it < ITER; it++) {
        for (let i = 1; i < n - 2; i++) link(p[i], p[i + 1], s, share(i, i + 1, n), false);
        // Stiffness: a gentle pull towards straight, and a hard limit on how tight it bends.
        for (let i = 0; i < n - 2; i++) {
          const w = share(i, i + 2, n);
          if (w < 0) continue;
          link(p[i], p[i + 2], lim, w, true);
          link(p[i], p[i + 2], 2 * s, w, true, this.stiff);
        }
        // Tethers: no point further from either end than the hose between them, so a quick pull on
        // one end straightens the hose at once instead of stretching it.
        for (let i = 2; i < n - 2; i++) { tether(p[i], p[1], (i - 1) * s); tether(p[i], p[n - 2], (n - 2 - i) * s); }
        p[0].copy(a); p[1].copy(a).addScaledVector(aDir, s);
        p[n - 1].copy(b); p[n - 2].copy(b).addScaledVector(bDir, s);
        if (collide) {
          this.floor ||= new Uint8Array(n);
          for (let i = 2; i < n - 2; i++) this.floor[i] = collide(p[i], HOSE_R, i) ? 1 : 0;
        }
      }
    }
    let L = 0; for (let i = 1; i < n; i++) L += p[i].distanceTo(p[i - 1]);
    this.stretch = L - this.len;
  }
}

const _v = new THREE.Vector3(), _d = new THREE.Vector3();
// How a correction between points i and j is shared: j's share, or -1 if both are held (the two
// at each end are).
const held = (i, n) => i <= 1 || i >= n - 2;
const share = (i, j, n) => (held(i, n) ? (held(j, n) ? -1 : 1) : held(j, n) ? 0 : 0.5);
// Pull q back to within r of c.
function tether(q, c, r) {
  _d.subVectors(q, c);
  const d = _d.length();
  if (d > r && d > 1e-9) q.copy(c).addScaledVector(_d, r / d);
}
// Move a and b towards distance len apart: w is b's share of the move (0: only a moves). min: only
// push apart (a lower limit), at stiffness k.
function link(a, b, len, w, min, k = 1) {
  _d.subVectors(b, a);
  const d = _d.length();
  if (d < 1e-9 || (min && d >= len)) return;
  const e = ((d - len) / d) * k;
  a.addScaledVector(_d, e * (1 - w));
  b.addScaledVector(_d, -e * w);
}

// A tube along the points (a smooth curve through them), r thick: into geo's buffers if it was made
// by this with the same counts, else a new one.
export function hoseTube(pts, geo, segs = 64, r = HOSE_R) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs, r, 7, false);
  if (geo && geo.attributes.position?.count === g.attributes.position.count) {
    geo.attributes.position.array.set(g.attributes.position.array);
    geo.attributes.normal.array.set(g.attributes.normal.array);
    geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
    g.dispose();
    return geo;
  }
  geo?.dispose();
  return g;
}
