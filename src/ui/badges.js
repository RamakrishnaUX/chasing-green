// Badges: medals for things you have done on the trip, worked out from what the notebook already
// keeps (stamps, sightings, daily challenges) plus a few feats the game reports (flying, a jump,
// a swim in the car). A badge that lands pops up at the top of the screen and spins in like a coin.
import { LANDMARKS } from '../world/landmarks.js';
import { store } from '../storage.js';

export const ICONS = {
  aurora: '<path d="M3 17 C 6 8, 10 14, 12 9 S 18 5, 21 12"/><path d="M3 21 h18"/>',
  falls: '<path d="M6 4 h12 M8 4 v12 M12 4 v14 M16 4 v12 M5 20 h14"/>',
  peak: '<path d="M3 19 L10 6 L14 13 L16 10 L21 19 Z"/>',
  road: '<path d="M8 3 L5 21 M16 3 L19 21 M12 5 v3 M12 11 v3 M12 17 v3"/>',
  heli: '<path d="M3 6 h18 M12 6 v3"/><ellipse cx="11" cy="13" rx="6" ry="4"/><path d="M17 13 h4 M8 19 h8"/>',
  chute: '<path d="M4 11 a8 7 0 0 1 16 0 Z"/><path d="M4 11 L12 19 L20 11 M9 11 L12 19 L15 11"/>',
  flag: '<path d="M5 20 V6 M5 6 h10 l-3 4 l3 4 H5"/>',
  pool: '<path d="M3 15 c3 -3 6 3 9 0 s6 3 9 0"/><path d="M7 11 c1.5 -2.5 0 -4 1.5 -6.5 M13 11 c1.5 -2.5 0 -4 1.5 -6.5"/>',
  crown: '<path d="M4 18 L5 8 L9 12 L12 6 L15 12 L19 8 L20 18 Z"/>',
  red: '<path d="M3 16 C 6 6, 10 13, 12 8 S 18 4, 21 11"/><circle cx="12" cy="18" r="2"/>',
  photo: '<rect x="3" y="6" width="18" height="13" rx="1"/><path d="M3 15 l5 -4 l4 3 l3 -2 l6 4"/>',
  boot: '<circle cx="13" cy="4.5" r="1.8"/><path d="M12.5 8 L10.5 14 L13 16.5 L14 21 M11.2 11.5 L8 13 M12.5 8 L16 11 L18 10.5 M10.5 14 L8 20"/>',
  wave: '<path d="M3 14 c3 -4 6 4 9 0 s6 4 9 0"/><path d="M5 19 h14"/><path d="M8 10 l4 -5 l4 5"/>',
  star: '<path d="M12 4 l2.4 5 l5.6 .6 l-4.2 3.8 l1.2 5.6 l-5 -2.9 l-5 2.9 l1.2 -5.6 l-4.2 -3.8 l5.6 -.6 Z"/>',
};

const kinds = (...k) => LANDMARKS.filter((l) => k.includes(l.kind)).map((l) => l.id);
const stamped = (ids) => ids.filter((id) => store.data.stamps[id]);
const auroras = () => store.data.sightings.filter((s) => s.type !== 'Sky' && s.type !== 'Night sky');
const feat = (k) => (store.data.feats?.[k] ? 1 : 0);
const FALLS = kinds('waterfall'), HOT = kinds('pool', 'geothermal', 'geyser'), PEAKS = kinds('mountain', 'crater', 'canyon', 'rift');

