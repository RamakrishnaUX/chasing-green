import * as THREE from 'three';
import { mulberry32, clamp, smoothstep, createNoise2D, fbm } from './noise.js';
import { NOISE, TABLE_NOISE, surfaceUniforms } from './materials.js';
import { toWorld } from './geo.js';
import { HD } from './hd.js';
import { BOUNDS, heightAt, waterLevelAt, roadDistAt, roadHalfWidth, coastAt, sandMask, glacierMask, lavaMask, isleAt, nearestRoadAnywhere } from './terrain.js';

// Iceland's woods: downy birch (most of them, often several crooked stems from one root), Sitka
// and Norway spruce planted in blocks and shelterbelts, and low willow scrub at the edges.
//
// Drawn the way the best web driving games do it (Slow Roads is the model): no tree is detailed
// geometry. Up close a tree is a cheap trunk and branches with bark, carrying a few dozen cut-out
// cards, each a picture of a leafy spray; its normals bend out from the crown's centre, so the
// whole crown lights as one soft volume, and sunlight glows through the leaves seen against it.
// Further out every tree is one flat card (an impostor), pictured from 16 sides and from above
// when the island loads, with normals, so it is lit by the same sun and sky as everything else.
// The two cross-fade in a band, pixel by pixel. All of it is a handful of instanced draws, fed
// from a grid of 32 m cells only when you move into a new cell: no per-tree work per frame.
// Everything is made in code: the sprays are painted on a canvas, the bark too.

const TAU = Math.PI * 2;
const VIEWS = 16; // impostor views round the tree; one more column is the view from above
const CELL = 32;
const STRIDE = 8; // floats per tree: x, y, z, scale | yaw, impostor row, hue, random

// Quality: how far the detailed trees and impostors reach, how many variants, impostor detail.
const QUALITY = {
  low: { birch: 2, spruce: 1, shrub: 1, near: 34, band: 8, far: 1100, shrubFar: 70, cellPx: 112, density: 0.55 },
  medium: { birch: 3, spruce: 2, shrub: 2, near: 58, band: 12, far: 1800, shrubFar: 120, cellPx: 160, density: 0.85 },
  high: { birch: 4, spruce: 3, shrub: 2, near: 70, band: 14, far: 2600, shrubFar: 170, cellPx: 192, density: 1 },
};

// Real woods, by latitude and longitude. r is in world units (metres at the island's scale);
// mix is [birch, spruce, scrub]; d is density (1 is a closed wood); small shrinks the trees.
export const ZONES = [
  { name: 'Hallormsstaðaskógur', ll: [65.095, -14.74], r: 420, mix: [0.5, 0.45, 0.05], d: 1 },
  { name: 'Egilsstaðir', ll: [65.268, -14.4], r: 170, mix: [0.65, 0.3, 0.05], d: 0.45 },
  { name: 'Vaglaskógur', ll: [65.705, -17.9], r: 300, mix: [0.88, 0.08, 0.04], d: 1 },
  { name: 'Kjarnaskógur', ll: [65.65, -18.11], r: 230, mix: [0.5, 0.45, 0.05], d: 0.9 },
  { name: 'Akureyri gardens', ll: [65.683, -18.1], r: 170, mix: [0.6, 0.35, 0.05], d: 0.3, town: true },
  { name: 'Ásbyrgi rim', ll: [65.965, -16.69], r: 150, mix: [0.85, 0.05, 0.1], d: 0.6 },
  { name: 'Skaftafell', ll: [64.022, -16.93], r: 160, mix: [0.9, 0, 0.1], d: 0.75, small: 0.85 },
  { name: 'Þórsmörk', ll: [63.683, -19.5], r: 320, mix: [0.9, 0, 0.1], d: 0.8, small: 0.85 },
  { name: 'Þingvellir', ll: [64.262, -21.08], r: 360, mix: [0.8, 0, 0.2], d: 0.42, small: 0.6 },
  { name: 'Heiðmörk', ll: [64.075, -21.78], r: 320, mix: [0.4, 0.55, 0.05], d: 0.85 },
  { name: 'Haukadalsskógur', ll: [64.335, -20.28], r: 210, mix: [0.35, 0.6, 0.05], d: 0.85 },
  { name: 'Laugarvatn', ll: [64.218, -20.73], r: 170, mix: [0.7, 0.25, 0.05], d: 0.6 },
  { name: 'Skorradalur', ll: [64.5, -21.43], r: 270, mix: [0.3, 0.65, 0.05], d: 0.9 },
  { name: 'Húsafell', ll: [64.7, -20.86], r: 230, mix: [0.92, 0.02, 0.06], d: 0.7, small: 0.85 },
  { name: 'Kirkjubæjarklaustur', ll: [63.79, -18.04], r: 170, mix: [0.75, 0.2, 0.05], d: 0.6 },
  { name: 'Múlakot', ll: [63.73, -19.87], r: 150, mix: [0.6, 0.35, 0.05], d: 0.6 },
  { name: 'Hveragerði', ll: [64.0, -21.19], r: 130, mix: [0.6, 0.35, 0.05], d: 0.3, town: true },
  { name: 'Selfoss', ll: [63.935, -21.0], r: 150, mix: [0.6, 0.35, 0.05], d: 0.25, town: true },
  { name: 'Reykjavík gardens', ll: [64.135, -21.9], r: 260, mix: [0.55, 0.4, 0.05], d: 0.22, town: true },
  { name: 'Fnjóskadalur', ll: [65.63, -17.88], r: 220, mix: [0.9, 0.05, 0.05], d: 0.55 },
];

// How leafy the birches and willows are, and how golden, by month (0 is January).
const LEAF = [0, 0, 0, 0, 0.3, 1, 1, 1, 1, 0.7, 0.08, 0];
const AUTUMN = [0, 0, 0, 0, 0, 0, 0, 0.05, 0.55, 1, 1, 0];
const SNOWY = [0.9, 0.9, 0.75, 0.4, 0, 0, 0, 0, 0, 0, 0.5, 0.9];

// ---------------------------------------------------------------------------------------------
// Pictures, painted on a canvas: the spray cards and the bark.
// ---------------------------------------------------------------------------------------------

const CARD = 256; // pixels a card
const ATLAS_W = 8 * CARD, ATLAS_H = 2 * CARD;
// Cells: row 0: birch sprays 0..3, then the same four bare. Row 1: spruce 0..3, willow 0..1,
// willow bare 0..1.
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
function polyline(ctx, pts, w0, w1, color) {
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = w0 + (w1 - w0) * (i / (pts.length - 1));
    ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
  }
}
// A twig: from p, heading a, bending by curl over its length.
function twig(p, a, len, curl, n = 8) {
  const pts = [[p[0], p[1]]];
  let x = p[0], y = p[1];
  for (let i = 1; i <= n; i++) { const ang = a + curl * (i / n); x += Math.cos(ang) * len / n; y += Math.sin(ang) * len / n; pts.push([x, y]); }
  return pts;
}
const at = (pts, t) => { const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]; };
const dirAt = (pts, t) => { const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)); return Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]); };

// A broadleaf spray (birch or willow): a stem from the left edge out to the right, alternate
// twigs off it, and leaves on short shoots. Returns the structure so the bare card matches.
function broadleafStructure(rand, S, willow) {
  const y0 = S * 0.5, droop = (rand() - 0.4) * S * 0.12;
  const p0 = [S * 0.03, y0], p1 = [S * 0.45, y0 + droop * 0.2 + (rand() - 0.5) * S * 0.08], p2 = [S * 0.97, y0 + droop];
  const stem = []; for (let i = 0; i <= 16; i++) stem.push(bez(p0, p1, p2, i / 16));
  const twigs = [];
  let side = rand() < 0.5 ? -1 : 1;
  // Twigs fan out to fill an oval spray most of the card high.
  for (let t = 0.08 + rand() * 0.04; t < 0.92; t += 0.05 + rand() * 0.035) {
    side = -side;
    const base = at(stem, t), a0 = dirAt(stem, t);
    const env = Math.sin(Math.PI * clamp(t * 1.05, 0, 1));
    const spread = willow ? 0.45 + rand() * 0.4 : 0.6 + rand() * 0.6;
    const len = S * (willow ? 0.26 + rand() * 0.14 : 0.24 + rand() * 0.16) * (0.45 + 0.55 * env);
    const pts = twig(base, a0 + side * spread, len, -side * (0.3 + rand() * 0.4));
    twigs.push({ pts, w: 1.6 - t });
    for (let k = 0; k < 2; k++) if (len > S * 0.12 && rand() < 0.85) {
      const tt = 0.3 + k * 0.3 + rand() * 0.15, b = at(pts, tt);
      twigs.push({ pts: twig(b, dirAt(pts, tt) + (k ? side : -side) * (0.5 + rand() * 0.4), len * (0.4 + rand() * 0.2), side * 0.3, 5), w: 0.8 });
    }
  }
  return { stem, twigs };
}

