// Pictures of each car for the Cars tab, rendered once with a throwaway renderer. Every car is
// seen whole from the same front three-quarter angle and the same distance, so the pictures
// show the cars' true sizes side by side, with a calm margin around even the biggest.
import * as THREE from 'three';
import { buildVehicleModel } from '../vehicle/models.js';

// Share of the frame the biggest car spans, across and up.
const FILL_X = 0.86, FILL_Y = 0.78;

let cache = null;
export function carThumbs(kinds, w = 960, h = 600) {
  if (cache) return cache;
  cache = {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch { return cache; }
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe9f2, 0x2a3440, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(4, 6, 5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
  const dir = new THREE.Vector3(0.92, 0.24, 0.72).normalize();
  const q = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const shots = kinds.map((kind) => {
    const m = buildVehicleModel(kind);
    const box = new THREE.Box3().setFromObject(m.group);
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const look = box.getCenter(new THREE.Vector3());
    let d = box.getSize(q).length() * 2;
    // Frame by measuring: project the box, recentre on it, and move in or out to the set fill.
    for (let k = 0; k < 5; k++) {
      camera.position.copy(look).addScaledVector(dir, d);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of corners) {
        q.copy(p).project(camera);
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      }
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      look.addScaledVector(right, ((x0 + x1) / 2) * d * tanY * camera.aspect).addScaledVector(up, ((y0 + y1) / 2) * d * tanY);
      d *= Math.max((x1 - x0) / 2 / FILL_X, (y1 - y0) / 2 / FILL_Y);
    }
    return { kind, m, look, d };
  });
  const far = Math.max(...shots.map((s) => s.d));
  for (const { kind, m, look } of shots) {
    scene.add(m.group);
    camera.position.copy(look).addScaledVector(dir, far);
    camera.lookAt(look);
    renderer.render(scene, camera);
    cache[kind] = renderer.domElement.toDataURL('image/png');
    scene.remove(m.group);
    m.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return cache;
}
