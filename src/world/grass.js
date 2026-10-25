import * as THREE from 'three';
import { BOUNDS, grid, roadField, coastAt, waterLevelAt, glacierMask, lavaMask, sandMask, heightAt } from './terrain.js';
import { NOISE, surfaceUniforms } from './materials.js';
import { mulberry32 } from './noise.js';

// A dense field of tussock grass that follows the camera. Every clump lives in a fixed square
// tile and wraps around as you move, so there is no work on the CPU per frame. The GPU reads
// terrain height and a "where grass grows" map, so blades sit on the ground and avoid roads,
// sand, water and ice.

function clumpGeometry(rand) {
  const pos = [], idx = [], bladeN = [];
  const blades = 10;
  for (let b = 0; b < blades; b++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.32;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const dir = rand() * Math.PI * 2; // direction the blade leans
    const lx = Math.cos(dir), lz = Math.sin(dir);
    const h = 0.28 + rand() * 0.34;
    const w = 0.018 + rand() * 0.012;
    const lean = 0.08 + rand() * 0.22;
    const px = -lz * w, pz = lx * w; // across the blade
    const base = pos.length / 3;
    // Two segments: base pair, middle pair, tip. The lean grows with height (a curve).
    const pts = [
      [ox + px, 0, oz + pz], [ox - px, 0, oz - pz],
      [ox + px * 0.7 + lx * lean * 0.3, h * 0.5, oz + pz * 0.7 + lz * lean * 0.3], [ox - px * 0.7 + lx * lean * 0.3, h * 0.5, oz - pz * 0.7 + lz * lean * 0.3],
      [ox + lx * lean, h, oz + lz * lean],
    ];
    pts.forEach((p) => { pos.push(...p); bladeN.push(-lz, 0.35, lx); });
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(bladeN, 3));
  g.setIndex(idx);
  return g;
}