function leafPath(ctx, len, w, pet, willow) {
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(pet, 0);
  if (willow) {
    ctx.bezierCurveTo(pet + len * 0.25, -w * 0.6, pet + len * 0.75, -w * 0.55, pet + len, 0);
    ctx.bezierCurveTo(pet + len * 0.75, w * 0.55, pet + len * 0.25, w * 0.6, pet, 0);
  } else {
    // Birch: broad near the base, drawn out to a point.
    ctx.bezierCurveTo(pet + len * 0.02, -w * 0.62, pet + len * 0.5, -w * 0.52, pet + len, 0);
    ctx.bezierCurveTo(pet + len * 0.5, w * 0.52, pet + len * 0.02, w * 0.62, pet, 0);
  }
}

function paintBroadleaf(ctx, ox, oy, S, rand, { willow = false, bare = false, struct }) {
  ctx.save(); ctx.translate(ox, oy);
  ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
  const bark = willow ? (bare ? [36, 30, 34] : [30, 22, 26]) : [8, 26, 22];
  const barkCol = (l) => hsl(bark[0], bark[1], l);
  polyline(ctx, struct.stem, 3.6, 1.2, barkCol(bark[2]));
  for (const tw of struct.twigs) polyline(ctx, tw.pts, tw.w + 0.4, 0.5, barkCol(bark[2] + 4));
  if (bare) {
    // Winter: the fine twigs show, reddish brown on birch, a haze of them at the tips.
    const r2 = mulberry32(Math.floor(rand() * 1e9));
    for (const tw of struct.twigs) for (let k = 0; k < 4; k++) {
      const t = 0.3 + r2() * 0.7, b = at(tw.pts, t), a = dirAt(tw.pts, t) + (r2() < 0.5 ? -1 : 1) * (0.4 + r2() * 0.6);
      polyline(ctx, twig(b, a, S * (0.04 + r2() * 0.07), (r2() - 0.5) * 0.6, 4), 0.7, 0.35, barkCol(bark[2] + 6 + r2() * 8));
    }
    if (!willow) for (let k = 0; k < 10; k++) { // catkin buds
      const tw = struct.twigs[Math.floor(r2() * struct.twigs.length)], b = at(tw.pts, 0.85 + r2() * 0.15);
      ctx.fillStyle = barkCol(18); ctx.beginPath(); ctx.ellipse(b[0], b[1], 2.2, 1.1, dirAt(tw.pts, 0.95), 0, TAU); ctx.fill();
    }
    ctx.restore(); return;
  }
  // Leaves on short shoots along every twig and the outer stem, drawn back to front: the ones
  // underneath are in the crown's shade, the top ones catch the light.
  const leaves = [];
  const add = (p, a) => {
    const n = 1 + Math.floor(rand() * (willow ? 2 : 3));
    for (let i = 0; i < n; i++) {
      const len = willow ? 16 + rand() * 9 : 13 + rand() * 7;
      leaves.push({ x: p[0], y: p[1], a: a + (rand() - 0.5) * 2.6, len, w: len * (willow ? 0.3 : 0.66), d: rand() });
    }
  };
  for (const tw of struct.twigs) for (let t = 0.1; t <= 1.0; t += 0.07 + rand() * 0.05) add(at(tw.pts, t), dirAt(tw.pts, Math.min(t, 0.99)));
  for (let t = 0.3; t <= 1.0; t += 0.05) add(at(struct.stem, t), dirAt(struct.stem, Math.min(t, 0.99)));
  leaves.sort((a, b) => a.d - b.d);
  for (const L of leaves) {
    ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(L.a);
    leafPath(ctx, L.len, L.w, 2.5, willow);
    const under = willow && rand() < 0.3; // willow leaves are silver underneath
    const l = (willow ? 24 : 12) + L.d * (willow ? 18 : 15) + rand() * 4;
    ctx.fillStyle = under ? hsl(78, 10, 52 + L.d * 10) : willow ? hsl(78 + rand() * 8, 20 + rand() * 6, l) : hsl(92 + rand() * 16, 30 + rand() * 12, l);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,30,8,0.18)'; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.strokeStyle = willow ? 'rgba(220,230,200,0.35)' : 'rgba(210,230,150,0.32)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(2.5, 0); ctx.lineTo(2.5 + L.len * 0.85, 0); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// A spruce spray seen from above: a straight axis with opposite side shoots, each furred with
// needles, darker and older towards the axis, bright new growth at the tips.
function paintSpruce(ctx, ox, oy, S, rand) {
  ctx.save(); ctx.translate(ox, oy);
  ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
  const y0 = S * 0.5 + (rand() - 0.5) * S * 0.04;
  const axis = twig([S * 0.02, y0], (rand() - 0.5) * 0.06, S * 0.95, (rand() - 0.5) * 0.12, 12);
  const shoots = [{ pts: axis, w: 2.6 }];
  for (let t = 0.04; t < 0.96; t += 0.04 + rand() * 0.015) {
    const env = Math.pow(1 - t, 0.6) * smoothstep(0, 0.12, t);
    for (const side of [-1, 1]) {
      if (rand() < 0.12) continue;
      const len = S * 0.3 * env * (0.75 + rand() * 0.4);
      if (len < 4) continue;
      const pts = twig(at(axis, t), dirAt(axis, t) + side * (0.8 + rand() * 0.25), len, -side * (0.25 + rand() * 0.2), 6);
      shoots.push({ pts, w: 1.2 });
      if (len > S * 0.12) for (let k = 0; k < 2; k++) {
        const tt = 0.35 + k * 0.3 + rand() * 0.1;
        shoots.push({ pts: twig(at(pts, tt), dirAt(pts, tt) + (rand() < 0.5 ? -1 : 1) * 0.75, len * 0.35, 0.1, 4), w: 0.7 });
      }
    }
  }
  for (const s of shoots) polyline(ctx, s.pts, s.w, 0.5, hsl(24, 28, 20));
  // Needles, batched into a few colour buckets so the canvas strokes few paths.
  const B = 7, paths = Array.from({ length: B }, () => new Path2D());
  for (const s of shoots) {
    const n = s.pts.length;
    let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
    const steps = Math.max(2, Math.floor(len / 1.5));
    for (let i = 0; i < steps; i++) {
      const t = i / steps, p = at(s.pts, t), a = dirAt(s.pts, Math.min(t, 0.99));
      for (const side of [-1, 1, 0]) {
        if (side === 0 && rand() < 0.5) continue;
        const ang = a + side * (0.55 + rand() * 0.6) + (side === 0 ? (rand() - 0.5) * 0.8 : 0);
        const nl = 5 + rand() * 3;
        // Bucket: depth (random) and new growth at the tips of shoots.
        const tip = t > 0.8 ? 1 : 0;
        const b = Math.min(B - 1, Math.floor(rand() * (B - 2)) + (tip && rand() < 0.75 ? 2 : 0));
        paths[b].moveTo(p[0], p[1]); paths[b].lineTo(p[0] + Math.cos(ang) * nl, p[1] + Math.sin(ang) * nl);
      }
    }
  }
  ctx.lineCap = 'round'; ctx.lineWidth = 1.25;
  for (let b = 0; b < B; b++) {
    const f = b / (B - 1);
    ctx.strokeStyle = b >= B - 2 ? hsl(98, 34, 27 + (b - B + 2) * 5) : hsl(148 - f * 25, 30 - f * 4, 10 + f * 14);
    ctx.stroke(paths[b]);
  }
  ctx.restore();
}

function buildCardAtlas() {
  const cv = document.createElement('canvas');
  cv.width = ATLAS_W; cv.height = ATLAS_H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const rand = mulberry32(9137);
  for (let i = 0; i < 4; i++) {
    const st = broadleafStructure(rand, CARD, false);
    paintBroadleaf(ctx, i * CARD, 0, CARD, rand, { struct: st });
    paintBroadleaf(ctx, (4 + i) * CARD, 0, CARD, rand, { struct: st, bare: true });
    paintSpruce(ctx, i * CARD, CARD, CARD, rand);
  }
  for (let i = 0; i < 2; i++) {
    const st = broadleafStructure(rand, CARD, true);
    paintBroadleaf(ctx, (4 + i) * CARD, CARD, CARD, rand, { struct: st, willow: true });
    paintBroadleaf(ctx, (6 + i) * CARD, CARD, CARD, rand, { struct: st, willow: true, bare: true });
  }
  // The canvas forgets the colour of see-through pixels; give them their cell's average colour
  // so mip maps fade the edges into foliage instead of black.
  const img = ctx.getImageData(0, 0, ATLAS_W, ATLAS_H), d = img.data;
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 8; cx++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy * CARD; y < (cy + 1) * CARD; y += 2) for (let x = cx * CARD; x < (cx + 1) * CARD; x += 2) {
      const i = (y * ATLAS_W + x) * 4; if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (!n) continue; r /= n; g /= n; b /= n;
    for (let y = cy * CARD; y < (cy + 1) * CARD; y++) for (let x = cx * CARD; x < (cx + 1) * CARD; x++) {
      const i = (y * ATLAS_W + x) * 4; if (d[i + 3] < 8) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
    }
  }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), ATLAS_W, ATLAS_H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function barkTexture(kind) {
  const W = 256, H = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const rand = mulberry32(kind === 'birch' ? 31 : 47);
  // Draw a shape at x and at x +- W so the bark wraps round the trunk without a seam.
  const wrap = (fn) => { for (const dx of [-W, 0, W]) { ctx.save(); ctx.translate(dx, 0); fn(); ctx.restore(); } };
  if (kind === 'birch') {
    ctx.fillStyle = '#e4e0d6'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(${150 + rand() * 60},${145 + rand() * 50},${135 + rand() * 50},${0.08 + rand() * 0.1})`; ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 4, 1 + rand() * 2); }
    // Faint peeling bands, warm and grey.
    for (let i = 0; i < 14; i++) { const y = rand() * H; ctx.fillStyle = rand() < 0.5 ? 'rgba(205,170,140,0.14)' : 'rgba(120,115,110,0.1)'; ctx.fillRect(0, y, W, 2 + rand() * 6); }
    // Lenticels: short dark dashes across the trunk.
    for (let i = 0; i < 260; i++) {
      const x = rand() * W, y = rand() * H, w = 4 + rand() * 18, h = 0.8 + rand() * 1.6;
      wrap(() => { ctx.fillStyle = `rgba(60,52,48,${0.35 + rand() * 0.45})`; ctx.fillRect(x, y, w, h); });
    }
    // Black diamonds and blotches where twigs fell.
    for (let i = 0; i < 16; i++) {
      const x = rand() * W, y = rand() * H, s = 6 + rand() * 16;
      wrap(() => {
        ctx.fillStyle = `rgba(28,24,22,${0.75 + rand() * 0.2})`;
        ctx.beginPath(); ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x, y - s * 0.35, x + s, y); ctx.quadraticCurveTo(x, y + s * 0.5, x - s, y); ctx.fill();
      });
    }
  } else {
    ctx.fillStyle = '#5b4a3f'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      const x = rand() * W, y = rand() * H, w = 10 + rand() * 26, h = 6 + rand() * 14, l = 22 + rand() * 22;
      wrap(() => { ctx.fillStyle = hsl(22 + rand() * 10, 18 + rand() * 10, l, 0.55); ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, TAU); ctx.fill(); });
    }
    for (let i = 0; i < 300; i++) { const x = rand() * W, y = rand() * H; wrap(() => { ctx.strokeStyle = 'rgba(25,18,14,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 6, y + 8 + rand() * 20); ctx.stroke(); }); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Near models: bark tubes plus spray cards.
// ---------------------------------------------------------------------------------------------

class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(P, N, u, v, c) { this.p.push(P.x, P.y, P.z); this.n.push(N.x, N.y, N.z); this.uv.push(u, v); this.c.push(c, c, c); return this.count - 1; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// A tapering tube along pts (Vector3s) with radii. Bark runs round it (u) and along it (v).
function tube(G, pts, radii, sides, tileLen, shade) {
  const base = G.count;
  let along = 0;
  const t = V(), a = V(), b = V(), ref = V(0, 0, 1), P = V(), N = V();
  for (let k = 0; k < pts.length; k++) {
    if (k > 0) along += pts[k].distanceTo(pts[k - 1]);
    t.subVectors(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]).normalize();
    if (Math.abs(t.dot(ref)) > 0.9) ref.set(1, 0, 0);
    a.crossVectors(t, ref).normalize(); b.crossVectors(t, a).normalize();
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * TAU;
      N.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
      P.copy(pts[k]).addScaledVector(N, radii[k]);
      G.vert(P, N, s / sides, along / tileLen, shade(k / (pts.length - 1), pts[k]));
    }
  }
  for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < sides; s++) {
    const i0 = base + k * (sides + 1) + s, i1 = i0 + sides + 1;
    G.i.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
  }
}

// One card: origin O (where its stem enters), axis a along the stem, face normal n, size s, the
// atlas cell (col, row). Normals bend towards the crown's own outward normal (crownN).
function card(G, O, a, n, s, col, row, crownN, ao, flip, droop = 0) {
  const b = V().crossVectors(n, a).normalize();
  const idx = [];
  const P = V(), N = V(), cn = V();
  // A drooping spray bends at its middle (three columns); a flat one is two triangles.
  const us = droop > 0 ? [0, 0.5, 1] : [0, 1];
  for (const u of us) for (const v of [0, 1]) {
    P.copy(O).addScaledVector(a, (u - 0.04) * s).addScaledVector(b, (v - 0.5) * s);
    P.y -= droop * u * u * s;
    crownN(P, cn);
    N.copy(n).multiplyScalar(Math.sign(n.dot(cn)) || 1).lerp(cn, 0.72).normalize();
    idx.push(G.vert(P, N, (col + u) / 8, (row + (flip ? 1 - v : v)) / 2, ao(P)));
  }
  // Columns of (v0, v1) pairs along u.
  for (let k = 0; k < us.length - 1; k++) { const a0 = idx[k * 2], a1 = idx[k * 2 + 1], b0 = idx[k * 2 + 2], b1 = idx[k * 2 + 3]; G.i.push(a0, b0, a1, a1, b0, b1); }
}

// Ellipsoid helpers for the crown.
function crownFns(C, R) {
  return {
    crownN: (P, out) => out.set((P.x - C.x) / (R.x * R.x), (P.y - C.y) / (R.y * R.y), (P.z - C.z) / (R.z * R.z)).normalize(),
    depth: (P) => Math.sqrt(((P.x - C.x) / R.x) ** 2 + ((P.y - C.y) / R.y) ** 2 + ((P.z - C.z) / R.z) ** 2),
  };
}

function frameFrom(a, roll, rand, rollTo = 0) {
  const up = V(0, 1, 0);
  let r = V().crossVectors(a, up);
  if (r.lengthSq() < 1e-4) r.set(1, 0, 0);
  r.normalize();
  const n0 = V().crossVectors(r, a).normalize();
  const phi = roll * (rand() - 0.5) + rollTo;
  return n0.multiplyScalar(Math.cos(phi)).addScaledVector(r, Math.sin(phi)).normalize();
}

function makeBirch(rand) {
  const trunk = new Geo(), cards = new Geo();
  const stems = rand() < 0.4 ? 1 : 2 + (rand() < 0.35 ? 1 : 0);
  // Icelandic downy birch: a small tree, often several crooked stems from one root.
  const H = 4.8 + rand() * 2.6;
  const cardSpecs = [];
  const branchTubes = [];
  for (let s = 0; s < stems; s++) {
    const az = (s / stems) * TAU + rand() * 0.8;
    const lean = stems > 1 ? 0.14 + rand() * 0.18 : rand() * 0.08;
    const Hs = H * (stems > 1 ? 0.78 + rand() * 0.22 : 1);
    const base = V(Math.cos(az) * 0.12 * (stems > 1 ? 1 : 0), 0, Math.sin(az) * 0.12 * (stems > 1 ? 1 : 0));
    const dir = V(Math.cos(az) * Math.sin(lean), Math.cos(lean), Math.sin(az) * Math.sin(lean)).normalize();
    const pts = [base.clone()], n = 8;
    for (let k = 1; k <= n; k++) {
      dir.add(V((rand() - 0.5) * 0.16, 0.05, (rand() - 0.5) * 0.16)).normalize();
      pts.push(pts[k - 1].clone().addScaledVector(dir, Hs / n));
    }
    const r0 = stems > 1 ? 0.09 + rand() * 0.04 : 0.13 + rand() * 0.05;
    tube(trunk, pts, pts.map((_, k) => r0 * (1 - 0.85 * (k / n)) + 0.012), 7, 1.6, (t, P) => 0.5 + 0.5 * smoothstep(0, 1.3, P.y));
    const at3 = (t) => { const f = t * n, i = Math.min(n - 1, Math.floor(f)); return pts[i].clone().lerp(pts[i + 1], f - i); };
    // First branches.
    const nb = Math.round((13 + rand() * 6) / Math.sqrt(stems));
    for (let k = 0; k < nb; k++) {
      const t = 0.36 + 0.58 * (k + rand() * 0.6) / nb;
      const O = at3(t);
      const baz = k * 2.4 + rand() * 0.6 + (stems > 1 ? 0 : 0);
      // Branches lean the way their stem leans, away from the others.
      const out = V(Math.cos(baz), 0, Math.sin(baz)).addScaledVector(V(Math.cos(az), 0, Math.sin(az)), stems > 1 ? 0.8 : 0).normalize();
      const e = 0.7 + t * 0.45 + (rand() - 0.5) * 0.25;
      const L = H * 0.3 * Math.pow(Math.sin(Math.PI * clamp((t - 0.18) / 0.88, 0, 1)), 0.6) + 0.5;
      const d = V(out.x * Math.cos(e), Math.sin(e), out.z * Math.cos(e)).normalize();
      const bp = [O.clone()];
      for (let j = 1; j <= 4; j++) {
        d.add(V((rand() - 0.5) * 0.15, -0.2 - 0.08 * j, (rand() - 0.5) * 0.15)).normalize();
        bp.push(bp[j - 1].clone().addScaledVector(d, L / 4));
      }
      branchTubes.push({ pts: bp.slice(0, 4), r: 0.025 + 0.02 * L / 3 });
      const nc = 2 + Math.ceil(L / 0.65);
      for (let j = 0; j < nc; j++) {
        const tb = 0.32 + 0.68 * (j + 0.3 + rand() * 0.5) / nc;
        const f = tb * 4, i = Math.min(3, Math.floor(f));
        const Oc = bp[i].clone().lerp(bp[i + 1], f - i);
        const a = bp[i + 1].clone().sub(bp[i]).normalize().add(V((rand() - 0.5) * 0.5, -0.15 - rand() * 0.25, (rand() - 0.5) * 0.5)).normalize();
        cardSpecs.push({ O: Oc, a, s: 1.3 + rand() * 0.6, roll: j % 2 ? TAU : 2.4 });
      }
    }
    // The leader: a few sprays round the top of each stem.
    const top = pts[n];
    for (let k = 0; k < 4; k++) {
      const a = V((rand() - 0.5) * 0.9, 0.7 + rand() * 0.3, (rand() - 0.5) * 0.9).normalize();
      cardSpecs.push({ O: top.clone().addScaledVector(a, -0.6), a, s: 1.2 + rand() * 0.4, roll: TAU });
    }
  }
  for (const b of branchTubes) tube(trunk, b.pts, b.pts.map((_, k) => b.r * (1 - 0.7 * k / (b.pts.length - 1)) + 0.006), 4, 1.6, (t) => 0.62 - 0.18 * t);
  return finishCards(trunk, cards, cardSpecs, rand, { cols: [0, 1, 2, 3], row: 0, H, kind: 'birch', fill: 9 });
}

function makeSpruce(rand) {
  const trunk = new Geo(), cards = new Geo();
  const H = 9 + rand() * 6, Rb = H * (0.19 + rand() * 0.05), r0 = H * 0.017;
  const lean = V((rand() - 0.5) * 0.04, 1, (rand() - 0.5) * 0.04).normalize();
  const pts = []; for (let k = 0; k <= 6; k++) pts.push(lean.clone().multiplyScalar(H * k / 6));
  tube(trunk, pts, pts.map((_, k) => r0 * (1 - 0.92 * k / 6) + 0.01), 7, 1.4, (t, P) => 0.55 + 0.45 * smoothstep(0, 1.2, P.y));
  const specs = [];
  let y = 0.6 + rand() * 0.5, az0 = rand() * TAU;
  while (y < H - 0.4) {
    const f = y / H, n = 4 + Math.floor(rand() * 3);
    az0 += 0.6 + rand() * 0.4;
    for (let k = 0; k < n; k++) {
      if (y < 1.6 && rand() < 0.35) continue; // dead lower branches
      const az = az0 + (k / n) * TAU + (rand() - 0.5) * 0.5;
      const L = Rb * Math.pow(1 - f, 0.9) * (0.85 + rand() * 0.3) + 0.25;
      const e = -0.38 + f * 0.62 + (rand() - 0.5) * 0.2;
      const a = V(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)).normalize();
      const O = lean.clone().multiplyScalar(y);
      specs.push({ O, a, s: L * 1.1, roll: 1.0, droop: 0.14 * (1 - f) });
      // A second spray turned up on its edge, so the tree has body seen from the side too.
      if (L > 0.55) specs.push({ O, a: a.clone().add(V(0, -0.12, 0)).normalize(), s: L * 1.0, roll: 0, rollTo: (rand() < 0.5 ? -1 : 1) * (1.0 + rand() * 0.4), droop: 0.1 * (1 - f) });
    }
    y += 0.36 + rand() * 0.16;
  }
  // The leader at the top.
  for (let k = 0; k < 3; k++) {
    const a = V((rand() - 0.5) * 0.25, 1, (rand() - 0.5) * 0.25).normalize();
    specs.push({ O: lean.clone().multiplyScalar(H - 0.95), a, s: 1.0, roll: TAU });
  }
  return finishCards(trunk, cards, specs, rand, { cols: [0, 1, 2, 3], row: 1, H, kind: 'spruce', cone: Rb });
}

function makeWillow(rand) {
  const trunk = new Geo(), cards = new Geo();
  const H = 0.9 + rand() * 1.0;
  const specs = [];
  const n = 9 + Math.floor(rand() * 6);
  for (let k = 0; k < n; k++) {
    const az = rand() * TAU, e = 0.55 + rand() * 0.75, r = rand() * 0.25;
    const a = V(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e));
    specs.push({ O: V(Math.cos(az) * r, 0.05, Math.sin(az) * r), a, s: H * (0.75 + rand() * 0.35), roll: 2.2 });
  }
  return finishCards(trunk, cards, specs, rand, { cols: [4, 5], row: 1, H, kind: 'shrub' });
}

function finishCards(trunk, cards, specs, rand, { cols, row, H, kind, fill = 0, cone = 0 }) {
  // The crown: an ellipsoid round the cards.
  const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
  for (const c of specs) {
    const tip = c.O.clone().addScaledVector(c.a, c.s);
    lo.min(c.O).min(tip); hi.max(c.O).max(tip);
  }
  const C = lo.clone().add(hi).multiplyScalar(0.5);
  const R = hi.clone().sub(lo).multiplyScalar(0.5).max(V(0.3, 0.3, 0.3));
  if (kind === 'shrub') { C.y = H * 0.35; R.y = Math.max(R.y, H * 0.55); }
  const { crownN, depth } = crownFns(C, R);
  let cn = crownN;
  if (cone) {
    // A spruce lights as a cone: outward and a little up.
    cn = (P, out) => { const r = Math.hypot(P.x, P.z) || 1; return out.set(P.x / r, cone / H + 0.25 + (P.y > H - 1.2 ? 1 : 0), P.z / r).normalize(); };
  }
  const ao = cone
    ? (P) => { const f = P.y / H, rr = Math.hypot(P.x, P.z) / (cone * (1 - f) + 0.35); return (0.42 + 0.58 * smoothstep(0.1, 1, rr)) * (0.7 + 0.3 * Math.sqrt(clamp(f, 0, 1))); }
    : (P) => (0.5 + 0.5 * smoothstep(0.15, 1.0, depth(P))) * (0.78 + 0.22 * smoothstep(C.y - R.y, C.y + R.y, P.y));
  // A few big sprays inside the crown, so it never shows daylight straight through.
  for (let k = 0; k < fill; k++) {
    const P = C.clone().add(V((rand() - 0.5) * R.x, (rand() - 0.3) * R.y, (rand() - 0.5) * R.z));
    const a = V(rand() - 0.5, (rand() - 0.5) * 0.6, rand() - 0.5).normalize();
    specs.push({ O: P.addScaledVector(a, -0.8), a, s: 1.7 + rand() * 0.5, roll: TAU });
  }
  for (const c of specs) {
    const n = frameFrom(c.a, c.roll, rand, c.rollTo);
    card(cards, c.O, c.a, n, c.s, cols[Math.floor(rand() * cols.length)], row, cn, ao, rand() < 0.5, c.droop || 0);
  }
  const maxR = Math.max(Math.abs(lo.x), Math.abs(hi.x), Math.abs(lo.z), Math.abs(hi.z));
  return { kind, trunk: trunk.count ? trunk.build() : null, cards: cards.build(), H: Math.max(H, hi.y), R: maxR, crownY: C.y };
}

// ---------------------------------------------------------------------------------------------
// Shaders.
// ---------------------------------------------------------------------------------------------

const COMMON_GLSL = /* glsl */ `
attribute vec4 aI0; attribute vec4 aI1;
uniform vec3 uEye; uniform float uNear; uniform float uBand; uniform float uFar;
uniform vec2 uWindDir; uniform float uWindStr; uniform float uTime;
uniform float uLeaf; uniform float uSnowy; uniform float uSnowLine; uniform float uSnowCover;
varying float vFade; varying float vBare; varying float vHue; varying float vSnow;
vec2 rotY(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(v.x * c + v.y * s, -v.x * s + v.y * c); }
float h11(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
`;
const FRAG_COMMON = /* glsl */ `
varying float vFade; varying float vBare; varying float vHue; varying float vSnow;
uniform float uAutumn; uniform vec3 uSunDir; uniform float uSunUp; uniform float uLeafTone;
// Leaves are the pixels clearly greener than they are red or blue (bark is white or brown).
float leafMask(vec3 c){ return smoothstep(0.08, 0.22, (c.g - max(c.r, c.b)) / max(c.g, 1e-3)); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// Alpha keeps its coverage as the mip maps average it away, so far crowns don't thin out.
float mipBoost(vec2 uv, vec2 size){ vec2 dx = dFdx(uv * size), dy = dFdy(uv * size); return 1.0 + max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy)))) * 0.28; }
vec3 autumnize(vec3 c, float amt){
  float leaf = leafMask(c);
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  vec3 gold = mix(vec3(0.62, 0.36, 0.05), vec3(0.85, 0.55, 0.09), vHue) * l * 2.4;
  gold = mix(gold, vec3(0.5, 0.2, 0.06) * l * 2.2, step(0.86, vHue)); // the odd rusty one
  return mix(c, gold, leaf * amt * (0.7 + 0.3 * vHue)) * mix(1.0, uLeafTone, leaf);
}
`;

// Wind: slow gusts rolling across the wood, and each tree swaying on its own.
const SWAY = /* glsl */ `
  float hN = clamp(lp.y / uTreeH, 0.0, 1.0);
  float gust = g_n(base.xz * 0.025 - uWindDir * uTime * 0.3) * 0.7 + 0.3;
  vec2 sway = uWindDir * gust * uWindStr * 0.32 * hN * hN
    + vec2(sin(uTime * 1.3 + aI1.w * 6.28), cos(uTime * 1.05 + aI1.w * 4.0)) * 0.05 * hN * (0.3 + uWindStr);
