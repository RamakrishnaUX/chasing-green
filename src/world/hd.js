// The realistic look, for desktop only: scanned ground textures (Poly Haven, CC0) blended into the
// terrain and roads, scanned rocks instead of lumpy spheres, and haze that thickens in the valleys
// and glows towards the sun. Phones never load any of it and keep the classic look.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';

export const HD = { on: false, terrain: null, road: null, rocks: null, surface: null, dem: null, textures: null };

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
// The land reads the same trace from a map of it (see SunMap below): one lookup per pixel instead of
// sixteen, which was about a seventh of the frame. Rocks and landmarks above the land still trace.
export const terrainShadowChunk = () => `#include <lights_fragment_end>
{ float hdSh = uSunUp < 0.01 ? 1.0 : texture2D(uSunMap, ((vWPos.xz - uGridMin) / uGridStep + 0.5) / uGridN).r; reflectedLight.directDiffuse *= hdSh; reflectedLight.directSpecular *= hdSh; }`;

// ---------- The long sun shadows as a map ----------
// One texel per point of the island's height grid, holding hdSunShadow traced from the land there.
// The sun moves slowly, so the map is redrawn only when it has moved (or the land has been refitted),
// an eighth of it a frame.
export class SunMap {
  constructor(surface) {
    const n = surface.uGridN.value;
    this.rt = new THREE.WebGLRenderTarget(n.x, n.y, { type: THREE.UnsignedByteType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uHeightTex: surface.uHeightTex, uGridMin: surface.uGridMin, uGridStep: surface.uGridStep, uGridN: surface.uGridN, uSun: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `${HD_SUN_SHADOW}
        uniform vec3 uSun;
        void main(){
          vec2 c = floor(gl_FragCoord.xy), p = uGridMin + c * uGridStep, d = uGridStep;
          float h = hdGround(p);
          vec3 n = normalize(vec3((hdGround(p - vec2(d.x, 0.0)) - hdGround(p + vec2(d.x, 0.0))) / (2.0 * d.x), 1.0, (hdGround(p - vec2(0.0, d.y)) - hdGround(p + vec2(0.0, d.y))) / (2.0 * d.y)));
          gl_FragColor = vec4(hdSunShadow(vec3(p.x, h, p.y), n, normalize(uSun), 1.0), 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.drawn = new THREE.Vector3(); this.strip = -1; this.ver = -1;
    this.surface = surface;
    surface.uSunMap.value = this.rt.texture;
  }
  update(renderer, sunDir, up) {
    if (up < 0.01 && this.ver >= 0) return;
    const hv = this.surface.uHeightTex.value?.version ?? 0;
    // A fresh pass when the sun has moved a sixth of a degree since the last one began; the first
    // map, and one after the land is refitted, is drawn whole.
    if (this.strip < 0 && (this.ver !== hv || this.drawn.angleTo(sunDir) > 0.003)) {
      this.strip = this.ver !== hv ? 99 : 0;
      this.ver = hv; this.drawn.copy(sunDir); this.mat.uniforms.uSun.value.copy(sunDir);
    }
    if (this.strip < 0) return;
    const N = 8, rt = this.rt, w = Math.ceil(rt.width / N), prev = renderer.getRenderTarget();
    const [k0, k1] = this.strip === 99 ? [0, N] : [this.strip, this.strip + 1];
    for (let k = k0; k < k1; k++) {
      rt.scissor.set(k * w, 0, w, rt.height); rt.scissorTest = true;
      renderer.setRenderTarget(rt); // (applies the scissor)
      renderer.render(this.scene, this.cam);
    }
    rt.scissorTest = false;
    renderer.setRenderTarget(prev);
    this.strip = k1 >= N ? -1 : k1;
  }
}
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

// alpha: [images, channel] to pack into the alpha channel (the scans' occlusion and roughness ride
// in the albedo's and normal map's alpha, so each sample takes two lookups instead of three).
function arrayTexture(imgs, size, srgb, aniso, alpha = null) {
  const data = new Uint8Array(size * size * 4 * imgs.length);
  imgs.forEach((img, i) => {
    const px = pixels(img, size);
    if (alpha) { const ap = pixels(alpha[0][i], size), c = alpha[1]; for (let k = 3; k < px.length; k += 4) px[k] = ap[k - 3 + c]; }
    data.set(px, i * size * size * 4);
  });
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

// Only the elevation is waited for: the island is shaped from it while the textures (most of the
// download) keep arriving. HD.textures settles once they are in; wait for it before the rocks.
export async function loadHD(renderer) {
  const textures = loadTextures(renderer);
  textures.catch(() => {});
  if (typeof DecompressionStream === 'function') await loadDEM().catch((e) => console.warn('Elevation data did not load; using generated mountains.', e));
  HD.on = true;
  HD.textures = textures.catch((e) => { console.warn('Realistic textures did not load; the land keeps its painted colours.', e); plainTextures(); });
}

// Stand-ins if the scans never arrive: flat grey that the shaders read as "no detail".
function plainTextures() {
  const px = (r, g, b) => new Uint8Array([r, g, b, 255]);
  const layers = (c) => { const d = new Uint8Array(4 * LAYERS.length); for (let i = 0; i < LAYERS.length; i++) d.set(c, i * 4); const t = new THREE.DataArrayTexture(d, 1, 1, LAYERS.length); t.needsUpdate = true; return t; };
  const flat = (c) => { const t = new THREE.DataTexture(c, 1, 1); t.needsUpdate = true; return t; };
  const grey = px(128, 128, 128), up = px(128, 128, 255), arm = px(255, 242, 0), mean = new THREE.Vector3().setScalar(Math.pow(128 / 255, 2.2));
  up[3] = 242; // roughness rides in the normal map's alpha
  HD.terrain = { alb: layers(grey), nor: layers(up), mean: LAYERS.map(() => mean.clone()) };
  HD.road = { asphalt: { alb: flat(grey), nor: flat(up), arm: flat(arm), mean }, gravel: { alb: flat(grey), nor: flat(up), arm: flat(arm), mean } };
  HD.rocks = [];
}

async function loadTextures(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (name, map) => loadImage(`${BASE}tex/${name}_${map}.jpg`);
  const [layerImgs, roadImgs, rockScenes] = await Promise.all([
    Promise.all(LAYERS.map((l) => Promise.all(['diff', 'nor', 'arm'].map((m) => tex(l.name, m))))),
    Promise.all(['asphalt_02', 'gravel_road'].map((n) => Promise.all(['diff', 'nor', 'arm'].map((m) => tex(n, m))))),
    Promise.all(ROCKS.map((r) => new GLTFLoader().loadAsync(`${BASE}rocks/${r}/${r}.gltf`))),
  ]);
  const size = 1024;
  HD.terrain = {
    alb: arrayTexture(layerImgs.map((l) => l[0]), size, true, aniso, [layerImgs.map((l) => l[2]), 0]), // + occlusion
    nor: arrayTexture(layerImgs.map((l) => l[1]), size, false, aniso, [layerImgs.map((l) => l[2]), 1]), // + roughness
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
uniform sampler2DArray hdAlb; uniform sampler2DArray hdNor;
uniform vec3 hdMean[${LAYERS.length}]; uniform float hdChroma[${LAYERS.length}]; uniform float hdStrength[${LAYERS.length}];
vec3 hdRatio(vec3 a, int L){
  vec3 m = hdMean[L];
  float lum = dot(a, vec3(0.2126, 0.7152, 0.0722)) / max(dot(m, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  vec3 r = mix(vec3(lum), a / max(m, vec3(1e-3)), hdChroma[L]);
  return clamp(mix(vec3(1.0), r, hdStrength[L]), 0.0, 2.5);
}
// Albedo carries the scan's occlusion in its alpha, the normal map its roughness. Normal maps are
// only read within near (1 up close, 0 past about 170 m): further out their bumps are smaller than
// a pixel, so the plain normal and the material's own roughness stand in.
// From above, with a larger rotated copy faded in by noise so the repeat never lines up. Where the
// noise picks one copy outright (most of the ground) only that one is read.
void hdTop(int L, vec3 p, float s, vec3 N, float v, float near, out vec3 a, out vec3 n, out vec2 ra){
  float l = float(L);
  vec3 u1 = vec3(p.xz / s, l), u2 = vec3(mat2(0.8, -0.6, 0.6, 0.8) * p.xz / (s * 2.3) + 0.37, l);
  vec4 A;
  if (v < 0.002) A = texture(hdAlb, u1); else if (v > 0.998) A = texture(hdAlb, u2); else A = mix(texture(hdAlb, u1), texture(hdAlb, u2), v);
  a = A.rgb; ra = vec2(A.a, 0.9); n = N;
  if (near > 0.0) {
    vec4 T;
    if (v < 0.002) T = texture(hdNor, u1); else if (v > 0.998) T = texture(hdNor, u2); else T = mix(texture(hdNor, u1), texture(hdNor, u2), v);
    vec3 t = T.xyz * 2.0 - 1.0;
    n = normalize(mix(N, normalize(vec3(t.x + N.x, abs(t.z) * N.y, t.y + N.z)), near));
    ra.y = T.a;
  }
}
// From three sides, for cliffs and steep slopes. A side that adds under 3% is left out.
void hdTri(int L, vec3 p, float s, vec3 N, float near, out vec3 a, out vec3 n, out vec2 ra){
  float l = float(L);
  vec3 b = pow(abs(N), vec3(4.0)); b /= b.x + b.y + b.z;
  b = max(b - 0.03, 0.0); b /= b.x + b.y + b.z;
  vec3 ux = vec3(p.zy / s, l), uy = vec3(p.xz / s, l), uz = vec3(p.xy / s, l);
  vec4 A = vec4(0.0);
  if (b.x > 0.0) A += texture(hdAlb, ux) * b.x;
  if (b.y > 0.0) A += texture(hdAlb, uy) * b.y;
  if (b.z > 0.0) A += texture(hdAlb, uz) * b.z;
  a = A.rgb; ra = vec2(A.a, 0.9); n = N;
  if (near > 0.0) {
    vec4 tx = vec4(0.0, 0.0, 1.0, 0.9), ty = tx, tz = tx;
    if (b.x > 0.0) tx = texture(hdNor, ux);
    if (b.y > 0.0) ty = texture(hdNor, uy);
    if (b.z > 0.0) tz = texture(hdNor, uz);
    ra.y = tx.a * b.x + ty.a * b.y + tz.a * b.z;
    vec3 nx = tx.xyz * 2.0 - 1.0, ny = ty.xyz * 2.0 - 1.0, nz = tz.xyz * 2.0 - 1.0;
    nx = vec3(nx.xy + N.zy, abs(nx.z) * N.x);
    ny = vec3(ny.xy + N.xz, abs(ny.z) * N.y);
    nz = vec3(nz.xy + N.xy, abs(nz.z) * N.z);
    n = normalize(mix(N, normalize(nx.zyx * b.x + ny.xzy * b.y + nz.xyz * b.z), near));
  }
}
void hdMix(inout vec3 A, inout vec3 Nn, inout vec2 RA, vec3 a, vec3 n, vec2 ra, float w){
  A = mix(A, a, w); Nn = normalize(mix(Nn, n, w)); RA = mix(RA, ra, w);
}`;

export const HD_TERRAIN = HD_COMMON + /* glsl */ `
uniform sampler2D uSunMap;
vec3 hdA; vec3 hdN; float hdR; float hdAO;
void hdDetail(vec3 m, vec3 p, vec3 N, float dist){
  // The fine scans fade out by 650 m (past that a 3 to 11 m scan is a few pixels across and mip
  // maps leave only its average, which the ratio turns to nothing); their normals by 170 m.
  float fade = 1.0 - smoothstep(220.0, 650.0, dist), near = 1.0 - smoothstep(90.0, 170.0, dist);
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
  float v = smoothstep(0.42, 0.58, g_n(p.xz * 0.04));
  vec3 a, n; vec2 ra;
  hdTop(0, p, 3.2, N, v, near, a, n, ra);
  vec3 A = hdRatio(a, 0), Nn = n; vec2 RA = ra;
  // The other layers, each laid over what came before: (texture layer, scale in metres, weight).
  // One loop rather than six copies of the sampling code: the same result, but a much smaller
  // shader, and the shader's size (not the samples it takes) is what made the ground slow.
  vec3 hdL[6] = vec3[6](vec3(1.0, 7.0, tEarthW), vec3(2.0, 11.0, tRockW), vec3(5.0, 6.0, tSnowW),
    vec3(4.0, 3.0, m.r), vec3(3.0, 3.5, tLavaW), vec3(5.0, 9.0, m.b));
  for (int i = 0; i < 6; i++) {
    float w = hdL[i].z;
    if (w <= 0.01) continue;
    int li = int(hdL[i].x);
    // Rock is mapped from three sides, for cliffs; the rest from above.
    if (li == 2) hdTri(li, p, hdL[i].y, N, near, a, n, ra); else hdTop(li, p, hdL[i].y, N, v, near, a, n, ra);
    hdMix(A, Nn, RA, hdRatio(a, li), n, ra, w);
  }
  hdA = mix(vec3(1.0), A * mix(1.0, RA.x, 0.6), fade) * macro;
  hdN = normalize(mix(N, Nn, fade));
  hdR = mix(tRough, RA.y, near * 0.8);
}`;

export function terrainUniforms() {
  const t = HD.terrain;
  return {
    hdAlb: { value: t.alb }, hdNor: { value: t.nor },
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
      // Interiors (halls.js) keep their own finish: polished stone, plaster, wood, velvet.
      if (done.has(mat) || mat.type !== 'MeshStandardMaterial' || mat.transparent || mat.map || mat.vertexColors || mat.userData.noDetail) continue;
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
            float hdDist = length(vViewPosition), hdFade = 1.0 - smoothstep(220.0, 650.0, hdDist), hdNear = 1.0 - smoothstep(90.0, 170.0, hdDist);
            if (hdFade > 0.0) {
              vec3 hdWN = normalize((vec4(normal, 0.0) * viewMatrix).xyz), a, n; vec2 ra;
              hdTri(${c.layer}, vHdW, ${c.scale.toFixed(1)}, hdWN, hdNear, a, n, ra);
              diffuseColor.rgb *= mix(vec3(1.0), hdRatio(a, ${c.layer}) * mix(1.0, ra.x, 0.5), hdFade * ${c.k.toFixed(2)});
              normal = normalize((viewMatrix * vec4(normalize(mix(hdWN, n, hdFade * ${c.k.toFixed(2)})), 0.0)).xyz);
              roughnessFactor = mix(roughnessFactor, ra.y, hdNear * 0.5);
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

// ---------- Scanned rocks ----------
// The scatter's rock spots, drawn with the scanned models. Only rocks near the camera are drawn:
// every few frames the instance lists are rebuilt from the rocks within reach.
export class HDRocks {
  constructor(scene, spots, rand) {
    // Near the camera each rock is a full scan and casts a shadow. Further out the same rock is a
    // lumpy low-poly boulder in the same scanned material: a scan is 10,000 to 16,000 triangles,
    // and drawing hundreds of them, three times a frame, was most of the realistic look's cost.
    this.variants = HD.rocks.map((v) => {
      const mesh = new THREE.InstancedMesh(v.geometry, v.material, spots.length);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, big: v.big };
    });
    const far = new THREE.IcosahedronGeometry(0.55, 2), fp = far.attributes.position;
    for (let k = 0; k < fp.count; k++) {
      const x = fp.getX(k), y = fp.getY(k), z = fp.getZ(k);
      const n = 1 + 0.2 * Math.sin(x * 5.6 + 1.3) * Math.sin(z * 4.9) + 0.1 * Math.sin(y * 9.5 + x * 3.6);
      fp.setXYZ(k, x * n, Math.max(y * n, -0.25), z * n);
    }
    far.computeVertexNormals();
    this.far = new THREE.InstancedMesh(far, HD.rocks[0].material, spots.length);
    this.far.count = 0;
    this.far.receiveShadow = true;
    this.far.frustumCulled = false;
    this.far.userData.noAO = true;
    scene.add(this.far);
    const small = this.variants.filter((v) => !v.big), big = this.variants.filter((v) => v.big);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    // The heavy boulder scans go only to the largest rocks.
    this.spots = spots.map((s) => {
      const pool = big.length && s.s > 1.6 && rand() < 0.5 ? big : small;
      q.setFromEuler(e.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3));
      m.compose(p.set(s.x, s.y - s.s * 0.18, s.z), q, sc.set(s.s, s.s * (0.75 + rand() * 0.35), s.s * (0.85 + rand() * 0.3)));
      // The scan stands taller or lower than the plain boulder: climb the one you see.
      const v = pool[Math.floor(rand() * pool.length)];
      if (s.obs) { v.mesh.geometry.boundingBox || v.mesh.geometry.computeBoundingBox(); s.obs.top = p.y + v.mesh.geometry.boundingBox.max.y * sc.y; }
      return { x: s.x, z: s.z, v, m: m.clone() };
    });
    this.timer = 0;
    this.near = 90;
    this.reach = 500;
  }
  update(dt, cam) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    for (const v of this.variants) v.mesh.count = 0;
    this.far.count = 0;
    const n2 = this.near * this.near, r2 = this.reach * this.reach;
    for (const s of this.spots) {
      const dx = s.x - cam.x, dz = s.z - cam.z, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const mesh = d2 < n2 ? s.v.mesh : this.far;
      mesh.setMatrixAt(mesh.count++, s.m);
    }
    for (const v of this.variants) v.mesh.instanceMatrix.needsUpdate = true;
    this.far.instanceMatrix.needsUpdate = true;
  }
}
