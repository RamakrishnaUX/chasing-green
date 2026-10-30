import * as THREE from 'three';
import { HD, HD_TERRAIN, HD_SUN_SHADOW, terrainUniforms, terrainShadowChunk } from './hd.js';

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
};

export const NOISE = /* glsl */ `
float g_h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float g_n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(g_h(i), g_h(i+vec2(1,0)), u.x), mix(g_h(i+vec2(0,1)), g_h(i+vec2(1,1)), u.x), u.y); }
float g_f(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*g_n(p); p = p*2.07 + 13.7; a *= 0.5; } return s; }
`;

// Colours below are written in sRGB (as you would pick them from a photo) and converted at the end.
// The function also returns a bump height and a roughness, so lighting picks up grass streaks,
// rock layers and smooth snow.
const TERRAIN_COLOR = /* glsl */ `
float tBump; float tRough; float tSpark;
// Layer weights, read by the realistic (desktop) shader to blend its scanned textures.
float tEarthW; float tRockW; float tSnowW; float tLavaW;
vec3 terrainColor(vec3 masks, vec3 p, vec3 nrm, float dist){
  float slope = 1.0 - clamp(nrm.y, 0.0, 1.0);
  float nL = g_f(p.xz * 0.006);
  float nM = g_f(p.xz * 0.035);
  float detail = 1.0 - smoothstep(20.0, 75.0, dist);
  // Fine noise fades out with distance so far slopes stay clean instead of shimmering.
  float lod = 1.0 - smoothstep(50.0, 220.0, dist);
  float nF = mix(0.5, g_n(p.xz * 0.6) * 0.6 + g_n(p.xz * 2.1) * 0.4, lod);
  // Grass: pale gold, straw and rust in the cold months, with olive and moss mixed in.
  vec3 pale = vec3(0.84, 0.72, 0.48), straw = vec3(0.74, 0.6, 0.36), rust = vec3(0.7, 0.47, 0.25);
  vec3 olive = vec3(0.47, 0.44, 0.23), moss = vec3(0.40, 0.45, 0.22);
  vec3 grassW = mix(straw, pale, smoothstep(0.35, 0.7, nM));
  grassW = mix(grassW, rust, smoothstep(0.6, 0.85, nL) * 0.4);
  grassW = mix(grassW, olive, smoothstep(0.6, 0.85, g_f(p.xz * 0.012 + 7.0)) * 0.6);
  vec3 grassS = mix(vec3(0.33, 0.45, 0.17), vec3(0.47, 0.55, 0.24), smoothstep(0.3, 0.7, nM));
  grassS = mix(grassS, olive, smoothstep(0.6, 0.85, nL) * 0.5);
  vec3 col = mix(grassW, grassS, uSummer);
  // Hay fields: bright green patches on the lowland near farms and roads.
  float field = smoothstep(0.62, 0.66, g_f(p.xz * 0.0045 + 3.3)) * (1.0 - smoothstep(9.0, 16.0, p.y)) * (1.0 - smoothstep(0.06, 0.14, slope));
  col = mix(col, mix(vec3(0.36, 0.55, 0.18), vec3(0.45, 0.62, 0.22), nF), field * (0.55 + 0.4 * uSummer));
  // Streaky grass texture up close.
  float streak = mix(0.5, g_n(vec2(p.x * 1.6, p.z * 0.35) + nF) * 0.5 + g_n(vec2(p.x * 0.35, p.z * 1.6) - nF) * 0.5, detail);
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
      .replace('#include <common>', `#include <common>\nuniform float uSnowLine; uniform float uSummer; uniform float uCloudCover; uniform vec2 uCloudOffset; uniform vec3 uSunDir; uniform float uSunUp; uniform vec3 uRhyolite;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n${NOISE}\n${TERRAIN_COLOR}\n${hd ? HD_TERRAIN + HD_SUN_SHADOW : ''}`)
      .replace('#include <lights_fragment_end>', hd ? terrainShadowChunk() : '#include <lights_fragment_end>')
      .replace('#include <normal_pars_fragment>', `#include <normal_pars_fragment>\n${BUMP}`)
      .replace('#include <color_fragment>', hd
        ? 'vec3 tCol = terrainColor(vColor, vWPos, normalize(vWNrm), length(vViewPosition));\nhdDetail(vColor, vWPos, normalize(vWNrm), length(vViewPosition));\ndiffuseColor.rgb = tCol * hdA * cloudShade(vWPos);'
        : 'diffuseColor.rgb = terrainColor(vColor, vWPos, normalize(vWNrm), length(vViewPosition)) * cloudShade(vWPos);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * tSpark * uSunUp * 1.5;')
      .replace('#include <roughnessmap_fragment>', hd ? 'float roughnessFactor = hdR;' : 'float roughnessFactor = tRough;')
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
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  const hd = HD.on;
  if (hd) mat.customProgramCacheKey = () => `road-hd-${paved}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms);
    // Desktop: real asphalt and gravel under the painted lines, as light and shade on the classic colours.
    if (hd) Object.assign(shader.uniforms, { rdAlb: { value: HD.road.asphalt.alb }, rdMean: { value: HD.road.asphalt.mean }, grAlb: { value: HD.road.gravel.alb }, grMean: { value: HD.road.gravel.mean } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad;\nattribute float aJunction;\nvarying vec2 vRoad;\nvarying float vJ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;\nvJ = aJunction;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vRoad;\nvarying float vJ;\nuniform float uSummer;\n${NOISE}\nfloat rBump; float rRough;${hd ? `\nuniform sampler2D rdAlb; uniform vec3 rdMean; uniform sampler2D grAlb; uniform vec3 grMean;\nvec3 rdRatio(sampler2D t, vec3 m, vec2 uv, float chroma, out float lum){ vec3 a = texture2D(t, uv).rgb; lum = dot(a, vec3(0.2126, 0.7152, 0.0722)) / max(dot(m, vec3(0.2126, 0.7152, 0.0722)), 1e-3); return clamp(mix(vec3(lum), a / max(m, vec3(1e-3)), chroma), 0.0, 2.5); }` : ''}`)
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
        vec3 asphalt = mix(vec3(0.2, 0.2, 0.21), vec3(0.3, 0.3, 0.31), mix(0.5, grain, 0.35 + 0.65 * fine));
        float track = smoothstep(0.7, 0.0, abs(lat - hw * 0.5));
        asphalt *= 0.92 + 0.1 * patchy - track * 0.05;
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
        diffuseColor.rgb = pow(c, vec3(2.2));${hd ? `
        float hdFade = 1.0 - smoothstep(120.0, 420.0, dist), lA, lG;
        vec3 ra = rdRatio(${paved ? 'rdAlb, rdMean, vRoad / 3.5, 0.0' : 'grAlb, grMean, vRoad / 4.0, 0.2'}, lA);
        vec3 rg = rdRatio(grAlb, grMean, vRoad / 4.0, 0.2, lG);
        diffuseColor.rgb *= mix(vec3(1.0), mix(ra, rg, shoulder), (1.0 - hdPaint) * hdFade);
        rBump += (mix(lA, lG, shoulder) - 1.0) * 0.035 * fine;` : ''}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumpNormal(normal, rBump, 1.0);');
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