`;

function nearVertex(cards) {
  return {
    common: `#include <common>\n${COMMON_GLSL}\nuniform float uTreeH; varying float vUpN;\n${NOISE}\n${TABLE_NOISE}`,
    normal: `#include <beginnormal_vertex>\nobjectNormal.xz = rotY(objectNormal.xz, aI1.x); vUpN = objectNormal.y;`,
    begin: `
      vec3 base = aI0.xyz; float sc = aI0.w;
      vec3 lp = position;
      ${SWAY}
      ${cards ? 'lp += normal * sin(uTime * 3.7 + dot(lp, vec3(3.1, 2.3, 1.7)) + aI1.w * 10.0) * 0.035 * (0.25 + uWindStr) * hN;' : ''}
      lp.xz = rotY(lp.xz, aI1.x);
      vec3 transformed = base + lp * sc + vec3(sway.x, 0.0, sway.y) * sc;
      float dd = distance(base.xz, uEye.xz);
      vFade = smoothstep(uNear - uBand, uNear, dd);
      if (vFade >= 1.0) transformed = vec3(base.x, -1e4, base.z);
      vBare = step(uLeaf, h11(aI1.w * 13.7 + 0.3));
      vHue = aI1.z;
      vSnow = max(uSnowy * (1.0 - smoothstep(uSnowLine - 14.0, uSnowLine - 4.0, base.y)), smoothstep(0.5, 1.0, uSnowCover) * 0.9);`,
  };
}

