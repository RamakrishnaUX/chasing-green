import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { groundAt as heightAt, surfaceAt, nearestRoad, exposureAt, waterLevelAt, bridgeGuard } from '../world/terrain.js';
import { clamp, lerp } from '../world/noise.js';
import { buildVehicleModel } from './models.js';
import { VEHICLES, SURFACE_DRAG } from './specs.js';

// The player's car. Kept under the old name so the rest of the game needs no changes;
// setType() swaps between the Jeep, the vintage roadster and the race car.
export class Jeep {
  constructor(scene, kind = 'jeep') {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.headlight = new THREE.SpotLight(0xfff0d0, 0, 110, 0.5, 0.6, 1.2);
    this.headlight.target.position.set(0, 0, 18);
    this.root.add(this.headlight, this.headlight.target);
    // Nitro flame: two emissive cones that flicker at the exhaust.
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0x7fb8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const fg = new THREE.ConeGeometry(0.09, 0.7, 12, 1, true);
    fg.rotateX(-Math.PI / 2);
    fg.translate(0, 0, -0.35);
    this.flame = new THREE.Mesh(fg, this.flameMat);
    this.root.add(this.flame);

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
    this.body = this.model.group;
    this.wheels = this.model.wheels;
    this.lightMat = this.model.lightMat;
    this.tailMat = this.model.tailMat;
    this.root.add(this.body);
    this.headlight.position.set(...this.model.headlight);
    this.headlight.target.position.set(0, 0, 22);
    this.flame.position.set(...this.model.exhaust);
    this.vF = 0; this.vL = 0;
    if (this.pos) this.sync(0);
  }

  place(x, z, heading) {
    this.air = false; this.vy = 0; this.vyPrev = 0; this.lastGround = null;
    this.pos.set(x, heightAt(x, z), z);
    this.heading = heading;
    this.vF = 0; this.vL = 0;
    this.sync(0);
  }

  get speed() { return Math.abs(this.vF); }
  get kmh() { return Math.round(Math.abs(this.vF) * 3.6); }
  get name() { return this.spec.name; }

