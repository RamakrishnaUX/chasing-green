// The start screen's hero shot: one vehicle at a time, lit like a studio photograph on wet black
// ground, drawn over the aurora sky (auroraSky.js) on its own transparent canvas. It starts with
// the code-built stand-ins and swaps in each model file as it arrives. The vehicle sits over the
// `spot` element, so the page layout decides where it goes and how big it is.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildVehicleModel } from '../vehicle/models.js';

const FOV = 26;

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
    this.fit = { size: 4, aimY: 0.8 };
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
      model = buildVehicleModel(kind);
      model.lightMat.emissiveIntensity = 3; model.tailMat.emissiveIntensity = 1.2;
    }
    const car = this.car = model.group;
    car.rotation.y = 0.62; // three-quarters on
    this.scene.add(car);
    car.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(car.matrixWorld).invert();
    // Fit: every vehicle about the same size on screen, whatever its length.
    const size = new THREE.Box3().setFromObject(car).applyMatrix4(inv).getSize(new THREE.Vector3());
    this.fit = { size: Math.max(size.z, size.x * 0.8) * (kind === 'heli' ? 0.83 : 1), aimY: size.y * 0.5 };
    // A soft glow on each front lamp.
    if (model.lightMat) {
      const lamps = [], box = new THREE.Box3();
      car.traverse((o) => { if (o.isMesh && o.material === model.lightMat) lamps.push(o); });
      for (const o of lamps) {
        box.setFromObject(o).applyMatrix4(inv);
        const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
        if (c.z < 0) continue;
        const s = new THREE.Sprite(this.glow);
        s.position.copy(c); s.position.z += sz.z / 2 + 0.02;
        s.scale.setScalar(Math.min(0.7, Math.max(0.35, Math.max(sz.x, sz.y) * 2.2)));
        car.add(s);
      }
    }
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
    // Where the layout wants the vehicle, and how wide.
    const r = this.spot?.getBoundingClientRect();
    const cx = r && r.width ? r.left + r.width * 0.55 : W * 0.42, cy = r && r.height ? r.top + r.height * 0.42 : H * 0.7;
    const wantW = r && r.width ? Math.min(r.width * (r.width < 900 ? 0.8 : 0.62), r.height * 1.7) : W * 0.32;
    const focal = H / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const dist = Math.max(4, (this.fit.size * 0.92 * focal) / Math.max(120, wantW));
    // A slow drift round the vehicle, never more than a few degrees.
    const t = this.reduce ? 0 : (performance.now() - this.t0) / 1000;
    const a = 0.18 * Math.sin(t * 0.06);
    cam.position.set(Math.sin(a) * dist, 1.35 * dist / 13, Math.cos(a) * dist);
    cam.lookAt(0, this.fit.aimY, 0);
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
