import * as THREE from 'three';
import { createNoise2D, fbm, clamp, lerp, smoothstep } from './noise.js';
import { COAST, ROADS, FORDS, LAKES, GLACIERS, LAVA, SANDS, PITS, CANYONS, PASSES, FLATS, JUMPS, BRIDGES, KERID, keridU, keridProfile, WS } from './geo.js';
import { solidTopAt } from './solids.js';
import { bakeStatic } from './bake.js';
import { HD } from './hd.js';
import { createTerrainMaterial, createRoadMaterial, createWaterMaterial, createRiverMaterial, riverGeometry, surfaceUniforms } from './materials.js';

export const BOUNDS = { minX: -900 * WS, maxX: 930 * WS, minZ: -690 * WS, maxZ: 580 * WS };

const nA = createNoise2D(11);
const nB = createNoise2D(23);
const nC = createNoise2D(37);
const nD = createNoise2D(51);

// ---------- Coastline ----------
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-6;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  const qx = ax + dx * t, qz = az + dz * t;
  return { d: Math.hypot(px - qx, pz - qz), t, qx, qz };
}
export function coastSignedDist(x, z) {
  let m = Infinity;
  for (let i = 0, j = COAST.length - 1; i < COAST.length; j = i++) {
    const r = segDist(x, z, COAST[j].x, COAST[j].z, COAST[i].x, COAST[i].z);
    if (r.d < m) m = r.d;
  }
  // Wobble the coastline so it never looks like straight polygon edges.
  const wob = nD(x * 0.02, z * 0.02) * 6 * WS + nD(x * 0.07, z * 0.07) * 2;
  return (pointInPoly(x, z, COAST) ? m : -m) + wob;
}

// ---------- Roads ----------
function catmullRom(points, loop, step = 4) {
  const out = [];
  const n = points.length;
  const get = (i) => (loop ? points[(i + n) % n] : points[clamp(i, 0, n - 1)]);
  const segCount = loop ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(2, Math.ceil(len / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  if (!loop) out.push({ ...points[n - 1] });
  else out.push({ ...out[0] });
  return out;
}

const CELL = 48;
const roadHash = new Map();
export const roadPaths = []; // dense polylines with heights, used for ribbons and spawn
const segments = [];

function cellKey(cx, cz) { return cx * 100003 + cz; }

function buildRoads() {
  for (const road of ROADS) {
    const pts = catmullRom(road.points, !!road.loop);
    roadPaths.push({ name: road.name, type: road.type, loop: !!road.loop, pts, profile: road.profile, summit: road.summit || 0 });
  }
}

function insertSegments() {
  roadPaths.forEach((path, pi) => {
    const p = path.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const seg = { ax: p[i].x, az: p[i].z, bx: p[i + 1].x, bz: p[i + 1].z, ha: p[i].h, hb: p[i + 1].h, fa: p[i].ford, fb: p[i + 1].ford, type: path.type, path: pi, i };
      segments.push(seg);
      const minCx = Math.floor(Math.min(seg.ax, seg.bx) / CELL), maxCx = Math.floor(Math.max(seg.ax, seg.bx) / CELL);
      const minCz = Math.floor(Math.min(seg.az, seg.bz) / CELL), maxCz = Math.floor(Math.max(seg.az, seg.bz) / CELL);
      for (let cx = minCx; cx <= maxCx; cx++)
        for (let cz = minCz; cz <= maxCz; cz++) {
          const k = cellKey(cx, cz);
          if (!roadHash.has(k)) roadHash.set(k, []);
          roadHash.get(k).push(seg);
        }
    }
  });
}

export function nearestRoad(x, z, maxR = 96) {
  const r = Math.ceil(maxR / CELL);
  const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
  let best = null, bestD = maxR;
  const seen = new Set();
  for (let cx = cx0 - r; cx <= cx0 + r; cx++)
    for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
      const list = roadHash.get(cellKey(cx, cz));
      if (!list) continue;
      for (const s of list) {
        if (seen.has(s)) continue;
        seen.add(s);
        const q = segDist(x, z, s.ax, s.az, s.bx, s.bz);
        if (q.d < bestD) {
          bestD = q.d;
          best = { dist: q.d, seg: s, t: q.t, px: q.qx, pz: q.qz, type: s.type, h: lerp(s.ha, s.hb, q.t), ford: lerp(s.fa, s.fb, q.t) };
        }
      }
    }
  return best;
}

export function roadHalfWidth(type) { return type === 'paved' ? 3.3 : 2.7; }

// The nearest stretch of road that is not the one already found: another road, or the same road
// further along (the other leg of a hairpin).
function otherLeg(x, z, first, maxR) {
  const r = Math.ceil(maxR / CELL), cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
  let best = null, bestD = maxR;
  for (let cx = cx0 - r; cx <= cx0 + r; cx++) for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
    for (const s of roadHash.get(cellKey(cx, cz)) || []) {
      if (s.path === first.seg.path && Math.abs(s.i - first.seg.i) < 10) continue;
      const q = segDist(x, z, s.ax, s.az, s.bx, s.bz);
      if (q.d < bestD) { bestD = q.d; best = { dist: q.d, type: s.type, h: lerp(s.ha, s.hb, q.t) }; }
    }
  }
  return best;
}

// True where (x, z) lies on the carriageway of a road listed before path pi. Where two roads merge
// and run together, only the earlier one is drawn (the Ring Road is first), so their surfaces
// never interleave.
function onEarlierRoad(x, z, pi) {
  const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
  for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) for (let cz = cz0 - 1; cz <= cz0 + 1; cz++) {
    for (const s of roadHash.get(cellKey(cx, cz)) || []) {
      if (s.path >= pi) continue;
      if (segDist(x, z, s.ax, s.az, s.bx, s.bz).d < roadHalfWidth(s.type) + 0.4) return true;
    }
  }
  return false;
}

// ---------- Road distance field ----------
// Distance from every point to the nearest road, on a 2 unit grid. Built with a two-pass
// nearest-seed sweep, so it is close to true Euclidean distance and takes a few milliseconds.
export const roadField = { cell: 3, nx: 0, nz: 0, d: null };

function buildRoadField() {
  const C = roadField.cell;
  const nx = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / C) + 1;
  const nz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / C) + 1;
  const sx = new Float32Array(nx * nz).fill(1e9), sz = new Float32Array(nx * nz).fill(1e9);
  const d = new Float32Array(nx * nz).fill(1e9);
  const seed = (x, z) => {
    const ix = Math.round((x - BOUNDS.minX) / C), iz = Math.round((z - BOUNDS.minZ) / C);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return;
    const i = iz * nx + ix;
    const cx = BOUNDS.minX + ix * C, cz = BOUNDS.minZ + iz * C;
    const dd = Math.hypot(cx - x, cz - z);
    if (dd < d[i]) { d[i] = dd; sx[i] = x; sz[i] = z; }
  };
  for (const path of roadPaths) {
    const p = path.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const L = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].z - p[i].z);
      const n = Math.max(1, Math.ceil(L / (C * 0.5)));
      for (let k = 0; k <= n; k++) seed(p[i].x + (p[i + 1].x - p[i].x) * (k / n), p[i].z + (p[i + 1].z - p[i].z) * (k / n));
    }
  }
  const relax = (i, j, cx, cz) => {
    if (sx[j] > 1e8) return;
    const dd = Math.hypot(cx - sx[j], cz - sz[j]);
    if (dd < d[i]) { d[i] = dd; sx[i] = sx[j]; sz[i] = sz[j]; }
  };
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const i = iz * nx + ix, cx = BOUNDS.minX + ix * C, cz = BOUNDS.minZ + iz * C;
    if (ix > 0) relax(i, i - 1, cx, cz);
    if (iz > 0) { relax(i, i - nx, cx, cz); if (ix > 0) relax(i, i - nx - 1, cx, cz); if (ix < nx - 1) relax(i, i - nx + 1, cx, cz); }
  }
  for (let iz = nz - 1; iz >= 0; iz--) for (let ix = nx - 1; ix >= 0; ix--) {
    const i = iz * nx + ix, cx = BOUNDS.minX + ix * C, cz = BOUNDS.minZ + iz * C;
    if (ix < nx - 1) relax(i, i + 1, cx, cz);
    if (iz < nz - 1) { relax(i, i + nx, cx, cz); if (ix < nx - 1) relax(i, i + nx + 1, cx, cz); if (ix > 0) relax(i, i + nx - 1, cx, cz); }
  }
  Object.assign(roadField, { nx, nz, d });
}

