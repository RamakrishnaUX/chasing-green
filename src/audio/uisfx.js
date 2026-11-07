// Menu sounds, made on the spot with Web Audio, in the spirit of a car game's front end:
// a dry tick moving between rows, a mechanical clack changing a value, a whoosh and a low thud
// switching sections, a short engine blip and a chime confirming, and a bright chime for a badge.
// They play through the game's master volume, so Mute and the All sound slider cover them too.

let engine = null;
export function bindUiSfx(audio) { engine = audio; }

// Before the drive starts the game's own audio is not running yet, so the start screen gets a
// small context of its own (it can only make sound after a click or key, which the splash asks for).
let own = null, dest = null;
function out() {
  const a = engine;
  if (a?.muted) return null;
  if (a?.ctx && a.master) { if (a.ctx.state === 'suspended') a.ctx.resume(); dest = a.master; return a.ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!own) { own = new AC(); const g = own.createGain(); g.gain.value = 0.8; g.connect(own.destination); own.out = g; }
  if (own.state === 'suspended') own.resume();
  dest = own.out;
  return own;
}
export function wakeUiSfx() { out(); }

function tone(ctx, f, t0, dur, { type = 'sine', gain = 0.1, to, attack = 0.004 } = {}) {
  const t = ctx.currentTime + t0, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.03);
}

let noiseBuf = null;
function noise(ctx, t0, dur, { f = 1200, q = 1, gain = 0.1, to, type = 'bandpass', peak = 0.3 } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + t0, s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; bp.type = type; bp.Q.value = q; bp.frequency.setValueAtTime(f, t);
  if (to) bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * peak); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(bp).connect(g).connect(dest); s.start(t, Math.random() * 0.5, dur + 0.05);
}

let lastTick = 0;
// An engine voice: a sawtooth and its octave through a low-pass, the pitch following rpm points
// [time, Hz] and the level following gain points [time, gain].
function engineVoice(ctx, pitch, level, { cutoff = 700, q = 2 } = {}) {
  const t = ctx.currentTime, a = ctx.createOscillator(), b = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  a.type = 'sawtooth'; b.type = 'square';
  lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = q;
  for (const [k, [at, f]] of pitch.entries()) { (k ? a.frequency.linearRampToValueAtTime(f, t + at) : a.frequency.setValueAtTime(f, t + at)); (k ? b.frequency.linearRampToValueAtTime(f / 2, t + at) : b.frequency.setValueAtTime(f / 2, t + at)); }
  g.gain.setValueAtTime(0, t);
  for (const [at, v] of level) g.gain.linearRampToValueAtTime(v, t + at);
  const end = level[level.length - 1][0] + 0.05;
  a.connect(lp); b.connect(lp); lp.connect(g).connect(dest);
  a.start(t); b.start(t); a.stop(t + end); b.stop(t + end);
}

