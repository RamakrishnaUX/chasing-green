import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Three vehicles, all built in code. Units are metres, +z is forward, the ground is y = 0.

const rbox = (w, h, d, r = 0.06, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

function paint(color, { metal = 0.45, rough = 0.32 } = {}) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: metal, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.08 });
}
const M = {
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: 1, roughness: 0.12 }),
  black: () => new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.15, roughness: 0.62 }),
  plastic: () => new THREE.MeshStandardMaterial({ color: 0x222325, metalness: 0, roughness: 0.85 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.92 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0x8b8f94, metalness: 0.9, roughness: 0.35 }),
  carbon: () => new THREE.MeshStandardMaterial({ color: 0x101113, metalness: 0.4, roughness: 0.3 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x0b1216, metalness: 0.1, roughness: 0.07, clearcoat: 1, transparent: true, opacity: 0.78 }),
  leather: () => new THREE.MeshStandardMaterial({ color: 0x5a3420, metalness: 0, roughness: 0.6 }),
  white: () => new THREE.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0, roughness: 0.5 }),
  red: () => new THREE.MeshStandardMaterial({ color: 0xc0242b, metalness: 0.2, roughness: 0.4 }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------- Wheels ----------
// Axis is X. The outer face (rim side) points to +x; mirror for the left side.
function tireGeometry(R, W, rimR) {
  // Cross-section of the tyre, revolved around the axle.
  const pts = [];
  const sh = Math.min(0.06, W * 0.22); // shoulder rounding
  pts.push(new THREE.Vector2(rimR, -W / 2 + 0.01));
  pts.push(new THREE.Vector2(R - sh, -W / 2));
  for (let i = 0; i <= 4; i++) { const a = (-Math.PI / 2) + (i / 4) * (Math.PI / 2); pts.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, -W / 2 + sh + Math.sin(a) * sh)); }
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); pts.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, W / 2 - sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(R - sh, W / 2));
  pts.push(new THREE.Vector2(rimR, W / 2 - 0.01));
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2); // lathe axis (y) -> x
  return g;
}

function treadGeometry(R, W, style) {
  const parts = [];
  const n = style === 'offroad' ? 26 : 34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (style === 'offroad') {
      // Chunky staggered lugs.
      for (const side of [-1, 1]) {
        const b = new THREE.BoxGeometry(W * 0.36, 0.08, 0.13);
        b.translate(side * W * 0.2 + (i % 2 ? 0.02 : -0.02) * side, R + 0.02, 0);
        b.rotateX(a + (side > 0 ? 0.06 : 0));
        parts.push(b);
        // Shoulder lug wrapping down the sidewall.
        const sl = new THREE.BoxGeometry(0.05, 0.09, 0.11);
        sl.translate(side * (W / 2 + 0.01), R - 0.06, 0);
        sl.rotateX(a + (i % 2 ? 0.08 : -0.08));
        parts.push(sl);
      }
    } else if (style === 'road') {
      const b = new THREE.BoxGeometry(W * 0.75, 0.018, 0.035);
      b.translate(0, R + 0.002, 0);
      b.rotateX(a);
      parts.push(b);
    }
  }
  return parts.length ? mergeGeometries(parts) : null;
}

