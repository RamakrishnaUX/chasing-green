import { LANDMARKS } from '../world/landmarks.js';
import { CHALLENGES } from '../challenges.js';
import { store } from '../storage.js';

const GLYPHS = {
  falls: '<path d="M30 26v24M38 24v28M46 26v24" />',
  columns: '<path d="M26 52V34h6v18M35 52V28h6v24M44 52V36h6v16" />',
  ice: '<path d="M38 22l12 14-12 18-12-18z M26 36h24" />',
  rift: '<path d="M26 24l6 28M50 24l-6 28" />',
  peak: '<path d="M22 50l14-26 4 6 4-4 10 24z" />',
  crater: '<ellipse cx="38" cy="42" rx="12" ry="6" /><path d="M32 30c2-4-2-6 0-10M42 30c2-4-2-6 0-10" />',
  star: '<path d="M38 24l4 9 10 1-8 6 3 10-9-6-9 6 3-10-8-6 10-1z" />',
  church: '<path d="M38 18v6M35 21h6M38 24l-6 8v20h12V32z M28 52h20" />',
  harpa: '<path d="M24 50l4-24 22-4-2 28z M28 34h20M27 42h21M34 24v28M42 23v29" />',
  ship: '<path d="M22 44c8 6 24 6 32-2M26 44l-2-12M38 46V28M50 42l4-14M30 45l2-10M44 45l2-10" />',
  dome: '<path d="M26 40a12 12 0 0 1 24 0zM24 40h28v10H24zM30 40v10M38 40v10M46 40v10" />',
  pool: '<path d="M22 40c4-4 8 4 12 0s8 4 12 0 8 4 8 0M24 32c2-4 0-6 2-10M38 30c2-4 0-6 2-10" />',
  canyon: '<path d="M22 24v28h10l2-14 4 14h4l2-14 4 14h6V24" />',
  geyser: '<path d="M38 50V26M34 30c-4-6 2-8 4-12 2 4 8 6 4 12M26 50h24" />',
  arch: '<path d="M20 50V32c0-6 6-10 12-10h12c6 0 12 4 12 10v18M30 50V38a8 8 0 0 1 16 0v12" />',
  steam: '<path d="M26 50h24M30 46c-2-6 4-8 2-14M38 46c-2-6 4-8 2-14M46 46c-2-6 4-8 2-14" />',
  lava: '<path d="M22 46c4-8 10-4 14-8s10-6 18 0M24 52c6-4 12-2 18-4s8-2 12 0" />',
};

export function stampSvg(label, glyph, got, id) {
  const col = got ? '#5cf2a0' : 'rgba(169,180,189,0.45)';
  const dash = got ? '' : 'stroke-dasharray="3 4"';
  const pid = `arc-${id}`;
  return `<svg viewBox="0 0 76 76" aria-hidden="true"><g fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${got ? 'transform="rotate(-8 38 38)"' : ''}>
    <circle cx="38" cy="38" r="35" ${dash}/><circle cx="38" cy="38" r="30" ${dash}/>
    <defs><path id="${pid}" d="M14 40a24 24 0 0 1 48 0" /></defs>
    <text font-size="8" font-weight="700" fill="${col}" stroke="none" font-family="Atkinson Hyperlegible, system-ui"><textPath href="#${pid}" startOffset="50%" text-anchor="middle">${label}</textPath></text>
    <g transform="translate(0 6) scale(0.82) translate(8 2)">${GLYPHS[glyph] || ''}</g></g></svg>`;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Notebook {
  constructor({ onPostcard, getChallenge }) {
    this.dialog = document.getElementById('notebook');
    this.list = document.getElementById('sightings-list');
    this.stamps = document.getElementById('stamps-list');
    this.challengeEl = document.getElementById('challenge-card');
    this.onPostcard = onPostcard;
    this.getChallenge = getChallenge;
    this.dialog.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => this.tab(tab.dataset.tab)));
    this.dialog.querySelector('[data-close]').addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
  }

  tab(name) {
    this.dialog.querySelectorAll('.tab').forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on)); });
    this.dialog.querySelectorAll('.tab-body').forEach((b) => (b.hidden = b.dataset.body !== name));
  }

  open(tab = 'sightings') { this.render(); this.tab(tab); this.dialog.showModal(); }

  render() {
    const sightings = [...store.data.sightings].reverse();
    if (!sightings.length) {
      this.list.innerHTML = '<li class="empty">No sightings yet. When the radio says the aurora is active, find a dark spot away from town and look up for a few seconds.</li>';
    } else {
      this.list.innerHTML = sightings.map((s) => {
        const thumb = store.thumb(s.n);
        const img = thumb ? `<img src="${thumb}" alt="Aurora at ${esc(s.place)}">` : '<div class="thumb" aria-hidden="true"></div>';
        return `<li class="sighting">${img}<div><h3>Sighting #${s.n}</h3><p>${esc(s.place)}, ${esc(s.clock)}</p><p>${esc(s.type)}, Kp ${s.kp.toFixed(1)}</p></div>
          <button class="btn btn-quiet" data-n="${s.n}">Postcard</button></li>`;
      }).join('');
      this.list.querySelectorAll('button[data-n]').forEach((b) => b.addEventListener('click', () => this.onPostcard(+b.dataset.n)));
    }

    const st = store.data.stamps;
    const lm = LANDMARKS.map((l) => `<li class="${st[l.id] ? 'is-got' : ''}">${stampSvg(l.name, l.glyph, !!st[l.id], l.id)}${esc(l.name)}</li>`);
    const done = Object.entries(store.data.challenges).filter(([, v]) => v.done);
    const ch = done.map(([key, v]) => {
      const c = CHALLENGES.find((x) => x.id === v.id);
      return `<li class="is-got">${stampSvg(key, 'star', true, 'c' + key)}${esc(c ? c.title : 'Daily challenge')}</li>`;
    });
    this.stamps.innerHTML = lm.join('') + ch.join('');

    const c = this.getChallenge();
    const rec = store.data.challenges[c.key];
    this.challengeEl.innerHTML = `<h3>${esc(c.title)}</h3><p>${esc(c.detail)}</p>${rec?.done ? '<p class="done">Done. Stamp added to your notebook.</p>' : '<p>A new challenge appears every day.</p>'}`;
  }
}
