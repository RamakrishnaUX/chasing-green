import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toWorld } from './geo.js';
import { roadPaths, heightAt, waterLevelAt, coastAt, roadDistAt } from './terrain.js';

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
      if (dc < 60 || dc > 340) continue;
      const n = P[(i + 2) % N], o = P[(i - 2 + N) % N];
      const fx = n.x - o.x, fz = n.z - o.z, L = Math.hypot(fx, fz) || 1;
      for (const side of [-1, 1]) {
        const ax = (fz / L) * side, az = (-fx / L) * side;
        const x = q.x + ax * OFF, z = q.z + az * OFF;
        if (coastAt(x, z) < 45 || heightAt(x, z) < waterLevelAt(x, z) + 1.5) continue;
        if (landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < 75)) continue;
        // Only its own road nearby: the far side and both ends of the forecourt stay clear.
        if (roadDistAt(x + ax * 16, z + az * 16) < 26 || roadDistAt(x + (fx / L) * 22, z + (fz / L) * 22) < OFF - 4 || roadDistAt(x - (fx / L) * 22, z - (fz / L) * 22) < OFF - 4) continue;
        let lo = Infinity, hi = -Infinity;
        for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, h = heightAt(x + Math.cos(a) * 20, z + Math.sin(a) * 20); lo = Math.min(lo, h); hi = Math.max(hi, h); }
        const curve = Math.abs(Math.atan2(n.x - q.x, n.z - q.z) - Math.atan2(q.x - o.x, q.z - o.z)) % (Math.PI * 2);
        const score = (hi - lo) + dc * 0.006 + Math.min(curve, Math.PI * 2 - curve) * 20;
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

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,215,1)'); grad.addColorStop(0.55, 'rgba(255,236,205,0.45)'); grad.addColorStop(1, 'rgba(255,236,205,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class Stations {
  constructor(scene, sites, { obstacles = null } = {}) {
    this.list = sites;
    const parts = { white: [], teal: [], concrete: [], asphalt: [], dark: [], steel: [], glass: [], panel: [], sign: [], pool: [] };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12); cyl.translate(0, 0.5, 0);
    const plane = new THREE.PlaneGeometry(1, 1);
    const down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
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
      // Pump islands: a kerb, two columns holding the roof, and a pump in the middle.
      for (const u of ISLANDS) {
        box(parts.concrete, u, 0, 0, 1.2, 0.22, 7.6);
        for (const w of [-3.1, 3.1]) put(parts.steel, cyl, u, w, 0.2, 0.34, 4.6, 0.34);
        box(parts.white, u, 0, 0.22, 0.62, 1.75, 1.05);
        box(parts.teal, u, 0, 1.97, 0.66, 0.24, 1.09);
        box(parts.dark, u, 0, 1.25, 0.65, 0.42, 0.62); // screens, one each side
        box(parts.dark, u, 0.32, 0.55, 0.72, 0.5, 0.1); // holstered nozzles
      }
      // Shop: walls, a glass front towards the pumps, a roof edge, a door and a band of colour.
      box(parts.white, 12.5, 0, 0, 8, 3.7, 14);
      box(parts.dark, 12.5, 0, 3.7, 8.6, 0.28, 14.6);
      box(parts.glass, 8.47, -1, 0.35, 0.08, 2.5, 9);
      box(parts.dark, 8.45, 4.6, 0, 0.1, 2.3, 1.6);
      box(parts.teal, 8.4, 0, 2.95, 0.12, 0.6, 12);
      // Roadside sign on a post, lit, facing traffic both ways.
      put(parts.steel, cyl, -12.5, -14, 0, 0.36, 4.6, 0.36);
      box(parts.teal, -12.5, -14, 4.4, 2.7, 3.9, 0.4);
      put(parts.sign, plane, -12.5, -14 + 0.21, 6.35, 2.4, 3.5, 1);
      put(parts.sign, plane, -12.5, -14 - 0.21, 6.35, 2.4, 3.5, 1, back);
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
      pool: new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xffe9c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 }),
    };
    this.mats = mats;
    for (const [k, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mats[k]);
      mesh.castShadow = !['pool', 'panel', 'asphalt', 'sign'].includes(k);
      mesh.receiveShadow = k !== 'pool';
      if (k === 'pool') mesh.renderOrder = 2;
      scene.add(mesh);
    }
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
  }
}
