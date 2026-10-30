// The realistic look, for desktop only: scanned ground textures (Poly Haven, CC0) blended into the
// terrain and roads, scanned rocks instead of lumpy spheres, and haze that thickens in the valleys
// and glows towards the sun. Phones never load any of it and keep the classic look.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';

export const HD = { on: false, terrain: null, road: null, rocks: null, surface: null, dem: null };

// ---------- Long sun shadows ----------
// Traces from a surface toward the sun across the island's height map, in steps that grow from
// 3 m to about a kilometre, so mountains shade valleys at any distance (the shadow map only
// covers the few hundred metres around the car). The closest miss sets a soft penumbra.
export const HD_SUN_SHADOW = /* glsl */ `
uniform sampler2D uHeightTex; uniform vec2 uGridMin; uniform vec2 uGridStep; uniform vec2 uGridN;
float hdGround(vec2 p){ ivec2 c = ivec2(floor((p - uGridMin) / uGridStep + 0.5)); c = clamp(c, ivec2(0), ivec2(uGridN) - 1); return texelFetch(uHeightTex, c, 0).r; }
float hdSunShadow(vec3 wp, vec3 n, vec3 L, float up){
  if (up < 0.01 || L.y <= 0.0) return 1.0;
  vec3 p = wp + n * 0.8;
  float sh = 1.0, t = 3.0;
  for (int i = 0; i < 16; i++) {
    vec3 s = p + L * t;
    if (s.y > 420.0) break;
    sh = min(sh, clamp(0.5 + 8.0 * (s.y - hdGround(s.xz)) / t, 0.0, 1.0));
    if (sh < 0.02) break;
    t *= 1.45;
  }
  return sh;
}`;
const SHADE_DIRECT = (wp, wn) => `#include <lights_fragment_end>
{ float hdSh = hdSunShadow(${wp}, ${wn}, normalize(uSunDir), uSunUp); reflectedLight.directDiffuse *= hdSh; reflectedLight.directSpecular *= hdSh; }`;
export const terrainShadowChunk = () => SHADE_DIRECT('vWPos', 'normalize(vWNrm)');
const sunUniforms = () => {
  const s = HD.surface;
  return { uHeightTex: s.uHeightTex, uGridMin: s.uGridMin, uGridStep: s.uGridStep, uGridN: s.uGridN, uSunDir: s.uSunDir, uSunUp: s.uSunUp };
};

const BASE = '/hd/';
// Terrain layers, in texture-array order. chroma: how much of the photo's own colour to keep
// (0 keeps the game's palette and takes only light and shade); strength: how much detail.
export const LAYERS = [
  { name: 'sparse_grass', chroma: 0.3, strength: 0.9 }, // 0 grass
  { name: 'aerial_grass_rock', chroma: 0.3, strength: 0.9 }, // 1 earth and moss on lower slopes
  { name: 'rock_face', chroma: 0, strength: 1 }, // 2 cliffs, mapped from three sides
  { name: 'mossy_rock', chroma: 0.75, strength: 1 }, // 3 lava fields
  { name: 'coast_sand_01', chroma: 0, strength: 0.85 }, // 4 black sand
  { name: 'snow_02', chroma: 0, strength: 0.3 }, // 5 snow and ice
];
// One set of six mossy rocks: light enough to draw by the hundred (the big single-boulder scans
// cost more frame time than they gave back).
const ROCKS = ['rock_moss_set_01'];

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`Could not load ${url}`));
  img.src = url;
});

function pixels(img, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

// Average colour of a photo in linear light, so a layer can be divided by it to give pure detail.
function meanLinear(img) {
  const d = pixels(img, 32), lin = (v) => Math.pow(v / 255, 2.2);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); g += lin(d[i + 1]); b += lin(d[i + 2]); }
  const n = d.length / 4;
  return new THREE.Vector3(r / n, g / n, b / n);
}

