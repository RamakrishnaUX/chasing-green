// Menu sounds, made on the spot with Web Audio, in the spirit of a car game's front end:
// a dry tick moving between rows, a mechanical clack changing a value, a whoosh and a low thud
// switching sections, a short engine blip and a chime confirming, and a bright chime for a badge.
// They play through the game's master volume, so Mute and the All sound slider cover them too.

let engine = null;
export function bindUiSfx(audio) { engine = audio; }

function out() {
  const a = engine;
  if (!a?.ctx || !a.master || a.muted) return null;
  if (a.ctx.state === 'suspended') a.ctx.resume();
  return a.ctx;
}

function tone(ctx, f, t0, dur, { type = 'sine', gain = 0.1, to, attack = 0.004 } = {}) {
  const t = ctx.currentTime + t0, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(engine.master); o.start(t); o.stop(t + dur + 0.03);
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
  s.connect(bp).connect(g).connect(engine.master); s.start(t, Math.random() * 0.5, dur + 0.05);
}

let lastTick = 0;
export const sfx = {
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
