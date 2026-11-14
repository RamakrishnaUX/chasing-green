// Every waterfall, built after the real one. Shared machinery (the falling sheet, spray, mist,
// rainbow, pool foam, layered cliffs) is in falls.js; this file shapes each place.
//
// Local frame: +z faces the road (the viewer), y is up from the landmark's level pad.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRiverMaterial, riverGeometry, rockMaterial } from './materials.js';
import { HD } from './hd.js';
import {
  straightLip, arcLip, sheetGeometry, sheetMaterial, makeSheet, makeSpray, makeRainbow, makePool,
  makeCliff, cliffPath, boulder, paintedRock,
} from './falls.js';

const riverMats = new Map();
function riverMat(kind) {
  if (riverMats.has(kind)) return riverMats.get(kind);
  const k = {
    clear: { shallow: [0.24, 0.48, 0.48], deep: [0.03, 0.12, 0.14], speed: 2.2 },
    glacial: { shallow: [0.46, 0.5, 0.47], deep: [0.2, 0.22, 0.2], speed: 2.6 },
    silt: { shallow: [0.52, 0.48, 0.4], deep: [0.24, 0.21, 0.17], speed: 2.8 },
    turquoise: { shallow: [0.36, 0.66, 0.66], deep: [0.06, 0.26, 0.3], speed: 1.8 },
  }[kind];
  const m = createRiverMaterial(k);
  riverMats.set(kind, m);
  return m;
}
const POOL = {
  clear: { color: 0x1d4a50 },
  glacial: { color: 0x4a5a58, tint: { shallow: [0.5, 0.56, 0.54], deep: [0.18, 0.22, 0.22] } },
  silt: { color: 0x5a5244, tint: { shallow: [0.55, 0.5, 0.42], deep: [0.22, 0.19, 0.15] } },
  turquoise: { color: 0x2f7c80, tint: { shallow: [0.42, 0.75, 0.74], deep: [0.05, 0.28, 0.32] } },
};
// The river's own colour as it goes over the lip.
const LIPCOL = { clear: 0x2e4f4c, glacial: 0x6c7672, silt: 0x7a705c, turquoise: 0x3b8486 };

function blocker(g, x, y, z, w, h, d, ry = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  b.position.set(x, y, z); b.rotation.y = ry;
  b.visible = false; b.userData.collide = true;
  g.add(b);
  return b;
}

const lowFx = (kit) => kit.quality === 'low' || (!HD.on && kit.quality !== 'high' && kit.quality !== 'medium');

// The water and everything it makes: sheet (with a veil over it), spray, mist, rainbow, pool.
// lip: lip points; D: drop to the pool; o: options.
function pour(kit, g, lip, D, o = {}) {
  const water = o.water || 'clear';
  const v0 = o.v0 ?? 2, spread = o.spread ?? 0.05, aerate = o.aerate ?? 3, gap = o.gap ?? 0.35;
  const mat = { color: o.lipColor ?? LIPCOL[water], aerate, gap, flow: o.flow ?? 1, breakup: o.breakup ?? (D > 30 ? 1 : D > 18 ? 0.4 : 0) };
  const geo = { drop: D, v0, spread, rows: Math.round(Math.min(34, 14 + D * 0.5)), approach: o.approach ?? 3 };
  g.add(makeSheet(lip, geo, mat));
  const low = lowFx(kit);
  if (o.veil !== false && !low) {
    // A looser outer veil of spray and droplets, thrown a little further and fraying sooner.
    const veil = makeSheet(lip, { ...geo, v0: v0 * 1.12 + 0.2, spread: Math.min(spread * 1.8 + 0.02, 0.6 / Math.sqrt(D)), approach: 0.5 },
      { ...mat, aerate: aerate * 0.6, gap: Math.min(gap, 0.15), opacity: 0.55, scale: 1.37, flow: (o.flow ?? 1) * 1.07 });
    veil.renderOrder = 3;
    g.add(veil);
  }
  // Where it lands.
  const T = Math.sqrt(2 * D / 9.8);
  const ends = [lip[0], lip[lip.length - 1]];
  const land = (p, side) => ({ x: p.x + p.nx * v0 * T + side * spread * D * (p.nz || 1), z: p.z + p.nz * v0 * T - side * spread * D * (p.nx || 0) });
  const a = land(ends[0], -1), b = land(ends[1], 1);
  const ly = o.poolY ?? 0.12;
  const W = Math.hypot(b.x - a.x, b.z - a.z);
  const mid = lip[Math.floor(lip.length / 2)];
  const out = o.out || [mid.nx, 0, mid.nz];
  const fx = lowFx(kit) ? 0.45 : 1;
  const sprayK = (o.spray ?? 1) * fx, mistK = (o.mist ?? 1) * fx;
  if (sprayK > 0 && !low) g.add(makeSpray('spray', {
    a: [a.x, ly, a.z], b: [b.x, ly, b.z], out, count: Math.min(520, 50 + W * Math.sqrt(D) * 9) * sprayK,
    life: 1.4 + D * 0.02, speed: 2.2 + Math.sqrt(D) * 1.1, rise: 1.3, size: 0.22 + D * 0.006, opacity: 0.5, grav: 6.5, drag: 1.1,
  }));
  if (mistK > 0) g.add(makeSpray('mist', {
    a: [a.x, ly + 0.3, a.z], b: [b.x, ly + 0.3, b.z], out, count: Math.min(160, 18 + W * 2.6 + D * 1.4) * mistK,
    life: 6 + D * 0.08, speed: 1.0 + Math.sqrt(D) * 0.45, rise: 1.5 + D * 0.02, size: 1.3 + W * 0.05 + D * 0.05, opacity: (o.mistOpacity ?? 0.09),
  }));
  if (o.rainbow && !low) {
    // Only as big as the spray cloud it lives in.
    const rb = makeRainbow(W + D * 0.6 + 4, D * 0.55 + 5, o.rainbow);
    rb.position.set((a.x + b.x) / 2 + out[0] * 3, ly + D * 0.25 + 1, (a.z + b.z) / 2 + out[2] * 3);
    rb.rotation.y = o.rainbowYaw ?? Math.atan2(out[0], out[2]);
    g.add(rb);
  }
  if (o.pool !== false) {
    const P = o.pool || {};
    const cx = (a.x + b.x) / 2 + out[0] * (P.ahead ?? 1.5), cz = (a.z + b.z) / 2 + out[2] * (P.ahead ?? 1.5);
    const rx = P.rx ?? (W / 2 + 2.5 + D * 0.12), rz = P.rz ?? (3 + D * 0.2);
    kit.clearGrass?.(cx, cz, Math.max(rx, rz) * 1.2 + 1);
    g.add(makePool({
      cx, cz, rx, rz, y: ly, impact: [a.x, a.z, b.x, b.z],
      reach: P.reach ?? (2.5 + D * 0.1), boil: P.boil ?? (1.2 + Math.sqrt(D) * 0.35), seed: Math.round(D * 13 + W), lip: D, ...POOL[P.water || water],
    }));
  }
  return { a, b, W, ly };
}

