import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CONFIG } from '../config.js';
import { groundAt as heightAt, surfaceHeightAt, waterLevelAt } from '../world/terrain.js';
import { clamp, lerp, smoothstep } from '../world/noise.js';

// The person on foot: a man in a winter coat ("Man In Coat" by Saitam, CC BY 4.0, an Adobe Fuse
// character on a Mixamo rig) moved by Mixamo clips ("ETB Animated" by Royaleyourdad, CC BY 4.0;
// see tools/person): idle, walk, a walk backwards, run, a standing jump and kneeling.
//
// Forward walks; held on, he breaks into a run, and pressed again quickly (tapping it) he picks
// up the pace sooner. Shift keeps him walking. Space hops like a person does, he climbs any rock face
// too steep to walk up (boulders, cliffs, stacks), drops off ledges, and walks round the car
// rather than through it. The clips are blended by speed and played at the pace he moves, so
// the feet keep up with the ground; climbing reuses the jump's reach, hand over hand.
const STEP = 0.25; // a ledge this high is stepped up; anything higher is climbed
const REACH = 0.35; // hands and toes to the rock, from the body's centre
const BODY = 0.3; // radius kept clear of the car
const CLIMB = 1.4; // metres a second up a face
const GRAVITY = 18;
// Close to the clips' own paces, so the legs are sped up only a little.
const RUN = 4.2, WALK = 1.3, BACK = 1.0; // metres a second
// The clips' own paces, measured off the planted foot, where the feet do not slide; and where in
// each the left foot is furthest forward (a share of the clip), so walk and run keep step.
const RUN_PACE = 3.0, WALK_PACE = 1.06, BACK_PACE = 0.73;
const STEP_AT = { walk: 0.183, run: 0.2 };
// Forward held this long is a walk; then he speeds up to a run over the next RUN_BUILD seconds.
// Pressed again within TAP of letting go, the hold carries on and counts TAP_BOOST more.
const RUN_AFTER = 0.7, RUN_BUILD = 0.8, TAP = 0.4, TAP_BOOST = 0.45;
// The jump clip: a crouch, take-off at about a third of the way in, the top halfway, landing at
// about 0.62, then standing again. A hop plays from the end of the crouch to just after landing.
const JUMP = { from: 0.31, to: 0.74, speed: 1.3 };
const CLIPS = ['idle', 'walk', 'back', 'run', 'jump', 'kneel'];

