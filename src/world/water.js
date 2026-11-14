// The look of open water, shared by the sea, the lakes, the fords, the surf and the plunge pools.
//
// Two small tiling textures are worked out once, at load, and every water shader reads them:
//
// - The wave tile (256 x 256): a patch of sea made of about forty wave trains, each a whole number
//   of wavelengths across the tile so it repeats without a seam. Real waves have sharp crests and
//   broad, flat troughs, so each train is shaped exp(sin - 1) rather than a plain sine, and the
//   trains drag on one another (each shifts where the next is read), which bunches the crests into
//   groups as on the real sea. It stores the surface's slope (R, G) and height (B). Shaders read
//   it at three or four sizes, turned and drifting different ways at speeds near the real phase
//   speed of waves that long, so the pattern never visibly repeats or slides as one sheet. Mip
//   maps blur it with distance exactly as the eye does, so far water calms to a mirror without
//   sparkling, and the shaders roughen it there to keep the sun's glitter path as wide as it is.
// - The foam tile (256 x 256): R is lace (the thin bright threads round dark holes that foam on
//   water makes, the edges of a cellular pattern at two sizes), G soft blotches, B fine bubbles,
//   A streaks. The same lace, inverted and sharpened, is the network of caustic light on the bed.
//
// Both are periodic in both directions and made with seeded random numbers, so every load and
// every device draws the same water.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const N = 256;
let waveTex = null, foamTex = null;

// Slopes are stored as slope / SLOPE * 0.5 + 0.5. In tile units (the tile is 1 across, heights in
// the same units), the steepest point is under 3.
export const WAVE_SLOPE = 3.2;

function bakeWaves() {
  const rnd = mulberry32(9127);
  // Wave trains: integer wave numbers (m, n) so each repeats across the tile, spread round the
  // main direction (+x), longer waves stronger (slope spectrum falling as k^-0.5 here, height as
  // k^-1.5), random phase.
  const trains = [];
  const pick = new Set();
  while (trains.length < 36) {
    const k = 2 + Math.floor(Math.pow(rnd(), 1.6) * 34); // 2..35 wavelengths across
    const spread = (rnd() - 0.5) * 2 * (k < 6 ? 0.55 : 1.1); // long swell keeps to one direction
    let m = Math.round(Math.cos(spread) * k), n = Math.round(Math.sin(spread) * k);
    if (!m && !n) continue;
    const key = `${m},${n}`;
    if (pick.has(key)) continue;
    pick.add(key);
    const kk = Math.hypot(m, n);
    trains.push({ m, n, kk, a: Math.pow(kk, -1.5), ph: rnd() * Math.PI * 2 });
  }
  trains.sort((a, b) => a.kk - b.kk);
  let norm = 0; for (const w of trains) norm += w.a;
  const TAU = Math.PI * 2;
  const h = new Float32Array(N * N);
  let hMin = Infinity, hMax = -Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let px = x / N, py = y / N, sum = 0;
    for (const w of trains) {
      const ph = TAU * (w.m * px + w.n * py) + w.ph;
      const s = Math.sin(ph), e = Math.exp(s - 1);
      sum += w.a * e;
      // Drag: shift the point along this train by its slope, so the next trains are read where the
      // water has bunched. The shift is a periodic function of the point, so the tile still repeats.
      const d = Math.cos(ph) * e * w.a / norm * 0.09;
      px += (w.m / w.kk) * d; py += (w.n / w.kk) * d;
    }
    const v = sum / norm;
    h[y * N + x] = v;
    if (v < hMin) hMin = v; if (v > hMax) hMax = v;
  }
  // Heights in tile units: the tallest waves stand about 1/14 of the tile from trough to crest
  // (a 90 m tile gives swell of about 6 m, a stormy-but-not-wild Atlantic).
  const H = 1 / 14, span = hMax - hMin || 1;
  const data = new Uint8Array(N * N * 4);
  const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = (at(x + 1, y) - at(x - 1, y)) / span * H * N / 2;
    const sy = (at(x, y + 1) - at(x, y - 1)) / span * H * N / 2;
    const v = (at(x, y) - hMin) / span;
    const i = (y * N + x) * 4;
    data[i] = Math.max(0, Math.min(255, Math.round((sx / WAVE_SLOPE * 0.5 + 0.5) * 255)));
    data[i + 1] = Math.max(0, Math.min(255, Math.round((sy / WAVE_SLOPE * 0.5 + 0.5) * 255)));
    data[i + 2] = Math.round(v * 255);
    data[i + 3] = 255;
  }
  return data;
}