export function roadDistAt(x, z) {
  if (!roadField.d) return 0;
  const C = roadField.cell;
  const fx = clamp((x - BOUNDS.minX) / C, 0, roadField.nx - 1.001), fz = clamp((z - BOUNDS.minZ) / C, 0, roadField.nz - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, w = roadField.nx, D = roadField.d;
  const a = D[iz * w + ix], b = D[iz * w + ix + 1], c = D[(iz + 1) * w + ix], e = D[(iz + 1) * w + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
}

// Ridged noise: sharp crests and soft valleys, each octave weighted by the one before.
function ridged(x, z) {
  let sum = 0, amp = 1, f = 1, w = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    let n = 1 - Math.abs(nC(x * f, z * f));
    n *= n;
    n *= w;
    w = clamp(n * 1.6, 0, 1);
    sum += n * amp; norm += amp;
    amp *= 0.5; f *= 2.13;
  }
  return sum / norm;
}

// ---------- Height ----------
// Realistic look: real elevation on the game grid, bilinear (see loadHD in hd.js).
function demAt(x, z, a) {
  const D = HD.dem;
  const fx = clamp((x - D.minX) / D.sx - 0.5, 0, D.cols - 1.001), fz = clamp((z - D.minZ) / D.sz - 0.5, 0, D.rows - 1.001);
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, w = D.cols, p = iz * w + ix;
  return (a[p] * (1 - tx) + a[p + 1] * tx) * (1 - tz) + (a[p + w] * (1 - tx) + a[p + w + 1] * tx) * tz;
}
// Inland lakes get their own water level: the lowest ground around the rim, so the
// surface sits in a shallow basin instead of a pit dug down to sea level.
function lakeLevel(k) {
  if (k.level != null) return k.level;
  let m = Infinity;
  const s = k.stretch || 1;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
    const x = k.x + Math.cos(a) * k.r * 1.15 * s, z = k.z + Math.sin(a) * k.r * 1.15;
    m = Math.min(m, rawHeight(x, z, undefined, true));
  }
  k.level = Math.max(0, m - 0.5);
  return k.level;
}

export function waterLevelAt(x, z) {
  for (const k of LAKES) {
    const s = k.stretch || 1;
    if (Math.hypot((x - k.x) / s, z - k.z) < k.r * 1.1) return lakeLevel(k);
  }
  for (const f of fordPools) if (f.level > 0 && Math.hypot(x - f.x, z - f.z) < f.r) return f.level;
  return 0;
}
// Where each ford's river runs: { x, z, r, level }.
const fordPools = [];

// ---------- Bridges ----------
export const bridges = [];
function prepareBridges() {
  const ring = roadPaths.find((p) => p.loop);
  for (const B of BRIDGES) {
    let bi = 0, bd = 1e9;
    ring.pts.forEach((q, i) => { const d = Math.hypot(q.x - B.x, q.z - B.z); if (d < bd) { bd = d; bi = i; } });
    const a = ring.pts[Math.max(0, bi - 3)], b = ring.pts[Math.min(ring.pts.length - 1, bi + 3)];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    bridges.push({ x: ring.pts[bi].x, z: ring.pts[bi].z, dx: (b.x - a.x) / L, dz: (b.z - a.z) / L, len: 84, depth: 15, valley: 320 });
  }
}
// Position relative to a bridge: along the road (across the river) and along the river.
function bridgeFrame(B, x, z) {
  const ox = x - B.x, oz = z - B.z;
  return { along: ox * B.dx + oz * B.dz, lat: -ox * B.dz + oz * B.dx };
}
function bridgeCarve(x, z) {
  let c = 0;
  for (const B of bridges) {
    const f = bridgeFrame(B, x, z);
    const wander = Math.sin(f.lat * 0.018) * 10;
    const across = Math.abs(f.along - wander);
    if (across > B.len * 0.5 || Math.abs(f.lat) > B.valley) continue;
    c = Math.max(c, B.depth * (1 - smoothstep(B.len * 0.24, B.len * 0.5, across)) * (1 - smoothstep(B.valley * 0.65, B.valley, Math.abs(f.lat))));
  }
  return c;
}
// Deck height if (x, z) is on a bridge deck, else null.
export function deckAt(x, z) {
  for (const B of bridges) {
    if (B.h0 == null) continue;
    const f = bridgeFrame(B, x, z);
    if (Math.abs(f.along) <= B.len / 2 && Math.abs(f.lat) <= roadHalfWidth('paved') + 1.4) return lerp(B.h0, B.h1, (f.along + B.len / 2) / B.len);
  }
  return null;
}
// Keeps a car that is on a bridge between the parapets. The parapet boxes alone can be skipped
// at full speed (a fast car moves further in one frame than a wall is thick), so this works on
// the lateral offset directly and cannot be tunnelled through. Returns the inward wall normal.
export function bridgeGuard(prevX, prevZ, pos, r) {
  const hw = roadHalfWidth('paved') + 1.4, lim = hw - 0.3 - r;
  for (const B of bridges) {
    const fp = bridgeFrame(B, prevX, prevZ);
    if (Math.abs(fp.along) > B.len / 2 + 6 || Math.abs(fp.lat) > hw + 0.5) continue;
    const f = bridgeFrame(B, pos.x, pos.z);
    if (Math.abs(f.along) > B.len / 2 + 6 || Math.abs(f.lat) <= lim) continue;
    const s = Math.sign(f.lat), push = f.lat - s * lim;
    pos.x += B.dz * push; pos.z -= B.dx * push;
    return { nx: B.dz * s, nz: -B.dx * s, kind: 'wall' };
  }
  return null;
}
// The land at (x, z) given its natural height h, pulled to the nearest road's height near it.
function roadBlendAt(x, z, h) {
  h = underDecks(x, z, h);
  const r = nearestRoad(x, z, 34);
  if (!r) return h;
  const hw = roadHalfWidth(r.type);
  // Under a bridge the land keeps its valley; elsewhere it rises to meet the road.
  // Level with the road out to one grid cell past the shoulder, so no ground triangle under
  // the road surface has a corner up or down the hillside (that tilts it through the road).
  const verge = hw + SHOULDER + Math.max(grid.dx, grid.dz) * 1.2;
  // Under a bridge the valley stays, except the last cells before each end, which meet the
  // deck so the road does not dip as it leaves the bridge.
  const blend = nearBridge(x, z, -Math.max(grid.dx, grid.dz) * 1.5) ? 1 : smoothstep(verge, verge + 16, r.dist);
  // Between two legs of road at different heights (switchbacks, a road passing under a
  // slope) the ground slopes smoothly from one to the other instead of stepping where the
  // nearer road changes; under each road it stays at that road's height.
  let rh = r.h;
  const r2 = otherLeg(x, z, r, verge + 16);
  if (r2) {
    const W = hw + SHOULDER;
    const wa = 1 / Math.max(r.dist - W, 1e-3) ** 2, wb = 1 / Math.max(r2.dist - roadHalfWidth(r2.type) - SHOULDER, 1e-3) ** 2;
    rh = (r.h * wa + r2.h * wb) / (wa + wb);
  }
  return lerp(rh, h, blend);
}

// Under a bridge the valley keeps its shape, but never reaches up to the deck: a bank that rose
// through the end of the deck was a ridge the car hit as it drove on.
function underDecks(x, z, h) {
  for (const B of bridges) {
    const f = bridgeFrame(B, x, z);
    if (Math.abs(f.along) > B.len / 2 + 1 || Math.abs(f.lat) > 9) continue;
    if (B.ends == null) B.ends = [-1, 1].map((s) => nearestRoad(B.x + B.dx * s * (B.len / 2), B.z + B.dz * s * (B.len / 2), 20)?.h ?? 2);
    h = Math.min(h, lerp(B.ends[0], B.ends[1], clamp(f.along / B.len + 0.5, 0, 1)) - 1.2);
  }
  return h;
}
function nearBridge(x, z, pad = 0) {
  for (const B of bridges) { const f = bridgeFrame(B, x, z); if (Math.abs(f.along) < B.len / 2 + pad && Math.abs(f.lat) < 30) return true; }
  return false;
}
// What a wheel or a foot actually stands on: the bridge deck where there is one, else the land.
// What wheels and boots stand on: the land, a bridge deck, or a landmark landform on top.
export function groundAt(x, z) { const d = deckAt(x, z); return Math.max(d ?? -Infinity, heightAt(x, z), solidTopAt(x, z)); }