function arrayTexture(imgs, size, srgb, aniso) {
  const data = new Uint8Array(size * size * 4 * imgs.length);
  imgs.forEach((img, i) => data.set(pixels(img, size), i * size * size * 4));
  const t = new THREE.DataArrayTexture(data, size, size, imgs.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function texture2D(img, srgb, aniso) {
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// Each rock stands on its base, centred, one unit across, so the scatter can size it like the old ones.
function normalise(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  geo.translate(-cx, -b.min.y, -cz);
  const r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  geo.scale(1 / r, 1 / r, 1 / r);
  geo.computeBoundingSphere();
  return geo;
}

// Real elevation, baked from Copernicus GLO-90 onto the game grid (metres, Uint16, gzipped),
// turned into game units with a compressing curve: the island is about 125 times smaller than
// life, so true-scale heights would be flat and plain multiples would make needles.
export const demToGame = (m) => (m > 0 ? 9 * Math.pow(m / 100, 0.75) : 0);
async function loadDEM() {
  const meta = await (await fetch(`${BASE}terrain/iceland_dem.json`)).json();
  let buf = new Uint8Array(await (await fetch(`${BASE}terrain/iceland_dem.bin`)).arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const m = new Uint16Array(buf.buffer, buf.byteOffset, meta.w * meta.h);
  const h = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) h[i] = demToGame(m[i]);
  // A blurred copy (box blur, two passes each way) for gentle ground beside the roads.
  const blur = Float32Array.from(h), tmp = new Float32Array(h.length), W = meta.w, H = meta.h, R = 6;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) { let s = 0; for (let x = -R; x <= R; x++) s += blur[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { tmp[y * W + x] = s / (2 * R + 1); s += blur[y * W + Math.min(W - 1, x + R + 1)] - blur[y * W + Math.max(0, x - R)]; } }
    for (let x = 0; x < W; x++) { let s = 0; for (let y = -R; y <= R; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { blur[y * W + x] = s / (2 * R + 1); s += tmp[Math.min(H - 1, y + R + 1) * W + x] - tmp[Math.max(0, y - R) * W + x]; } }
  }
  HD.dem = { minX: meta.minX, minZ: meta.minZ, cols: meta.w, rows: meta.h, sx: (meta.maxX - meta.minX) / meta.w, sz: (meta.maxZ - meta.minZ) / meta.h, heights: h, blur };
}

export async function loadHD(renderer) {
  if (typeof DecompressionStream === 'function') await loadDEM().catch((e) => console.warn('Elevation data did not load; using generated mountains.', e));
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (name, map) => loadImage(`${BASE}tex/${name}_${map}.jpg`);
  const [layerImgs, roadImgs, rockScenes] = await Promise.all([
    Promise.all(LAYERS.map((l) => Promise.all(['diff', 'nor', 'arm'].map((m) => tex(l.name, m))))),
    Promise.all(['asphalt_02', 'gravel_road'].map((n) => Promise.all(['diff', 'nor', 'arm'].map((m) => tex(n, m))))),
    Promise.all(ROCKS.map((r) => new GLTFLoader().loadAsync(`${BASE}rocks/${r}/${r}.gltf`))),
  ]);
  const size = 1024;
  HD.terrain = {
    alb: arrayTexture(layerImgs.map((l) => l[0]), size, true, aniso),
    nor: arrayTexture(layerImgs.map((l) => l[1]), size, false, aniso),
    arm: arrayTexture(layerImgs.map((l) => l[2]), size, false, aniso),
    mean: layerImgs.map((l) => meanLinear(l[0])),
  };
  HD.road = Object.fromEntries(['asphalt', 'gravel'].map((k, i) => [k, {
    alb: texture2D(roadImgs[i][0], true, aniso), nor: texture2D(roadImgs[i][1], false, aniso), arm: texture2D(roadImgs[i][2], false, aniso),
    mean: meanLinear(roadImgs[i][0]),
  }]));
  // Darken the scans towards Icelandic basalt; the mossy set keeps more of its colour.
  HD.rocks = [];
  rockScenes.forEach((gltf, i) => {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mat = o.material.clone();
      mat.color.setRGB(...(i === 0 ? [0.78, 0.78, 0.76] : [0.5, 0.5, 0.52]));
      // Long sun shadows on the rocks too, so they darken with the land around them.
      mat.customProgramCacheKey = () => 'hd-rock';
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, sunUniforms());
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vHdW;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 hdWP = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nhdWP = instanceMatrix * hdWP;\n#endif\nvHdW = (modelMatrix * hdWP).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vHdW;\nuniform vec3 uSunDir; uniform float uSunUp;\n${HD_SUN_SHADOW}`)
          .replace('#include <lights_fragment_end>', SHADE_DIRECT('vHdW', 'normalize((vec4(normal, 0.0) * viewMatrix).xyz)'));
      };
      HD.rocks.push({ geometry: normalise(o.geometry.clone().applyMatrix4(o.matrixWorld)), material: mat, big: i > 0 });
    });
  });
  HD.on = true;
}