function nearMaterials(map, uniforms, { cards, deciduous, bareShift, H, shrub }) {
  const U = { ...uniforms, uTreeH: { value: H }, uBareShift: { value: bareShift } };
  const V = nearVertex(cards);
  const mapChunk = `
    vec2 tuv = vMapUv;
    ${cards && deciduous ? 'tuv.x += vBare * uBareShift;' : ''}
    vec4 texel = texture2D(map, tuv);
    ${cards ? 'texel.a *= mipBoost(tuv, vec2(2048.0, 512.0));' : ''}
    diffuseColor *= texel;`;
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: cards ? 0.82 : 0.9, metalness: 0, side: cards ? THREE.DoubleSide : THREE.FrontSide, alphaTest: cards ? 0.5 : 0 });
  if (cards && deciduous) mat.defines.DECID = '';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, surfaceUniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', V.common).replace('#include <beginnormal_vertex>', V.normal).replace('#include <begin_vertex>', V.begin);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_COMMON}\nuniform float uBareShift; varying float vUpN;`)
      .replace('#include <map_fragment>', mapChunk)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef DECID
        diffuseColor.rgb = autumnize(diffuseColor.rgb, uAutumn);
        #else
        diffuseColor.rgb *= mix(1.0, uLeafTone, leafMask(diffuseColor.rgb));
        #endif
        diffuseColor.rgb *= mix(vec3(0.9, 1.0, 0.88), vec3(1.08, 1.02, 0.9), vHue);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), vSnow * smoothstep(${cards ? '0.25, 0.75' : '0.5, 0.9'}, vUpN));`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        if (ign(gl_FragCoord.xy) < vFade) discard;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        ${cards ? 'normal = normalize(vNormal);' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${cards ? `{ vec3 sv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float back = pow(max(dot(normalize(-vViewPosition), sv), 0.0), 4.0);
          float leafy = leafMask(diffuseColor.rgb);
          totalEmissiveRadiance += diffuseColor.rgb * back * leafy * uSunUp * ${shrub ? '0.5' : '0.65'}; }` : ''}`);
  };
  mat.customProgramCacheKey = () => `tree-near-${cards}-${deciduous}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: cards ? 0.5 : 0, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, surfaceUniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', V.common).replace('#include <begin_vertex>', V.begin.replace(/lp \+= normal[^\n]*\n/, ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_COMMON}\nuniform float uBareShift;`)
      .replace('#include <map_fragment>', cards ? mapChunk : '')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\nif (ign(gl_FragCoord.xy) < vFade) discard;`);
  };
  depth.customProgramCacheKey = () => `tree-near-depth-${cards}-${deciduous}`;
  return { mat, depth };
}

// The impostor: two quads per tree, one standing (turned to face you, picturing the tree from
// the nearest two of 16 sides), one lying flat at crown height (the tree from above), crossfaded by
// how steeply you look down on it.
function impostorMaterials(colTex, norTex, uniforms, rows, cellPx, bareRows) {
  const U = {
    ...uniforms,
    uImpCol: { value: colTex }, uImpNor: { value: norTex },
    uRows: { value: rows.map((r) => new THREE.Vector4(r.S, r.crownY, r.decid ? 1 : 0, r.H)) },
    uBareRows: { value: bareRows },
    uAtlas: { value: new THREE.Vector2(VIEWS + 1, rows.length) },
    uTexSize: { value: new THREE.Vector2((VIEWS + 1) * cellPx, rows.length * cellPx) },
  };
  const vert = (depthPass) => ({
    common: `#include <common>\n${COMMON_GLSL}\n${NOISE}
      attribute float aTop;
      uniform vec4 uRows[${rows.length}]; uniform float uBareRows; uniform vec2 uAtlas;
      varying vec2 vUv0; varying vec2 vUv1; varying float vT; varying float vTopW; varying float vIsTop; varying float vYaw; varying float vFar; varying float vDecid;`,
    begin: `
      vec3 base = aI0.xyz; float sc = aI0.w;
      float row = aI1.y;
      vec4 R = uRows[int(row + 0.5)];
      vDecid = R.z;
      vBare = R.z > 0.5 ? step(uLeaf, h11(aI1.w * 13.7 + 0.3)) : 0.0;
      float rowT = row + vBare * uBareRows;
      float S = R.x * sc;
      vec3 toC = cameraPosition - base;
      float dh = max(length(toC.xz), 1e-3);
      vec2 dir = toC.xz / dh;
      float elev = atan(toC.y - R.y * sc, dh);
      vTopW = smoothstep(0.8, 1.15, elev);
      float a = atan(dir.x, dir.y) - aI1.x;
      float f = fract(a / 6.2831853) * ${VIEWS}.0;
      float i0 = floor(f); vT = f - i0;
      float i1 = mod(i0 + 1.0, ${VIEWS}.0);
      vec3 transformed;
      vIsTop = aTop;
      if (aTop < 0.5) {
        vec3 right = vec3(dir.y, 0.0, -dir.x);
        float sw = sin(uTime * 1.2 + aI1.w * 6.28) * 0.012 * position.y * position.y * (0.4 + uWindStr);
        transformed = base + right * (position.x + sw) * S + vec3(0.0, (position.y - 0.03) * S, 0.0);
        vec2 luv = vec2(position.x + 0.5, position.y);
        vUv0 = (vec2(i0, rowT) + luv) / uAtlas;
        vUv1 = (vec2(i1, rowT) + luv) / uAtlas;
      } else {
        vec2 o = rotY(position.xz, aI1.x) * S;
        transformed = base + vec3(o.x, R.y * sc, o.y);
        vec2 luv = vec2(position.x + 0.5, 0.5 - position.z);
        vUv0 = vUv1 = (vec2(${VIEWS}.0, rowT) + luv) / uAtlas;
      }
      float dd = distance(base.xz, uEye.xz);
      vFade = smoothstep(uNear - uBand, uNear, dd);
      vFar = smoothstep(uFar * 0.82, uFar, dd);
      if (vFade <= 0.0 || vFar >= 1.0) transformed = vec3(base.x, -1e4, base.z);
      vYaw = aI1.x; vHue = aI1.z;
      vSnow = max(uSnowy * (1.0 - smoothstep(uSnowLine - 14.0, uSnowLine - 4.0, base.y)), smoothstep(0.5, 1.0, uSnowCover) * 0.9);`,
  });
  const fragCommon = `${FRAG_COMMON}
    uniform sampler2D uImpCol; uniform sampler2D uImpNor; uniform vec2 uTexSize;
    varying vec2 vUv0; varying vec2 vUv1; varying float vT; varying float vTopW; varying float vIsTop; varying float vYaw; varying float vFar; varying float vDecid;
    vec2 rotY(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(v.x * c + v.y * s, -v.x * s + v.y * c); }`;
  const sample = `
    vec4 c0 = texture2D(uImpCol, vUv0), c1 = texture2D(uImpCol, vUv1);
    vec4 cc = mix(c0, c1, vT);
    cc.a *= mipBoost(vUv0, uTexSize);
    if (cc.a < 0.5) discard;
    float dz = ign(gl_FragCoord.xy);
    if (dz >= vFade || dz < vFar) discard;
    float dz2 = ign(gl_FragCoord.xy + vec2(17.0, 31.0));
    if (vIsTop > 0.5 ? dz2 >= vTopW : dz2 < vTopW) discard;`;
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const V0 = vert(false);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, surfaceUniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', V0.common).replace('#include <begin_vertex>', V0.begin);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragCommon}`)
      .replace('#include <map_fragment>', `${sample}
        vec3 alb = pow(cc.rgb, vec3(2.2));
        alb = autumnize(alb, uAutumn * vDecid);
        alb *= mix(vec3(0.9, 1.0, 0.88), vec3(1.08, 1.02, 0.9), vHue);
        vec3 nl = normalize(mix(texture2D(uImpNor, vUv0).xyz, texture2D(uImpNor, vUv1).xyz, vT) * 2.0 - 1.0);
        nl.xz = rotY(nl.xz, vYaw);
        alb = mix(alb, vec3(0.86, 0.89, 0.93), vSnow * smoothstep(0.3, 0.8, nl.y));
        diffuseColor.rgb *= alb;
        vec3 impN = normalize((viewMatrix * vec4(nl, 0.0)).xyz);`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = impN;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 sv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float back = pow(max(dot(normalize(-vViewPosition), sv), 0.0), 4.0);
          float leafy = leafMask(diffuseColor.rgb);
          totalEmissiveRadiance += diffuseColor.rgb * back * leafy * uSunUp * 0.55; }`);
  };
  mat.customProgramCacheKey = () => 'tree-impostor';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, surfaceUniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', V0.common).replace('#include <begin_vertex>', V0.begin);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${fragCommon}`).replace('#include <map_fragment>', sample);
  };
  depth.customProgramCacheKey = () => 'tree-impostor-depth';
  return { mat, depth };
}

