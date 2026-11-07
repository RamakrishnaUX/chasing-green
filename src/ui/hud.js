import { CONFIG } from '../config.js';
import { haptics } from './haptics.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), speed: $('speed'), alt: $('alt'), where: $('where'), clock: $('clock'), kp: $('kp'), kpWrap: $('kp').parentElement,
      status: $('radio-status'), graph: $('radio-graph'), cloud: $('stat-cloud'), activity: $('stat-activity'), dark: $('stat-dark'), glow: $('stat-glow'),
      rose: $('compass-rose'), wind: $('wind-arrow'), toast: $('toast'),
      radio: $('radio'), radioToggle: $('radio-toggle'), kpLevel: $('kp-level'), skyHint: $('sky-hint'), look: $('t-look'),
    };
    this.g = this.el.graph.getContext('2d');
    this.graphTimer = 0;
    this.toastTimer = 0;
    this.toastPriority = 0;
    this.lastStatus = '';
    this.hx = Object.fromEntries(['tape', 'kick', 'place', 'next', 'clock', 'day', 'gear', 'fuel', 'fuelbar', 'fuelside', 'speed', 'unit', 'nitro-l', 'nitro-r', 'kp', 'kpbar'].map((k) => [k, $(`hx-${k}`)]));
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
  }

  show() { this.el.hud.hidden = false; }

  toast(text, { seconds = 4, priority = 1, action } = {}) {
    if (this.toastTimer > 0 && priority < this.toastPriority) return;
    const t = this.el.toast;
    t.textContent = text;
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
    this.toastTimer = seconds;
    this.toastPriority = priority;
  }

  update(dt, s) {
    const e = this.el;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) { e.toast.classList.remove('is-on'); e.toast.style.pointerEvents = 'none'; this.toastPriority = 0; }
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
    document.body.classList.toggle('sky-on', callUp);
    if (callUp && !this.wasCall) haptics.play('aurora', 0);
    this.wasCall = callUp;
    this.moment(dt, s, kp);
    this.drive(s, kp);
    e.cloud.textContent = `${Math.round(s.aurora.cloud * 100)}%`;
    e.dark.textContent = `${Math.round(s.aurora.dark * 100)}%`;
    const glow = s.aurora.city.overhead;
    e.glow.textContent = glow > 0.6 ? 'Strong' : glow > 0.25 ? 'Some' : glow > 0.05 ? 'Faint' : 'None';
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

  // The driving display: only drawn when it shows (computers), and only what changed.
  drive(s, kp) {
    const h = this.hx;
    if (!h.tape || !h.tape.closest('.hx').offsetParent) return;
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
    // The band's height and its slope (smoothed through the bends), so a cut on the incline keeps
    // the same angle to the band as it has on the flat.
    const slope = (x) => (mid(x + 14) - mid(x - 14)) / 28;
    const mid = (x) => x <= 232 || x >= 468 ? 67 : x >= 286 && x <= 414 ? 107 : x < 286 ? 67 + (x - 232) / 54 * 40 : 107 - (x - 414) / 54 * 40;
    const cut = (x, k) => {
      const t = Math.atan(slope(x)), c = Math.cos(t), sn = Math.sin(t), vx = k * c - sn, vy = k * sn + c;
      return (y) => (x + (vx / vy) * (y - mid(x))).toFixed(1);
    };
    const PARTS = { 'hx-fuelbar': [300, 24, -0.6], 'hx-nitro-l': [350, 300, -0.6, 0], 'hx-nitro-r': [350, 400, 0.6, 0], 'hx-kpbar': [400, 676, 0.6] };
    const dash = (el, f) => {
      f = Math.max(0, Math.min(1, f));
      if (el.dataset.f === f.toFixed(3)) return;
      el.dataset.f = f.toFixed(3);
      el.style.visibility = f < 0.005 ? 'hidden' : '';
      const poly0 = el._poly ??= document.querySelector(`${el.getAttribute('clip-path').slice(4, -1)} polygon`);
      // Nitro: one piece in the dip, widening from the centre to both sides, each side at its slant.
      if (el.id === 'hx-nitro-l') {
        const w = 10 + 40 * f, L = (y) => (350 - w - 0.6 * (y - 107)).toFixed(1), R = (y) => (350 + w + 0.6 * (y - 107)).toFixed(1);
        poly0.setAttribute('points', `${L(-20)},-20 ${R(-20)},-20 ${R(150)},150 ${L(150)},150`);
        return;
      }
      const [from, to, k, kFrom = k] = PARTS[el.id], lead = from + (to - from) * f;
      const a = cut(from, kFrom), b = cut(lead, k);
      const poly = el._poly ??= document.querySelector(`${el.getAttribute('clip-path').slice(4, -1)} polygon`);
      poly.setAttribute('points', `${a(-20)},-20 ${b(-20)},-20 ${b(150)},150 ${a(150)},150`);
    };
    const nb = (s.nitro || 0) * ramp(1.5, 0.9);
    dash(h['nitro-l'], nb); h['nitro-r'].style.display = 'none';
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
    c.strokeStyle = 'rgba(92,242,160,0.35)';
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
    c.strokeStyle = '#66dfb0';
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
