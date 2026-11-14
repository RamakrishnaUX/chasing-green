import * as THREE from 'three';
import { HD, HD_TERRAIN, HD_SUN_SHADOW, terrainUniforms, terrainShadowChunk } from './hd.js';
import { nightSky, NIGHT_SKY_GLSL } from './skyreflect.js';
import { NOISE_TABLE, NOISE_SIZE } from './noise.js';
import { waterTex, WATER_GLSL, WAVE_SLOPE } from './water.js';

// The value-noise table as a texture (half floats, filtered, tiling).
function noiseTexture() {
  const d = new Uint16Array(NOISE_TABLE.length);
  for (let i = 0; i < d.length; i++) d[i] = THREE.DataUtils.toHalfFloat(NOISE_TABLE[i]);
  const t = new THREE.DataTexture(d, NOISE_SIZE, NOISE_SIZE, THREE.RedFormat, THREE.HalfFloatType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// Shared uniforms for everything that changes with season, time or light.
export const surfaceUniforms = {
  // Terrain height as a texture, so water can work out its own depth (set by the terrain).
  uHeightTex: { value: null },
  uGridMin: { value: new THREE.Vector2() },
  uGridStep: { value: new THREE.Vector2(1, 1) },
  uGridN: { value: new THREE.Vector2(1, 1) },
  // Cloud shadows drifting over the land.
  uCloudCover: { value: 0 },
  uCloudOffset: { value: new THREE.Vector2() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunUp: { value: 1 },
  uSnowLine: { value: 10 },
  // Rhyolite colours painted on the land around Landmannalaugar: x, z, radius.
  uRhyolite: { value: new THREE.Vector3(0, 0, 0) },
  uSummer: { value: 0 },
  uTime: { value: 0 },
  uNight: { value: 0 },
  // Rain: how hard it is falling now (0 to 1), and how wet the ground is (it lags the rain).
  uRain: { value: 0 },
  uSurfPatch: { value: new THREE.Vector3() }, // where the surf patch (surf.js) is drawn over the sea: x, z, half size
  uWet: { value: 0 },
  // Winter on the roads (0 to 1): packed snow, ploughed banks and patches of ice.
  uRoadSnow: { value: 0 },
  // Value noise read from a table (TABLE_NOISE).
  uNoiseTex: { value: noiseTexture() },
  // The long sun shadows over the land (hd.js SunMap), realistic look only.
  uSunMap: { value: null },
};

export const NOISE = /* glsl */ `
float g_h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float g_n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(g_h(i), g_h(i+vec2(1,0)), u.x), mix(g_h(i+vec2(0,1)), g_h(i+vec2(1,1)), u.x), u.y); }
float g_f(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*g_n(p); p = p*2.07 + 13.7; a *= 0.5; } return s; }
uniform float uWet; uniform float uRain;
// Raindrop rings: in every cell a drop lands at its own moment and a ring spreads and fades.
// Returns a slope (x, z) to tilt the water's normal by.
vec2 rainRings(vec2 p, float t){
  vec2 g = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * 2.3 + float(k) * 0.37, c = floor(q), f = fract(q) - 0.5;
    float h = g_h(c + float(k) * 7.0);
    vec2 o = vec2(g_h(c + 3.1), g_h(c + 5.7)) - 0.5;
    float ph = fract(t * 1.4 + h);
    vec2 d = f - o * 0.6; float r = length(d), e = r - ph * 0.45;
    g += (r > 1e-3 ? d / r : vec2(0.0)) * exp(-e * e * 900.0) * sin(e * 90.0) * (1.0 - ph);
  }
  return g;
}
`;

// The ground and road shaders read their value noise from a table instead of hashing: the same
// smoothstep-blended value noise, one filtered lookup (the blend weights moved into the texture
// coordinate) in place of four hashes. Their CPU twins in terrain.js read the same table.
const NATURE = /* glsl */`
// Grassland as it is in Iceland, not a lawn: less lime, more olive; big patches of darker moss and
// of drier, yellowing grass, and close up the light and shade of tussocks. Only where grass is
// the ground (rock, earth, snow and lava keep their own colours).
vec3 hdNature(vec3 c, vec3 p, float dist){
  float g = clamp(1.0 - tRockW - tSnowW - tEarthW - tLavaW, 0.0, 1.0);
  if (g <= 0.01) return c;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 cc = mix(vec3(l), c * vec3(1.05, 0.94, 0.8), 0.8);
  // The terrain colour's own noise (tNL, tNM, tNF), so this costs no more lookups.
  float a = tNL, b = tNM;
  cc *= mix(0.82, 1.12, a);
  cc = mix(cc, cc * vec3(1.16, 1.04, 0.72), smoothstep(0.55, 0.8, b) * 0.55);
  cc = mix(cc, cc * vec3(0.7, 0.84, 0.68), smoothstep(0.55, 0.82, 1.0 - b) * 0.5);
  float near = 1.0 - smoothstep(30.0, 140.0, dist);
  cc *= mix(1.0, 0.84 + 0.32 * tNF, near);
  return mix(c, cc, g);
}
`;
const TABLE_NOISE = /* glsl */ `
uniform sampler2D uNoiseTex;
float g_nt(vec2 p){ vec2 i = floor(p), f = p - i; return textureLod(uNoiseTex, (i + f * f * (3.0 - 2.0 * f) + 0.5) * ${(1 / NOISE_SIZE).toFixed(8)}, 0.0).r; }
float g_ft(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * g_nt(p); p = p * 2.07 + 13.7; a *= 0.5; } return s; }
#define g_n g_nt
#define g_f g_ft
`;

// Colours below are written in sRGB (as you would pick them from a photo) and converted at the end.
// The function also returns a bump height and a roughness, so lighting picks up grass streaks,
// rock layers and smooth snow.
const TERRAIN_COLOR = /* glsl */ `
float tBump; float tRough; float tSpark;
// Layer weights, read by the realistic (desktop) shader to blend its scanned textures.
float tEarthW; float tRockW; float tSnowW; float tLavaW;
// Its noise, kept for the grassland colouring (NATURE).
float tNL; float tNM; float tNF;
// Noise laid on from all three sides, weighted by which way the ground faces, so steep slopes
// get the same grain as flat ground instead of the top-down pattern smeared down them. Flat
// ground pays for one sample only.
#ifndef HD_ROCK
vec3 tpW;
float tpFbm(vec3 p, float s){
  float v = tpW.y > 0.0 ? g_f(p.xz * s) * tpW.y : 0.0;
  if (tpW.x > 0.0) v += g_f(p.zy * s + 5.1) * tpW.x;
  if (tpW.z > 0.0) v += g_f(p.xy * s + 9.7) * tpW.z;
  return v;
}
float tpFine(vec3 p){
  float v = tpW.y > 0.0 ? (g_n(p.xz * 0.6) * 0.6 + g_n(p.xz * 2.1) * 0.4) * tpW.y : 0.0;
  if (tpW.x > 0.0) v += (g_n(p.zy * 0.6 + 3.3) * 0.6 + g_n(p.zy * 2.1) * 0.4) * tpW.x;
  if (tpW.z > 0.0) v += (g_n(p.xy * 0.6 + 7.7) * 0.6 + g_n(p.xy * 2.1) * 0.4) * tpW.z;
  return v;
}
#endif
vec3 terrainColor(vec3 masks, vec3 p, vec3 nrm, float dist){
  float slope = 1.0 - clamp(nrm.y, 0.0, 1.0);
#ifndef HD_ROCK
  vec3 aw = pow(abs(nrm), vec3(4.0)); aw /= aw.x + aw.y + aw.z;
  tpW = aw * step(0.04, aw); tpW /= tpW.x + tpW.y + tpW.z;
#endif
  float nL = g_f(p.xz * 0.006);
#ifdef HD_ROCK
  // (The realistic look's scans carry slopes' grain; sampling three ways cost it a sixth of a frame.)
  float nM = g_f(p.xz * 0.035);
#else
  float nM = tpFbm(p, 0.035);
#endif
  float detail = 1.0 - smoothstep(20.0, 75.0, dist);
  // Fine noise fades out with distance so far slopes stay clean instead of shimmering.
  float lod = 1.0 - smoothstep(50.0, 220.0, dist);
#ifdef HD_ROCK
  float nF = mix(0.5, g_n(p.xz * 0.6) * 0.6 + g_n(p.xz * 2.1) * 0.4, lod);
#else
  float nF = mix(0.5, lod > 0.0 ? tpFine(p) : 0.5, lod);
#endif
  tNL = nL; tNM = nM; tNF = nF;
  // Grass: pale gold, straw and rust in the cold months, with olive and moss mixed in.
#ifdef HD_ROCK
  // Realistic look: real vegetation is darker than paint (an albedo of about a fifth), and
  // Iceland's cold-season grass is tawny and khaki with olive moss through it, not pale gold.
  vec3 pale = vec3(0.66, 0.57, 0.38), straw = vec3(0.56, 0.46, 0.28), rust = vec3(0.54, 0.36, 0.2);
  vec3 olive = vec3(0.38, 0.38, 0.2), moss = vec3(0.31, 0.37, 0.17);
#else
  vec3 pale = vec3(0.84, 0.72, 0.48), straw = vec3(0.74, 0.6, 0.36), rust = vec3(0.7, 0.47, 0.25);
  vec3 olive = vec3(0.47, 0.44, 0.23), moss = vec3(0.40, 0.45, 0.22);
#endif
  vec3 grassW = mix(straw, pale, smoothstep(0.35, 0.7, nM));
  grassW = mix(grassW, rust, smoothstep(0.6, 0.85, nL) * 0.4);
  grassW = mix(grassW, olive, smoothstep(0.6, 0.85, g_f(p.xz * 0.012 + 7.0)) * 0.6);
#ifdef HD_ROCK
  // Broad drifts of moss and olive through the dry grass, and darker damp hollows.
  grassW = mix(grassW, mix(olive, moss, nF), smoothstep(0.4, 0.75, g_f(p.xz * 0.02 + 3.0)) * 0.55);
  grassW *= 0.88 + 0.24 * smoothstep(0.25, 0.75, nL);
#endif
  vec3 grassS = mix(vec3(0.33, 0.45, 0.17), vec3(0.47, 0.55, 0.24), smoothstep(0.3, 0.7, nM));
  grassS = mix(grassS, olive, smoothstep(0.6, 0.85, nL) * 0.5);
  vec3 col = mix(grassW, grassS, uSummer);
  // Hay fields: bright green patches on the lowland near farms and roads.
  float field = smoothstep(0.62, 0.66, g_f(p.xz * 0.0045 + 3.3)) * (1.0 - smoothstep(9.0, 16.0, p.y)) * (1.0 - smoothstep(0.06, 0.14, slope));
  col = mix(col, mix(vec3(0.36, 0.55, 0.18), vec3(0.45, 0.62, 0.22), nF), field * (0.55 + 0.4 * uSummer));
  // Streaky grass texture up close.
#ifdef HD_ROCK
  float streak = mix(0.5, g_n(vec2(p.x * 1.6, p.z * 0.35) + nF) * 0.5 + g_n(vec2(p.x * 0.35, p.z * 1.6) - nF) * 0.5, detail);
#else
  float streak = detail > 0.0 && slope < 0.3 ? mix(0.5, g_n(vec2(p.x * 1.6, p.z * 0.35) + nF) * 0.5 + g_n(vec2(p.x * 0.35, p.z * 1.6) - nF) * 0.5, detail * (1.0 - smoothstep(0.15, 0.3, slope))) : 0.5;
#endif
  col *= 0.8 + 0.34 * mix(0.5, streak, detail) + 0.12 * (nF - 0.5);
  tBump = streak * 0.08 * detail;
  tRough = 0.95;
  // Lower slopes: brown earth and moss; steep faces: dark layered basalt with pale scree streaks.
  tEarthW = smoothstep(0.14, 0.32, slope) * 0.8;
  col = mix(col, mix(vec3(0.38, 0.30, 0.21), olive * 0.8, nM) * (0.85 + 0.3 * nF), tEarthW);
  float warp = g_n(p.xz * 0.02 + p.y * 0.02) * 9.0 + g_n(p.xz * 0.045 + p.y * 0.03) * 3.0 + g_n(p.xz * 0.25) * 1.0 * lod;
  float layers = sin(p.y * (0.55 + 0.2 * nL) + warp) * (1.0 - smoothstep(250.0, 900.0, dist) * 0.7);
#ifdef HD_ROCK
  // The scanned rock carries the detail up close; strong painted bands would read as wood grain.
  layers *= mix(0.1, 1.0, smoothstep(150.0, 600.0, dist));
#endif
  vec3 rockDark = vec3(0.16, 0.15, 0.15), rockWarm = vec3(0.36, 0.27, 0.21), rockGrey = vec3(0.42, 0.42, 0.42);
  vec3 rock = mix(rockDark, rockWarm, (layers * 0.5 + 0.5) * 0.45 + nM * 0.3 + nF * 0.15 * detail);
  float scree = smoothstep(0.55, 0.8, g_n(vec2(p.x * 0.035, p.y * 0.012 + p.z * 0.035)) * 0.6 + mix(0.5, g_n(p.xz * 0.5), lod) * 0.4) * smoothstep(0.3, 0.5, slope);
#ifdef HD_ROCK
  scree *= mix(0.2, 1.0, smoothstep(120.0, 500.0, dist));
#endif
  rock = mix(rock, rockGrey * (0.85 + 0.2 * nF), scree * 0.4);
  float rockAmt = smoothstep(0.28, 0.5, slope);
  tRockW = rockAmt;
  // Erosion gullies running straight down the fall line, visible from any distance.
  vec2 fall = normalize(nrm.xz + vec2(1e-4));
  // On flat ground the fall line is undefined, so fade back to plain coordinates there.
  float across = mix(p.x + p.z * 0.37, dot(p.xz, vec2(-fall.y, fall.x)), smoothstep(0.08, 0.28, slope));
  float gully = g_n(vec2(across * 0.05, p.y * 0.008)) * 0.7 + mix(0.5, g_n(vec2(across * 0.16, p.y * 0.02)), lod) * 0.3;
  float gullyDark = smoothstep(0.58, 0.85, gully);
#ifdef HD_ROCK
  // On weathered (bumpy) faces the fall line wanders, which bends painted streaks into swirls.
  // Up close the scanned rock carries the detail, so the painted gullies fade in only with distance.
  gullyDark *= mix(0.15, 1.0, smoothstep(120.0, 500.0, dist));
#endif
  rock *= 1.0 - gullyDark * 0.3;
  // Shadowed cavity under each basalt ledge.
  rock *= 0.78 + 0.22 * smoothstep(-0.7, 0.5, layers);
  // Big, slow variation so whole mountainsides are not one flat colour.
  rock *= 0.85 + 0.3 * g_n(p.xz * 0.0025 + 11.0);
  col = mix(col, rock, rockAmt);
  tBump = mix(tBump, nF * 0.35 * lod, rockAmt);
  tRough = mix(tRough, 0.88, rockAmt);
  // Snow: settles on gentler ground above the snow line and on the ledges between rock layers.
  float line = uSnowLine + (nL - 0.5) * 16.0 + (nM - 0.5) * 6.0;
  float above = smoothstep(line - 7.0, line + 9.0, p.y);
  // Snow lies on every slope it can hold to: thick on gentle ground, thinner on steep rock,
  // so the white follows the mountain's shape instead of sitting on it in bands.
  float flatSnow = above * mix(1.0, 0.55, smoothstep(0.32, 0.75, slope));
  float snowPatch = smoothstep(0.35, 0.75, g_n(p.xz * 0.08 + p.y * 0.1) * 0.7 + mix(0.5, g_n(p.xz * 0.4 - p.y * 0.3), lod) * 0.3);
  float ledge = above * smoothstep(0.3, 0.85, layers) * smoothstep(0.28, 0.5, slope) * snowPatch;
  float dust = (1.0 - uSummer) * smoothstep(line - 18.0, line, p.y) * smoothstep(0.55, 0.85, nM) * (1.0 - rockAmt) * 0.6;
  float snow = max(max(flatSnow, ledge * 0.25 * lod), dust * 0.7);
#ifdef HD_ROCK
  // Wind scours steep faces and ridges, so dark rock breaks through the snow in patches.
  float bare = smoothstep(0.36, 0.62, slope) * smoothstep(0.38, 0.68, g_n(p.xz * 0.05 + p.y * 0.04) * 0.6 + g_n(p.xz * 0.19 - p.y * 0.07) * 0.4);
  snow *= 1.0 - bare * 0.9;
#endif
  tSnowW = snow;
  // Snow: wind streaks down the slope, cooler blue in hollows, brighter on the ridges,
  // with thin lines of rock showing through in the steeper gullies.
  float streakS = g_n(vec2(across * 0.06, p.y * 0.01)) * 0.6 + g_n(vec2(across * 0.22, p.y * 0.03)) * 0.4 * lod;
#ifdef HD_ROCK
  streakS = mix(0.5, streakS, mix(0.25, 0.55, smoothstep(150.0, 600.0, dist)));
#endif
  // Wind streaks only where the slope is steep enough to have a clear fall line.
  vec3 snowC = mix(vec3(0.84, 0.88, 0.95), vec3(0.97, 0.98, 1.0), mix(0.65, smoothstep(0.28, 0.78, streakS), smoothstep(0.25, 0.55, slope)));
  snowC *= 0.94 + 0.06 * nF;
  float thin = smoothstep(0.34, 0.6, slope) * smoothstep(0.58, 0.85, gully);
  snowC = mix(snowC, rock * 0.9, thin * 0.75);
  col = mix(col, snowC, snow);
  // Wind ripples (sastrugi) up close and soft drifts further out.
  float ripples = sin(dot(p.xz, vec2(1.1, 0.45)) * 2.2 + nF * 4.0) * 0.5 + 0.5;
  tBump = mix(tBump, ripples * 0.1 * detail + streakS * 0.25 * lod, snow);
  tSpark = snow * detail * step(0.9965, g_h(floor(p.xz * 9.0) + floor(p.y * 9.0)));
  tRough = mix(tRough, 0.62, snow);
  // Rhyolite mountains: banded reds, ochres, greens and greys on the slopes around Landmannalaugar.
  float rhy = uRhyolite.z > 0.0 ? 1.0 - smoothstep(uRhyolite.z * 0.6, uRhyolite.z, length(p.xz - uRhyolite.xy)) : 0.0;
  if (rhy > 0.0) {
    float bandR = sin(p.y * 0.35 + g_n(p.xz * 0.02) * 6.0);
    vec3 r1 = vec3(0.72, 0.42, 0.28), r2 = vec3(0.85, 0.68, 0.38), r3 = vec3(0.5, 0.58, 0.44), r4 = vec3(0.62, 0.6, 0.58);
    vec3 rc = mix(mix(r1, r2, smoothstep(-0.6, 0.2, bandR)), mix(r3, r4, nM), smoothstep(0.3, 0.9, bandR));
#ifdef HD_ROCK
    // Real rhyolite is muted ochre, sage and grey, with softer band edges.
    rc = mix(vec3(dot(rc, vec3(0.3, 0.5, 0.2))), rc, 0.55) * 0.92;
#endif
    col = mix(col, rc * (0.85 + 0.2 * nF), rhy * smoothstep(0.18, 0.42, slope) * (1.0 - snow * 0.7));
  }
  // Black volcanic sand along the coast, darker and a little glossy where it is wet.
  col = mix(col, vec3(0.08, 0.08, 0.09) * (0.75 + 0.5 * nF), masks.r);
  tRough = mix(tRough, 0.55, masks.r * smoothstep(2.0, 0.3, p.y));
  // Lava fields: dark rock wrapped in grey-green moss.
  vec3 lavaMoss = mix(vec3(0.45, 0.47, 0.33), vec3(0.5, 0.56, 0.24), uSummer);
  vec3 lava = mix(vec3(0.13, 0.13, 0.12), lavaMoss, smoothstep(0.35, 0.7, nM) * (0.7 + 0.3 * nF));
  tLavaW = masks.g * (1.0 - snow * 0.6);
  col = mix(col, lava, tLavaW);
  tBump = mix(tBump, nF * 0.4 * lod, masks.g);
  // Glacier ice, with blue in the crevasses and grey ash bands.
  vec3 ice = mix(vec3(0.9, 0.94, 0.97), vec3(0.6, 0.76, 0.87), smoothstep(0.5, 0.8, nM) * 0.7);
  ice = mix(ice, vec3(0.45, 0.45, 0.46), smoothstep(0.75, 0.9, sin(p.y * 0.6 + nL * 6.0)) * 0.25);
  col = mix(col, ice, masks.b);
  tRough = mix(tRough, 0.45, masks.b);
  // Under water: dark seabed.
  col = mix(col, vec3(0.12, 0.15, 0.16), smoothstep(0.3, -0.5, p.y) * (1.0 - masks.b));
  return pow(col, vec3(2.2));
}
// Cloud shadows: the same kind of noise as the sky clouds, projected down along the sun.
float cloudShade(vec3 p){
  if (uSunUp < 0.01 || uCloudCover < 0.05) return 1.0;
  vec2 q = p.xz + uCloudOffset - uSunDir.xz / max(uSunDir.y, 0.18) * 380.0;
  float n = g_f(q * 0.0045);
  float cov = smoothstep(1.0 - uCloudCover - 0.1, 1.0 - uCloudCover + 0.25, n);
  return 1.0 - 0.42 * cov * uSunUp;
}`;

// Standard bump: tilt the normal by the screen-space slope of a height value.
const BUMP = /* glsl */ `
vec3 bumpNormal(vec3 n, float h, float k){
  vec3 sp = -vViewPosition;
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec2 dh = vec2(dFdx(h), dFdy(h)) * k;
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  vec3 r = abs(det) * n - grad;
  // On distant ground some GPUs round these tiny values to zero; fall back to the plain normal.
  float l2 = dot(r, r);
  return (l2 > 1e-20 && l2 == l2) ? r * inversesqrt(l2) : n;
}`;

let sharedRock = null;
// One shared instance for landmark rock, so cliffs get the same layers and snow as the land.
export function rockMaterial() {
  if (!sharedRock) sharedRock = createTerrainMaterial();
  return sharedRock;
}

export function createTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const hd = HD.on;
  if (hd) { mat.customProgramCacheKey = () => 'terrain-hd'; mat.defines = { HD_ROCK: '' }; }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms, hd ? terrainUniforms() : {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uSnowLine; uniform float uSummer; uniform float uCloudCover; uniform vec2 uCloudOffset; uniform vec3 uSunDir; uniform float uSunUp; uniform vec3 uRhyolite;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n${NOISE}\n${TABLE_NOISE}\n${TERRAIN_COLOR}\n${hd ? HD_TERRAIN + HD_SUN_SHADOW : ''}`)
      .replace('#include <lights_fragment_end>', hd ? terrainShadowChunk() : '#include <lights_fragment_end>')
      .replace('#include <normal_pars_fragment>', `#include <normal_pars_fragment>\n${BUMP}\n${NATURE}`)
      .replace('#include <color_fragment>', hd
        ? 'vec3 tCol = terrainColor(vColor, vWPos, normalize(vWNrm), length(vViewPosition));\nhdDetail(vColor, vWPos, normalize(vWNrm), length(vViewPosition));\ndiffuseColor.rgb = hdNature(tCol, vWPos, length(vViewPosition)) * hdA * cloudShade(vWPos);'
        : 'diffuseColor.rgb = hdNature(terrainColor(vColor, vWPos, normalize(vWNrm), length(vViewPosition)), vWPos, length(vViewPosition)) * cloudShade(vWPos);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * tSpark * uSunUp * 1.5;')
      .replace('#include <roughnessmap_fragment>', (hd ? 'float roughnessFactor = hdR;' : 'float roughnessFactor = tRough;') + '\n// Wet ground: darker and a little glossier.\nroughnessFactor = mix(roughnessFactor, 0.45, uWet * 0.5);\ndiffuseColor.rgb *= mix(1.0, 0.7, uWet);')
      .replace('#include <normal_fragment_maps>', hd
        ? `#include <normal_fragment_maps>
          normal = normalize((viewMatrix * vec4(hdN, 0.0)).xyz);
          {
            // Beyond the scanned textures, rocky relief: crags and ribs on rock and snow slopes,
            // so mountains in the middle distance still read as rough rather than smooth.
            float dv = length(vViewPosition);
            float far = smoothstep(120.0, 450.0, dv) * (1.0 - smoothstep(2500.0, 4000.0, dv));
            float steep = max(tRockW, tSnowW * 0.7);
            if (far * steep > 0.01) {
              float r1 = 1.0 - abs(g_n(vWPos.xz * 0.045 + vWPos.y * 0.03) * 2.0 - 1.0);
              float r2 = 1.0 - abs(g_n(vWPos.xz * 0.13 - vWPos.y * 0.05) * 2.0 - 1.0);
              normal = bumpNormal(normal, (r1 * r1 * 0.7 + r2 * 0.3) * far * steep, 9.0);
            }
          }`
        : '#include <normal_fragment_maps>\nnormal = bumpNormal(normal, tBump * (1.0 - smoothstep(40.0, 140.0, length(vViewPosition))), 4.0);');
  };
  return mat;
}

// Roads carry vRoad = (signed distance from centre line, distance along the road).
export function createRoadMaterial({ paved, halfWidth }) {
  // Two-sided: each road edge has a skirt hanging down, and the two skirts face opposite ways.
  // Pulled well forward in depth, so where the land rises a few centimetres over the verge's
  // outer edge it never shows through in teeth (most visible against a snow bank in headlights).
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12, side: THREE.DoubleSide });
  const hd = HD.on;
  if (hd) mat.customProgramCacheKey = () => `road-hd-${paved}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms);
    // Desktop: real asphalt and gravel under the painted lines, as light and shade on the classic colours.
    if (hd) Object.assign(shader.uniforms, { rdAlb: { value: HD.road.asphalt.alb }, rdMean: { value: HD.road.asphalt.mean }, grAlb: { value: HD.road.gravel.alb }, grMean: { value: HD.road.gravel.mean } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad;\nattribute float aJunction;\nvarying vec2 vRoad;\nvarying float vJ;\nvarying vec2 vRW;\nuniform float uRoadSnow;')
      // In winter the verge's outer edge (and the skirt's top) rises into a ploughed snow bank, a
      // little above the land there, so the land never cuts into it in teeth.
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRoad = aRoad;\nvJ = aJunction;\nvRW = (modelMatrix * vec4(transformed, 1.0)).xz;\nif (abs(aRoad.x) > ${(halfWidth + 1.05).toFixed(2)} && abs(aRoad.x) < ${(halfWidth + 1.4).toFixed(2)}) transformed.y += smoothstep(0.1, 0.5, uRoadSnow) * 0.32;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vRoad;\nvarying float vJ;\nvarying vec2 vRW;\nuniform float uSummer; uniform float uRoadSnow;\n${NOISE}\n${TABLE_NOISE}\nfloat rBump; float rRough; float rSnow;${hd ? `\nuniform sampler2D rdAlb; uniform vec3 rdMean; uniform sampler2D grAlb; uniform vec3 grMean;\nvec3 rdRatio(sampler2D t, vec3 m, vec2 uv, float chroma, out float lum){ vec3 a = texture2D(t, uv).rgb; lum = dot(a, vec3(0.2126, 0.7152, 0.0722)) / max(dot(m, vec3(0.2126, 0.7152, 0.0722)), 1e-3); return clamp(mix(vec3(lum), a / max(m, vec3(1e-3)), chroma), 0.0, 2.5); }` : ''}`)
      .replace('#include <normal_pars_fragment>', `#include <normal_pars_fragment>\n${BUMP}`)
      .replace('#include <color_fragment>', `
        float lat = abs(vRoad.x);
        float hw = ${halfWidth.toFixed(2)};
        float dist = length(vViewPosition);
        float fine = 1.0 - smoothstep(8.0, 45.0, dist);
        float grain = g_n(vRoad * vec2(23.0, 19.0)) * 0.45 + g_n(vRoad * vec2(71.0, 63.0)) * 0.35 + g_n(vRoad * vec2(4.0, 3.1)) * 0.2;
        float patchy = g_n(vRoad * vec2(0.35, 0.06));
        float shoulder = smoothstep(hw - 0.05, hw + 0.2, lat);
        vec3 c;
        float hdPaint = 0.0;
        ${paved ? `
        // Dark, coarse Icelandic asphalt: pale stones in black binder, worn smoother in the wheel tracks.
        vec3 asphalt = mix(vec3(0.2, 0.2, 0.21), vec3(0.3, 0.3, 0.31), mix(0.5, grain, ${hd ? '0.12 + 0.25 * fine' : '0.35 + 0.65 * fine'}));
        float track = smoothstep(0.7, 0.0, abs(lat - hw * 0.5));
        asphalt *= (0.92 + 0.1 * patchy - track * ${hd ? '0.12' : '0.05'})${hd ? ' * vec3(1.07, 1.03, 0.95)' : ''};
        // Thin edge lines and a dashed centre line.
        float edge = smoothstep(0.04, 0.0, abs(lat - (hw - 0.28)) - 0.06);
        float dash = step(fract(vRoad.y / 10.0), 0.38) * smoothstep(0.03, 0.0, lat - 0.08);
        // Painted lines stop short of junctions so they never cross another road.
        float paint = max(edge, dash) * (0.82 + 0.18 * grain) * smoothstep(0.0, 7.0, vJ);
        c = mix(asphalt, vec3(0.86, 0.86, 0.83), paint);
        hdPaint = paint;
        rRough = mix(mix(0.78, 0.66, track), 0.55, paint);
        rBump = grain * 0.02 * (1.0 - paint) * fine;` : `
        vec3 gravel = mix(vec3(0.43, 0.39, 0.33), vec3(0.55, 0.5, 0.43), grain);
        float ruts = smoothstep(0.45, 0.0, abs(lat - hw * 0.45));
        c = mix(gravel, gravel * 0.8, ruts * 0.6) * (0.9 + 0.15 * patchy);
        rRough = 0.95;
        rBump = (grain * 0.12 + ruts * 0.08) * fine;`}
        // Gravel shoulder: grey-brown stones that thin out into the verge.
        vec3 sh = mix(vec3(0.27, 0.26, 0.25), vec3(0.45, 0.42, 0.38), grain) * (0.9 + 0.2 * patchy);
        c = mix(c, sh, shoulder);
        rRough = mix(rRough, 0.95, shoulder);
        rBump = mix(rBump, grain * 0.15 * fine, shoulder);
        // Winter: snow ploughed into banks along the edges, packed snow on the road that the
        // wheels wear back to dark tracks, drifts reaching in from the sides, and patches of
        // glazed ice (iceAt in terrain.js finds the same patches, so they really are slippery).
        rSnow = 0.0;
        if (uRoadSnow > 0.01) {
          float rs = uRoadSnow;
          float blot = g_n(vRW * 0.55) * 0.6 + g_n(vRW * 2.1 + 3.0) * 0.4;
          ${paved ? 'float tracks = max(smoothstep(0.5, 0.15, abs(lat - 0.85)), smoothstep(0.5, 0.15, abs(lat - 2.45)));' : 'float tracks = smoothstep(0.5, 0.15, abs(lat - hw * 0.45));'}
          float drift = smoothstep(hw - 1.6 - rs * 0.8, hw - 0.2, lat + (blot - 0.5) * 1.4);
          float packed = clamp(smoothstep(0.42, 0.62, blot * 0.55 + (1.0 - tracks) * 0.35 + rs * 0.3) * mix(0.55, 1.0, rs) + drift, 0.0, 1.0) * smoothstep(0.0, 0.25, rs);
          vec3 packedC = mix(vec3(0.6, 0.63, 0.67), vec3(0.85, 0.87, 0.9), g_n(vRoad * vec2(7.0, 2.5)) * 0.6 + drift * 0.4);
          vec3 trackC = c * 0.75 + vec3(0.03, 0.035, 0.04);
          c = mix(c, trackC, tracks * rs * 0.6);
          c = mix(c, packedC, packed * (1.0 - shoulder));
          float iceN = g_n(vRW * 0.03) * 0.7 + g_n(vRW * 0.11 + vec2(5.0, 9.0)) * 0.3;
          float ice = smoothstep(0.6, 0.67, iceN) * smoothstep(0.15, 0.5, rs) * (1.0 - shoulder) * (1.0 - drift);
          c = mix(c, vec3(0.1, 0.12, 0.15) + packedC * 0.12, ice * 0.85);
          float bank = smoothstep(0.0, 0.3, rs) * smoothstep(hw - 0.1, hw + 0.5, lat);
          // The bank's outer edge, and the skirt below it where the land dips, settle to the
          // duller white of the snow on the land, so the join does not show as bright teeth.
          float outer = smoothstep(hw + 0.6, hw + 1.1, lat);
          c = mix(c, vec3(0.88, 0.9, 0.93) * (0.9 + 0.1 * blot) * mix(1.0, 0.72, outer), bank);
          rSnow = max(max(packed * (1.0 - shoulder), bank), 0.0) * (1.0 - ice);
          rRough = mix(mix(rRough, 0.82, rSnow), 0.07, ice);
          rBump = mix(rBump, (blot - 0.5) * 0.12 * fine + bank * 0.18 * blot, rSnow) * (1.0 - ice);
          hdPaint = max(hdPaint, max(rSnow, ice));
        }
        diffuseColor.rgb = pow(c, vec3(2.2));${hd ? `
        float hdFade = 1.0 - smoothstep(120.0, 420.0, dist), lA, lG;
        vec3 ra = rdRatio(${paved ? 'rdAlb, rdMean, vRoad / 3.5, 0.0' : 'grAlb, grMean, vRoad / 4.0, 0.2'}, lA);
        vec3 rg = rdRatio(grAlb, grMean, vRoad / 4.0, 0.2, lG);
        diffuseColor.rgb *= mix(vec3(1.0), mix(ra, rg, shoulder), (1.0 - hdPaint) * hdFade * mix(0.7, 1.0, shoulder));
        rBump += (mix(lA, lG, shoulder) - 1.0) * 0.035 * fine;
        // Bump finer than a pixel flickers into sun-coloured speckle: fade it out as the
        // texture's grain shrinks below a few pixels.
        rBump *= 1.0 - smoothstep(0.0015, 0.006, length(fwidth(vRoad)));` : ''}`)
      .replace('#include <roughnessmap_fragment>', '// Wet tarmac: darker, and smooth enough to mirror lights and the sky (not the snow on it).\nfloat roughnessFactor = min(rRough, mix(rRough, 0.34, uWet * 0.85 * (1.0 - rSnow)));\ndiffuseColor.rgb *= mix(1.0, 0.42, uWet * (1.0 - rSnow));')
      // The verge follows every bump in the land, so low light (headlights above all) picked out
      // each little tilt as a bright or dark step: it is lit as if nearly flat instead. The skirts
      // hanging below the edges are lit as flat too, so where one shows it reads as more verge.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = bumpNormal(normal, rBump, 1.0);\n{ vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); float vg = smoothstep(${(halfWidth - 0.1).toFixed(2)}, ${(halfWidth + 0.5).toFixed(2)}, abs(vRoad.x)); normal = normalize(mix(normal, upV, abs(vRoad.x) > ${(halfWidth + 1.15).toFixed(2)} ? 1.0 : vg * 0.8)); }`);
  };
  return mat;
}

