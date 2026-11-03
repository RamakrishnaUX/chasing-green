import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { groundAt as heightAt, waterLevelAt } from '../world/terrain.js';
import { lerp } from '../world/noise.js';
import { NitroFX } from './nitrofx.js';

// An articulated person: hips, torso, head with a hood, upper and lower arms, thighs and
// shins with knees, boots and a backpack. Smooth capsules, no flat polygons.
//
// On foot he walks, sprints on nitro (the backpack burns like the car's exhausts), climbs any
// rock face too steep to walk up (boulders, cliffs, stacks), drops off ledges, and walks round
// the car rather than through it.
const STEP = 0.25; // a ledge this high is stepped up; anything higher is climbed
const REACH = 0.35; // hands and toes to the rock, from the body's centre
const BODY = 0.3; // radius kept clear of the car
const CLIMB = 1.4; // metres a second up a face
const GRAVITY = 18;
const V_WALK = 4.2; // the walking pace; faster than this is a run
const N = { speed: 2.5, climb: 2.6, burn: 0.26, fill: 0.1 }; // nitro: sprint and climb boost, tank use per second
const mat = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
function cap(r, len, m, y = 0) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  g.translate(0, y, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

export class Walker {
  constructor(scene) {
    const jacket = mat(0xc9402f, 0.75), trousers = mat(0x2d3b48, 0.85), skin = mat(0xd9b79c, 0.6), hood = mat(0xb8362a, 0.8);
    const boot = mat(0x1d1a18, 0.9), pack = mat(0x3f5a3a, 0.9), glove = mat(0x1f2328, 0.85);

    this.root = new THREE.Group();
    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.root.add(this.hips);
    // Torso: pelvis and a jacket with a hood.
    this.hips.add(cap(0.17, 0.12, trousers, 0.02));
    this.torso = new THREE.Group();
    this.torso.position.y = 0.1;
    this.hips.add(this.torso);
    const chest = cap(0.2, 0.34, jacket, 0.36); chest.scale.z = 0.72; this.torso.add(chest);
    const neck = cap(0.06, 0.06, skin, 0.66); this.torso.add(neck);
    this.head = new THREE.Group();
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), skin); face.position.y = 0.1; face.castShadow = true; this.head.add(face);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hood); hd.position.set(0, 0.12, -0.02); hd.scale.z = 1.1; hd.castShadow = true; this.head.add(hd);
    // Backpack.
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.16), pack); bag.position.set(0, 0.36, -0.2); bag.castShadow = true; this.torso.add(bag);

    // Arms: shoulder joint, upper arm, elbow, forearm, glove.
    this.arms = [-1, 1].map((side) => {
      const sh = new THREE.Group(); sh.position.set(side * 0.26, 0.56, 0); this.torso.add(sh);
      sh.add(cap(0.065, 0.24, jacket, -0.14));
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      el.add(cap(0.055, 0.22, jacket, -0.13));
      el.add(cap(0.06, 0.04, glove, -0.3));
      return { sh, el, side };
    });
    // Legs: hip joint, thigh, knee, shin, boot.
    this.legs = [-1, 1].map((side) => {
      const hp = new THREE.Group(); hp.position.set(side * 0.11, 0, 0); this.hips.add(hp);
      hp.add(cap(0.085, 0.3, trousers, -0.18));
      const kn = new THREE.Group(); kn.position.y = -0.4; hp.add(kn);
      kn.add(cap(0.07, 0.3, trousers, -0.18));
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.27), boot); b.position.set(0, -0.44, 0.05); b.castShadow = true; kn.add(b);
      return { hp, kn, side };
    });
    // Nitro: twin flames from the foot of the backpack, angled back and down, with the car's
    // streaks and sparks. No light of its own: one appearing and vanishing with the walker
    // would recompile every lit material.
    const fx = new THREE.Group();
    fx.position.set(0, 0.24, -0.29);
    fx.rotation.x = -0.9;
    fx.scale.setScalar(0.45);
    this.torso.add(fx);
    this.nitroFx = new NitroFX(scene, fx, { light: false, trailWidth: 0.09, spark: 0.13, glow: 0.7 });
    this.nitroFx.place([0.21, 0, 0]);
    this.nitro = 1;
    this.boosting = false;
    this.root.visible = false;
    scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.phase = 0;
    this.climbPhase = 0;
    this.speedSmooth = 0;
    this.sitting = false;
    this.state = 'walk'; // walk, climb, mantle (pulling up over the top) or fall
    this.vy = 0;
    this.landed = 0;
  }

  enter(fromJeep) {
    const side = fromJeep.heading + Math.PI / 2;
    this.pos.set(fromJeep.pos.x + Math.sin(side) * 2.6, 0, fromJeep.pos.z + Math.cos(side) * 2.6);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.heading = fromJeep.heading;
    this.state = 'walk'; this.vy = 0; this.landed = 0;
    this.car = carBox(fromJeep);
    this.root.visible = true;
  }
  exit() {
    this.root.visible = false; this.setSitting(false);
    this.boosting = false;
    this.nitroFx.update(1, false, 0); // clear the streaks and sparks left in the air
  }

  setSitting(on) { this.sitting = !!on; }

  // The ground on foot: terrain, landforms, and any rock or cliff there to stand on.
  groundAt(x, z) { return Math.max(heightAt(x, z), this.obstacles ? this.obstacles.topAt(x, z) : -Infinity); }

  update(dt, input, car, obstacles) {
    const V = CONFIG.vehicle;
    this.obstacles = obstacles;
    const t = this.sitting ? 0 : input.throttle, s = this.sitting ? 0 : input.steer;
    // Nitro on foot: hold it while walking forward to sprint. A drained pack has to refill a
    // little before it lights again.
    this.boosting = !this.sitting && input.nitro && t > 0 && this.nitro > (this.boosting ? 0.02 : 0.15);
    this.nitro = this.boosting ? Math.max(0, this.nitro - dt * N.burn) : Math.min(1, this.nitro + dt * N.fill);
    // Hands on the rock: no turning until he is up or lets go.
    if (this.state !== 'climb') this.heading += s * 2.4 * dt;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let speed = t * V.walkSpeed * (t < 0 ? 0.5 : 1) * (this.boosting ? N.speed : 1);
    if (this.state === 'mantle') speed = 1.8;
    this.blocked = '';
    let moved = 0;

    if (this.state === 'climb') {
      // Up the face while pushing forward, hanging on while not, letting go when backing off.
      // The face is the highest rock between the body and arm's length.
      let face = -Infinity;
      for (const d of [0.05, 0.15, REACH]) face = Math.max(face, this.groundAt(this.pos.x + fx * d, this.pos.z + fz * d));
      if (face <= this.pos.y + 0.05) { this.state = 'mantle'; this.mantle = REACH + 0.2; }
      else if (t > 0) { const up = Math.min(face - this.pos.y, CLIMB * (this.boosting ? N.climb : 1) * dt); this.pos.y += up; moved = up; }
      else if (t < 0) { this.state = 'fall'; this.vy = 0; }
    } else {
      const step = Math.abs(speed) * dt;
      const nx = this.pos.x + fx * speed * dt, nz = this.pos.z + fz * speed * dt;
      const tooFar = Math.hypot(nx - car.pos.x, nz - car.pos.z) > V.walkRadius;
      const tooDeep = heightAt(nx, nz) < waterLevelAt(nx, nz) - 0.6;
      this.blocked = tooFar ? 'far' : tooDeep ? 'deep' : '';
      const g0 = this.groundAt(this.pos.x, this.pos.z), feet = Math.max(g0, this.pos.y);
      // A ledge higher than a step, or a slope steeper than about 50 degrees, is climbed: at
      // arm's length ahead (the same reach the climb uses to find the top), or where the next
      // step lands.
      const toe = speed > 0 ? this.groundAt(this.pos.x + fx * REACH, this.pos.z + fz * REACH) : -Infinity;
      const gN = this.groundAt(nx, nz);
      const face = toe - feet > STEP + REACH * 0.7 || gN - feet > STEP + step * 0.7;
      // In the air, a face in the way stops the drift rather than letting him into the rock.
      const wall = this.state === 'fall' ? gN > this.pos.y : face;
      if (face && this.state !== 'fall' && (t > 0 || this.state === 'mantle')) { this.state = 'climb'; this.mantle = 0; }
      else if (!tooFar && !tooDeep && !wall) { moved = step; this.pos.x = nx; this.pos.z = nz; }
      const g = this.groundAt(this.pos.x, this.pos.z);
      // Never more than a scramble upward in one frame, even if pushed onto something taller.
      const rise = (y) => Math.min(y, this.pos.y + 15 * dt);
      if (this.state === 'fall') {
        // Gravity, softened while the pack burns: a short glide.
        this.vy = Math.max(this.boosting ? -3 : -40, this.vy - GRAVITY * (this.boosting ? 0.25 : 1) * dt);
        this.pos.y += this.vy * dt;
        if (this.pos.y <= g) { this.landed = Math.min(1, -this.vy / 14); this.pos.y = g; this.vy = 0; this.state = 'walk'; }
      } else if (this.state === 'mantle') {
        if (g > this.pos.y) this.pos.y = rise(g);
        this.mantle -= moved;
        if (this.mantle <= 0) this.state = 'walk';
      } else if (this.state === 'walk') {
        // Off a ledge (the ground fell away much faster than a slope would): drop.
        if (g < this.pos.y - 0.6 && g < g0 - 0.15 - moved * 1.5) { this.state = 'fall'; this.vy = 0; }
        // On a slope the feet stay within a hand of it, smoothing only the small bumps.
        else { const s = lerp(this.pos.y, g, Math.min(1, dt * 14)); this.pos.y = g > this.pos.y ? rise(Math.max(g - 0.1, s)) : Math.min(s, g + 0.1); }
      }
    }
    this.keepClear(car);
    this.speedSmooth = lerp(this.speedSmooth, this.state === 'walk' ? Math.abs(speed) : 0, Math.min(1, dt * 8));
    this.climbPhase += this.state === 'climb' ? moved * 5 : 0;
    this.landed = Math.max(0, this.landed - dt * 3);
    this.animate(dt, Math.sign(speed) || 1);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this.nitroFx.update(dt, this.boosting, (this.state === 'walk' ? Math.abs(speed) : 4) * 3);
  }

  // The car is solid: walk round it, not into it.
  keepClear(car) {
    const b = this.car;
    if (!b || this.pos.y > car.pos.y + b.top) return;
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    const dx = this.pos.x - car.pos.x, dz = this.pos.z - car.pos.z;
    const lx = dx * c - dz * s - b.cx, lz = dx * s + dz * c - b.cz;
    const ex = b.hx + BODY, ez = b.hz + BODY;
    if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return;
    let ox = lx, oz = lz;
    if (ex - Math.abs(lx) < ez - Math.abs(lz)) ox = Math.sign(lx || 1) * ex; else oz = Math.sign(lz || 1) * ez;
    ox += b.cx; oz += b.cz;
    this.pos.x = car.pos.x + ox * c + oz * s;
    this.pos.z = car.pos.z - ox * s + oz * c;
  }

  animate(dt, dir) {
    const now = performance.now() * 0.001;
    const k = Math.min(1, dt * 6), kk = Math.min(1, dt * 10);
    const ease = (o, key, v, f = kk) => { o[key] = lerp(o[key], v, f); };
    if (this.sitting) {
      // On the ground, legs out, hands resting on knees, looking up a little.
      this.hips.position.y = lerp(this.hips.position.y, 0.3, k);
      for (const l of this.legs) { l.hp.rotation.x = lerp(l.hp.rotation.x, -1.3, k); l.kn.rotation.x = lerp(l.kn.rotation.x, 0.9, k); }
      for (const a of this.arms) { a.sh.rotation.x = lerp(a.sh.rotation.x, -0.9, k); a.el.rotation.x = lerp(a.el.rotation.x, -0.4, k); }
      this.torso.rotation.x = lerp(this.torso.rotation.x, -0.12, k);
      this.head.rotation.x = lerp(this.head.rotation.x, -0.3, k);
      return;
    }
    if (this.state === 'climb' || this.state === 'mantle') {
      // Hand over hand: one arm reaching high while the other pulls, knees driving up in turn.
      const cp = this.climbPhase, top = this.state === 'mantle';
      this.hips.position.y = lerp(this.hips.position.y, 0.92, k);
      this.hips.rotation.y = 0;
      ease(this.torso.rotation, 'x', top ? 0.55 : 0.22);
      ease(this.head.rotation, 'x', top ? 0.1 : -0.45);
      for (const a of this.arms) {
        const r = Math.sin(cp + (a.side > 0 ? 0 : Math.PI));
        ease(a.sh.rotation, 'x', top ? -1.0 : -2.5 - r * 0.4);
        ease(a.sh.rotation, 'z', a.side * 0.25);
        ease(a.el.rotation, 'x', top ? -0.2 : -0.5 + r * 0.45);
      }
      for (const l of this.legs) {
        const r = Math.sin(cp + (l.side > 0 ? Math.PI : 0));
        ease(l.hp.rotation, 'x', top ? -0.9 : -0.75 - r * 0.45);
        ease(l.kn.rotation, 'x', top ? 1.1 : 1.0 + r * 0.4);
      }
      return;
    }
    if (this.state === 'fall') {
      // Arms out for balance, knees ready for the landing.
      ease(this.hips.position, 'y', 0.92, k);
      ease(this.torso.rotation, 'x', 0.1);
      ease(this.head.rotation, 'x', 0.25);
      for (const a of this.arms) { ease(a.sh.rotation, 'x', -0.5); ease(a.sh.rotation, 'z', a.side * 1.25); ease(a.el.rotation, 'x', -0.3); }
      for (const l of this.legs) { ease(l.hp.rotation, 'x', l.side > 0 ? -0.6 : -0.2); ease(l.kn.rotation, 'x', l.side > 0 ? 0.9 : 0.4); }
      return;
    }
    const v = this.speedSmooth;
    const w = Math.min(1, v / 2.5);
    // Run: from a brisk walk up to the nitro sprint, a longer stride, a deeper lean and pumping arms.
    const run = Math.min(1, Math.max(0, (v - V_WALK) / 4.5));
    this.phase += (Math.min(v, V_WALK) * 2.6 + Math.max(0, v - V_WALK) * 0.9) * dt * dir;
    const sw = Math.sin(this.phase), cw = Math.cos(this.phase);
    const idle = Math.sin(now * 1.8) * 0.02;
    this.hips.position.y = lerp(this.hips.position.y, 0.92 + Math.abs(cw) * (0.035 + run * 0.06) * w + idle - this.landed * 0.3 - run * 0.05, k);
    this.hips.rotation.y = sw * (0.08 + run * 0.06) * w;
    this.torso.rotation.x = lerp(this.torso.rotation.x, 0.06 * w + run * 0.32 + this.landed * 0.4, k);
    this.head.rotation.x = lerp(this.head.rotation.x, -run * 0.22, k);
    for (const l of this.legs) {
      const ph = this.phase + (l.side > 0 ? 0 : Math.PI);
      ease(l.hp.rotation, 'x', Math.sin(ph) * (0.65 + run * 0.4) * w - run * 0.15 - this.landed * 0.6);
      // The knee bends while the leg swings forward and straightens as it lands.
      ease(l.kn.rotation, 'x', Math.max(0, Math.cos(ph)) * (0.9 + run * 0.9) * w + 0.05 + this.landed * 1.1);
    }
    for (const a of this.arms) {
      const ph = this.phase + (a.side > 0 ? Math.PI : 0);
      ease(a.sh.rotation, 'x', Math.sin(ph) * (0.5 + run * 0.35) * w);
      ease(a.sh.rotation, 'z', a.side * 0.14);
      ease(a.el.rotation, 'x', -0.35 - run * 0.9 - Math.max(0, Math.sin(ph)) * 0.4 * w);
    }
  }
}

// The car's body as a box in its own frame (x across, z along), measured from the model once
// when stepping out: { cx, cz, hx, hz, top }.
const _box = new THREE.Box3(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
function carBox(car) {
  car.root.updateMatrixWorld(true);
  _inv.copy(car.root.matrixWorld).invert();
  const b = new THREE.Box3();
  car.body.traverseVisible((m) => {
    if (!m.isMesh || !m.geometry || m.userData.noBox || m.material?.blending === THREE.AdditiveBlending) return;
    m.geometry.boundingBox || m.geometry.computeBoundingBox();
    b.union(_box.copy(m.geometry.boundingBox).applyMatrix4(_m.multiplyMatrices(_inv, m.matrixWorld)));
  });
  if (b.isEmpty()) return null;
  return { cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, hx: (b.max.x - b.min.x) / 2, hz: (b.max.z - b.min.z) / 2, top: b.max.y };
}