// ---------------------------------------------------------------------------------------------
// Baking the impostors: each near model, from 16 sides and from above, into two atlases: colour
// (with its shade baked in) and the crown's normals, so they light like the near trees.
// ---------------------------------------------------------------------------------------------

function bakeMaterial(map, isCard, bareShift) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uMode: { value: 0 }, uBare: { value: 0 }, uShift: { value: bareShift } },
    vertexShader: /* glsl */ `
      attribute vec3 color; varying vec2 vUv; varying vec3 vN; varying vec3 vCol;
      void main(){ vUv = uv; vN = normal; vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uMode; uniform float uBare; uniform float uShift;
      varying vec2 vUv; varying vec3 vN; varying vec3 vCol;
      void main(){
        vec2 uv = vUv; uv.x += uBare * uShift;
        vec4 t = texture2D(map, uv);
        float a = ${isCard ? 'clamp((t.a - 0.5) / max(fwidth(t.a), 1e-3) + 0.5, 0.0, 1.0)' : '1.0'};
        if (a <= 0.0) discard;
        vec3 n = normalize(vN);
        gl_FragColor = uMode < 0.5 ? vec4(pow(t.rgb * vCol, vec3(1.0 / 2.2)), a) : vec4(n * 0.5 + 0.5, a);
      }`,
    side: isCard ? THREE.DoubleSide : THREE.FrontSide,
    alphaToCoverage: isCard,
  });
}