// Gentle sway for instanced grass tufts.
export function createGrassMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 ip = instanceMatrix[3];
        float sway = sin(uTime * 1.7 + ip.x * 0.13 + ip.z * 0.11) + 0.5 * sin(uTime * 3.1 + ip.x * 0.7);
        transformed.x += sway * position.y * position.y * 0.12;
        transformed.z += sway * position.y * position.y * 0.05;`);
  };
  return mat;
}

// ---------- Water ----------
const GROUND = /* glsl */ `
uniform sampler2D uHeightTex; uniform vec2 uGridMin; uniform vec2 uGridStep; uniform vec2 uGridN;
float wFetch(ivec2 c){ c = clamp(c, ivec2(0), ivec2(uGridN) - 1); return texelFetch(uHeightTex, c, 0).r; }
float groundAt(vec2 p){
  vec2 f = (p - uGridMin) / uGridStep; vec2 i = floor(f); vec2 t = f - i; ivec2 c = ivec2(i);
  float a = wFetch(c), b = wFetch(c + ivec2(1, 0)), cc = wFetch(c + ivec2(0, 1)), d = wFetch(c + ivec2(1, 1));
  return (t.x + t.y < 1.0) ? a + (b - a) * t.x + (cc - a) * t.y : d + (cc - d) * (1.0 - t.x) + (b - d) * (1.0 - t.y);
}`;

// Water that knows how deep it is. What you see on real water is mostly what it mirrors: the sky
// and the sun, strongly at a low angle and hardly at all looking straight down (Fresnel), so the
// surface's slopes, not its colour, make it read as water. Here:
//
// - The surface is wave trains with sharp crests and broad troughs (water.js), read at several
//   sizes moving at their own speeds, long swell out at sea and short chop on lakes and ponds; it
//   blurs to a calm mirror with distance and is roughened there, so the sun's path on the sea at
//   sunset is as wide as it really is and never sparkles into noise.
// - Under the mirror, the water's own colour: light is absorbed with depth, red first, so the
//   shallows over sand and rock are clear turquoise with the caustic web of focused sunlight on
//   the bed, darkening to deep blue-green further out.
// - The sun shining through the thin top of a wave toward you glows green-blue.
// - Foam: lace that washes in and drains back at the shoreline and round rocks, and on the open
//   sea scattered whitecaps on the biggest crests.
export function createWaterMaterial(color, {
  roughness = 0.08, ripple = 1, shallow = [0.2, 0.46, 0.45], deep = [0.012, 0.05, 0.075],
  clarity = 0.55, foam = 1, depthAware = true, glow = 0, bowl = 0, surf = false, waves,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMapIntensity: 1.0 });
  mat.userData.water = true; // found by waterSurfaces (main.js): rings, splashes and rotor wash on it
  // How big the biggest waves are (metres across the largest tile) and how steep: the open sea has
  // room for long swell; a lake's or a pond's wind raises only short chop.
  const scale = waves ?? (surf ? 90 : bowl ? 7 : depthAware ? 24 : 10);
  const amp = surf ? 0.7 : Math.max(0.08, Math.min(0.85, ripple * 0.62));
  // Each set of options writes a different shader, so each needs its own compiled program.
  const key = `water2-${[roughness, ripple, shallow, deep, clarity, foam, depthAware, glow, bowl, surf, scale].join('|')}`;
  mat.customProgramCacheKey = () => key;
  const f3 = (v) => v.map((c) => c.toFixed(3)).join(',');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms, nightSky, waterTex);
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;${bowl ? '\nvBowl = length(uv - 0.5) * 2.0;' : ''}`)
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;${bowl ? '\nvarying float vBowl;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uNight; uniform vec3 uSunDir;${surf ? ' uniform vec3 uSurfPatch;' : ''}\nvarying vec3 vWPos;${bowl ? '\nvarying float vBowl;' : ''}\n${NOISE}\n${GROUND}\n${NIGHT_SKY_GLSL}\n${WATER_GLSL}
float wDepth; float wFoam; vec2 wSlope; float wRough;`)
      .replace('#include <color_fragment>', `
        {
          float dist = length(vViewPosition);
          // A pool laid on the ground (bowl, in metres) deepens from its rim to its middle, so it is
          // clear and dark in the middle with foam only round the edge, not white all over.
          ${bowl ? `wDepth = ${bowl.toFixed(2)} * pow(clamp(1.0 - vBowl, 0.0, 1.0), 0.6);` : depthAware ? 'wDepth = max(0.0, vWPos.y - groundAt(vWPos.xz));' : 'wDepth = 6.0;'}
          // The surface. Very shallow water is held flatter by the bed.
          wSlope = seaSlope(vWPos.xz, ${scale.toFixed(1)}, ${amp.toFixed(3)}, dist) * mix(0.35, 1.0, smoothstep(0.0, 1.5, wDepth));
          vec3 shallowC = vec3(${f3(shallow)});
          vec3 deepC = vec3(${f3(deep)});
          // Light is absorbed with depth: red goes first, so deeper water turns blue-green.
          vec3 absorb = exp(-wDepth * vec3(0.9, 0.45, 0.32) * ${clarity.toFixed(3)});
          // The bed seen through the water, lit by the caustic web, refracted a little by the waves.
          vec2 bedP = vWPos.xz + wSlope * min(wDepth, 3.0) * 0.6;
          float cau = caustics(bedP) * exp(-wDepth * 0.7) * (1.0 - uNight) * (1.0 - smoothstep(30.0, 140.0, dist));
          vec3 bottom = shallowC * (0.82 + 1.5 * cau);
          vec3 col = mix(deepC, bottom, absorb);
          // Foam. At the shoreline and round rocks: lace that washes in and drains back with each
          // wave, thick at the very edge, thinning to scattered threads a little way out.
          float edge = 1.0 - smoothstep(0.0, 1.1, wDepth);
          float wash = 0.5 + 0.5 * sin(wDepth * 5.5 - uTime * 1.25 + texture(uFoamTex, vWPos.xz * 0.013).g * 7.0);
          float lace = foamLace(vWPos.xz, 7.0, vec2(uTime * 0.11, uTime * 0.07) + wSlope * 0.6);
          wFoam = ${foam.toFixed(2)} * clamp(smoothstep(0.42 - 0.3 * edge * (0.45 + 0.55 * wash), 0.75, lace) * edge * 1.2 + edge * edge * edge * 0.55, 0.0, 1.0);${surf ? `
          // Whitecaps: on the open sea the biggest crests break into short-lived patches of white.
          float cap = smoothstep(0.83, 0.97, wH) * smoothstep(4.0, 12.0, wDepth);
          wFoam = max(wFoam, cap * smoothstep(0.45, 0.8, foamLace(vWPos.xz, 11.0, vec2(uTime * 0.6, uTime * 0.2))) * 0.8);` : ''}
          wFoam *= 1.0 - smoothstep(180.0, 520.0, dist);${surf ? `
          // Where the surf is drawn over the sea, its breaking waves take over from this foam.
          if (uSurfPatch.z > 0.0) { vec2 so = abs(vWPos.xz - uSurfPatch.xy); wFoam *= smoothstep(uSurfPatch.z * 0.55, uSurfPatch.z * 0.85, max(so.x, so.y)); }` : ''}
          col = mix(col, vec3(0.9, 0.94, 0.95), wFoam);
          col += vec3(${glow.toFixed(3)}) * shallowC;
          diffuseColor.rgb = pow(col, vec3(2.2)) * 2.0;
          // At night water is dark: what shows on it is the sky it mirrors.
          diffuseColor.rgb *= 1.0 - 0.75 * uNightRefl * (1.0 - wFoam);
          // Far off, the waves are smaller than a pixel: the blur of all their slopes is a rougher
          // mirror, which spreads the sun into its long glittering path.
          wRough = roughness * 0.55 + 0.17 * smoothstep(60.0, 1400.0, dist) + 0.05 * smoothstep(8.0, 60.0, dist);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(wRough, 0.85, wFoam);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float dist = length(vViewPosition);
          vec3 nw = normalize(vec3(-wSlope.x, 1.0, -wSlope.y));
          if (uRain > 0.01) { vec2 rr = rainRings(vWPos.xz, uTime) * uRain * 0.5 * (1.0 - smoothstep(15.0, 45.0, dist)); nw = normalize(nw + vec3(-rr.x, 0.0, -rr.y)); }
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`);
    // At night the sky (aurora, moon, stars) is mirrored in the water (skyreflect.js). By day the sun
    // glows through the thin tops of waves seen against the light.
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `outgoingLight += nightMirror(normal) * (1.0 - wFoam);
      {
        vec3 vw = normalize(cameraPosition - vWPos), nw = normalize(vec3(-wSlope.x, 1.0, -wSlope.y));
        float gl = crestGlow(vw, uSunDir, nw, wH) * (1.0 - wFoam) * (1.0 - uNight);
        outgoingLight += uSunCol * vec3(0.05, 0.2, 0.17) * gl * ${surf ? '0.55' : '0.25'} * smoothstep(1.0, 6.0, wDepth);
      }
      #include <opaque_fragment>`);
  };
  return mat;
}

