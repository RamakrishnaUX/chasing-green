// Walk-in interiors for Harpa and Hallgrímskirkja, and the pieces they are built from.
//
// You walk in through the front door; a car never gets in (an invisible box the size of the
// building stops vehicles but not someone on foot). Inside, hidden walls keep you to the rooms,
// stairs and stages are steps you can climb, and each room is marked so the walking camera stays
// inside it instead of swinging out through a wall.
import * as THREE from 'three';

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
// Interior finishes are not given the realistic look's scanned rock and grass (see detailScene).
const std = (color, rough = 0.85, metal = 0, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }); m.userData.noDetail = true; return m; };
// Lit from inside: a steady glow, so a room in the building's shadow still reads.
const indoor = (color, rough, glow, metal = 0) => std(color, rough, metal, { emissive: glow, emissiveIntensity: 1 });

function M(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Hidden shapes, read by Landmarks.collectColliders before the model is baked. A wall stops you on
// foot and in a car; carOnly stops only vehicles; a room keeps the walking camera inside it.
function hidden(g, x, z, w, d, rot, h, y = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIDDEN);
  m.position.set(x, y + h / 2, z);
  m.rotation.y = rot;
  m.visible = false;
  g.add(m);
  return m;
}
export const wall = (g, x, z, w, d, rot = 0) => { hidden(g, x, z, w, d, rot, 4).userData.collide = true; };
export const carWall = (g, x, z, w, d, rot = 0) => { const m = hidden(g, x, z, w, d, rot, 6); m.userData.collide = true; m.userData.carOnly = true; };
export const room = (g, x, z, w, d, y0, y1, rot = 0) => { hidden(g, x, z, w, d, rot, y1 - y0, y0).userData.room = true; };
// A step, stage or raised floor you can climb onto: a visible solid block from the floor up.
function block(g, mat, x, z, w, d, top, rot = 0) {
  const m = M(new THREE.BoxGeometry(w, top, d), mat, x, top / 2, z);
  m.rotation.y = rot;
  m.userData.collide = true;
  g.add(m);
  return m;
}

// A straight wall from a to b, y0 to y1, in two layers: outMat outside, inMat on the side facing
// (cx, cz). Either may be null. Openings [{ at, w, h }] are measured along the wall from a, from
// the floor (y = 0). With collide, the parts that reach the floor are walls on foot as well.
export function wallLine(g, ax, az, bx, bz, y0, y1, { cx, cz, outMat = null, inMat = null, t = 0.5, openings = [], collide = true }) {
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
  let nx = -uz, nz = ux;
  if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; }
  const rot = Math.atan2(-uz, ux);
  const pieces = [];
  let s = 0;
  for (const o of [...openings].sort((p, q) => p.at - q.at)) {
    const a = o.at - o.w / 2, b = o.at + o.w / 2;
    if (a > s) pieces.push([s, a, y0, y1]);
    if (o.h < y1) pieces.push([a, b, o.h, y1]);
    s = b;
  }
  if (s < L) pieces.push([s, L, y0, y1]);
  for (const [s0, s1, yb, yt] of pieces) {
    const w = s1 - s0, mx = ax + ux * (s0 + s1) / 2, mz = az + uz * (s0 + s1) / 2, my = (yb + yt) / 2;
    for (const [mat, k] of [[outMat, -1], [inMat, 1]]) {
      if (!mat) continue;
      const th = outMat && inMat ? t / 2 : t, off = outMat && inMat ? k * t / 4 : 0;
      const m = M(new THREE.BoxGeometry(w, yt - yb, th), mat, mx + nx * off, my, mz + nz * off);
      m.rotation.y = rot;
      g.add(m);
    }
    if (collide && yb <= 0.5) wall(g, mx, mz, w, t + 0.2, rot);
  }
}

