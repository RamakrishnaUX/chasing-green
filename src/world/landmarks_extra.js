import * as THREE from 'three';
import { createWaterMaterial, createRiverMaterial, riverGeometry } from './materials.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildChurch, buildSkaftafell } from './landmarks_more.js';
import { HD } from './hd.js';

// Generic builders, chosen by a landmark's `model` field, with `params` for the details.
const std = (color, rough = 0.85, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
function M(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
function lump(size, rand, flat = 0.7) {
  const g = new THREE.IcosahedronGeometry(size, 1), p = g.attributes.position, k = [rand() * 6, rand() * 6, rand() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.25 * Math.sin(x * 2.3 / size + k[0]) * Math.sin(z * 1.9 / size + k[1]) + 0.15 * Math.sin(y * 3.1 / size + k[2]);
    p.setXYZ(i, x * n, y * n * flat, z * n);
  }
  g.computeVertexNormals();
  return g;
}
const RAINBOW = [0xe40303, 0xff8c00, 0xffed00, 0x008026, 0x24408e, 0x732982];

// Weathered aluminium for the plane wreck. u runs round the fuselage (0 = the side facing the
// road, 0.25 = the top), v runs from the tail cut (0) to the nose (1).
function wreckSkin(rand) {
  const W = 1024, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (u) => u * W, Y = (v) => (1 - v) * H;
  g.fillStyle = '#b3b4af'; g.fillRect(0, 0, W, H);
  // Mottled oxidation.
  for (let i = 0; i < 900; i++) {
    const l = rand() < 0.5 ? 255 : 40;
    g.fillStyle = `rgba(${l},${l},${l - 6},${0.03 + rand() * 0.05})`;
    g.beginPath(); g.ellipse(rand() * W, rand() * H, 6 + rand() * 50, 4 + rand() * 30, rand() * 3, 0, Math.PI * 2); g.fill();
  }
  // Grime running down from the top towards the belly on both sides.
  for (let i = 0; i < 260; i++) {
    const v = rand(), from = 0.25 + (rand() - 0.5) * 0.08, dir = rand() < 0.5 ? -1 : 1, len = 0.05 + rand() * 0.2;
    const x0 = X(from), x1 = X(from + dir * len);
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, 'rgba(60,58,52,0)'); gr.addColorStop(0.3, `rgba(60,58,52,${0.12 + rand() * 0.12})`); gr.addColorStop(1, 'rgba(60,58,52,0)');
    g.fillStyle = gr; g.fillRect(Math.min(x0, x1), Y(v), Math.abs(x1 - x0), 1 + rand() * 2.5);
  }
  // Panel seams: rings along the body and lines along it, some with a coppery tint.
  for (let v = 0.02; v < 1; v += 0.062) {
    g.fillStyle = rand() < 0.4 ? 'rgba(150,96,62,0.55)' : 'rgba(70,70,66,0.5)';
    g.fillRect(0, Y(v), W, 2);
    for (let u = 0; u < 1; u += 0.011) { g.fillStyle = 'rgba(60,60,56,0.55)'; g.fillRect(X(u), Y(v) + 5, 2, 2); }
  }
  for (let u = 0; u < 1; u += 1 / 14) {
    g.fillStyle = rand() < 0.4 ? 'rgba(150,96,62,0.45)' : 'rgba(70,70,66,0.45)';
    g.fillRect(X(u), 0, 2, H);
  }
  // Cabin windows on both sides and a round port up top.
  for (const u0 of [0.03, 0.47]) {
    for (const v of [0.2, 0.29, 0.38, 0.47, 0.56]) {
      g.fillStyle = '#d4d5d0'; g.fillRect(X(u0) - 4, Y(v) + 4, X(0.052) + 8, -(0.03 * H) - 8);
      g.fillStyle = '#121312'; g.fillRect(X(u0), Y(v), X(0.052), -(0.03 * H));
    }
  }
  g.fillStyle = '#9a9b96'; g.beginPath(); g.arc(X(0.2), Y(0.36), 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2a2b29'; g.beginPath(); g.arc(X(0.2), Y(0.36), 10, 0, Math.PI * 2); g.fill();
  // Cockpit: ragged dark openings where the glass was.
  for (const [u, w] of [[0.12, 0.09], [0.29, 0.09]]) {
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(X(u), Y(0.86));
    for (let k = 0; k <= 8; k++) g.lineTo(X(u + (w * k) / 8), Y(0.9 + rand() * 0.012));
    for (let k = 8; k >= 0; k--) g.lineTo(X(u + (w * k) / 8), Y(0.84 - rand() * 0.012));
    g.fill();
  }
  // Holes punched through the skin, mostly towards the nose, each in a small dent.
  for (let i = 0; i < 170; i++) {
    const v = 0.4 + Math.pow(rand(), 0.45) * 0.56, u = rand(), r = 1.2 + Math.pow(rand(), 4) * 7;
    g.fillStyle = 'rgba(70,68,62,0.45)'; g.beginPath(); g.ellipse(X(u), Y(v), r * 2.4, r * 1.8, rand() * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#141414'; g.beginPath(); g.arc(X(u), Y(v), r, 0, Math.PI * 2); g.fill();
  }
  // Scratched names and doodles left by visitors.
  g.strokeStyle = 'rgba(235,235,230,0.35)'; g.lineWidth = 1.2;
  for (let i = 0; i < 60; i++) {
    let x = rand() * W, y = Y(0.15 + rand() * 0.7);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.3) * 14; y += (rand() - 0.5) * 10; g.lineTo(x, y); }
    g.stroke();
  }
  // Rust weeping from a few seams.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${120 + rand() * 40},${70 + rand() * 20},40,${0.08 + rand() * 0.12})`;
    g.fillRect(rand() * W, rand() * H, 2 + rand() * 4, 10 + rand() * 40);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A rainbow painted on the ground from (x0,z0) to (x1,z1), width w, following the terrain.
function rainbowStrip(kit, x0, z0, x1, z1, w = 5) {
  const g = new THREE.Group();
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(6, Math.round(L / 2)), dx = (x1 - x0) / L, dz = (z1 - z0) / L, nx = -dz, nz = dx;
  const mats = RAINBOW.map((c) => std(c, 0.75, 0, { polygonOffset: true, polygonOffsetFactor: -3 }));
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    for (let k = 0; k < 6; k++) {
      const off = (k - 2.5) * (w / 6);
      const ax = x0 + dx * L * t0 + nx * off, az = z0 + dz * L * t0 + nz * off;
      const bx = x0 + dx * L * t1 + nx * off, bz = z0 + dz * L * t1 + nz * off;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(w / 6, 0.08, L / n + 0.05), mats[k]);
      seg.position.set((ax + bx) / 2, (kit.ground(ax, az) + kit.ground(bx, bz)) / 2 + 0.14, (az + bz) / 2);
      seg.rotation.y = Math.atan2(dx, dz);
      seg.rotation.x = Math.atan2(kit.ground(ax, az) - kit.ground(bx, bz), L / n);
      seg.receiveShadow = true;
      g.add(seg);
    }
  }
  return g;
}


