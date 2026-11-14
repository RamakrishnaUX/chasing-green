import * as THREE from 'three';
import { grid, heightAt, BOUNDS } from './terrain.js';
import { surfaceUniforms, NOISE } from './materials.js';
import { nightSky, NIGHT_SKY_GLSL } from './skyreflect.js';
import { waterTex, WATER_GLSL } from './water.js';

// Waves on the shore. Swell rolls in from the open sea every nine seconds or so, rises as the
// water shallows, steepens and breaks where the sea gets too shallow to hold it (out on a gentle
// beach, right at the water's edge on a steep one), and runs on as a band of churning white water.
// At the shore each wave runs up the sand as a thin sheet with a line of foam at its front, slows,
// and slides back, leaving the black sand dark and shining for a while. Waves differ in size, and
// now and then one is far bigger than the rest: a sneaker wave, which runs several times further
// up the beach than the others.
//
// It is drawn as a patch of water laid over the sea and the shore round the eye, wherever the eye
// is near the coast. Where nothing is happening the patch is clear, so the sea shows through.
// Everything is a function of time, place, the ground height and the distance to the coast, so
// the game can ask the same question of any point (waterAt): is the sea over this spot now?

export const SURF = { period: 9, speed: 4.5 };

const SURF_GLSL = /* glsl */ `
uniform sampler2D uCoastTex; uniform float uSurfT;
float cFetch(ivec2 c){ c = clamp(c, ivec2(0), ivec2(uGridN) - 1); return texelFetch(uCoastTex, c, 0).r; }
float coastD(vec2 p){
  vec2 f = (p - uGridMin) / uGridStep; vec2 i = floor(f); vec2 t = f - i; ivec2 c = ivec2(i);
  return mix(mix(cFetch(c), cFetch(c + ivec2(1, 0)), t.x), mix(cFetch(c + ivec2(0, 1)), cFetch(c + ivec2(1, 1)), t.x), t.y);
}
const float SP = ${SURF.period.toFixed(1)}, SC = ${SURF.speed.toFixed(1)};
float sHash(float n){ float h = fract(n * 0.1031); h *= h + 33.33; h *= h + h; return fract(h); }
// Waves reach the shore at slightly different moments along it, so crests bend and break in sections.
float sOff(vec2 p){ return 1.6 * sin(p.x * 0.011 + p.y * 0.006) + 0.9 * sin(p.y * 0.019 - p.x * 0.004 + 1.3) + 0.35 * sin(p.x * 0.047 + p.y * 0.031 + 4.0); }
float sBig(float n){ return step(0.9, sHash(n * 1.37 + 11.0)); }
float sH(float n){ return (0.55 + 0.5 * sHash(n)) * (1.0 + sBig(n) * 0.9); }
float sRun(float n){ return (3.2 + 3.6 * sHash(n + 3.7)) * (1.0 + sBig(n) * 1.7); }
float sTup(float R){ return 1.2 + 0.85 * sqrt(R); }
// How far up the beach the front of the run-up is (metres from the waterline), tau seconds after
// the wave reached the shore.
float sFront(float R, float tau){
  float tu = sTup(R), td = tu * 1.4;
  if (tau < 0.0 || tau > tu + td) return -9.0;
  if (tau < tu) { float a = 1.0 - tau / tu; return R * (1.0 - a * a); }
  float b = (tau - tu) / td; return R * (1.0 - b * b);
}
float sLift, sFoam, sLace, sCover, sSheet, sEdge, sWet, sThin, sBigNow, sMark, sFlow;
float sNh(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float sNz(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sNh(i), sNh(i + vec2(1, 0)), f.x), mix(sNh(i + vec2(0, 1)), sNh(i + vec2(1, 1)), f.x), f.y); }
void surfAt(vec2 p, float h, float d){
  float t = uSurfT - sOff(p);
  sLift = 0.0; sFoam = 0.0; sLace = 0.0; sThin = 0.0;
  if (h < 0.4) {
    float depth = max(0.0, -h);
    float ph = (t - min(d, 0.0) / SC) / SP, n = floor(ph), u = fract(ph);
    float Hn = sH(n), Hn1 = sH(n + 1.0);
    // Has the wave that just passed (n) broken here, or is the one coming (n + 1) breaking?
    float brN = smoothstep(Hn * 1.7, Hn * 1.05, depth), brN1 = smoothstep(Hn1 * 1.7, Hn1 * 1.05, depth);
    float back = exp(-pow(u * SP / 2.4, 2.0));
    float front = exp(-pow((1.0 - u) * SP / mix(1.8, 0.5, brN1), 2.0));
    float grow = smoothstep(-120.0, -22.0, d), shore = mix(0.3, 1.0, smoothstep(0.0, 0.9, depth));
    float aN = Hn * grow * mix(1.0, 0.45, brN) * shore, aN1 = Hn1 * grow * mix(1.0, 0.55, brN1) * shore;
    sLift = max(aN * back, aN1 * front) - 0.1 * max(aN, aN1);
    // Light through the thin top of a steep wave about to break.
    sThin = brN1 * front * smoothstep(0.55, 0.95, u) * smoothstep(0.2, 0.6, aN1);
    // White water: down the face of a breaking wave, a churning band behind a broken one, and
    // lacy foam left on the water that thins out until the next.
    sFoam = clamp(brN1 * front * smoothstep(0.8, 0.97, u) * 1.3 + brN * exp(-u * SP / 2.6), 0.0, 1.0) * grow;
    sLace = brN * exp(-u * SP / 7.5) * grow;
  }
  // The run-up of the last few waves to reach the shore: d here is the distance from the waterline.
  // Running up, the water comes as a sheet with a bubbly front. Sliding back, it does not retreat
  // as one piece: it drains, thinning from the top down so the sand shows through, its edge going
  // ragged in scallops and fingers, and it leaves a line of foam where it reached, which fades.
  float t0 = t / SP, n0 = floor(t0), tau0 = fract(t0) * SP;
  float x = max(d, 0.0);
  float rag = sNz(p * 0.22) * 0.6 + sNz(p * 0.85 + 4.0) * 0.4 - 0.5; // -0.5..0.5, metres apart
  sCover = 0.0; sSheet = 0.0; sEdge = 0.0; sWet = 0.0; sBigNow = 0.0; sMark = 0.0; sFlow = 0.0;
  for (int k = 0; k < 3; k++) {
    float n = n0 - float(k), tau = tau0 + float(k) * SP;
    float R = sRun(n), tu = sTup(R), td = tu * 1.4;
    float e = sFront(R, tau);
    // Up a steep bank the water climbs only so high (eased, so it never cuts off in a hard line).
    float capK = 1.0 - smoothstep(0.2 + 0.5 * R, 0.6 + 0.5 * R, h);
    float b = clamp((tau - tu) / td, 0.0, 1.0), back = step(tu, tau);
    float reach = e + rag * mix(0.5, 0.8 + 2.4 * b, back) - x;
    if (reach > 0.0 && capK > 0.0 && e > -1.0) {
      // Draining: shallow near the edge, and shallower all over as it goes.
      float cov = smoothstep(0.0, mix(0.3, 0.8 + 3.0 * b, back), reach) * mix(1.0, 1.0 - 0.75 * b, back) * capK;
      if (cov > sCover) sFlow = e;
      sCover = max(sCover, cov);
      sSheet = max(sSheet, reach * mix(1.0, 1.0 - b, back));
      sEdge = max(sEdge, exp(-pow(reach / 1.3, 2.0)) * (1.0 - back) * capK);
      sBigNow = max(sBigNow, sBig(n));
    }
    // The line of foam left at the top of the run-up, scalloped like the edge, fading as it sinks in.
    if (back > 0.0) sMark = max(sMark, exp(-pow((x - R - rag * 1.2) / 0.3, 2.0)) * exp(-(tau - tu) / 3.5) * capK);
    // The sand stays dark and shining for a while after the water has slid back off it.
    if (x < R + rag * 1.2 && h < 0.6 + 0.5 * R) {
      float tl = tu + td * sqrt(max(0.0, 1.0 - x / R)), age = tau - tl;
      sWet = max(sWet, age > 0.0 ? exp(-age / 10.0) : (reach > 0.0 ? 1.0 : 0.0));
    }
  }
  sWet = max(sWet, (1.0 - smoothstep(0.0, 1.5, x)) * 0.75);
}`;