// A river strip that follows the ground: from (x0, z0) along a wandering line.
function outflow(kit, g, pts, width, kind, lift = 0.16, start = 2.5) {
  // Stop short of any road (the river goes under it in a culvert, out of sight).
  const keep = [];
  for (const q of pts) { if (kit.roadDist && kit.roadDist(q.x, q.z) < width / 2 + 4) break; keep.push(q); }
  if (keep.length < 2) return null;
  const p = keep.map((q) => ({ x: q.x, z: q.z, y: q.y ?? (kit.ground(q.x, q.z) + lift) }));
  // Never flow uphill.
  for (let i = 1; i < p.length; i++) p[i].y = Math.min(p[i].y, p[i - 1].y);
  const m = new THREE.Mesh(riverGeometry(p, width, start), riverMat(kind));
  m.userData.notGround = true;
  g.add(m);
  for (let i = 0; i < p.length; i += 2) kit.clearGrass?.(p[i].x, p[i].z, width * 0.6 + 1);
  return m;
}
function wander(x0, z0, x1, z1, n, amp, phase = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, w = Math.sin(t * 5.1 + phase) * amp * Math.sin(t * Math.PI);
    pts.push({ x: x0 + (x1 - x0) * t + w, z: z0 + (z1 - z0) * t });
  }
  return pts;
}
function scatterBoulders(kit, g, n, place) {
  for (let i = 0; i < n; i++) {
    const p = place(i, kit.rand);
    if (!p || (kit.roadDist && kit.roadDist(p.x, p.z) < p.s + 5)) continue;
    const b = boulder(p.s, kit.rand);
    b.position.set(p.x, (p.y ?? kit.ground(p.x, p.z)) - p.s * 0.25, p.z);
    g.add(b);
  }
}

// Nothing of a waterfall may stand on a road: rock within a few metres of one is pressed down
// into the ground (a rim near a plateau road, the end of a cliff), so the road stays clear.
function clearRoads(kit, mesh) {
  if (!kit.roadDist) return mesh;
  const p = mesh.geometry.attributes.position;
  let moved = false;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = kit.roadDist(x, z);
    if (d > 8) continue;
    const g = kit.ground(x, z) - 0.6, y = p.getY(i);
    if (y <= g) continue;
    const k = THREE.MathUtils.smoothstep(8 - d, 0, 3.5);
    p.setY(i, y + (g - y) * k); moved = true;
  }
  if (moved) { p.needsUpdate = true; mesh.geometry.computeVertexNormals(); }
  return mesh;
}

// The base of every cliff point reaches the ground under it.
function grounded(kit, path) {
  for (const p of path) p.base = Math.min(0, kit.ground(p.x, p.z));
  return path;
}

// A cliff that bows round the pool: x across span, ends coming forward by `bow`.
function bowPath(kit, { span, bow = 6, H, W, wetPad = 3, n, overhang = 0, cave = 0, notch = 1.2, ends = 0.22, spray = 1, lean }) {
  return grounded(kit, cliffPath(n || Math.round(span * 1.3), (t) => {
    const x = (t - 0.5) * span;
    return { x, z: bow * Math.pow(Math.abs(x) / (span / 2), 2) };
  }, {
    top: (t, p) => H + notch * THREE.MathUtils.smoothstep(Math.abs(p.x), W / 2, W / 2 + 3),
    ends,
    wetAt: (t, p) => 1 - THREE.MathUtils.smoothstep(Math.abs(p.x), W / 2 + 0.5, W / 2 + wetPad),
    spray: (t, p) => spray * (1 - THREE.MathUtils.smoothstep(Math.abs(p.x), W / 2, W / 2 + 14)),
    overhang: (t, p) => overhang * (1 - THREE.MathUtils.smoothstep(Math.abs(p.x), W / 2 + 4, W / 2 + 14)),
    // A hollow at the foot wide enough for a path to loop round behind the water.
    cave: (t, p) => cave * (1 - THREE.MathUtils.smoothstep(Math.abs(p.x), W / 2 + 5, W / 2 + 13)),
    lean,
  }));
}

// A gorge: two walls running out toward the viewer from a rounded head where the falls are.
// R: half the gorge's width at the head; len: how far the walls run forward; flare: how much
// wider the gorge gets at its mouth.
function gorgePath(kit, { R, len, flare = 1.5, H, W, wetPad = 2.5, notch = 1.5, overhang = 0, cave = 0, step = 0.9, spray = 1, mouth = true }) {
  const pts = [];
  const add = (x, z) => pts.push({ x, z });
  const wall = len, arcN = Math.max(10, Math.round(Math.PI * R / step));
  const wallN = Math.max(6, Math.round(wall / step));
  for (let i = 0; i < wallN; i++) { const k = 1 - i / wallN; add(-R * (1 + (flare - 1) * k * k), wall * k); }
  for (let i = 0; i <= arcN; i++) { const a = -Math.PI / 2 + Math.PI * (i / arcN); add(Math.sin(a) * R, -Math.cos(a) * R * 0.9); }
  for (let i = 1; i <= wallN; i++) { const k = i / wallN; add(R * (1 + (flare - 1) * k * k), wall * k); }
  const N = pts.length - 1;
  const total = 2 * wall + Math.PI * R;
  return grounded(kit, cliffPath(N, (t) => pts[Math.round(t * N)], {
    top: (t, p) => H + notch * THREE.MathUtils.smoothstep(Math.hypot(p.x, Math.min(p.z, 0) + R * 0.9), W / 2, W / 2 + 3),
    ends: mouth ? wall / total * 0.8 : 0.015,
    wetAt: (t, p) => (p.z < 0 ? 1 - THREE.MathUtils.smoothstep(Math.abs(p.x), W / 2 + 0.5, W / 2 + wetPad) : 0),
    spray: (t, p) => spray * (1 - THREE.MathUtils.smoothstep(Math.hypot(p.x, p.z + R * 0.9), 2, R * 2 + 6)),
    overhang: (t, p) => (p.z < 0 ? overhang * (1 - THREE.MathUtils.smoothstep(Math.abs(p.x), W / 2 + 1, W / 2 + 6)) : 0),
    cave: (t, p) => (p.z < 0 ? cave * (1 - THREE.MathUtils.smoothstep(Math.abs(p.x), W / 2 + 1, W / 2 + 5)) : 0),
  }));
}


