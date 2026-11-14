import * as THREE from 'three';
import { SKY_LAYER } from './skyreflect.js';
import { Sky as ScatterSky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, smoothstep } from './noise.js';
import { HD } from './hd.js';

export const GLSL_NOISE = /* glsl */ `
// smoothstep, defined for edges in either order (GLSL leaves edge0 >= edge1 undefined; on Apple GPUs
// it came out as dark seams across the sky).
float sstep(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm2(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
// A colour by the sun's elevation, keyed at 10, 4, 0.5, -2, -5 and -10 degrees.
vec3 elRamp(float e, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5){
  vec3 c = c0;
  c = mix(c, c1, sstep(10.0, 4.0, e)); c = mix(c, c2, sstep(4.0, 0.5, e)); c = mix(c, c3, sstep(0.5, -2.0, e));
  c = mix(c, c4, sstep(-2.0, -5.0, e)); c = mix(c, c5, sstep(-5.0, -10.0, e));
  return c;
}
`;

// Sky palette, shared by the sky shader and the fog so the horizon and distant hills always match.
// Values are display (sRGB) colours.
const PAL = {
  dayZen: [0.17, 0.36, 0.64], dayMid: [0.4, 0.6, 0.82], dayHor: [0.8, 0.86, 0.9],
  twZen: [0.24, 0.27, 0.44], twHor: [0.86, 0.63, 0.7], twSun: [1.0, 0.56, 0.44],
  goldSun: [1.0, 0.8, 0.52],
  nightZen: [0.01, 0.018, 0.04], nightHor: [0.05, 0.08, 0.125],
};
const v3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uMoonLit; uniform float uMoonIllum; uniform float uDark; uniform float uTime; uniform float uSunEl;
uniform vec3 uCityDir; uniform float uCityGlow; uniform float uCityOverhead; uniform float uCloud;
uniform vec3 uAuroraTint; uniform float uAurora; uniform float uOverlay;
varying vec3 vDir;
${GLSL_NOISE}
void main(){
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  float hor = pow(1.0 - y, 4.0);
  float el = uSunEl;
  float sunF = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  // A low sun, as it really goes: by golden hour the horizon under the sun turns gold, then
  // orange, and at sunset a fiery red-orange band, with a peach glow above it fading through a
  // hint of green-cyan into deepening blue. Opposite the sun the horizon blushes pink, and as the
  // sun goes down the Earth's shadow rises there as a blue-grey band under the pink belt of Venus.
  // Above 10 degrees the physical sky (Preetham) shows instead; this blends in below 12.
  float s = dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5));
  float side = sstep(-0.35, 1.0, s); side *= side;
  vec3 Z  = elRamp(el, vec3(0.2, 0.38, 0.66), vec3(0.22, 0.36, 0.62), vec3(0.2, 0.3, 0.56), vec3(0.15, 0.22, 0.46), vec3(0.07, 0.11, 0.28), vec3(0.02, 0.035, 0.09));
  vec3 HS = elRamp(el, vec3(0.95, 0.88, 0.74), vec3(1.0, 0.72, 0.42), vec3(1.0, 0.47, 0.15), vec3(0.95, 0.31, 0.1), vec3(0.62, 0.2, 0.14), vec3(0.12, 0.08, 0.12));
  vec3 GS = elRamp(el, vec3(0.88, 0.88, 0.82), vec3(1.0, 0.83, 0.57), vec3(1.0, 0.7, 0.42), vec3(0.98, 0.62, 0.42), vec3(0.6, 0.42, 0.45), vec3(0.1, 0.08, 0.15));
  vec3 HA = elRamp(el, vec3(0.78, 0.84, 0.9), vec3(0.84, 0.79, 0.8), vec3(0.86, 0.67, 0.68), vec3(0.78, 0.55, 0.63), vec3(0.4, 0.36, 0.5), vec3(0.07, 0.09, 0.15));
  vec3 GA = elRamp(el, vec3(0.6, 0.72, 0.86), vec3(0.58, 0.66, 0.82), vec3(0.6, 0.58, 0.74), vec3(0.5, 0.48, 0.66), vec3(0.24, 0.26, 0.42), vec3(0.04, 0.06, 0.12));
  vec3 horC = mix(HA, HS, side), glow = mix(GA, GS, side);
  vec3 col = mix(glow, Z, sstep(0.04, 0.62, y));
  col = mix(col, horC, exp(-y * 13.0));
  // A thin greenish band where the warm glow meets the blue, just after sunset.
  col = mix(col, vec3(0.56, 0.74, 0.72), sstep(0.5, -2.5, el) * sstep(-9.0, -4.0, el) * side * exp(-pow((y - 0.28) / 0.1, 2.0)) * 0.22);
  // Earth's shadow and the belt of Venus, opposite the sun from just before sunset to dusk.
  float shW = sstep(1.0, -1.0, el) * sstep(-8.0, -4.5, el), anti = sstep(0.1, -0.7, s);
  float shH = 0.012 + clamp(-el, 0.0, 6.0) * 0.012;
  col = mix(col, vec3(0.3, 0.34, 0.5), anti * shW * (1.0 - sstep(shH * 0.5, shH, y)) * 0.8);
  col = mix(col, vec3(0.9, 0.6, 0.66), anti * shW * exp(-pow((y - shH * 1.7) / (shH + 0.02), 2.0)) * 0.55);
  vec3 night = mix(${v3(PAL.nightZen)}, ${v3(PAL.nightHor)}, hor);
  col = mix(col, night, sstep(-5.0, -11.0, el));
  // Sun disk and its glow, both reddening as it nears the horizon; the glow lingers after it sets.
  float sd = dot(d, uSunDir);
  vec3 disk = elRamp(el, vec3(1.0, 0.93, 0.8), vec3(1.0, 0.8, 0.55), vec3(1.0, 0.56, 0.26), vec3(1.0, 0.4, 0.16), vec3(0.8, 0.3, 0.15), vec3(0.0));
  vec3 aure = elRamp(el, vec3(1.0, 0.86, 0.66), vec3(1.0, 0.7, 0.42), vec3(1.0, 0.5, 0.2), vec3(0.95, 0.38, 0.14), vec3(0.5, 0.2, 0.12), vec3(0.0));
  col += disk * sstep(0.9993, 0.9997, sd) * (1.0 - uDark) * sstep(-1.0, 0.3, el);
  col += aure * (pow(max(sd, 0.0), 10.0) * 0.32 + pow(max(sd, 0.0), 90.0) * 0.5) * sstep(-9.0, -1.0, el) * (1.0 - uDark * 0.6);
  // City light pollution.
  float cityFacing = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), uCityDir), 0.0), 5.0);
  vec3 glowCol = vec3(0.55, 0.36, 0.2);
  col += glowCol * uCityGlow * cityFacing * exp(-y * 9.0) * uDark * 0.35;
  col += glowCol * uCityOverhead * (0.12 + 0.2 * hor) * uDark * 0.5;
  // Stars.
  vec3 sp = d * 380.0; vec3 cell = floor(sp); float h = hash13(cell);
  float star = 0.0;
  if (h > 0.9965) {
    vec3 c = cell + 0.5 + (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 5.1)) - 0.5) * 0.6;
    float dist = length(sp - c);
    float twk = 0.7 + 0.3 * sin(uTime * (1.5 + h * 30.0) + h * 100.0);
    star = sstep(0.35, 0.0, dist) * twk * (0.4 + 2.5 * (h - 0.9965) / 0.0035);
  }
  // A bright moon up in the sky drowns the fainter stars.
  float moonUp = sstep(-0.05, 0.12, uMoonDir.y) * uMoonIllum * uMoonIllum;
  float starVis = uDark * (1.0 - uCloud * 0.9) * (1.0 - uCityOverhead * 0.85) * sstep(0.0, 0.12, y) * (1.0 - moonUp * 0.6);
  col += vec3(0.85, 0.9, 1.0) * star * starVis;
  col += vec3(0.05, 0.06, 0.08) * fbm2(d.xz / (y + 0.3) * 3.0) * uDark * (1.0 - uCloud) * 0.5;
  // Moon.
  // Moon: a sphere lit from the sun's side (uMoonLit), so it shows its phase, with darker seas
  // on its face and the dark part just visible by earthshine. The glow round it grows with the phase.
  float md = dot(d, uMoonDir);
  if (md > 0.9995) {
    vec3 mU = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), mV = cross(mU, uMoonDir);
    vec2 q = vec2(dot(d, mU), dot(d, mV)) / 0.0265;
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      vec3 n = q.x * mU + q.y * mV - sqrt(1.0 - r2) * uMoonDir;
      float lit = sstep(-0.06, 0.08, dot(n, uMoonLit));
      float seas = 0.78 + 0.22 * sstep(0.35, 0.65, vnoise(q * 2.3 + 4.0));
      float edge = sstep(1.0, 0.9, r2);
      // Only the lit part covers the sky; the dark part keeps the sky's colour, faintly lifted by earthshine.
      col = mix(col, vec3(0.9, 0.91, 0.92) * seas * (1.0 - uCloud * 0.8), edge * lit) + vec3(0.02, 0.025, 0.03) * edge * (1.0 - lit) * uDark;
    }
  }
  col += vec3(0.25, 0.3, 0.4) * pow(max(md, 0.0), 30.0) * 0.3 * uDark * (1.0 - uCloud * 0.6) * (0.15 + 0.85 * uMoonIllum);
  col += uAuroraTint * uAurora * hor * 0.05;
  gl_FragColor = vec4(col, uOverlay);
}`;

const CLOUD_FRAG = /* glsl */ `
uniform float uCloud; uniform float uDark; uniform vec2 uOffset; uniform vec3 uCam; uniform vec3 uSunDir; uniform float uSunEl;
uniform float uCityOverhead; uniform vec3 uAuroraTint; uniform float uAurora; uniform float uTime; uniform vec2 uWind;
varying vec3 vDir;
${GLSL_NOISE}
#ifdef HD_CLOUDS
// Realistic look (desktop): a cloud layer with depth. March through a slab between two heights,
// shading each sample by how much cloud lies toward the sun (Beer-Lambert), with a soft powder
// darkening on thin edges and forward scattering when looking toward the sun.
float fbm3(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<3;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
// Cellular noise (distance to the nearest random point): round cells that read as cloud puffs.
float worley(vec2 p){
  vec2 i = floor(p), f = fract(p); float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash12(i + g), hash12(i + g + 19.7));
    d = min(d, length(g + o - f));
  }
  return d;
}
float cDens(vec3 q, float cov, bool fine){
  float hf = (q.y - 420.0) / 380.0;
  if (hf < 0.0 || hf > 1.0) return 0.0;
  vec2 p = q.xz + uOffset;
  // Warp the field so cells bunch into ragged groups instead of a grid.
  vec2 w = p + (vec2(vnoise(p * 0.0021), vnoise(p * 0.0021 + 5.2)) - 0.5) * 420.0;
  float big = 1.0 - worley(w * 0.0034);
  float lumps = fine ? 1.0 - worley(w * 0.0095 + 3.1) : 0.5;
  float field = fbm3(w * 0.0011);
  float n = field * 0.55 + big * 0.33 + lumps * 0.12;
  // Flat bases; tops rounded and taller where a cell is thick.
  float prof = sstep(0.0, 0.1, hf) * sstep(0.35 + 0.6 * big, 0.15 + 0.3 * big, hf);
  float dd = sstep(1.0 - cov - 0.06, 1.0 - cov + 0.22, n);
  if (fine) dd -= vnoise(p * 0.06 + hf * 3.0) * 0.28 * (1.0 - dd);
  return clamp(dd, 0.0, 1.0) * prof;
}
vec4 volClouds(vec3 d, float cov, vec3 sunCol, vec3 ambCol){
  // The march is for a deck seen from below. From inside it or above (in the helicopter, under a
  // parachute) it came out as dark seams across the sky: there the flat layer is drawn instead.
  // (Below 0.06 the flat layer takes over outright, so the march would be thrown away.)
  if (cov < 0.03 || d.y < 0.06 || uCam.y > 420.0) return vec4(0.0);
  float t0 = (420.0 - uCam.y) / d.y, t1 = min((800.0 - uCam.y) / d.y, t0 + 1300.0);
  if (t0 < 0.0) t0 = 0.0;
#ifdef PANO
  // The panorama is drawn a slice at a time, so it can afford more steps and needs no dither
  // (a dither per texel would be stretched over many screen pixels into streaks).
  const int N = 20;
  float jit = 0.5;
#else
  const int N = 12;
  // Interleaved gradient noise: a dither that hides banding with far less visible grain than white noise.
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
#endif
  float dt = (t1 - t0) / float(N);
  float mu = dot(d, uSunDir);
  float phase = 0.55 + 1.6 * pow(max(mu, 0.0), 8.0);
  float T = 1.0; vec3 L = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = uCam + d * (t0 + (float(i) + jit) * dt);
    float den = cDens(q, cov, true);
    if (den < 0.01) continue;
    float ld = den < 0.05 ? den : cDens(q + uSunDir * 45.0, cov, false) + cDens(q + uSunDir * 120.0, cov, false);
    float sunT = exp(-ld * 1.6);
    float powder = 1.0 - exp(-den * 3.0);
    vec3 lit = sunCol * sunT * phase * (0.45 + 0.55 * powder) + ambCol * (0.55 + 0.45 * (1.0 - den));
    float a = 1.0 - exp(-den * dt * 0.016);
    L += T * a * lit;
    T *= 1.0 - a;
    if (T < 0.03) break;
  }
  float alpha = 1.0 - T;
  return vec4(L / max(alpha, 1e-3), alpha);
}
#endif
vec4 cloudAt(vec3 d){
  if (d.y < 0.0) return vec4(0.0);
  float horizonFade = sstep(0.0, 0.09, d.y);
  vec2 p = uCam.xz + d.xz / max(d.y, 0.04) * 420.0 + uOffset;
  // Weather clouds, driven by the simulation's local cover.
  float n = fbm2(p * 0.0045) * 0.75 + fbm2(p * 0.018 + uTime * 0.01) * 0.25;
  float cov = clamp(uCloud, 0.0, 1.0);
  float dens = sstep(1.0 - cov - 0.1, 1.0 - cov + 0.25, n) * horizonFade;
  // Light the cloud: sample again a little toward the sun. Thicker cloud between this point and
  // the sun means a darker, bluer underside; thin edges facing the sun glow.
  vec2 toSun = normalize(uSunDir.xz + vec2(1e-4));
  float n2 = fbm2((p + toSun * 38.0) * 0.0045) * 0.75 + fbm2((p + toSun * 38.0) * 0.018 + uTime * 0.01) * 0.25;
  float occl = sstep(1.0 - cov - 0.1, 1.0 - cov + 0.25, n2);
  float shade = 1.0 - 0.55 * occl;
  float lining = pow(max(dot(d, uSunDir), 0.0), 6.0) * (1.0 - dens) * 1.4;
  // High cirrus: long wind-combed streaks, mostly for looks.
  vec2 q = vec2(dot(p, uWind), dot(p, vec2(-uWind.y, uWind.x)));
  vec2 pc = uCam.xz + d.xz / max(d.y, 0.04) * 900.0 + uOffset * 1.6;
  vec2 qc = vec2(dot(pc, uWind), dot(pc, vec2(-uWind.y, uWind.x)));
  float streak = fbm2(vec2(qc.x * 0.0016, qc.y * 0.0062));
  float wisp = sstep(0.56, 0.8, streak) * (0.55 + 0.45 * vnoise(qc * 0.012)) * horizonFade;
  float el = uSunEl;
  float sunF = pow(max(dot(d, uSunDir), 0.0), 3.0);
  float golden = sstep(16.0, 1.0, el) * sstep(-4.0, 0.0, el);
  float wTw = sstep(-10.0, -3.0, el) * sstep(6.0, 0.0, el);
  float wNight = sstep(-5.0, -11.0, el);
  // Lit tops and grey bellies by day, gold near a low sun, pink at twilight.
  vec3 dayCol = mix(vec3(0.62, 0.66, 0.74), vec3(1.0, 0.99, 0.97), shade) * (1.0 - dens * 0.18) + vec3(1.0, 0.9, 0.75) * lining;
  dayCol *= mix(vec3(1.0), vec3(1.0, 0.8, 0.6), golden * (0.35 + 0.65 * sunF));
  // Low sun: undersides lit gold, then orange, then crimson and pink and last violet as the sun
  // sinks, hottest toward the sun; the side away from it stays cool lilac-grey.
  vec3 litC = elRamp(el, vec3(1.0, 0.95, 0.88), vec3(1.0, 0.76, 0.48), vec3(1.0, 0.5, 0.24), vec3(0.96, 0.34, 0.3), vec3(0.72, 0.3, 0.46), vec3(0.22, 0.18, 0.28));
  vec3 shadC = elRamp(el, vec3(0.62, 0.66, 0.74), vec3(0.56, 0.52, 0.6), vec3(0.46, 0.38, 0.48), vec3(0.4, 0.3, 0.44), vec3(0.24, 0.21, 0.34), vec3(0.05, 0.06, 0.09));
  float toward = pow(max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)), 0.0) * 0.5 + 0.5, 2.0);
  // Under a full deck the low sun only reaches the cloud near the horizon on its own side; broken
  // cloud catches it everywhere.
  float reach = mix(1.0, exp(-d.y * 5.0) * toward, clamp(cov * 1.3 - 0.2, 0.0, 1.0));
  vec3 twCol = mix(shadC, litC, clamp((toward * (0.55 + 0.45 * shade) + sunF * 0.4) * reach, 0.0, 1.0)) * (1.0 - dens * 0.25);
  float lowW = sstep(12.0, 3.0, el) * (1.0 - sstep(-6.0, -11.0, el));
  vec3 nightCol = vec3(0.035, 0.045, 0.06) + vec3(0.18, 0.12, 0.07) * uCityOverhead + uAuroraTint * uAurora * 0.04;
  vec3 col = mix(dayCol, twCol, lowW);
  col = mix(col, nightCol, wNight);
  float a = max(dens * 0.95, wisp * 0.6 * (1.0 - wNight * 0.85) * (1.0 - dens));
