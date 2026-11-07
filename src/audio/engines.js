// Engine voices. Each engine is heard as its exhaust: a train of firing pulses, one per cylinder
// per engine cycle (720 degrees of crank), at the crank angles its firing order sets. Each pulse
// rings the exhaust pipe it leaves through (a few decaying partials), over a low thump and a
// crack of noise. Cylinders on different banks leave through different pipes, so an uneven firing
// order (a cross-plane V8, a VW flat-four) gives its burble or putter; an even one (a straight
// six, a flat-plane V8) hums or screams. A loop of a few cycles is built once at `ref` rpm and
// played faster or slower for the revs.
//
// Each voice also sets the revs (idle and redline), its gearing (`tops`: m/s at the redline in
// each gear), how its filter opens with revs and throttle (`lp`: base, per rpm, per throttle),
// a body boost (`body`: frequency, gain), its level, and how readily it pops and crackles on the
// overrun (`pops`: the chance a throttle lift sets it off, how many, how loud, and their pitch).
//
// The four cars play real recordings instead (`rec`): loops cut from engine recordings, each held at
// one rpm (public/sounds/engines, credited in the README), crossfaded by the revs and each played
// faster or slower to match them (audio.js, recMix). Their built voice plays only until the loops
// have loaded. rec.lp is their filter (base, per rpm, per throttle) and rec.gain their level.

export const VOICES = {
  // Motorbike: a 270-degree parallel twin, as in a Triumph Scrambler or Bonneville (see twinBuffer).
  twin: {
    twin: true, ref: 1500, idle: 1150, red: 7000,
    tops: [13, 21, 29, 38, 60], lp: [500, 0.16, 1300], body: [95, 6], gain: 1,
    pops: { chance: 0.92, min: 3, max: 7, gain: 1, freq: [300, 650], thump: 62, upshift: 0.45 },
  },
  // Trail 4x4: a big cross-plane V8. Firing order 1-8-4-3-6-5-7-2, banks L R R L R L L R, each
  // bank's pipe a little different: the lumpy off-beat burble.
  v8: {
    ref: 1200, cycles: 10, idle: 900, red: 3200, len: 0.06,
    // The recordings: a 1965 Jeep CJ5, an old four-cylinder Jeep, at its warm-up idle and held at
    // two speeds. A low-revving engine, so its redline is low.
    rec: { lp: [1500, 0.5, 4000], gain: 2.2, loops: [['jeep_1090', 1090], ['jeep_1375', 1375], ['jeep_1450', 1450]] },
    fire: [[0, 0], [90, 1], [180, 1], [270, 0], [360, 1], [450, 0], [540, 0], [630, 1]],
    pipes: [
      { amp: 1, ring: [[70, 0.019, 0.75], [140, 0.008, 0.28], [210, 0.005, 0.1]] },
      { amp: 0.78, ring: [[79, 0.017, 0.75], [158, 0.007, 0.25]] },
    ],
    thump: [36, 0.022, 0.95], crack: [0.14, 0.002], vary: 0.12, jit: 0.004, drive: 1.8,
    tops: [9, 15, 23, 33, 55], lp: [300, 0.13, 900], body: [70, 5], gain: 0.95,
    pops: { chance: 0.4, min: 1, max: 3, gain: 0.7, freq: [160, 320], thump: 48, upshift: 0 },
  },
  // Vintage: an old straight six, even and smooth, a soft hum through a quiet pipe.
  six: {
    ref: 1200, cycles: 12, idle: 650, red: 2400, len: 0.07,
    // The recordings: a veteran car idling, climbing a steep hill and driving on. Engines that old
    // turn slowly, so it idles near 650 rpm and runs out of revs near 2,400.
    rec: { lp: [1300, 0.6, 3200], gain: 1.9, loops: [['old_0645', 645], ['old_0725', 725], ['old_1010', 1010], ['old_1210', 1210]] },
    fire: [[0, 0], [120, 0], [240, 0], [360, 0], [480, 0], [600, 0]],
    pipes: [{ amp: 1, ring: [[61, 0.022, 0.65], [122, 0.011, 0.25], [183, 0.006, 0.08]] }],
    thump: [33, 0.026, 0.8], crack: [0.1, 0.003], vary: 0.1, jit: 0.004, drive: 1.3,
    tops: [8, 14, 22, 38], lp: [260, 0.1, 520], body: [62, 4], gain: 0.9,
    pops: { chance: 0.15, min: 1, max: 1, gain: 0.6, freq: [180, 300], thump: 45, upshift: 0 },
  },
  // Camper van: an air-cooled flat four, as in the old VW bus. Firing 1-4-3-2, banks L R R L,
  // through a short raspy pipe: the clattering putter.
  flat4: {
    ref: 1500, cycles: 12, idle: 700, red: 4200, len: 0.05,
    // A 1961 VW Beetle's air-cooled flat four idling, then a VW Type 2 bus held at two speeds.
    rec: { lp: [1500, 0.45, 3800], gain: 2.1, loops: [['flat4_0700', 700], ['flat4_2590', 2590], ['flat4_2750', 2750]] },
    fire: [[0, 0], [180, 1], [360, 1], [540, 0]],
    pipes: [
      { amp: 1, ring: [[116, 0.013, 0.6], [232, 0.006, 0.32], [348, 0.004, 0.12]] },
      { amp: 0.68, ring: [[131, 0.012, 0.6], [262, 0.006, 0.3]] },
    ],
    thump: [54, 0.018, 0.6], crack: [0.42, 0.0026], vary: 0.18, jit: 0.012, drive: 2.0,
    tops: [7, 13, 21, 37], lp: [430, 0.18, 1100], body: [120, 4], gain: 0.85,
    pops: { chance: 0.2, min: 1, max: 2, gain: 0.55, freq: [250, 450], thump: 55, upshift: 0 },
  },
  // Supercar: a flat-plane V8, banks alternating L R L R so each pipe fires evenly: a hard,
  // rising scream, with crackle on the overrun.
  race: {
    ref: 2400, cycles: 16, idle: 900, red: 7400, len: 0.03,
    // An Audi R8's V10 idling and held at four speeds.
    rec: { lp: [1800, 0.5, 5000], gain: 1.8, loops: [['race_0820', 820], ['race_1930', 1930], ['race_2780', 2780], ['race_3260', 3260], ['race_4070', 4070]] },
    fire: [[0, 0], [90, 1], [180, 0], [270, 1], [360, 0], [450, 1], [540, 0], [630, 1]],
    pipes: [
      { amp: 1, ring: [[150, 0.008, 0.6], [300, 0.004, 0.36], [450, 0.003, 0.16]] },
      { amp: 0.92, ring: [[161, 0.008, 0.6], [322, 0.004, 0.32]] },
    ],
    thump: [62, 0.01, 0.45], crack: [0.3, 0.0014], vary: 0.08, jit: 0.002, drive: 2.4,
    tops: [13, 21, 30, 40, 53, 80], lp: [600, 0.24, 2400], body: [150, 4], gain: 0.85,
    pops: { chance: 0.75, min: 2, max: 6, gain: 0.75, freq: [450, 900], thump: 70, upshift: 0.3 },
  },
};

