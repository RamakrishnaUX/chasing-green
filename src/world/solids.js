// Landmark landforms as solid ground. Mountains, stacks, cliffs, lava pillars and ice built as
// meshes sit on top of the terrain, and the car used to drive straight through them. Here the
// top surface of each one is drawn into a height grid when the world is built, so the ground
// under a wheel or a boot is the terrain or the landform above it, whichever is higher.
//
// Gentle slopes can be climbed like any hill; a face too steep to climb is a wall (see
// solidStep, used by the car and the walker).
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
export function addSolids(root) {
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
  const top = new Float32Array(nx * nz).fill(-Infinity);
  const ox = x0 - cell, oz = z0 - cell;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    const i0 = Math.floor((Math.min(ax, bx, cx) - ox) / cell), i1 = Math.floor((Math.max(ax, bx, cx) - ox) / cell);
    const j0 = Math.floor((Math.min(az, bz, cz) - oz) / cell), j1 = Math.floor((Math.max(az, bz, cz) - oz) / cell);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const yMax = Math.max(ay, by, cy);
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      const k = j * nx + ii;
      let y;
      if (Math.abs(det) < 1e-6) y = yMax; // a wall seen edge-on from above: its top edge
      else {
        const px = ox + (ii + 0.5) * cell, pz = oz + (j + 0.5) * cell;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
        const l3 = 1 - l1 - l2;
        const e = -0.5 * cell / Math.max(1e-3, Math.sqrt(Math.abs(det)));
        if (l1 < e || l2 < e || l3 < e) continue;
        y = Math.min(yMax, l1 * ay + l2 * by + l3 * cy);
      }
      if (y > top[k]) top[k] = y;
    }
  }
  tiles.push({ ox, oz, cell, nx, nz, top, x0: ox, x1: ox + nx * cell, z0: oz, z1: oz + nz * cell });
}

// Height of the landform top at (x, z), or -Infinity where there is none.
export function solidTopAt(x, z) {
  let best = -Infinity;
  for (const t of tiles) {
    if (x < t.x0 || x >= t.x1 || z < t.z0 || z >= t.z1) continue;
    const fx = (x - t.ox) / t.cell - 0.5, fz = (z - t.oz) / t.cell - 0.5;
    const i = Math.max(0, Math.min(t.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(t.nz - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const a = t.top[j * t.nx + i], b = t.top[j * t.nx + i + 1], c = t.top[(j + 1) * t.nx + i], d = t.top[(j + 1) * t.nx + i + 1];
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
export function solidStep(x, z, y, step) {
  return solidTopAt(x, z) > y + step;
}

export function solidTiles() { return tiles; }