// Each badge: how far along you are (have of need) and the line it shows once earned.
export const BADGES = [
  { id: 'first-lights', name: 'First Lights', icon: 'aurora', need: 1, have: () => auroras().length, what: 'Log your first aurora sighting.', done: () => `Your first aurora, at ${auroras()[0]?.place || 'night'}.` },
  { id: 'waterfall-chaser', name: 'Waterfall Chaser', icon: 'falls', need: 5, have: () => stamped(FALLS).length, what: 'Find five waterfalls.', done: () => `You found five waterfalls. ${last(FALLS)} was the fifth.` },
  { id: 'all-the-falls', name: 'Every Waterfall', icon: 'falls', need: FALLS.length, have: () => stamped(FALLS).length, what: `Find all ${FALLS.length} waterfalls.`, done: () => `All ${FALLS.length} waterfalls in your notebook.` },
  { id: 'hot-water', name: 'Hot Water', icon: 'pool', need: 3, have: () => stamped(HOT).length, what: 'Visit three hot springs, pools or geysers.', done: () => `Three hot spots found. ${last(HOT)} was the third.` },
  { id: 'rock-hound', name: 'Rock Hound', icon: 'peak', need: 3, have: () => stamped(PEAKS).length, what: 'Find three mountains, craters, canyons or rifts.', done: () => `Three bits of raw geology, ending at ${last(PEAKS)}.` },
  { id: 'ten-places', name: 'Road Tripper', icon: 'road', need: 10, have: () => Object.keys(store.data.stamps).length, what: 'Stamp ten places.', done: () => 'Ten places stamped in your notebook.' },
  { id: 'thirty-places', name: 'Ring Road', icon: 'flag', need: 30, have: () => Object.keys(store.data.stamps).length, what: 'Stamp thirty places.', done: () => 'Thirty places. You have seen most of the island.' },
  { id: 'every-place', name: 'Every Corner', icon: 'crown', need: LANDMARKS.length, have: () => stamped(LANDMARKS.map((l) => l.id)).length, what: `Stamp all ${LANDMARKS.length} places.`, done: () => 'Every place on the island, stamped.' },
  { id: 'corona', name: 'Corona', icon: 'star', need: 1, have: () => auroras().filter((s) => /corona/i.test(s.type)).length, what: 'See an aurora corona straight overhead.', done: () => 'Rays pouring from one point overhead. A corona.' },
  { id: 'red-sky', name: 'Red Sky', icon: 'red', need: 1, have: () => auroras().filter((s) => /red/i.test(s.type)).length, what: 'See a rare red aurora.', done: () => 'A red aurora, high and rare.' },
  { id: 'five-sightings', name: 'Sky Watcher', icon: 'photo', need: 5, have: () => auroras().length, what: 'Log five aurora sightings.', done: () => 'Five sightings in your notebook.' },
  { id: 'taking-off', name: 'Taking Off', icon: 'heli', need: 1, have: () => feat('fly'), what: 'Fly the helicopter.', done: () => 'Wheels up. You flew the helicopter.' },
  { id: 'out-the-door', name: 'Out the Door', icon: 'chute', need: 1, have: () => feat('jump'), what: 'Jump from the helicopter.', done: () => 'You jumped, and the parachute opened.' },
  { id: 'on-foot', name: 'Stretch Your Legs', icon: 'boot', need: 1, have: () => feat('walk'), what: 'Step out and walk.', done: () => 'Out of the car and on foot.' },
  { id: 'afloat', name: 'Afloat', icon: 'wave', need: 1, have: () => feat('boat'), what: 'Drive into the water and float.', done: () => 'Your car floats. Who knew.' },
  { id: 'daily', name: 'Daily Driver', icon: 'flag', need: 1, have: () => Object.values(store.data.challenges).filter((c) => c.done).length, what: 'Finish a daily challenge.', done: () => 'A daily challenge, done.' },
];
const last = (ids) => {
  const got = stamped(ids).sort((a, b) => (store.data.stamps[a] < store.data.stamps[b] ? -1 : 1));
  return LANDMARKS.find((l) => l.id === got[got.length - 1])?.name || 'The last one';
};

