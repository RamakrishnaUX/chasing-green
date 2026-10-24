import './ui/style.css';
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { store } from './storage.js';
import { createNoise2D, clamp, smoothstep, lerp } from './world/noise.js';
import { START, PLACES, CANYONS, JUMPS, KERID } from './world/geo.js';
import { buildTerrain, paintTerrain, flattenPads, bridges, roadPaths, nearestRoad, heightAt, coastAt, nearestRoadAnywhere, exposureAt, waterLevelAt, postReflectorMat, lakeMat } from './world/terrain.js';
import { Scatter } from './world/scatter.js';
import { Grass } from './world/grass.js';
import { Post } from './world/post.js';
import { carThumbs } from './ui/carthumbs.js';
import { Props } from './world/props.js';
import { Towns } from './world/towns.js';
import { Obstacles } from './world/obstacles.js';
import { Puddles, Particles, SnowFall } from './world/effects.js';
import { MapUI } from './ui/minimap.js';
import { Sheet } from './ui/sheet.js';
import { haptics } from './ui/haptics.js';
import { Learn } from './ui/learn.js';
import { VEHICLES, VEHICLE_ORDER } from './vehicle/specs.js';
import { surfaceUniforms } from './world/materials.js';
import { Clock } from './world/time.js';
import { Sky } from './world/sky.js';
import { Landmarks, waterUniforms } from './world/landmarks.js';
import { Forecast, AURORA_TYPES } from './aurora/forecast.js';
import { Aurora } from './aurora/aurora.js';
import { Jeep } from './vehicle/jeep.js';
import { Walker } from './vehicle/walker.js';
import { Input } from './vehicle/input.js';
import { Hud } from './ui/hud.js';
import { Notebook, stampSvg } from './ui/notebook.js';
import { AudioEngine } from './audio/audio.js';
import { drawPostcard, sharePostcard, canvasBlob, download } from './share/postcard.js';
import { linkFor, readSharedSighting } from './share/link.js';
import { ClipRecorder } from './share/recorder.js';
import { dailyChallenge } from './challenges.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

store.load();
const settings = store.data.settings;
// Phones that run hot get a lighter Low: small or low-memory Android phones and any phone with
// few cores render fewer pixels, less grass and simpler aurora. Phones also cap at 30 fps,
// which this slow-paced game does not need more than and which keeps them cool.
const isAndroid = /Android/i.test(navigator.userAgent);
const weakDevice = isTouch && ((navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4 ||
  (isAndroid && Math.min(screen.width, screen.height) <= 400));
const LITE = { pixelRatio: 0.75, auroraSteps: 6, terrainRes: 480, grass: 3500, grassRadius: 18, rocks: 140 };
const qualityFor = (name) => (weakDevice && name === 'low' ? { ...CONFIG.quality.low, ...LITE } : CONFIG.quality[name]);
const FRAME_GAP = isTouch ? 1000 / 30 : 0;
let qualityName = settings.quality || (isTouch ? 'low' : CONFIG.defaultQuality);
let Q = qualityFor(qualityName);
const challenge = dailyChallenge();

// ---------- Renderer ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: qualityName !== 'low', powerPreference: isTouch ? 'default' : 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = Q.shadowSize > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.exposure ?? 0.95;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.4, Q.far || 3200);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post?.setSize();
});

// ---------- State ----------
const clock = new Clock(Number.isInteger(settings.month) ? settings.month : new Date().getMonth());
clock.speed = settings.speed || 1;
const tripSeed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
const forecast = new Forecast(tripSeed, { redChallenge: challenge.id === 'red' });
const windNoise = createNoise2D(tripSeed ^ 77);
const input = new Input(canvas);
const hud = new Hud();
const sheet = new Sheet();
haptics.enabled = settings.haptics !== 'off';
const audio = new AudioEngine();
audio.muted = !!settings.muted;

let world = null, sky, aurora, landmarks, jeep, walker, scatter, grass, props, post = null;
let obstacles, puddles, spray, dust, mapUI, towns, snow;
const snowNoise = createNoise2D(4040);
let wasInPuddle = false, wasInWater = false, shake = 0, sitting = false, sitSpeedBefore = 1, camHeading = null;
let started = false;
let mode = 'chase'; // chase | lookup | walk
let walkTilt = false;
const look = { yaw: 0, pitch: 0.95, orbit: 0, walkYaw: 0 };
let lookTimer = 0;
let loggedThisWindow = false, lastLoggedType = null, inactiveFor = 99, lastLogReal = -999, lastLogPos = null, lastShot = -1e9, lastAurora = null, wasLooking = false;
let captureRequest = null;
const sessionImages = new Map();
let guaranteeToastShown = false;
let infoDismissed = null;
let lastWhere = '';
let auroraVisSmoothed = 0;
const cloudOffset = new THREE.Vector2();
const startGameHours = clock.gameHours;
const startNight = clock.nightIndex;
let fpsAcc = 0, fpsFrames = 0, autoDowngraded = false;

// ---------- Build world ----------
// Built in stages so the Start button can fill as it goes. Before each stage the bar is sent
// toward that stage's end over its usual duration; the fill animates on the compositor, so it
// keeps moving even while a heavy stage holds the main thread.
// The real build fills the bar to BUILD_SHARE; a short paced finish carries it to 100%, so the
// load always feels like a load (at least MIN_LOAD_MS) even on a fast machine.
const BUILD_SHARE = 0.82, MIN_LOAD_MS = 3200;
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const stageTimes = {};
async function buildWorld(progress) {
  const t0 = performance.now();
  let tStage = t0, current = null, currentMs = 0;
  // Expected times come from a desktop build; phones start at 2.5x, then the first stage tells
  // us how fast this device really is and the rest of the bar is paced to match.
  let pace = isTouch ? 2.5 : 1;
  const stage = async (name, end, ms) => {
    if (current) {
      stageTimes[current] = Math.round(performance.now() - tStage);
      if (current === 'Shaping the island') pace = Math.min(6, Math.max(0.5, stageTimes[current] / currentMs));
    }
    current = name; tStage = performance.now(); currentMs = ms;
    progress(end * BUILD_SHARE, ms * pace, name);
    await nextPaint();
  };
  await stage('Shaping the island', 0.58, 1500);
  world = buildTerrain(scene, Q.terrainRes, clock.season);
  await stage('Lighting the sky', 0.59, 40);
  sky = new Sky(scene, { shadowSize: Q.shadowSize, renderer });
  aurora = new Aurora(scene, Q.auroraSteps);
  await stage('Placing landmarks', 0.67, 220);
  // Pads under built landmarks, by kind (radius in world units). Natural sites keep their shape.
  const PAD = { building: 32, town: 30, sculpture: 12, pool: 26, geothermal: 24, cave: 16, bridge: 18, waterfall: 34, geyser: 18 };
  landmarks = new Landmarks(scene, { quality: qualityName, beforeBuild: (list) => {
    const pads = list.filter((l) => PAD[l.kind] && l.id !== 'seydisfjordur').map((l) => ({ x: l.x, z: l.z, r: l.id === 'hallgrimskirkja' ? 38 : PAD[l.kind] }));
    flattenPads(pads, world.mesh);
  } });
  landmarks.onEvent = (type, lm) => {
    const pp = activePos(), d = Math.hypot(pp.x - lm.x, pp.z - lm.z);
    if (d > 160 || !started) return;
    if (type === 'geyser-warning') { hud.toast('Strokkur is about to erupt. Watch the water bulge!', { seconds: 3, priority: 2 }); audio.thud(6); }
    if (type === 'geyser-erupt') audio.splash(1);
  };
  obstacles = new Obstacles();
  landmarks.registerObstacles(obstacles);
  await stage('Scattering rocks', 0.88, 560);
  // Bridge railings are solid on both sides.
  for (const B of bridges) for (const sx of [-1, 1]) obstacles.addBox(B.x - B.dz * sx * 4.65, B.z + B.dx * sx * 4.65, Math.atan2(B.dx, B.dz), 0.25, B.len / 2 + 2, 'wall');
  scatter = new Scatter(scene, { grass: 0, rocks: Math.round(Q.rocks * (CONFIG.rockDensity[settings.rocks || 'normal'] || 1)), obstacles });
  // No grass field on streets, churchyards and city squares.
  const clear = landmarks.list.filter((l) => ['town', 'building', 'sculpture'].includes(l.kind)).map((l) => ({ x: l.x, z: l.z, r: l.id === 'seydisfjordur' ? 58 : l.id === 'laugavegur' ? 30 : l.id === 'hallgrimskirkja' ? 34 : 22 }));
  if (Q.grass > 0) grass = new Grass(scene, { count: Q.grass, radius: Q.grassRadius, clear });
  if (Q.post) post = new Post(renderer, scene, camera, { ao: !!Q.ao });
  await stage('Building towns', 0.91, 80);
  props = new Props(scene, { farms: qualityName === 'low' ? 14 : 26, landmarks: landmarks.list, keepClear: [START], obstacles });
  towns = new Towns(scene, { landmarks: landmarks.list, obstacles, scale: qualityName === 'low' ? 0.6 : 1 });
  snow = new SnowFall(scene, qualityName === 'low' ? 900 : 2200);
  puddles = new Puddles(scene, qualityName === 'low' ? 100 : 180);
  spray = new Particles(scene, { count: qualityName === 'low' ? 260 : 600, color: 0xe6f0f4, size: 0.5, opacity: 0.75, gravity: 9.5, drag: 1.2 });
  dust = new Particles(scene, { count: qualityName === 'low' ? 120 : 300, color: 0xb39a74, size: 1.3, opacity: 0.28, gravity: -0.4, drag: 1.4 });
  scatter.setSeason(clock.season);
  await stage('Parking your car', 0.93, 60);
  jeep = new Jeep(scene, settings.vehicle || 'jeep');
  jeep.obstacles = obstacles;
  walker = new Walker(scene);
  const sp = nearestRoadAnywhere(START.x, START.z);
  jeep.place(sp.x, sp.z, sp.heading);
  await stage('Drawing the map', 0.95, 180);
  mapUI = new MapUI({ landmarks, onTravel: fastTravel });
  { const L = landmarks.list.find((l) => l.id === 'landmannalaugar'); if (L) surfaceUniforms.uRhyolite.value.set(L.x, L.z, 170); }
  surfaceUniforms.uSnowLine.value = [16, 18, 24, 32, 55, 95, 95, 85, 55, 32, 24, 18][clock.month];
  // Compile every shader now, in parallel where the browser allows, instead of freezing the
  // first frame doing it.
  await stage('Mixing the colours', 1, 1200);
  // Never wait more than 2.5 s here; anything left compiles on the first frame as before.
  try { await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 2500))]); } catch { renderer.compile(scene, camera); }
  stageTimes[current] = Math.round(performance.now() - tStage);
  console.info(`World built in ${Math.round(performance.now() - t0)} ms`, stageTimes);
}

