import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createWaterMaterial, createRiverMaterial, riverGeometry } from './materials.js';
import { KERID, keridU, keridProfile, keridWob } from './geo.js';

// New landmarks. Every builder works in the landmark's local frame: +z faces the road
// (or the sea for coastal ones), y = 0 is the ground at the landmark's centre.
// kit gives shared helpers: ground(lx, lz), rand(), makeWaterfall, makeMist, materials,
// nightLit(mat, k), auroraLit(mat, k), update(fn), emit(type, data), quality.

const lerp = (a, b, t) => a + (b - a) * t;
const std = (color, rough = 0.85, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
function M(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function gable(w, d, h, over = 0.4) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 - over, 0); s.lineTo(w / 2 + over, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d + over * 2, bevelEnabled: false });
  g.translate(0, 0, -(d + over * 2) / 2);
  return g;
}
// A lumpy rock: subdivided sphere pushed in and out.
function lump(size, rand, flat = 0.7, detail = 1) {
  const g = new THREE.IcosahedronGeometry(size, detail);
  const p = g.attributes.position;
  const k = [rand() * 6, rand() * 6, rand() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.25 * Math.sin(x * 2.3 / size + k[0]) * Math.sin(z * 1.9 / size + k[1]) + 0.15 * Math.sin(y * 3.1 / size + k[2]);
    p.setXYZ(i, x * n, y * n * flat, z * n);
  }
  g.computeVertexNormals();
  return g;
}
// Vertex-coloured block, for banded cliffs (Hengifoss) and mossy walls.
function bandedBox(w, h, d, colourAt) {
  const g = new THREE.BoxGeometry(w, h, d, 2, Math.max(4, Math.round(h / 1.2)), 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { colourAt(p.getX(i), p.getY(i) + h / 2, p.getZ(i), c); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------- Reykjavík ----------
export function buildHallgrimskirkja(kit) {
  const g = new THREE.Group();
  // Pale concrete, warmly uplit at night: the glow is strongest at the base and fades upward.
  const concrete = std(0xb9b0a3, 0.9, 0, { emissive: 0xffc27a, emissiveIntensity: 0 });
  kit.nightLit(concrete, 0.55);
  concrete.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vObjY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vObjY;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.18 + 1.1 * (1.0 - smoothstep(0.0, 34.0, vObjY));');
  };
  const parts = [];
  // A fluted column with a slanted top: an octagonal prism, squashed to a narrow pier.
  const column = (x, z, w, d, h, slope, side, rotY = 0) => {
    const c = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
    c.rotateY(Math.PI / 8);
    c.translate(0, 0.5, 0);
    const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i) * w, lz = p.getZ(i) * d;
      let y = p.getY(i) * (h + 1) - 1; // one unit below ground so it never floats
      if (p.getY(i) > 0.5) y -= side * lx * slope; // cut the top at an angle, falling outward
      p.setXYZ(i, lx, y, lz);
    }
    c.rotateY(rotY);
    c.translate(x, 0, z);
    parts.push(c);
  };

  // ---------- Tower ----------
  const TW = 8.6, TD = 7.4, TH = 50;
  const tower = new THREE.BoxGeometry(TW, TH + 1, TD); tower.translate(0, (TH + 1) / 2 - 1, 0); parts.push(tower);
  // Ribs on the tower's front corners, stepping up toward the top.
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) column(side * (TW / 2 - 0.45 - k * 0.95), TD / 2 + 0.25, 0.8, 0.9, TH - 4 + k * 1.5, 0.6, side);
  // Belfry storey and the stepped, crenellated top.
  const steps = [[TW + 0.6, 2.2, TD + 0.6], [TW - 0.8, 2.6, TD - 0.8], [TW - 2.4, 2.6, TD - 2.4], [TW - 4.0, 2.4, TD - 4.0], [TW - 5.4, 2.2, TD - 5.4]];
  let y = TH;
  for (const [w, h, d] of steps) { const s2 = new THREE.BoxGeometry(w, h, d); s2.translate(0, y + h / 2, 0); parts.push(s2); y += h;
    // Crenellations: small ribs around each step's edge.
    for (const sx of [-1, 1]) for (let k = -1; k <= 1; k++) { const r = new THREE.BoxGeometry(0.5, 1.2, 0.5); r.translate(sx * (w / 2 - 0.25), y + 0.3, k * (d / 3)); parts.push(r); const r2 = new THREE.BoxGeometry(0.5, 1.2, 0.5); r2.translate(k * (w / 3), y + 0.3, sx * (d / 2 - 0.25)); parts.push(r2); }
  }
  const cap = new THREE.ConeGeometry(1.9, 7, 4); cap.rotateY(Math.PI / 4); cap.translate(0, y + 3.5, 0); parts.push(cap);
  const topY = y + 7;

  // ---------- The wings: concave organ-pipe columns, bending back along the nave ----------
  const N = 24;
  for (const side of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const h = 6 + (TH - 10) * Math.pow(1 - t, 2.4);           // concave fall from the tower
      const x = side * (TW / 2 + 0.55 + i * 1.08);
      const back = -Math.pow(t, 1.8) * 9;                        // the outer columns curve back
      column(x, TD / 2 - 2.2 + back, 0.92, 3.4, h, 0.9, side, side * t * 0.35);
    }
  }
  // Nave behind the tower, with columns along its sides.
  const nave = new THREE.BoxGeometry(14, 15, 34); nave.translate(0, 6.5, -21); parts.push(nave);
  for (const side of [-1, 1]) for (let k = 0; k < 12; k++) column(side * 7.4, -6 - k * 2.6, 0.9, 1.2, 14, 0.4, side);

  const merged = mergeGeometries(parts.map((q) => q.index ? q.toNonIndexed() : q));
  merged.computeVertexNormals();
  const body = M(merged, concrete);
  body.userData.solid = true;
  g.add(body);
  const roof = M(gable(14.2, 34.4, 5), std(0x6c7075, 0.55, 0.35), 0, 14, -21); g.add(roof);

  // ---------- Openings that glow at night ----------
  const glow = std(0x2a2014, 0.5, 0, { emissive: 0xffb54a, emissiveIntensity: 0.05 }); kit.nightLit(glow, 2.0);
  const dark = std(0x1d1c1b, 0.7);
  // Vertical row of slit windows up the tower face.
  for (let k = 0; k < 9; k++) g.add(M(new THREE.BoxGeometry(0.45, 1.0, 0.12), k % 2 ? glow : dark, 0, 18 + k * 3.4, TD / 2 + 0.06));
  // Belfry: three pointed openings on each face.
  const lancet = (w, h) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, h - w * 0.8); sh.quadraticCurveTo(w / 2, h - w * 0.15, 0, h); sh.quadraticCurveTo(-w / 2, h - w * 0.15, -w / 2, h - w * 0.8); sh.closePath(); return new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false }); };
  for (const [fx, fz, ry] of [[0, TD / 2 + 0.32, 0], [0, -TD / 2 - 0.32, Math.PI], [TW / 2 + 0.32, 0, Math.PI / 2], [-TW / 2 - 0.32, 0, -Math.PI / 2]]) {
    for (const k of [-1, 0, 1]) { const m = M(lancet(1.0, 2.8), glow); m.position.set(fx + Math.cos(ry) * k * 1.9, TH + 0.4, fz - Math.sin(ry) * k * 1.9); m.rotation.y = ry; g.add(m); }
  }
  // Clock faces on the front and both sides.
  const face = std(0xf2efe6, 0.4, 0, { emissive: 0xfff1d0, emissiveIntensity: 0 }); kit.nightLit(face, 1.4);
  for (const [fx, fz, ry] of [[0, TD / 2 + 0.05, 0], [TW / 2 + 0.05, 0, Math.PI / 2], [-TW / 2 - 0.05, 0, -Math.PI / 2]]) {
    const c = M(new THREE.CircleGeometry(1.15, 28), face); c.position.set(fx, TH - 4.5, fz); c.rotation.y = ry; g.add(c);
    const rim = M(new THREE.TorusGeometry(1.2, 0.08, 6, 28), dark); rim.position.set(fx, TH - 4.5, fz); rim.rotation.y = ry; g.add(rim);
    for (const [len, ang] of [[0.8, 0.6], [0.55, 2.2]]) { const hnd = M(new THREE.BoxGeometry(0.07, len, 0.04), dark); hnd.position.set(fx + Math.cos(ry) * Math.sin(ang) * len / 2 * 0 , TH - 4.5 + Math.cos(ang) * len / 2, fz); hnd.rotation.set(0, ry, -ang); hnd.position.x += Math.cos(ry) * Math.sin(ang) * len / 2; hnd.position.z -= Math.sin(ry) * Math.sin(ang) * len / 2; hnd.position.addScaledVector(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)), 0.03); g.add(hnd); }
  }
  // Entrance: recessed pointed-arch surround, the tall stained-glass lancet, and the door below.
  const surround = M(lancet(4.2, 17), std(0xbab3a7, 0.85)); surround.position.set(0, 0, TD / 2 + 0.02); g.add(surround);
  const recess = M(lancet(3.4, 16.2), std(0x8e877c, 0.85)); recess.position.set(0, 0.2, TD / 2 + 0.08); g.add(recess);
  // Stained glass: vertical strips of colour inside the lancet.
  const glassCols = [0x2c5fd6, 0xd8a23a, 0xc23a3a, 0x3fa36b, 0x7d4fc9, 0x2c8fd6, 0xd8c24a];
  for (let k = 0; k < 7; k++) {
    const m = std(glassCols[k], 0.3, 0, { emissive: glassCols[k], emissiveIntensity: 0.08 }); kit.nightLit(m, 1.6);
    g.add(M(new THREE.BoxGeometry(0.28, 8.5 - Math.abs(k - 3) * 0.7, 0.1), m, -1.05 + k * 0.35, 9.5 + (8.5 - Math.abs(k - 3) * 0.7) / 2, TD / 2 + 0.22));
  }
  const glassArch = M(lancet(2.5, 10.4), std(0x2a3a5a, 0.3, 0, { emissive: 0x3a5a9a, emissiveIntensity: 0 })); kit.nightLit(glassArch.material, 0.6); glassArch.position.set(0, 7.6, TD / 2 + 0.15); g.add(glassArch);
  const door = M(new THREE.BoxGeometry(2.3, 4.6, 0.2), std(0x2a2422, 0.7), 0, 2.3, TD / 2 + 0.2); g.add(door);
  const emblem = M(new THREE.TorusGeometry(0.55, 0.12, 8, 24), std(0xb32a22, 0.5, 0, { emissive: 0x8a1a12, emissiveIntensity: 0 }), 0, 2.6, TD / 2 + 0.33); kit.nightLit(emblem.material, 0.6); g.add(emblem);
  g.add(M(new THREE.CircleGeometry(0.4, 18), emblem.material, 0, 2.6, TD / 2 + 0.32));
  // Gold cross on the very top.
  const gold = std(0xd8b84a, 0.3, 0.85);
  g.add(M(new THREE.BoxGeometry(0.22, 2.6, 0.22), gold, 0, topY + 1.3, 0));
  g.add(M(new THREE.BoxGeometry(1.2, 0.22, 0.22), gold, 0, topY + 1.9, 0));

  // ---------- Low steel railings in front of the wings ----------
  const steel = std(0x6d6f72, 0.45, 0.7);
  for (const side of [-1, 1]) {
    const x0 = side * (TW / 2 + 1.5), x1 = side * (TW / 2 + N * 1.08);
    for (let k = 0; k <= 10; k++) { const x = lerp(x0, x1, k / 10); g.add(M(new THREE.BoxGeometry(0.07, 0.9, 0.07), steel, x, 0.45, TD / 2 + 1.6 - Math.pow(k / 10, 1.8) * 8)); }
    for (let k = 0; k < 10; k++) {
      const xa = lerp(x0, x1, k / 10), xb = lerp(x0, x1, (k + 1) / 10);
      const za = TD / 2 + 1.6 - Math.pow(k / 10, 1.8) * 8, zb = TD / 2 + 1.6 - Math.pow((k + 1) / 10, 1.8) * 8;
      const L = Math.hypot(xb - xa, zb - za);
      const r = M(new THREE.BoxGeometry(0.05, 0.05, L), steel, (xa + xb) / 2, 0.88, (za + zb) / 2); r.rotation.y = Math.atan2(xb - xa, zb - za); g.add(r);
    }
  }

  // ---------- Patterned paving in front: dark stone with pale lines ----------
  const pave = M(new THREE.PlaneGeometry(64, 34), std(0x2a2b2d, 0.85), 0, 0.1, 21);
  pave.rotation.x = -Math.PI / 2; g.add(pave);
  const line = std(0xb8b5ad, 0.8);
  const strip = (x, z, w, l, rot) => { const m = M(new THREE.PlaneGeometry(w, l), line, x, 0.13, z); m.rotation.set(-Math.PI / 2, 0, rot); g.add(m); };
  for (let i = 0; i < 5; i++) { const s2 = 5 + i * 5; strip(0, 21 - s2 * 0.5, s2 * 2, 0.35, 0); strip(0, 21 + s2 * 0.5, s2 * 2, 0.35, 0); strip(-s2, 21, 0.35, s2, 0); strip(s2, 21, 0.35, s2, 0); }
  for (const r of [0.6, -0.6]) strip(0, 21, 0.35, 60, r);
  return g;
}

