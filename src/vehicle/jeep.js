import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { surfaceHeightAt, surfaceAt, iceAt, roadDistAt, shoreDistAt, exposureAt, waterLevelAt, bridgeGuard, isleAt, BOUNDS } from '../world/terrain.js';
import { clamp, lerp } from '../world/noise.js';
import { buildVehicleModel } from './models.js';
import { surfaceUniforms } from '../world/materials.js';
import { VEHICLES, SURFACE_DRAG } from './specs.js';
import { NitroFX } from './nitrofx.js';
import { bakeStatic } from '../world/bake.js';
import { solidStep, solidTopAt, solidRoofAt } from '../world/solids.js';
import { buildInterior } from './interiors.js';
import { HD } from '../world/hd.js';
import { applyGrime, grime } from './grime.js';
import { buildBoatKit, stages } from './boat.js';
import { VOICES } from '../audio/engines.js';

// How long the drive is cut at each change up, by engine: a quick-shifting supercar and bike,
// a 4x4 and camper with ordinary manual boxes, an old car with a slow crash box.
const SHIFT_TIME = { race: 0.11, twin: 0.13, v8: 0.26, flat4: 0.3, six: 0.36 };

// Hitting things. Restitution (how much of the closing speed comes back as a bounce) and friction
// (how hard the surface drags along the car while it scrapes past) for each kind of obstacle.
// Real cars bounce very little: the crumple zone takes the hit, more so the harder it is.
const IMPACT = { rock: { e: 0.22, mu: 0.45 }, wall: { e: 0.16, mu: 0.35 }, tree: { e: 0.12, mu: 0.55 } };

// The top of the car, so it can pass beneath a sea arch rather than treating the arch's roof as
// ground. Set as each update and sync begins. Rock more than a little above the car is a wall
// or a roof, not ground: the centre and bumper checks stop the car at it, and a wheel beside an
// arch's opening does not lift the car onto the arch.
// A mound, crater rim or hillside built as a landform is solid down to the land, so it is ground
// under a wheel however steep, up to what a wheel could reach on a slope the car can climb (the
// bumper check stops it at anything steeper). Without this a wheel on the uphill side of a mound
// read the land beneath it, and the car's nose dug into the grass.
let clearTop = null, carBase = null;
function heightAt(x, z) {
  const base = surfaceHeightAt(x, z), rock = solidTopAt(x, z, clearTop);
  if (!(rock > base)) return base;
  if (clearTop == null || rock < clearTop - 1.2) return rock;
  return carBase != null && rock < carBase + 2.6 && !solidRoofAt(x, z) ? rock : base;
}