// ---------- Detailed wooden churches ----------
const glowMat = (kit) => { const m = std(0x2a2416, 0.4, 0, { emissive: 0xffc46b, emissiveIntensity: 0 }); kit.nightLit(m, 1.3); return m; };
// Vertical corrugated siding: thin grooves merged into one mesh per wall colour.
function siding(w, h, d, color, step = 0.18) {
  const parts = [];
  for (let x = -w / 2 + step / 2; x < w / 2; x += step) { const b = new THREE.BoxGeometry(step * 0.5, h, 0.03); b.translate(x, h / 2, d / 2 + 0.015); parts.push(b); const b2 = b.clone(); b2.translate(0, 0, -d - 0.03); parts.push(b2); }
  for (let z = -d / 2 + step / 2; z < d / 2; z += step) { const b = new THREE.BoxGeometry(0.03, h, step * 0.5); b.translate(w / 2 + 0.015, h / 2, z); parts.push(b); const b2 = b.clone(); b2.translate(-w - 0.03, 0, 0); parts.push(b2); }
  return M(mergeGeometries(parts), std(color, 0.75));
}
// Arched window: white frame, dark glass that glows at night.
function archWindow(kit, w, h, frame, glass) {
  const g = new THREE.Group();
  const f = new THREE.Shape(); f.moveTo(-w / 2, 0); f.lineTo(w / 2, 0); f.lineTo(w / 2, h - w / 2); f.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); f.closePath();
  const inner = new THREE.Path(); const iw = w - 0.14, ih = h - 0.07; inner.moveTo(-iw / 2, 0.07); inner.lineTo(iw / 2, 0.07); inner.lineTo(iw / 2, ih - iw / 2); inner.absarc(0, ih - iw / 2, iw / 2, 0, Math.PI, true); inner.closePath();
  f.holes.push(inner);
  g.add(M(new THREE.ExtrudeGeometry(f, { depth: 0.08, bevelEnabled: false }), frame));
  g.add(M(new THREE.ExtrudeGeometry(new THREE.Shape(inner.getPoints(16)), { depth: 0.04, bevelEnabled: false }), glass, 0, 0, 0.02));
  // Glazing bars.
  g.add(M(new THREE.BoxGeometry(0.03, h - 0.1, 0.02), frame, 0, (h - 0.1) / 2 + 0.05, 0.08));
  g.add(M(new THREE.BoxGeometry(iw, 0.03, 0.02), frame, 0, h * 0.45, 0.08));
  return g;
}

function buildSeydisChurch(kit) {
  const g = new THREE.Group();
  const blue = 0xaccbe6, trimW = std(0xf4f7fa, 0.6), roofM = std(0x9fb4c6, 0.45, 0.4), stepM = std(0x7d8084, 0.9), glass = glowMat(kit), wood = std(0x6b3418, 0.6);
  const W = 7.2, D = 12, H = 5.2;
  const nave = M(new THREE.BoxGeometry(W, H, D), std(blue, 0.8), 0, H / 2, -2); nave.userData.solid = true; g.add(nave);
  const sid = siding(W, H, D, blue); sid.position.set(0, 0, -2); g.add(sid);
  for (const sx of [-1, 1]) for (const z of [-7, -2, 3]) g.add(M(new THREE.BoxGeometry(0.16, H, 0.16), trimW, sx * W / 2, H / 2, z === 3 ? 4 : -8));
  // Roof with white eaves.
  const s = new THREE.Shape(); s.moveTo(-W / 2 - 0.35, 0); s.lineTo(W / 2 + 0.35, 0); s.lineTo(0, 2.6); s.closePath();
  const r = new THREE.ExtrudeGeometry(s, { depth: D + 0.6, bevelEnabled: false }); r.translate(0, 0, -(D + 0.6) / 2);
  g.add(M(r, roofM, 0, H, -2));
  g.add(M(new THREE.BoxGeometry(W + 0.8, 0.22, 0.3), trimW, 0, H + 0.02, 4.1));
  // Side annex, as in the photos.
  const annex = M(new THREE.BoxGeometry(2.6, 3.6, 7), std(blue, 0.8), -W / 2 - 1.3, 1.8, -3); annex.userData.solid = true; g.add(annex);
  g.add(M(new THREE.BoxGeometry(2.9, 0.2, 7.3), std(0x9fb4c6, 0.45, 0.4), -W / 2 - 1.3, 3.65, -3));
  // Front: arched door with a white surround, the big fan window above, arched windows beside.
  const door = archWindow(kit, 1.5, 2.6, trimW, wood); door.position.set(0, 0.9, 4.05); g.add(door);
  g.add(M(new THREE.BoxGeometry(2.4, 0.18, 0.35), trimW, 0, 3.7, 4.2));
  for (const sx of [-1, 1]) { const w = archWindow(kit, 0.75, 1.7, trimW, glass); w.position.set(sx * 2.4, 1.4, 4.02); g.add(w); }
  const fan = new THREE.Shape(); fan.absarc(0, 0, 1.3, 0, Math.PI, false); fan.closePath();
  g.add(M(new THREE.ExtrudeGeometry(fan, { depth: 0.06, bevelEnabled: false }), trimW, 0, 4.1, 4.02));
  const fanIn = new THREE.Shape(); fanIn.absarc(0, 0, 1.18, 0, Math.PI, false); fanIn.closePath();
  g.add(M(new THREE.ExtrudeGeometry(fanIn, { depth: 0.04, bevelEnabled: false }), glass, 0, 4.1, 4.06));
  for (let k = 0; k < 5; k++) { const a = (k / 4) * Math.PI; const bar = M(new THREE.BoxGeometry(0.04, 1.18, 0.02), trimW, Math.cos(a) * 0.59, 4.1 + Math.sin(a) * 0.59, 4.1); bar.rotation.z = a - Math.PI / 2; g.add(bar); }
  // Side windows.
  for (const sx of [-1, 1]) for (const z of [-6.2, -3.6, -1]) { const w = archWindow(kit, 0.8, 1.8, trimW, glass); w.position.set(sx * (W / 2 + 0.02), 1.6, z); w.rotation.y = sx * Math.PI / 2; g.add(w); }
  // Tower on the front, with an arched window, a small round window, the steeple and the cross.
  const TW = 3.1, TH = 9.5;
  const tower = M(new THREE.BoxGeometry(TW, TH, TW), std(blue, 0.8), 0, TH / 2, 2.4); tower.userData.solid = true; g.add(tower);
  const tsid = siding(TW, TH, TW, blue); tsid.position.set(0, 0, 2.4); g.add(tsid);
  for (const sx of [-1, 1]) g.add(M(new THREE.BoxGeometry(0.16, TH, 0.16), trimW, sx * TW / 2, TH / 2, 2.4 + TW / 2));
  const tw = archWindow(kit, 0.8, 1.6, trimW, glass); tw.position.set(0, 6.4, 2.4 + TW / 2 + 0.02); g.add(tw);
  g.add(M(new THREE.TorusGeometry(0.32, 0.05, 8, 20), trimW, 0, 8.7, 2.4 + TW / 2 + 0.03));
  g.add(M(new THREE.CircleGeometry(0.3, 20), glass, 0, 8.7, 2.4 + TW / 2 + 0.04));
  g.add(M(new THREE.BoxGeometry(TW + 0.6, 0.3, TW + 0.6), trimW, 0, TH + 0.1, 2.4));
  const steeple = M(new THREE.ConeGeometry(TW * 0.72, 6.5, 8), std(0x9fb4c6, 0.5, 0.3), 0, TH + 3.4, 2.4); steeple.rotation.y = Math.PI / 8; g.add(steeple);
  const gold = std(0xd8b84a, 0.3, 0.8);
  g.add(M(new THREE.BoxGeometry(0.08, 1.1, 0.08), gold, 0, TH + 7.1, 2.4)); g.add(M(new THREE.BoxGeometry(0.6, 0.08, 0.08), gold, 0, TH + 7.3, 2.4));
  // Steps and the white railing ramp.
  for (let i = 0; i < 5; i++) g.add(M(new THREE.BoxGeometry(5.5 - i * 0.2, 0.22, 0.5), stepM, 0, 0.11 + i * 0.22, 5.4 - i * 0.5 + 1.2));
  const rail = std(0xf4f7fa, 0.5, 0.5);
  for (const [x, z, h] of [[3.2, 6.4, 1.0], [3.2, 4.4, 1.2], [3.2, 2.4, 1.2]]) g.add(M(new THREE.CylinderGeometry(0.03, 0.03, h, 6), rail, x, h / 2, z));
  g.add(M(new THREE.BoxGeometry(0.05, 0.05, 4.2), rail, 3.2, 1.1, 4.4));
  return g;
}