#ifdef HD_CLOUDS
  vec3 sunCol = mix(vec3(1.0, 0.97, 0.92), litC, lowW);
  vec4 v = volClouds(d, cov, sunCol * 1.15, mix(vec3(0.5, 0.56, 0.66), shadC, lowW));
  vec3 vcol = mix(v.rgb, twCol, lowW * 0.55);
  vcol = mix(vcol, nightCol, wNight);
  // Low in the sky the march grows too long for its steps, so hand over to the flat layer.
  float vw = sstep(0.06, 0.22, d.y) * (1.0 - sstep(370.0, 420.0, uCam.y)); // and hand over as you climb into the deck
  vcol = mix(col, vcol, vw);
  float va = mix(dens * 0.95, v.a * horizonFade, vw);
  // High streaky cirrus only shows in fair weather; under real cloud it reads as smears.
  float wa = wisp * 0.6 * (1.0 - wNight * 0.85) * (1.0 - va) * (1.0 - sstep(0.25, 0.55, cov));
  col = (vcol * va + col * wa) / max(va + wa, 1e-3);
  a = va + wa;
#endif
  return vec4(col, clamp(a, 0.0, 0.97));
}
#ifdef PANO
// Writing the cloud panorama: x is the compass direction, y the square root of the height above
// the horizon, so more of the texture goes to the low sky where clouds are seen edge-on.
varying vec2 vUv;
void main(){
  float az = vUv.x * 6.2831853, y = vUv.y * vUv.y, r = sqrt(max(1.0 - y * y, 0.0));
  vec4 c = cloudAt(vec3(r * sin(az), y, r * cos(az)));
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}
#elif defined(USE_PANO)
uniform sampler2D uPano;
void main(){
  vec3 d = normalize(vDir);
  if (d.y < 0.0) discard;
  float az = atan(d.x, d.z) / 6.2831853;
  vec4 c = texture2D(uPano, vec2(az < 0.0 ? az + 1.0 : az, sqrt(d.y)));
  gl_FragColor = vec4(c.rgb / max(c.a, 1e-3), c.a);
}
#else
void main(){
  vec4 c = cloudAt(normalize(vDir));
  if (c.a <= 0.0 && vDir.y < 0.0) discard;
  gl_FragColor = c;
}
#endif`;

