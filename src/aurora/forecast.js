import { CONFIG } from '../config.js';
import { createNoise2D, mulberry32, clamp, smoothstep, lerp } from '../world/noise.js';

const TYPES = {
  arc: 'Green arc',
  curtains: 'Green curtains',
  pink: 'Pink-topped curtains',
  red: 'Red aurora',
  corona: 'Corona',
};
export const AURORA_TYPES = TYPES;

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
      const w = lerp(F.windowWidthHours[0], F.windowWidthHours[1], r());
      const a = lerp(F.windowAmpMin, F.windowAmpMax, r()) * mf;
      windows.push({ c, w, a });
    }
    const stormChance = this.redChallenge ? F.stormChanceRedChallenge : F.stormChance;
    if (r() < stormChance) {
      windows.push({ c: lerp(8, 15, r()), w: lerp(0.8, 1.6, r()), a: lerp(F.stormAmp[0], F.stormAmp[1], r()) });
    }
    const data = { base, windows };
    this.nights.set(n, data);
    return data;
  }

  // Actual Kp at an absolute game hour.
  kpAt(gameHours) {
    const n = Math.floor((gameHours - 12) / 24);
    const local = gameHours - 12 - n * 24;
    const night = this.night(n);
    let kp = night.base;
    for (const w of night.windows) {
      const x = (local - w.c) / w.w;
      kp += w.a * Math.exp(-x * x);
    }
    kp += CONFIG.forecast.jitter * this.timeNoise(gameHours * 2.2, 3.1);
    return clamp(kp, 0, 9);
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
    const rawVis = summer ? 0 : strength * darkGate * cityGate;
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
    else if (kp >= 4.2) type = TYPES.curtains;

    return {
      kp, cloud, dark, city, vis, rawVis, strength, summer,
      active: vis > A.activeThreshold,
      red, pink, curtains, corona: this.corona.level, type,
    };
  }
}