let keridBusy = false;
function rawHeight(x, z, cd, noLakes = false, noBridge = false) {
  let d = cd ?? coastSignedDist(x, z);
  const rd = roadDistAt(x, z);
  // A few roads (round Snæfellsnes, into Siglufjörður) run just off the drawn coastline, as the
  // real ones run on a thin strip of shore: keep low land under them so they never cross open sea.
  if (d < 8 && roadField.d && rd < 26) d = Math.max(d, 8 * (1 - smoothstep(10, 26, rd)));
  if (d < 0) return Math.max(-16, -1.4 + d * 0.06);
  const bc = noBridge ? 0 : bridgeCarve(x, z);
  const ramp = smoothstep(0, 40, d);
  // Lowland: broad golden plains that roll gently and rise toward the interior plateau.
  const nP = fbm(nA, x * 0.0024, z * 0.0024, 3) * 0.5 + 0.5;
  let h = 0.8 + ramp * (1.6 + 6 * nP) + smoothstep(60, 320, d) * 14 * nP;
  let mountainH = 0;
  if (HD.dem) {
    // Realistic look: the land's shape comes from real elevation (Copernicus GLO-90), squeezed
    // into the game's scale. Beside roads it eases to a blurred copy so grades stay drivable,
    // and it fades in from the game's own coastline.
    let flat = 0;
    for (const k of FLATS) flat = Math.max(flat, 1 - smoothstep(0.55, 1.0, Math.hypot(x - k.x, z - k.z) / k.r));
    const near = smoothstep(10, 70, rd);
    const relief = lerp(demAt(x, z, HD.dem.blur), demAt(x, z, HD.dem.heights), near) * smoothstep(2, 40, d) * (1 - flat * 0.85);
    h = 0.8 + ramp * (1.6 + 2.5 * nP) + relief;
    const k = smoothstep(10, 45, relief) * near;
    if (k > 0) {
      const g = ridged(x * 0.016 + 31.7, z * 0.016 - 12.3), f = ridged(x * 0.045 - 8.1, z * 0.045 + 4.4);
      h += ((g - 0.42) * 8 + (f - 0.42) * 2.5) * k;
    }
    mountainH = relief;
  } else {
  // Mountain massifs: broad, steep-sided and often flat-topped, like Icelandic table mountains
  // and basalt ridges. They rise from the plains, leave a corridor open along every road, and
  // can stand right on the coast like the east fjords and Snæfellsnes.
  const mm = fbm(nB, x * 0.0021 + 5.2, z * 0.0021 - 3.1, 3) * 0.5 + 0.5;
  const foot = smoothstep(0.4, 0.58, mm);
  let pass = 0;
  for (const k of PASSES) pass = Math.max(pass, 1 - smoothstep(0.45, 1.0, Math.hypot(x - k.x, z - k.z) / k.r));
  let flat = 0;
  for (const k of FLATS) flat = Math.max(flat, 1 - smoothstep(0.55, 1.0, Math.hypot(x - k.x, z - k.z) / k.r));
  const corridor = lerp(smoothstep(24, 80, rd), 1, pass) * (1 - flat);
  // A pass always has a mountain under it, whatever the noise says.
  const mask = Math.pow(Math.max(foot, pass * 0.9), 0.7) * smoothstep(4, 34, d) * corridor;
  if (mask > 0) {
    const r = ridged(x * 0.0046, z * 0.0046);
    const peak = lerp(70 + 150 * smoothstep(0.52, 0.85, mm), 62, pass);
    let m = mask * peak * (0.5 + 0.55 * r);
    // Plateau: some massifs are cut flat on top with a cliff rim.
    const capN = nA(x * 0.0013 - 4.0, z * 0.0013 + 9.0) * 0.5 + 0.5;
    const cap = 55 + 120 * capN;
    if (m > cap) m = cap + (m - cap) * 0.12;
    // Layered basalt: soft terraces give the striped, stepped faces.
    const step = 8 + 3 * nP;
    const tq = m / step, fr = tq - Math.floor(tq);
    const terr = (Math.floor(tq) + smoothstep(0.5, 1.0, fr)) * step;
    m = lerp(m, terr, smoothstep(16, 45, m) * 0.6);
    // Realistic look (desktop): erosion. Sharper sub-ridges and gullies cut into every face,
    // with finer rills on top, growing with height so foothills and roads stay as they were.
    if (HD.on) {
      const k = smoothstep(6, 40, m);
      const g = ridged(x * 0.016 + 31.7, z * 0.016 - 12.3), f = ridged(x * 0.045 - 8.1, z * 0.045 + 4.4);
      m += ((g - 0.42) * 11 + (f - 0.42) * 3.2) * k;
    }
    h += m;
    mountainH = m;
  }
  }
  // Basalt step cliffs along parts of the coast.
  const cliffMask = smoothstep(0.15, 0.45, nC(x * 0.004, z * 0.004));
  h += cliffMask * smoothstep(3, 6, d) * 5 * smoothstep(10, 30, rd);
  // Fine undulation so plains never look flat-shaded.
  // (Kept off the mountains: finer than the mesh, it only speckles steep faces.)
  h += (nD(x * 0.035, z * 0.035) * 0.35) * ramp * (1 - smoothstep(3, 20, mountainH));
  // Ice caps: smooth domes that ride over the mountains, kept off the road corridor.
  for (const g of GLACIERS) {
    const gd = Math.hypot(x - g.x, z - g.z) / g.r;
    // With real elevation the ice caps are already high, so their domes are only a cap of ice.
    if (gd < 1) h += g.h * (HD.dem ? 0.3 : 1) * Math.pow(1 - gd * gd, 0.5) * smoothstep(18, 75, rd);
  }
  for (const l of LAVA) {
    const m = 1 - smoothstep(0.55, 1, Math.hypot(x - l.x, z - l.z) / l.r);
    if (m > 0) h += m * Math.abs(nB(x * 0.09, z * 0.09)) * 1.4;
  }
  // Canyons: the deepest carve wins where segments of a winding gorge overlap at their joints.
  let carve = 0;
  for (const c of CANYONS) {
    const q = segDist(x, z, c.a.x, c.a.z, c.b.x, c.b.z);
    if (q.d >= c.w) continue;
    const ends = (c.taperA === false ? 1 : smoothstep(0.0, 0.08, q.t)) * (c.taperB === false ? 1 : smoothstep(1.0, 0.92, q.t));
    carve = Math.max(carve, c.depth * (1 - smoothstep(c.w * 0.5, c.w, q.d)) * ends);
  }
  h -= carve;
  // Kerið: the land follows the crater shape, a little below the detailed surface laid over it.
  if (!keridBusy && !noBridge) {
    const ku = keridU(x, z);
    if (ku < 1.9) {
      if (KERID.base == null) {
        // Base height: the average of the land in a ring just outside the crater.
        keridBusy = true;
        const c0 = Math.cos(KERID.rot), s0 = Math.sin(KERID.rot);
        let sum = 0;
        for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, cx = 1.35 * KERID.rx * Math.cos(a), cz = 1.35 * KERID.rz * Math.sin(a); sum += rawHeight(KERID.x + cx * c0 + cz * s0, KERID.z - cx * s0 + cz * c0); }
        // Kerið sits in a low scoria hill, so its floor stays well above sea level.
        KERID.base = Math.max(sum / 16, 26);
        keridBusy = false;
      }
      const target = KERID.base + keridProfile(ku) - (ku < 0.84 ? 1.8 : 0.3);
      h = lerp(target, h, smoothstep(1.05, 1.9, ku));
    }
  }
  h -= bc;
  if (noLakes) return h;
  for (const k of LAKES) {
    const s = k.stretch || 1;
    const ld = Math.hypot((x - k.x) / s, z - k.z) / k.r;
    const carve = 1 - smoothstep(0.65, 1.08, ld);
    if (carve > 0) h = lerp(h, lakeLevel(k) - k.depth, carve);
  }
  return h;
}

export function lavaMask(x, z) {
  let m = 0;
  for (const l of LAVA) m = Math.max(m, 1 - smoothstep(0.55, 1, Math.hypot(x - l.x, z - l.z) / l.r));
  return m;
}
// Black sand plains: full strength in the middle, fading at the rim and up any hillside.
export function sandMask(x, z, h = heightAt(x, z)) {
  let m = 0;
  for (const s of SANDS) m = Math.max(m, (1 - smoothstep(0.6, 1, Math.hypot(x - s.x, z - s.z) / s.r)) * (1 - smoothstep(s.top * 0.7, s.top, h)));
  return m;
}
export function glacierMask(x, z) {
  let m = 0;
  for (const g of GLACIERS) m = Math.max(m, 1 - smoothstep(0.75, 0.95, Math.hypot(x - g.x, z - g.z) / g.r));
  return m;
}

// Jumps: on a few long straights the road climbs a short kicker and drops away, so a car at
// speed takes off. The profile is measured along the road from the jump point.
function applyJumps(path, h) {
  const p = path.pts;
  for (const J of JUMPS) {
    if (J.path !== path.name) continue;
    let best = -1, bd = 1e9;
    p.forEach((q, i) => { const d = Math.hypot(q.x - J.x, q.z - J.z); if (d < bd) { bd = d; best = i; } });
    J.found = true;
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
    for (let i = 0; i < p.length; i++) {
      const s = cum[i] - cum[best];
      // A sharp crest, the same from both directions: ride up, fly off the top, land on the far slope.
      const a = Math.abs(s);
      h[i] += a < 48 ? 6 * Math.pow(1 - a / 48, 1.6) : 0;
    }
  }
}

// Snap every jump onto the nearest point of the nearest road.
function snapJumps() {
  for (const J of JUMPS) {
    let bd = 1e9;
    for (const path of roadPaths) for (const q of path.pts) { const d = Math.hypot(q.x - J.x, q.z - J.z); if (d < bd) { bd = d; J.sx = q.x; J.sz = q.z; J.path = path.name; } }
    J.x = J.sx; J.z = J.sz;
  }
}

