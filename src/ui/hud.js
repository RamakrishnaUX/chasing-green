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