// A falls you can walk behind. The game's ground ignores ceilings (it takes the highest landform
// at a point), so rock over the cave would count as a wall: the part of the cliff round the cave
// is drawn but not ground, and hidden walls follow the back of the hollow at foot height. The
// rest of the cliff stays solid, climbable rock.
function walkBehindCliff(kit, g, path, opts, inCave) {
  const parts = [[]];
  let cur = null;
  for (const p of path) {
    const c = inCave(p);
    if (cur !== null && c !== cur) { parts[parts.length - 1].push(p); parts.push([]); }
    parts[parts.length - 1].push(p); cur = c;
    parts[parts.length - 1].cave = c;
  }
  for (const part of parts) {
    if (part.length < 2) continue;
    const m = clearRoads(kit, makeCliff(part, opts));
    if (part.cave) {
      m.userData.notGround = true;
      // Hidden walls along the back of the hollow.
      for (let i = 0; i < part.length - 1; i++) {
        const a = part[i], b = part[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, ox = -dz / L, oz = dx / L;
        const back = (p) => 0.2 - (p.cave || 0) * 0.56 - 0.5;
        const ax = a.x + ox * back(a), az = a.z + oz * back(a), bx = b.x + ox * back(b), bz = b.z + oz * back(b);
        const w = blocker(g, (ax + bx) / 2 - ox * 1.5, (a.top) / 2, (az + bz) / 2 - oz * 1.5, Math.hypot(bx - ax, bz - az) + 0.6, a.top + 2, 3, Math.atan2(-(bz - az), bx - ax));
        w.userData.walkWall = true;
      }
    }
    g.add(m);
  }
}

// The water's lip on a cliff built by the paths above: just in front of the face top.
const lipAt = (z, over = 0) => z - 0.8 + over + 0.35;

// River on the plateau above the lip, running back from it.
function upperRiver(kit, g, x, y, z, width, len, kind, dir = [0, -1]) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    pts.push({ x: x + dir[0] * len * k + Math.sin(k * 4) * width * 0.15 * k, y: y + k * len * 0.03, z: z + dir[1] * len * k });
  }
  pts.reverse(); // flows toward the lip
  const m = new THREE.Mesh(riverGeometry(pts, width), riverMat(kind));
  m.userData.notGround = true;
  g.add(m);
}

// ---------------------------------------------------------------------------------------------

// Skógafoss: a broad, thick white curtain about 60 m high and 25 wide off a sheer old sea cliff
// with grassy slopes above and moss on its ledges; a wide shingle riverbed in front, a pool
// that boils right across the foot, and on sunny days a rainbow (often a double one) in the spray.
export function skogafoss(kit) {
  const g = new THREE.Group();
  const H = 24, W = 11;
  // To the right of the falls the cliff gives way to a steep grass slope, where the stairway climbs.
  const path = bowPath(kit, { span: 78, bow: 7, H, W, wetPad: 2.5, notch: 0.6, ends: 0.2, lean: (t, p) => 21 * THREE.MathUtils.smoothstep(p.x, 15, 21) });
  g.add(clearRoads(kit, makeCliff(path, { below: 6, back: 14, bands: 2.6, relief: 1.1, moss: 0.85, ledgeMoss: 0.55, seed: 11 })));
  const lip = straightLip(W, H, lipAt(0), 18);
  pour(kit, g, lip, H - 0.12, { water: 'clear', v0: 2.3, spread: 0.035, aerate: 2.2, gap: 0.55, spray: 1.4, mist: 1.3, rainbow: 0.32, mistOpacity: 0.17,
    pool: { rx: 15, rz: 7, reach: 6, boil: 3.5, ahead: 2.5 } });
  upperRiver(kit, g, 0, H - 0.3, lipAt(0) - 2.5, W * 0.95, 26, 'clear');
  // The Skógá running away across its shingle bed toward the road.
  outflow(kit, g, wander(0, 13, 4, 40, 10, 3), 13, 'clear');
  scatterBoulders(kit, g, 22, (i, r) => {
    const x = (r() - 0.5) * 34, z = 6 + r() * 30;
    return { x, z, s: 0.4 + r() * (z < 14 ? 1.6 : 0.9) };
  });
  blocker(g, 0, H / 2, -10, 60, H + 4, 14);
  return g;
}

// Seljalandsfoss: a slender fall of 60 m dropping free off the lip of an overhanging old sea
// cliff, so far out that a path runs round behind it through the hollow at its foot. Grassy
// slopes above, moss and wet black rock round the cave, a shallow pool and a stream out.
export function seljalandsfoss(kit) {
  const g = new THREE.Group();
  const H = 25, W = 3.2;
  const path = bowPath(kit, { span: 90, bow: 4, H, W, wetPad: 3, notch: 0.9, overhang: 3.2, cave: 7, ends: 0.16 });
  walkBehindCliff(kit, g, path, { below: 5, back: 14, bands: 3.0, relief: 1.2, moss: 0.9, ledgeMoss: 0.5, seed: 21 }, (p) => Math.abs(p.x) < 15);
  const lip = straightLip(W, H, lipAt(0, 3.2), 8);
  pour(kit, g, lip, H - 0.12, { water: 'clear', v0: 2.6, spread: 0.05, aerate: 3.5, gap: 0.3, spray: 1.1, mist: 1, rainbow: 0.28,
    pool: { rx: 7, rz: 5.5, reach: 3.5, boil: 2 } });
  upperRiver(kit, g, 0, H - 0.35, lipAt(0, 3.2) - 2.5, W * 1.1, 24, 'clear');
  outflow(kit, g, wander(0, 10, -3, 36, 10, 2), 3.2, 'clear');
  scatterBoulders(kit, g, 16, (i, r) => {
    const a = r() * Math.PI, rr = 6 + r() * 4;
    return { x: Math.cos(a) * rr * 1.3, z: 4 + Math.sin(a) * rr * 0.7 - 2, s: 0.5 + r() * 1.1 };
  });
  return g;
}