function computeRoadHeights() {
  snapJumps();
  for (const path of roadPaths) {
    const p = path.pts;
    const base = p.map((q) => Math.max(0.9, rawHeight(q.x, q.z, undefined, false, true)));
    let h = base;
    // Smooth hard: roads in Iceland follow the land in long, gentle grades, not bumps.
    for (let pass = 0; pass < 6; pass++) {
      h = h.map((_, i) => {
        let s = 0, c = 0;
        for (let k = -10; k <= 10; k++) {
          const j = path.loop ? (i + k + p.length) % p.length : clamp(i + k, 0, p.length - 1);
          s += h[j]; c++;
        }
        return s / c;
      });
    }
    // A pass road gets its own smooth profile: valley floor, a long climb to the summit,
    // and back down to the far valley. The mountains either side stay as they are.
    if (path.profile === 'pass') {
      const cum = [0];
      for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
      const L = cum[p.length - 1] || 1;
      const h0 = Math.max(0.9, rawHeight(p[0].x, p[0].z, undefined, true)), h1 = Math.max(0.9, rawHeight(p[p.length - 1].x, p[p.length - 1].z, undefined, true));
      h = p.map((_, i) => { const t = cum[i] / L; return lerp(h0, h1, t) + path.summit * Math.pow(Math.sin(Math.PI * t), 1.4); });
    }
    // Gradient limit (forward then backward), gentler on tarmac than on gravel tracks.
    const g = path.type === 'paved' ? 0.07 : 0.12;
    for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); h[i] = clamp(h[i], h[i - 1] - g * d, h[i - 1] + g * d); }
    for (let i = p.length - 2; i >= 0; i--) { const d = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].z - p[i].z); h[i] = clamp(h[i], h[i + 1] - g * d, h[i + 1] + g * d); }
    applyJumps(path, h);
    // A ford dips the road into the river. On real terrain the river runs just under the banks;
    // in the classic look it is at sea level. The wet stretch is always the same, but the ramp
    // down to it on each side reaches as far as that bank needs for about a 7% average grade, so
    // a high bank is no cliff. A road that only passes near a ford gets the old short dip.
    const ramps = FORDS.map((f, k) => {
      let at = -1, best = 10;
      p.forEach((q, i) => { const d = Math.hypot(q.x - f.x, q.z - f.z); if (d < best) { best = d; at = i; } });
      if (at < 0) return { at, R: [20, 20], bed: (fordPools[k]?.level ?? 0) - 0.4 };
      if (!fordPools[k]) {
        let bank = Infinity;
        p.forEach((q, i) => { if (Math.hypot(q.x - f.x, q.z - f.z) < 30) bank = Math.min(bank, h[i]); });
        fordPools[k] = { x: f.x, z: f.z, r: 18, level: HD.dem ? Math.max(0, bank - 1) : 0 };
      }
      const bed = fordPools[k].level - 0.4;
      const R = [0, 1].map((side) => {
        let r = 20;
        p.forEach((q, i) => {
          if ((i < at) !== (side === 0)) return;
          const d = Math.hypot(q.x - f.x, q.z - f.z), need = 6 + (Math.max(0.9, h[i]) - bed) / 0.07;
          if (d > 6 && d < need) r = Math.max(r, need);
        });
        // Never past the road's end on that side, which meets a road or a landmark at its own height.
        if (!path.loop) { const e = side === 0 ? p[0] : p[p.length - 1]; r = Math.min(r, Math.max(20, Math.hypot(e.x - f.x, e.z - f.z) - 10)); }
        return Math.min(r, 300);
      });
      return { at, R, bed };
    });
    p.forEach((q, i) => {
      let ford = 0, dip = 0, bed = -0.4;
      FORDS.forEach((f, k) => {
        const d = Math.hypot(q.x - f.x, q.z - f.z), { at, R } = ramps[k];
        const w = 1 - smoothstep(6, at < 0 ? 20 : R[i < at ? 0 : 1], d);
        ford = Math.max(ford, 1 - smoothstep(6, 20, d));
        if (w > dip) { dip = w; bed = ramps[k].bed; }
      });
      q.ford = ford;
      q.h = lerp(Math.max(0.9, h[i]), bed, dip);
    });
  }
  roundProfiles();
  closeLoops();
  meetAtJunctions();
}

// Grade limits, pads and fords leave corners in a road's profile: a climb meeting a level
// stretch at an angle. At speed each one throws the car up or drops it away. Real roads are
// rounded into vertical curves; here every profile is smoothed over about 13 m either way.
// Bridge decks, the wet stretch of a ford and jump ramps keep their exact heights.
function roundProfiles() {
  const R = 3, wts = [1, 2, 3, 4, 3, 2, 1];
  for (const path of roadPaths) {
    const p = path.pts, n = p.length;
    const jumps = JUMPS.filter((J) => J.path === path.name);
    const held = p.map((q) => q.ford > 0 || nearBridge(q.x, q.z, 10) || jumps.some((J) => Math.hypot(q.x - J.x, q.z - J.z) < 50));
    for (let pass = 0; pass < 3; pass++) {
      const h = p.map((q) => q.h);
      for (let i = 0; i < n; i++) {
        if (held[i]) continue;
        let sum = 0, w = 0;
        for (let k = -R; k <= R; k++) {
          const j = path.loop ? (i + k + n) % n : i + k;
          if (j < 0 || j >= n) continue;
          sum += h[j] * wts[k + R]; w += wts[k + R];
        }
        p[i].h = sum / w;
      }
    }
  }
}

// A loop road's heights are worked out from its first point round to its last, so where the loop
// closes they can disagree. The step is shared out over the 30 points either side.
function closeLoops() {
  for (const path of roadPaths) {
    if (!path.loop) continue;
    const p = path.pts, n = p.length, K = 30;
    const d = (i, j) => Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z);
    const step = p[0].h - (p[n - 1].h + ((p[n - 1].h - p[n - 2].h) / Math.max(d(n - 1, n - 2), 0.1)) * d(0, n - 1));
    for (let k = 0; k < K; k++) {
      const w = (step / 2) * (1 - k / K);
      p[k].h -= w;
      p[n - 1 - k].h += w;
    }
  }
}

// Each road's profile is smoothed on its own, so two roads can meet, or run side by side, at
// different heights and leave a step. Wherever a road touches one listed before it (and at its
// ends, wherever it ends on any road) it takes that road's height, easing back to its own
// profile over the next 90 m.
function meetAtJunctions() {
  const REACH = 12, EASE = 90;
  const hash = new Map();
  roadPaths.forEach((other, oi) => other.pts.forEach((q) => {
    const k = cellKey(Math.floor(q.x / REACH), Math.floor(q.z / REACH));
    (hash.get(k) || hash.set(k, []).get(k)).push([q, oi]);
  }));
  const nearestOn = (x, z, test) => {
    let best = null;
    const cx = Math.floor(x / REACH), cz = Math.floor(z / REACH);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const [q, oi] of hash.get(cellKey(cx + i, cz + j)) || []) {
        if (!test(oi)) continue;
        const d = Math.hypot(q.x - x, q.z - z);
        if (d < REACH && (!best || d < best.d)) best = { d, h: q.h };
      }
    }
    return best;
  };
  roadPaths.forEach((path, pi) => {
    const p = path.pts, n = p.length;
    const anchor = p.map((q, i) => {
      const end = !path.loop && (i === 0 || i === n - 1);
      return nearestOn(q.x, q.z, (oi) => oi < pi || (end && oi !== pi))?.h ?? null;
    });
    if (anchor.every((a) => a === null)) return;
    // Walk forward then back, carrying the step at the last anchor and the distance since it. The
    // step fades out along the road, which keeps its own rise and fall; a bigger step is faded
    // over a longer stretch, at no more than about a 5% grade on top. Between two anchors the
    // steps from either side are mixed by how near each one is.
    const side = [1, -1].map((dir) => {
      const out = p.map(() => ({ run: Infinity, off: 0, w: 0 }));
      let run = Infinity, off = 0, ease = EASE;
      for (let k = 0; k < n; k++) {
        const i = dir > 0 ? k : n - 1 - k, j = i - dir;
        if (k > 0) run += Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z);
        if (anchor[i] !== null) { run = 0; off = anchor[i] - p[i].h; ease = Math.max(EASE, Math.abs(off) / 0.05); }
        out[i] = { run, off, w: run < ease ? 1 - smoothstep(0, ease, run) : 0 };
      }
      return out;
    });
    p.forEach((q, i) => {
      const [a, b] = [side[0][i], side[1][i]];
      if (a.w <= 0 && b.w <= 0) return;
      const ka = a.w / (a.run + 1e-3), kb = b.w / (b.run + 1e-3);
      q.h += ((a.off * ka + b.off * kb) / (ka + kb)) * Math.max(a.w, b.w);
    });
  });
}

// ---------- Grid ----------
export const grid = { res: 0, nx: 0, nz: 0, dx: 0, dz: 0, heights: null, coast: null };

