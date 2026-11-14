// The Ring Road's bridges, built the way Iceland builds them (where they stand and how high the
// deck runs is worked out in terrain.js; this draws them):
// - concrete: the newer two-lane bridges (Þjórsá, Markarfljót, Hvítá). A concrete deck slab on a
//   box girder, thick edge beams, wall piers with pointed cutwaters facing the current.
// - onelane: the einbreið brú of the sandur (Gígjukvísl). A thin deck on four steel I-girders, short
//   spans on many slim piers, a joint over each one, yellow-and-black end markers and the blue
//   "Einbreið brú" sign on each approach.
// - truss: the steel truss over Jökulsá á Fjöllum at Grímsstaðir, two spans either side of one pier.
// Every bridge has galvanised W-beam guardrail on posts with a top rail, a kerb, expansion joints
// across the road at its ends, the river's name on a blue sign at each end, riprap and wet boulders
// along the banks, and a milky glacial river braided over black gravel under it, foaming round the
// piers. Each bridge is merged into one mesh per material (bakeStatic): concrete, steel, signs and
// rock, plus its river. The weathering, wet banding and rock wetness are drawn by the shaders, in
// the realistic look only; the classic look keeps plain materials.
import * as THREE from 'three';
import { bakeStatic } from './bake.js';
import { createRiverMaterial, riverGeometry, NOISE } from './materials.js';
import { lerp } from './noise.js';

// ---------- Materials ----------
// Weathered concrete: mottled, rain streaks down the vertical faces, a little lichen, and dark and
// damp below the river's high-water line (uWaterY).
function concreteMaterial(hd, waterY) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8f8e88, roughness: 0.9, metalness: 0 });
  if (!hd) return mat;
  mat.customProgramCacheKey = () => 'bridge-concrete-hd';
  const u = { uWaterY: { value: waterY } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uWaterY;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n${NOISE}\nfloat cWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vWNrm);
          float vert = 1.0 - abs(n.y);
          float hz = dot(vWPos.xz, abs(n.x) > abs(n.z) ? vec2(0.0, 1.0) : vec2(1.0, 0.0));
          float mott = g_n(vWPos.xz * 0.8 + vWPos.y * 0.6) * 0.55 + g_n(vWPos.xz * 3.1 - vWPos.y * 2.7) * 0.3 + g_n(vec2(hz, vWPos.y) * 9.0) * 0.15;
          float streak = smoothstep(0.5, 0.9, g_n(vec2(hz * 2.4, vWPos.y * 0.16))) * vert;
          float lichen = smoothstep(0.72, 0.84, g_n(vWPos.xz * 1.4 + vWPos.y * 1.2 + 7.0)) * (0.35 + 0.65 * (1.0 - vert));
          diffuseColor.rgb *= (0.8 + 0.32 * mott) * (1.0 - 0.32 * streak);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.19, 0.09), lichen * 0.35);
          cWet = 1.0 - smoothstep(uWaterY + 0.4, uWaterY + 1.8, vWPos.y + (g_n(vWPos.xz * 1.7) - 0.5) * 0.5);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.4, 0.43, 0.4), cWet);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.42, cWet);');
  };
  return mat;
}

// Basalt boulders and riprap, glistening wet near the water.
function rockMaterial(hd, waterY) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8, metalness: 0, flatShading: true });
  if (!hd) return mat;
  mat.customProgramCacheKey = () => 'bridge-rock-hd';
  const u = { uWaterY: { value: waterY } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uWaterY;\nvarying vec3 vWPos;\n${NOISE}\nfloat rkWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        rkWet = 1.0 - smoothstep(uWaterY + 0.1, uWaterY + 0.9, vWPos.y);
        diffuseColor.rgb *= (0.7 + 0.5 * g_n(vWPos.xz * 2.3 + vWPos.y * 1.7)) * mix(1.0, 0.42, rkWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.17, 0.1), smoothstep(0.75, 0.9, g_n(vWPos.xz * 1.1 + vWPos.y)) * (1.0 - rkWet) * 0.5);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.85, 0.16, rkWet);');
  };
  return mat;
}

