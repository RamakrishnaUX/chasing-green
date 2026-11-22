// The arithmetic behind skytone.js, free of three.js so the worker (skytoneWorker.js) can run it.
// p: { tm: 'agx' | 'aces' | 'linear', exposure, look: { power, sat } | null, grade: {...} | null }.
export const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
// GLSL mat3 is column-major: M * v = col0 * v.x + col1 * v.y + col2 * v.z.
const mul = (m, v) => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
const SRGB_TO_2020 = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956]];
const R2020_TO_SRGB = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const AGX_IN = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const AGX_OUT = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
const ACES_IN = [[0.59719, 0.076, 0.0284], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
const ACES_OUT = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
export const LUMA = [0.2126, 0.7152, 0.0722];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function agx(c, exposure, look) {
  let v = mul(AGX_IN, mul(SRGB_TO_2020, c.map((x) => x * exposure)));
  v = v.map((x) => clamp01((Math.log2(Math.max(x, 1e-10)) + 12.47393) / (4.026069 + 12.47393)));
  v = v.map((x) => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; });
  if (look) { // installLook's cgLook (look.js)
    const l = dot(v, LUMA);
    v = v.map((x) => l + look.sat * (Math.pow(Math.max(x, 0), look.power) - l));
  }
  v = mul(AGX_OUT, v).map((x) => Math.pow(Math.max(0, x), 2.2));
  return mul(R2020_TO_SRGB, v).map(clamp01);
}
function aces(c, exposure) {
  let v = mul(ACES_IN, c.map((x) => (x * exposure) / 0.6));
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mul(ACES_OUT, v).map(clamp01);
}

// The grade pass (post.js GradeShader), at the centre of the screen (no vignette or grain).
// G holds plain numbers and [r, g, b] arrays (SkyTone snapshots the grade's uniforms).
function grade(c, G) {
  let l = dot(c, LUMA);
  c = c.map((x) => l + (x - l) * G.sat);
  c = c.map((x) => (x - 0.5) * G.contrast + 0.5);
  c = c.map((x, i) => x * G.gain[i] + G.lift[i] * (1 - x));
  c = c.map((x) => clamp01((x - G.black) / (G.white - G.black)));
  if (G.vibrance > 0) {
    const mx = Math.max(...c), mn = Math.min(...c);
    l = dot(c, LUMA);
    const k = 1 + G.vibrance * (1 - (mx - mn));
    c = c.map((x) => l + (x - l) * k);
  }
  if (G.split > 0) {
    l = dot(c, LUMA);
    const t0 = clamp01((l - 0.08) / 0.62), t = t0 * t0 * (3 - 2 * t0);
    c = c.map((x, i) => x * (1 + (G.shadowTint[i] + (G.highTint[i] - G.shadowTint[i]) * t - 1) * G.split));
  }
  if (G.curve > 0) c = c.map((x) => { x = clamp01(x); return x + (x * x * (3 - 2 * x) - x) * G.curve; });
  return c.map(clamp01);
}

export const N = 17; // lookup table points along each axis
// The faintest scene light solved for: anything darker shows as black anyway, and a floor far below
// it made the table blend dark channels toward nothing.
const U_MIN = Math.log(0.002);
// And the brightest: 4 already shows as near white. Pale targets near white sit on the curve's flat
// shoulder, where the solver chased them to 90 and more; the glow round a low sun then flared the
// sun rays across the whole picture and tinted the land.
const U_MAX = Math.log(4);