// Water that knows how deep it is: shallow turquoise over sand and rock, deep blue further out,
// moving caustic light in the shallows, foam where it meets the shore, sky reflections on top.
export function createWaterMaterial(color, {
  roughness = 0.08, ripple = 1, shallow = [0.2, 0.46, 0.45], deep = [0.012, 0.05, 0.075],
  clarity = 0.55, foam = 1, depthAware = true, glow = 0,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMapIntensity: 1.0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uNight;\nvarying vec3 vWPos;\n${NOISE}\n${GROUND}
float wv(vec2 p){ return g_n(p * 0.09 + vec2(uTime * 0.04, uTime * 0.025)) * 0.6 + g_n(p * 0.37 - vec2(uTime * 0.11, -uTime * 0.07)) * 0.3 + g_n(p * 1.3 + uTime * 0.2) * 0.1; }
float caustic(vec2 p){
  vec2 q = p * 0.55 + vec2(uTime * 0.12, uTime * 0.08);
  float a = abs(g_n(q) - 0.5) + abs(g_n(q * 1.7 + 3.1 - uTime * 0.07) - 0.5);
  return pow(clamp(1.0 - a * 2.2, 0.0, 1.0), 4.0);
}
float wDepth; float wFoam;`)
      .replace('#include <color_fragment>', `
        {
          float dist = length(vViewPosition);
          ${depthAware ? 'wDepth = max(0.0, vWPos.y - groundAt(vWPos.xz));' : 'wDepth = 6.0;'}
          vec3 shallowC = vec3(${shallow.map((v) => v.toFixed(3)).join(',')});
          vec3 deepC = vec3(${deep.map((v) => v.toFixed(3)).join(',')});
          // Light is absorbed with depth: red goes first, so deeper water turns blue.
          vec3 absorb = exp(-wDepth * vec3(0.9, 0.45, 0.32) * ${clarity.toFixed(3)});
          vec3 bottom = shallowC * (1.0 + 1.4 * caustic(vWPos.xz) * exp(-wDepth * 0.9) * (1.0 - uNight));
          vec3 col = mix(deepC, bottom, absorb);
          // Foam: bands that wash in at the shoreline and around rocks, breaking up with noise.
          float edge = 1.0 - smoothstep(0.0, 0.9, wDepth);
          float bands = 0.5 + 0.5 * sin(wDepth * 9.0 - uTime * 1.6 + g_n(vWPos.xz * 0.3) * 6.0);
          float brk = smoothstep(0.35, 0.75, g_n(vWPos.xz * 1.1 + uTime * 0.15));
          wFoam = ${foam.toFixed(2)} * clamp(edge * (0.55 + 0.45 * bands) * mix(0.5, 1.0, brk) + edge * edge * 0.6, 0.0, 1.0);
          wFoam *= 1.0 - smoothstep(150.0, 450.0, dist);
          col = mix(col, vec3(0.92, 0.95, 0.96), wFoam);
          col += vec3(${glow.toFixed(3)}) * shallowC;
          diffuseColor.rgb = pow(col, vec3(2.2)) * 2.2;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.9, wFoam);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float dist = length(vViewPosition);
          float k = ${ripple.toFixed(2)} * 2.2 * (1.0 - smoothstep(40.0, 700.0, dist)) + 0.15;
          float e = 0.35;
          float h0 = wv(vWPos.xz), hx = wv(vWPos.xz + vec2(e, 0.0)), hz = wv(vWPos.xz + vec2(0.0, e));
          vec3 nw = normalize(vec3(-(hx - h0) / e * k, 1.0, -(hz - h0) / e * k));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`);
  };
  return mat;
}

// Flowing river: geometry carries uv = (across 0..1, metres along) and aSlope (drop per metre).
// Streaks scroll downstream, and steep stretches churn into white rapids.
export function createRiverMaterial({ shallow = [0.16, 0.42, 0.44], deep = [0.02, 0.1, 0.12], speed = 2.2 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSlope;\nvarying vec2 vRiv;\nvarying float vSlope;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiv = uv;\nvSlope = aSlope;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec2 vRiv;\nvarying float vSlope;\n${NOISE}\nfloat rFoam;`)
      .replace('#include <color_fragment>', `
        {
          float across = abs(vRiv.x - 0.5) * 2.0;
          float spd = ${speed.toFixed(2)} * (1.0 + vSlope * 6.0);
          vec2 q = vec2(vRiv.x * 6.0, vRiv.y * 0.35 - uTime * spd);
          float streak = g_n(vec2(q.x * 2.0, q.y)) * 0.6 + g_n(vec2(q.x * 5.0, q.y * 2.5)) * 0.4;
          vec3 col = mix(vec3(${deep.join(',')}), vec3(${shallow.join(',')}), across * 0.8 + streak * 0.25);
          float rapids = smoothstep(0.04, 0.18, vSlope);
          rFoam = clamp(smoothstep(0.62 - rapids * 0.45, 0.85 - rapids * 0.3, streak) * (0.35 + rapids) + smoothstep(0.8, 1.0, across) * 0.5, 0.0, 1.0);
          col = mix(col, vec3(0.93, 0.96, 0.97), rFoam);
          diffuseColor.rgb = pow(col, vec3(2.2)) * 2.2;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.1, 0.85, rFoam);');
  };
  return mat;
}

// Build a river strip along points [{x, y, z}], width w. Adds uv and slope for the shader.
export function riverGeometry(points, w) {
  const pos = [], uv = [], slope = [], idx = [];
  let dist = 0;
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
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
