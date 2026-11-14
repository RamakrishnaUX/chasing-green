// Natural rock landmarks, rebuilt from photographs of the real places: Reynisfjara's columns,
// cave and stacks, Dyrhólaey's arch and lighthouse, and the others in this file. Each builder
// works in its landmark's local frame (+x east when the landmark faces 0, +z toward the sea or the
// road; y = 0 is the ground at the landmark's centre) and uses the pieces in basalt.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { basaltRock, columnField, basaltTone, massifGeometry, spireGeometry, sweepGeometry, masked, sandSheet, sstep, basaltNoise as noise } from './basalt.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const keep = (m) => { m.userData.keepShape = true; m.castShadow = m.receiveShadow = true; return m; };
const rockMesh = (geo) => keep(new THREE.Mesh(masked(geo), basaltRock()));

// A sea stack: spires merged into one craggy mass, each from the seabed (or the ground) up.
// parts: [{ x, z, top (above the sea), rx, rz, sharp, lean, rot }]
function stack(kit, parts, seed) {
  const sea = -kit.baseY;
  const geos = parts.map((p, i) => {
    let bed = Infinity;
    for (const [a, b] of [[0, 0], [p.rx, 0], [-p.rx, 0], [0, p.rz], [0, -p.rz]]) bed = Math.min(bed, kit.bed(p.x + a, p.z + b));
    return spireGeometry({ ...p, foot: bed - 2.5, top: sea + p.top, seed: seed + i * 7.3 });
  });
  const g = mergeGeometries(geos);
  geos.forEach((q) => q.dispose());
  g.computeVertexNormals();
  return rockMesh(g);
}