// Periodic cellular noise: distance to the nearest and second-nearest of a set of points that
// repeats every P cells. Returns F2 - F1 (zero on the edges between cells).
function cellular(P, seed) {
  const r = mulberry32(seed), pts = new Float32Array(P * P * 2);
  for (let i = 0; i < pts.length; i++) pts[i] = r();
  return (u, v) => {
    const x = u * P, y = v * P, cx = Math.floor(x), cy = Math.floor(y);
    let f1 = 9, f2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j, wx = ((gx % P) + P) % P, wy = ((gy % P) + P) % P;
      const k = (wy * P + wx) * 2, dx = gx + pts[k] - x, dy = gy + pts[k + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return Math.sqrt(f2) - Math.sqrt(f1);
  };
}
function valueNoise(P, seed) {
  const r = mulberry32(seed), a = new Float32Array(P * P);
  for (let i = 0; i < a.length; i++) a[i] = r();
  return (u, v) => {
    const x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    return (a[y0 * P + x0] * (1 - fx) + a[y0 * P + x1] * fx) * (1 - fy) + (a[y1 * P + x0] * (1 - fx) + a[y1 * P + x1] * fx) * fy;
  };
}

function bakeFoam() {
  const c1 = cellular(9, 31), c2 = cellular(23, 47);
  const n1 = valueNoise(8, 71), n2 = valueNoise(16, 83), n3 = valueNoise(32, 97);
  const s1 = valueNoise(64, 113), s2 = valueNoise(128, 127);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    // Warp the cells a little so the lace is not a tidy honeycomb.
    const wu = u + (n2(u, v) - 0.5) * 0.035, wv = v + (n2(v + 0.31, u + 0.17) - 0.5) * 0.035;
    const e1 = c1(wu, wv), e2 = c2(wu, wv);
    const lace = Math.max(Math.exp(-e1 * 9), Math.exp(-e2 * 7) * 0.8);
    const blot = n1(u, v) * 0.55 + n2(u, v) * 0.3 + n3(u, v) * 0.15;
    const i = (y * N + x) * 4;
    data[i] = Math.round(Math.min(1, lace) * 255);
    data[i + 1] = Math.round(blot * 255);
    data[i + 2] = 0;
    data[i + 3] = Math.round((s1(u, v) * 0.6 + s2(u, v) * 0.4) * 255);
  }
  // Fine bubbles: distance to the nearest point of a dense set, as a soft dot.
  const P = 48, r = mulberry32(141), pts = new Float32Array(P * P * 3);
  for (let i = 0; i < P * P; i++) { pts[i * 3] = r(); pts[i * 3 + 1] = r(); pts[i * 3 + 2] = 0.25 + r() * 0.75; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = x / N * P, gy = y / N * P, cx = Math.floor(gx), cy = Math.floor(gy);
    let best = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const ax = cx + i, ay = cy + j, wx = ((ax % P) + P) % P, wy = ((ay % P) + P) % P, k = (wy * P + wx) * 3;
      const d = Math.hypot(ax + pts[k] - gx, ay + pts[k + 1] - gy), rad = 0.18 * pts[k + 2];
      best = Math.max(best, Math.max(0, 1 - d / rad));
    }
    data[(y * N + x) * 4 + 2] = Math.round(Math.min(1, best * 1.6) * 255);
  }
  return data;
}

function tileTexture(data) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function waveTexture() { return (waveTex ||= tileTexture(bakeWaves())); }
export function foamTexture() { return (foamTex ||= tileTexture(bakeFoam())); }

// Uniforms every water shader shares. uSunCol is the sun's light (set each frame with the falls'
// light), for the green glow through the thin tops of waves.
export const waterTex = {
  uWaveTex: { get value() { return waveTexture(); } },
  uFoamTex: { get value() { return foamTexture(); } },
  uSunCol: { value: new THREE.Color(3, 2.85, 2.6) },
  uAmbCol: { value: new THREE.Color(0.75, 0.8, 0.86) },
};

