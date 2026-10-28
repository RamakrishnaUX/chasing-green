// "Drive there": a route on both maps, a chip that points the way and counts down the distance,
// and a column of light over the destination that shows from far off.
import * as THREE from 'three';
import { planRoute } from '../world/route.js';
import { heightAt } from '../world/terrain.js';

const $ = (id) => document.getElementById(id);
const ARRIVE = 30; // metres from the destination that count as there

export function formatDistance(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

// A slim, faint pillar of light: brightest at the ground, gone by about 60 m up. Drawn without fog
// so it still reads through haze, and only a little wider far away so it never vanishes.
function makeBeacon() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, alphaMap: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const group = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 70, 16, 1, true), mat(0x4da3ff, 0.22));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 70, 8, 1, true), mat(0xd8ecff, 0.4));
  for (const m of [outer, core]) { m.position.y = 35; m.frustumCulled = false; group.add(m); }
  group.visible = false;
  group.userData.outer = outer.material;
  return group;
}

export class Nav {
  constructor(scene, { onArrive, onStop } = {}) {
    this.route = null;
    this.dest = null;
    this.onArrive = onArrive;
    this.onStop = onStop;
    this.el = $('nav');
    this.arrow = $('nav-arrow');
    this.nameEl = $('nav-name');
    this.distEl = $('nav-dist');
    $('nav-stop').addEventListener('click', () => this.stop(true));
    this.beacon = makeBeacon();
    scene.add(this.beacon);
  }

  get active() { return !!this.route; }

  start(dest, from) {
    this.dest = dest;
    this.plan(from);
    this.beacon.position.set(dest.x, heightAt(dest.x, dest.z), dest.z);
    this.beacon.visible = true;
    this.nameEl.textContent = dest.label;
    this.distText = '';
    this.el.hidden = false;
    document.body.classList.add('nav-on');
  }

  plan(from) {
    this.route = planRoute(from, this.dest);
    const p = this.route.pts;
    this.cum = [0];
    for (let i = 1; i < p.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
    this.idx = 0;
    this.offTime = 0;
  }

  stop(byUser = false) {
    if (!this.route) return;
    const dest = this.dest;
    this.route = null;
    this.dest = null;
    this.beacon.visible = false;
    this.el.hidden = true;
    document.body.classList.remove('nav-on');
    this.onStop?.(dest, byUser);
  }

  update(dt, pos, heading, t) {
    if (!this.route) return;
    const p = this.route.pts, cum = this.cum, dest = this.dest;
    const toDest = Math.hypot(dest.x - pos.x, dest.z - pos.z);
    if (toDest < ARRIVE) { const d = dest; this.stop(false); this.onArrive?.(d); return; }
    // Progress: the nearest route point a little behind to well ahead of the last one.
    let best = this.idx, bd = Infinity;
    for (let i = Math.max(0, this.idx - 3); i < Math.min(p.length, this.idx + 40); i++) {
      const d = Math.hypot(p[i].x - pos.x, p[i].z - pos.z);
      if (d < bd) { bd = d; best = i; }
    }
    this.idx = best;
    // Off the route for a couple of seconds: plan again from here.
    if (bd > 120) { this.offTime += dt; if (this.offTime > 2) { this.plan(pos); return; } } else this.offTime = 0;
    // Point at a spot about 45 m further along the route, so the arrow leads into bends.
    let aim = p[p.length - 1];
    for (let i = best; i < p.length; i++) if (cum[i] - cum[best] > 45) { aim = p[i]; break; }
    const rel = Math.atan2(aim.x - pos.x, aim.z - pos.z) - heading;
    this.arrow.style.transform = `rotate(${-rel}rad)`;
    const text = formatDistance(Math.max(toDest, bd + cum[cum.length - 1] - cum[best]));
    if (text !== this.distText) { this.distText = text; this.distEl.textContent = text; }
    // The beacon breathes gently and widens a little with distance so it stays findable.
    const w = Math.min(3, Math.max(1, toDest / 500));
    this.beacon.scale.set(w, 1, w);
    this.beacon.userData.outer.opacity = 0.2 + Math.sin(t * 1.6) * 0.04;
  }
}
