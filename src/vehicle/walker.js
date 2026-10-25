import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { groundAt as heightAt, waterLevelAt } from '../world/terrain.js';
import { solidStep } from '../world/solids.js';
import { lerp } from '../world/noise.js';

// An articulated person: hips, torso, head with a hood, upper and lower arms, thighs and
// shins with knees, boots and a backpack. Smooth capsules, no flat polygons.
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
    this.root.visible = false;
    scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.phase = 0;
    this.speedSmooth = 0;
    this.sitting = false;
  }

  enter(fromJeep) {
    const side = fromJeep.heading + Math.PI / 2;
    this.pos.set(fromJeep.pos.x + Math.sin(side) * 2.6, 0, fromJeep.pos.z + Math.cos(side) * 2.6);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.heading = fromJeep.heading;
    this.root.visible = true;
  }
  exit() { this.root.visible = false; this.setSitting(false); }

  setSitting(on) { this.sitting = !!on; }

  update(dt, input, anchor) {
    const V = CONFIG.vehicle;
    const t = this.sitting ? 0 : input.throttle, s = this.sitting ? 0 : input.steer;
    this.heading += s * 2.4 * dt;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const speed = t * V.walkSpeed * (t < 0 ? 0.5 : 1);
    const nx = this.pos.x + fx * speed * dt, nz = this.pos.z + fz * speed * dt;
    const tooFar = Math.hypot(nx - anchor.x, nz - anchor.z) > V.walkRadius;
    const tooDeep = heightAt(nx, nz) < waterLevelAt(nx, nz) - 0.6;
    // A rock face too steep to step up is a wall; gentle slopes are walked up.
    const tooSteep = solidStep(nx, nz, this.pos.y, 0.45 + Math.abs(speed) * dt * 1.2);
    this.blocked = tooFar ? 'far' : tooDeep ? 'deep' : '';
    if (!tooFar && !tooDeep && !tooSteep) { this.pos.x = nx; this.pos.z = nz; }
    this.pos.y = lerp(this.pos.y || heightAt(this.pos.x, this.pos.z), heightAt(this.pos.x, this.pos.z), Math.min(1, dt * 12));
    this.speedSmooth = lerp(this.speedSmooth, Math.abs(speed), Math.min(1, dt * 8));
    this.animate(dt, Math.sign(speed) || 1);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
  }

  animate(dt, dir) {
    const now = performance.now() * 0.001;
    const k = Math.min(1, dt * 6);
    if (this.sitting) {
      // On the ground, legs out, hands resting on knees, looking up a little.
      this.hips.position.y = lerp(this.hips.position.y, 0.3, k);
      for (const l of this.legs) { l.hp.rotation.x = lerp(l.hp.rotation.x, -1.3, k); l.kn.rotation.x = lerp(l.kn.rotation.x, 0.9, k); }
      for (const a of this.arms) { a.sh.rotation.x = lerp(a.sh.rotation.x, -0.9, k); a.el.rotation.x = lerp(a.el.rotation.x, -0.4, k); }
      this.torso.rotation.x = lerp(this.torso.rotation.x, -0.12, k);
      this.head.rotation.x = lerp(this.head.rotation.x, -0.3, k);
      return;
    }
    const w = Math.min(1, this.speedSmooth / 2.5);
    this.phase += this.speedSmooth * dt * 2.6 * dir;
    const sw = Math.sin(this.phase), cw = Math.cos(this.phase);
    const idle = Math.sin(now * 1.8) * 0.02;
    this.hips.position.y = lerp(this.hips.position.y, 0.92 + Math.abs(cw) * 0.035 * w + idle, k);
    this.hips.rotation.y = sw * 0.08 * w;
    this.torso.rotation.x = lerp(this.torso.rotation.x, 0.06 * w, k);
    this.head.rotation.x = lerp(this.head.rotation.x, 0, k);
    const kk = Math.min(1, dt * 10);
    for (const l of this.legs) {
      const ph = this.phase + (l.side > 0 ? 0 : Math.PI);
      l.hp.rotation.x = lerp(l.hp.rotation.x, Math.sin(ph) * 0.65 * w, kk);
      // The knee bends while the leg swings forward and straightens as it lands.
      l.kn.rotation.x = lerp(l.kn.rotation.x, Math.max(0, Math.cos(ph)) * 0.9 * w + 0.05, kk);
    }
    for (const a of this.arms) {
      const ph = this.phase + (a.side > 0 ? Math.PI : 0);
      a.sh.rotation.x = lerp(a.sh.rotation.x, Math.sin(ph) * 0.5 * w, kk);
      a.sh.rotation.z = a.side * 0.14;
      a.el.rotation.x = lerp(a.el.rotation.x, -0.35 - Math.max(0, Math.sin(ph)) * 0.4 * w, kk);
    }
  }
}
