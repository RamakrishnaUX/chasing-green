import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Four vehicles, all built in code. Units are metres, +z is forward, the ground is y = 0.

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

// ---------- Camper van ----------
// A classic bay-window bus in two-tone paint: white roof and upper body over a mint-green lower
// half, white bumpers and mint steel wheels. Down each side runs a graffiti piece painted for
// this game. The badge on the nose is a plain ring.

// The side piece: "AURORA" in chunky sunset-coloured letters with deep violet 3D edges, black
// and white outlines, shine and drips, over a violet spray burst with green aurora streaks and
// stars, plus a handstyle tag. Transparent around the burst so the mint paint shows, and cut
// clear of both wheel arches (arches: [{ x, y, r }] in pixels).
const GRAFFITI_FONT = '"Bungee", "Arial Black", Impact, system-ui, sans-serif';
const TAG_FONT = '"Sedgwick Ave Display", "Brush Script MT", cursive';
function graffitiPiece(W, H, arches) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cx = W * 0.5, cy = H * 0.52;

  // Violet spray burst: soft blobs inside a wide oval, a lighter core, spiky edges, overspray.
  const inOval = (sx, sy) => { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()); return [cx + Math.cos(a) * d * W * sx, cy + Math.sin(a) * d * H * sy]; };
  g.save(); g.shadowColor = 'rgba(80,40,150,0.9)'; g.shadowBlur = 30;
  for (let i = 0; i < 60; i++) { const [x, y] = inOval(0.36, 0.34); const r = H * (0.1 + rnd() * 0.16); g.fillStyle = rnd() < 0.5 ? '#43248a' : '#51309e'; g.beginPath(); g.ellipse(x, y, r * 1.6, r, rnd() * Math.PI, 0, Math.PI * 2); g.fill(); }
  g.restore();
  for (let i = 0; i < 26; i++) { const [x, y] = inOval(0.3, 0.22); const r = H * (0.08 + rnd() * 0.1); g.fillStyle = 'rgba(126,82,214,0.55)'; g.beginPath(); g.ellipse(x, y, r * 1.7, r, 0, 0, Math.PI * 2); g.fill(); }
  const spike = (x, y, ang, len, wid, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(x + Math.cos(ang + 1.57) * wid, y + Math.sin(ang + 1.57) * wid); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.lineTo(x + Math.cos(ang - 1.57) * wid, y + Math.sin(ang - 1.57) * wid); g.closePath(); g.fill(); };
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2 + rnd() * 0.15; const ex = cx + Math.cos(a) * W * 0.33, ey = cy + Math.sin(a) * H * 0.33; spike(ex, ey, a, H * (0.14 + rnd() * 0.16), H * 0.05, '#43248a'); }
  for (let i = 0; i < 500; i++) { const a = rnd() * Math.PI * 2, d = 0.9 + rnd() * 0.3; g.fillStyle = `rgba(75,40,140,${0.25 + rnd() * 0.55})`; g.beginPath(); g.arc(cx + Math.cos(a) * d * W * 0.37, cy + Math.sin(a) * d * H * 0.38, rnd() * 3 + 0.6, 0, Math.PI * 2); g.fill(); }

  // Aurora streaks across the burst, behind the letters.
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  for (const [y0, col, wv] of [[0.3, 'rgba(92,242,160,A)', 18], [0.42, 'rgba(70,220,255,A)', 12], [0.24, 'rgba(255,92,190,A)', 8]]) {
    for (const [w, a] of [[wv * 2.4, 0.15], [wv, 0.5], [wv * 0.35, 0.9]]) {
      g.strokeStyle = col.replace('A', a); g.lineWidth = w; g.beginPath();
      for (let x = W * 0.12; x <= W * 0.88; x += 14) { const y = H * y0 + Math.sin(x * 0.012 + y0 * 9) * H * 0.06; x === W * 0.12 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
  }
  g.restore();

  // Letters.
  const word = 'AURORA';
  const size = Math.round(H * 0.66);
  g.font = `400 ${size}px ${GRAFFITI_FONT}`;
  g.textBaseline = 'alphabetic'; g.lineJoin = 'round'; g.miterLimit = 2;
  const ws = [...word].map((ch) => g.measureText(ch).width);
  const step = 0.84, total = ws.reduce((a, b) => a + b, 0) * step;
  const scale = Math.min(1, (W * 0.6) / total);
  const L = []; let x = cx - (total * scale) / 2;
  const base = cy + size * scale * 0.34;
  [...word].forEach((ch, i) => { L.push({ ch, x, y: base + [0.02, -0.08, 0.05, -0.06, 0.07, -0.03][i] * size, rot: [-0.12, 0.06, -0.04, 0.09, -0.07, 0.1][i], s: scale * [1.12, 0.96, 1.04, 0.98, 1.06, 1.1][i] }); x += ws[i] * step * scale; });
  const each = (fn, list = L) => list.forEach((l) => { g.save(); g.translate(l.x, l.y); g.rotate(l.rot); g.scale(l.s, l.s); g.transform(1, 0, -0.12, 1, 0, 0); fn(l); g.restore(); });
  // Arrows, behind the letters.
  const arrow = (x0, y0, ang, len) => {
    g.save(); g.translate(x0, y0); g.rotate(ang);
    const t = H * 0.05;
    g.beginPath(); g.moveTo(0, -t); g.lineTo(len, -t); g.lineTo(len, -t * 2.4); g.lineTo(len + t * 3.2, 0); g.lineTo(len, t * 2.4); g.lineTo(len, t); g.lineTo(0, t); g.closePath();
    g.lineWidth = H * 0.04; g.strokeStyle = '#120a20'; g.stroke();
    const ag = g.createLinearGradient(0, 0, len + t * 3, 0); ag.addColorStop(0, '#ff3d8b'); ag.addColorStop(1, '#ffe14d'); g.fillStyle = ag; g.fill();
    g.restore();
  };
  arrow(L[0].x - size * 0.05, base - size * 0.65, -2.7, H * 0.2);
  arrow(L[5].x + size * 0.6, base - size * 0.75, -0.55, H * 0.18);
  arrow(L[3].x + size * 0.3, base - size * 0.95, -1.4, H * 0.12);
  // Deep 3D edge in violet, stepped down and to the right.
  for (let k = 22; k > 0; k -= 1.5) each((l) => { g.fillStyle = k > 12 ? '#1d0c3a' : '#2e1660'; g.fillText(l.ch, k * 0.55, k * 0.55); });
  // Outlines: thick black, then white, then the fill.
  each((l) => { g.strokeStyle = '#0d0716'; g.lineWidth = size * 0.17; g.strokeText(l.ch, 0, 0); g.strokeText(l.ch, 11, 11); });
  each((l) => { g.strokeStyle = '#ffffff'; g.lineWidth = size * 0.06; g.strokeText(l.ch, 0, 0); });
  const fill = g.createLinearGradient(0, -size * 0.75, 0, 0);
  fill.addColorStop(0, '#ffe14d'); fill.addColorStop(0.5, '#ff8a3d'); fill.addColorStop(1, '#ff3d8b');
  each((l) => {
    g.fillStyle = fill; g.fillText(l.ch, 0, 0);
    // Shine: a diagonal light band and a couple of bubbles, kept inside each letter.
    g.save(); g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.beginPath(); g.moveTo(-size * 0.1, -size * 0.2); g.lineTo(size * 0.35, -size * 0.75); g.lineTo(size * 0.5, -size * 0.75); g.lineTo(size * 0.05, -size * 0.2); g.closePath(); g.fill();
    g.fillStyle = 'rgba(120,30,90,0.35)';
    g.fillRect(-size, -size * 0.18, size * 3, size * 0.06);
    g.restore();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(size * 0.16, -size * 0.6, size * 0.035, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(size * 0.25, -size * 0.6, size * 0.018, 0, Math.PI * 2); g.fill();
  });
  // Pink drips from some letters.
  L.forEach((l, i) => { if (i % 2) return; const dx = l.x + size * l.s * (0.18 + (i % 3) * 0.1), len = H * (0.06 + (i % 3) * 0.035); g.fillStyle = '#ff3d8b'; g.strokeStyle = '#0d0716'; g.lineWidth = 3; g.beginPath(); g.roundRect(dx, l.y + 2, size * 0.05, len, size * 0.025); g.fill(); g.stroke(); g.beginPath(); g.arc(dx + size * 0.025, l.y + len + 2, size * 0.04, 0, Math.PI * 2); g.fill(); g.stroke(); });
  // Stars: two yellow ones with outlines, and white sparkles.
  const star = (x0, y0, r, rot) => { g.save(); g.translate(x0, y0); g.rotate(rot); g.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.lineWidth = r * 0.22; g.strokeStyle = '#0d0716'; g.stroke(); g.fillStyle = '#ffe14d'; g.fill(); g.restore(); };
  star(cx - W * 0.33, cy - H * 0.28, H * 0.08, 0.2);
  star(cx + W * 0.36, cy + H * 0.2, H * 0.065, -0.3);
  const sparkle = (x0, y0, r) => { g.fillStyle = '#ffffff'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, rr = i % 2 ? r * 0.2 : r; g.lineTo(x0 + Math.cos(a) * rr, y0 + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  for (let i = 0; i < 14; i++) { const [sx, sy] = inOval(0.42, 0.34); sparkle(sx, sy, H * (0.02 + rnd() * 0.04)); }
  // Handstyle tag under the piece.
  g.save(); g.translate(cx, H * 0.95); g.rotate(-0.04);
  g.font = `400 ${Math.round(H * 0.13)}px ${TAG_FONT}`; g.textAlign = 'center';
  g.lineWidth = 7; g.strokeStyle = '#0d0716'; g.strokeText('chasing green', 0, 0); g.fillStyle = '#ffffff'; g.fillText('chasing green', 0, 0);
  g.restore();
  // Keep both wheel arches clear.
  g.globalCompositeOperation = 'destination-out';
  for (const a of arches) { g.beginPath(); g.arc(a.x, a.y, a.r, 0, Math.PI * 2); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Two-tone paint in one material: the body colour below the belt line, white above it, with a
// crisp edge (y is the model's own height, so the line stays put as the van moves).
function twoTonePaint(lower, upper, beltY) {
  const m = new THREE.MeshPhysicalMaterial({ color: lower, metalness: 0.05, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uUpper = { value: new THREE.Color(upper) };
    sh.uniforms.uBelt = { value: beltY };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vModelY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvModelY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vModelY;\nuniform vec3 uUpper;\nuniform float uBelt;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uUpper, step(uBelt, vModelY));');
  };
  m.customProgramCacheKey = () => 'two-tone';
  return m;
}

function buildCamper() {
  const g = new THREE.Group();
  // Mint below the belt line, white above it, like the classic bus.
  const BELT = 1.29;
  const body = twoTonePaint(0x4cc28c, 0xf4f1e8, BELT);
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf4f1e8, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const chr = M.chrome(), gls = M.glass(), blk = M.black(), rub = M.rubber();
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfffbea, emissive: 0xfff2c8, emissiveIntensity: 0.4, roughness: 0.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0c0c, emissive: 0xff2020, emissiveIntensity: 0.5, roughness: 0.2 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xff9a2e, emissive: 0x5a2a00, roughness: 0.3 });
  const R = 0.38, track = 0.76, wb = 1.15, bw = 1.8, y0 = 0.46, archR = 0.48;
  // Rounded edges grow the shape outward by the bevel, so the outline is drawn that much inside
  // the van's real surface (b), and every detail below sits on the real surface.
  const b = 0.12;
  const ZF = 2.13, ZR = -2.1, YT = 2.02;

  // Side profile: short, tall and rounded like a bay-window bus: a big raked windscreen, a
  // bulging nose, a flat back, and real wheel arches cut out of the bottom edge.
  const s = new THREE.Shape();
  const ar = archR + b, a0 = Math.asin((y0 + b - R) / ar), dz = Math.cos(a0) * ar;
  s.moveTo(ZR + 0.1, y0 + b);
  s.quadraticCurveTo(ZR + b, y0 + b, ZR + b, 0.7);
  s.lineTo(ZR + b, 1.7);
  s.quadraticCurveTo(ZR + b, YT - b, ZR + 0.42, YT - b);
  s.lineTo(1.7, YT - b);
  s.quadraticCurveTo(ZF - 0.12 - b, YT - b, ZF - 0.1 - b, 1.78);
  s.lineTo(ZF - 0.04 - b, 1.25);
  s.quadraticCurveTo(ZF - b + 0.01, 1.0, ZF - b, 0.74);
  s.quadraticCurveTo(ZF - b, y0 + b, ZF - 0.16, y0 + b);
  s.lineTo(wb + dz, y0 + b);
  s.absarc(wb, R, ar, a0, Math.PI - a0, false);
  s.lineTo(-wb + dz, y0 + b);
  s.absarc(-wb, R, ar, a0, Math.PI - a0, false);
  s.lineTo(ZR + 0.1, y0 + b);
  const geo = new THREE.ExtrudeGeometry(s, { depth: bw - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 5, curveSegments: 22 });
  geo.translate(0, 0, -(bw - b * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  g.add(mesh(geo, body));
  // Dark wheel wells behind the arches.
  const wellMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1, side: THREE.BackSide });
  for (const z of [wb, -wb]) {
    const well = new THREE.CylinderGeometry(archR, archR, bw - 0.1, 28, 1, true); well.rotateZ(Math.PI / 2);
    g.add(mesh(well, wellMat, 0, R, z));
  }

  // Windscreen: one big pane, raked back with the nose.
  const ws = mesh(rbox(1.5, 0.5, 0.04, 0.12), gls, 0, 1.52, ZF - 0.03); ws.rotation.x = -0.12; g.add(ws);
  for (const sx of [-1, 1]) {
    const side = sx * (bw / 2 + 0.004);
    const pane = (z0, z1, y1 = 1.34, y2 = 1.8) => { const p = mesh(new THREE.PlaneGeometry(z1 - z0, y2 - y1), gls, side, (y1 + y2) / 2, (z0 + z1) / 2); p.rotation.y = sx * Math.PI / 2; g.add(p); return p; };
    pane(1.3, 1.9, 1.34, 1.78);       // cab door
    pane(0.55, 1.15);                 // sliding door window, with louvres
    for (let k = 0; k < 5; k++) g.add(mesh(rbox(0.012, 0.03, 0.58, 0.008), chr, side + sx * 0.01, 1.42 + k * 0.08, 0.85));
    pane(-0.35, 0.4); pane(-1.2, -0.5); pane(-1.95, -1.42, 1.38, 1.78);
    // A thin chrome belt line under the windows.
    g.add(mesh(rbox(0.012, 0.018, 3.9, 0.008), chr, side + sx * 0.006, BELT, 0));
    // Mirror on an arm by the cab door.
    g.add(mesh(rbox(0.03, 0.03, 0.22, 0.01), blk, sx * (bw / 2 + 0.1), 1.42, 1.92));
    g.add(mesh(rbox(0.06, 0.16, 0.12, 0.03), blk, sx * (bw / 2 + 0.2), 1.48, 2.0));
    // Nose: round lamps low and wide, indicators up by the windscreen.
    const lamp = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 28); lamp.rotateX(Math.PI / 2);
    g.add(mesh(lamp, chr, sx * 0.6, 0.86, ZF));
    g.add(mesh(new THREE.CircleGeometry(0.13, 28), lightMat, sx * 0.6, 0.86, ZF + 0.045));
    g.add(mesh(rbox(0.18, 0.09, 0.05, 0.02), amber, sx * 0.64, 1.16, ZF - 0.03));
    // Tail lights.
    g.add(mesh(rbox(0.1, 0.26, 0.05, 0.03), tailMat, sx * 0.74, 1.0, ZR - 0.01));
  }
  // Vent grille under the windscreen, a plain ring badge, plate and step bumpers.
  g.add(mesh(rbox(0.84, 0.1, 0.03, 0.02), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 }), 0, 1.16, ZF - 0.02));
  for (let i = -8; i <= 8; i++) if (i) g.add(mesh(new THREE.BoxGeometry(0.012, 0.075, 0.012), chr, i * 0.047, 1.16, ZF - 0.005));
  g.add(mesh(new THREE.TorusGeometry(0.15, 0.024, 10, 36), chr, 0, 0.92, ZF + 0.01));
  g.add(mesh(new THREE.BoxGeometry(0.44, 0.11, 0.02), M.white(), 0, 0.6, ZF + 0.06));
  for (const z of [ZF + 0.05, ZR - 0.05]) g.add(mesh(rbox(bw + 0.04, 0.1, 0.12, 0.04), white, 0, 0.53, z));
  g.add(mesh(rbox(1.1, 0.32, 0.04, 0.06), gls, 0, 1.66, ZR - 0.005));

  // Graffiti on both sides: the whole lower side below the belt line, cut clear of both arches.
  const z0 = ZR + 0.14, z1 = ZF - 0.2, panelLen = z1 - z0, panelY0 = y0 + 0.06, panelH = BELT - 0.05 - panelY0;
  const PW = 1600, PH = Math.round(PW * panelH / panelLen), px = PW / panelLen;
  for (const sx of [-1, 1]) {
    // Right side (sx = 1) runs from z1 at the left of the picture to z0; the left side the other way.
    const toU = (z) => (sx > 0 ? z1 - z : z - z0) / panelLen;
    const arches = [wb, -wb].map((z) => ({ x: toU(z) * PW, y: PH + (panelY0 - R) * px, r: (archR + 0.04) * px }));
    const tex = graffitiPiece(PW, PH, arches);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, transparent: true, alphaTest: 0.05, roughness: 0.45, metalness: 0.05 });
    const p = mesh(new THREE.PlaneGeometry(panelLen, panelH), mat, sx * (bw / 2 + 0.006), panelY0 + panelH / 2, (z0 + z1) / 2);
    p.rotation.y = sx * Math.PI / 2; p.castShadow = false;
    g.add(p);
  }

  // Steel wheels painted mint, with white centre caps.
  const cap = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, metalness: 0.3, roughness: 0.3 });
  const wheels = [];
  for (const [x, z] of [[track, wb], [-track, wb], [track, -wb], [-track, -wb]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, R, z);
    const spin = new THREE.Group();
    spin.add(buildWheel({ R, W: 0.21, style: 'road', rim: 'spoke5', rimColor: 0x4cc28c, hub: true, mirror: x < 0 }));
    const cc = new THREE.CylinderGeometry(R * 0.24, R * 0.24, 0.03, 24); cc.rotateZ(Math.PI / 2);
    spin.add(mesh(cc, cap, Math.sign(x) * 0.11, 0, 0));
    pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, spin, front: z > 0, x, z });
  }
  // A van is bigger than the cars: the whole model is scaled up. The game places the wheels,
  // lights, exhaust and camera in real-world size; the wheel pivots stay in model units.
  const S = 1.4;
  g.scale.setScalar(S);
  const outer = new THREE.Group(); outer.add(g);
  return {
    group: outer, scale: S, lightMat, tailMat, R,
    wheels: wheels.map((w) => ({ ...w, x: w.x * S, z: w.z * S })),
    headlight: [0, 0.86 * S, (ZF + 0.06) * S], exhaust: [0.42 * S, 0.42 * S, (ZR - 0.05) * S],
    camDist: 14.5, camHeight: 4.9, eye: 2.7,
  };
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
  if (kind === 'camper') return buildCamper();
  return buildJeep();
}