// Scene light (linear sRGB) to the screen colour (sRGB, 0 to 1) the player sees.
export function forward(p, lin) {
  let c;
  if (p.tm === 'agx') c = agx(lin, p.exposure, p.look);
  else if (p.tm === 'aces') c = aces(lin, p.exposure);
  else c = lin.map((x) => clamp01(x * p.exposure));
  c = c.map(l2s);
  return p.grade ? grade(c, p.grade) : c;
}
// The scene light (as natural log) that shows as the given screen colour (sRGB, 0 to 1), by
// least squares in log space with the Jacobian by finite differences, from a starting guess. A
// colour the chain cannot reach (pure white, say) comes as close as it can.
export function solve(p, want, u) {
  u = u.map((v) => Math.max(U_MIN, Math.min(U_MAX, v)));
  const f = (uu) => forward(p, uu.map((x) => Math.exp(x)));
  const cost = (y) => (y[0] - want[0]) ** 2 + (y[1] - want[1]) ** 2 + (y[2] - want[2]) ** 2;
  let y = f(u), c = cost(y), lambda = 1e-3;
  // Levenberg-Marquardt: Gauss-Newton steps, damped, and kept only when they bring the colour
  // closer. Near white the curve flattens and plain Newton steps flew off to wild colours.
  for (let it = 0; it < 40 && c > 1e-6; it++) {
    const h = 0.01, J = [0, 1, 2].map((j) => { const uj = u.slice(); uj[j] += h; return f(uj).map((v, i) => (v - y[i]) / h); }); // J[j]: column j
    const A = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J[a][0] * J[b][0] + J[a][1] * J[b][1] + J[a][2] * J[b][2]));
    const g = [0, 1, 2].map((a) => -(J[a][0] * (y[0] - want[0]) + J[a][1] * (y[1] - want[1]) + J[a][2] * (y[2] - want[2])));
    let moved = false;
    for (let tries = 0; tries < 8 && !moved; tries++) {
      const M = A.map((row, i) => row.map((v, j) => v + (i === j ? lambda * (A[i][i] + 1e-6) : 0)));
      const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const det = det3(M);
      if (Math.abs(det) > 1e-30) {
        const du = [0, 1, 2].map((col) => det3(M.map((row, i) => row.map((v, j) => (j === col ? g[i] : v)))) / det);
        const un = u.map((v, i) => Math.max(U_MIN, Math.min(U_MAX, v + Math.max(-2, Math.min(2, du[i])))));
        const yn = f(un), cn = cost(yn);
        if (cn < c) { u = un; y = yn; c = cn; lambda = Math.max(1e-6, lambda * 0.3); moved = true; break; }
      }
      lambda *= 10;
    }
    if (!moved) break;
  }
  return u;
}
// The table: for each of N x N x N screen colours, the scene light (log2) that shows as it.
// About 5,000 solves, each started from its neighbour's answer.
export function buildTable(p) {
  const lut = new Float32Array(N * N * N * 4);
  let u = [-3, -3, -3];
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) {
    for (let r = 0; r < N; r++) {
      const want = [r / (N - 1), g / (N - 1), b / (N - 1)];
      if (r === 0) { const i0 = ((b * N + g) * N) * 4, prev = g > 0 ? i0 - N * 4 : (b > 0 ? i0 - N * N * 4 : -1); if (prev >= 0) u = [0, 1, 2].map((k) => lut[prev + k] * Math.LN2); }
      // Start from the neighbour's answer; where that misses, also from the colour itself and
      // from a grey as bright as it, and keep the best (the curve has false minima near white).
      const miss = (uu) => { const y = forward(p, uu.map((x) => Math.exp(x))); return Math.max(Math.abs(y[0] - want[0]), Math.abs(y[1] - want[1]), Math.abs(y[2] - want[2])); };
      u = solve(p, want, u);
      if (miss(u) > 0.006) {
        const lum = Math.log(Math.max(dot(want.map(s2l), LUMA), 0.002));
        for (const start of [want.map((x) => Math.log(Math.max(s2l(x), 0.002))), [lum, lum, lum], [lum + 1, lum + 1, lum + 1]]) {
          const v = solve(p, want, start);
          if (miss(v) < miss(u)) u = v;
        }
      }
      const i = ((b * N + g) * N + r) * 4;
      lut[i] = u[0] / Math.LN2; lut[i + 1] = u[1] / Math.LN2; lut[i + 2] = u[2] / Math.LN2; lut[i + 3] = 1;
    }
  }
  return lut;
}
// The table with no correction at all (each screen colour simply decoded to linear light), used
// until the real one arrives from the worker.
export function plainTable() {
  const lut = new Float32Array(N * N * N * 4);
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const i = ((b * N + g) * N + r) * 4;
    lut[i] = Math.log2(Math.max(s2l(r / (N - 1)), 0.002)); lut[i + 1] = Math.log2(Math.max(s2l(g / (N - 1)), 0.002)); lut[i + 2] = Math.log2(Math.max(s2l(b / (N - 1)), 0.002)); lut[i + 3] = 1;
  }
  return lut;
}