// ---------- Reynisfjara ----------
// The black beach under Reynisfjall. At its east end the mountain's cliff stands on a stepped
// pyramid of hexagonal basalt columns (Garðar) that you can climb, and just south of it, at the
// waterline, the cave Hálsanefshellir opens in the same columns, its roof a honeycomb of column
// ends. Off the mountain's tip stand the Reynisdrangar stacks: Landdrangur with its twin
// points, slender Háidrangur, and the jagged ridge of Langhamar. Here (+x east, +z south to the
// sea) the mountain runs south from the road between the beach and Vík's church on its knoll.
export function buildReynisfjara(kit) {
  const g = new THREE.Group();
  const rand = kit.rand, sea = -kit.baseY;
  // Reynisfjall's south end: rising from the land near the road to a grassy top about 24 m up,
  // lower toward its tip in the sea; kept well clear of the road.
  const H = (x, z) => 24 * sstep(-9, 16, z) * (1 - 0.25 * sstep(30, 50, z)) * sstep(5, 13, kit.roadDist(x, z));
  const CX = 6, warp = (z) => -6 * (1 - sstep(8, 26, z));
  // Hálsanefshellir: an arched opening in the west face, about 6 m deep and up to 9 m high.
  const C0 = 28, C1 = 34.5, CD = 6;
  const caveW = (z) => sstep(C0 - 0.5, C0 + 1.5, z) * (1 - sstep(C1 - 1.5, C1 + 0.5, z));
  const archTop = (z) => 7 + 3 * Math.sin(Math.PI * clamp((z - C0) / (C1 - C0), 0, 1));
  const { geometry, edge } = massifGeometry({
    // A cliff of columns about 12 m high at its foot, then steep grassy slopes to the ridge.
    cx: CX, cz: 20, ax: 12.5, az: 29, p: 2.3, N: 200, F: 16, T: 10, seed: 3, warp, topShape: 1.3, grassy: 0.75,
    lip: (x, z) => Math.max(kit.ground(x, z) + 0.3, Math.min(H(x, z) * 0.86, 3 + 0.32 * H(x, z) + 1.6 * noise(x * 0.07, z * 0.07))),
    top: (x, z) => Math.max(kit.ground(x, z) + 0.6, H(x, z) + 1.2),
    foot: (x, z) => kit.bed(x, z) - 2,
    inset: (x, z, y) => (x < CX + warp(z) ? CD * caveW(z) * (1 - sstep(archTop(z) - 2, archTop(z) + 0.6, y)) : 0),
  });
  g.add(keep(new THREE.Mesh(geometry, basaltRock())));

  // Garðar: hexagonal columns packed face to face against the cliff, stepping down from about
  // 15 m at the back to knee height at the front in irregular terraces (whole blocks of columns
  // broke off together), with lower columns running on along the foot of the cliff.
  const cols = [];
  const R = 0.5, DX = Math.sqrt(3) * R, DZ = 1.5 * R;
  const col = (x, y, z, h, o = {}) => cols.push({
    x, y, z, h, r: R * (0.92 + rand() * 0.06) * (o.s || 1), ry: (rand() - 0.5) * 0.16,
    tx: (rand() - 0.5) * (o.tilt ?? 0.05), tz: (rand() - 0.5) * (o.tilt ?? 0.05),
    c: basaltTone(rand, { lichen: o.lichen ?? 0.02, light: o.light || 0, base: [0.15, 0.155, 0.165], spread: 0.14 }),
  });
  const G0 = 10.5, G1 = 27.4;
  for (let r = 0, z = 4; z < C0 - 0.2; r++, z += DZ) {
    const xf = edge(z, -1);
    if (xf == null) continue;
    const u = (z - G0) / (G1 - G0), uc = u * 2 - 1, inG = u > 0 && u < 1;
    const depth = inG ? 7.5 * (1 - 0.4 * uc * uc) : 0; // beyond Garðar, set into the cliff
    for (let c = 0; ; c++) {
      const v = (c + (r % 2) * 0.5) * DX - 0.5; // out from the face; below 0 it is in the rock
      if (v > depth) break;
      const x = xf - v;
      let h;
      if (inG) {
        const hb = 12 * (1 - 0.45 * Math.pow(Math.abs(uc), 1.5)) * Math.pow(Math.max(0, 1 - v / depth), 1.15) + 0.45;
        // Terraces: whole blocks share a step; a few columns broke lower.
        const blk = noise(Math.floor(z / 2.4) * 3.1, Math.floor(v / 1.8) * 2.3) * 0.9;
        h = Math.max(0.35, Math.round((hb + blk) / 0.85) * 0.85 + (rand() - 0.5) * 0.22);
        if (rand() < 0.06) h *= 0.55 + rand() * 0.3;
      } else h = (6 + 3 * noise(z * 0.3, 7) + rand() * 1.5) * (1 - 0.6 * sstep(4, 9, -z + 12));
      const gy = kit.ground(x, z);
      col(x, gy - 0.8, z, h + 0.8, { lichen: h < 2 ? 0.08 : 0.015 });
    }
  }
  // The cave: columns lining its back and sides up to the roof, and the roof itself a honeycomb
  // of hanging column ends, ragged at the mouth.
  for (let r = 0, z = C0 + 0.2; z < C1 - 0.1; r++, z += DZ) {
    const xf = edge(z, -1);
    if (xf == null) continue;
    const d = CD * caveW(z), top = archTop(z);
    if (d < 0.8) continue;
    for (let c = 0; ; c++) {
      const v = (c + (r % 2) * 0.5) * DX + 0.15;
      if (v > d + 0.6) break;
      const x = xf + v, gy = kit.ground(x, z);
      const back = v > d - 0.9 || z < C0 + 1.1 || z > C1 - 1.2;
      if (back) col(x, gy - 0.6, z, top - gy + 2.5, { tilt: 0.02 });
      else {
        const hang = (v < 1.2 ? 1.6 : 0.4) + rand() * 1.1;
        col(x, top - 1.6 - hang, z, hang + 4, { tilt: 0.03, light: -0.05 });
      }
    }
  }
  // Rounded basalt boulders at the cliff foot and in the cave mouth.
  const cf = columnField(cols);
  g.add(cf);

  // Reynisdrangar, off the mountain's tip.
  g.add(stack(kit, [
    { x: 6.5, z: 54, top: 15, rx: 3.1, rz: 2.5, sharp: 0.62, lean: [0.6, 0.2], rot: 0.3 },
    { x: 8.9, z: 55.2, top: 11.5, rx: 2.1, rz: 1.9, sharp: 0.8, lean: [0.4, 0], rot: 1.1 },
    { x: 7.2, z: 54.6, top: 5.5, rx: 4.6, rz: 3.6, sharp: 0.05, rot: 0.2 },
  ], 11));
  g.add(stack(kit, [
    { x: 16, z: 65, top: 23.5, rx: 2.9, rz: 2.4, sharp: 0.86, lean: [-0.9, 0.5], rot: 0.5 },
    { x: 18, z: 65.6, top: 13, rx: 2.3, rz: 2.1, sharp: 0.55, lean: [0.3, 0], rot: 1.7 },
    { x: 16.6, z: 65.2, top: 4.5, rx: 4.3, rz: 3.7, sharp: 0, rot: 0.9 },
  ], 23));
  g.add(stack(kit, [
    { x: 23.2, z: 60, top: 11.5, rx: 2.3, rz: 2.5, sharp: 0.72, lean: [-0.4, 0], rot: 0.1 },
    { x: 25.6, z: 60.4, top: 15.5, rx: 2.4, rz: 2.6, sharp: 0.78, lean: [0.2, 0.3], rot: 0.7 },
    { x: 28.1, z: 60.2, top: 13.5, rx: 2.2, rz: 2.4, sharp: 0.68, rot: 1.3 },
    { x: 30.4, z: 59.8, top: 9.5, rx: 2.1, rz: 2.2, sharp: 0.6, lean: [0.6, 0], rot: 2.1 },
    { x: 26.8, z: 60.1, top: 6, rx: 6.6, rz: 2.9, sharp: 0, rot: 0 },
  ], 37));
  g.add(stack(kit, [{ x: 34, z: 68, top: 3.2, rx: 2.2, rz: 1.8, sharp: 0.3 }], 51));
  g.add(stack(kit, [{ x: 11.5, z: 59.5, top: 2.2, rx: 1.6, rz: 1.4, sharp: 0.2 }], 57));

  // The black sand: the whole beach from Dyrhólaey's cliffs to the columns, fading out inland
  // (where the grass starts) and up any rise.
  g.add(sandSheet(kit.ground, {
    x0: -48, x1: 8, z0: -5, z1: 44, step: 1.5, sea,
    amount: (x, z, y) => {
      const d = Math.hypot(x + 20, z - 16);
      return sstep(-48, -40, x) * sstep(-4, 5, z) * (1 - sstep(28, 36, d)) * (1 - sstep(9 - kit.baseY, 11 - kit.baseY, y));
    },
  }));
  return g;
}