// A bike does not float: no hull, only the sizes the rest of the car code reads from a kit.
function bikeKit(model) {
  model.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model.group);
  return { group: new THREE.Group(), apply() {}, bucket: new THREE.Object3D(), R: model.R, MS: 1, halfW: 0.4, z0: box.min.z, z1: box.max.z, waterline: 0.3, height: box.max.y, lift: 0, inset: 0 };
}

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
    this.wheelie = 0; this.wheelieV = 0; // the bike's front lifted, radians, and how fast it moves
    this.power = 1; // engine power from the fuel tank: 1 normal, 0 out of fuel
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
    this.wheelie = 0; this.wheelieV = 0;
    this.model = buildVehicleModel(kind);
    // Dirt that builds up as you drive (grime.js). The realistic look's built-in cars keep a little
    // road grime even when clean; the Sketchfab cars carry their own wear in their textures.
    applyGrime(this.model.group);
    grime.uBase.value = HD.on && !this.model.glb ? 0.3 : 0;
    this.kit = this.model.bike ? bikeKit(this.model) : buildBoatKit(this.model);
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
    if (this.interior.outside) this.body.add(this.interior.outside); // parts seen from outside too
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
    // From inside the glass is not drawn at all: even nearly clear, its glossy coat reflected the
    // sky as blurred blue patches across the windscreen.
    for (const m of this.glass) { m.opacity = m.userData.opacity; m.visible = !inside; }
  }

  place(x, z, heading) {
    // Set down on the land, the water or rock it can stand on. Under an arch the roof is a roof,
    // not ground (as when driving): a car put there sat up against it, tipped on its side.
    const base = surfaceHeightAt(x, z), rock = solidTopAt(x, z, base + this.kit.height + 0.1);
    const y = Math.max(base, rock);
    clearTop = y + this.kit.height + 0.1; carBase = y;
    this.air = false; this.vy = 0; this.vyPrev = 0; this.lastGround = null; this.lastSyncY = null; this.groundVy = 0;
    this.pos.set(x, y, z);
    this.heading = heading;
    this.vF = 0; this.vL = 0; this.spinV = 0; this.gear = 1; this.shiftT = 0; this.biteT = 0; this.downT = 0;
    this.boat = 0; this.boatOn = false; this.kit.apply(0);
    this.sync(0);
  }

  get speed() { return Math.abs(this.vF); }
  get kmh() { return Math.round(Math.abs(this.vF) * 3.6); }
  get name() { return this.spec.name; }

  update(dt, input, wind, active) {
    grime.uGround.value = this.pos.y;
    clearTop = this.pos.y + this.kit.height + 0.1; carBase = this.pos.y;
    this.bobT += dt;
    const S = this.spec, V = CONFIG.vehicle;
    const throttle = active ? input.throttle : 0;
    // Steering eases toward the key input instead of snapping, so turns feel smooth.
    const steerTarget = active ? input.steer : 0;
    // On the bike, more gently still: a rider rolls into a turn rather than flicking the bars.
    const steerRate = S.bike ? (steerTarget === 0 ? 2.4 : 1.7) : (steerTarget === 0 ? 5 : 2.6);
    this.steerSmooth = (this.steerSmooth || 0) + (steerTarget - (this.steerSmooth || 0)) * (1 - Math.exp(-dt * steerRate));
    const steer = this.steerSmooth;
    const handbrake = active ? input.handbrake : !active;
    this.surface = surfaceAt(this.pos.x, this.pos.z);
    // Winter roads: packed snow takes some of the grip, black ice most of it, and snow off the
    // road some too. Slick: 0 (dry tarmac) to about 0.9 (glazed ice).
    const onRoad = this.surface === 'paved' || this.surface === 'gravel';
    this.ice = onRoad ? iceAt(this.pos.x, this.pos.z) : 0;
    const slick = clamp(this.ice * 0.8 + (onRoad ? surfaceUniforms.uRoadSnow.value * 0.22 : this.surface === 'snow' ? 0.28 : 0), 0, 0.9);
    this.slick = slick;
    this.depth = Math.max(0, waterLevelAt(this.pos.x, this.pos.z) - heightAt(this.pos.x, this.pos.z));
    // Spin from a knock (collide): the body turns while its momentum carries on the way it was going,
    // so the tyres end up sliding sideways and scrub the spin and the slide away (skids and squeal
    // follow from the slide). The less grip, the longer it spins: on ice it can go round.
    if (this.spinV) {
      const h0 = this.heading, vx = Math.sin(h0) * this.vF + Math.cos(h0) * this.vL, vz = Math.cos(h0) * this.vF - Math.sin(h0) * this.vL;
      this.heading += this.spinV * dt;
      const h1 = this.heading;
      this.vF = vx * Math.sin(h1) + vz * Math.cos(h1); this.vL = vx * Math.cos(h1) - vz * Math.sin(h1);
      const hold = this.air ? 0.2 : this.boatOn ? 1.2 : lerp(6, 1.1, this.slick || 0);
      this.spinV *= Math.exp(-dt * hold);
      if (Math.abs(this.spinV) < 0.01) this.spinV = 0;
    }
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);

    // Boat mode. Past the depth a car can wade (no deeper than 1.4 m) it floats and turns into a
    // boat; back in shallow water it turns into a car again. The gap stops it flicking between them.
    const floatAt = Math.min(S.wade, 1.4);
    if (!this.boatOn && !this.air && this.depth > floatAt && !S.bike) { this.boatOn = true; this.boatEvent = 'boat'; }
    else if (this.boatOn && this.depth < floatAt * 0.6) { this.boatOn = false; this.boatEvent = 'car'; }
    this.boat = clamp(this.boat + (this.boatOn ? dt : -dt) / 1.6, 0, 1);
    this.kit.apply(this.boat);
    const wet = this.boatOn || this.boat > 0;
    const afloat = this.boatOn && this.boat > 0.6; // hull down and jet out
    const B = S.boat || { maxSpeed: 15, accel: 6 };

    // On the bike, the same control pulls a wheelie (see wheelieStep).
    // Nitro: hold to boost while the gauge lasts; it refills when you let go. It works on the
    // road and as a boat (it digs the jet in), but not while wading or changing over.
    this.boosting = active && !S.bike && !!input.nitro && this.nitro > 0.02 && this.power > 0.5 && throttle > 0 && (afloat || (!wet && this.depth < 0.3));
    if (this.boosting) this.nitro = Math.max(0, this.nitro - dt * 0.22);
    else this.nitro = Math.min(1, this.nitro + dt * 0.09);

    const inWater = this.depth > 0.05;
    const waterF = inWater ? lerp(1, 0.5, clamp(this.depth / S.wade, 0, 1)) : 1;
    // While the kit unfolds (either way) it only paddles along.
    const maxV = wet ? (afloat ? B.maxSpeed * (this.boosting ? S.nitro.speed : 1) : 3.5) : S.maxSpeed * (S.offroad[this.surface] ?? 1) * waterF * (this.boosting ? S.nitro.speed : 1);
    const accel = wet ? (afloat ? B.accel * (this.boosting ? S.nitro.accel : 1) : 3) : S.accel * (this.boosting ? S.nitro.accel : 1) * (1 - slick * 0.55);
    const brake = S.brake * (1 - slick * 0.62); // on ice the wheels lock and it slides on

    // In the air there is no grip: no engine, brakes or steering, just momentum.
    const air = !!this.air;

    // The gearbox: the same gears as the engine's sound (engines.js `tops`), so what you hear
    // and what the car does change together. Changing up under power, the drive is cut while the
    // clutch is in: the car stops pulling for a moment and the nose dips as the weight comes
    // forward. Then it bites: a shove in the back as it pulls on in the next gear, the tail
    // squatting. Quick in the supercar and on the bike, slower in the old cars. Lower gears
    // shove hardest.
    const GV = VOICES[S.engine?.voice];
    this.gear ||= 1;
    if (GV && !wet) {
      const T = GV.tops, sp = Math.abs(this.vF), was = this.gear;
      if (sp > T[this.gear - 1] * 0.97 && this.gear < T.length) this.gear++;
      else if (this.gear > 1 && sp < T[this.gear - 2] * 0.45) this.gear--;
      // Changing down off the throttle: the lower gear bites, the engine holds the car back for a
      // moment and the nose dips (audio.js blips the revs to match).
      if (this.gear < was && throttle <= 0 && this.vF > 3 && !air && dt) {
        this.downT = 0.3;
        this.rockV = (this.rockV || 0) + 0.09 / Math.sqrt(this.gear) * (S.bike ? 0.5 : 1) * (this.spec.susp?.roll ?? 1);
      }
      if (this.gear > was && throttle > 0.2 && this.vF > 0 && !air && dt) {
        this.shiftDur = SHIFT_TIME[S.engine.voice] ?? 0.25;
        this.shiftT = this.shiftDur;
        this.shiftKick = 0.2 / Math.sqrt(was) * (S.bike ? 0.5 : S.engine.voice === 'race' ? 0.7 : 1) * (this.spec.susp?.roll ?? 1);
        this.rockV = (this.rockV || 0) + this.shiftKick; // nose dips as the drive goes
      }
    } else if (wet) this.gear = 1;
    let drive = 1;
    if (this.shiftT > 0) {
      drive = 0.35; // the pull eases rather than dropping out, so speed doesn't stall mid-change
      this.shiftT -= dt || 0;
      if (this.shiftT <= 0) { this.shiftT = 0; this.biteT = 0.3; this.rockV = (this.rockV || 0) - this.shiftKick; } // it bites: the tail squats
    } else if (this.biteT > 0) {
      drive = 1 + 0.12 * (this.biteT / 0.3); // a light shove as the clutch bites
      this.biteT = Math.max(0, this.biteT - (dt || 0));
    }
    if (throttle <= 0) { this.shiftT = 0; this.biteT = 0; drive = 1; }
    this.shifting = this.shiftT > 0;
    // Engine and brakes.
    this.braking = 0;
    if (air) { /* coasting */ } else if (throttle > 0) {
      if (this.vF < -0.5) { this.vF += brake * dt; this.braking = 1; }
      else if (drive > 0) this.vF += accel * throttle * this.power * drive * dt * clamp(1.05 - this.vF / (maxV + 0.01), 0, 1);
      else this.vF -= Math.min(this.vF, 1.6 * dt); // clutch in: no drive, a little drag
    } else if (throttle < 0) {
      if (this.vF > 0.5) { this.vF -= brake * dt; this.braking = 1; }
      else this.vF = Math.max(this.vF - S.accel * 0.6 * this.power * dt, -S.reverseMax);
    }
    // Rolling resistance: small on tarmac, more off-road for cars that are bad at it.
    const off = S.offroad[this.surface] ?? 1;
    let drag = wet ? 0.08 : (SURFACE_DRAG[this.surface] ?? 0.05) * (1.6 - off);
    if (inWater && !wet) drag += S.waterDrag * clamp(this.depth, 0, 1.5) * 0.6;
    this.vF -= this.vF * drag * dt;
    // Off the throttle the engine holds the car back, harder in the low gears, and with a brief
    // lurch just after changing down.
    let coast = wet ? 0.5 : 1.0;
    if (GV && !wet && throttle === 0 && this.vF > 2) {
      coast += 0.5 + 0.45 * (GV.tops.length - this.gear);
      if (this.downT > 0) { coast += 1.2 * (this.downT / 0.3); this.downT = Math.max(0, this.downT - (dt || 0)); }
    }
    if (throttle === 0) this.vF -= Math.sign(this.vF) * Math.min(Math.abs(this.vF), coast * dt);
    if (this.vF > maxV) this.vF -= (this.vF - maxV) * 1.8 * dt;

    // Hills (water is flat).
    const ahead = heightAt(this.pos.x + fx * 2, this.pos.z + fz * 2);
    const behind = heightAt(this.pos.x - fx * 2, this.pos.z - fz * 2);
    const holding = throttle === 0 && Math.abs(this.vF) < 2.2;
    if (!holding && !wet) this.vF -= ((ahead - behind) / 4) * 8 * dt;

    // Steering is softer at speed so it stays forgiving, even when boosting. A boat steers with
    // its jet, so it turns once it has a little way on, even slowly, and wider when fast.
    const sp = Math.abs(this.vF);
    if (S.bike) this.wheelieStep(dt, active && !!input.wheelie && !air && this.depth < 0.3 && this.vF > -0.5 && (throttle > 0 || sp > 5), air);
    const steerAmt = (S.bike ? 1 - 0.35 * clamp(this.wheelie / 0.5, 0, 1) : 1) * wet
      ? steer * S.steerRate * 0.55 * clamp(this.vF / 3, -1, 1) * (1 - 0.35 * clamp(sp / B.maxSpeed, 0, 1))
      : steer * S.steerRate * 0.72 * clamp(this.vF / 6, -1, 1) * (1 - 0.62 * clamp(sp / (S.maxSpeed * 1.2), 0, 1)) * (1 - slick * 0.3);
    if (!air) this.heading += steerAmt * dt;
    // On ice the car turns but its weight carries on the way it was going: the turn becomes a
    // slide that the little grip there is slowly pulls back into line.
    if (!air && !wet && slick > 0.05) this.vL -= this.vF * Math.sin(steerAmt * dt) * slick;
    this.yawRate = air ? 0 : steerAmt;
    // A bike's bars turn well over at walking pace and only a little at speed (it leans instead).
    this.steerVis = lerp(this.steerVis, steer * (S.bike ? lerp(0.5, 0.06, clamp(sp / 25, 0, 1)) : 0.45), Math.min(1, dt * 8));

    // Wind pushes sideways; grip pulls the car back in line.
    const rx = fz, rz = -fx;
    const exposure = exposureAt(this.pos.x, this.pos.z);
    const windSide = (wind.x * rx + wind.z * rz) * exposure * V.windPush;
    // A boat has little grip, so the wind only nudges it, or it would drift sideways like a leaf.
    if (!holding) this.vL += windSide * dt * (wet ? 0.6 : 3);
    // Afloat it slides through turns, as a boat does.
    const grip = wet ? 1.4 : (handbrake && active ? S.handbrakeGrip : S.grip) * (inWater ? 0.7 : 1) * (1 - slick * 0.93);
    this.vL -= this.vL * Math.min(1, grip * dt);
    if (handbrake) this.vF -= this.vF * Math.min(1, 1.6 * dt);
    if (handbrake && active && sp > 4 && !wet) this.vL += steer * -this.vF * 0.12 * dt * 8;

    // How hard the tyres are working sideways (0 to 1): the cornering load against what this car
    // can hold, a slide (handbrake, wind), or locking up under hard braking at speed. It drives
    // the squeal, the skid marks and the camera's lean.
    // Steering hard for the speed: from full lock at about 40 km/h, or under half lock at 100.
    const lock = Math.abs(steer), corner = clamp((lock * Math.abs(this.vF) - 7) / 8, 0, 1);
    this.latAcc = air || wet ? 0 : (this.yawRate || 0) * this.vF;
    this.slip = air || wet || S.bike ? 0 : Math.max(corner, clamp((Math.abs(this.vL) - 1.2) / 3, 0, 1), throttle < 0 && this.vF > 7 ? 0.34 + clamp((this.vF - 7) / 15, 0, 0.5) : 0);
    // Ice is quiet and leaves no rubber: the tyres slide rather than scrub.
    this.slip *= 1 - this.ice * 0.85;
    // Parking hold: no throttle and below walking pace means the car is parked. It stops dead,
    // so wind and slopes cannot creep it along (which made the whole world seem to slide).
    // A boat just drifts to a stop.
    const parked = !wet && throttle === 0 && Math.abs(this.vF) < 2.2 && Math.abs(this.vL) < 1.5;
    if (parked) {
      this.spinV = (this.spinV || 0) * Math.max(0, 1 - dt * 10);
      this.vF *= Math.max(0, 1 - dt * 10);
      this.vL *= Math.max(0, 1 - dt * 10);
      if (Math.abs(this.vF) < 0.05) this.vF = 0;
      if (Math.abs(this.vL) < 0.05) this.vL = 0;
    }
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += (fx * this.vF + rx * this.vL) * dt;
    this.pos.z += (fz * this.vF + rz * this.vL) * dt;

    let warn = '';
    this.impact = 0; this.scrape = 0; this.hit = null;
    // Landmark rock and ice: drive up a slope like any hill, but a face steeper than about 50
    // degrees is a wall. Checked under the car and at the bumper in the direction of travel. The
    // wall's face is read from the rock's shape there, so the car hits it as it would a wall: a
    // glancing blow slides it along the face, a square one stops it.
    const moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    const reach = (S.halfLength || 2.4) * (Math.sign(this.vF) || 1);
    const blockedAt = () => solidStep(this.pos.x, this.pos.z, this.pos.y, 0.6 + moved * 1.2, clearTop) ? 0
      : solidStep(this.pos.x + fx * reach, this.pos.z + fz * reach, this.pos.y, 0.6 + (Math.abs(reach) + moved) * 1.2, clearTop) ? 1 : -1;
    const b = blockedAt();
    if (b >= 0) {
      const ox = fx * reach * b, oz = fz * reach * b, bx = this.pos.x + ox, bz = this.pos.z + oz;
      const top = (x, z) => { const t = solidTopAt(x, z, clearTop); return t > -1e9 ? t : this.pos.y; };
      let nx = top(bx - 1, bz) - top(bx + 1, bz), nz = top(bx, bz - 1) - top(bx, bz + 1), nl = Math.hypot(nx, nz);
      const mx = this.pos.x - prevX, mz = this.pos.z - prevZ;
      if (nl < 1e-3 || nx * mx + nz * mz > 0) { nx = -mx; nz = -mz; nl = Math.hypot(nx, nz) || 1; }
      nx /= nl; nz /= nl;
      // Keep the part of the move along the face, drop the part into it.
      const into = Math.min(0, mx * nx + mz * nz);
      this.pos.x = prevX + mx - into * nx; this.pos.z = prevZ + mz - into * nz;
      if (blockedAt() >= 0) { this.pos.x = prevX; this.pos.z = prevZ; }
      this.hitBox({ nx, nz, kind: 'rock' }, fx, fz);
    }
    // A bike cannot float: it stops at water deeper than it can ford, and can always back out.
    if (S.bike) {
      const deep = (x, z) => waterLevelAt(x, z) - heightAt(x, z);
      if (deep(this.pos.x, this.pos.z) > S.wade + 0.15 && deep(this.pos.x, this.pos.z) > deep(prevX, prevZ)) {
        this.pos.x = prevX; this.pos.z = prevZ; this.vF *= 0.3; this.vL = 0;
        warn = 'Too deep for the bike. Find a way round, or take a car.';
      }
    }
    // How far you can roam. On land: 70 m from a road, but you can always head down to the sea or
    // a lake and drive along its shore. On the water: 400 m out from the shore. Only moving further
    // out is stopped, sliding along the limit, so you can always come back.
    const limit = wet ? V.boatRange : V.offRoadLimit;
    // Past the edge of the land map there is only open sea: count that distance as offshore too.
    const outside = (x, z) => Math.max(0, BOUNDS.minX - x, x - BOUNDS.maxX, BOUNDS.minZ - z, z - BOUNDS.maxZ);
    // An island is small enough to roam all over (its stadium fills much of it): no road limit.
    const far = wet ? (x, z) => -shoreDistAt(x, z) + outside(x, z) : (x, z) => (isleAt(x, z) ? 0 : roadDistAt(x, z));
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
    // Each touch is an impact at the point of contact (collide).
    for (const k of [1, -1]) {
      const ax = fx * S.halfLength * 0.62 * k, az = fz * S.halfLength * 0.62 * k;
      const c = { x: this.pos.x + ax, z: this.pos.z + az };
      const ox = c.x, oz = c.z;
      const hit = bridgeGuard(prevX + ax, prevZ + az, c, S.radius) || (this.obstacles && this.obstacles.resolve(c, S.radius));
      if (hit) {
        this.pos.x += c.x - ox; this.pos.z += c.z - oz;
        this.hitBox(hit, fx, fz);
      }
    }
    this.warning = warn;
    this.windSide = windSide;
    this.vertical(dt, sp);
    this.sync(dt);
  }

  // Where a contact touches the car and which way it pushes, against the car's own box (its length
  // and a little under its width) rather than the round footprint that finds the contact: round
  // ends point every push at the centre line, so a corner clipping a rock glanced off instead of
  // being held back and slewing the car round it. A round obstacle (cx, cz) touches the box at its
  // closest point; a flat face touches the corner (or the edge) that leads into it.
  hitBox(hit, fx, fz) {
    const S = this.spec, rx = fz, rz = -fx;
    const Lh = S.halfLength * 0.62 + S.radius * 0.9, Wh = S.radius * (S.bike ? 0.5 : 0.75);
    let nx = hit.nx, nz = hit.nz, qf, qr;
    if (hit.circle) {
      const dx = hit.cx - this.pos.x, dz = hit.cz - this.pos.z, of = dx * fx + dz * fz, or = dx * rx + dz * rz;
      qf = clamp(of, -Lh, Lh); qr = clamp(or, -Wh, Wh);
      const df = qf - of, dr = qr - or, dl = Math.hypot(df, dr);
      if (dl > 1e-3) { nx = (df * fx + dr * rx) / dl; nz = (df * fz + dr * rz) / dl; }
    } else {
      qf = -Lh * clamp((nx * fx + nz * fz) * 4, -1, 1);
      qr = -Wh * clamp((nx * rx + nz * rz) * 4, -1, 1);
    }
    this.collide(qf * fx + qr * rx, qf * fz + qr * rz, nx, nz, hit.kind);
  }

  // An impact, as a rigid body meeting something that does not move. (px, pz): where it touches,
  // from the car's centre; (nx, nz): the obstacle's face, pointing out at the car. The push is
  // worked out at the point of contact, so a hit off the centre line turns the car as well as
  // stopping it (a front corner clipping a rock slews the nose round), and the face drags along the
  // car while it scrapes past, so a glancing blow slides it along a wall losing a little speed
  // while a square one stops it dead. Harder hits bounce less (the body crumples rather than
  // springs). The body pitches and rolls on its springs with the jolt.
  collide(px, pz, nx, nz, kind) {
    const S = this.spec, h = this.heading, fx = Math.sin(h), fz = Math.cos(h), rx = fz, rz = -fx;
    let vx = fx * this.vF + rx * this.vL, vz = fz * this.vF + rz * this.vL, w = this.spinV || 0;
    const vx0 = vx, vz0 = vz;
    // How the contact point moves: the car's motion plus its turning (heading h turns a point r at
    // w * (r.z, -r.x)).
    const cx = vx + w * pz, cz = vz - w * px, vn = cx * nx + cz * nz;
    if (vn >= -1e-4) return;
    // Yaw inertia per unit mass of the car's footprint, as a box.
    const len = 2 * (S.halfLength * 0.62 + S.radius * 0.9), wid = S.radius * (S.bike ? 1 : 1.5), I = (len * len + wid * wid) / 12;
    const P = IMPACT[kind] || IMPACT.wall, close = -vn;
    // Resting against it (pushing on a wall at a crawl): no bounce, so it never judders.
    const e = close < 1 ? 0 : P.e * clamp(1.15 - close / 22, 0.2, 1);
    const ln = pz * nx - px * nz, jn = (1 + e) * close / (1 + ln * ln / I);
    const tx = -nz, tz = nx, vt = cx * tx + cz * tz, lt = pz * tx - px * tz;
    const jt = clamp(-vt / (1 + lt * lt / I), -P.mu * jn, P.mu * jn);
    vx += jn * nx + jt * tx; vz += jn * nz + jt * tz;
    // The tyres' side grip fights the turn while the hit lasts (they are planted at the axles), so
    // on the ground a knock turns the car about half as much as it would a sliding box; on ice, in
    // the air or afloat nearly the full amount.
    const planted = this.air ? 0 : this.boatOn ? 0.2 : 1 - (this.slick || 0);
    w += (jn * ln + jt * lt) / I * lerp(1, 0.45, planted);
    const vF = vx * fx + vz * fz, vL = vx * rx + vz * rz, dF = vF - this.vF, dL = vL - this.vL;
    this.vF = vF; this.vL = vL;
    this.spinV = clamp(w, -2.5, 2.5);
    // The body carries on for a moment on its springs: the nose dips into a hit from the front (and
    // the tail into one from behind) and the body leans away from a hit on the side.
    const sus = this.spec.susp || { roll: 1 }, give = clamp(sus.roll, 0.4, 2.4);
    this.rockV = (this.rockV || 0) + clamp(-dF * 0.045 * give, -1.2, 1.2);
    this.rollV = (this.rollV || 0) + clamp(-dL * 0.05 * give, -1, 1);
    this.impact = Math.max(this.impact, close);
    this.impactKind = kind;
    this.scrape = Math.max(this.scrape || 0, Math.abs(vt) * (jn > 0 ? 1 : 0));
    // The hardest contact this frame, for the crash effects: where (world, and in the car's own
    // frame), the face, the car's velocity before and the change, how hard and how fast it slid.
    if (!this.hit || close > this.hit.speed) this.hit = {
      x: this.pos.x + px, z: this.pos.z + pz, lx: px * rx + pz * rz, lz: px * fx + pz * fz, nx, nz, kind,
      vx: vx0, vz: vz0, dvx: vx - vx0, dvz: vz - vz0, speed: close, slide: Math.abs(vt),
    };
  }

  sync(dt) {
    if (this.model.bike) return this.syncBike(dt);
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
    let y = Math.max((front + back) / 2, solidTopAt(this.pos.x, this.pos.z, clearTop) - 0.2);
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
    // Tilt follows the ground under the wheels, but no further than a car on its wheels can tip.
    let pitchT = clamp(Math.atan2(back - front, wbLen), -0.62, 0.62) - this.braking * 0.02 * sus.roll;
    const lean = -this.steerVis * clamp(this.vF / 30, 0, 1) * 0.07 * sus.roll;
    let rollT = clamp(Math.atan2(right - left, trackW), -0.5, 0.5) + (this.windSide || 0) * 0.01 + lean;
    let rate = sus.k * 0.85;
    if (afloat) {
      // Afloat the seabed does not tilt it: the bow lifts with speed, it rocks on the swell
      // and leans out of a turn.
      const t = this.bobT, plane = clamp(this.vF / 14, 0, 1.4);
      // Climbing onto the plane the bow rises most (the hump, about 7 m/s), then settles a little.
      const hump = Math.sin(Math.PI * clamp(this.vF / 14, 0, 1));
      pitchT = lerp(pitchT, -plane * 0.045 - hump * 0.07 + Math.sin(t * 1.1) * 0.018, hull);
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
    this.suspend(dt);
    this.body.rotation.set(this.pitch + this.rockP, 0, this.roll + this.rollP);
    this.body.position.y = this.susY;
    if (this.landing > 0) this.landing -= dt || 0;
    // A model may be built at one size and scaled up (model.scale): its wheel pivots live in the
    // model's own units, so suspension travel is divided by the scale and spin uses the real radius.
    // In boat mode the wheels rise and turn to lie flat on the deck, and stop turning.
    const R = this.model.R, MS = this.model.scale || 1, fold = stages(this.boat).fold, K = this.kit;
    this.wheels.forEach((w, i) => {
      const plane = y + (w.z / wbLen) * (front - back) + (w.x / trackW) * (right - left);
      const sx = Math.sign(w.x);
      // In the air the wheels hang at full droop; landed, they stay on the ground while the body
      // sinks and rebounds on its springs above them.
      w.pivot.position.y = R + (clamp(g[i] - plane, -0.12, 0.12) - this.susY) / MS * (1 - fold) + K.lift * fold;
      w.pivot.position.x = w.baseX - sx * K.inset * fold;
      w.pivot.rotation.z = -sx * (Math.PI / 2) * fold;
      w.spin.rotation.x += (this.vF * (dt || 0)) / (R * MS) * (1 - fold);
      if (w.front) w.pivot.rotation.y = this.steerVis * (1 - fold);
    });
    K.bucket.rotation.y = -this.steerVis * 0.6;
    // The propeller turns with the throttle and the speed, once the motor is down in the water.
    if (K.prop) K.prop.rotation.z += (dt || 0) * stages(this.boat).jet * (10 + Math.abs(this.vF) * 4 + (this.boosting ? 20 : 0));
    // On the water nitro shows in the jet's plume (BoatWater), not as exhaust flames and streaks.
    this.nitroFx.update(dt, this.boosting && this.boat < 0.5, Math.abs(this.vF));
  }

  // A bike on its two wheels: it follows the ground under them nose to tail, but stays upright
  // across a slope and leans into its turns, by the angle that balances the turn at its speed
  // (tan lean = speed x turn rate / g), upright at walking pace. It leans about the line where the
  // tyres touch the road, as a real one does. Both wheels spin; the front one turns with the bars.
  syncBike(dt) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const [F, B] = this.wheels;
    const gF = heightAt(this.pos.x + fx * F.z, this.pos.z + fz * F.z), gB = heightAt(this.pos.x + fx * B.z, this.pos.z + fz * B.z);
    let y = Math.max((gF + gB) / 2, solidTopAt(this.pos.x, this.pos.z, clearTop) - 0.2);
    const fl = this.floatY();
    if (fl > y) y = fl;
    const sus = this.spec.susp;
    if (dt && this.lastSyncY != null) {
      const gv = (y - this.lastSyncY) / dt;
      this.groundVy = this.groundVy == null ? gv : lerp(this.groundVy, gv, 1 - Math.exp(-dt * 14));
    } else this.groundVy = 0;
    this.lastSyncY = y;
    if (!this.air) {
      if (this.landing > 0 || !dt) this.pos.y = y;
      else {
        this.pos.y = lerp(this.pos.y + this.groundVy * dt, y, 1 - Math.exp(-dt * sus.k * 1.6));
        this.pos.y = clamp(this.pos.y, y - 0.08, y + 0.25);
      }
    }
    const pitchT = Math.atan2(gB - gF, F.z - B.z) - this.braking * 0.03;
    const v = this.vF, lean = Math.atan2(v * (this.yawRate || 0), 9.8);
    const rollT = this.air ? this.roll : -clamp(lean, -0.52, 0.52) * clamp(Math.abs(v) / 4, 0, 1);
    const k = dt ? Math.min(1, dt * 6) : 1;
    this.pitch = this.air ? lerp(this.pitch, this.airPitch ?? 0, dt ? Math.min(1, dt * 3) : 1) : lerp(this.pitch, pitchT, k);
    // The lean eases toward its angle and never swings faster than a rider can tip a bike over
    // (about 90 degrees a second), so going from one turn into the next rolls, never snaps.
    if (dt) this.roll += clamp((rollT - this.roll) * (1 - Math.exp(-dt * 3.5)), -1.6 * dt, 1.6 * dt);
    else this.roll = rollT;
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.heading, 0);
    if (this.blob) {
      this.blob.position.set(this.pos.x, Math.max(this.pos.y, waterLevelAt(this.pos.x, this.pos.z)) + 0.06, this.pos.z);
      this.blob.rotation.z = this.heading;
      this.blob.scale.set(0.9, (F.z - B.z) + 1.4, 1);
      this.blob.visible = this.root.visible;
    }
    this.suspend(dt);
    // A wheelie turns the bike about where the back tyre meets the road, so that tyre stays down.
    const wA = this.wheelie;
    this.body.rotation.set(this.pitch + this.rockP - wA, 0, this.roll + this.rollP * 0.5);
    this.body.position.set(0, this.susY - B.z * Math.sin(wA), B.z * (1 - Math.cos(wA)));
    if (this.landing > 0) this.landing -= dt || 0;
    for (const w of this.wheels) w.spin.rotation.x += (this.vF * (dt || 0)) / this.model.R;
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
    return wl - lerp(this.draft(), this.kit.waterline, h) + (bob + clamp(this.vF / 14, 0, 1.4) * 0.06) * h;
  }
  groundY() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = fz, rz = -fx;
    let s = 0;
    for (const w of this.wheels) s += heightAt(this.pos.x + rx * w.x + fx * w.z, this.pos.z + rz * w.x + fz * w.z);
    const g = Math.max(s / this.wheels.length, solidTopAt(this.pos.x, this.pos.z, clearTop) - 0.2);
    return Math.max(g, this.floatY());
  }
  // Jumps. The car leaves the ground where the road drops away faster than gravity can pull it
  // down after it (checked a moment ahead along its path, so small bumps only make it light), then
  // flies ballistically. In the air it keeps the attitude it left with, the nose easing toward the
  // line it is flying along, and the wheels hang down. It lands on its springs: how hard is how fast
  // it meets the ground across the ground's own slope (landing on a downslope is gentle, as on a
  // real jump's landing ramp), and the body sinks, rebounds once and settles, rocking on the axle
  // that touched first. Only past the bump stops does the whole car bounce.
  vertical(dt, sp) {
    if (!dt) return;
    const G = 14;
    const ground = this.groundY();
    const gv = this.lastGround == null ? 0 : (ground - this.lastGround) / dt;
    this.landImpact = 0;
    if (!this.air) {
      this.vyPrev = lerp(this.vyPrev || 0, gv, 0.5);
      if (sp > 10 && !this.boatOn && this.boat < 0.5 && this.vyPrev > -3 && this.wouldFly(ground, this.vyPrev, G)) {
        this.air = true; this.airT = 0;
        this.vy = Math.min(this.vyPrev, 11);
        this.airPitch = this.pitch;
      } else this.vy = gv;
    }
    if (this.air) {
      this.airT += dt;
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      const path = -Math.atan2(this.vy, Math.max(6, Math.abs(this.vF))); // nose down as it falls
      this.airPitch = lerp(this.airPitch ?? 0, clamp(path * 0.55, -0.3, 0.4), Math.min(1, dt * 1.1));
      if (this.pos.y <= ground) {
        const impact = Math.max(0, gv - this.vy);
        this.pos.y = ground;
        this.landImpact = impact;
        // Into the springs, and the axle that touched first rocks the body.
        this.susV = (this.susV || 0) - Math.min(impact, 12) * 0.5;
        const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
        const slope = Math.atan2(this.groundAtPoint(this.pos.x - fx * 1.5, this.pos.z - fz * 1.5) - this.groundAtPoint(this.pos.x + fx * 1.5, this.pos.z + fz * 1.5), 3);
        this.rockV = (this.rockV || 0) + clamp(this.airPitch - slope, -0.4, 0.4) * Math.min(impact, 10) * 0.35;
        this.vF *= 1 - Math.min(0.12, impact * 0.008);
        if (impact > 9 && this.airT > 0.25) { this.vy = gv + (impact - 9) * 0.28; this.pos.y = ground + 0.02; this.airT = 0; }
        else { this.air = false; this.vy = gv; this.vyPrev = gv; this.landing = 0.1; this.pitch = this.airPitch; }
      }
    }
    this.lastGround = ground;
  }
  // The ground (land, landform or water surface) at a point, as the car's centre reads it.
  groundAtPoint(x, z) { return Math.max(heightAt(x, z), waterLevelAt(x, z) - this.draft()); }
  // Would the car, leaving now with vertical speed vy, stay clear of the ground just ahead?
  wouldFly(ground, vy, G) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = fz, rz = -fx;
    const vx = fx * this.vF + rx * this.vL, vz = fz * this.vF + rz * this.vL;
    const off = ground - this.groundAtPoint(this.pos.x, this.pos.z);
    for (const t of [0.1, 0.2]) {
      const g = this.groundAtPoint(this.pos.x + vx * t, this.pos.z + vz * t) + off;
      if (g > ground + vy * t - 0.5 * G * t * t - 0.12) return false;
    }
    return true;
  }
  // The springs: the body's height over its wheels (susY) and a pitch rock (rockP), each a damped
  // spring, about one rebound before they settle. Bump stops at 0.3 m.
  // The wheelie. Held, the front rises to the balance point (about 29 degrees) and hovers there,
  // wavering a little as a rider holds it on the throttle; let go (or slow right down, or leave
  // the ground) and it falls back, landing on the front tyre with a small bounce into the fork.
  wheelieStep(dt, want, air) {
    if (!dt) return;
    if (air) { this.wheelieV = 0; return; } // in the air it keeps its attitude
    const BAL = 0.5, t = this.bobT;
    const target = want ? BAL + Math.sin(t * 2.3) * 0.045 + Math.sin(t * 5.3 + 1) * 0.02 : 0;
    const w = want ? 5.5 : 8, z = want ? 0.75 : 0.5;
    const h = Math.min(dt, 1 / 30);
    for (let s = 0; s < dt - 1e-6; s += h) {
      const k = Math.min(h, dt - s);
      this.wheelieV += (-w * w * (this.wheelie - target) - 2 * z * w * this.wheelieV) * k;
      this.wheelie += this.wheelieV * k;
    }
    if (this.wheelie > 0.62) { this.wheelie = 0.62; this.wheelieV = Math.min(0, this.wheelieV); }
    if (this.wheelie < 0) {
      // Front tyre down: the fork takes the hit, and a fast drop bounces it up a touch.
      const hit = -this.wheelieV;
      this.wheelie = 0; this.wheelieV = hit > 1 ? hit * 0.18 : 0;
      if (hit > 0.4) { this.susV = (this.susV || 0) - Math.min(1.2, hit * 0.35); this.rockV = (this.rockV || 0) + Math.min(0.8, hit * 0.25); }
    }
  }

  suspend(dt) {
    this.susY = this.susY || 0; this.susV = this.susV || 0; this.rockP = this.rockP || 0; this.rockV = this.rockV || 0;
    this.rollP = this.rollP || 0; this.rollV = this.rollV || 0;
    if (!dt) return;
    const h = Math.min(dt, 1 / 30);
    for (let t = 0; t < dt - 1e-6; t += h) {
      const k = Math.min(h, dt - t);
      this.susV += (-100 * this.susY - 2 * 0.42 * 10 * this.susV) * k; this.susY += this.susV * k;
      this.rockV += (-81 * this.rockP - 2 * 0.45 * 9 * this.rockV) * k; this.rockP += this.rockV * k;
      // Side to side: a little stiffer than fore and aft (a car is narrower than it is long).
      this.rollV += (-110 * this.rollP - 2 * 0.4 * 10.5 * this.rollV) * k; this.rollP += this.rollV * k;
    }
    if (this.susY < -0.3) { this.susY = -0.3; this.susV = Math.max(0, this.susV); }
    if (this.susY > 0.12) { this.susY = 0.12; this.susV = Math.min(0, this.susV); }
    this.rockP = clamp(this.rockP, -0.12, 0.12);
    this.rollP = clamp(this.rollP, -0.09, 0.09);
  }

  setLights(dark) {
    // Full beam: brighter, reaching about twice as far, aimed higher up the road.
    const hb = !!this.highBeam;
    this.headlight.intensity = dark * (hb ? 1900 : 950);
    this.headlight.distance = hb ? 480 : 260;
    this.headlight.angle = hb ? 0.3 : 0.36;
    this.headlight.target.position.set(0, hb ? -0.6 : -2.6, 60);
    this.spread.intensity = dark * 320;
    this.lightMat.emissiveIntensity = 0.4 + dark * 1.4;
    this.tailMat.emissiveIntensity = 0.4 + dark * 0.6 + this.braking * 1.2;
  }
}