function buildWheel({ R, W, style = 'road', rim = 'spoke5', rimColor = 0xb9bec4, whitewall = false, mirror = false, beadlock = null, hub = null }) {
  const g = new THREE.Group();
  const rimR = R * (style === 'offroad' ? 0.58 : style === 'slick' ? 0.7 : 0.62);
  g.add(mesh(tireGeometry(R, W, rimR), M.rubber()));
  const tread = treadGeometry(R, W, style);
  if (tread) g.add(mesh(tread, M.rubber()));
  if (whitewall) {
    const ww = new THREE.RingGeometry(rimR * 1.05, rimR + (R - rimR) * 0.62, 40);
    ww.rotateY(Math.PI / 2);
    g.add(mesh(ww, M.white(), W / 2 + 0.004, 0, 0));
  }
  const rimMat = new THREE.MeshStandardMaterial({ color: rimColor, metalness: 0.95, roughness: rim === 'wire' ? 0.2 : 0.28 });
  // Rim barrel and face.
  const barrel = new THREE.CylinderGeometry(rimR, rimR, W * 0.9, 32, 1, true);
  barrel.rotateZ(Math.PI / 2);
  g.add(mesh(barrel, new THREE.MeshStandardMaterial({ color: 0x55595e, metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide })));
  const lip = new THREE.TorusGeometry(rimR, 0.018, 8, 40);
  lip.rotateY(Math.PI / 2);
  g.add(mesh(lip, rimMat, W * 0.42, 0, 0));
  const face = [];
  if (rim === 'wire') {
    for (let i = 0; i < 28; i++) {
      const sp = new THREE.CylinderGeometry(0.005, 0.005, rimR * 0.92, 4);
      sp.translate(0, rimR * 0.46, 0);
      sp.rotateX((i / 28) * Math.PI * 2);
      sp.translate(W * 0.3 + (i % 2) * 0.03, 0, 0);
      face.push(sp);
    }
    const hub = new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.3, 0.12, 16); hub.rotateZ(Math.PI / 2); hub.translate(W * 0.42, 0, 0);
    face.push(hub);
  } else {
    const spokes = rim === 'multi' ? 10 : 5;
    const disc = new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.3, 0.06, 20); disc.rotateZ(Math.PI / 2); disc.translate(W * 0.4, 0, 0);
    face.push(disc);
    for (let i = 0; i < spokes; i++) {
      const sp = new THREE.BoxGeometry(0.05, rimR * 0.78, rim === 'multi' ? 0.045 : 0.11);
      sp.translate(0, rimR * 0.5, 0);
      sp.rotateX((i / spokes) * Math.PI * 2);
      sp.translate(W * 0.38, 0, 0);
      face.push(sp);
    }
  }
  g.add(mesh(mergeGeometries(face), rimMat));
  // Lug nuts and centre cap.
  const nuts = [];
  for (let i = 0; i < 5; i++) {
    const n = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6); n.rotateZ(Math.PI / 2);
    n.translate(W * 0.44, Math.cos((i / 5) * Math.PI * 2) * rimR * 0.18, Math.sin((i / 5) * Math.PI * 2) * rimR * 0.18);
    nuts.push(n);
  }
  g.add(mesh(mergeGeometries(nuts), M.chrome()));
  // Brake disc behind the spokes.
  const brake = new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.03, 28); brake.rotateZ(Math.PI / 2);
  g.add(mesh(brake, M.metal(), -W * 0.05, 0, 0));
  // Beadlock ring: a coloured ring with bolts around the rim face.
  if (beadlock) {
    const ring = new THREE.TorusGeometry(rimR * 0.98, 0.035, 8, 40); ring.rotateY(Math.PI / 2);
    g.add(mesh(ring, new THREE.MeshPhysicalMaterial({ color: beadlock, metalness: 0.4, roughness: 0.3, clearcoat: 1 }), W * 0.46, 0, 0));
    const bolts = [];
    for (let i = 0; i < 16; i++) {
      const b = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6); b.rotateZ(Math.PI / 2);
      b.translate(W * 0.49, Math.cos((i / 16) * Math.PI * 2) * rimR * 0.98, Math.sin((i / 16) * Math.PI * 2) * rimR * 0.98);
      bolts.push(b);
    }
    g.add(mesh(mergeGeometries(bolts), M.metal()));
  }
  // Chrome hub cap (vintage wire wheels).
  if (hub) {
    const cap = new THREE.SphereGeometry(rimR * 0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); cap.rotateZ(-Math.PI / 2);
    g.add(mesh(cap, M.chrome(), W * 0.45, 0, 0));
  }
  if (mirror) g.rotation.y = Math.PI;
  return g;
}

// Extrude a side profile (z along length, y up) to a width, with rounded edges.
function profileBody(points, width, bevel = 0.1, curveSeg = 10) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.length === 2) s.lineTo(p[0], p[1]);
    else if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else s.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: curveSeg });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x (length) -> world z
  g.computeVertexNormals();
  return g;
}

// Wheel arch: a thick half ring, extruded across the wheel width.
function archGeometry(r1, r2, width, a0 = 0.15, a1 = Math.PI - 0.15) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r2, a0, a1, false);
  s.absarc(0, 0, r1, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 20 });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// ---------- Four-door off-roader ----------