function surfMaterial(uniforms, low) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  mat.customProgramCacheKey = () => `surf2-${low ? 'low' : 'full'}`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, surfaceUniforms, nightSky, waterTex, uniforms);
    const head = `uniform sampler2D uHeightTex; uniform vec2 uGridMin; uniform vec2 uGridStep; uniform vec2 uGridN;
float wFetch(ivec2 c){ c = clamp(c, ivec2(0), ivec2(uGridN) - 1); return texelFetch(uHeightTex, c, 0).r; }
float groundAt(vec2 p){
  vec2 f = (p - uGridMin) / uGridStep; vec2 i = floor(f); vec2 t = f - i; ivec2 c = ivec2(i);
  float a = wFetch(c), b = wFetch(c + ivec2(1, 0)), cc = wFetch(c + ivec2(0, 1)), d = wFetch(c + ivec2(1, 1));
  return (t.x + t.y < 1.0) ? a + (b - a) * t.x + (cc - a) * t.y : d + (cc - d) * (1.0 - t.x) + (b - d) * (1.0 - t.y);
}
${SURF_GLSL}
${low ? '#define SURF_LOW' : ''}
uniform vec3 uPatch; // centre x, z and half size
varying vec3 vWP; varying float vH; varying float vD;`;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${head}
float surfY(vec2 p, out float h, out float d){
  h = groundAt(p); d = coastD(p);
  surfAt(p, h, d);
  if (h < 0.0) return max(sLift, 0.0);
  // A little above the ground, so its folds (the land's triangles are coarser than the patch's)
  // never poke through the thin water.
  return h + clamp(sSheet * 0.03, 0.06, 0.12);
}`)
      .replace('#include <beginnormal_vertex>', `
        vec2 sp = position.xz + uPatch.xy;
        float sh0, sd0, shx, sdx, shz, sdz;
        float y0 = surfY(sp, sh0, sd0);
        #ifdef SURF_LOW
        // (Phones: one sum per point, the slope of the waves left to the ripples.)
        vec3 objectNormal = vec3(0.0, 1.0, 0.0);
        #else
        float yx = surfY(sp + vec2(0.6, 0.0), shx, sdx), yz = surfY(sp + vec2(0.0, 0.6), shz, sdz);
        vec3 objectNormal = normalize(vec3(-(yx - y0) / 0.6, 1.0, -(yz - y0) / 0.6));
        #endif
        vH = sh0; vD = sd0;
        // Far from the coast nothing happens: tuck the patch under the ground there.
        if (sd0 > 60.0 || sd0 < -140.0) y0 = sh0 - 3.0;
        vWP = vec3(sp.x, y0, sp.y);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vWP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${head}\n${NOISE}\n${NIGHT_SKY_GLSL}\nfloat sfFoam; float sfWetSand;\nuniform float uTime;\n${WATER_GLSL}`)
      .replace('#include <color_fragment>', `
        surfAt(vWP.xz, vH, vD);
        // Most of the patch is clear water or dry sand most of the time: stop there.
        if (max(max(sLift - 0.02, sFoam), max(sLace, max(sCover, max(sWet, sMark)))) < 0.01) discard;
        float dist = length(vViewPosition);
        // Lacy foam: thin bright threads round darker holes, drifting, plus soft churned patches.
        vec2 q = vWP.xz * 0.85 + vec2(sin(uSurfT * 0.21), cos(uSurfT * 0.17)) * 0.7;
        float l1 = abs(g_n(q) - 0.5), l2 = abs(g_n(q * 2.3 + 7.0) - 0.5);
        float lace = smoothstep(0.1, 0.015, min(l1, l2 * 1.3));
        float churn = 0.55 + 0.45 * g_n(vWP.xz * 2.2 + vec2(uSurfT * 0.4, -uSurfT * 0.3));
        // The sea's own colours (terrain.js): clear over the sand, darker as it deepens.
        vec3 deepC = vec3(0.01, 0.045, 0.07), shallowC = vec3(0.17, 0.4, 0.4), clearC = vec3(0.12, 0.42, 0.38), foamC = vec3(0.93, 0.96, 0.97);
        vec3 seaC = mix(deepC, shallowC, exp(-max(0.0, -vH) * vec3(0.9, 0.45, 0.32) * 0.5));
        vec3 col; float a;
        float sea = 1.0 - smoothstep(-0.05, 0.05, vH);
        // Over the sea: the raised wave, translucent green where its top is thin, and white water.
        float liftA = smoothstep(0.02, 0.22, sLift);
        // A raised wave is a little darker than the water round it (its face tilts away from the
        // sky), and glows green-blue near the top as it steepens to break.
        // The wave's body is a veil over the sea beneath (which keeps its own colour and light, by
        // day or night): darker on the face, clear green-blue at the thin top.
        vec3 waveC = mix(seaC * 0.45, clearC, clamp(sThin * 0.9, 0.0, 1.0));
        float fSea = clamp(sFoam * churn + sLace * lace * 0.75, 0.0, 1.0);
        // On the sand: a thin glassy sheet with a bubbly line at its front, and wet sand behind.
        float sheetA = sCover * mix(0.4, 0.75, smoothstep(0.0, 3.0, sSheet));
        // The front is a band of bubbles, broken up into clumps, thinning to lace behind it.
        float bub = smoothstep(0.35, 0.75, g_n(vWP.xz * 3.1 + uSurfT * 0.2) * 0.6 + g_n(vWP.xz * 7.3) * 0.4);
        // Foam on the sheet moves with the water: up the beach on the run-up, down it on the way back.
        // (Uphill is found from how the distance to the waterline changes across the screen.)
        vec2 gx = dFdx(vWP.xz), gy = dFdy(vWP.xz); float ddx = dFdx(vD), ddy = dFdy(vD);
        float det = gx.x * gy.y - gx.y * gy.x;
        vec2 up = abs(det) > 1e-6 ? normalize(vec2(ddx * gy.y - ddy * gx.y, gx.x * ddy - gy.x * ddx) / det + 1e-5) : vec2(0.0);
        vec2 qs = (vWP.xz - up * sFlow) * 2.4;
        float laceS = smoothstep(0.07, 0.01, min(abs(g_n(qs) - 0.5), abs(g_n(qs * 2.1 + 3.0) - 0.5) * 1.4));
        float fSand = clamp(sEdge * mix(0.35, 1.0, bub) * 1.15 + sCover * laceS * 0.22 * smoothstep(0.3, 2.0, sSheet) + sMark * mix(0.2, 0.85, bub), 0.0, 1.0);
        vec3 sheetC = vec3(0.025, 0.04, 0.045);
        float wetA = sWet * (1.0 - sCover) * 0.62;
        sfWetSand = (1.0 - sea) * wetA / max(1e-3, wetA + sheetA);
        vec3 seaCol = waveC; float seaA = liftA * mix(0.42, 0.75, clamp(sThin, 0.0, 1.0));
        vec3 sandCol = mix(vec3(0.0), sheetC, sCover / max(1e-3, sCover + wetA)); float sandA = max(sheetA, wetA);
        col = mix(sandCol, seaCol, sea); a = mix(sandA, seaA, sea);
        sfFoam = mix(fSand, fSea, sea);
        col = mix(col, foamC, sfFoam); a = max(a, sfFoam);
        // Only round the eye: the patch fades out before its square edge.
        vec2 off = abs(vWP.xz - uPatch.xy);
        a *= 1.0 - smoothstep(uPatch.z * 0.72, uPatch.z * 0.95, max(off.x, off.y));
        a *= smoothstep(-140.0, -130.0, vD);
        diffuseColor.rgb = pow(col, vec3(2.2)) * 2.2;
        diffuseColor.rgb *= 1.0 - 0.75 * uNightRefl * (1.0 - sfFoam);
        diffuseColor.a = a;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.07, 0.55, sfWetSand), 0.9, sfFoam);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // The same waves as the sea round it (materials.js, water.js), so the two meet without a seam.
          vec2 ss = seaSlope(vWP.xz, 90.0, 0.7, dist) * mix(0.35, 1.0, smoothstep(0.0, 1.5, max(0.0, -vH)));
          normal = normalize(normal + (viewMatrix * vec4(-ss.x, 0.0, -ss.y, 0.0)).xyz);
        }`)
      .replace('#include <opaque_fragment>', 'outgoingLight += nightMirror(normal) * (1.0 - sfFoam) * diffuseColor.a;\n// Wet sand: darker, with a soft sheen rather than a mirror.\noutgoingLight *= 1.0 - 0.55 * sfWetSand;\n#include <opaque_fragment>');
  };
  return mat;
}

export class Surf {
  constructor(scene, { low = false } = {}) {
    const size = low ? 200 : 280, n = low ? 110 : 176;
    this.half = size / 2; this.step = size / n;
    const geo = new THREE.PlaneGeometry(size, size, n, n).rotateX(-Math.PI / 2);
    this.field = waterline();
    const tex = new THREE.DataTexture(this.field, grid.nx, grid.nz, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
    this.uniforms = { uCoastTex: { value: tex }, uSurfT: { value: 0 }, uPatch: { value: new THREE.Vector3(0, 0, size / 2) } };
    this.mesh = new THREE.Mesh(geo, surfMaterial(this.uniforms, low));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.receiveShadow = true; this.mesh.userData.noAO = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
    // Sea foam laid down by the sea's own shader is faded inside the patch (materials.js).
    this.seaFade = surfaceUniforms.uSurfPatch;
    this.t = 0;
  }

  // Each frame: the eye's position; coast: distance from it to the sea's edge.
  update(dt, eye, coast) {
    this.t = (this.t + dt) % (SURF.period * 1000);
    this.uniforms.uSurfT.value = this.t;
    const on = coast < this.half * 0.9 && eye.y < 160;
    this.mesh.visible = on;
    if (on) {
      const s = this.step, cx = Math.round(eye.x / s) * s, cz = Math.round(eye.z / s) * s;
      this.uniforms.uPatch.value.set(cx, cz, this.half);
    }
    if (this.seaFade) this.seaFade.value.set(this.uniforms.uPatch.value.x, this.uniforms.uPatch.value.y, on ? this.half : 0);
  }

  // The same sums as the shader, for one point: is the sea over it right now?
  // Returns { sheet: depth of water over the ground in metres (0 if dry), up: running up (not
  // sliding back), big: a sneaker wave, wave: which wave }.
  waterAt(x, z) {
    const h = heightAt(x, z), d = Math.max(0, this.distAt(x, z));
    const t = this.t - sOff(x, z);
    const t0 = t / SURF.period, n0 = Math.floor(t0), tau0 = (t0 - n0) * SURF.period;
    let best = { sheet: 0, up: false, big: false, wave: null };
    for (let k = 0; k < 3; k++) {
      const n = n0 - k, tau = tau0 + k * SURF.period, R = sRun(n), tu = sTup(R);
      const e = sFront(R, tau), reach = h < 0.6 + 0.5 * e ? e - d : 0;
      // (The sheet is thin: about 4 cm for every metre short of the front.)
      if (reach > 0 && reach * 0.04 > best.sheet) best = { sheet: Math.min(0.3, reach * 0.04), up: tau < tu, big: sBig(n) > 0, wave: n };
    }
    return best;
  }
  // Distance from the waterline (metres; negative out on the water), as the shader reads it.
  distAt(x, z) { return waterlineAt(x, z); }
  // How hard the surf is breaking near the shore right now, 0 to 1 (for the sound): a swell of
  // noise as each wave breaks, louder for a big one.
  breaking(x, z) {
    const t = this.t - sOff(x, z), t0 = t / SURF.period, n = Math.floor(t0) + 1, u = t0 - Math.floor(t0);
    // A wave breaks a little before it reaches the shore.
    const k = Math.exp(-Math.pow((u - 0.82) * SURF.period / 1.6, 2)) + 0.5 * Math.exp(-((u + 0.18) * SURF.period) / 3);
    return Math.min(1, k * (sBig(n) ? 1.5 : 1));
  }
}

// The JavaScript twins of the shader's functions.
const fract = (v) => v - Math.floor(v);
function sHash(n) { let h = fract(n * 0.1031); h *= h + 33.33; h *= h + h; return fract(h); }
function sOff(x, z) { return 1.6 * Math.sin(x * 0.011 + z * 0.006) + 0.9 * Math.sin(z * 0.019 - x * 0.004 + 1.3) + 0.35 * Math.sin(x * 0.047 + z * 0.031 + 4.0); }
function sBig(n) { return sHash(n * 1.37 + 11.0) >= 0.9 ? 1 : 0; }
function sRun(n) { return (3.2 + 3.6 * sHash(n + 3.7)) * (1 + sBig(n) * 1.7); }
function sTup(R) { return 1.2 + 0.85 * Math.sqrt(R); }
function sFront(R, tau) {
  const tu = sTup(R), td = tu * 1.4;
  if (tau < 0 || tau > tu + td) return -9;
  if (tau < tu) { const a = 1 - tau / tu; return R * (1 - a * a); }
  const b = (tau - tu) / td; return R * (1 - b * b);
}

// Distance from the waterline at a point (bilinear, as the shader reads it). Built on first use,
// once the land has its final shape (after the pads are levelled).
let FIELD = null;
export function waterline() { return FIELD || (FIELD = waterlineField()); }
export function waterlineAt(x, z) {
  const F = waterline(), w = grid.nx;
  const fx = Math.min(Math.max((x - BOUNDS.minX) / grid.dx, 0), grid.nx - 1.001), fz = Math.min(Math.max((z - BOUNDS.minZ) / grid.dz, 0), grid.nz - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const a = F[iz * w + ix], b = F[iz * w + ix + 1], c = F[(iz + 1) * w + ix], e = F[(iz + 1) * w + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
}

// Distance from the waterline (where the ground drops below the sea) for every point of the height
// grid: positive on land, negative out on the water. The edge is placed between grid points where
// the ground crosses sea level, then spread out with a two-pass chamfer sweep.
function waterlineField() {
  const { nx, nz, dx, dz, heights: H } = grid, N = nx * nz, BIG = 1e4;
  const land = new Float32Array(N).fill(BIG), sea = new Float32Array(N).fill(BIG);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const i = iz * nx + ix, h = H[i];
    for (const [ox, oz, st] of [[1, 0, dx], [-1, 0, dx], [0, 1, dz], [0, -1, dz]]) {
      const jx = ix + ox, jz = iz + oz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const hn = H[jz * nx + jx];
      if ((h >= 0) === (hn >= 0)) continue;
      const f = Math.abs(h) / (Math.abs(h) + Math.abs(hn)) * st; // to the crossing
      if (h >= 0) land[i] = Math.min(land[i], f); else sea[i] = Math.min(sea[i], f);
    }
  }
  const dg = Math.hypot(dx, dz);
  const sweep = (D) => {
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix; let v = D[i];
      if (ix > 0) v = Math.min(v, D[i - 1] + dx);
      if (iz > 0) { v = Math.min(v, D[i - nx] + dz); if (ix > 0) v = Math.min(v, D[i - nx - 1] + dg); if (ix < nx - 1) v = Math.min(v, D[i - nx + 1] + dg); }
      D[i] = v;
    }
    for (let iz = nz - 1; iz >= 0; iz--) for (let ix = nx - 1; ix >= 0; ix--) {
      const i = iz * nx + ix; let v = D[i];
      if (ix < nx - 1) v = Math.min(v, D[i + 1] + dx);
      if (iz < nz - 1) { v = Math.min(v, D[i + nx] + dz); if (ix < nx - 1) v = Math.min(v, D[i + nx + 1] + dg); if (ix > 0) v = Math.min(v, D[i + nx - 1] + dg); }
      D[i] = v;
    }
  };
  // Land cells measure to the nearest sea, sea cells to the nearest land.
  for (let i = 0; i < N; i++) { if (H[i] >= 0) sea[i] = BIG; else land[i] = BIG; }
  const toSea = new Float32Array(N), toLand = new Float32Array(N);
  for (let i = 0; i < N; i++) { toSea[i] = H[i] >= 0 ? land[i] : 0; toLand[i] = H[i] < 0 ? sea[i] : 0; }
  sweep(toSea); sweep(toLand);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.max(-300, Math.min(300, H[i] >= 0 ? toSea[i] : -toLand[i]));
  return out;
}