function buildBudaChurch(kit) {
  const g = new THREE.Group();
  const black = 0x15161a, trimW = std(0xf2f2ee, 0.6), roofM = std(0x111214, 0.4, 0.3), glass = glowMat(kit);
  const W = 5.6, D = 9.5, H = 4.2;
  const nave = M(new THREE.BoxGeometry(W, H, D), std(black, 0.85), 0, H / 2, -1); nave.userData.solid = true; g.add(nave);
  const sid = siding(W, H, D, black, 0.22); sid.position.set(0, 0, -1); g.add(sid);
  const s = new THREE.Shape(); s.moveTo(-W / 2 - 0.3, 0); s.lineTo(W / 2 + 0.3, 0); s.lineTo(0, 2.2); s.closePath();
  const r = new THREE.ExtrudeGeometry(s, { depth: D + 0.5, bevelEnabled: false }); r.translate(0, 0, -(D + 0.5) / 2);
  g.add(M(r, roofM, 0, H, -1));
  // Light grey foundation line.
  g.add(M(new THREE.BoxGeometry(W + 0.2, 0.25, D + 0.2), std(0xb9bcc0, 0.8), 0, 0.12, -1));
  // White classical door surround: pilasters, lintel and a little pediment.
  const dz = D / 2 - 1 + 0.02;
  g.add(M(new THREE.BoxGeometry(1.1, 2.3, 0.1), std(0xf6f6f2, 0.5), 0, 1.15, dz + 0.05));
  for (const sx of [-1, 1]) g.add(M(new THREE.BoxGeometry(0.22, 2.7, 0.16), trimW, sx * 0.78, 1.35, dz + 0.08));
  g.add(M(new THREE.BoxGeometry(1.9, 0.22, 0.2), trimW, 0, 2.8, dz + 0.1));
  const ped = new THREE.Shape(); ped.moveTo(-1.05, 0); ped.lineTo(1.05, 0); ped.lineTo(0, 0.55); ped.closePath();
  g.add(M(new THREE.ExtrudeGeometry(ped, { depth: 0.2, bevelEnabled: false }), trimW, 0, 2.92, dz));
  // Three white-framed windows on each side.
  for (const sx of [-1, 1]) for (const z of [-4, -1.5, 1]) {
    g.add(M(new THREE.BoxGeometry(0.08, 1.3, 0.8), trimW, sx * (W / 2 + 0.03), 2.0, z));
    g.add(M(new THREE.BoxGeometry(0.06, 1.1, 0.62), glass, sx * (W / 2 + 0.06), 2.0, z));
  }
  // Small black steeple with a pyramid cap and a cross.
  const tower = M(new THREE.BoxGeometry(1.5, 2.6, 1.5), std(black, 0.85), 0, H + 1.9, dz - 1.4); g.add(tower);
  g.add(M(new THREE.BoxGeometry(1.7, 0.12, 1.7), trimW, 0, H + 3.2, dz - 1.4));
  const cap = M(new THREE.ConeGeometry(1.15, 1.6, 4), roofM, 0, H + 4.0, dz - 1.4); cap.rotation.y = Math.PI / 4; g.add(cap);
  g.add(M(new THREE.BoxGeometry(0.06, 0.9, 0.06), trimW, 0, H + 5.2, dz - 1.4)); g.add(M(new THREE.BoxGeometry(0.5, 0.06, 0.06), trimW, 0, H + 5.4, dz - 1.4));
  // Lava-rock wall around the graveyard, with a little white gate.
  const lava = std(0x242426, 0.95);
  const R = 12;
  for (let i = 0; i < 44; i++) {
    const t = (i / 44) * Math.PI * 2;
    if (t > 1.3 && t < 1.85) continue; // gap for the gate
    const x = Math.cos(t) * R * 1.25, z = Math.sin(t) * R - 1;
    g.add(M(lump(0.9 + kit.rand() * 0.6, kit.rand, 0.6), lava, x, kit.ground(x, z) + 0.4, z));
  }
  const gx = Math.cos(1.57) * R * 1.25, gz = Math.sin(1.57) * R - 1, gy = kit.ground(gx, gz);
  for (const sx of [-1, 1]) g.add(M(new THREE.BoxGeometry(0.16, 2.2, 0.16), trimW, gx + sx * 1.3, gy + 1.1, gz));
  g.add(M(new THREE.BoxGeometry(2.9, 0.16, 0.2), trimW, gx, gy + 2.3, gz));
  const gp = new THREE.Shape(); gp.moveTo(-1.5, 0); gp.lineTo(1.5, 0); gp.lineTo(0, 0.5); gp.closePath();
  g.add(M(new THREE.ExtrudeGeometry(gp, { depth: 0.2, bevelEnabled: false }), trimW, gx, gy + 2.4, gz - 0.1));
  return g;
}