function bakeImpostors(renderer, rows, models, cellPx, cardTex, barkTex) {
  const cols = VIEWS + 1, W = cols * cellPx, Hh = rows.length * cellPx;
  const mk = () => {
    // Made with mip levels (the storage is fixed when it is made), filled with them off, and the
    // mips worked out once at the end.
    const rt = new THREE.WebGLRenderTarget(W, Hh, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.anisotropy = 4;
    renderer.initRenderTarget(rt);
    rt.texture.generateMipmaps = false;
    return rt;
  };
  const colRT = mk(), norRT = mk();
  const cellRT = new THREE.WebGLRenderTarget(cellPx, cellPx, { samples: 4 });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const copyMat = new THREE.ShaderMaterial({
    uniforms: { t: { value: cellRT.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }',
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
  quad.frustumCulled = false;
  const copyScene = new THREE.Scene(); copyScene.add(quad);
  const copyCam = new THREE.Camera();
  const saved = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), shadow: renderer.shadowMap.autoUpdate };
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  const clearAll = (rt) => { renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false); };
  clearAll(colRT); clearAll(norRT);
  const total = rows.length * cols * 2;
  let done = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r], m = models[row.model];
    scene.clear();
    const mats = [];
    if (m.trunk) { const bm = bakeMaterial(barkTex[m.kind === 'spruce' ? 1 : 0], false, 0); mats.push(bm); scene.add(new THREE.Mesh(m.trunk, bm)); }
    const cm = bakeMaterial(cardTex, true, row.bareShift); cm.uniforms.uBare.value = row.bare ? 1 : 0; mats.push(cm);
    scene.add(new THREE.Mesh(m.cards, cm));
    const S = row.S, mg = S * 0.03;
    for (let v = 0; v < cols; v++) {
      if (v < VIEWS) {
        const th = (v / VIEWS) * TAU;
        cam.left = -S / 2; cam.right = S / 2; cam.top = S - mg; cam.bottom = -mg;
        cam.position.set(Math.sin(th) * 60, 0, Math.cos(th) * 60); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
      } else {
        cam.left = -S / 2; cam.right = S / 2; cam.top = S / 2; cam.bottom = -S / 2;
        cam.position.set(0, 60, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
      }
      cam.near = 1; cam.far = 140; cam.updateProjectionMatrix();
      for (const [pass, rt] of [[0, colRT], [1, norRT]]) {
        for (const bm of mats) bm.uniforms.uMode.value = pass;
        renderer.setRenderTarget(cellRT);
        // Colour clears to the foliage's own tone (see-through), so mip maps fade to foliage.
        if (pass === 0) renderer.setClearColor(row.kind === 'spruce' ? 0x24321f : 0x46562a, 0); else renderer.setClearColor(0x80c080, 0);
        renderer.clear(true, true, false);
        renderer.render(scene, cam);
        done++;
        rt.texture.generateMipmaps = done >= total - 1;
        rt.viewport.set(v * cellPx, r * cellPx, cellPx, cellPx);
        rt.scissor.set(v * cellPx, r * cellPx, cellPx, cellPx);
        rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.render(copyScene, copyCam);
      }
    }
    for (const bm of mats) bm.dispose();
  }
  for (const rt of [colRT, norRT]) { rt.scissorTest = false; rt.viewport.set(0, 0, W, Hh); rt.scissor.set(0, 0, W, Hh); }
  renderer.setRenderTarget(saved.target);
  renderer.autoClear = saved.autoClear;
  renderer.setClearColor(saved.color, saved.alpha);
  renderer.shadowMap.autoUpdate = saved.shadow;
  cellRT.dispose(); copyMat.dispose(); quad.geometry.dispose();
  return { col: colRT, nor: norRT };
}

// ---------------------------------------------------------------------------------------------
// Where the trees grow, and drawing them.
// ---------------------------------------------------------------------------------------------

class Stream {
  constructor(geo, cap) { this.geo = geo; this.alloc(cap); }
  alloc(cap) {
    this.cap = cap;
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * STRIDE), STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    for (const g of this.geos()) {
      // three.js remembers how many instances a geometry can draw the first time it draws it;
      // forget that when the buffer grows, or only the first ones ever show.
      g._maxInstanceCount = undefined;
      g.setAttribute('aI0', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
      g.setAttribute('aI1', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    }
  }
  geos() { return [].concat(this.geo); }
  fill(n, write) {
    if (n > this.cap) { this.alloc(Math.ceil(n * 1.4) + 16); }
    write(this.buf.array);
    this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, n * STRIDE);
    this.buf.needsUpdate = true;
    for (const g of this.geos()) g.instanceCount = n;
  }
}