// A pointed (Gothic) arch rib: span wide, springing at y0 and rising to the apex, t thick.
function ribShape(span, y0, apex, t) {
  const o = span / 2, i = o - t, s = new THREE.Shape();
  const rise = apex - y0;
  s.moveTo(-o, y0); s.quadraticCurveTo(-o, y0 + rise * 0.85, 0, apex); s.quadraticCurveTo(o, y0 + rise * 0.85, o, y0);
  s.lineTo(i, y0); s.quadraticCurveTo(i, y0 + (rise - t) * 0.85, 0, apex - t); s.quadraticCurveTo(-i, y0 + (rise - t) * 0.85, -i, y0);
  s.closePath();
  return s;
}
function rib(span, y0, apex, t, depth) {
  const g = new THREE.ExtrudeGeometry(ribShape(span, y0, apex, t), { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Harpa. Local frame: the hall's shell spans x -17..17 and z -16..8, the glass front at z = 8
// facing the road, with its door in the middle. Inside: the foyer under a dark mirrored ceiling,
// stairs up to a raised upper foyer on the east side, a café, and Eldborg, the red main hall, in
// the west half, entered through a doorway from the foyer.
export const HARPA_DOOR = { w: 4.4, h: 4.2 };
export function harpaInterior(g, kit, roofY) {
  const floor = std(0x1c1e21, 0.28, 0.25);
  const stone = indoor(0x2a2c30, 0.6, 0x08090a);
  const red = indoor(0x6e1a14, 0.55, 0x1c0604);
  const redDark = indoor(0x4a120e, 0.6, 0x120403);
  const char = indoor(0x2b1714, 0.7, 0x0a0504);
  const wood = indoor(0x8a5a32, 0.5, 0x140c06);
  const velvet = indoor(0x8c1d1d, 0.9, 0x1a0505);
  const white = indoor(0xd8d4cc, 0.6, 0x2a2826);

  // Foyer floor: dark polished stone.
  const fl = M(new THREE.PlaneGeometry(33.8, 23.8), floor, 0, 0.04, -4); fl.rotation.x = -Math.PI / 2; g.add(fl);

  // Ceiling lights: a grid of small warm points under the mirrored roof.
  const dot = new THREE.SphereGeometry(0.09, 6, 4), dotMat = std(0x332200, 0.4, 0, { emissive: 0xffd9a0, emissiveIntensity: 2.2 });
  const pts = [];
  for (let x = -15; x <= 15; x += 2.5) for (let z = -14.5; z <= 6.5; z += 2.5) if (!(x < 3.6 && z < -4)) pts.push([x, roofY(x, z) - 0.25, z]);
  const lights = new THREE.InstancedMesh(dot, dotMat, pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach(([x, y, z], k) => lights.setMatrixAt(k, m4.makeTranslation(x, y, z)));
  g.add(lights);

  // Hidden walls along the shell, the front split round the door.
  const D = HARPA_DOOR.w / 2;
  wall(g, -(17 + D) / 2, 8.3, 17 - D, 0.8); wall(g, (17 + D) / 2, 8.3, 17 - D, 0.8);
  wall(g, 0, -16.3, 34.6, 0.8); wall(g, -17.3, -4, 0.8, 25); wall(g, 17.3, -4, 0.8, 25);
  // Cars stop at the building, door or not.
  carWall(g, 0, -3.6, 35.2, 26.4);
  room(g, 0, -4, 33.6, 23.6, 0, 13);

  // Eldborg: the west half, from the shell's walls to x = 3.6 and z = -4.2. Dark outside, deep
  // red within, entered from the foyer.
  const EX = 3.6, EZ = -4.2, EH = 10.5, cx = -6.7, cz = -10.1;
  wallLine(g, -17, EZ, EX, EZ, 0, EH, { cx, cz, outMat: char, inMat: red, t: 0.4, openings: [{ at: 11.5, w: 3, h: 3.4 }] });
  wallLine(g, EX, EZ, EX, -16, 0, EH, { cx, cz, outMat: char, inMat: red, t: 0.4 });
  wallLine(g, -16.7, EZ, -16.7, -16, 0, EH, { cx, cz, inMat: red, t: 0.2, collide: false });
  wallLine(g, -17, -15.7, EX, -15.7, 0, EH, { cx, cz, inMat: red, t: 0.2, collide: false });
  const lid = M(new THREE.BoxGeometry(EX + 17, 0.4, 11.8), char, (EX - 17) / 2, EH + 0.2, (EZ - 16) / 2); g.add(lid);
  const under = M(new THREE.PlaneGeometry(EX + 17, 11.8), redDark, (EX - 17) / 2, EH - 0.01, (EZ - 16) / 2); under.rotation.x = Math.PI / 2; g.add(under);
  room(g, (EX - 17) / 2, (EZ - 16) / 2, EX + 16.6, 11.4, 0, EH - 0.2);
  // Stage at the back, a grand piano on it, and an acoustic canopy above.
  block(g, wood, (EX - 17) / 2, -14.2, EX + 16.6, 3, 1.0);
  const piano = std(0x0c0c0e, 0.25, 0.3);
  g.add(M(new THREE.BoxGeometry(1.5, 0.35, 2.0), piano, -6.5, 1.85, -14));
  for (const [x, z] of [[-7.1, -13.2], [-5.9, -13.2], [-6.5, -14.8]]) g.add(M(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), piano, x, 1.35, z));
  const lidP = M(new THREE.BoxGeometry(1.45, 0.04, 1.9), piano, -6.5, 2.35, -14.1); lidP.rotation.z = 0.5; lidP.position.x -= 0.3; g.add(lidP);
  for (let k = 0; k < 4; k++) { const p = M(new THREE.BoxGeometry(3.4, 0.08, 1.6), white, -12 + k * 4.2, 8.2 - k * 0.15, -13.6); p.rotation.x = 0.25; g.add(p); }
  // Seats: two blocks facing the stage, an aisle in line with the doorway between them.
  const seatGeo = new THREE.BoxGeometry(0.5, 0.14, 0.46), backGeo = new THREE.BoxGeometry(0.5, 0.62, 0.08), baseGeo = new THREE.BoxGeometry(0.42, 0.38, 0.36);
  const seats = [], blocks = [[-15.4, -6.6], [-4.4, 2.8]];
  for (let r = 0; r < 7; r++) for (const [x0, x1] of blocks) for (let x = x0 + 0.3; x < x1; x += 0.56) seats.push([x, -11.2 + r * 0.95]);
  for (const [geo, mat, y, dz] of [[seatGeo, velvet, 0.45, 0], [backGeo, velvet, 0.82, 0.22], [baseGeo, char, 0.19, 0]]) {
    const im = new THREE.InstancedMesh(geo, mat, seats.length);
    seats.forEach(([x, z], k) => im.setMatrixAt(k, m4.makeTranslation(x, y, z + dz)));
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
  }
  for (const [x0, x1] of blocks) wall(g, (x0 + x1) / 2, -8.4, x1 - x0, 6.4);
  // Balcony tiers on the side walls and over the door, red fronts with a gold lip.
  const gold = std(0xc49a4a, 0.35, 0.8);
  for (const y of [4.2, 7]) {
    for (const x of [-16.0, EX - 0.9]) { g.add(M(new THREE.BoxGeometry(1.4, 0.5, 6.4), redDark, x, y, -8.2)); g.add(M(new THREE.BoxGeometry(0.06, 0.08, 6.4), gold, x + (x < 0 ? 0.7 : -0.7), y + 0.28, -8.2)); }
    g.add(M(new THREE.BoxGeometry(20, 0.5, 1.4), redDark, cx, y + 0.4, EZ - 0.9));
  }
  // Ceiling lights in the hall.
  const hall = [];
  for (let x = -15.5; x <= 2.5; x += 1.5) for (let z = -15; z <= -5; z += 1.5) hall.push([x, EH - 0.12, z]);
  const hl = new THREE.InstancedMesh(dot, dotMat, hall.length);
  hall.forEach(([x, y, z], k) => hl.setMatrixAt(k, m4.makeTranslation(x, y, z)));
  g.add(hl);

  // Upper foyer: a raised floor along the east side, from Eldborg's wall to the shell, reached by
  // a broad flight of stairs from the foyer. A glass balustrade along its edge.
  const UP = 3.6, UZ = -5;
  block(g, stone, (EX + 0.2 + 16.9) / 2, (UZ - 15.9) / 2, 16.7 - EX, UZ + 15.9, UP);
  const SX0 = 10, SX1 = 13, N = 20, RUN = 0.32;
  for (let k = 0; k < N; k++) block(g, stone, (SX0 + SX1) / 2, UZ + (N - k - 0.5) * RUN, SX1 - SX0, RUN, (k + 1) * (UP / N));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ee, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22 });
  for (const [x0, x1] of [[EX, SX0], [SX1, 17]]) {
    g.add(M(new THREE.BoxGeometry(x1 - x0, 1.05, 0.04), glass, (x0 + x1) / 2, UP + 0.52, UZ + 0.05));
    g.add(M(new THREE.BoxGeometry(x1 - x0, 0.05, 0.08), gold, (x0 + x1) / 2, UP + 1.06, UZ + 0.05));
    wall(g, (x0 + x1) / 2, UZ + 0.1, x1 - x0, 0.3);
  }
  for (const x of [SX0, SX1]) {
    const L = N * RUN, rail = M(new THREE.BoxGeometry(0.06, 0.06, Math.hypot(L, UP)), gold, x, UP / 2 + 1.0, UZ + L / 2);
    rail.rotation.x = Math.atan2(UP, L); g.add(rail);
  }

  // Café by the west glass: a counter, stools and two long benches facing the harbour.
  const counter = M(new THREE.BoxGeometry(5, 1.1, 0.9), wood, -11, 0.55, 2.4); g.add(counter);
  g.add(M(new THREE.BoxGeometry(5.2, 0.06, 1.1), white, -11, 1.13, 2.4));
  wall(g, -11, 2.4, 5, 0.9);
  for (let k = 0; k < 4; k++) { const x = -12.8 + k * 1.2; g.add(M(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), redDark, x, 0.75, 3.4)); g.add(M(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), gold, x, 0.37, 3.4)); }
  for (const x of [-4, 3]) { g.add(M(new THREE.BoxGeometry(3.2, 0.45, 0.6), wood, x, 0.23, 6.2)); wall(g, x, 6.2, 3.2, 0.6); }
}