// ---------- Helpers ----------
function wind(t) {
  const W = CONFIG.wind;
  const dir = 0.6 + windNoise(t * 0.01, 1.5) * 1.2; // slowly turning, mostly from the east
  const strength = W.baseStrength + W.gustStrength * (0.5 + 0.5 * windNoise(t * W.gustSpeed, 4.2));
  return { x: Math.sin(dir) * strength, z: Math.cos(dir) * strength, strength, dir };
}

function describePlace(x, z) {
  const n = landmarks.nearest(x, z);
  if (n.dist < 110) return { label: n.lm.name, nearId: n.lm.id, nearDist: n.dist };
  let best = null, bd = Infinity;
  for (const p of PLACES) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
  let label;
  if (bd < 70) label = best.name;
  else if (bd < 180) label = `Near ${best.name}`;
  else if (coastAt(x, z) > 315) label = 'The highlands';
  else if (z > 480) label = 'The south coast';
  else if (x > 1150) label = 'The east fjords';
  else if (z < -600) label = 'The north';
  else if (x < -1350) label = 'The west';
  else label = 'Open country';
  return { label, nearId: n.lm.id, nearDist: n.dist };
}

function activePos() { return mode === 'walk' ? walker.pos : jeep.pos; }
function lookingUp() { return mode === 'lookup' ? look.pitch > 0.35 : mode === 'walk' && (walkTilt || (sitting && look.pitch > 0.35)); }
// True when the view actually holds the aurora: facing roughly north, or looking close to straight up.
const _fwd = new THREE.Vector3();
function facingLights() {
  camera.getWorldDirection(_fwd);
  if (_fwd.y > 0.8) return true;
  const bearing = Math.atan2(_fwd.x, -_fwd.z); // 0 = north
  return Math.abs(bearing) < 1.2;
}

function guaranteeLevel() {
  const G = CONFIG.aurora.guarantee;
  if (clock.midnightSun) return 0;
  if (store.data.sightings.length > 0 || clock.nightIndex !== startNight) return 0;
  const elapsed = clock.gameHours - startGameHours; // game hours (equal to real minutes at normal speed)
  if (elapsed < G.startMinutes || elapsed > G.startMinutes + G.maxMinutes) return 0;
  return smoothstep(G.startMinutes, G.startMinutes + 0.4, elapsed);
}

function nextWindowLabel() {
  const now = clock.gameHours;
  for (let h = now + 0.25; h < now + 6; h += 0.25) {
    if (clock.darkness(((h % 24) + 24) % 24) < CONFIG.aurora.minDarkness) continue;
    if (forecast.predictedAt(h, now) >= CONFIG.aurora.minKp + 0.4) return clock.label(Math.round(h * 4) / 4);
  }
  return null;
}

// ---------- Camera ----------
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const l = input.consumeLook();
  if (mode === 'photo') return; // camera placed by hand from the console
  if (mode === 'chase') {
    look.orbit -= l.dx * 0.006;
    if (!l.dx) look.orbit *= 1 - Math.min(1, dt * 0.8);
    // The camera follows a smoothed heading, so turning does not whip the scenery around.
    const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    camHeading = camHeading == null ? jeep.heading : camHeading + wrapA(jeep.heading - camHeading) * Math.min(1, dt * 2.2);
    const h = camHeading + look.orbit;
    const cd = jeep.model.camDist + (jeep.boosting ? 1.2 : 0), ch = jeep.model.camHeight;
    const desired = new THREE.Vector3(jeep.pos.x - Math.sin(h) * cd, jeep.pos.y + ch, jeep.pos.z - Math.cos(h) * cd);
    desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 1.5);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    if (jeep.speed < 0.3 && camera.position.distanceTo(desired) < 0.08) camera.position.copy(desired);
    camTarget.set(jeep.pos.x + Math.sin(h) * 14, jeep.pos.y + ch * 0.7, jeep.pos.z + Math.cos(h) * 14);
    camera.lookAt(camTarget);
    // Knocks from rocks and walls shake the camera briefly.
    if (shake > 0.01) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
    // Wider view at speed and under nitro.
    const fov = 52 + Math.min(1, jeep.speed / 60) * 6 + (jeep.boosting ? 8 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  } else if (mode === 'lookup') {
    look.yaw -= l.dx * 0.005;
    look.pitch = clamp(look.pitch - l.dy * 0.005, -0.1, 1.5);
    const h = jeep.heading + look.yaw;
    camera.position.set(jeep.pos.x - Math.sin(jeep.heading) * 0.3, jeep.pos.y + jeep.model.eye, jeep.pos.z - Math.cos(jeep.heading) * 0.3);
    camTarget.set(camera.position.x + Math.sin(h) * Math.cos(look.pitch), camera.position.y + Math.sin(look.pitch), camera.position.z + Math.cos(h) * Math.cos(look.pitch));
    camera.lookAt(camTarget);
  } else {
    look.walkYaw -= l.dx * 0.006;
    if (sitting) {
      look.pitch = clamp(look.pitch - l.dy * 0.005, -0.2, 1.5);
      const h = walker.heading + look.walkYaw;
      camera.position.set(walker.pos.x, walker.pos.y + 1.05, walker.pos.z);
      camTarget.set(camera.position.x + Math.sin(h) * Math.cos(look.pitch), camera.position.y + Math.sin(look.pitch), camera.position.z + Math.cos(h) * Math.cos(look.pitch));
      camera.lookAt(camTarget);
    } else if (walkTilt) {
      look.pitch = clamp(look.pitch - l.dy * 0.005, 0.3, 1.5);
      const h = walker.heading + look.walkYaw;
      camera.position.set(walker.pos.x - Math.sin(h) * 1.2, walker.pos.y + 1.9, walker.pos.z - Math.cos(h) * 1.2);
      camTarget.set(camera.position.x + Math.sin(h) * Math.cos(look.pitch), camera.position.y + Math.sin(look.pitch), camera.position.z + Math.cos(h) * Math.cos(look.pitch));
      camera.lookAt(camTarget);
    } else {
      if (!l.dx) look.walkYaw *= 1 - Math.min(1, dt * 0.6);
      const h = walker.heading + look.walkYaw;
      const desired = new THREE.Vector3(walker.pos.x - Math.sin(h) * 6, walker.pos.y + 2.8, walker.pos.z - Math.cos(h) * 6);
      desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 1);
      camera.position.lerp(desired, Math.min(1, dt * 5));
      camTarget.set(walker.pos.x, walker.pos.y + 1.6, walker.pos.z);
      camera.lookAt(camTarget);
    }
  }
}

