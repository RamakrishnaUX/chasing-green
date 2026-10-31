import * as THREE from 'three';
import { roadPaths, heightAt, waterLevelAt, roadDistAt, coastAt } from './terrain.js';
import { PLACES } from './geo.js';
import { mulberry32 } from './noise.js';

// Towns: clusters of houses along their roads, plus apartment blocks in the bigger ones.
const SIZE = {
  'Reykjavík': { houses: 20, radius: 180, blocks: 4 }, 'Akureyri': { houses: 12, radius: 132, blocks: 2 },
  'Keflavík': { houses: 7, radius: 96, blocks: 1 }, 'Selfoss': { houses: 6, radius: 96 },
  'Vík': { houses: 4, radius: 72 }, 'Húsavík': { houses: 6, radius: 84 }, 'Höfn': { houses: 5, radius: 76 },
  'Egilsstaðir': { houses: 5, radius: 84 }, 'Borgarnes': { houses: 4, radius: 72 }, 'Grundarfjörður': { houses: 4, radius: 68 },
  'Hella': { houses: 2, radius: 57 }, 'Blönduós': { houses: 3, radius: 63 }, 'Kirkjubæjarklaustur': { houses: 2, radius: 52 },
  'Djúpivogur': { houses: 2, radius: 57 }, 'Seyðisfjörður': { houses: 6, radius: 72 }, 'Siglufjörður': { houses: 4, radius: 68 }, 'Ísafjörður': { houses: 5, radius: 72 },
};
const WALLS = [0xf1efe8, 0xe9e4d6, 0xdfe6e8, 0xe8d9c4, 0xc9d6d1, 0xe0c8b8, 0xd5d0c4, 0x9bb3be];
const ROOFS = [0xa3281e, 0xa3281e, 0x2f6d4a, 0x35506b, 0x55595d, 0x7a2f2a, 0x2a2d30];

function windowTexture(rand) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    if (rand() < 0.45) continue;
    g.fillStyle = rand() < 0.8 ? '#ffcf7a' : '#cfe4ff';
    g.fillRect(4 + x * 15, 6 + y * 15, 9, 9);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Corrugated iron: stripes sized from each instance's own scale, so every house gets the same pitch.
