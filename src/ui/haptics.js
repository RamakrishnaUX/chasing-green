// Small taps you can feel. Android browsers use the Vibration API. iPhone Safari has no such
// API, but since iOS 18 toggling a native switch control gives a system tick, so on iPhone we
// flip a hidden switch. iOS only lets that happen during a touch, so iPhones feel button
// presses but not knocks that happen later on their own.

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let iosLabel = null;
function iosTick() {
  if (!iosLabel) {
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
  }
  iosLabel.click();
}

// Strength names map to vibration lengths in milliseconds (or on/off patterns).
const PATTERNS = {
  select: 6,
  light: 10,
  medium: 18,
  heavy: 32,
  success: [12, 60, 18],
  warning: [24, 50, 24],
  thud: [40, 30, 16],
  aurora: [10, 80, 14, 80, 22],
};

let last = 0;
export const haptics = {
  enabled: true,
  supported: canVibrate || isIOS,
  // Fire a named pattern. minGap stops a stream of events from turning into a buzz.
  play(name = 'light', minGap = 40) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - last < minGap) return;
    last = now;
    const p = PATTERNS[name] ?? name;
    if (canVibrate) { try { navigator.vibrate(p); } catch { /* blocked until the first touch */ } }
    else if (isIOS) { try { iosTick(); } catch { /* not supported on this iOS version */ } }
  },
  // A knock scaled by how hard it was.
  impact(strength) {
    if (strength > 14) this.play('thud', 120);
    else if (strength > 7) this.play('heavy', 90);
    else if (strength > 2.5) this.play('medium', 90);
  },
};