// ---------- Dyrhólaey ----------
// The promontory west of Reynisfjara: a grassy plateau on sheer cliffs, the lighthouse on its
// high western part, and at its southern tip the great arch, a bridge of rock from the cliff to an
// outer pillar standing in the sea, the opening running east and west under it (boats pass
// through; seen from Reynisfjara you look through it). Arnardrangur stands below the east cliff,
// and two more stacks off the point. (+x east toward Reynisfjara, +z south to the sea.)
export function buildDyrholaey(kit) {
  const g = new THREE.Group();
  const sea = -kit.baseY;
  const H = (x, z) => 17 * sstep(-8, 14, z) * sstep(4, 12, kit.roadDist(x, z));
  const { geometry } = massifGeometry({
    cx: -14, cz: 28, ax: 15, az: 24, p: 2.2, N: 180, F: 20, T: 7, seed: 9, lean: 1.4,
    lip: (x, z) => Math.max(kit.ground(x, z) + 0.3, H(x, z) * 0.88),
    top: (x, z) => Math.max(kit.ground(x, z) + 0.6, H(x, z) + 1.5 + 2.2 * Math.exp(-((x + 19) ** 2 + (z - 34) ** 2) / 120)),
    foot: (x, z) => kit.bed(x, z) - 2,
  });
  g.add(keep(new THREE.Mesh(geometry, basaltRock())));
  // The arch: the bridge (thicker where it meets the cliff and the pillar, so its underside
  // curves up) and the outer pillar standing on the seabed.
  const ay = sea + 18;
  const bridge = sweepGeometry([[-9, ay, 44], [-8.5, ay + 0.6, 52], [-7.8, ay + 0.3, 59], [-7.2, ay - 0.6, 66]], {
    w: (t) => 11 - 1.5 * Math.sin(Math.PI * t), h: (t) => 8 + 5 * Math.pow(Math.abs(t * 2 - 1), 2.5), seed: 4, rough: 0.16,
  });
  g.add(rockMesh(bridge));
  g.add(stack(kit, [
    { x: -7, z: 68, top: 22, rx: 6.4, rz: 5.2, sharp: 0.05, rot: 0.2, ribs: 0.05 },
    { x: -4.5, z: 70.5, top: 9, rx: 3.6, rz: 3, sharp: 0.3, rot: 1 },
  ], 61));
  // Arnardrangur under the east cliff, and stacks off the point to the south-west.
  g.add(stack(kit, [{ x: 6, z: 42, top: 13, rx: 2.6, rz: 2.3, sharp: 0.45, lean: [0.3, 0], rot: 0.4 }, { x: 6.5, z: 42.4, top: 5, rx: 3.6, rz: 3.2, sharp: 0 }], 67));
  g.add(stack(kit, [{ x: -36, z: 62, top: 14, rx: 2.8, rz: 2.4, sharp: 0.7, lean: [0.5, 0.4], rot: 0.9 }, { x: -35, z: 62.5, top: 5, rx: 4, rz: 3.4, sharp: 0 }], 71));
  g.add(stack(kit, [{ x: -24, z: 74, top: 8, rx: 2.4, rz: 2.1, sharp: 0.55, rot: 0.3 }], 79));

  // Dyrhólaeyjarviti (1927): a stout square white tower with a parapet, the red lantern on top
  // behind its gallery, and the keeper's low house beside it.
  const lx = -19, lz = 34, ly = 17 + 1.5 + 2.2 - 0.7; // on the plateau's high point
  const std = (c, r = 0.8, ex = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0, ...ex });
  const white = std(0xeeece4, 0.75), red = std(0xb8302a, 0.5), dark = std(0x2a2c2e, 0.6);
  const lamp = std(0x2a2410, 0.2, { emissive: 0xfff0b8, emissiveIntensity: 0 });
  kit.nightLit(lamp, 3.2);
  const L = new THREE.Group();
  L.position.set(lx, ly, lz);
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; L.add(m); return m; };
  const tower = new THREE.CylinderGeometry(1.6, 1.85, 6.4, 4, 1); tower.rotateY(Math.PI / 4);
  add(tower, white, 0, 3.2, 0).userData.solid = true;
  add(new THREE.BoxGeometry(2.7, 0.35, 2.7), white, 0, 6.55, 0);
  for (const [x, z] of [[-1.2, 0], [1.2, 0], [0, -1.2], [0, 1.2]]) add(new THREE.BoxGeometry(x ? 0.25 : 2.7, 0.55, z ? 0.25 : 2.7), white, x, 7, z);
  add(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 8), red, 0, 6.95, 0);
  add(new THREE.CylinderGeometry(0.58, 0.58, 1.1, 8), lamp, 0, 7.75, 0);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; add(new THREE.BoxGeometry(0.06, 1.1, 0.06), red, Math.cos(a) * 0.6, 7.75, Math.sin(a) * 0.6); }
  add(new THREE.CylinderGeometry(0.15, 0.7, 0.55, 8), red, 0, 8.55, 0);
  add(new THREE.SphereGeometry(0.12, 8, 6), dark, 0, 8.9, 0);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.12, 0.9, 0.7), dark, s * 1.62, 4.3, 0);
  add(new THREE.BoxGeometry(0.7, 1.8, 0.12), dark, 0, 0.9, 1.62);
  const house = add(new THREE.BoxGeometry(5, 2.6, 3.6), white, 3.6, 1.3, 0.6); house.userData.solid = true;
  const roof = new THREE.CylinderGeometry(2.25, 2.25, 5.4, 3); roof.rotateZ(Math.PI / 2); roof.rotateX(-Math.PI / 2); roof.scale(1, 0.4, 1);
  add(roof, std(0x8e2620, 0.6), 3.6, 3.05, 0.6);
  g.add(L);
  return g;
}