// A waterfall's plunge pool. The falling water hits it along the impact line and everything about
// the surface follows from that: right under the falls it boils, white and churned, aerated water
// glowing pale green beneath; rings of chop race outward and calm as they spread; foam rides out on
// the current in drifting lace that thins to scattered threads and gathers along the banks; and
// beyond the turmoil the pool is clear, dark and deep, mirroring the cliffs' shadow and the sky.
//
// The geometry carries aPI = (distance from the impact line, distance along it, distance in from
// the rim), all in metres (falls.js makePool). impact: [x0, z0, x1, z1] in the pool's own frame.
export function createPoolMaterial({ shallow = [0.2, 0.5, 0.5], deep = [0.015, 0.07, 0.085], reach = 4, boil = 2.2, depth = 3, clarity = 0.6, impact = [-2, 0, 2, 0], lip = 10 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, envMapIntensity: 1.0 });
  mat.userData.water = true;
  // Each pool has its own impact line and cliff height (uniforms), sharing one program per look.
  const key = `pool2-${[shallow, deep, reach, boil, depth, clarity].join('|')}`;
  mat.customProgramCacheKey = () => key;
  const own = { uImpact: { value: new THREE.Vector4(...impact) }, uLipH: { value: lip } };
  const f3 = (v) => v.map((c) => c.toFixed(3)).join(',');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms, nightSky, waterTex, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPI; varying vec3 vPI; varying vec3 vWPos; varying vec3 vLP; varying vec3 vCamL;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPI = aPI; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vLP = transformed; vCamL = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uNight; uniform vec3 uSunDir; uniform vec4 uImpact; uniform float uLipH;\nvarying vec3 vPI; varying vec3 vWPos; varying vec3 vLP; varying vec3 vCamL;\n${NOISE}\n${NIGHT_SKY_GLSL}\n${WATER_GLSL}
