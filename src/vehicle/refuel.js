import * as THREE from 'three';
import { nozzleGeometry, NOZZLE_TAIL, NOZZLE_TIP, HOSE_REST, HOSE_PTS } from '../world/stations.js';
import { Hose, hoseTube } from '../world/hose.js';
import { reach, wpos, turnWorld, setWorldQuat, frameQuat, twistAbout, aim } from './driver.js';
import { bonesOf } from './skydiver.js';

// Filling up by hand. Press Refuel under a station's roof and the driver gets out at his door,
// walks round to the pump, takes the nozzle out of its holster, carries it to the car's filler
// (the side facing the pump; the top of the tank on the bike) and holds it in while the tank
// fills. Full (or stopped with Refuel again), he carries it back, hangs it up and gets back in.
// He walks on the walker's own legs and clips (walker.js), steered along a planned path; his right
// arm, hand and fingers are posed on top.
//
// The nozzle is one object from start to finish: in its holster until his hand has closed round
// its grip, then held rigidly in his hand (its place is his hand's, every frame), until he has set
// it back in the holster and only then lets go. What it does is planned as a path (out of the
// holster, to his side, into the filler, and back), and his arm is solved to carry it along that
// path, so nothing jumps. The hose is a simulated rope (hose.js) from the pump to the nozzle's tail.
//
// Phases: out, toPump, take, toCap, fill, toPump2, hang, toDoor, in.

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
// Points on the nozzle that must stay out of the pump and the car (its own frame): the tip, the
// spout's root, the body's front and back, the tail and the bottom of the handle.
const NOZZLE_PTS = [[0, -0.01, 0.26], [0, 0.03, 0.1], [0, 0.055, 0.095], [0, 0.055, -0.03], [0, 0.055, -0.05], [0, -0.07, 0.01]].map((a) => new THREE.Vector3(...a));
// The pump's solid parts in a face's frame: [x from, x to, half its length along the face, y from,
// y to]: its body, the crown's lip over it, the plinth (the island's centre line is at x = -0.31).
const PUMP_BOXES = [[-0.59, -0.03, 0.49, 0.36, 1.82], [-0.66, 0.04, 0.56, 1.82, 2.18], [-0.7, 0.08, 0.62, 0, 0.36]];
const _e = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

// How he holds it, pistol fashion: in the nozzle's own frame (spout along +z, top +y, handle hanging
// below the body) his fingers (wrist to knuckles) run along the spout, tipped up square across the
// handle; his palm faces the nozzle's +x, so his thumb comes up over the top of the handle. GRIP_C
// is the middle of the handle, where his fist closes. The wrist sits back from it along the hand
// and off it by the palm (in hand lengths, wrist to the middle knuckle).
const GRIP_F = new THREE.Vector3(0, 0.34, 0.94).normalize(), GRIP_P = new THREE.Vector3(1, 0, 0);
const GRIP_C = new THREE.Vector3(0, -0.012, -0.012);
const WRIST_BACK = 0.78, WRIST_OFF = 0.36;
// Each finger closed round the handle (radians a joint, knuckle to tip); the index rests on the
// lever, a little more open. The thumb's two outer joints.
const FIST = { Index: [0.95, 1.05, 0.7], Middle: [1.15, 1.25, 0.85], Ring: [1.15, 1.3, 0.85], Pinky: [1.1, 1.3, 0.85], Thumb: [0.35, 0.3, 0] };
const OPEN = 0.12; // how closed an open hand is (share of the fist)
// The timing of each move (seconds).
const T = { reach: 0.6, close: 0.24, lift: 0.4, swing: 0.6, toFill: 0.65, insert: 0.4, withdraw: 0.35, back: 0.55, toHolster: 0.65, seat: 0.42, open: 0.25, rest: 0.5 };