function buildJeep(color = 0x8fc31f) {
  const g = new THREE.Group();
  const P = new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 });
  const blk = M.black(), pl = M.plastic(), gls = M.glass(), chr = M.chrome(), metal = M.metal();
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfafcff, emissive: 0xf2f6ff, emissiveIntensity: 0.4, roughness: 0.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0c0c, emissive: 0xff2020, emissiveIntensity: 0.5, roughness: 0.2 });
  const R = 0.5, track = 0.92, wbF = 1.62, wbR = -1.55;

  g.add(mesh(new THREE.BoxGeometry(1.3, 0.28, 4.2), blk, 0, 0.68, 0)); // frame
  // Tub with a lower body line, bonnet, cowl.
  g.add(mesh(rbox(1.8, 0.72, 4.15, 0.07), P, 0, 1.16, -0.05));
  g.add(mesh(rbox(1.66, 0.2, 1.42, 0.09), P, 0, 1.6, 1.42));
  for (const x of [-0.45, 0.45]) g.add(mesh(rbox(0.32, 0.03, 0.52, 0.012), pl, x, 1.71, 1.32));
  // Seven-slot grille, round LED headlamps with halo, fog lamps.
  g.add(mesh(rbox(1.68, 0.66, 0.1, 0.05), P, 0, 1.2, 2.14));
  for (let i = -3; i <= 3; i++) g.add(mesh(rbox(0.08, 0.4, 0.05, 0.025), blk, i * 0.12, 1.24, 2.19));
  for (const x of [-0.64, 0.64]) {
    g.add(mesh(new THREE.TorusGeometry(0.165, 0.03, 10, 28), blk, x, 1.22, 2.2));
    const lens = new THREE.CylinderGeometry(0.15, 0.15, 0.04, 28); lens.rotateX(Math.PI / 2);
    g.add(mesh(lens, lightMat, x, 1.22, 2.19));
    g.add(mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 24), lightMat, x, 1.22, 2.215)); // LED halo
  }
  // Fender flares, wide and squared off.
  for (const z of [wbF, wbR]) for (const sx of [-1, 1]) g.add(mesh(archGeometry(R + 0.08, R + 0.24, 0.36), pl, sx * (track + 0.03), R, z));
  // Windscreen, roll bar, hard top rails, tube doors.
  const ws = new THREE.Group(); ws.position.set(0, 1.68, 0.64); ws.rotation.x = -0.16;
  ws.add(mesh(rbox(1.72, 0.08, 0.08, 0.03), P, 0, 0.62, 0));
  for (const sx of [-1, 1]) ws.add(mesh(rbox(0.08, 0.68, 0.08, 0.03), P, sx * 0.83, 0.31, 0));
  ws.add(mesh(new THREE.BoxGeometry(1.6, 0.58, 0.02), gls, 0, 0.32, 0.01));
  g.add(ws);
  const tube = (pts, r = 0.035) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 24, r, 8), blk);
  for (const z of [0.1, -0.95, -1.95]) g.add(tube([[-0.82, 1.5, z], [-0.82, 2.25, z], [0.82, 2.25, z], [0.82, 1.5, z]], 0.045)); // roll cage hoops
  for (const sx of [-1, 1]) g.add(tube([[sx * 0.82, 2.25, 0.62], [sx * 0.82, 2.25, -1.95]], 0.04));
  g.add(mesh(rbox(1.7, 0.06, 2.7, 0.03), M.black(), 0, 2.29, -0.68)); // soft top panel
  for (const sx of [-1, 1]) {
    // Tube doors front and rear.
    for (const [z0, z1] of [[0.5, -0.3], [-0.42, -1.25]]) {
      g.add(tube([[sx * 0.92, 0.9, z0], [sx * 0.92, 1.45, z0], [sx * 0.92, 1.45, z1], [sx * 0.92, 0.9, z1]], 0.03));
      g.add(tube([[sx * 0.92, 1.18, z0], [sx * 0.92, 1.18, z1]], 0.02));
    }
    g.add(mesh(rbox(0.06, 0.04, 0.05, 0.01), blk, sx * 0.95, 1.72, 0.66)); // mirror arm
    g.add(mesh(rbox(0.05, 0.18, 0.24, 0.03), blk, sx * 1.02, 1.76, 0.62));
    const slider = new THREE.CylinderGeometry(0.055, 0.055, 2.3, 12); slider.rotateX(Math.PI / 2);
    g.add(mesh(slider, blk, sx * 0.97, 0.72, 0));
    // Seats visible through the open doors.
    for (const z of [-0.15, -1.05]) {
      g.add(mesh(rbox(0.55, 0.14, 0.55, 0.06), blk, sx * 0.4, 1.25, z));
      g.add(mesh(rbox(0.55, 0.6, 0.12, 0.05), blk, sx * 0.4, 1.55, z - 0.3));
    }
  }
  // Winch bumper with a red strap, fog lamps and tow hooks.
  g.add(mesh(rbox(2.0, 0.28, 0.36, 0.05), blk, 0, 0.78, 2.33));
  const winch = new THREE.CylinderGeometry(0.1, 0.1, 0.66, 18); winch.rotateZ(Math.PI / 2);
  g.add(mesh(winch, metal, 0, 0.8, 2.52));
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.3), M.red(), 0, 0.72, 2.66));
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.32, 0.06), M.red(), 0, 0.58, 2.8));
  for (const x of [-0.75, 0.75]) {
    const fog = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 18); fog.rotateX(Math.PI / 2);
    g.add(mesh(fog, lightMat, x, 0.8, 2.53));
    g.add(mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 16), M.red(), x * 0.62, 0.66, 2.52));
  }
  g.add(mesh(rbox(1.95, 0.24, 0.3, 0.05), blk, 0, 0.78, -2.2));
  for (const sx of [-1, 1]) g.add(mesh(rbox(0.12, 0.34, 0.05, 0.02), tailMat, sx * 0.84, 1.22, -2.12));
  // Snorkel up the windscreen pillar.
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.15, 14), blk, 0.98, 1.72, 0.86));
  g.add(mesh(rbox(0.17, 0.15, 0.27, 0.05), blk, 0.98, 2.33, 0.92));
  // Spare on the tailgate.
  const spare = buildWheel({ R: R * 0.95, W: 0.32, style: 'offroad', rim: 'spoke5', rimColor: 0x1b1c1e, beadlock: color });
  spare.rotation.y = -Math.PI / 2; spare.position.set(0, 1.38, -2.34);
  g.add(spare);
  // Plain "Trail" badge.
  const badge = document.createElement('canvas'); badge.width = 128; badge.height = 32;
  const bx = badge.getContext('2d'); bx.fillStyle = '#d9dde0'; bx.font = 'bold 26px sans-serif'; bx.textAlign = 'center'; bx.fillText('TRAIL', 64, 26);
  const bt = new THREE.CanvasTexture(badge); bt.colorSpace = THREE.SRGBColorSpace;
  for (const sx of [-1, 1]) {
    const b2 = mesh(new THREE.PlaneGeometry(0.34, 0.085), new THREE.MeshStandardMaterial({ map: bt, transparent: true, metalness: 0.8, roughness: 0.3 }), sx * 0.905, 1.42, 1.25);
    b2.rotation.y = sx * Math.PI / 2; g.add(b2);
  }
  const wheels = [];
  for (const [x, z] of [[track, wbF], [-track, wbF], [track, wbR], [-track, wbR]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, R, z);
    const spin = new THREE.Group();
    spin.add(buildWheel({ R, W: 0.38, style: 'offroad', rim: 'spoke5', rimColor: 0x1b1c1e, beadlock: color, mirror: x < 0 }));
    pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, spin, front: z > 0, x, z });
  }
  return { group: g, wheels, lightMat, tailMat, R, headlight: [0, 1.22, 2.3], exhaust: [0.55, 0.55, -2.25], camDist: 10.5, camHeight: 3.5, eye: 2.6 };
}