float pFoam; vec2 pSlope; float pTurb; float pRough;
// What a ray reflected off the pool sees of the cliff behind the falls: how much of it is cliff
// (x), how much of that is the falling water (y). The cliff is a wall standing on the impact
// line, as tall as the lip, running on a little to each side of the falls.
vec2 cliffSeen(vec3 R){
  if (R.y <= 0.0) return vec2(0.0);
  vec2 A = uImpact.xy, d = uImpact.zw - A; float L = max(length(d), 0.5); d /= L;
  vec2 nr = vec2(-d.y, d.x);
  float dn = dot(R.xz, nr), t = dot(A - vLP.xz, nr) / (abs(dn) > 1e-4 ? dn : 1e-4);
  if (t <= 0.0) return vec2(0.0);
  float hy = R.y * t, s = dot(vLP.xz + R.xz * t - A, d) - L * 0.5;
  float on = 1.0 - smoothstep(uLipH * 0.9, uLipH * 1.04, hy);
  on *= 1.0 - smoothstep(L * 0.5 + uLipH * 0.5, L * 0.5 + uLipH * 1.3, abs(s));
  float fall = 1.0 - smoothstep(L * 0.5 - 0.4, L * 0.5 + 0.8, abs(s));
  // Streaks in the reflected falls, running down as the real ones do.
  float st = texture(uFoamTex, vec2(s * 0.12, hy * 0.035 + uTime * 0.5)).a;
  return vec2(on, fall * (0.55 + 0.6 * st));
}`)
      .replace('#include <color_fragment>', `
        {
          float dist = length(vViewPosition);
          float dI = vPI.x, al = vPI.y, rim = vPI.z;
          float R = ${reach.toFixed(2)}, B = ${boil.toFixed(2)};
          // How violent the water is: churning in the boil under the falls, calming as it spreads.
          pTurb = exp(-dI / (R * 0.55)) + 0.6 * (1.0 - smoothstep(0.0, B * 1.1, dI));
          // Rings of chop racing outward from the impact (several trains, so they never look regular),
          // plus the churn itself, read from the wave tile flowing outward.
          float t = uTime;
          float r1 = sin(dI * 3.1 - t * 6.2 + g_n(vec2(al * 0.35, dI * 0.2)) * 4.0);
          float r2 = sin(dI * 5.3 - t * 8.1 + g_n(vec2(al * 0.6 + 4.0, dI * 0.4)) * 5.0);
          float r3 = sin(dI * 9.7 - t * 11.0 + g_n(vec2(al * 1.1 + 9.0, dI * 0.8)) * 6.0);
          float ringK = exp(-dI / (R * 1.2));
          // The slope of the rings points away from the impact line: its direction across the pool
          // is the gradient of dI, found from how dI changes across the screen.
          vec2 gx = dFdx(vWPos.xz), gy = dFdy(vWPos.xz); float ddx = dFdx(dI), ddy = dFdy(dI);
          float det = gx.x * gy.y - gx.y * gy.x;
          vec2 outward = abs(det) > 1e-7 ? (vec2(ddx * gy.y - ddy * gx.y, gx.x * ddy - gy.x * ddx) / det) : vec2(0.0);
          outward = length(outward) > 1e-4 ? normalize(outward) : vec2(0.0, 1.0);
          float ringS = (cos(dI * 3.1 - t * 6.2) * 0.5 + cos(dI * 5.3 - t * 8.1) * 0.32 * 1.7 + cos(dI * 9.7 - t * 11.0) * 0.2 * 3.1) * ringK * 0.16;
          // Churn: the wave tile at a small size, flowing outward along the current.
          vec2 flowP = vWPos.xz - outward * t * mix(0.4, 1.6, pTurb);
          vec2 churn = seaSlope(flowP, 5.5, 1.0, dist * 3.0);
          vec2 calm = seaSlope(vWPos.xz, 12.0, 0.22, dist * 2.0);
          // Far off, the churn is finer than a pixel: let it settle to its average, not sparkle.
          float near = 1.0 - smoothstep(25.0, 90.0, dist);
          pSlope = outward * ringS * near + churn * (0.05 + 0.5 * pTurb) * mix(0.45, 1.0, near) + calm * (1.0 - min(pTurb, 1.0));
          pSlope *= mix(0.4, 1.0, smoothstep(0.0, 0.8, rim)); // held flat against the bank
          // Depth: deep in the middle of the pool, shelving up to the rim.
          float wDepth = ${depth.toFixed(2)} * smoothstep(0.0, 3.5, rim);
          vec3 absorb = exp(-wDepth * vec3(0.9, 0.45, 0.32) * ${clarity.toFixed(3)});
          vec2 bedP = vWPos.xz + pSlope * min(wDepth, 2.0) * 0.6;
          float cau = caustics(bedP * 1.4) * exp(-wDepth * 0.8) * (1.0 - uNight) * (1.0 - smoothstep(25.0, 90.0, dist)) * (1.0 - min(pTurb, 1.0));
          // The bed: dark wet gravel and stones at the edge, the water's own clear colour deeper in.
          vec3 bed = mix(vec3(0.075, 0.07, 0.055) * (0.8 + 0.4 * texture(uFoamTex, vWPos.xz * 0.35).g), vec3(${f3(shallow)}), smoothstep(0.2, 2.5, rim));
          vec3 col = mix(vec3(${f3(deep)}), bed * (0.8 + 1.4 * cau), absorb);
          // Air churned into the water near the falls scatters light: pale green-white below the
          // surface, fading out as the bubbles rise and the water clears.
          float aer = clamp(pTurb * 0.8 + exp(-dI / (R * 1.6)) * 0.35, 0.0, 1.0);
          col = mix(col, vec3(0.3, 0.46, 0.43), aer * 0.65);
          // Foam: the white boil, then lace drifting outward on the current, breaking up and
          // thinning, and a line of it collected along the banks.
          vec2 drift = -outward * t * 0.9;
          float lace = foamLace(vWPos.xz, 4.6, drift + vec2(al * 0.02, 0.0));
          float lace2 = foamLace(vWPos.xz + 17.0, 1.4, drift * 1.3);
          float bub = texture(uFoamTex, (vWPos.xz - outward * t * 0.6) / 0.9).b;
          float spread = exp(-dI / R);
          // The boil: heaped, churning white, ragged at its edge where it breaks into clumps.
          float bn = texture(uFoamTex, (vWPos.xz - outward * t * 1.4) / 2.6).g * 0.6 + texture(uFoamTex, (vWPos.xz + outward * t * 0.7) / 1.1 + 0.5).g * 0.4;
          float boilF = (1.0 - smoothstep(B * 0.25, B * 1.15, dI + (bn - 0.5) * B * 1.1)) * smoothstep(0.15, 0.5, lace2 * 0.5 + bn * 0.7);
          // (Thin threads far off are under a pixel: they would only sparkle, so they need more foam to show.)
          float far = smoothstep(10.0, 45.0, dist);
          float drifting = smoothstep(0.62 - 0.32 * spread + far * 0.12, 0.85 - 0.15 * spread + far * 0.08, lace) * (0.2 + 0.8 * spread);
          float bank = (1.0 - smoothstep(0.0, 0.9, rim)) * smoothstep(0.35, 0.7, lace2) * 0.8;
          pFoam = clamp(max(max(boilF, drifting), bank) + bub * spread * 0.35 * (1.0 - smoothstep(6.0, 25.0, dist)), 0.0, 1.0);
          pFoam *= 1.0 - smoothstep(160.0, 420.0, dist);
          col = mix(col, vec3(0.92, 0.95, 0.96) * (0.78 + 0.22 * bn), pFoam);
          diffuseColor.rgb = pow(col, vec3(2.2)) * mix(1.5, 2.0, pFoam);
          diffuseColor.rgb *= 1.0 - 0.75 * uNightRefl * (1.0 - pFoam);
          pRough = mix(0.035, 0.22, min(pTurb, 1.0)) + 0.08 * smoothstep(20.0, 200.0, dist);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(pRough, 0.85, pFoam);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float dist = length(vViewPosition);
          vec3 nw = normalize(vec3(-pSlope.x, 1.0, -pSlope.y));
          if (uRain > 0.01) { vec2 rr = rainRings(vWPos.xz, uTime) * uRain * 0.5 * (1.0 - smoothstep(15.0, 45.0, dist)); nw = normalize(nw + vec3(-rr.x, 0.0, -rr.y)); }
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`)
      // The cliff and the falls themselves, mirrored in the pool (the sky's light map knows only the
      // sky, so without this the pool under a dark cliff mirrored bright sky and looked like ice).
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        {
          vec3 nl = normalize(vec3(-pSlope.x, 1.0, -pSlope.y));
          vec3 R = reflect(normalize(vLP - vCamL), nl);
          vec2 cs = cliffSeen(R);
          vec3 rock = vec3(0.075, 0.08, 0.065) * (uAmbCol * 1.1 + uSunCol * 0.25);
          vec3 fallC = vec3(0.85, 0.88, 0.88) * (uAmbCol * 1.0 + uSunCol * 0.3);
          radiance = mix(radiance, mix(rock, fallC, cs.y), cs.x * (1.0 - pFoam) * (1.0 - uNight * 0.6));
        }`)
      .replace('#include <opaque_fragment>', 'outgoingLight += nightMirror(normal) * (1.0 - pFoam);\n#include <opaque_fragment>');
  };
  return mat;
}