function buildDensityTexture(clear = []) {
  const C = roadField.cell, nx = roadField.nx, nz = roadField.nz;
  const data = new Uint8Array(nx * nz * 4);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const x = BOUNDS.minX + ix * C, z = BOUNDS.minZ + iz * C;
      const h = heightAt(x, z);
      let d = 1;
      const rd = roadField.d[i];
      d *= Math.min(1, Math.max(0, (rd - 4.6) / 1.6)); // keep off the road and its gravel shoulder
      if (h < waterLevelAt(x, z) + 0.3) d = 0;
      else if ((coastAt(x, z) < 22 && h < 4) || sandMask(x, z, h) > 0.2) d = 0; // black sand
      const slope = Math.abs(heightAt(x + 1.5, z) - h) + Math.abs(heightAt(x, z + 1.5) - h);
      d *= Math.min(1, Math.max(0, (1.6 - slope) / 0.8));
      d *= 1 - glacierMask(x, z);
      d *= 1 - lavaMask(x, z) * 0.6;
      for (const c of clear) { const dd = Math.hypot(c.x - x, c.z - z); if (dd < c.r) d *= Math.min(1, Math.max(0, (dd - c.r * 0.7) / (c.r * 0.3))); }
      data[i * 4] = Math.round(d * 255);
      data[i * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildHeightTexture() {
  const tex = new THREE.DataTexture(grid.heights, grid.nx, grid.nz, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export class Grass {
  constructor(scene, { count, radius, clear = [] }) {
    this.radius = radius;
    const rand = mulberry32(777);
    const geo = clumpGeometry(rand);
    const off = new Float32Array(count * 2), rnd = new Float32Array(count * 4);
    // Jittered grid so the clumps spread evenly with no bare patches.
    const side = Math.ceil(Math.sqrt(count));
    const cell = (radius * 2) / side;
    for (let i = 0; i < count; i++) {
      const gx = i % side, gz = Math.floor(i / side);
      off[i * 2] = -radius + (gx + rand()) * cell;
      off[i * 2 + 1] = -radius + (gz + rand()) * cell;
      rnd[i * 4] = rand() * Math.PI * 2;
      rnd[i * 4 + 1] = rand();
      rnd[i * 4 + 2] = rand();
      rnd[i * 4 + 3] = rand();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 2));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = count;

    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uR: { value: radius },
      uHeight: { value: buildHeightTexture() },
      uDens: { value: buildDensityTexture(clear) },
      uGridMin: { value: new THREE.Vector2(BOUNDS.minX, BOUNDS.minZ) },
      uGridStep: { value: new THREE.Vector2(grid.dx, grid.dz) },
      uGridN: { value: new THREE.Vector2(grid.nx, grid.nz) },
      uDensSize: { value: new THREE.Vector2(roadField.nx * roadField.cell, roadField.nz * roadField.cell) },
      uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
      uWindStr: { value: 0.5 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, surfaceUniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aOffset; attribute vec4 aRand;
          uniform vec3 uCam; uniform float uR; uniform sampler2D uHeight; uniform sampler2D uDens;
          uniform vec2 uGridMin; uniform vec2 uGridStep; uniform vec2 uGridN; uniform vec2 uDensSize;
          uniform vec2 uWindDir; uniform float uWindStr; uniform float uTime; uniform float uSnowLine; uniform float uSummer;
          uniform float uCloudCover; uniform vec2 uCloudOffset; uniform vec3 uSunDir; uniform float uSunUp;
          varying vec3 vGrassCol;
          ${NOISE}
          float hFetch(ivec2 c){ c = clamp(c, ivec2(0), ivec2(uGridN) - 1); return texelFetch(uHeight, c, 0).r; }
          // Same triangle split as the terrain mesh, so blades stand exactly on the ground.
          float groundH(vec2 p){
            vec2 f = (p - uGridMin) / uGridStep; vec2 i = floor(f); vec2 t = f - i; ivec2 c = ivec2(i);
            float a = hFetch(c), b = hFetch(c + ivec2(1, 0)), cc = hFetch(c + ivec2(0, 1)), d = hFetch(c + ivec2(1, 1));
            return (t.x + t.y < 1.0) ? a + (b - a) * t.x + (cc - a) * t.y : d + (cc - d) * (1.0 - t.x) + (b - d) * (1.0 - t.y);
          }`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          float S = uR * 2.0;
          vec2 base = aOffset + floor((uCam.xz - aOffset) / S + 0.5) * S;
          float gh = groundH(base);
          float dens = texture2D(uDens, (base - uGridMin) / uDensSize).r;
          float dist = length(base - uCam.xz);
          float keep = step(aRand.w, dens * 1.05);
          float fade = 1.0 - smoothstep(uR * 0.6, uR * 0.98, dist);
          float snow = 1.0 - smoothstep(uSnowLine - 16.0, uSnowLine - 6.0, gh);
          float sc = (0.7 + aRand.y * 0.75) * keep * fade * snow;
          // Taller, lusher grass in summer; short and wiry in winter.
          sc *= mix(0.85, 1.15, uSummer);
          float cr = cos(aRand.x), sr = sin(aRand.x);
          mat2 rot = mat2(cr, -sr, sr, cr);
          objectNormal = normalize(mix(vec3(rot * objectNormal.xz, objectNormal.y).xzy, vec3(0.0, 1.0, 0.0), 0.55));
          objectNormal = vec3(objectNormal.x, objectNormal.y, objectNormal.z);`)
        .replace('#include <begin_vertex>', `
          vec3 lp = position;
          lp.xz = rot * lp.xz;
          float ty = clamp(lp.y / 0.62, 0.0, 1.0);
          // Wind: slow rolling gusts across the field plus a quick flutter.
          float gust = g_n(base * 0.04 - uWindDir * uTime * 0.22);
          float flutter = sin(uTime * 2.4 + aRand.z * 6.28 + base.x * 0.7) * 0.04;
          vec2 bend = uWindDir * (gust * 0.4 + 0.15) * uWindStr + vec2(flutter);
          lp.xz += bend * ty * ty * 0.9;
          lp.y *= 1.0 - 0.18 * length(bend) * ty;
          vec3 transformed = vec3(base.x, gh - 0.04, base.y) + lp * sc;
          // Colour: dry gold, straw and rust in winter, olive and green in summer, greener on hay fields.
          float n1 = g_n(base * 0.035), n2 = g_n(base * 0.006 + 2.0), n3 = g_n(base * 0.012 + 7.0);
          vec3 winter = mix(vec3(0.76, 0.62, 0.38), vec3(0.88, 0.77, 0.52), smoothstep(0.35, 0.7, n1));
          winter = mix(winter, vec3(0.74, 0.5, 0.27), smoothstep(0.6, 0.85, n2) * 0.4);
          winter = mix(winter, vec3(0.5, 0.47, 0.25), smoothstep(0.6, 0.85, n3) * 0.5);
          vec3 summer = mix(vec3(0.36, 0.48, 0.18), vec3(0.52, 0.58, 0.26), smoothstep(0.3, 0.7, n1));
          vec3 col = mix(winter, summer, uSummer);
          float field = smoothstep(0.62, 0.66, g_f(base * 0.0045 + 3.3)) * (1.0 - smoothstep(9.0, 16.0, gh));
          col = mix(col, vec3(0.42, 0.6, 0.22), field * (0.55 + 0.4 * uSummer));
          col *= 0.85 + 0.3 * aRand.z;
          // Dark at the root, sunlit at the tip.
          col *= mix(0.62, 1.12, ty);
          if (uSunUp > 0.01 && uCloudCover > 0.05) {
            float cn = g_f((base + uCloudOffset - uSunDir.xz / max(uSunDir.y, 0.18) * 380.0) * 0.0045);
            col *= 1.0 - 0.42 * smoothstep(1.0 - uCloudCover - 0.1, 1.0 - uCloudCover + 0.25, cn) * uSunUp;
          }
          vGrassCol = pow(col, vec3(2.2));`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vGrassCol;');
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  update(camera, wind) {
    this.uniforms.uCam.value.copy(camera.position);
    if (wind) {
      const s = Math.hypot(wind.x, wind.z) || 1;
      this.uniforms.uWindDir.value.set(wind.x / s, wind.z / s);
      this.uniforms.uWindStr.value = Math.min(1.2, 0.25 + s * 0.07);
    }
  }
}
