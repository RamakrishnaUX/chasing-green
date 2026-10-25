// Pictures of each car for the Cars tab, rendered once with a throwaway renderer. The camera
// sits close at a low front three-quarter angle, so the car fills the frame and the back is
// cropped away: a portrait of the car rather than a small car in empty space.
import * as THREE from 'three';
import { buildVehicleModel } from '../vehicle/models.js';

let cache = null;
export function carThumbs(kinds, w = 960, h = 540) {
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
  for (const kind of kinds) {
    const m = buildVehicleModel(kind);
    scene.add(m.group);
    const box = new THREE.Box3().setFromObject(m.group);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const d = Math.max(s.x, s.y, s.z) * (kind === 'camper' ? 0.9 : 0.8);
    if (kind === 'camper') {
      // The camper's character is the graffiti, so it is framed from the side, back half.
      camera.position.set(c.x + d * 1.05, c.y + d * 0.04, c.z - d * 0.42);
      camera.lookAt(c.x, c.y - s.y * 0.08, c.z - s.z * 0.16);
    } else {
      camera.position.set(c.x + d * 0.78, c.y + d * 0.06, c.z + d * 0.86);
      camera.lookAt(c.x + s.x * 0.08, c.y - s.y * 0.05, c.z + s.z * 0.2);
    }
    renderer.render(scene, camera);
    cache[kind] = renderer.domElement.toDataURL('image/png');
    scene.remove(m.group);
    m.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return cache;
}