export class RefuelScene {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.phase = '';
    this.nozzle = new THREE.Mesh(nozzleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }));
    this.nozzle.castShadow = true; this.nozzle.receiveShadow = true; this.nozzle.visible = false; this.nozzle.matrixAutoUpdate = false;
    this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.55, metalness: 0.1 });
    this.hose = new THREE.Mesh(new THREE.BufferGeometry(), this.hoseMat);
    this.hose.castShadow = true; this.hose.receiveShadow = true; this.hose.visible = false; this.hose.frustumCulled = false;
    this.hose.matrixAutoUpdate = false;
    scene.add(this.nozzle, this.hose);
  }

  // car: the Jeep; walker: already standing at the car (walker.enter); face: the pump face
  // (stations.faceNear); stations: to lift and hang the nozzle; ground(x, z): the ground's height.
  // False (and nothing started) if he could not walk to the pump and then to the filler, or the
  // hose would not reach the filler from the pump: parked hard against the island, there is no
  // room to stand beside it.
  begin({ car, walker, face, stations, ground, onFill, onDone }) {
    if (this.settling) { this.settling = false; this.release(); } // the last hose put to rest at once
    this.car = car; this.walker = walker; this.face = face; this.stations = stations; this.ground = ground;
    this.onFill = onFill; this.onDone = onDone;
    this.bones = walker.man ? bonesOf(walker.man) : null;
    const h = car.heading, f = new THREE.Vector3(Math.sin(h), 0, Math.cos(h)), l = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
    let B = walker.car || { cx: 0, cz: 0, hx: 1, hz: 2.2, top: 1.6 };
    // A bike's box is as wide as its handlebars and mirrors; beside its tank he stands right up to
    // it, so here (and for him walking round it) it is only as wide as the tank and seat.
    if (car.model.bike && walker.car) walker.car = B = { ...B, hx: Math.min(B.hx, 0.2) };
    this.B = B; this.f = f; this.l = l;
    const at = (x, z) => new THREE.Vector3(car.pos.x + l.x * x + f.x * z, 0, car.pos.z + l.z * x + f.z * z);
    // Which side of the car the pump is on (+1 his door's side, the car's left).
    const fp = face.root;
    const sgn = Math.sign((fp.x - car.pos.x) * l.x + (fp.z - car.pos.z) * l.z) || 1;
    const bike = !!car.model.bike;
    const S = face.s, side = face.side;
    // Across the car, d beyond its body on side g (+1 its left): the box is not centred on the car.
    const sx = (g, d) => g * (B.hx + d) + B.cx;
    // Where he can stand: clear of the car's body (by more than the walker keeps clear of it) and of
    // the forecourt's solid parts. Each spot below is a list of choices, best first; the first one
    // free is used, so a car parked tight against the island still gets filled (he steps onto the
    // kerb, or round the corner of the car).
    this.free = (x, z) => !this.inCar(x, z, 0.34) && !stations.solidAt(S, x, z, 0.24) && !stations.onIsland(S, x, z, 0.12);
    const pick = (list) => list.find((p) => this.free(p.x, p.z)) || list[0];
    // The shortest errand: of the free spots, the one nearest the next (dist(p) is how far from p).
    const nearest = (list, dist) => { let b = null, bd = Infinity; for (const p of list) { const q = p.p || p; if (!this.free(q.x, q.z)) continue; const d = dist(q, p); if (d < bd) { bd = d; b = p; } } return b; };
    // At the pump: square in front of the holster, his toes just off the kerb, with his right
    // shoulder in line with it so the nozzle is in reach as he leans in; failing that (something in
    // the way), as near that as is free. Facing the pump.
    const pumpList = [];
    for (const c of [0.75, 0.8, 0.88, 0.96]) for (const dk of [0.17, 0.08, 0.26, 0, 0.34]) {
      const q = stations.point(S, face.u + side * c, face.w + face.kw * dk);
      pumpList.push({ p: new THREE.Vector3(q.x, 0, q.z), cost: Math.abs(c - 0.75) * 2 + Math.abs(dk - 0.17) });
    }
    pumpList.sort((a, b) => a.cost - b.cost);
    // Only spots he can walk to count (a car parked hard against the island leaves none beside it).
    // And only by a sensible walk: not round the end of the island and back.
    const reachable = (from, to) => {
      const pts = this.route(from, to);
      if (!this.routeOk) return false;
      let len = 0, a = from; for (const q of pts) { len += Math.hypot(q.x - a.x, q.z - a.z); a = q; }
      return len < Math.hypot(to.x - from.x, to.z - from.z) * 1.6 + 1.5;
    };
    // At the filler: beside it (pump side, rear quarter), nearer the car or further along it if
    // that is where there is room; failing that, round the back corner, with the filler there.
    const capList = [];
    if (bike) {
      for (const d of [0.36, 0.42]) for (const z of [0.05, 0.2, -0.1, 0.35, -0.25]) capList.push({ p: at(sx(sgn, d), B.cz + B.hz * z), z: B.cz + B.hz * 0.12 });
    } else {
      // Close to the car (a short arm's length from the filler), further out only if that is blocked.
      for (const d of [0.38, 0.45, 0.55]) for (const z of [-0.5, -0.38, -0.62, -0.25, -0.74]) capList.push({ p: at(sx(sgn, d), B.cz + B.hz * z), z: B.cz + B.hz * z, d });
      for (const x of [0.4, 0.1, 0.7]) capList.push({ p: at(sgn * (B.hx * x + (x > 0.6 ? 0.25 : 0)) + B.cx, B.cz - B.hz - 0.4), z: B.cz - B.hz + 0.3, behind: true });
    }
    // At his door, where he gets out and back in: on the bike he swings his leg over on the pump's
    // side (the side nearest the pump); out of a car, it is his door.
    const dside = bike ? sgn : 1;
    const doorList = [];
    for (const d of [0.55, 0.45, 0.38]) for (const z of [0.12, 0.3, -0.05, 0.45, -0.2]) doorList.push(at(dside * (B.hx + B.cx + d), B.cz + B.hz * z));
    doorList.push(at(dside * B.hx * 0.6, B.cz - B.hz - 0.45));
    let pump = null, door = null;
    for (const c of pumpList) {
      if (!this.free(c.p.x, c.p.z)) continue;
      const dr = bike ? nearest(doorList, (q) => q.distanceTo(c.p)) || doorList[0] : pick(doorList);
      if (reachable(dr, c.p)) { pump = c.p; door = dr; break; }
    }
    if (!pump) return false; // he cannot get to the pump from the car
    // Beside the filler if there is room (the spot along the car nearest the pump), else round the back.
    // Standing off the body costs: he stands close enough to hold the nozzle in with a bent arm.
    const capCost = (q, c) => q.distanceTo(pump) + (c.d ? (c.d - 0.38) * 4 : 0) + (c.behind ? 3 : 0);
    // And the hose must reach the filler there from the pump without going round the car: within
    // its reach, in a line clear of the car's body (the filler is on the near side of the car).
    const hoseReaches = (c) => {
      const fx = bike ? at(0, c.z) : at(sgn * (B.hx - (c.behind ? 0.08 : 0.02)) + B.cx, c.z);
      if (Math.hypot(fx.x - face.root.x, fx.z - face.root.z) > 4.6) return false;
      for (let t = 0; t <= 0.8; t += 0.05) if (this.inCar(face.root.x + (fx.x - face.root.x) * t, face.root.z + (fx.z - face.root.z) * t, -0.15)) return false;
      return true;
    };
    const cs = capList.filter((c) => this.free(c.p.x, c.p.z) && hoseReaches(c)).sort((a, b) => capCost(a.p, a) - capCost(b.p, b)).find((c) => reachable(pump, c.p));
    if (!cs) return false;
    const capStand = cs.p;
    this.out = cs.behind ? f.clone().negate() : l.clone().multiplyScalar(sgn); // the way out of the car at the filler
    this.cap = bike
      ? this.tankTop(at(sgn * 0.05, cs.z))
      : at(sgn * (B.hx - (cs.behind ? 0.08 : 0.02)) + B.cx, cs.z).setY(car.pos.y + THREE.MathUtils.clamp(B.top * 0.5, 0.9, 1.05)); // low cars fill high on the haunch
    // The box is only the car's outline (its mirrors, wheels and wings stick out): find the panel
    // itself, so the spout goes into the body rather than stopping in the air beside it.
    if (!bike) {
      const hit = this.panel(this.cap, this.out);
      if (hit) { this.cap.copy(hit.point).addScaledVector(hit.n, -0.05); this.out.copy(hit.n); }
    }
    const facePump = Math.atan2(-face.n.x, -face.n.z);
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
    this.held = false; // the nozzle in his hand
    this.lookW = 0; this.lookAt = null; this.leanW = 0; this.leanT = 0; this.crouchW = 0; this.crouchT = 0; this.miss = 1;
    this.filling = false; this.inserted = false; this.stopAt = null; this.outAt = null;
    this.setupHold();
    this.setupHose();
    // Down the gap between the car and the pump, from ahead of the car and a little above: the
    // car on one side, the pump on the other, and him in between.
    const mid = pump.clone().lerp(capStand, 0.5);
    const toLane = new THREE.Vector3(face.n.x, 0, face.n.z);
    this.shot = {
      eye: mid.clone().addScaledVector(f, 5.6).addScaledVector(toLane, 0.5).setY(car.pos.y + 2.5),
      at: mid.clone().addScaledVector(f, -1.2).setY(car.pos.y + 0.85),
    };
    this.makeScreen();
    return true;
  }

  // The top of a bike's tank at (p.x, p.z): the model cast down onto from above, the filler just
  // into it.
  tankTop(p) {
    const meshes = [];
    this.car.body.traverseVisible((m) => { if (m.isMesh && !m.isSkinnedMesh && m.geometry && !m.userData.noBox && m.material?.blending !== THREE.AdditiveBlending) meshes.push(m); });
    const ray = new THREE.Raycaster(new THREE.Vector3(p.x, this.car.pos.y + 2.5, p.z), new THREE.Vector3(0, -1, 0), 0, 3);
    const h = ray.intersectObjects(meshes, false)[0];
    return p.setY(h ? h.point.y - 0.03 : this.car.pos.y + 0.9);
  }
  // The car's body panel near p, seen from outside along out (a horizontal unit vector): the
  // highest point of the side, below p, that faces outward, and its outward normal. Its filler is
  // just under the top of the panel there.
  panel(p, out) {
    const meshes = [];
    this.car.body.traverseVisible((m) => { if (m.isMesh && !m.isSkinnedMesh && m.geometry && !m.userData.noBox && m.material?.blending !== THREE.AdditiveBlending) meshes.push(m); });
    if (!meshes.length) return null;
    const ray = new THREE.Raycaster(), dir = out.clone().negate();
    ray.far = 2.4;
    let best = null;
    for (let dy = 0.12; dy > -0.5; dy -= 0.04) {
      ray.set(p.clone().addScaledVector(out, 1.6).setY(p.y + dy), dir);
      const h = ray.intersectObjects(meshes, false)[0];
      if (!h || !h.face) continue;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.dot(out) < 0) n.negate(); // a double-sided face seen from behind
      if (Math.abs(n.y) > 0.6 || n.dot(out) < 0.5) continue; // the top of a wing, or a wheel's face
      // How far in it is from the car's outline: no deeper than the box allows.
      if (h.point.clone().sub(p).dot(out) < -0.45) continue;
      best = { point: h.point.clone(), n: n.setY(0).normalize() };
      break;
    }
    if (!best) return null;
    // A hand's width under the top, so the spout goes into the side and not over its lip; found
    // again there, since the side may lean in or out.
    ray.set(best.point.clone().addScaledVector(out, 1.6).addScaledVector(UP, -0.11), dir);
    const h = ray.intersectObjects(meshes, false)[0];
    if (h?.face && Math.abs(h.point.clone().sub(best.point).dot(out)) < 0.12) best.point.copy(h.point);
    else best.point.y -= 0.11;
    return best;
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
    this.routeOk = true;
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
    if (prev[goal] < 0) { this.routeOk = false; return [to.clone()]; } // no way there
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
    this.phase = phase; this.t = 0; this.wp = 0; this.arrived = false; this.tc = null; this.seatedAt = null; this.lined = null; this.fillU = 0; this.linedWait = 0; this.next = null; this.glide = false;
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
    if (this.glide) { inp.throttle = 0.6; return inp; } // walking on (update moves him)
    const tgt = P.pts[Math.min(this.wp, P.pts.length - 1)];
    const dx = tgt.x - W.pos.x, dz = tgt.z - W.pos.z, d = Math.hypot(dx, dz);
    const last = this.wp >= P.pts.length - 1;
    // Getting no closer (pressed against something): within reach, he stops there; held up for
    // long, he steps the last bit.
    if (d < this.best - 0.03) { this.best = d; this.bestT = this.t; }
    const stalled = this.t - this.bestT > 0.9;
    if (stalled && !last) { this.wp++; this.best = Infinity; this.bestT = this.t; return this.input(dt); }
    // Held up for long (something unforeseen in the way): he goes on along the line to where he is
    // going at a walk, never jumping there (he may be carrying the nozzle).
    if (this.t > P.limit || (stalled && last && d > 0.6)) this.glide = true;
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
      if (this.phase === 'in') { this.finish(); return; }
    } else if (ph === 'fill' && this.inserted) {
      if (this.filling && fuelFull()) { this.filling = false; this.onFill?.(false); }
      if (!this.filling && this.stopAt == null) this.stopAt = this.t;
    }
    const W = this.walker, px = W.pos.x, pz = W.pos.z;
    if (this.glide && this.paths[this.phase]?.pts) {
      // Gliding on (see input): from where he was last frame toward the waypoint at his pace.
      const P = this.paths[this.phase], tgt = P.pts[Math.min(this.wp, P.pts.length - 1)], from = this.lastPos || W.pos;
      const dx = tgt.x - from.x, dz = tgt.z - from.z, d = Math.hypot(dx, dz), k = Math.min(1, (1.2 * dt) / Math.max(d, 1e-6));
      W.pos.x = from.x + dx * k; W.pos.z = from.z + dz * k;
      if (d > 0.05) W.heading += wrap(Math.atan2(dx, dz) - W.heading) * Math.min(1, dt * 6);
      // There: on to the next waypoint, or done (he turns to face what he came for as usual).
      if (d < 0.05) { if (this.wp < P.pts.length - 1) this.wp++; else { this.glide = false; this.best = 0; this.bestT = this.t; } }
    }
    // Never inside the pump, a column or a post, whatever his steering did on the way round.
    this.stations.pushOut(this.face.s, W.pos, 0.22);
    if (W.pos.x !== px || W.pos.z !== pz) { W.root.position.x += W.pos.x - px; W.root.position.z += W.pos.z - pz; W.root.updateMatrixWorld(true); }
    (this.lastPos ||= new THREE.Vector3()).copy(W.pos);
    this.pose(dt);
    // A move just finished: on to the next phase (after this frame is posed, so no frame is skipped).
    if (this.next) { const n = this.next; this.next = null; this.go(n); }
  }

  // Stop filling (Refuel pressed again): he takes the nozzle out.
  stop() { if (this.phase === 'fill' && this.filling) { this.filling = false; this.onFill?.(false); } }

  // Called off from outside (a tow, a jump, another vehicle): the nozzle goes straight back.
  abort() {
    if (this.settling) { this.settling = false; this.release(); }
    if (!this.active) return;
    this.active = false;
    this.release();
    if (this.filling) { this.filling = false; this.onFill?.(false); }
  }

  // Done: the nozzle is back in its holster and he hands back to the car. The hose may still be
  // swinging back to rest: it carries on (settle) and the face's own is drawn again only once ours
  // is lying exactly where it does, so the change never shows.
  // Called off part way (E), he is back in the car at once and the nozzle goes straight back.
  finish() {
    this.active = false;
    if (this.screen) this.screen.visible = false;
    if (this.filling) { this.filling = false; this.onFill?.(false); }
    if (this.phase === 'in') { this.settling = true; this.settle(0); } else this.release();
    this.onDone?.();
  }
  // Each frame after finish until the hose is at rest (main.js calls it while settling).
  settle(dt) {
    if (!this.settling) return;
    if (dt) this.updateHose(dt);
    let d = 0; for (let i = 0; i < this.hoseSim.n; i++) d = Math.max(d, this.hoseSim.p[i].distanceTo(this.hoseRest[i]));
    if (d < 0.002 || !this.hoseAwake) { this.settling = false; this.release(); }
  }
  // The face's own nozzle and hose drawn again in their place, ours put away.
  release() {
    // How far our hose and nozzle are from the face's own resting ones as they swap back (should be
    // nothing: the swap must not show).
    if (this.hoseSim) { let d = 0; for (let i = 0; i < this.hoseSim.n; i++) d = Math.max(d, this.hoseSim.p[i].distanceTo(this.hoseRest[i])); this.swapGap = { hose: d, nozzle: _v.setFromMatrixPosition(this.nozzle.matrix).distanceTo(_c.setFromMatrixPosition(this.face.nozzle)) }; }
    if (this.screen) this.screen.visible = false;
    this.nozzle.visible = this.hose.visible = false;
    this.stations.holster(this.face, true);
    this.held = false;
  }

  // --- Holding the nozzle -------------------------------------------------------------------------

  // Once per refuel, for the person as he is now (either person, at his own size): how a held
  // nozzle sits in his right hand, his fingers' rest pose (to close from), his shoulder's height.
  setupHold() {
    const B = this.bones, W = this.walker;
    this.hold = null;
    if (!B?.RightHand || !B.RightHandMiddle1) return;
    W.man.updateMatrixWorld(true);
    // The hand's own frame (fingers along, palm out of it), from the walker's reading of the bind
    // pose: the palm square to the fingers.
    const hf = W.body?.handFrame?.Right;
    const f = hf ? hf.f.clone() : new THREE.Vector3(1, 0, 0), p = hf ? hf.p.clone() : new THREE.Vector3(0, -1, 0);
    p.addScaledVector(f, -p.dot(f)).normalize();
    const handLen = wpos(B.RightHand).distanceTo(wpos(B.RightHandMiddle1));
    // The hand's turn in the nozzle's frame, and where the wrist is in it.
    const Qh = frameQuat(f, p, GRIP_F, GRIP_P);
    const wrist = GRIP_C.clone().addScaledVector(GRIP_F, -WRIST_BACK * handLen).addScaledVector(GRIP_P, -WRIST_OFF * handLen);
    // The fingers' bind pose (straight, a T-pose hand), from the skin's bind matrices.
    let sk = null; W.man.traverse((o) => { if (!sk && o.isSkinnedMesh) sk = o.skeleton; });
    const fingers = [];
    for (const name of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (const j of [1, 2, 3]) {
      const b = B['RightHand' + name + j], next = B['RightHand' + name + (j + 1)];
      if (!b) continue;
      let bind = null;
      if (sk) {
        const i = sk.bones.indexOf(b), ip = sk.bones.indexOf(b.parent);
        if (i >= 0 && ip >= 0) { _m.copy(sk.boneInverses[i]).invert(); bind = new THREE.Matrix4().multiplyMatrices(sk.boneInverses[ip], _m); bind = new THREE.Quaternion().setFromRotationMatrix(bind.extractRotation(bind)); }
      }
      fingers.push({ b, next, name, j, bind: bind || b.quaternion.clone(), clip: new THREE.Quaternion(), want: new THREE.Quaternion() });
    }
    this.hold = { f, p, Qh, QhInv: Qh.clone().invert(), wrist, handLen, fingers };
    this.shoulderH = null; // measured as he walks (pose): his body has not caught up with him yet
    this.carryH = null;
    this.armLen = wpos(B.RightArm).distanceTo(wpos(B.RightForeArm)) + wpos(B.RightForeArm).distanceTo(wpos(B.RightHand));
  }

  // The nozzle's place when held at his side as he walks: in his right hand just in front of his
  // hip, spout forward and down, the hose trailing back from it.
  carryM(out = new THREE.Matrix4()) {
    const W = this.walker, h = this.carryH ?? W.heading; // his arm follows a quick turn a moment late
    const fwd = _v.set(Math.sin(h), 0, Math.cos(h)), left = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
    // His forearm forward and down from a relaxed elbow: the grip about four fifths of his arm's
    // length below his shoulder, a hand's width forward.
    const sh = this.shoulderH || 1.4, a = this.armLen || 0.47;
    const pos = W.pos.clone().addScaledVector(fwd, 0.2).addScaledVector(left, -0.17).setY(W.pos.y + sh - a * 0.78 - 0.02);
    const z = fwd.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(UP, -Math.sin(0.5)).addScaledVector(left, 0.12).normalize();
    return this.clear(basis(out, z, pos));
  }
  // Move a placement of the nozzle out of the pump and the car if any part of it would be inside
  // (turning away from the pump, or walking close along the car), by the shortest way out. Not used
  // for drawing it out of or lowering it into the holster, which run along the holster's own line.
  clear(M) {
    const F = this.face, c = this.car, B = this.B, m = 0.03;
    for (let it = 0; it < 3; it++) {
      // The deepest part of the nozzle inside the pump (its body, crown or plinth, in the face's
      // frame: x out from the face, z along it) or the car (its outline below the roof, its panel
      // on the filler's side), and the shortest way out of it.
      let best = 0; const push = _e.set(0, 0, 0);
      for (const q of NOZZLE_PTS) {
        _c.copy(q).applyMatrix4(M);
        _d.copy(_c).applyMatrix4(F.frameInv);
        const w = F.w + _d.z * F.kw;
        for (const [x0, x1, hw, y0, y1] of PUMP_BOXES) {
          if (_d.y < y0 || _d.y > y1) continue;
          const ox0 = _d.x - (x0 - m), ox1 = x1 + m - _d.x, ow = hw + m - Math.abs(w);
          if (ox0 <= 0 || ox1 <= 0 || ow <= 0) continue;
          const o = Math.min(ox0, ox1, ow);
          if (o <= best) continue;
          best = o;
          if (o === ox1) push.set(F.n.x, 0, F.n.z).multiplyScalar(o);
          else if (o === ox0) push.set(-F.n.x, 0, -F.n.z).multiplyScalar(o);
          else { const k = _c.set(F.s.fx, 0, F.s.fz).multiplyScalar(Math.sign(w) * o); push.copy(k); }
        }
        _c.copy(q).applyMatrix4(M);
        if (_c.y < c.pos.y + B.top) {
          const dx = _c.x - c.pos.x, dz = _c.z - c.pos.z;
          const lx = dx * this.l.x + dz * this.l.z - B.cx, lz = dx * this.f.x + dz * this.f.z - B.cz;
          const hx = Math.sign(lx) === this.carSide.s ? this.carSide.hx : B.hx;
          const ox = hx + m - Math.abs(lx), oz = B.hz + m - Math.abs(lz);
          if (ox > 0 && oz > 0 && Math.min(ox, oz) > best) {
            best = Math.min(ox, oz);
            if (ox < oz) push.copy(this.l).multiplyScalar(Math.sign(lx || 1) * ox); else push.copy(this.f).multiplyScalar(Math.sign(lz || 1) * oz);
          }
        }
      }
      if (!best) break;
      M.setPosition(_c.setFromMatrixPosition(M).add(push));
    }
    return M;
  }
  // In the holster (the face's own resting place for it).
  restM(out = new THREE.Matrix4()) { return out.copy(this.face.nozzle); }
  // Just out of the holster: drawn back along its spout (up and out) and a little toward the lane.
  liftedM(out = new THREE.Matrix4()) {
    out.copy(this.face.nozzle);
    const back = new THREE.Vector3(0, 0, -1).transformDirection(out);
    const p = new THREE.Vector3().setFromMatrixPosition(out).addScaledVector(back, 0.2).addScaledVector(new THREE.Vector3(this.face.n.x, 0, this.face.n.z), 0.06);
    return out.setPosition(p);
  }
  // In the filler: spout into the car along the panel's inward normal, tipped down (steeply into
  // the top of a bike's tank), its tip at the filler (a little inside the panel). pre: 0.12 back
  // out along the spout, lined up to go in.
  fillM(pre, out = new THREE.Matrix4()) {
    const tilt = this.car.model.bike ? 1.1 : 0.6; // down into the top of a bike's tank
    const z = this.out.clone().negate().multiplyScalar(Math.cos(tilt)).addScaledVector(UP, -Math.sin(tilt)).normalize();
    basis(out, z, new THREE.Vector3());
    const tip = NOZZLE_TIP.clone().transformDirection(out).multiplyScalar(NOZZLE_TIP.length());
    const p = this.cap.clone().sub(tip).addScaledVector(z, pre ? -0.12 : 0);
    return out.setPosition(p);
  }

  // Where the nozzle is meant to be this frame, how much his arm and fingers are posed (arm: 0 the
  // clip's swing, 1 holding; curl: 0 open, 1 closed round the grip) and whether it is in his hand.
  // Each move runs on the phase clock from where the last one left it, so the path is continuous.
  plan(ph, t, M) {
    const A = this._a ||= new THREE.Matrix4(), Bm = this._b ||= new THREE.Matrix4();
    let arm = 0, curl = OPEN, held = this.held, look = null;
    const rest = this.face.nozzle;
    if (ph === 'take') {
      // Reach to the grip, close the hand on it, draw it up out of the holster, bring it to his side.
      look = 'rest';
      if (this.tc == null) {
        M.copy(rest); arm = ease(t / T.reach); curl = OPEN;
        // Closing only once the hand is on the grip (the arm reaches it before T.reach is up, or
        // within a moment after, as he leans in).
        if (t >= T.reach && (this.miss < 0.002 || t > T.reach + 1.2)) this.tc = t;
      }
      if (this.tc != null) {
        const u = t - this.tc;
        arm = 1;
        curl = OPEN + (1 - OPEN) * ease(u / T.close);
        // In his hand once his fingers are round it, a moment before it moves.
        if (u >= T.close * 0.8) held = true;
        if (u < T.close) M.copy(rest);
        else {
          const v = u - T.close;
          if (v < T.lift) lerpM(rest, this.liftedM(A), ease(v / T.lift), M);
          else { this.clear(lerpM(this.liftedM(A), this.carryM(Bm), ease((v - T.lift) / T.swing), M)); if (v - T.lift > T.swing * 0.6) look = null; }
          if (v >= T.lift + T.swing) this.next = 'toCap';
        }
      }
    } else if (ph === 'toCap' || ph === 'toPump2') {
      this.carryM(M); arm = 1; curl = 1;
    } else if (ph === 'fill') {
      arm = 1; curl = 1; look = 'cap';
      if (this.stopAt == null || this.t - this.stopAt < 0.45) {
        // In: to the filler, lined up, then along the spout into it.
        // To the filler, no faster than his hand keeps up (he may have to bend to it).
        this.fillU = Math.min(1, (this.fillU || 0) + (this.dt / T.toFill) * (this.miss < 0.015 ? 1 : 0.3));
        if (this.fillU < 1) lerpM(this.carryM(A), this.fillM(true, Bm), ease(this.fillU), M);
        else if (this.lined == null) {
          // Lined up: in once his hand is truly there (he may still be leaning in).
          this.fillM(true, M);
          this.linedWait = (this.linedWait || 0) + this.dt;
          if (this.miss < 0.004 || this.linedWait > 2) this.lined = t;
        } else lerpM(this.fillM(true, A), this.fillM(false, Bm), ease((t - this.lined) / T.insert), M);
        if (this.lined != null && t >= this.lined + T.insert && !this.inserted) { this.inserted = true; this.filling = true; this.onFill?.(true); }
      } else {
        // Out: back along the spout, then to his side.
        this.outAt ??= this.t;
        const u = this.t - this.outAt;
        if (u < T.withdraw) lerpM(this.fillM(false, A), this.fillM(true, Bm), ease(u / T.withdraw), M);
        else lerpM(this.fillM(true, A), this.carryM(Bm), ease((u - T.withdraw) / T.back), M);
        if (u > T.withdraw + T.back * 0.5) look = null;
        if (u >= T.withdraw + T.back) this.next = 'toPump2';
      }
    } else if (ph === 'hang') {
      // To the holster, down into it, and only once it is seated does his hand open and come away.
      look = 'rest'; arm = 1; curl = 1;
      if (t < T.toHolster) this.clear(lerpM(this.carryM(A), this.liftedM(Bm), ease(t / T.toHolster), M));
      else if (t < T.toHolster + T.seat) lerpM(this.liftedM(A), rest, ease((t - T.toHolster) / T.seat), M);
      else if (this.seatedAt == null) {
        // Down in the holster: held there until his hand is truly on it (he may still be leaning in).
        M.copy(rest);
        if (this.miss < 0.003 || t > T.toHolster + T.seat + 1) this.seatedAt = t;
      } else {
        M.copy(rest); held = false;
        const u = t - this.seatedAt;
        curl = 1 - (1 - OPEN) * ease(u / T.open);
        arm = 1 - ease((u - T.open) / T.rest);
        if (u > T.open) look = null;
        if (u >= T.open + T.rest) this.next = 'toDoor';
      }
    } else {
      M.copy(rest); held = false;
    }
    return { arm, curl, held, look };
  }

  pose(dt) {
    const W = this.walker, B = this.bones, ph = this.phase, t = this.t, H = this.hold;
    const D = this._D ||= new THREE.Matrix4();
    // His shoulder's height over his feet, as the clip has him (before he bends), smoothed over his
    // steps: what the carrying height is measured from.
    if (B) { const h = wpos(B.RightArm).y - W.pos.y; this.shoulderH = this.shoulderH == null ? h : this.shoulderH + (h - this.shoulderH) * Math.min(1, dt * 2); }
    this.carryH = this.carryH == null ? W.heading : this.carryH + wrap(W.heading - this.carryH) * (1 - Math.exp(-dt / 0.12));
    this.dt = dt;
    const P = this.plan(ph, t, D);
    // Where he looks: at the holster as he takes the nozzle or hangs it up, down at the filler while
    // he fills (bending at the waist if it is low or far); ahead when walking. Done before the arm,
    // so the arm reaches from where the bend puts his shoulder.
    const lookAt = P.look === 'rest' ? new THREE.Vector3().setFromMatrixPosition(this.face.nozzle) : P.look === 'cap' ? this.cap : null;
    if (lookAt) this.lookAt = lookAt;
    const look = P.look === 'rest' ? 0.75 : P.look === 'cap' ? 1 : 0;
    this.lookW += (look - this.lookW) * Math.min(1, dt * (look > this.lookW ? 3.5 : 3));
    // Bent at the waist when what he reaches for is further or lower than his arm reaches standing.
    // He keeps bending further while his wrist is beyond an easy reach of where it must go and
    // straightens as it comes within it (up to about 50 degrees, as over a low sports car's filler),
    // so his hand always gets there; standing straight again once he is done.
    if (B && H && P.arm > 0.3 && P.look) {
      const wrist = this.wristFor(D, _v), d = wpos(B.RightArm).distanceTo(wrist);
      this.leanT = THREE.MathUtils.clamp(this.leanT + THREE.MathUtils.clamp(d - this.armLen * 0.93, -0.06, 0.08) * 20 * dt, 0, 0.9);
      // Bent as far as is comfortable and still short (a low sports car's filler): he bends his
      // knees too.
      // (Only for something well below his shoulder: crouching would take him away from anything higher.)
      const short = d - this.armLen * 0.93, low = wrist.y < wpos(B.RightArm).y - 0.3;
      this.crouchT = THREE.MathUtils.clamp(this.crouchT + (this.leanT > 0.8 && short > 0 && low ? Math.min(short, 0.05) * 8 : short < -0.03 || !low ? -0.15 : 0) * dt, 0, 0.3);
    } else { this.leanT = Math.max(0, this.leanT - dt * 1.2); this.crouchT = Math.max(0, this.crouchT - dt * 0.5); }
    this.leanW += (this.leanT - this.leanW) * Math.min(1, dt * 7);
    this.crouchW += (this.crouchT - this.crouchW) * Math.min(1, dt * 6);
    if (B && this.crouchW > 0.002) this.crouch(this.crouchW);
    if (B && this.lookAt && (this.lookW > 0.01 || this.leanW > 0.005)) this.bow(this.lookAt, this.lookW, this.leanW);
    // His arm, hand and fingers on the nozzle.
    this.miss = 0;
    if (B && H && P.arm > 0.001) this.miss = this.holdAt(D, P.arm, P.curl);
    // The nozzle: in his hand (its place is his hand's) or where the plan has it (the holster).
    this.held = P.held && !!H;
    const N = this.nozzle;
    if (this.held) this.fromHand(N.matrix); else N.matrix.copy(D);
    N.matrixWorld.copy(N.matrix);
    this.updateHose(dt);
  }

  // Where his wrist goes to hold the nozzle placed at M.
  wristFor(M, out = new THREE.Vector3()) { return out.copy(this.hold.wrist).applyMatrix4(M); }
  // The nozzle's place from his hand as it is now.
  fromHand(out) {
    const H = this.hold, hand = this.bones.RightHand;
    const q = hand.getWorldQuaternion(_q).multiply(H.QhInv);
    const p = wpos(hand).sub(H.wrist.clone().applyQuaternion(q));
    return out.compose(p, q, _v.set(1, 1, 1));
  }

  // Pose his right arm, hand and fingers to hold the nozzle placed at M, by weight w over what the
  // clip has him doing (curl: how far his fingers are closed). Returns how far the wrist fell short.
  holdAt(M, w, curl) {
    const B = this.bones, H = this.hold, W = this.walker;
    const sh = B.RightShoulder, arm = B.RightArm, fore = B.RightForeArm, hand = B.RightHand;
    const saved = [sh, arm, fore, hand].map((b) => b && b.quaternion.clone());
    for (const fg of H.fingers) fg.clip.copy(fg.b.quaternion);
    M.decompose(_pa, _qa, _s);
    const want = _qa.clone().multiply(H.Qh); // the hand's world turn
    const wrist = this.wristFor(M);
    const fwd = new THREE.Vector3(Math.sin(W.heading), 0, Math.cos(W.heading));
    // A long reach takes the shoulder forward too (the collarbone turns toward it).
    if (sh) {
      const d = wpos(arm).distanceTo(wrist) - this.armLen * 0.97;
      if (d > 0) {
        const c = wpos(sh), a = wpos(arm).sub(c), b = wrist.clone().sub(c), ax = new THREE.Vector3().crossVectors(a, b);
        if (ax.lengthSq() > 1e-8) turnWorld(sh, ax.normalize(), Math.min(0.35, d / a.length()));
      }
    }
    // The elbow out to his side and down, a little behind.
    const side = wpos(arm).sub(wpos(B.Spine2 || B.Spine)).setY(0).normalize();
    const pole = side.multiplyScalar(0.75).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.25);
    let miss = 0;
    for (let k = 0; k < 2; k++) {
      miss = reach(arm, fore, hand, wrist, pole);
      // The forearm takes most of the hand's twist about its length, as a real one does.
      const axis = wpos(hand).sub(wpos(fore)).normalize();
      const rel = want.clone().multiply(hand.getWorldQuaternion(_q).invert());
      turnWorld(fore, axis, twistAbout(rel, axis) * 0.7);
      setWorldQuat(hand, want);
    }
    // Fingers: from straight and together, closed round the grip by curl.
    this.fist(curl);
    // By weight over the clip.
    if (w < 1) {
      [sh, arm, fore, hand].forEach((b, i) => { if (b) b.quaternion.slerpQuaternions(saved[i], b.quaternion.clone(), w); });
      for (const fg of H.fingers) fg.b.quaternion.slerpQuaternions(fg.clip, fg.b.quaternion.clone(), w);
      (sh || arm).updateMatrixWorld(true);
      miss = wpos(hand).distanceTo(wrist);
    }
    return miss;
  }

  // His fingers closed by c (0 straight, 1 a fist round the nozzle's grip): from the bind pose (a
  // flat hand), drawn together, the thumb brought round in front of the palm, each joint turned
  // toward the palm.
  fist(c) {
    const B = this.bones, H = this.hold, hand = B.RightHand;
    for (const fg of H.fingers) fg.b.quaternion.copy(fg.bind);
    hand.updateMatrixWorld(true);
    const hq = hand.getWorldQuaternion(new THREE.Quaternion());
    const palm = H.p.clone().applyQuaternion(hq), F = H.f.clone().applyQuaternion(hq);
    const along = wpos(B.RightHandMiddle2).sub(wpos(B.RightHandMiddle1)).normalize();
    for (const f of ['Index', 'Ring', 'Pinky']) {
      const b1 = B['RightHand' + f + 1], b2 = B['RightHand' + f + 2];
      if (b1 && b2) aim(b1, b2, along.clone().lerp(wpos(b2).sub(wpos(b1)).normalize(), 0.3));
    }
    if (B.RightHandThumb1 && B.RightHandThumb2) aim(B.RightHandThumb1, B.RightHandThumb2, F.clone().multiplyScalar(0.6).addScaledVector(palm, 0.5 + 0.2 * c).normalize());
    for (const fg of H.fingers) {
      if (!fg.next || (fg.name === 'Thumb' && fg.j === 1)) continue;
      const d = wpos(fg.next).sub(wpos(fg.b)).normalize(), ax = new THREE.Vector3().crossVectors(d, palm);
      if (ax.lengthSq() < 1e-6) continue;
      turnWorld(fg.b, ax.normalize(), FIST[fg.name][fg.name === 'Thumb' ? fg.j - 2 : fg.j - 1] * c);
    }
  }

  // Lower his hips by h, his feet staying where they are: each leg solved again to its ankle,
  // knees forward, and each foot kept at the turn it had.
  crouch(h) {
    const B = this.bones, W = this.walker, H = B.Hips;
    if (!H) return;
    const legs = ['Left', 'Right'].map((s) => [B[s + 'UpLeg'], B[s + 'Leg'], B[s + 'Foot']]).filter((l) => l[2]);
    const ankles = legs.map((l) => wpos(l[2])), feet = legs.map((l) => l[2].getWorldQuaternion(new THREE.Quaternion()));
    const w = wpos(H); w.y -= h;
    H.position.copy(H.parent.worldToLocal(w)); H.updateMatrixWorld(true);
    const knee = new THREE.Vector3(Math.sin(W.heading), 0.15, Math.cos(W.heading));
    legs.forEach(([up, mid, end], i) => { reach(up, mid, end, ankles[i], knee); setWorldQuat(end, feet[i]); });
  }

  // Bow his head and upper back so he looks at p, by k (0 to 1): the turn spread down the spine,
  // most of it in the neck and head, a little in the back, as a person leans over to watch the
  // spout. Added on top of whatever his clip has him doing.
  bow(p, k, lean = 0) {
    const B = this.bones, W = this.walker;
    if (!B.Head || !B.Neck) return;
    const d = p.clone().sub(wpos(B.Head)), flat = Math.hypot(d.x, d.z);
    const yaw = THREE.MathUtils.clamp(wrap(Math.atan2(d.x, d.z) - W.heading), -1.0, 1.0);
    const pitch = THREE.MathUtils.clamp(Math.atan2(-d.y, Math.max(0.15, flat)), -0.15, 1.05); // + is down
    const a = W.heading + yaw * 0.6, left = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    // [bone, share of the bow, share of the turn, share of the lean]
    // lean: a further bend at the waist (radians, from the hips up), the head kept on its target.
    for (const [b, sp, sy, sl] of [[B.Spine, 0.1, 0.1, 0.5], [B.Spine1, 0.12, 0.12, 0.3], [B.Spine2, 0.13, 0.13, 0.2], [B.Neck, 0.28, 0.25, -0.45], [B.Head, 0.37, 0.4, -0.25]]) {
      if (!b) continue;
      turnWorld(b, UP, yaw * sy * k);
      turnWorld(b, left, (pitch * sp * k + lean * sl));
    }
  }

  // --- The hose ------------------------------------------------------------------------------------

  // Start the hose in use from the face's own resting hose, point for point, and draw ours in place
  // of the face's (they are the same, so nothing changes on screen).
  setupHose() {
    const F = this.face;
    this.hoseRest = this.stations.hoseRestWorld(F);
    this.hoseSim = new Hose(HOSE_PTS, HOSE_REST).copyFrom(this.hoseRest);
    this.hoseAwake = false;
    this.nozzle.matrix.copy(F.nozzle); this.nozzle.matrixWorld.copy(F.nozzle);
    this.hose.geometry = hoseTube(this.hoseRest, this.hose.geometry);
    this.nozzle.visible = this.hose.visible = true;
    this.stations.holster(F, false);
    // The car's side the hose may lie against: its box, but on the filler's side its panel there.
    const c = this.car, cp = this.cap.clone().addScaledVector(this.out, 0.05);
    const lx = (cp.x - c.pos.x) * this.l.x + (cp.z - c.pos.z) * this.l.z - this.B.cx;
    this.carSide = { s: Math.sign(lx) || 1, hx: c.model.bike ? this.B.hx : Math.abs(lx) };
    this.floorY = F.s.y;
    this.hoseStats = null;
  }

  // Each frame: the hose from the pump to the nozzle's tail. While the nozzle is moving or has just
  // been hung up it is simulated; the pump's retractor pays out what is needed to reach (keeping it
  // a little slack) and winds it back in, and once hung up it swings back to its resting shape.
  updateHose(dt) {
    const S = this.hoseSim, F = this.face, N = this.nozzle.matrix;
    const tail = NOZZLE_TAIL.clone().applyMatrix4(N), back = new THREE.Vector3(0, 0, -1).transformDirection(N);
    const moved = tail.distanceToSquared(NOZZLE_TAIL.clone().applyMatrix4(F.nozzle)) > 1e-8;
    if (moved) this.hoseAwake = true;
    if (!this.hoseAwake) return;
    // Carried: paid out as fast as he walks, wound in slowly as he comes back (it is drawn back
    // along the ground). Hung up: wound in as it swings back to rest, at the same pace.
    const resting = !this.held && !moved;
    const want = Math.max(HOSE_REST, F.root.distanceTo(tail) * 1.15 + 0.8);
    const L = resting
      ? Math.max(HOSE_REST, Math.min(S.len, Math.max(HOSE_REST + (S.len - HOSE_REST) * Math.exp(-dt * 2.2), S.len + S.stretch)))
      : S.len + THREE.MathUtils.clamp(want - S.len, -1.2 * dt, 2.2 * dt);
    S.resize(L, F.root, F.rootDir);
    S.step(dt, F.root, F.rootDir, tail, back, this.collide ||= (p, r) => this.hoseCollide(p, r));
    // Hung up: drawn back to how it rests (no faster than it would swing there), so that when the
    // face's own hose is drawn again, nothing moves.
    if (resting) {
      const k = 1 - Math.exp(-dt * 2.2);
      for (let i = 0; i < S.n; i++) { _v.subVectors(this.hoseRest[i], S.p[i]).multiplyScalar(k); S.p[i].add(_v); S.o[i].add(_v); }
    }
    this.hose.geometry = hoseTube(S.p, this.hose.geometry);
    // For tests (window.chasingGreen.refuel.scene): its length, how far over it, its highest point.
    let top = -Infinity; for (const q of S.p) top = Math.max(top, q.y);
    this.hoseStats = { len: L, stretch: S.stretch, top: top - this.floorY };
  }
  // Keep a point of the hose (radius r) out of the pump and kerb, off the forecourt, out of the car
  // and out of his legs. True if it lies on something.
  hoseCollide(p, r) {
    let on = this.stations.hoseCollide(this.face, p, r);
    if (p.y < this.floorY + r) { p.y = this.floorY + r; on = true; }
    // The car: its outline below the roof, its panel on the filler's side.
    const c = this.car, B = this.B;
    if (p.y < c.pos.y + B.top) {
      const dx = p.x - c.pos.x, dz = p.z - c.pos.z;
      const lx = dx * this.l.x + dz * this.l.z - B.cx, lz = dx * this.f.x + dz * this.f.z - B.cz;
      const hx = Math.sign(lx) === this.carSide.s ? this.carSide.hx : B.hx;
      const ox = hx + r - Math.abs(lx), oz = B.hz + r - Math.abs(lz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) { const m = Math.sign(lx || 1) * ox; p.x += this.l.x * m; p.z += this.l.z * m; } else { const m = Math.sign(lz || 1) * oz; p.x += this.f.x * m; p.z += this.f.z * m; }
      }
    }
    // His legs and body, a column round where he stands (while he is out of the car); hose lying
    // on the ground he steps over.
    if (!this.active) return on;
    const W = this.walker, wr = 0.13 + r, ex = p.x - W.pos.x, ez = p.z - W.pos.z, ed = Math.hypot(ex, ez);
    if (p.y > W.pos.y + 0.12 && p.y < W.pos.y + 1.45 && ed < wr && ed > 1e-5) { p.x = W.pos.x + (ex / ed) * wr; p.z = W.pos.z + (ez / ed) * wr; }
    return on;
  }
}

// A placement whose spout (+z) points along z, its top (+y) as near up as that allows, at pos.
function basis(out, z, pos) {
  const y = UP.clone().addScaledVector(z, -UP.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
  return out.makeBasis(x, y, z).setPosition(pos);
}
// Between two placements (position and turn), k from 0 to 1, into out.
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _s = new THREE.Vector3();
function lerpM(A, Bm, k, out) {
  A.decompose(_pa, _qa, _s); Bm.decompose(_pb, _qb, _s);
  return out.compose(_pa.lerp(_pb, k), _qa.slerp(_qb, k), _s.set(1, 1, 1));
}
