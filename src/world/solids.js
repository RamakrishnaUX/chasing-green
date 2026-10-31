// Landmark landforms as solid ground. Mountains, stacks, cliffs, lava pillars and ice built as
// meshes sit on top of the terrain, and the car used to drive straight through them. Here the
// top surface of each one is drawn into a height grid when the world is built, so the ground
// under a wheel or a boot is the terrain or the landform above it, whichever is higher.
//
// Gentle slopes can be climbed like any hill; a face too steep to climb is a wall (see
// solidStep, used by the car and the walker).
//
// Each cell also keeps its ceiling: where a landform starts above the ground or water, open
// beneath, as under a sea arch. Faces below the ground say whether the ground there is inside
// rock (more faces looking down than up: a buried bottom), which is solid all the way up. If not,
// and the first face above looks down, that is the ceiling. Something that fits beneath it passes.
import * as THREE from 'three';

const tiles = [];
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
const im = new THREE.Matrix4(), wm = new THREE.Matrix4(), box = new THREE.Box3();

// Things that are not landforms: water and falls (see-through or custom shaders), and anything
// small enough to be a post, sign or plank.
function isLandform(m) {
  if (!m.isMesh || !m.visible || Array.isArray(m.material)) return false;
  if (m.material.transparent || m.material.isShaderMaterial || m.material.isPointsMaterial) return false;
  if (m.userData.collide || m.userData.solid || m.userData.solidCircle || m.userData.notGround) return false;
  if (!m.geometry?.attributes.position) return false;
  // Measured in world space, so a disc laid flat (a pool, a patch of ground) does not count.
  const s = box.setFromObject(m).getSize(va);
  return Math.max(s.x, s.z) >= 2.5 && s.y >= 1.2;
}

// Draw the meshes under root into a new tile of top heights. Cells are about a metre.
// floor(x, z): the ground or water level there, below which a face looking down is buried.
export function addSolids(root, floor = null) {
  root.updateMatrixWorld(true);
  const tris = [];
  root.traverse((m) => {
    if (!isLandform(m)) return;
    const g = m.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    const count = m.isInstancedMesh ? m.count : 1;
    for (let k = 0; k < count; k++) {
      if (m.isInstancedMesh) { m.getMatrixAt(k, im); wm.multiplyMatrices(m.matrixWorld, im); } else wm.copy(m.matrixWorld);
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        va.fromBufferAttribute(pos, a).applyMatrix4(wm);
        vb.fromBufferAttribute(pos, b).applyMatrix4(wm);
        vc.fromBufferAttribute(pos, c).applyMatrix4(wm);
        tris.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
      }
    }
  });
  if (!tris.length) return;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]);
    z0 = Math.min(z0, tris[i + 2]); z1 = Math.max(z1, tris[i + 2]);
  }
  const cell = Math.max(1, Math.max(x1 - x0, z1 - z0) / 700);
  const nx = Math.ceil((x1 - x0) / cell) + 2, nz = Math.ceil((z1 - z0) / cell) + 2;
  const top = new Float32Array(nx * nz).fill(-Infinity), ceil = new Float32Array(nx * nz).fill(Infinity);
  const ox = x0 - cell, oz = z0 - cell;
  const under = new Float32Array(nx * nz).fill(NaN); // floor, read once per cell
  const low = new Float32Array(nx * nz).fill(Infinity), lowDown = new Uint8Array(nx * nz); // first face above the floor
  const inside = new Int16Array(nx * nz); // faces below the floor, down minus up
  const wall = new Uint8Array(nx * nz); // an upright face here reaches down to the floor
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    const i0 = Math.floor((Math.min(ax, bx, cx) - ox) / cell), i1 = Math.floor((Math.max(ax, bx, cx) - ox) / cell);
    const j0 = Math.floor((Math.min(az, bz, cz) - oz) / cell), j1 = Math.floor((Math.max(az, bz, cz) - oz) / cell);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const yMax = Math.max(ay, by, cy);
    // Upright (or within about 3 degrees of it): handled as a wall, cell by cell along its line.
    const n1 = (by - ay) * (cz - az) - (bz - az) * (cy - ay), n2 = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), n3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const upright = Math.abs(det) < 1e-6 || Math.abs(n2) < 0.05 * Math.hypot(n1, n2, n3);
    // Facing down: the y part of the triangle's normal is negative.
    const down = floor && (bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0;
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      const k = j * nx + ii;
      let y;
      const px = ox + (ii + 0.5) * cell, pz = oz + (j + 0.5) * cell;
      if (upright) {
        // A wall seen edge-on from above: only the cells it runs through, at its height there.
        const span = wallSpan(ax, ay, az, bx, by, bz, cx, cy, cz, px, pz, cell);
        if (!span) continue;
        y = span[1];
        // How low does it come here? Down to the floor, it is a wall; higher up (the face of an
        // arch above its opening), it is a ceiling.
        if (floor) {
          if (Number.isNaN(under[k])) under[k] = floor(px, pz);
          if (span[0] <= under[k] + 0.6) wall[k] = 1;
          else if (span[0] < low[k]) { low[k] = span[0]; lowDown[k] = 1; }
        }
      } else {
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
        const l3 = 1 - l1 - l2;
        const e = -0.5 * cell / Math.max(1e-3, Math.sqrt(Math.abs(det)));
        if (l1 < e || l2 < e || l3 < e) continue;
        y = Math.min(yMax, l1 * ay + l2 * by + l3 * cy);
        // The count needs each face once per cell, so it skips the edge allowance used for tops.
        if (floor && l1 >= 0 && l2 >= 0 && l3 >= 0) {
          if (Number.isNaN(under[k])) under[k] = floor(px, pz);
          if (y <= under[k] + 0.6) inside[k] += down ? 1 : -1;
          else if (y < low[k]) { low[k] = y; lowDown[k] = down ? 1 : 0; }
        }
      }
      if (y > top[k]) top[k] = y;
    }
  }
  for (let k = 0; k < nx * nz; k++) if (lowDown[k] && inside[k] <= 0 && !wall[k]) ceil[k] = low[k];
  tiles.push({ ox, oz, cell, nx, nz, top, ceil, x0: ox, x1: ox + nx * cell, z0: oz, z1: oz + nz * cell });
}

