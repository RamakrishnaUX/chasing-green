// Small taps you can feel. Android browsers use the Vibration API. iPhone Safari has no such
// API, but since iOS 18 toggling a native switch control gives a system tick, so on iPhone we
// flip a hidden switch.
//
// iPhone care: Safari withholds a tap's click if the page changes while the finger lands, and
// flipping the switch counts as a change. So on iPhone the switch is built once at load and is
// only ever flipped while a click is being handled, after the tap has already gone through.
// iPhones therefore feel taps on buttons; crashes and scrapes (which happen on their own) flip it
// too, while you drive with no menu open (no button is being tapped then). iOS 17.4 to 26.4 give a
// tick for that; later versions may only tick inside a tap, and then a crash is felt on Android
// alone.

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const isIOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

let iosLabel = null;
let inClick = false;
if (isIOS && typeof document !== 'undefined') {
  const build = () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = 'haptic-switch';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    iosLabel = document.createElement('label');
    iosLabel.htmlFor = input.id;
    iosLabel.setAttribute('aria-hidden', 'true');
    iosLabel.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;';
    iosLabel.append(input);
    document.body.append(iosLabel);
  };
  if (document.body) build(); else addEventListener('DOMContentLoaded', build);
  // Mark the span of every real click, so ticks only happen inside one.
  addEventListener('click', (e) => { if (e.isTrusted) { inClick = true; setTimeout(() => (inClick = false), 0); } }, true);
}

// Strength names map to vibration lengths in milliseconds (or on/off patterns).
// Phone vibration motors barely spin up under about 20 ms, so even the lightest tick is 20 ms.
const PATTERNS = {
  select: 20,
  light: 30,
  medium: 45,
  heavy: 70,
  success: [35, 70, 50],
  warning: [50, 60, 50],
  thud: [80, 40, 35],
  aurora: [30, 90, 40, 90, 70],
};

let last = 0;
export const haptics = {
  enabled: true,
  supported: canVibrate || isIOS,
  // Fire a named pattern. minGap stops a stream of events from turning into a buzz.
  play(name = 'light', minGap = 40) {
    if (!this.enabled) return;
    // Browsers refuse vibration before the first tap, and log an error if asked.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (isIOS && (!inClick || !iosLabel)) return;
    const now = performance.now();
    if (now - last < minGap) return;
    last = now;
    const p = PATTERNS[name] ?? name;
    if (canVibrate) { try { navigator.vibrate(p); } catch { /* blocked until the first touch */ } }
    else if (isIOS) { try { iosLabel.click(); } catch { /* not supported on this iOS version */ } }
  },
  // Feel a press: at the touch on Android, at the click on iPhone (see above).
  press(el, name = 'select') {
    el.addEventListener(isIOS ? 'click' : 'pointerdown', () => this.play(name, 0));
  },
  // A crash, scaled by how hard it was (closing speed, m/s); glass: a window broke too.
  // Android: one long jolt, a rebound and the rattle of things settling, longer and harder the
  // faster. iPhone: a run of ticks, closer together and more of them the harder it was.
  crash(speed, glass = false) {
    if (!this.enabled || speed < 2.5) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const s = Math.min(1, speed / 22), now = performance.now();
    if (now - last < 90) return;
    last = now;
    if (canVibrate) {
      const p = [Math.round(40 + 140 * s)];
      if (s > 0.25) p.push(Math.round(35 - 15 * s), Math.round(25 + 70 * s));
      if (s > 0.55) p.push(40, Math.round(20 + 40 * s), 60, 18);
      if (glass) p.push(30, 12, 40, 10);
      try { navigator.vibrate(p); } catch { /* blocked */ }
      this.rumbleUntil = now + p.reduce((a, b) => a + b, 0);
    } else if (isIOS && iosLabel && !document.querySelector('dialog[open]')) {
      const n = 1 + Math.round(s * 4) + (glass ? 1 : 0);
      for (let i = 0; i < n; i++) setTimeout(() => { try { iosLabel.click(); } catch { /* unsupported */ } }, i * (60 - s * 20));
    }
  },
  // A steady grind while scraping along something (level 0 to 1, each frame; 0 stops it).
  // Android pulses the motor, more of each beat on the harder the scrape; an iPhone ticks.
  rumble(level) {
    if (!this.enabled) return;
    const now = performance.now();
    if (level <= 0.05) { if (this.rumbling && canVibrate && now > (this.rumbleUntil || 0)) { try { navigator.vibrate(0); } catch { /* */ } } this.rumbling = false; return; }
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (now < (this.rumbleUntil || 0) || now - (this.rumbleAt || 0) < 110) return;
    this.rumbleAt = now; this.rumbling = true;
    if (canVibrate) {
      const on = Math.round(8 + 22 * level), off = Math.max(6, 30 - on);
      try { navigator.vibrate([on, off, on, off, on, off, on]); } catch { /* */ }
    } else if (isIOS && iosLabel && !document.querySelector('dialog[open]') && now - (this.tickAt || 0) > 140 - level * 60) {
      this.tickAt = now;
      try { iosLabel.click(); } catch { /* */ }
    }
  },
  // A knock scaled by how hard it was.
  impact(strength) {
    if (strength > 14) this.play('thud', 120);
    else if (strength > 7) this.play('heavy', 90);
    else if (strength > 2.5) this.play('medium', 90);
  },
};