// Dettifoss: Europe's most powerful falls, 100 m wide and 45 high, grey-brown with glacial silt,
// thundering into the basalt canyon of Jökulsárgljúfur under a great plume of spray.
export function dettifoss(kit) {
  const g = new THREE.Group();
  const H = 17, W = 34;
  const path = gorgePath(kit, { R: W / 2 + 4, len: 46, flare: 1.15, H, W: W + 4, wetPad: 2, notch: 1.0, step: 1.1 });
  g.add(clearRoads(kit, makeCliff(path, { below: 5, back: 16, bands: 1.7, columns: 1.1, relief: 1.3, moss: 0.15, ledgeMoss: 0.3, seed: 31 })));
  // The lip is uneven: the main curtain and two chutes split off by rock, plus a ragged side fall.
  const R = W / 2 + 4, zBack = -R * 0.9;
  const RL = R + 0.45; // the lip sits just in front of the face's top, which leans back 0.8
  const mk = (x0, x1, y, n) => arcLip(RL, Math.asin(x0 / RL), Math.asin(x1 / RL), y, 0, 0, n).map((p) => ({ ...p, z: p.z * 0.9 }));
  const opts = { water: 'silt', v0: 3.4, spread: 0.02, aerate: 1.4, gap: 0.6, mistOpacity: 0.12 };
  const main = pour(kit, g, mk(-12, 9, H, 30), H - 0.12, { ...opts, spray: 1.5, mist: 2.2, rainbow: 0.3, pool: { rx: 22, rz: 10, reach: 9, boil: 4, water: 'silt', ahead: 3 } });
  pour(kit, g, mk(10.5, 15, H - 0.4, 8), H - 0.5, { ...opts, pool: false, mist: 0.4, spray: 0.6 });
  pour(kit, g, mk(-16.5, -13.2, H - 0.6, 6), H - 0.7, { ...opts, v0: 1.4, gap: 0.3, pool: false, mist: 0.3, spray: 0.5 });
  upperRiver(kit, g, -1, H - 0.3, zBack - 3, W * 0.95, 30, 'silt');
  outflow(kit, g, wander(0, main.a.z + 14, -2, 46, 10, 2), 18, 'silt');
  scatterBoulders(kit, g, 18, (i, r) => ({ x: (r() < 0.5 ? -1 : 1) * (14 + r() * 8), z: 4 + r() * 34, s: 0.8 + r() * 1.8 }));
  blocker(g, 0, H / 2, zBack - 8, W + 16, H + 2, 12);
  return g;
}

// Goðafoss: the falls of the gods, a horseshoe 12 m high and 30 wide on the blue Skjálfandafljót,
// split by a rock in the middle into two great curtains, with smaller falls round the sides and
// basalt columns in the walls.
export function godafoss(kit) {
  const g = new THREE.Group();
  const H = 7.5, R = 14;
  // The horseshoe: an arc of cliff round the pool, the river on the shelf behind it.
  const pts = [];
  const n = 70;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = -2.0 + 4.0 * t;
    pts.push({ x: Math.sin(a) * R * (1 + 0.25 * Math.max(0, Math.abs(a) - 1.4)), z: -Math.cos(a) * R + 2 });
  }
  const waterAt = (a) => (a > -1.25 && a < -0.18) || (a > 0.1 && a < 1.0) || (a > -1.6 && a < -1.42) || (a > 1.18 && a < 1.32);
  const path = grounded(kit, cliffPath(n, (t) => pts[Math.round(t * n)], {
    top: (t) => { const a = -2.0 + 4.0 * t; return H + (waterAt(a) ? 0 : 0.7); },
    ends: 0.1,
    wetAt: (t) => { const a = -2.0 + 4.0 * t; return waterAt(a) ? 1 : waterAt(a - 0.06) || waterAt(a + 0.06) ? 0.5 : 0; },
    spray: (t) => 0.6,
  }));
  g.add(clearRoads(kit, makeCliff(path, { below: 4, back: 24, bands: 1.3, columns: 0.9, relief: 0.8, moss: 0.4, ledgeMoss: 0.6, seed: 41 })));
  const opts = { water: 'turquoise', v0: 2.6, spread: 0.02, aerate: 1.7, gap: 0.5, pool: false, mistOpacity: 0.1 };
  const arc = (a0, a1, nn) => arcLip(R + 0.45, a0, a1, H, 0, 2, nn);
  pour(kit, g, arc(-1.25, -0.18, 18), H - 0.15, { ...opts, spray: 1.2, mist: 1, rainbow: 0.22 });
  pour(kit, g, arc(0.1, 1.0, 16), H - 0.15, { ...opts, spray: 1.1, mist: 1 });
  pour(kit, g, arc(-1.6, -1.42, 4), H - 0.15, { ...opts, v0: 1.2, spray: 0.3, mist: 0.2, veil: false });
  pour(kit, g, arc(1.18, 1.32, 4), H - 0.15, { ...opts, v0: 1.2, spray: 0.3, mist: 0.2, veil: false });
  kit.clearGrass?.(0, 3, R * 1.1);
  g.add(makePool({ cx: 0, cz: 3, rx: R * 0.95, rz: R * 0.7, y: 0.12, impact: [-8, -6, 8, -6], reach: 7, boil: 4.5, seed: 44, lip: H, ...POOL.turquoise }));
  // The river on the shelf behind, running in from upstream.
  upperRiver(kit, g, 0, H - 0.25, -R + 1, 28, 34, 'turquoise');
  outflow(kit, g, wander(0, 12, 3, 44, 10, 3), 16, 'turquoise');
  // The rock that splits the falls, and boulders along the shore.
  { const b = boulder(2.2, kit.rand); b.position.set(Math.sin(-0.04) * (R - 1.5), H - 1.2, -Math.cos(-0.04) * (R - 1.5) + 2); g.add(b); }
  scatterBoulders(kit, g, 20, (i, r) => { const a = (r() - 0.5) * 3.6, rr = R * (0.95 + r() * 0.2); return { x: Math.sin(a) * rr, z: -Math.cos(a) * rr * 0.7 + 4 + (r() < 0.5 ? 8 : 0), s: 0.5 + r() * 1.2 }; });
  blocker(g, 0, H / 2, -R - 8, 40, H + 2, 14);
  return g;
}