// ---------- Stuðlagil ----------
// The canyon walls are a colonnade of slender hexagonal columns, packed face to face from the
// river to the grassy rim: twelve metres of upright basalt, dark grey with vertical bands of
// rust, their tops a ragged honeycomb under the turf. In places whole stretches fan out like
// the ribs of a shell, leaning away from a point near the water. c: the canyon (geo.js), a
// straight cut from c.a to c.b, c.w either side of its axis; ground(x, z): world heights.
export function buildStudlagilWalls(c, rand, ground) {
  const dx = c.b.x - c.a.x, dz = c.b.z - c.a.z, L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const R = 0.45, DU = Math.sqrt(3) * R, DN = 1.5 * R;
  const cols = [], walls = [];
  const yaw = Math.atan2(-uz, ux); // local x along the canyon, so neighbours sit flat to flat
  for (const sgn of [-1, 1]) {
    // Fans on this side: centre (along the canyon, 0 to 1), reach and how far they lean.
    const fans = sgn < 0 ? [[0.32, 0.07, 0.42], [0.71, 0.05, -0.35]] : [[0.5, 0.08, -0.4], [0.18, 0.04, 0.3]];
    const front0 = c.w * 0.43;
    for (let row = 0; row < 12; row++) {
      for (let i = 0; ; i++) {
        const t = 0.07 + (i * DU + (row % 2) * DU * 0.5) / L;
        if (t > 0.93) break;
        // The face wanders in and out along the canyon, and the odd column stands proud.
        const face = front0 + 0.7 * noise(t * 9 + sgn * 5, 1.7) + 0.35 * noise(t * 31, sgn * 3);
        const off = face + row * DN + (row === 0 ? (rand() - 0.5) * 0.25 : 0);
        const cx = c.a.x + dx * t, cz = c.a.z + dz * t, x = cx + nx * off * sgn, z = cz + nz * off * sgn;
        const rim = ground(cx + nx * (c.w + 1.5) * sgn, cz + nz * (c.w + 1.5) * sgn);
        const floor = ground(cx, cz), base = ground(x, z);
        // Ragged tops: a little under the rim, blocks of them broken lower near the edge.
        let top = rim - 0.75 + noise(t * 40 + sgn, row * 0.3) * 0.6 + (row < 2 ? -rand() * 0.6 : 0);
        if (row < 3 && noise(t * 18 + sgn * 9, 4.4) > 0.45) top -= 1.2 + rand();
        if (base > top - 0.5) continue; // the slope has reached the rim: turf from here
        let lean = 0;
        for (const [fc, fr, fa] of fans) { const d = (t - fc) / fr; if (Math.abs(d) < 1.6) lean += fa * Math.max(-1, Math.min(1, d)) * Math.exp(-0.5 * d * d * 0.4); }
        const y0 = Math.min(base, floor + 1) - 0.6, h = (top - y0) / Math.cos(lean);
        const rusty = noise(t * 11 + sgn * 2.3, 0.5) > 0.32;
        cols.push({
          x, y: y0, z, h, r: R * (0.93 + rand() * 0.06), ry: yaw + (rand() - 0.5) * 0.12, tx: (rand() - 0.5) * 0.03, tz: lean + (rand() - 0.5) * 0.03,
          c: basaltTone(rand, { base: [0.2, 0.2, 0.205], spread: 0.18, rust: rusty ? 0.75 : 0.05, lichen: 0.05, light: row > 4 ? 0.06 : 0 }),
        });
      }
    }
    // The column band is solid. You get into the canyon from either end, where it ramps down.
    const inner = front0 - 0.9, outer = c.w - 0.3, band = outer - inner;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(band, 10, L * 0.86), new THREE.MeshBasicMaterial());
    wall.visible = false;
    const mid = inner + band / 2;
    wall.position.set((c.a.x + c.b.x) / 2 + nx * mid * sgn, 0, (c.a.z + c.b.z) / 2 + nz * mid * sgn);
    wall.rotation.y = Math.atan2(ux, uz);
    wall.userData.collide = true;
    walls.push(wall);
  }
  return { mesh: columnField(cols), walls };
}

