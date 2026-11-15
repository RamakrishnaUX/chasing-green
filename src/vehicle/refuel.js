import * as THREE from 'three';
import { nozzleGeometry, NOZZLE_TAIL, NOZZLE_TIP } from '../world/stations.js';
import { reach, wpos } from './driver.js';
import { bonesOf } from './skydiver.js';

// Filling up by hand. Press Refuel under a station's roof and the driver gets out at his door,
// walks round to the pump, lifts the nozzle out of its holster (its hose coming with it), walks
// back to the car's filler (the side facing the pump; the top of the tank on the bike), and holds
// the nozzle in it while the tank fills. Full (or stopped with Refuel again), he takes it back,
// hangs it up and gets back in. He walks on the walker's own legs and clips (walker.js), steered
// along a few waypoints; only his right arm is posed on top, by reach (driver.js).
//
// Phases: out, toPump, take, toCap, fill, toPump2, hang, toDoor, in.

const HOSE = 3.6; // metres of hose: it hangs slack near the pump and lies on the ground near the car
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (u) => u * u * (3 - 2 * u);

export class RefuelScene {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.phase = '';
    this.nozzle = new THREE.Mesh(nozzleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }));
    this.nozzle.castShadow = true; this.nozzle.visible = false; this.nozzle.matrixAutoUpdate = false;
    this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.55, metalness: 0.1 });
    this.hose = new THREE.Mesh(new THREE.BufferGeometry(), this.hoseMat);
    this.hose.castShadow = true; this.hose.visible = false; this.hose.frustumCulled = false;
    scene.add(this.nozzle, this.hose);
    this.nozzleM = new THREE.Matrix4();
  }

  // car: the Jeep; walker: already standing at the car (walker.enter); face: the pump face
  // (stations.faceNear); stations: to lift and hang the nozzle; ground(x, z): the ground's height.
  begin({ car, walker, face, stations, ground, onFill, onDone }) {
    this.car = car; this.walker = walker; this.face = face; this.stations = stations; this.ground = ground;
    this.onFill = onFill; this.onDone = onDone;
    this.bones = walker.man ? bonesOf(walker.man) : null;
    const h = car.heading, f = new THREE.Vector3(Math.sin(h), 0, Math.cos(h)), l = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
    const B = walker.car || { cx: 0, cz: 0, hx: 1, hz: 2.2, top: 1.6 };
    this.B = B; this.f = f; this.l = l;
    const at = (x, z) => new THREE.Vector3(car.pos.x + l.x * x + f.x * z, 0, car.pos.z + l.z * x + f.z * z);
    // Which side of the car the pump is on (+1 his door's side, the car's left).
    const fp = face.root;
    const sgn = Math.sign((fp.x - car.pos.x) * l.x + (fp.z - car.pos.z) * l.z) || 1;
    const bike = !!car.model.bike;
    const S = face.s, side = face.side;
    // Where he can stand: clear of the car's body (by more than the walker keeps clear of it) and of
    // the forecourt's solid parts. Each spot below is a list of choices, best first; the first one
    // free is used, so a car parked tight against the island still gets filled (he steps onto the
    // kerb, or round the corner of the car).
    this.free = (x, z) => !this.inCar(x, z, 0.34) && !stations.solidAt(S, x, z, 0.24);
    const pick = (list) => list.find((p) => this.free(p.x, p.z)) || list[0];
    // The shortest errand: of the free spots, the one nearest the next (dist(p) is how far from p).
    const nearest = (list, dist) => { let b = null, bd = Infinity; for (const p of list) { const q = p.p || p; if (!this.free(q.x, q.z)) continue; const d = dist(q); if (d < bd) { bd = d; b = p; } } return b; };
    const sideFiller = bike ? at(sgn * (B.hx + B.cx + 0.42), B.cz + B.hz * 0.05) : at(sgn * (B.hx + B.cx + 0.45), B.cz - B.hz * 0.5);
    // At the pump: in front of its face, off the kerb if there is room, else on it; of those, the
    // nearest the car's filler.
    const pumpList = [];
    for (const c of [0.95, 0.82, 0.7, 0.62]) for (const w of [0.3, 0.12, 0.48, -0.06, 0.66]) { const q = stations.point(S, face.u + side * c, w); pumpList.push(new THREE.Vector3(q.x, 0, q.z)); }
    const pump = nearest(pumpList.filter((q) => Math.hypot(q.x - face.root.x, q.z - face.root.z) < 1.05), (q) => q.distanceTo(sideFiller)) || pick(pumpList);
    // At the filler: beside it (pump side, rear quarter), nearer the car or further along it if
    // that is where there is room; failing that, round the back corner, with the filler there.
    const capList = [];
    if (bike) {
      for (const d of [0.45, 0.38]) for (const z of [0.05, 0.2, -0.1, 0.35, -0.25]) capList.push({ p: at(sgn * (B.hx + B.cx + d), B.cz + B.hz * z), z: B.cz + B.hz * 0.12 });
    } else {
      for (const d of [0.5, 0.42, 0.37]) for (const z of [-0.5, -0.38, -0.62, -0.25, -0.74]) capList.push({ p: at(sgn * (B.hx + B.cx + d), B.cz + B.hz * z), z: B.cz + B.hz * z });
      for (const x of [0.4, 0.1, 0.7]) capList.push({ p: at(sgn * (B.hx * x + B.cx + (x > 0.6 ? 0.25 : 0)), B.cz - B.hz - 0.4), z: B.cz - B.hz + 0.3, behind: true });
    }
    // Beside the filler if there is room (the spot along the car nearest the pump), else round the back.
    const cs = nearest(capList.filter((c) => !c.behind), (q) => q.distanceTo(pump)) || nearest(capList, (q) => q.distanceTo(pump)) || capList[0];
    const capStand = cs.p;
    this.cap = bike
      ? at(0, cs.z).setY(car.pos.y + B.top * 0.74)
      : at(sgn * (B.hx - (cs.behind ? 0.08 : 0.02)) + B.cx, cs.z).setY(car.pos.y + Math.min(1.05, B.top * 0.5));
    this.out = cs.behind ? f.clone().negate() : l.clone().multiplyScalar(sgn); // the way out of the car at the filler
    // At his door, where he gets out and back in.
    // On the bike he swings his leg over on the pump's side; out of a car, it is his door.
    const dside = bike ? sgn : 1;
    const doorList = [];
    for (const d of [0.55, 0.45, 0.38]) for (const z of [0.12, 0.3, -0.05, 0.45, -0.2]) doorList.push(at(dside * (B.hx + B.cx + d), B.cz + B.hz * z));
    doorList.push(at(dside * B.hx * 0.6, B.cz - B.hz - 0.45));
    const door = bike ? (nearest(doorList, (q) => q.distanceTo(pump)) || doorList[0]) : pick(doorList);
    const facePump = Math.atan2(face.root.x - pump.x, face.root.z - pump.z);
    const faceCap = Math.atan2(this.cap.x - capStand.x, this.cap.z - capStand.z);
    this.spots = { pump, capStand, door };
    this.paths = {
      toPump: { to: pump, facing: facePump },
      toCap: { to: capStand, facing: faceCap },
      toPump2: { to: pump, facing: facePump },
      toDoor: { to: door, facing: car.heading },
    };
    walker.pos.set(door.x, ground(door.x, door.z), door.z);
    walker.heading = Math.atan2(pump.x - door.x, pump.z - door.z); // stepping out toward the pump
    this.active = true; this.go('out');
    this.carry = 0; // 1 while the nozzle is in his hand
    this.armW = 0;
    this.filling = false;
    // Down the gap between the car and the pump, from ahead of the car and a little above: the
    // car on one side, the pump on the other, and him in between.
    const mid = pump.clone().lerp(capStand, 0.5);
    const toLane = new THREE.Vector3(face.n.x, 0, face.n.z);
    this.shot = {
      eye: mid.clone().addScaledVector(f, 5.6).addScaledVector(toLane, 0.5).setY(car.pos.y + 2.5),
      at: mid.clone().addScaledVector(f, -1.2).setY(car.pos.y + 0.85),
    };
    this.makeScreen();
  }

  // Inside the car's body grown by r (its own frame, as the walker measures it).
  inCar(x, z, r) {
    const B = this.B, c = this.car, dx = x - c.pos.x, dz = z - c.pos.z;
    const lx = dx * this.l.x + dz * this.l.z - B.cx, lz = dx * this.f.x + dz * this.f.z - B.cz;
    return Math.abs(lx) < B.hx + r && Math.abs(lz) < B.hz + r;
  }

  // A way from (x, z) to `to` round the car and the forecourt's solid parts: a search over a 0.2 m
  // grid (8 ways), then the corners cut wherever the straight line between is clear. Returns
  // waypoints ending at `to`.
  route(from, to) {
    const clear = (a, b) => { const n = Math.ceil(a.distanceTo(b) / 0.1); for (let i = 1; i < n; i++) { const t = i / n; if (!this.free(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; } return true; };
    const A = new THREE.Vector3(from.x, 0, from.z);
    if (clear(A, to)) return [to.clone()];
    const G = 0.2, x0 = Math.min(A.x, to.x) - 6, z0 = Math.min(A.z, to.z) - 6;
    const nx = Math.ceil((Math.max(A.x, to.x) + 6 - x0) / G), nz = Math.ceil((Math.max(A.z, to.z) + 6 - z0) / G);
    const id = (i, j) => j * nx + i, cell = (p) => [Math.round((p.x - x0) / G), Math.round((p.z - z0) / G)];
    const ok = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) ok[id(i, j)] = this.free(x0 + i * G, z0 + j * G) ? 1 : 0;
    const [si, sj] = cell(A), [gi, gj] = cell(to);
    ok[id(si, sj)] = 1; ok[id(gi, gj)] = 1; // he is where he is; the spot was chosen free
    const g = new Float32Array(nx * nz).fill(Infinity), prev = new Int32Array(nx * nz).fill(-1), done = new Uint8Array(nx * nz);
    const open = [id(si, sj)]; g[open[0]] = 0;
    const hh = (k) => Math.hypot((k % nx) - gi, Math.floor(k / nx) - gj);
    const goal = id(gi, gj);
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (g[open[k]] + hh(open[k]) < g[open[bi]] + hh(open[bi])) bi = k;
      const cur = open[bi]; open.splice(bi, 1);
      if (cur === goal) break;
      if (done[cur]) continue; done[cur] = 1;
      const ci = cur % nx, cj = Math.floor(cur / nx);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const k = id(ni, nj);
        if (!ok[k] || done[k] || (di && dj && (!ok[id(ci + di, cj)] || !ok[id(ci, cj + dj)]))) continue;
        const ng = g[cur] + (di && dj ? 1.414 : 1);
        if (ng < g[k]) { g[k] = ng; prev[k] = cur; open.push(k); }
      }
    }
    if (prev[goal] < 0) return [to.clone()];
    const pts = [];
    for (let k = goal; k >= 0; k = prev[k]) pts.push(new THREE.Vector3(x0 + (k % nx) * G, 0, z0 + Math.floor(k / nx) * G));
    pts.reverse(); pts[pts.length - 1] = to.clone();
    // Cut corners: from each kept point, on to the furthest one in a clear straight line.
    const out = []; let a = A;
    for (let i = 0; i < pts.length;) {
      let j = pts.length - 1;
      while (j > i && !clear(a, pts[j])) j--;
      out.push(pts[j]); a = pts[j]; i = j + 1;
    }
    return out;
  }

  go(phase) {
    this.phase = phase; this.t = 0; this.wp = 0; this.arrived = false; this.holdT = 0;
    const P = this.paths?.[phase];
    if (P) {
      P.pts = this.route(this.walker.pos, P.to); this.best = Infinity; this.bestT = 0;
      let len = 0, a = this.walker.pos; for (const q of P.pts) { len += Math.hypot(q.x - a.x, q.z - a.z); a = q; }
      P.limit = len / 0.9 + 3; // longer than any honest walk there takes
      P.len = len;
    }
  }

  // What the walker is told to do this frame: walk toward the next waypoint (steered by setting his
  // heading), slowing to stop on the last, then turning to face what he came for.
  input(dt) {
    const W = this.walker, P = this.paths[this.phase];
    const inp = { throttle: 0, steer: 0, walk: true };
    if (!P?.pts) return inp;
    const tgt = P.pts[Math.min(this.wp, P.pts.length - 1)];
    const dx = tgt.x - W.pos.x, dz = tgt.z - W.pos.z, d = Math.hypot(dx, dz);
    const last = this.wp >= P.pts.length - 1;
    // Getting no closer (pressed against something): within reach, he stops there; held up for
    // long, he steps the last bit.
    if (d < this.best - 0.03) { this.best = d; this.bestT = this.t; }
    const stalled = this.t - this.bestT > 0.9;
    if (stalled && !last) { this.wp++; this.best = Infinity; this.bestT = this.t; return this.input(dt); }
    if (this.t > P.limit || (stalled && last && d > 0.6)) { W.pos.x = P.to.x; W.pos.z = P.to.z; W.fwd = 0; this.wp = P.pts.length - 1; this.best = 0; }
    if (!last && d < 0.35) { this.wp++; this.best = Infinity; this.bestT = this.t; return this.input(dt); }
    if (last && (d < 0.14 || stalled)) {
      W.fwd = 0;
      const turn = wrap(P.facing - W.heading);
      W.heading += Math.sign(turn) * Math.min(Math.abs(turn), dt * 4.5);
      if (Math.abs(turn) < 0.08 && W.speedSmooth < 0.25) this.arrived = true;
      return inp;
    }
    const want = Math.atan2(dx, dz), turn = wrap(want - W.heading);
    W.heading += Math.sign(turn) * Math.min(Math.abs(turn), dt * 6);
    // Turn on the spot first if it is well behind him; slow for the last half metre.
    inp.throttle = Math.abs(turn) > 1.2 ? 0.15 : last ? Math.max(0.3, Math.min(1, d / 0.7)) : 1;
    if (last && d < 0.5) W.fwd = Math.min(W.fwd, 0.3 + d * 2);
    return inp;
  }

  // The pump's own screen counting up while he fills: a picture of its own laid over the face he
  // is using (the others keep their resting figures).
  makeScreen() {
    if (!this.screen) {
      this.screenCanvas = document.createElement('canvas'); this.screenCanvas.width = 256; this.screenCanvas.height = 192;
      this.screenTex = new THREE.CanvasTexture(this.screenCanvas); this.screenTex.colorSpace = THREE.SRGBColorSpace;
      this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.33), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
      this.scene.add(this.screen);
    }
    const F = this.face, n = new THREE.Vector3(F.n.x, 0, F.n.z), q = this.stations.point(F.s, F.u + F.side * 0.288, -0.16);
    this.screen.position.set(q.x, F.s.y + 1.34, q.z);
    this.screen.lookAt(this.screen.position.clone().add(n));
    this.screen.visible = true;
    this.drawScreen(0);
  }
  drawScreen(litres, price = 314.9) {
    const g = this.screenCanvas.getContext('2d'), w = 256, h = 192;
    g.fillStyle = '#0b0f0e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2b3331'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    const fmt = (v, d) => v.toFixed(d).replace('.', ',');
    const row = (y, label, val, px) => { g.textBaseline = 'middle'; g.textAlign = 'right'; g.fillStyle = '#9dffd0'; g.font = `600 ${px}px "Saira", system-ui, sans-serif`; g.fillText(val, w - 22, y); g.textAlign = 'left'; g.fillStyle = '#6c7a75'; g.font = '700 16px "Saira", system-ui, sans-serif'; g.fillText(label, 20, y); };
    row(46, 'KR', Math.round(litres * price).toLocaleString('is-IS'), 46); row(104, 'LÍTRAR', fmt(litres, 2), 38); row(156, 'KR/L', fmt(price, 1), 30);
    this.screenTex.needsUpdate = true;
  }
  // Each frame while filling: the litres so far, on the pump.
  setPumped(litres) { if (this.screen?.visible && Math.abs(litres - (this.shown ?? -1)) > 0.04) { this.shown = litres; this.drawScreen(litres); } }

  // After the walker has moved and been animated: the phase clock, his arm, the nozzle and the hose.
  // fuelFull(): whether the tank is full.
  update(dt, { fuelFull }) {
    if (!this.active) return;
    this.t += dt;
    const ph = this.phase;
    if (ph === 'out' && this.t > 0.45) this.go('toPump');
    else if (this.paths[ph] && this.arrived) {
      this.arrived = false;
      this.go(ph === 'toPump' ? 'take' : ph === 'toCap' ? 'fill' : ph === 'toPump2' ? 'hang' : 'in');
      if (this.phase === 'fill') { this.filling = true; this.onFill?.(true); }
      if (this.phase === 'in') { this.finish(); return; }
    } else if (ph === 'take' && this.t > 1.15) this.go('toCap');
    else if (ph === 'hang' && this.t > 1.0) this.go('toDoor');
    else if (ph === 'fill') {
      if (this.filling && fuelFull()) { this.filling = false; this.onFill?.(false); }
      if (!this.filling && this.t > 0.6 && (this.holdT += dt) > 0.6) this.go('toPump2');
    }
    this.pose(dt);
  }

  // Stop filling (Refuel pressed again): he takes the nozzle back.
  stop() { if (this.phase === 'fill' && this.filling) { this.filling = false; this.onFill?.(false); } }

  // Called off from outside (a tow, a jump, another vehicle): the nozzle goes straight back.
  abort() {
    if (!this.active) return;
    this.active = false;
    if (this.screen) this.screen.visible = false;
    this.nozzle.visible = this.hose.visible = false;
    this.stations.holster(this.face, true);
    if (this.filling) { this.filling = false; this.onFill?.(false); }
  }

  // Done or called off: hang the nozzle up and hand back to the car.
  finish() {
    this.active = false;
    if (this.screen) this.screen.visible = false;
    this.nozzle.visible = this.hose.visible = false;
    this.stations.holster(this.face, true);
    if (this.filling) { this.filling = false; this.onFill?.(false); }
    this.onDone?.();
  }

  pose(dt) {
    const W = this.walker, B = this.bones, ph = this.phase, t = this.t;
    const rest = this.face.nozzle; // the nozzle in its holster (world)
    // Where the nozzle is: in the holster, in his hand, or in the filler.
    let inHand = this.carry;
    if (ph === 'take' && t > 0.55 && !this.carry) { this.carry = 1; this.stations.holster(this.face, false); inHand = 1; }
    if (ph === 'hang' && t > 0.55 && this.carry) { this.carry = 0; this.stations.holster(this.face, true); inHand = 0; }
    this.nozzle.visible = this.hose.visible = !!inHand;
    // His right arm: how much it is posed (reaching for the holster, carrying, holding it in the
    // filler) and where to.
    let want = 0, target = null;
    const fwd = _v.set(Math.sin(W.heading), 0, Math.cos(W.heading)).clone();
    const left = new THREE.Vector3(Math.cos(W.heading), 0, -Math.sin(W.heading));
    const carryAt = W.pos.clone().addScaledVector(fwd, 0.32).addScaledVector(left, -0.24).setY(W.pos.y + 0.98);
    if (ph === 'take' || ph === 'hang') {
      // Out to the holster and back: there by 0.45 s, back to carrying by the end.
      const grip = new THREE.Vector3().setFromMatrixPosition(rest);
      const u = ph === 'take' ? t : t; // same shape both ways
      const k = u < 0.45 ? ease(u / 0.45) : u < 0.65 ? 1 : 1 - ease((u - 0.65) / 0.45);
      target = grip.clone().lerp(carryAt, 1 - k);
      want = 1;
    } else if (this.carry && ph !== 'fill') { target = carryAt; want = 0.85; }
    else if (ph === 'fill') {
      // The nozzle sits in the filler, spout in; his hand on its grip.
      const z = this.out.clone().negate().multiplyScalar(Math.cos(0.6)).addScaledVector(UP, -Math.sin(0.6)).normalize();
      const y = new THREE.Vector3().crossVectors(z, new THREE.Vector3().crossVectors(UP, z)).normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      _m.makeBasis(x, y, z);
      const tip = NOZZLE_TIP.clone().applyMatrix4(_m);
      const k = ease(Math.min(1, t / 0.5));
      const inCap = this.cap.clone().sub(tip);
      this.fillM = _m.clone().setPosition(inCap);
      target = inCap.clone().lerp(carryAt, 1 - k);
      want = 1;
    }
    this.armW += (want - this.armW) * Math.min(1, dt * 8);
    if (B && target && this.armW > 0.01) {
      const arm = B.RightArm, fore = B.RightForeArm, hand = B.RightHand;
      const q0 = [arm.quaternion.clone(), fore.quaternion.clone()];
      const sh = wpos(arm), side = sh.clone().sub(wpos(B.Spine2 || B.Spine)).setY(0).normalize();
      const pole = side.multiplyScalar(0.7).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.2);
      // The wrist a little short of the grip, so the palm closes round it.
      const wrist = target.clone().addScaledVector(UP, 0.03).addScaledVector(target.clone().sub(sh).normalize(), -0.06);
      reach(arm, fore, hand, wrist, pole);
      arm.quaternion.slerpQuaternions(q0[0], arm.quaternion.clone(), this.armW);
      fore.quaternion.slerpQuaternions(q0[1], fore.quaternion.clone(), this.armW);
      arm.updateMatrixWorld(true);
    }
    // The nozzle's own place: its grip in his hand (carrying, spout forward and down), easing into
    // the filler while he fills.
    if (inHand && B) {
      const hp = wpos(B.RightHand);
      const z = fwd.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(UP, -Math.sin(0.5)).normalize();
      const y = new THREE.Vector3().crossVectors(z, new THREE.Vector3().crossVectors(UP, z)).normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      const held = new THREE.Matrix4().makeBasis(x, y, z).setPosition(hp.x, hp.y - 0.03, hp.z);
      let M = held;
      if (ph === 'fill' && this.fillM) {
        const k = ease(Math.min(1, t / 0.5));
        M = lerpMatrix(held, this.fillM, k);
      }
      if (ph === 'take' && t < 0.8) M = lerpMatrix(rest, held, ease(Math.min(1, (t - 0.55) / 0.25)));
      if (ph === 'hang' && t > 0.3) M = lerpMatrix(held, rest, ease(Math.min(1, (t - 0.3) / 0.25)));
      this.nozzle.matrix.copy(M); this.nozzle.matrixWorld.copy(M);
      this.updateHose(M);
    }
  }

  // The hose from the pump to the nozzle's tail: slack hangs down from the pump, and what is left
  // over lies along the forecourt.
  updateHose(M) {
    const root = this.face.root, tail = NOZZLE_TAIL.clone().applyMatrix4(M);
    const back = new THREE.Vector3(0, 0, -1).transformDirection(M);
    const n = new THREE.Vector3(this.face.n.x, 0, this.face.n.z);
    const d = root.distanceTo(tail), slack = Math.max(0.05, HOSE - d);
    const g0 = this.ground(root.x, root.z) + 0.02;
    const a = root.clone().addScaledVector(n, 0.08).setY(root.y - 0.25);
    const mid = root.clone().lerp(tail, 0.5);
    mid.y = Math.max(g0, Math.min(root.y, tail.y) - slack * 0.45);
    const b = tail.clone().addScaledVector(back, 0.14).addScaledVector(UP, -0.08);
    const curve = new THREE.CatmullRomCurve3([root, a, mid, b, tail]);
    const geo = new THREE.TubeGeometry(curve, 30, 0.016, 6, false);
    this.hose.geometry.dispose();
    this.hose.geometry = geo;
  }
}

// Between two placements (position and turn), k from 0 to 1.
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _s = new THREE.Vector3();
function lerpMatrix(A, Bm, k) {
  A.decompose(_pa, _qa, _s); Bm.decompose(_pb, _qb, _s);
  return new THREE.Matrix4().compose(_pa.lerp(_pb, k), _qa.slerp(_qb, k), _s.set(1, 1, 1));
}
