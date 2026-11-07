// Draws the aurora sky off the page's main thread, so it keeps moving while the island loads.
import { makeSky, skyClock } from './auroraSky.js';

let sky = null, clock = null, w = 0, h = 0, running = false, timer = 0;
const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
const caf = self.cancelAnimationFrame ? (id) => self.cancelAnimationFrame(id) : clearTimeout;
const frame = (now) => { if (!running) return; sky.draw(w, h, clock(now)); timer = raf(frame); };

self.onmessage = ({ data: m }) => {
  if (m.type === 'init') {
    sky = makeSky(m.canvas); if (!sky) return;
    clock = skyClock(m.start, m.reduce); w = m.w; h = m.h; running = true; frame(performance.now());
  } else if (!sky) return;
  else if (m.type === 'size') { w = m.w; h = m.h; }
  else if (m.type === 'pause') { running = false; caf(timer); }
  else if (m.type === 'resume') { if (m.w) { w = m.w; h = m.h; } if (!running) { running = true; frame(performance.now()); } }
  else if (m.type === 'stop') { running = false; caf(timer); sky.lose(); sky = null; }
};