function cycleCamera() {
  if (mode === 'chase') { enterLookUp(); hud.toast('Looking up, facing north. Drag to look around.', { seconds: 2.5 }); }
  else if (mode === 'lookup') {
    if (jeep.speed > 2.5) { mode = 'chase'; hud.toast('Slow down to step out.', { seconds: 2.5 }); }
    else { mode = 'walk'; walkTilt = false; walker.enter(jeep); look.walkYaw = 0; hud.toast('On foot. Walk with the same keys. Press L to look up.', { seconds: 3.5 }); }
  } else { mode = 'chase'; walker.exit(); }
  syncLookButton();
}
// The lights usually sit to the north, so looking up turns you that way, the way a person would.
function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
function enterLookUp() { mode = 'lookup'; look.yaw = wrapAngle(Math.PI - jeep.heading); look.pitch = 0.75; }
function toggleLookUp() {
  if (mode === 'walk') { walkTilt = !walkTilt; look.pitch = 0.75; if (walkTilt) look.walkYaw = wrapAngle(Math.PI - walker.heading); }
  else if (mode === 'lookup') mode = 'chase';
  else enterLookUp();
  syncLookButton();
}
function syncLookButton() { $('t-look').setAttribute('aria-pressed', String(lookingUp() || mode === 'lookup')); }

// ---------- Sightings ----------
const TYPE_RANK = { [AURORA_TYPES.arc]: 0, [AURORA_TYPES.curtains]: 1, [AURORA_TYPES.pink]: 2, [AURORA_TYPES.red]: 3, [AURORA_TYPES.corona]: 4 };

// manual: the player pressed the shutter. That works any time they look up, aurora or not.
function logSighting(a, { manual = false } = {}) {
  const p = activePos();
  const where = describePlace(p.x, p.z);
  const type = a.active ? a.type : a.dark < CONFIG.aurora.minDarkness ? 'Sky' : 'Night sky';
  const s = {
    n: store.nextSightingNumber(), place: where.label, nearId: where.nearId, nearDist: Math.round(where.nearDist),
    hour: clock.hourOfDay, clock: clock.label(), kp: Math.round(a.kp * 10) / 10, type, season: clock.season,
    x: Math.round(p.x), z: Math.round(p.z), date: new Date().toISOString(),
  };
  if (a.active) { loggedThisWindow = true; lastLoggedType = a.type; }
  lastLogReal = clock.realSeconds;
  lastLogPos = { x: p.x, z: p.z };
  lastShot = performance.now();
  // A soft flash and a click, like a camera.
  $('flash').classList.remove('is-on'); void $('flash').offsetWidth; $('flash').classList.add('is-on');
  haptics.play('success', 0);
  captureRequest = (dataUrl) => {
    const img = new Image();
    img.onload = () => {
      sessionImages.set(s.n, img);
      const tc = document.createElement('canvas');
      tc.width = 320; tc.height = 200;
      const ctx = tc.getContext('2d');
      const r = img.width / img.height, cr = 320 / 200;
      let sw = img.width, sh = img.height, sx = 0, sy = 0;
      if (r > cr) { sw = img.height * cr; sx = (img.width - sw) / 2; } else { sh = img.width / cr; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 320, 200);
      store.addSighting(s, tc.toDataURL('image/jpeg', 0.72));
    };
    img.src = dataUrl;
  };
  const what = a.active ? `Sighting #${s.n}: ${s.type.toLowerCase()} at ${s.place}.` : `Postcard #${s.n} saved at ${s.place}.`;
  hud.toast(what, { seconds: 6, priority: 3, action: { label: 'View postcard', run: () => openPostcard(s.n) } });
  if (a.active) checkChallenge(s);
}

function checkChallenge(s) {
  const rec = store.data.challenges[challenge.key];
  if (rec?.done) return;
  if (challenge.check(s)) {
    store.data.challenges[challenge.key] = { id: challenge.id, done: new Date().toISOString() };
    haptics.play('success', 0);
    store.save();
    setTimeout(() => hud.toast(`Daily challenge done: ${challenge.title}. Stamp added to your notebook.`, { seconds: 6, priority: 3 }), 7200);
  }
}

// ---------- Postcards ----------
const pcDialog = $('postcard');
let pcSighting = null;
async function openPostcard(n, sharedImg) {
  const s = n === 'shared' ? pcSighting : store.data.sightings.find((x) => x.n === n);
  if (!s) return;
  pcSighting = s;
  let img = sharedImg || sessionImages.get(s.n);
  if (!img) {
    const t = store.thumb(s.n);
    if (t) img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = t; });
  }
  await drawPostcard($('postcard-canvas'), s, img);
  $('pc-play').hidden = n !== 'shared';
  if ($('notebook').open) $('notebook').close();
  if (!pcDialog.open) pcDialog.showModal();
}
pcDialog.querySelector('[data-close]').addEventListener('click', () => pcDialog.close());
$('pc-save').addEventListener('click', async () => download(await canvasBlob($('postcard-canvas')), `chasing-green-sighting-${pcSighting.n}.png`));
$('pc-share').addEventListener('click', async () => {
  const r = await sharePostcard($('postcard-canvas'), pcSighting, linkFor(pcSighting));
  if (r === 'downloaded') hud.toast('Sharing is not available here, so the image was saved instead.', { seconds: 4 });
});
$('pc-link').addEventListener('click', async () => {
  const link = linkFor(pcSighting);
  try { await navigator.clipboard.writeText(link); $('pc-link').textContent = 'Link copied'; }
  catch { prompt('Copy this link', link); }
  setTimeout(() => ($('pc-link').textContent = 'Copy link'), 2000);
});
$('pc-play').addEventListener('click', () => { pcDialog.close(); history.replaceState(null, '', location.pathname); });

// A shared link renders that sighting's sky at its spot, then shows the postcard.
function renderSharedSighting(s) {
  pcSighting = s;
  clock.season = s.season;
  const saved = clock.gameHours;
  clock.gameHours = s.hour < 12 ? 24 + s.hour : s.hour;
  const y = heightAt(s.x, s.z);
  camera.position.set(s.x, Math.max(y, 0) + 2.4, s.z);
  camera.lookAt(s.x, camera.position.y + 1.1, s.z - 1.2);
  const kp = s.kp;
  const A = CONFIG.aurora;
  const state = {
    vis: 0.2 + 0.8 * smoothstep(A.minKp, A.fullKp, kp), curtains: 1 + 3 * smoothstep(A.minKp, 7.5, kp),
    pink: s.type === AURORA_TYPES.pink ? 1 : smoothstep(4.5, 6.5, kp), red: s.type === AURORA_TYPES.red ? 1 : 0,
    corona: s.type === AURORA_TYPES.corona ? 1 : 0,
  };
  if (state.corona) camera.lookAt(s.x, camera.position.y + 5, s.z - 0.6);
  Object.assign(aurora.smooth, state);
  aurora.update(0, 40, camera, state);
  sky.update({ camera, clock, cloud: 0.05, cloudOffset, city: { overhead: 0, horizon: 0, dirX: 1, dirZ: 0 }, auroraVis: state.vis, auroraTint: aurora.tint, t: 40 });
  waterUniforms.uLight.value = 0.25;
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
  clock.gameHours = saved;
  clock.month = Number.isInteger(settings.month) ? settings.month : new Date().getMonth();
  const img = new Image();
  img.onload = () => openPostcard('shared', img);
  img.src = url;
}