export function buildHarpa(kit) {
  const g = new THREE.Group();
  const frame = std(0x1d2227, 0.4, 0.7);
  // Leaning, faceted block.
  const geo = new THREE.BoxGeometry(30, 17, 20, 1, 1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setX(i, p.getX(i) + p.getZ(i) * 0.18); p.setY(i, p.getY(i) + p.getX(i) * 0.12); }
  }
  geo.computeVertexNormals();
  const body = M(geo, new THREE.MeshPhysicalMaterial({ color: 0x1b2632, metalness: 0.7, roughness: 0.1, clearcoat: 1 }), 0, 8.5, -4);
  body.userData.solid = true;
  g.add(body);
  // Glass panels in a grid on the front and side faces. Each glows its own colour at night.
  const palette = [0x2f6fd0, 0x5a3fc8, 0x2bb7c9, 0x3cc28f, 0x8a52d6, 0x1f4aa6, 0xd6e4ff];
  const panelGeo = new THREE.BoxGeometry(1.75, 1.75, 0.12);
  const count = 15 * 8 + 10 * 8;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.03, roughness: 0.06, metalness: 0.7 });
  mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader
    .replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_INSTANCING_COLOR\ndiffuseColor.rgb = vec3(0.05, 0.07, 0.09) + vColor * 0.06;\n#endif')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif'); };
  kit.nightLit(mat, 1.8, 0.03);
  const inst = new THREE.InstancedMesh(panelGeo, mat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), c = new THREE.Color();
  let n = 0;
  for (let ix = 0; ix < 15; ix++) for (let iy = 0; iy < 8; iy++) {
    v.set(-14 + ix * 2 + (iy * 0.18), 1.2 + iy * 2, 6.08);
    q.identity(); m4.compose(v, q, sc); inst.setMatrixAt(n, m4);
    inst.setColorAt(n, c.set(palette[Math.floor(kit.rand() * palette.length)])); n++;
  }
  q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  for (let iz = 0; iz < 10; iz++) for (let iy = 0; iy < 8; iy++) {
    v.set(15.2 + iy * 0.18, 1.2 + iy * 2, 5 - iz * 2);
    m4.compose(v, q, sc); inst.setMatrixAt(n, m4);
    inst.setColorAt(n, c.set(palette[Math.floor(kit.rand() * palette.length)])); n++;
  }
  inst.castShadow = true;
  g.add(inst);
  g.add(M(new THREE.BoxGeometry(31, 0.5, 21), frame, 0, 17.2, -4));
  g.add(M(new THREE.BoxGeometry(40, 0.3, 14), std(0x3a3c3f, 0.85), 0, 0.15, 12));
  return g;
}

