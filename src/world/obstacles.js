// Solid things the vehicle and walker bump into: rocks, landmark cliffs, buildings and trees.
// Circles and yaw-rotated boxes in a spatial hash, so a query only checks nearby shapes.

const CELL = 32;
const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;

export class Obstacles {
  constructor() { this.cells = new Map(); this.count = 0; }

  insert(o, minX, maxX, minZ, maxZ) {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(o);
      }
    this.count++;
  }
  addCircle(x, z, r, kind = 'rock') { this.insert({ circle: true, x, z, r, kind }, x - r, x + r, z - r, z + r); }
  addBox(x, z, rot, hx, hz, kind = 'wall') {
    const e = Math.hypot(hx, hz);
    this.insert({ x, z, rot, hx, hz, kind }, x - e, x + e, z - e, z + e);
  }

  // Add every mesh under obj flagged userData.solid (box) or userData.solidCircle (radius).
  addFromObject(obj, kind = 'wall') {
    obj.updateMatrixWorld(true);
    obj.traverse((m) => {
      if (!m.isMesh) return;
      if (m.userData.solidCircle) {
        const e = m.matrixWorld.elements;
        this.addCircle(e[12], e[14], m.userData.solidCircle, m.userData.kind || kind);
      } else if (m.userData.solid) {
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox, e = m.matrixWorld.elements;
        const sx = Math.hypot(e[0], e[1], e[2]), sz = Math.hypot(e[8], e[9], e[10]);
        const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
        const wx = e[0] * cx + e[8] * cz + e[12], wz = e[2] * cx + e[10] * cz + e[14];
        const rot = Math.atan2(e[8], e[10]);
        this.addBox(wx, wz, rot, ((bb.max.x - bb.min.x) / 2) * sx, ((bb.max.z - bb.min.z) / 2) * sz, m.userData.kind || kind);
      }
    });
  }

  // Push a circle of radius r out of anything it overlaps. Returns the strongest contact
  // { nx, nz, depth, kind } or null.
  resolve(pos, r) {
    const cx = Math.floor(pos.x / CELL), cz = Math.floor(pos.z / CELL);
    let hit = null;
    const seen = new Set();
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const list = this.cells.get(key(ix, iz));
      if (!list) continue;
      for (const c of list) {
        if (seen.has(c)) continue;
        seen.add(c);
        let nx = 0, nz = 0, depth = 0;
        if (c.circle) {
          const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
          if (d >= min || d < 1e-5) continue;
          nx = dx / d; nz = dz / d; depth = min - d;
        } else {
          const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
          const ex = c.hx + r, ez = c.hz + r;
          if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
          const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
          let lnx = 0, lnz = 0;
          if (px < pz) { lnx = Math.sign(lx || 1); depth = px; } else { lnz = Math.sign(lz || 1); depth = pz; }
          nx = lnx * cs + lnz * sn; nz = -lnx * sn + lnz * cs;
        }
        pos.x += nx * depth; pos.z += nz * depth;
        if (!hit || depth > hit.depth) hit = { nx, nz, depth, kind: c.kind };
      }
    }
    return hit;
  }
}