// Rounded hexagon: each corner a short curve, so the medal reads as pressed metal, not cut paper.
function hexPath(w, h, r) {
  const cx = w / 2, cy = h / 2;
  const pts = [0, 60, 120, 180, 240, 300].map((a) => [cx + (w / 2) * Math.sin((a * Math.PI) / 180), cy - (h / 2) * Math.cos((a * Math.PI) / 180)]);
  const toward = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let d = '';
  pts.forEach((p, i) => {
    const prev = pts[(i + 5) % 6], next = pts[(i + 1) % 6];
    const t = r / Math.hypot(next[0] - p[0], next[1] - p[1]);
    const a = toward(p, prev, t), b = toward(p, next, t);
    d += `${i ? ' L' : 'M'}${a[0].toFixed(1)} ${a[1].toFixed(1)} Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  });
  return `${d} Z`;
}

let uid = 0;
// The medal as one SVG: a bevelled rim, a dark face, a dashed inner ring, a soft highlight and the icon.
export function medalSvg(icon, got = true) {
  const w = 100, h = 111, id = `md${uid++}`;
  const outer = hexPath(w, h, 13), inner = hexPath(w - 10, h - 11, 11), ring = hexPath(w - 24, h - 26, 9);
  const c = got ? ['#cbfbe7', '#66dfb0', '#1e5c47', '#1f6049', '#071d17'] : ['#3d4846', '#262f2d', '#161c1b', '#121a18', '#0a100f'];
  return `<svg class="medal" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs>
    <linearGradient id="${id}r" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="0.45" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient>
    <radialGradient id="${id}c" cx="0.5" cy="0.32" r="0.75"><stop offset="0" stop-color="${c[3]}"/><stop offset="1" stop-color="${c[4]}"/></radialGradient>
    <clipPath id="${id}k"><path d="${inner}" transform="translate(5 5.5)"/></clipPath></defs>
    <path d="${outer}" fill="url(#${id}r)"/>
    <path d="${outer}" fill="none" stroke="rgba(255,255,255,${got ? 0.55 : 0.06})" stroke-width="1.2"/>
    <path d="${inner}" transform="translate(5 5.5)" fill="url(#${id}c)"/>
    <path d="${ring}" transform="translate(12 13)" fill="none" stroke="${got ? 'rgba(162,246,211,0.45)' : 'rgba(255,255,255,0.06)'}" stroke-width="1" ${got ? 'stroke-dasharray="2 3"' : ''}/>
    <g clip-path="url(#${id}k)"><ellipse cx="50" cy="13" rx="70" ry="42" fill="#fff" opacity="${got ? 0.1 : 0.03}"/></g>
    <g transform="translate(29 33) scale(1.75)" fill="none" stroke="${got ? '#c9fbe6' : '#4a5754'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] || ''}</g></svg>`;
}
export const MEDAL_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 111'><path d='${hexPath(100, 111, 13)}'/></svg>`)}")`;

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export class Badges {
  constructor({ onEarn } = {}) {
    store.data.badges ||= {};
    store.data.feats ||= {};
    this.el = document.getElementById('badge-pop');
    this.el.style.setProperty('--hexmask', MEDAL_MASK);
    this.queue = [];
    this.timer = 0;
    this.onEarn = onEarn;
    this.total = BADGES.length;
    // Badges already earned by the time this version arrived land quietly, without a popup each.
    if (!store.data.badgesSeeded) { this.check({ quiet: true }); store.data.badgesSeeded = true; store.save(); }
  }

  feat(k) {
    store.data.feats ||= {};
    if (store.data.feats[k]) return;
    store.data.feats[k] = new Date().toISOString();
    store.save();
    this.check();
  }

  check({ quiet = false } = {}) {
    store.data.badges ||= {};
    let changed = false;
    for (const b of BADGES) {
      if (store.data.badges[b.id] || b.have() < b.need) continue;
      store.data.badges[b.id] = new Date().toISOString();
      changed = true;
      if (!quiet) this.queue.push(b);
    }
    if (changed) store.save();
    if (!this.timer) this.next();
  }

  next() {
    const b = this.queue.shift();
    if (!b) { this.el.hidden = true; this.timer = 0; document.body.classList.remove('badge-on'); return; }
    this.el.innerHTML = `<div class="bp-medal">${medalSvg(b.icon)}</div><div class="bp-text"><p class="bp-kick">Badge earned</p><h3>${esc(b.name)}</h3><p>${esc(b.done())}</p></div>`;
    this.el.hidden = false;
    document.body.classList.add('badge-on');
    this.el.classList.remove('is-out');
    // Restart the animation each time, even for two badges in a row.
    void this.el.offsetWidth;
    this.onEarn?.(b);
    this.timer = setTimeout(() => {
      this.el.classList.add('is-out');
      this.timer = setTimeout(() => { this.timer = 0; this.el.hidden = true; this.next(); }, 450);
    }, 5200);
  }

  // The collection, for the notebook.
  html() {
    const got = store.data.badges || {};
    return [...BADGES].sort((a, b) => (got[b.id] ? 1 : 0) - (got[a.id] ? 1 : 0)).map((b) => {
      const g = !!got[b.id], p = Math.min(1, b.have() / b.need);
      return `<li class="badge${g ? ' is-got' : ''}">${medalSvg(b.icon, g)}<b>${esc(b.name)}</b><span>${esc(g ? b.done() : b.what)}</span>${g ? '' : `<i class="bprog" aria-label="${Math.round(p * 100)}% done"><i style="width:${(p * 100).toFixed(0)}%"></i></i>`}</li>`;
    }).join('');
  }
}
