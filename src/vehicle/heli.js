// The helicopter: a Eurocopter EC135 ("Elicopter SMURD Romania" by solid3DDD, CC BY 4.0,
// markings painted out; see tools/heli). Fly over the whole island and land on flat ground.
//
// Two ways to fly it (easy is the default; Settings, Helicopter):
// - Easy flies it like the car: Up (W, Go) takes off and flies forward, Down (S, Brake) slows to
//   a hover and, held once stopped, lets it down to land; Left and Right turn. It holds a cruise
//   height above the ground by itself, following hills and the coast, and Space / Shift (or the
//   Up and Down pads) raise or lower that height.
// - Manual is the full set of controls below.
//
// Flight follows what a light helicopter does, with the stabilisation a modern one has:
// - The rotor needs about five seconds to spool up before it can lift, and winds down when you
//   get out. Lift is the rotor's thrust, along the mast, and grows with the square of its speed.
// - Collective (Space / Shift, or Up and Down) sets the climb or descent; let go and it holds
//   its height. Near the ground the descent slows on its own so touchdowns are gentle, and
//   moving over rising ground it climbs to keep clear (a ground-proximity assist).
// - Cyclic (W / S, or Go and Brake) tilts the disc: nose down and the tilted thrust pulls you
//   forward, nose up to slow and stop. Let go and it eases back to a hover.
// - Pedals (A / D) yaw it. At speed it banks into the turn (bank from speed and turn rate, as a
//   real coordinated turn), the flight path follows the nose round, the tail fin swings the nose
//   into the airflow, and sideways drift is trimmed out. Drag grows with the square of airspeed,
//   which sets a top speed of about 225 km/h.
// - The wind pushes it, with a little turbulence that grows near the ground and in gusts, and
//   it shudders as it passes through translational lift (about 30 to 60 km/h).
// - Landing: it settles only where the ground under all four skid corners is within about 11
//   degrees of level, and never on water. A hard touchdown jolts it. Cliffs and mountains are
//   solid: fly into a face and it stops against it.
// - Empty (you have jumped out): an autopilot flies it, through the same easy controls. It stops
//   and hovers, then finds flat, dry, open ground nearby and lands there, clear of where you are,
//   and shuts down. Called, it starts up, flies over to flat ground beside you and lands (see fly).
import * as THREE from 'three';
import { loadGLTF } from '../world/gltf.js';
import { groundAt, waterLevelAt, BOUNDS } from '../world/terrain.js';
import { clamp, lerp } from '../world/noise.js';

const G = 9.81;
const MAX_PITCH = 0.35; // nose down at full forward cyclic (about 20 degrees)
const MAX_BANK = 0.52; // about 30 degrees
const CLIMB = 10, DESCEND = 7; // metres a second at full collective
const CEILING = 3600; // metres above the sea
const SPOOL = 0.2; // share of full rotor speed gained per second
const DRAG2 = 0.00072, DRAG1 = 0.012; // quadratic and linear drag
const LAND_SLOPE = 0.2; // steepest ground it settles on (rise over run, about 11 degrees)
const SKIDS = [[0.95, 1.6], [-0.95, 1.6], [0.95, -1.9], [-0.95, -1.9]]; // skid corners: across, along

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _up = new THREE.Vector3();