// ---------------------------------------------------------------------------------------------
// Hallgrímskirkja. The tower stands at the origin (TW x TD), the nave behind it (14 wide, from
// z = -4 to -38). The door at the foot of the tower opens into a vestibule and on into the nave:
// tall white concrete, slender pillars and pointed arches, pews either side of an aisle, the altar
// under three tall windows at the far end, and the great organ over the way in.
export const CHURCH_DOOR = { w: 2.4, h: 4.6 };
export function churchInterior(g, kit, { TW, TD, concrete, lower = 8 }) {
  const plaster = indoor(0xe6e2da, 0.9, 0x3b3834);
  const paleFloor = indoor(0xcbc5ba, 0.7, 0x24221f);
  const oak = indoor(0xc8a77a, 0.6, 0x221a10);
  const darkWood = indoor(0x5a3b22, 0.6, 0x120b06);
  const pipe = std(0xd4d8dc, 0.22, 0.95, { emissive: 0x2a2c30, emissiveIntensity: 1 });
  const windowMat = std(0xdfe9f2, 0.3, 0, { emissive: 0xcfe0f0, emissiveIntensity: 1.4 });
  kit.nightLit(windowMat, 0.6, 0.9);
  const X = TW / 2, Z = TD / 2, NX = 7, NZ1 = -38, NH = 13.5, T = 0.6, h = T / 2;
  const XI = X - h, ZI = Z - h, FZ = -Z - h; // wall centre lines; FZ: the wall between tower and nave

  // The foot of the tower, hollow: the door in front, the vestibule, an arch on into the nave.
  const tc = { cx: 0, cz: 0 };
  wallLine(g, -XI, ZI, XI, ZI, -1, lower, { ...tc, outMat: concrete, inMat: plaster, t: T, openings: [{ at: XI, w: CHURCH_DOOR.w, h: CHURCH_DOOR.h }] });
  wallLine(g, -XI, -Z, -XI, Z, -1, lower, { ...tc, outMat: concrete, inMat: plaster, t: T });
  wallLine(g, XI, -Z, XI, Z, -1, lower, { ...tc, outMat: concrete, inMat: plaster, t: T });
  // The nave: white within, the old concrete without; its front wall carries the organ.
  const nc = { cx: 0, cz: (FZ + NZ1) / 2 };
  wallLine(g, -NX, FZ, NX, FZ, -1, NH, { ...nc, outMat: plaster, inMat: plaster, t: T, openings: [{ at: NX, w: 4.4, h: 6.6 }] });
  wallLine(g, -(NX - h), -Z, -(NX - h), NZ1, -1, NH, { ...nc, outMat: concrete, inMat: plaster, t: T });
  wallLine(g, NX - h, -Z, NX - h, NZ1, -1, NH, { ...nc, outMat: concrete, inMat: plaster, t: T });
  wallLine(g, -NX, NZ1 + h, NX, NZ1 + h, -1, NH, { ...nc, outMat: concrete, inMat: plaster, t: T });
  g.add(M(new THREE.BoxGeometry(NX * 2, 0.6, -Z - NZ1), plaster, 0, NH + 0.3, (-Z + NZ1) / 2));
  const IN = NX - T, BACK = NZ1 + T, NZ0 = FZ - h; // inner faces of the nave
  const tf = M(new THREE.PlaneGeometry(XI * 2 - T, ZI - h - (FZ + h)), paleFloor, 0, 0.05, (ZI - h + FZ + h) / 2); tf.rotation.x = -Math.PI / 2; g.add(tf);
  const nf = M(new THREE.PlaneGeometry(IN * 2, NZ0 - BACK), paleFloor, 0, 0.05, (NZ0 + BACK) / 2); nf.rotation.x = -Math.PI / 2; g.add(nf);
  carWall(g, 0, -16.8, 62, 45);
  room(g, 0, (ZI - h + FZ + h) / 2, XI * 2 - T - 0.6, ZI - h - (FZ + h) - 0.6, 0, lower - 0.4);
  room(g, 0, (NZ0 + BACK) / 2, IN * 2 - 0.6, NZ0 - BACK - 0.6, 0, NH - 0.3);

  // Pillars and pointed arches: across the nave, and along each side between the pillars.
  const PX = 4.9, bays = [];
  for (let z = -7.5; z > NZ1 + 2; z -= 4) bays.push(z);
  for (const z of bays) {
    for (const s of [-1, 1]) { g.add(M(new THREE.BoxGeometry(0.7, 9.2, 0.9), plaster, s * PX, 4.6, z)); wall(g, s * PX, z, 0.7, 0.9); }
    g.add(M(rib(PX * 2 + 0.7, 9.2, 13.2, 0.55, 0.6), plaster, 0, 0, z));
  }
  for (let k = 0; k < bays.length - 1; k++) for (const s of [-1, 1]) {
    const r = M(rib(4 - 0.9 + 0.5, 6.2, 9.2, 0.4, 0.5), plaster, s * PX, 0, (bays[k] + bays[k + 1]) / 2);
    r.rotation.y = Math.PI / 2; g.add(r);
  }
  // Tall slit windows down both sides, between the pillars.
  for (const z of bays.slice(0, -1).map((b) => b - 2)) for (const s of [-1, 1]) g.add(M(new THREE.BoxGeometry(0.05, 6.5, 0.7), windowMat, s * (IN - 0.03), 5.6, z));

  // Pews either side of the aisle, facing the altar.
  const rows = [];
  for (let z = -9; z > -29.5; z -= 1.1) rows.push(z);
  const m4 = new THREE.Matrix4();
  const parts = [[new THREE.BoxGeometry(3.3, 0.08, 0.42), 0.45, 0], [new THREE.BoxGeometry(3.3, 0.5, 0.06), 0.74, 0.22], [new THREE.BoxGeometry(0.06, 0.88, 0.5), 0.44, 0]];
  for (const [geo, y, dz] of parts) {
    const ends = geo.parameters.width < 1;
    const list = [];
    for (const z of rows) for (const x of [-2.55, 2.55]) { if (ends) list.push([x - 1.65, z], [x + 1.65, z]); else list.push([x, z]); }
    const im = new THREE.InstancedMesh(geo, oak, list.length);
    list.forEach(([x, z], k) => im.setMatrixAt(k, m4.makeTranslation(x, y, z + dz)));
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
  }
  for (const x of [-2.55, 2.55]) wall(g, x, (rows[0] + rows[rows.length - 1]) / 2, 3.4, rows[0] - rows[rows.length - 1] + 0.6);

  // The chancel: a low step up, the altar, candles, and three tall windows behind.
  block(g, paleFloor, 0, (BACK - 32) / 2, IN * 2, -32 - BACK, 0.22);
  g.add(M(new THREE.BoxGeometry(2.6, 1.0, 1.0), plaster, 0, 0.72, -35.4));
  g.add(M(new THREE.BoxGeometry(2.8, 0.04, 1.2), std(0xf4f2ec, 0.8), 0, 1.24, -35.4));
  wall(g, 0, -35.4, 2.6, 1.0);
  const flame = std(0x332200, 0.4, 0, { emissive: 0xffc070, emissiveIntensity: 2.5 });
  for (const x of [-0.9, 0.9]) { g.add(M(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 8), std(0xf2eee4, 0.6), x, 1.48, -35.4)); g.add(M(new THREE.SphereGeometry(0.04, 6, 4), flame, x, 1.75, -35.4)); }
  const lancetWin = (w, h) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w * 0.8); s.quadraticCurveTo(w / 2, h - w * 0.15, 0, h); s.quadraticCurveTo(-w / 2, h - w * 0.15, -w / 2, h - w * 0.8); s.closePath(); return new THREE.ShapeGeometry(s); };
  for (const [x, wh] of [[-2.2, 7], [0, 9], [2.2, 7]]) g.add(M(lancetWin(1.3, wh), windowMat, x, 3, BACK + 0.02));

  // The organ over the way in: a dark case on a gallery, a front of silver pipes in towers.
  const OZ = NZ0;
  g.add(M(new THREE.BoxGeometry(11, 0.4, 2.4), darkWood, 0, 7.0, OZ - 1.2));
  g.add(M(new THREE.BoxGeometry(11, 0.9, 0.08), darkWood, 0, 7.6, OZ - 2.4));
  g.add(M(new THREE.BoxGeometry(9.4, 5.6, 0.9), darkWood, 0, 10.0, OZ - 0.45));
  const pipes = [];
  for (let k = 0; k < 41; k++) {
    const x = -4.4 + k * 0.22, tower = Math.cos((x / 4.4) * Math.PI * 2.5);
    pipes.push([x, 1.6 + 2.6 * (0.5 + 0.5 * tower) + (1 - Math.abs(x) / 4.4) * 1.2]);
  }
  const pg = new THREE.CylinderGeometry(0.08, 0.08, 1, 10);
  const pm = new THREE.InstancedMesh(pg, pipe, pipes.length);
  const sc = new THREE.Vector3(), pos = new THREE.Vector3(), q = new THREE.Quaternion();
  pipes.forEach(([x, h], k) => pm.setMatrixAt(k, m4.compose(pos.set(x, 7.5 + h / 2, OZ - 1.05), q, sc.set(1, h, 1))));
  g.add(pm);
}