// ---------- Hvítserkur ----------
// A 15 m stack in Húnafjörður shaped like a beast drinking from the sea: its head and trunk
// reach down into the water at one end, its back humps up behind, and two arches open at its
// foot (the narrow one by the trunk, the broad one under the body). A thin slab of basalt,
// craggy all over, white on top with the droppings of its seabirds (hence the name, "white
// shirt"). Built as two craggy surfaces over its silhouette, meeting at its outline.
export function buildHvitserkur(kit) {
  const g = new THREE.Group();
  const W0 = -kit.baseY; // the sea surface
  let zs = 40;
  for (let z = 6; z < 220; z += 2) { if (kit.ground(0, z) + kit.baseY < -2.5) { zs = z + 18; break; } }
  // Silhouette in metres above the sea (x across, y up).
  const outer = [[-11, -7], [-11, 0.5], [-10.6, 6], [-10.1, 10.5], [-9.3, 13.4], [-8.5, 12.2], [-8.1, 8.5], [-7.1, 9.4], [-6.9, 14.8], [-5.2, 17.4], [-3.4, 17.1], [-2.2, 18.6], [0.4, 18.2], [1.6, 17.4], [3.4, 17.9], [5.6, 17.1], [7.6, 15.6], [9.3, 12.4], [10.4, 6.5], [10.9, 1.2], [11, -7]];
  const arches = [{ cx: -7.4, hw: 2.2, top: 5.6 }, { cx: 1.2, hw: 4.4, top: 5.8 }];
  const inPoly = (x, y) => { let c = false; for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) { const [xi, yi] = outer[i], [xj, yj] = outer[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const archR = (A) => Math.min(A.hw, A.top * 0.6), knee = (A) => A.top - archR(A);
  const inArch = (x, y) => arches.some((A) => { const dx = (x - A.cx) / A.hw; if (Math.abs(dx) >= 1) return false; return y < knee(A) || dx * dx + ((y - knee(A)) / archR(A)) ** 2 < 1; });
  const solid = (x, y) => inPoly(x, y) && !inArch(x, y);
  // The outline as points, for distances and for snapping.
  const B = [];
  const seg = (x0, y0, x1, y1) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.15)); for (let i = 0; i < n; i++) B.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
  for (let i = 0; i < outer.length - 1; i++) seg(...outer[i], ...outer[i + 1]);
  for (const A of arches) {
    const r = archR(A), k = knee(A);
    seg(A.cx - A.hw, -7, A.cx - A.hw, k); seg(A.cx + A.hw, -7, A.cx + A.hw, k);
    for (let i = 0; i <= 40; i++) { const a = Math.PI * i / 40; B.push([A.cx - Math.cos(a) * A.hw, k + Math.sin(a) * r]); }
  }
  // Outline points bucketed by metre, so each look-up only searches within 2 m (all the
  // rounding and snapping needs; further in, the slab is at full thickness).
  const bucket = new Map(), key = (i, j) => i * 1000 + j;
  for (const q of B) { const k = key(Math.floor(q[0]), Math.floor(q[1])); (bucket.get(k) || bucket.set(k, []).get(k)).push(q); }
  const near = (x, y) => {
    let best = 1e9, bx = x, by = y;
    const i0 = Math.floor(x), j0 = Math.floor(y);
    for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) for (const [px, py] of bucket.get(key(i, j)) || []) {
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < best) { best = d; bx = px; by = py; }
    }
    return [Math.sqrt(best), bx, by];
  };
  // Half-thickness: a slab about 6 m through, thinner at the head, thinning upward.
  const thick = (x, y) => (x < -7.6 ? 2.4 : 3.1 - Math.max(0, y - 12) * 0.22) * (1 + 0.12 * noise(x * 0.2, y * 0.2));
  const S = 0.42, nx = Math.ceil(23 / S), ny = Math.ceil(26.5 / S);
  const geos = [];
  for (const side of [1, -1]) {
    const pos = [], col = [], idx = [], ins = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      let x = -11.5 + i * S, y = -7.2 + j * S;
      const inside = solid(x, y), [d, bx, by] = near(x, y);
      let z = 0;
      if (inside) {
        const round = Math.sqrt(Math.min(1, d / 1.5));
        z = side * (thick(x, y) * round + (noise(x * 0.45 + side * 7, y * 0.45) * 0.45 + noise(x * 1.3, y * 1.3 + side) * 0.15) * round);
      } else { x = bx; y = by; }
      pos.push(x, W0 + y, zs + z);
      // Guano: white over the top, streaking down the upper flanks.
      const streak = Math.max(0, noise(x * 0.9 + side * 3, 2.2) - 0.3) * 1.6 * sstep(10, 15, y);
      const guano = clamp(sstep(15, 17.8, y) * 0.75 + streak * 0.45, 0, 0.8) * (inside ? 1 : 0.7);
      col.push(0, 0, guano);
      ins.push(inside);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      if (ins[a] || ins[b] || ins[d]) side > 0 ? idx.push(a, b, d) : idx.push(a, d, b);
      if (ins[a] || ins[d] || ins[c]) side > 0 ? idx.push(a, d, c) : idx.push(a, c, d);
    }
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    q.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    q.setIndex(idx);
    geos.push(q);
  }
  const geo = mergeGeometries(geos);
  geo.computeVertexNormals();
  const body = new THREE.Group();
  body.rotation.y = 0.25;
  body.add(keep(new THREE.Mesh(geo, basaltRock())));
  // The low shelf at the waterline the legs stand on (clear of the arches, for boats).
  body.add(stack(kit, [-10, -4.2, 6.2, 9].map((x) => ({ x, z: zs + noise(x, 1) * 1.5, top: 0.7, rx: 1.6, rz: 2.4, sharp: 0.1 })), 91));
  g.add(body);
  return g;
}