// Svartifoss: "black falls", a thin fall of 20 m in an amphitheatre of dark basalt columns that
// hang from the overhanging rim like organ pipes, broken lengths of column heaped at the foot.
const colGeo = new THREE.CylinderGeometry(0.42, 0.42, 1, 6);
colGeo.translate(0, -0.5, 0); // hangs from its top
const colMats = [new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.72 }), new THREE.MeshStandardMaterial({ color: 0x26272a, roughness: 0.8 })];
export function svartifoss(kit) {
  const g = new THREE.Group();
  const H = 15, W = 1.7, R = 8;
  const path = gorgePath(kit, { R, len: 16, flare: 1.6, H, W, wetPad: 1.5, notch: 0.9, overhang: 1.2, step: 0.6 });
  g.add(clearRoads(kit, makeCliff(path, { below: 4, back: 10, bands: 4.5, columns: 0.8, relief: 0.9, moss: 0.55, ledgeMoss: 0.8, seed: 51 })));
  pour(kit, g, straightLip(W, H, -R * 0.9 + lipAt(0, 1.2), 6), H - 0.12, { water: 'clear', v0: 1.3, spread: 0.05, aerate: 2.6, gap: 0.3, spray: 0.7, mist: 0.6,
    pool: { rx: 3.8, rz: 2.8, reach: 2, boil: 1.2 } });
  upperRiver(kit, g, 0, H - 0.35, -R * 0.9 - 3, 2.2, 18, 'clear');
  // Hanging columns round the amphitheatre, under the rim; their lower ends make a ragged line.
  const ring = [];
  for (let a = -1.75; a <= 1.75; a += 0.075) {
    if (Math.abs(a) < 0.14) continue;
    for (let layer = 0; layer < 2; layer++) ring.push([a + layer * 0.037, layer]);
  }
  const hang = new THREE.InstancedMesh(colGeo, colMats[0], ring.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  ring.forEach(([a, layer], i) => {
    const rr = R + 0.3 + layer * 0.55;
    const len = 4.5 + Math.abs(Math.sin(a * 9.1)) * 3.5 + kit.rand() * 2 - layer * 0.8;
    p.set(Math.sin(a) * rr, H - 0.9, -Math.cos(a) * rr * 0.9);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), kit.rand());
    s.set(1, len, 1);
    hang.setMatrixAt(i, m4.compose(p, q, s));
  });
  hang.castShadow = hang.receiveShadow = true;
  g.add(hang);
  // Standing columns below them, and the broken pieces at the foot.
  const stand = [];
  for (let a = -1.6; a <= 1.6; a += 0.1) if (Math.abs(a) > 0.2) stand.push(a);
  const st = new THREE.InstancedMesh(colGeo, colMats[1], stand.length + 40);
  stand.forEach((a, i) => {
    const rr = R + 0.15, len = 3 + Math.abs(Math.sin(a * 5.3)) * 4 + kit.rand() * 1.5;
    p.set(Math.sin(a) * rr, len - 0.4, -Math.cos(a) * rr * 0.9);
    q.identity(); s.set(1.05, len, 1.05);
    st.setMatrixAt(i, m4.compose(p, q, s));
  });
  for (let i = 0; i < 40; i++) {
    const a = (kit.rand() - 0.5) * 3, rr = R * (0.55 + kit.rand() * 0.4), len = 0.6 + kit.rand() * 1.6;
    p.set(Math.sin(a) * rr, 0.3, -Math.cos(a) * rr * 0.9 + 1);
    q.setFromEuler(new THREE.Euler(Math.PI / 2 + (kit.rand() - 0.5), kit.rand() * 6, (kit.rand() - 0.5) * 0.6));
    s.set(1, len, 1);
    st.setMatrixAt(stand.length + i, m4.compose(p, q, s));
  }
  st.castShadow = st.receiveShadow = true;
  g.add(st);
  outflow(kit, g, wander(0, -R * 0.9 + 5, 1.5, 22, 10, 1.5), 1.8, 'clear');
  blocker(g, 0, H / 2, -R - 6, R * 2.4, H, 8);
  return g;
}

// Hengifoss: one of Iceland's tallest falls, about 128 m, dropping free into a gorge whose walls
// are dark basalt striped with thin layers of red clay (old soils baked between lava flows).
export function hengifoss(kit) {
  const g = new THREE.Group();
  const H = 50, W = 2.2, R = 11;
  const path = gorgePath(kit, { R, len: 34, flare: 1.8, H, W, wetPad: 1.5, notch: 1.4, overhang: 1.5, step: 1.0 });
  // Thick basalt flows with a thin red layer under each.
  const clay = (u, y, bi, bf, c) => [c[0], c[1] * 0.6, 1 - c[0]]; // red layers wherever the rock isn't wet
  g.add(clearRoads(kit, makeCliff(path, { below: 4, back: 12, bands: 4.2, columns: 1.3, relief: 1.4, moss: 0.3, ledgeMoss: 0.7, seed: 61, colour: clay, material: paintedRock(0x6e3224, 2.9), NV: 56 })));
  pour(kit, g, straightLip(W, H, -R * 0.9 + lipAt(0, 1.5), 6), H - 0.12, { water: 'clear', v0: 2.2, spread: 0.012, aerate: 5, gap: 0.22, spray: 0.8, mist: 1.2, rainbow: 0.18,
    pool: { rx: 5, rz: 4, reach: 3, boil: 1.6 } });
  upperRiver(kit, g, 0, H - 0.4, -R * 0.9 - 3, 2.6, 22, 'clear');
  outflow(kit, g, wander(0, -R * 0.9 + 9, -2, 40, 12, 2.5), 2.6, 'clear');
  scatterBoulders(kit, g, 24, (i, r) => ({ x: (r() - 0.5) * R * 1.6, z: -R * 0.5 + r() * 40, s: 0.4 + r() * 1.6 }));
  blocker(g, 0, H / 2, -R - 6, R * 2.6, H, 8);
  return g;
}

// Háifoss: 122 m, the Fossá shooting off the rim of a deep, wide gorge, grey with glacial silt;
// its neighbour Granni falls beside it.
export function haifoss(kit) {
  const g = new THREE.Group();
  const H = 48, W = 2.3, R = 15;
  const path = gorgePath(kit, { R, len: 36, flare: 1.5, H, W, wetPad: 1.5, notch: 1.6, overhang: 0.8, step: 1.1 });
  g.add(clearRoads(kit, makeCliff(path, { below: 4, back: 12, bands: 3.2, columns: 1.4, relief: 1.5, moss: 0.25, ledgeMoss: 0.7, seed: 71, NV: 52 })));
  pour(kit, g, straightLip(W, H, -R * 0.9 + lipAt(0, 0.8), 8), H - 0.12, { water: 'glacial', v0: 3.6, spread: 0.015, aerate: 4, gap: 0.25, spray: 0.9, mist: 1.3, rainbow: 0.2,
    pool: { rx: 7, rz: 5, reach: 4, boil: 2, water: 'glacial' } });
  // Granni: a second, thinner fall from the rim to the right.
  const gx = 10.5, gz = -Math.sqrt(Math.max(1, R * R - gx * gx)) * 0.9 + 0.6;
  const glip = straightLip(0.9, H - 0.6, gz, 4).map((p) => ({ ...p, x: p.x + gx, nx: -0.35, nz: 0.94 }));
  pour(kit, g, glip, H - 0.7, { water: 'glacial', v0: 1.2, spread: 0.04, aerate: 3, gap: 0.2, spray: 0.4, mist: 0.5, pool: { rx: 3.5, rz: 3, water: 'glacial' } });
  upperRiver(kit, g, 0, H - 0.4, -R * 0.9 - 3, 3.4, 24, 'glacial');
  outflow(kit, g, wander(0, -R * 0.9 + 10, 3, 42, 12, 3), 4, 'glacial');
  scatterBoulders(kit, g, 24, (i, r) => ({ x: (r() - 0.5) * R * 1.7, z: -R * 0.4 + r() * 40, s: 0.5 + r() * 1.8 }));
  blocker(g, 0, H / 2, -R - 6, R * 2.6, H, 8);
  return g;
}