let shared = null;
function sharedMaterials() {
  if (shared) return shared;
  // Galvanised steel: the dull, slightly mottled silver of hot-dip zinc.
  const steel = new THREE.MeshStandardMaterial({ color: 0xaeb3b5, roughness: 0.42, metalness: 0.7 });
  const signs = new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.5, metalness: 0 });
  shared = { steel, signs };
  return shared;
}

// ---------- The sign atlas ----------
// One canvas for everything painted: the blue "Einbreið brú" sign, each river's name sign, the
// yellow-and-black marker boards and a few flat colours. Slots are 512 x 128, two to a row.
const NAMES = ['Þjórsá', 'Markarfljót', 'Gígjukvísl', 'Jökulsá á Fjöllum', 'Hvítá'];
const SLOT = { onelane: 0, name: (i) => 1 + i, stripes: 6, white: 7, black: 8, amber: 9, joint: 10, yellow: 11 };
function signAtlas() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  const rect = (k) => [(k % 2) * 512, Math.floor(k / 2) * 128];
  const blue = (k, text) => {
    const [x, y] = rect(k);
    g.fillStyle = '#1f4f9d'; g.fillRect(x, y, 512, 128);
    g.strokeStyle = '#f4f6f8'; g.lineWidth = 7; g.strokeRect(x + 10, y + 10, 492, 108);
    g.fillStyle = '#f4f6f8';
    let px = 78;
    g.font = `bold ${px}px "DIN Alternate", "Arial Narrow", Arial, Helvetica, sans-serif`;
    const w = g.measureText(text).width;
    if (w > 440) { px = Math.floor(px * 440 / w); g.font = `bold ${px}px "DIN Alternate", "Arial Narrow", Arial, Helvetica, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x + 256, y + 68);
  };
  blue(SLOT.onelane, 'Einbreið brú');
  NAMES.forEach((n, i) => blue(SLOT.name(i), n));
  {
    const [x, y] = rect(SLOT.stripes);
    g.save(); g.beginPath(); g.rect(x, y, 512, 128); g.clip();
    g.fillStyle = '#f2c100'; g.fillRect(x, y, 512, 128);
    g.fillStyle = '#111';
    for (let k = -4; k < 12; k++) { g.beginPath(); const s = x + k * 64; g.moveTo(s, y + 128); g.lineTo(s + 32, y + 128); g.lineTo(s + 32 + 128, y); g.lineTo(s + 128, y); g.fill(); }
    g.restore();
  }
  const flat = (k, col) => { const [x, y] = rect(k); g.fillStyle = col; g.fillRect(x, y, 512, 128); };
  flat(SLOT.white, '#e8e8e4'); flat(SLOT.black, '#141414'); flat(SLOT.amber, '#ffb300'); flat(SLOT.joint, '#3b3d3f'); flat(SLOT.yellow, '#f2c100');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// Point a geometry's uvs into one slot of the atlas (solid slots use only their middle).
function slotUV(geo, k, inset = 0.02) {
  const u0 = (k % 2) * 0.5, v1 = 1 - Math.floor(k / 2) * 0.125, uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + (inset + uv.getX(i) * (1 - 2 * inset)) * 0.5, v1 - 0.125 + (inset + uv.getY(i) * (1 - 2 * inset)) * 0.125);
  }
  return geo;
}

// ---------- Shapes ----------
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// The galvanised W-beam: two waves pressed into a 31 cm band of thin steel, bulging toward the
// traffic (-x), run the length of the bridge (z).
function wBeam(len) {
  const prof = [[0, 0], [-0.005, 0.02], [-0.068, 0.062], [-0.083, 0.08], [-0.068, 0.098], [-0.012, 0.142], [-0.012, 0.168], [-0.068, 0.212], [-0.083, 0.23], [-0.068, 0.248], [-0.005, 0.29], [0, 0.31]];
  const s = new THREE.Shape();
  prof.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  for (let i = prof.length - 1; i >= 0; i--) s.lineTo(prof[i][0] + 0.008, prof[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -len / 2);
  return g;
}
// A wall pier: long along the current (x) with pointed cutwaters at both ends, thin across it (z).
function pierGeo(L, T, H, nose) {
  const s = new THREE.Shape();
  s.moveTo(-L / 2, 0); s.lineTo(-L / 2 + nose, -T / 2); s.lineTo(L / 2 - nose, -T / 2); s.lineTo(L / 2, 0); s.lineTo(L / 2 - nose, T / 2); s.lineTo(-L / 2 + nose, T / 2); s.lineTo(-L / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}
// A box girder's cross-section: wide at the top, narrower at the soffit.
function trapezoidBeam(top, bottom, y0, y1, len) {
  const s = new THREE.Shape();
  s.moveTo(-top / 2, y0); s.lineTo(top / 2, y0); s.lineTo(bottom / 2, y1); s.lineTo(-bottom / 2, y1); s.lineTo(-top / 2, y0);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  return g;
}
// A rough boulder: an icosahedron pushed in and out at its corners (the same push for every copy
// of a corner, so it stays closed), drawn faceted.
function rockGeo(rnd) {
  const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position;
  const seed = rnd() * 100;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    const k = 0.75 + 0.5 * (h - Math.floor(h));
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function rng(seed) { let s = Math.floor(seed * 9973) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// ---------- Building ----------
export function buildBridgeModels(scene, bridges, T) {
  const { heightAt, nearestRoad, roadHalfWidth, riverLevel, riverHere, hd } = T;
  const { steel, signs } = sharedMaterials();
  const hw = roadHalfWidth('paved') + 1.4;
  bridges.forEach((B, bi) => {
    const rnd = rng(B.seed + 1);
    const W0 = B.riv ? riverLevel(B, 0) : 0;
    const concrete = concreteMaterial(hd, W0), rock = rockMaterial(hd, W0);
    const deckAtZ = (zz) => lerp(B.h0, B.h1, zz / B.len + 0.5);
    const deckY = (B.h0 + B.h1) / 2;
    const world = (al, lat) => ({ x: B.x + B.dx * al - B.dz * lat, z: B.z + B.dz * al + B.dx * lat });
    const root = new THREE.Group();
    const g = new THREE.Group();
    g.position.set(B.x, 0, B.z);
    g.rotation.y = Math.atan2(B.dx, B.dz);
    root.add(g);
    // A world point's place in the bridge's frame (x across the road, z along it).
    const local = (q) => [(q.x - B.x) * B.dz - (q.z - B.z) * B.dx, (q.x - B.x) * B.dx + (q.z - B.z) * B.dz];
    // Every part unindexed, so all the parts in one material merge into a single mesh.
    const add = (geo, mat, x, y, z, parent = g, ry = 0, rx = 0) => {
      const m = new THREE.Mesh(geo.index ? geo.toNonIndexed() : geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
      // Rocks and signs are too small to be worth a place in the shadow passes (each pass is a draw).
      m.castShadow = mat !== rock && mat !== signs; m.receiveShadow = true; parent.add(m); return m;
    };
    const paint = (geo, k, inset) => slotUV(geo, k, inset);
    // The deck tilts with the road, which climbs from one bank's height to the other's, so the
    // asphalt ribbon (lane lines and all) lies just on top of it from end to end. Heights in here
    // are relative to the road surface at the middle of the bridge; x is across the road, z along it.
    const deck = new THREE.Group();
    deck.position.y = deckY;
    deck.rotation.x = -Math.atan2(B.h1 - B.h0, B.len);
    g.add(deck);
    const style = B.style || 'concrete', L = B.len + 1;
    const slabT = style === 'concrete' ? 0.3 : 0.25;
    add(box(2 * (hw + 0.55), slabT, L), concrete, 0, -0.05 - slabT / 2, 0, deck);
    // Kerbs, and the edge beams that give the deck its thickness from the side.
    const fasciaH = style === 'concrete' ? 1.25 : 0.85;
    for (const sx of [-1, 1]) {
      add(box(0.6, 0.3, L), concrete, sx * (hw + 0.05), 0.1, 0, deck);
      add(box(0.32, fasciaH, L), concrete, sx * (hw + 0.39), 0.32 - fasciaH / 2, 0, deck);
      // A drip groove along the underside of the overhang.
      add(box(0.04, 0.04, L), concrete, sx * (hw + 0.2), -0.05 - slabT - 0.015, 0, deck);
    }
    // Under the deck.
    let soffit;
    if (style === 'concrete') {
      add(trapezoidBeam(6.4, 4.2, -0.05 - slabT, -2.1, L), concrete, 0, 0, 0, deck);
      soffit = -2.1;
    } else {
      // Four steel I-girders (the truss carries its deck on two stringers and floor beams).
      const xs = style === 'onelane' ? [-3.6, -1.2, 1.2, 3.6] : [-2.4, 2.4], d = style === 'onelane' ? 1.1 : 0.7, top = -0.05 - slabT;
      for (const x of xs) {
        add(box(0.4, 0.04, L), steel, x, top - 0.02, 0, deck);
        add(box(0.05, d, L), steel, x, top - 0.04 - d / 2, 0, deck);
        add(box(0.4, 0.04, L), steel, x, top - 0.06 - d, 0, deck);
      }
      soffit = top - 0.08 - d;
      // Cross-frames between the girders at every joint.
      for (const j of B.joints) add(box(xs[xs.length - 1] - xs[0], d * 0.7, 0.12), steel, 0, top - 0.04 - d / 2, Math.max(-L / 2 + 0.3, Math.min(L / 2 - 0.3, j)), deck);
    }
    // Guardrail: posts every 2 m on the kerb, the W-beam on blockouts facing the traffic at the
    // line the car is held to (bridgeGuard), and a round top rail; it runs 2 m past each end of the
    // deck, as far as the wall the car meets (main.js). A small amber reflector on every fourth post.
    const railLen = B.len + 4;
    for (const sx of [-1, 1]) {
      const beam = add(wBeam(railLen), steel, sx * (hw - 0.19), 0.52, 0, deck);
      if (sx < 0) beam.scale.x = -1;
      const tr = add(new THREE.CylinderGeometry(0.045, 0.045, railLen, 8), steel, sx * (hw + 0.12), 1.12, 0, deck);
      tr.rotation.x = Math.PI / 2;
      let k = 0;
      for (let z = -railLen / 2 + 0.3; z <= railLen / 2 - 0.3; z += 2, k++) {
        add(box(0.1, 0.92, 0.15), steel, sx * (hw + 0.12), 0.25 + 0.46, z, deck);
        add(box(0.26, 0.2, 0.1), steel, sx * (hw - 0.06), 0.66, z, deck);
        if (k % 4 === 0) add(paint(box(0.02, 0.07, 0.1), SLOT.amber), signs, sx * (hw + 0.06), 1.0, z, deck);
      }
      // Yellow-and-black marker boards where the rail begins, at both ends, leaning toward the road.
      for (const s2 of [-1, 1]) {
        add(paint(box(0.3, 1.0, 0.04), SLOT.stripes, 0), signs, sx * (hw + 0.12), 0.9, s2 * (railLen / 2 + 0.25), deck);
        add(box(0.08, 1.4, 0.08), steel, sx * (hw + 0.12), 0.45, s2 * (railLen / 2 + 0.3), deck);
      }
    }
    // Expansion joints across the road: two steel edges with the black rubber seal between,
    // standing a hair proud of the asphalt.
    for (const j of B.joints) {
      const z = Math.max(-B.len / 2 + 0.3, Math.min(B.len / 2 - 0.3, j));
      for (const dz of [-0.09, 0.09]) add(paint(box(2 * hw - 0.7, 0.035, 0.1), SLOT.joint), signs, 0, 0.152, z + dz, deck);
      add(paint(box(2 * hw - 0.7, 0.03, 0.08), SLOT.black), signs, 0, 0.148, z, deck);
    }
    // The steel truss: two Pratt trusses either side of the deck, one over each span, with
    // inclined end posts, verticals, diagonals and struts across the top.
    if (style === 'truss') {
      const member = (x, y0, z0, y1, z1, w) => {
        const dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dy, dz);
        const m = add(box(w, w, len), steel, x, (y0 + y1) / 2, (z0 + z1) / 2, deck);
        m.rotation.x = -Math.atan2(dy, dz);
      };
      const X = hw + 0.85, yb = -0.3, yt = 5.6, p = 7;
      for (const zs of [-B.len / 2, 0]) {
        for (const sx of [-1, 1]) {
          const x = sx * X, n = (k) => zs + k * p;
          member(x, yb, n(0), yb, n(6), 0.45);
          member(x, yt, n(1), yt, n(5), 0.45);
          member(x, yb, n(0), yt, n(1), 0.42); member(x, yb, n(6), yt, n(5), 0.42);
          for (let k = 1; k <= 5; k++) member(x, yb, n(k), yt, n(k), 0.28);
          member(x, yt, n(1), yb, n(2), 0.3); member(x, yt, n(2), yb, n(3), 0.3);
          member(x, yt, n(5), yb, n(4), 0.3); member(x, yt, n(4), yb, n(3), 0.3);
        }
        for (let k = 1; k <= 5; k++) add(box(2 * X, 0.3, 0.3), steel, 0, yt, zs + k * p, deck);
        for (let k = 0; k <= 6; k++) add(box(2 * X + 0.3, 0.6, 0.35), steel, 0, soffit + 0.3, zs + k * p, deck);
      }
    }
    // Piers in the river, standing square to the current, from below the bed up to bearings
    // under the deck where it passes over them.
    const piers = style === 'onelane' ? [-28, -14, 0, 14, 28] : style === 'truss' ? [0] : [-21, 0, 21];
    const PT = style === 'onelane' ? 0.9 : style === 'truss' ? 1.7 : 1.4;
    const PL = style === 'onelane' ? 6.4 : style === 'truss' ? 12.6 : 7.2;
    const skew = Math.atan(0.18); // the river crosses at a slight angle (its line winds through here)
    const pierU = [];
    // What stands in the valley under the deck, for collisions (main.js): each pier and abutment
    // as a box { x, z, rot, hx, hz, top }, and the deck's underside below the road surface.
    B.soffit = soffit; B.blocks = [];
    const yaw = Math.atan2(B.dx, B.dz);
    for (const zz of piers) {
      const w = world(zz, 0), floor = heightAt(w.x, w.z) - 1.5, top = deckAtZ(zz) + soffit - 0.45;
      if (top - floor < 0.8) continue;
      B.blocks.push({ x: w.x, z: w.z, rot: yaw + skew, hx: PL / 2 - PT * 0.2, hz: PT / 2, top: top + 0.45 });
      add(pierGeo(PL, PT, top - floor, PT * 0.9), concrete, 0, floor, zz, g, skew);
      // Pier cap with bearings.
      add(box(PL - PT * 1.2, 0.45, PT + 0.3), concrete, 0, top + 0.225, zz, g, skew);
      // Riprap round the foot of the pier.
      for (let k = 0; k < 7; k++) {
        const a = rnd() * Math.PI * 2, r = PL * 0.35 + rnd() * 1.8, lx = Math.cos(a) * r, lz = Math.sin(a) * (PT + rnd() * 1.5);
        const s = 0.35 + rnd() * 0.45, q = world(zz + lz, -lx);
        const m = add(rockGeo(rnd), rock, lx, heightAt(q.x, q.z) - s * 0.3, zz + lz, g, rnd() * 6);
        m.scale.set(s * (1 + rnd() * 0.4), s * 0.7, s);
      }
      // For the river's foam: the pier's place, half its length along the current, half its thickness.
      pierU.push([w.x, w.z, PL / 2 - PT * 0.25, PT / 2]);
    }
    // Abutments at both ends: a wall under the deck's end, down into the bank.
    for (const s2 of [-1, 1]) {
      const zz = s2 * (B.len / 2 - 0.4);
      let low = Infinity;
      for (const lx of [-hw, 0, hw]) { const q = world(zz - s2 * 2, -lx); low = Math.min(low, heightAt(q.x, q.z)); }
      const top = deckAtZ(s2 * B.len / 2) - 0.05 - slabT, bot = Math.min(low - 1.5, top - 3);
      add(box(2 * hw + 0.9, top - bot, 1.2), concrete, 0, (top + bot) / 2, zz, g);
      const wa = world(zz, 0); B.blocks.push({ x: wa.x, z: wa.z, rot: yaw, hx: hw + 0.45, hz: 0.6, top });
    }
    // Riprap on the banks either side of the river under the bridge, and boulders along both
    // waterlines up and down the valley, wet where the river laps them.
    if (B.riv) {
      for (let lat = -14; lat <= 14; lat += 1.9) for (const side of [-1, 1]) for (let a = 21; a <= 38; a += 1.9) {
        if (rnd() < 0.35) continue;
        const al = Math.sin(lat * 0.018) * 10 + side * (a + rnd()), q = world(al, lat + rnd()), [lx, lz] = local(q);
        const s = 0.45 + rnd() * 0.5;
        const m = add(rockGeo(rnd), rock, lx, heightAt(q.x, q.z) - s * 0.35, lz, g, rnd() * 6);
        m.scale.set(s * (1 + rnd() * 0.5), s * (0.6 + rnd() * 0.3), s);
      }
      for (let lat = -B.valley * 0.62; lat <= B.valley * 0.62; lat += 4.5) {
        if (Math.abs(lat) < 16) continue;
        const W = riverLevel(B, lat), c = Math.sin(lat * 0.018) * 10;
        for (const side of [-1, 1]) {
          // Find the waterline going out from the middle of the river.
          let edge = null;
          for (let a = 6; a < 34; a += 1) { const q = world(c + side * a, lat); if (heightAt(q.x, q.z) > W + 0.15) { edge = a; break; } }
          if (edge == null || rnd() < 0.4) continue;
          for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
            const a = edge + (rnd() - 0.3) * 3, l2 = lat + (rnd() - 0.5) * 4, q = world(c + side * a, l2), s = 0.3 + rnd() * rnd() * 1.3;
            const [lx, lz] = local(q);
            const m = add(rockGeo(rnd), rock, lx, heightAt(q.x, q.z) - s * 0.35, lz, g, rnd() * 6);
            m.scale.set(s * (1 + rnd() * 0.5), s * (0.55 + rnd() * 0.35), s * (0.8 + rnd() * 0.4));
          }
        }
      }
    }
    // Signs on the approaches, on the right as you drive toward the bridge: the river's name just
    // before the deck, and on the one-lane bridge the blue "Einbreið brú" sign 40 m out.
    const sign = (dist, s2, slot, w, h, y0) => {
      const p = world(s2 * (B.len / 2 + dist), 0), r = nearestRoad(p.x, p.z, 30);
      if (!r) return;
      const sg = r.seg, tx = sg.bx - sg.ax, tz = sg.bz - sg.az, tl = Math.hypot(tx, tz) || 1;
      // Heading toward the bridge along the road.
      let fx = tx / tl, fz = tz / tl;
      if ((B.x - r.px) * fx + (B.z - r.pz) * fz < 0) { fx = -fx; fz = -fz; }
      const off = roadHalfWidth('paved') + 2.4, x = r.px - fz * off, z = r.pz + fx * off;
      const ground = Math.min(heightAt(x, z), r.h), top = r.h + y0 + h;
      const sgG = new THREE.Group();
      sgG.position.set(x, 0, z); sgG.rotation.y = Math.atan2(-fx, -fz);
      root.add(sgG);
      add(paint(new THREE.PlaneGeometry(w, h), slot, 0), signs, 0, r.h + y0 + h / 2, 0.03, sgG);
      add(box(w + 0.04, h + 0.04, 0.03), steel, 0, r.h + y0 + h / 2, 0, sgG);
      for (const px of w > 1.2 ? [-w * 0.3, w * 0.3] : [0]) add(new THREE.CylinderGeometry(0.035, 0.035, top - ground + 0.3, 8), steel, px, (top + ground - 0.3) / 2, -0.06, sgG);
    };
    for (const s2 of [-1, 1]) {
      sign(9, s2, SLOT.name(bi), 1.5, 0.375, 1.0);
      if (style === 'onelane') sign(40, s2, SLOT.onelane, 1.8, 0.45, 1.6);
    }
    scene.add(root);
    bakeStatic(root); // a few hundred parts, one mesh per material
    // The rocks and signs are only drawn within 450 m: from further off they are a few pixels.
    for (const m of [...root.children]) {
      if (!m.userData.baked || (m.material !== rock && m.material !== signs)) continue;
      const lod = new THREE.LOD();
      lod.position.set(B.x, deckY, B.z);
      m.position.set(-B.x, -deckY, -B.z);
      lod.addLevel(m, 0); lod.addLevel(new THREE.Object3D(), 450);
      root.add(lod);
    }
    // The river along the valley floor, from upstream to downstream, at its own level.
    if (!B.riv) return;
    // Only the unbroken stretch through the bridge where the land holds it (at the coast the sea
    // takes over).
    const all = [], dir = B.riv.dir;
    let mid = 0;
    for (let t = -B.valley * 0.92; t <= B.valley * 0.92; t += 4) {
      const lat = dir * t; // t runs downstream
      const q = world(Math.sin(lat * 0.018) * 10, lat), y = riverHere(B, lat);
      if (Math.abs(t) < 2) mid = all.length;
      all.push(y == null ? null : { x: q.x, y, z: q.z });
    }
    let i0 = mid, i1 = mid;
    if (!all[mid]) return;
    while (i0 > 0 && all[i0 - 1]) i0--;
    while (i1 < all.length - 1 && all[i1 + 1]) i1++;
    const pts = all.slice(i0, i1 + 1);
    if (pts.length < 3) return;
    // Downstream at the bridge, for the wakes.
    const fl = [(B.dx * 0.18 - B.dz) * dir, (B.dz * 0.18 + B.dx) * dir];
    const look = RIVER_LOOK[style === 'truss' ? 'brown' : bi === 4 ? 'pale' : 'grey'];
    const width = 2 * 26;
    const river = new THREE.Mesh(riverGeometry(pts, width), createRiverMaterial({ glacial: true, piers: pierU, flow: fl, width, speed: 1.5, ...look }));
    river.receiveShadow = true;
    scene.add(river);
  });
}

// Glacial water: Þjórsá, Markarfljót and Gígjukvísl a grey-turquoise milk; Jökulsá á Fjöllum
// browner with silt; Hvítá ("white river") paler.
const RIVER_LOOK = {
  grey: { shallow: [0.37, 0.37, 0.33], deep: [0.22, 0.3, 0.31] },
  brown: { shallow: [0.4, 0.36, 0.3], deep: [0.28, 0.28, 0.26] },
  pale: { shallow: [0.43, 0.45, 0.42], deep: [0.27, 0.36, 0.37] },
};