// ---------- Atmosphere ----------
// Exponential fog becomes height fog (thick in valleys, thin towards peaks) that picks up the
// sun's colour when you look towards it. The sun uniforms are plain objects on purpose: three.js
// copies vectors into every material, but shares plain objects, so one update reaches them all.
export const fogSun = { dir: { x: 0, y: 1, z: 0 }, color: { x: 1, y: 0.82, z: 0.6 } };
export function installAtmosphere() {
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (!lib.uniforms?.fogColor) continue;
    lib.uniforms.fogSunDir = { value: fogSun.dir };
    lib.uniforms.fogSunColor = { value: fogSun.color };
  }
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n  varying float vFogDepth;\n  varying vec3 vFogView;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n  vFogDepth = - mvPosition.z;\n  vFogView = mvPosition.xyz;\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogView;
  uniform vec3 fogSunDir; uniform vec3 fogSunColor;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fRay = (vec4(vFogView, 0.0) * viewMatrix).xyz;
    float fDist = length(fRay);
    // Density falls off with height: integrate it along the ray from the camera.
    float fH = 120.0, fDy = fRay.y / fH;
    float fAlong = abs(fDy) > 1e-3 ? (1.0 - exp(-fDy)) / fDy : 1.0 - fDy * 0.5;
    float fHeight = clamp(exp(-max(cameraPosition.y, 0.0) / fH) * fAlong, 0.12, 2.5);
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * fDist * fDist * fHeight);
    float fSun = pow(max(dot(fRay / max(fDist, 1e-3), fogSunDir), 0.0), 6.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor + fogSunColor * fSun * 0.3, fogFactor);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;
}
export function updateAtmosphere(sunDir, sunUp) {
  fogSun.dir.x = sunDir.x; fogSun.dir.y = sunDir.y; fogSun.dir.z = sunDir.z;
  // Warm by day, gone at night.
  fogSun.color.x = 1.0 * sunUp; fogSun.color.y = 0.78 * sunUp; fogSun.color.z = 0.55 * sunUp;
}

// ---------- Terrain shader ----------
// Samples each layer from above (flat ground) or from three sides (cliffs), turns the photo into
// detail relative to its own average colour, and blends layers with the same weights the classic
// colours use. Normals come from the scans' normal maps, blended with the whiteout method.
const HD_COMMON = /* glsl */ `
uniform sampler2DArray hdAlb; uniform sampler2DArray hdNor; uniform sampler2DArray hdArm;
uniform vec3 hdMean[${LAYERS.length}]; uniform float hdChroma[${LAYERS.length}]; uniform float hdStrength[${LAYERS.length}];
vec3 hdRatio(vec3 a, int L){
  vec3 m = hdMean[L];
  float lum = dot(a, vec3(0.2126, 0.7152, 0.0722)) / max(dot(m, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  vec3 r = mix(vec3(lum), a / max(m, vec3(1e-3)), hdChroma[L]);
  return clamp(mix(vec3(1.0), r, hdStrength[L]), 0.0, 2.5);
}
// From above, with a larger rotated copy faded in by noise so the repeat never lines up.
void hdTop(int L, vec3 p, float s, vec3 N, float v, out vec3 a, out vec3 n, out vec2 ra){
  float l = float(L);
  vec2 u1 = p.xz / s, u2 = mat2(0.8, -0.6, 0.6, 0.8) * p.xz / (s * 2.3) + 0.37;
  a = mix(texture(hdAlb, vec3(u1, l)).rgb, texture(hdAlb, vec3(u2, l)).rgb, v);
  vec3 t = mix(texture(hdNor, vec3(u1, l)).xyz, texture(hdNor, vec3(u2, l)).xyz, v) * 2.0 - 1.0;
  ra = mix(texture(hdArm, vec3(u1, l)).rg, texture(hdArm, vec3(u2, l)).rg, v);
  n = normalize(vec3(t.x + N.x, abs(t.z) * N.y, t.y + N.z));
}
// From three sides, for cliffs and steep slopes.
void hdTri(int L, vec3 p, float s, vec3 N, out vec3 a, out vec3 n, out vec2 ra){
  float l = float(L);
  vec3 b = pow(abs(N), vec3(4.0)); b /= b.x + b.y + b.z;
  vec2 ux = p.zy / s, uy = p.xz / s, uz = p.xy / s;
  a = texture(hdAlb, vec3(ux, l)).rgb * b.x + texture(hdAlb, vec3(uy, l)).rgb * b.y + texture(hdAlb, vec3(uz, l)).rgb * b.z;
  ra = texture(hdArm, vec3(ux, l)).rg * b.x + texture(hdArm, vec3(uy, l)).rg * b.y + texture(hdArm, vec3(uz, l)).rg * b.z;
  vec3 tx = texture(hdNor, vec3(ux, l)).xyz * 2.0 - 1.0, ty = texture(hdNor, vec3(uy, l)).xyz * 2.0 - 1.0, tz = texture(hdNor, vec3(uz, l)).xyz * 2.0 - 1.0;
  tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
  ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
  tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
  n = normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z);
}
void hdMix(inout vec3 A, inout vec3 Nn, inout vec2 RA, vec3 a, vec3 n, vec2 ra, float w){
  A = mix(A, a, w); Nn = normalize(mix(Nn, n, w)); RA = mix(RA, ra, w);
}`;

