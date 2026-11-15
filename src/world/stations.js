import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toWorld } from './geo.js';
import { WashBrushes } from './washbrush.js';
import { roadPaths, heightAt, waterLevelAt, coastAt, roadDistAt, bridges } from './terrain.js';
import { archMats, Batch, frame as aframe, SKIP } from './archkit.js';

// Fuel stations on the Ring Road, one by each of six towns, so a full tank always reaches the next.
// Each is a forecourt beside the road: a lit roof over two pump islands, a small shop behind and a
// tall sign at the roadside. The sign reads ELDSNEYTI, Icelandic for fuel.
export const STATIONS = [
  { name: 'Selfoss', at: [63.94, -21.0] },
  { name: 'Vík', at: [63.42, -19.0] },
  { name: 'Höfn', at: [64.27, -15.25] },
  { name: 'Egilsstaðir', at: [65.26, -14.4] },
  { name: 'Akureyri', at: [65.68, -18.09] },
  { name: 'Borgarnes', at: [64.54, -21.92] },
];

const OFF = 19; // metres from the road's centre line to the middle of the forecourt
// Where things stand on the forecourt: u runs away from the road (the road is at u = -OFF), w along it.
const ISLANDS = [-4.5, 0.5];
const ROOF = { u: -2, w: 0, du: 11, dw: 17 };
// The car wash: a drive-through gantry past the end of the roof, in the lane between the pumps.
// Roll through slowly and the brushes spin, water sprays and the car comes out clean.
const WASH = { u: -2, w: 13, len: 4, gap: 2.3 };

// Pick a level, dry spot beside the Ring Road a little way out of each town, clear of landmarks
// and other roads. Returns sites with the road's heading and the side the station sits on, plus a
// pad for flattenPads.
export function siteStations(landmarks = []) {
  const ring = roadPaths.find((p) => p.name === 'Ring Road');
  if (!ring) return [];
  const P = ring.pts, N = P.length;
  return STATIONS.map((st) => {
    const c = toWorld(...st.at);
    let best = null;
    for (let i = 0; i < N; i++) {
      const q = P[i], dc = Math.hypot(q.x - c.x, q.z - c.z);
      if (dc < 60 || dc > 260) continue;
      const n = P[(i + 2) % N], o = P[(i - 2 + N) % N];
      const fx = n.x - o.x, fz = n.z - o.z, L = Math.hypot(fx, fz) || 1;
      for (const side of [-1, 1]) {
        const ax = (fz / L) * side, az = (-fx / L) * side;
        const x = q.x + ax * OFF, z = q.z + az * OFF;
        if (coastAt(x, z) < 45 || heightAt(x, z) < waterLevelAt(x, z) + 1.5) continue;
        if (landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < 75)) continue;
        // Not by a bridge: the road there is raised over a carved river valley, and a forecourt
        // levelled to it would stand on a mound above the fields.
        // (Only the valley itself: a town's station can still stand near its bridge, as Selfoss's
        // does beside the Ölfusá.)
        if (bridges.some((B) => { const ox = x - B.x, oz = z - B.z; return Math.abs(ox * B.dx + oz * B.dz) < B.len * 0.5 + 40 && Math.abs(-ox * B.dz + oz * B.dx) < B.valley * 0.75; })) continue;
        // Only its own road nearby: the far side and both ends of the forecourt stay clear.
        if (roadDistAt(x + ax * 16, z + az * 16) < 26 || roadDistAt(x + (fx / L) * 22, z + (fz / L) * 22) < OFF - 4 || roadDistAt(x - (fx / L) * 22, z - (fz / L) * 22) < OFF - 4) continue;
        let lo = Infinity, hi = -Infinity;
        for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, h = heightAt(x + Math.cos(a) * 20, z + Math.sin(a) * 20); lo = Math.min(lo, h); hi = Math.max(hi, h); }
        // And level with the land round it, not just flat underfoot: the pad's blend reaches about
        // 30 m out, and ground falling steeply past that leaves the station on a mound. Close to
        // its town counts too, so each stays where its name says.
        const h0 = heightAt(x, z);
        let wide = 0;
        // Land falling away (a mound) counts more than land rising (a cutting into a slope, as
        // real roadside stations often are).
        for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, d = heightAt(x + Math.cos(a) * 42, z + Math.sin(a) * 42) - h0; wide += d < 0 ? -d : d * 0.4; }
        const curve = Math.abs(Math.atan2(n.x - q.x, n.z - q.z) - Math.atan2(q.x - o.x, q.z - o.z)) % (Math.PI * 2);
        const score = (hi - lo) + (wide / 16) * 1.2 + dc * 0.015 + Math.min(curve, Math.PI * 2 - curve) * 20;
        if (!best || score < best.score) best = { score, x, z, heading: Math.atan2(fx, fz), side, ax, az, fx: fx / L, fz: fz / L };
      }
    }
    if (!best) return null;
    // The pad reaches back to cover the shop and forward to meet the road.
    const pad = { x: best.x + best.ax * 1, z: best.z + best.az * 1, r: 28 };
    return { name: st.name, ...best, pad };
  }).filter(Boolean);
}