// Flowing river: geometry carries uv = (across 0..1, metres along) and aSlope (drop per metre).
// Streaks scroll downstream, and steep stretches churn into white rapids.
//
// glacial: a milky glacial river braided over black gravel (the bridges, bridges.js). It knows
// how deep it is from the land's height map, so the gravel shows through at the edges of the bars
// and foam lines their waterlines; riffles over the shallows stand in fixed waves; and round each
// pier (piers: up to 6 of [x, z, half length along the flow, half thickness]; flow: the downstream
// direction [x, z]) the water piles up in a collar and trails a widening V of foam downstream.
// width: the strip's width in metres. Without glacial the look is exactly as before.
export function createRiverMaterial({ shallow = [0.16, 0.42, 0.44], deep = [0.02, 0.1, 0.12], speed = 2.2, glacial = false, piers = [], flow = [0, 1], width = 20 } = {}) {
  if (glacial) return glacialRiver({ shallow, deep, speed, piers, flow, width });
  // Clear river water: deep and dark in the channel, shelving to the stony bed at the banks, which
  // shows through lit by the caustic web; chop and boils carried downstream at the current's speed,
  // the water clear and mirror-like where it runs smooth, broken white where it runs steep.
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.05, metalness: 0, side: THREE.DoubleSide });
  const f3 = (v) => v.map((c) => c.toFixed(3)).join(',');
  mat.customProgramCacheKey = () => `river2-${f3(shallow)}-${f3(deep)}-${speed}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms, waterTex);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSlope; attribute float aW;\nvarying vec2 vRiv;\nvarying float vSlope; varying float vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiv = uv;\nvSlope = aSlope; vW = aW;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uNight; uniform vec3 uSunDir;\nvarying vec2 vRiv;\nvarying float vSlope; varying float vW;\n${NOISE}\n${WATER_GLSL}\nfloat rFoam; vec2 rSlope;`)
      .replace('#include <color_fragment>', `
        {
          float dist = length(vViewPosition);
          // A river leaving a pool starts under the pool's water (its first metres carry a negative
          // distance along): drawn there, its square end showed on top of the pool.
          if (vRiv.y < 0.0) discard;
          float W = max(vW, 1.0), across = abs(vRiv.x - 0.5) * 2.0;
          vec2 rc = vec2((vRiv.x - 0.5) * W, vRiv.y); // metres: across, along
          float spd = ${speed.toFixed(2)} * (1.0 + vSlope * 6.0), tf = uTime * spd;
          float rapids = smoothstep(0.04, 0.18, vSlope);
          // Chop carried downstream, drawn out a little along the current; boils welling up.
          vec3 w1 = texture(uWaveTex, vec2(rc.x, (rc.y - tf) * 0.7) / 4.5).rgb;
          vec3 w2 = texture(uWaveTex, vec2(rc.x * 1.2 + 0.37, (rc.y - tf * 1.12) * 0.8) / 1.6).rgb;
          vec2 s1 = (w1.rg * 2.0 - 1.0) * ${WAVE_SLOPE.toFixed(2)}, s2 = (w2.rg * 2.0 - 1.0) * ${WAVE_SLOPE.toFixed(2)};
          float near = 1.0 - smoothstep(30.0, 160.0, dist);
          rSlope = (s1 * 0.16 + s2 * 0.12 * near) * (1.0 + rapids * 1.6) * mix(0.35, 1.0, smoothstep(0.98, 0.6, across));
          // Depth across the channel, shallower where it runs steep.
          float depth = (1.0 - across * across) * mix(1.4, 0.6, rapids);
          vec3 absorb = exp(-depth * vec3(0.9, 0.45, 0.32) * 1.1);
          float cau = caustics(rc + rSlope * 0.5) * exp(-depth * 0.8) * (1.0 - uNight) * near;
          vec3 bed = mix(vec3(0.085, 0.078, 0.06) * (0.75 + 0.5 * texture(uFoamTex, rc * 0.3).g), vec3(${f3(shallow)}) * 0.8, smoothstep(0.95, 0.4, across));
          vec3 col = mix(vec3(${f3(deep)}) * 0.85, bed * (0.8 + 1.3 * cau), absorb);
          // Foam: white water over the steep stretches, lines of it at the banks, flecks riding the current.
          float lace = foamLace(vec2(rc.x, rc.y * 0.6), 2.2, vec2(0.0, -tf * 0.6));
          float white = smoothstep(0.7 - rapids * 0.45, 0.88 - rapids * 0.3, lace + w1.b * 0.25) * (0.15 + rapids);
          float bank = smoothstep(0.86, 1.0, across) * smoothstep(0.4, 0.7, lace) * 0.7;
          float fleck = smoothstep(0.8, 0.95, texture(uFoamTex, vec2(rc.x * 0.4, (rc.y - tf) * 0.18)).r) * 0.35 * near;
          rFoam = clamp(max(max(white, bank), fleck), 0.0, 1.0) * (1.0 - smoothstep(200.0, 500.0, dist));
          col = mix(col, vec3(0.92, 0.95, 0.96), rFoam);
          diffuseColor.rgb = pow(col, vec3(2.2)) * mix(1.6, 2.0, rFoam);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.04 + 0.1 * smoothstep(20.0, 300.0, length(vViewPosition)), 0.85, rFoam);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(normalize(vec3(-rSlope.x, 1.0, -rSlope.y)), 0.0)).xyz);`);
  };
  return mat;
}