  update(dt, input, wind, active) {
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

    const inWater = this.depth > 0.05;
    const waterF = inWater ? lerp(1, 0.5, clamp(this.depth / S.wade, 0, 1)) : 1;
    const maxV = S.maxSpeed * (S.offroad[this.surface] ?? 1) * waterF * (this.boosting ? S.nitro.speed : 1);
    const accel = S.accel * (this.boosting ? S.nitro.accel : 1);

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
    let drag = (SURFACE_DRAG[this.surface] ?? 0.05) * (1.6 - off);
    if (inWater) drag += S.waterDrag * clamp(this.depth, 0, 1.5) * 0.6;
    this.vF -= this.vF * drag * dt;
    if (throttle === 0) this.vF -= Math.sign(this.vF) * Math.min(Math.abs(this.vF), 1.0 * dt);
    if (this.vF > maxV) this.vF -= (this.vF - maxV) * 1.8 * dt;

    // Hills.
    const ahead = heightAt(this.pos.x + fx * 2, this.pos.z + fz * 2);
    const behind = heightAt(this.pos.x - fx * 2, this.pos.z - fz * 2);
    const holding = throttle === 0 && Math.abs(this.vF) < 2.2;
    if (!holding) this.vF -= ((ahead - behind) / 4) * 8 * dt;

    // Steering is softer at speed so it stays forgiving, even when boosting.
    const sp = Math.abs(this.vF);
    const steerAmt = steer * S.steerRate * 0.72 * clamp(this.vF / 6, -1, 1) * (1 - 0.62 * clamp(sp / (S.maxSpeed * 1.2), 0, 1));
    if (!air) this.heading += steerAmt * dt;
    this.steerVis = lerp(this.steerVis, steer * 0.45, Math.min(1, dt * 8));

    // Wind pushes sideways; grip pulls the car back in line.
    const rx = fz, rz = -fx;
    const exposure = exposureAt(this.pos.x, this.pos.z);
    const windSide = (wind.x * rx + wind.z * rz) * exposure * V.windPush;
    if (!holding) this.vL += windSide * dt * 3;
    const grip = (handbrake && active ? S.handbrakeGrip : S.grip) * (inWater ? 0.7 : 1);
    this.vL -= this.vL * Math.min(1, grip * dt);
    if (handbrake) this.vF -= this.vF * Math.min(1, 1.6 * dt);
    if (handbrake && active && sp > 4) this.vL += steer * -this.vF * 0.12 * dt * 8;

    // Parking hold: no throttle and below walking pace means the car is parked. It stops dead,
    // so wind and slopes cannot creep it along (which made the whole world seem to slide).
    const parked = throttle === 0 && Math.abs(this.vF) < 2.2 && Math.abs(this.vL) < 1.5;
    if (parked) {
      this.vF *= Math.max(0, 1 - dt * 10);
      this.vL *= Math.max(0, 1 - dt * 10);
      if (Math.abs(this.vF) < 0.05) this.vF = 0;
      if (Math.abs(this.vL) < 0.05) this.vL = 0;
    }
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += (fx * this.vF + rx * this.vL) * dt;
    this.pos.z += (fz * this.vF + rz * this.vL) * dt;

    // Deep water: each car has its own limit (the Jeep has a snorkel).
    let warn = '';
    const newDepth = waterLevelAt(this.pos.x, this.pos.z) - heightAt(this.pos.x, this.pos.z);
    if (newDepth > S.wade) {
      this.pos.x = prevX; this.pos.z = prevZ;
      this.vF *= -0.2; this.vL = 0;
      warn = this.kind === 'jeep' ? 'Too deep, even for the Jeep. Back up.' : `Too deep for the ${S.name.toLowerCase()}. The Jeep can wade much deeper.`;
    }
    const road = nearestRoad(this.pos.x, this.pos.z, V.offRoadLimit + 30);
    if (!road || road.dist > V.offRoadLimit) {
      if (road) {
        const over = road.dist - V.offRoadLimit;
        const dx = (road.px - this.pos.x) / road.dist, dz = (road.pz - this.pos.z) / road.dist;
        this.pos.x += dx * over; this.pos.z += dz * over;
      } else { this.pos.x = prevX; this.pos.z = prevZ; }
      this.vF *= 1 - Math.min(1, 3 * dt);
      warn = 'The ground gets too rough past here. Head back toward the road.';
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
    let y = (front + back) / 2;
    const sus = this.spec.susp || { k: 7, roll: 1 };
    const k = dt ? Math.min(1, dt * sus.k) : 1;
    // In water the body rides above the surface with only the wheels under: a ford, not a sink.
    const wl = waterLevelAt(this.pos.x, this.pos.z);
    if (wl - this.draft() > y) y = wl - this.draft();
    if (!this.air) this.pos.y = this.landing > 0 ? y : lerp(this.pos.y, y, k);
    this.pitch = this.air ? lerp(this.pitch, this.airPitch ?? 0, dt ? Math.min(1, dt * 3) : 1) : lerp(this.pitch, Math.atan2(back - front, wbLen) - this.braking * 0.02 * sus.roll, dt ? Math.min(1, dt * sus.k * 0.85) : 1);
    const lean = -this.steerVis * clamp(this.vF / 30, 0, 1) * 0.07 * sus.roll;
    this.roll = lerp(this.roll, Math.atan2(right - left, trackW) + (this.windSide || 0) * 0.01 + lean, dt ? Math.min(1, dt * sus.k * 0.85) : 1);
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.heading, 0);
    if (this.blob) {
      const len = (this.wheels[0].z - this.wheels[2].z) + 2.2, wid = Math.abs(this.wheels[0].x - this.wheels[1].x) + 1.0;
      this.blob.position.set(this.pos.x, Math.max(this.pos.y, waterLevelAt(this.pos.x, this.pos.z)) + 0.06, this.pos.z);
      this.blob.rotation.z = this.heading;
      this.blob.scale.set(wid * 1.25, len * 1.15, 1);
      this.blob.visible = this.root.visible;
    }
    this.body.rotation.set(this.pitch, 0, this.roll);
    // Accelerating squats the back a touch; braking dips the nose.
    // Suspension squash after a landing, springing back.
    this.compress = (this.compress || 0) * Math.max(0, 1 - (dt || 0) * 5);
    this.body.position.y = -this.compress;
    if (this.landing > 0) this.landing -= dt || 0;
    const R = this.model.R;
    this.wheels.forEach((w, i) => {
      const plane = y + (w.z / wbLen) * (front - back) + (w.x / trackW) * (right - left);
      w.pivot.position.y = R + clamp(g[i] - plane, -0.12, 0.12);
      w.spin.rotation.x += (this.vF * (dt || 0)) / R;
      if (w.front) w.pivot.rotation.y = this.steerVis;
    });
    // Nitro flame flicker.
    const on = this.boosting ? 1 : 0;
    this.flameMat.opacity = lerp(this.flameMat.opacity, on * (0.75 + Math.random() * 0.25), dt ? Math.min(1, dt * 12) : 1);
    this.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
    this.flame.visible = this.flameMat.opacity > 0.02;
  }

  // Vertical motion: follow the ground, take off where it drops away faster than the car can
  // follow, fly ballistically, and land with a squash and (on hard landings) a bounce.
  // How deep the wheels sit in water before the body rides on the surface.
  draft() { return clamp(this.spec.wade * 0.2, 0.12, 0.5); }
  groundY() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = fz, rz = -fx;
    let s = 0;
    for (const w of this.wheels) s += heightAt(this.pos.x + rx * w.x + fx * w.z, this.pos.z + rz * w.x + fz * w.z);
    const g = s / this.wheels.length, wl = waterLevelAt(this.pos.x, this.pos.z);
    return Math.max(g, wl - this.draft());
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
    this.headlight.intensity = dark * 70;
    this.lightMat.emissiveIntensity = 0.4 + dark * 1.4;
    this.tailMat.emissiveIntensity = 0.4 + dark * 0.6 + this.braking * 1.2;
  }
}