export function buildSunVoyager() {
  const g = new THREE.Group();
  const steel = std(0xd3d8dc, 0.18, 1);
  const granite = std(0x45474a, 0.7);
  g.add(M(new THREE.CylinderGeometry(4.2, 4.6, 0.7, 40), granite, 0, 0.35, 0));
  const tube = (pts, r = 0.16) => M(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 48, r, 10), steel);
  g.add(tube([[-5.2, 2.2, 0], [-3, 1.1, 0], [0, 0.9, 0], [3, 1.1, 0], [5.4, 2.0, 0]], 0.24)); // keel
  g.add(tube([[5.4, 2.0, 0], [6.4, 3.2, 0], [7.2, 5.4, 0]], 0.18)); // bow
  g.add(tube([[-5.2, 2.2, 0], [-6.0, 3.6, 0], [-6.4, 5.0, 0]], 0.16)); // stern
  for (let i = 0; i < 7; i++) {
    const x = -3.6 + i * 1.2;
    for (const sz of [-1, 1]) g.add(tube([[x, 1.0, 0], [x + 0.2, 1.7, sz * 0.9], [x + 0.5, 2.9 + i * 0.08, sz * 1.5]], 0.09));
  }
  for (const [x, lean] of [[-1.2, -0.3], [0.6, 0.1], [2.2, 0.35]]) g.add(tube([[x, 1.0, 0], [x + lean, 3.2, 0], [x + lean * 2, 5.6, 0]], 0.08));
  for (const x of [-2.2, 2.2]) g.add(M(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 10), steel, x, 0.9, 0));
  g.rotation.y = Math.PI / 2;
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

export function buildPerlan(kit) {
  const g = new THREE.Group();
  const hill = M(new THREE.CylinderGeometry(9, 34, 9, 40, 1), std(0x4f5d36, 0.95), 0, 3.5, 0);
  g.add(hill);
  // Trees on the slopes.
  const tree = std(0x2f4a26, 0.9);
  for (let i = 0; i < 40; i++) {
    const a = kit.rand() * Math.PI * 2, r = 14 + kit.rand() * 17;
    const t = M(new THREE.ConeGeometry(0.9 + kit.rand() * 0.6, 3 + kit.rand() * 2, 7), tree, Math.cos(a) * r, 0, Math.sin(a) * r);
    t.position.y = 8 - (r - 9) * (9 / 25) + 1.5;
    g.add(t);
  }
  const tankMat = std(0xb9c0c6, 0.35, 0.65);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const t = M(new THREE.CylinderGeometry(3.1, 3.1, 9, 28), tankMat, Math.cos(a) * 7.4, 12.5, Math.sin(a) * 7.4);
    t.userData.solid = true;
    g.add(t);
  }
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xa9cad8, metalness: 0.4, roughness: 0.05, transparent: true, opacity: 0.6, clearcoat: 1, emissive: 0xffd8a0, emissiveIntensity: 0 });
  kit.nightLit(glass, 0.6);
  g.add(M(new THREE.SphereGeometry(9.6, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 17, 0));
  const frame = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(9.66, 20, 9, 0, Math.PI * 2, 0, Math.PI / 2)), new THREE.LineBasicMaterial({ color: 0xd8dde1 }));
  frame.position.y = 17;
  g.add(frame);
  return g;
}