// ---------- Arnarstapi ----------
// Gatklettur: a squat rock standing off the cliffs with a round hole through it, the sea
// running in under its arch, its top a cap of turf. Below the village the shore is columnar
// basalt, short columns standing in the surf. (+z out to sea.)
export function buildGatklettur(kit, p = {}) {
  const g = new THREE.Group();
  const yb = Math.min(-4, -kit.baseY - 9), Z = 26;
  // The arch: swept up from the seabed, over and down, in its own upright plane.
  const path = [[-6.4, yb, Z], [-6.6, -1, Z], [-6.2, 3, Z], [-4.4, 6.6, Z], [-1.2, 8.4, Z], [1.8, 8.3, Z], [4.8, 6.2, Z], [6.3, 2.4, Z], [6.5, -1, Z], [6.2, yb, Z]];
  g.add(rockMesh(sweepGeometry(path, { w: () => 7.5, h: (t) => 4.6 + 2.4 * Math.pow(Math.abs(t * 2 - 1), 1.5), plane: [0, 0, 1], seed: 21, rough: 0.2 })));
  // Its mass beside and behind the hole, so it reads as a rock pierced, not a hoop.
  // (A stack's top is given above the sea; local heights are above the landmark's ground.)
  const up = (y) => y + kit.baseY;
  g.add(stack(kit, [
    { x: -8.6, z: Z + 0.5, top: up(8.6), rx: 3.4, rz: 4.2, sharp: 0.05, rot: 0.3 },
    { x: 8.4, z: Z - 0.4, top: up(7.4), rx: 3, rz: 3.8, sharp: 0.08, rot: 1.2 },
  ], 33));
  // Two boulders off the arch, standing on the seabed.
  g.add(stack(kit, [{ x: -18, z: 34, top: up(4.5), rx: 3.6, rz: 3.2, sharp: 0.1 }], 41));
  g.add(stack(kit, [{ x: 16, z: 38, top: up(3), rx: 3, rz: 2.8, sharp: 0.15 }], 43));
  // Columns in the surf along the shore: find the water's edge, then plant clusters there.
  const cols = [], R = 0.55;
  for (let x = -26; x <= 26; x += Math.sqrt(3) * R) {
    if (Math.abs(x) < 12) continue; // the arch's own cove
    let zs = null;
    for (let z = 0; z < 60; z += 0.5) if (kit.ground(x, z) + kit.baseY < 0.4) { zs = z; break; }
    if (zs == null) continue;
    for (let k = 0; k < 4; k++) {
      const z = zs - 1.5 + k * 1.5 * R * 2 + (Math.round(x / (Math.sqrt(3) * R)) % 2) * R * 1.5, y0 = kit.bed(x, z) - 1;
      const top = -kit.baseY + 1.2 + 3.5 * Math.max(0, noise(x * 0.12, 3.3)) - k * 0.9 + kit.rand() * 0.6;
      if (top - y0 < 0.8) continue;
      cols.push({ x, y: y0, z, h: top - y0, r: R * (0.92 + kit.rand() * 0.06), ry: (kit.rand() - 0.5) * 0.2, tx: (kit.rand() - 0.5) * 0.06, tz: (kit.rand() - 0.5) * 0.06, c: basaltTone(kit.rand, { lichen: 0.05 }) });
    }
  }
  if (cols.length) g.add(columnField(cols));
  return g;
}