// The height range of an upright triangle above the point (px, pz), if it passes within half a
// cell of it: [lowest, highest], or null.
function wallSpan(ax, ay, az, bx, by, bz, cx, cy, cz, px, pz, cell) {
  const P = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
  let p0 = P[0], p1 = P[1], best = -1;
  for (let i = 0; i < 3; i++) for (let k = i + 1; k < 3; k++) { const d = (P[i][0] - P[k][0]) ** 2 + (P[i][2] - P[k][2]) ** 2; if (d > best) { best = d; p0 = P[i]; p1 = P[k]; } }
  if (best < 1e-8) return null;
  const L = Math.sqrt(best), ux = (p1[0] - p0[0]) / L, uz = (p1[2] - p0[2]) / L;
  if (Math.abs((px - p0[0]) * uz - (pz - p0[2]) * ux) > cell * 0.5) return null;
  const U = P.map((q) => (q[0] - p0[0]) * ux + (q[2] - p0[2]) * uz), uMin = Math.min(...U), uMax = Math.max(...U);
  let uc = (px - p0[0]) * ux + (pz - p0[2]) * uz;
  if (uc < uMin - cell * 0.5 || uc > uMax + cell * 0.5) return null;
  uc = Math.min(uMax, Math.max(uMin, uc)); // a wall ending inside this cell still covers it
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 3; i++) {
    const k = (i + 1) % 3, u0 = U[i], u1 = U[k];
    if ((uc - u0) * (uc - u1) > 0 || u0 === u1) continue;
    const y = P[i][1] + ((uc - u0) / (u1 - u0)) * (P[k][1] - P[i][1]);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return lo < Infinity ? [lo, hi] : null;
}

// Height of the landform top at (x, z), or -Infinity where there is none. With clear (the top
// of whatever is asking), a landform whose underside is higher than that does not count: a boat
// passing beneath an arch.
export function solidTopAt(x, z, clear = null) {
  let best = -Infinity;
  for (const t of tiles) {
    if (x < t.x0 || x >= t.x1 || z < t.z0 || z >= t.z1) continue;
    const fx = (x - t.ox) / t.cell - 0.5, fz = (z - t.oz) / t.cell - 0.5;
    const i = Math.max(0, Math.min(t.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(t.nz - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const k0 = j * t.nx + i, ks = [k0, k0 + 1, k0 + t.nx, k0 + t.nx + 1];
    const [a, b, c, d] = ks.map((k) => (clear != null && t.ceil[k] < Infinity && t.ceil[k] > clear ? -Infinity : t.top[k]));
    let h;
    if (a > -Infinity && b > -Infinity && c > -Infinity && d > -Infinity) h = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    else {
      // At the rim only some corners are solid: use the nearest one that is.
      const near = [[a, u + v], [b, 1 - u + v], [c, u + 1 - v], [d, 2 - u - v]].filter(([y]) => y > -Infinity).sort((p, q) => p[1] - q[1]);
      if (!near.length || near[0][1] > 1.2) continue;
      h = near[0][0];
    }
    if (h > best) best = h;
  }
  return best;
}

// True when moving onto (x, z) would mean climbing a landform face steeper than the given
// step from the current height y: the caller treats it as a wall.
export function solidStep(x, z, y, step, clear = null) {
  return solidTopAt(x, z, clear) > y + step;
}

export function solidTiles() { return tiles; }
