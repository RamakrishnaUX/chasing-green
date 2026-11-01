import { CONFIG } from '../config.js';
import { createNoise2D, mulberry32, clamp, smoothstep, lerp } from '../world/noise.js';

const TYPES = {
  arc: 'Green arc',
  curtains: 'Green curtains',
  pulsating: 'Pulsating aurora',
  pink: 'Pink-topped curtains',
  red: 'Red aurora',
  corona: 'Corona',
};
export const AURORA_TYPES = TYPES;

// Each activity window is a substorm with the three phases real ones have. Growth: a quiet arc
// low in the north slowly brightens (typically 30 to 60 minutes). Breakup: the arc nearest the
// horizon suddenly flares, splits into folding curtains and races overhead (10 to 30 minutes).
// Recovery: the light goes diffuse and dim, with patches that pulse on and off every few
// seconds, fading over one to three hours. Times are game hours from the window's onset.
function activity(w, t) {
  if (t < -w.g || t > w.e + w.r) return 0;
  if (t < 0) return 0.3 * smoothstep(-w.g, 0, t);
  if (t < w.e) return 0.3 + 0.7 * smoothstep(0, w.e * 0.35, t);
  const u = (t - w.e) / w.r;
  return lerp(1, 0.3, smoothstep(0, 0.4, u)) * (1 - smoothstep(0.55, 1, u));
}

export class Forecast {
  constructor(tripSeed, { redChallenge = false } = {}) {
    this.seed = tripSeed >>> 0;
    this.redChallenge = redChallenge;
    this.cloudNoiseA = createNoise2D(this.seed ^ 0x9e37);
    this.cloudNoiseB = createNoise2D(this.seed ^ 0x51ed);
    this.timeNoise = createNoise2D(this.seed ^ 0x1234);
    this.nights = new Map();
    this.corona = { active: false, until: 0, level: 0 };
    this.history = new Map(); // nightIndex -> [{h, kp}]
    this.lastHistoryH = -1;
  }

  night(n) {
    if (this.nights.has(n)) return this.nights.get(n);
    const F = CONFIG.forecast;
    const r = mulberry32(this.seed * 31 + n * 977 + 7);
    const mf = this.monthFactor ?? 1;
    const base = lerp(F.baseMin, F.baseMax, r()) * (0.55 + 0.45 * Math.min(1, mf));
    const count = F.windowsMin + Math.floor(r() * (F.windowsMax - F.windowsMin + 1));
    const windows = [];
    for (let i = 0; i < count; i++) {
      // Activity clusters around local midnight but can land anywhere in the dark (17:00 to 08:00).
      const c = lerp(5.5, 19.5, r());
      const a = lerp(F.windowAmpMin, F.windowAmpMax, r()) * mf;
      windows.push(this.substorm(c, a, r));
    }
    const stormChance = this.redChallenge ? F.stormChanceRedChallenge : F.stormChance;
    if (r() < stormChance) windows.push(this.substorm(lerp(8, 15, r()), lerp(F.stormAmp[0], F.stormAmp[1], r()), r, 1.4));
    const data = { base, windows };
    this.nights.set(n, data);
    return data;
  }

  // One substorm: onset c (game hours after noon), peak amplitude a, phase lengths from F.phases.
  substorm(c, a, r, stretch = 1) {
    const P = CONFIG.forecast.phases;
    return { c, a, g: lerp(...P.growth, r()) * stretch, e: lerp(...P.breakup, r()) * stretch, r: lerp(...P.recovery, r()) * stretch };
  }

  // Actual Kp at an absolute game hour.
  kpAt(gameHours) {
    const n = Math.floor((gameHours - 12) / 24);
    const local = gameHours - 12 - n * 24;
    const night = this.night(n);
    let kp = night.base;
    for (const w of night.windows) kp += w.a * activity(w, local - w.c);
    kp += CONFIG.forecast.jitter * this.timeNoise(gameHours * 2.2, 3.1);
    return clamp(kp, 0, 9);
  }

  // Where tonight's strongest substorm is in its life: quiet, growth, breakup or recovery, with
  // 0..1 amounts the aurora uses for its look, and whether a display worth seeing is building.
  phaseAt(gameHours) {
    const n = Math.floor((gameHours - 12) / 24), local = gameHours - 12 - n * 24, night = this.night(n);
    let best = null, bestA = 0;
    for (const w of night.windows) { const v = w.a * activity(w, local - w.c); if (v > bestA) { bestA = v; best = w; } }
    const out = { phase: 'quiet', growth: 0, breakup: 0, diffuse: 0, pulse: 0, promising: false };
    if (!best || bestA < 0.08) return out;
    const t = local - best.c, w = best;
    out.promising = night.base + w.a >= CONFIG.aurora.minKp + 0.3;
    if (t < 0) { out.phase = 'growth'; out.growth = smoothstep(-w.g, 0, t); return out; }
    out.breakup = smoothstep(0, w.e * 0.12, t) * (1 - smoothstep(w.e * 0.7, w.e * 1.4, t));
    out.diffuse = smoothstep(w.e * 0.8, w.e + w.r * 0.3, t);
    const u = (t - w.e) / w.r;
    out.pulse = smoothstep(0.08, 0.3, u) * (1 - smoothstep(0.75, 1, u));
    out.phase = t < w.e ? 'breakup' : 'recovery';
    return out;
  }

  // What the radio predicts. Fuzzier the further ahead it looks.
  predictedAt(gameHours, nowHours) {
    const ahead = Math.max(0, gameHours - nowHours);
    const err = CONFIG.forecast.forecastNoise * Math.min(1, ahead / 3) * this.timeNoise(gameHours * 0.45, 9.7);
    return clamp(this.kpAt(gameHours) + err, 0, 9);
  }