// ---------- Landmarks ----------
const card = { el: $('infocard'), name: $('info-name'), desc: $('info-desc'), legend: $('info-legend'), fact: $('info-fact'), stamp: $('info-stamp'), current: null };
$('info-more').addEventListener('click', () => {
  const open = card.el.classList.toggle('is-expanded');
  $('info-more').setAttribute('aria-expanded', String(open));
  $('info-more').textContent = open ? 'Less' : 'More';
});
$('info-close').addEventListener('click', () => {
  infoDismissed = card.current?.id;
  card.el.hidden = true;
  card.el.classList.remove('is-expanded');
  $('info-more').setAttribute('aria-expanded', 'false');
  $('info-more').textContent = 'More';
});
$('info-share').addEventListener('click', async () => {
  const lm = card.current; if (!lm) return;
  const text = `${lm.name}: ${lm.fact} (from Chasing Green, a road trip around Iceland)`;
  try {
    if (navigator.share) await navigator.share({ title: lm.name, text });
    else { await navigator.clipboard.writeText(text); hud.toast('Fact copied to your clipboard.', { seconds: 2.5 }); }
  } catch { /* cancelled */ }
});

function updateLandmarks(p) {
  const { lm, dist } = landmarks.nearest(p.x, p.z);
  const reach = lm.reach || CONFIG.landmarkRadius;
  if (dist < reach) {
    if (store.stamp(lm.id)) {
      hud.toast(`New stamp: ${lm.name}.`, { seconds: 4, priority: 2 });
      haptics.play('success', 0);
      if (card.current === lm) card.stamp.innerHTML = stampSvg(lm.name, lm.glyph, true, 'card');
    }
  }
  if (dist < reach * 2.6) {
    if (card.current !== lm) {
      card.current = lm;
      card.name.textContent = lm.name;
      card.desc.textContent = lm.desc || '';
      card.legend.textContent = lm.legend || '';
      card.legend.hidden = !lm.legend;
      card.fact.textContent = lm.fact;
      card.stamp.innerHTML = stampSvg(lm.name, lm.glyph, !!store.data.stamps[lm.id], 'card');
      card.shownAt = null;
    }
    card.el.hidden = infoDismissed === lm.id;
    // The card tucks itself away after a while of driving so it never sits over the view for good.
    if (!card.el.hidden && started && !card.el.classList.contains('is-expanded')) {
      card.shownAt ??= performance.now();
      if (performance.now() - card.shownAt > 12000) { infoDismissed = lm.id; card.el.hidden = true; }
    }
  } else {
    card.el.hidden = true;
    card.current = null;
    if (infoDismissed === lm.id) infoDismissed = null;
  }
  return { lm, dist };
}

// ---------- UI wiring ----------
const notebook = new Notebook({ onPostcard: (n) => openPostcard(n), getChallenge: () => challenge });
$('btn-notebook').addEventListener('click', () => notebook.open());
$('btn-camera').addEventListener('click', cycleCamera);
$('btn-mute').addEventListener('click', () => setMuted(!audio.muted));
function setMuted(m) {
  audio.setMuted(m);
  settings.muted = m; store.save();
  $('btn-mute').setAttribute('aria-pressed', String(m));
  $('btn-mute').setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
}
setMuted(audio.muted);

const recorder = new ClipRecorder(canvas, () => audio.recordDest?.stream);
$('btn-record').addEventListener('click', toggleRecording);
function toggleRecording() {
  const btn = $('btn-record');
  if (recorder.recording) { recorder.stop(); return; }
  if (!ClipRecorder.supported()) { hud.toast('Clip recording is not supported in this browser.', { seconds: 3 }); return; }
  const ok = recorder.start(15, (left) => {
    btn.setAttribute('aria-label', `Recording, ${Math.ceil(left)} seconds left. Select to stop.`);
    hud.toast(`Recording clip, ${Math.ceil(left)}s left`, { seconds: 1, priority: 0 });
  }, (blob, ext) => {
    btn.classList.remove('is-recording');
    btn.setAttribute('aria-label', 'Record a 15 second clip');
    hud.toast('Clip ready.', { seconds: 8, priority: 2, action: { label: 'Download clip', run: () => download(blob, `chasing-green-clip.${ext}`) } });
  });
  if (ok) btn.classList.add('is-recording');
}

const settingsDialog = $('settings');
function openSettings() {
  $('set-quality').value = qualityName;
  $('set-month').value = String(clock.month);
  $('set-speed').value = String(clock.speed);
  $('set-touch').value = settings.touch;
  $('set-rocks').value = settings.rocks || 'normal';
  $('set-nitro').value = settings.nitro || 'on';
  $('set-haptics').value = settings.haptics || 'on';
  settingsDialog.showModal();
  settingsDialog.dispatchEvent(new Event('sync'));
}
$('btn-settings').addEventListener('click', openSettings);
sheet.register('settings', openSettings);
sheet.register('notebook', () => notebook.open());
pcDialog.addEventListener('click', (e) => { if (e.target === pcDialog) pcDialog.close(); });
$('set-haptics').addEventListener('change', (e) => {
  settings.haptics = e.target.value; store.save();
  haptics.enabled = settings.haptics !== 'off';
  haptics.play('medium');
});
$('set-quality').addEventListener('change', (e) => setQuality(e.target.value, true));
function setQuality(name, save) {
  qualityName = name; Q = qualityFor(name);
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight, false);
  aurora?.setSteps(Q.auroraSteps);
  camera.far = Q.far || 3000; camera.updateProjectionMatrix();
  if (world) {
    if (Q.post && !post) post = new Post(renderer, scene, camera, { ao: !!Q.ao });
    else if (!Q.post) post = null;
    post?.setSize();
  }
  if (sky) {
    sky.shadowsWanted = renderer.shadowMap.enabled && Q.shadowSize > 0;
    if (sky.shadowsWanted && sky.sun.shadow.mapSize.x !== Q.shadowSize) {
      sky.sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
      sky.sun.shadow.map?.dispose();
      sky.sun.shadow.map = null;
    }
  }
  if (save) { settings.quality = name; store.save(); }
}
$('set-month').addEventListener('change', (e) => setMonth(+e.target.value, true));
// Months drive the sun path, darkness and aurora chance. The visual season follows from the month.
function monthCardHTML() {
  const m = clock.m;
  const day = Math.max(0, Math.min(24, m.sunset - m.sunrise));
  const dark = clock.darkHours();
  return `<h3>${m.name}</h3><dl><div><dt>Daylight</dt><dd>${day.toFixed(1)} h</dd></div><div><dt>Dark hours</dt><dd>${dark.toFixed(1)} h</dd></div><div><dt>Aurora chance</dt><dd>${m.chance}</dd></div></dl><p>${m.tip}</p>`;
}
function renderMonthCards() { document.querySelectorAll('.month-card').forEach((el) => (el.innerHTML = monthCardHTML())); }
function setMonth(m, announce = false) {
  clock.month = m; settings.month = m; store.save();
  forecast.monthFactor = clock.m.aurora;
  forecast.nights.clear();
  document.querySelectorAll('.month-select').forEach((sel) => (sel.value = String(m)));
  renderMonthCards();
  setSeason(clock.season, announce);
  // Snow line by month: low in midwinter, high glaciers only in summer.
  surfaceUniforms.uSnowLine.value = [16, 18, 24, 32, 55, 95, 95, 85, 55, 32, 24, 18][m];
}
function setSeason(season, announce = true) {
  if (world) { paintTerrain(season); scatter?.setSeason(season); }
  if (!announce) return;
  if (started) hud.toast(clock.midnightSun ? `${clock.m.name}. Midnight sun. No aurora this month.` : `${clock.m.name}. Aurora chance: ${clock.m.chance.toLowerCase()}. ${clock.m.tip}`, { seconds: 5 });
}
$('set-speed').addEventListener('change', (e) => { clock.speed = +e.target.value; settings.speed = clock.speed; store.save(); });
$('set-rocks').addEventListener('change', (e) => { settings.rocks = e.target.value; store.save(); hud.toast('Rock density changes on the next load. Reload the page to apply it.', { seconds: 4 }); });
$('set-touch').addEventListener('change', (e) => { settings.touch = e.target.value; store.save(); syncTouch(); });
$('set-reset').addEventListener('click', () => {
  if (confirm('Clear all sightings, stamps and challenge progress?')) { store.clear(); hud.toast('Notebook cleared.', { seconds: 2.5 }); }
});
// Phones: a collapsed radio, a landscape prompt in portrait, fullscreen and a landscape lock when allowed.
function touchLayout() {
  const touch = document.body.classList.contains('has-touch');
  if (touch) hud.el.radio.classList.add('is-collapsed');
  const portrait = matchMedia('(orientation: portrait)').matches;
  $('rotate').hidden = !(touch && portrait && started && !settings.keepPortrait);
}
$('rotate-dismiss').addEventListener('click', () => { settings.keepPortrait = true; store.save(); $('rotate').hidden = true; });
matchMedia('(orientation: portrait)').addEventListener('change', () => touchLayout());
async function goLandscape() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    if (screen.orientation?.lock) await screen.orientation.lock('landscape');
  } catch { /* not allowed here; the prompt covers it */ }
}
document.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.quick;
  haptics.play('select');
  if (k !== 'mute') settingsDialog.close();
  if (k === 'camera') cycleCamera();
  else if (k === 'record') toggleRecording();
  else if (k === 'mute') setMuted(!audio.muted);
  else if (k === 'fullscreen') goLandscape();
}));
function syncTouch() {
  const show = settings.touch === 'on' || (settings.touch === 'auto' && (isTouch || matchMedia('(pointer: coarse)').matches));
  $('touch').hidden = !show;
  document.body.classList.toggle('has-touch', show);
}
input.bindSteerPair($('t-left'), $('t-right'), () => haptics.play('select', 0));
input.bindGasButton($('t-gas'), (up) => { if (up) nitroHint(); });
input.bindTouchButton($('t-brake'), 'brake');
// Nitro lives on Go: slide the finger up from Go to boost, back down to ease off. The ring
// around Go shows how much is left.
let nitroHinted = false;
function nitroHint() {
  haptics.play('heavy', 0);
  if (nitroHinted) return;
  nitroHinted = true;
  hud.toast('Nitro! Slide back down to ease off.', { seconds: 2, priority: 2 });
}
$('t-look').addEventListener('click', toggleLookUp);
$('sky-hint').addEventListener('click', () => { haptics.play('medium', 0); toggleLookUp(); });
$('t-shot').addEventListener('click', () => { if (lastAurora && performance.now() - lastShot > 1200) logSighting(lastAurora, { manual: true }); });
// Every control answers the finger: a tick for small buttons, firmer for the pedals.
const PAD_FEEL = { 't-gas': 'light', 't-brake': 'medium' };
document.querySelectorAll('.pad:not(.pad-steer)').forEach((el) => haptics.press(el, PAD_FEEL[el.id] || 'select'));
document.querySelectorAll('.icon-btn, .tile, .btn, .minimap').forEach((el) => haptics.press(el));

