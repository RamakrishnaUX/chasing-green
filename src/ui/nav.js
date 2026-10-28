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

// A tall soft column: bright at the ground, fading to nothing at the top. Drawn without fog so
// it reads through haze, and widened with distance so it never shrinks to a hairline.
function makeBeacon() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, alphaMap: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const group = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 240, 24, 1, true), mat(0x4da3ff, 0.55));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 240, 12, 1, true), mat(0xd8ecff, 0.9));
  for (const m of [outer, core]) { m.position.y = 120; m.frustumCulled = false; group.add(m); }
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
    // The beacon breathes, and widens with distance so it stays visible.
    this.beacon.scale.set(Math.max(1, toDest / 260), 1, Math.max(1, toDest / 260));
    this.beacon.userData.outer.opacity = 0.45 + Math.sin(t * 2.4) * 0.12;
  }
}