// A point on a station's forecourt, in world space.
export function stationPoint(s, u, w) { return { x: s.x + s.ax * u + s.fx * w, z: s.z + s.az * u + s.fz * w }; }

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#16594f'; g.fillRect(0, 0, 256, 384);
  g.fillStyle = '#f4f2ec'; g.fillRect(14, 14, 228, 356);
  g.fillStyle = '#16594f'; g.fillRect(24, 24, 208, 200);
  // A pump, drawn plainly.
  g.fillStyle = '#f4f2ec';
  g.fillRect(84, 62, 62, 128); g.fillRect(74, 182, 82, 14);
  g.fillStyle = '#16594f'; g.fillRect(94, 76, 42, 30);
  g.strokeStyle = '#f4f2ec'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(146, 92); g.lineTo(170, 104); g.lineTo(170, 162); g.quadraticCurveTo(170, 176, 182, 172); g.lineTo(182, 112); g.stroke();
  g.fillStyle = '#16594f'; g.font = '700 38px "Saira", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ELDSNEYTI', 128, 268);
  g.fillStyle = '#5b625f'; g.font = '700 30px "Saira", system-ui, sans-serif';
  g.fillText('OPIÐ 24/7', 128, 326);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// The wash's sign: BÍLAÞVOTTUR (car wash) in white on teal.
function washSignTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#16594f'; g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#f4f2ec'; g.font = '700 40px "Saira", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('BÍLAÞVOTTUR', 256, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// A canvas texture, drawn by fn(g, w, h).
function canvasTex(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const FONT = (wt, px) => `${wt} ${px}px "Saira", system-ui, sans-serif`;
// The pump's screen: what you pay, litres and the price a litre, in green figures on black.
function screenTexture() {
  return canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#0b0f0e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2b3331'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const row = (y, label, val, px) => { g.fillStyle = '#7fe8b8'; g.font = FONT(600, px); g.fillText(val, w - 22, y); g.fillStyle = '#6c7a75'; g.font = FONT(700, 16); g.textAlign = 'left'; g.fillText(label, 20, y); g.textAlign = 'right'; };
    row(46, 'KR', '0,00', 46); row(104, 'LÍTRAR', '0,00', 38); row(156, 'KR/L', '314,9', 30);
  });
}
// The fascia along the canopy: ELDSNEYTI in white on teal, with the pump mark.
function fasciaTexture() {
  return canvasTex(1024, 64, (g, w, h) => {
    g.fillStyle = '#16594f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9f4f0'; g.fillRect(0, h - 7, w, 3);
    g.fillStyle = '#f4f2ec'; g.font = FONT(700, 40); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ELDSNEYTI', w / 2, 30);
    g.fillStyle = '#7fe8b8'; for (const x of [w * 0.22, w * 0.78]) { g.beginPath(); g.arc(x, 30, 9, 0, Math.PI * 2); g.fill(); }
  });
}
// The tall price sign by the road: the name and pump, then today's prices for each fuel.
function pylonTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#16594f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f2ec'; g.fillRect(12, 12, w - 24, 206);
    g.fillStyle = '#16594f'; g.fillRect(84, 34, 62, 120); g.fillRect(74, 148, 82, 14);
    g.fillStyle = '#f4f2ec'; g.fillRect(94, 48, 42, 28);
    g.strokeStyle = '#16594f'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(146, 62); g.lineTo(170, 74); g.lineTo(170, 128); g.quadraticCurveTo(170, 140, 182, 136); g.lineTo(182, 82); g.stroke();
    g.fillStyle = '#16594f'; g.font = FONT(700, 34); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ELDSNEYTI', w / 2, 192);
    const price = (y, name, col, val) => {
      g.fillStyle = '#0d1412'; g.fillRect(12, y, w - 24, 84);
      g.fillStyle = col; g.fillRect(12, y, 12, 84);
      g.fillStyle = '#c9d4d0'; g.font = FONT(700, 22); g.textAlign = 'left'; g.fillText(name, 36, y + 24);
      g.fillStyle = '#ffd36b'; g.font = FONT(600, 46); g.textAlign = 'right'; g.fillText(val, w - 24, y + 56);
    };
    price(232, '95 OKTAN', '#3fbf7f', '314,9'); price(326, 'DÍSIL', '#2b2b2b', '309,9');
    g.fillStyle = '#f4f2ec'; g.font = FONT(700, 26); g.textAlign = 'center'; g.fillText('OPIÐ 24/7', w / 2, 452);
    g.fillStyle = '#7fe8b8'; g.font = FONT(600, 18); g.fillText('VERSLUN · KAFFI', w / 2, 486);
  });
}
// The shop's name over the glass, and posters in the window (a hot dog and a cola: the Icelandic
// roadside lunch).
function shopSignTexture() {
  return canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16594f'; g.font = FONT(700, 36); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('VERSLUN  ·  KAFFI  ·  PYLSUR', w / 2, 34);
  });
}
function posterTexture() {
  return canvasTex(128, 192, (g, w, h) => {
    g.fillStyle = '#d8322a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd36b'; g.beginPath(); g.ellipse(64, 74, 46, 16, -0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9c4a26'; g.beginPath(); g.ellipse(64, 70, 50, 9, -0.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffe9a6'; g.lineWidth = 3; g.beginPath(); g.moveTo(22, 76); for (let x = 22; x < 106; x += 8) g.lineTo(x + 4, 66 + ((x / 8) % 2) * 6); g.stroke();
    g.fillStyle = '#fff'; g.font = FONT(800, 26); g.textAlign = 'center'; g.fillText('PYLSA', 64, 128);
    g.font = FONT(700, 22); g.fillText('& GOS', 64, 152); g.fillStyle = '#ffd36b'; g.font = FONT(800, 24); g.fillText('990 kr', 64, 180);
  });
}
// The Icelandic flag: a red cross edged in white on blue.
function flagTexture() {
  return canvasTex(180, 130, (g, w, h) => {
    g.fillStyle = '#02529c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.fillRect(50, 0, 30, h); g.fillRect(0, 50, w, 30);
    g.fillStyle = '#dc1e35'; g.fillRect(57, 0, 16, h); g.fillRect(0, 57, w, 16);
  });
}
// An arrow painted on the forecourt, pointing along the lane.
function arrowTexture() {
  return canvasTex(64, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(240,240,232,0.92)';
    g.fillRect(24, 70, 16, 116); g.beginPath(); g.moveTo(32, 6); g.lineTo(60, 80); g.lineTo(4, 80); g.closePath(); g.fill();
  });
}
function stainTexture() {
  return canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    r.addColorStop(0, 'rgba(10,10,10,0.55)'); r.addColorStop(0.6, 'rgba(10,10,10,0.25)'); r.addColorStop(1, 'rgba(10,10,10,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
}

// The nozzle, built once (metres; the spout points along +z, the grip rises behind it along +y):
// a black grip with a green collar, a trigger under a guard, and a steel spout. Its frame's origin
// is where a hand holds it.
export function nozzleGeometry() {
  const parts = [];
  const add = (geo, color, x, y, z, rx = 0) => { geo.rotateX(rx); geo.translate(x, y, z); const n = geo.attributes.position.count, c = new Float32Array(n * 3), k = new THREE.Color(color); for (let i = 0; i < n; i++) k.toArray(c, i * 3); geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(geo); };
  add(new THREE.BoxGeometry(0.045, 0.13, 0.055), 0x16191b, 0, -0.01, -0.02, -0.35); // grip
  add(new THREE.BoxGeometry(0.05, 0.05, 0.12), 0x1d2124, 0, 0.055, 0.035); // body
  add(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12), 0x2fbf7a, 0, 0.055, -0.03, Math.PI / 2); // collar
  add(new THREE.BoxGeometry(0.012, 0.06, 0.012), 0x9aa0a4, 0, 0.0, 0.04, 0.3); // trigger
  add(new THREE.BoxGeometry(0.03, 0.008, 0.11), 0x16191b, 0, -0.045, 0.03); // guard
  const spout = new THREE.CylinderGeometry(0.011, 0.013, 0.2, 10); spout.rotateX(Math.PI / 2 + 0.35);
  add(spout, 0xb9bdc0, 0, 0.025, 0.17);
  return mergeGeometries(parts, false);
}
// Where the hose joins the nozzle and where the spout's tip is, in the nozzle's frame.
export const NOZZLE_TAIL = new THREE.Vector3(0, 0.055, -0.05), NOZZLE_TIP = new THREE.Vector3(0, -0.01, 0.26);

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,215,1)'); grad.addColorStop(0.55, 'rgba(255,236,205,0.45)'); grad.addColorStop(1, 'rgba(255,236,205,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// A material for a picture that glows a little at night (and a touch by day, the screens).
function lit(t, base, double = false) {
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: base, roughness: 0.5, side: double ? THREE.DoubleSide : THREE.FrontSide });
  m.userData.base = base;
  return m;
}

