import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { groundAt as heightAt, surfaceAt, roadDistAt, shoreDistAt, exposureAt, waterLevelAt, bridgeGuard, BOUNDS } from '../world/terrain.js';
import { clamp, lerp } from '../world/noise.js';
import { buildVehicleModel } from './models.js';
import { VEHICLES, SURFACE_DRAG } from './specs.js';
import { NitroFX } from './nitrofx.js';
import { bakeStatic } from '../world/bake.js';
import { solidStep, solidTopAt } from '../world/solids.js';
import { buildInterior } from './interiors.js';
import { HD, weatherCar, carGround } from '../world/hd.js';
import { buildBoatKit, stages } from './boat.js';

// The player's car. Kept under the old name so the rest of the game needs no changes;
// setType() swaps between the Jeep, the vintage roadster and the race car.
export class Jeep {
  constructor(scene, kind = 'jeep') {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    // Headlights like a real car: a long, tight beam that throws far down the road, and a wide,
    // soft beam that spreads across the lane, the verges and the near ground.
    this.headlight = new THREE.SpotLight(0xfff3dc, 0, 260, 0.36, 0.55, 1.0);
    this.headlight.target.position.set(0, -2.6, 60);
    this.spread = new THREE.SpotLight(0xffeed2, 0, 75, 0.95, 0.9, 1.1);
    this.spread.target.position.set(0, -1.6, 16);
    this.root.add(this.headlight, this.headlight.target, this.spread, this.spread.target);
    // Nitro: glowing twin exhausts with streaks and sparks.
    this.nitroFx = new NitroFX(scene, this.root);

    // Soft contact shadow under the car, so it sits on the ground even outside the shadow map.
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const gx = c.getContext('2d'); const grad = gx.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.45)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    gx.fillStyle = grad; gx.fillRect(0, 0, 64, 64);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -8 }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    scene.add(this.blob);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.vF = 0;
    this.vL = 0;
    this.surface = 'paved';
    this.steerVis = 0;
    this.roll = 0; this.pitch = 0;
    this.nitro = 1;
    this.boosting = false;
    this.depth = 0;
    this.impact = 0;
    this.braking = 0;
    this.obstacles = null;
    // Boat mode: boatOn is where it is heading, boat how far the change has got (0 car, 1 boat).
    this.boat = 0; this.boatOn = false; this.boatEvent = null; this.bobT = 0;
    this.setType(kind);
  }

  setType(kind) {
    if (!VEHICLES[kind]) kind = 'jeep';
    if (this.model) {
      this.root.remove(this.model.group);
      this.model.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    }
    this.kind = kind;
    this.spec = VEHICLES[kind];
    this.model = buildVehicleModel(kind);
    if (HD.on) weatherCar(this.model.group);
    this.kit = buildBoatKit(this.model);
    // Wheels turn and steer; the rest of the body is merged into a few meshes.
    for (const w of this.model.wheels) w.pivot.userData.dynamic = true;
    bakeStatic(this.model.group);
    this.body = this.model.group;
    // The cockpit: built once per car, merged except for the parts that move.
    this.interior = buildInterior(kind, this.model);
    for (const n of Object.values(this.interior.needles)) n.userData.dynamic = true;
    if (this.interior.steer) this.interior.steer.userData.dynamic = true;
    bakeStatic(this.interior.group);
    this.body.add(this.interior.group);
    this.glass = [];
    this.body.traverse((o) => { const m = o.material; if (m?.userData?.glass && !this.glass.includes(m)) { m.userData.opacity ??= m.opacity; this.glass.push(m); } });
    this.setView(this.view || 'chase');
    this.wheels = this.model.wheels;
    this.lightMat = this.model.lightMat;
    this.tailMat = this.model.tailMat;
    this.root.add(this.body);
    this.headlight.position.set(...this.model.headlight);
    this.spread.position.set(...this.model.headlight);
    this.nitroFx.place(this.model.exhaust);
    this.vF = 0; this.vL = 0;
    this.kit.apply(this.boat);
    if (this.pos) this.sync(0);
  }

  // chase, hood or cockpit. Open cars always show their cockpit; closed ones only from inside,
  // where their tinted glass is lightened so the road is not seen through near-black panes.
  setView(view) {
    this.view = view;
    if (!this.interior) return;
    const inside = view === 'cockpit';
    this.interior.group.visible = inside || !this.interior.closed;
    for (const m of this.glass) m.opacity = inside ? 0.12 : m.userData.opacity;
  }

  place(x, z, heading) {
    this.air = false; this.vy = 0; this.vyPrev = 0; this.lastGround = null; this.lastSyncY = null; this.groundVy = 0;
    this.pos.set(x, heightAt(x, z), z);
    this.heading = heading;
    this.vF = 0; this.vL = 0;
    this.boat = 0; this.boatOn = false; this.kit.apply(0);
    this.sync(0);
  }

  get speed() { return Math.abs(this.vF); }
  get kmh() { return Math.round(Math.abs(this.vF) * 3.6); }
  get name() { return this.spec.name; }

  update(dt, input, wind, active) {
    carGround.value = this.pos.y;
    this.bobT += dt;
    const S = this.spec, V = CONFIG.vehicle;
    const throttle = active ? input.throttle : 0;
    // Steering eases toward the key input instead of snapping, so turns feel smooth.
    const steerTarget = active ? input.steer : 0;
    this.steerSmooth = (this.steerSmooth || 0) + (steerTarget - (this.steerSmooth || 0)) * Math.min(1, dt * (steerTarget === 0 ? 5 : 2.6));
    const steer = this.steerSmooth;
    const handbrake = active ? input.handbrake : !active;
    this.surface = surfaceAt(this.pos.x, this.pos.z);
    this.depth = Math.max(0, waterLevelAt(this.pos.x, this.pos.z) - heightAt(this.pos.x, this.pos.z));
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);

    // Nitro: hold to boost while the gauge lasts; it refills when you let go.
    this.boosting = active && !!input.nitro && this.nitro > 0.02 && throttle > 0 && this.depth < 0.3;
    if (this.boosting) this.nitro = Math.max(0, this.nitro - dt * 0.22);
    else this.nitro = Math.min(1, this.nitro + dt * 0.09);

    // Boat mode. Past the depth a car can wade (no deeper than 1.4 m) it floats and turns into a
    // boat; back in shallow water it turns into a car again. The gap stops it flicking between them.
    const floatAt = Math.min(S.wade, 1.4);
    if (!this.boatOn && !this.air && this.depth > floatAt) { this.boatOn = true; this.boatEvent = 'boat'; }
    else if (this.boatOn && this.depth < floatAt * 0.6) { this.boatOn = false; this.boatEvent = 'car'; }
    this.boat = clamp(this.boat + (this.boatOn ? dt : -dt) / 1.6, 0, 1);
    this.kit.apply(this.boat);
    const wet = this.boatOn || this.boat > 0;
    const afloat = this.boatOn && this.boat > 0.6; // hull down and jet out
    const B = S.boat || { maxSpeed: 15, accel: 6 };

    const inWater = this.depth > 0.05;
    const waterF = inWater ? lerp(1, 0.5, clamp(this.depth / S.wade, 0, 1)) : 1;
    // While the kit unfolds (either way) it only paddles along.
    const maxV = wet ? (afloat ? B.maxSpeed : 3.5) : S.maxSpeed * (S.offroad[this.surface] ?? 1) * waterF * (this.boosting ? S.nitro.speed : 1);
    const accel = wet ? (afloat ? B.accel : 3) : S.accel * (this.boosting ? S.nitro.accel : 1);

    // In the air there is no grip: no engine, brakes or steering, just momentum.
    const air = !!this.air;
    // Engine and brakes.
    this.braking = 0;
    if (air) { /* coasting */ } else if (throttle > 0) {
      if (this.vF < -0.5) { this.vF += S.brake * dt; this.braking = 1; }
      else this.vF += accel * throttle * dt * clamp(1.05 - this.vF / (maxV + 0.01), 0, 1);
    } else if (throttle < 0) {
      if (this.vF > 0.5) { this.vF -= S.brake * dt; this.braking = 1; }
      else this.vF = Math.max(this.vF - S.accel * 0.6 * dt, -S.reverseMax);
    }
    // Rolling resistance: small on tarmac, more off-road for cars that are bad at it.
    const off = S.offroad[this.surface] ?? 1;
    let drag = wet ? 0.08 : (SURFACE_DRAG[this.surface] ?? 0.05) * (1.6 - off);
    if (inWater && !wet) drag += S.waterDrag * clamp(this.depth, 0, 1.5) * 0.6;
    this.vF -= this.vF * drag * dt;
    if (throttle === 0) this.vF -= Math.sign(this.vF) * Math.min(Math.abs(this.vF), (wet ? 0.5 : 1.0) * dt);
    if (this.vF > maxV) this.vF -= (this.vF - maxV) * 1.8 * dt;

    // Hills (water is flat).
    const ahead = heightAt(this.pos.x + fx * 2, this.pos.z + fz * 2);
    const behind = heightAt(this.pos.x - fx * 2, this.pos.z - fz * 2);
    const holding = throttle === 0 && Math.abs(this.vF) < 2.2;
    if (!holding && !wet) this.vF -= ((ahead - behind) / 4) * 8 * dt;

    // Steering is softer at speed so it stays forgiving, even when boosting. A boat steers with
    // its jet, so it turns once it has a little way on, even slowly, and wider when fast.
    const sp = Math.abs(this.vF);
    const steerAmt = wet
      ? steer * S.steerRate * 0.55 * clamp(this.vF / 3, -1, 1) * (1 - 0.35 * clamp(sp / B.maxSpeed, 0, 1))
      : steer * S.steerRate * 0.72 * clamp(this.vF / 6, -1, 1) * (1 - 0.62 * clamp(sp / (S.maxSpeed * 1.2), 0, 1));
    if (!air) this.heading += steerAmt * dt;
    this.steerVis = lerp(this.steerVis, steer * 0.45, Math.min(1, dt * 8));

    // Wind pushes sideways; grip pulls the car back in line.
    const rx = fz, rz = -fx;
    const exposure = exposureAt(this.pos.x, this.pos.z);
    const windSide = (wind.x * rx + wind.z * rz) * exposure * V.windPush;
    if (!holding) this.vL += windSide * dt * 3;
    // Afloat it slides through turns, as a boat does.
    const grip = wet ? 1.4 : (handbrake && active ? S.handbrakeGrip : S.grip) * (inWater ? 0.7 : 1);
    this.vL -= this.vL * Math.min(1, grip * dt);
    if (handbrake) this.vF -= this.vF * Math.min(1, 1.6 * dt);
    if (handbrake && active && sp > 4 && !wet) this.vL += steer * -this.vF * 0.12 * dt * 8;

    // Parking hold: no throttle and below walking pace means the car is parked. It stops dead,
    // so wind and slopes cannot creep it along (which made the whole world seem to slide).
    // A boat just drifts to a stop.
    const parked = !wet && throttle === 0 && Math.abs(this.vF) < 2.2 && Math.abs(this.vL) < 1.5;
    if (parked) {
      this.vF *= Math.max(0, 1 - dt * 10);
      this.vL *= Math.max(0, 1 - dt * 10);
      if (Math.abs(this.vF) < 0.05) this.vF = 0;
      if (Math.abs(this.vL) < 0.05) this.vL = 0;
    }
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += (fx * this.vF + rx * this.vL) * dt;
    this.pos.z += (fz * this.vF + rz * this.vL) * dt;

    let warn = '';
    // Landmark rock and ice: drive up a slope like any hill, but a face steeper than about 50
    // degrees is a wall. Checked under the car and at the bumper in the direction of travel.
    const moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    const reach = (S.halfLength || 2.4) * (Math.sign(this.vF) || 1);
    if (solidStep(this.pos.x, this.pos.z, this.pos.y, 0.6 + moved * 1.2) ||
        solidStep(this.pos.x + fx * reach, this.pos.z + fz * reach, this.pos.y, 0.6 + (Math.abs(reach) + moved) * 1.2)) {
      this.pos.x = prevX; this.pos.z = prevZ;
      this.vF *= -0.15; this.vL = 0;
    }
    // How far you can roam. On land: 70 m from a road, but you can always head down to the sea or
    // a lake and drive along its shore. On the water: 400 m out from the shore. Only moving further
    // out is stopped, sliding along the limit, so you can always come back.
    const limit = wet ? V.boatRange : V.offRoadLimit;
    // Past the edge of the land map there is only open sea: count that distance as offshore too.
    const outside = (x, z) => Math.max(0, BOUNDS.minX - x, x - BOUNDS.maxX, BOUNDS.minZ - z, z - BOUNDS.maxZ);
    const far = wet ? (x, z) => -shoreDistAt(x, z) + outside(x, z) : roadDistAt;
    const dNew = far(this.pos.x, this.pos.z), dOld = far(prevX, prevZ);
    const shore = wet ? 0 : shoreDistAt(this.pos.x, this.pos.z);
    const toWater = !wet && (shore < V.shoreBand || shore <= shoreDistAt(prevX, prevZ));
    if (dNew > limit && dNew > dOld && !toWater) {
      const e = 2, gx = far(this.pos.x + e, this.pos.z) - far(this.pos.x - e, this.pos.z), gz = far(this.pos.x, this.pos.z + e) - far(this.pos.x, this.pos.z - e);
      const gl = Math.hypot(gx, gz) || 1, over = dNew - Math.max(limit, dOld);
      this.pos.x -= (gx / gl) * over; this.pos.z -= (gz / gl) * over;
      this.vF *= 1 - Math.min(1, 3 * dt);
      warn = wet ? 'That is far enough out. Turn back toward the shore.' : 'Head back toward the road, or down to the water.';
    }

    // Solid obstacles and bridge parapets: two circles (front and back) give a car-shaped footprint.
    this.impact = 0;
    for (const k of [1, -1]) {
      const ax = fx * S.halfLength * 0.62 * k, az = fz * S.halfLength * 0.62 * k;
      const c = { x: this.pos.x + ax, z: this.pos.z + az };
      const ox = c.x, oz = c.z;
      const hit = bridgeGuard(prevX + ax, prevZ + az, c, S.radius) || (this.obstacles && this.obstacles.resolve(c, S.radius));
      if (hit) {
        this.pos.x += c.x - ox; this.pos.z += c.z - oz;
        let vx = fx * this.vF + rx * this.vL, vz = fz * this.vF + rz * this.vL;
        const vn = vx * hit.nx + vz * hit.nz;
        if (vn < 0) {
          // Bounce off and lose speed, harder the more head-on the hit.
          vx -= 1.35 * vn * hit.nx; vz -= 1.35 * vn * hit.nz;
          vx *= 0.7; vz *= 0.7;
          this.vF = vx * fx + vz * fz;
          this.vL = (vx * rx + vz * rz) * 0.6;
          this.impact = Math.max(this.impact, -vn);
          this.impactKind = hit.kind;
        }
      }
    }
    this.warning = warn;
    this.windSide = windSide;
    this.vertical(dt, sp);
    this.sync(dt);
  }

  sync(dt) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = fz, rz = -fx;
    // Suspension: sample the ground under each wheel, fit a plane, then let each wheel
    // follow the ground on its own a little.
    const g = this.wheels.map((w) => heightAt(this.pos.x + rx * w.x + fx * w.z, this.pos.z + rz * w.x + fz * w.z));
    const front = (g[0] + g[1]) / 2, back = (g[2] + g[3]) / 2;
    const left = (g[1] + g[3]) / 2, right = (g[0] + g[2]) / 2;
    const wbLen = this.wheels[0].z - this.wheels[2].z, trackW = Math.abs(this.wheels[0].x - this.wheels[1].x);
    // A rock or hummock smaller than the wheelbase can sit between the wheels: the body rides
    // over it rather than letting it poke through the floor.
    let y = Math.max((front + back) / 2, solidTopAt(this.pos.x, this.pos.z) - 0.2);
    const sus = this.spec.susp || { k: 7, roll: 1 };
    // In water the body rides above the surface with only the wheels under: a ford, not a sink.
    // As a boat it floats on its hull instead, bobbing on the swell and lifting a little at speed.
    const fl = this.floatY();
    if (fl > y) y = fl;
    const hull = stages(this.boat).hull, afloat = hull > 0 && fl >= y - 1e-6;
    // The suspension smooths bumps but not the road's own rise and fall: the body moves with the
    // ground's smoothed vertical speed, and only what is left over is eased out. (Easing the whole
    // height made the body lag below a climb; with a catch-up past 25 cm it then snapped up and
    // fell back every frame, a fast judder at speed.) Frame-rate independent.
    if (dt && this.lastSyncY != null) {
      const gv = (y - this.lastSyncY) / dt;
      this.groundVy = this.groundVy == null ? gv : lerp(this.groundVy, gv, 1 - Math.exp(-dt * 14));
    } else this.groundVy = 0;
    this.lastSyncY = y;
    if (!this.air) {
      if (this.landing > 0 || !dt) this.pos.y = y;
      else {
        const follow = this.pos.y + this.groundVy * dt;
        this.pos.y = lerp(follow, y, 1 - Math.exp(-dt * sus.k * 1.6));
        this.pos.y = clamp(this.pos.y, y - 0.08, y + 0.25); // never sinks into the road
      }
    }
    let pitchT = Math.atan2(back - front, wbLen) - this.braking * 0.02 * sus.roll;
    const lean = -this.steerVis * clamp(this.vF / 30, 0, 1) * 0.07 * sus.roll;
    let rollT = Math.atan2(right - left, trackW) + (this.windSide || 0) * 0.01 + lean;
    let rate = sus.k * 0.85;
    if (afloat) {
      // Afloat the seabed does not tilt it: the bow lifts with speed, it rocks on the swell
      // and leans out of a turn.
      const t = this.bobT, plane = clamp(this.vF / 14, 0, 1);
      pitchT = lerp(pitchT, -plane * 0.06 + Math.sin(t * 1.1) * 0.018, hull);
      rollT = lerp(rollT, -this.steerVis * clamp(this.vF / 12, -1, 1) * 0.1 + Math.sin(t * 0.8 + 1) * 0.025 + (this.windSide || 0) * 0.02, hull);
      rate = lerp(rate, 2, hull);
    }
    this.pitch = this.air ? lerp(this.pitch, this.airPitch ?? 0, dt ? Math.min(1, dt * 3) : 1) : lerp(this.pitch, pitchT, dt ? Math.min(1, dt * rate) : 1);
    this.roll = lerp(this.roll, rollT, dt ? Math.min(1, dt * rate) : 1);
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.heading, 0);
    if (this.blob) {
      const len = (this.wheels[0].z - this.wheels[2].z) + 2.2, wid = Math.abs(this.wheels[0].x - this.wheels[1].x) + 1.0;
      this.blob.position.set(this.pos.x, Math.max(this.pos.y, waterLevelAt(this.pos.x, this.pos.z)) + 0.06, this.pos.z);
      this.blob.rotation.z = this.heading;
      this.blob.scale.set(wid * 1.25, len * 1.15, 1);
      this.blob.visible = this.root.visible && this.boat < 0.3;
    }
    this.body.rotation.set(this.pitch, 0, this.roll);
    // Accelerating squats the back a touch; braking dips the nose.
    // Suspension squash after a landing, springing back.
    this.compress = (this.compress || 0) * Math.max(0, 1 - (dt || 0) * 5);
    this.body.position.y = -this.compress;
    if (this.landing > 0) this.landing -= dt || 0;
    // A model may be built at one size and scaled up (model.scale): its wheel pivots live in the
    // model's own units, so suspension travel is divided by the scale and spin uses the real radius.
    // In boat mode the wheels rise and turn to lie flat on the deck, and stop turning.
    const R = this.model.R, MS = this.model.scale || 1, fold = stages(this.boat).fold, K = this.kit;
    this.wheels.forEach((w, i) => {
      const plane = y + (w.z / wbLen) * (front - back) + (w.x / trackW) * (right - left);
      const sx = Math.sign(w.x);
      w.pivot.position.y = R + clamp(g[i] - plane, -0.12, 0.12) / MS * (1 - fold) + K.lift * fold;
      w.pivot.position.x = w.baseX - sx * K.inset * fold;
      w.pivot.rotation.z = -sx * (Math.PI / 2) * fold;
      w.spin.rotation.x += (this.vF * (dt || 0)) / (R * MS) * (1 - fold);
      if (w.front) w.pivot.rotation.y = this.steerVis * (1 - fold);
    });
    K.bucket.rotation.y = -this.steerVis * 0.9;
    this.nitroFx.update(dt, this.boosting, Math.abs(this.vF));
  }

  // Vertical motion: follow the ground, take off where it drops away faster than the car can
  // follow, fly ballistically, and land with a squash and (on hard landings) a bounce.
  // How deep the wheels sit in water before the body rides on the surface.
  draft() { return clamp(this.spec.wade * 0.2, 0.12, 0.5); }
  // Height the car rides at on water: on its wheels' draft, or on the hull's waterline with a
  // gentle bob and a lift at speed as a boat.
  floatY() {
    const wl = waterLevelAt(this.pos.x, this.pos.z), h = stages(this.boat).hull;
    if (!h) return wl - this.draft();
    const t = this.bobT, bob = Math.sin(t * 1.3) * 0.045 + Math.sin(t * 2.1 + 1) * 0.02;
    return wl - lerp(this.draft(), this.kit.waterline, h) + (bob + clamp(this.vF / 14, 0, 1) * 0.06) * h;
  }
  groundY() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = fz, rz = -fx;
    let s = 0;
    for (const w of this.wheels) s += heightAt(this.pos.x + rx * w.x + fx * w.z, this.pos.z + rz * w.x + fz * w.z);
    const g = Math.max(s / this.wheels.length, solidTopAt(this.pos.x, this.pos.z) - 0.2);
    return Math.max(g, this.floatY());
  }
  vertical(dt, sp) {
    if (!dt) return;
    const G = 18;
    const ground = this.groundY();
    this.landImpact = 0;
    if (!this.air) {
      const gv = this.lastGround == null ? 0 : (ground - this.lastGround) / dt;
      // Take off: the road was carrying us up, and now falls away much faster than that.
      if (sp > 12 && (this.vyPrev || 0) > gv + 4 && (this.vyPrev || 0) > -1) {
        this.air = true;
        this.vy = Math.min(this.vyPrev, 10);
        this.airPitch = this.pitch;
      } else this.vy = gv;
      this.vyPrev = lerp(this.vyPrev || 0, gv, 0.5);
    }
    if (this.air) {
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      // Nose drops slowly during the flight.
      this.airPitch = lerp(this.airPitch ?? 0, 0.16, dt * 0.8);
      if (this.pos.y <= ground) {
        const impact = -this.vy;
        this.pos.y = ground;
        this.landImpact = impact;
        this.compress = Math.min(0.32, impact * 0.022);
        this.vF *= 1 - Math.min(0.25, impact * 0.012);
        if (impact > 9) { this.vy = impact * 0.22; this.pos.y = ground + 0.02; } // one bounce
        else { this.air = false; this.vy = 0; this.landing = 0.25; }
      }
    }
    this.lastGround = ground;
  }

  setLights(dark) {
    this.headlight.intensity = dark * 950;
    this.spread.intensity = dark * 320;
    this.lightMat.emissiveIntensity = 0.4 + dark * 1.4;
    this.tailMat.emissiveIntensity = 0.4 + dark * 0.6 + this.braking * 1.2;
  }
}