// ---------- Hot water ----------
export function buildBlueLagoon(kit) {
  const g = new THREE.Group();
  const milky = createWaterMaterial(0x9fd8d8, { roughness: 0.3, ripple: 0.3, shallow: [0.58, 0.84, 0.84], deep: [0.36, 0.7, 0.74], clarity: 0.05, foam: 0.15, depthAware: false, glow: 0.12 });
  const lava = std(0x1c1d1f, 0.9);
  const pools = [[0, -6, 14, 8], [-16, -14, 8, 6], [14, -16, 9, 5]];
  for (const [cx, cz, rx, rz] of pools) {
    const s = new THREE.Shape();
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2, w = 1 + 0.14 * Math.sin(a * 3 + cx) + 0.08 * Math.sin(a * 7);
      const x = Math.cos(a) * rx * w, y = Math.sin(a) * rz * w;
      i ? s.lineTo(x, y) : s.moveTo(x, y);
    }
    const geo = new THREE.ShapeGeometry(s);
    geo.rotateX(-Math.PI / 2);
    let top = -1e9;
    for (let k = 0; k < 8; k++) top = Math.max(top, kit.ground(cx + Math.cos(k) * rx, cz + Math.sin(k) * rz));
    const pool = M(geo, milky, cx, top + 0.25, cz);
    g.add(pool);
    // Black lava rim around the pool.
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, w = 1.05 + kit.rand() * 0.15;
      const r = M(lump(0.7 + kit.rand() * 1.4, kit.rand, 0.6), lava, cx + Math.cos(a) * rx * w, top + 0.2, cz + Math.sin(a) * rz * w);
      g.add(r);
    }
    const steam = kit.makeMist(60, rx * 1.6, 7);
    steam.material = steam.material.clone();
    steam.material.opacity = 0.18;
    steam.material.size = 6;
    steam.position.set(cx, top + 0.4, cz);
    g.add(steam);
    kit.steam(steam);
  }
  // Boardwalk and a low turf-roofed building.
  const wood = std(0x6b5137, 0.85);
  g.add(M(new THREE.BoxGeometry(2.2, 0.3, 20), wood, 6, kit.ground(6, -2) + 0.5, -2));
  const hall = M(new THREE.BoxGeometry(16, 4, 7), std(0x26292c, 0.6, 0.2), -4, kit.ground(-4, -32) + 2, -32);
  hall.userData.solid = true;
  g.add(hall);
  g.add(M(new THREE.BoxGeometry(17, 0.8, 8), std(0x4f6233, 0.95), -4, kit.ground(-4, -32) + 4.3, -32));
  return g;
}

export function buildKerid(kit) {
  const K = KERID, g = new THREE.Group();
  const c = Math.cos(K.rot), sr = Math.sin(K.rot);
  // Crater coordinates (angle a, radius u) to the landmark's local frame.
  const toLocal = (u, a) => {
    const w = keridWob(a), cx = u * w * K.rx * Math.cos(a), cz = u * w * K.rz * Math.sin(a);
    const dx = cx * c + cz * sr, dz = -cx * sr + cz * c;               // crater frame to world offset
    const wx = K.x + dx - kit.lmX, wz = K.z + dz - kit.lmZ;           // offset from the landmark
    return [wx * kit.cs - wz * kit.sn, wx * kit.sn + wz * kit.cs];    // world offset to local
  };
  const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
  const nz = (x, z) => Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) * Math.sin(z * 0.17 - x * 0.07) * 0.5 + 0.5;
  const NR = 84, NS = 140, U0 = 0.34, U1 = 1.9;
  const pos = [], col = [], idx = [], C = new THREE.Color();
  const red = new THREE.Color(0.47, 0.19, 0.13), brown = new THREE.Color(0.33, 0.19, 0.13), moss = new THREE.Color(0.33, 0.43, 0.19);
  const lichen = new THREE.Color(0.5, 0.52, 0.42), ledge = new THREE.Color(0.2, 0.19, 0.17), scree = new THREE.Color(0.4, 0.3, 0.22), path = new THREE.Color(0.55, 0.24, 0.15);
  for (let i = 0; i <= NR; i++) {
    const u = U0 + (U1 - U0) * (i / NR);
    for (let j = 0; j <= NS; j++) {
      const a = (j / NS) * Math.PI * 2;
      const [lx, lz] = toLocal(u, a);
      const n = nz(lx, lz), streak = Math.sin(a * 46 + Math.sin(a * 9) * 4) * 0.5 + 0.5;
      // Height: the shared profile, roughened on the walls, then laid onto the land at the edge.
      let y = K.base + keridProfile(u) - kit.baseY;
      if (u > 0.47 && u < 0.8) y += (n - 0.5) * 1.6 + (streak - 0.5) * 0.5;
      const land = kit.ground(lx, lz) + 0.1;
      if (u >= 0.84) y = Math.max(y, land);
      y = THREE.MathUtils.lerp(y, land, THREE.MathUtils.smoothstep(u, 1.2, 1.9));
      pos.push(lx, y, lz);
      // Colour: scree apron, red scoria walls with moss and scree streaks, a dark ledge band,
      // the red rim path, then mossy ground outside.
      if (u < 0.47) C.copy(scree).lerp(brown, n * 0.5).multiplyScalar(0.8 + hash(lx, lz) * 0.35);
      else if (u < 0.8) {
        C.copy(red).lerp(brown, smoothstep01(streak) * 0.55 + n * 0.25);
        const m = THREE.MathUtils.smoothstep(nz(lx * 1.7 + 40, lz * 1.7), 0.55, 0.75) * (0.45 + 0.55 * THREE.MathUtils.smoothstep(u, 0.55, 0.78));
        C.lerp(moss, m);
        if (u > 0.7 && u < 0.77) C.lerp(ledge, 0.65 * (0.6 + 0.4 * n));
        C.multiplyScalar(0.85 + hash(lx, lz) * 0.25);
      } else if (u < 0.86) C.copy(Math.abs(u - 0.83) < 0.012 ? path : moss).lerp(lichen, n * 0.3);
      else C.copy(moss).lerp(lichen, nz(lx * 2, lz * 2) * 0.45).multiplyScalar(0.85 + hash(lx, lz) * 0.2);
      C.convertSRGBToLinear();
      col.push(C.r, C.g, C.b);
    }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) { const a0 = i * (NS + 1) + j, b0 = a0 + NS + 1; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const surf = M(geo, std(0xffffff, 0.95, 0, { vertexColors: true, side: THREE.DoubleSide }));
  g.add(surf);
  // The teal lake, filling the floor inside the scree apron.
  const lakeY = K.base - 17.8 - kit.baseY, lp = [0, lakeY, 0], li = [];
  const [cx0, cz0] = toLocal(0, 0); lp[0] = cx0; lp[2] = cz0;
  for (let j = 0; j <= 96; j++) { const [x, z] = toLocal(0.42, (j / 96) * Math.PI * 2); lp.push(x, lakeY, z); if (j) li.push(0, j, j + 1); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setIndex(li); lg.computeVertexNormals();
  const water = createWaterMaterial(0x1d5f58, { roughness: 0.18, ripple: 0.3, shallow: [0.1, 0.42, 0.36], deep: [0.02, 0.16, 0.15], clarity: 0.3, foam: 0.08, depthAware: false });
  water.side = THREE.DoubleSide;
  g.add(M(lg, water));
  // Boulders on the scree apron and along the ledges.
  const rock = std(0x4a3c34, 0.95);
  for (let k = 0; k < 46; k++) {
    const u = k < 30 ? 0.42 + kit.rand() * 0.06 : 0.7 + kit.rand() * 0.06, a = kit.rand() * Math.PI * 2;
    const [x, z] = toLocal(u, a);
    const s = 0.5 + kit.rand() * 1.3;
    const b = M(new THREE.DodecahedronGeometry(s, 0), rock, x, K.base + keridProfile(u) - kit.baseY + s * 0.3, z);
    b.rotation.set(kit.rand() * 3, kit.rand() * 3, kit.rand() * 3); b.scale.y = 0.65; g.add(b);
  }
  return g;
}
const smoothstep01 = (x) => x * x * (3 - 2 * x);

export function buildHverir(kit) {
  const g = new THREE.Group();
  // Mineral-stained ground: orange, ochre, sulphur yellow and grey.
  const geo = new THREE.CircleGeometry(32, 48, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, kit.ground(x, z) + 0.12);
    const n = Math.sin(x * 0.31) * Math.sin(z * 0.27) * 0.5 + 0.5, m = Math.sin(x * 0.9 + z * 0.6) * 0.5 + 0.5;
    c.setRGB(0.72, 0.42, 0.2).lerp(new THREE.Color(0.8, 0.66, 0.32), n).lerp(new THREE.Color(0.55, 0.52, 0.5), m * 0.35);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  g.add(M(geo, std(0xffffff, 0.95, 0, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 })));
  // Steaming fumarole cairns.
  const stone = std(0x8b7c62, 0.9);
  for (const [x, z, h] of [[-10, -8, 3.5], [6, -14, 2.6], [14, 2, 3], [-4, 6, 2.2]]) {
    const cairn = M(new THREE.ConeGeometry(2.2, h, 9, 3), stone, x, kit.ground(x, z) + h / 2, z);
    g.add(cairn);
    const s = kit.makeMist(70, 1.6, 16);
    s.material = s.material.clone(); s.material.opacity = 0.3; s.material.size = 4.5;
    s.position.set(x, kit.ground(x, z) + h, z);
    g.add(s); kit.steam(s, 1.6);
  }
  // Bubbling mud pots.
  const mud = std(0x5d625f, 0.35);
  const bubbles = [];
  for (const [x, z] of [[2, -4], [-6, -2], [9, -6], [-1, 10]]) {
    const y = kit.ground(x, z) + 0.15;
    g.add(M(new THREE.CircleGeometry(1.8, 20).rotateX(-Math.PI / 2), mud, x, y, z));
    for (let k = 0; k < 3; k++) {
      const b = M(new THREE.SphereGeometry(0.3, 10, 8), mud, x + (kit.rand() - 0.5) * 2, y, z + (kit.rand() - 0.5) * 2);
      b.userData.phase = kit.rand() * 6;
      bubbles.push(b);
      g.add(b);
    }
  }
  kit.update((dt, t) => {
    for (const b of bubbles) { const s = Math.max(0, Math.sin(t * 1.7 + b.userData.phase)); b.scale.setScalar(0.2 + s * 1.2); }
  });
  return g;
}