export const HD_TERRAIN = HD_COMMON + /* glsl */ `
vec3 hdA; vec3 hdN; float hdR; float hdAO;
void hdDetail(vec3 m, vec3 p, vec3 N, float dist){
  float fade = 1.0 - smoothstep(300.0, 1100.0, dist);
  hdA = vec3(1.0); hdN = N; hdR = tRough; hdAO = 1.0;
  // Middle distance: the same scans at a large scale, so hills keep patches and grain where the
  // fine detail has blurred away (colour only, no normals; fades in past 40 m, out by 4 km).
  float macroW = smoothstep(40.0, 200.0, dist) * (1.0 - smoothstep(2500.0, 4000.0, dist)) * 0.6;
  vec3 macro = vec3(1.0);
  if (macroW > 0.0) {
    vec3 mg = hdRatio(texture(hdAlb, vec3(p.xz / 31.0, 0.0)).rgb, 0);
    vec3 mr = hdRatio(texture(hdAlb, vec3(p.xz / 57.0 + vec2(0.0, p.y / 57.0), 2.0)).rgb, 2);
    vec3 ms = hdRatio(texture(hdAlb, vec3(p.xz / 43.0, 5.0)).rgb, 5);
    macro = mix(vec3(1.0), mix(mix(mg, mr, tRockW), ms, tSnowW), macroW);
  }
  if (fade <= 0.0) { hdA = macro; return; }
  float v = smoothstep(0.35, 0.65, g_n(p.xz * 0.04));
  vec3 a, n; vec2 ra;
  hdTop(0, p, 3.2, N, v, a, n, ra);
  vec3 A = hdRatio(a, 0), Nn = n; vec2 RA = ra;
  if (tEarthW > 0.01) { hdTop(1, p, 7.0, N, v, a, n, ra); hdMix(A, Nn, RA, hdRatio(a, 1), n, ra, tEarthW); }
  if (tRockW > 0.01) { hdTri(2, p, 11.0, N, a, n, ra); hdMix(A, Nn, RA, hdRatio(a, 2), n, ra, tRockW); }
  if (tSnowW > 0.01) { hdTop(5, p, 6.0, N, v, a, n, ra); hdMix(A, Nn, RA, hdRatio(a, 5), n, ra, tSnowW); }
  if (m.r > 0.01) { hdTop(4, p, 3.0, N, v, a, n, ra); hdMix(A, Nn, RA, hdRatio(a, 4), n, ra, m.r); }
  if (tLavaW > 0.01) { hdTop(3, p, 3.5, N, v, a, n, ra); hdMix(A, Nn, RA, hdRatio(a, 3), n, ra, tLavaW); }
  if (m.b > 0.01) { hdTop(5, p, 9.0, N, v, a, n, ra); hdMix(A, Nn, RA, hdRatio(a, 5), n, ra, m.b); }
  hdA = mix(vec3(1.0), A * mix(1.0, RA.x, 0.6), fade) * macro;
  hdN = normalize(mix(N, Nn, fade));
  hdR = mix(tRough, RA.y, fade * 0.8);
}`;