// Intro
document.querySelectorAll('.month-select').forEach((sel) => {
  sel.innerHTML = CONFIG.months.map((m, i) => `<option value="${i}">${m.name}</option>`).join('');
  sel.value = String(clock.month);
  sel.addEventListener('change', (e) => setMonth(+e.target.value, started));
});
forecast.monthFactor = clock.m.aurora;
renderMonthCards();
$('intro-challenge').innerHTML = `Today’s challenge: <strong>${challenge.title}</strong>`;
if (isTouch) document.querySelector('.keys-hint').textContent = 'Steer with the arrows, press Go to drive and Brake to slow down or reverse. Slide up from Go for a nitro boost. Tap Look when the radio says the aurora is out. Drag to look around.';
const startBtn = $('start');
startBtn.disabled = true;
startBtn.addEventListener('click', () => {
  audio.start();
  audio.setMuted(audio.muted);
  started = true;
  store.data.trips++; store.save();
  $('intro').classList.add('is-leaving');
  setTimeout(() => ($('intro').hidden = true), 900);
  hud.show();
  syncTouch();
  if (isTouch) { touchLayout(); goLandscape(); }
  canvas.focus();
  hud.toast('Watch the Kp on the aurora radio. Tap the (i) next to it to learn what it means.', { seconds: 7 });
});

addEventListener('keydown', (e) => {
  if (!started || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k === 'c') cycleCamera();
  else if (k === 'l') toggleLookUp();
  else if (k === 'u') setMuted(!audio.muted);
  else if (k === 'm') mapUI?.open();
  else if (k === 'v') cycleVehicle();
  else if (k === 'n') notebook.open();
  else if (k === 'r') toggleRecording();
  else if (k === 'x') toggleSit();
  else if (k === 'h') learn.open();
});

// ---------- Learn, sitting, nitro option ----------
const learn = new Learn();
sheet.register('learn', () => learn.open());
// Sit down on foot: lower view, free look, and time passes faster while you rest and watch.
function toggleSit(force) {
  if (mode !== 'walk') { hud.toast('Step out of the car first (C), then sit down.', { seconds: 2.5 }); return; }
  sitting = force ?? !sitting;
  walker.setSitting?.(sitting);
  if (sitting) {
    sitSpeedBefore = clock.speed; clock.speed = Math.max(clock.speed, 6);
    look.pitch = 0.45; look.walkYaw = 0;
    hud.toast('Sitting down. Time passes faster while you rest. Drag to look around, X to stand.', { seconds: 4, priority: 2 });
  } else clock.speed = sitSpeedBefore;
  $('t-sit').setAttribute('aria-pressed', String(sitting));
}
$('t-sit').addEventListener('click', () => toggleSit());
function applyNitroSetting() {
  const on = settings.nitro !== 'off'; // on unless switched off in Settings
  input.nitroAllowed = on;
  $('nitro-bar').parentElement.hidden = !on;
  document.body.classList.toggle('nitro-off', !on);
}
$('set-nitro').addEventListener('change', (e) => { settings.nitro = e.target.value; store.save(); applyNitroSetting(); });
applyNitroSetting();

// ---------- Vehicles ----------
function setVehicle(kind, announce = true) {
  if (!VEHICLES[kind]) return;
  settings.vehicle = kind; store.save();
  if (jeep) {
    jeep.setType(kind);
    audio.setEngine(VEHICLES[kind].engine);
    if (announce) hud.toast(`Now driving the ${VEHICLES[kind].name.toLowerCase()}.`, { seconds: 2.5, priority: 2 });
  }
  $('intro-car').innerHTML = `Driving the <strong>${VEHICLES[kind].name}</strong>. Tap or click your car any time to switch.`;
  renderGarage();
}
function cycleVehicle() {
  const i = VEHICLE_ORDER.indexOf(jeep.kind);
  setVehicle(VEHICLE_ORDER[(i + 1) % VEHICLE_ORDER.length]);
}
function renderGarage() {
  const list = $('garage-list');
  if (!list) return;
  const thumbs = $('garage').open || list.dataset.wantThumbs ? carThumbs(VEHICLE_ORDER) : {};
  const bar = (v, max) => `<i><b style="width:${Math.round(Math.min(1, v / max) * 100)}%"></b></i>`;
  list.innerHTML = VEHICLE_ORDER.map((k) => {
    const v = VEHICLES[k];
    const off = (v.offroad.gravel + v.offroad.moss + v.offroad.sand) / 3;
    const on = (settings.vehicle || 'jeep') === k;
    const img = thumbs[k] ? `<img class="car-pic" src="${thumbs[k]}" alt="" />` : '';
    return `<button class="car-card ${on ? 'is-on' : ''}" data-pick="${k}" aria-pressed="${on}">${img}<h3>${v.name}</h3><p class="car-tag">${v.tagline}</p><p class="car-blurb">${v.blurb}</p>
      <span class="car-stats"><span>Top speed</span>${bar(v.maxSpeed, 66)}<span>Off-road</span>${bar(off, 1)}<span>Water</span>${bar(v.wade, 1.9)}</span></button>`;
  }).join('');
  list.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { haptics.play('medium'); setVehicle(b.dataset.pick); $('garage').close(); }));
}
function openGarage() { $('garage-list').dataset.wantThumbs = '1'; renderGarage(); $('garage').showModal(); }
sheet.register('garage', openGarage);
sheet.register('map', () => mapUI?.open());
// Tap the car itself to switch to the next one.
const carRay = new THREE.Raycaster(), carTap = new THREE.Vector2();
let tapStart = null;
canvas.addEventListener('pointerdown', (e) => { tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  const s = tapStart; tapStart = null;
  if (!s || !jeep || !started || mode === 'walk') return;
  if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8 || performance.now() - s.t > 400) return;
  const r = canvas.getBoundingClientRect();
  carTap.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  carRay.setFromCamera(carTap, camera);
  if (carRay.intersectObject(jeep.body, true).length) { haptics.play('medium', 0); cycleVehicle(); }
});
setVehicle(settings.vehicle || 'jeep', false);