export function buildHveravellir(kit) {
  const g = new THREE.Group();
  const sinter = std(0xe2ddcf, 0.8);
  const hot = createWaterMaterial(0x39b4d6, { roughness: 0.1, ripple: 0.2, shallow: [0.3, 0.75, 0.85], deep: [0.05, 0.4, 0.6], clarity: 0.2, foam: 0, depthAware: false, glow: 0.18 });
  for (const [x, z, r] of [[0, -6, 3], [-8, -12, 2], [7, -14, 2.4]]) {
    const y = kit.ground(x, z);
    g.add(M(new THREE.CylinderGeometry(r + 1.4, r + 2.2, 0.6, 28), sinter, x, y + 0.2, z));
    const pool = M(new THREE.CircleGeometry(r, 28), hot, x, y + 0.52, z);
    pool.rotation.x = -Math.PI / 2;
    g.add(pool);
    const s = kit.makeMist(50, r, 9);
    s.material = s.material.clone(); s.material.opacity = 0.24; s.material.size = 4;
    s.position.set(x, y + 0.6, z);
    g.add(s); kit.steam(s, 0.8);
  }
  const hut = M(new THREE.BoxGeometry(6, 3, 4), std(0x8c5a3c, 0.8), 12, kit.ground(12, 6) + 1.5, 6);
  hut.userData.solid = true;
  g.add(hut);
  g.add(M(gable(6, 4, 1.8), std(0xa3281e, 0.55, 0.3), 12, kit.ground(12, 6) + 3, 6));
  return g;
}

// ---------- Geyser ----------
const PLUME_FRAG = /* glsl */ `
uniform float uTime; uniform float uAmt; uniform float uLight; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  float body = n(vec2(vUv.x * 9.0, vUv.y * 5.0 - uTime * 3.0)) * 0.6 + n(vec2(vUv.x * 21.0, vUv.y * 11.0 - uTime * 5.0)) * 0.4;
  float a = smoothstep(0.25, 0.7, body) * smoothstep(1.0, 0.7, vUv.y) * uAmt;
  gl_FragColor = vec4(vec3(0.96, 0.97, 0.98) * (0.45 + uLight * 0.6), a);
}`;
export function buildStrokkur(kit) {
  const g = new THREE.Group();
  const prof = [[10, -0.2], [7, 0.3], [3.4, 0.8], [2.0, 0.65], [1.7, 0.25]].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(M(new THREE.LatheGeometry(prof, 48), std(0xd9d3c3, 0.7)));
  const pool = M(new THREE.CircleGeometry(1.75, 32), createWaterMaterial(0x2a9fc4, { roughness: 0.05, ripple: 0.6, shallow: [0.25, 0.7, 0.85], deep: [0.02, 0.25, 0.45], depthAware: false, foam: 0, glow: 0.15 }), 0, 0.3, 0);
  pool.rotation.x = -Math.PI / 2;
  g.add(pool);
  const domeMat = new THREE.MeshPhysicalMaterial({ color: 0x5cc6e8, roughness: 0.05, transparent: true, opacity: 0.75, clearcoat: 1, emissive: 0x0d4f6b, emissiveIntensity: 0.6 });
  const dome = M(new THREE.SphereGeometry(1.75, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, 0, 0.3, 0);
  dome.scale.y = 0.01;
  g.add(dome);
  const plumeMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: PLUME_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: kit.waterUniforms.uTime, uLight: kit.waterUniforms.uLight, uAmt: { value: 0 } },
  });
  const plume = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.4, 1, 24, 8, true), plumeMat);
  plume.geometry.translate(0, 0.5, 0);
  plume.position.y = 0.3;
  plume.scale.y = 0.01;
  g.add(plume);
  const steam = kit.makeMist(60, 3, 8);
  steam.material = steam.material.clone(); steam.material.opacity = 0.22; steam.material.size = 4;
  steam.position.y = 0.4;
  g.add(steam); kit.steam(steam, 0.7);
  // Cycle: wait, warning bulge, eruption, settle.
  let phase = 'wait', timer = 25 + kit.rand() * 30;
  kit.update((dt) => {
    timer -= dt;
    if (phase === 'wait' && timer <= 0) { phase = 'warn'; timer = 2.6; kit.emit('geyser-warning'); }
    else if (phase === 'warn') {
      dome.scale.y = 0.2 + (1 - timer / 2.6) * 1.1;
      if (timer <= 0) { phase = 'erupt'; timer = 4.5; dome.scale.y = 0.01; kit.emit('geyser-erupt'); }
    } else if (phase === 'erupt') {
      const k = 1 - timer / 4.5;
      const rise = Math.min(1, k * 5);
      plume.scale.set(1 + k * 1.5, 0.5 + rise * 22 * (1 - Math.max(0, k - 0.55) * 0.9), 1 + k * 1.5);
      plumeMat.uniforms.uAmt.value = Math.min(1, rise) * (1 - Math.max(0, (k - 0.6) / 0.4));
      if (timer <= 0) { phase = 'wait'; timer = 60 + kit.rand() * 80; plumeMat.uniforms.uAmt.value = 0; plume.scale.y = 0.01; }
    }
  });
  return g;
}