// Painted cobbles in colour rows, like Seyðisfjörður's street: little bricks with dark gaps.
function cobbleRainbow(kit, x0, z0, x1, z1, w = 4.4) {
  const L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L, nx = -dz, nz = dx;
  const rowH = 0.42, cols = Math.round(w / 0.5), rows = Math.floor(L / rowH);
  const geo = new THREE.BoxGeometry(0.46, 0.06, 0.36);
  const inst = new THREE.InstancedMesh(geo, std(0xffffff, 0.7, 0, { polygonOffset: true, polygonOffsetFactor: -3 }), rows * cols);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
  const rot = Math.atan2(dx, dz);
  q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const col = RAINBOW[r % RAINBOW.length];
    for (let k = 0; k < cols; k++) {
      const off = (k - (cols - 1) / 2) * 0.5 + (r % 2 ? 0.12 : -0.12);
      const t = (r + 0.5) * rowH;
      const x = x0 + dx * t + nx * off, z = z0 + dz * t + nz * off;
      v.set(x, kit.ground(x, z) + 0.16, z);
      m4.compose(v, q, sc); inst.setMatrixAt(n, m4);
      inst.setColorAt(n, c.set(col).multiplyScalar(0.85 + kit.rand() * 0.25)); n++;
    }
  }
  inst.count = n; inst.receiveShadow = true;
  return inst;
}
function lamp(kit, x, z) {
  const g = new THREE.Group();
  const pole = std(0x3a3d42, 0.5, 0.6), bulb = std(0x332200, 0.3, 0, { emissive: 0xffe2a8, emissiveIntensity: 0 });
  kit.nightLit(bulb, 2.5);
  const y = kit.ground(x, z);
  g.add(M(new THREE.CylinderGeometry(0.06, 0.09, 5, 8), pole, x, y + 2.5, z));
  const arm = M(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), pole, x + 0.6, y + 5.1, z); arm.rotation.z = Math.PI / 2 + 0.25; g.add(arm);
  g.add(M(new THREE.SphereGeometry(0.16, 10, 8), bulb, x + 1.25, y + 5.0, z));
  return g;
}
function timberHouse(kit, x, z, { w = 7, d = 8, h = 6, wall = 0x1e1f22, roof = 0x8a8f94, trim = 0xf2f2ee, windows = 6 } = {}) {
  const g = new THREE.Group();
  const y = kit.ground(x, z);
  const body = M(new THREE.BoxGeometry(w, h, d), std(wall, 0.8), x, y + h / 2, z); body.userData.solid = true; g.add(body);
  g.add(M(new THREE.BoxGeometry(w + 0.3, 2.2, d + 0.3), std(0x55585c, 0.95), x, y - 0.8, z));
  const s = new THREE.Shape(); s.moveTo(-w / 2 - 0.3, 0); s.lineTo(w / 2 + 0.3, 0); s.lineTo(0, w * 0.4); s.closePath();
  const r = new THREE.ExtrudeGeometry(s, { depth: d + 0.5, bevelEnabled: false }); r.translate(0, 0, -(d + 0.5) / 2);
  g.add(M(r, std(roof, 0.5, 0.35), x, y + h, z));
  const frame = std(trim, 0.6), glass = glowMat(kit);
  const perFloor = Math.round(windows / 2);
  for (let f = 0; f < 2; f++) for (let k = 0; k < perFloor; k++) for (const sx of [-1, 1]) {
    const wz = z - d / 2 + (k + 0.5) * (d / perFloor);
    g.add(M(new THREE.BoxGeometry(0.08, 1.2, 0.9), frame, x + sx * (w / 2 + 0.03), y + 1.5 + f * 2.6, wz));
    g.add(M(new THREE.BoxGeometry(0.06, 1.0, 0.7), glass, x + sx * (w / 2 + 0.06), y + 1.5 + f * 2.6, wz));
  }
  return g;
}