function glacialRiver({ shallow, deep, speed, piers, flow, width }) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0, side: THREE.DoubleSide });
  const P = Array.from({ length: 6 }, (_, i) => new THREE.Vector4(...(piers[i] || [0, 0, 0, 0])));
  const uniforms = { uPier: { value: P }, uFlow: { value: new THREE.Vector2(flow[0], flow[1]).normalize() } };
  const f = (v) => v.map((c) => c.toFixed(3)).join(',');
  // Colours, width and speed are written into the shader; the piers and flow are uniforms, so the
  // bridges share one program between rivers of the same look.
  // (The classic look is lit brighter and has no haze to soften it, so its water is a shade darker.)
  const key = `river-glacial-${HD.on ? 'hd' : 'classic'}-${f(shallow)}-${f(deep)}-${speed}-${width}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRiv;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiv = uv;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform vec4 uPier[6]; uniform vec2 uFlow;\nvarying vec2 vRiv;\nvarying vec3 vWPos;\n${NOISE}\n${GROUND}\nfloat rFoam; float rH;`)
      .replace('#include <normal_pars_fragment>', `#include <normal_pars_fragment>\n${BUMP}`)
      .replace('#include <color_fragment>', `
        {
          float dist = length(vViewPosition);
          float depth = max(0.0, vWPos.y - groundAt(vWPos.xz));
          float ac = (vRiv.x - 0.5) * ${width.toFixed(1)}, al = vRiv.y, tf = uTime * ${speed.toFixed(2)};
          // Slow boils and swirls of silt, and finer streaks drawn out along the current.
          float sw = g_n(vec2(ac * 0.16, (al - tf * 0.8) * 0.05)) * 0.6 + g_n(vec2(ac * 0.43 + 3.1, (al - tf) * 0.13)) * 0.4;
          float st = g_n(vec2(ac * 0.9, (al - tf) * 0.16)) * 0.55 + g_n(vec2(ac * 2.6, (al - tf * 1.15) * 0.42)) * 0.45;
          // Milky with rock flour: brighter and browner where it runs shallow, greyer turquoise in the channels.
          vec3 col = mix(vec3(${f(shallow)}), vec3(${f(deep)}), smoothstep(0.12, 0.95, depth));
          col *= 0.88 + 0.22 * sw + 0.06 * st;
          // The black gravel shows through the last few centimetres at a bar's edge, darkened by the wet.
          col = mix(vec3(0.055, 0.055, 0.06), col, smoothstep(0.0, 0.2, depth));
          // Foam: a broken line at the waterline, white caps on the riffles over the shallows, and round the piers.
          float edge = (1.0 - smoothstep(0.02, 0.16, depth)) * smoothstep(0.3, 0.7, g_n(vec2(ac * 1.4, (al - tf) * 0.55)));
          float rif = smoothstep(0.06, 0.22, depth) * (1.0 - smoothstep(0.32, 0.6, depth));
          float riffle = rif * smoothstep(0.58, 0.8, st);
          vec2 pp = vec2(-uFlow.y, uFlow.x);
          float pf = 0.0, ph = 0.0;
          for (int i = 0; i < 6; i++) {
            vec4 P = uPier[i];
            if (P.w <= 0.0) continue;
            vec2 d = vWPos.xz - P.xy;
            float a = dot(d, uFlow), r = dot(d, pp);
            if (abs(r) > 14.0 || a < -6.0 || a > 40.0) continue;
            float dc = length(vec2(max(abs(a) - P.z, 0.0), r)) - P.w;
            // The water banks up white against the upstream nose and hugs the sides.
            float collar = 1.0 - smoothstep(0.0, a < 0.0 ? 1.5 : 0.6, dc);
            // Behind it: the two arms of a narrow V spreading downstream, and a churned trail of
            // eddies straight behind, both drawn out in streaks by the current and dying away.
            float x = max(a - P.z, 0.0), on = step(P.z, a);
            float arms = exp(-pow((abs(r) - P.w - 0.24 * x) / (0.22 + 0.035 * x), 2.0)) * exp(-x / 16.0) * on;
            float trail = (1.0 - smoothstep(P.w * 0.5, P.w * 1.4 + 0.12 * x, abs(r))) * exp(-x / 10.0) * on;
            float brk = g_n(vec2(r * 2.2, (a - tf) * 0.45)) * 0.6 + g_n(vec2(r * 5.0 + 3.0, (a - tf * 1.1) * 1.3)) * 0.4;
            float fo = max(collar, max(arms * (0.55 + 0.6 * brk), trail * smoothstep(0.3, 0.7, brk) * 1.3));
            pf = max(pf, smoothstep(0.25, 0.6, fo));
            ph += collar * 0.18 + arms * 0.06 + trail * 0.05 * brk;
          }
          pf *= smoothstep(0.04, 0.2, depth);
          // Flecks of foam riding the current, drawn out into streaks: which way it flows at a glance.
          float fleck = smoothstep(0.76, 0.88, g_n(vec2(ac * 3.6, (al - tf * 1.05) * 0.45)) * 0.65 + g_n(vec2(ac * 11.0, (al - tf * 1.05) * 1.6)) * 0.35) * smoothstep(0.15, 0.4, depth) * 0.45;
          rFoam = clamp(max(max(edge * 0.75, riffle * 0.65), max(pf, fleck)), 0.0, 1.0) * (1.0 - smoothstep(250.0, 600.0, dist));
          col = mix(col, vec3(0.86, 0.88, 0.87), rFoam);
          // Relief for the normal (metres): ripples running downstream, waves that stand still
          // over the riffles, and the swell round each pier.
          float stand = sin(al * 2.3 + g_n(vec2(ac * 0.35, al * 0.08)) * 6.0) * 0.5 + 0.5;
          // Boils welling up from the bed and churning chop: the river never lies flat like a lake.
          float boil = g_n(vec2(ac * 0.3 + 7.0, (al - tf * 0.7) * 0.3 + uTime * 0.05));
          rH = st * 0.05 + sw * 0.08 + boil * 0.07 + stand * rif * 0.11 + ph + g_n(vec2(ac * 4.0, (al - tf * 1.3) * 2.2)) * 0.018 + g_n(vec2(ac * 9.0, (al - tf * 1.4) * 5.0)) * 0.006;
          diffuseColor.rgb = pow(col, vec3(2.2)) * mix(${HD.on ? '1.0' : '0.6'}, 1.6, rFoam);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.13, 0.8, rFoam);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumpNormal(normal, rH * (1.0 - smoothstep(40.0, 260.0, length(vViewPosition))), 1.0);');
  };
  return mat;
}

// Build a river strip along points [{x, y, z}], width w. Adds uv and slope for the shader.
// start: metres at the head of the strip that are not drawn (a river leaving a pool begins inside it).
export function riverGeometry(points, w, start = 0) {
  const pos = [], uv = [], slope = [], idx = [];
  let dist = -start;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    if (i > 0) dist += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    const drop = Math.max(0, (a.y - b.y) / L);
    const p = points[i];
    pos.push(p.x + nx * w / 2, p.y, p.z + nz * w / 2, p.x - nx * w / 2, p.y, p.z - nz * w / 2);
    uv.push(0, dist, 1, dist);
    slope.push(drop, drop);
    if (i < points.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSlope', new THREE.Float32BufferAttribute(slope, 1));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(new Float32Array(slope.length).fill(w), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
