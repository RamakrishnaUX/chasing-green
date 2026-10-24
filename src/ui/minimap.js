import { BOUNDS, heightAt, waterLevelAt, glacierMask, roadPaths } from '../world/terrain.js';
import { surfaceUniforms } from '../world/materials.js';
import { PLACES } from '../world/geo.js';
import { store } from '../storage.js';

const $ = (id) => document.getElementById(id);
const W = BOUNDS.maxX - BOUNDS.minX, H = BOUNDS.maxZ - BOUNDS.minZ;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sat = (x) => Math.max(0, Math.min(1, x));

// Paint the island once: terrain colour, hill shading, ice, water and roads.
function paintIsland(px) {
  const w = px, h = Math.round(px * (H / W));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const snowLine = surfaceUniforms.uSnowLine.value;
  const sx = W / w, sz = H / h;
  for (let j = 0; j < h; j++) {
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
  g.putImageData(img, 0, 0);
  // Roads.
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
}

export class MapUI {
  constructor({ landmarks, onTravel }) {
    this.landmarks = landmarks;
    this.onTravel = onTravel;
    this.mini = $('minimap-canvas');
    this.ctx = this.mini.getContext('2d');
    this.big = $('map-canvas');
    this.island = paintIsland(900);
    this.view = 1230; // world units across the minimap
    this.timer = 0;
    $('minimap').addEventListener('click', () => this.open());
    $('map').querySelector('[data-close]').addEventListener('click', () => $('map').close());
    $('map').addEventListener('click', (e) => { if (e.target === $('map')) $('map').close(); });
    this.big.addEventListener('click', (e) => {
      const r = this.big.getBoundingClientRect();
      const x = BOUNDS.minX + ((e.clientX - r.left) / r.width) * W;
      const z = BOUNDS.minZ + ((e.clientY - r.top) / r.height) * H;
      this.travel(x, z, null);
    });
  }

  travel(x, z, label, face) {
    $('map').close();
    this.onTravel(x, z, label, face);
  }

  open() {
    const b = this.big;
    const dpr = Math.min(2, devicePixelRatio || 1);
    // Fit the whole island inside the dialog, by width and by height.
    const cssW = Math.max(260, Math.min(980, innerWidth - 48, (innerHeight * 0.86 - 140) * (W / H)));
    b.style.width = cssW + 'px';
    b.width = Math.round(cssW * dpr);
    b.height = Math.round(cssW * (H / W) * dpr);
    const g = b.getContext('2d');
    g.drawImage(this.island, 0, 0, b.width, b.height);
    // Markers for landmarks and towns, as real buttons for keyboard and screen readers.
    const layer = $('map-markers');
    layer.innerHTML = '';
    const add = (x, z, label, cls, face) => {
      const btn = document.createElement('button');
      btn.className = `map-pin ${cls}`;
      btn.style.left = `${((x - BOUNDS.minX) / W) * 100}%`;
      btn.style.top = `${((z - BOUNDS.minZ) / H) * 100}%`;
      btn.innerHTML = `<span class="dot"></span><span class="label">${label}</span>`;
      btn.setAttribute('aria-label', `Go to ${label}`);
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.travel(x, z, label, face); });
      layer.appendChild(btn);
    };
    // Towns first, so landmark pins sit on top; skip towns that would crowd a landmark.
    for (const p of PLACES) {
      if (this.landmarks.list.some((lm) => Math.hypot(lm.x - p.x, lm.z - p.z) < 60)) continue;
      add(p.x, p.z, p.name, 'is-town', false);
    }
    for (const lm of this.landmarks.list) add(lm.x, lm.z, lm.name, store.data.stamps[lm.id] ? 'is-lm is-got' : 'is-lm', true);
    this.drawPlayer(g, b.width / W, true);
    $('map').showModal();
  }

  drawPlayer(g, scale, big) {
    if (!this.player) return;
    const { x, z, heading } = this.player;
    const u = (x - BOUNDS.minX) * scale, v = (z - BOUNDS.minZ) * scale;
    g.save();
    g.translate(u, v);
    g.rotate(-heading + Math.PI); // world heading 0 points +z, which is down on the map
    const s = big ? 9 * (devicePixelRatio || 1) : 8;
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.7, s * 0.8); g.lineTo(0, s * 0.35); g.lineTo(-s * 0.7, s * 0.8); g.closePath();
    g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#0d1520'; g.stroke();
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
    g.fillStyle = '#0c1c28';
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
    // Player arrow at the centre.
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(-heading + Math.PI);
    const s = 8 * dpr;
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.7, s * 0.8); g.lineTo(0, s * 0.35); g.lineTo(-s * 0.7, s * 0.8); g.closePath();
    g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2 * dpr; g.strokeStyle = '#0d1520'; g.stroke();
    g.restore();
    // North marker.
    g.fillStyle = 'rgba(13,21,32,0.75)';
    g.beginPath(); g.arc(S - 14 * dpr, 14 * dpr, 9 * dpr, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e7ecef'; g.font = `700 ${11 * dpr}px "Atkinson Hyperlegible", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', S - 14 * dpr, 14.5 * dpr);
  }
}