// ---------- Þingvellir: Almannagjá ----------
// The rift's western wall: a long, high cliff of dark lava, cracked into blocks and leaning
// slabs, with the path running along its foot between it and the lower, broken eastern wall;
// the flag on its pole marks the Law Rock. (The group is turned a quarter round as before.)
export function buildAlmannagja(kit) {
  const g = new THREE.Group();
  const th = Math.PI / 4, c = Math.cos(th), s = Math.sin(th);
  const gl = (x, z) => kit.ground(x * c + z * s, -x * s + z * c);
  const crack = (z, y) => 0.9 * Math.max(0, noise(z * 0.45, y * 0.04 + 3)) + 0.4 * Math.abs(noise(z * 1.7, 9));
  const west = massifGeometry({
    // The edge of the lava plateau to the west: sheer on the rift side, easing down behind.
    cx: -13, cz: 0, ax: 9.5, az: 47, p: 5, N: 220, F: 14, T: 6, seed: 17, lean: 0.4, wob: 0.03,
    lip: (x, z) => gl(x, z) + (x > -13 ? 9 + 2.2 * noise(z * 0.05, 1.1) + 1.2 * noise(z * 0.2, 4) : 1.2) - 6 * sstep(36, 47, Math.abs(z)) * (x > -13 ? 1 : 0),
    top: (x, z) => gl(x, z) + 10 + 2 * noise(z * 0.05, 1.1) - 6 * sstep(36, 47, Math.abs(z)),
    foot: (x, z) => gl(x, z) - 2,
    inset: (x, z, y) => (x > -13 ? crack(z, y) : 0),
  });
  const east = massifGeometry({
    cx: 8, cz: 0, ax: 4.5, az: 44, p: 4, N: 180, F: 8, T: 4, seed: 23, lean: 0.8, wob: 0.06,
    lip: (x, z) => gl(x, z) + Math.max(0.6, 3.6 + 1.8 * noise(z * 0.09, 2.2) - 4 * sstep(34, 44, Math.abs(z))),
    top: (x, z) => gl(x, z) + Math.max(0.8, 4.2 + 1.6 * noise(z * 0.09, 2.2) - 4 * sstep(34, 44, Math.abs(z))),
    foot: (x, z) => gl(x, z) - 2,
    inset: (x, z, y) => (x < 8 ? crack(z + 40, y) * 0.8 : 0),
  });
  g.add(keep(new THREE.Mesh(masked(west.geometry), basaltRock())), keep(new THREE.Mesh(masked(east.geometry), basaltRock())));
  // Fallen blocks along the foot of the west wall.
  const blocks = [];
  for (let z = -38; z < 38; z += 7 + noise(z, 5) * 3) {
    const x = -3.2 + Math.abs(noise(z * 0.3, 1)) * 0.8, y0 = gl(x, z);
    blocks.push(spireGeometry({ x, z, foot: y0 - 0.6, top: y0 + 0.6 + Math.abs(noise(z, 2)) * 0.9, rx: 0.9, rz: 1.3, sharp: 0.05, K: 10, seed: z }));
  }
  const bg = mergeGeometries(blocks); bg.computeVertexNormals(); g.add(rockMesh(bg));
  // The path: fine grey gravel between the walls.
  const pos = [], idx = [], NZ = 60;
  for (let i = 0; i <= NZ; i++) {
    const z = -40 + (80 * i) / NZ;
    for (const x of [-2.2, -0.7, 0.7, 2.2]) pos.push(x, gl(x, z) + 0.06, z);
    if (i < NZ) for (let k = 0; k < 3; k++) { const a = i * 4 + k; idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5); }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pg.setIndex(idx); pg.computeVertexNormals();
  const path = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  path.receiveShadow = true; path.userData.notGround = true;
  g.add(path);
  // The flagpole at the Law Rock, on the wall's edge.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 7, 5), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, color: 0xcfd5d9 }));
  pole.position.set(-3.6, gl(-3.6, -8) + 3.5, -8);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, color: 0x2c5aa0, side: THREE.DoubleSide }));
  flag.position.set(-2.4, gl(-3.6, -8) + 6.2, -8);
  g.add(pole, flag);
  g.rotation.y = th;
  return g;
}

