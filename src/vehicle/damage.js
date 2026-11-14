import * as THREE from 'three';

// Dents. A hit pushes the bodywork in where it landed: every vertex of the body within reach of
// the point moves along the blow, most at the centre and easing to nothing at the edge, with a
// little crumple so it is not a smooth dish. Dents add up (to a limit, so the car never folds
// into itself), and a fuel stop or a new car puts it right. A hard enough knock near a window
// breaks it out.
//
// The body is whatever bakeStatic merged in the car's own frame, plus any single parts left as
// they were; wheels, the steering, the mirrors and the cockpit are left alone. Points that share
// a position (the seams where normals are split) move together, so the skin never tears.

const _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _b = new THREE.Box3(), _c = new THREE.Vector3();
const MAX_DENT = 0.22; // metres any point may move in all

// A steady hash of a position, so coincident vertices crumple alike.
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

function bodyParts(car) {
  const out = [], glass = [];
  const walk = (o, top) => {
    if (o !== car.root && (o.userData.dynamic || o === car.skip)) return;
    if (o.isMesh && !o.userData.mirror) (o.material?.userData?.glass ? glass : out).push(o);
    for (const c of o.children) walk(c, false);
  };
  walk(car.root, true);
  return { out, glass };
}

export class Damage {
  // root: the car's model group (its own frame: x right, y up, z forward); skip: a part to leave
  // alone (the cockpit).
  constructor(root, skip = null) {
    this.root = root; this.skip = skip;
    this.parts = null; this.total = 0; this.broken = [];
  }

  // A blow at (lx, ly, lz) in the car's frame, pushing along (dx, dz) (unit, the car's frame) at
  // speed (m/s). Returns true if a window broke.
  dent(lx, ly, lz, dx, dz, speed) {
    if (speed < 4) return false;
    if (!this.parts) this.parts = bodyParts(this);
    const depth = Math.min(0.16, (speed - 3) * 0.009), R = 0.45 + Math.min(0.75, speed * 0.03);
    this.root.updateMatrixWorld(true);
    _inv.copy(this.root.matrixWorld).invert();
    const dir = new THREE.Vector3(dx, -0.12, dz).normalize();
    for (const m of this.parts.out) {
      // The blow, in this mesh's own frame.
      _rel.multiplyMatrices(_inv, m.matrixWorld).invert();
      const P = _p.set(lx, ly, lz).applyMatrix4(_rel);
      const scale = _d.setFromMatrixColumn(_rel, 0).length();
      const D = dir.clone().transformDirection(_rel);
      const r = R * scale, r2 = r * r;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox.distanceToPoint(P) > r) continue;
      if (!m.userData.dentOwn) { m.geometry = m.geometry.clone(); m.userData.dentOwn = true; }
      const geo = m.geometry, A = geo.attributes.position, a = A.array;
      if (!geo.userData.orig) { geo.userData.orig = a.slice(); geo.userData.origN = geo.attributes.normal?.array.slice(); }
      const o = geo.userData.orig, lim = MAX_DENT * scale;
      let moved = false;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i] - P.x, y = a[i + 1] - P.y, z = a[i + 2] - P.z, q = x * x + y * y + z * z;
        if (q >= r2) continue;
        const f = 1 - q / r2, w = f * f * depth * scale * (0.7 + 0.6 * hash(o[i], o[i + 1], o[i + 2]));
        let nx = a[i] + D.x * w, ny = a[i + 1] + D.y * w, nz = a[i + 2] + D.z * w;
        // Never further than the limit from where it started.
        const ex = nx - o[i], ey = ny - o[i + 1], ez = nz - o[i + 2], el = Math.hypot(ex, ey, ez);
        if (el > lim) { const k = lim / el; nx = o[i] + ex * k; ny = o[i + 1] + ey * k; nz = o[i + 2] + ez * k; }
        a[i] = nx; a[i + 1] = ny; a[i + 2] = nz; moved = true;
      }
      if (!moved) continue;
      A.needsUpdate = true;
      this.reshade(geo);
    }
    this.total += depth;
    // Windows near the blow break out.
    let broke = false;
    if (speed > 11) for (const m of this.parts.glass) {
      if (!m.visible) continue;
      _b.setFromObject(m).applyMatrix4(_inv);
      if (_b.distanceToPoint(_c.set(lx, ly, lz)) < 0.35 + speed * 0.02) { m.visible = false; this.broken.push(m); broke = true; }
    }
    return broke;
  }

  // New normals where the skin moved; where it did not, the model's own (so its creases and
  // smoothing are kept everywhere else).
  reshade(geo) {
    const N = geo.attributes.normal;
    if (!N) return;
    geo.computeVertexNormals();
    const a = geo.attributes.position.array, o = geo.userData.orig, on = geo.userData.origN, n = geo.attributes.normal.array;
    if (!on) return;
    for (let i = 0; i < a.length; i += 3) if (a[i] === o[i] && a[i + 1] === o[i + 1] && a[i + 2] === o[i + 2]) { n[i] = on[i]; n[i + 1] = on[i + 1]; n[i + 2] = on[i + 2]; }
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  // Good as new.
  repair() {
    if (!this.parts) return;
    for (const m of this.parts.out) {
      const g = m.geometry, o = g.userData.orig;
      if (!o) continue;
      g.attributes.position.array.set(o); g.attributes.position.needsUpdate = true;
      if (g.userData.origN && g.attributes.normal) { g.attributes.normal.array.set(g.userData.origN); g.attributes.normal.needsUpdate = true; }
      g.computeBoundingSphere();
    }
    for (const m of this.broken) m.visible = true;
    this.broken.length = 0;
    this.total = 0;
  }
}