// Spray, dust, splashes and knocks.
function vehicleEffects(dt) {
  const fx = Math.sin(jeep.heading), fz = Math.cos(jeep.heading), rx = fz, rz = -fx;
  const sp = jeep.speed;
  const wheelsWorld = jeep.wheels.map((w) => [jeep.pos.x + rx * w.x + fx * w.z, jeep.pos.z + rz * w.x + fz * w.z, w.x]);
  const inPuddle = wheelsWorld.some(([x, z]) => puddles.at(x, z));
  const inWater = jeep.depth > 0.05;
  // Splash on the way in.
  if (inPuddle && !wasInPuddle && sp > 3) { audio.splash(Math.min(1, sp / 30)); haptics.play('light'); }
  if (inWater && !wasInWater && sp > 2) { audio.splash(Math.min(1, sp / 18 + jeep.depth * 0.4)); haptics.play(sp > 10 ? 'heavy' : 'medium'); }
  wasInPuddle = inPuddle; wasInWater = inWater;
  // Spray from the wheels, thrown out sideways and up.
  if ((inWater || inPuddle) && sp > 1.5) {
    const amount = inWater ? Math.min(1, sp / 15) * (0.6 + Math.min(1, jeep.depth)) : Math.min(1, sp / 25);
    for (const [x, z, side] of wheelsWorld) {
      const y = (inWater ? waterLevelAt(x, z) : heightAt(x, z)) + 0.15;
      const out = Math.sign(side) * (1.2 + sp * 0.08);
      jeep.root && spray.emit(x, y, z, rx * out - fx * sp * 0.15, 2.5 + sp * 0.12, rz * out - fz * sp * 0.15, Math.ceil(amount * 4), 1.6, 0.8);
    }
  }
  jeep.wadeLevel = inWater ? Math.min(1, jeep.depth * 0.7 + sp / 25) : inPuddle ? Math.min(0.6, sp / 30) : 0;
  // Dust off-road.
  if (!inWater && sp > 8 && (jeep.surface === 'gravel' || jeep.surface === 'sand' || jeep.surface === 'moss')) {
    const rear = wheelsWorld.slice(2);
    if (Math.random() < Math.min(1, sp / 30)) for (const [x, z] of rear) dust.emit(x, heightAt(x, z) + 0.3, z, -fx * 2, 0.6, -fz * 2, 1, 1.2, 1.6);
  }
  // Landings after a jump: thud, camera knock, a burst of dust or spray.
  if (jeep.landImpact > 2.5) {
    audio.thud(jeep.landImpact * 1.6);
    haptics.impact(jeep.landImpact * 1.6);
    shake = Math.min(0.9, jeep.landImpact * 0.06);
    for (const [x, z] of wheelsWorld) dust.emit(x, heightAt(x, z) + 0.3, z, 0, 1.5, 0, 4, 3, 1.4);
  }
  // Knocks.
  if (jeep.impact > 2.5) {
    audio.thud(jeep.impact);
    haptics.impact(jeep.impact);
    shake = Math.min(0.6, jeep.impact * 0.035);
    if (jeep.impact > 12) hud.toast(jeep.impactKind === 'rock' ? 'Ouch. That rock did not move.' : 'Bump! Mind the scenery.', { seconds: 2, priority: 1 });
  }
  shake *= Math.max(0, 1 - dt * 6);
  drivingHaptics(dt);
}

// Feel the drive: a kick when nitro fires and a soft pulse while it burns, an ABS-style
// flutter under hard braking, a tick each time the speed climbs past another 20 km/h,
// and a light grumble on rough ground.
let wasBoosting = false, hapticClock = 0, lastSpeedStep = 0;
function drivingHaptics(dt) {
  hapticClock -= dt;
  const kmh = jeep.kmh;
  if (jeep.boosting && !wasBoosting) haptics.play('heavy');
  wasBoosting = jeep.boosting;
  const step = Math.floor(kmh / 20);
  if (step > lastSpeedStep && kmh > 15) haptics.play('select');
  lastSpeedStep = step;
  if (hapticClock > 0) return;
  if (jeep.boosting) { haptics.play('light'); hapticClock = 0.22; }
  else if (jeep.braking && kmh > 25) { haptics.play('light'); hapticClock = 0.16; }
  else if (kmh > 20 && !jeep.air && (jeep.surface === 'gravel' || jeep.surface === 'sand' || jeep.surface === 'moss')) { haptics.play('select'); hapticClock = Math.max(0.3, 0.7 - kmh / 300); }
}