export function heightAt(x, z) {
  const fx = clamp((x - BOUNDS.minX) / grid.dx, 0, grid.nx - 1.001);
  const fz = clamp((z - BOUNDS.minZ) / grid.dz, 0, grid.nz - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const H = grid.heights, w = grid.nx;
  const a = H[iz * w + ix], b = H[iz * w + ix + 1], c = H[(iz + 1) * w + ix], d = H[(iz + 1) * w + ix + 1];
  // Match the triangle split used by the mesh so the jeep sits on the visible surface.
  if (tx + tz < 1) return a + (b - a) * tx + (c - a) * tz;
  return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}
export function coastAt(x, z) {
  const fx = clamp((x - BOUNDS.minX) / grid.dx, 0, grid.nx - 1.001);
  const fz = clamp((z - BOUNDS.minZ) / grid.dz, 0, grid.nz - 1.001);
  return grid.coast[Math.round(fz) * grid.nx + Math.round(fx)];
}

export function surfaceAt(x, z) {
  const r = nearestRoad(x, z, 12);
  const h = heightAt(x, z);
  if (r && r.dist < roadHalfWidth(r.type) + 0.6) {
    if (r.ford > 0.35 && h < waterLevelAt(x, z) + 0.15) return 'ford';
    return r.type;
  }
  if (h < waterLevelAt(x, z) + 0.12) return 'ford';
  const cd = coastAt(x, z);
  if ((cd < 14 * WS && h < 4) || sandMask(x, z, h) > 0.5) return 'sand';
  if (snowAt(x, z) > 0.28) return 'snow';
  return 'moss';
}

// The terrain shader's noise, ported so the CPU can tell where it painted snow.
const fract = (v) => v - Math.floor(v);
function gH(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function gN(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const top = lerp(gH(ix, iy), gH(ix + 1, iy), ux), bot = lerp(gH(ix, iy + 1), gH(ix + 1, iy + 1), ux);
  return lerp(top, bot, uy);
}
function gF(x, y) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 4; i++) { s += a * gN(x, y); x = x * 2.07 + 13.7; y = y * 2.07 + 13.7; a *= 0.5; }
  return s;
}
// How snowy the ground is (0..1), following the terrain shader: deep snow above the season's
// (wavy) snow line, scattered patches below it in the cold months, and glaciers.
export function snowAt(x, z) {
  const nL = gF(x * 0.006, z * 0.006), nM = gF(x * 0.035, z * 0.035);
  const line = surfaceUniforms.uSnowLine.value + (nL - 0.5) * 16 + (nM - 0.5) * 6;
  const h = heightAt(x, z);
  const gx = (heightAt(x + 1, z) - heightAt(x - 1, z)) / 2, gz = (heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;
  const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
  const above = smoothstep(line - 7, line + 9, h);
  const flat = above * lerp(1, 0.55, smoothstep(0.32, 0.75, slope));
  const dust = (1 - surfaceUniforms.uSummer.value) * smoothstep(line - 18, line, h) * smoothstep(0.55, 0.85, nM) * 0.6;
  return Math.max(flat, dust * 0.7, glacierMask(x, z));
}

// How exposed a spot is to wind: highlands and open coast catch the most.
export function exposureAt(x, z) {
  const h = heightAt(x, z);
  const cd = coastAt(x, z);
  let e = 0.35 + 0.45 * smoothstep(8, 28, h) + 0.35 * (1 - smoothstep(10, 60, cd));
  if (z > 250) e += 0.15; // the south coast is famous for it
  return clamp(e, 0, 1);
}

let colorCtx = null;

// onProgress(0..1) is called as the land is built; the build pauses briefly every ~40 ms so the
// page can draw the loading bar between rows.
export async function buildTerrain(scene, res, season, onProgress) {
  let lastYield = performance.now();
  const breathe = async (f) => {
    // A background tab would throttle the pause to a second or more, so it just keeps building.
    if (document.hidden || performance.now() - lastYield < 40) return;
    onProgress?.(f);
    await new Promise((r) => setTimeout(r, 0));
    lastYield = performance.now();
  };
  buildRoads();
  buildRoadField();
  prepareBridges();
  computeRoadHeights();
  insertSegments();

  const nx = res + 1;
  const aspect = (BOUNDS.maxZ - BOUNDS.minZ) / (BOUNDS.maxX - BOUNDS.minX);
  const nz = Math.round(res * aspect) + 1;
  grid.nx = nx; grid.nz = nz;
  grid.dx = (BOUNDS.maxX - BOUNDS.minX) / (nx - 1);
  grid.dz = (BOUNDS.maxZ - BOUNDS.minZ) / (nz - 1);
  grid.heights = new Float32Array(nx * nz);
  grid.coast = new Float32Array(nx * nz);

  const pos = new Float32Array(nx * nz * 3);
  for (let iz = 0; iz < nz; iz++) {
    await breathe(0.1 + 0.65 * (iz / nz));
    for (let ix = 0; ix < nx; ix++) {
      const x = BOUNDS.minX + ix * grid.dx;
      const z = BOUNDS.minZ + iz * grid.dz;
      const cd = coastSignedDist(x, z);
      let h = rawHeight(x, z, cd);
      if (cd > -4 || roadDistAt(x, z) < 26) h = roadBlendAt(x, z, h);
      const i = iz * nx + ix;
      grid.heights[i] = h;
      grid.coast[i] = cd;
      pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
    }
  }
  // Smoothing pass: soften small bumps so the land rolls instead of jitters. Roads stay exact.
  {
    const Hh = grid.heights, src = new Float32Array(Hh);
    for (let pass = 0; pass < 2; pass++) {
      src.set(Hh);
      for (let iz = 1; iz < nz - 1; iz++) {
        await breathe(0.75 + 0.1 * pass + 0.1 * (iz / nz));
        for (let ix = 1; ix < nx - 1; ix++) {
          const i = iz * nx + ix;
          const gx = BOUNDS.minX + ix * grid.dx, gz = BOUNDS.minZ + iz * grid.dz;
          const rd = roadDistAt(gx, gz);
          if (rd < 7) continue;
          // Keep canyons sharp: smoothing would fill them in.
          if (CANYONS.some((c) => segDist(gx, gz, c.a.x, c.a.z, c.b.x, c.b.z).d < c.w + 6)) continue;
          if (keridU(gx, gz) < 1.95) continue;
          const avg = (src[i] * 4 + src[i - 1] + src[i + 1] + src[i - nx] + src[i + nx] + (src[i - nx - 1] + src[i - nx + 1] + src[i + nx - 1] + src[i + nx + 1]) * 0.5) / 10;
          Hh[i] = lerp(src[i], avg, smoothstep(7, 15, rd) * 0.8);
        }
      }
    }
    for (let i = 0; i < nx * nz; i++) pos[i * 3 + 1] = Hh[i];
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < nz - 1; iz++)
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * nz * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, createTerrainMaterial());
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  addTerrainTiles(scene, mesh, nx, nz);
  colorCtx = { geo, pos };
  writeMasks();
  paintTerrain(season);

  // Sea and lakes share one water plane at y = 0.
  const waterGeo = new THREE.PlaneGeometry(6000, 6000, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  // Share the height grid with water shaders so they can work out their depth.
  const hTex = new THREE.DataTexture(grid.heights, grid.nx, grid.nz, THREE.RedFormat, THREE.FloatType);
  hTex.magFilter = THREE.NearestFilter; hTex.minFilter = THREE.NearestFilter; hTex.needsUpdate = true;
  surfaceUniforms.uHeightTex.value = hTex;
  surfaceUniforms.uGridMin.value.set(BOUNDS.minX, BOUNDS.minZ);
  surfaceUniforms.uGridStep.value.set(grid.dx, grid.dz);
  surfaceUniforms.uGridN.value.set(grid.nx, grid.nz);
  // North Atlantic: green-teal shallows over black sand, dark blue offshore.
  const waterMat = createWaterMaterial(0x0a161c, { roughness: 0.08, ripple: 0.55, shallow: [0.17, 0.4, 0.4], deep: [0.01, 0.045, 0.07], clarity: 0.5 });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.receiveShadow = true;
  water.position.y = 0;
  scene.add(water);

  buildBridges(scene);
  buildRoadRibbons(scene);
  // A water surface for each inland lake at its own level.
  // Glacial lakes are turquoise.
  // Each lake has its own water: clear blue-green Þingvallavatn, dark Mývatn, milky glacial Jökulsárlón.
  const LAKE_LOOK = [
    { shallow: [0.2, 0.48, 0.5], deep: [0.02, 0.09, 0.14], clarity: 0.3 },
    { shallow: [0.18, 0.32, 0.28], deep: [0.02, 0.06, 0.07], clarity: 0.6 },
    { shallow: [0.42, 0.62, 0.68], deep: [0.1, 0.27, 0.36], clarity: 0.9, ripple: 0.25 },
  ];
  lakeMat = createWaterMaterial(0x1c5a63, { roughness: 0.08, ripple: 0.5, ...LAKE_LOOK[0] });
  LAKES.forEach((k, li) => {
    const lv = Math.max(0.03, lakeLevel(k));
    const mat = li === 0 ? lakeMat : createWaterMaterial(0x1c5a63, { roughness: 0.08, ripple: 0.5, ...LAKE_LOOK[li] });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(k.r * 1.08, 40), mat);
    disc.receiveShadow = true;
    disc.rotation.x = -Math.PI / 2;
    disc.scale.x = k.stretch || 1;
    disc.position.set(k.x, lv, k.z);
    scene.add(disc);
  });

  // A ford above sea level gets a patch of river of its own; the land hides all but the crossing.
  for (const f of fordPools) {
    if (f.level <= 0) continue;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(f.r, 32), lakeMat);
    disc.receiveShadow = true;
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(f.x, f.level, f.z);
    scene.add(disc);
  }

  buildCanyonWater(scene);
  return { mesh, water, waterMat, lakeMat };
}