// ---------- Waterfalls ----------
export function buildSvartifoss(kit) {
  const g = new THREE.Group();
  const fall = kit.makeWaterfall({ width: 2.4, height: 20, cliffWidth: 8 });
  fall.group.position.z = -8;
  g.add(fall.group); kit.mists(fall.mists);
  // Amphitheatre of black basalt columns hanging from the rim.
  const colGeo = new THREE.CylinderGeometry(0.72, 0.72, 1, 6);
  const dark = std(0x1d1e20, 0.75), darker = std(0x141516, 0.7);
  for (let a = -1.9; a <= 1.9; a += 0.085) {
    if (Math.abs(a) < 0.16) continue;
    const R = 9.5, x = Math.sin(a) * R, z = -8 - Math.cos(a) * R * 0.6 + 2;
    const len = 6 + Math.abs(Math.sin(a * 7.3)) * 7 + kit.rand() * 2;
    const col = M(colGeo, kit.rand() < 0.5 ? dark : darker, x, 22 - len / 2, z);
    col.scale.set(1, len, 1);
    g.add(col);
    const wall = kit.rockBox(1.4, 22 - len + 1, 3);
    wall.position.set(x * 1.04, (22 - len) / 2, z - 1.2);
    wall.userData.collide = true;
    g.add(wall);
  }
  return g;
}

export function buildGodafoss(kit) {
  const g = new THREE.Group();
  const R = 16, H = 10;
  // Upper river on a rock shelf behind the horseshoe.
  const shelf = kit.rockBox(70, H, 34);
  shelf.position.set(0, H / 2 - 0.5, -R - 15);
  shelf.userData.collide = true;
  g.add(shelf);
  const river = createRiverMaterial({ shallow: [0.24, 0.5, 0.52], deep: [0.04, 0.16, 0.2], speed: 1.8 });
  const up = [];
  for (let i = 0; i <= 12; i++) up.push({ x: Math.sin(i * 0.4) * 3, y: H + 0.2 - i * 0.02, z: -R - 32 + i * 2.3 });
  g.add(M(riverGeometry(up, 22), river));
  // The horseshoe: rock blocks around the arc, water pouring off most of them.
  for (let i = 0; i <= 14; i++) {
    const a = -1.6 + (i / 14) * 3.2;
    const x = Math.sin(a) * R, z = -Math.cos(a) * R;
    const block = kit.rockBox(4.4, H, 6);
    block.position.set(x * 1.08, H / 2 - 0.5, z * 1.08);
    block.rotation.y = -a;
    block.userData.collide = true;
    g.add(block);
    if (i % 4 !== 3) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(4.2, H + 0.5, 4, 10), kit.fallMaterial(0xe1eef4, 2.4 + kit.rand(), 1.0));
      const rin = (R * 1.08 - 3.3) / R;
      f.position.set(x * rin, H / 2, z * rin);
      f.rotation.y = -a;
      g.add(f);
    }
  }
  const pool = M(new THREE.CircleGeometry(R * 0.95, 40), createWaterMaterial(0x1d4f58, { roughness: 0.08, ripple: 1.2, shallow: [0.2, 0.46, 0.48], deep: [0.03, 0.13, 0.17], foam: 0.8 }), 0, 0.3, -2);
  pool.rotation.x = -Math.PI / 2;
  g.add(pool);
  const mist = kit.makeMist(70, R * 1.4, 6);
  mist.position.set(0, 0.4, -R * 0.5);
  mist.material.size = 3;
  mist.material.opacity = 0.22;
  g.add(mist); kit.mists([mist]);
  // River running out toward the road.
  const out = [];
  for (let i = 0; i <= 10; i++) out.push({ x: Math.sin(i * 0.5) * 2, y: 0.32 - i * 0.03, z: 2 + i * 2.2 });
  g.add(M(riverGeometry(out, 10), river));
  return g;
}

export function buildGljufrabui(kit) {
  const g = new THREE.Group();
  // A cliff split by a narrow gorge; the waterfall hides inside it.
  for (const side of [-1, 1]) {
    const b = kit.rockBox(14, 26, 18);
    b.position.set(side * 8.8, 12.5, -9);
    b.userData.collide = true;
    g.add(b);
  }
  const back = kit.rockBox(6, 26, 8);
  back.position.set(0, 12.5, -16);
  g.add(back);
  const lip = kit.rockBox(5, 6, 9);
  lip.position.set(0, 24, -7);
  g.add(lip);
  const f = kit.makeWaterfall({ width: 1.8, height: 22, cliffWidth: 4 });
  f.group.position.set(0, 0, -11.4);
  g.add(f.group); kit.mists(f.mists);
  const river = createRiverMaterial({ shallow: [0.22, 0.45, 0.45], deep: [0.04, 0.14, 0.16], speed: 2.4 });
  const pts = [];
  for (let i = 0; i <= 10; i++) pts.push({ x: Math.sin(i * 0.6) * 0.8, y: kit.ground(0, -6 + i * 2.6) + 0.25 - i * 0.03, z: -6 + i * 2.6 });
  g.add(M(riverGeometry(pts, 2.6), river));
  return g;
}

