import { CONFIG } from '../config.js';
import { haptics } from './haptics.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), speed: $('speed'), alt: $('alt'), where: $('where'), clock: $('clock'), kp: $('kp'), kpWrap: $('kp').parentElement,
      status: $('radio-status'), graph: $('radio-graph'), cloud: $('stat-cloud'), activity: $('stat-activity'), dark: $('stat-dark'), glow: $('stat-glow'), moon: $('stat-moon'),
      rose: $('compass-rose'), wind: $('wind-arrow'), toast: $('toast'),
      radio: $('radio'), radioToggle: $('radio-toggle'), kpLevel: $('kp-level'), skyHint: $('sky-hint'), look: $('t-look'),
    };
    this.g = this.el.graph.getContext('2d');
    this.graphTimer = 0;
    this.toastTimer = 0;
    this.toastPriority = 0;
    this.lastStatus = '';
    this.hx = Object.fromEntries(['tape', 'kick', 'place', 'next', 'clock', 'day', 'gear', 'fuel', 'fuelbar', 'fuelside', 'speed', 'unit', 'nitro-l', 'nitro-r', 'kp', 'kpbar', 'cond', 'chip'].map((k) => [k, $(`hx-${k}`)]));
    if (this.hx.cond) { this.hx.condPct = this.hx.cond.querySelector('em'); this.hx.condPips = [...this.hx.cond.querySelectorAll('.hx-pips i')]; }
    if (this.hx.chip) {
      const c = this.hx.chip;
      Object.assign(this.hx, { chipFuel: c.querySelector('.c-fuel b'), chipFuelWrap: c.querySelector('.c-fuel'), chipCond: c.querySelector('.c-cond b'), chipCondWrap: c.querySelector('.c-cond'), chipKp: c.querySelector('.c-kp b') });
      // The chip's Kp opens the aurora radio, as the Kp in the cluster does.
      c.querySelector('.c-kp').addEventListener('click', () => this.el.radioToggle?.click());
    }
    this.gauge = document.querySelector('.hx-gauge');
    this.buildTape();
    // The aurora moment: a big title when the lights first come out, once per display.
    this.mo = { el: $('moment'), edge: $('mo-edge'), time: $('mo-time'), kp: $('mo-kp'), level: $('mo-level'), fill: $('mo-fill'), t: 0, cool: 0, was: false };
    this.el.radioToggle.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.el.radioToggle.click(); } });
    this.el.radioToggle.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-learn]')) return;
      const collapsed = this.el.radio.classList.toggle('is-collapsed');
      this.el.radioToggle.setAttribute('aria-expanded', String(!collapsed));
    });
    // The minimap sits a fixed gap below the speed panel, however tall that panel is (it grows
    // with the nitro bar), so the two never touch. CSS reads --tl-bottom.
    const tl = this.el.hud.querySelector('.hud-tl');
    new ResizeObserver(() => {
      const b = tl.getBoundingClientRect().bottom;
      if (b > 0) this.el.hud.style.setProperty('--tl-bottom', `${Math.round(b)}px`);
    }).observe(tl);
    // Whether the driving display shows (it depends on the screen): asked of the page only when its
    // size changes, never each frame (asking each frame makes the browser lay the page out again).
    const hx = this.el.hud.querySelector('.hx') || document.querySelector('.hx');
    this.hxShown = !!hx?.offsetParent;
    if (hx) new ResizeObserver(() => { this.hxShown = !!hx.offsetParent; }).observe(hx);
    // The quiet line (computers). Its items are kept in the page and only shown or hidden, so they
    // can grow in and out of the line; text is written only when it changes.
    const qh = $('qh');
    this.q = { root: qh, scrim: document.querySelector('.qh-scrim'), items: {}, shown: '', placeText: '', kpHtml: '' };
    if (qh) {
      qh.querySelectorAll('.qh-it').forEach((el) => { this.q.items[el.dataset.i] = el; });
      for (const k of ['alt', 'spd', 'up', 'place', 'time', 'fuel', 'cond', 'kp', 'kbd', 'key', 'altbar', 'pumped', 'cost']) this.q[k] = $(`qh-${k}`);
      this.qShown = !!qh.offsetParent;
      new ResizeObserver(() => { this.qShown = !!qh.offsetParent; }).observe(qh);
    }
    // Buttons and key hints show while the mouse moves, and step away after a few still seconds
    // (not for a drag, which is looking around, nor while the pointer rests on a button).
    this.idleT = 4;
    const wake = () => { this.idleT = 3; document.body.classList.remove('hud-idle'); };
    addEventListener('mousemove', (ev) => { if (!ev.buttons) wake(); }, { passive: true });
    this.el.hud.addEventListener('focusin', wake);
  }

  show() { this.el.hud.hidden = false; }

  toast(text, { seconds = 4, priority = 1, action, tone } = {}) {
    if (this.toastTimer > 0 && priority < this.toastPriority) return;
    const t = this.el.toast;
    t.textContent = text;
    // A safety message wears its own amber dress with a "Drive safe" kicker.
    t.classList.toggle('is-safe', tone === 'safe');
    if (tone === 'safe') { const k = document.createElement('b'); k.className = 'toast-kick'; k.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z"/><path d="M12 8v5M12 16.2v.1"/></svg>Drive safe'; t.prepend(k); }
    if (action) {
      const b = document.createElement('button');
      b.className = 'btn btn-small';
      b.style.marginLeft = '10px';
      b.textContent = action.label;
      b.onclick = action.run;
      t.appendChild(b);
      t.style.pointerEvents = 'auto';
    } else t.style.pointerEvents = 'none';
    t.classList.add('is-on');
    document.body.classList.add('toast-on');
    this.toastTimer = seconds;
    this.toastPriority = priority;
  }

  update(dt, s) {
    const e = this.el;
    // One message at a time at the top: while a badge shows, a tip waits under it with its clock
    // stopped, and gets its full time once the badge has gone.
    if (this.toastTimer > 0 && !document.body.classList.contains('badge-on')) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) { e.toast.classList.remove('is-on'); e.toast.style.pointerEvents = 'none'; this.toastPriority = 0; document.body.classList.remove('toast-on'); }
    }
    e.speed.textContent = s.walking ? 'On foot' : String(s.kmh);
    e.speed.nextElementSibling.hidden = s.walking;
    // Flying: height above the sea beside the speed.
    const alt = s.altitude != null && !s.walking ? `${Math.max(0, Math.round(s.altitude))} m` : '';
    if (e.alt.textContent !== alt) { e.alt.textContent = alt; e.alt.hidden = !alt; }
    e.where.textContent = s.where;
    e.clock.textContent = `${s.clockLabel}, ${s.monthName || s.season.toLowerCase()}`;
    e.kp.textContent = s.aurora.kp.toFixed(1);
    e.kpWrap.classList.toggle('is-low', s.aurora.kp < CONFIG.aurora.minKp);
    // Kp in words, so the number means something at a glance.
    const kp = s.aurora.kp;
    e.kpLevel.textContent = kp < 3 ? 'Quiet' : kp < 5 ? 'Active' : 'Storm';
    e.kpLevel.dataset.level = kp < 3 ? 'quiet' : kp < 5 ? 'active' : 'storm';
    // When the lights are out, say so plainly at the top and make the Look button call for attention.
    const callUp = !!s.aurora.active && !s.lookingUp;
    e.skyHint.hidden = !callUp;
    e.look?.classList.toggle('is-call', callUp);
    // The Look button shows only when there is something to look up at, or while you are looking up.
    document.body.classList.toggle('look-needed', !!s.aurora.active || !!s.lookingUp);
    document.body.classList.toggle('sky-on', callUp);
    if (callUp && !this.wasCall) haptics.play('aurora', 0);
    this.wasCall = callUp;
    this.moment(dt, s, kp);
    this.drive(s, kp);
    this.quiet(s, kp);
    if (this.idleT > 0) {
      this.idleT -= dt;
      if (this.idleT <= 0) {
        if (this.el.hud.querySelector('.hud-tr:hover, .nav:hover, .hud-tr:focus-within, .sm:hover, .sm.is-open, .sm:focus-within')) this.idleT = 1;
        else document.body.classList.add('hud-idle');
      }
    }
    e.cloud.textContent = `${Math.round(s.aurora.cloud * 100)}%`;
    e.dark.textContent = `${Math.round(s.aurora.dark * 100)}%`;
    const glow = s.aurora.city.overhead;
    e.glow.textContent = glow > 0.6 ? 'Strong' : glow > 0.25 ? 'Some' : glow > 0.05 ? 'Faint' : 'None';
    const M = s.aurora.moon;
    if (M && e.moon) {
      const i = M.illum, wax = M.phase < 0.5;
      const name = i < 0.04 ? 'New' : i > 0.96 ? 'Full' : i < 0.4 ? `${wax ? 'Waxing' : 'Waning'} crescent` : i < 0.6 ? 'Half' : `${wax ? 'Waxing' : 'Waning'} gibbous`;
      const where = i < 0.04 ? '' : M.el > 2 ? (M.bright > 0.5 ? ', up and bright' : ', up') : ', set';
      const txt = name + where;
      if (e.moon.textContent !== txt) e.moon.textContent = txt;
    }
    const v = s.aurora.vis;
    e.activity.textContent = v < 0.05 ? 'None' : v < 0.3 ? 'Faint' : v < 0.6 ? 'Moderate' : 'Bright';

    e.rose.setAttribute('transform', `rotate(${-s.bearingDeg} 32 32)`);
    e.wind.setAttribute('transform', `rotate(${s.windBearingDeg - s.bearingDeg} 32 32)`);
    e.wind.style.opacity = String(0.35 + Math.min(1, s.windStrength / 10) * 0.65);

    const status = this.statusLine(s);
    if (status !== this.lastStatus) { e.status.textContent = status; this.lastStatus = status; }

    this.graphTimer -= dt;
    if (this.graphTimer <= 0) { this.drawGraph(s); this.graphTimer = 0.5; }
  }

  // The compass tape: ticks every 5 degrees and a label every 15, laid out once over a span
  // wider than a full turn, then slid along under the fixed caret.
  buildTape() {
    const ppd = 760 / 140, names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let svg = '';
    for (let d = -90; d <= 450; d += 5) {
      const x = (d + 90) * ppd, a = ((d % 360) + 360) % 360, major = d % 15 === 0;
      svg += `<path d="M${x.toFixed(1)} ${major ? 30 : 34}V40"/>`;
      if (major) svg += `<text x="${x.toFixed(1)}" y="20"${names[a] !== undefined ? ' class="c"' : ''}>${names[a] ?? a}</text>`;
    }
    this.hx.tape.innerHTML = `<path d="M0 40H${((540) * ppd).toFixed(0)}" class="base"/>${svg}`;
    this.ppd = ppd;
  }

  // The quiet line (computers): what it holds depends on the ride.
  //   Road (car, bike, horse): speed · place · time
  //   Helicopter: speed · height · place · time      Skydiving: height · speed · place
  //   On foot: place · time
  // Fuel (under a quarter tank), the car's condition (once dented), the Kp (when it is worth
  // looking up) and a key to press (jump, open the chute, get back in) join only while they matter.
  quiet(s, kp) {
    const q = this.q;
    if (!q.root || !this.qShown) return;
    const set = (el, v) => { if (el.textContent !== v) el.textContent = v; };
    const sky = s.mode === 'sky', air = s.agl != null, A = CONFIG.aurora;
    const show = [];
    if (sky) show.push('alt');
    if (!s.walking) show.push('spd');
    if (air && !sky) show.push('up');
    show.push('place');
    // Filling up at a pump: the litres and the price take the line, and the hairline is the tank.
    const fill = s.filling;
    if (fill) show.push('pumped', 'cost');
    if (!sky && !fill) show.push('time');
    if (s.fuel && s.fuel.level < 0.25 && !fill) show.push('fuel');
    if (s.condition != null && s.condition < 0.9 && !fill) show.push('cond');
    const kpOn = !!s.aurora.active || (kp >= A.minKp && s.aurora.dark >= A.minDarkness && !s.aurora.summer);
    if (kpOn) show.push('kp');
    // A key to press: the helicopter's jump and the chute come from the jump button's state;
    // on foot, getting back in (or on the horse) from main.js.
    const jumpAct = this.jumpBtn ??= document.getElementById('t-jump');
    const act = jumpAct && !jumpAct.hidden ? jumpAct.dataset.act : '';
    const key = fill ? ['F', 'Stop'] : act === 'jump' ? ['J', 'Jump'] : act === 'open' ? ['J', 'Open the chute'] : s.walkKey ? ['E', s.walkKey] : null;
    if (key) { show.push('key'); set(q.kbd, key[0]); set(q.key, key[1]); }

    const shown = show.join(' ');
    if (shown !== q.shown) {
      q.shown = shown;
      let first = true;
      for (const [k, el] of Object.entries(q.items)) {
        const on = show.includes(k);
        el.classList.toggle('on', on);
        el.classList.toggle('first', on && first);
        if (on) first = false;
      }
    }
    q.root.classList.toggle('is-air', air);
    q.root.classList.toggle('is-fill', !!fill);
    q.scrim?.classList.toggle('is-air', air);

    set(q.spd, String(Math.abs(Math.round(s.kmh || 0))));
    if (air) {
      const h = Math.max(0, Math.round(s.agl));
      set(sky ? q.alt : q.up, h.toLocaleString('en'));
      const w = `${Math.min(100, h / 10).toFixed(1)}%`;
      if (q.altbar.style.width !== w) q.altbar.style.width = w;
    } else if (fill) {
      set(q.pumped, fill.litres.toFixed(1).replace('.', ','));
      set(q.cost, Math.round(fill.litres * 314.9).toLocaleString('is-IS'));
      const w = `${(Math.min(1, fill.level) * 100).toFixed(1)}%`;
      if (q.altbar.style.width !== w) q.altbar.style.width = w;
    } else if (q.altbar.style.width !== '0px') q.altbar.style.width = '0px';
    set(q.time, s.clockLabel || '');
    // Driving somewhere: the place gives way to the route, as the route card shows it.
    const nav = this.navEl ??= document.getElementById('nav');
    const route = nav && !nav.hidden ? `${document.getElementById('nav-name').textContent}|${document.getElementById('nav-dist').textContent}` : '';
    const place = route || s.where || '';
    if (place !== q.placeText) {
      q.placeText = place;
      q.items.place.classList.toggle('is-route', !!route);
      if (route) {
        const [name, dist] = route.split('|');
        q.place.innerHTML = '';
        q.place.insertAdjacentHTML('beforeend', '<svg class="qh-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 17-7-4-7 4z"/></svg>');
        q.place.append(name, ' ');
        const em = document.createElement('em'); em.textContent = dist; q.place.append(em);
      } else q.place.textContent = place;
    }
    if (s.fuel) {
      set(q.fuel, `${s.fuel.litres} L`);
      q.items.fuel.classList.toggle('is-low', s.fuel.level < 0.25);
      q.items.fuel.classList.toggle('is-empty', s.fuel.level < 0.05);
    }
    if (s.condition != null) {
      set(q.cond, `${Math.round(s.condition * 100)}%`);
      q.items.cond.classList.toggle('is-bad', s.condition < 0.3);
    }
    if (kpOn) {
      const look = !!s.aurora.active && !s.lookingUp;
      const html = `<i></i>Kp ${kp.toFixed(1)}${look ? ' <kbd>L</kbd> Look up' : ''}`;
      if (html !== q.kpHtml) { q.kpHtml = html; q.items.kp.innerHTML = html; }
      q.items.kp.classList.toggle('is-calm', !s.aurora.active);
    }
  }

  // The driving display: only drawn when it shows (computers), and only what changed.
  drive(s, kp) {
    const h = this.hx;
    if (!h.tape || !this.hxShown) return;
    const set = (el, v) => { if (el.textContent !== v) el.textContent = v; };
    const b = ((s.bearingDeg % 360) + 360) % 360;
    h.tape.setAttribute('transform', `translate(${(380 - (b + 90) * this.ppd).toFixed(1)} 0)`);
    set(h.kick, s.kick || '');
    set(h.place, s.where || '');
    h.place.classList.toggle('is-long', (s.where || '').length > 14);
    set(h.next, s.next || '');
    set(h.clock, s.clockLabel);
    set(h.day, s.dayText || '');
    set(h.gear, s.gear || '');
    set(h.speed, s.walking ? '0' : String(s.kmh));
    set(h.unit, 'km/h');
    // The ribbon: each part filled from the centre out (pathLength 100, so a dash of n is n%).
    // Power-up when the drive starts: fuel sweeps in first, then nitro from the centre out to both
    // sides, then the Kp, like a dash waking up.
    this.boot ??= performance.now();
    const bt = (performance.now() - this.boot) / 1000;
    const ramp = (from, len) => { const u = Math.min(1, Math.max(0, (bt - from) / len)); return 1 - Math.pow(1 - u, 3); };
    // The ribbon is one band (index.html). Each fill is that band cut by two lines at the band's
    // own slant, the same as its ends: one fixed where the part starts, one moving with the value.
    // Left of centre the lines lean one way, right of centre the other.
    // Perspective: every cut across the band (its ends, each fill's start and its moving edge) is a
    // line running to one vanishing point above the middle, like the edges of a road. Near the ends
    // they lean in hard; near the centre they stand almost upright.
    const VX = 350, VY = -480, NITRO_BARS = 14;
    const mid = (x) => x <= 232 || x >= 468 ? 67 : x >= 286 && x <= 414 ? 107 : x < 286 ? 67 + (x - 232) / 54 * 40 : 107 - (x - 414) / 54 * 40;
    const cut = (x) => { const y0 = mid(x), k = (x - VX) / (y0 - VY); return (y) => (x + k * (y - y0)).toFixed(1); };
    // Fuel runs from the dip out to the left end, the Kp from the dip out to the right, and nitro
    // has the dip to itself, so the three meet edge to edge with no gap of bare track between them.
    const PARTS = { 'hx-fuelbar': [286, 24, -0.6], 'hx-kpbar': [414, 676, 0.6] };
    // The bars: NITRO_BARS across the flat of the dip with thin gaps between them and a gap at each
    // end, so they stand apart from the fuel and the Kp. on(i) says which are drawn.
    const nitroBars = (sel, on) => {
      const clip = document.querySelector(sel), A = 287.5, B = 412.5, pitch = (B - A) / NITRO_BARS, gap = 2.4;
      const polys = [];
      for (let i = 0; i < NITRO_BARS; i++) {
        if (!on(i)) continue;
        const L = cut(A + i * pitch + gap / 2), R = cut(A + (i + 1) * pitch - gap / 2);
        polys.push(`<polygon points="${L(-20)},-20 ${R(-20)},-20 ${R(150)},150 ${L(150)},150"/>`);
      }
      clip.innerHTML = polys.join('') || '<polygon points="0,0 0,0 0,0"/>';
    };
    const dash = (el, f) => {
      f = Math.max(0, Math.min(1, f));
      if (el.dataset.f === f.toFixed(3)) return;
      el.dataset.f = f.toFixed(3);
      el.style.visibility = f < 0.005 ? 'hidden' : '';
      const poly0 = el._poly ??= document.querySelector(`${el.getAttribute('clip-path').slice(4, -1)} polygon`);
      // Nitro: a row of upright bars across the dip, each cut toward the vanishing point like the
      // band's ends, lighting pair by pair from the centre out to both sides.
      if (el.id === 'hx-nitro-l') {
        const lit = f < 0.005 ? 0 : Math.max(1, Math.round(f * NITRO_BARS / 2));
        nitroBars(el.getAttribute('clip-path').slice(4, -1), (i) => Math.abs(i - (NITRO_BARS - 1) / 2) < lit);
        return;
      }
      const [from, to] = PARTS[el.id], lead = from + (to - from) * f;
      const a = cut(from), b0 = cut(lead), dir = Math.sign(to - from), y0 = mid(lead);
      // The tip bows out toward the side it is filling, most at the band's middle, like a wave front.
      const b = (y) => (+b0(y) + dir * 7 * Math.max(0, 1 - ((y - y0) / 16) ** 2)).toFixed(1);
      const poly = el._poly ??= document.querySelector(`${el.getAttribute('clip-path').slice(4, -1)} polygon`);
      const tip = [y0 - 20, y0 - 15, y0 - 10, y0 - 5, y0, y0 + 5, y0 + 10, y0 + 15, y0 + 20].map((y) => `${b(y)},${y}`).join(' ');
      poly.setAttribute('points', `${a(-20)},-20 ${b(-20)},-20 ${tip} ${b(150)},150 ${a(150)},150`);
    };
    const nb = (s.nitro || 0) * ramp(1.5, 0.9);
    dash(h['nitro-l'], nb);
    // Under the nitro, the empty part of the dip is a dim nitro colour rather than bare grey track,
    // so a part-used tank never leaves a thin grey sliver between the fuel and the nitro.
    const bed = h['nitro-r'];
    if (!bed._set) { bed._set = true; nitroBars('#hx-c-nr', () => true); bed.classList.add('is-bed'); }
    bed.style.opacity = (0.3 * ramp(1.3, 0.5)).toFixed(3);
    this.gauge.classList.toggle('is-boost', !!s.boosting);
    set(h.kp, kp.toFixed(1));
    dash(h.kpbar, Math.max(0.03, kp / 9) * ramp(2.0, 0.9));
    // Flying, the left of the cluster is height above the ground instead of fuel, its bar growing
    // out from the centre as you climb (full at 600 m).
    const alt = s.agl != null;
    h.fuelside.classList.toggle('is-alt', alt);
    this.gauge.classList.toggle('is-alt', alt);
    if (alt) {
      h.fuelside.hidden = false; h.fuelbar.style.visibility = '';
      set(h.fuel, String(Math.round(s.agl)));
      set(h.fuelside.querySelector('small'), 'm altitude');
      dash(h.fuelbar, Math.min(1, s.agl / 600) * ramp(0.9, 1.1));
      h.fuelside.classList.remove('is-low');
    } else if (h.fuelside.classList.contains('was-alt')) set(h.fuelside.querySelector('small'), 'L fuel');
    h.fuelside.classList.toggle('was-alt', alt);
    if (!alt) h.fuelside.hidden = s.fuel == null;
    if (!alt) h.fuelbar.style.visibility = s.fuel == null ? 'hidden' : '';
    // The car's condition: a small row of ten pips over the fuel (and the same in the phone's chip),
    // amber below a half, red below a fifth.
    if (h.cond) {
      const c = s.condition;
      h.cond.hidden = c == null || alt;
      if (c != null) {
        const pct = Math.round(c * 100), lit = Math.ceil(c * 10 - 0.001);
        set(h.condPct, `${pct}%`);
        if (h.cond.dataset.lit !== String(lit)) { h.cond.dataset.lit = String(lit); h.condPips.forEach((p, i) => p.classList.toggle('on', i < lit)); }
        h.cond.classList.toggle('is-warn', c < 0.5 && c >= 0.2);
        h.cond.classList.toggle('is-bad', c < 0.2);
      }
    }
    if (h.chip) {
      const show = !alt && s.fuel != null;
      h.chip.hidden = !show && s.condition == null;
      if (s.fuel != null) { set(h.chipFuel, `${Math.round(s.fuel.level * 100)}%`); h.chip.classList.toggle('fuel-low', s.fuel.level < 0.2); }
      h.chipFuelWrap.hidden = s.fuel == null;
      if (s.condition != null) { set(h.chipCond, `${Math.round(s.condition * 100)}%`); h.chip.classList.toggle('cond-warn', s.condition < 0.5); h.chip.classList.toggle('cond-bad', s.condition < 0.2); }
      h.chipCondWrap.hidden = s.condition == null;
      set(h.chipKp, kp.toFixed(1));
    }
    if (!alt && s.fuel != null) {
      set(h.fuel, String(s.fuel.litres));
      dash(h.fuelbar, s.fuel.level * ramp(0.9, 1.1));
      h.fuelside.classList.toggle('is-low', s.fuel.level < 0.2);
    }
  }

  // The lights come out: AURORA across the top with the Kp, and Look up, Record and Postcard. It
  // stays about nine seconds, goes the moment you look up, and comes back only for a new display.
  moment(dt, s, kp) {
    const m = this.mo, active = !!s.aurora.active;
    m.cool = active ? Math.max(m.cool, 0) : m.cool - dt;
    const rise = active && !m.was;
    m.was = active;
    const blocked = s.lookingUp || s.busy;
    if (rise && m.cool <= 0 && !blocked) { m.t = 9; m.cool = 90; m.el.hidden = false; m.el.classList.remove('is-out'); void m.el.offsetWidth; }
    if (m.t > 0) {
      m.t = blocked ? 0 : m.t - dt;
      if (m.t <= 0) { m.el.classList.add('is-out'); setTimeout(() => { if (this.mo.t <= 0) m.el.hidden = true; }, 600); }
      m.time.textContent = `· ${s.clockLabel}`;
      m.kp.textContent = `Kp ${kp.toFixed(1)}`;
      m.level.textContent = kp < 3 ? 'Quiet' : kp < 5 ? 'Active' : kp < 7 ? 'Strong' : 'Storm';
      m.fill.style.setProperty('--k', `${Math.min(100, Math.max(4, (kp / 9) * 100)).toFixed(1)}%`);
    }
    document.body.classList.toggle('moment-on', m.t > 0);
    // A soft green glow round the screen edge while the lights are out and you are not looking up.
    m.edge.classList.toggle('is-on', active && !s.lookingUp && !s.busy);
  }

  statusLine(s) {
    const a = s.aurora, A = CONFIG.aurora;
    if (a.summer) return 'Midnight sun. The sky never gets dark enough for aurora in summer.';
    if (a.dark < A.minDarkness) return a.dark < 0.2 ? 'Too bright for now. Darkness comes after sunset.' : 'Getting darker. Give it a little longer.';
    if (a.active) {
      // Say what the substorm is doing, so waiting through a quiet arc makes sense.
      if (s.lookingUpWrongWay) return 'The lights are to the north. Turn around.';
      if (a.phase === 'breakup') return s.lookingUp ? 'Breakup! The whole sky is moving.' : 'Breakup! The aurora is bursting across the sky. Look up.';
      if (a.pulse > 0.5) return s.lookingUp ? 'Soft patches, pulsing on and off. Watch one.' : 'The display is fading into pulsing patches. Look up.';
      if (a.phase === 'growth') return s.lookingUp ? 'A quiet arc. It can break up any minute.' : 'A quiet arc low in the north. Look up, and wait.';
      return s.lookingUp ? 'Lights overhead. Stay with them.' : 'Aurora active now. Look up.';
    }
    if (a.kp >= A.minKp) {
      if (a.cloud > A.maxCloud) return 'Activity is up, but clouds are in the way. Drive toward clearer sky.';
      if (a.city.overhead > 0.3) return `Activity is up. Get away from the ${a.city.name} lights.`;
      if (a.moon?.bright > 0.45 && !a.active) return 'Activity is up, but the bright moon washes faint lights out. Wait for it to set, or for a stronger display.';
      return 'Activity is building. Watch the sky.';
    }
    if (a.phase === 'growth' && a.promising) {
      if (a.cloud > A.maxCloud) return 'A substorm is building, but clouds are in the way. Find clearer sky.';
      return 'A faint arc is forming in the north. Stay put: it often breaks up within the hour.';
    }
    if (s.nextWindow) return `Quiet for now. The radio expects activity around ${s.nextWindow}.`;
    return 'Quiet for now. Keep driving and check back.';
  }

  drawGraph(s) {
    const mono = !document.body.classList.contains('has-touch'); // no green on a computer's screen
    const c = this.g, W = this.el.graph.width, H = this.el.graph.height;
    const padL = 34, padB = 28, padT = 10, padR = 10;
    c.clearRect(0, 0, W, H);
    const x0 = s.nightStart, x1 = s.nightStart + 18; // 16:00 to 10:00
    const X = (h) => padL + ((h - x0) / (x1 - x0)) * (W - padL - padR);
    const Y = (kp) => padT + (1 - kp / 9) * (H - padT - padB);
    c.font = '20px "Saira", system-ui, sans-serif';
    c.fillStyle = 'rgba(169,180,189,0.8)';
    c.strokeStyle = 'rgba(169,180,189,0.18)';
    c.lineWidth = 1;
    [0, 3, 6, 9].forEach((k) => { c.beginPath(); c.moveTo(padL, Y(k)); c.lineTo(W - padR, Y(k)); c.stroke(); c.fillText(String(k), 8, Y(k) + 7); });
    [[2, '18:00'], [8, '00:00'], [14, '06:00']].forEach(([o, label]) => { c.fillText(label, X(x0 + o) - 26, H - 6); });
    // Threshold line.
    c.setLineDash([6, 6]);
    c.strokeStyle = mono ? 'rgba(255,255,255,0.3)' : 'rgba(92,242,160,0.35)';
    c.beginPath(); c.moveTo(padL, Y(CONFIG.aurora.minKp)); c.lineTo(W - padR, Y(CONFIG.aurora.minKp)); c.stroke();
    c.setLineDash([]);
    // Forecast ahead.
    c.strokeStyle = 'rgba(231,236,239,0.55)';
    c.lineWidth = 2.5;
    c.setLineDash([8, 7]);
    c.beginPath();
    let started = false;
    for (let h = Math.max(x0, s.now); h <= x1; h += 0.15) {
      const k = s.predict(h);
      if (!started) { c.moveTo(X(h), Y(k)); started = true; } else c.lineTo(X(h), Y(k));
    }
    c.stroke();
    c.setLineDash([]);
    // What actually happened tonight.
    const hist = s.history || [];
    c.strokeStyle = mono ? '#f3f5f6' : '#66dfb0';
    c.lineWidth = 3;
    c.beginPath();
    hist.forEach((p, i) => (i ? c.lineTo(X(p.h), Y(p.kp)) : c.moveTo(X(p.h), Y(p.kp))));
    c.stroke();
    // Now marker.
    if (s.now >= x0 && s.now <= x1) {
      c.strokeStyle = 'rgba(231,236,239,0.8)';
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(X(s.now), padT); c.lineTo(X(s.now), H - padB); c.stroke();
      c.fillStyle = '#e7ecef';
      c.beginPath(); c.arc(X(s.now), Y(s.aurora.kp), 5, 0, Math.PI * 2); c.fill();
    }
  }
}