export let lakeMat = null;

function buildCanyonWater(scene) {
  // Glacial river through each canyon: blue-green, flowing downhill, with rapids where it drops.
  // Consecutive segments (a winding gorge) are joined into one continuous river.
  const mat = createRiverMaterial({ shallow: [0.22, 0.55, 0.55], deep: [0.03, 0.2, 0.24], speed: 1.6 });
  const chains = [];
  for (const c of CANYONS) {
    const last = chains[chains.length - 1];
    if (last && Math.hypot(last[last.length - 1].b.x - c.a.x, last[last.length - 1].b.z - c.a.z) < 1) last.push(c);
    else chains.push([c]);
  }
  for (const chain of chains) {
    const pts = [];
    chain.forEach((c, ci) => {
      const n = 24;
      const dx = c.b.x - c.a.x, dz = c.b.z - c.a.z;
      const t0 = ci === 0 ? 0.05 : 0, t1 = ci === chain.length - 1 ? 0.95 : 1;
      for (let i = 0; i <= n; i++) {
        const t = t0 + (i / n) * (t1 - t0);
        if (ci > 0 && i === 0) continue;
        const x = c.a.x + dx * t, z = c.a.z + dz * t;
        pts.push({ x, y: heightAt(x, z) + 0.5, z });
      }
    });
    // Smooth the floor profile so the water does not step, then flow downhill.
    for (let k = 0; k < 2; k++) for (let i = 1; i < pts.length - 1; i++) pts[i].y = (pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4;
    for (let i = 1; i < pts.length; i++) pts[i].y = Math.min(pts[i].y, pts[i - 1].y + 0.02); // never uphill
    if (pts[0].y < pts[pts.length - 1].y) pts.reverse();
    for (let i = 1; i < pts.length; i++) pts[i].y = Math.min(pts[i].y, pts[i - 1].y);
    const m = new THREE.Mesh(riverGeometry(pts, chain[0].w * 0.8), mat);
    m.receiveShadow = true;
    scene.add(m);
  }
}

// Per-vertex masks for the terrain shader: r = black sand, g = lava field, b = glacier.
function writeMasks() {
  const { geo, pos } = colorCtx;
  const col = geo.attributes.color.array;
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], h = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cd = grid.coast[i];
    col[i * 3] = Math.max((1 - smoothstep(6 * WS, 11 * WS, cd)) * (1 - smoothstep(2.5, 4, h)), sandMask(x, z, h));
    col[i * 3 + 1] = lavaMask(x, z);
    col[i * 3 + 2] = glacierMask(x, z) * smoothstep(22, 60, roadDistAt(x, z)) * smoothstep(8, 20, h);
  }
  geo.attributes.color.needsUpdate = true;
}

// Season only changes shader uniforms, so switching is instant.
// The island is one grid, drawn as tiles that share its vertex buffers. The camera, and the sun's
// shadow camera, then skip the tiles they cannot see instead of drawing the whole island in every
// pass; heights and colours written to the grid still reach every tile. Each tile's bounds allow
// for the pads and roads reshaping the land after it is built.
const TILE = 96;
function addTerrainTiles(scene, mesh, nx, nz) {
  const geo = mesh.geometry, P = geo.attributes.position.array;
  for (let tz = 0; tz < nz - 1; tz += TILE) for (let tx = 0; tx < nx - 1; tx += TILE) {
    const x1 = Math.min(tx + TILE, nx - 1), z1 = Math.min(tz + TILE, nz - 1);
    const idx = new Uint32Array((x1 - tx) * (z1 - tz) * 6);
    let k = 0, y0 = Infinity, y1 = -Infinity;
    for (let iz = tz; iz < z1; iz++) for (let ix = tx; ix < x1; ix++) {
      const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    for (let iz = tz; iz <= z1; iz++) for (let ix = tx; ix <= x1; ix++) { const y = P[(iz * nx + ix) * 3 + 1]; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const g = new THREE.BufferGeometry();
    for (const name in geo.attributes) g.setAttribute(name, geo.attributes[name]);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const lo = P[(tz * nx + tx) * 3], hi = P[(z1 * nx + x1) * 3], lz = P[(tz * nx + tx) * 3 + 2], hz = P[(z1 * nx + x1) * 3 + 2];
    g.boundingBox = new THREE.Box3(new THREE.Vector3(lo, y0 - 40, lz), new THREE.Vector3(hi, y1 + 40, hz));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const t = new THREE.Mesh(g, mesh.material);
    t.receiveShadow = mesh.receiveShadow; t.castShadow = mesh.castShadow;
    t.userData.terrainTile = true;
    scene.add(t);
  }
}

export function paintTerrain(season) {
  const summer = season === 'Summer';
  surfaceUniforms.uSummer.value = summer ? 1 : 0;
  if (!surfaceUniforms.uSnowLine.userSet) surfaceUniforms.uSnowLine.value = summer ? 95 : 34;
}

const SHOULDER = 1.1;

// Junctions: wherever a road ends on another road. Each gets a plain asphalt patch over the
// overlap, and both roads' painted lines fade out as they approach it.
const junctions = [];
function findJunctions() {
  junctions.length = 0;
  roadPaths.forEach((path, pi) => {
    if (path.loop) return;
    for (const end of [path.pts[0], path.pts[path.pts.length - 1]]) {
      let best = null;
      roadPaths.forEach((other, oi) => {
        if (oi === pi) return;
        const q = other.pts;
        for (let i = 0; i < q.length - 1; i++) {
          const r = segDist(end.x, end.z, q[i].x, q[i].z, q[i + 1].x, q[i + 1].z);
          if (r.d < 9 && (!best || r.d < best.d)) best = { d: r.d, x: r.qx, z: r.qz, type: other.type };
        }
      });
      if (best) {
        const r = Math.max(roadHalfWidth(path.type), roadHalfWidth(best.type)) + SHOULDER + 0.3;
        junctions.push({ x: best.x, z: best.z, r, type: path.type === 'paved' && best.type === 'paved' ? 'paved' : best.type });
      }
    }
  });
}
function junctionDist(x, z) {
  let m = 1e9;
  for (const j of junctions) m = Math.min(m, Math.hypot(j.x - x, j.z - z) - j.r);
  return m;
}

function buildRoadRibbons(scene) {
  const posts = [];
  findJunctions();
  for (const path of roadPaths) {
    const p = path.pts;
    const hw = roadHalfWidth(path.type);
    const W = hw + SHOULDER;
    const pos = [], road = [], jd = [], idx = [];
    const side = [];
    let along = 0;
    const alongArr = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      side.push([-dz / l, dx / l]);
      if (i) along += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
      alongArr.push(along);
    }
    // Strips across: a skirt down from each edge (it fills any gap where the land falls away from
    // the road), shoulder, lane, centre, lane, shoulder. Each vertex follows the ground, and there
    // are three rows per step along the road so the ribbon hugs the ground on bends.
    // Skirt columns: its own top edge (so the shoulder keeps its own normals) and its bottom.
    const TOP = W + 0.25, BOT = W + 0.5;
    const offs = [-BOT, -TOP, -W, -hw, -hw / 2, 0, hw / 2, hw, W, TOP, BOT];
    const K = offs.length;
    const rows = [];
    for (let i = 0; i < p.length; i++) {
      rows.push({ x: p[i].x, z: p[i].z, n: side[i], along: alongArr[i] });
      if (i < p.length - 1) {
        for (const t of [1 / 3, 2 / 3]) {
          const n0 = side[i], n1 = side[i + 1], nx = n0[0] + (n1[0] - n0[0]) * t, nz = n0[1] + (n1[1] - n0[1]) * t, nl = Math.hypot(nx, nz) || 1;
          rows.push({ x: p[i].x + (p[i + 1].x - p[i].x) * t, z: p[i].z + (p[i + 1].z - p[i].z) * t, n: [nx / nl, nz / nl], along: alongArr[i] + (alongArr[i + 1] - alongArr[i]) * t });
        }
      }
    }
    const pi = roadPaths.indexOf(path);
    for (const row of rows) row.hidden = onEarlierRoad(row.x, row.z, pi);
    for (const row of rows) {
      const [nx, nz] = row.n;
      for (const o of offs) {
        // The skirt hangs straight down below the shoulder's edge.
        const e = Math.abs(o) > W ? Math.sign(o) * W : o;
        const x = row.x + nx * e, z = row.z + nz * e;
        const lift = Math.abs(o) > W + 0.4 ? -1.2 : Math.abs(o) > hw ? 0.08 : 0.13;
        const dk = deckAt(x, z);
        pos.push(x, (dk ?? heightAt(x, z)) + lift, z);
        road.push(o, row.along);
        jd.push(junctionDist(x, z));
      }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].hidden && rows[i + 1].hidden) continue;
      for (let j = 0; j < K - 1; j++) {
        const a = i * K + j, b = a + 1, c = a + K, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 2));
    geo.setAttribute('aJunction', new THREE.Float32BufferAttribute(jd, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, createRoadMaterial({ paved: path.type === 'paved', halfWidth: hw }));
    mesh.receiveShadow = true;
    mesh.userData.roadLift = (o) => (Math.abs(o) > W + 0.4 ? -1.2 : Math.abs(o) > hw ? 0.08 : 0.13);
    mesh.userData.roadEdge = W;
    roadMeshes.push(mesh);
    scene.add(mesh);

    // Yellow marker posts every 30 units on both sides, like every rural road in Iceland.
    let next = 10;
    for (let i = 1; i < p.length; i++) {
      if (alongArr[i] < next) continue;
      next += 30;
      const [nx, nz] = side[i];
      for (const sgn of [-1, 1]) {
        const x = p[i].x + nx * (W + 0.5) * sgn, z = p[i].z + nz * (W + 0.5) * sgn;
        const y = heightAt(x, z);
        if (y < waterLevelAt(x, z) + 0.1) continue;
        if (junctionDist(x, z) < 6) continue;
        if (nearBridge(x, z, 6)) continue;
        if (roadDistAt(x, z) < W - 0.2) continue; // too close to another road
        if (JUMPS.some((J) => Math.hypot(J.x - x, J.z - z) < 40)) continue;
        posts.push([x, y, z, Math.atan2(nx, nz)]);
      }
    }
  }
  // Asphalt patches over each junction, with no painted lines, sitting just above both ribbons.
  for (const j of junctions) {
    const seg = 28, pos = [], road = [], jd = [], idx = [];
    const hw = roadHalfWidth(j.type);
    // Grain coordinates come from world position so the patch blends into the road texture.
    const rc = (x, z) => [hw * 0.5 + Math.sin(x * 0.7) * 0.5, z * 1.0];
    pos.push(j.x, heightAt(j.x, j.z) + 0.17, j.z); road.push(...rc(j.x, j.z)); jd.push(-10);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2, x = j.x + Math.cos(a) * j.r, z = j.z + Math.sin(a) * j.r;
      pos.push(x, heightAt(x, z) + 0.17, z); road.push(...rc(x, z)); jd.push(-10);
      idx.push(0, 1 + ((k + 1) % seg), 1 + k);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 2));
    geo.setAttribute('aJunction', new THREE.Float32BufferAttribute(jd, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = createRoadMaterial({ paved: j.type === 'paved', halfWidth: hw });
    mat.polygonOffsetFactor = -3.5; mat.polygonOffsetUnits = -3.5;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.userData.roadLift = () => 0.17;
    roadMeshes.push(mesh);
    scene.add(mesh);
  }
  buildPosts(scene, posts);
}