// Gljúfrabúi: "the one who lives in the canyon": a 40 m fall hidden in a narrow, moss-lined slot
// in the cliff. From outside you glimpse it through the crack; a stream runs out over stones.
export function gljufrabui(kit) {
  const g = new THREE.Group();
  const H = 19, W = 1.3, R = 2.3;
  const path = gorgePath(kit, { R, len: 18, flare: 1.05, H, W, wetPad: 1.2, notch: 1.0, overhang: 0.6, step: 0.6, mouth: false });
  g.add(clearRoads(kit, makeCliff(path, { below: 4, back: 12, bands: 3.4, relief: 0.8, moss: 1, ledgeMoss: 0.4, seed: 81 })));
  // The cliff the slot cuts into, running away to both sides, mossy and tall.
  for (const sgn of [-1, 1]) {
    const side = grounded(kit, cliffPath(40, (t) => ({ x: sgn * (R * 1.15 + 0.6 + t * 40), z: 18 - 4 * t * t }), { top: (t) => H * (1 - 0.15 * t), ends: 0.08 }));
    // Faces look toward +z when a path runs left to right: the left one is built outward, so flip it.
    g.add(clearRoads(kit, makeCliff(sgn < 0 ? side.reverse() : side, { below: 4, back: 12, bands: 3.4, relief: 1, moss: 0.9, ledgeMoss: 0.5, seed: 82 + sgn })));
  }
  pour(kit, g, straightLip(W, H, -R * 0.9 + lipAt(0, 0.6), 5), H - 0.12, { water: 'clear', v0: 1.5, spread: 0.05, aerate: 3, gap: 0.3, spray: 0.6, mist: 0.9,
    pool: { rx: 2.8, rz: 2.4, reach: 1.8, boil: 1.1 } });
  upperRiver(kit, g, 0, H - 0.3, -R * 0.9 - 3, 1.8, 18, 'clear');
  outflow(kit, g, wander(0, -R * 0.9 + 4, 0.8, 34, 12, 0.8), 1.6, 'clear');
  scatterBoulders(kit, g, 14, (i, r) => ({ x: (r() - 0.5) * 3, z: -1 + r() * 20, s: 0.3 + r() * 0.6 }));
  // The great mossy rock that half hides the slot from the meadow.
  { const b = boulder(1, kit.rand); b.position.set(-0.6, 2.6, 18.5); b.scale.set(3.6, 7.5, 3); b.rotation.set(0, 0.3, 0); g.add(b); }
  blocker(g, 0, H / 2, -R - 5, R * 3, H, 6);
  return g;
}

// Kvernufoss: a 30 m fall at the head of a green gorge near Skógar, with a path behind the water.
export function kvernufoss(kit) {
  const g = new THREE.Group();
  const H = 14, W = 2.6, R = 7;
  const path = gorgePath(kit, { R, len: 22, flare: 1.4, H, W, wetPad: 1.5, notch: 1.0, overhang: 2.4, cave: 4.5, step: 0.7 });
  walkBehindCliff(kit, g, path, { below: 4, back: 9, bands: 2.4, relief: 1.0, moss: 0.95, ledgeMoss: 0.6, seed: 91 }, (p) => p.z < 1 && Math.abs(p.x) < R + 1);
  pour(kit, g, straightLip(W, H, -R * 0.9 + lipAt(0, 2.4), 6), H - 0.12, { water: 'clear', v0: 2.0, spread: 0.05, aerate: 2.8, gap: 0.35, spray: 0.8, mist: 0.8, rainbow: 0.16,
    pool: { rx: 4.5, rz: 3.5, reach: 2.4, boil: 1.4 } });
  upperRiver(kit, g, 0, H - 0.3, -R * 0.9 - 3, 2.6, 18, 'clear');
  outflow(kit, g, wander(0, -R * 0.9 + 7, 1, 30, 12, 1.5), 2.2, 'clear');
  scatterBoulders(kit, g, 12, (i, r) => ({ x: (r() - 0.5) * R * 1.5, z: -2 + r() * 20, s: 0.3 + r() * 0.9 }));
  return g;
}

// Öxarárfoss: the Öxará spilling over the edge of the Almannagjá rift at Þingvellir, down a dark
// stepped lava wall in several strands that meet in a rocky pool.
export function oxararfoss(kit) {
  const g = new THREE.Group();
  const H = 9, W = 4;
  const path = bowPath(kit, { span: 60, bow: 3, H, W: W + 1, wetPad: 2, notch: 1.4, ends: 0.18, spray: 0.5 });
  g.add(clearRoads(kit, makeCliff(path, { below: 4, back: 10, bands: 1.4, columns: 1.6, relief: 1.6, moss: 0.55, ledgeMoss: 0.7, seed: 101 })));
  const opts = { water: 'clear', v0: 0.9, spread: 0.06, aerate: 1.6, gap: 0.3, pool: false, mist: 0.4, spray: 0.5 };
  // Three strands: a main one and two thinner ones that peel off the lip.
  pour(kit, g, straightLip(1.9, H, lipAt(0), 6).map((p) => ({ ...p, x: p.x - 0.4 })), H - 0.12, { ...opts, mist: 0.7, spray: 0.8 });
  pour(kit, g, straightLip(0.9, H - 0.25, lipAt(0) - 0.1, 4).map((p) => ({ ...p, x: p.x + 1.5 })), H - 0.4, { ...opts, veil: false });
  pour(kit, g, straightLip(0.6, H - 0.4, lipAt(0) - 0.15, 3).map((p) => ({ ...p, x: p.x - 2.2 })), H - 0.5, { ...opts, veil: false });
  kit.clearGrass?.(0, 3.5, 7.5);
  g.add(makePool({ cx: 0, cz: 3.5, rx: 6, rz: 4, y: 0.12, impact: [-2.5, 1.2, 2, 1.2], reach: 2.5, boil: 1.2, seed: 104, lip: H, ...POOL.clear }));
  upperRiver(kit, g, 0, H - 0.3, lipAt(0) - 2.5, 4, 20, 'clear');
  outflow(kit, g, wander(0, 7, 5, 34, 12, 2.5), 3.4, 'clear');
  scatterBoulders(kit, g, 22, (i, r) => ({ x: (r() - 0.5) * 16, z: 0.5 + r() * 9, s: 0.4 + r() * 1.3 }));
  blocker(g, 0, H / 2, -9, 44, H + 2, 12);
  return g;
}

