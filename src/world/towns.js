import * as THREE from 'three';
import { roadPaths, heightAt, waterLevelAt, roadDistAt, coastAt } from './terrain.js';
import { PLACES } from './geo.js';
import { mulberry32 } from './noise.js';
import { archMats, Batch, frame, addHouse, addBlock, addFarHouse, addFarBlock, WALLS, ROOFS } from './archkit.js';

// Towns: clusters of houses along their roads, plus apartment blocks in the bigger ones.
// Houses are built like real Icelandic ones (archkit.js): corrugated-iron walls on a concrete
// foundation, a corrugated roof with ridge cap, gutters and downpipes, white-framed windows with
// glazing bars and sills, steps and railings to the door, chimneys, dormers, porches and fences.
// Each town is written into one mesh per shared material and swaps to a plain far version
// (walls, roofs and lit windows in two draws) past a distance.
const SIZE = {
  'Reykjavík': { houses: 20, radius: 180, blocks: 4 }, 'Akureyri': { houses: 12, radius: 132, blocks: 2 },
  'Keflavík': { houses: 7, radius: 96, blocks: 1 }, 'Selfoss': { houses: 6, radius: 96 },
  'Vík': { houses: 4, radius: 72 }, 'Húsavík': { houses: 6, radius: 84 }, 'Höfn': { houses: 5, radius: 76 },
  'Egilsstaðir': { houses: 5, radius: 84 }, 'Borgarnes': { houses: 4, radius: 72 }, 'Grundarfjörður': { houses: 4, radius: 68 },
  'Hella': { houses: 2, radius: 57 }, 'Blönduós': { houses: 3, radius: 63 }, 'Kirkjubæjarklaustur': { houses: 2, radius: 52 },
  'Djúpivogur': { houses: 2, radius: 57 }, 'Seyðisfjörður': { houses: 6, radius: 72 }, 'Siglufjörður': { houses: 4, radius: 68 }, 'Ísafjörður': { houses: 5, radius: 72 },
  'Vestmannaeyjar': { houses: 7, radius: 50 },
};
const BLOCK_WALLS = [0xe9e7e0, 0xdcdad3, 0xd9d2c2, 0xc9d3d6, 0xe3d6bd, 0xd7c2b4, 0xb9c4b8, 0xf0efe9];
const BALCONY = [0xf4f3ee, 0xf4f3ee, 0x3a3d42, 0x9fb7c4, 0xc9a24a, 0x8aa38d];
const FENCES = [0xf4f3ee, 0xf4f3ee, 0xf4f3ee, 0xb33a2c, 0x2f6d4a, 0x3a3d42];
const pick = (rand, a) => a[Math.floor(rand() * a.length)];