// ---------- Ásbyrgi ----------
// A horseshoe canyon: sheer walls of dark basalt with a grassy rim, open toward the road, and
// in its mouth the long rock island Eyjan; birch woods fill the floor round a small pond.
export function buildAsbyrgi(kit, extras) {
  const g = new THREE.Group();
  const R = 28, H = (t) => 22 * sstep(0, 0.12, t) * sstep(1, 0.88, t) + 3;
  const path = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28, a = -1.8 + t * 3.6, x = Math.sin(a) * R, z = -Math.cos(a) * R * 0.85 - 24;
    path.push([x, kit.ground(x, z) + H(t) / 2 - 2.5, z]);
  }
  g.add(rockMesh(sweepGeometry(path, { w: (t) => 13 + 2 * noise(t * 6, 1), h: (t) => H(t) + 5, K: 34, seed: 5, rough: 0.1, ramp: -1 })));
  const eyjan = massifGeometry({
    cx: 0, cz: -11, ax: 3.8, az: 12, p: 4, N: 120, F: 12, T: 5, seed: 29, lean: 0.5,
    lip: (x, z) => kit.ground(x, z) + 9 * sstep(2, -3, z),
    top: (x, z) => kit.ground(x, z) + 9.6 * sstep(2, -3, z) + 0.3,
    foot: (x, z) => kit.ground(x, z) - 2,
  });
  g.add(keep(new THREE.Mesh(masked(eyjan.geometry), basaltRock())));
  return g;
}

// ---------- Dimmuborgir ----------
// The "dark castles": ragged towers and walls of lava, the crust of a lava lake left standing
// when it drained, hollowed and holed, with birch and moss between; and the arch of Kirkjan.
export function buildDimmuborgir(kit) {
  const g = new THREE.Group(), rand = kit.rand;
  const geos = [];
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2, r = 4 + Math.sqrt(rand()) * 24;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 14;
    if (kit.roadDist(x, z) < 6) continue;
    const y0 = kit.ground(x, z), h = 3 + rand() * 9, w = 1.2 + rand() * 1.8;
    geos.push(spireGeometry({ x, z, foot: y0 - 1, top: y0 + h, rx: w, rz: w * (0.6 + rand() * 0.6), sharp: 0.15 + rand() * 0.35, lean: [(rand() - 0.5) * 1.5, (rand() - 0.5) * 1.5], K: 16, ribs: 0.1, seed: i * 3.7, rot: rand() * 3 }));
    // Many are clusters: a lower buttress leaning on the tower.
    if (rand() < 0.5) geos.push(spireGeometry({ x: x + (rand() - 0.5) * 2.5, z: z + (rand() - 0.5) * 2.5, foot: y0 - 1, top: y0 + h * (0.4 + rand() * 0.3), rx: w * 0.8, rz: w * 0.7, sharp: 0.3, K: 14, ribs: 0.12, seed: i * 5.1 }));
  }
  // Arches: Kirkjan and its neighbours, rough hoops of lava.
  for (let i = 0; i < 3; i++) {
    const cx = -12 + i * 11, cz = -20 - i * 2, y0 = kit.ground(cx, cz), hw = 2.4 + i * 0.4, top = 4.5 + i;
    geos.push(sweepGeometry([[cx - hw, y0 - 1.5, cz], [cx - hw - 0.2, y0 + top * 0.5, cz], [cx - hw * 0.5, y0 + top * 0.92, cz], [cx + hw * 0.5, y0 + top, cz], [cx + hw + 0.2, y0 + top * 0.5, cz], [cx + hw, y0 - 1.5, cz]],
      { w: () => 1.8, h: (t) => 1.3 + Math.pow(Math.abs(t * 2 - 1), 2) * 1.8, plane: [0, 0, 1], seed: i * 9, rough: 0.38, K: 14 }));
  }
  const geo = mergeGeometries(geos.map((q) => { q.deleteAttribute('normal'); return q; }));
  geo.computeVertexNormals();
  g.add(rockMesh(geo));
  return g;
}