// Barnafoss and Hraunfossar: hundreds of springs pouring out from under the Hallmundarhraun lava,
// a long mossy lava edge with birch scrub, in white rivulets down into the turquoise Hvítá.
export function barnafoss(kit) {
  const g = new THREE.Group();
  const H = 6, span = 84;
  const path = grounded(kit, cliffPath(110, (t) => ({ x: (t - 0.5) * span, z: Math.sin(t * 5.3) * 2 - 2 }), {
    top: (t) => H + Math.sin(t * 17) * 0.4, ends: 0.08, wetAt: () => 0.35, spray: () => 0.6,
  }));
  g.add(clearRoads(kit, makeCliff(path, { below: 4, back: 14, bands: 1.1, relief: 1.6, moss: 1, ledgeMoss: 0.4, seed: 111 })));
  // The springs: emerge from the face at varied heights, merged into one mesh (one draw call).
  const geos = [];
  const lips = [];
  const r = kit.rand;
  // They come out in clusters where a porous layer of the lava meets the face: a tight run of
  // rivulets at one level, some only a hand wide, some a broad white sheet, then a stretch of dry
  // mossy rock before the next cluster (an even row of equal streams read as a fence).
  for (let x0 = -span * 0.45; x0 < span * 0.44;) {
    const n = 2 + Math.floor(r() * 7), level = 1.2 + r() * (H - 2.4), big = r() < 0.35;
    let x = x0;
    for (let k = 0; k < n && x < span * 0.45; k++) {
      const t = x / span + 0.5, zf = Math.sin(t * 5.3) * 2 - 2;
      const y = Math.min(H - 0.6, Math.max(0.9, level + (r() - 0.5) * 1.2));
      const w = big && k === Math.floor(n / 2) ? 1.6 + r() * 2.2 : 0.12 + r() * r() * 0.9;
      const lip = straightLip(w, y, zf + 0.1, 3).map((p) => ({ ...p, x: p.x + x }));
      lips.push({ lip, y });
      geos.push(sheetGeometry(lip, { drop: y + 0.4, v0: 0.4 + r() * 1.1, spread: 0.06 + r() * 0.12, rows: 10, approach: 0.01 }));
      x += w * 0.6 + 0.25 + r() * 0.9;
    }
    x0 = x + 3 + r() * 9;
  }
  const springs = new THREE.Mesh(mergeGeometries(geos), sheetMaterial({ color: LIPCOL.turquoise, aerate: 1.3, gap: 0.2, opacity: 0.9, scale: 2.2 }));
  springs.renderOrder = 2; springs.userData.notGround = true;
  g.add(springs);
  for (const gg of geos) gg.dispose();
  // The Hvítá: a broad turquoise river running along the foot, white where the springs come in.
  const rp = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; rp.push({ x: -span * 0.6 + span * 1.2 * t, z: 5.5 + Math.sin(t * 4) * 1.5, y: 0.05 - t * 0.6 }); }
  const river = new THREE.Mesh(riverGeometry(rp, 11), riverMat('turquoise'));
  river.userData.notGround = true;
  g.add(river);
  // Spray where the biggest springs land.
  const fx = lowFx(kit) ? 0.4 : 1;
  g.add(makeSpray('mist', { a: [-span * 0.4, 0.4, 1], b: [span * 0.4, 0.4, 1], out: [0, 0, 1], count: 50 * fx, life: 6, speed: 0.6, rise: 1.2, size: 2.2, opacity: 0.08 }));
  g.add(makeSpray('spray', { a: [-span * 0.4, 0.2, 0.8], b: [span * 0.4, 0.2, 0.8], out: [0, 0, 1], count: 260 * fx, life: 1.2, speed: 1.8, rise: 1.4, size: 0.18, opacity: 0.45 }));
  // Barnafoss itself: rapids squeezed through a narrow rock channel downstream.
  const rap = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; rap.push({ x: span * 0.52 + t * 16, z: 6 + Math.sin(t * 3) * 1.2, y: -0.6 - t * 2.4 }); }
  const rapids = new THREE.Mesh(riverGeometry(rap, 4.5), riverMat('turquoise'));
  rapids.userData.notGround = true;
  g.add(rapids);
  scatterBoulders(kit, g, 26, (i, rr) => ({ x: (rr() - 0.5) * span, z: 1 + rr() * 2.5, s: 0.3 + rr() * 0.8 }));
  blocker(g, 0, H / 2, -10, span * 0.8, H + 2, 14);
  return g;
}