export function buildHengifoss(kit) {
  const g = new THREE.Group();
  // Basalt cliff striped with thin red clay layers.
  const banded = std(0xffffff, 0.9, 0, { vertexColors: true });
  const colourAt = (x, y, z, c) => {
    const band = Math.sin(y * 0.55 + Math.sin(x * 0.1) * 0.6);
    c.setRGB(0.17, 0.16, 0.16);
    if (band > 0.72) c.setRGB(0.55, 0.22, 0.13);
    else if (band > 0.55) c.setRGB(0.4, 0.2, 0.14);
  };
  for (let i = 0; i <= 10; i++) {
    const a = -1.3 + (i / 10) * 2.6, R = 16;
    const b = M(bandedBox(6.4, 48, 9, colourAt), banded, Math.sin(a) * R, 23.5, -Math.cos(a) * R - 6);
    b.rotation.y = -a;
    b.userData.solid = true;
    g.add(b);
  }
  const f = kit.makeWaterfall({ width: 2.2, height: 44, cliffWidth: 6 });
  f.group.position.set(0, 0, -16.5);
  g.add(f.group); kit.mists(f.mists);
  return g;
}

// ---------- Canyons and cliffs ----------
// Two mossy walls along a winding path, with a river between them.
function canyonWalls(kit, path, { wall = 18, gap = 7, moss = true, river = true }) {
  const g = new THREE.Group();
  const mat = std(0xffffff, 0.92, 0, { vertexColors: true });
  for (const side of [-1, 1]) {
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    path.forEach((p, i) => {
      const q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
      const dx = q.x - o.x, dz = q.z - o.z, L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L * side, nz = dx / L * side;
      const top = wall + Math.sin(i * 0.9 + side) * 2 + kit.rand() * 1.5;
      const prof = [[gap / 2, -2], [gap / 2 + 0.6, top * 0.5], [gap / 2 + 1.0, top], [gap / 2 + 9, top + 0.5], [gap / 2 + 22, -1]];
      for (const [off, y] of prof) {
        const base = kit.ground(p.x + nx * off, p.z + nz * off);
        pos.push(p.x + nx * off, Math.max(base, 0) + y * (y > 0 ? 1 : 0) + Math.min(0, y), p.z + nz * off);
        const mossy = moss && (y >= top - 0.01 || Math.sin(i * 2.1 + y) > 0.35);
        c.setRGB(0.2, 0.2, 0.19);
        if (mossy) c.setRGB(0.3, 0.42, 0.17);
        col.push(c.r, c.g, c.b);
      }
      if (i < path.length - 1) for (let k = 0; k < 4; k++) { const a = i * 5 + k, b = a + 5; side > 0 ? idx.push(a, a + 1, b, a + 1, b + 1, b) : idx.push(a, b, a + 1, a + 1, b, b + 1); }
      // Invisible blocker so the car cannot drive through the wall.
      if (i % 2 === 0) {
        const blk = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3));
        blk.visible = false;
        blk.position.set(p.x + nx * (gap / 2 + 2), 1, p.z + nz * (gap / 2 + 2));
        blk.userData.solid = true;
        g.add(blk);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(M(geo, mat));
  }
  if (river) {
    const pts = path.map((p, i) => ({ x: p.x, y: kit.ground(p.x, p.z) + 0.35 + (path.length - i) * 0.04, z: p.z }));
    g.add(M(riverGeometry(pts, gap * 0.85), createRiverMaterial({ shallow: [0.2, 0.42, 0.4], deep: [0.04, 0.13, 0.14], speed: 2 })));
  }
  return g;
}

export function buildFjadrargljufur(kit) {
  const path = [];
  for (let i = 0; i <= 30; i++) path.push({ x: Math.sin(i * 0.28) * 7, z: -8 - i * 3.4 });
  return canyonWalls(kit, path, { wall: 20, gap: 8 });
}

export function buildAsbyrgi(kit) {
  const g = new THREE.Group();
  const R = 28;
  for (let i = 0; i <= 22; i++) {
    const a = -1.75 + (i / 22) * 3.5;
    const b = kit.rockBox(10.5, 24 + Math.sin(i) * 2, 8);
    b.position.set(Math.sin(a) * R, 11.5, -Math.cos(a) * R * 0.85 - 24);
    b.rotation.y = -a;
    b.userData.collide = true;
    g.add(b);
  }
  // Birch woods on the canyon floor.
  const trunk = std(0xd9d3c6, 0.9), crowns = [0x9c8a2e, 0xb58f35, 0x6f7a32, 0x8d6a2a].map((c) => std(c, 0.9));
  for (let i = 0; i < 70; i++) {
    const a = (kit.rand() - 0.5) * 3.6, r = kit.rand() * R * 0.8;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r * 0.85 - 24;
    const y = kit.ground(x, z), h = 3 + kit.rand() * 3;
    const t = M(new THREE.CylinderGeometry(0.08, 0.13, h, 5), trunk, x, y + h / 2, z);
    t.userData.solidCircle = 0.4;
    g.add(t);
    const cr = M(new THREE.IcosahedronGeometry(1 + kit.rand() * 0.6, 1), crowns[i % 4], x, y + h, z);
    cr.scale.y = 1.5;
    g.add(cr);
  }
  const pond = M(new THREE.CircleGeometry(6, 28), createWaterMaterial(0x203d38, { shallow: [0.2, 0.36, 0.3], deep: [0.03, 0.1, 0.09], foam: 0.3 }), 0, kit.ground(0, -58) + 0.3, -58);
  pond.rotation.x = -Math.PI / 2;
  g.add(pond);
  return g;
}

export function buildDyrholaey(kit) {
  const g = new THREE.Group();
  // The headland with its sea arch, standing in the sea south of the road.
  const s = new THREE.Shape();
  s.moveTo(-34, -6); s.lineTo(34, -6); s.lineTo(32, 18); s.quadraticCurveTo(10, 26, -30, 22); s.lineTo(-34, -6);
  const hole = new THREE.Path();
  hole.moveTo(4, -6); hole.lineTo(4, 6); hole.quadraticCurveTo(12, 17, 20, 6); hole.lineTo(20, -6); hole.lineTo(4, -6);
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 18, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2 });
  geo.translate(-12, 0, -9);
  const rock = kit.rockMaterial();
  const arch = M(geo, rock, 0, 0, 72);
  g.add(arch);
  const cap = M(new THREE.BoxGeometry(62, 1.2, 18), std(0x4c5d2c, 0.95), -12, 23.4, 72);
  g.add(cap);
  // Lighthouse on top.
  const white = std(0xf1efe8, 0.7), red = std(0xb3261e, 0.5, 0.2);
  g.add(M(new THREE.BoxGeometry(5, 8, 5), white, -30, 28, 72));
  g.add(M(new THREE.BoxGeometry(2.4, 2.2, 2.4), white, -30, 33.2, 72));
  const lamp = std(0x332200, 0.3, 0, { emissive: 0xfff0b0, emissiveIntensity: 0 });
  kit.nightLit(lamp, 3);
  g.add(M(new THREE.CylinderGeometry(1, 1, 1.6, 12), lamp, -30, 35, 72));
  g.add(M(new THREE.ConeGeometry(1.4, 1.4, 12), red, -30, 36.4, 72));
  for (const [x, z, h] of [[24, 92, 14], [34, 98, 9]]) g.add(M(new THREE.CylinderGeometry(1.4, 3.6, h, 6, 3), rock, x, h / 2 - 3, z));
  return g;
}