export class Trees {
  constructor(scene, renderer, { quality = 'medium', obstacles = null, clear = [], farms = [], homes = [], landmarks = [], avoid = [] } = {}) {
    const Q = QUALITY[quality] || QUALITY.medium;
    this.Q = Q;
    this.scene = scene;
    const t0 = performance.now();
    const rand = mulberry32(5150);
    // Models.
    const models = [], variants = [];
    const add = (kind, make, n) => { for (let i = 0; i < n; i++) { const m = make(rand); m.variant = variants.length; models.push(m); variants.push(m); } };
    add('birch', makeBirch, Q.birch);
    add('spruce', makeSpruce, Q.spruce);
    add('shrub', makeWillow, Q.shrub);
    this.models = models;
    const cardTex = buildCardAtlas();
    const barkTex = [barkTexture('birch'), barkTexture('spruce')];
    this.textures = [cardTex, ...barkTex];
    // Impostor rows: each birch leafy, each birch bare, each spruce.
    const rows = [];
    const rowOf = new Map();
    const pushRow = (m, bare) => {
      const S = Math.max(m.R * 2.1, m.H * 1.04);
      rows.push({ model: m.variant, kind: m.kind, bare, decid: m.kind === 'birch', S, H: m.H, crownY: m.crownY, bareShift: m.kind === 'birch' ? 0.5 : 0.25 });
      return rows.length - 1;
    };
    for (const m of models) if (m.kind === 'birch') rowOf.set(m.variant, pushRow(m, false));
    for (const m of models) if (m.kind === 'birch') pushRow(m, true);
    for (const m of models) if (m.kind === 'spruce') rowOf.set(m.variant, pushRow(m, false));
    this.rows = rows;

    this.uniforms = {
      uEye: { value: new THREE.Vector3() }, uNear: { value: Q.near }, uBand: { value: Q.band }, uFar: { value: Q.far },
      uWindDir: { value: new THREE.Vector2(0.8, 0.6) }, uWindStr: { value: 0.4 },
      uLeaf: { value: 1 }, uAutumn: { value: 0 }, uSnowy: { value: 0 },
      // The classic look has no camera tone curve, so its leaves are toned down to sit with its grass.
      uLeafTone: { value: HD.on ? 1 : 0.8 },
    };
    // Near meshes: one instanced trunk and one card mesh per variant, sharing one instance stream.
    this.near = [];
    for (const m of models) {
      const shrub = m.kind === 'shrub';
      const U = shrub ? { ...this.uniforms, uNear: { value: Q.shrubFar }, uBand: { value: Q.shrubFar * 0.25 } } : this.uniforms;
      const geos = [], meshes = [];
      const mk = (g, cards) => {
        const ig = new THREE.InstancedBufferGeometry();
        ig.index = g.index;
        for (const k of ['position', 'normal', 'uv', 'color']) ig.setAttribute(k, g.attributes[k]);
        ig.instanceCount = 0;
        const { mat, depth } = nearMaterials(cards ? cardTex : barkTex[m.kind === 'spruce' ? 1 : 0], U, { cards, deciduous: m.kind !== 'spruce', bareShift: m.kind === 'birch' ? 0.5 : 0.25, H: m.H, shrub });
        const mesh = new THREE.Mesh(ig, mat);
        mesh.customDepthMaterial = depth;
        mesh.castShadow = !shrub; mesh.receiveShadow = true;
        mesh.frustumCulled = false; mesh.userData.noAO = true;
        mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false;
        geos.push(ig); meshes.push(mesh);
        scene.add(mesh);
      };
      if (m.trunk) mk(m.trunk, false);
      mk(m.cards, true);
      this.near.push({ model: m, stream: new Stream(geos, 64), meshes, reach: shrub ? Q.shrubFar : Q.near * 1.2 });
    }
    // Impostors.
    const baked = bakeImpostors(renderer, rows, models, Q.cellPx, cardTex, barkTex);
    this.baked = baked;
    const ig = new THREE.InstancedBufferGeometry();
    const pos = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5];
    ig.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ig.setAttribute('aTop', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
    ig.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    ig.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    const nb = models.filter((m) => m.kind === 'birch').length;
    const imp = impostorMaterials(baked.col.texture, baked.nor.texture, this.uniforms, rows, Q.cellPx, nb);
    this.impMesh = new THREE.Mesh(ig, imp.mat);
    this.impMesh.customDepthMaterial = imp.depth;
    this.impMesh.castShadow = true; this.impMesh.receiveShadow = true;
    this.impMesh.frustumCulled = false; this.impMesh.userData.noAO = true;
    this.impMesh.matrixAutoUpdate = false; this.impMesh.matrixWorldAutoUpdate = false;
    scene.add(this.impMesh);
    this.impStream = new Stream(ig, 1024);

    // Planting.
    this.place({ rand, obstacles, clear, farms, homes, landmarks, avoid, rowOf, density: Q.density });
    this.lastNear = null; this.lastFar = null;
    this.buildMs = Math.round(performance.now() - t0);
  }

