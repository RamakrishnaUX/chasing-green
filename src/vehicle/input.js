// Collects keyboard, on-screen touch buttons and pointer drag into one simple state object.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false };
    this.look = { dx: 0, dy: 0 };
    this.pressed = new Set(); // one-shot keys for this frame
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this.keys.clear(); Object.keys(this.touch).forEach((k) => (this.touch[k] = false)); });

    // Drag on the canvas to look around (mouse or a finger that is not on a button).
    let dragId = null, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => { dragId = e.pointerId; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      this.look.dx += e.clientX - lx; this.look.dy += e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === dragId) dragId = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  bindTouchButton(el, name) {
    const on = (e) => { e.preventDefault(); this.touch[name] = true; el.classList.add('is-down'); };
    const off = (e) => { e.preventDefault(); this.touch[name] = false; el.classList.remove('is-down'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get throttle() {
    if (!this.enabled) return 0;
    const k = this.keys;
    let t = 0;
    if (k.has('w') || k.has('arrowup') || this.touch.gas) t += 1;
    if (k.has('s') || k.has('arrowdown') || this.touch.brake) t -= 1;
    return t;
  }
  get steer() {
    if (!this.enabled) return 0;
    const k = this.keys;
    let s = 0;
    if (k.has('a') || k.has('arrowleft') || this.touch.left) s += 1;
    if (k.has('d') || k.has('arrowright') || this.touch.right) s -= 1;
    return s;
  }
  get handbrake() { return this.enabled && this.keys.has('shift'); }
  get nitro() { return this.enabled && this.nitroAllowed && (this.keys.has(' ') || this.touch.nitro); }

  consumeLook() { const l = { ...this.look }; this.look.dx = 0; this.look.dy = 0; return l; }
  wasPressed(k) { return this.enabled && this.pressed.has(k); }
  endFrame() { this.pressed.clear(); }
}
