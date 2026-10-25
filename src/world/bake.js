// Merge the static meshes under a group into one mesh per material. A landmark or a farm is
// built from hundreds of small boxes and cylinders, and every separate mesh costs a draw call,
// which is what made the island slow. Merging keeps exactly the same shapes and materials.
//
// Left alone: instanced meshes, points and lines, see-through materials (they need sorting),
// materials whose shader reads a part's own coordinates (material.userData.localShading),
// anything hidden, and anything marked userData.dynamic or inside a group so marked (moving
// parts such as bubbles and wheels). Run it after collisions have been read from the meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();

// Reverse the winding of every triangle, for parts that were mirrored with a negative scale.
function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    return;
  }
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array, s = attr.itemSize;
    for (let v = 0; v < attr.count; v += 3) for (let k = 0; k < s; k++) {
      const i1 = (v + 1) * s + k, i2 = (v + 2) * s + k, t = a[i1]; a[i1] = a[i2]; a[i2] = t;
    }
  }
}

function signature(m) {
  const g = m.geometry;
  const attrs = Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}${g.attributes[k].normalized ? 'n' : ''}`).join(',');
  return [m.material.uuid, attrs, g.index ? 'i' : 'n', m.castShadow, m.receiveShadow, m.renderOrder, m.layers.mask].join('|');
}

function mergeable(m) {
  if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || !m.visible) return false;
  if (Array.isArray(m.material) || m.material.transparent || m.material.userData.localShading) return false;
  const g = m.geometry;
  if (!g?.attributes.position || Object.keys(g.morphAttributes).length) return false;
  return !Object.values(g.attributes).some((a) => a.isInterleavedBufferAttribute);
}

export function bakeStatic(root) {
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const buckets = new Map();
  const walk = (o) => {
    if (o.userData.dynamic) return;
    if (o !== root && mergeable(o)) {
      const key = signature(o);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  let before = 0, after = 0;
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      rel.multiplyMatrices(inv, m.matrixWorld);
      const g = m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(rel);
      if (rel.determinant() < 0) flipWinding(g);
      g.clearGroups();
      return g;
    });
    // All geometries in a bucket share attributes, but dropping extras above may leave some
    // without uv or color where others have it; merge only the ones that line up.
    const names = Object.keys(geos[0].attributes).sort().join();
    const ok = geos.map((g) => Object.keys(g.attributes).sort().join() === names);
    const merged = mergeGeometries(geos.filter((_, i) => ok[i]), false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const src = meshes[0];
    const mesh = new THREE.Mesh(merged, src.material);
    mesh.castShadow = src.castShadow; mesh.receiveShadow = src.receiveShadow;
    mesh.renderOrder = src.renderOrder; mesh.layers.mask = src.layers.mask;
    mesh.userData.baked = true;
    root.add(mesh);
    meshes.forEach((m, i) => {
      if (!ok[i] || !m.parent) return;
      // A merged part may still carry children that were not merged: keep its transform as a
      // plain node so they stay where they were.
      if (m.children.length) {
        const node = new THREE.Object3D();
        node.position.copy(m.position); node.quaternion.copy(m.quaternion); node.scale.copy(m.scale);
        node.userData = m.userData;
        m.parent.children[m.parent.children.indexOf(m)] = node;
        node.parent = m.parent; m.parent = null;
        for (const c of [...m.children]) node.add(c);
      } else m.parent.remove(m);
    });
    before += meshes.filter((_, i) => ok[i]).length; after++;
  }
  return { before, after };
}
