// Cockpits for the inside views. Each car gets a dashboard with two lit dials and a radio,
// a steering wheel that turns with the steering, and, for the closed cars, the cab around you:
// roof, door panels, pillars and a partition behind the seats. The car bodies are one-sided,
// so from inside they would be see-through without this shell.
//
// Positions are in metres in the car's own frame: +z forward, +y up, +x to the driver's side
// (the cars are left-hand drive). Each car also says where the eye sits for the hood and
// cockpit views.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const std = (color, rough = 0.7, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
function M(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; return m; }
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Two round dials (speed and revs) set into a hood, facing the driver. Returns the needles.
function dials(g, { x, y, z, tilt = -0.35, r = 0.065, gap = 0.17, ring, face }) {
  const needles = [];
  const glowA = std(0x0c2a1c, 0.4, 0, { emissive: 0x5cf2a0, emissiveIntensity: 1.3 });
  const glowB = std(0x2a1a08, 0.4, 0, { emissive: 0xffb44a, emissiveIntensity: 1.1 });
  const faceMat = face || std(0x0d0f11, 0.6);
  [[x + gap / 2, glowA], [x - gap / 2, glowB]].forEach(([dx, glow], i) => {
    const d = new THREE.Group(); d.position.set(dx, y, z); d.rotation.set(tilt, Math.PI, 0);
    d.add(M(new THREE.CircleGeometry(r, 32), faceMat));
    const rim = M(new THREE.TorusGeometry(r, r * 0.12, 8, 36), ring || std(0x2a2d31, 0.4, 0.5)); d.add(rim);
    // A lit arc of scale marks around the face.
    const arc = M(new THREE.RingGeometry(r * 0.78, r * 0.86, 32, 1, -0.6, 4.3), glow); arc.position.z = 0.002; arc.rotation.z = -Math.PI / 2 - 0.6; d.add(arc);
    const pivot = new THREE.Group(); pivot.position.z = 0.004; d.add(pivot);
    const n = M(box(r * 0.07, r * 0.8, 0.002), glow); n.position.y = r * 0.36; pivot.add(n);
    needles.push(pivot);
    g.add(d);
  });
  return { speed: needles[0], rev: needles[1] };
}

// A small lit radio display for the car stereo; draw(text) repaints it.
function radio(g, { x, y, z, tilt = -0.3, w = 0.2, h = 0.07 }) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 88;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = std(0x061016, 0.4, 0, { map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.9 });
  const p = M(new THREE.PlaneGeometry(w, h), mat, x, y, z); p.rotation.set(tilt, Math.PI, 0); g.add(p);
  let last = null;
  const draw = (text) => {
    if (text === last) return;
    last = text;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#04121a'; x2.fillRect(0, 0, 256, 88);
    x2.fillStyle = '#5cf2a0'; x2.font = '700 30px system-ui, sans-serif'; x2.textBaseline = 'middle';
    x2.fillText(text, 14, 44, 228);
    tex.needsUpdate = true;
  };
  draw('FM 98.1');
  return draw;
}