export let postReflectorMat = null;

// Road surfaces, junction patches and marker posts, kept so they can be laid back onto the ground
// after anything reshapes it (landmark pads are levelled after the roads are built).
const roadMeshes = [];
let roadPosts = null;
function refitRoads() {
  for (const mesh of roadMeshes) {
    const P = mesh.geometry.attributes.position, R = mesh.geometry.attributes.aRoad, lift = mesh.userData.roadLift;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i);
      P.setY(i, (deckAt(x, z) ?? heightAt(x, z)) + lift(R.getX(i)));
    }
    // A skirt vertex sits under its shoulder edge: keep it a fixed drop below that edge.
    if (mesh.userData.roadEdge) {
      const K = 11;
      for (let i = 0; i < P.count; i += K) { P.setY(i, P.getY(i + 1) - 1.3); P.setY(i + K - 1, P.getY(i + K - 2) - 1.3); }
    }
    P.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
  if (roadPosts) {
    const { a, b, posts } = roadPosts, m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    posts.forEach(([x, , z, r], i) => {
      m.compose(v.set(x, heightAt(x, z) - 0.05, z), q.setFromAxisAngle(up, r), sc);
      a.setMatrixAt(i, m); b.setMatrixAt(i, m);
    });
    a.instanceMatrix.needsUpdate = true; b.instanceMatrix.needsUpdate = true;
  }
}

function buildPosts(scene, posts) {
  const postGeo = new THREE.BoxGeometry(0.16, 1.15, 0.16);
  postGeo.translate(0, 0.575, 0);
  const tipGeo = new THREE.BoxGeometry(0.17, 0.22, 0.17);
  tipGeo.translate(0, 1.04, 0);
  const postMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0,  color: 0xe0b324 });
  postReflectorMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0,  color: 0x1a1a1a, emissive: 0xfff2d0, emissiveIntensity: 0 });
  const a = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  const b = new THREE.InstancedMesh(tipGeo, postReflectorMat, posts.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  posts.forEach(([x, y, z, r], i) => {
    q.setFromAxisAngle(up, r);
    m.compose(v.set(x, y - 0.05, z), q, sc);
    a.setMatrixAt(i, m);
    b.setMatrixAt(i, m);
  });
  a.castShadow = true;
  scene.add(a, b);
  roadPosts = { a, b, posts };
}