// Jump to any spot: the nearest road there, facing the place if it is a landmark.
function fastTravel(x, z, label, face) {
  const r = nearestRoadAnywhere(x, z);
  if (!r) return;
  const d = Math.hypot(x - r.x, z - r.z);
  const heading = face && d > 8 ? Math.atan2(x - r.x, z - r.z) : r.heading;
  if (mode === 'walk') walker.exit();
  mode = 'chase';
  jeep.place(r.x, r.z, heading);
  camHeading = heading;
  camera.position.set(r.x - Math.sin(heading) * jeep.model.camDist, heightAt(r.x, r.z) + jeep.model.camHeight, r.z - Math.cos(heading) * jeep.model.camDist);
  camera.lookAt(r.x, heightAt(r.x, r.z) + 1.5, r.z);
  infoDismissed = null;
  hud.toast(label ? `Arrived at ${label}.` : `Arrived near ${describePlace(r.x, r.z).label}.`, { seconds: 3, priority: 2 });
}

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  // Skip frames to hold the cap: 30 fps on phones, 20 fps behind the intro and menus.
  const idle = !started || !!document.querySelector('dialog[open]');
  if (now - last < (idle ? 1000 / 20 : FRAME_GAP) - 2) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!world) return;
  const paused = !started || !!document.querySelector('dialog[open]');
  input.enabled = !paused;
  const t = now / 1000;

  if (!paused) clock.tick(dt);
  const w = wind(clock.realSeconds);

  if (sitting && (mode !== 'walk' || input.throttle || input.steer)) toggleSit(false);
  $('t-sit').hidden = mode !== 'walk';
  if (mode === 'walk') {
    jeep.update(dt, input, w, false);
    walker.update(dt, input, jeep.pos);
    obstacles.resolve(walker.pos, 0.4);
  } else {
    jeep.update(paused ? 0 : dt, input, w, !paused);
    if (!paused) vehicleEffects(dt);
  }
  spray.update(dt);
  dust.update(dt);

  const p = activePos();
  const g = started ? guaranteeLevel() : 0;
  if (g > 0.5 && !guaranteeToastShown) {
    guaranteeToastShown = true;
    hud.toast('The radio crackles: activity is building and the sky is clearing. Find a dark spot and look up.', { seconds: 8, priority: 2 });
  }
  const a = forecast.evaluate({ x: p.x, z: p.z, clock, dt, guaranteeActive: g });

  updateCamera(dt);
  forecast.cloudOffset(clock.realSeconds, cloudOffset);
  auroraVisSmoothed = aurora.update(dt, t, camera, a);
  const { dark, sunDir } = sky.update({ camera, clock, cloud: a.cloud, cloudOffset, city: a.city, auroraVis: auroraVisSmoothed, auroraTint: aurora.tint, t, focus: p });
  surfaceUniforms.uCloudCover.value = a.cloud;
  surfaceUniforms.uCloudOffset.value.copy(cloudOffset);
  surfaceUniforms.uSunDir.value.copy(sunDir);
  surfaceUniforms.uSunUp.value = smoothstep(-2, 8, clock.sunElevation()) * (1 - dark);
  surfaceUniforms.uTime.value = t;
  if (postReflectorMat) postReflectorMat.emissiveIntensity = dark * 0.8;
  if (lakeMat) lakeMat.emissive.copy(aurora.tint).multiplyScalar(auroraVisSmoothed * 0.1 * dark);

  landmarks.update(dt, t, { wind: w, dark, auroraTint: aurora.tint, auroraVis: auroraVisSmoothed, player: p });
  // Snow showers: winter months, cold ground (high or far north) and thick cloud, in drifting bands.
  const cold = clock.month >= 9 || clock.month <= 3;
  const band = snowNoise(p.x * 0.0022 + clock.realSeconds * 0.004, p.z * 0.0022) * 0.5 + 0.5;
  const altitude = Math.max(0, (heightAt(p.x, p.z) - 6) / 30) + Math.max(0, -p.z / 1050);
  const snowTarget = cold && a.cloud > 0.5 ? clamp((band - 0.45) * 3 + altitude * 0.8, 0, 1) * (clock.month === 11 || clock.month === 0 || clock.month === 1 ? 1 : 0.6) : 0;
  snow.update(dt, camera, snowTarget, w);
  if (snow.intensity > 0.02) { sky.fog.density += snow.intensity * 0.0012; sky.fog.color.lerp(new THREE.Color(0xd9dfe4), snow.intensity * 0.5); }
  grass?.update(camera, w);
  props?.setNight(dark);
  towns?.setNight(dark);
  jeep.setLights(dark);
  waterUniforms.uLight.value = 1 - dark * 0.82;
  waterUniforms.uTint.value.copy(aurora.tint).multiplyScalar(auroraVisSmoothed * 0.25 * dark);
  world.waterMat.emissive.copy(aurora.tint).multiplyScalar(auroraVisSmoothed * 0.07 * dark);

  // Sightings: look up during an active display for a few seconds.
  const up = lookingUp() && facingLights();
  const upAnyDir = lookingUp();
  if (a.active) inactiveFor = 0; else inactiveFor += dt;
  if (inactiveFor > 20) { loggedThisWindow = false; lastLoggedType = null; }
  const upgraded = loggedThisWindow && TYPE_RANK[a.type] > TYPE_RANK[lastLoggedType];
  // A fresh postcard comes from a new place (a few hundred metres away), a stronger display,
  // or simply a couple of minutes later at the same spot.
  const here = activePos();
  const movedOn = lastLogPos && Math.hypot(here.x - lastLogPos.x, here.z - lastLogPos.z) > CONFIG.aurora.newPlaceDistance;
  const longAgo = clock.realSeconds - lastLogReal > 120;
  if (loggedThisWindow && (upgraded || longAgo || movedOn)) loggedThisWindow = false;
  if (started && !paused && up && a.active) {
    lookTimer += dt;
    if (lookTimer >= CONFIG.aurora.lookUpSecondsToLog && !loggedThisWindow) { logSighting(a); lookTimer = 0; }
  } else lookTimer = Math.max(0, lookTimer - dt * 2);
  lastAurora = a;
  // Looking up is for the sky: the HUD steps aside and a shutter appears. Its ring fills while
  // an automatic postcard is on its way.
  const looking = started && !paused && upAnyDir;
  if (looking !== wasLooking) { document.body.classList.toggle('is-looking', looking); $('t-shot').hidden = !looking; wasLooking = looking; }
  if (looking) $('t-shot').style.setProperty('--p', (a.active && !loggedThisWindow ? Math.min(1, lookTimer / CONFIG.aurora.lookUpSecondsToLog) : 0).toFixed(3));

  // Landmarks and audio.
  let waterProx = 0, iceProx = 0;
  if (landmarks) {
    const near = updateLandmarks(p);
    for (const lm of landmarks.list) {
      const d = Math.hypot(lm.x - p.x, lm.z - p.z);
      if (lm.kind === 'waterfall') waterProx = Math.max(waterProx, Math.pow(clamp(1 - d / 130, 0, 1), 2));
      if (lm.id === 'jokulsarlon') iceProx = clamp(1 - d / 110, 0, 1);
    }
    void near;
  }
  audio.update(dt, { speed: mode === 'walk' ? 0 : jeep.speed, wind: w.strength, exposure: exposureAt(p.x, p.z), waterProx, iceProx, aurora: auroraVisSmoothed * (up ? 1 : 0.6), inCar: mode !== 'walk' && started, wade: mode === 'walk' ? 0 : jeep.wadeLevel || 0, nitro: jeep.boosting });

  if (started) {
    if (jeep.warning && mode !== 'walk') hud.toast(jeep.warning, { seconds: 2.5, priority: 1 });
    if (mode === 'walk' && walker.blocked === 'far') hud.toast('Stay close to the jeep. Press C to get back in.', { seconds: 2.5 });
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const bearing = Math.atan2(fwd.x, -fwd.z);
    if (Math.floor(clock.realSeconds * 2) !== lastWhere) { lastWhere = Math.floor(clock.realSeconds * 2); hud.whereText = describePlace(p.x, p.z).label; hud.nextWindowText = nextWindowLabel(); }
    $('nitro-bar').style.transform = `scaleX(${jeep.nitro.toFixed(3)})`;
    $('nitro-bar').parentElement.classList.toggle('is-on', jeep.boosting);
    $('t-gas').style.setProperty('--tank', jeep.nitro.toFixed(3));
    $('t-gas').classList.toggle('is-boosting', jeep.boosting);
    mapUI.update(dt, activePos(), mode === 'walk' ? walker.heading : jeep.heading);
    hud.update(dt, {
      kmh: jeep.kmh, walking: mode === 'walk', where: hud.whereText || '', clockLabel: clock.label(), season: clock.season, monthName: clock.m.name, aurora: a,
      bearingDeg: THREE.MathUtils.radToDeg(bearing), windBearingDeg: THREE.MathUtils.radToDeg(Math.atan2(w.x, -w.z)), windStrength: w.strength,
      lookingUp: up, lookingUpWrongWay: upAnyDir && !up, lookTimer, loggedThisWindow,
      now: clock.gameHours, nightStart: clock.nightIndex * 24 + 12 + 4, history: forecast.history.get(clock.nightIndex),
      predict: (h) => forecast.predictedAt(h, clock.gameHours), nextWindow: hud.nextWindowText,
    });
  }

  if (post) post.render(t, { aurora: auroraVisSmoothed, dark });
  else renderer.render(scene, camera);
  if (captureRequest) { const cb = captureRequest; captureRequest = null; cb(renderer.domElement.toDataURL('image/jpeg', 0.88)); }
  input.endFrame();

  // If the device is struggling, step quality down once.
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 4) {
    const fps = fpsFrames / fpsAcc;
    window.__fps = fps;
    if (started && fps < (isTouch ? 24 : 40) && !autoDowngraded && !settings.quality && qualityName !== 'low') {
      autoDowngraded = true;
      setQuality(qualityName === 'high' ? 'medium' : 'low', false);
      hud.toast('Lowered graphics quality to keep things smooth. You can change it in Settings.', { seconds: 4 });
    }
    fpsAcc = 0; fpsFrames = 0;
  }
}