export function terrainUniforms() {
  const t = HD.terrain;
  return {
    hdAlb: { value: t.alb }, hdNor: { value: t.nor }, hdArm: { value: t.arm },
    hdMean: { value: t.mean }, hdChroma: { value: LAYERS.map((l) => l.chroma) }, hdStrength: { value: LAYERS.map((l) => l.strength) },
  };
}

// ---------- Landmarks, props and towns ----------
// Plain-coloured natural surfaces get the same scanned detail, picked by colour: greens become
// grass or moss, near-whites snow and plaster, greys and browns rock. Painted things (roofs,
// flags, signs) stay clean. Mapped from three sides in world space, so no UVs are needed.
function classify(color) {
  const hsl = {}; color.getHSL(hsl, THREE.SRGBColorSpace);
  const hue = hsl.h * 360;
  if (hue > 70 && hue < 175 && hsl.s > 0.12) return hsl.l > 0.22 ? { layer: 0, scale: 3.2, k: 0.85 } : { layer: 3, scale: 3.5, k: 0.9 };
  // Pale grey-green is lava-field moss, not snow.
  if (hue > 60 && hue < 180 && hsl.s > 0.04 && hsl.l > 0.45) return { layer: 3, scale: 3.5, k: 1, pale: true };
  if (hsl.s > 0.45) return null;
  if (hsl.l > 0.72) return { layer: 5, scale: 5, k: 0.6 };
  return { layer: 2, scale: 6, k: 1 };
}
export function detailScene(root) {
  const done = new Set();
  root.traverse((o) => {
    const mats = o.isMesh ? [].concat(o.material) : [];
    for (const mat of mats) {
      if (done.has(mat) || mat.type !== 'MeshStandardMaterial' || mat.transparent || mat.map || mat.vertexColors) continue;
      if (Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') || mat.emissiveIntensity * Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b) > 0.2) continue;
      done.add(mat);
      // A white material on an instanced mesh takes its real colour from the instances.
      let base = mat.color;
      if (o.instanceColor && mat.color.r + mat.color.g + mat.color.b > 2.94) {
        const a = o.instanceColor.array, n = Math.max(1, Math.min(o.count, a.length / 3));
        base = new THREE.Color(0, 0, 0);
        for (let i = 0; i < n; i++) { base.r += a[i * 3] / n; base.g += a[i * 3 + 1] / n; base.b += a[i * 3 + 2] / n; }
      }
      let c = classify(base);
      if (!c) continue;
      // Green instanced lumps are moss hummocks, not lawns.
      if (o.instanceColor && c.layer === 0) c = { layer: 3, scale: 3.5, k: 1 };
      // Real Icelandic moss is a deeper grey-green than the classic look's pale mounds.
      if (c.pale) mat.color.multiplyScalar(0.6);
      const key = `hd-detail-${c.layer}-${c.scale}-${c.k}`;
      mat.customProgramCacheKey = () => key;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, terrainUniforms(), sunUniforms());
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vHdW;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 hdWP = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nhdWP = instanceMatrix * hdWP;\n#endif\nvHdW = (modelMatrix * hdWP).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vHdW;\nuniform vec3 uSunDir; uniform float uSunUp;\n${HD_COMMON}\n${HD_SUN_SHADOW}`)
          .replace('#include <lights_fragment_end>', SHADE_DIRECT('vHdW', 'normalize((vec4(normal, 0.0) * viewMatrix).xyz)'))
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            float hdFade = 1.0 - smoothstep(250.0, 900.0, length(vViewPosition));
            if (hdFade > 0.0) {
              vec3 hdWN = normalize((vec4(normal, 0.0) * viewMatrix).xyz), a, n; vec2 ra;
              hdTri(${c.layer}, vHdW, ${c.scale.toFixed(1)}, hdWN, a, n, ra);
              diffuseColor.rgb *= mix(vec3(1.0), hdRatio(a, ${c.layer}) * mix(1.0, ra.x, 0.5), hdFade * ${c.k.toFixed(2)});
              normal = normalize((viewMatrix * vec4(normalize(mix(hdWN, n, hdFade * ${c.k.toFixed(2)})), 0.0)).xyz);
              roughnessFactor = mix(roughnessFactor, ra.y, hdFade * 0.5);
            }
          }`);
      };
      mat.needsUpdate = true;
    }
  });
}

// ---------- Weathering landmark shapes ----------
// Natural landmarks are built from simple solids (cylinder hills, box cliffs). Here each large
// rock or grass shape is subdivided and pushed in and out by noise in world space, so it reads as a
// weathered landform. Vertices that share a position move together, so hard edges never crack.
// Basalt columns (keepShape) and anything built by people keep their shape; colliders were
// already measured from the original solids.
const NATURAL = new Set(['beach', 'canyon', 'crater', 'headland', 'horseshoe', 'lagoon', 'lake', 'lava', 'mountain', 'park', 'rift', 'waterfall', 'geothermal', 'geyser']);
const h3 = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => h3(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), ux), l(c(0, 1, 0), c(1, 1, 0), ux), uy), l(l(c(0, 0, 1), c(1, 0, 1), ux), l(c(0, 1, 1), c(1, 1, 1), ux), uy), uz);
}
const isNaturalMaterial = (mat) => mat && mat.type === 'MeshStandardMaterial' && !mat.transparent && !mat.map
  && (mat.customProgramCacheKey?.() === 'terrain-hd' || [0, 2, 3].includes(classify(mat.color)?.layer));
// Towns and buildings keep their streets and walls, but their grassy hills weather too.
export function naturalize(root, kind) {
  if (!HD.on || !(NATURAL.has(kind) || kind === 'town' || kind === 'building')) return;
  root.updateMatrixWorld(true);
  const meshes = [];
  const walk = (o) => {
    if (o.userData.keepShape || o.userData.dynamic) return;
    const mat = [].concat(o.material)[0];
    if (o.isMesh && !o.isInstancedMesh && isNaturalMaterial(mat) && (NATURAL.has(kind) || [0, 3].includes(classify(mat.color)?.layer))) meshes.push(o);
    for (const c of o.children) walk(c);
  };
  walk(root);
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), wp = new THREE.Vector3(), size = new THREE.Vector3();
  for (const m of meshes) {
    m.matrixWorld.decompose(pos, q, sc);
    const s = (Math.abs(sc.x) + Math.abs(sc.y) + Math.abs(sc.z)) / 3;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const extent = m.geometry.boundingBox.getSize(size).multiply(sc).length();
    if (extent < 5 || extent > 900) continue;
    let g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    // Enough passes to finish: a stop part-way leaves an edge split on one side only, which cracks.
    g = new TessellateModifier(Math.max(0.9, extent / 32) / s, 24).modify(g.index ? g.toNonIndexed() : g);
    const P = g.attributes.position;
    if (P.count > 150000) { g.dispose(); continue; }
    // Smooth direction per shared position: the sum of the face normals around it.
    // Numeric key for a position (2 cm steps, 17 bits per axis), much cheaper than building strings.
    const q17 = (v) => Math.min(131071, Math.max(0, Math.round(v * 50) + 65536));
    const key = (i) => q17(P.getX(i)) * 17179869184 + q17(P.getY(i)) * 131072 + q17(P.getZ(i));
    const dirs = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < P.count; i += 3) {
      a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
      n.subVectors(c, b).cross(a.clone().sub(b));
      for (let j = 0; j < 3; j++) { const k = key(i + j); (dirs.get(k) || dirs.set(k, new THREE.Vector3()).get(k)).add(n); }
    }
    const amp = Math.min(2.6, Math.max(0.25, extent * 0.03)) / s;
    const moved = new Map();
    for (let i = 0; i < P.count; i++) {
      const k = key(i);
      let d = moved.get(k);
      if (!d) {
        wp.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
        const v = noise3(wp.x * 0.09, wp.y * 0.09, wp.z * 0.09) * 0.65 + noise3(wp.x * 0.3 + 7, wp.y * 0.3, wp.z * 0.3) * 0.35;
        d = dirs.get(k).clone().normalize().multiplyScalar((v - 0.5) * 2 * amp);
        moved.set(k, d);
      }
      P.setXYZ(i, P.getX(i) + d.x, P.getY(i) + d.y, P.getZ(i) + d.z);
    }
    // Smooth normals across the new faces (the textures carry the fine detail), so the weathered
    // shape reads as rock rather than low-poly facets.
    const smooth = new Map();
    for (let i = 0; i < P.count; i += 3) {
      a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
      n.subVectors(c, b).cross(a.clone().sub(b));
      for (let j = 0; j < 3; j++) { const k = key(i + j); (smooth.get(k) || smooth.set(k, new THREE.Vector3()).get(k)).add(n); }
    }
    const N = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) { const v = smooth.get(key(i)).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z; }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    m.geometry = g;
  }
}

// ---------- Road grime on the cars ----------
// Mud and dust build up towards the wheels, in patches, and turn the paint matte there. The
// pattern is fixed to the car's own geometry; the height is measured from the ground under it.
export const carGround = { value: 0 };
export function weatherCar(group) {
  const done = new Set();
  group.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of [].concat(o.material)) {
      if (done.has(mat)) continue;
      done.add(mat);
      if (!mat.isMeshStandardMaterial || mat.transparent || mat.userData?.glass) continue;
      if (mat.emissive && Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b) * (mat.emissiveIntensity ?? 1) > 0.05) continue;
      if (Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile')) continue;
      mat.customProgramCacheKey = () => 'hd-car';
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uCarGround = carGround;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vCarL; varying float vCarY;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarL = transformed;\nvCarY = (modelMatrix * vec4(transformed, 1.0)).y;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vCarL; varying float vCarY; uniform float uCarGround;\nfloat cvh(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }\nfloat cvn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n  return mix(mix(mix(cvh(i), cvh(i + vec3(1,0,0)), f.x), mix(cvh(i + vec3(0,1,0)), cvh(i + vec3(1,1,0)), f.x), f.y),\n             mix(mix(cvh(i + vec3(0,0,1)), cvh(i + vec3(1,0,1)), f.x), mix(cvh(i + vec3(0,1,1)), cvh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          {
            float cn = cvn(vCarL * 3.1) * 0.6 + cvn(vCarL * 11.0 + 5.0) * 0.4;
            float grime = smoothstep(1.25, 0.3, vCarY - uCarGround + (cn - 0.5) * 0.45) * smoothstep(0.15, 0.5, cn + 0.15);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.1, 0.075), grime * 0.72);
            roughnessFactor = mix(roughnessFactor, 0.92, grime);
          }`);
      };
    }
  });
}

