// Glacier ice at Jökulsárlón and Diamond Beach: crystal-shaped chunks, an ice material that
// reads as clear, bubbly, glassy ice rather than white plastic, and a scatter of small pieces on
// the road and the black sand that the car's tyres push aside, flick away or crush.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Particles } from './effects.js';

// ---------- Shape ----------
// Real glacier ice breaks along flat faces with sharp edges, and the sea then melts shallow
// scalloped hollows into it. So a chunk starts as a sphere pulled in to the nearest of a dozen
// random cutting planes (a convex crystal with flat facets), then gets its scallops, and is drawn
// with flat normals so every facet and edge catches the light on its own.
export function crystalIceGeometry(size, rand, { angular = false, detail = 3, color = true } = {}) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  ico.dispose();
  const planes = [];
  const nP = angular ? 15 : 12;
  for (let k = 0; k < nP; k++) {
    // Random directions, with the top and bottom cut flatter more often (ice floats and settles).
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    planes.push([s * Math.cos(a), u, s * Math.sin(a), 0.62 + rand() * 0.38]);
  }
  planes.push([0, -1, 0, 0.32 + rand() * 0.18]);
  const sx = 0.85 + rand() * 0.5, sy = angular ? 0.7 + rand() * 0.5 : 0.5 + rand() * 0.3, sz = 0.85 + rand() * 0.5;
  const k = [rand() * 6, rand() * 6, rand() * 6];
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let r = 1.25;
    for (const P of planes) {
      const d = x * P[0] + y * P[1] + z * P[2];
      if (d > 0.04) r = Math.min(r, P[3] / d);
    }
    // Melt scallops: shallow round hollows over every face.
    const sc = Math.sin(x * 7.1 + k[0]) * Math.sin(y * 6.3 + k[1]) * Math.sin(z * 7.7 + k[2]);
    r *= 1 - 0.045 * sc * sc;
    // A freshly calved berg keeps a pinnacle or two.
    if (angular && y > 0.2) r *= 1 + 0.35 * Math.pow(Math.max(0, Math.sin(x * 2.3 + k[1]) * Math.cos(z * 2.1 + k[2])), 4) * y;
    p.setXYZ(i, x * r * sx * size, y * r * sy * size, z * r * sz * size);
  }
  const out = g.toNonIndexed();
  g.dispose();
  out.computeVertexNormals();
  if (color) {
    // Colour: clear blue-green body, frosted white where the top has weathered, and on some chunks
    // a tilted band of black ash from an old eruption.
    out.computeBoundingBox();
    const q = out.attributes.position, y0 = out.boundingBox.min.y, y1 = out.boundingBox.max.y;
    const col = new Float32Array(q.count * 3);
    const ash = rand() < 0.35 ? (() => { const v = new THREE.Vector3(rand() - 0.5, 1.5, rand() - 0.5).normalize(); return [v.x, v.y, v.z, (rand() - 0.5) * 0.6]; })() : null;
    const tint = rand();
    for (let i = 0; i < q.count; i++) {
      const t = (q.getY(i) - y0) / Math.max(y1 - y0, 1e-3);
      const frost = Math.pow(t, 3.0) * (0.45 + tint * 0.4);
      col[i * 3] = 0.42 + 0.5 * frost; col[i * 3 + 1] = 0.7 + 0.27 * frost; col[i * 3 + 2] = 0.86 + 0.13 * frost;
      if (ash && Math.abs(q.getX(i) * ash[0] + q.getY(i) * ash[1] + q.getZ(i) * ash[2] - ash[3] * size) < size * 0.06) { col[i * 3] *= 0.2; col[i * 3 + 1] *= 0.2; col[i * 3 + 2] *= 0.22; }
    }
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return out;
}