function corrugated(mat, kind) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCorr; varying float vHgt;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        ${kind === 'roof' ? 'vCorr = position.z * sc.z;' : 'vCorr = abs(normal.x) > 0.5 ? position.z * sc.z : position.x * sc.x;'}
        vHgt = position.y * sc.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCorr; varying float vHgt;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rib = smoothstep(-0.35, 0.35, sin(vCorr * ${kind === 'roof' ? '24.0' : '38.0'}));
        diffuseColor.rgb *= ${kind === 'roof' ? '0.82 + 0.18 * rib' : '0.9 + 0.1 * rib'};
        ${kind === 'wall' ? 'diffuseColor.rgb *= mix(0.82, 1.0, smoothstep(0.0, 0.9, vHgt));' : ''}`);
  };
  return mat;
}
// Window glass: dark by day; at night each instance glows in its own colour (black means unlit).
function litGlass() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.12, metalness: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vec3(0.06, 0.08, 0.1);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif');
  };
  return m;
}

export class Towns {
  constructor(scene, { landmarks = [], obstacles = null, scale = 1 } = {}) {
    const rand = mulberry32(4242);
    const houses = [], blocks = [];
    for (const place of PLACES) {
      const cfg = SIZE[place.name];
      if (!cfg) continue;
      const near = roadPaths.flatMap((p) => p.pts.map((q, i) => ({ q, p, i }))).filter(({ q }) => Math.hypot(q.x - place.x, q.z - place.z) < cfg.radius);
      if (!near.length) continue;
      const want = Math.round(cfg.houses * scale), wantBlocks = Math.round((cfg.blocks || 0) * scale);
      let tries = 0, made = 0, madeBlocks = 0;
      while ((made < want || madeBlocks < wantBlocks) && tries < (want + wantBlocks) * 25) {
        tries++;
        const { q, p, i } = near[Math.floor(rand() * near.length)];
        const n = p.pts[Math.min(p.pts.length - 1, i + 1)], o = p.pts[Math.max(0, i - 1)];
        const dx = n.x - o.x, dz = n.z - o.z, L = Math.hypot(dx, dz) || 1;
        const side = rand() < 0.5 ? -1 : 1;
        const block = madeBlocks < wantBlocks && rand() < 0.35;
        const off = (block ? 16 : 10) + rand() * (cfg.radius * 0.45);
        const along = (rand() - 0.5) * 8;
        const x = q.x + (-dz / L) * off * side + (dx / L) * along, z = q.z + (dx / L) * off * side + (dz / L) * along;
        const h = heightAt(x, z);
        if (h < waterLevelAt(x, z) + 0.8 || coastAt(x, z) < 6) continue;
        // Size first, so the whole footprint (not just the centre) stays clear of every road.
        const bw = block ? 10 + rand() * 8 : 5 + rand() * 3, bd = block ? 9 + rand() * 4 : 7 + rand() * 4;
        if (roadDistAt(x, z) < Math.hypot(bw, bd) / 2 + 4) continue;
        const slope = Math.abs(heightAt(x + 4, z) - heightAt(x - 4, z)) + Math.abs(heightAt(x, z + 4) - heightAt(x, z - 4));
        if (slope > 1.6) continue; // gentle ground only, so foundations stay short
        if (landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < (l.id === 'perlan' ? 38 : l.id === 'hallgrimskirkja' || l.id === 'harpa' ? 30 : 22))) continue;
        const rot = Math.atan2(dx, dz) + (rand() - 0.5) * 0.15;
        const all = houses.concat(blocks);
        if (all.some((b) => Math.hypot(b.x - x, b.z - z) < (block ? 14 : 7.5))) continue;
        if (block) {
          blocks.push({ x, z, y: h, rot, w: bw, d: bd, h: 9 + rand() * 12 });
          madeBlocks++;
        } else {
          houses.push({ x, z, y: h, rot, w: bw, d: bd, h: 3 + rand() * 1.8, wall: WALLS[Math.floor(rand() * WALLS.length)], roof: ROOFS[Math.floor(rand() * ROOFS.length)] });
          made++;
        }
      }
    }
    this.build(scene, houses, blocks, rand, obstacles);
    this.count = houses.length + blocks.length;
  }

  build(scene, houses, blocks, rand, obstacles) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const n = Math.max(1, houses.length);
    const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
    const shape = new THREE.Shape(); shape.moveTo(-0.56, 0); shape.lineTo(0.56, 0); shape.lineTo(0, 0.42); shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.08, bevelEnabled: false }); roofGeo.translate(0, 0, -0.54);
    // One instanced mesh per part. Window frames and glass are separate so the glass can glow.
    const parts = {
      walls: new THREE.InstancedMesh(unit, corrugated(new THREE.MeshStandardMaterial({ roughness: 0.8 }), 'wall'), n),
      base: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x4a4c4f, roughness: 0.95 }), n),
      roofs: new THREE.InstancedMesh(roofGeo, corrugated(new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.4 }), 'roof'), n),
      ridge: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.4 }), n),
      trim: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.7 }), n * 2),
      chimney: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x8c8580, roughness: 0.9 }), n),
      door: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.6 }), n),
      frames: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: 0.6 }), n * 6),
      glass: new THREE.InstancedMesh(unit, litGlass(), n * 6),
      bars: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: 0.6 }), n * 12),
      sills: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.7 }), n * 6),
      steps: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x7a7c7f, roughness: 0.9 }), n),
      canopy: new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.4 }), n),
    };
    const DOORS = [0xa3281e, 0x2f6d4a, 0x35506b, 0x1f1f22, 0xc9a24a];
    const put = (mesh, i, x, y, z, w, h, d, rot, color) => {
      q.setFromAxisAngle(up, rot); v.set(x, y, z); sc.set(w, h, d);
      m4.compose(v, q, sc); mesh.setMatrixAt(i, m4);
      if (color !== undefined) mesh.setColorAt(i, c.set(color));
    };
    // Place a part at a position given in the house's own frame (x across, z along).
    const local = (b, lx, lz) => ({ x: b.x + Math.cos(b.rot) * lx + Math.sin(b.rot) * lz, z: b.z - Math.sin(b.rot) * lx + Math.cos(b.rot) * lz });
    let fi = 0, gi = 0, ti = 0, bi = 0, si = 0;
    const WARM = [0xffc46b, 0xffd896, 0xffb050, 0xffe8c0, 0xf0a860];
    houses.forEach((b, i) => {
      // Sit the floor on the highest corner and run the foundation down to the lowest,
      // so no house ever floats on a slope.
      let lo = 1e9, hi = -1e9;
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const p = local(b, cx * b.w / 2, cz * b.d / 2); const g = heightAt(p.x, p.z); lo = Math.min(lo, g); hi = Math.max(hi, g); }
      b.y = hi + 0.25;
      put(parts.base, i, b.x, lo - 0.4, b.z, b.w + 0.3, b.y - lo + 0.45, b.d + 0.3, b.rot);
      put(parts.walls, i, b.x, b.y, b.z, b.w, b.h, b.d, b.rot, b.wall);
      put(parts.roofs, i, b.x, b.y + b.h, b.z, b.w, b.w, b.d, b.rot, b.roof);
      put(parts.ridge, i, b.x, b.y + b.h + b.w * 0.42 - 0.06, b.z, 0.16, 0.12, b.d + 0.4, b.rot);
      const corner = local(b, b.w * 0.22, -b.d * 0.3);
      put(parts.chimney, i, corner.x, b.y + b.h + b.w * 0.3, corner.z, 0.5, b.w * 0.2 + 0.5, 0.5, b.rot);
      // Fascia boards under the eaves on both long sides.
      for (const sx of [-1, 1]) { const e = local(b, sx * (b.w / 2 + 0.05), 0); put(parts.trim, ti++, e.x, b.y + b.h - 0.22, e.z, 0.1, 0.22, b.d + 0.4, b.rot); }
      // Door on the front, windows along both long sides and the back.
      const front = local(b, 0.35 * b.w * (rand() < 0.5 ? -1 : 1), b.d / 2 + 0.02);
      put(parts.door, i, front.x, b.y, front.z, 0.9, 2.0, 0.08, b.rot, DOORS[Math.floor(rand() * DOORS.length)]);
      const stepP = local(b, (front.x - b.x) * Math.cos(b.rot) - (front.z - b.z) * Math.sin(b.rot), b.d / 2 + 0.45);
      put(parts.steps, i, stepP.x, b.y - 0.3, stepP.z, 1.4, 0.3, 0.8, b.rot);
      const canP = local(b, (front.x - b.x) * Math.cos(b.rot) - (front.z - b.z) * Math.sin(b.rot), b.d / 2 + 0.45);
      put(parts.canopy, i, canP.x, b.y + 2.2, canP.z, 1.6, 0.12, 0.9, b.rot);
      const spots = [];
      const nz = Math.max(1, Math.floor(b.d / 3));
      for (let k = 0; k < nz; k++) for (const sx of [-1, 1]) spots.push([sx * (b.w / 2 + 0.02), -b.d / 2 + (k + 0.5) * (b.d / nz), 0]);
      spots.push([-0.35 * b.w * Math.sign(front.x - b.x || 1), b.d / 2 + 0.02, 1]);
      for (const [lx, lz, isFront] of spots.slice(0, 6)) {
        const w = local(b, lx, lz);
        const rot = b.rot + (isFront ? 0 : Math.PI / 2);
        put(parts.frames, fi++, w.x, b.y + 1.05, w.z, 1.0, 1.15, 0.1, rot);
        // About half the windows are lit at night, each a slightly different warm tone.
        put(parts.glass, gi++, w.x, b.y + 1.13, w.z, 0.78, 0.95, 0.12, rot, rand() < 0.5 ? WARM[Math.floor(rand() * WARM.length)] : 0x000000);
        put(parts.bars, bi++, w.x, b.y + 1.13, w.z, 0.05, 0.95, 0.15, rot);
        put(parts.bars, bi++, w.x, b.y + 1.55, w.z, 0.78, 0.05, 0.15, rot);
        put(parts.sills, si++, w.x, b.y + 0.98, w.z, 1.15, 0.08, 0.26, rot);
      }
      obstacles?.addBox(b.x, b.z, b.rot, b.w / 2 + 0.15, b.d / 2 + 0.15, 'wall');
    });
    parts.frames.count = fi; parts.glass.count = gi; parts.trim.count = ti; parts.bars.count = bi; parts.sills.count = si;
    for (const m of Object.values(parts)) { m.castShadow = true; m.receiveShadow = true; if (!houses.length) m.count = 0; scene.add(m); }
    const winMat = parts.glass.material;
    // Apartment blocks with lit windows.
    const tex = windowTexture(rand);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
    blockMat.onBeforeCompile = (sh) => {
      // Repeat the window pattern by the block's size (stored in the instance scale).
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_EMISSIVEMAP\nvEmissiveMapUv = uv * vec2(length(instanceMatrix[0].xyz) / 5.0, length(instanceMatrix[1].xyz) / 10.0);\n#endif');
    };
    const bm = new THREE.InstancedMesh(unit, blockMat, Math.max(1, blocks.length));
    blocks.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      let lo = 1e9; for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lo = Math.min(lo, heightAt(b.x + cx * b.w / 2, b.z + cz * b.d / 2));
      v.set(b.x, lo - 0.4, b.z); sc.set(b.w, b.h + (b.y - lo) + 0.4, b.d);
      m4.compose(v, q, sc); bm.setMatrixAt(i, m4);
      obstacles?.addBox(b.x, b.z, b.rot, b.w / 2, b.d / 2, 'wall');
    });
    bm.castShadow = true; bm.receiveShadow = true;
    if (!blocks.length) bm.count = 0;
    scene.add(bm);
    this.night = [winMat, blockMat];
  }

  setNight(dark) {
    this.night[0].emissiveIntensity = dark * 1.1;
    this.night[1].emissiveIntensity = dark * 1.3;
  }
}