// ---------- Scanned rocks ----------
// The scatter's rock spots, drawn with the scanned models. Only rocks near the camera are drawn:
// every few frames the instance lists are rebuilt from the rocks within reach.
export class HDRocks {
  constructor(scene, spots, rand) {
    this.variants = HD.rocks.map((v) => {
      const mesh = new THREE.InstancedMesh(v.geometry, v.material, spots.length);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, big: v.big };
    });
    const small = this.variants.filter((v) => !v.big), big = this.variants.filter((v) => v.big);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    // The heavy boulder scans go only to the largest rocks.
    this.spots = spots.map((s) => {
      const pool = big.length && s.s > 1.6 && rand() < 0.5 ? big : small;
      q.setFromEuler(e.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3));
      m.compose(p.set(s.x, s.y - s.s * 0.18, s.z), q, sc.set(s.s, s.s * (0.75 + rand() * 0.35), s.s * (0.85 + rand() * 0.3)));
      return { x: s.x, z: s.z, v: pool[Math.floor(rand() * pool.length)], m: m.clone() };
    });
    this.timer = 0;
    this.reach = 700;
  }
  update(dt, cam) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    for (const v of this.variants) v.mesh.count = 0;
    const r2 = this.reach * this.reach;
    for (const s of this.spots) {
      const dx = s.x - cam.x, dz = s.z - cam.z;
      if (dx * dx + dz * dz > r2) continue;
      const mesh = s.v.mesh;
      mesh.setMatrixAt(mesh.count++, s.m);
    }
    for (const v of this.variants) v.mesh.instanceMatrix.needsUpdate = true;
  }
}