export function buildSkaftafell(kit) {
  const g = new THREE.Group();
  // Glacier tongue sliding down toward the valley, with blue crevasses and ash bands.
  const geo = new THREE.BoxGeometry(34, 16, 80, 16, 4, 32);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (z + 40) / 80; // 0 at the snout, 1 at the back
    x *= 0.55 + t * 0.6;
    y = y > 0 ? y * (0.25 + t * 1.2) + Math.sin(x * 0.8 + z * 0.3) * 0.5 : y;
    p.setXYZ(i, x, y, z);
    const crev = Math.abs(Math.sin(z * 0.9 + Math.sin(x * 0.2) * 2));
    c.setRGB(0.88, 0.93, 0.97).lerp(new THREE.Color(0.45, 0.66, 0.82), crev < 0.15 ? 0.8 : 0);
    if (Math.sin(z * 0.35 + x * 0.05) > 0.9) c.lerp(new THREE.Color(0.35, 0.35, 0.36), 0.5);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ice = M(geo, std(0xffffff, 0.45, 0, { vertexColors: true }), 0, 4, -52);
  ice.userData.solid = true;
  g.add(ice);
  // Dark moraine in front, and a signpost.
  const moraine = std(0x3b3a38, 0.95);
  for (let i = 0; i < 16; i++) g.add(M(lump(1.5 + kit.rand() * 2, kit.rand, 0.5), moraine, -14 + i * 1.9, kit.ground(-14 + i * 1.9, -10), -10 - kit.rand() * 3));
  const wood = std(0x6b4e32, 0.85);
  g.add(M(new THREE.BoxGeometry(0.25, 2.6, 0.25), wood, 6, kit.ground(6, 8) + 1.3, 8));
  g.add(M(new THREE.BoxGeometry(2.6, 0.9, 0.12), wood, 6, kit.ground(6, 8) + 2.4, 8));
  return g;
}

// ---------- Beaches and lava ----------
export function iceMaterial(quality) {
  // Translucent, refracting glacier ice with a faint blue core. Transmission is skipped on Low.
  return new THREE.MeshPhysicalMaterial({
    color: 0xe8f6fc, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    transmission: quality === 'low' ? 0 : 0.88, thickness: 1.4, ior: 1.31,
    attenuationColor: new THREE.Color(0x5aa8d0), attenuationDistance: 2.2,
    emissive: new THREE.Color(0x0a2a3c), emissiveIntensity: 0.35, specularIntensity: 1, flatShading: true,
  });
}

export function buildDiamondBeach(kit) {
  const g = new THREE.Group();
  const mats = [iceMaterial(kit.quality), iceMaterial(kit.quality)];
  mats[1].attenuationColor.set(0x3f86c0);
  mats.forEach((m) => kit.auroraLit(m, 0.5));
  for (let i = 0, tries = 0; i < 46 && tries < 400; tries++) {
    const s = 0.25 + Math.pow(kit.rand(), 2.5) * 1.1;
    const x = (kit.rand() - 0.5) * 80, z = 2 + kit.rand() * 10;
    if (kit.roadDist(x, z) < 8 || kit.ground(x, z) < -0.3) continue;
    i++;
    const m = M(kit.iceGeometry(s, kit.rand), mats[i % 2], x, kit.ground(x, z) + s * 0.25, z);
    m.rotation.set(kit.rand() * 0.6, kit.rand() * 6, kit.rand() * 0.6);
    if (s > 0.8) m.userData.solidCircle = s * 0.9;
    g.add(m);
  }
  return g;
}

export function buildEldhraun(kit) {
  // Thick woolly moss over lava hummocks, with dark rock showing through here and there.
  const count = kit.quality === 'low' ? 160 : 320;
  const geo = lump(1, kit.rand, 0.55, 1);
  const inst = new THREE.InstancedMesh(geo, std(0xffffff, 0.98), count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = kit.rand() * Math.PI * 2, r = Math.sqrt(kit.rand()) * 34;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 18;
    const s = 0.9 + kit.rand() * 2.2;
    v.set(x, kit.ground(x, z) + s * 0.15, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), kit.rand() * 6);
    sc.set(s * (1 + kit.rand() * 0.4), s * 0.7, s);
    m4.compose(v, q, sc);
    inst.setMatrixAt(i, m4);
    c.setRGB(0.52, 0.56, 0.42).lerp(new THREE.Color(0.62, 0.66, 0.5), kit.rand());
    if (kit.rand() < 0.12) c.setRGB(0.15, 0.15, 0.14);
    inst.setColorAt(i, c);
  }
  inst.receiveShadow = true;
  inst.castShadow = true;
  const g = new THREE.Group();
  g.add(inst);
  const wood = std(0x6b5137, 0.85);
  for (let i = 0; i < 12; i++) g.add(M(new THREE.BoxGeometry(1.6, 0.2, 2.2), wood, Math.sin(i * 0.3) * 2, kit.ground(Math.sin(i * 0.3) * 2, 4 - i * 2.2) + 0.5, 4 - i * 2.2));
  return g;
}

// ---------- Churches ----------
export function buildChurch(kit, { hill = 8, roof = 0xa3281e, scale = 1, walls = 0xf2f0ea } = {}) {
  const g = new THREE.Group();
  if (hill > 0) g.add(M(new THREE.CylinderGeometry(7, 20, hill, 36), std(0x5b6a3a, 0.95), 0, hill / 2 - 0.5, 0));
  const c = new THREE.Group();
  c.position.y = hill;
  c.scale.setScalar(scale);
  const white = std(walls, 0.75), r = std(roof, 0.5, 0.3);
  const glow = std(0x332200, 0.4, 0, { emissive: 0xffc76a, emissiveIntensity: 0 });
  kit.nightLit(glow, 1.4);
  const nave = M(new THREE.BoxGeometry(6, 4.2, 10), white, 0, 2.1, -1);
  nave.userData.solid = true;
  c.add(nave);
  c.add(M(gable(6, 10, 2.8), r, 0, 4.2, -1));
  c.add(M(new THREE.BoxGeometry(2.6, 7.5, 2.6), white, 0, 3.75, 5));
  const spire = M(new THREE.ConeGeometry(1.95, 4.5, 4), r, 0, 9.75, 5);
  spire.rotation.y = Math.PI / 4;
  c.add(spire);
  for (const x of [-3.01, 3.01]) for (const z of [-4, -1, 2]) c.add(M(new THREE.BoxGeometry(0.05, 1.3, 0.8), glow, x, 2.4, z));
  c.add(M(new THREE.BoxGeometry(1.2, 2.2, 0.05), glow, 0, 1.1, 6.32));
  g.add(c);
  return g;
}
