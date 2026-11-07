// The start screen's hero shot: one vehicle at a time, lit like a studio photograph on wet black
// ground, drawn over the aurora sky (auroraSky.js) on its own transparent canvas. It starts with
// the code-built stand-ins and swaps in each model file as it arrives. The vehicle sits over the
// `spot` element, so the page layout decides where it goes and how big it is.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildVehicleModel, modelReady } from '../vehicle/models.js';

const FOV = 26;
const YAW = 0.62;
// Size on the cover against the rest: the supercar is long and low and would look the biggest;
// the 4x4 and the roadster stand a little larger.
const SCALE = { race: 0.9, jeep: 1.08, vintage: 1.06, bike: 1.25 };

function gradient(size, stops, radial = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = radial ? g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2) : g.createLinearGradient(0, 0, 0, size);
  for (const [at, col] of stops) gr.addColorStop(at, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// The turntable's rim, drawn once: a glowing ring with tick marks, an outer hairline and a
// dashed inner ring, on a square that the rim fills to 80% of its half-width.
function ringTexture() {
  const N = 1024, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), u = N / 2, ring = (r, w, style, dash = []) => { g.setLineDash(dash); g.lineWidth = w; g.strokeStyle = style; g.beginPath(); g.arc(u, u, r * u, 0, Math.PI * 2); g.stroke(); };
  g.shadowColor = 'rgba(102,223,176,1)'; g.shadowBlur = 36;
  ring(0.8, 0.02 * u, '#a2f6d3'); ring(0.8, 0.012 * u, '#d8fff0');
  g.shadowBlur = 0;
  ring(0.9, 2.5, 'rgba(162,246,211,0.5)'); ring(0.6, 2, 'rgba(162,246,211,0.3)', [10, 14]);
  g.setLineDash([]); g.strokeStyle = 'rgba(162,246,211,0.6)';
  for (let a = 0; a < 360; a += 5) {
    const t = (a * Math.PI) / 180, r1 = 0.835 * u, r2 = (a % 30 === 0 ? 0.885 : 0.86) * u;
    g.lineWidth = a % 30 === 0 ? 3 : 1.6; g.beginPath(); g.moveTo(u + Math.cos(t) * r1, u + Math.sin(t) * r1); g.lineTo(u + Math.cos(t) * r2, u + Math.sin(t) * r2); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

export class Cover {
  constructor(canvas, { spot, small = false } = {}) {
    this.canvas = canvas;
    this.spot = spot;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setClearColor(0x000000, 0);
    const scene = this.scene = new THREE.Scene();
    // Soft studio reflections in the paint, turned well down: it is night.
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

    // Light: the aurora behind and above (a green rim), a cool key from the front, a faint fill.
    scene.add(new THREE.HemisphereLight(0x2a4a5a, 0x000000, 0.35));
    const rim = new THREE.DirectionalLight(0x6ef0ad, 4); rim.position.set(-2, 5, -9);
    const key = new THREE.DirectionalLight(0xcfe3ff, 1.1); key.position.set(6, 4, 7);
    const kick = new THREE.DirectionalLight(0x9fd8ff, 0.8); kick.position.set(-8, 2, 2);
    scene.add(rim, key, kick);

    // Wet black ground: black underneath so the sky never shows through, the vehicle's reflection
    // drawn on that, and a dark glassy surface over both, fading out toward the horizon.
    // The turntable: black underneath (so the sky never shows through), a dark glossy floor the
    // reflection shows through, and a glowing rim with tick marks that turns slowly. Sized to the
    // vehicle in show().
    const fade = gradient(256, [[0, '#fff'], [0.62, '#fff'], [1, '#000']]);
    const under = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshBasicMaterial({ color: 0x010203, transparent: true, alphaMap: fade, depthWrite: false }));
    under.rotation.x = -Math.PI / 2; under.position.y = -6; under.renderOrder = -1;
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false,
      map: gradient(256, [[0, 'rgba(16,58,46,0.82)'], [0.5, 'rgba(6,22,18,0.84)'], [0.74, 'rgba(3,10,8,0.6)'], [1, 'rgba(3,10,8,0)']]) }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = 0.002; this.floor.renderOrder = 1;
    this.rings = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.rings.rotation.x = -Math.PI / 2; this.rings.position.y = 0.004; this.rings.renderOrder = 2;
    // Past the floor's edge the reflection fades under the same dark sheen as before.
    const wet = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshBasicMaterial({ color: 0x010203, transparent: true, opacity: 0.86, alphaMap: fade, depthWrite: false }));
    wet.rotation.x = -Math.PI / 2; wet.position.y = 0.001; wet.renderOrder = 0;
    scene.add(under, wet, this.floor, this.rings);
    this.glow = new THREE.SpriteMaterial({ map: gradient(64, [[0, 'rgba(255,248,232,1)'], [0.25, 'rgba(255,240,215,0.55)'], [1, 'rgba(255,240,215,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });

    this.kind = null;
    this.car = null;
    this.mirror = null;
    this.fit = { w: 4, h: 1.8 };
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.t0 = performance.now();
    this.heli = null;
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/heli.glb`).then((g) => {
      if (this.done) return;
      const m = g.scene;
      m.traverse((o) => { if (o.isMesh && o.material.transparent) { o.material.depthWrite = false; o.renderOrder = 2; } });
      m.position.y = -new THREE.Box3().setFromObject(m).min.y;
      this.heli = new THREE.Group(); this.heli.add(m);
      if (this.kind === 'heli') this.show('heli');
    }).catch(() => {});

    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.resize();
    const loop = () => { if (this.done) return; this.render(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  // Show a vehicle (a car kind or 'heli'). Called again when that model's file arrives.
  // arrive: true when the player picked it, so it rolls in onto the stage and then switches its
  // lights on; otherwise it is simply there, lights on.
  show(kind, arrive = false) {
    this.kind = kind;
    this.car?.removeFromParent(); this.mirror?.removeFromParent();
    let model;
    if (kind === 'heli') {
      if (!this.heli) { this.car = this.mirror = null; return; } // appears when its file is in
      model = { group: this.heli.clone(true) };
    } else {
      if (!modelReady(kind)) { this.car = this.mirror = null; return; } // appears when its file is in
      model = buildVehicleModel(kind);
      // Its own lamp materials, so switching them on here never lights another copy.
      const head = model.lightMat, tail = model.tailMat;
      model.lightMat = head.clone(); model.tailMat = tail.clone();
      model.group.traverse((o) => { if (!o.isMesh) return; if (o.material === head) o.material = model.lightMat; else if (o.material === tail) o.material = model.tailMat; });
    }
    // Coming in from an empty stage (its file just arrived), it fades in rather than popping.
    if (!this.car) { const c = this.canvas; c.style.transition = 'none'; c.style.opacity = '0'; requestAnimationFrame(() => requestAnimationFrame(() => { c.style.transition = 'opacity 700ms ease-out'; c.style.opacity = '1'; })); }
    const car = this.car = model.group;
    this.scene.add(car);
    // Measured square on, before it turns: a box measured after turning and turned back would
    // come out far bigger than the vehicle, and draw it small.
    car.rotation.y = 0;
    car.updateMatrixWorld(true);
    // Fit: measured from the body, so the helicopter's rotor blades (wider than its cabin) do not
    // shrink it; they may overhang a little. w is its width on screen at this angle, h its height.
    const body = new THREE.Box3();
    const isBlade = (o) => { for (let n = o; n && n !== car; n = n.parent) if (/blade|rotor/i.test(n.name)) return true; return false; };
    car.traverse((o) => { if (o.isMesh && !o.userData.blur && !isBlade(o)) body.expandByObject(o); });
    const size = body.getSize(new THREE.Vector3());
    // The stage resizes to each vehicle: the rim (a little wider than the vehicle is long) and the
    // framing ease from the last vehicle's size to this one's rather than jumping.
    const fit = { w: size.z * Math.sin(YAW) + size.x * Math.cos(YAW), h: size.y };
    const R = Math.max(size.z, size.x) * 0.56;
    this.target = { R, w: fit.w, h: fit.h };
    if (!this.stage) { this.stage = { ...this.target }; this.fit = fit; this.floor.scale.setScalar(R * 1.4); this.rings.scale.setScalar(R / 0.8); }
    // A soft glow on each headlamp. A lamp part often holds both lamps (left and right in one
    // mesh), so its points are split by side and each side gets its own glow at that lamp.
    const glow = this.glow.clone();
    this.lamps = { head: model.lightMat || null, tail: model.tailMat || null, glow };
    if (model.lightMat) {
      const sides = [new THREE.Box3(), new THREE.Box3()], v = new THREE.Vector3();
      car.traverse((o) => {
        if (!o.isMesh || o.material !== model.lightMat) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (v.z > 0) sides[v.x < 0 ? 0 : 1].expandByPoint(v);
        }
      });
      for (const b of sides) {
        if (b.isEmpty()) continue;
        const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
        const s = new THREE.Sprite(glow);
        s.position.set(c.x, c.y, b.max.z + 0.03);
        s.scale.setScalar(Math.min(0.45, Math.max(0.25, Math.max(sz.x, sz.y) * 1.6)));
        car.add(s);
      }
    }
    car.rotation.y = YAW; // three-quarters on
    // The reflection: the same vehicle upside down under the wet ground.
    this.mirror = car.clone(true);
    this.mirror.scale.y = -1;
    this.mirror.traverse((o) => { if (o.isSprite) o.visible = false; }); // no lamp glow in the reflection
    this.scene.add(this.mirror);
    this.wheels = model.wheels || [];
    // The helicopter's rotors, each spun about its thinnest axis (flat main rotor, upright tail).
    this.rotors = [];
    if (kind === 'heli') {
      for (const root of [car, this.mirror]) root.traverse((o) => {
        if (!/rotor|blade/i.test(o.name) || /rotor|blade/i.test(o.parent?.name || '')) return;
        const box = new THREE.Box3().setFromObject(o), sz = box.getSize(new THREE.Vector3());
        const axis = sz.y <= sz.x && sz.y <= sz.z ? 'y' : sz.x <= sz.z ? 'x' : 'z';
        // Only parts that turn about their own centre; one whose pivot sits elsewhere would swing
        // round the helicopter instead of spinning.
        const c = box.getCenter(new THREE.Vector3()), w = o.getWorldPosition(new THREE.Vector3());
        const off = axis === 'y' ? Math.hypot(c.x - w.x, c.z - w.z) : axis === 'x' ? Math.hypot(c.y - w.y, c.z - w.z) : Math.hypot(c.x - w.x, c.y - w.y);
        if (off > Math.max(sz.x, sz.y, sz.z) * 0.08) return;
        this.rotors.push({ o, axis });
      });
    }
    this.spin = arrive ? 1 : 0;
    this.arrive = arrive && !this.reduce ? { t0: performance.now(), heli: kind === 'heli' } : null;
    this.setLights(this.arrive ? 0 : 1);
    if (arrive && this.reduce) this.lightsFrom = performance.now(); // no roll, just the lights
  }

  // Lamps from off (0) to on (1): headlamps, tail lamps and their glow together.
  setLights(k) {
    const L = this.lamps;
    if (!L) return;
    if (L.head) L.head.emissiveIntensity = 3 * k;
    if (L.tail) L.tail.emissiveIntensity = 0.15 + 1.05 * k;
    L.glow.opacity = k;
  }

  // A model file has arrived: redraw if it is the one on show.
  refresh(kind) { if (kind === this.kind) this.show(kind); }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (!this.car) { this.renderer.clear(); return; }
    const W = innerWidth, H = innerHeight, cam = this.camera;
    // The layout's spot is the free space for the vehicle. It stands on a ground line near the
    // spot's foot and fills most of it: as wide as fits, and no taller than the space above the
    // ground line, whichever is smaller. Its reflection runs on below.
    const r = this.spot?.getBoundingClientRect();
    const sp = r && r.width > 40 && r.height > 40 ? r : { left: W * 0.1, top: H * 0.5, width: W * 0.5, height: H * 0.4 };
    const k = SCALE[this.kind] || 1;
    // Never taller than the room below the name, whatever the scale.
    const maxW = Math.min(sp.width * 0.92, W * 0.6) * k, maxH = sp.height * Math.min(0.72, 0.68 * k);
    const focal = H / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const dist = Math.max(3, (this.fit.w * focal) / maxW, (this.fit.h * focal) / maxH);
    const ground = sp.top + sp.height * 0.8; // room below for the front of the turntable
    const cx = sp.left + sp.width * 0.5, cy = ground - (this.fit.h * focal) / dist / 2;
    // A slow drift round the vehicle, never more than a few degrees.
    const now = performance.now(), t = this.reduce ? 0 : (now - this.t0) / 1000;
    // Rolling in: from 7 m back along its own heading, slowing to a stop on its mark, the wheels
    // turning with the distance. Then the lights: a quick flicker as they catch, then full.
    let off = 0, lift = 0;
    if (this.arrive?.heli) {
      // The helicopter comes down from above onto the pad: quick at first, settling gently.
      const u = Math.min(1, (now - this.arrive.t0) / 2600), ease = 1 - Math.pow(1 - u, 3);
      lift = this.fit.h * 2.4 * (1 - ease);
      if (u >= 1) this.arrive = null;
    } else if (this.arrive) {
      const u = Math.min(1, (now - this.arrive.t0) / 1100), ease = 1 - Math.pow(1 - u, 3);
      off = -7 * (1 - ease);
      for (const w of this.wheels) if (w.spin) w.spin.rotation.x = (off / (w.R || 0.35)) % (Math.PI * 2);
      if (u >= 1) { this.arrive = null; this.lightsFrom = now; }
    }
    // Rotors: full speed while it lands, then winding down.
    if (this.rotors?.length) {
      const dt = Math.min(0.05, (now - (this.lastT || now)) / 1000);
      if (!this.arrive) this.spin = Math.max(0, this.spin - dt * 0.35);
      for (const r of this.rotors) r.o.rotation[r.axis] += dt * 38 * this.spin;
    }
    // Ease the stage toward this vehicle's size (about 0.6 s).
    if (this.target && this.stage) {
      const dt2 = Math.min(0.05, (now - (this.lastT || now)) / 1000), e = 1 - Math.exp(-dt2 * 6);
      for (const k of ['R', 'w', 'h']) this.stage[k] += (this.target[k] - this.stage[k]) * e;
      this.floor.scale.setScalar(this.stage.R * 1.4); this.rings.scale.setScalar(this.stage.R / 0.8);
      this.fit = { w: this.stage.w, h: this.stage.h };
    }
    this.lastT = now;
    this.car.position.set(Math.sin(YAW) * off, lift, Math.cos(YAW) * off);
    this.mirror.position.set(this.car.position.x, -lift, this.car.position.z);
    if (this.lightsFrom) {
      const l = (now - this.lightsFrom) / 1000;
      this.setLights(l < 0.07 ? 0.7 : l < 0.14 ? 0.05 : l < 0.2 ? 0.9 : l < 0.26 ? 0.3 : Math.min(1, 0.6 + (l - 0.26) * 2));
      if (l > 0.5) this.lightsFrom = 0;
    }
    const a = 0.18 * Math.sin(t * 0.06);
    // A little above the vehicle (about 11 degrees), so the turntable reads as a ring.
    cam.position.set(Math.sin(a) * dist * 0.98, dist * 0.19, Math.cos(a) * dist * 0.98);
    if (!this.reduce) this.rings.rotation.z = t * 0.05;
    cam.lookAt(0, this.fit.h / 2, 0);
    cam.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    this.renderer.render(this.scene, cam);
  }

  dispose() {
    this.done = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
