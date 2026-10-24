// All sound is made on the fly with the Web Audio API. No audio files.

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
    this.nextClick = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.recordDest = ctx.createMediaStreamDestination();
    comp.connect(this.recordDest);

    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 3, true);
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // Wind: brown noise through a wandering band-pass.
    this.windBand = ctx.createBiquadFilter();
    this.windBand.type = 'bandpass'; this.windBand.frequency.value = 500; this.windBand.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    loop(this.brown).connect(this.windBand).connect(this.windGain).connect(this.master);
    this.windHiss = ctx.createBiquadFilter();
    this.windHiss.type = 'highpass'; this.windHiss.frequency.value = 2500;
    this.windHissGain = ctx.createGain(); this.windHissGain.gain.value = 0;
    loop(this.white).connect(this.windHiss).connect(this.windHissGain).connect(this.master);

    // Water: white noise shaped into a rumble plus a hiss.
    const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 900;
    const wh = ctx.createBiquadFilter(); wh.type = 'highpass'; wh.frequency.value = 120;
    this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0;
    loop(this.white).connect(wh).connect(wl).connect(this.waterGain).connect(this.master);

    // Engine: two detuned saws through a low-pass.
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 300;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.eng1 = ctx.createOscillator(); this.eng1.type = 'sawtooth'; this.eng1.frequency.value = 42;
    this.eng2 = ctx.createOscillator(); this.eng2.type = 'sawtooth'; this.eng2.frequency.value = 42.7;
    this.eng1.connect(this.engLP); this.eng2.connect(this.engLP);
    this.engLP.connect(this.engGain).connect(this.master);
    this.eng1.start(); this.eng2.start();

    // Aurora shimmer: a very quiet high pad under the crackle.
    this.shimmerGain = ctx.createGain(); this.shimmerGain.gain.value = 0;
    const trem = ctx.createGain(); trem.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.5;
    lfo.connect(lfoAmt).connect(trem.gain); lfo.start();
    [1046.5, 1568, 2093].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f + i * 0.7;
      o.connect(trem); o.start();
    });
    trem.connect(this.shimmerGain).connect(this.master);

    // Wading: churning water around the wheels, gurgling as it moves.
    this.wadeBand = ctx.createBiquadFilter(); this.wadeBand.type = 'bandpass'; this.wadeBand.frequency.value = 520; this.wadeBand.Q.value = 0.9;
    this.wadeGain = ctx.createGain(); this.wadeGain.gain.value = 0;
    loop(this.white).connect(this.wadeBand).connect(this.wadeGain).connect(this.master);
    const gurgle = ctx.createOscillator(); gurgle.frequency.value = 7;
    const gAmt = ctx.createGain(); gAmt.gain.value = 260;
    gurgle.connect(gAmt).connect(this.wadeBand.frequency); gurgle.start();
    // Nitro: a rising whoosh.
    this.nitroBand = ctx.createBiquadFilter(); this.nitroBand.type = 'bandpass'; this.nitroBand.frequency.value = 1400; this.nitroBand.Q.value = 0.7;
    this.nitroGain = ctx.createGain(); this.nitroGain.gain.value = 0;
    loop(this.white).connect(this.nitroBand).connect(this.nitroGain).connect(this.master);
    this.engine = { base: 38, perSpeed: 2.2, rumble: 1 };

    this.ready = true;
  }

  // Each vehicle sounds different: pitch, waveform and how rough it is.
  setEngine(e) {
    this.engine = e;
    if (!this.ready) return;
    this.eng1.type = e.type; this.eng2.type = e.type;
  }

  // Splash when hitting water or a puddle. strength 0 to 1.
  splash(strength) {
    if (!this.ready) return;
    const s = Math.min(1, strength);
    this.burst(700 + Math.random() * 500, 0.8, 0.35 + s * 0.4, 0.35 * s + 0.08, 'lowpass');
    this.burst(2200 + Math.random() * 1500, 1.2, 0.2 + s * 0.2, 0.12 * s + 0.03, 'bandpass');
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
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.45);
    this.burst(900, 0.7, 0.18 + s * 0.2, 0.3 * s + 0.05, 'lowpass');
    if (s > 0.4) this.burst(3200, 2, 0.12, 0.15 * s, 'bandpass'); // scrape
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  burst(freq, q, dur, gain, type = 'bandpass') {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  update(dt, { speed, wind, exposure, waterProx, iceProx, aurora, inCar, wade = 0, nitro = false }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const ease = 0.25;
    const windLevel = Math.min(1, 0.1 + wind * exposure * 0.08 + speed * 0.012);
    this.windGain.gain.setTargetAtTime(0.32 * windLevel, t, ease);
    this.windBand.frequency.setTargetAtTime(320 + windLevel * 700 + Math.sin(t * 0.7) * 120, t, 0.4);
    this.windHissGain.gain.setTargetAtTime(0.02 * windLevel * windLevel, t, ease);
    this.waterGain.gain.setTargetAtTime(0.45 * waterProx, t, 0.3);
    const E = this.engine;
    const eng = inCar ? 0.05 + Math.min(1, speed / 40) * 0.07 + (nitro ? 0.03 : 0) : 0;
    this.engGain.gain.setTargetAtTime(eng, t, 0.2);
    // A few "gears": revs climb, drop back, climb again.
    const rev = speed < 1 ? 0 : ((speed * 0.9) % 14) / 14 + Math.min(3, Math.floor(speed * 0.9 / 14)) * 0.15;
    const f = E.base + speed * E.perSpeed * 0.5 + rev * E.base * 1.4 + (nitro ? 18 : 0);
    this.eng1.frequency.setTargetAtTime(f, t, 0.12);
    this.eng2.frequency.setTargetAtTime(f * (1.012 + 0.01 * E.rumble), t, 0.12);
    this.engLP.frequency.setTargetAtTime(240 + speed * 14 + (nitro ? 500 : 0), t, 0.2);
    this.wadeGain.gain.setTargetAtTime(0.32 * Math.min(1, wade), t, 0.15);
    this.nitroGain.gain.setTargetAtTime(nitro ? 0.12 : 0, t, nitro ? 0.08 : 0.3);
    this.nitroBand.frequency.setTargetAtTime(nitro ? 2600 : 1200, t, 0.5);
    this.shimmerGain.gain.setTargetAtTime(0.0035 * aurora, t, 1.5);

    // Ice cracks near the lagoon: a sharp snap and a deeper groan now and then.
    if (iceProx > 0.05 && t > this.nextCrack) {
      this.burst(2400 + Math.random() * 2000, 4, 0.08, 0.25 * iceProx);
      if (Math.random() < 0.4) this.burst(180 + Math.random() * 120, 2, 0.6, 0.35 * iceProx, 'lowpass');
      this.nextCrack = t + 1.5 + Math.random() * 6 / (0.3 + iceProx);
    }
    // Aurora crackle: sparse, faint, electronic clicks.
    if (aurora > 0.08 && t > this.nextClick) {
      this.burst(5000 + Math.random() * 3000, 8, 0.012 + Math.random() * 0.02, 0.05 + 0.08 * aurora, 'highpass');
      this.nextClick = t + (0.05 + Math.random() * 0.5) / (0.4 + aurora);
    }
  }
}