const PANO_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vDir;
void main(){ vUv = uv; vDir = vec3(0.0); gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`;

const sm = (e0, e1, x) => smoothstep(e0, e1, x);
const mixA = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Horizon colour away from the sun, matching the sky shader. Used for fog.
const ramp6 = (e, c) => {
  let r = c[0];
  for (const [k, e0, e1] of [[1, 10, 4], [2, 4, 0.5], [3, 0.5, -2], [4, -2, -5], [5, -5, -10]]) r = mixA(r, c[k], sm(e0, e1, e));
  return r;
};
// The horizon's colour all round (fog takes it, so distant hills fade into the sunset): mostly
// the side away from the sun, warmed a little toward the sun side's glow.
const HOR_ANTI = [[0.78, 0.84, 0.9], [0.84, 0.79, 0.8], [0.86, 0.67, 0.68], [0.78, 0.55, 0.63], [0.4, 0.36, 0.5], [0.07, 0.09, 0.15]];
const HOR_SUN = [[0.95, 0.88, 0.74], [1.0, 0.72, 0.42], [1.0, 0.47, 0.15], [0.95, 0.31, 0.1], [0.62, 0.2, 0.14], [0.12, 0.08, 0.12]];
function horizonColor(el) {
  const low = mixA(ramp6(el, HOR_ANTI), ramp6(el, HOR_SUN), 0.28);
  let c = mixA(PAL.dayHor, low, sm(14, 6, el));
  c = mixA(c, PAL.nightHor, sm(-5, -11, el));
  return c;
}

export class Sky {
  constructor(scene, { shadowSize = 0, renderer = null } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    // Daylight balance. The realistic look lowers the sky fill and raises the sun so light has a direction.
    this.light = { env: 1, hemi: 1, sun: 1 };

    // Daytime sky: physically based scattering (Preetham), so blues, haze and sunset colours
    // come out right for any sun angle. It also lights the world through an environment map.
    this.scatter = new ScatterSky();
    this.scatter.scale.setScalar(5000);
    this.scatter.renderOrder = -10;
    this.scatter.frustumCulled = false;
    const su = this.scatter.material.uniforms;
    su.turbidity.value = 3.2;
    su.rayleigh.value = 1.35;
    su.mieCoefficient.value = 0.0035;
    su.mieDirectionalG.value = 0.86;
    su.uGain = { value: 1 };
    this.scatter.material.fragmentShader = this.scatter.material.fragmentShader
      .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float uGain;')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( clamp( retColor * uGain, 0.0, 40.0 ), 1.0 );');
    scene.add(this.scatter);
    if (renderer) {
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(this.scatter.geometry, this.scatter.material);
      envSky.scale.setScalar(5000);
      this.envScene.add(envSky);
      this.envTarget = null;
      this.envEl = -999;
      this.envTimer = 0;
    }
    const skyGeo = new THREE.SphereGeometry(1800, 48, 24);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonLit: { value: new THREE.Vector3(0, -1, 0) }, uMoonIllum: { value: 1 }, uSunEl: { value: 10 },
        uDark: { value: 0 }, uTime: { value: 0 }, uCityDir: { value: new THREE.Vector3(1, 0, 0) },
        uCityGlow: { value: 0 }, uCityOverhead: { value: 0 }, uCloud: { value: 0 },
        uAuroraTint: { value: new THREE.Color(0x3cff9a) }, uAurora: { value: 0 },
      },
    });
    this.skyMat.transparent = true;
    this.skyMat.uniforms.uOverlay = { value: 0 };
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -5;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.sky.layers.enable(SKY_LAYER); // seen in the water at night (skyreflect.js)
    // The reflections see the painted low-sun sky too, laid over the physical one as on screen.
    if (this.envScene) { const envDome = new THREE.Mesh(skyGeo, this.skyMat); envDome.renderOrder = 1; envDome.frustumCulled = false; this.envScene.add(envDome); }

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: CLOUD_FRAG, side: THREE.BackSide, depthWrite: false, transparent: true,
      defines: HD.on ? { HD_CLOUDS: '' } : {},
      uniforms: {
        uCloud: { value: 0 }, uDark: { value: 0 }, uOffset: { value: new THREE.Vector2() }, uCam: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunEl: { value: 10 }, uWind: { value: new THREE.Vector2(0.92, -0.4).normalize() },
        uCityOverhead: { value: 0 }, uAuroraTint: { value: new THREE.Color(0x3cff9a) }, uAurora: { value: 0 }, uTime: { value: 0 },
      },
    });
    if (HD.on && renderer) {
      // The realistic clouds are raymarched, which is too heavy to repeat for every sky pixel every
      // frame. They are drawn into a panorama of the sky instead, an eighth of it each frame, and
      // the dome reads the panorama. Clouds drift slowly and sit hundreds of metres up, so a
      // panorama a few frames old looks the same.
      this.pano = new THREE.WebGLRenderTarget(2048, 512, { type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping });
      this.panoMat = new THREE.ShaderMaterial({ vertexShader: PANO_VERT, fragmentShader: CLOUD_FRAG, defines: { HD_CLOUDS: '', PANO: '' }, uniforms: this.cloudMat.uniforms, depthTest: false, depthWrite: false });
      this.panoScene = new THREE.Scene();
      this.panoScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.panoMat));
      this.panoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.panoStrip = -1;
      this.cloudMat.uniforms.uPano = { value: this.pano.texture };
      this.cloudMat.defines = { USE_PANO: '' };
    }
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), this.cloudMat);
    this.clouds.layers.enable(SKY_LAYER);
    this.clouds.renderOrder = -1;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    this.sun = new THREE.DirectionalLight(0xffe8d0, 1.2);
    if (shadowSize > 0) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      const sc = this.sun.shadow.camera;
      // Bigger shadow area on High, so mountains and cliffs further out still cast shadows.
      const ext = shadowSize >= 4096 ? 230 : 140;
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 1400;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.8;
    }
    this.shadowsWanted = shadowSize > 0;
    this.moon = new THREE.DirectionalLight(0x9fb4d6, 0.3);
    this.hemi = new THREE.HemisphereLight(0xc4d2de, 0x3a4046, 0.9);
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);

    this.fog = new THREE.FogExp2(0x9aa8b4, 0.0016);
    scene.fog = this.fog;
    this.tmp = new THREE.Color();
    this.c1 = new THREE.Color();
    this.c2 = new THREE.Color();
  }

  // Re-bake the sky into an environment map when the sun has moved enough to matter.
  updateEnvironment(elDeg, cloud, overlay) {
    if (!this.pmrem) return;
    this.envTimer -= 1;
    const moved = Math.abs(elDeg - this.envEl) > 0.6 || Math.abs(cloud - (this.envCloud ?? -1)) > 0.08;
    if ((moved && this.envTimer <= 0) || !this.envTarget) {
      const old = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
      old?.dispose();
      this.scene.environment = this.envTarget.texture;
      this.envEl = elDeg;
      this.envCloud = cloud;
      this.envTimer = 30;
    }
    // Sky light and reflections fade through dusk (by the sun, not by which sky is drawn).
    this.scene.environmentIntensity = 2.1 * this.light.env * (1 - sm(-1.5, -8, elDeg)) * (1 - cloud * 0.15);
  }

  setRGB(target, a) { return target.setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace); }

  // One eighth of the cloud panorama per call; all of it on the first call. The slice's scissor
  // must be set before the target is bound: three.js applies a target's scissor when it is bound,
  // and with it set afterwards the whole panorama was marched every frame (half the frame time).
  drawPano() {
    const r = this.renderer, rt = this.pano, N = 8, w = rt.width / N;
    const prev = r.getRenderTarget();
    const strips = this.panoStrip < 0 ? [...Array(N).keys()] : [this.panoStrip];
    for (const k of strips) {
      rt.scissor.set(k * w, 0, w, rt.height);
      rt.scissorTest = true;
      r.setRenderTarget(rt);
      r.render(this.panoScene, this.panoCam);
    }
    rt.scissorTest = false;
    r.setRenderTarget(prev);
    this.panoStrip = ((this.panoStrip < 0 ? 0 : this.panoStrip) + 1) % N;
  }
  // hold: the picture is being held (under a menu), so the clouds need not be marched.
  update({ camera, clock, cloud, cloudOffset, city, auroraVis, auroraTint, t, focus, hold = false }) {
    const elDeg = clock.sunElevation();
    const el = THREE.MathUtils.degToRad(elDeg);
    const az = clock.sunAzimuth();
    const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const dark = clock.darkness();
    // The moon: its own path and phase (time.js).
    const M = clock.moonPath();
    const mEl = THREE.MathUtils.degToRad(M.el), mAz = M.az;
    const moonDir = new THREE.Vector3(Math.sin(mAz) * Math.cos(mEl), Math.sin(mEl), -Math.cos(mAz) * Math.cos(mEl));
    // Where its light comes from, as the phase shows it: from behind it at new moon, from the
    // sun's side of the sky in between, from straight behind you at full moon.
    const toSun = sunDir.clone().addScaledVector(moonDir, -sunDir.dot(moonDir));
    if (toSun.lengthSq() < 1e-6) toSun.set(1, 0, 0);
    toSun.normalize();
    const th = M.phase * Math.PI * 2;
    const moonLit = moonDir.clone().multiplyScalar(Math.cos(th)).addScaledVector(toSun, Math.abs(Math.sin(th)));
    this.moonInfo = { illum: M.illum, phase: M.phase, up: smoothstep(-0.05, 0.15, moonDir.y) };

    const u = this.skyMat.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunEl.value = elDeg;
    u.uMoonDir.value.copy(moonDir);
    u.uMoonLit.value.copy(moonLit);
    u.uMoonIllum.value = M.illum;
    u.uDark.value = dark;
    u.uTime.value = t;
    u.uCityDir.value.set(city.dirX, 0, city.dirZ).normalize();
    u.uCityGlow.value = city.horizon;
    u.uCityOverhead.value = city.overhead;
    u.uCloud.value = cloud;
    u.uAuroraTint.value.copy(auroraTint);
    u.uAurora.value = auroraVis;

    const c = this.cloudMat.uniforms;
    c.uCloud.value = cloud;
    c.uDark.value = dark;
    c.uOffset.value.copy(cloudOffset);
    c.uCam.value.copy(camera.position);
    c.uSunDir.value.copy(sunDir);
    c.uSunEl.value = elDeg;
    c.uCityOverhead.value = city.overhead;
    c.uAuroraTint.value.copy(auroraTint);
    c.uAurora.value = auroraVis;
    c.uTime.value = t;

    if (this.pano && !hold) this.drawPano();
    this.sky.position.copy(camera.position);
    this.clouds.position.copy(camera.position);
    this.scatter.position.copy(camera.position);
    this.scatter.material.uniforms.sunPosition.value.copy(sunDir);
    // Night sky takes over once the sun is well below the horizon.
    const overlay = sm(12, 5, elDeg);
    u.uOverlay.value = overlay;
    this.scatter.visible = overlay < 0.999;
    // Overcast skies are greyer and dimmer.
    // The realistic look: a clearer, deeper blue sky (less haze, a little more Rayleigh) drawn
    // darker, so it reads blue through the film curve instead of white.
    const hdSky = HD.on ? 1 : 0;
    this.scatter.material.uniforms.turbidity.value = 3.2 - hdSky * 0.9 + cloud * 6;
    this.scatter.material.uniforms.rayleigh.value = 1.35 + hdSky * 0.45 * (1 - cloud);
    this.scatter.material.uniforms.mieCoefficient.value = 0.0035 - hdSky * 0.0013;
    this.scatter.material.uniforms.uGain.value = (1 - cloud * 0.25) * (1 - hdSky * 0.4 * (1 - cloud * 0.6));
    this.updateEnvironment(elDeg, cloud, overlay);

    // Sun: warm and low most of the winter day, whiter when high.
    const f = focus || camera.position;
    const sunUp = smoothstep(-3, 4, elDeg);
    this.setRGB(this.sun.color, mixA(mixA([1.0, 0.55, 0.3], [1.0, 0.76, 0.55], sm(0, 5, elDeg)), [1.0, 0.95, 0.88], sm(5, 24, elDeg)));
    this.sun.intensity = 4.2 * this.light.sun * sunUp * (1 - cloud * 0.55);
    // Snap the shadow box to whole units so shadows don't shimmer as you drive.
    const fx = Math.round(f.x), fz = Math.round(f.z);
    this.sun.target.position.set(fx, f.y, fz);
    this.sun.position.set(fx, f.y, fz).addScaledVector(sunDir, 500);
    // The sun keeps casting even when it is too weak to matter: switching castShadow changes every
    // material's shader, so the whole scene recompiled (a long freeze) at every dusk and dawn. When
    // the sun is that weak the shadow map just stops being redrawn.
    this.sun.castShadow = this.shadowsWanted;
    if (this.renderer && this.shadowsWanted) this.renderer.shadowMap.autoUpdate = this.sun.intensity > 0.05;
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 500);
    this.moon.target.position.copy(camera.position);
    // Moonlight: bright enough to see the land by at full moon, next to nothing at new moon.
    this.moon.intensity = 1.5 * dark * (1 - cloud * 0.6) * smoothstep(-0.05, 0.15, moonDir.y) * Math.pow(M.illum, 1.5);

    // Skylight: blue by day, lilac at dusk, cool blue by moonlight, green under a strong aurora.
    const wTw = sm(-10, -3, elDeg) * sm(6, 0, elDeg);
    const wNight = sm(-5, -11, elDeg);
    this.setRGB(this.c1, mixA(mixA([0.64, 0.71, 0.8], [0.66, 0.54, 0.66], wTw), [0.22, 0.29, 0.45], wNight));
    this.c1.lerp(auroraTint, auroraVis * 0.22 * dark);
    this.hemi.color.copy(this.c1);
    this.setRGB(this.hemi.groundColor, mixA([0.42, 0.33, 0.22], [0.06, 0.07, 0.09], wNight));
    this.hemi.intensity = 0.45 * this.light.hemi + wTw * 0.5 + wNight * (0.7 + 0.35 * this.moonInfo.up * this.moonInfo.illum * (1 - cloud)) + auroraVis * 0.6 * dark;

    // Fog takes the horizon colour, so far hills fade into blue haze.
    this.setRGB(this.fog.color, horizonColor(elDeg));
    this.fog.color.lerp(this.c2.setRGB(0.23, 0.17, 0.12), city.overhead * dark * 0.4);
    // Realistic look: distance turns land blue, as air really does (aerial perspective), rather
    // than the pale grey of a painted backdrop.
    if (HD.on) { const day = 1 - wNight; this.fog.color.multiply(this.c2.setRGB(1 - 0.24 * day, 1 - 0.13 * day, 1)); }
    this.fog.density = 0.0004 + wNight * 0.0005 + cloud * 0.00045;
    return { sunDir, dark };
  }
}
