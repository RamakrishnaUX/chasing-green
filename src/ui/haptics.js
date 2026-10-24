// Small taps you can feel. Android browsers use the Vibration API. iPhone Safari has no such
// API, but since iOS 18 toggling a native switch control gives a system tick, so on iPhone we
// flip a hidden switch.
//
// iPhone care: Safari withholds a tap's click if the page changes while the finger lands, and
// flipping the switch counts as a change. So on iPhone the switch is built once at load and is
// only ever flipped while a click is being handled, after the tap has already gone through.
// iPhones therefore feel taps on buttons, but not knocks or nitro, which happen on their own.

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
  // A knock scaled by how hard it was.
  impact(strength) {
    if (strength > 14) this.play('thud', 120);
    else if (strength > 7) this.play('heavy', 90);
    else if (strength > 2.5) this.play('medium', 90);
  },
};
