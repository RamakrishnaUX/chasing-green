// Photo mode: the game holds still, the HUD steps aside and the camera is yours. Drag to look,
// WASD (or the arrow pad on a phone) to move, Q and E to go down and up, scroll or pinch to
// zoom. Exposure brightens or darkens the shot, and focus and blur (where the picture runs
// through the effects pipeline) throw the background or foreground soft. Take postcard saves the
// frame to the Journey like any other sighting.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export class PhotoMode {
  // camera, renderer; canvas: the game canvas; getPost(): the effects pipeline or null;
  // groundAt(x, z): the camera is kept just above it; onShot(): take the postcard;
  // onChange(on): photo mode opened or closed.
  constructor({ camera, renderer, canvas, getPost, groundAt, onShot, onChange }) {
    Object.assign(this, { camera, renderer, canvas, getPost, groundAt, onShot, onChange });
    this.on = false; this.keys = new Set(); this.pad = new Set(); this.ptrs = new Map();
    this.el = $('photo');
    this.yaw = 0; this.pitch = 0; this.fov = 60; this.ev = 0;
    const bind = (id, fn) => $(id)?.addEventListener('input', (e) => fn(+e.target.value));
    bind('ph-ev', (v) => { this.ev = v; this.applyLook(); });
    bind('ph-fov', (v) => { this.fov = v; this.camera.fov = v; this.camera.updateProjectionMatrix(); });
    bind('ph-focus', () => this.applyFocus());
    bind('ph-blur', () => this.applyFocus());
    $('ph-close')?.addEventListener('click', () => this.close());
    $('ph-shot')?.addEventListener('click', () => this.shot());
    // The move pad: held buttons move the camera like the keys.
    for (const b of this.el?.querySelectorAll('[data-move]') || []) {
      const k = b.dataset.move;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pad.add(k); b.setPointerCapture?.(e.pointerId); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => this.pad.delete(k));
    }
    // Keys go to photo mode only while it is open (capture phase, so the game never sees them).
    const keyOf = (e) => e.key.toLowerCase();
    addEventListener('keydown', (e) => {
      if (!this.on) return;
      const k = keyOf(e);
      if (k === 'escape' || k === 'o') { this.close(); }
      else if (k === 'enter' || k === 'p') this.shot();
      else this.keys.add(k);
      e.stopImmediatePropagation(); e.preventDefault();
    }, true);
    addEventListener('keyup', (e) => { if (!this.on) return; this.keys.delete(keyOf(e)); e.stopImmediatePropagation(); }, true);
    // Look by dragging, zoom with the wheel or a pinch.
    canvas.addEventListener('pointerdown', (e) => { if (!this.on) return; this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture?.(e.pointerId); }, true);
    canvas.addEventListener('pointermove', (e) => {
      if (!this.on || !this.ptrs.has(e.pointerId)) return;
      const p = this.ptrs.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (this.ptrs.size === 1) {
        const k = (this.fov / 60) * 0.0042;
        this.yaw -= dx * k; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.5, 1.5);
      } else if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.entries()], other = a[0] === e.pointerId ? b[1] : a[1];
        const before = Math.hypot(p.x - other.x, p.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        this.zoom(before - after);
      }
      p.x = e.clientX; p.y = e.clientY;
      e.stopImmediatePropagation();
    }, true);
    for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, (e) => this.ptrs.delete(e.pointerId), true);
    canvas.addEventListener('wheel', (e) => { if (!this.on) return; e.preventDefault(); this.zoom(e.deltaY * 0.6); }, { passive: false });
  }

  zoom(d) {
    this.fov = THREE.MathUtils.clamp(this.fov + d * 0.08, 15, 100);
    this.camera.fov = this.fov; this.camera.updateProjectionMatrix();
    const s = $('ph-fov'); if (s) s.value = String(Math.round(this.fov));
  }

  open() {
    if (this.on) return;
    this.on = true;
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
    this.saved = { fov: this.camera.fov, exposure: this.renderer.toneMappingExposure };
    this.fov = this.camera.fov; this.ev = 0;
    $('ph-fov').value = String(Math.round(this.fov)); $('ph-ev').value = '0'; $('ph-blur').value = '0';
    // Focus and blur need the effects pipeline (it is off on Low quality).
    this.el.classList.toggle('no-focus', !this.getPost()?.bokeh);
    this.el.hidden = false;
    document.body.classList.add('photo-on');
    this.applyLook(); this.applyFocus();
    this.onChange?.(true);
  }

  close() {
    if (!this.on) return;
    this.on = false; this.keys.clear(); this.pad.clear(); this.ptrs.clear();
    this.el.hidden = true;
    document.body.classList.remove('photo-on');
    this.camera.fov = this.saved.fov; this.camera.updateProjectionMatrix();
    this.renderer.toneMappingExposure = this.saved.exposure;
    const post = this.getPost(); if (post?.bokeh) post.bokeh.enabled = false;
    this.onChange?.(false);
  }

  applyLook() { this.renderer.toneMappingExposure = this.saved.exposure * Math.pow(2, this.ev); }

  applyFocus() {
    const post = this.getPost(), b = post?.bokeh;
    if (!b) return;
    const blur = +$('ph-blur').value, focus = +$('ph-focus').value;
    b.enabled = this.on && blur > 0.01;
    b.uniforms.focus.value = focus;
    b.uniforms.aperture.value = 0.00002 * blur * blur * 40;
    b.uniforms.maxblur.value = 0.012 * blur;
  }

  shot() {
    // The panel is drawn by the page, not into the picture, so the shot is just the view.
    this.onShot?.();
    this.el.classList.remove('is-shot'); void this.el.offsetWidth; this.el.classList.add('is-shot');
  }

  // Each frame while open: move and aim the camera.
  update(dt) {
    if (!this.on) return;
    const k = this.keys, p = this.pad, fast = k.has('shift') ? 4 : 1, v = 9 * fast * dt;
    const f = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const c = this.camera.position;
    if (k.has('w') || k.has('arrowup') || p.has('fwd')) c.addScaledVector(f, v);
    if (k.has('s') || k.has('arrowdown') || p.has('back')) c.addScaledVector(f, -v);
    if (k.has('d') || k.has('arrowright') || p.has('right')) c.addScaledVector(r, v);
    if (k.has('a') || k.has('arrowleft') || p.has('left')) c.addScaledVector(r, -v);
    if (k.has('e') || p.has('up')) c.y += v;
    if (k.has('q') || p.has('down')) c.y -= v;
    c.y = Math.max(c.y, this.groundAt(c.x, c.z) + 0.3);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }
}