export class Walker {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.climbPhase = 0;
    this.speedSmooth = 0;
    this.stride = 0; // where in a stride the walk and run are, from 0 to 1
    this.time = 0; this.held = 0; this.pushing = false; this.letGo = -1; this.fwd = 0; // the forward key's hold, and the pace it has built
    this.sitting = false;
    this.state = 'walk'; // walk, climb, mantle (pulling up over the top) or fall
    this.vy = 0;
    this.landed = 0;
    this.jumpT = -1; // seconds into a hop, or -1
    this.ready = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/person.glb`).then((g) => {
      const man = g.scene;
      man.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      this.root.add(man);
      this.man = man; man.visible = !this.sitting;
      this.mixer = new THREE.AnimationMixer(man);
      this.actions = {}; this.weights = {};
      for (const name of CLIPS) {
        const clip = g.animations.find((c) => c.name === name);
        if (!clip) continue;
        const a = this.mixer.clipAction(clip);
        a.play(); a.setEffectiveWeight(name === 'idle' ? 1 : 0);
        this.actions[name] = a; this.weights[name] = name === 'idle' ? 1 : 0;
      }
      this.jumpLen = this.actions.jump.getClip().duration;
    });
  }

  enter(fromJeep) {
    const side = fromJeep.heading + Math.PI / 2;
    this.pos.set(fromJeep.pos.x + Math.sin(side) * 2.6, 0, fromJeep.pos.z + Math.cos(side) * 2.6);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.heading = fromJeep.heading;
    this.state = 'walk'; this.vy = 0; this.landed = 0;
    this.held = 0; this.pushing = false; this.letGo = -1; this.fwd = 0;
    this.car = carBox(fromJeep);
    this.root.visible = true;
  }
  // On the ground after a parachute jump: standing where he landed, with no vehicle beside him.
  land(x, z, heading) {
    this.pos.set(x, this.groundAt(x, z), z);
    this.heading = heading;
    this.state = 'walk'; this.vy = 0; this.landed = 0;
    this.held = 0; this.pushing = false; this.letGo = -1; this.fwd = 0;
    this.car = null;
    this.root.visible = true;
  }
  // The vehicle he walks round (null for none), when it changes while he is on foot.
  setCar(vehicle) { this.car = vehicle ? carBox(vehicle) : null; }
  exit() { this.root.visible = false; this.setSitting(false); this.jumpT = -1; }

  // Sitting is seen through his own eyes, from inside his head: his body is hidden meanwhile, or
  // the camera would show the inside of his face.
  setSitting(on) { this.sitting = !!on; if (this.man) this.man.visible = !this.sitting; }

  // The ground on foot: terrain, landforms, and any rock or cliff there to stand on.
  groundAt(x, z) { return Math.max(heightAt(x, z), surfaceHeightAt(x, z), this.obstacles ? this.obstacles.topAt(x, z) : -Infinity); } // on a road, the tarmac drawn over the land

  update(dt, input, car, obstacles) {
    const radius = CONFIG.vehicle.walkRadius;
    this.obstacles = obstacles;
    const t = this.sitting ? 0 : input.throttle, s = this.sitting ? 0 : input.steer;
    // Space hops (on a touch screen, a slide up from Go): once per press, from the ground.
    const jumpKey = !!input.jump;
    if (jumpKey && !this.jumpHeld && this.jumpT < 0 && this.state === 'walk' && !this.sitting) { this.jumpT = 0; this.jumped = true; }
    this.jumpHeld = jumpKey;
    // Hands on the rock: no turning until he is up or lets go.
    if (this.state !== 'climb') this.heading += s * 2.4 * dt;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    // Forward: a walk, then a run once held a moment (sooner when tapped again quickly); a walk
    // with Shift held, and a slower step backwards. Letting go he keeps his pace for a moment (so
    // quick taps carry him on, building up to a run), then slows to a stop in a stride or two.
    this.time += dt;
    if (t > 0) {
      if (!this.pushing) { this.held = this.letGo >= 0 && this.time - this.letGo < TAP ? this.held + TAP_BOOST : 0; this.pushing = true; }
      this.held += dt;
    } else if (this.pushing) { this.pushing = false; this.letGo = this.time; }
    const run = input.walk ? 0 : smoothstep(RUN_AFTER, RUN_AFTER + RUN_BUILD, this.held);
    const coast = t === 0 && !this.sitting && this.time - this.letGo < TAP;
    const target = t > 0 ? t * lerp(WALK, RUN, run) : coast ? this.fwd : 0;
    this.fwd = target > this.fwd ? Math.min(target, this.fwd + 7 * dt) : Math.max(target, this.fwd - 9 * dt);
    let speed = t < 0 ? t * BACK : this.fwd;
    if (t < 0 || this.state === 'climb') this.fwd = 0;
    if (this.state === 'mantle') speed = 1.8;
    this.blocked = '';
    let moved = 0;

    if (this.state === 'climb') {
      // Up the face while pushing forward, hanging on while not, letting go when backing off.
      // The face is the highest rock between the body and arm's length.
      let face = -Infinity;
      for (const d of [0.05, 0.15, REACH]) face = Math.max(face, this.groundAt(this.pos.x + fx * d, this.pos.z + fz * d));
      if (face <= this.pos.y + 0.05) { this.state = 'mantle'; this.mantle = REACH + 0.2; }
      else if (t > 0) { const up = Math.min(face - this.pos.y, CLIMB * dt); this.pos.y += up; moved = up; }
      else if (t < 0) { this.state = 'fall'; this.vy = 0; }
    } else {
      const step = Math.abs(speed) * dt;
      const nx = this.pos.x + fx * speed * dt, nz = this.pos.z + fz * speed * dt;
      const tooFar = Math.hypot(nx - car.pos.x, nz - car.pos.z) > radius;
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
        this.vy = Math.max(-40, this.vy - GRAVITY * dt);
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
    this.climbPhase += this.state === 'climb' ? moved * 2.2 : 0;
    this.landed = Math.max(0, this.landed - dt * 3);
    if (this.jumpT >= 0) { this.jumpT += dt; if (this.state !== 'walk' || this.jumpT * JUMP.speed > (JUMP.to - JUMP.from) * (this.jumpLen || 2.37)) this.jumpT = -1; }
    this.animate(dt, Math.sign(speed) || 1);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
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

  // Each clip's weight eases towards what the moment wants, so changes blend rather than snap.
  // Moving, the walk and run are mixed by speed and played at his pace; the jump plays its
  // airborne part for a hop, and is held or rocked for a fall, a climb and a pull-up.
  animate(dt, dir) {
    if (!this.mixer) return;
    const want = { idle: 0, walk: 0, back: 0, run: 0, jump: 0, kneel: 0 };
    const A = this.actions, J = A.jump, len = this.jumpLen;
    J.paused = true;
    if (this.sitting) want.kneel = 1;
    else if (this.state === 'climb') {
      // Reaching up and pulling, rocking between the two reaches of the jump.
      want.jump = 1;
      J.time = len * (0.4 + 0.12 * (0.5 - 0.5 * Math.cos(this.climbPhase)));
    } else if (this.state === 'mantle') { want.jump = 1; J.time = len * 0.6; }
    else if (this.state === 'fall') { want.jump = 1; J.time = len * 0.47; }
    else if (this.jumpT >= 0) { want.jump = 1; J.time = len * JUMP.from + this.jumpT * JUMP.speed; }
    else {
      const v = this.speedSmooth;
      if (dir < 0) want.back = clamp(v / 0.4, 0, 1);
      else if (v >= 1.9) { want.run = clamp((v - 1.9) / 1.5, 0, 1); want.walk = 1 - want.run; }
      else if (v >= 0.1) want.walk = clamp(v / 0.5, 0, 1);
      // Standing: the pack's idle is a nervous crouch, so it is mostly the relaxed stance from
      // the jump's first frame, with a little of the idle for breathing and shifting weight.
      const rest = 1 - want.walk - want.run;
      want.idle = rest * 0.2; want.jump = rest * 0.8; J.time = len * 0.04;
      // Walk and run share one stride, as far along as the ground covered, so their feet agree
      // while they blend and never slide.
      const wd = A.walk.getClip().duration, rd = A.run.getClip().duration;
      if (dir > 0) this.stride = (this.stride + v * dt / lerp(WALK_PACE * wd, RUN_PACE * rd, want.run)) % 1;
      A.walk.timeScale = 0; A.run.timeScale = 0;
      A.walk.time = ((this.stride + STEP_AT.walk) % 1) * wd;
      A.run.time = ((this.stride + STEP_AT.run) % 1) * rd;
      if (A.back) A.back.timeScale = v / BACK_PACE;
    }
    const k = Math.min(1, dt * (this.jumpT >= 0 ? 14 : 8));
    for (const name of CLIPS) {
      if (!A[name]) continue;
      this.weights[name] = lerp(this.weights[name], want[name], k);
      A[name].setEffectiveWeight(this.weights[name]);
    }
    this.mixer.update(dt);
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
