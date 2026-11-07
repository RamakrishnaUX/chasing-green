// Sound is made on the fly with the Web Audio API. The one exception is the music on the car
// stereo, streamed from files in public/music.
import { CONFIG } from '../config.js';
import { VOICES, pulseBuffer } from './engines.js';
export { TWIN_RPM, twinBuffer } from './engines.js';

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

    // Engine: the vehicle's voice (engines.js), a loop of its exhaust pulses played at the revs,
    // through a boost where its body is and a filter that opens with revs and throttle.
    this.engBody = ctx.createBiquadFilter(); this.engBody.type = 'peaking'; this.engBody.Q.value = 1.1;
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.Q.value = 0.8; this.engLP.frequency.value = 900;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engBody.connect(this.engLP).connect(this.engGain).connect(car);
    this.engSrc = null; this.voice = null; this.voiceName = undefined; this.voiceBufs = {};
    this.recSrc = null; this.recLoads = {};
    this.gear = 1; this.lastThrottle = 0; this.popsLeft = 0; this.nextPop = 0; this.shiftT = -1;

    // Tyres: a low roar that grows with speed, and off the tarmac a gritty crunch over it.
    this.tyreLP = ctx.createBiquadFilter(); this.tyreLP.type = 'lowpass'; this.tyreLP.frequency.value = 380;
    this.tyreGain = ctx.createGain(); this.tyreGain.gain.value = 0;
    loop(this.brown).connect(this.tyreLP).connect(this.tyreGain).connect(car);
    this.gritBand = ctx.createBiquadFilter(); this.gritBand.type = 'bandpass'; this.gritBand.frequency.value = 1700; this.gritBand.Q.value = 0.6;
    this.gritGain = ctx.createGain(); this.gritGain.gain.value = 0;
    loop(this.white).connect(this.gritBand).connect(this.gritGain).connect(car);

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

    // Boat: an outboard heard from on board (real recordings, see boatUpdate), with the hull
    // slapping the chop and the bow washing through the water.
    this.boatLP = ctx.createBiquadFilter(); this.boatLP.type = 'lowpass'; this.boatLP.Q.value = 0.6; this.boatLP.frequency.value = 2200;
    this.boatGain = ctx.createGain(); this.boatGain.gain.value = 0;
    this.boatLP.connect(this.boatGain).connect(car);
    this.boatSrc = null; this.boatLoad = null; this.nextSlap = 0;
    this.washBand = ctx.createBiquadFilter(); this.washBand.type = 'bandpass'; this.washBand.frequency.value = 900; this.washBand.Q.value = 0.5;
    this.washGain = ctx.createGain(); this.washGain.gain.value = 0;
    loop(this.white).connect(this.washBand).connect(this.washGain).connect(car);
    this.washLow = ctx.createBiquadFilter(); this.washLow.type = 'lowpass'; this.washLow.frequency.value = 260;
    this.washLowGain = ctx.createGain(); this.washLowGain.gain.value = 0;
    loop(this.brown).connect(this.washLow).connect(this.washLowGain).connect(car);

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
    this.loadWater();
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

  // Each vehicle has its own engine (its spec's engine.voice, from engines.js). The helicopter has
  // none here: its rotor and turbines are their own sounds.
  setEngine(e) { this.engine = e; }
  setVoice(name) {
    this.voiceName = name;
    const V = VOICES[name] || null;
    if (V === this.voice) return;
    this.voice = V;
    const t = this.ctx.currentTime;
    this.engGain.gain.cancelScheduledValues(t); this.engGain.gain.setValueAtTime(0, t);
    if (this.engSrc) { this.engSrc.stop(t + 0.02); this.engSrc = null; }
    if (this.engSrcB) { this.engSrcB.stop(t + 0.02); this.engSrcB = null; }
    this.engHeads = null;
    if (this.recSrc) { for (const s of this.recSrc) { s.src.stop(t + 0.02); s.srcB.stop(t + 0.02); } this.recSrc = null; }
    this.gear = 1; this.popsLeft = 0;
    if (!V) return;
    if (V.rec) this.loadRec(name, V).then((bufs) => { if (bufs && this.voice === V && !this.recSrc) this.startRec(V, bufs); });
    const buf = this.voiceBufs[name] ||= pulseBuffer(this.ctx, V);
    const [a, b] = this.heads(buf, this.engBody, t);
    a.src.playbackRate.value = b.src.playbackRate.value = V.idle / V.ref;
    this.engSrc = a.src; this.engSrcB = b.src; this.engHeads = [a, b];
    this.engBody.frequency.value = V.body[0]; this.engBody.gain.value = V.body[1];
  }

  // A recorded engine's loops (rec in engines.js), fetched and decoded once, the first time that
  // vehicle is driven. A failed load leaves the built voice playing.
  loadRec(name, V) {
    const url = (f) => `${import.meta.env.BASE_URL}sounds/engines/${f}.wav`;
    return (this.recLoads[name] ||= Promise.all(V.rec.loops.map(([f]) => fetch(url(f))
      .then((r) => { if (!r.ok) throw new Error(f); return r.arrayBuffer(); })
      .then((b) => this.ctx.decodeAudioData(b)))).catch(() => { delete this.recLoads[name]; return null; }));
  }
  // Two players on one loop, the second half a loop behind and a hair faster, so the two drift
  // against each other. Played fast (high revs) a short loop comes round several times a second
  // and its ends can be heard; blended with its twin, the seams never line up and the pattern
  // never quite repeats. Returns [head A, head B], each { src, g }.
  heads(buf, out, t) {
    return [0, 0.5].map((off) => {
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = buf; src.loop = true; g.gain.value = off ? 0 : 1;
      src.connect(g).connect(out); src.start(t, ((Math.random() * 0.2 + off) % 1) * buf.duration);
      return { src, g };
    });
  }
  // Set both heads' speed, and blend in the second once the loop repeats faster than every
  // 1.6 s (both at equal power by 0.8 s).
  headMix(H, rate, dur, t) {
    H[0].src.playbackRate.setTargetAtTime(rate, t, 0.07);
    H[1].src.playbackRate.setTargetAtTime(rate * 1.0073, t, 0.07);
    const b = Math.min(1, Math.max(0, (1.6 - dur / rate) / 0.8));
    H[0].g.gain.setTargetAtTime(Math.cos(b * Math.PI / 4), t, 0.1);
    H[1].g.gain.setTargetAtTime(Math.sin(b * Math.PI / 4), t, 0.1);
  }

  // Swap the built voice for the recordings: every loop runs all the time, silent until the revs
  // come near the speed it was recorded at.
  startRec(V, bufs) {
    const t = this.ctx.currentTime;
    if (this.engSrc) { this.engSrc.stop(t + 0.05); this.engSrc = null; }
    this.engBody.gain.value = 0; // the recordings need no body boost
    if (this.engSrcB) { this.engSrcB.stop(t + 0.05); this.engSrcB = null; }
    this.engHeads = null;
    this.recSrc = bufs.map((buf, i) => {
      const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.engBody);
      const [a, b] = this.heads(buf, g, t);
      return { src: a.src, srcB: b.src, heads: [a, b], g, rpm: V.rec.loops[i][1], dur: buf.duration };
    });
  }
  // The two loops either side of the revs, crossfaded (equal power, over the middle of the gap on a
  // log scale) and each played at the revs over its own: so each sounds near the speed it was
  // recorded at, and the pair never disagree on pitch.
  recMix(t, rpm) {
    const S = this.recSrc;
    let i = 0;
    while (i < S.length - 1 && rpm > S[i + 1].rpm) i++;
    const lo = S[i], hi = S[Math.min(i + 1, S.length - 1)];
    const x = hi === lo || rpm <= lo.rpm ? 0 : Math.log(rpm / lo.rpm) / Math.log(hi.rpm / lo.rpm);
    const m = Math.min(1, Math.max(0, (x - 0.2) / 0.6));
    for (const s of S) {
      this.headMix(s.heads, Math.min(3, Math.max(0.35, rpm / s.rpm)), s.dur, t);
      s.g.gain.setTargetAtTime(s === lo ? Math.cos(m * Math.PI / 2) : s === hi ? Math.sin(m * Math.PI / 2) : 0, t, 0.06);
    }
  }

  // The revs: through the gears, changing up near the redline and down again once the revs have
  // fallen well off, so they climb through each gear and drop back at the change (with a short
  // dip in the sound as the clutch goes in). Louder and brighter on the throttle. Lift off at
  // speed and the exhaust pops and crackles, how readily and how hard set by the voice: the bike
  // nearly every time, the supercar often, the old cars only now and then.
  engineUpdate(t, dt, on, speed, throttle, nitro, gear = 0, shifting = false) {
    const V = this.voice;
    if (!V) return;
    const T = V.tops, P = V.pops, was = this.gear;
    // The car's own gearbox (jeep.js) when it has one, so the sound changes gear with the car.
    if (gear) this.gear = Math.min(T.length, gear);
    else if (speed > T[this.gear - 1] * 0.97 && this.gear < T.length) this.gear++;
    else if (this.gear > 1 && speed < T[this.gear - 2] * 0.45) this.gear--;
    if (this.gear !== was) {
      this.shiftT = t;
      if (on && this.gear > was && throttle > 0 && Math.random() < P.upshift) this.pop(V, 0.5);
      if (on && this.gear < was && throttle <= 0 && Math.random() < P.chance) this.popsLeft = Math.max(this.popsLeft, 1 + (Math.random() < 0.5 ? 1 : 0));
    }
    // Changing down: a quick blip of the throttle to match the revs, heard as a short rise.
    if (this.gear < was && speed > 3) this.blipT = t;
    const blip = t - (this.blipT ?? -9) < 0.2 ? 1 - (t - this.blipT) / 0.2 : 0;
    const load = Math.max(0, throttle) + (nitro ? 0.4 : 0) + blip * 0.7;
    const rpm = Math.min(V.red * 1.04, (speed < 0.4 ? V.idle + load * (V.red - V.idle) * 0.15 : Math.max(V.idle * 1.5, V.red * speed / T[this.gear - 1]) + load * 250) * (1 + 0.16 * blip));
    const dip = shifting || (!gear && t - this.shiftT < 0.11) ? 0.6 : 1;
    const R = this.recSrc ? V.rec : null, lp = R ? R.lp : V.lp;
    if (R) this.recMix(t, rpm); else if (this.engHeads) this.headMix(this.engHeads, rpm / V.ref, this.engSrc.buffer.duration, t);
    this.engLP.frequency.setTargetAtTime(lp[0] + rpm * lp[1] + load * lp[2], t, 0.08);
    const vol = on && this.afloat < 1 ? (1 - (this.afloat || 0)) * (0.16 + Math.min(1, rpm / V.red) * 0.12 + load * 0.1) * (R ? R.gain : V.gain) * dip * (CONFIG.engineVolume ?? 1) : 0;
    this.engGain.gain.setTargetAtTime(vol, t, dip < 1 ? 0.025 : 0.08);
    // Pops: a run of them as the throttle closes, the odd one while coasting at high revs.
    if (!on || throttle > 0) this.popsLeft = 0;
    else {
      if (this.lastThrottle > 0 && rpm > V.red * 0.38 && Math.random() < P.chance) {
        this.popsLeft = P.min + Math.floor(Math.random() * (P.max - P.min + 1));
        this.nextPop = t + 0.05 + Math.random() * 0.07;
      } else if (!this.popsLeft && rpm > V.red * 0.5 && Math.random() < dt * P.chance * 0.7) {
        this.popsLeft = 1; this.nextPop = t;
      }
      if (this.popsLeft > 0 && t >= this.nextPop) {
        this.pop(V, 0.55 + Math.random() * 0.45);
        this.popsLeft--; this.nextPop = t + 0.05 + Math.random() * 0.2;
      }
    }
    this.lastThrottle = throttle;
  }

  // One pop from the exhaust: a blast of noise in the pipe's band, a low punch falling in pitch,
  // and the crack on top.
  pop(V, s) {
    const ctx = this.ctx, t = ctx.currentTime, P = V.pops, out = this.bus.car;
    const g0 = P.gain * s * (CONFIG.engineVolume ?? 1);
    this.burst(P.freq[0] + Math.random() * (P.freq[1] - P.freq[0]), 1.4, 0.06 + Math.random() * 0.05, 0.42 * g0, 'bandpass', out);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(P.thump * 1.4, t); o.frequency.exponentialRampToValueAtTime(P.thump * 0.7, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.38 * g0, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.13);
    this.burst(2600 + Math.random() * 1800, 0.8, 0.025, 0.16 * g0, 'highpass', out);
  }

  // Splash when hitting water or a puddle. strength 0 to 1.
  // Splashes, from recordings (public/sounds/water, credited in the README): a tyre through a
  // puddle, a splash into water, and a big one for a fast or deep plunge. Each plays a little
  // faster or slower every time so no two sound the same. Before they load, a burst of noise.
  loadWater() {
    this.waterSnd ||= Promise.all(['puddle', 'splash', 'splash_big'].map((f) => fetch(`${import.meta.env.BASE_URL}sounds/water/${f}.wav`)
      .then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b)))).then((b) => { this.waterBufs = { puddle: b[0], splash: b[1], big: b[2] }; }).catch(() => { this.waterSnd = null; });
  }
  splash(strength, kind = 'water') {
    if (!this.ready) return;
    const s = Math.min(1, strength);
    this.loadWater();
    const B = this.waterBufs;
    if (!B) {
      if (kind === 'puddle' && s < 0.15) return;
      this.burst(700 + Math.random() * 500, 0.8, 0.35 + s * 0.4, 0.35 * s + 0.08, 'lowpass', this.bus.car);
      return;
    }
    const ctx = this.ctx, t = ctx.currentTime, src = ctx.createBufferSource(), g = ctx.createGain();
    const buf = kind === 'puddle' ? B.puddle : s > 0.65 ? B.big : B.splash;
    src.buffer = buf;
    src.playbackRate.value = (kind === 'puddle' ? 0.95 + s * 0.1 : 1.05 - s * 0.2) * (0.94 + Math.random() * 0.12);
    if (kind === 'puddle') {
      // A slow roll through a puddle is a soft, short slosh: quiet, muffled and over quickly.
      // Fast, it is the full loud hiss of a sheet of water.
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + 11000 * Math.pow(s, 1.4); lp.Q.value = 0.5;
      const len = 0.35 + 2.6 * s;
      g.gain.setValueAtTime(0.008 + 0.3 * Math.pow(s, 2), t); // at most about a third as loud as before, and barely there when slow
      g.gain.setTargetAtTime(0, t + len * 0.5, len * 0.25);
      src.connect(lp).connect(g).connect(this.bus.car); src.start(t); src.stop(t + len + 0.5);
      return;
    }
    g.gain.value = 0.3 + 0.6 * s;
    src.connect(g).connect(this.bus.car); src.start(t);
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

  // The outboard, from three loops cut from Freesound recordings made on board (README):
  // exhaust bubbling at idle, a low throb pushing through the water, and the run up on the
  // plane. Each is sped up with the throttle and speed, and they hand over as the boat climbs
  // onto the plane, the way a real hull changes its note. Fetched the first time you float.
  loadBoat() {
    const url = (f) => `${import.meta.env.BASE_URL}sounds/engines/${f}.wav`;
    return (this.boatLoad ||= Promise.all(['boat_bubble', 'boat_low', 'boat_high'].map((f) => fetch(url(f))
      .then((r) => { if (!r.ok) throw new Error(f); return r.arrayBuffer(); })
      .then((b) => this.ctx.decodeAudioData(b))))
      .then((bufs) => {
        const t = this.ctx.currentTime;
        this.boatSrc = bufs.map((buf) => {
          const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
          src.buffer = buf; src.loop = true; g.gain.value = 0;
          src.connect(g).connect(this.boatLP); src.start(t, Math.random() * buf.duration * 0.9);
          return { src, g };
        });
      })
      .catch(() => { this.boatLoad = null; }));
  }
  boatUpdate(t, dt, on, speed, throttle, nitro) {
    if (on > 0 && !this.boatLoad) this.loadBoat();
    const sp = Math.max(0, speed), thr = Math.max(0, throttle), boost = nitro ? 1 : 0;
    // How far up on the plane: none below 6 m/s, fully from 13.
    const plane = Math.min(1, Math.max(0, (sp - 6) / 7));
    this.boatGain.gain.setTargetAtTime(on * (0.75 + thr * 0.35 + boost * 0.2) * (CONFIG.engineVolume ?? 1), t, 0.12);
    this.boatLP.frequency.setTargetAtTime(1400 + thr * 1800 + plane * 1600 + boost * 1500, t, 0.1);
    if (this.boatSrc) {
      const [bub, low, high] = this.boatSrc;
      const idle = Math.max(0, 1 - sp / 3.5 - thr * 0.6);
      bub.src.playbackRate.setTargetAtTime(0.9 + thr * 0.25, t, 0.15);
      bub.g.gain.setTargetAtTime(0.55 * idle, t, 0.15);
      low.src.playbackRate.setTargetAtTime(0.72 + Math.min(1, sp / 9) * 0.38 + thr * 0.12, t, 0.12);
      low.g.gain.setTargetAtTime(Math.cos(plane * Math.PI / 2) * (0.35 + 0.65 * Math.min(1, sp / 2.5 + thr)), t, 0.12);
      high.src.playbackRate.setTargetAtTime(0.86 + Math.min(1, Math.max(0, sp - 6) / 16) * 0.24 + thr * 0.05 + boost * 0.08, t, 0.12);
      high.g.gain.setTargetAtTime(Math.sin(plane * Math.PI / 2), t, 0.12);
    }
    // The bow washing through the water: a hiss that brightens with speed, and a low churn.
    const run = Math.min(1, sp / 18);
    this.washGain.gain.setTargetAtTime(on * (0.02 + run * 0.12), t, 0.2);
    this.washBand.frequency.setTargetAtTime(500 + run * 1800, t, 0.3);
    this.washLowGain.gain.setTargetAtTime(on * (0.05 + run * 0.14), t, 0.2);
    // The hull slapping the chop: a knock now and then at rest, a quick run of them at speed,
    // and the odd hard slam with spray off the bow once it is flying over the waves.
    if (on > 0.5 && t > this.nextSlap) {
      const hard = plane > 0.6 && Math.random() < 0.18;
      this.burst(110 + Math.random() * 90, 1.4, hard ? 0.32 : 0.16, (hard ? 0.5 : 0.18 + run * 0.18) * on, 'lowpass', this.bus.car);
      if (hard || Math.random() < run * 0.4) this.burst(1200 + Math.random() * 1600, 0.8, 0.35, (hard ? 0.12 : 0.05) * on, 'bandpass', this.bus.car);
      this.nextSlap = t + (sp < 2 ? 0.9 + Math.random() * 1.8 : 0.16 + Math.random() * 0.5 / (0.4 + run));
    }
  }

  // Rain (recordings in public/sounds/water, credited in the README): falling all round you
  // outside, and drumming on the roof when you are in a vehicle, where the rain outside is
  // muffled by the glass.
  rainUpdate(t, level, inCar) {
    if (level > 0.01 && !this.rainLoad) {
      this.rainLoad = Promise.all(['rain', 'rain_car'].map((f) => fetch(`${import.meta.env.BASE_URL}sounds/water/${f}.wav`).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b))))
        .then(([out, roof]) => {
          const mk = (buf, filter) => { const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = buf; s.loop = true; g.gain.value = 0; s.connect(filter || g); if (filter) filter.connect(g); s.start(this.ctx.currentTime, Math.random() * buf.duration); return g; };
          this.rainLP = this.ctx.createBiquadFilter(); this.rainLP.type = 'lowpass'; this.rainLP.frequency.value = 12000;
          this.rainOut = mk(out, this.rainLP); this.rainOut.connect(this.bus.ambience);
          this.rainRoof = mk(roof); this.rainRoof.connect(this.bus.car);
        }).catch(() => { this.rainLoad = null; });
    }
    if (!this.rainOut) return;
    this.rainOut.gain.setTargetAtTime(level * (inCar ? 0.14 : 0.32), t, 0.4);
    this.rainLP.frequency.setTargetAtTime(inCar ? 1600 : 12000, t, 0.3);
    this.rainRoof.gain.setTargetAtTime(inCar ? level * 0.3 : 0, t, 0.4);
  }

  update(dt, { speed, wind, exposure, waterProx, iceProx, inCar, wade = 0, nitro = false, heli = null, throttle = 0, voice = null, surface = 'paved', grounded = true, boat = 0, gear = 0, shifting = false, rain = 0 }) {
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
    const v = heli ? null : voice;
    if (v !== this.voiceName) this.setVoice(v);
    // Afloat, the outboard takes over from the car's engine.
    this.afloat = heli ? 0 : boat;
    this.engineUpdate(t, dt, inCar && !heli, speed, throttle, nitro, gear, shifting);
    this.rainUpdate(t, rain, inCar);
    this.boatUpdate(t, dt, inCar && !heli ? boat : 0, speed, throttle, nitro);
    // Tyres: only rolling on the ground, not in the air or on the water.
    const roll = inCar && !heli && grounded && wade < 0.3 && surface !== 'ford' ? Math.min(1, speed / 35) : 0;
    const rough = surface === 'paved' ? 0 : surface === 'gravel' ? 1 : 0.6;
    this.tyreGain.gain.setTargetAtTime(roll * (0.07 + rough * 0.05), t, 0.15);
    this.tyreLP.frequency.setTargetAtTime(300 + roll * 250 + rough * 200, t, 0.3);
    this.gritGain.gain.setTargetAtTime(roll * rough * 0.035 * (0.5 + Math.random()), t, 0.03);
    this.wadeGain.gain.setTargetAtTime(0.32 * Math.min(1, wade) * (1 - this.afloat), t, 0.15);
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
