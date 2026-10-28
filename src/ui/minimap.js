import { BOUNDS, heightAt, waterLevelAt, glacierMask, roadPaths } from '../world/terrain.js';
import { surfaceUniforms } from '../world/materials.js';
import { PLACES } from '../world/geo.js';
import { store } from '../storage.js';
import { haptics } from './haptics.js';

const $ = (id) => document.getElementById(id);
const W = BOUNDS.maxX - BOUNDS.minX, H = BOUNDS.maxZ - BOUNDS.minZ;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sat = (x) => Math.max(0, Math.min(1, x));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const OCEAN = '#0c1c2a';

// Paint the island: terrain colour, hill shading, ice, water and roads. Rows are painted in
// slices; paintIsland() does it all at once, paintIslandSlowly() spreads it over idle time.
function islandPainter(px) {
  const w = px, h = Math.round(px * (H / W));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const snowLine = surfaceUniforms.uSnowLine.value;
  const sx = W / w, sz = H / h;
  const rows = (j0, j1) => {
    for (let j = j0; j < j1; j++) {
      for (let i = 0; i < w; i++) {
        const x = BOUNDS.minX + (i + 0.5) * sx, z = BOUNDS.minZ + (j + 0.5) * sz;
        const y = heightAt(x, z), wl = waterLevelAt(x, z);
        let col;
        if (y < wl - 0.05) {
          const deep = sat((wl - y) / 12);
          col = wl > 0.1 ? [38, 104, 112] : mix([28, 62, 82], [12, 28, 42], deep);
        } else {
          col = mix([196, 168, 110], [128, 110, 74], sat((y - 6) / 30));
          col = mix(col, [84, 76, 70], sat((y - 40) / 50));
          col = mix(col, [214, 220, 226], sat((y - snowLine - 25) / 30) * 0.85);
          col = mix(col, [232, 240, 245], glacierMask(x, z));
          // Hill shade, light from the north west.
          const dx = heightAt(x + 4, z) - heightAt(x - 4, z), dz = heightAt(x, z + 4) - heightAt(x, z - 4);
          const k = Math.min(1.3, Math.max(0.6, 1 - (dx + dz) * 0.03));
          col = col.map((v) => v * k);
        }
        const o = (j * w + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
  };
  const finish = () => {
    g.putImageData(img, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const path of roadPaths) {
      g.beginPath();
      path.pts.forEach((p, k) => { const u = (p.x - BOUNDS.minX) / sx, v = (p.z - BOUNDS.minZ) / sz; k ? g.lineTo(u, v) : g.moveTo(u, v); });
      g.strokeStyle = 'rgba(20,24,28,0.55)'; g.lineWidth = Math.max(2, px / 260); g.setLineDash([]); g.stroke();
      g.strokeStyle = path.type === 'paved' ? '#f1ede2' : '#d7b57a'; g.lineWidth = Math.max(1, px / 520);
      g.setLineDash(path.type === 'paved' ? [] : [px / 120, px / 180]);
      g.stroke();
    }
    g.setLineDash([]);
    return c;
  };
  return { h, rows, finish };
}
function paintIsland(px) { const p = islandPainter(px); p.rows(0, p.h); return p.finish(); }
function paintIslandSlowly(px, done) {
  const p = islandPainter(px);
  let j = 0;
  const step = () => {
    const t0 = performance.now();
    while (j < p.h && performance.now() - t0 < 10) { p.rows(j, Math.min(p.h, j + 4)); j += 4; }
    if (j < p.h) setTimeout(step, 16); else done(p.finish());
  };
  setTimeout(step, 400);
}

const ease = (t) => 1 - Math.pow(1 - t, 3);

// The player's own colour on both maps, kept apart from the white and green landmark dots.
const ME = '#2f8fff', ROUTE = '#5fb0ff';

export class MapUI {
  constructor({ landmarks, onTravel, onDrive, describe }) {
    this.landmarks = landmarks;
    this.onTravel = onTravel;
    this.onDrive = onDrive;
    this.describe = describe;
    this.route = null; // [{x, z}] while driving to a place
    this.dest = null;
    this.mini = $('minimap-canvas');
    this.ctx = this.mini.getContext('2d');
    this.big = $('map-canvas');
    this.wrap = $('map-wrap');
    this.layer = $('map-markers');
    this.island = paintIsland(900);
    this.detail = null; // a sharper copy, painted in the background the first time the map opens
    this.view = 1230; // world units across the minimap
    this.timer = 0;
    this.v = null; // big map view: centre (cx, cz) and k, CSS pixels per world unit
    this.pins = [];
    $('minimap').addEventListener('click', () => this.open());
    this.bindGestures();
    $('map-zoom-in').addEventListener('click', () => this.zoomBy(1.8));
    $('map-zoom-out').addEventListener('click', () => this.zoomBy(1 / 1.8));
    $('map-reset').addEventListener('click', () => { haptics.play('select'); this.animateTo(this.fitView()); });
    $('map-locate').addEventListener('click', () => {
      if (!this.player) return;
      haptics.play('select');
      this.animateTo({ cx: this.player.x, cz: this.player.z, k: Math.max(this.v.k, this.fitK * 4) });
    });
    addEventListener('resize', () => { if ($('map').open) { this.size(); this.v = this.clampView(this.v); this.draw(); } });
    $('map-drive').addEventListener('click', () => { const s = this.sel; if (!s) return; haptics.play('medium'); $('map').close(); this.onDrive(s.x, s.z, s.label); });
    $('map-jump').addEventListener('click', () => { const s = this.sel; if (s) this.travel(s.x, s.z, s.named ? s.label : null, s.face); });
    $('map-pick-close').addEventListener('click', () => this.unpick());
  }

  travel(x, z, label, face) {
    haptics.play('medium');
    $('map').close();
    this.onTravel(x, z, label, face);
  }

  // A tap on the map picks a place; the card under it offers to drive there or jump there.
  pick(x, z, label, face) {
    haptics.play('select');
    const named = !!label;
    label ||= this.describe(x, z);
    this.sel = { x, z, label, named, face };
    $('map-pick-name').textContent = label;
    const d = this.player ? Math.hypot(x - this.player.x, z - this.player.z) : 0;
    $('map-pick-dist').textContent = d < 40 ? 'You are here' : d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} km away` : `${Math.round(d / 10) * 10} m away`;
    $('map-drive').disabled = d < 40;
    $('map-pick').hidden = false;
    this.draw();
  }
  unpick() { this.sel = null; $('map-pick').hidden = true; this.draw(); }

  open() {
    this.sel = null;
    $('map-pick').hidden = true;
    $('map').showModal();
    if (!this.detail) paintIslandSlowly(2400, (c) => { this.detail = c; if ($('map').open) this.draw(); });
    this.buildPins();
    this.size();
    this.v = this.fitView();
    this.draw();
  }

  size() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.vw = this.wrap.clientWidth || 600; this.vh = this.wrap.clientHeight || 400;
    this.big.width = Math.round(this.vw * dpr); this.big.height = Math.round(this.vh * dpr);
    this.dpr = dpr;
    this.fitK = Math.min(this.vw / W, this.vh / H) * 0.94;
  }
  fitView() { return { cx: BOUNDS.minX + W / 2, cz: BOUNDS.minZ + H / 2, k: this.fitK }; }
  clampView(v) {
    const k = clamp(v.k, this.fitK, this.fitK * 8);
    // Keep some of the island on screen however far it is dragged.
    const hx = Math.max(0, W / 2 - this.vw / 2 / k) + W * 0.15, hz = Math.max(0, H / 2 - this.vh / 2 / k) + H * 0.15;
    const mx = BOUNDS.minX + W / 2, mz = BOUNDS.minZ + H / 2;
    return { k, cx: clamp(v.cx, mx - hx, mx + hx), cz: clamp(v.cz, mz - hz, mz + hz) };
  }
  toWorld(sx, sy, v = this.v) { return { x: v.cx + (sx - this.vw / 2) / v.k, z: v.cz + (sy - this.vh / 2) / v.k }; }

  // Zoom so the world point under screen point (sx, sy) stays put.
  zoomAt(sx, sy, k) {
    const p = this.toWorld(sx, sy);
    const nk = clamp(k, this.fitK, this.fitK * 8);
    this.v = this.clampView({ k: nk, cx: p.x - (sx - this.vw / 2) / nk, cz: p.z - (sy - this.vh / 2) / nk });
    this.draw();
  }
  zoomBy(f) {
    haptics.play('select');
    const k = clamp(this.v.k * f, this.fitK, this.fitK * 8);
    this.animateTo({ ...this.v, k });
  }
  animateTo(target) {
    const from = { ...this.v }, to = this.clampView(target), t0 = performance.now(), dur = 320;
    cancelAnimationFrame(this.anim);
    const tick = (now) => {
      const t = ease(Math.min(1, (now - t0) / dur));
      // Interpolate zoom in log space so it feels even.
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * t);
      this.v = { k, cx: from.cx + (to.cx - from.cx) * t, cz: from.cz + (to.cz - from.cz) * t };
      this.draw();
      if (t < 1) this.anim = requestAnimationFrame(tick);
    };
    this.anim = requestAnimationFrame(tick);
  }

  bindGestures() {
    const pts = new Map();
    let start = null, moved = false;
    const local = (e) => { const r = this.wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const begin = () => {
      const p = [...pts.values()];
      if (p.length === 1) start = { mode: 'pan', x: p[0].x, y: p[0].y, v: { ...this.v } };
      else if (p.length >= 2) {
        const mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        start = { mode: 'pinch', d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, world: this.toWorld(mid.x, mid.y), v: { ...this.v } };
      }
    };
    this.wrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.map-tools, .map-pick')) return;
      cancelAnimationFrame(this.anim);
      if (!pts.size) moved = false;
      pts.set(e.pointerId, local(e));
      begin();
    });
    addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, local(e));
      const p = [...pts.values()];
      if (start.mode === 'pan' && p.length === 1) {
        const dx = p[0].x - start.x, dy = p[0].y - start.y;
        if (Math.hypot(dx, dy) > 6) moved = true;
        if (!moved) return;
        this.v = this.clampView({ k: start.v.k, cx: start.v.cx - dx / start.v.k, cz: start.v.cz - dy / start.v.k });
        this.draw();
      } else if (start.mode === 'pinch' && p.length >= 2) {
        moved = true;
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        const k = clamp(start.v.k * d / start.d, this.fitK, this.fitK * 8);
        this.v = this.clampView({ k, cx: start.world.x - (mid.x - this.vw / 2) / k, cz: start.world.z - (mid.y - this.vh / 2) / k });
        this.draw();
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      const at = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      // A tap on open ground (not a pin) picks that spot.
      if (!pts.size && !moved && e.type === 'pointerup' && e.target === this.big) {
        const w = this.toWorld(at.x, at.y);
        this.pick(w.x, w.z, null, false);
      }
      this.suppressClick = moved;
      if (pts.size) begin(); else start = null;
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    this.wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(p.x, p.y, this.v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    }, { passive: false });
  }

  buildPins() {
    this.layer.innerHTML = '';
    this.pins = [];
    const add = (x, z, label, cls, face) => {
      const btn = document.createElement('button');
      btn.className = `map-pin ${cls}`;
      btn.innerHTML = `<span class="dot"></span><span class="label">${label}</span>`;
      btn.setAttribute('aria-label', `Choose ${label}`);
      btn.addEventListener('click', (e) => { e.stopPropagation(); if (this.suppressClick) return; this.pick(x, z, label, face); });
      this.layer.appendChild(btn);
      this.pins.push({ el: btn, x, z });
    };
    // Towns first, so landmark pins sit on top; skip towns that would crowd a landmark.
    for (const p of PLACES) {
      if (this.landmarks.list.some((lm) => Math.hypot(lm.x - p.x, lm.z - p.z) < 60)) continue;
      add(p.x, p.z, p.name, 'is-town', false);
    }
    for (const lm of this.landmarks.list) add(lm.x, lm.z, lm.name, store.data.stamps[lm.id] ? 'is-lm is-got' : 'is-lm', true);
    const me = document.createElement('div');
    me.className = 'map-me';
    me.setAttribute('aria-hidden', 'true');
    me.innerHTML = '<i class="map-me-halo"></i><i class="map-me-arrow"></i><span class="map-me-label">You</span>';
    this.layer.appendChild(me);
    this.me = me;
    this.selEl = document.createElement('div');
    this.selEl.className = 'map-sel';
    this.selEl.setAttribute('aria-hidden', 'true');
    this.layer.appendChild(this.selEl);
  }

  draw() {
    if (!this.v) return;
    const { cx, cz, k } = this.v, dpr = this.dpr;
    const g = this.big.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = OCEAN;
    g.fillRect(0, 0, this.big.width, this.big.height);
    const img = this.detail && k > this.fitK * 1.2 ? this.detail : this.island;
    const left = cx - this.vw / 2 / k, top = cz - this.vh / 2 / k;
    const s = (k * W) / img.width;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.setTransform(s * dpr, 0, 0, s * dpr, -(left - BOUNDS.minX) * k * dpr, -(top - BOUNDS.minZ) * k * dpr);
    g.drawImage(img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.route) this.strokeRoute(g, (x) => (x - left) * k * dpr, (z) => (z - top) * k * dpr, dpr, true);
    // Pins and labels: landmark names once zoomed a little, towns once zoomed further.
    const r = k / this.fitK;
    this.layer.classList.toggle('show-lm', r > 1.7 || this.vw > 900);
    this.layer.classList.toggle('show-town', r > 3.2);
    for (const p of this.pins) {
      const x = (p.x - left) * k, y = (p.z - top) * k;
      const off = x < -40 || y < -40 || x > this.vw + 40 || y > this.vh + 40;
      p.el.style.visibility = off ? 'hidden' : '';
      if (!off) p.el.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (this.me && this.player) {
      const x = (this.player.x - left) * k, y = (this.player.z - top) * k;
      this.me.style.transform = `translate(${x}px, ${y}px)`;
      this.me.style.setProperty('--turn', `${-this.player.heading + Math.PI}rad`);
    }
    if (this.selEl) {
      const s = this.sel || this.dest;
      this.selEl.hidden = !s;
      if (s) this.selEl.style.transform = `translate(${(s.x - left) * k}px, ${(s.z - top) * k}px)`;
    }
  }

  // The route as a dark-cased blue line, like a satnav, ending in a ring at the destination.
  strokeRoute(g, X, Y, dpr, big) {
    const p = this.route;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    p.forEach((q, i) => (i ? g.lineTo(X(q.x), Y(q.z)) : g.moveTo(X(q.x), Y(q.z))));
    g.strokeStyle = 'rgba(8,16,30,0.75)'; g.lineWidth = (big ? 7 : 6) * dpr; g.stroke();
    g.strokeStyle = ROUTE; g.lineWidth = (big ? 4 : 3.5) * dpr; g.stroke();
    g.restore();
  }

  update(dt, pos, heading) {
    this.player = { x: pos.x, z: pos.z, heading };
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const c = this.mini, g = this.ctx;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const css = c.clientWidth || 168;
    if (c.width !== Math.round(css * dpr)) { c.width = c.height = Math.round(css * dpr); }
    const S = c.width;
    const pxPerUnit = this.island.width / W;
    const src = this.view * pxPerUnit;
    const sx = (pos.x - BOUNDS.minX) * pxPerUnit - src / 2, sy = (pos.z - BOUNDS.minZ) * pxPerUnit - src / 2;
    g.fillStyle = OCEAN;
    g.fillRect(0, 0, S, S);
    g.drawImage(this.island, sx, sy, src, src, 0, 0, S, S);
    const k = S / this.view;
    // Landmarks nearby.
    for (const lm of this.landmarks.list) {
      const u = (lm.x - pos.x) * k + S / 2, v = (lm.z - pos.z) * k + S / 2;
      if (u < -10 || v < -10 || u > S + 10 || v > S + 10) continue;
      g.beginPath(); g.arc(u, v, 4.5 * dpr, 0, Math.PI * 2);
      g.fillStyle = store.data.stamps[lm.id] ? '#5cf2a0' : '#ffffff';
      g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#0d1520'; g.stroke();
    }
    // Route and destination; a destination off the edge shows as a marker on the rim.
    if (this.route) this.strokeRoute(g, (x) => (x - pos.x) * k + S / 2, (z) => (z - pos.z) * k + S / 2, dpr, false);
    if (this.dest) {
      let u = (this.dest.x - pos.x) * k, v = (this.dest.z - pos.z) * k;
      const m = S / 2 - 9 * dpr, f = Math.max(Math.abs(u), Math.abs(v)) / m;
      if (f > 1) { u /= f; v /= f; }
      g.beginPath(); g.arc(u + S / 2, v + S / 2, 5.5 * dpr, 0, Math.PI * 2);
      g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 3 * dpr; g.strokeStyle = ME; g.stroke();
    }
    // Player: a blue arrow with a white rim and a soft pulse, the one thing on the map that moves.
    g.save();
    g.translate(S / 2, S / 2);
    const pulse = (performance.now() / 1400) % 1;
    g.beginPath(); g.arc(0, 0, (9 + pulse * 9) * dpr, 0, Math.PI * 2);
    g.fillStyle = `rgba(47,143,255,${0.35 * (1 - pulse)})`; g.fill();
    g.beginPath(); g.arc(0, 0, 11 * dpr, 0, Math.PI * 2);
    g.fillStyle = 'rgba(47,143,255,0.22)'; g.fill();
    g.rotate(-heading + Math.PI);
    const s = 10 * dpr;
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.72, s * 0.8); g.lineTo(0, s * 0.38); g.lineTo(-s * 0.72, s * 0.8); g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 4.5 * dpr; g.strokeStyle = 'rgba(8,16,30,0.6)'; g.stroke();
    g.lineWidth = 2.5 * dpr; g.strokeStyle = '#ffffff'; g.stroke();
    g.fillStyle = ME; g.fill();
    g.restore();
    // North marker.
    g.fillStyle = 'rgba(13,21,32,0.75)';
    g.beginPath(); g.arc(S - 14 * dpr, 14 * dpr, 9 * dpr, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e7ecef'; g.font = `700 ${11 * dpr}px "Atkinson Hyperlegible", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', S - 14 * dpr, 14.5 * dpr);
  }
}