function glowTexture(rgb) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.2, `rgba(${rgb},0.9)`); grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// The blur a spinning rotor leaves: faint across the disc, a little darker near the hub, with the
// painted tips drawing a thin ring.
function discTexture(tip) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(30,30,32,0.42)'); grad.addColorStop(0.12, 'rgba(30,30,32,0.2)'); grad.addColorStop(0.8, 'rgba(36,36,38,0.13)');
  if (tip) { grad.addColorStop(0.87, 'rgba(36,36,38,0.12)'); grad.addColorStop(0.89, tip); grad.addColorStop(0.98, tip); }
  grad.addColorStop(1, 'rgba(36,36,38,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Heli {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.body = new THREE.Group(); // pitches and rolls with the airframe (the root turns with the heading)
    this.root.add(this.body);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0; this.pitch = 0; this.roll = 0;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.rpm = 0; this.engineOn = false; this.rotorAngle = 0; this.tailAngle = 0;
    this.collective = 0.6; this.landed = true; this.agl = 0; this.thrust = 0;
    this.impact = 0; this.shake = 0; this.warning = ''; this.t = 0; this.dark = 0;
    this.input = { fwd: 0, turn: 0, lift: 0 }; // smoothed, for the cockpit controls
    this.easy = true; // fly it like the car (see the top); false for the full controls
    this.cruise = 30; // easy: height to hold above the ground, metres
    this.gref = 0; // easy: the ground height it follows, smoothed
    this.landing = false; // easy: coming down to land (Down held while stopped)
    this.auto = null; // the autopilot's job when nobody is aboard (see fly)
    this.obstacles = null;
    this.ready = this.load();
  }

  async load() {
    const gltf = await loadGLTF(`${import.meta.env.BASE_URL}models/heli.glb`);
    const model = gltf.scene;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      if (m.transparent) { m.depthWrite = false; o.castShadow = false; o.renderOrder = 2; }
    });
    this.body.add(model);
    model.updateMatrixWorld(true);
    // Moving parts: the main rotor turns about its mast, the Fenestron fan about its axle.
    const blades = model.getObjectByName('blade_0'), fan = model.getObjectByName('blade_tail_2');
    this.mainHub = blades.parent; this.tailHub = fan.parent;
    // The blades fade as they speed up and a blurred disc takes over, as the eye sees them.
    this.bladeMats = [];
    // The rotors are not part of the body you walk round (see Walker's carBox).
    for (const part of [blades, fan]) part.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.userData.noBox = true; this.bladeMats.push(o.material); } });
    const box = new THREE.Box3().setFromObject(blades), hub = new THREE.Vector3(), v = new THREE.Vector3();
    this.mainHub.getWorldPosition(hub);
    // The rotor's radius: the farthest blade tip from the mast, whatever angle the blades rest at.
    let R = 0;
    blades.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); R = Math.max(R, Math.hypot(v.x - hub.x, v.z - hub.z)); } });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: discTexture('rgba(220,190,50,0.055)'), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }));
    disc.position.y = (box.min.y + box.max.y) / 2 - hub.y;
    disc.renderOrder = 3;
    this.mainHub.add(disc);
    const fbox = new THREE.Box3().setFromObject(fan), fr = Math.max(fbox.max.y - fbox.min.y, fbox.max.z - fbox.min.z) / 2;
    const fdisc = new THREE.Mesh(new THREE.CircleGeometry(fr, 32).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: discTexture(null), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }));
    fdisc.renderOrder = 3;
    this.tailHub.add(fdisc);
    this.discs = [disc, fdisc];
    disc.userData.noBox = fdisc.userData.noBox = true;
    disc.userData.blur = fdisc.userData.blur = true;
    this.rotorR = R;
    this.mastTop = hub.y;
    // The model's skids sit at its lowest point: that is the helicopter's height above the ground.
    // Its size is the airframe's, without the rotor.
    const all = new THREE.Box3();
    model.traverse((o) => { if (o.isMesh && !o.userData.noBox) all.expandByObject(o, true); });
    model.position.y = -all.min.y;
    this.size = all.getSize(new THREE.Vector3());
    this.tail = all.min.z; this.nose = all.max.z;
    // The pilot's eye, in the right-hand seat (the model's +x is the left side), in body space.
    this.eye = new THREE.Vector3(-0.42, 1.95 - all.min.y, 2.45);
    this.addLights(all);
    this.model = model;
    this.buildCockpit(model);
  }

  // The cockpit. Both cyclic sticks and both collective levers are part of the cabin mesh, so
  // the shader swings just their vertices about their pivots (the controls are linked, as dual
  // controls are), and the four flight displays show live instruments drawn on a canvas.
  buildCockpit(model) {
    let cabin = null;
    model.traverse((o) => { if (o.isMesh && o.material.name === 'interior') cabin = o; });
    this.body.updateMatrixWorld(true);
    if (cabin) {
      const toBody = new THREE.Matrix4().copy(this.body.matrixWorld).invert().multiply(cabin.matrixWorld);
      this.ctl = { uToBody: { value: toBody }, uFromBody: { value: toBody.clone().invert() }, uCyc: { value: new THREE.Vector2() }, uCol: { value: 0 } };
      const mat = cabin.material;
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.ctl);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform mat4 uToBody, uFromBody; uniform vec2 uCyc; uniform float uCol;
bool inBox(vec3 p, vec3 a, vec3 b) { return all(greaterThan(p, a)) && all(lessThan(p, b)); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }`).replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 b = (uToBody * vec4(transformed, 1.0)).xyz, q = b;
  mat3 cyc = rotZ(uCyc.y) * rotX(uCyc.x), col = rotX(uCol);
  if (inBox(b, vec3(-0.515, 0.998, 2.46), vec3(-0.335, 1.565, 2.795))) q = vec3(-0.425, 1.0, 2.62) + cyc * (b - vec3(-0.425, 1.0, 2.62));
  if (inBox(b, vec3(0.34, 0.998, 2.465), vec3(0.525, 1.565, 2.795))) q = vec3(0.432, 1.0, 2.62) + cyc * (b - vec3(0.432, 1.0, 2.62));
  if (inBox(b, vec3(-0.135, 1.012, 2.11), vec3(-0.02, 1.1, 2.755))) q = vec3(-0.077, 1.05, 2.12) + col * (b - vec3(-0.077, 1.05, 2.12));
  if (inBox(b, vec3(0.595, 1.012, 1.995), vec3(0.745, 1.23, 2.505))) q = vec3(0.67, 1.05, 2.0) + col * (b - vec3(0.67, 1.05, 2.0));
  transformed = (uFromBody * vec4(q, 1.0)).xyz;
}`);
      };
      mat.customProgramCacheKey = () => 'heli-cabin';
      mat.needsUpdate = true;
    }
    // Flight displays: the pilot's pair (right seat) and the copilot's, on the panel's face.
    this.screens = [];
    const W = 256, H = 204;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return { c, g: c.getContext('2d'), t }; };
    this.pfd = mk(); this.mfd = mk();
    const geo = new THREE.PlaneGeometry(0.112, 0.089).rotateY(Math.PI);
    for (const x of [-0.2675, 0.2675]) for (const [d, y] of [[this.pfd, 1.6435], [this.mfd, 1.5285]]) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: d.t, toneMapped: false }));
      m.position.set(x, y, 3.092);
      m.userData.noBox = true;
      this.body.add(m);
      this.screens.push(m);
    }
    this.screenT = 0;
  }

  // Primary flight display: the horizon tilting with pitch and bank, a pitch ladder, the bank
  // pointer, speed and altitude tapes, and the heading. The second display: rotor speed, engine
  // torque, height above the ground, climb rate and a compass rose.
  drawScreens() {
    const { g } = this.pfd, W = 256, H = 204, cx = W / 2, cy = H / 2 - 6;
    const pitchDeg = -this.pitch * 57.3, rollR = this.roll, ppd = 3.2; // pixels per degree of pitch
    g.save(); g.fillStyle = '#05080b'; g.fillRect(0, 0, W, H);
    g.beginPath(); g.rect(34, 12, W - 68, H - 44); g.clip();
    g.translate(cx, cy); g.rotate(rollR); g.translate(0, pitchDeg * ppd);
    g.fillStyle = '#2f7fd6'; g.fillRect(-300, -600, 600, 600);
    g.fillStyle = '#8a5a2b'; g.fillRect(-300, 0, 600, 600);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-300, 0); g.lineTo(300, 0); g.stroke();
    g.lineWidth = 1.5; g.font = 'bold 11px system-ui, sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let d = -30; d <= 30; d += 5) { if (!d) continue; const y = -d * ppd, w = d % 10 ? 14 : 28; g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke(); if (!(d % 10)) g.fillText(String(Math.abs(d)), -w - 4, y); }
    g.restore();
    // Aircraft symbol and bank pointer.
    g.strokeStyle = '#ffd23a'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 34, cy); g.lineTo(cx - 12, cy); g.lineTo(cx - 6, cy + 6); g.moveTo(cx + 34, cy); g.lineTo(cx + 12, cy); g.lineTo(cx + 6, cy + 6); g.stroke();
    g.fillStyle = '#ffd23a'; g.fillRect(cx - 2, cy - 2, 4, 4);
    g.save(); g.translate(cx, cy); g.rotate(rollR); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -70); g.lineTo(-6, -60); g.lineTo(6, -60); g.fill(); g.restore();
    // Tapes.
    const tape = (x, val, unit) => { g.fillStyle = 'rgba(10,14,18,0.92)'; g.fillRect(x, cy - 14, 34, 28); g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x + 0.5, cy - 13.5, 33, 27); g.fillStyle = '#fff'; g.font = 'bold 14px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(val, x + 17, cy + 1); g.font = '9px system-ui, sans-serif'; g.fillStyle = '#9fe8ff'; g.fillText(unit, x + 17, cy + 22); };
    tape(0, String(this.kmh), 'KM/H'); tape(W - 34, String(Math.max(0, Math.round(this.pos.y))), 'M');
    // Heading.
    const hdg = Math.round(((Math.PI - this.heading) * 57.3 % 360 + 360) % 360);
    g.fillStyle = '#0b1116'; g.fillRect(0, H - 30, W, 30);
    g.fillStyle = '#fff'; g.font = 'bold 15px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(String(hdg).padStart(3, '0') + '°', cx, H - 15);
    g.fillStyle = '#9fe8ff'; g.font = '10px system-ui, sans-serif'; g.fillText('HDG', cx - 46, H - 15);
    this.pfd.t.needsUpdate = true;

    const m = this.mfd.g;
    m.fillStyle = '#05080b'; m.fillRect(0, 0, W, H);
    const bar = (y, label, v, txt, warn) => {
      m.fillStyle = '#9fe8ff'; m.font = 'bold 12px system-ui, sans-serif'; m.textAlign = 'left'; m.fillText(label, 10, y);
      m.fillStyle = '#1b262e'; m.fillRect(52, y - 8, 120, 12);
      m.fillStyle = warn ? '#ffb43a' : '#41e08a'; m.fillRect(52, y - 8, 120 * clamp(v, 0, 1), 12);
      m.fillStyle = '#fff'; m.textAlign = 'right'; m.fillText(txt, W - 10, y + 2);
    };
    m.textBaseline = 'middle';
    bar(24, 'NR', this.rpm, Math.round(this.rpm * 100) + '%', this.rpm < 0.95);
    const trq = clamp(this.thrust / (1.8 * G), 0, 1);
    bar(50, 'TRQ', trq, Math.round(trq * 100) + '%', trq > 0.85);
    m.fillStyle = '#9fe8ff'; m.font = 'bold 12px system-ui, sans-serif'; m.textAlign = 'left';
    m.fillText('AGL', 10, 80); m.fillText('V/S', 10, 104);
    m.fillStyle = '#fff'; m.font = 'bold 18px system-ui, sans-serif';
    m.fillText(this.landed ? 'ON GROUND' : Math.round(this.agl) + ' m', 52, 80);
    const vs = this.vel.y; m.fillText((vs >= 0 ? '+' : '') + vs.toFixed(1) + ' m/s', 52, 104);
    // Compass rose, north up the dial turning with the heading.
    const rx = W / 2, ry = 160, R = 34;
    m.strokeStyle = '#3d5260'; m.lineWidth = 2; m.beginPath(); m.arc(rx, ry, R, 0, Math.PI * 2); m.stroke();
    m.save(); m.translate(rx, ry); m.rotate(-(Math.PI - this.heading));
    m.fillStyle = '#fff'; m.font = 'bold 11px system-ui, sans-serif'; m.textAlign = 'center';
    [['N', 0], ['E', 1], ['S', 2], ['W', 3]].forEach(([l, k]) => { m.save(); m.rotate(k * Math.PI / 2); m.fillStyle = l === 'N' ? '#ff6a5a' : '#fff'; m.fillText(l, 0, -R + 9); m.restore(); });
    m.restore();
    m.fillStyle = '#ffd23a'; m.beginPath(); m.moveTo(rx, ry - 12); m.lineTo(rx - 7, ry + 8); m.lineTo(rx + 7, ry + 8); m.fill();
    this.mfd.t.needsUpdate = true;
  }

  // Navigation lights: red to port (left), green to starboard, white at the tail, and a red
  // beacon on the roof that flashes, as on every helicopter, plus white strobes.
  addLights(box) {
    const add = (rgb, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(rgb), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.userData.size = size; s.renderOrder = 4; this.body.add(s); return s; };
    const y0 = -box.min.y;
    this.nav = {
      port: add('255,40,30', 0.7), star: add('40,255,90', 0.7), tail: add('255,255,240', 0.55),
      beacon: add('255,30,20', 1.4), strobe: add('240,248,255', 1.8),
    };
    this.nav.port.position.set(box.max.x * 0.62, y0 + box.max.y * 0.35, -1.0);
    this.nav.star.position.set(box.min.x * 0.62, y0 + box.max.y * 0.35, -1.0);
    this.nav.tail.position.set(0, y0 + box.max.y * 0.55, box.min.z + 0.1);
    this.nav.beacon.position.set(0, y0 + box.max.y * 0.72, -1.6);
    this.nav.strobe.position.set(0, y0 + 0.15, 0.4);
  }

  place(x, z, heading) {
    this.pos.set(x, this.floor(x, z).y, z);
    this.vel.set(0, 0, 0);
    this.heading = heading; this.pitch = 0; this.roll = 0; this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.landed = true; this.agl = 0; this.auto = null;
    this.sync();
  }

  // What the skids would rest on: the land, any landform or rock on it, or the water.
  floor(x, z) {
    const land = Math.max(groundAt(x, z), this.obstacles ? this.obstacles.topAt(x, z) : -Infinity);
    const wl = waterLevelAt(x, z);
    return land < wl - 0.2 ? { y: wl, water: true } : { y: land, water: false };
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get kmh() { return Math.round(this.speed * 3.6); }
  get vF() { return this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading); }

  // input: { throttle, steer, lift } as from Input, or null to leave it to itself (parked).
  update(dt, input, wind) {
    if (!this.model || dt <= 0) { if (this.model) this.sync(); return; }
    this.t += dt;
    this.warning = '';
    const flying = !!input && this.engineOn;
    const fwd = flying ? input.throttle : 0, turn = flying ? input.steer : 0, lift = flying ? input.lift : 0;
    const k = Math.min(1, dt * 6);
    this.input.fwd = lerp(this.input.fwd, fwd, k); this.input.turn = lerp(this.input.turn, turn, k); this.input.lift = lerp(this.input.lift, lift, k);

    // Rotor speed: spools up with the engine on, winds down slowly with it off.
    this.rpm = this.engineOn ? Math.min(1, this.rpm + dt * SPOOL * (this.easy ? 1.7 : 1) * (0.6 + this.rpm)) : Math.max(0, this.rpm - dt * 0.07);
    const power = this.rpm * this.rpm;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading); // forward
    const lx = fz, lz = -fx; // left
    const vF = this.vel.x * fx + this.vel.z * fz, vL = this.vel.x * lx + this.vel.z * lz, sp = Math.hypot(vF, vL);
    const here = this.floor(this.pos.x, this.pos.z);
    this.agl = this.pos.y - here.y;

    if (this.landed) {
      // On the skids: it lifts once the rotor can carry it and you pull up.
      this.vel.set(0, 0, 0);
      this.pos.y = here.y;
      const slope = this.slopeUnder();
      this.pitch = lerp(this.pitch, slope.pitch, k); this.roll = lerp(this.roll, slope.roll, k);
      this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
      this.thrust = power * 0.6;
      const go = lift > 0.1 || (this.easy && fwd > 0.1);
      if (go && this.rpm > 0.88) { this.landed = false; this.vel.y = 0.5; this.landing = false; this.cruise = Math.max(this.cruise, 30); this.gref = here.y; }
      else if (go && this.engineOn) this.warning = 'spooling';
      this.sync(dt);
      return;
    }

    // Pedals: yaw rate, quicker in the hover than at speed.
    const yawMax = lerp(1.05, 0.55, clamp(sp / 45, 0, 1));
    this.yawRate += (turn * yawMax - this.yawRate) * Math.min(1, dt * 2.6);
    // The tail fin weathervanes the nose into the airflow at speed.
    let vane = 0;
    if (vF > 8) vane = wrap(Math.atan2(this.vel.x, this.vel.z) - this.heading) * 0.6 * clamp((vF - 8) / 25, 0, 1);
    this.heading = wrap(this.heading + (this.yawRate + vane) * dt);

    // Cyclic targets, with the stabiliser trimming out speed and drift when you let go.
    let pitchT = fwd > 0.05 ? MAX_PITCH * fwd : fwd < -0.05 ? 0.7 * MAX_PITCH * fwd : clamp(-vF * 0.011, -0.2, 0.2);
    // Easy: Down brakes to a hover (nose up as hard as the speed needs) and never flies backwards.
    if (this.easy && fwd < -0.05) pitchT = clamp(-vF * 0.03, -1.2 * MAX_PITCH, 0.12);
    if (fwd > 0.05 && vF < -2) pitchT = Math.max(pitchT, 0.15); // nose down to stop going backwards
    let rollT = -Math.atan(clamp(vF, 0, 80) * this.yawRate / G) + clamp(vL * 0.035, -0.25, 0.25);
    // Turbulence: more near the ground, in gusts and in the wind.
    const gust = wind ? wind.strength : 0, rough = (0.006 + gust * 0.0025) * (1 + 1.5 * clamp(1 - this.agl / 120, 0, 1));
    pitchT += rough * (Math.sin(this.t * 1.7) + 0.6 * Math.sin(this.t * 3.9 + 1.3));
    rollT += rough * (Math.sin(this.t * 2.1 + 0.5) + 0.6 * Math.sin(this.t * 4.7 + 2.1));
    rollT = clamp(rollT, -MAX_BANK, MAX_BANK);
    // Attitude follows on critically damped springs: smooth, with no overshoot.
    const K = 9, D = 6;
    this.pitchRate += (K * (pitchT - this.pitch) - D * this.pitchRate) * dt;
    this.rollRate += (K * (rollT - this.roll) - D * this.rollRate) * dt;
    this.pitch += this.pitchRate * dt; this.roll += this.rollRate * dt;

    // Collective: a climb or descent rate, held by the governor; let go and it holds height.
    let vyT = lift > 0.05 ? CLIMB * lift : lift < -0.05 ? DESCEND * lift : 0;
    if (this.easy) {
      // Down held once nearly stopped: come down to land. Let go and it holds where it is.
      const wasLanding = this.landing;
      this.landing = fwd < -0.3 && sp < 4;
      if (wasLanding && !this.landing) this.cruise = Math.max(4, this.agl);
      if (this.landing && !wasLanding) this.warning = 'landing';
      // The ground it follows: the highest point under and just ahead of it, rising quickly
      // and sinking slowly so it does not dip into every gully.
      let g = Math.max(here.y, here.water ? here.y : -Infinity);
      for (const t of [0.6, 1.5, 3]) g = Math.max(g, this.floor(this.pos.x + this.vel.x * t, this.pos.z + this.vel.z * t).y);
      this.gref += (g - this.gref) * Math.min(1, dt * (g > this.gref ? 3 : 0.7));
      this.cruise = clamp(this.cruise + lift * 14 * dt, 4, 900);
      // The autopilot comes down quickly from high up (a pilot would too, with nobody aboard).
      const down = this.auto && this.agl > 80 ? DESCEND * 3 : DESCEND;
      vyT = this.landing ? -down : clamp((this.gref + this.cruise - this.pos.y) * 0.7, -down, CLIMB);
    }
    // Close to the ground the descent eases off for a gentle touchdown; over water it will not
    // go below a safe hover.
    if (vyT < 0) vyT = Math.max(vyT, -clamp(0.8 + this.agl * 0.35, 0.8, this.auto && this.agl > 80 ? DESCEND * 3 : DESCEND));
    if (here.water && this.agl < 2.5) vyT = Math.max(vyT, (2.5 - this.agl) * 0.8);
    if (here.water && this.agl < 3.5 && lift < -0.05) this.warning = 'water';
    if (this.pos.y > CEILING) vyT = Math.min(vyT, (CEILING - this.pos.y) * 0.5);
    // Ground proximity: moving with the collective at rest or up, it looks ahead along its path
    // and climbs to keep clear of rising ground, more at speed. Coming down on purpose, it lets you.
    if (lift > -0.05 && sp > 3) {
      let ahead = here.y;
      for (const t of [0.5, 1.2, 1 + sp / 20]) ahead = Math.max(ahead, this.floor(this.pos.x + this.vel.x * t, this.pos.z + this.vel.z * t).y);
      vyT = Math.max(vyT, clamp((ahead + 3 + sp * 0.12 - this.pos.y) * 1.2, 0, CLIMB * 1.5));
    }
    _e.set(this.pitch, this.heading, this.roll); _q.setFromEuler(_e); _up.set(0, 1, 0).applyQuaternion(_q);
    const tilt = Math.max(0.2, _up.y);
    // Ground effect: within a rotor's width of the ground the same power lifts more.
    const groundEffect = 1 + 0.12 * clamp(1 - this.agl / (this.rotorR * 2), 0, 1);
    const want = ((vyT - this.vel.y) * 2.2 + G) / tilt / groundEffect;
    this.thrust = clamp(want, 0, 1.8 * G * power);
    const T = this.thrust * groundEffect;
    // Forces: thrust along the mast, gravity, drag on the airspeed (the wind carries it along).
    const ax = T * _up.x, az = T * _up.z, ay = T * _up.y - G;
    const wx = wind ? wind.x * 0.6 : 0, wz = wind ? wind.z * 0.6 : 0;
    const rx = this.vel.x - wx, rz = this.vel.z - wz, air = Math.hypot(rx, rz);
    const drag = DRAG1 + DRAG2 * air;
    this.vel.x += (ax - drag * rx) * dt;
    this.vel.z += (az - drag * rz) * dt;
    this.vel.y += (ay - this.vel.y * 0.3) * dt;
    // Easy: braking also bleeds speed off directly, so it stops in a few seconds, not half a minute.
    if (this.easy && fwd < -0.05 && !this.landed) { const k = Math.exp(-dt * 0.55); this.vel.x *= k; this.vel.z *= k; }
    // Coordinated turn: in a banked turn the rotor's sideways pull swings the flight path round
    // with the nose, so a turn keeps its speed instead of skidding wide.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 5) {
      const along = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
      const target = along >= 0 ? this.heading : this.heading + Math.PI;
      const da = wrap(target - Math.atan2(this.vel.x, this.vel.z));
      const turnBy = da * Math.min(1, dt * 1.6) * clamp((hs - 5) / 10, 0, 1);
      const c = Math.cos(turnBy), sn = Math.sin(turnBy), nx = this.vel.x * c + this.vel.z * sn, nz = -this.vel.x * sn + this.vel.z * c;
      this.vel.x = nx; this.vel.z = nz;
    }
    // Soft walls at the edge of the map.
    const m = 500, ox = Math.max(0, BOUNDS.minX - m - this.pos.x) - Math.max(0, this.pos.x - BOUNDS.maxX - m), oz = Math.max(0, BOUNDS.minZ - m - this.pos.z) - Math.max(0, this.pos.z - BOUNDS.maxZ - m);
    if (ox || oz) { this.vel.x += ox * 0.4 * dt; this.vel.z += oz * 0.4 * dt; this.warning = 'edge'; }

    // Move, with the ground and cliffs solid.
    const step = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (step > 1e-4) {
      // A face ahead taller than the rotor head is a wall: the helicopter stops against it.
      const dx = this.vel.x / (step / dt), dz = this.vel.z / (step / dt);
      const reach = Math.max(this.size.z * 0.5, this.rotorR) + step;
      const ahead = this.floor(this.pos.x + dx * reach, this.pos.z + dz * reach).y;
      if (ahead > this.pos.y + this.mastTop * 0.6) {
        const into = this.vel.x * dx + this.vel.z * dz;
        this.vel.x -= dx * into; this.vel.z -= dz * into;
        if (into > 6) { this.impact = Math.min(1, into / 25); this.shake = Math.max(this.shake, this.impact); }
        this.warning ||= 'wall';
      }
    }
    this.pos.addScaledVector(this.vel, dt);
    // Buildings, walls and trees at low height.
    if (this.obstacles && this.agl < 12) {
      const hit = this.obstacles.resolve(this.pos, Math.max(2.2, this.size.x * 0.5), true);
      if (hit) { const into = this.vel.x * -hit.nx + this.vel.z * -hit.nz; if (into > 0) { this.vel.x += hit.nx * into; this.vel.z += hit.nz * into; } }
    }
    const under = this.floor(this.pos.x, this.pos.z);
    if (this.pos.y <= under.y) {
      const vy = this.vel.y;
      this.pos.y = under.y;
      if (this.vel.y < 0) this.vel.y = 0;
      const slope = this.slopeUnder();
      if (under.water) this.warning = 'water';
      else if (slope.steep) { this.warning = 'steep'; this.vel.y = Math.max(this.vel.y, 1.2); }
      else if (this.speed > 4) { this.vel.x *= 0.9; this.vel.z *= 0.9; this.warning = 'fast'; }
      else if (this.easy ? this.landing || this.cruise <= 4.5 : lift <= 0.05) {
        this.landed = true; this.landing = false;
        this.impact = clamp((-vy - 1.5) / 5, 0, 1);
        if (this.impact > 0.25) { this.shake = Math.max(this.shake, this.impact); this.warning = 'hard'; }
        this.touchdown = true;
      }
    }
    // Translational lift: a shudder through the airframe as it gains forward speed.
    const etl = clamp(1 - Math.abs(sp - 12) / 6, 0, 1);
    this.shake = Math.max(this.shake * Math.exp(-dt * 3), etl * 0.06);
    this.agl = this.pos.y - under.y;
    this.sync(dt);
  }

  // ---------- Autopilot ----------
  // A place to land near (x, z): dry, nearly level across the skids' footprint, with nothing built
  // on it, and at least clear metres from avoid (where you are). Rings outward; null if none.
  findPad(x, z, avoid = null, clear = 30, maxR = 3000) {
    const ok = (px, pz) => {
      if (avoid && Math.hypot(px - avoid.x, pz - avoid.z) < clear) return false;
      let lo = Infinity, hi = -Infinity;
      for (const [a, b] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]]) {
        const f = this.floor(px + a, pz + b);
        if (f.water) return false;
        const g = groundAt(px + a, pz + b);
        if (f.y > g + 0.3) return false; // a roof, a wall
        lo = Math.min(lo, f.y); hi = Math.max(hi, f.y);
      }
      return hi - lo < 0.9;
    };
    for (let r = 0; r <= maxR; r += r < 200 ? 8 : 25) {
      const n = r === 0 ? 1 : Math.max(12, Math.min(40, Math.round(r / 6)));
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return { x: px, z: pz }; }
    }
    return null;
  }
  // Fly it empty: phase 'park' (land near here, where you jumped) or 'come' (to you, at avoid).
  autopilot(phase, avoid) {
    this.auto = { phase, t: 0, pad: null, avoid: avoid ? { x: avoid.x, z: avoid.z } : null, tries: 0, bad: [] };
    this.engineOn = true; this.landing = false;
  }
  // Each frame while nobody is at the controls: the autopilot if it has a job, else parked.
  // avoid: where you are now (it never lands on you).
  fly(dt, wind, avoid = null) {
    const A = this.auto;
    if (!A || dt <= 0) { this.update(dt, null, wind); return; }
    A.t += dt;
    if (avoid) A.avoid = { x: avoid.x, z: avoid.z };
    const inp = { throttle: 0, steer: 0, lift: 0 };
    const sp = this.speed;
    // Where to land: chosen once it has slowed (after a jump) or straight away (called).
    if (!A.pad && (A.phase === 'come' || A.t > 2.5)) {
      const c = A.phase === 'come' && A.avoid ? A.avoid : this.pos;
      A.pad = this.findPad(c.x, c.z, A.avoid, A.phase === 'come' ? 18 : 30);
      if (!A.pad) A.none = true;
      this.cruise = Math.min(Math.max(this.cruise, 45), 90);
    }
    if (this.landed && A.pad && Math.hypot(this.pos.x - A.pad.x, this.pos.z - A.pad.z) < 12 && A.t > 3) {
      // Down: shut down and wait.
      this.auto = null; this.engineOn = false; this.parkedAt = { x: this.pos.x, z: this.pos.z };
      this.update(dt, null, wind); return;
    }
    if (!A.pad) inp.throttle = this.landed ? 0 : -0.2; // stop and hover
    else {
      const dx = A.pad.x - this.pos.x, dz = A.pad.z - this.pos.z, dist = Math.hypot(dx, dz);
      const err = wrap(Math.atan2(dx, dz) - this.heading);
      // You walked under it: find somewhere else.
      if (A.avoid && Math.hypot(A.pad.x - A.avoid.x, A.pad.z - A.avoid.z) < 14) { A.pad = null; A.t = 3; this.update(dt, inp, wind); return; }
      if (this.landed) inp.throttle = 1; // take off (once the rotor is up to speed)
      else if (dist > 9) {
        inp.steer = clamp(err * 1.6, -1, 1);
        const want = clamp(dist * 0.22, 3, 45) * (Math.abs(err) < 0.6 ? 1 : 0.2);
        inp.throttle = sp > want + 2 ? -0.25 : clamp((want - sp) / 8, 0, 1);
      } else inp.throttle = sp > 3.5 ? -0.25 : -1; // over the pad: stop, then down
      // Stuck on bad ground (steep, water) while landing: try the next pad.
      if (this.warning === 'steep' || this.warning === 'water') { A.stuck = (A.stuck || 0) + dt; if (A.stuck > 2.5) { A.bad.push(A.pad); A.pad = this.findPad(A.pad.x + 40, A.pad.z, A.avoid, 30); A.stuck = 0; } }
    }
    const e = this.easy; this.easy = true;
    this.update(dt, inp, wind);
    this.easy = e;
  }

  // The ground under the four skid corners: how it slopes, and whether that is too steep to land.
  slopeUnder() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), lx = fz, lz = -fx;
    const h = SKIDS.map(([a, b]) => this.floor(this.pos.x + lx * a + fx * b, this.pos.z + lz * a + fz * b).y);
    const len = SKIDS[0][1] - SKIDS[2][1], wid = SKIDS[0][0] - SKIDS[1][0];
    const along = ((h[0] + h[1]) - (h[2] + h[3])) / 2 / len, across = ((h[0] + h[2]) - (h[1] + h[3])) / 2 / wid;
    const spread = Math.max(...h) - Math.min(...h);
    return { pitch: -Math.atan(along), roll: Math.atan(across), steep: Math.hypot(along, across) > LAND_SLOPE || spread > LAND_SLOPE * len * 1.2 };
  }

  sync(dt = 0) {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this.body.rotation.set(this.pitch, 0, this.roll);
    if (!this.model) return;
    // The main rotor turns at about 6.6 turns a second, the fan about eleven times faster.
    this.rotorAngle = (this.rotorAngle + this.rpm * 41 * dt) % (Math.PI * 2);
    this.tailAngle = (this.tailAngle + this.rpm * 260 * dt) % (Math.PI * 2);
    this.mainHub.rotation.y = this.rotorAngle;
    // Controls follow the pilot's hands; the displays redraw ten times a second when seen.
    if (this.ctl) {
      this.ctl.uCyc.value.set(this.input.fwd * 0.13, -this.input.turn * 0.1);
      this.ctl.uCol.value = -clamp((this.thrust / G - 0.55) * 0.35, -0.03, 0.21);
    }
    if (this.screens && this.cockpitOn) { this.screenT -= dt; if (this.screenT <= 0) { this.screenT = 0.1; this.drawScreens(); } }
    this.tailHub.rotation.x = this.tailAngle;
    const blur = clamp((this.rpm - 0.15) / 0.5, 0, 1);
    for (const m of this.bladeMats) { m.opacity = 1 - 0.8 * blur; m.depthWrite = blur < 0.5; }
    this.discs[0].material.opacity = blur * 0.9;
    this.discs[1].material.opacity = blur * 0.8;
    // Beacon: two quick red flashes a second; strobe: a white flash every 1.3 s while flying.
    if (this.nav) {
      const on = this.engineOn || this.rpm > 0.05;
      const b = (this.t * 1.0) % 1;
      this.nav.beacon.visible = on && (b < 0.08 || (b > 0.18 && b < 0.26));
      this.nav.strobe.visible = on && !this.landed && (this.t % 1.3) < 0.05;
      this.nav.port.visible = this.nav.star.visible = this.nav.tail.visible = on;
      // Small points by day, glowing halos at night.
      const k = 0.22 + 0.78 * this.dark;
      for (const l of Object.values(this.nav)) { l.scale.setScalar(l.userData.size * k); l.material.opacity = 0.55 + 0.45 * this.dark; }
    }
  }
}