// A steering wheel: a tilted mount, and inside it the part that turns.
function wheel(g, { x, y, z, tilt, r = 0.19, rim, spokes = 3, hub }) {
  const mount = new THREE.Group(); mount.position.set(x, y, z); mount.rotation.x = tilt; g.add(mount);
  const turn = new THREE.Group(); mount.add(turn);
  turn.add(M(new THREE.TorusGeometry(r, r * 0.12, 12, 48), rim));
  const angles = spokes === 3 ? [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6] : [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (const a of angles) {
    const arm = new THREE.Group(); arm.rotation.z = a;
    const s = M(box(r * 0.9, r * 0.14, r * 0.1), rim); s.position.x = r * 0.48; arm.add(s);
    turn.add(arm);
  }
  const h = M(new THREE.CylinderGeometry(r * 0.26, r * 0.3, r * 0.25, 24), hub || std(0x1b1d20, 0.5)); h.rotation.x = Math.PI / 2; turn.add(h);
  // The column down into the dash.
  const col = M(new THREE.CylinderGeometry(0.03, 0.035, 0.4, 12), std(0x16181a, 0.6)); col.rotation.x = Math.PI / 2; col.position.z = 0.2; mount.add(col);
  return turn;
}

const dash = (g, mat, w, h, d, x, y, z, tilt = 0) => { const m = M(box(w, h, d), mat, x, y, z); m.rotation.x = tilt; g.add(m); return m; };

function jeep() {
  const g = new THREE.Group();
  const plastic = std(0x15171a, 0.75), trim = std(0x2a2d31, 0.5, 0.3);
  dash(g, plastic, 1.66, 0.22, 0.42, 0, 1.66, 0.42);
  dash(g, trim, 0.5, 0.1, 0.22, 0.4, 1.8, 0.4); // binnacle over the dials
  const needles = dials(g, { x: 0.4, y: 1.79, z: 0.29 });
  const draw = radio(g, { x: -0.05, y: 1.75, z: 0.2 });
  const steer = wheel(g, { x: 0.4, y: 1.83, z: 0.04, tilt: 0.5, rim: std(0x4a4f57, 0.45, 0.4, { emissive: 0x0c1a14, emissiveIntensity: 0.5 }) });
  return { group: g, steer, needles, draw, closed: false,
    views: { cockpit: { eye: [0.4, 2.08, -0.22], fov: 70, pitch: -0.11 }, hood: { eye: [0, 1.94, 0.86], fov: 66, pitch: -0.08 } } };
}

function vintage(model) {
  const g = new THREE.Group();
  const wood = std(0x5a2f15, 0.35, 0.05), cream = std(0xe6d6b4, 0.5);
  // The cowl tops out near 1.06 m, so the wood panel stands on it below the windscreen, with
  // the dials in the middle like a period roadster so the wheel does not hide them.
  dash(g, wood, 1.0, 0.2, 0.06, 0, 1.16, 0.27, -0.12);
  const needles = dials(g, { x: 0.02, y: 1.17, z: 0.235, tilt: -0.12, r: 0.055, gap: 0.2, ring: std(0xe8ecef, 0.12, 1), face: cream });
  const draw = radio(g, { x: -0.3, y: 1.16, z: 0.235, tilt: -0.12, w: 0.17, h: 0.06 });
  return { group: g, steer: model.steer, needles, draw, closed: false,
    views: { cockpit: { eye: [0.28, 1.5, -0.45], fov: 70, pitch: -0.18 }, hood: { eye: [0, 1.46, 0.6], fov: 64, pitch: -0.08 } } };
}

function camper() {
  // The van is drawn at 1.4 times its model size, so this cab is in real metres.
  const g = new THREE.Group();
  const plastic = std(0x1a1c1f, 0.8), cloth = std(0x3a3f45, 0.95), panel = std(0x9d988c, 0.75), mint = std(0x3fa577, 0.55);
  // Dashboard across the cab under the windscreen, mint like the lower body.
  dash(g, mint, 2.2, 0.3, 0.35, 0, 1.62, 2.66);
  dash(g, plastic, 2.2, 0.08, 0.4, 0, 1.8, 2.66);
  dash(g, plastic, 0.5, 0.12, 0.2, 0.6, 1.88, 2.5);
  const needles = dials(g, { x: 0.6, y: 1.86, z: 2.39, r: 0.07, gap: 0.19 });
  const draw = radio(g, { x: -0.1, y: 1.72, z: 2.47, tilt: -0.15, w: 0.24, h: 0.08 });
  // A big, nearly flat bus wheel.
  const steer = wheel(g, { x: 0.6, y: 1.9, z: 2.05, tilt: 1.0, r: 0.24, rim: std(0x101113, 0.5) });
  // Cab shell: roof, headliner strip over the windscreen, door panels below the windows,
  // pillars between them and a partition behind the seats.
  dash(g, cloth, 2.4, 0.04, 2.1, 0, 2.74, 1.95);
  dash(g, plastic, 2.3, 0.18, 0.12, 0, 2.62, 2.84);
  for (const sx of [-1, 1]) {
    dash(g, panel, 0.06, 1.0, 2.1, sx * 1.2, 1.35, 1.95);
    dash(g, panel, 0.06, 0.32, 2.1, sx * 1.2, 2.58, 1.95);
    dash(g, plastic, 0.1, 1.0, 0.1, sx * 1.13, 2.25, 2.86); // A pillar
    dash(g, plastic, 0.08, 0.7, 0.12, sx * 1.18, 2.15, 1.8); // B pillar
    // Seats: driver and passenger.
    dash(g, cloth, 0.6, 0.16, 0.6, sx * 0.6, 1.44, 1.45);
    dash(g, cloth, 0.6, 0.75, 0.14, sx * 0.6, 1.88, 1.12);
  }
  dash(g, panel, 2.4, 1.5, 0.06, 0, 1.95, 1.0);
  return { group: g, steer, needles, draw, closed: true,
    views: { cockpit: { eye: [0.6, 2.38, 1.5], fov: 72, pitch: -0.1 }, hood: { eye: [0, 3.02, 2.2], fov: 64, pitch: -0.16 } } };
}

function race() {
  const g = new THREE.Group();
  const carbon = std(0x101113, 0.3, 0.4), alcantara = std(0x1c1d20, 0.95), orange = std(0xff6a00, 0.3, 0.3);
  dash(g, carbon, 1.3, 0.12, 0.42, 0, 0.78, 0.5, 0.15);
  dash(g, carbon, 0.42, 0.08, 0.16, 0.3, 0.86, 0.35);
  const needles = dials(g, { x: 0.3, y: 0.86, z: 0.26, r: 0.05, gap: 0.13 });
  const draw = radio(g, { x: -0.05, y: 0.82, z: 0.32, tilt: -0.3, w: 0.16, h: 0.055 });
  const steer = wheel(g, { x: 0.3, y: 0.8, z: 0.05, tilt: 0.25, r: 0.15, spokes: 3, rim: alcantara, hub: orange });
  // Low roof, door cards and a bulkhead behind the seats.
  dash(g, alcantara, 1.3, 0.03, 0.7, 0, 1.12, -0.3);
  for (const sx of [-1, 1]) {
    dash(g, carbon, 0.05, 0.4, 1.3, sx * 0.72, 0.68, -0.05);
    const pil = dash(g, carbon, 0.06, 0.05, 0.7, sx * 0.62, 0.97, 0.45, 0.62); pil.rotation.z = sx * 0.12; // A pillar along the windscreen
  }
  dash(g, alcantara, 1.4, 0.6, 0.05, 0, 0.88, -0.62);
  return { group: g, steer, needles, draw, closed: true,
    views: { cockpit: { eye: [0.3, 0.99, -0.32], fov: 72, pitch: -0.04 }, hood: { eye: [0, 1.2, 0.82], fov: 66, pitch: -0.06 } } };
}

export function buildInterior(kind, model) {
  const i = kind === 'vintage' ? vintage(model) : kind === 'camper' ? camper() : kind === 'race' ? race() : jeep();
  i.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return i;
}

// Point the needles and set the radio for this frame. kmh: speed; music: the track name or null.
export function updateInterior(i, { kmh, steer, music }) {
  if (!i) return;
  const sweep = 4.2;
  i.needles.speed.rotation.z = 2.1 - Math.min(1, kmh / 200) * sweep;
  const v = kmh / 3.6, rev = v < 0.5 ? 0.12 : 0.18 + ((v * 0.9) % 14) / 14 * 0.6 + Math.min(3, Math.floor(v * 0.9 / 14)) * 0.05;
  i.needles.rev.rotation.z = 2.1 - Math.min(1, rev) * sweep;
  if (i.steer) i.steer.rotation.z = -steer * 2.2;
  i.draw(music ? `♪ ${music}` : 'FM 98.1');
}

export const trackTitle = (n) => CONFIG.music.titles?.[n] ?? null;
