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
const SCALE = { race: 0.8, jeep: 1.08, vintage: 1.06 };

function gradient(size, stops, radial = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = radial ? g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2) : g.createLinearGradient(0, 0, 0, size);
  for (const [at, col] of stops) gr.addColorStop(at, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
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
    const fade = gradient(256, [[0, '#fff'], [0.62, '#fff'], [1, '#000']]);
    const under = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshBasicMaterial({ color: 0x010203, transparent: true, alphaMap: fade, depthWrite: false }));
    under.rotation.x = -Math.PI / 2; under.position.y = -6; under.renderOrder = -1;
    const wet = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshBasicMaterial({ color: 0x010203, transparent: true, opacity: 0.8, alphaMap: fade, depthWrite: false }));
    wet.rotation.x = -Math.PI / 2; wet.position.y = 0.002; wet.renderOrder = 1;
    scene.add(under, wet);
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
  show(kind) {
    this.kind = kind;
    this.car?.removeFromParent(); this.mirror?.removeFromParent();
    let model;
    if (kind === 'heli') {
      if (!this.heli) { this.car = this.mirror = null; return; } // appears when its file is in
      model = { group: this.heli.clone(true) };
    } else {
      if (!modelReady(kind)) { this.car = this.mirror = null; return; } // appears when its file is in
      model = buildVehicleModel(kind);
      model.lightMat.emissiveIntensity = 3; model.tailMat.emissiveIntensity = 1.2;
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
    this.fit = { w: size.z * Math.sin(YAW) + size.x * Math.cos(YAW), h: size.y };
    // A soft glow on each front lamp.
    if (model.lightMat) {
      const lamps = [], box = new THREE.Box3();
      car.traverse((o) => { if (o.isMesh && o.material === model.lightMat) lamps.push(o); });
      for (const o of lamps) {
        box.setFromObject(o);
        const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
        if (c.z < 0) continue;
        const s = new THREE.Sprite(this.glow);
        s.position.copy(c); s.position.z += sz.z / 2 + 0.02;
        s.scale.setScalar(Math.min(0.5, Math.max(0.3, Math.max(sz.x, sz.y) * 1.8)));
        car.add(s);
      }
    }
    car.rotation.y = YAW; // three-quarters on
    // The reflection: the same vehicle upside down under the wet ground.
    this.mirror = car.clone(true);
    this.mirror.scale.y = -1;
    this.scene.add(this.mirror);
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
    const maxW = Math.min(sp.width * 0.92, W * 0.6) * k, maxH = sp.height * Math.min(0.78, 0.74 * k);
    const focal = H / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const dist = Math.max(3, (this.fit.w * focal) / maxW, (this.fit.h * focal) / maxH);
    const ground = sp.top + sp.height * 0.86;
    const cx = sp.left + sp.width * 0.5, cy = ground - (this.fit.h * focal) / dist / 2;
    // A slow drift round the vehicle, never more than a few degrees.
    const t = this.reduce ? 0 : (performance.now() - this.t0) / 1000;
    const a = 0.18 * Math.sin(t * 0.06);
    cam.position.set(Math.sin(a) * dist, 1.35 * dist / 13, Math.cos(a) * dist);
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
