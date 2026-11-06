// Sound is made on the fly with the Web Audio API. The one exception is the music on the car
// stereo, streamed from files in public/music.
import { CONFIG } from '../config.js';

function noiseBuffer(ctx, seconds = 2, brown = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

// The twin's loop: CYCLES engine cycles (720 degrees of crank each) at TWIN_RPM, two firing pulses
// per cycle at 0 and 270 degrees. Each pulse: a crack of exhaust noise ringing in the pipe near
// 110 Hz, over a deeper thump; a little variation between pulses so the loop does not drone.
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

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.nextCrack = 0;
    this.music = null;
    // Volume of each group, 0 to 1, set from the Sound tab. master scales everything.
    this.levels = { master: 1, music: 1, car: 1, ambience: 1 };
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8 * this.levels.master;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.recordDest = ctx.createMediaStreamDestination();
    comp.connect(this.recordDest);
    // The three groups the player sets separately: the stereo, the car, and the land around.
    this.bus = {};
    for (const k of ['music', 'car', 'ambience']) { this.bus[k] = ctx.createGain(); this.bus[k].gain.value = this.levels[k]; this.bus[k].connect(this.master); }
    const { car, ambience } = this.bus;

    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 3, true);
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // Wind: brown noise through a wandering band-pass.
    this.windBand = ctx.createBiquadFilter();
    this.windBand.type = 'bandpass'; this.windBand.frequency.value = 500; this.windBand.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    loop(this.brown).connect(this.windBand).connect(this.windGain).connect(ambience);
    this.windHiss = ctx.createBiquadFilter();
    this.windHiss.type = 'highpass'; this.windHiss.frequency.value = 2500;
    this.windHissGain = ctx.createGain(); this.windHissGain.gain.value = 0;
    loop(this.white).connect(this.windHiss).connect(this.windHissGain).connect(ambience);

    // Water: white noise shaped into a rumble plus a hiss.
    const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 900;
    const wh = ctx.createBiquadFilter(); wh.type = 'highpass'; wh.frequency.value = 120;
    this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0;
    loop(this.white).connect(wh).connect(wl).connect(this.waterGain).connect(ambience);

    // Engine: two detuned saws through a low-pass.
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 300;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.eng1 = ctx.createOscillator(); this.eng1.type = 'sawtooth'; this.eng1.frequency.value = 42;
    this.eng2 = ctx.createOscillator(); this.eng2.type = 'sawtooth'; this.eng2.frequency.value = 42.7;
    this.eng1.connect(this.engLP); this.eng2.connect(this.engLP);
    this.engLP.connect(this.engGain).connect(car);
    this.eng1.start(); this.eng2.start();

    // The aurora makes no sound here: none felt right, so the sky stays silent.

    // Wading: churning water around the wheels, gurgling as it moves.
    this.wadeBand = ctx.createBiquadFilter(); this.wadeBand.type = 'bandpass'; this.wadeBand.frequency.value = 520; this.wadeBand.Q.value = 0.9;
    this.wadeGain = ctx.createGain(); this.wadeGain.gain.value = 0;
    loop(this.white).connect(this.wadeBand).connect(this.wadeGain).connect(car);
    const gurgle = ctx.createOscillator(); gurgle.frequency.value = 7;
    const gAmt = ctx.createGain(); gAmt.gain.value = 260;
    gurgle.connect(gAmt).connect(this.wadeBand.frequency); gurgle.start();
    // Nitro: a rising whoosh.
    this.nitroBand = ctx.createBiquadFilter(); this.nitroBand.type = 'bandpass'; this.nitroBand.frequency.value = 1400; this.nitroBand.Q.value = 0.7;
    this.nitroGain = ctx.createGain(); this.nitroGain.gain.value = 0;
    loop(this.white).connect(this.nitroBand).connect(this.nitroGain).connect(car);
    this.engine = { base: 38, perSpeed: 2.2, rumble: 1 };

    // Motorbike: a parallel twin with a 270-degree crank, as in a Triumph Bonneville, Thruxton or
    // Scrambler. Its two exhaust pulses come 270 and then 450 degrees apart, the uneven beat that
    // makes it lope like a V-twin rather than buzz. Built once as a loop of firing pulses at
    // TWIN_RPM (each a short burst of exhaust noise ringing in the pipe, over a low thump) and
    // played faster or slower for the revs, through a filter that opens with the throttle.
    this.twinSrc = ctx.createBufferSource(); this.twinSrc.buffer = twinBuffer(ctx); this.twinSrc.loop = true;
    this.twinLP = ctx.createBiquadFilter(); this.twinLP.type = 'lowpass'; this.twinLP.frequency.value = 900; this.twinLP.Q.value = 0.8;
    this.twinBody = ctx.createBiquadFilter(); this.twinBody.type = 'peaking'; this.twinBody.frequency.value = 95; this.twinBody.gain.value = 6; this.twinBody.Q.value = 1.1;
    this.twinGain = ctx.createGain(); this.twinGain.gain.value = 0;
    this.twinSrc.connect(this.twinBody).connect(this.twinLP).connect(this.twinGain).connect(car);
    this.twinSrc.start();
    this.gear = 1; this.lastThrottle = 0; this.nextPop = 0;

    // Helicopter. The rotor: low noise chopped into a beat at the blade-passing rate (four
    // blades at about 6.6 turns a second), the deep "whop" of each blade's wake. The turbines: a
    // high whine that rises as they spool up. The Fenestron: a band of hiss near 900 Hz.
    this.rotorLP = ctx.createBiquadFilter(); this.rotorLP.type = 'lowpass'; this.rotorLP.frequency.value = 260; this.rotorLP.Q.value = 1.2;
    this.rotorAM = ctx.createGain(); this.rotorAM.gain.value = 0;
    this.rotorGain = ctx.createGain(); this.rotorGain.gain.value = 0;
    loop(this.brown).connect(this.rotorLP).connect(this.rotorAM).connect(this.rotorGain);
    this.rotorBeat = ctx.createOscillator(); this.rotorBeat.type = 'sawtooth'; this.rotorBeat.frequency.value = 26;
    const beatShape = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.pow(Math.max(0, -x), 3) * 1.6; } // a sharp thump at the start of each beat, fading
    beatShape.curve = curve;
    this.rotorBeat.connect(beatShape).connect(this.rotorAM.gain); this.rotorBeat.start();
    this.turbine = ctx.createOscillator(); this.turbine.type = 'triangle'; this.turbine.frequency.value = 400;
    this.turbineGain = ctx.createGain(); this.turbineGain.gain.value = 0;
    this.turbine.connect(this.turbineGain); this.turbine.start();
    this.fanBand = ctx.createBiquadFilter(); this.fanBand.type = 'bandpass'; this.fanBand.frequency.value = 900; this.fanBand.Q.value = 2;
    this.fanGain = ctx.createGain(); this.fanGain.gain.value = 0;
    loop(this.white).connect(this.fanBand).connect(this.fanGain);
    // In the cabin the headset and the airframe take the edge off everything.
    this.heliLP = ctx.createBiquadFilter(); this.heliLP.type = 'lowpass'; this.heliLP.frequency.value = 8000;
    for (const n of [this.rotorGain, this.turbineGain, this.fanGain]) n.connect(this.heliLP);
    this.heliLP.connect(car);

    this.ready = true;
    if (this.levels.music > 0) this.playMusic();
  }

  // Volumes from the Sound tab, each 0 to 1. Music at zero also stops streaming the track.
  setLevels(levels) {
    Object.assign(this.levels, levels);
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const k of ['music', 'car', 'ambience']) this.bus[k].gain.setTargetAtTime(this.levels[k], t, 0.08);
    if (!this.muted) this.master.gain.setTargetAtTime(0.8 * this.levels.master, t, 0.08);
    if (this.levels.music > 0) this.playMusic(); else this.music?.el.pause();
  }

  // ---------- Music: the car stereo ----------
  // Streamed, not decoded up front. It plays through a cabin EQ (a little fuller in the bass,
  // softer in the treble, like car speakers) into the same mix as the engine, so both are heard.
  playMusic() {
    const ctx = this.ctx, M = CONFIG.music;
    if (!this.music) {
      const el = new Audio();
      el.preload = 'auto';
      const src = ctx.createMediaElementSource(el);
      const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 140; bass.gain.value = 3;
      const treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 5000; treble.gain.value = -5;
      const doors = ctx.createBiquadFilter(); doors.type = 'lowpass'; doors.frequency.value = 12000; doors.Q.value = 0.5;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(bass).connect(treble).connect(doors).connect(gain).connect(this.bus.music);
      // Start on either track, then take turns.
      this.music = { el, doors, gain, i: Math.floor(Math.random() * M.tracks.length) };
      el.addEventListener('ended', () => { this.music.i = (this.music.i + 1) % M.tracks.length; this.music.el.src = M.tracks[this.music.i]; this.music.el.play().catch(() => {}); });
      el.src = M.tracks[this.music.i];
    }
    this.music.el.play().catch(() => {});
  }

  // Each vehicle sounds different: pitch, waveform and how rough it is.
  setEngine(e) {
    this.engine = e;
    if (!this.ready) return;
    this.eng1.type = e.type; this.eng2.type = e.type;
  }

  // The twin's revs: five gears, changing up near 6,800 rpm and down again below about 3,000, so it
  // climbs through each gear and drops back at the change. Louder and brighter on the throttle; off
  // it at high revs, the odd pop from the exhaust.
  twinUpdate(t, on, speed, throttle, nitro) {
    const TOPS = [13, 21, 29, 38, 60]; // m/s at 7,000 rpm in each gear
    if (speed > TOPS[this.gear - 1] * 0.97 && this.gear < 5) this.gear++;
    else if (this.gear > 1 && speed < TOPS[this.gear - 2] * 0.42) this.gear--;
    const load = Math.max(0, throttle) + (nitro ? 0.4 : 0);
    const rpm = speed < 0.4 ? 1150 + load * 900 : Math.max(1700, 7000 * speed / TOPS[this.gear - 1]) + load * 250;
    this.twinSrc.playbackRate.setTargetAtTime(rpm / TWIN_RPM, t, 0.07);
    this.twinLP.frequency.setTargetAtTime(500 + rpm * 0.16 + load * 1300, t, 0.08);
    const vol = on ? (0.16 + Math.min(1, rpm / 7000) * 0.12 + load * 0.1) * (CONFIG.engineVolume ?? 1) : 0;
    this.twinGain.gain.setTargetAtTime(vol, t, 0.08);
    if (on && throttle <= 0 && this.lastThrottle > 0) this.nextPop = t + 0.08;
    if (on && throttle <= 0 && rpm > 3200 && t > this.nextPop && this.nextPop > 0) {
      this.burst(380 + Math.random() * 300, 3, 0.05, 0.16 + Math.random() * 0.12, 'bandpass', this.bus.car);
      this.nextPop = Math.random() < 0.5 ? t + 0.07 + Math.random() * 0.25 : 0;
    }
    this.lastThrottle = throttle;
  }

  // Splash when hitting water or a puddle. strength 0 to 1.
  splash(strength) {
    if (!this.ready) return;
    const s = Math.min(1, strength);
    this.burst(700 + Math.random() * 500, 0.8, 0.35 + s * 0.4, 0.35 * s + 0.08, 'lowpass', this.bus.car);
    this.burst(2200 + Math.random() * 1500, 1.2, 0.2 + s * 0.2, 0.12 * s + 0.03, 'bandpass', this.bus.car);
  }

  // Thump of hitting a rock or wall. strength in speed units.
  thud(strength) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = Math.min(1, strength / 20);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * s + 0.1, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.bus.car); o.start(t); o.stop(t + 0.45);
    this.burst(900, 0.7, 0.18 + s * 0.2, 0.3 * s + 0.05, 'lowpass', this.bus.car);
    if (s > 0.4) this.burst(3200, 2, 0.12, 0.15 * s, 'bandpass'); // scrape
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8 * this.levels.master, this.ctx.currentTime, 0.1);
  }

  burst(freq, q, dur, gain, type = 'bandpass', to = this.master) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(to);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  update(dt, { speed, wind, exposure, waterProx, iceProx, inCar, wade = 0, nitro = false, heli = null, throttle = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // The helicopter replaces the car engine: rotor, turbines and fan, louder under load and
    // fading with distance once you have walked away from it.
    const hr = heli ? heli.rpm : 0, far = heli ? 1 / (1 + Math.max(0, heli.near - 6) / 25) : 0;
    const load = heli ? Math.min(1.6, Math.max(0.5, heli.load)) : 0;
    this.rotorBeat.frequency.setTargetAtTime(Math.max(1, 26.4 * hr), t, 0.1);
    this.rotorGain.gain.setTargetAtTime(0.5 * hr * hr * (0.6 + 0.4 * load) * far, t, 0.15);
    this.turbine.frequency.setTargetAtTime(380 + 1650 * Math.min(1, hr * 1.15), t, 0.3);
    this.turbineGain.gain.setTargetAtTime(heli ? 0.022 * Math.min(1, hr * 2.5) * far : 0, t, 0.3);
    this.fanGain.gain.setTargetAtTime(0.09 * hr * hr * far, t, 0.2);
    this.heliLP.frequency.setTargetAtTime(heli?.inside ? 1400 : 8000, t, 0.3);
    if (heli) { inCar = heli.near === 0; speed = speed || 0; }
    const ease = 0.25;
    const windLevel = Math.min(1, 0.1 + wind * exposure * 0.08 + speed * 0.012);
    this.windGain.gain.setTargetAtTime(0.32 * windLevel, t, ease);
    this.windBand.frequency.setTargetAtTime(320 + windLevel * 700 + Math.sin(t * 0.7) * 120, t, 0.4);
    this.windHissGain.gain.setTargetAtTime(0.02 * windLevel * windLevel, t, ease);
    this.waterGain.gain.setTargetAtTime(0.45 * waterProx, t, 0.3);
    const E = this.engine;
    const eng = inCar && !heli ? (0.05 + Math.min(1, speed / 40) * 0.07 + (nitro ? 0.03 : 0)) * (CONFIG.engineVolume ?? 1) : 0;
    this.engGain.gain.setTargetAtTime(E.twin ? 0 : eng, t, 0.2);
    this.twinUpdate(t, E.twin && inCar && !heli, speed, throttle, nitro);
    // A few "gears": revs climb, drop back, climb again.
    const rev = speed < 1 ? 0 : ((speed * 0.9) % 14) / 14 + Math.min(3, Math.floor(speed * 0.9 / 14)) * 0.15;
    const f = E.base + speed * E.perSpeed * 0.5 + rev * E.base * 1.4 + (nitro ? 18 : 0);
    this.eng1.frequency.setTargetAtTime(f, t, 0.12);
    this.eng2.frequency.setTargetAtTime(f * (1.012 + 0.01 * E.rumble), t, 0.12);
    this.engLP.frequency.setTargetAtTime(240 + speed * 14 + (nitro ? 500 : 0), t, 0.2);
    this.wadeGain.gain.setTargetAtTime(0.32 * Math.min(1, wade), t, 0.15);
    this.nitroGain.gain.setTargetAtTime(nitro ? 0.12 : 0, t, nitro ? 0.08 : 0.3);
    this.nitroBand.frequency.setTargetAtTime(nitro ? 2600 : 1200, t, 0.5);
    if (this.music) {
      // In the car: the stereo at its set level. On foot: quieter and muffled by the doors.
      const M = CONFIG.music;
      this.music.gain.gain.setTargetAtTime(M.volume * (inCar ? 1 : M.outside), t, 1.2);
      this.music.doors.frequency.setTargetAtTime(inCar ? 12000 : 900, t, 0.4);
    }

    // Ice cracks near the lagoon: a sharp snap and a deeper groan now and then.
    if (iceProx > 0.05 && t > this.nextCrack) {
      this.burst(2400 + Math.random() * 2000, 4, 0.08, 0.25 * iceProx, 'bandpass', this.bus.ambience);
      if (Math.random() < 0.4) this.burst(180 + Math.random() * 120, 2, 0.6, 0.35 * iceProx, 'lowpass', this.bus.ambience);
      this.nextCrack = t + 1.5 + Math.random() * 6 / (0.3 + iceProx);
    }
  }
}