export const EXTRA = {
  // Seyðisfjarðarkirkja: pale blue church, rainbow street leading to its door.
  rainbowChurch(kit) {
    const g = new THREE.Group();
    g.add(buildSeydisChurch(kit));
    // The painted street runs from the road straight to the church steps.
    // The painted street is the last stretch of the drive: gravel from the road end up to the steps.
    g.add(cobbleRainbow(kit, 0, 46, 0, 8.4, 4.4));
    // Houses along the street: black timber with white windows, a red one, a white one with a blue roof.
    g.add(timberHouse(kit, -13, 38, { w: 6.5, d: 9, h: 6.2, wall: 0x1e1f22, roof: 0x8a8f94 }));
    g.add(timberHouse(kit, 13, 34, { w: 6, d: 8, h: 5.6, wall: 0xa83226, roof: 0x9a9fa4 }));
    g.add(timberHouse(kit, -13, 24, { w: 5.5, d: 7, h: 3.6, wall: 0xf1efe8, roof: 0x3f7cc0, windows: 4 }));
    g.add(timberHouse(kit, -13, 12, { w: 5, d: 6, h: 3.4, wall: 0xd9a441, roof: 0x3a3d42, windows: 4 }));
    g.add(timberHouse(kit, 13, 20, { w: 5.5, d: 6.5, h: 3.4, wall: 0xe8e2d3, roof: 0x55595d, windows: 4 }));
    for (const [x, z] of [[-7, 42], [7, 30], [-7, 18]]) g.add(lamp(kit, x, z));
    // String lights across the street.
    const bulbs = std(0x332200, 0.3, 0, { emissive: 0xfff0c0, emissiveIntensity: 0 }); kit.nightLit(bulbs, 2);
    for (const z of [36, 24]) {
      const y = kit.ground(0, z) + 5.6;
      g.add(M(new THREE.BoxGeometry(18, 0.02, 0.02), std(0x222, 0.8), 0, y, z));
      for (let k = -8; k <= 8; k++) g.add(M(new THREE.SphereGeometry(0.07, 6, 5), bulbs, k * 1.1, y - 0.12 - Math.abs(k) * 0.02, z));
    }
    // Trees around the church lawn.
    const trunk = std(0xd9d3c6, 0.9), crown = std(0x4f7a2e, 0.9);
    for (const [x, z] of [[-7, 2], [-9, -4], [8, 1], [9, -6], [-5, -11]]) {
      const y = kit.ground(x, z), h = 3.5 + kit.rand() * 2;
      g.add(M(new THREE.CylinderGeometry(0.1, 0.16, h, 6), trunk, x, y + h / 2, z));
      const c = M(new THREE.IcosahedronGeometry(1.4 + kit.rand() * 0.6, 1), crown, x, y + h + 0.4, z); c.scale.y = 1.3; g.add(c);
    }
    return g;
  },
  rainbowStreet(kit) {
    const g = new THREE.Group();
    g.add(rainbowStrip(kit, 0, 34, 0, -6, 4.5));
    for (const [x, z, c] of [[-11, 26, 0xe9d8a6], [11, 22, 0xb8d8e6], [-11, 14, 0xd98c8c], [11, 10, 0xe8e2d3], [-11, 2, 0x8fb9a8]]) {
      const h = M(new THREE.BoxGeometry(5, 4.2, 6), std(c, 0.8), x, kit.ground(x, z) + 2.1, z);
      h.userData.solid = true; g.add(h);
      g.add(M(new THREE.BoxGeometry(5.4, 0.4, 6.4), std(0x3a3d42, 0.5, 0.3), x, kit.ground(x, z) + 4.4, z));
      g.add(M(new THREE.BoxGeometry(3.6, 1.6, 0.1), std(0x1a2229, 0.2, 0.5), x + (x < 0 ? 2.56 : -2.56), kit.ground(x, z) + 1.3, z));
    }
    return g;
  },

  falls(kit, p = {}) {
    const g = new THREE.Group();
    const tiers = p.tiers || 1, fan = p.fan || 1;
    let mists = [];
    for (let t = 0; t < tiers; t++) {
      const k = tiers - 1 - t; // 0 at the bottom tier
      const w = p.width * (1 + (fan - 1) * (k / Math.max(1, tiers - 1)));
      const f = kit.makeWaterfall({ width: w, height: p.height / tiers, walkBehind: !!p.walkBehind, cliffWidth: p.cliffWidth ? p.cliffWidth * (1 + 0.4 * k) : undefined });
      f.group.position.set(0, (p.height / tiers) * (tiers - 1 - k), -k * 12);
      g.add(f.group); mists.push(...f.mists);
    }
    kit.mists(mists);
    if (p.canyon) {
      // A deep slot in front of the falls, with the river at the bottom.
      for (const side of [-1, 1]) { const w = kit.rockBox(10, 26, 18); w.position.set(side * 10, 13 - 26, 9); w.userData.collide = true; g.add(w); }
    }
    if (p.springs) {
      // Hraunfossar: a long line of little springs seeping out of the lava edge.
      const mat = createRiverMaterial({ shallow: [0.5, 0.78, 0.82], deep: [0.15, 0.45, 0.5], speed: 1.2 });
      for (let i = 0; i < 9; i++) {
        const x = -32 + i * 7.5, pts = [];
        for (let k = 0; k <= 4; k++) pts.push({ x: x + Math.sin(k) * 0.4, y: 5.4 - k * 1.2, z: 0.3 + k * 0.6 });
        g.add(M(riverGeometry(pts, 1.4), mat));
      }
    }
    return g;
  },
  glacier(kit) { const g = buildSkaftafell(kit); g.scale.set(0.7, 0.7, 0.7); return g; },

  beach(kit) {
    const g = new THREE.Group();
    const rock = kit.rockMaterial();
    for (const [x, z, h] of [[-20, 70, 22], [-8, 78, 30], [6, 74, 18]]) g.add(M(new THREE.CylinderGeometry(1.6 + h * 0.06, 4.6, h, 6, 3), rock, x, h / 2 - 5, z));
    const wood = std(0x6b5137, 0.85);
    for (let i = 0; i < 5; i++) { const d = M(new THREE.CylinderGeometry(0.18, 0.25, 4 + kit.rand() * 3, 7), wood, -16 + i * 8, kit.ground(-16 + i * 8, 12) + 0.2, 12 + kit.rand() * 6); d.rotation.z = Math.PI / 2; d.rotation.y = kit.rand() * 3; g.add(d); }
    return g;
  },

  hotpool(kit, p = {}) {
    const g = new THREE.Group();
    const water = createWaterMaterial(p.color || 0x3fa6c4, { roughness: 0.15, ripple: 0.3, shallow: [0.4, 0.75, 0.8], deep: [0.15, 0.5, 0.6], clarity: 0.15, foam: 0.1, depthAware: false, glow: 0.1 });
    const stone = std(0x6b6660, 0.9), deck = std(0x6b5137, 0.85);
    const n = p.pools || 1, r = p.r || 8;
    for (let i = 0; i < n; i++) {
      const x = n > 1 ? Math.cos(i * 1.7) * r * 1.3 : 0, z = -6 + (n > 1 ? Math.sin(i * 1.7) * r : 0);
      const y = kit.ground(x, z);
      g.add(M(new THREE.CylinderGeometry(r + 1.2, r + 2, 0.7, 36), stone, x, y + 0.2, z));
      const pool = M(new THREE.CircleGeometry(r, 36), water, x, y + 0.58, z); pool.rotation.x = -Math.PI / 2; g.add(pool);
      const s = kit.makeMist(50, r * 1.5, 7); s.material = s.material.clone(); s.material.opacity = 0.2; s.material.size = 5; s.position.set(x, y + 0.7, z);
      g.add(s); kit.steam(s);
    }
    g.add(M(new THREE.BoxGeometry(2, 0.25, 14), deck, r + 3, kit.ground(r + 3, 2) + 0.5, 2));
    if (p.hut) {
      const hut = M(new THREE.BoxGeometry(9, 3.4, 6), std(0x2b2e32, 0.7), -r - 6, kit.ground(-r - 6, -10) + 1.7, -10); hut.userData.solid = true; g.add(hut);
      g.add(M(new THREE.BoxGeometry(9.6, 0.5, 6.6), std(0x4f6233, 0.95), -r - 6, kit.ground(-r - 6, -10) + 3.6, -10));
    }
    return g;
  },

  greenhouse(kit) {
    const g = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe2ea, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.45, emissive: 0xff8fb0, emissiveIntensity: 0 });
    kit.nightLit(glass, 0.55);
    const frame = std(0xdde2e5, 0.5, 0.6), vine = std(0x3f7a2e, 0.9), tomato = std(0xd8322a, 0.5);
    for (const x of [-9, 0, 9]) {
      const y = kit.ground(x, -12);
      const gh = M(new THREE.BoxGeometry(8, 4, 26), glass, x, y + 2, -12); gh.userData.solid = true; g.add(gh);
      const s = new THREE.Shape(); s.moveTo(-4.1, 0); s.lineTo(4.1, 0); s.lineTo(0, 1.6); s.closePath();
      const r = new THREE.ExtrudeGeometry(s, { depth: 26.2, bevelEnabled: false }); r.translate(0, 0, -13.1);
      g.add(M(r, glass, x, y + 4, -12));
      g.add(M(new THREE.BoxGeometry(0.2, 4.2, 26.2), frame, x - 4, y + 2.1, -12));
      g.add(M(new THREE.BoxGeometry(0.2, 4.2, 26.2), frame, x + 4, y + 2.1, -12));
      for (let k = 0; k < 6; k++) {
        g.add(M(new THREE.BoxGeometry(0.6, 2.6, 3.2), vine, x - 1.6 + (k % 2) * 3.2, y + 1.3, -24 + k * 4));
        g.add(M(new THREE.SphereGeometry(0.22, 8, 6), tomato, x - 1.6 + (k % 2) * 3.2 + 0.4, y + 1.5, -24 + k * 4));
      }
    }
    return g;
  },

  hotriver(kit) {
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 16; i++) { const z = 10 - i * 4, x = Math.sin(i * 0.5) * 5; pts.push({ x, y: kit.ground(x, z) + 0.3 + i * 0.02, z }); }
    g.add(M(riverGeometry(pts, 3.2), createRiverMaterial({ shallow: [0.34, 0.6, 0.62], deep: [0.1, 0.3, 0.34], speed: 0.8 })));
    for (let i = 2; i <= 14; i += 4) { const s = kit.makeMist(40, 4, 6); s.material = s.material.clone(); s.material.opacity = 0.2; s.material.size = 4; s.position.set(pts[i].x, pts[i].y, pts[i].z); g.add(s); kit.steam(s); }
    const wood = std(0x6b5137, 0.85);
    for (let i = 0; i < 8; i++) g.add(M(new THREE.BoxGeometry(1.6, 0.2, 2.4), wood, pts[i * 2].x + 3, pts[i * 2].y + 0.2, pts[i * 2].z));
    return g;
  },

  bridge(kit) {
    const g = new THREE.Group();
    const lava = std(0x222325, 0.95), sand = std(0x2a2a2c, 0.95), steel = std(0x5d5f63, 0.5, 0.6), wood = std(0x7a5a3a, 0.8);
    for (const side of [-1, 1]) { const b = M(lump(9, kit.rand, 0.35), lava, side * 11, 1, -8); b.userData.solid = true; g.add(b); }
    g.add(M(new THREE.PlaneGeometry(14, 30).rotateX(-Math.PI / 2), sand, 0, 0.2, -8));
    g.add(M(new THREE.BoxGeometry(18, 0.3, 2.2), wood, 0, 3.2, -8));
    for (const x of [-7, 7]) for (const z of [-9, -7]) g.add(M(new THREE.CylinderGeometry(0.12, 0.12, 4.4, 8), steel, x, 1.6, z));
    for (const z of [-9.1, -6.9]) g.add(M(new THREE.BoxGeometry(18, 0.08, 0.08), steel, 0, 4.3, z));
    return g;
  },

  // The DC-3 on Sólheimasandur: a stripped silver fuselage, wings and tail gone, the nose torn
  // open, lying tail-down in black sand with the round wing-root stubs beside it.
  planeWreck(kit) {
    const g = new THREE.Group();
    const rand = kit.rand;
    const L0 = -7.2, L1 = 7.4, R = 1.32;
    const tex = wreckSkin(rand);
    const skin = std(0x9d9e99, 0.66, 0.2, { map: tex });
    const inside = std(0x3b3c3a, 0.95, 0, { side: THREE.BackSide });
    const plate = std(0x86877f, 0.7, 0.2), dark = std(0x2c2d2c, 0.9);

    // Fuselage: a tube that rounds into the nose, built along x (nose at +x, a = 0 facing +z).
    const NS = 56, NA = 40;
    const dents = Array.from({ length: 46 }, () => ({ t: L0 + rand() * (L1 - L0) * (0.35 + 0.65 * Math.sqrt(rand())), a: rand() * Math.PI * 2, s: 0.15 + rand() * 0.35, d: 0.03 + rand() * 0.06 }));
    const tear = (a) => 0.5 + 0.45 * Math.sin(a * 3 + 1) * Math.sin(a * 7 + 2) + rand() * 0.25;
    const tears = Array.from({ length: NA + 1 }, (_, i) => tear((i / NA) * Math.PI * 2));
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= NS; j++) {
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * Math.PI * 2;
        let t = L0 + ((L1 - L0) * j) / NS;
        if (j > NS - 4) t -= tears[i % NA] * (j - (NS - 4)) / 4;
        const k = Math.max(0, (t - 2.6) / (L1 - 2.6));
        let r = R * Math.sqrt(Math.max(0.05, 1 - k * k * 0.82));
        const yc = -k * k * 0.32;
        // Crushed nose: the lower front on the near side is caved in.
        const low = Math.max(0, -Math.sin(a + 0.5));
        r *= 1 - Math.max(0, (t - 4.9) / 2.5) * low * 0.42;
        for (const d of dents) {
          const da = Math.atan2(Math.sin(a - d.a), Math.cos(a - d.a)) * R, dt = t - d.t;
          r -= d.d * Math.exp(-(da * da + dt * dt) / (d.s * d.s));
        }
        pos.push(t, yc + Math.sin(a) * r * 1.04, Math.cos(a) * r * 0.95);
        uv.push(i / NA, (t - L0) / (L1 - L0));
      }
    }
    for (let j = 0; j < NS; j++) for (let i = 0; i < NA; i++) {
      const p = j * (NA + 1) + i, q = p + NA + 1;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const body = new THREE.Group();
    body.add(M(geo, skin), M(geo, inside));
    // Rear bulkhead just inside the cut end, with a doorway.
    const bulk = new THREE.Shape(); bulk.absarc(0, 0, R * 0.98, 0, Math.PI * 2, false);
    const door = new THREE.Path(); door.moveTo(-0.38, -0.9); door.lineTo(0.38, -0.9); door.lineTo(0.38, 0.55); door.lineTo(-0.38, 0.55); door.closePath();
    bulk.holes.push(door);
    const bh = M(new THREE.ShapeGeometry(bulk, 24), std(0x8e8f8a, 0.75, 0.2, { side: THREE.DoubleSide }), L0 + 0.5, 0, 0);
    bh.rotation.y = Math.PI / 2; bh.scale.set(0.95, 1.04, 1);
    body.add(bh);
    // Cockpit frame: bent bars where the windscreen was, and torn sheet curling off the nose.
    const bar = std(0x55564f, 0.6, 0.4);
    for (const [y, z, rz, len] of [[0.62, 0.42, 0.7, 1.1], [0.66, -0.42, 0.62, 1.05], [0.8, 0, 0.9, 0.9], [0.25, 0.7, 1.3, 0.8]]) {
      const b = M(new THREE.CylinderGeometry(0.035, 0.035, len, 5), bar, 6.45, y, z); b.rotation.z = rz; b.rotation.x = (rand() - 0.5) * 0.6; body.add(b);
    }
    for (let i = 0; i < 5; i++) {
      const s = M(new THREE.PlaneGeometry(0.5 + rand() * 0.6, 0.3 + rand() * 0.5, 3, 2), std(0x9d9e99, 0.66, 0.2, { side: THREE.DoubleSide, map: tex }), 6.3 + rand() * 0.6, -0.6 + rand() * 0.9, (rand() < 0.5 ? -1 : 1) * (0.7 + rand() * 0.3));
      const p = s.geometry.attributes.position; for (let v = 0; v < p.count; v++) p.setZ(v, (rand() - 0.5) * 0.18);
      s.geometry.computeVertexNormals(); s.rotation.set(rand() * 1.2, rand() * 3, rand() * 1.2); body.add(s);
    }
    // Broken nose gear legs under the front.
    for (const z of [-0.55, 0.55]) {
      const leg = M(new THREE.CylinderGeometry(0.07, 0.09, 1.5, 7), bar, 3.6, -1.3, z); leg.rotation.z = -0.55; leg.rotation.x = z * 0.4; body.add(leg);
    }

    // Wing-root stubs: a flattened centre section each side ending in the round nacelle drum.
    for (const side of [-1, 1]) {
      const stub = M(new THREE.BoxGeometry(2.6, 0.32, 1.7), plate, -0.6, -0.95, side * 2.2); stub.rotation.x = side * 0.05; body.add(stub);
      const drum = new THREE.Group();
      const shell = M(new THREE.CylinderGeometry(1.12, 1.16, 0.9, 28, 1, true), std(0x9d9e99, 0.66, 0.2, { map: tex, side: THREE.DoubleSide }));
      const face = M(new THREE.CircleGeometry(1.1, 28), std(0x8f908a, 0.72, 0.2, { map: tex }));
      face.position.y = side * 0.4; face.rotation.x = side * -Math.PI / 2;
      drum.add(shell, face);
      // Plates, brackets and bolts on the open face.
      for (let i = 0; i < 9; i++) {
        const a = rand() * Math.PI * 2, rr = rand() * 0.8;
        const b = M(new THREE.BoxGeometry(0.12 + rand() * 0.25, 0.06, 0.08 + rand() * 0.2), i % 3 ? dark : bar, Math.cos(a) * rr, side * 0.44, Math.sin(a) * rr);
        b.rotation.y = rand() * 3; drum.add(b);
      }
      drum.add(M(new THREE.BoxGeometry(0.06, 0.04, 1.9), dark, 0, side * 0.43, 0), M(new THREE.BoxGeometry(1.9, 0.04, 0.06), dark, 0, side * 0.43, 0));
      drum.rotation.x = Math.PI / 2;
      drum.position.set(-0.8, -0.55, side * 3.3);
      body.add(drum);
    }

    // Lie it tail-down with the nose lifted, skewed a little to the road.
    const lay = new THREE.Group();
    lay.add(body);
    body.rotation.z = 0.085;
    body.rotation.x = -0.04;
    body.position.y = kit.ground(0, 0) + 1.2;
    lay.rotation.y = 0.32;
    g.add(lay);

    // A loose belly section lying open beside the tail, its ribs showing.
    const loose = new THREE.Group();
    const half = M(new THREE.CylinderGeometry(1.15, 1.2, 2.6, 20, 1, true, 0, Math.PI), std(0x9d9e99, 0.66, 0.2, { map: tex, side: THREE.DoubleSide }));
    half.rotation.z = Math.PI / 2;
    loose.add(half);
    for (let i = 0; i < 5; i++) {
      const rib = M(new THREE.TorusGeometry(1.12, 0.05, 4, 16, Math.PI), plate, -1.1 + i * 0.55, 0, 0);
      rib.rotation.y = Math.PI / 2; loose.add(rib);
    }
    loose.rotation.set(Math.PI + 0.12, 0.5, 0.06);
    loose.position.set(-9.6, kit.ground(-9.6, 1.5) + 0.75, 1.5);
    g.add(loose);

    // Scraps of sheet metal half sunk in the sand around it.
    for (let i = 0; i < 12; i++) {
      const x = -10 + rand() * 20, z = -6 + rand() * 12;
      if (Math.abs(z) < 3.5 && Math.abs(x) < 8) continue;
      const s = M(new THREE.BoxGeometry(0.3 + rand() * 0.9, 0.03, 0.2 + rand() * 0.6), i % 4 ? plate : dark, x, kit.ground(x, z) + 0.05, z);
      s.rotation.set((rand() - 0.5) * 0.5, rand() * 3, (rand() - 0.5) * 0.5); g.add(s);
    }

    // Solid to drive into: one box the size of the fuselage, along the yawed axis.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(15, 3, 3.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.5; hit.userData.collide = true;
    lay.add(hit);
    return g;
  },

  church(kit, p = {}) { return p.black ? buildBudaChurch(kit) : buildChurch(kit, { hill: p.hill ?? 0, roof: p.roof ?? 0xa3281e, walls: p.walls ?? 0xf2f0ea, scale: p.scale ?? 1.1 }); },

  arch(kit, p = {}) {
    const g = new THREE.Group();
    const rock = kit.rockMaterial();
    const s = new THREE.Shape(); s.moveTo(-12, -4); s.lineTo(12, -4); s.lineTo(11, 9); s.quadraticCurveTo(0, 12, -11, 9); s.lineTo(-12, -4);
    const hole = new THREE.Path(); hole.moveTo(-4, -4); hole.lineTo(-4, 1); hole.quadraticCurveTo(0, 7, 4, 1); hole.lineTo(4, -4); hole.lineTo(-4, -4);
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 7, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 2 }); geo.translate(0, 0, -3.5);
    const a = M(geo, rock, 0, 0, 26); g.add(a);
    g.add(M(new THREE.BoxGeometry(22, 0.8, 7), std(0x5a6a33, 0.95), 0, 9.6, 26));
    for (const [x, z] of [[-18, 34], [16, 38]]) { const c = kit.rockBox(10, 12, 10); c.position.set(x, 1, z); g.add(c); }
    return g;
  },

  // Hvítserkur: a basalt stack standing in the sea off a black beach, shaped like a drinking
  // beast, with a narrow trunk on one side and two arches at its feet. It rises from the
  // seabed, so its base runs well below the water and it stands on a low shelf at the waterline.
  stack(kit) {
    const g = new THREE.Group();
    // Heights from kit.ground are relative to this landmark; kit.baseY is its world height.
    const W0 = -kit.baseY;          // local height of the sea surface (world y = 0)
    // Walk out from the beach until the seabed is properly under water, and stand it there.
    let zs = 40;
    for (let z = 6; z < 220; z += 2) { if (kit.ground(0, z) + kit.baseY < -1.5) { zs = z + 16; break; } }
    const bed = W0 - 7;             // well below the water

    // Silhouette, in metres above sea level (x across, y up).
    const outer = [[-11, -7], [-11, 0.5], [-10.6, 6], [-10.1, 10.5], [-9.3, 13.4], [-8.5, 12.2], [-8.1, 8.5], [-7.1, 9.4], [-6.9, 14.8], [-5.2, 17.4], [-3.4, 17.1], [-2.2, 18.6], [0.4, 18.2], [1.6, 17.4], [3.4, 17.9], [5.6, 17.1], [7.6, 15.6], [9.3, 12.4], [10.4, 6.5], [10.9, 1.2], [11, -7]];
    const inPoly = (x, y) => { let c = false; for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) { const [xi, yi] = outer[i], [xj, yj] = outer[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    // Arches go all the way down to the seabed, so open water runs through them.
    const arches = [{ cx: -7.6, hw: 1.05, top: 4.8 }, { cx: 0.3, hw: 3.9, top: 3.3 }];
    const inArch = (x, y) => arches.some((A) => { const dx = (x - A.cx) / A.hw; if (Math.abs(dx) >= 1) return false; const r = Math.min(A.hw, A.top * 0.6); const knee = A.top - r; return y < knee || dx * dx + ((y - knee) / r) ** 2 < 1; });
    const solid = (x, y) => inPoly(x, y) && !inArch(x, y);

    // Fill the silhouette with jittered basalt blocks: columnar jointing, craggy front and back.
    const parts = [];
    const col = new THREE.Color();
    const cw = 0.72, ch = 0.9;
    const hash = (k) => { const v = Math.sin(k * 12.9898 + 4.1) * 43758.5453; return v - Math.floor(v); };
    for (let y = -7; y < 19; y += ch) {
      for (let x = -11; x < 11; x += cw) {
        const mx = x + cw / 2, my = y + ch / 2;
        if (!solid(mx, my)) continue;
        const thick = mx < -7.6 ? 3.2 : 6.4 - Math.max(0, my - 12) * 0.25;
        const w = cw * (0.92 + kit.rand() * 0.18), h = ch * (1.0 + kit.rand() * 0.55), d = thick * (0.82 + kit.rand() * 0.22);
        const box = new THREE.BoxGeometry(w, h, d);
        box.rotateZ((kit.rand() - 0.5) * 0.08);
        box.rotateY((kit.rand() - 0.5) * 0.12);
        box.translate(mx + (kit.rand() - 0.5) * 0.15, W0 + my, zs + (kit.rand() - 0.5) * 0.9);
        // Colour: near-black basalt; bird guano streaks down the upper faces; a little lichen
        // near the top; darker and wet at the waterline.
        // A few columns carry a guano streak from partway up the face to the top.
        const ci = Math.round(mx / cw);
        const streakFrom = 7 + hash(ci + 31) * 7;
        const streak = hash(ci) > 0.78 && my > streakFrom;
        const guano = (streak ? 0.35 + hash(ci + 7) * 0.3 : 0) + (my > 9 && kit.rand() < 0.035 ? 0.55 : 0);
        const v = 0.07 + kit.rand() * 0.05;
        col.setRGB(v * 0.95, v, v * 1.08);
        if (guano > 0) col.lerp(new THREE.Color(0.86, 0.85, 0.8), Math.min(0.85, guano * (0.6 + kit.rand() * 0.4)));
        if (my > 14 && kit.rand() < 0.06) col.lerp(new THREE.Color(0.55, 0.4, 0.24), 0.5);
        if (my < 1.2) col.multiplyScalar(0.7).lerp(new THREE.Color(0.09, 0.11, 0.08), my < 0.6 ? 0.4 : 0.15);
        col.convertSRGBToLinear(); // vertex colours are read as linear light
        const n = box.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
        box.setAttribute('color', new THREE.BufferAttribute(c, 3));
        parts.push(box.index ? box.toNonIndexed() : box);
      }
    }
    // Low rock shelf at the waterline that the legs stand on.
    for (let i = 0; i < 9; i++) {
      const x = -10 + i * 2.5, sh = lump(1.6 + kit.rand() * 0.8, kit.rand, 0.25);
      sh.translate(x, W0 + 0.1, zs + (kit.rand() - 0.5) * 3);
      const n = sh.attributes.position.count, c = new Float32Array(n * 3); for (let k = 0; k < n; k++) c.set([0.008, 0.01, 0.009], k * 3);
      sh.setAttribute('color', new THREE.BufferAttribute(c, 3));
      parts.push(sh.index ? sh.toNonIndexed() : sh);
    }
    const geo = mergeGeometries(parts);
    geo.computeVertexNormals();
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
    const m = new THREE.Mesh(geo, rock);
    m.castShadow = true; m.receiveShadow = true;
    m.rotation.y = 0.25;
    g.add(m);
    return g;
  },

  pillars(kit) {
    const g = new THREE.Group();
    const dark = std(0x262628, 0.92), moss = std(0x5d6b3f, 0.95);
    for (let i = 0; i < 46; i++) {
      const a = kit.rand() * Math.PI * 2, r = 4 + Math.sqrt(kit.rand()) * 24;
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 14, h = 3 + kit.rand() * 9;
      const p = M(new THREE.CylinderGeometry(0.8 + kit.rand() * 1.2, 1.4 + kit.rand() * 1.6, h, 7, 2), dark, x, kit.ground(x, z) + h / 2 - 0.5, z);
      p.userData.solidCircle = 1.2;
      g.add(p);
      if (kit.rand() < 0.3) g.add(M(new THREE.SphereGeometry(0.9, 8, 6), moss, x, kit.ground(x, z) + h - 0.3, z));
    }
    for (let i = 0; i < 4; i++) { const a = M(new THREE.TorusGeometry(3, 1, 8, 16, Math.PI), dark, -12 + i * 8, kit.ground(-12 + i * 8, -20) + 0.5, -20); g.add(a); }
    return g;
  },

  cave(kit) {
    const g = new THREE.Group();
    const lava = std(0x232426, 0.95);
    const shell = new THREE.SphereGeometry(9, 24, 12, Math.PI * 0.65, Math.PI * 1.7, 0, Math.PI / 2);
    const m = M(shell, new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.95, side: THREE.DoubleSide }), 0, -1, -10); g.add(m);
    for (let i = 0; i < 10; i++) { const r = M(lump(2 + kit.rand() * 2, kit.rand, 0.5), lava, Math.cos(i) * 10, kit.ground(Math.cos(i) * 10, -10 + Math.sin(i) * 9) + 0.5, -10 + Math.sin(i) * 9); g.add(r); }
    const pool = M(new THREE.CircleGeometry(5, 24), createWaterMaterial(0x35b2d8, { roughness: 0.03, ripple: 0.2, shallow: [0.3, 0.8, 0.95], deep: [0.05, 0.45, 0.7], depthAware: false, foam: 0, glow: 0.35 }), 0, -0.8, -10);
    pool.rotation.x = -Math.PI / 2; g.add(pool);
    const s = kit.makeMist(30, 5, 4); s.material = s.material.clone(); s.material.opacity = 0.2; s.position.set(0, -0.5, -10); g.add(s); kit.steam(s);
    return g;
  },

  rhyolite(kit) {
    const g = new THREE.Group();
    // The stream follows the ground a metre at a time, so it never bridges a dip.
    const pts = []; for (let i = 0; i <= 30; i++) { const x = -10 + i, z = -6 + Math.sin(i / 3) * 3; pts.push({ x, y: kit.ground(x, z) + 0.3, z }); }
    g.add(M(riverGeometry(pts, 3), createRiverMaterial({ shallow: [0.34, 0.6, 0.62], deep: [0.1, 0.3, 0.34], speed: 0.6 })));
    const s = kit.makeMist(50, 10, 6); s.material = s.material.clone(); s.material.opacity = 0.18; s.material.size = 4; s.position.set(0, kit.ground(0, -6) + 0.5, -6); g.add(s); kit.steam(s);
    // The walls reach down to the lowest corner, so the hut never hangs over a slope.
    const top = kit.ground(14, 4) + 3, low = Math.min(...[[10, 1.5], [18, 1.5], [10, 6.5], [18, 6.5]].map(([x, z]) => kit.ground(x, z))) - 0.3;
    const hut = M(new THREE.BoxGeometry(8, top - low, 5), std(HD.on ? 0xd8d4cb : 0x3f5a2f, 0.85), 14, (top + low) / 2, 4); hut.userData.solid = true; g.add(hut);
    if (HD.on) {
      // Realistic look: the box becomes a mountain hut, pale walls under a pitched green roof.
      const y = kit.ground(14, 4) + 3;
      const roofMat = std(0x2f4a33, 0.6, 0.3);
      for (const s of [-1, 1]) {
        const slab = M(new THREE.BoxGeometry(8.8, 0.16, 3.25), roofMat, 14, y + 0.82, 4 + s * 1.38);
        slab.rotation.x = s * 0.55;
        g.add(slab);
      }
      // Gable ends under the roof.
      const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -2.5), new THREE.Vector3(0, 0, 2.5), new THREE.Vector3(0, 1.7, 0)]);
      tri.computeVertexNormals();
      for (const dx of [-3.98, 3.98]) g.add(M(tri, std(0xd8d4cb, 0.85, 0, { side: THREE.DoubleSide }), 14 + dx, y, 4));
      const dark = std(0x23262a, 0.4, 0.1);
      g.add(M(new THREE.BoxGeometry(1.1, 2, 0.08), std(0x5a3b26, 0.8), 14, y - 2, 6.55));
      for (const dx of [-2.6, 2.4]) g.add(M(new THREE.BoxGeometry(1.2, 0.9, 0.08), dark, 14 + dx, y - 1.2, 6.55));
    }
    return g;
  },

  silfra(kit) {
    const g = new THREE.Group();
    for (const side of [-1, 1]) { const w = kit.rockBox(6, 8, 36); w.position.set(side * 4.2, 1, -14); w.userData.collide = true; g.add(w); }
    const water = createWaterMaterial(0x1f8fb0, { roughness: 0.02, ripple: 0.15, shallow: [0.25, 0.75, 0.85], deep: [0.03, 0.3, 0.5], clarity: 0.08, foam: 0, depthAware: false });
    const w = M(new THREE.PlaneGeometry(2.6, 34).rotateX(-Math.PI / 2), water, 0, 1.2, -14); g.add(w);
    g.add(M(new THREE.BoxGeometry(1.4, 0.2, 6), std(0x6b5137, 0.85), 0, 5.1, 2));
    return g;
  },
};