  cloudAt(x, z, realT) {
    const C = CONFIG.clouds;
    const s = C.scale;
    const dx = C.driftDirection[0] * C.driftSpeed * realT;
    const dz = C.driftDirection[1] * C.driftSpeed * realT;
    const e = realT * C.evolveSpeed;
    const n1 = this.cloudNoiseA((x - dx) * s, (z - dz) * s + e);
    const n2 = this.cloudNoiseB((x - dx) * s * 2.7 + e * 2, (z - dz) * s * 2.7);
    let c = 0.5 + 0.42 * n1 + 0.18 * n2 + C.globalBias;
    c += C.southBias * smoothstep(150, 350, z);
    c += C.northBias * smoothstep(-150, -400, z);
    return clamp(c, 0, 1);
  }

  cloudOffset(realT, out) {
    const C = CONFIG.clouds;
    out.set(-C.driftDirection[0] * C.driftSpeed * realT, -C.driftDirection[1] * C.driftSpeed * realT);
    return out;
  }

  cityLight(x, z) {
    let overhead = 0, horizon = 0, dirX = 1, dirZ = 0, best = -1, name = null;
    for (const c of CONFIG.cities) {
      const d = Math.hypot(x - c.x, z - c.z);
      const o = c.strength * (1 - smoothstep(c.radius * 0.25, c.radius, d));
      const h = c.strength * (1 - smoothstep(c.radius * 0.6, c.radius * 3.5, d));
      if (o > overhead) { overhead = o; name = c.name; }
      if (h > best) { best = h; horizon = h; dirX = (c.x - x) / (d || 1); dirZ = (c.z - z) / (d || 1); }
    }
    return { overhead, horizon, dirX, dirZ, name };
  }

  recordHistory(gameHours, kp) {
    const n = Math.floor((gameHours - 12) / 24);
    if (!this.history.has(n)) this.history.set(n, []);
    const arr = this.history.get(n);
    if (!arr.length || gameHours - arr[arr.length - 1].h > 0.08) arr.push({ h: gameHours, kp });
  }

  // The full evaluation for this frame.
  evaluate({ x, z, clock, dt, guaranteeActive }) {
    const A = CONFIG.aurora;
    let kp = this.kpAt(clock.gameHours);
    let cloud = this.cloudAt(x, z, clock.realSeconds);
    const dark = clock.darkness();
    const city = this.cityLight(x, z);

    // Console overrides for testing: chasingGreen.forecast.debugKp = 6, debugCloud = 0.
    if (this.debugKp != null) kp = this.debugKp;
    if (this.debugCloud != null) cloud = this.debugCloud;
    if (guaranteeActive > 0) {
      kp = Math.max(kp, lerp(kp, A.guarantee.kpFloor, guaranteeActive));
      cloud = lerp(cloud, Math.min(cloud, 0.18), guaranteeActive);
    }
    this.recordHistory(clock.gameHours, kp);

    const strength = kp < A.minKp ? 0 : 0.2 + 0.8 * smoothstep(A.minKp, A.fullKp, kp);
    const darkGate = smoothstep(A.minDarkness - 0.15, A.minDarkness + 0.15, dark);
    const cloudGate = 1 - smoothstep(A.maxCloud - 0.1, A.maxCloud + 0.04, cloud);
    const cityGate = 1 - city.overhead * A.cityGlowPenalty;
    const summer = clock.midnightSun;
    const ph = this.phaseAt(clock.gameHours);
    if (this.debugPhase) Object.assign(ph, this.debugPhase); // console: forecast.debugPhase = { phase: 'breakup', breakup: 1 }
    // In the growth phase a faint quiet arc is already there, before Kp has properly risen: a
    // promise of what is coming, if you know to wait for it.
    const arc = ph.promising ? A.growthArcVis * ph.growth : 0;
    const rawVis = summer ? 0 : Math.max(strength * (1 - 0.35 * ph.diffuse), arc) * darkGate * cityGate;
    const vis = rawVis * cloudGate;

    // Corona: rare, only at high activity, and only when the sky is properly clear.
    const t = clock.realSeconds;
    if (!this.corona.active && kp >= A.coronaKp && vis > 0.45) {
      if (Math.random() < (A.coronaChancePerMinute / 60) * dt) {
        this.corona.active = true;
        this.corona.until = t + A.coronaDurationSec;
      }
    }
    if (this.corona.active && (t > this.corona.until || vis < 0.25)) this.corona.active = false;
    this.corona.level = clamp(this.corona.level + (this.corona.active ? dt / 6 : -dt / 6), 0, 1);

    const red = smoothstep(A.redKp - 0.3, A.redKp + 0.8, kp);
    const pink = smoothstep(4.5, 6.5, kp);
    const curtains = 1 + 3 * smoothstep(A.minKp, 7.5, kp);

    let type = TYPES.arc;
    if (this.corona.level > 0.5) type = TYPES.corona;
    else if (red > 0.5) type = TYPES.red;
    else if (pink > 0.5) type = TYPES.pink;
    else if (ph.pulse > 0.5) type = TYPES.pulsating;
    else if (kp >= 4.2) type = TYPES.curtains;

    return {
      kp, cloud, dark, city, vis, rawVis, strength, summer,
      active: vis > A.activeThreshold,
      red, pink, curtains, corona: this.corona.level, type,
      phase: ph.phase, growth: ph.growth, breakup: ph.breakup, diffuse: ph.diffuse, pulse: ph.pulse, promising: ph.promising,
    };
  }
}