// The twin's loop: twelve cycles at 1,500 rpm, two firing pulses per cycle at 0 and 270 degrees.
// Each pulse: a crack of exhaust noise ringing in the pipe near 110 Hz, over a deeper thump; a
// little variation between pulses so the loop does not drone.
export const TWIN_RPM = 1500;
export function twinBuffer(ctx) {
  const sr = ctx.sampleRate, CYCLES = 12, cyc = 120 / TWIN_RPM, n = Math.round(CYCLES * cyc * sr);
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const len = Math.round(0.07 * sr);
  for (let c = 0; c < CYCLES; c++) for (const deg of [0, 270]) {
    const start = Math.round((c + deg / 720) * cyc * sr), amp = 0.8 + rnd() * 0.35, pf = 104 + rnd() * 14, ph = rnd() * 6;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const ring = Math.sin(2 * Math.PI * pf * tt + ph) * Math.exp(-tt / 0.016);
      const thump = Math.sin(2 * Math.PI * 52 * tt) * Math.exp(-tt / 0.022);
      const crack = (rnd() * 2 - 1) * Math.exp(-tt / 0.0035);
      d[(start + i) % n] += amp * (0.55 * ring + 0.6 * thump + 0.5 * crack);
    }
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] = Math.tanh(1.6 * d[i] / peak) * 0.9; // a little grit
  return buf;
}

// Any other voice's loop, from its firing order and pipes (see the top).
export function pulseBuffer(ctx, V) {
  if (V.twin) return twinBuffer(ctx);
  const sr = ctx.sampleRate, cyc = 120 / V.ref, n = Math.round(V.cycles * cyc * sr);
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const len = Math.round(V.len * sr), TAU = 2 * Math.PI;
  const [tf, tTau, tAmp] = V.thump, [cAmp, cTau] = V.crack;
  for (let c = 0; c < V.cycles; c++) for (const [deg, bank] of V.fire) {
    const P = V.pipes[bank];
    const start = Math.round((c + deg / 720 + (rnd() - 0.5) * V.jit) * cyc * sr + n) % n;
    const amp = P.amp * (1 + (rnd() * 2 - 1) * V.vary), df = 1 + (rnd() - 0.5) * 0.06, ph = rnd() * 6;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      let s = 0;
      for (let k = 0; k < P.ring.length; k++) { const [f, tau, a] = P.ring[k]; s += a * Math.sin(TAU * f * df * tt + ph * (k + 1)) * Math.exp(-tt / tau); }
      s += tAmp * Math.sin(TAU * tf * tt) * Math.exp(-tt / tTau);
      s += cAmp * (rnd() * 2 - 1) * Math.exp(-tt / cTau);
      d[(start + i) % n] += amp * s;
    }
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] = Math.tanh(V.drive * d[i] / peak) * 0.9;
  return buf;
}