// ---------- 1930s roadster ----------
function buildVintage() {
  const g = new THREE.Group();
  // Satin paint: some reflection, not a mirror.
  const red = new THREE.MeshPhysicalMaterial({ color: 0x6e1420, metalness: 0.45, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  const cream = new THREE.MeshPhysicalMaterial({ color: 0xe8dcc0, metalness: 0.1, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.4 });
  const chr = M.chrome(), gls = M.glass(), blk = M.black();
  const leather = new THREE.MeshStandardMaterial({ color: 0xe6d6b4, roughness: 0.55 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a3a1c, roughness: 0.35, metalness: 0.05 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0xe2d5b6, roughness: 0.9 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfffbea, emissive: 0xfff2c8, emissiveIntensity: 0.4, roughness: 0.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0c0c, emissive: 0xff2020, emissiveIntensity: 0.5, roughness: 0.2 });
  const R = 0.4, track = 0.72, wbF = 1.62, wbR = -1.42;

  // Long bonnet, low doors with a cream side panel, boat tail.
  const body = profileBody([[-2.15, 0.55], [-2.45, 0.68, -2.3, 1.0, -1.75, 1.02], [-1.1, 1.04], [-0.9, 0.86], [0.2, 0.86], [0.35, 1.06], [2.0, 1.04], [2.18, 1.02, 2.15, 0.62], [2.05, 0.55]], 1.22, 0.14, 14);
  g.add(mesh(body, red));
  const panel = profileBody([[-1.7, 0.66], [-1.7, 0.9], [1.7, 0.94], [1.7, 0.7]], 1.27, 0.02, 4);
  g.add(mesh(panel, cream));
  // Fluted bonnet: chrome strips along the top and louvres on the side.
  for (let i = -3; i <= 3; i++) g.add(mesh(rbox(0.015, 0.012, 1.55, 0.005), chr, i * 0.12, 1.07, 1.2));
  for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) g.add(mesh(rbox(0.01, 0.16, 0.035, 0.005), chr, sx * 0.63, 0.92, 0.7 + i * 0.13));
  // Long sweeping front fenders down to running boards, rounded rear fenders.
  for (const sx of [-1, 1]) {
    g.add(mesh(archGeometry(R + 0.05, R + 0.17, 0.36, 0.0, Math.PI), red, sx * (track + 0.04), R, wbF));
    const sweep = mesh(rbox(0.36, 0.1, 1.15, 0.05), red, sx * (track + 0.04), 0.62, wbF - 0.85);
    sweep.rotation.x = 0.42; g.add(sweep);
    g.add(mesh(archGeometry(R + 0.05, R + 0.17, 0.38, 0.0, Math.PI), red, sx * (track + 0.04), R, wbR));
    g.add(mesh(rbox(0.34, 0.05, 1.3, 0.02), blk, sx * (track + 0.04), 0.42, 0.1));
    // Paired headlamps on the fenders and a chrome spotlamp inboard.
    const lamp = new THREE.SphereGeometry(0.17, 24, 16); lamp.scale(1, 1, 1.2);
    g.add(mesh(lamp, chr, sx * 0.55, 1.08, 2.05));
    g.add(mesh(new THREE.CircleGeometry(0.14, 24), lightMat, sx * 0.55, 1.08, 2.25));
    const spot = new THREE.SphereGeometry(0.09, 16, 10); spot.scale(1, 1, 1.3);
    g.add(mesh(spot, chr, sx * 0.3, 0.78, 2.22));
    g.add(mesh(new THREE.CircleGeometry(0.07, 18), lightMat, sx * 0.3, 0.78, 2.34));
    g.add(mesh(new THREE.SphereGeometry(0.06, 14, 10), tailMat, sx * (track + 0.04), 0.84, wbR - 0.55));
    // Chrome side exhaust pipes coming out of the bonnet.
    const pipe = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 0.62, 0.9, 1.3), new THREE.Vector3(sx * 0.72, 0.72, 0.9), new THREE.Vector3(sx * 0.74, 0.55, 0.2), new THREE.Vector3(sx * 0.74, 0.5, -0.4)]), 20, 0.045, 10);
    for (const dz of [0, -0.16]) { const pm = mesh(pipe, chr, 0, 0, dz); g.add(pm); }
    // Mirrors on the windscreen frame.
    g.add(mesh(new THREE.SphereGeometry(0.07, 14, 10), chr, sx * 0.68, 1.5, 0.35));
  }
  // Tall chrome radiator with vertical fins.
  g.add(mesh(rbox(0.62, 0.72, 0.1, 0.06), chr, 0, 0.86, 2.14));
  for (let i = -6; i <= 6; i++) g.add(mesh(rbox(0.018, 0.6, 0.05, 0.008), blk, i * 0.04, 0.86, 2.19));
  g.add(mesh(new THREE.ConeGeometry(0.035, 0.16, 10), chr, 0, 1.28, 2.12));
  // Chrome bumper with a number plate.
  const bump = new THREE.CapsuleGeometry(0.055, 1.6, 6, 16); bump.rotateZ(Math.PI / 2);
  g.add(mesh(bump, chr, 0, 0.5, 2.42));
  g.add(mesh(new THREE.BoxGeometry(0.46, 0.13, 0.02), M.black(), 0, 0.5, 2.49));
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.1, 0.01), M.white(), 0, 0.5, 2.5));
  const bump2 = new THREE.CapsuleGeometry(0.05, 1.4, 6, 16); bump2.rotateZ(Math.PI / 2);
  g.add(mesh(bump2, chr, 0, 0.5, -2.42));
  // Chrome windscreen, cream leather seats, wood steering wheel, folded cream top.
  const ws = new THREE.Group(); ws.position.set(0, 1.04, 0.32); ws.rotation.x = -0.2;
  ws.add(mesh(rbox(1.14, 0.035, 0.04, 0.015), chr, 0, 0.42, 0));
  for (const sx of [-1, 1]) ws.add(mesh(rbox(0.03, 0.44, 0.04, 0.012), chr, sx * 0.57, 0.21, 0));
  ws.add(mesh(new THREE.BoxGeometry(1.1, 0.38, 0.015), gls, 0, 0.21, 0));
  g.add(ws);
  for (const sx of [-1, 1]) {
    g.add(mesh(rbox(0.5, 0.18, 0.52, 0.08), leather, sx * 0.28, 0.9, -0.45));
    g.add(mesh(rbox(0.5, 0.52, 0.15, 0.08), leather, sx * 0.28, 1.12, -0.76));
  }
  const sw = mesh(new THREE.TorusGeometry(0.18, 0.022, 10, 28), wood, 0.28, 1.15, 0.05); sw.rotation.x = -0.5; g.add(sw);
  const top = new THREE.CylinderGeometry(0.16, 0.16, 1.18, 16); top.rotateZ(Math.PI / 2);
  g.add(mesh(top, canvas, 0, 1.12, -1.0));
  // Spare wire wheel on the tail.
  const spare = buildWheel({ R, W: 0.18, style: 'road', rim: 'wire', rimColor: 0xe6e8ea, whitewall: true, hub: true });
  spare.rotation.y = -Math.PI / 2; spare.rotation.x = -0.25; spare.position.set(0, 0.98, -2.3);
  g.add(spare);
  const wheels = [];
  for (const [x, z] of [[track, wbF], [-track, wbF], [track, wbR], [-track, wbR]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, R, z);
    const spin = new THREE.Group();
    spin.add(buildWheel({ R, W: 0.18, style: 'road', rim: 'wire', rimColor: 0xe6e8ea, whitewall: true, hub: true, mirror: x < 0 }));
    pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, spin, front: z > 0, x, z });
  }
  return { group: g, wheels, lightMat, tailMat, R, headlight: [0, 1.08, 2.3], exhaust: [0.74, 0.5, -0.5], camDist: 9, camHeight: 2.9, eye: 1.6 };
}