// ---------- Boot ----------
// The Start button is the loading bar: it fills with green as the island is built, shows what
// is happening and how far along it is, then turns into the full Start driving button.
const startLabel = startBtn.querySelector('.start-label'), startPct = startBtn.querySelector('.start-pct');
// The percentage follows the same timing as the fill (eased toward each target over its stage)
// and only ever counts up, so it never jumps backwards after a busy moment.
let pctShown = 0, pctSeg = { from: 0, to: 0, t0: 0, dur: 1 };
function startProgress(p, ms, label) {
  startBtn.style.setProperty('--dur', `${ms}ms`);
  startBtn.style.setProperty('--p', p.toFixed(3));
  startLabel.textContent = label;
  pctSeg = { from: pctShown, to: p, t0: performance.now(), dur: Math.max(1, ms) };
}
(function countUp() {
  if (!startBtn.classList.contains('is-loading')) return;
  const t = Math.min(1, (performance.now() - pctSeg.t0) / pctSeg.dur);
  pctShown = Math.max(pctShown, pctSeg.from + (pctSeg.to - pctSeg.from) * (1 - (1 - t) * (1 - t)));
  const pct = Math.round(pctShown * 100);
  startPct.textContent = `${pct}%`;
  startBtn.setAttribute('aria-valuenow', String(pct));
  requestAnimationFrame(countUp);
})();
const bootStart = performance.now();
requestAnimationFrame(() => setTimeout(async () => {
  try {
    await buildWorld(startProgress);
    // Park the camera behind the jeep for the intro view.
    camera.position.set(jeep.pos.x - Math.sin(jeep.heading) * 12, jeep.pos.y + 5, jeep.pos.z - Math.cos(jeep.heading) * 12);
    camera.lookAt(jeep.pos.x, jeep.pos.y + 2, jeep.pos.z);
    // Start drawing the scene now, so it is alive behind the start screen during the finish.
    requestAnimationFrame(frame);
    const left = Math.max(900, MIN_LOAD_MS - (performance.now() - bootStart));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    startProgress(0.93, left * 0.55, 'Waking the aurora');
    await wait(left * 0.55);
    startProgress(1, left * 0.45, 'Warming up the engine');
    await wait(left * 0.45 + 60);
    startBtn.classList.remove('is-loading');
    startBtn.classList.add('is-ready');
    startBtn.removeAttribute('role'); startBtn.removeAttribute('aria-valuenow'); startBtn.removeAttribute('aria-label');
    startLabel.textContent = 'Start driving';
    startBtn.disabled = false;
    haptics.play('success');
    const shared = readSharedSighting();
    if (shared) renderSharedSighting(shared);
  } catch (err) {
    console.error(err);
    startBtn.classList.add('is-failed');
    startLabel.textContent = 'Could not build the island';
    $('loading').textContent = 'Something went wrong while building the island. Try reloading, or lower the quality in Settings.';
  }
}, 30));

// Handy for tuning from the browser console.
window.chasingGreen = {
  clock, forecast, CONFIG, store, linkFor, scene, renderer, camera, setVehicle, fastTravel, input,
  get obstacles() { return obstacles; }, get scene() { return scene; }, Vec3: THREE.Vector3, get puddles() { return puddles; }, get mapUI() { return mapUI; }, get snow() { return snow; },
  nearestRoad: (x, z, r) => nearestRoad(x, z, r),
  roadPaths: () => roadPaths,
  heightAt: (x, z) => heightAt(x, z),
  waterLevelAt: (x, z) => waterLevelAt(x, z),
  get kerid() { return KERID; },
  get bridges() { return bridges; },
  get jumps() { return JUMPS; },
  // Debug switches for tracking down rendering problems.
  debugPost(on) { post = on ? (post || new Post(renderer, scene, camera)) : null; post?.setSize(); },
  debugShadows(on) { renderer.shadowMap.enabled = on; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); }); },
  // Stand on the nearest road at a real-world latitude and longitude, eye height, looking along it.
  photo(lat, lon, turn = 0, pitch = -0.02) {
    const x = (lon + 19) * 160, z = -(lat - 64.8) * 360;
    const r = nearestRoadAnywhere(x, z);
    const hd = r.heading + turn;
    mode = 'photo';
    jeep.place(r.x - Math.sin(hd) * 40, r.z - Math.cos(hd) * 40, hd);
    camera.position.set(r.x, heightAt(r.x, r.z) + 1.7, r.z);
    camera.lookAt(r.x + Math.sin(hd) * 50, camera.position.y + pitch * 50, r.z + Math.cos(hd) * 50);
    return [r.x, r.z];
  },
  get jeep() { return jeep; }, get walker() { return walker; }, get sitting() { return sitting; }, get canyon() { return CANYONS[0]; }, get landmarks() { return landmarks; }, get aurora() { return aurora; }, get mode() { return mode; },
  setMode: (m) => { mode = m; },
  // Render one still with a forced aurora, from a given camera, at any size. Used to make the
  // share image. Returns a PNG data URL and puts the renderer back the way it was.
  still({ from, to, kp = 7.2, type = AURORA_TYPES.curtains, hour = 23.6, w = 1200, h = 630, scale = 2, fov } = {}) {
    const A = CONFIG.aurora;
    const state = {
      vis: 0.2 + 0.8 * smoothstep(A.minKp, A.fullKp, kp), curtains: 1 + 3 * smoothstep(A.minKp, 7.5, kp),
      pink: type === AURORA_TYPES.pink ? 1 : smoothstep(4.5, 6.5, kp), red: type === AURORA_TYPES.red ? 1 : 0, corona: type === AURORA_TYPES.corona ? 1 : 0,
    };
    const saved = { hours: clock.gameHours, aspect: camera.aspect, fov: camera.fov, pr: renderer.getPixelRatio() };
    clock.gameHours = hour;
    camera.position.set(...from); camera.lookAt(...to);
    if (fov) camera.fov = fov;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setPixelRatio(1); renderer.setSize(w * scale, h * scale, false);
    jeep.setLights(1); jeep.sync?.(0);
    Object.assign(aurora.smooth, state);
    aurora.update(0, 40, camera, state);
    sky.update({ camera, clock, cloud: 0.04, cloudOffset, city: { overhead: 0, horizon: 0, dirX: 1, dirZ: 0 }, auroraVis: state.vis, auroraTint: aurora.tint, t: 40 });
    waterUniforms.uLight.value = 0.25;
    if (post) { post.setSize(); post.render(40, { aurora: state.vis, dark: 1 }); } else renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    clock.gameHours = saved.hours; camera.fov = saved.fov; camera.aspect = saved.aspect; camera.updateProjectionMatrix();
    renderer.setPixelRatio(saved.pr); dispatchEvent(new Event('resize'));
    return url;
  },
  look: (yaw, pitch) => { look.yaw = yaw; look.pitch = pitch; },
  // Park on the nearest road to a lat/lon, facing along it (flip turns around).
  placeAt(lat, lon, flip = false) {
    const x = (lon + 19) * 160, z = -(lat - 64.8) * 360;
    const r = nearestRoadAnywhere(x, z);
    jeep.place(r.x, r.z, r.heading + (flip ? Math.PI : 0));
    const h = jeep.heading;
    camera.position.set(r.x - Math.sin(h) * 10, heightAt(r.x, r.z) + 3.4, r.z - Math.cos(h) * 10);
    return [r.x, r.z];
  },
  // Jump to a landmark by id, parked on the nearest road facing it.
  teleport(id) {
    const lm = landmarks.list.find((l) => l.id === id);
    if (!lm) return landmarks.list.map((l) => l.id);
    const r = nearestRoadAnywhere(lm.x, lm.z);
    jeep.place(r.x, r.z, Math.atan2(lm.x - r.x, lm.z - r.z));
    camera.position.set(r.x, heightAt(r.x, r.z) + 6, r.z);
    return [r.x, r.z];
  },
};

// ---------- Settings: tap a choice instead of opening a drop-down ----------
// Each short select in Settings gets a row of buttons that drive it, so the same change
// handlers run. The long month list keeps its drop-down.
for (const sel of document.querySelectorAll('.settings-grid select:not(.month-select)')) {
  const seg = document.createElement('div');
  seg.className = sel.classList.contains('desk-only') ? 'seg desk-only' : 'seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', document.querySelector(`label[for="${sel.id}"]`)?.textContent || '');
  const sync = () => seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.value === sel.value; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
  for (const o of sel.options) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.value = o.value; b.setAttribute('role', 'radio');
    b.textContent = o.textContent;
    b.addEventListener('click', () => { haptics.play('select'); sel.value = o.value; sel.dispatchEvent(new Event('change')); sync(); });
    seg.append(b);
  }
  sel.addEventListener('change', sync);
  sel.after(seg);
  settingsDialog.addEventListener('sync', sync);
  sync();
}
