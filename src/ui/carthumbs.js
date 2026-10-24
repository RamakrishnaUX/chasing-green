// Small pictures of each car for the garage, rendered once with a throwaway renderer.
import * as THREE from 'three';
import { buildVehicleModel } from '../vehicle/models.js';

let cache = null;
export function carThumbs(kinds, w = 360, h = 220) {
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
  const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 100);
  for (const kind of kinds) {
    const m = buildVehicleModel(kind);
    scene.add(m.group);
    const box = new THREE.Box3().setFromObject(m.group);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const d = Math.max(s.x, s.y, s.z) * 2.3;
    camera.position.set(c.x + d * 0.62, c.y + d * 0.28, c.z + d * 0.72);
    camera.lookAt(c);
    renderer.render(scene, camera);
    cache[kind] = renderer.domElement.toDataURL('image/png');
    scene.remove(m.group);
    m.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return cache;
}