// ---------- Hypercar ----------
function buildRace() {
  const g = new THREE.Group();
  const P = new THREE.MeshPhysicalMaterial({ color: 0xff6a00, metalness: 0.5, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03 });
  const cf = M.carbon(), gls = new THREE.MeshPhysicalMaterial({ color: 0x050607, metalness: 0.2, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.86 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 0.6, roughness: 0.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0c0c, emissive: 0xff1010, emissiveIntensity: 0.7, roughness: 0.2 });
  const R = 0.36, track = 0.84, wbF = 1.38, wbR = -1.32;
  // Low wedge body with a sculpted nose and a low glass cabin.
  const prof = [[-2.3, 0.3], [-2.38, 0.58, -2.3, 0.8, -2.1, 0.84], [-0.7, 0.9], [-0.45, 1.1, -0.1, 1.14, 0.2, 1.1], [0.75, 0.78, 1.6, 0.64, 2.3, 0.42], [2.32, 0.24], [-2.25, 0.24]];
  const bodyGeo = profileBody(prof, 1.56, 0.16, 18);
  // Taper the nose to a point and pinch the tail, so it reads as a sculpted hypercar, not a slab.
  const bp = bodyGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const z = bp.getZ(i), y = bp.getY(i);
    let k = 1;
    if (z > 0.9) k -= (z - 0.9) * 0.3;
    if (z < -1.7) k -= (-1.7 - z) * 0.22;
    if (y > 0.92) k -= (y - 0.92) * 0.9; // narrower roof
    bp.setX(i, bp.getX(i) * Math.max(0.45, k));
  }
  bodyGeo.computeVertexNormals();
  g.add(mesh(bodyGeo, P));
  // Glass: raked windscreen, side windows and a small rear screen.
  const wsg = mesh(rbox(1.18, 0.025, 0.72, 0.01), gls, 0, 0.98, 0.5); wsg.rotation.x = -0.62; g.add(wsg);
  for (const sx of [-1, 1]) {
    const sw = mesh(rbox(0.02, 0.2, 0.86, 0.01), gls, sx * 0.735, 0.97, -0.12); sw.rotation.z = sx * 0.12; g.add(sw);
    // Wheel arches so the wheels show, and crisp haunches flaring out above the rear ones.
    for (const [z, w] of [[wbF, 0.36], [wbR, 0.42]]) g.add(mesh(archGeometry(R + 0.03, R + 0.17, w, 0.02, Math.PI - 0.02), P, sx * track, R, z));
    g.add(mesh(rbox(0.34, 0.2, 1.25, 0.09), P, sx * 0.84, 0.7, wbR + 0.05));
    g.add(mesh(rbox(0.3, 0.14, 1.0, 0.07), P, sx * 0.81, 0.62, wbF - 0.05));
    // Sill with a carbon side intake behind the door, and a shoulder crease.
    g.add(mesh(rbox(0.14, 0.2, 1.2, 0.05), P, sx * 0.8, 0.36, 0.05));
    g.add(mesh(rbox(0.06, 0.24, 0.5, 0.03), cf, sx * 0.86, 0.66, -0.62));
    g.add(mesh(rbox(0.02, 0.02, 2.4, 0.01), P, sx * 0.76, 0.84, 0.1));
    // Wraparound headlight with a light strip.
    const hl = mesh(rbox(0.46, 0.07, 0.14, 0.03), gls, sx * 0.52, 0.56, 2.08); hl.rotation.y = sx * -0.45; g.add(hl);
    const strip = mesh(rbox(0.42, 0.02, 0.02, 0.008), lightMat, sx * 0.54, 0.53, 2.14); strip.rotation.y = sx * -0.45; g.add(strip);
    g.add(mesh(rbox(0.14, 0.07, 0.1, 0.03), P, sx * 0.72, 0.95, 0.42)); // mirror
  }
  // Carbon splitter and dark lower intake under the nose.
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.04, 0.45), cf, 0, 0.16, 2.12));
  g.add(mesh(rbox(1.1, 0.16, 0.06, 0.03), cf, 0, 0.32, 2.3));
  // Bonnet vents.
  for (const sx of [-0.22, 0.22]) g.add(mesh(rbox(0.3, 0.02, 0.36, 0.01), cf, sx, 0.71, 1.5));
  // Cabin seats visible through the glass.
  for (const sx of [-0.3, 0.3]) {
    g.add(mesh(rbox(0.42, 0.12, 0.5, 0.05), M.black(), sx, 0.78, -0.2));
    g.add(mesh(rbox(0.42, 0.5, 0.12, 0.05), M.black(), sx, 0.98, -0.48));
  }
  // Rear deck, low wing, diffuser, light bar and exhausts.
  for (let i = -2; i <= 2; i++) g.add(mesh(new THREE.BoxGeometry(0.03, 0.18, 0.5), cf, i * 0.3, 0.27, -2.15));
  const wing = mesh(rbox(1.7, 0.05, 0.36, 0.02), cf, 0, 1.0, -2.0); wing.rotation.x = 0.1; g.add(wing);
  for (const sx of [-0.55, 0.55]) g.add(mesh(rbox(0.04, 0.16, 0.14, 0.01), cf, sx, 0.9, -2.0));
  g.add(mesh(rbox(1.6, 0.04, 0.03, 0.01), tailMat, 0, 0.78, -2.32));
  for (const sx of [-0.12, 0.12]) { const ex = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 14); ex.rotateX(Math.PI / 2); g.add(mesh(ex, M.metal(), sx, 0.42, -2.33)); }
  const wheels = [];
  for (const [x, z] of [[track, wbF], [-track, wbF], [track, wbR], [-track, wbR]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, R, z);
    const spin = new THREE.Group();
    spin.add(buildWheel({ R, W: z > 0 ? 0.3 : 0.36, style: 'road', rim: 'multi', rimColor: 0x141517, mirror: x < 0 }));
    pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, spin, front: z > 0, x, z });
  }
  return { group: g, wheels, lightMat, tailMat, R, headlight: [0, 0.65, 2.2], exhaust: [0, 0.42, -2.42], camDist: 8.5, camHeight: 2.4, eye: 1.25 };
}

export function buildVehicleModel(kind) {
  if (kind === 'vintage') return buildVintage();
  if (kind === 'race') return buildRace();
  return buildJeep();
}