export class Towns {
  constructor(scene, { landmarks = [], obstacles = null, scale = 1, clear = [], quality = scale < 1 ? 'low' : 'medium' } = {}) {
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
        if (roadDistAt(x, z) < Math.hypot(bw, bd) / 2 + 7) continue; // well back from the kerb
        const slope = Math.abs(heightAt(x + 4, z) - heightAt(x - 4, z)) + Math.abs(heightAt(x, z + 4) - heightAt(x, z - 4));
        if (slope > 1.6) continue; // gentle ground only, so foundations stay short
        if (landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < (l.id === 'perlan' ? 38 : l.id === 'harpa' ? 58 : l.id === 'hallgrimskirkja' ? 52 : l.id === 'laugavegur' ? 42 : 22))) continue;
        if (clear.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) continue; // fuel station forecourts
        const rot = Math.atan2(dx, dz) + (rand() - 0.5) * 0.15;
        const all = houses.concat(blocks);
        if (all.some((b) => Math.hypot(b.x - x, b.z - z) < (block ? 14 : 7.5))) continue;
        if (block) {
          blocks.push({ x, z, y: h, rot, w: bw, d: bd, h: 9 + rand() * 12, town: place.name, radius: cfg.radius, face: side });
          madeBlocks++;
        } else {
          houses.push({ x, z, y: h, rot, w: bw, d: bd, h: 3 + rand() * 1.8, wall: WALLS[Math.floor(rand() * WALLS.length)], roof: ROOFS[Math.floor(rand() * ROOFS.length)], town: place.name, radius: cfg.radius, face: side });
          made++;
        }
      }
    }
    this.build(scene, houses, blocks, rand, obstacles, quality);
    this.count = houses.length + blocks.length;
  }

  build(scene, houses, blocks, rand, obstacles, quality) {
    const M = archMats(), low = quality === 'low';
    // Red walls and black ones never get a red roof; pale walls avoid a pale grey one.
    for (const b of houses) if ((b.wall === 0xb33a2c && (b.roof === 0xa3281e || b.roof === 0x8e2a22))) b.roof = 0x3b3f44;
    const towns = new Map();
    for (const b of houses) (towns.get(b.town) || towns.set(b.town, { houses: [], blocks: [], radius: b.radius }).get(b.town)).houses.push(b);
    for (const b of blocks) (towns.get(b.town) || towns.set(b.town, { houses: [], blocks: [], radius: b.radius }).get(b.town)).blocks.push(b);
    this.group = new THREE.Group();
    this.group.userData.townInfo = { houses, blocks };
    const corners = (b, fn) => { for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const lx = cx * b.w / 2, lz = cz * b.d / 2; fn(b.x + Math.cos(b.rot) * lx + Math.sin(b.rot) * lz, b.z - Math.sin(b.rot) * lx + Math.cos(b.rot) * lz); } };
    const toWorld = (b, lx, lz) => ({ x: b.x + Math.cos(b.rot) * lx + Math.sin(b.rot) * lz, z: b.z - Math.sin(b.rot) * lx + Math.cos(b.rot) * lz });
    for (const [, T] of towns) {
      const all = T.houses.concat(T.blocks);
      const ox = all.reduce((s, b) => s + b.x, 0) / all.length, oz = all.reduce((s, b) => s + b.z, 0) / all.length;
      const near = new Batch(), far = new Batch();
      for (const b of T.houses) {
        // Sit the floor on the highest corner (some on a tall basement) and run the foundation
        // down to the lowest, so no house ever floats on a slope.
        let lo = 1e9, hi = -1e9;
        corners(b, (x, z) => { const g = heightAt(x, z); lo = Math.min(lo, g); hi = Math.max(hi, g); });
        b.y = hi + 0.25 + (rand() < 0.35 ? 0.45 + rand() * 0.55 : 0);
        b.floors = b.h > 3.9 ? 2 : 1;
        const s = { w: b.w, d: b.d, floors: b.floors, wallH: b.floors === 2 ? 5.3 + (b.h - 3.9) * 0.5 : 2.85 + (b.h - 3) * 0.6, lift: b.y - lo, face: b.face, wall: b.wall, roof: b.roof, fenceColor: pick(rand, FENCES) };
        const fp = toWorld(b, b.face * (b.w / 2 + 3), 0);
        s.fence = !low && rand() < 0.4 && roadDistAt(fp.x, fp.z) > 6;
        const F = frame(null, b.x - ox, b.y, b.z - oz, b.rot);
        const ground = (lx, lz) => { const p = toWorld(b, lx, lz); return heightAt(p.x, p.z) - b.y; };
        const res = addHouse(near, M, F, s, rand, { low, ground });
        addFarHouse(far, M, F, s, rand);
        obstacles?.addBox(b.x, b.z, b.rot, b.w / 2 + 0.15, b.d / 2 + 0.15, 'wall');
        for (const o of res.solids) { const p = toWorld(b, o.x, o.z); obstacles?.addBox(p.x, p.z, b.rot, o.hx, o.hz, 'wall'); }
      }
      for (const b of T.blocks) {
        let lo = 1e9, hi = -1e9;
        corners(b, (x, z) => { const g = heightAt(x, z); lo = Math.min(lo, g); hi = Math.max(hi, g); });
        b.y = hi + 0.25;
        const wall = pick(rand, BLOCK_WALLS);
        const s = { w: b.w, d: b.d, floors: Math.max(3, Math.round(b.h / 2.9)), lift: b.y - lo, wall, accent: new THREE.Color(wall).multiplyScalar(0.82).getHex(),
          frame: rand() < 0.7 ? 0xf4f3ee : 0x3a3d42, balcony: pick(rand, BALCONY), pitched: rand() < 0.4, roof: pick(rand, [0x3b3f44, 0xa3281e, 0x6b7378, 0x2c5a3f]) };
        const F = frame(null, b.x - ox, b.y, b.z - oz, b.rot);
        addBlock(near, M, F, s, rand, { low });
        addFarBlock(far, M, F, s, rand);
        obstacles?.addBox(b.x, b.z, b.rot, b.w / 2, b.d / 2, 'wall');
      }
      // Detailed within the town and a little way out; plain shapes beyond.
      const lod = new THREE.LOD();
      lod.position.set(ox, 0, oz);
      const ng = new THREE.Group(), fg = new THREE.Group();
      near.flush(ng); far.flush(fg);
      const spread = Math.max(...all.map((h) => Math.hypot(h.x - ox, h.z - oz)));
      lod.addLevel(ng, 0); lod.addLevel(fg, spread + (low ? 170 : quality === 'high' ? 420 : 300), 0.05);
      this.group.add(lod);
    }
    scene.add(this.group);
    this.night = [M.glass];
  }

  setNight(dark) {
    this.night[0].emissiveIntensity = dark * 1.2;
  }
}