// Level the ground under built landmarks so nothing perches on a slope. Each pad is fully level
// across its footprint (plus one grid cell, so no ground triangle at its edge tilts) and eases back
// to the land, the fade widening on a hillside up to the pad's own radius again. All the fades go first and all the level cores last,
// so a neighbour's fade never tilts a landmark that is already level. Roads crossing a pad follow
// the new ground: they are laid back on afterwards.
export function flattenPads(pads, mesh) {
  const H = grid.heights, nx = grid.nx, nz = grid.nz;
  const pos = mesh.geometry.attributes.position;
  for (const pd of pads) {
    let sum = 0;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; sum += heightAt(pd.x + Math.cos(a) * pd.r * 0.35, pd.z + Math.sin(a) * pd.r * 0.35); }
    pd.h = Math.max(sum / 12, waterLevelAt(pd.x, pd.z) + 0.8);
    pd.core = pd.r * 0.7 + Math.max(grid.dx, grid.dz);
    let drop = 0;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; drop = Math.max(drop, Math.abs(heightAt(pd.x + Math.cos(a) * pd.r, pd.z + Math.sin(a) * pd.r) - pd.h)); }
    pd.outer = pd.core + clamp(drop * 3, pd.r * 0.3, pd.r);
  }
  // Pads whose level cores overlap (Skógafoss and Kvernufoss, Hallgrímskirkja and Laugavegur)
  // share one height, so neither ends up tilted on the other's level.
  const group = pads.map((_, i) => i);
  const root = (i) => (group[i] === i ? i : (group[i] = root(group[i])));
  pads.forEach((a, i) => pads.forEach((b, j) => { if (j > i && Math.hypot(a.x - b.x, a.z - b.z) < a.core + b.core) group[root(j)] = root(i); }));
  const sums = new Map();
  pads.forEach((pd, i) => { const g = root(i), s = sums.get(g) || { h: 0, n: 0 }; s.h += pd.h; s.n++; sums.set(g, s); });
  pads.forEach((pd, i) => { const s = sums.get(root(i)); pd.h = s.h / s.n; });
  const each = (pd, radius, fn) => {
    const i0 = Math.max(0, Math.floor((pd.x - radius - BOUNDS.minX) / grid.dx)), i1 = Math.min(nx - 1, Math.ceil((pd.x + radius - BOUNDS.minX) / grid.dx));
    const j0 = Math.max(0, Math.floor((pd.z - radius - BOUNDS.minZ) / grid.dz)), j1 = Math.min(nz - 1, Math.ceil((pd.z + radius - BOUNDS.minZ) / grid.dz));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(BOUNDS.minX + i * grid.dx - pd.x, BOUNDS.minZ + j * grid.dz - pd.z);
      if (d <= radius) fn(j * nx + i, d);
    }
  };
  for (const pd of pads) each(pd, pd.outer, (k, d) => { if (d > pd.core) H[k] = lerp(H[k], pd.h, 1 - smoothstep(pd.core, pd.outer, d)); });
  for (const pd of pads) each(pd, pd.core, (k) => { H[k] = pd.h; });
  // A road that crosses or skirts a pad's level ground takes its level there; either side it keeps
  // its own rise and fall, held within its usual grade of that level. Elsewhere a road keeps its
  // heights, and the land beside every road near a pad is blended to the road again below.
  const before = roadPaths.map((path) => path.pts.map((q) => q.h));
  const verge = roadHalfWidth('paved') + SHOULDER + Math.max(grid.dx, grid.dz) * 1.2;
  roadPaths.forEach((path) => {
    const p = path.pts, n = p.length, g = path.type === 'paved' ? 0.07 : 0.12;
    // Held: on a pad (at its level), and on a bridge, a ford's wet stretch or a jump (as they
    // are). A ford's ramp gives way to a pad nearby, within the grade limit.
    const jumps = JUMPS.filter((J) => J.path === path.name);
    // slack: how far outside its pad's level ground a pad-held point is (-Infinity: held as it is).
    const slack = p.map(() => -Infinity);
    const fixed = p.map((q, i) => {
      if (q.ford > 0 || nearBridge(q.x, q.z, 10) || jumps.some((J) => Math.hypot(q.x - J.x, q.z - J.z) < 50)) return q.h;
      // A road on a pad, or skirting one so its verge reaches the level ground, is at that level;
      // unless two pads at different levels both reach it, when it keeps its own height.
      const reach = pads.filter((pd) => Math.hypot(q.x - pd.x, q.z - pd.z) < pd.core + verge);
      if (!reach.length || reach.some((pd) => Math.abs(pd.h - reach[0].h) >= 1)) return null;
      slack[i] = Math.min(...reach.map((pd) => Math.hypot(q.x - pd.x, q.z - pd.z) - pd.core));
      return reach[0].h;
    });
    if (!fixed.some((v, i) => v !== null && v !== p[i].h)) return;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
    // A pad's level gives way where it cannot be met at the road's grade from a held stretch that
    // matters more: one held as it is, or one nearer its own pad.
    const release = [];
    for (let i = 0; i < n; i++) {
      if (fixed[i] === null || slack[i] === -Infinity) continue;
      for (const dir of [1, -1]) {
        for (let j = i + dir; j >= 0 && j < n && Math.abs(cum[j] - cum[i]) < 300; j += dir) {
          if (fixed[j] === null || slack[j] >= slack[i]) continue;
          if (Math.abs(fixed[j] - fixed[i]) > g * Math.abs(cum[j] - cum[i]) + 0.05) { release.push(i); break; }
        }
      }
    }
    for (const i of release) fixed[i] = null;
    // Two held stretches too far apart in height for the grade between them: a straight ramp.
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (fixed[i] === null) continue;
      if (last >= 0 && i > last + 1 && Math.abs(fixed[i] - fixed[last]) > g * (cum[i] - cum[last])) {
        for (let k = last + 1; k < i; k++) fixed[k] = lerp(fixed[last], fixed[i], (cum[k] - cum[last]) / (cum[i] - cum[last]));
      }
      last = i;
    }
    const h = p.map((q, i) => fixed[i] ?? q.h);
    for (let i = 1; i < n; i++) if (fixed[i] === null) { const d = g * (cum[i] - cum[i - 1]); h[i] = clamp(h[i], h[i - 1] - d, h[i - 1] + d); }
    for (let i = n - 2; i >= 0; i--) if (fixed[i] === null) { const d = g * (cum[i + 1] - cum[i]); h[i] = clamp(h[i], h[i + 1] - d, h[i + 1] + d); }
    p.forEach((q, i) => { q.h = h[i]; });
  });
  // Roads that meet one that moved follow it again.
  roundProfiles();
  closeLoops();
  meetAtJunctions();
  const changed = [];
  roadPaths.forEach((path, pi) => path.pts.forEach((q, i) => {
    if (Math.abs(q.h - before[pi][i]) > 0.01 || pads.some((pd) => Math.hypot(q.x - pd.x, q.z - pd.z) < pd.outer + 4)) changed.push(q);
  }));
  if (changed.length) {
    for (const seg of segments) { const p = roadPaths[seg.path].pts; seg.ha = p[seg.i].h; seg.hb = p[seg.i + 1].h; }
    const near = new Set();
    for (const q of changed) each(q, verge + 19, (k) => near.add(k));
    for (const k of near) {
      const x = BOUNDS.minX + (k % nx) * grid.dx, z = BOUNDS.minZ + Math.floor(k / nx) * grid.dz;
      // A pad's level ground stays level (a landmark stands on it), except right under a road.
      if (pads.some((pd) => Math.hypot(x - pd.x, z - pd.z) < pd.core) && !nearestRoad(x, z, verge)) continue;
      H[k] = roadBlendAt(x, z, H[k]);
    }
  }
  for (let k = 0; k < H.length; k++) pos.setY(k, H[k]);
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  if (surfaceUniforms.uHeightTex.value) surfaceUniforms.uHeightTex.value.needsUpdate = true;
  refitRoads();
}

function buildBridges(scene) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.4, metalness: 0.7 });
  const riverMat = createRiverMaterial({ shallow: [0.36, 0.52, 0.5], deep: [0.1, 0.2, 0.22], speed: 1.8 });
  const hw = roadHalfWidth('paved') + 1.4;
  for (const B of bridges) {
    // The deck meets the road at its own ends: read 2 m further out, on a sloping road it started
    // a lip of 10 cm or more above the tarmac, a knock at every crossing.
    const end = (s) => nearestRoad(B.x + B.dx * s * (B.len / 2), B.z + B.dz * s * (B.len / 2), 20);
    const e0 = end(-1), e1 = end(1);
    B.h0 = (e0 ? e0.h : 2); B.h1 = (e1 ? e1.h : 2);
    const deckY = (B.h0 + B.h1) / 2;
    const g = new THREE.Group();
    g.position.set(B.x, 0, B.z);
    g.rotation.y = Math.atan2(B.dx, B.dz);
    const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
    // The deck tilts with the road, which climbs from one bank's height to the other's, so the
    // asphalt ribbon (lane lines and all) lies just on top of it from end to end. Heights in
    // here are relative to the deck surface at the middle of the bridge.
    const deck = new THREE.Group();
    deck.position.y = deckY;
    deck.rotation.x = -Math.atan2(B.h1 - B.h0, B.len);
    g.add(deck);
    add(new THREE.BoxGeometry(hw * 2, 0.9, B.len + 2), concrete, 0, -0.5, 0, deck);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.6, B.len + 2), concrete, sx * hw, 0.05, 0, deck);
    // Parapets: a closed concrete wall each side with a steel rail on top, so the edge reads as
    // solid and nothing can slip through. They run just past the ends of the deck.
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.5, 1.05, B.len + 4), concrete, sx * (hw - 0.05), 0.5, 0, deck);
      for (let zz = -B.len / 2 - 1.5; zz <= B.len / 2 + 1.5; zz += 3) add(new THREE.BoxGeometry(0.1, 0.4, 0.1), steel, sx * (hw - 0.05), 1.2, zz, deck);
      add(new THREE.BoxGeometry(0.16, 0.1, B.len + 3.6), steel, sx * (hw - 0.05), 1.42, 0, deck);
    }
    // Piers down to the river bed, and abutments at both ends. Each sits under the deck where it
    // stands: the deck slopes from one bank's height to the other's, so an abutment set at the
    // middle height would stand up out of the road at the lower end.
    const deckAtZ = (zz) => lerp(B.h0, B.h1, zz / B.len + 0.5);
    for (const zz of [-B.len / 4, 0, B.len / 4]) {
      const wx = B.x + B.dx * zz, wz = B.z + B.dz * zz, floor = heightAt(wx, wz) - 1;
      const h = deckAtZ(zz) - 0.8 - floor;
      if (h > 0.5) for (const sx of [-0.5, 0.5]) add(new THREE.CylinderGeometry(0.75, 0.95, h, 14), concrete, sx * hw, floor + h / 2, zz);
    }
    for (const s2 of [-1, 1]) add(new THREE.BoxGeometry(hw * 2 + 1, 4, 3), concrete, 0, deckAtZ(s2 * B.len / 2) - 2.4, s2 * (B.len / 2 + 0.5));
    scene.add(g);
    bakeStatic(g); // some 75 parts, one mesh per material
    // The river along the valley floor, flowing downhill.
    const pts = [];
    for (let t = -B.valley * 0.85; t <= B.valley * 0.85; t += 8) {
      const wander = Math.sin(t * 0.018) * 10;
      const x = B.x - B.dz * t + B.dx * wander, z = B.z + B.dx * t + B.dz * wander;
      pts.push({ x, y: heightAt(x, z) + 0.6, z });
    }
    // Only where the valley is still deep; the river does not climb the valley's far ends.
    const floorMid = heightAt(B.x, B.z);
    const keep = pts.filter((q) => q.y < floorMid + 4);
    pts.length = 0; pts.push(...keep);
    if (pts.length < 3) continue;
    if (pts[0].y < pts[pts.length - 1].y) pts.reverse();
    for (let i = 1; i < pts.length; i++) pts[i].y = Math.min(pts[i].y, pts[i - 1].y);
    const river = new THREE.Mesh(riverGeometry(pts, 20), riverMat);
    river.receiveShadow = true;
    scene.add(river);
  }
}

// Nearest point on any road, searching the whole network (used for spawning and recovery).
export function nearestRoadAnywhere(x, z) {
  let best = null, bestD = Infinity;
  for (const s of segments) {
    const q = segDist(x, z, s.ax, s.az, s.bx, s.bz);
    if (q.d < bestD) { bestD = q.d; best = { x: q.qx, z: q.qz, heading: Math.atan2(s.bx - s.ax, s.bz - s.az), seg: s }; }
  }
  return best;
}