// Gullfoss: the Hvítá, wide and milky with glacial silt, comes down a broad curving staircase
// (11 m in two steps) toward you, then turns hard to the left and plunges 21 m into a narrow
// crevice that runs away at right angles, so from the bank you see the lower falls side-on with
// spray boiling up out of the gorge.
// A cliff path given point by point: [x, z, top, wet] with an optional base (foot) height.
function polyPath(kit, pts, step = 0.9, baseY = null) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0, t0, w0] = pts[i], [x1, z1, t1, w1] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 0; k < n + (i === pts.length - 2 ? 1 : 0); k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      out.push({ x, z, top: t0 + (t1 - t0) * t, wet: w0 + (w1 - w0) * t, overhang: 0, cave: 0, spray: 0.6, lean: 0, base: baseY ?? Math.min(0, kit.ground(x, z)) });
    }
  }
  return out;
}
export function gullfoss(kit) {
  const g = new THREE.Group();
  const H1 = 11.5, H2 = 6.5, xL = -12; // river above the falls, the shelf between them, its left edge
  // The plateau: its left side drops into the gorge; its front is the upper falls, standing on the shelf.
  g.add(clearRoads(kit, makeCliff(polyPath(kit, [[xL, -56, H1 * 0.6, 0], [xL, -40, H1 + 1, 0], [xL, -17, H1 + 1, 0]]), { below: 4, back: 30, bands: 1.6, columns: 1.2, relief: 1.2, moss: 0.35, seed: 121 })));
  const upFace = polyPath(kit, [[xL, -17, H1 + 1, 0], [-9, -16.5, H1 + 0.6, 0.6], [-7, -16, H1, 1], [17, -16, H1, 1], [19, -16.5, H1 + 0.8, 0.4], [40, -18, H1 + 1, 0], [52, -24, 3, 0]], 0.9, H2);
  g.add(clearRoads(kit, makeCliff(upFace, { below: 1, back: 30, bands: 1.4, relief: 1.0, moss: 0.4, seed: 122 })));
  // The step between the two tiers of the upper falls.
  { const st = new THREE.Mesh(new THREE.BoxGeometry(26, H1 - 2.2 - H2 + 0.6, 2.8), rockMaterial()); st.position.set(5, H2 + (H1 - 2.2 - H2) / 2 - 0.3, -14.9); st.userData.keepShape = true; g.add(st); }
  // The shelf: its left edge is the lower falls' lip over the gorge, its front a dry rock wall.
  const shelf = polyPath(kit, [[xL, -17, H2 + 0.6, 0.3], [xL, -15, H2, 1], [xL, -2, H2, 1], [xL, 0, H2 + 0.6, 0.3], [xL + 2, 2, H2 + 0.8, 0], [40, 2, H2 + 0.8, 0], [52, 0, 2, 0]]);
  // The front of the shelf is a steep grassy bank rather than a wall, so the upper falls show over it.
  for (const p of shelf) if (p.z > 1) p.lean = 7 * THREE.MathUtils.smoothstep(p.x, xL + 1, xL + 6);
  g.add(clearRoads(kit, makeCliff(shelf, { below: 4, back: 20, bands: 1.5, columns: 1.2, relief: 1.1, moss: 0.3, seed: 123 })));
  // The far wall of the gorge, facing back at the falls, and the gorge running away behind.
  const far = polyPath(kit, [[-27, 8, 2, 0], [-26, 2, H2 + 3, 0], [-25, -14, H2 + 3.5, 0], [-26, -40, H1 + 1, 0], [-27, -56, H1 * 0.6, 0]]);
  g.add(clearRoads(kit, makeCliff(far, { below: 4, back: 18, bands: 1.6, columns: 1.2, relief: 1.3, moss: 0.4, seed: 124 })));
  // Upper falls: a broad, slightly curved staircase in two tiers, flowing toward the viewer.
  const upperLip = arcLip(90, -0.14, 0.14, H1, 5, 90 - 16 + 0.45 - 0.3, 26).map((p) => ({ ...p, z: p.z }));
  const tier2 = upperLip.map((p) => ({ ...p, y: H1 - 2.2, z: p.z + 2.9 }));
  pour(kit, g, upperLip, 2.2, { water: 'glacial', v0: 2.4, spread: 0.01, aerate: 0.8, gap: 0.75, pool: false, spray: 0.5, mist: 0.4 });
  pour(kit, g, tier2, H1 - 2.2 - H2, { water: 'glacial', v0: 2.8, spread: 0.01, aerate: 0.8, gap: 0.75, pool: false, spray: 0.8, mist: 0.5 });
  // Across the shelf the river swings left toward the crevice, rough and white.
  const sr = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; sr.push({ x: 5 - 15 * t * t, y: H2 - 0.2 - t * 0.4, z: -12 + 6 * Math.sin(t * 1.4) }); }
  { const m = new THREE.Mesh(riverGeometry(sr, 15), riverMat('glacial')); m.userData.notGround = true; g.add(m); }
  // Lower falls: the whole river plunging sideways over the shelf's left edge into the crevice.
  const lower = [];
  for (let i = 0; i <= 26; i++) { const t = i / 26; lower.push({ x: xL + 0.45, y: H2, z: -14.5 + 13 * t, nx: -1, nz: 0 }); }
  pour(kit, g, lower, H2 - 0.1, { water: 'glacial', v0: 3.2, spread: 0.01, aerate: 1.1, gap: 0.6, spray: 1.6, mist: 2.8, mistOpacity: 0.13, rainbow: 0.28, rainbowYaw: 0,
    pool: { rx: 6, rz: 9, reach: 4, boil: 2.4, water: 'glacial', ahead: 1.2 } });
  // The gorge floor: the river rushing away from the falls between the walls.
  const gr = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; gr.push({ x: -19 + Math.sin(t * 3) * 1.5, y: 0.1 - t * 1.6, z: -2 - 56 * t }); }
  { const m = new THREE.Mesh(riverGeometry(gr, 9), riverMat('glacial')); m.userData.notGround = true; g.add(m); }
  // The river coming in from upstream on the plateau.
  upperRiver(kit, g, 5, H1 - 0.25, -18.5, 28, 34, 'glacial');
  scatterBoulders(kit, g, 16, (i, r) => ({ x: -16 - r() * 9, z: 4 - r() * 40, s: 0.5 + r() * 1.3 }));
  blocker(g, 14, H1 / 2, -30, 50, H1 + 2, 22);
  blocker(g, 14, H2 / 2, -7, 50, H2, 16);
  return g;
}

export const FALL_BUILDERS = {
  skogafoss, seljalandsfoss, dettifoss, godafoss, svartifoss, hengifoss, haifoss, gljufrabui, kvernufoss, oxararfoss, barnafoss, gullfoss,
};

// A small generic fall for places that only need one (Kirkjufellsfoss): the same signature the
// old makeWaterfall had, returning { group, mists }.
export function genericFall(kit, { width, height, cliffWidth, below = 3, water = 'clear', at = null }) {
  const g = new THREE.Group();
  const span = cliffWidth || width + 26;
  // The ground in this fall's own frame (it may sit offset and turned inside its landmark).
  const ry = at?.ry || 0, c = Math.cos(ry), s = Math.sin(ry);
  const gl = at ? (x, z) => kit.ground(at.x + x * c + z * s, at.z - x * s + z * c) - at.y : () => 0;
  const path = bowPath({ ...kit, ground: gl }, { span, bow: 2, H: height, W: width, wetPad: 1.5, notch: 0.5, ends: 0.25 });
  const kf = { ground: gl, roadDist: at && kit.roadDist ? (x, z) => kit.roadDist(at.x + x * c + z * s, at.z - x * s + z * c) : null };
  g.add(clearRoads(kf, makeCliff(path, { below, back: 3, backSlope: 0.25, bands: 1.6, relief: 0.9, moss: 0.7, ledgeMoss: 0.6, seed: Math.round(width * 7 + height) })));
  // The pool sits on the ground where the water lands, however far the land falls away.
  let poolY = -Infinity;
  for (const x of [-width / 2, 0, width / 2]) for (const z of [2, 3.5]) poolY = Math.max(poolY, gl(x, z));
  poolY = Math.min(poolY, height - 1) + 0.12;
  const k2 = at ? { ...kit, clearGrass: (x, z, r) => kit.clearGrass?.(at.x + x * c + z * s, at.z - x * s + z * c, r) } : kit;
  pour(k2, g, straightLip(width, height, lipAt(0), Math.max(4, Math.round(width * 1.5))), height - poolY, {
    water, v0: 1.6, spread: 0.05, aerate: 1.6, gap: 0.4, spray: 0.6, mist: 0.5, poolY, pool: { rx: width / 2 + 2.5, rz: 2.5 },
  });
  return { group: g, mists: [] };
}