// ---------- Material ----------
// Clear glacier ice looks dark and glassy face on (you see into it, and the black sand through
// it) and bright at a glancing angle, where it mirrors the sky; trapped air makes milky white
// clouds and veins inside it; sunlight scattered within it glows blue; and its facets glint as you
// move. No refraction pass: that re-renders the scene every frame the ice is on screen.
const ICE_NOISE = /* glsl */ `
float iceH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float iceN(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(iceH(i), iceH(i + vec3(1, 0, 0)), f.x), mix(iceH(i + vec3(0, 1, 0)), iceH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(iceH(i + vec3(0, 0, 1)), iceH(i + vec3(1, 0, 1)), f.x), mix(iceH(i + vec3(0, 1, 1)), iceH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

export function glacierIceMaterial({ quality = 'medium', deep = false, clear = 0.6, scale = 1 } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.07, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    ior: 1.31, specularIntensity: 1, transparent: true, depthWrite: true,
    emissive: new THREE.Color(deep ? 0x0a3a5c : 0x0b3550), emissiveIntensity: quality === 'low' ? 0.3 : 0.45,
  });
  mat.customProgramCacheKey = () => `glacier-ice-${clear}-${scale}`;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIceP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIceP = transformed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vIceP;\nfloat iceMilk; float iceVein;\n${ICE_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 q = vIceP * ${(3.2 / scale).toFixed(3)};
          // Milky clouds of trapped air, and thin white veins where the ice has cracked and healed.
          float m = iceN(q) * 0.6 + iceN(q * 2.3 + 7.0) * 0.3 + iceN(q * 5.1) * 0.1;
          iceMilk = smoothstep(0.5, 0.78, m);
          iceVein = smoothstep(0.035, 0.0, abs(iceN(q * 1.7 + 3.0) - 0.5)) * 0.8;
          // Clear ice reads deep blue-green; milky ice white.
          vec3 clearC = diffuseColor.rgb * vec3(0.38, 0.62, 0.8);
          diffuseColor.rgb = mix(clearC, vec3(0.9, 0.95, 1.0), max(iceMilk * 0.6, iceVein * 0.85));
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, iceMilk * 0.6);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Glints: a few facets flash white as the view moves across them.
          vec3 vd = normalize(vViewPosition);
          float g = iceH(floor(vIceP * ${(34 / scale).toFixed(2)}) + floor(vd * 9.0));
          totalEmissiveRadiance += vec3(0.9, 0.97, 1.0) * step(0.994, g) * 1.6;
        }`)
      .replace('#include <opaque_fragment>', `
        {
          // Face on, clear ice lets what is behind it show through; at a glancing angle it mirrors.
          float nv = abs(dot(normalize(normal), normalize(vViewPosition)));
          float fres = pow(1.0 - nv, 3.0);
          diffuseColor.a = mix(${clear.toFixed(2)}, 1.0, clamp(max(fres * 1.3, max(iceMilk * 0.85, iceVein)), 0.0, 1.0));
        }
        #include <opaque_fragment>`);
  };
  return mat;
}

// ---------- Small pieces the car drives through ----------
const EULER = new THREE.Euler(), Q = new THREE.Quaternion(), QW = new THREE.Quaternion(), M4 = new THREE.Matrix4(), V = new THREE.Vector3(), SC = new THREE.Vector3(), AX = new THREE.Vector3();
const SHAPES = 4;