  place({ rand, obstacles, clear, farms, homes, landmarks, avoid, rowOf, density }) {
    const byKind = { birch: [], spruce: [], shrub: [] };
    for (const m of this.models) byKind[m.kind].push(m.variant);
    const trees = []; // [x, y, z, scale, yaw, row, hue, rnd, variant]
    const nPatch = createNoise2D(71), nKind = createNoise2D(83);
    const roadClear = roadHalfWidth('paved') + 2.8;
    const blocked = (x, z, pad = 0) => {
      for (const c of clear) { const dx = x - c.x, dz = z - c.z, r = c.r + pad; if (dx * dx + dz * dz < r * r) return true; }
      for (const c of avoid) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < c.r * c.r) return true; }
      return false;
    };
    const lmAvoid = landmarks.map((l) => ({ x: l.x, z: l.z, r: l.kind === 'park' ? 35 : l.kind === 'town' ? 40 : 70 }));
    const why = this.rejects = {};
    const no = (k) => { why[k] = (why[k] || 0) + 1; return null; };
    const ground = (x, z, kind) => {
      if (x < BOUNDS.minX + 5 || x > BOUNDS.maxX - 5 || z < BOUNDS.minZ + 5 || z > BOUNDS.maxZ - 5) return no('edge');
      if (roadDistAt(x, z) < roadClear + (kind === 'spruce' ? 2.2 : kind === 'shrub' ? -0.6 : 0.8)) return no('road');
      const h = heightAt(x, z);
      if (h < waterLevelAt(x, z) + 0.45) return no('water');
      if (h > 34) return no('high'); // the tree line (birch reaches about 550 m in Iceland)
      const s = Math.abs(heightAt(x + 2, z) - h) + Math.abs(heightAt(x, z + 2) - h);
      if (s > 2.2) return no('steep');
      if (coastAt(x, z) < 18) return no('coast');
      if (sandMask(x, z, h) > 0.2) return no('sand');
      if (glacierMask(x, z) > 0.05) return no('ice');
      if (lavaMask(x, z) > 0.5 && kind === 'spruce') return no('lava');
      for (const c of lmAvoid) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < c.r * c.r) return no('landmark'); }
      if (blocked(x, z, 6)) return no('clear');
      if (obstacles?.boxNear(x, z, kind === 'spruce' ? 3 : 2.4)) return no('building');
      return h;
    };
    // The woods and copses keep clear of farmyards (their own shelterbelts are planted apart).
    const wild = (x, z, kind) => {
      for (const c of homes) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < c.r * c.r) return no('farm'); }
      return ground(x, z, kind);
    };
    const plant = (x, z, kind, scale, h) => {
      const list = byKind[kind];
      const variant = list[Math.floor(rand() * list.length)];
      // A tree stands a little into the ground so slopes never show its foot in the air.
      trees.push([x, h - 0.12, z, scale, rand() * TAU, kind === 'shrub' ? -1 : rowOf.get(variant), rand(), rand(), variant]);
      if (obstacles && kind !== 'shrub') obstacles.addCircle(x, z, (kind === 'spruce' ? 0.32 : 0.24) * scale, 'tree');
    };
    for (const Z of ZONES) {
      let c = toWorld(Z.ll[0], Z.ll[1]);
      // The island's roads are fewer than the real ones: a wood whose road the game leaves out
      // slides over to the nearest road it has, so you still drive through it.
      const rd = nearestRoadAnywhere(c.x, c.z);
      if (rd) {
        const d = Math.hypot(c.x - rd.x, c.z - rd.z);
        if (d > Z.r * 0.4) c = { x: rd.x + (c.x - rd.x) / d * Z.r * 0.35, z: rd.z + (c.z - rd.z) / d * Z.r * 0.35 };
        Z.road = Math.round(d);
      }
      Z.at = c;
      const sp = 4.4 / Math.sqrt(Z.d * density);
      for (let gx = -Z.r; gx < Z.r; gx += sp) for (let gz = -Z.r; gz < Z.r; gz += sp) {
        const x = c.x + gx + (rand() - 0.5) * sp * 0.9, z = c.z + gz + (rand() - 0.5) * sp * 0.9;
        const q = Math.hypot(x - c.x, z - c.z) / Z.r;
        if (q >= 1) continue;
        // Woods come in stands with glades between, ragged at the edge.
        const np = fbm(nPatch, x / 110, z / 110, 3);
        const keep = smoothstep(1.0, 0.7, q + np * 0.35) * smoothstep(-0.42, -0.18, np + (Z.town ? -0.12 : 0));
        if (rand() > keep) { no('patch'); continue; }
        // Plantations: spruce in blocks; scrub most often at the edges.
        const nk = nKind(x / 160, z / 160) * 0.5 + 0.5;
        let kind = nk < Z.mix[1] ? 'spruce' : 'birch';
        if (rand() < Z.mix[2] + smoothstep(0.65, 1, q) * 0.25) kind = 'shrub';
        const h = wild(x, z, kind);
        if (h == null) continue;
        Z.n = (Z.n || 0) + 1;
        let scale = (kind === 'spruce' ? 0.7 + rand() * 0.5 : kind === 'shrub' ? 0.7 + rand() * 0.6 : 0.62 + rand() * 0.6) * (kind === 'shrub' ? 1 : Z.small || 1);
        scale *= 1 - 0.3 * smoothstep(0.65, 1, q) - 0.35 * smoothstep(20, 34, h);
        plant(x, z, kind, scale, h);
      }
    }
    // Shelterbelts behind the farms (props.js).
    for (const f of farms) {
      const h = ground(f.x, f.z, f.kind);
      if (h != null) plant(f.x, f.z, f.kind, f.scale, h);
    }
    // Copses of birch and willow here and there along the roads in the lowlands, most in the
    // sheltered valleys of the east and north.
    const nCopse = 220;
    const nRegion = createNoise2D(97);
    for (let k = 0, tries = 0; k < nCopse && tries < nCopse * 30; tries++) {
      const x = BOUNDS.minX + rand() * (BOUNDS.maxX - BOUNDS.minX), z = BOUNDS.minZ + rand() * (BOUNDS.maxZ - BOUNDS.minZ);
      const rd = roadDistAt(x, z);
      if (rd > 160 || rd < 12) continue;
      if (isleAt && isleAt(x, z)) continue;
      const east = smoothstep(BOUNDS.minX + (BOUNDS.maxX - BOUNDS.minX) * 0.35, BOUNDS.maxX, x);
      if (rand() > 0.25 + 0.5 * east + 0.25 * nRegion(x / 400, z / 400)) continue;
      const h0 = heightAt(x, z);
      if (h0 > 16 || h0 < 1) continue;
      k++;
      const n = 4 + Math.floor(rand() * 20), R = 8 + rand() * 22;
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU, r = Math.sqrt(rand()) * R;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const kind = rand() < 0.3 ? 'shrub' : 'birch';
        const h = wild(px, pz, kind);
        if (h == null) continue;
        plant(px, pz, kind, kind === 'shrub' ? 0.7 + rand() * 0.6 : 0.55 + rand() * 0.45, h);
      }
    }
    this.count = trees.length;
    this.zones = ZONES;
    // Pack by cell (and within a cell, by variant) so a cell's trees are one slice per variant.
    const NV = this.models.length;
    const gx = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / CELL), gz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / CELL);
    this.grid = { gx, gz };
    const cellOf = (t) => clamp(Math.floor((t[2] - BOUNDS.minZ) / CELL), 0, gz - 1) * gx + clamp(Math.floor((t[0] - BOUNDS.minX) / CELL), 0, gx - 1);
    const keyed = trees.map((t) => ({ t, k: cellOf(t) * NV + t[8] }));
    keyed.sort((a, b) => a.k - b.k);
    const data = new Float32Array(keyed.length * STRIDE);
    const start = new Int32Array(gx * gz * NV + 1);
    let ki = 0;
    for (let slot = 0; slot < gx * gz * NV; slot++) {
      start[slot] = ki;
      while (ki < keyed.length && keyed[ki].k === slot) {
        const t = keyed[ki].t, o = ki * STRIDE;
        for (let j = 0; j < 8; j++) data[o + j] = t[j];
        ki++;
      }
    }
    start[gx * gz * NV] = ki;
    this.data = data; this.start = start; this.NV = NV;
    this.isShrub = this.models.map((m) => m.kind === 'shrub');
    this.firstShrub = this.isShrub.indexOf(true);
    if (this.firstShrub < 0) this.firstShrub = NV;
  }

  // Which cells a reach covers, as seen from anywhere in the eye's cell.
  cellsWithin(cx, cz, reach, fn) {
    const { gx, gz } = this.grid, n = Math.ceil(reach / CELL);
    for (let z = Math.max(0, cz - n); z <= Math.min(gz - 1, cz + n); z++) for (let x = Math.max(0, cx - n); x <= Math.min(gx - 1, cx + n); x++) {
      const dx = Math.max(0, Math.abs(x - cx) - 1) * CELL, dz = Math.max(0, Math.abs(z - cz) - 1) * CELL;
      if (dx * dx + dz * dz <= reach * reach) fn(z * gx + x);
    }
  }

  rebuild(ex, ez, force = false) {
    const cx = clamp(Math.floor((ex - BOUNDS.minX) / CELL), 0, this.grid.gx - 1), cz = clamp(Math.floor((ez - BOUNDS.minZ) / CELL), 0, this.grid.gz - 1);
    const key = cz * this.grid.gx + cx;
    const { start, data, NV } = this;
    if (force || key !== this.lastNear) {
      this.lastNear = key;
      // The cells the detailed trees can reach from anywhere in this cell, with each cell's middle.
      const reach = Math.max(...this.near.map((N) => N.reach)) + 2;
      const cells = [];
      this.cellsWithin(cx, cz, reach, (c) => {
        let any = false; for (let v = 0; v < NV; v++) if (start[c * NV + v + 1] > start[c * NV + v]) { any = true; break; }
        if (!any) return;
        const x = BOUNDS.minX + ((c % this.grid.gx) + 0.5) * CELL, z = BOUNDS.minZ + (Math.floor(c / this.grid.gx) + 0.5) * CELL;
        cells.push({ c, x, z, y: heightAt(x, z) });
      });
      this.nearCells = cells;
      this.nearView = null;
    }
    // The impostors change slowly: redo them when you are two cells from where they were made.
    const far = this.lastFar;
    if (force || !far || Math.abs(far[0] - cx) > 1 || Math.abs(far[1] - cz) > 1) {
      this.lastFar = [cx, cz];
      const slices = [];
      let n = 0;
      this.cellsWithin(cx, cz, this.Q.far + CELL * 2, (c) => {
        const a = start[c * NV], b = start[c * NV + this.firstShrub];
        if (b > a) { slices.push(a, b); n += b - a; }
      });
      this.impStream.fill(n, (arr) => { let o = 0; for (let i = 0; i < slices.length; i += 2) { arr.set(data.subarray(slices[i] * STRIDE, slices[i + 1] * STRIDE), o); o += (slices[i + 1] - slices[i]) * STRIDE; } });
    }
  }

  // The frame-rate governor's level (perf.js): when frames run long the detailed trees give way to
  // impostors sooner and the far woods end a little nearer; with room to spare they reach further.
  setLevel(level) {
    const near = [1.2, 1, 1, 0.85, 0.72, 0.6][level] ?? 1, far = [1.1, 1, 1, 0.9, 0.8, 0.7][level] ?? 1;
    this.uniforms.uNear.value = this.Q.near * near;
    this.uniforms.uFar.value = this.Q.far * far;
  }

  // Month (0 to 11): leaves out, gold or gone, and snow on the branches in winter.
  setMonth(m) {
    this.uniforms.uLeaf.value = LEAF[m];
    this.uniforms.uAutumn.value = AUTUMN[m];
    this.uniforms.uSnowy.value = SNOWY[m];
  }

  update(camera, wind) {
    this.uniforms.uEye.value.copy(camera.position);
    if (wind) {
      const s = Math.hypot(wind.x, wind.z) || 1;
      this.uniforms.uWindDir.value.set(wind.x / s, wind.z / s);
      this.uniforms.uWindStr.value = Math.min(1.2, 0.2 + s * 0.06);
    }
    this.rebuild(camera.position.x, camera.position.z);
    this.cullNear(camera);
  }

  // The detailed trees are refilled from the cells in view (and a ring close round you, whose
  // shadows can fall into view) whenever the camera has moved or turned a little: drawing every
  // detailed tree round you, behind you included, was most of their cost.
  cullNear(camera, force = false) {
    camera.updateMatrixWorld();
    const p = camera.position, e = camera.matrixWorld.elements, V = this.nearView;
    if (!force && V && V.key === this.lastNear && Math.hypot(p.x - V.x, p.z - V.z) < 1.5 && Math.abs(p.y - V.y) < 1.5 && e[8] * V.d[0] + e[9] * V.d[1] + e[10] * V.d[2] > 0.9997 && camera.fov === V.fov) return;
    this.nearView = { key: this.lastNear, x: p.x, y: p.y, z: p.z, d: [e[8], e[9], e[10]], fov: camera.fov };
    const fr = this._fr ||= new THREE.Frustum(), m = this._m ||= new THREE.Matrix4(), sph = this._s ||= new THREE.Sphere();
    // A slightly wider view than the camera's, so turning never shows a gap before the next refill.
    fr.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const { start, data, NV } = this, keep = [];
    for (const C of this.nearCells || []) {
      const dx = C.x - p.x, dz = C.z - p.z;
      sph.center.set(C.x, C.y + 6, C.z); sph.radius = CELL * 0.75 + 18;
      if (dx * dx + dz * dz < 40 * 40 || fr.intersectsSphere(sph)) keep.push(C.c);
    }
    for (let v = 0; v < NV; v++) {
      const N = this.near[v], slices = [];
      let n = 0;
      for (const c of keep) { const a = start[c * NV + v], b = start[c * NV + v + 1]; if (b > a) { slices.push(a, b); n += b - a; } }
      N.stream.fill(n, (arr) => { let o = 0; for (let i = 0; i < slices.length; i += 2) { arr.set(data.subarray(slices[i] * STRIDE, slices[i + 1] * STRIDE), o); o += (slices[i + 1] - slices[i]) * STRIDE; } });
    }
  }

  // How many trees are drawn now (for tests).
  get drawn() { return { near: this.near.map((n) => n.stream.geo[0].instanceCount), impostors: this.impStream.geo.instanceCount ?? this.impStream.geos()[0].instanceCount }; }
}