// GLSL shared by every water surface. Needs uTime.
//
// seaSlope(p, scale, amp, dist): the slope (x, z) of the sea at world point p (metres). scale is the
// size of the largest tile in metres (90 for the open sea; smaller for lakes and pools, whose wind
// has less room to raise waves); amp scales the steepness. Also sets wH, the height of the long
// waves there (0 trough .. 1 crest), for foam and the glow through crests.
export const WATER_GLSL = /* glsl */ `
uniform sampler2D uWaveTex; uniform sampler2D uFoamTex; uniform vec3 uSunCol; uniform vec3 uAmbCol;
float wH;
vec2 wRot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// One layer: the tile turned by a, size sc metres, drifting along its own +x at c m/s.
vec3 wLayer(vec2 p, float a, float sc, float c){
  vec2 q = wRot(p, -a) / sc; q.x -= uTime * c / sc;
  vec3 t = texture(uWaveTex, q).rgb;
  vec2 s = (t.rg * 2.0 - 1.0) * ${WAVE_SLOPE.toFixed(2)};
  return vec3(wRot(s, a), t.b);
}
vec2 seaSlope(vec2 p, float scale, float amp, float dist){
  // Phase speed of a deep-water wave is sqrt(g L / 2 pi); the middle of each tile's waves is about
  // a tenth of its size.
  float s0 = scale, s1 = scale * 0.27, s2 = scale * 0.077, s3 = scale * 0.021;
  vec3 a = wLayer(p, 0.35, s0, sqrt(9.8 * s0 * 0.1 / 6.283));
  vec3 b = wLayer(p + 37.0, 1.05, s1, sqrt(9.8 * s1 * 0.1 / 6.283));
  vec3 c = wLayer(p + 91.0, -0.55, s2, sqrt(9.8 * s2 * 0.1 / 6.283));
  vec2 s = a.xy * 0.55 + b.xy * 0.5 + c.xy * 0.42;
  // The finest ripples only near the eye (past that they are under a pixel and only add shimmer).
  float fine = 1.0 - smoothstep(scale * 0.5, scale * 2.2, dist);
  if (fine > 0.0) { vec3 d = wLayer(p + 13.0, 2.2, s3, sqrt(9.8 * s3 * 0.1 / 6.283)); s += d.xy * 0.32 * fine; }
  wH = a.z * 0.6 + b.z * 0.4;
  return s * amp;
}
// Foam lace at world point p (metres) of the given size, drifting by d (metres): 0..1.
float foamLace(vec2 p, float size, vec2 d){
  vec4 f = texture(uFoamTex, (p + d) / size);
  vec4 g = texture(uFoamTex, (p - d * 0.6) / (size * 0.43) + 0.37);
  return clamp(max(f.r, g.r * 0.85) * (0.55 + 0.45 * f.g), 0.0, 1.0);
}
// Caustic light on the bed: the bright web that waves focus onto the bottom of shallow water.
float caustics(vec2 p){
  vec2 d = vec2(uTime * 0.21, uTime * 0.13);
  float a = texture(uFoamTex, p * 0.11 + d * 0.11).r, b = texture(uFoamTex, p * 0.083 - d * 0.083 + 0.5).r;
  return pow(min(a, b) * 1.2, 2.2) + pow(max(a, b), 6.0) * 0.4;
}
// Sun shining through the thin top of a wave toward the eye: the green-blue glow of a crest seen
// against the light. v: from the point to the eye; L: toward the sun; n: the surface normal.
float crestGlow(vec3 v, vec3 L, vec3 n, float h){
  float back = pow(clamp(dot(-v, normalize(vec3(L.x, min(L.y, 0.35), L.z))), 0.0, 1.0), 4.0);
  float side = clamp(1.0 - abs(dot(v, n)), 0.0, 1.0);
  return back * (0.35 + 0.65 * side) * smoothstep(0.45, 0.95, h) * smoothstep(0.0, 0.08, L.y);
}`;