export class IceBits {
  // sites: [{ x, z, r }] centres (on the road) to scatter round. world: { surfaceHeightAt,
  // waterLevelAt, roadDistAt, heightAt }.
  constructor(scene, sites, world, { quality = 'medium', rand = Math.random } = {}) {
    this.world = world;
    this.sites = sites;
    // Most lie on the road in loose drifts you drive through, the rest out on the black sand.
    const onRoad = quality === 'low' ? 110 : 170, onSand = quality === 'low' ? 40 : 70;
    const n = (onRoad + onSand) * sites.length;
    this.n = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.w = new Float32Array(n * 3);
    this.s = new Float32Array(n); this.rest = new Uint8Array(n); this.alive = new Uint8Array(n); this.shape = new Uint8Array(n);
    this.q = [];
    const dry = (x, z) => world.waterLevelAt(x, z) < world.heightAt(x, z) - 0.05;
    const add = (x, z) => {
      const k = this.n++;
      // Small: fist-sized to about a shoe, never road-blocking lumps.
      const s = 0.06 + Math.pow(rand(), 2.0) * 0.2;
      this.s[k] = s;
      this.shape[k] = Math.floor(rand() * SHAPES);
      this.p[k * 3] = x; this.p[k * 3 + 2] = z;
      this.p[k * 3 + 1] = world.surfaceHeightAt(x, z, world.heightAt(x, z) + 1) + s * 0.3;
      this.q.push(new THREE.Quaternion().setFromEuler(EULER.set((rand() - 0.5) * 0.5, rand() * 6.3, (rand() - 0.5) * 0.5)));
      this.alive[k] = 1; this.rest[k] = 1;
    };
    for (const site of sites) {
      // Drift centres on the road (and its shoulders), each a patch a few metres across.
      const drifts = [];
      for (let t = 0; drifts.length < 16 && t < 2000; t++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * site.r;
        const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
        if (world.roadDistAt(x, z) < 3.5 && dry(x, z)) drifts.push([x, z]);
      }
      for (let i = 0, t = 0; drifts.length && i < onRoad && t < onRoad * 40; t++) {
        const d = drifts[Math.floor(rand() * drifts.length)];
        const x = d[0] + (rand() + rand() - 1) * 3.2, z = d[1] + (rand() + rand() - 1) * 3.2;
        if (world.roadDistAt(x, z) > 4.6 || !dry(x, z)) continue;
        add(x, z); i++;
      }
      for (let i = 0, t = 0; i < onSand && t < onSand * 40; t++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * site.r;
        const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
        if (world.roadDistAt(x, z) < 5 || !dry(x, z)) continue;
        add(x, z); i++;
      }
    }
    this.home = { p: this.p.slice(0, this.n * 3), q: this.q.map((q) => q.clone()) };
    // One instanced mesh per shape, all sharing the ice material.
    this.mat = glacierIceMaterial({ quality, clear: 0.5, scale: 0.15 });
    this.meshes = [];
    this.slot = new Int32Array(this.n);
    const counts = new Array(SHAPES).fill(0);
    for (let k = 0; k < this.n; k++) this.slot[k] = counts[this.shape[k]]++;
    for (let s = 0; s < SHAPES; s++) {
      const geo = crystalIceGeometry(1, rand, { detail: 2 });
      const m = new THREE.InstancedMesh(geo, this.mat, Math.max(1, counts[s]));
      m.count = counts[s];
      m.castShadow = quality !== 'low'; m.receiveShadow = true;
      m.frustumCulled = false;
      m.userData.noDetail = true;
      scene.add(m);
      this.meshes.push(m);
    }
    for (let k = 0; k < this.n; k++) this.write(k);
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    // Crushed ice: a burst of glittering splinters, and a pale smear of slush left on the ground.
    this.splinters = new Particles(scene, { count: quality === 'low' ? 160 : 320, color: 0xeef7ff, size: 0.07, opacity: 0.95, gravity: 9.8, drag: 0.6 });
    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      color: 0xe8f2f8, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.85, alphaMap: slushTexture(), depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }), 90);
    this.marks.count = 0; this.marks.frustumCulled = false; this.marks.renderOrder = 2; this.marks.userData.noAO = true;
    this.markBorn = new Float32Array(90); this.markSize = new Float32Array(90 * 2); this.markNext = 0;
    scene.add(this.marks);
    this.t = 0; this.awake = false; this.hits = [];
  }

  write(k) {
    const s = this.alive[k] ? this.s[k] : 0;
    M4.compose(V.set(this.p[k * 3], this.p[k * 3 + 1], this.p[k * 3 + 2]), this.q[k], SC.set(s, s, s));
    this.meshes[this.shape[k]].setMatrixAt(this.slot[k], M4);
  }

  // Put every piece back where it started (when the car has gone far away, so it never shows).
  reset() {
    this.p.set(this.home.p); this.v.fill(0); this.w.fill(0); this.rest.fill(1); this.alive.fill(1);
    for (let k = 0; k < this.n; k++) { this.q[k].copy(this.home.q[k]); this.write(k); }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    this.dirtyHome = false;
  }

  // car: { x, y, z, heading, vF, vL, wheels: [{ x, z }] (car frame), air }. Returns the indices of
  // the wheels that ran over ice this frame (their tyres are left wet with melt).
  update(dt, car) {
    this.hits.length = 0;
    this.t += dt;
    this.splinters.update(dt);
    this.fadeMarks();
    if (!dt || !this.n) return this.hits;
    let near = Infinity;
    for (const st of this.sites) near = Math.min(near, Math.hypot(car.x - st.x, car.z - st.z) - st.r);
    if (near > 400 && this.dirtyHome) this.reset();
    if (near > 60 && !this.awake) return this.hits;
    const { world } = this;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = fz, rz = -fx;
    const cvx = fx * car.vF + rx * car.vL, cvz = fz * car.vF + rz * car.vL, sp = Math.hypot(cvx, cvz);
    // How far the car moved this frame, so a fast car still meets every piece it passes over.
    const sweep = sp * dt;
    let moved = false, any = false;
    for (let k = 0; k < this.n; k++) {
      if (!this.alive[k]) continue;
      const i3 = k * 3, s = this.s[k];
      let x = this.p[i3], y = this.p[i3 + 1], z = this.p[i3 + 2];
      // Tyres: only they reach the ground; the body clears pieces this small.
      if (!car.air && sp > 0.4) {
        const dx = x - car.x, dz = z - car.z;
        if (dx * dx + dz * dz < 16 && Math.abs(y - car.y) < 1.2) {
          const lx = dx * rx + dz * rz, lz = dx * fx + dz * fz;
          for (let wi = 0; wi < car.wheels.length; wi++) {
            const W = car.wheels[wi];
            const ox = lx - W.x, oz = lz - W.z;
            const reach = 0.3 + s * 0.6;
            if (Math.abs(ox) > 0.14 + s * 0.6 || oz > reach || oz < -reach - sweep) continue;
            this.hits.push(wi);
            const dir = Math.sign(car.vF || 1);
            if (s < 0.13 && sp > 2) {
              // Small pieces are crushed under the tyre: splinters, and a smear of slush.
              this.alive[k] = 0;
              this.splinters.emit(x, y + 0.05, z, cvx * 0.25, 0.8 + sp * 0.05, cvz * 0.25, 7, 0.9 + sp * 0.04, 0.9);
              this.mark(x, world.surfaceHeightAt(x, z, y + 0.5) + 0.012, z, car.heading, 0.22 + s, 0.45 + s * 2 + Math.min(0.5, sp * 0.02));
            } else {
              // Bigger ones squirt out from under the tread: sideways and ahead, up a little, spinning.
              const side = Math.sign(ox || Math.random() - 0.5);
              const out = 0.6 + sp * (0.22 + Math.random() * 0.12), fwd = sp * (0.25 + Math.random() * 0.45) * dir;
              this.v[i3] = fx * fwd + rx * side * out;
              this.v[i3 + 2] = fz * fwd + rz * side * out;
              this.v[i3 + 1] = 0.6 + Math.random() * (0.6 + sp * 0.1);
              const spin = 4 + sp * 0.8;
              this.w[i3] = (Math.random() - 0.5) * spin; this.w[i3 + 1] = (Math.random() - 0.5) * spin; this.w[i3 + 2] = (Math.random() - 0.5) * spin;
              // Out from under the tyre so it is not hit again next frame.
              x += rx * side * (0.14 + s * 0.7 - Math.abs(ox) + 0.05);
              z += rz * side * (0.14 + s * 0.7 - Math.abs(ox) + 0.05);
              this.rest[k] = 0;
              if (sp > 3) this.splinters.emit(x, y + 0.05, z, this.v[i3] * 0.3, 0.6, this.v[i3 + 2] * 0.3, 2, 0.5, 0.6);
            }
            moved = true; this.dirtyHome = true;
            break;
          }
          if (!this.alive[k]) { this.write(k); continue; }
        }
      }
      if (this.rest[k]) continue;
      any = true;
      // Flight and sliding: gravity, the ground (or the water it floats in), low friction on ice.
      this.v[i3 + 1] -= 9.8 * dt;
      x += this.v[i3] * dt; y += this.v[i3 + 1] * dt; z += this.v[i3 + 2] * dt;
      const ground = world.surfaceHeightAt(x, z, y + 0.5) + s * 0.3;
      const water = world.waterLevelAt(x, z);
      if (water > ground - s * 0.3 && y < water) {
        // In the lagoon or the sea it floats, low in the water, and drifts to a stop.
        y = water - s * 0.15; this.v[i3 + 1] = 0;
        const k2 = Math.exp(-1.5 * dt);
        this.v[i3] *= k2; this.v[i3 + 2] *= k2;
      } else if (y <= ground) {
        y = ground;
        if (this.v[i3 + 1] < -1.2) {
          this.v[i3 + 1] *= -0.25;
          const k2 = 0.7; this.v[i3] *= k2; this.v[i3 + 2] *= k2;
        } else this.v[i3 + 1] = 0;
        // Ice on asphalt or wet sand slides a long way: about 1.6 m/s² of friction.
        const h = Math.hypot(this.v[i3], this.v[i3 + 2]);
        const nh = Math.max(0, h - 1.6 * dt);
        if (h > 0) { this.v[i3] *= nh / h; this.v[i3 + 2] *= nh / h; }
        const kw = Math.exp(-5 * dt); this.w[i3] *= kw; this.w[i3 + 1] *= kw; this.w[i3 + 2] *= kw;
        if (nh < 0.04 && Math.abs(this.v[i3 + 1]) < 0.05) { this.rest[k] = 1; this.v.fill(0, i3, i3 + 3); this.w.fill(0, i3, i3 + 3); }
      }
      this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
      const wl = Math.hypot(this.w[i3], this.w[i3 + 1], this.w[i3 + 2]);
      if (wl > 1e-3) { QW.setFromAxisAngle(AX.set(this.w[i3] / wl, this.w[i3 + 1] / wl, this.w[i3 + 2] / wl), wl * dt); this.q[k].premultiply(QW); }
      this.write(k);
      moved = true;
    }
    this.awake = any;
    if (moved) for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    return this.hits;
  }

  // A smear of crushed slush where a tyre burst a piece, along the direction of travel.
  mark(x, y, z, heading, w, l) {
    const i = this.markNext;
    this.markNext = (i + 1) % 90;
    this.markBorn[i] = this.t; this.markSize[i * 2] = w; this.markSize[i * 2 + 1] = l;
    this.marks.count = Math.max(this.marks.count, i + 1);
    M4.compose(V.set(x, y, z), Q.setFromEuler(EULER.set(0, heading + (Math.random() - 0.5) * 0.3, 0)), SC.set(w, 1, l));
    this.marks.setMatrixAt(i, M4);
    this.marks.instanceMatrix.needsUpdate = true;
  }

  // Slush melts away over a couple of minutes, shrinking as it goes.
  fadeMarks() {
    if (!this.marks.count || (this.t - (this.lastFade || 0)) < 0.5) return;
    this.lastFade = this.t;
    let changed = false;
    for (let i = 0; i < this.marks.count; i++) {
      const age = this.t - this.markBorn[i];
      if (age < 60 || this.markSize[i * 2] === 0) continue;
      this.marks.getMatrixAt(i, M4);
      M4.decompose(V, Q, SC);
      const k = Math.max(0, 1 - (age - 60) / 90);
      if (k === 0) this.markSize[i * 2] = 0;
      SC.set(this.markSize[i * 2] * k, 1, this.markSize[i * 2 + 1] * k);
      M4.compose(V, Q, SC);
      this.marks.setMatrixAt(i, M4);
      changed = true;
    }
    if (changed) this.marks.instanceMatrix.needsUpdate = true;
  }
}

// Alpha for a slush smear: a soft-edged streak of crushed grains with gaps between them.
function slushTexture() {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 420; i++) {
    const x = S / 2 + (Math.random() - 0.5) * S * 0.7 * Math.random(), y = Math.random() * S;
    const edge = 1 - Math.abs(x - S / 2) / (S * 0.36), ends = Math.min(1, Math.min(y, S - y) / (S * 0.18));
    const a = Math.max(0, edge * ends) * (0.4 + Math.random() * 0.6);
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    g.beginPath(); g.arc(x, y, 0.8 + Math.random() * 2.2, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}