export class Stations {
  constructor(scene, sites, { obstacles = null, low = false } = {}) {
    this.list = sites;
    const parts = { white: [], teal: [], concrete: [], asphalt: [], dark: [], steel: [], glass: [], panel: [], sign: [], pool: [], washSign: [],
      yellow: [], screen: [], fascia: [], pylon: [], shopSign: [], poster: [], flag: [], paint: [], arrow: [], stain: [], wood: [], strip: [], lamp: [] };
    // Each pump face (two to an island, one toward each lane): its nozzle sits in its holster and its
    // hose hangs in a loop beneath, both drawn as instances so one can be lifted out (refuel.js).
    this.faces = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12); cyl.translate(0, 0.5, 0);
    const plane = new THREE.PlaneGeometry(1, 1);
    const rock = new THREE.SphereGeometry(0.5, 7, 5);
    { const P = rock.attributes.position; for (let i = 0; i < P.count; i++) { const k = 1 + 0.18 * Math.sin(P.getX(i) * 13 + P.getZ(i) * 7) * Math.cos(P.getY(i) * 11); P.setXYZ(i, P.getX(i) * k, P.getY(i) * k, P.getZ(i) * k); } rock.computeVertexNormals(); }
    const down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    // Small detail on every station, in the shared building materials (archkit.js).
    const AM = archMats(), AB = new Batch();
    const back = new THREE.Quaternion().setFromAxisAngle(up, Math.PI);
    for (const s of sites) {
      const y0 = heightAt(s.x, s.z);
      s.y = y0;
      q.setFromAxisAngle(up, s.heading); // local x runs across the road, local z along it
      // A part centred at (u, w) on the forecourt, its foot y above the ground; sizes du, dh, dw.
      // Every part is symmetric about its centre, so the side of the road it is on never matters.
      const put = (list, geo, u, w, y, du, dh, dw, turn = null) => {
        const p = stationPoint(s, u, w), g = geo.clone();
        g.applyMatrix4(m4.compose(v.set(p.x, y0 + y, p.z), turn ? q.clone().multiply(turn) : q, sc.set(du, dh, dw)));
        list.push(g);
      };
      const box = (list, u, w, y, du, dh, dw) => put(list, unit, u, w, y, du, dh, dw);
      // Forecourt slab, open to the road along its whole front and running back behind the shop.
      // Deep, so its edge never shows a gap where the levelled ground eases back to the land.
      box(parts.asphalt, 0.75, 0, -1.45, 35.3, 1.47, 33);
      // Roof: deck, fascia with a teal band, and a lit panel underneath.
      const R = ROOF;
      box(parts.white, R.u, R.w, 4.75, R.du, 0.85, R.dw);
      box(parts.teal, R.u, R.w, 5.05, R.du + 0.08, 0.32, R.dw + 0.08);
      put(parts.panel, plane, R.u, R.w, 4.74, R.du - 0.8, R.dw - 0.8, 1, down);
      // Pump islands: a raised kerb with painted ends, crash posts, two columns holding the roof,
      // and a double-sided pump in the middle (plinth, body, a lit crown, a screen, a card reader,
      // grade buttons and a holster on each face), a bin and a windscreen bucket at one end.
      const turnY = (a) => new THREE.Quaternion().setFromAxisAngle(up, a);
      for (const u of ISLANDS) {
        box(parts.concrete, u, 0, 0, 1.2, 0.22, 7.6);
        box(parts.concrete, u, 0, 0.22, 1.24, 0.03, 7.64);
        for (const w of [-3.68, 3.68]) box(parts.yellow, u, w, 0.08, 1.22, 0.15, 0.26);
        for (const w of [-3.55, 3.55]) { put(parts.yellow, cyl, u, w, 0.22, 0.2, 1.05, 0.2); for (const y of [0.42, 0.72]) put(parts.dark, cyl, u, w, 0.22 + y, 0.205, 0.12, 0.205); }
        for (const w of [-3.1, 3.1]) { put(parts.steel, cyl, u, w, 0.2, 0.34, 4.6, 0.34); box(parts.steel, u, w, 0.22, 0.5, 0.05, 0.5); }
        box(parts.dark, u, 0, 0.22, 0.78, 0.14, 1.24); // plinth
        box(parts.white, u, 0, 0.36, 0.56, 1.46, 0.98); // body
        for (const w of [-0.5, 0.5]) box(parts.teal, u, w, 0.36, 0.6, 1.46, 0.05);
        box(parts.teal, u, 0, 1.82, 0.7, 0.36, 1.12); // crown
        box(parts.strip, u, 0, 1.8, 0.72, 0.04, 1.14);
        for (const side of [-1, 1]) {
          const turn = turnY(side * s.side > 0 ? Math.PI / 2 : -Math.PI / 2); // facing this face's lane
          put(parts.fascia, plane, u + side * 0.356, 0, 1.9, 1.08, 0.2, 1, turn);
          put(parts.screen, plane, u + side * 0.283, -0.16, 1.34, 0.44, 0.33, 1, turn);
          box(parts.dark, u + side * 0.29, -0.16, 1.16, 0.03, 0.38, 0.5); // the screen's bezel
          box(parts.dark, u + side * 0.3, 0.24, 1.08, 0.05, 0.3, 0.2); // card reader
          box(parts.steel, u + side * 0.326, 0.24, 1.12, 0.006, 0.12, 0.12); // its keys
          for (const [k, col] of [[-0.3, 'yellow'], [-0.16, 'teal'], [-0.02, 'dark']]) box(parts[col], u + side * 0.29, k, 0.98, 0.03, 0.07, 0.09); // grades
          box(parts.dark, u + side * 0.29, 0.3, 0.84, 0.04, 0.26, 0.15); // holster
          const n = { x: s.ax * side, z: s.az * side };
          this.faces.push({ s, u, side, n, w: 0.3 });
        }
        // A bin and a windscreen bucket on its stand, at the island's far end.
        put(parts.dark, cyl, u, 2.2, 0.22, 0.42, 0.8, 0.42);
        put(parts.steel, cyl, u, 1.55, 0.22, 0.05, 0.75, 0.05);
        put(parts.teal, cyl, u, 1.55, 0.97, 0.3, 0.26, 0.3);
      }
      // The canopy's light strip all round, and its name along both faces.
      box(parts.strip, R.u, R.w, 4.72, R.du + 0.12, 0.05, R.dw + 0.12);
      for (const side of [-1, 1]) put(parts.fascia, plane, R.u + side * (R.du / 2 + 0.05), R.w, 5.15, 7.5, 0.47, 1, turnY(side * s.side > 0 ? Math.PI / 2 : -Math.PI / 2));
      for (const end of [-1, 1]) put(parts.fascia, plane, R.u, R.w + end * (R.dw / 2 + 0.05), 5.15, 5.6, 0.36, 1, end > 0 ? null : back);
      // Lane markings: a broken line down each lane's edge, an arrow in each lane, stop lines, the
      // drain across the forecourt, and a few oil stains by the pumps.
      const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      for (const u of [ISLANDS[0] - 3.35, ISLANDS[1] + 3.35]) for (let w = -8; w <= 8; w += 2) box(parts.paint, u, w, 0.006, 0.14, 0.012, 1.1);
      for (const u of [ISLANDS[0] - 2, (ISLANDS[0] + ISLANDS[1]) / 2, ISLANDS[1] + 2]) {
        put(parts.arrow, plane, u, -6.3, 0.012, 0.7, 2.1, 1, flat);
        box(parts.paint, u, 5.2, 0.006, 1.8, 0.012, 0.3);
      }
      box(parts.dark, R.u, -7.8, 0.004, R.du, 0.01, 0.32);
      for (const [u, w, r] of [[ISLANDS[0] - 2.4, -0.6, 1.4], [ISLANDS[0] + 1.8, 1.4, 1.0], [ISLANDS[1] + 2.2, -1.2, 1.6], [ISLANDS[1] - 1.9, 0.8, 0.9]]) put(parts.stain, plane, u, w, 0.01, r, r * 1.3, 1, flat);
      // Parking bays and two electric car chargers beside the shop.
      for (const w of [-9.6, -12.4, -15.2]) box(parts.paint, 5, w, 0.006, 5, 0.012, 0.12);
      for (const w of [-11, -13.8]) {
        box(parts.white, 7.9, w, 0, 0.32, 1.55, 0.22);
        box(parts.strip, 7.9 - 0.165, w, 1.15, 0.01, 0.22, 0.14);
        box(parts.dark, 7.9 - 0.17, w, 0.95, 0.02, 0.1, 0.12);
      }
      // The shop: its name over the glass, posters in the window, a little porch over the door,
      // an ice chest, a cage of gas bottles, a bench, and the flags.
      const toPumps = turnY(s.side > 0 ? -Math.PI / 2 : Math.PI / 2);
      put(parts.shopSign, plane, 8.33, -1, 3.25, 8.6, 0.5, 1, toPumps);
      for (const w of [-4.6, -3.7, 1.8]) put(parts.poster, plane, 8.41, w, 1.0, 0.6, 0.9, 1, toPumps);
      box(parts.teal, 7.6, 4.6, 2.6, 1.7, 0.14, 2.4);
      for (const w of [3.55, 5.65]) put(parts.steel, cyl, 6.85, w, 0, 0.08, 2.6, 0.08);
      box(parts.white, 7.6, 7.3, 0, 0.85, 0.9, 1.5); box(parts.teal, 7.6, 7.3, 0.9, 0.9, 0.08, 1.55);
      box(parts.steel, 7.7, -6.4, 0, 0.9, 1.3, 1.6);
      for (const [dw, dh] of [[-0.45, 0], [0, 0], [0.45, 0]]) put(parts.teal, cyl, 7.7, -6.4 + dw, 0.02, 0.3, 1.1, 0.3);
      box(parts.wood, 7.2, 9.6, 0.42, 0.45, 0.06, 1.8); box(parts.wood, 7.42, 9.6, 0.5, 0.06, 0.45, 1.8);
      for (const w of [8.85, 10.35]) box(parts.dark, 7.2, w, 0, 0.4, 0.42, 0.06);
      for (const w of [-15.5, -17]) {
        put(parts.steel, cyl, 10.5, w, 0, 0.09, 8, 0.09);
        put(parts.flag, plane, 10.5, w + 0.75, 7.25, 1.4, 1.0, 1, turnY(s.side > 0 ? -Math.PI / 2 : Math.PI / 2));
        put(parts.flag, plane, 10.5, w + 0.75, 7.25, 1.4, 1.0, 1, turnY(s.side > 0 ? Math.PI / 2 : -Math.PI / 2));
      }
      // Two tall lamps on the forecourt's road edge.
      for (const w of [-15, 15]) {
        put(parts.steel, cyl, -14.5, w, 0, 0.16, 7.2, 0.16);
        box(parts.steel, -14.5 + 0.6, w, 7.1, 1.4, 0.12, 0.18);
        box(parts.lamp, -14.5 + 1.15, w, 6.98, 0.5, 0.06, 0.3);
      }
      // A ring of boulders along the pad's back corners, as Icelandic forecourts edge their verges.
      for (const [u, w, r] of [[16.5, -12, 0.9], [17.2, -9.5, 0.6], [16.8, 9, 0.8], [17.5, 11.5, 1.1], [3, -17.2, 0.7], [-2.5, -17.6, 0.55]]) put(parts.concrete, rock, u, w, r * 0.2, r, r * 0.75, r * 1.1);
      // Shop: walls, a glass front towards the pumps, a roof edge, a door and a band of colour.
      box(parts.white, 12.5, 0, 0, 8, 3.7, 14);
      box(parts.dark, 12.5, 0, 3.7, 8.6, 0.28, 14.6);
      box(parts.glass, 8.47, -1, 0.35, 0.08, 2.5, 9);
      box(parts.dark, 8.45, 4.6, 0, 0.1, 2.3, 1.6);
      box(parts.teal, 8.4, 0, 2.95, 0.12, 0.6, 12);
      // The price pylon at the roadside, lit, facing traffic both ways: the name and pump over
      // today's prices, on a two-legged frame.
      for (const dw of [-0.9, 0.9]) box(parts.steel, -12.5 + dw, -14, 0, 0.22, 2.2, 0.3);
      box(parts.dark, -12.5, -14, 0, 2.6, 0.5, 0.6);
      box(parts.teal, -12.5, -14, 2.0, 2.7, 5.5, 0.4);
      box(parts.strip, -12.5, -14, 7.5, 2.74, 0.06, 0.44);
      put(parts.pylon, plane, -12.5, -14 + 0.21, 4.75, 2.45, 4.9, 1);
      put(parts.pylon, plane, -12.5, -14 - 0.21, 4.75, 2.45, 4.9, 1, back);
      // Car wash gantry: four posts, beams across the top with a sign, a water bar, and the
      // brushes (built below, as they turn).
      for (const du of [-WASH.gap, WASH.gap]) for (const dw of [-WASH.len / 2 + 0.2, WASH.len / 2 - 0.2]) box(parts.steel, WASH.u + du, WASH.w + dw, 0, 0.24, 3.4, 0.24);
      for (const dw of [-WASH.len / 2 + 0.2, WASH.len / 2 - 0.2]) box(parts.teal, WASH.u, WASH.w + dw, 3.25, WASH.gap * 2 + 0.3, 0.4, 0.3);
      for (const du of [-WASH.gap, WASH.gap]) box(parts.steel, WASH.u + du, WASH.w, 3.3, 0.18, 0.18, WASH.len);
      box(parts.white, WASH.u, WASH.w, 3.62, WASH.gap * 2 + 0.3, 0.12, WASH.len);
      put(parts.washSign, plane, WASH.u, WASH.w - WASH.len / 2 + 0.03, 3.45, 3.2, 0.4, 1, back);
      put(parts.washSign, plane, WASH.u, WASH.w + WASH.len / 2 - 0.03, 3.45, 3.2, 0.4, 1);
      box(parts.dark, WASH.u, WASH.w + 1.2, 2.75, WASH.gap * 2 - 0.4, 0.08, 0.08); // the spray bar
      // Detail: shop-front mullions and a door frame, a metal coping and units on the shop roof,
      // bollards along the glass, bins by the door, an air and water post, downlights in the canopy.
      {
        const F = aframe(null, s.x, y0, s.z, s.heading), L = (u) => u * s.side, ry = s.side > 0 ? -Math.PI / 2 : Math.PI / 2;
        const B = AB, dark = 0x2a2d30, steelC = 0xb9bdc0;
        for (let w = -5.5; w <= 3.51; w += 1.5) B.box(AM.paint, F, L(8.4), 1.6, w, 0.1, 2.55, 0.09, dark, { skip: SKIP.ny });
        B.box(AM.paint, F, L(8.4), 2.2, -1, 0.1, 0.07, 9, dark);
        B.box(AM.paint, F, L(8.4), 0.38, -1, 0.12, 0.08, 9, dark);
        for (const w of [3.75, 5.45]) B.box(AM.paint, F, L(8.4), 1.2, w, 0.12, 2.4, 0.1, dark, { skip: SKIP.ny });
        B.box(AM.paint, F, L(8.4), 2.36, 4.6, 0.14, 0.12, 1.8, dark);
        B.box(AM.paint, F, L(8.38), 1.1, 4.6, 0.04, 0.06, 1.5, steelC); // push bar
        B.box(AM.paint, F, L(12.5), 3.99, 0, 8.7, 0.07, 14.7, 0x8d9296);
        B.box(AM.paint, F, L(13.5), 4.35, 3, 1.4, 0.6, 1.0, steelC, { skip: SKIP.ny });
        B.box(AM.paint, F, L(13.5), 4.3, -2.5, 0.9, 0.5, 0.9, 0x9aa0a4, { skip: SKIP.ny });
        for (let w = -5; w <= 3.01; w += 2) B.box(AM.paint, F, L(7.4), 0.45, w, 0.2, 0.9, 0.2, 0xd8b22a, { skip: SKIP.ny });
        for (const w of [6.3, 6.9]) B.box(AM.paint, F, L(7.8), 0.5, w, 0.5, 1.0, 0.5, w > 6.5 ? 0x2f6d4a : 0x3a3d42, { skip: SKIP.ny });
        B.box(AM.paint, F, L(-10), 0.7, 9, 0.35, 1.4, 0.3, 0x16594f, { skip: SKIP.ny });
        B.box(AM.paint, F, L(-10), 1.25, 9.16, 0.25, 0.3, 0.03, 0xe8e6e0);
        for (const u of [-6.5, -2, 2.5]) for (const w of [-6, -2, 2, 6]) B.box(AM.paint, F, L(u), 4.71, w, 0.5, 0.04, 0.5, 0xfff6e6);
        // A kerb round the shop and a strip of planting at its side.
        B.box(AM.concrete, F, L(12.5), 0.06, 0, 8.6, 0.16, 14.6, 0xa9a7a2, { skip: SKIP.ny });
        void ry;
      }
      // Warm light on the ground under the roof at night.
      put(parts.pool, plane, R.u, R.w, 0.08, R.du + 9, R.dw + 9, 1, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      // Solid parts.
      if (obstacles) {
        for (const u of ISLANDS) {
          const p = stationPoint(s, u, 0);
          obstacles.addBox(p.x, p.z, s.heading, 0.65, 3.85, 'wall');
        }
        const shop = stationPoint(s, 12.5, 0); obstacles.addBox(shop.x, shop.z, s.heading, 4.1, 7.1, 'wall');
        const post = stationPoint(s, -12.5, -14); obstacles.addCircle(post.x, post.z, 0.5, 'wall');
        for (const du of [-WASH.gap, WASH.gap]) for (const dw of [-WASH.len / 2 + 0.2, WASH.len / 2 - 0.2]) { const p = stationPoint(s, WASH.u + du, WASH.w + dw); obstacles.addCircle(p.x, p.z, 0.2, 'wall'); }
      }
    }
    const mats = {
      white: new THREE.MeshStandardMaterial({ color: 0xeceee9, roughness: 0.9, envMapIntensity: 0.5 }),
      teal: new THREE.MeshStandardMaterial({ color: 0x16594f, roughness: 0.75, envMapIntensity: 0.6 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x9a9b97, roughness: 0.95 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x34373a, roughness: 0.95 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.45, metalness: 0.3 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xc9ccce, roughness: 0.35, metalness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x12181d, roughness: 0.1, metalness: 0.4, emissive: 0xffd9a0, emissiveIntensity: 0 }),
      panel: new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6, emissive: 0xfff3df, emissiveIntensity: 0, side: THREE.DoubleSide }),
      sign: (() => { const t = signTexture(); return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 }); })(),
      washSign: (() => { const t = washSignTexture(); return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 }); })(),
      pool: new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xffe9c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe0b324, roughness: 0.6 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.85 }),
      // Lit at night: the canopy's strip, the lamps' heads, the chargers' rings.
      strip: new THREE.MeshStandardMaterial({ color: 0xf2f6f4, roughness: 0.4, emissive: 0xe8fff6, emissiveIntensity: 0.05 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0xfff6e6, roughness: 0.3, emissive: 0xfff0d6, emissiveIntensity: 0.05 }),
      screen: lit(screenTexture(), 0.55), fascia: lit(fasciaTexture(), 0.1), pylon: lit(pylonTexture(), 0.08), shopSign: lit(shopSignTexture(), 0.06), poster: lit(posterTexture(), 0.1), flag: lit(flagTexture(), 0, true),
      paint: new THREE.MeshStandardMaterial({ color: 0xe9e8e0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
      arrow: new THREE.MeshStandardMaterial({ map: arrowTexture(), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
      stain: new THREE.MeshBasicMaterial({ map: stainTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    };
    this.mats = mats;
    for (const [k, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mats[k]);
      mesh.castShadow = !['pool', 'panel', 'asphalt', 'sign', 'paint', 'arrow', 'stain', 'screen', 'fascia', 'poster', 'shopSign'].includes(k);
      mesh.receiveShadow = !['pool', 'stain', 'arrow'].includes(k);
      if (k === 'pool' || k === 'stain' || k === 'arrow') mesh.renderOrder = 2;
      scene.add(mesh);
    }
    AB.flush(scene);
    this.buildNozzles(scene);
    // The brushes: strips on spinning shafts (washbrush.js), one set moved to the wash in sight.
    this.brushes = new WashBrushes(scene, { low });
    this.washMat = mats.washSign;
  }

  // Each pump face's nozzle in its holster and its hose hanging in a loop beneath, as instances.
  // A face's frame: n out toward its lane, y up, k = n x y along the pump. The hose leaves the
  // pump just above the holster and hangs straight down in the n-y plane, so every face's is the
  // same shape.
  buildNozzles(scene) {
    const N = this.faces.length;
    if (!N) return;
    const up = new THREE.Vector3(0, 1, 0);
    this.nozzleGeo = nozzleGeometry();
    this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.55, metalness: 0.1 });
    this.nozzleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 });
    // The holstered nozzle in the face frame: spout down into the holster, grip out and up.
    const zN = new THREE.Vector3(-0.3, -0.95, 0).normalize(), yN = new THREE.Vector3(0.95, -0.3, 0).normalize(), xN = new THREE.Vector3().crossVectors(yN, zN);
    const rest = new THREE.Matrix4().makeBasis(xN, yN, zN).setPosition(0.07, 0.98, 0);
    const tail = NOZZLE_TAIL.clone().applyMatrix4(rest);
    this.restNozzle = rest;
    this.hoseRoot = new THREE.Vector3(0.01, 1.42, 0);
    const curve = new THREE.CatmullRomCurve3([this.hoseRoot.clone(), new THREE.Vector3(0.08, 1.12, 0), new THREE.Vector3(0.24, 0.6, 0), new THREE.Vector3(0.3, 0.42, 0), new THREE.Vector3(0.28, 0.62, 0), tail]);
    const hoseGeo = new THREE.TubeGeometry(curve, 28, 0.016, 6, false);
    this.nozzles = new THREE.InstancedMesh(this.nozzleGeo, this.nozzleMat, N);
    this.hoses = new THREE.InstancedMesh(hoseGeo, this.hoseMat, N);
    for (const m of [this.nozzles, this.hoses]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
    const F = new THREE.Matrix4(), M = new THREE.Matrix4();
    this.faces.forEach((f, i) => {
      const n = new THREE.Vector3(f.n.x, 0, f.n.z), k = new THREE.Vector3().crossVectors(n, up);
      const o = stationPoint(f.s, f.u + f.side * 0.31, f.w);
      F.makeBasis(n, up, k).setPosition(o.x, f.s.y, o.z);
      f.i = i; f.frame = F.clone();
      f.root = this.hoseRoot.clone().applyMatrix4(F);
      f.nozzle = M.multiplyMatrices(F, rest).clone();
      const st = stationPoint(f.s, f.u + f.side * 1.15, f.w);
      f.stand = { x: st.x, z: st.z, heading: Math.atan2(-n.x, -n.z) };
      this.hoses.setMatrixAt(i, F); this.nozzles.setMatrixAt(i, f.nozzle);
    });
    this.hoses.instanceMatrix.needsUpdate = this.nozzles.instanceMatrix.needsUpdate = true;
  }
  // Lift a face's nozzle and hose out of the scene (in use), or put them back.
  holster(face, on) {
    const Z = new THREE.Matrix4().makeScale(0, 0, 0);
    this.hoses.setMatrixAt(face.i, on ? face.frame : Z); this.nozzles.setMatrixAt(face.i, on ? face.nozzle : Z);
    this.hoses.instanceMatrix.needsUpdate = this.nozzles.instanceMatrix.needsUpdate = true;
  }
  // Whether a person of radius r standing at (x, z) on station s would be inside something solid on
  // its forecourt: a pump, a canopy column, a crash post, the bin or the bucket. (The islands' kerbs
  // are only a step up, so they are not solid to a person.)
  solidAt(s, x, z, r = 0.25) {
    const dx = x - s.x, dz = z - s.z, u = dx * s.ax + dz * s.az, w = dx * s.fx + dz * s.fz;
    for (const I of ISLANDS) {
      if (Math.abs(u - I) > 1.5) continue;
      if (Math.abs(u - I) < 0.39 + r && Math.abs(w) < 0.62 + r) return true; // the pump on its plinth
      for (const [cw, cr] of [[3.1, 0.17], [-3.1, 0.17], [3.55, 0.1], [-3.55, 0.1], [2.2, 0.21], [1.55, 0.15]]) if (Math.hypot(u - I, w - cw) < cr + r) return true;
    }
    return false;
  }
  // A point on a station given in its own terms (u across, w along), in world space.
  point(s, u, w) { return stationPoint(s, u, w); }

  // The pump face nearest a point on a station's forecourt (the side of the island it is on).
  faceNear(s, x, z) {
    let best = null, bd = Infinity;
    for (const f of this.faces) {
      if (f.s !== s) continue;
      const p = stationPoint(s, f.u + f.side * 0.31, f.w), d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = f; }
    }
    return best && { face: best, dist: bd };
  }

  // The wash a car at (x, z) is rolling through, if any: { s, along (0 at the entry to 1 at the
  // exit) }. Brushes spin up while one is there and wind down after.
  washAt(x, z) {
    for (const s of this.list) {
      const dx = x - s.x, dz = z - s.z, u = dx * s.ax + dz * s.az, w = dx * s.fx + dz * s.fz;
      if (Math.abs(u - WASH.u) < WASH.gap - 0.6 && Math.abs(w - WASH.w) < WASH.len / 2 + 0.6) return { s, along: (w - WASH.w) / (WASH.len + 1.2) + 0.5 };
    }
    return null;
  }
  // Where water sprays from in a wash: the bar and the brushes, in world space.
  washPoints(s) { return [-1.6, -0.6, 0.6, 1.6].map((du) => ({ ...stationPoint(s, WASH.u + du, WASH.w + 1.2), y: s.y + 2.7 })); }
  // Each frame: brushes at the wash nearest the eye (within sight), spinning while the car is in
  // it and folding against the car's body. emit(x, y, z, vx, vy, vz): water flung off them.
  updateWash(dt, active, { t, eye, body, emit }) {
    let near = null, bd = 110;
    for (const s of this.list) { const p = stationPoint(s, WASH.u, WASH.w), d = Math.hypot(p.x - eye.x, p.z - eye.z); if (d < bd) { bd = d; near = s; } }
    const at = near && { ...stationPoint(near, WASH.u, WASH.w), y: near.y, heading: near.heading, s: near };
    if (at && this.brushAt?.s === near) Object.assign(this.brushAt, at); else this.brushAt = at;
    this.brushes.update(dt, t, this.brushAt, active, body, emit);
  }

  // The station nearest a point, with its straight-line distance.
  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const s of this.list) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
    return best && { station: best, dist: bd };
  }

  // The station whose roof a car at (x, z) is parked under, if any.
  at(x, z) {
    for (const s of this.list) {
      const dx = x - s.x, dz = z - s.z;
      const u = dx * s.ax + dz * s.az, w = dx * s.fx + dz * s.fz;
      if (u > ROOF.u - ROOF.du / 2 - 3 && u < ROOF.u + ROOF.du / 2 + 2 && Math.abs(w - ROOF.w) < ROOF.dw / 2 + 2.5) return s;
    }
    return null;
  }

  // Where a towed car is left: in the lane by the first pump, facing along the road.
  bay(s) { const p = stationPoint(s, ISLANDS[0] - 2.6, -2.5); return { x: p.x, z: p.z, heading: s.heading }; }

  setNight(dark) {
    const m = this.mats;
    m.panel.emissiveIntensity = dark * 1.5;
    m.glass.emissiveIntensity = dark * 1.1;
    m.sign.emissiveIntensity = 0.05 + dark * 0.75;
    m.pool.opacity = dark * 0.55;
    m.washSign.emissiveIntensity = 0.05 + dark * 0.7;
    m.strip.emissiveIntensity = 0.05 + dark * 1.6;
    m.lamp.emissiveIntensity = 0.05 + dark * 2.2;
    for (const k of ['screen', 'fascia', 'pylon', 'shopSign', 'poster']) m[k].emissiveIntensity = m[k].userData.base + dark * (k === 'screen' ? 0.5 : 0.75);
  }
}