export const sfx = {
  // Changing vehicle on the turntable: a heavy clunk, a short servo whirr and a latch click.
  switcher() {
    const ctx = out(); if (!ctx) return;
    tone(ctx, 120, 0, 0.18, { gain: 0.18, to: 55 });
    noise(ctx, 0, 0.06, { f: 900, q: 1.5, gain: 0.12, peak: 0.1 });
    tone(ctx, 180, 0.04, 0.28, { type: 'sawtooth', gain: 0.025, to: 420, attack: 0.03 });
    noise(ctx, 0.3, 0.035, { f: 4200, q: 4, gain: 0.08, peak: 0.1 });
  },
  // A vehicle arriving on the stage: a car rolls in with its engine and settles to idle; the
  // helicopter's rotor chops down from above and winds down after it lands.
  arrive(kind = 'jeep') {
    const ctx = out(); if (!ctx) return;
    if (kind === 'heli') {
      const t = ctx.currentTime, src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), am = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain();
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      src.buffer = noiseBuf; src.loop = true;
      bp.type = 'bandpass'; bp.frequency.value = 160; bp.Q.value = 0.8;
      lfo.frequency.setValueAtTime(15, t); lfo.frequency.linearRampToValueAtTime(14, t + 2.2); lfo.frequency.linearRampToValueAtTime(5, t + 4.2);
      depth.gain.value = 0.5; am.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 1.6); g.gain.linearRampToValueAtTime(0.42, t + 2.3); g.gain.linearRampToValueAtTime(0, t + 4.4);
      src.connect(bp).connect(am).connect(g).connect(dest);
      src.start(t); lfo.start(t); src.stop(t + 4.5); lfo.stop(t + 4.5);
      tone(ctx, 900, 0, 4.2, { gain: 0.012, to: 520, attack: 0.8 });
      return;
    }
    const v = { jeep: [42, 1], vintage: [38, 0.9], camper: [34, 1], race: [62, 1.1], bike: [70, 0.9] }[kind] || [42, 1];
    const f = v[0], L = 0.12 * v[1];
    // Rolling in under a little throttle, a blip as it stops, then idle fading out.
    engineVoice(ctx, [[0, f * 1.5], [0.9, f * 1.2], [1.15, f * 2.1], [1.45, f], [2.4, f]], [[0, 0], [0.25, L], [0.95, L * 0.7], [1.2, L * 1.25], [1.6, L * 0.55], [2.6, 0]], { cutoff: kind === 'race' ? 1400 : 750 });
    noise(ctx, 0, 1.0, { f: 260, q: 0.7, gain: 0.05, type: 'lowpass', peak: 0.4 }); // tyres on the deck
    noise(ctx, 1.12, 0.04, { f: 3000, q: 3, gain: 0.05, peak: 0.1 }); // the lights clicking on
  },
  // Moving between rows: a short, dry click.
  tick() {
    const ctx = out(); if (!ctx) return;
    if (ctx.currentTime - lastTick < 0.035) return;
    lastTick = ctx.currentTime;
    tone(ctx, 2300, 0, 0.03, { type: 'square', gain: 0.025 });
    noise(ctx, 0, 0.025, { f: 5200, q: 3, gain: 0.05, peak: 0.1 });
  },
  // Changing a value: a heavier two-part clack, like a gear lever.
  clack() {
    const ctx = out(); if (!ctx) return;
    noise(ctx, 0, 0.05, { f: 1800, q: 2.5, gain: 0.12, peak: 0.08 });
    tone(ctx, 340, 0, 0.07, { type: 'triangle', gain: 0.08, to: 190 });
    noise(ctx, 0.045, 0.04, { f: 3200, q: 3, gain: 0.07, peak: 0.1 });
  },
  // Switching sections: air rushing past, landing on a low thud.
  whoosh() {
    const ctx = out(); if (!ctx) return;
    noise(ctx, 0, 0.26, { f: 500, q: 0.8, gain: 0.1, to: 3200, peak: 0.6 });
    tone(ctx, 110, 0.2, 0.18, { gain: 0.16, to: 48 });
    noise(ctx, 0.2, 0.08, { f: 400, q: 1, gain: 0.06, type: 'lowpass', peak: 0.1 });
  },
  // Confirming: a quick engine blip and a two-note chime.
  confirm() {
    const ctx = out(); if (!ctx) return;
    tone(ctx, 70, 0, 0.24, { type: 'sawtooth', gain: 0.05, to: 150, attack: 0.02 });
    noise(ctx, 0, 0.22, { f: 300, q: 1.2, gain: 0.05, to: 700, type: 'lowpass', peak: 0.5 });
    tone(ctx, 880, 0.12, 0.3, { gain: 0.06 });
    tone(ctx, 1318.5, 0.19, 0.42, { gain: 0.055 });
  },
  // A badge: three bright notes rising, with a soft shimmer.
  chime() {
    const ctx = out(); if (!ctx) return;
    [784, 1046.5, 1568].forEach((f, i) => tone(ctx, f, 0.25 + i * 0.09, 0.7, { gain: 0.05 }));
    noise(ctx, 0.25, 0.8, { f: 7000, q: 0.7, gain: 0.02, type: 'highpass', peak: 0.2 });
  },
};
