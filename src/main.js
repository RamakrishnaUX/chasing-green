import './ui/style.css';
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { store } from './storage.js';
import { createNoise2D, clamp, smoothstep, lerp } from './world/noise.js';
import { START, PLACES, CANYONS, JUMPS, KERID } from './world/geo.js';
import { buildTerrain, paintTerrain, iceAt, flattenPads, bridges, roadPaths, nearestRoad, heightAt, coastAt, nearestRoadAnywhere, exposureAt, waterLevelAt, postReflectorMat, lakeMat, snowAt, groundAt, roadDistAt, shoreDistAt, surfaceAt } from './world/terrain.js';
import { Scatter } from './world/scatter.js';
import { Grass } from './world/grass.js';
import { Post } from './world/post.js';
import { carThumbs, resetCarThumbs } from './ui/carthumbs.js';
import { Props } from './world/props.js';
import { Towns } from './world/towns.js';
import { Obstacles } from './world/obstacles.js';
import { Puddles, Particles, SnowFall, RainFall, Windscreen, SkidMarks, WetTracks, SnowTracks, headlightUniforms } from './world/effects.js';
import { MapUI } from './ui/minimap.js';
import { Cover } from './ui/cover.js';
import { startAuroraSky } from './ui/auroraSky.js';
import { HD, loadHD, installAtmosphere, updateAtmosphere, detailScene, naturalize, demToGame } from './world/hd.js';
import { Nav, formatDistance } from './ui/nav.js';
import { siteStations, Stations } from './world/stations.js';
import { FuelTank, TANKS } from './vehicle/fuel.js';
import { Sheet } from './ui/sheet.js';
import { haptics } from './ui/haptics.js';
import { Learn } from './ui/learn.js';
import { VEHICLES, VEHICLE_ORDER } from './vehicle/specs.js';
import { surfaceUniforms } from './world/materials.js';
import { SkyReflection } from './world/skyreflect.js';
import { Clock } from './world/time.js';
import { Sky } from './world/sky.js';
import { Landmarks, waterUniforms } from './world/landmarks.js';
import { Forecast, AURORA_TYPES } from './aurora/forecast.js';
import { Aurora } from './aurora/aurora.js';
import { Jeep } from './vehicle/jeep.js';
import { updateInterior, turnWheel, trackTitle } from './vehicle/interiors.js';
import { Walker } from './vehicle/walker.js';
import { Heli } from './vehicle/heli.js';
import { loadCarModels, modelReady, whenModel } from './vehicle/models.js';
import { grime, updateGrime, setDirtColor } from './vehicle/grime.js';
import { Mirrors } from './vehicle/mirrors.js';
import { Driver } from './vehicle/driver.js';
import { Skydiver, MIN_JUMP, fitGear, bonesOf } from './vehicle/skydiver.js';
import { solidTopAt } from './world/solids.js';
import { BoatWater } from './vehicle/boat.js';
import { WaterFx } from './world/waterfx.js';
import { PhotoMode } from './ui/photomode.js';
import { Wildlife, WILDLIFE_NOTES } from './world/wildlife.js';
import { Input } from './vehicle/input.js';
import { Hud } from './ui/hud.js';
import { Notebook, stampSvg, GLYPHS } from './ui/notebook.js';
import { Badges } from './ui/badges.js';
import { AudioEngine } from './audio/audio.js';
import { sfx, bindUiSfx, wakeUiSfx, preloadArrival } from './audio/uisfx.js';
import { drawPostcard, sharePostcard, canvasBlob, download, captionFor } from './share/postcard.js';
import { linkFor, readSharedSighting } from './share/link.js';
import { ClipRecorder } from './share/recorder.js';
import { dailyChallenge } from './challenges.js';
import { track, tickPlay, countSighting, countStamp } from './analytics.js';

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
// The realistic look's ground shader is costly per pixel (most of each frame is spent on it), so on
// Medium it draws at one pixel per CSS pixel: about a third less work on a Retina screen.
const qualityFor = (name) => {
  const q = weakDevice && name === 'low' ? { ...CONFIG.quality.low, ...LITE } : CONFIG.quality[name];
  return wantHD && name === 'medium' ? { ...q, pixelRatio: Math.min(q.pixelRatio, 1) } : q;
};
const FRAME_GAP = isTouch ? 1000 / 30 : 0;
// settings.autoQuality: where the game stepped itself down on this device last time, so a slow
// machine starts there instead of struggling (and being told so) on every visit.
let qualityName = settings.quality || settings.autoQuality || (isTouch ? 'low' : CONFIG.defaultQuality);
// The realistic look is desktop only (and not on Low): phones keep the classic look and never
// download its textures. It is chosen at load, so a change applies on the next reload.
const wantHD = !isTouch && qualityName !== 'low' && settings.look !== 'classic';
if (wantHD) installAtmosphere();
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
// The wing and rear-view mirrors, live from the driver's seat (a smaller, slower picture on phones).
const mirrors = new Mirrors({ small: isTouch });
// You, at the wheel while you drive (out of the car once you step out).
const driver = new Driver();
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
bindUiSfx(audio);
audio.muted = !!settings.muted;
// Volumes for the Sound tab. Anyone who had switched music off keeps it silent.
const volumes = settings.volumes || (settings.volumes = { master: 1, music: settings.music === 'off' ? 0 : 1, car: 1, ambience: 1 });
audio.setLevels(volumes);

let world = null, sky, aurora, landmarks, jeep, walker, heli, diver, scatter, grass, props, post = null;
let obstacles, puddles, spray, boatWater, waterFx, washDust, rain, windscreen, skids, trailDust, wetTracks, tyreWet = [0, 0, 0, 0], tyreLast = [], tyreIn = [], tyreSpray = [], wetness = 0, forceRain = null, forceSnow = null, roadSnow = 0, iceWarned = false, wildlife, dust, powder, powderCloud, mapUI, towns, snow, nav, stations, stationSites = [];
let lastPostState = { aurora: 0, dark: 0 };
const snowNoise = createNoise2D(4040);
let wasInPuddle = false, wasInWater = false, shake = 0, sitting = false, sitSpeedBefore = 1, camHeading = null;
let started = false;
let mode = 'chase'; // chase | lookup | walk | fly (at the helicopter's controls) | sky (skydiving)
// Skydiving (see skydiver.js): afterJump while on foot after a jump, until you board, switch or
// travel; the leash is where you landed until the helicopter lands near you.
let afterJump = false, jumpAnchor = null, leashOnHeli = null, heliComing = false, skyView = 'chase', jumpTipShown = false, walkerBones = null, jumpBtnState = null;
let ride = 'car'; // what you travel in: the car, or the helicopter that takes its place
let flySky = false; // in the helicopter: looking at the sky from above the rotor head
let walkTilt = false;
const look = { yaw: 0, pitch: 0.95, orbit: 0, walkYaw: 0, cabYaw: 0, cabPitch: 0, flyPitch: 0.3, flyDist: 19 };
// How you see the road while driving: from behind the car, from the bonnet, or from the seat.
const VIEWS = ['chase', 'hood', 'cockpit'];
let driveView = VIEWS.includes(settings.view) ? settings.view : 'chase';
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
let fpsAcc = 0, fpsFrames = 0, autoDowngraded = false, boostGlowOn = false, coverWarmFrames = 3;

// Dynamic resolution: a share of the quality preset's pixel ratio. It drops a step while frames
// run long and climbs back once there is room, but not within 20 s of a drop, so it settles
// instead of flickering between sizes.
const RES_MIN = 0.6;
let resScale = 1, lastResDrop = -Infinity;
function applyPixelRatio() {
  // Never below 0.55 of a CSS pixel, so even the weakest phone stays sharp enough to read.
  renderer.setPixelRatio(Math.max(Math.min(devicePixelRatio, 0.55), Math.min(devicePixelRatio, Q.pixelRatio) * resScale));
  renderer.setSize(innerWidth, innerHeight, false);
  post?.setSize();
}
// Changing the pixel ratio or the quality wipes the canvas and the next frame can take a while
// (a resize, a rebuilt pipeline, shaders to compile), which showed as a flash of black. Instead,
// the frame on screen is copied to a still that covers the canvas while the change is made, then
// fades away once new frames are coming through.
let frameHold = null;
function holdFrame(change) {
  const c = renderer.domElement;
  if (!world || !started || frameHold || !c.width) { change(); return; }
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height; o.className = 'frame-hold';
  try {
    if (post) post.render(clock.realSeconds, lastPostState); else renderer.render(scene, camera);
    o.getContext('2d').drawImage(c, 0, 0);
  } catch { change(); return; }
  c.after(o); frameHold = o;
  change();
  let n = 0;
  const wait = () => { if (++n < 6) { requestAnimationFrame(wait); return; } o.classList.add('is-gone'); setTimeout(() => { o.remove(); frameHold = null; }, 450); };
  requestAnimationFrame(wait);
}
function adaptResolution(fps) {
  const now = performance.now();
  if (fps < (isTouch ? 26 : 48) && resScale > RES_MIN) {
    resScale = Math.max(RES_MIN, Math.round((resScale - 0.15) * 100) / 100);
    lastResDrop = now;
    holdFrame(applyPixelRatio);
  } else if (fps > (isTouch ? 29 : 57) && resScale < 1 && now - lastResDrop > 20000) {
    resScale = Math.min(1, Math.round((resScale + 0.1) * 100) / 100);
    holdFrame(applyPixelRatio);
  }
}

// ---------- Build world ----------
// Built in stages so the Start button can fill as it goes. Before each stage the bar is sent
// toward that stage's end over its usual duration; the fill animates on the compositor, so it
// keeps moving even while a heavy stage holds the main thread.
// The real build fills the bar to BUILD_SHARE; a short paced finish carries it to 100%, so the
// load always feels like a load (at least MIN_LOAD_MS) even on a fast machine.
const BUILD_SHARE = 0.82, MIN_LOAD_MS = 3200;
// Wait for a painted frame between stages, except in a background tab, where there are no frames.
const nextPaint = () => (document.hidden ? Promise.resolve() : new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
const stageTimes = {};
async function buildWorld(progress) {
  // The camper's graffiti is painted from two web fonts; they download while the island is built
  // and are given a moment more, if they need it, just before the cars.
  const fonts = Promise.race([Promise.all(['400 100px "Bungee"', '400 60px "Sedgwick Ave Display"'].map((f) => document.fonts?.load(f))), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
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
  // Only a small creep here: the terrain build reports its own progress through the stage.
  if (wantHD) {
    await stage('Loading realistic textures', 0.05, 1800);
    HD.surface = surfaceUniforms;
    try { await loadHD(renderer); } catch (e) { console.warn('Elevation did not load; using the classic look.', e); }
  }
  await stage('Shaping the island', 0.06, 1500);
  // The realistic look uses a finer terrain mesh so the eroded faces have room to show.
  world = await buildTerrain(scene, HD.on ? Math.max(Q.terrainRes, 1500) : Q.terrainRes, clock.season, (f) => progress(0.58 * f * BUILD_SHARE, 300, 'Shaping the island'));
  await stage('Lighting the sky', 0.59, 40);
  sky = new Sky(scene, { shadowSize: Q.shadowSize, renderer });
  // The night sky (aurora, moon, stars) as the water mirrors it.
  skyRefl = new SkyReflection(renderer, qualityName === 'low' ? 64 : 128);
  if (HD.on) sky.light = { env: 0.55, hemi: 0.5, sun: 1.3 };
  aurora = new Aurora(scene, Q.auroraSteps);
  await stage('Placing landmarks', 0.67, 220);
  // Pads under built landmarks, by kind (radius in world units). Natural sites keep their shape.
  const PAD = { building: 32, town: 30, sculpture: 12, pool: 26, geothermal: 24, cave: 16, bridge: 18, waterfall: 34, geyser: 18, wreck: 18, stadium: 80 };
  landmarks = new Landmarks(scene, { quality: qualityName, defer: true, beforeBake: (root, lm) => naturalize(root, lm.kind), beforeBuild: (list) => {
    const pads = list.filter((l) => PAD[l.kind] && l.id !== 'seydisfjordur').map((l) => ({ x: l.x, z: l.z, r: l.id === 'hallgrimskirkja' ? 58 : PAD[l.kind], cap: l.id === 'hallgrimskirkja' || l.id === 'laugavegur' ? 2.5 : null }));
    // Fuel stations beside the Ring Road get level forecourts too.
    stationSites = siteStations(list);
    flattenPads(pads.concat(stationSites.map((s) => s.pad)), world.mesh);
  } });
  await landmarks.buildAll(() => new Promise((r) => setTimeout(r, 0)));
  landmarks.onEvent = (type, lm) => {
    const pp = activePos(), d = Math.hypot(pp.x - lm.x, pp.z - lm.z);
    if (d > 160 || !started) return;
    if (type === 'geyser-warning') { hud.toast('Strokkur is about to erupt. Watch the water bulge!', { seconds: 3, priority: 2 }); audio.thud(6); }
    if (type === 'geyser-erupt') audio.splash(1);
  };
  obstacles = new Obstacles();
  landmarks.registerObstacles(obstacles);
  await stage('Scattering rocks', 0.88, 560);
  // The scanned rocks and ground textures have been downloading while the island took shape.
  if (HD.on) await HD.textures;
  // Bridge railings are solid on both sides.
  for (const B of bridges) for (const sx of [-1, 1]) obstacles.addBox(B.x - B.dz * sx * 4.65, B.z + B.dx * sx * 4.65, Math.atan2(B.dx, B.dz), 0.25, B.len / 2 + 2, 'wall');
  // No rocks or grass field on streets, churchyards and city squares.
  const clear = landmarks.list.filter((l) => ['town', 'building', 'sculpture', 'stadium'].includes(l.kind)).map((l) => ({ x: l.x, z: l.z, r: l.kind === 'stadium' ? 78 : l.id === 'seydisfjordur' ? 58 : l.id === 'laugavegur' ? 36 : l.id === 'hallgrimskirkja' ? 46 : l.id === 'harpa' ? 30 : 22 }))
    .concat(stationSites.map((st) => ({ x: st.pad.x, z: st.pad.z, r: 30 })));
  scatter = new Scatter(scene, { grass: 0, rocks: Math.round(Q.rocks * (CONFIG.rockDensity[settings.rocks || 'normal'] || 1)), obstacles, clear });
  // The realistic look grows the field thicker and a little further out (each tuft is ten blades,
  // so this is most of the grass's cost: the same density over a smaller circle is far cheaper).
  if (Q.grass > 0) grass = new Grass(scene, { count: HD.on ? Math.max(Q.grass, 34000) : Q.grass, radius: HD.on ? Math.max(Q.grassRadius, 46) : Q.grassRadius, clear });
  // The realistic look always grounds things with ambient occlusion.
  if (Q.post) post = new Post(renderer, scene, camera, { ao: !!Q.ao || HD.on, aoSamples: Q.ao ? 12 : 6, samples: Q.msaa ?? 4 });
  // Realistic look: a little more contrast and a touch less saturation, like a photograph.
  if (post && HD.on) { post.grade.uniforms.uContrast.value = 1.1; post.grade.uniforms.uSat.value = 1.18; }
  // AgX rolls highlights off like a camera does, instead of clipping bright sky and snow.
  if (HD.on) { renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = (CONFIG.exposure ?? 0.95) * 1.2; }
  await stage('Building towns', 0.91, 80);
  props = new Props(scene, { farms: qualityName === 'low' ? 14 : 26, landmarks: landmarks.list, keepClear: [START, ...stationSites], obstacles });
  // Realistic look: scanned detail on landmark and prop surfaces (not town houses, cars or people).
  if (HD.on) detailScene(scene);
  stations = new Stations(scene, stationSites, { obstacles });
  towns = new Towns(scene, { landmarks: landmarks.list, obstacles, scale: qualityName === 'low' ? 0.6 : 1, clear: stationSites.map((st) => ({ x: st.pad.x, z: st.pad.z, r: 34 })).concat(landmarks.list.filter((l) => l.kind === 'stadium').map((l) => ({ x: l.x, z: l.z, r: 84 }))) });
  snow = new SnowFall(scene, qualityName === 'low' ? 900 : 2200);
  rain = new RainFall(scene, qualityName === 'low' ? 1300 : 2800);
  skids = new SkidMarks(scene);
  wetTracks = new WetTracks(scene);
  snowTracks = new SnowTracks(scene);
  // The dust a car raises off a gravel road: big soft billows that hang and drift.
  trailDust = new Particles(scene, { count: qualityName === 'low' ? 300 : 600, color: 0xb6a07c, size: 4.5, opacity: 0.15, gravity: -0.1, drag: 0.7, fadeNear: [4, 10] });
  windscreen = new Windscreen($('rain-glass'));
  puddles = new Puddles(scene, qualityName === 'low' ? 100 : 180);
  spray = new Particles(scene, { count: qualityName === 'low' ? 260 : 600, color: 0xe6f0f4, size: 0.5, opacity: 0.75, gravity: 9.5, drag: 1.2 });
  // Steam curling off a hot pool round you while you soak.
  bathSteam = new Particles(scene, { count: qualityName === 'low' ? 90 : 200, color: 0xeef2f4, size: 1.8, opacity: 0.06, gravity: -0.12, drag: 0.9, fadeNear: [0.8, 2.6] });
  boatWater = new BoatWater(scene, { low: qualityName === 'low' });
  waterFx = new WaterFx(scene, { low: qualityName === 'low' });
  wildlife = new Wildlife(scene, { low: qualityName === 'low' });
  // The rotor's dust: bigger, thicker billows than a car's.
  washDust = new Particles(scene, { count: qualityName === 'low' ? 260 : 600, color: 0xbfa77f, size: 5.5, opacity: 0.16, gravity: -0.12, drag: 0.9 });
  dust = new Particles(scene, { count: qualityName === 'low' ? 220 : 520, color: 0xb39a74, size: 1.3, opacity: 0.28, gravity: -0.4, drag: 1.4 });
  powder = new Particles(scene, { count: qualityName === 'low' ? 500 : 1100, color: 0xf6f9ff, size: 0.85, opacity: 0.95, gravity: 7, drag: 1.1 });
  powderCloud = new Particles(scene, { count: qualityName === 'low' ? 120 : 260, color: 0xdfe8f2, size: 2.6, opacity: 0.42, gravity: 0.6, drag: 2.2 });
  scatter.setSeason(clock.season);
  await stage('Parking your car', 0.93, 60);
  await fonts;
  jeep = new Jeep(scene, settings.vehicle === 'heli' ? settings.car || 'jeep' : settings.vehicle || 'jeep');
  // The supercar, roadster and camper models arrive in the background; the one in use is
  // rebuilt from its model as soon as it lands.
  jeep.setView(driveView);
  jeep.obstacles = obstacles;
  walker = new Walker(scene);
  heli = new Heli(scene);
  heli.obstacles = obstacles;
  diver = new Skydiver(scene);
  diver.obstacles = obstacles;
  heli.easy = settings.heli !== 'manual';
  const sp = nearestRoadAnywhere(START.x, START.z);
  jeep.place(sp.x, sp.z, sp.heading);
  await stage('Drawing the map', 0.95, 180);
  nav = new Nav(scene, {
    onArrive: (d) => { haptics.play('success'); hud.toast(`You have arrived at ${d.label}.`, { seconds: 4, priority: 2 }); track('nav_arrive', { destination: d.label }); },
    onStop: (d, byUser) => { if (byUser) { hud.toast('Route cleared.', { seconds: 2, priority: 2 }); track('nav_stop', { destination: d.label }); } },
  });
  mapUI = new MapUI({ landmarks, stations: stations.list, onTravel: fastTravel, onDrive: driveTo, describe: (x, z) => describePlace(x, z).label });
  { const L = landmarks.list.find((l) => l.id === 'landmannalaugar'); if (L) surfaceUniforms.uRhyolite.value.set(L.x, L.z, 170); }
  surfaceUniforms.uSnowLine.value = snowLineFor(clock.month);
  // Compile every shader now, in parallel where the browser allows, instead of freezing the
  // first frame doing it.
  await stage('Mixing the colours', 1, 1200);
  // Things hidden at load (night lights, the aurora, the route beacon) are compiled too, shown just
  // for the call, so dusk or the first aurora never freezes the game while their shaders build.
  // Never wait more than 2.5 s here; anything left compiles on the first frame as before.
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  let compiled;
  try { compiled = renderer.compileAsync(scene, camera); } catch { renderer.compile(scene, camera); }
  for (const o of hidden) o.visible = false;
  if (compiled) try { await Promise.race([compiled, new Promise((r) => setTimeout(r, 2500))]); } catch { /* compiles on first use */ }
  // Bloom only runs from dusk on: draw one frame with it now so its passes are ready by then.
  if (post) { const was = post.bloom.enabled; post.bloom.enabled = true; post.composer.render(); post.bloom.enabled = was; }
  stageTimes[current] = Math.round(performance.now() - tStage);
  console.info(`World built in ${Math.round(performance.now() - t0)} ms`, stageTimes);
}

// ---------- Water surfaces ----------
// Pools, crater lakes and plunge pools are drawn by the landmarks, apart from the sea and the
// big lakes the land knows about (waterLevelAt). Every mesh in a water material is found here,
// so wheels ring and splash in them and the rotor wash ruffles them like the sea.
let poolSurfaces = [], poolScanAt = -1e9;
function scanPools() {
  poolSurfaces = [];
  const box = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || !o.material?.userData?.water) return;
    box.setFromObject(o); box.getCenter(c); box.getSize(sz);
    const r = Math.max(sz.x, sz.z) / 2;
    if (r > 250 || r < 0.5 || sz.y > 3) return; // the sea and big lakes come from waterLevelAt
    if (waterLevelAt(c.x, c.z) > heightAt(c.x, c.z) + 0.3) return; // so does Kerið's lake
    poolSurfaces.push({ x: c.x, z: c.z, r: r * 0.92, y: box.max.y });
  });
}
function poolSurfaceAt(x, z) {
  if (performance.now() - poolScanAt > 8000) { poolScanAt = performance.now(); scanPools(); }
  for (const s of poolSurfaces) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return s;
  return null;
}
function poolAt(x, z) { return poolSurfaceAt(x, z)?.y ?? null; }
// The water surface at (x, z), or null over dry land.
function waterAt(x, z) {
  const p = poolAt(x, z);
  if (p != null) return p;
  const wl = waterLevelAt(x, z);
  return wl > heightAt(x, z) + 0.3 ? wl : null;
}

// ---------- Rotor wash ----------
// The helicopter's downwash: strongest with the rotor at full speed close to the ground, gone by
// about 25 m up. The air comes straight down under the rotor, turns at the ground and runs out
// flat in every direction, so everything is pushed outward from under it: the grass is blown
// flat in pulses as the blades pass (grass.js), dust, sand or snow is lifted and driven out
// along the ground in a ring, and on water (WaterFx) the surface is roughened and streaked,
// rings spread from the middle and mist and spray are thrown out sideways.
let washCarry = 0;
function rotorWash(dt) {
  if (!heli || (ride !== 'heli' && !heli.auto && !heli.engineOn) || !heli.root.visible) return null;
  const agl = heli.landed ? 0 : Math.max(0, heli.agl);
  const strength = heli.rpm * heli.rpm * (1 - smoothstep(4, 26, agl));
  if (strength < 0.02) return null;
  const x = heli.pos.x, z = heli.pos.z, pool = poolSurfaceAt(x, z);
  // Over a small pool the wash on the water stops at its edge.
  const radius = Math.min(12 + 14 * strength, pool ? Math.max(4, pool.r - Math.hypot(x - pool.x, z - pool.z)) : 1e9);
  const wAt = waterAt(x, z), onWater = wAt != null, wl = onWater ? wAt : waterLevelAt(x, z);
  // The dust takes the colour of the ground: black volcanic sand on the beaches, grey grit on
  // gravel, a pale dun from dry grass and earth.
  const surf = surfaceAt(x, z);
  washDust.mat.color.setHex(surf === 'sand' ? 0x4f4c48 : surf === 'gravel' ? 0x8c8376 : 0xb8a582);
  if (dt) {
    washCarry += (onWater ? 10 : 70) * strength * dt;
    for (; washCarry >= 1; washCarry--) {
      // Lifted where the wash turns (about a third of the way out) and driven outward, fastest
      // close in, slowing as it spreads.
      const a = Math.random() * Math.PI * 2, rr = radius * (0.2 + 0.45 * Math.random());
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, out = (5 + 10 * strength) * (1.2 - rr / radius);
      const pw = waterAt(px, pz), gy = heightAt(px, pz), pwl = pw ?? 0;
      if (pw != null) { if (!onWater) spray.emit(px, pwl + 0.1, pz, Math.cos(a) * out, 1.2, Math.sin(a) * out, 2, 1.2, 0.8); }
      else if (snowAt(px, pz) > 0.5) powder.emit(px, gy + 0.2, pz, Math.cos(a) * out, 1.0 + Math.random(), Math.sin(a) * out, 3, 1.4, 1.2);
      else washDust.emit(px, gy + 0.6, pz, Math.cos(a) * out, 0.2 + Math.random() * 0.6, Math.sin(a) * out, 2, 2.4, 2.4);
    }
  }
  return { x, z, strength, radius, onWater, y: wl };
}

// ---------- Helpers ----------
function wind(t) {
  const W = CONFIG.wind;
  const dir = 0.6 + windNoise(t * 0.01, 1.5) * 1.2; // slowly turning, mostly from the east
  const strength = W.baseStrength + W.gustStrength * (0.5 + 0.5 * windNoise(t * W.gustSpeed, 4.2));
  return { x: Math.sin(dir) * strength, z: Math.cos(dir) * strength, strength, dir };
}

// How wintry each month is (0 to 1): snow showers and snow and ice on the roads.
const WINTER = [1, 1, 0.85, 0.5, 0.05, 0, 0, 0, 0, 0.25, 0.7, 1];

// Snow line by month. With real elevation (realistic look) it is set in real metres, roughly as
// in Iceland, and turned into game units the same way the land is.
function snowLineFor(m) {
  if (HD.dem) return demToGame([150, 200, 300, 450, 800, 1100, 1200, 1150, 1000, 950, 500, 200][m]);
  return [16, 18, 24, 32, 55, 95, 95, 85, 55, 32, 24, 18][m];
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

function activePos() { return mode === 'walk' ? walker.pos : mode === 'sky' ? diver.pos : ride === 'heli' ? heli.pos : jeep.pos; }
function activeHeading() { return mode === 'walk' ? walker.heading : mode === 'sky' ? diver.heading : ride === 'heli' ? heli.heading : jeep.heading; }
function lookingUp() {
  if (mode === 'fly') return flySky && look.pitch > 0.35;
  return mode === 'lookup' ? look.pitch > 0.35 : mode === 'walk' && (walkTilt || (sitting && look.pitch > 0.35));
}
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

// The nearest place you have not stamped yet, for the driving display ("Next · Vík 4.2 km").
function nextPlaceText(p) {
  if (nav.dest) return `Route · ${nav.dest.label}`;
  let best = null, bd = Infinity;
  for (const l of landmarks.list) {
    if (store.data.stamps[l.id]) continue;
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    if (d < bd) { bd = d; best = l; }
  }
  hud.nextLm = best;
  return best ? `Next · ${best.name} ${formatDistance(bd)}` : 'Every place found';
}
// Markers floating over the world: the next place to find and the nearest fuel station, with
// their distance, only while they are ahead of you and inside the screen.
const markV = new THREE.Vector3();
const LIFT = { mountain: 70, waterfall: 30, canyon: 12, crater: 12, town: 18, building: 22, stadium: 24 };
// Where a point is on screen, or null if it is behind you or off the edges.
function onScreen(x, z, lift) {
  markV.set(x, heightAt(x, z) + lift, z).project(camera);
  return markV.z < 1 && Math.abs(markV.x) < 0.84 && markV.y > -0.4 && markV.y < 0.86 ? { x: markV.x, y: markV.y } : null;
}
function worldMark(el, pick) {
  const p = activePos();
  const pos = pick && !lookingUp() && mode !== 'sky' ? onScreen(pick.x, pick.z, pick.lift) : null;
  el.classList.toggle('is-on', !!pos);
  if (!pos) return;
  el.style.transform = `translate(${((pos.x + 1) / 2 * innerWidth).toFixed(0)}px, ${((1 - pos.y) / 2 * innerHeight).toFixed(0)}px) translate(-50%, -100%)`;
  if (pick.name != null && el.firstElementChild.textContent !== pick.name) el.firstElementChild.textContent = pick.name;
  const d = formatDistance(Math.hypot(pick.x - p.x, pick.z - p.z)).toUpperCase();
  if (el.children[1].textContent !== d) el.children[1].textContent = d;
}
// The Kp in the cluster opens the full aurora radio, and K does too.
document.querySelector('.hx-side.r').addEventListener('click', () => { sfx.tick(); $('radio').classList.toggle('is-open'); });
// Every quarter second, choose what to mark. Only things within a kilometre that are in view;
// one in front (the nearest place you have not found, else the nearest place, else fuel), and at
// most one more behind it, smaller and lighter, so the two never compete.
let marks = { main: null, back: null }, markTimer = 0;
const MARK_RANGE = 800; // only what is close enough to matter
function chooseMarks() {
  const p = activePos(), seen = [];
  for (const l of landmarks.list) {
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    if (d < 80 || d > MARK_RANGE) continue;
    const lift = LIFT[l.kind] ?? 20;
    if (!onScreen(l.x, l.z, lift)) continue;
    seen.push({ x: l.x, z: l.z, lift, name: l.name, d, got: !!store.data.stamps[l.id], el: 'place' });
  }
  seen.sort((a, b) => (a.got - b.got) || (a.d - b.d));
  let fuelPick = null;
  if (fuel.on && ride === 'car' && stations) {
    for (const st of stations.list) {
      const d = Math.hypot(st.x - p.x, st.z - p.z);
      if (d < 60 || d > MARK_RANGE || (fuelPick && d > fuelPick.d) || !onScreen(st.x, st.z, 8)) continue;
      fuelPick = { x: st.x, z: st.z, lift: 8, name: null, d, el: 'fuel' };
    }
  }
  const main = seen[0] || fuelPick || null;
  let back = main === fuelPick ? null : fuelPick || seen[1] || null;
  // The one behind never sits on top of the one in front.
  if (main && back) {
    const a = onScreen(main.x, main.z, main.lift), c = onScreen(back.x, back.z, back.lift);
    if (!(Math.abs(a.x - c.x) * innerWidth > 200 || Math.abs(a.y - c.y) * innerHeight > 80)) back = null;
  }
  marks = { main, back };
}
// On a phone: no labels in the world and no place panel; one chip says which unfound place is
// next within a kilometre, how far, and an arrow points the way.
let spotFor = null;
function nextSpot() {
  const el = $('hx-spot');
  if (!document.body.classList.contains('has-touch') || mode === 'sky' || lookingUp()) { el.classList.remove('is-on'); return; }
  const p = activePos();
  let best = null, bd = 1000;
  for (const l of landmarks.list) {
    if (store.data.stamps[l.id]) continue;
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    if (d < bd) { bd = d; best = l; }
  }
  el.classList.toggle('is-on', !!best);
  if (!best) return;
  if (spotFor !== best) { spotFor = best; $('hx-spot-name').textContent = best.name; }
  const dist = formatDistance(bd);
  if ($('hx-spot-dist').textContent !== dist) $('hx-spot-dist').textContent = dist;
  const rel = Math.atan2(best.x - p.x, best.z - p.z) - activeHeading();
  $('hx-spot-arrow').style.transform = `rotate(${(-Math.atan2(Math.sin(rel), Math.cos(rel))).toFixed(3)}rad)`;
}
function worldMarks(dt = 0.016) {
  nextSpot();
  markTimer -= dt;
  if (markTimer <= 0) { markTimer = 0.25; chooseMarks(); }
  // Places use the place marker, fuel its own; whichever is behind is drawn back.
  const placeMain = marks.main?.el === 'place' ? marks.main : null, placeBack = marks.back?.el === 'place' ? marks.back : null;
  const fuelPick = marks.main?.el === 'fuel' ? marks.main : marks.back?.el === 'fuel' ? marks.back : null;
  worldMark($('hx-mark-place'), placeMain);
  worldMark($('hx-mark-place2'), placeBack);
  worldMark($('hx-mark-fuel'), fuelPick);
  $('hx-mark-fuel').classList.toggle('is-back', !!fuelPick && marks.back === fuelPick);
}
// What the gear readout says: a gear from the speed when driving, R reversing, N standing.
function gearText() {
  if (mode === 'walk') return 'On foot';
  if (mode === 'sky') return 'Freefall';
  if (ride === 'heli') return heli.landed ? 'Landed' : 'Flying';
  if (jeep.boosting) return 'Nitro';
  if (jeep.vF < -0.5) return 'Gear R';
  const k = Math.abs(jeep.kmh);
  if (k < 1) return 'Gear N';
  return `Gear ${k < 20 ? 1 : k < 45 ? 2 : k < 75 ? 3 : k < 110 ? 4 : k < 150 ? 5 : 6}`;
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
const eyeV = new THREE.Vector3(), qBody = new THREE.Quaternion(), qLook = new THREE.Quaternion(), eLook = new THREE.Euler(0, 0, 0, 'YXZ');
// Hood and cockpit: the camera rides with the body (so bumps and body roll are felt), looks
// along the car, and can be dragged to look around; let go and it eases back to the road.
function insideCamera(dt, l) {
  const spec = jeep.interior.views[driveView];
  look.cabYaw = clamp(look.cabYaw - l.dx * 0.005, -2.0, 2.0);
  look.cabPitch = clamp(look.cabPitch - l.dy * 0.004, -0.5, 0.7);
  if (!l.dx && !l.dy) { const k = 1 - Math.min(1, dt * (jeep.speed > 3 ? 1.2 : 0.25)); look.cabYaw *= k; look.cabPitch *= k; }
  jeep.body.updateWorldMatrix(true, false);
  camera.position.copy(eyeV.set(...spec.eye).applyMatrix4(jeep.body.matrixWorld));
  jeep.body.getWorldQuaternion(qBody);
  camera.quaternion.copy(qBody).multiply(qLook.setFromEuler(eLook.set(spec.pitch + look.cabPitch, Math.PI + look.cabYaw, 0)));
  // A light buzz on rough ground, and the knocks.
  const j = shake * 0.3 + (jeep.surface === 'paved' ? 0 : Math.min(1, jeep.speed / 25) * 0.012);
  if (j > 0.001) { camera.position.x += (Math.random() - 0.5) * j; camera.position.y += (Math.random() - 0.5) * j; }
  // Upright phones keep at least a 60 degree sideways view, or the wheel fills the screen.
  const narrow = camera.aspect < 1 ? Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 6) / camera.aspect))) : 0;
  const fov = Math.max(spec.fov, narrow) + Math.min(1, jeep.speed / 60) * 5 + (jeep.boosting ? 7 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  camHeading = jeep.heading; // so switching back to the chase view does not swing round
}
let openingCam = null;
const _openLook = new THREE.Vector3();
function updateCamera(dt) {
  if (photo?.on) { input.consumeLook(); photo.update(dt); return; }
  const l = input.consumeLook();
  if (mode === 'photo') return; // camera placed by hand from the console
  if (mode === 'fly') { flyCamera(dt, l); return; }
  if (mode === 'sky') { skyCamera(dt, l); return; }
  if (camera.far !== (Q.far || 3000)) { camera.far = Q.far || 3000; camera.updateProjectionMatrix(); }
  // Inside the car things are centimetres from the eye, so the near clip comes in close.
  const inside = mode === 'chase' && driveView !== 'chase';
  const near = inside ? 0.05 : 0.4;
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  if (inside) { insideCamera(dt, l); return; }
  if (mode === 'chase') {
    look.orbit -= l.dx * 0.006;
    if (!l.dx) look.orbit *= 1 - Math.min(1, dt * 0.8);
    // The camera follows a smoothed heading, so turning does not whip the scenery around.
    const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    camHeading = camHeading == null ? jeep.heading : camHeading + wrapA(jeep.heading - camHeading) * Math.min(1, dt * 2.2);
    const h = camHeading + look.orbit;
    const cd = jeep.model.camDist + (jeep.boosting ? 1.2 : 0), ch = jeep.model.camHeight;
    const desired = new THREE.Vector3(jeep.pos.x - Math.sin(h) * cd, jeep.pos.y + ch, jeep.pos.z - Math.cos(h) * cd);
    // Under a sea arch the camera follows the car through rather than jumping over the roof.
    desired.y = Math.max(desired.y, groundAt(desired.x, desired.z, jeep.pos.y + jeep.kit.height + 0.1) + 1.5);
    // A small vehicle (the bike) is followed more closely, or at speed it shrinks into the distance.
    camera.position.lerp(desired, Math.min(1, dt * (jeep.model.camFollow || 4)));
    if (jeep.speed < 0.3 && camera.position.distanceTo(desired) < 0.08) camera.position.copy(desired);
    camTarget.set(jeep.pos.x + Math.sin(h) * 14, jeep.pos.y + ch * 0.7, jeep.pos.z + Math.cos(h) * 14);
    // The opening shot: from high over the land, off to one side, the camera sweeps round and
    // down onto the car and settles behind it.
    if (openingCam) {
      const u = Math.min(1, (performance.now() - openingCam.t0) / openingCam.dur), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const a = h + (1 - e) * 1.9, d = cd + (1 - e) * 70, y = ch + (1 - e) * 46;
      camera.position.set(jeep.pos.x - Math.sin(a) * d, Math.max(jeep.pos.y + y, groundAt(jeep.pos.x - Math.sin(a) * d, jeep.pos.z - Math.cos(a) * d, jeep.pos.y + y) + 3), jeep.pos.z - Math.cos(a) * d);
      camTarget.lerpVectors(_openLook.set(jeep.pos.x, jeep.pos.y + 1, jeep.pos.z), camTarget, e);
      if (u >= 1) openingCam = null;
    }
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
      // In a hot pool he leans back with his eyes just above the water.
      camera.position.set(walker.pos.x, walker.soaking && walker.bath ? walker.bath.y + 0.32 : walker.pos.y + 1.05, walker.pos.z);
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
      // Running, the camera hangs back a little more and the view widens a touch.
      const run = clamp(walker.speedSmooth / 4.2, 0, 1);
      // Indoors (Harpa, Hallgrímskirkja) the camera comes in closer and stays inside the room,
      // rather than swinging out through a wall and showing the building from outside.
      const indoors = landmarks.roomAt(walker.pos.x, walker.pos.z, walker.pos.y);
      // Swimming, he is low in the water: the camera comes closer and looks down on him a little more.
      const swim = walker.swimming;
      const cd = indoors ? 4.2 : swim ? 4.4 : 6 + run * 0.8;
      const desired = new THREE.Vector3(walker.pos.x - Math.sin(h) * cd, walker.pos.y + (indoors ? 2.2 : swim ? 3.3 : 2.8), walker.pos.z - Math.cos(h) * cd);
      desired.y = Math.max(desired.y, groundAt(desired.x, desired.z) + 1);
      if (indoors) {
        const r = indoors, cs = Math.cos(r.rot), sn = Math.sin(r.rot), dx = desired.x - r.x, dz = desired.z - r.z, m = 0.5;
        const lx = clamp(dx * cs - dz * sn, -r.hx + m, r.hx - m), lz = clamp(dx * sn + dz * cs, -r.hz + m, r.hz - m);
        desired.x = r.x + lx * cs + lz * sn; desired.z = r.z - lx * sn + lz * cs;
        desired.y = Math.min(desired.y, r.y1 - 0.5);
      }
      camera.position.lerp(desired, Math.min(1, dt * 5));
      camTarget.set(walker.pos.x, walker.pos.y + 1.6, walker.pos.z);
      camera.lookAt(camTarget);
      const fov = 52 + run * 4;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
    }
  }
}

// Flying: from behind and above, swinging round smoothly with the heading (drag to orbit and
// tilt, wheel to pull back), or from the pilot's seat. The view reaches further as you climb, so
// from a few thousand metres the whole island fits, and the near plane moves out with it.
const camOff = new THREE.Vector3(), flyTarget = new THREE.Vector3(), _ft = new THREE.Vector3();
let flyHeading = null;
function flyCamera(dt, l) {
  const agl = camera.position.y - Math.max(0, heightAt(camera.position.x, camera.position.z));
  const far = Math.min(16000, Math.max(Q.far || 3000, 2600 + Math.max(0, agl) * 3.6));
  const inside = driveView === 'cockpit';
  const near = inside && !flySky ? 0.1 : clamp(look.flyDist * 0.12 + agl * 0.002, 0.4, 6);
  if (camera.far !== far || camera.near !== near) { camera.far = far; camera.near = near; camera.updateProjectionMatrix(); }
  const shakeNow = Math.max(shake, heli.shake);
  heli.cockpitOn = inside && !flySky;
  if (flySky) {
    // Sky view: a camera just above the rotor head, free to look round and up for the lights.
    look.yaw -= l.dx * 0.005;
    look.pitch = clamp(look.pitch - l.dy * 0.005, -0.6, 1.5);
    const h = heli.heading + look.yaw;
    camera.position.set(heli.pos.x, heli.pos.y + heli.mastTop + 1.4, heli.pos.z);
    camTarget.set(camera.position.x + Math.sin(h) * Math.cos(look.pitch), camera.position.y + Math.sin(look.pitch), camera.position.z + Math.cos(h) * Math.cos(look.pitch));
    camera.lookAt(camTarget);
    if (camera.near !== 0.4) { camera.near = 0.4; camera.updateProjectionMatrix(); }
    if (Math.abs(camera.fov - 60) > 0.05) { camera.fov += (60 - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
    return;
  }
  if (inside) {
    look.cabYaw = clamp(look.cabYaw - l.dx * 0.005, -2.3, 2.3);
    look.cabPitch = clamp(look.cabPitch - l.dy * 0.004, -0.95, 0.95);
    if (!l.dx && !l.dy && heli.speed > 4) { const k = 1 - Math.min(1, dt * 0.8); look.cabYaw *= k; look.cabPitch *= k; }
    heli.body.updateWorldMatrix(true, false);
    camera.position.copy(eyeV.copy(heli.eye).applyMatrix4(heli.body.matrixWorld));
    heli.body.getWorldQuaternion(qBody);
    camera.quaternion.copy(qBody).multiply(qLook.setFromEuler(eLook.set(look.cabPitch - 0.17, Math.PI + look.cabYaw, 0)));
    const narrow = camera.aspect < 1 ? Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 6) / camera.aspect))) : 0;
    const fov = Math.max(62, narrow);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  } else {
    look.orbit -= l.dx * 0.006;
    look.flyPitch = clamp(look.flyPitch + l.dy * 0.004, -0.1, 1.35);
    if (!l.dx && heli.speed > 4) look.orbit *= 1 - Math.min(1, dt * 0.6);
    flyHeading = flyHeading == null ? heli.heading : flyHeading + wrapAngle(heli.heading - flyHeading) * Math.min(1, dt * 1.8);
    // Higher up the camera looks further down and hangs further back, so the land fills the view.
    const high = clamp((heli.agl - 150) / 2200, 0, 1);
    const h = flyHeading + look.orbit, el = Math.min(1.4, look.flyPitch + high * 0.8), d = look.flyDist + Math.min(14, heli.speed * 0.16) + high * 30;
    _ft.set(-Math.sin(h) * Math.cos(el) * d, 2.6 + Math.sin(el) * d, -Math.cos(h) * Math.cos(el) * d);
    // The offset eases, not the position, so the camera never trails behind at speed.
    camOff.lerp(_ft, Math.min(1, dt * 3.5));
    camera.position.copy(heli.pos).add(camOff);
    camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z) + 1.5);
    flyTarget.set(heli.pos.x + Math.sin(heli.heading) * 3, heli.pos.y + 2.2, heli.pos.z + Math.cos(heli.heading) * 3);
    camera.lookAt(flyTarget);
    const fov = 55 + Math.min(1, heli.speed / 60) * 7;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  }
  if (shakeNow > 0.01) { camera.position.x += (Math.random() - 0.5) * shakeNow * 0.25; camera.position.y += (Math.random() - 0.5) * shakeNow * 0.25; }
  camHeading = heli.heading;
}
// Skydiving: behind and above him in free fall (no lag: the offset eases, not the position, as
// for the helicopter), further back and level with the canopy under it; or through his own eyes
// (C). Drag to look round. Never below the ground.
const skyOff = new THREE.Vector3(), _sk = new THREE.Vector3(), _sh = new THREE.Vector3();
const smooth01 = (agl, top) => 1 - smoothstep(0, top, Math.max(0, agl));
let skyHeading = null, skyAim = null;
let skyRefl = null, snowTracks = null, footStep = -1, washing = null, washTipShown = false, washDirtIn = 0, swimTipShown = false, soakTipShown = false, soakStill = 0, bathSteam = null, lastSkyDark = 0;
function skyCamera(dt, l) {
  const d = diver, agl = Math.max(0, d.agl), fallingNow = d.falling;
  const far = Math.min(16000, Math.max(Q.far || 3000, 2600 + agl * 3.6));
  // The near plane moves out with height, as in the helicopter: with the far plane 16 km out, a
  // near plane of a few centimetres left too little depth precision and the sky showed dark seams.
  const near = skyView === 'eyes' ? clamp(0.08 + agl * 0.0004, 0.08, 0.5) : clamp(0.3 + agl * 0.002, 0.3, 2);
  if (camera.far !== far || camera.near !== near) { camera.far = far; camera.near = near; camera.updateProjectionMatrix(); }
  look.orbit -= l.dx * 0.006;
  look.skyPitch = clamp((look.skyPitch || 0) + l.dy * 0.004, -0.5, 0.9);
  if (!l.dx) look.orbit *= 1 - Math.min(1, dt * 0.8);
  skyHeading = skyHeading == null ? d.heading : skyHeading + wrapAngle(d.heading - skyHeading) * Math.min(1, dt * (fallingNow ? 2.2 : 1.4));
  const h = skyHeading + look.orbit, fx = Math.sin(h), fz = Math.cos(h);
  if (skyView === 'eyes' && d.bone && d.root.visible) {
    d.bone.Head.getWorldPosition(_sh);
    const pitch = (fallingNow ? -0.75 : -0.22) - look.skyPitch * 0.8;
    camera.position.set(_sh.x + Math.sin(d.heading) * 0.16, _sh.y + 0.06, _sh.z + Math.cos(d.heading) * 0.16);
    camTarget.set(camera.position.x + fx * Math.cos(pitch), camera.position.y + Math.sin(pitch), camera.position.z + fz * Math.cos(pitch));
    camera.lookAt(camTarget);
    if (Math.abs(camera.fov - 72) > 0.05) { camera.fov += (72 - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
    return;
  }
  // Under the canopy the camera rides level with the wing, behind it, so you see across its back
  // with him hanging below; falling, it is close behind and above him.
  const low = fallingNow ? 0 : smooth01(d.agl, 25); // 1 at the ground, 0 from 25 m up
  const back = fallingNow ? 5 : 11 - low * 3, up = (fallingNow ? 2.6 : 5.4 - low * 3.2) + look.skyPitch * 6;
  _sk.set(-fx * back, up, -fz * back);
  skyOff.lerp(_sk, Math.min(1, dt * (d.state === 'exit' ? 1.6 : 3.5)));
  camera.position.copy(d.pos).add(skyOff);
  camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z) + 1.2);
  // It looks a little ahead along the smoothed heading, and eases its aim, so nothing jolts.
  if (fallingNow) _sh.set(d.pos.x + fx * 5, d.pos.y - 2.5, d.pos.z + fz * 5);
  else _sh.set(d.pos.x + fx * 2, d.pos.y + 2.1 - smooth01(d.agl, 25) * 1.2, d.pos.z + fz * 2);
  skyAim = skyAim ? skyAim.lerp(_sh, Math.min(1, dt * 6)) : _sh.clone();
  camTarget.copy(skyAim);
  camera.lookAt(camTarget);
  const fov = fallingNow ? 60 + clamp(d.speed / 55, 0, 1) * 10 : 60;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
}
canvas.addEventListener('wheel', (e) => {
  if (mode !== 'fly' || driveView === 'cockpit') return;
  e.preventDefault();
  look.flyDist = clamp(look.flyDist * Math.exp(e.deltaY * 0.0015), 12, 220);
}, { passive: false });

// C or the view button: Chase, Hood, Cockpit in turn. On foot it gets you back in the car.
const VIEW_TOASTS = { chase: 'Chase view.', hood: 'Hood view.', cockpit: 'Cockpit view. Drag to look around.' };
// Dipped or full beam (B, or the beam button on a phone at night).
function toggleBeam() {
  if (ride !== 'car') return;
  jeep.highBeam = !jeep.highBeam;
  $('t-beam')?.setAttribute('aria-pressed', String(jeep.highBeam));
  hud.toast(jeep.highBeam ? 'Full beam.' : 'Dipped beam.', { seconds: 1.4, priority: 2 });
  sfx.tick?.();
}
$('t-beam')?.addEventListener('click', () => toggleBeam());
function cycleView() {
  if (mode === 'sky') { skyView = skyView === 'eyes' ? 'chase' : 'eyes'; hud.toast(skyView === 'eyes' ? 'Through your own eyes. Drag to look around.' : 'Chase view.', { seconds: 2, priority: 2 }); return; }
  if (mode === 'walk') { getIn(); return; }
  if (mode === 'fly') { if (flySky) flySky = false; else setView(driveView === 'cockpit' ? 'chase' : 'cockpit'); look.cabPitch = 0; look.cabYaw = 0; syncLookButton(); return; }
  if (mode === 'lookup') { mode = 'chase'; syncLookButton(); }
  setView(VIEWS[(VIEWS.indexOf(driveView) + 1) % VIEWS.length]);
}
$('set-view').addEventListener('change', (e) => { if (e.target.value !== driveView && mode !== 'sky') setView(e.target.value); });
function setView(v) {
  driveView = v; settings.view = v; store.save();
  jeep.setView(v);
  look.cabYaw = 0; look.cabPitch = 0;
  hud.toast(VIEW_TOASTS[v], { seconds: 2.2, priority: 2 });
  track('setting_change', { setting: 'view', setting_value: v });
}
// E (or Step out in the menu): leave the car, or get back in.
function stepOut() {
  if (mode === 'sky') { hud.toast('You are in the air. Open your parachute and land first.', { seconds: 2.5, priority: 2 }); return; }
  if (ride === 'heli') {
    if (!heli.landed) { hud.toast('Land first, then step out.', { seconds: 2.5 }); return; }
    mode = 'walk'; walkTilt = false; heli.engineOn = false; walker.enter(heli); track('step_out'); look.walkYaw = 0;
    hud.toast('On foot. The rotor winds down. Press E to climb back in and fly.', { seconds: 3.5, priority: 2 });
    syncLookButton();
    return;
  }
  if (jeep.boatOn || jeep.boat > 0) { hud.toast('You are on the water. Head back to the shore to step out.', { seconds: 2.5 }); return; }
  if (jeep.speed > 2.5) { hud.toast('Slow down to step out.', { seconds: 2.5 }); return; }
  mode = 'walk'; walkTilt = false; walker.enter(jeep); track('step_out'); look.walkYaw = 0; badges.feat('walk');
  hud.toast(isTouch ? 'On foot. Hold Go to walk, then run; slide up from Go to jump. Run into a rock to climb it.' : 'On foot. Up walks; hold it or tap it again to run (Shift keeps walking). Space jumps; run into a rock to climb it. E gets back in.', { seconds: 4.5 });
  syncLookButton();
}
function getIn() {
  if (afterJump && ride === 'heli' && !heliBeside()) { callHeli(); return; }
  if (afterJump) endJump();
  if (ride === 'heli') { heli.auto = null; heli.touchdown = false; }
  mode = ride === 'heli' ? 'fly' : 'chase';
  flySky = false;
  if (ride === 'heli') heli.engineOn = true;
  walker.exit(); syncLookButton();
}
function toggleWalk() { if (mode === 'walk') getIn(); else stepOut(); }
// The lights usually sit to the north, so looking up turns you that way, the way a person would.
function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
function enterLookUp() { track('look_up'); mode = 'lookup'; look.yaw = wrapAngle(Math.PI - jeep.heading); look.pitch = 0.75; }
function toggleLookUp() {
  if (mode === 'sky') { hud.toast('Drag to look around while you fall.', { seconds: 2 }); return; }
  // In the helicopter: a view of the sky from above the rotor head, turned to the north (where the
  // lights usually are), and back.
  if (mode === 'fly') {
    flySky = !flySky;
    if (flySky) { track('look_up'); look.yaw = wrapAngle(Math.PI - heli.heading); look.pitch = 0.75; }
    syncLookButton();
    return;
  }
  if (mode === 'walk') { walkTilt = !walkTilt; look.pitch = 0.75; if (walkTilt) look.walkYaw = wrapAngle(Math.PI - walker.heading); }
  else if (mode === 'lookup') mode = 'chase';
  else enterLookUp();
  syncLookButton();
}
function syncLookButton() { $('t-look').setAttribute('aria-pressed', String(lookingUp() || mode === 'lookup')); }

// ---------- Sightings ----------
const TYPE_RANK = { [AURORA_TYPES.arc]: 0, [AURORA_TYPES.curtains]: 1, [AURORA_TYPES.pulsating]: 1.5, [AURORA_TYPES.pink]: 2, [AURORA_TYPES.red]: 3, [AURORA_TYPES.corona]: 4 };

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
      badges.check();
    };
    img.src = dataUrl;
  };
  const what = a.active ? `Sighting #${s.n}: ${s.type.toLowerCase()} at ${s.place}.` : `Postcard #${s.n} saved at ${s.place}.`;
  hud.toast(what, { seconds: 6, priority: 3, action: { label: 'View postcard', run: () => openPostcard(s.n) } });
  if (a.active) { countSighting(); track('aurora_sighting', { kp: s.kp, aurora_type: s.type, place: s.place, game_hour: Math.floor(s.hour) }); }
  else track('sky_photo', { place: s.place });
  if (a.active) checkChallenge(s);
}

function checkChallenge(s) {
  const rec = store.data.challenges[challenge.key];
  if (rec?.done) return;
  if (challenge.check(s)) {
    store.data.challenges[challenge.key] = { id: challenge.id, done: new Date().toISOString() };
    track('challenge_complete', { challenge: challenge.id });
    haptics.play('success', 0);
    store.save();
    badges.check();
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
  pcImg = img;
  pcOpts.note = `${captionFor(s)} Wish you were here.`;
  $('pc-note').value = pcOpts.note;
  await drawPostcard($('postcard-canvas'), s, img, pcOpts);
  $('pc-play').hidden = n !== 'shared';
  $('pc-again').hidden = n === 'shared';
  if ($('notebook').open) $('notebook').close();
  if (!pcDialog.open) pcDialog.showModal();
}
pcDialog.querySelector('[data-close]').addEventListener('click', () => pcDialog.close());
// Frame, note and filter: each change redraws the card.
let pcImg = null, pcRedraw = 0;
const pcOpts = { frame: 'postcard', filter: 'none', note: '' };
const redrawPostcard = () => { if (pcSighting) drawPostcard($('postcard-canvas'), pcSighting, pcImg, pcOpts); };
for (const seg of pcDialog.querySelectorAll('.pc-seg')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sfx.clack();
    for (const x of seg.querySelectorAll('button')) { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); }
    pcOpts[seg.dataset.opt] = b.dataset.v;
    track('postcard_option', { option: seg.dataset.opt, value: b.dataset.v });
    redrawPostcard();
  });
}
$('pc-note').addEventListener('input', (e) => { pcOpts.note = e.target.value; clearTimeout(pcRedraw); pcRedraw = setTimeout(redrawPostcard, 120); });
$('pc-again').addEventListener('click', () => { pcDialog.close(); if (!lookingUp() && (mode === 'chase' || mode === 'walk')) toggleLookUp(); setTimeout(snapPostcard, 900); });
$('pc-save').addEventListener('click', async () => { track('postcard_save'); download(await canvasBlob($('postcard-canvas')), `chasing-green-sighting-${pcSighting.n}.png`); });
$('pc-share').addEventListener('click', async () => {
  const r = await sharePostcard($('postcard-canvas'), pcSighting, linkFor(pcSighting));
  track('postcard_share', { result: r || 'shared' });
  if (r === 'downloaded') hud.toast('Sharing is not available here, so the image was saved instead.', { seconds: 4 });
});
$('pc-link').addEventListener('click', async () => {
  const link = linkFor(pcSighting);
  track('postcard_link_copy');
  const label = $('pc-link').querySelector('span');
  try { await navigator.clipboard.writeText(link); label.textContent = 'Link copied'; }
  catch { prompt('Copy this link', link); }
  setTimeout(() => (label.textContent = 'Copy link'), 2000);
});
// Keys on the postcard: Enter shares, S saves, L copies the link.
pcDialog.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches?.('button, textarea, input')) return;
  const k = e.key.toLowerCase();
  const b = k === 'enter' ? $('pc-share') : k === 's' ? $('pc-save') : k === 'l' ? $('pc-link') : k === 'p' && !$('pc-again').hidden ? $('pc-again') : null;
  if (b) { e.preventDefault(); b.click(); }
});
pcDialog.addEventListener('click', (e) => { if (e.target.closest('.panel-actions button')) sfx.confirm(); });
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
    ...(s.type === AURORA_TYPES.pulsating ? { breakup: 0, diffuse: 0.7, pulse: 1 } : {}),
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
const card = { el: $('infocard'), name: $('info-name'), desc: $('info-desc'), legend: $('info-legend'), fact: $('info-fact'), stamp: $('info-stamp'), kick: $('info-kick'), found: $('info-found'), kind: $('info-kind'), current: null };
const KIND_NAME = { waterfall: 'Waterfall', beach: 'Beach', bridge: 'Bridge', building: 'Landmark', canyon: 'Canyon', cave: 'Cave', crater: 'Crater', geothermal: 'Hot ground', geyser: 'Geyser', headland: 'Headland', horseshoe: 'Canyon', lagoon: 'Glacier lagoon', lake: 'Lake', lava: 'Lava field', mountain: 'Mountain', park: 'National park', pool: 'Hot pool', rift: 'Rift', sculpture: 'Sculpture', stadium: 'Stadium', town: 'Town', wreck: 'Wreck' };
const foundText = () => `${Object.keys(store.data.stamps).filter((id) => landmarks.list.some((l) => l.id === id)).length} / ${landmarks.list.length}`;
// How often the place card pops up: for every place, only for places not yet stamped, or never
// (the stamp toast still says where you are). Phones default to new places only.
const placeCards = () => settings.placeCards || (isTouch ? 'new' : 'all');
// The card's text: two lines of the description, cut at a word with an ellipsis and followed by a
// Read more link on the second line. Read more opens the rest in place (the full description,
// the legend and the fact), with Show less at its end.
const infoMore = $('info-more');
function fitCard() {
  const lm = card.current; if (!lm || card.el.hidden) return;
  const open = card.el.classList.contains('is-expanded'), full = lm.desc || '';
  const extra = !!(lm.legend || lm.fact);
  card.fitW = card.el.clientWidth; card.fitFor = lm.id; card.fitOpen = open;
  infoMore.textContent = open ? 'Show less' : 'Read more';
  if (open) {
    card.desc.textContent = full;
    const last = [card.fact, card.legend, card.desc].find((el) => !el.hidden && el.textContent);
    (last || card.desc).append(' ', infoMore);
    return;
  }
  const text = document.createTextNode(full);
  card.desc.replaceChildren(text, ' ', infoMore);
  const max = parseFloat(getComputedStyle(card.desc).lineHeight) * 2 + 2;
  if (card.desc.offsetHeight <= max) { infoMore.hidden = !extra; return; }
  infoMore.hidden = false;
  // The most words that still leave room for the ellipsis and the link on the second line.
  const words = full.split(/\s+/);
  let lo = 0, hi = words.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    text.data = words.slice(0, mid).join(' ').replace(/[\s,.;:–-]+$/, '') + '…';
    if (card.desc.offsetHeight <= max) lo = mid; else hi = mid - 1;
  }
  text.data = words.slice(0, lo).join(' ').replace(/[\s,.;:–-]+$/, '') + '…';
}
function setCardExpanded(open) {
  card.el.classList.toggle('is-expanded', open);
  infoMore.setAttribute('aria-expanded', String(open));
  fitCard();
}
infoMore.addEventListener('click', () => {
  const open = !card.el.classList.contains('is-expanded');
  setCardExpanded(open);
  // Closed again, it stays a few seconds more before tucking itself away.
  if (!open && card.shownAt != null) card.shownAt = Math.max(card.shownAt, performance.now() - 7000);
});
addEventListener('resize', () => { card.fitFor = null; });

function updateLandmarks(p) {
  const near = landmarks.nearest(p.x, p.z), lm = near.lm;
  // From the helicopter a place counts once you come down to it, not while flying high over it.
  const dist = mode === 'fly' ? Math.hypot(near.dist, Math.max(0, heli.agl - 60)) : mode === 'sky' ? Math.hypot(near.dist, Math.max(0, diver.agl - 60)) : near.dist;
  const reach = lm.reach || CONFIG.landmarkRadius;
  // Whether this place was new to you, judged before a stamp can land in this same step.
  const unstamped = !store.data.stamps[lm.id];
  if (dist < reach) {
    if (store.stamp(lm.id)) {
      countStamp();
      track('landmark_stamp', { landmark: lm.id, landmark_name: lm.name, stamps_total: Object.keys(store.data.stamps).length });
      hud.toast(`New stamp: ${lm.name}.`, { seconds: 4, priority: 2 });
      haptics.play('success', 0);
      if (card.current === lm) { card.stamp.innerHTML = stampSvg(lm.name, lm.glyph, true, 'card'); card.found.textContent = foundText(); $('info-found2').textContent = `${foundText()} found`; }
      badges.check();
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
      card.kick.textContent = unstamped ? 'New place found' : 'Back again';
      card.found.textContent = foundText();
      card.kind.textContent = KIND_NAME[lm.kind] || 'Place';
      $('info-kind2').textContent = KIND_NAME[lm.kind] || 'Place';
      $('info-found2').textContent = `${foundText()} found`;
      $('info-glyph').innerHTML = GLYPHS[lm.glyph] || GLYPHS.peak;
      card.el.classList.toggle('is-long', lm.name.length > 13);
      card.shownAt = null;
      // Decided once per visit, so a card shown for a new place stays up after its stamp lands.
      card.wanted = placeCards() === 'all' || (placeCards() === 'new' && unstamped);
      setCardExpanded(false);
    }
    // Never while skydiving: on a phone the card sat over the Open button.
    card.el.hidden = infoDismissed === lm.id || !card.wanted || mode === 'sky' || document.body.classList.contains('has-touch');
    document.body.classList.toggle('card-on', !card.el.hidden);
    if (!card.el.hidden && (card.fitFor !== lm.id || card.fitW !== card.el.clientWidth)) fitCard();
    // The card tucks itself away after a while of driving so it never sits over the view for good.
    if (!card.el.hidden && started && !card.el.classList.contains('is-expanded')) {
      card.shownAt ??= performance.now();
      if (performance.now() - card.shownAt > 12000) { infoDismissed = lm.id; card.el.hidden = true; }
    }
  } else {
    card.el.hidden = true;
    document.body.classList.remove('card-on');
    card.current = null;
    if (infoDismissed === lm.id) infoDismissed = null;
  }
  return { lm, dist };
}

// ---------- UI wiring ----------
const badges = new Badges({ onEarn: (b) => { haptics.play('success', 0); sfx.chime(); track('badge_earned', { badge: b.id }); } });
const notebook = new Notebook({ onPostcard: (n) => openPostcard(n), getChallenge: () => challenge, badges, overview: () => journeyOverview() });
$('btn-notebook').addEventListener('click', () => notebook.open());
$('btn-camera').addEventListener('click', cycleView);
$('btn-mute').addEventListener('click', () => setMuted(!audio.muted));
function setMuted(m) {
  audio.setMuted(m);
  settings.muted = m; store.save();
  $('btn-mute').setAttribute('aria-pressed', String(m));
  $('btn-mute').setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  $('sound-muted').hidden = !m;
  if ($('set-sound')) { $('set-sound').value = m ? 'off' : 'on'; $('settings').dispatchEvent(new Event('sync')); }
}
setMuted(audio.muted);

// ---------- Sound tab: a volume for each group ----------
$('sound-unmute').addEventListener('click', () => { haptics.play('select'); setMuted(false); });
for (const input of document.querySelectorAll('input.vol')) {
  const k = input.dataset.vol, out = input.nextElementSibling;
  const show = () => { out.textContent = `${input.value}%`; input.style.setProperty('--p', `${input.value}%`); };
  input.value = Math.round(volumes[k] * 100);
  show();
  input.addEventListener('input', () => { volumes[k] = input.value / 100; show(); audio.setLevels({ [k]: volumes[k] }); });
  input.addEventListener('change', () => { store.save(); haptics.play('select'); track('setting_change', { setting: `volume_${k}`, setting_value: input.value }); });
}

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
  $('quick-walk').textContent = mode === 'sky' ? 'In the air' : mode === 'walk' ? (afterJump && ride === 'heli' && !heliBeside() ? 'Call helicopter' : 'Get in') : 'Step out';
  $('set-quality').value = qualityName;
  $('set-month').value = String(clock.month);
  $('set-speed').value = String(clock.speed);
  $('set-rocks').value = settings.rocks || 'normal';
  $('set-look').value = settings.look || 'realistic';
  $('set-nitro').value = settings.nitro || 'on';
  $('set-haptics').value = settings.haptics || 'on';
  $('set-places').value = placeCards();
  $('set-steering').value = settings.steering || 'buttons';
  $('set-heli').value = settings.heli || 'easy';
  $('set-view').value = driveView;
  $('set-full').value = document.fullscreenElement ? 'on' : 'off';
  $('set-sound').value = audio.muted ? 'off' : 'on';
  settingsDialog.showModal();
  settingsDialog.dispatchEvent(new Event('sync'));
}
$('btn-settings').addEventListener('click', openSettings);
sheet.register('settings', openSettings);
// Journey: the trip so far at a glance.
// Journey's overview: the trip so far, and tonight on the right.
function journeyOverview() {
  const total = landmarks?.list.length || 57, found = Object.keys(store.data.stamps).filter((id) => !landmarks || landmarks.list.some((l) => l.id === id)).length;
  const lights = store.data.sightings.filter((x) => x.type !== 'Sky' && x.type !== 'Night sky').length;
  const got = Object.keys(store.data.badges || {}).length, rec = store.data.challenges[challenge.key];
  const win = clock.midnightSun ? 'Midnight sun: no aurora this month' : hud.nextWindowText ? `Lights likely around ${hud.nextWindowText}` : `${clock.m.name}: aurora chance ${clock.m.chance.toLowerCase()}`;
  const mid = `<div class="jr-mid">
      <div class="jr-hero"><p class="jr-k">Places found</p><p class="jr-big"><b>${found}</b> / ${total}</p><i class="jr-bar"><b style="width:${((found / total) * 100).toFixed(1)}%"></b></i></div>
      <div class="jr-grid">
        <div><p class="jr-k">Aurora sightings</p><b>${lights}</b></div>
        <div><p class="jr-k">Postcards</p><b>${store.data.sightings.length}</b></div>
        <div><p class="jr-k">Badges</p><b>${got} / ${badges.total}</b></div>
        <div><p class="jr-k">Trips</p><b>${store.data.trips || 1}</b></div>
      </div>
      <div class="jr-card"><p class="jr-k">Today's challenge</p><h4>${challenge.title}</h4><p>${challenge.detail}</p><p class="jr-done">${rec?.done ? 'Done. Stamp in your notebook.' : 'Not done yet'}</p></div>
    </div>`;
  const note = `<p class="sn-kick">Tonight</p><h4 class="sn-title">${clock.m.name}</h4><p class="sn-text">${win}.</p>
      <div class="sn-three"><div><span>Dark</span><b>${clock.darkHours().toFixed(1)} h</b></div><div><span>Aurora</span><b class="g">${clock.m.chance}</b></div><div><span>Kp now</span><b>${(lastAurora?.kp ?? 0).toFixed(1)}</b></div></div>
      <p class="sn-tip">${clock.m.tip}</p>`;
  return { mid, note };
}
sheet.register('notebook', () => notebook.open());
pcDialog.addEventListener('click', (e) => { if (e.target === pcDialog) pcDialog.close(); });
$('set-places').addEventListener('change', (e) => {
  settings.placeCards = e.target.value; store.save();
  if (card.current) card.wanted = placeCards() === 'all' || (placeCards() === 'new' && !store.data.stamps[card.current.id]);
  track('setting_change', { setting: 'place_cards', setting_value: e.target.value });
});
// ---------- Tilt steering (touch screens) ----------
// The arrow buttons stay until the first tilt reading arrives, so a phone that cannot report tilt
// (or has not been allowed to) is never left without steering.
const needsTiltPermission = () => typeof window.DeviceOrientationEvent?.requestPermission === 'function';
function applySteering() {
  const tilt = settings.steering === 'tilt' && document.body.classList.contains('has-touch');
  input.setTilt(tilt);
  document.body.classList.toggle('tilt-steer', tilt && input.tiltSeen);
  clearTimeout(applySteering.timer);
  if (!tilt || needsTiltPermission()) return;
  // No readings after a moment and no permission to wait for: there is no sensor.
  applySteering.timer = setTimeout(() => {
    if (!input.tiltOn || input.tiltSeen) return;
    settings.steering = 'buttons'; store.save(); applySteering();
    hud.toast('This device does not report tilt, so steering is back on the buttons.', { seconds: 5, priority: 2 });
  }, 2500);
}
input.onTiltStart = () => document.body.classList.add('tilt-steer');
// iOS lets a page read tilt only after asking from a tap, so ask on the next tap while it waits.
let tiltAsk = 'idle';
addEventListener('touchend', () => {
  if (tiltAsk !== 'idle' || settings.steering !== 'tilt' || input.tiltSeen || !needsTiltPermission() || !document.body.classList.contains('has-touch')) return;
  tiltAsk = 'asking';
  Input.askTilt().then((ok) => {
    tiltAsk = ok ? 'idle' : 'refused';
    if (!ok) { settings.steering = 'buttons'; store.save(); hud.toast('Motion access was not allowed, so steering stays on the buttons.', { seconds: 5, priority: 2 }); }
    applySteering();
  });
});
$('set-steering').addEventListener('change', (e) => {
  const v = e.target.value;
  settings.steering = v; store.save();
  if (v === 'tilt') { tiltAsk = 'idle'; Input.askTilt().then(applySteering); hud.toast('Hold the phone like a steering wheel. Level is straight ahead.', { seconds: 5, priority: 2 }); }
  applySteering();
  track('setting_change', { setting: 'steering', setting_value: v });
});

$('set-haptics').addEventListener('change', (e) => {
  settings.haptics = e.target.value; store.save();
  haptics.enabled = settings.haptics !== 'off';
  haptics.play('medium');
});
$('set-quality').addEventListener('change', (e) => { holdFrame(() => setQuality(e.target.value, true)); track('setting_change', { setting: 'graphics', setting_value: e.target.value }); });
function setQuality(name, save) {
  qualityName = name; Q = qualityFor(name);
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio) * resScale);
  renderer.setSize(innerWidth, innerHeight, false);
  aurora?.setSteps(Q.auroraSteps);
  camera.far = Q.far || 3000; camera.updateProjectionMatrix();
  if (world) {
    if (Q.post && !post) post = new Post(renderer, scene, camera, { ao: !!Q.ao, samples: Q.msaa ?? 4 });
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
  if (save) { settings.quality = name; delete settings.autoQuality; store.save(); }
}
$('set-month').addEventListener('change', (e) => setMonth(+e.target.value, true));
// Months drive the sun path, darkness and aurora chance. The visual season follows from the month.
function monthCardHTML() {
  const m = clock.m;
  const day = Math.max(0, Math.min(24, m.sunset - m.sunrise));
  const dark = clock.darkHours();
  return `<h3>${m.name}</h3><dl><div><dt>Daylight</dt><dd>${day.toFixed(1)} h</dd></div><div><dt>Dark hours</dt><dd>${dark.toFixed(1)} h</dd></div><div><dt>Aurora chance</dt><dd>${m.chance}</dd></div></dl><p>${m.tip}</p>`;
}
function renderMonthCards() {
  document.querySelectorAll('.month-card').forEach((el) => (el.innerHTML = monthCardHTML()));
  $('intro-sub').textContent = `${clock.m.name} in Iceland`;
}
function setMonth(m, announce = false) {
  clock.month = m; settings.month = m; store.save();
  if (announce) track('setting_change', { setting: 'month', setting_value: clock.m.name });
  forecast.monthFactor = clock.m.aurora;
  forecast.nights.clear();
  document.querySelectorAll('.month-select').forEach((sel) => (sel.value = String(m)));
  renderMonthCards();
  setSeason(clock.season, announce);
  // Snow line by month: low in midwinter, high glaciers only in summer.
  surfaceUniforms.uSnowLine.value = snowLineFor(m);
}
function setSeason(season, announce = true) {
  if (world) { paintTerrain(season); scatter?.setSeason(season); }
  if (!announce) return;
  if (started) hud.toast(clock.midnightSun ? `${clock.m.name}. Midnight sun. No aurora this month.` : `${clock.m.name}. Aurora chance: ${clock.m.chance.toLowerCase()}. ${clock.m.tip}`, { seconds: 5 });
}
$('set-speed').addEventListener('change', (e) => { clock.speed = +e.target.value; settings.speed = clock.speed; store.save(); });
$('set-look').addEventListener('change', (e) => { settings.look = e.target.value; store.save(); hud.toast('The look changes on the next load. Reload the page to apply it.', { seconds: 4 }); track('setting_change', { setting: 'look', setting_value: e.target.value }); });
$('set-rocks').addEventListener('change', (e) => { settings.rocks = e.target.value; store.save(); hud.toast('Rock density changes on the next load. Reload the page to apply it.', { seconds: 4 }); });
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
  if (k === 'walk') toggleWalk();
  else if (k === 'record') toggleRecording();
  else if (k === 'mute') setMuted(!audio.muted);
  else if (k === 'fullscreen') goLandscape();
}));
// The touch layout is for touch screens only. A computer always gets the computer layout: an old
// "Touch controls: Show" setting from before used to switch a laptop to the phone layout.
if (settings.touch === 'on' && !isTouch) { settings.touch = 'auto'; store.save(); }
// Marked from the first frame, so the start screen and its menu use the touch layout too.
document.body.classList.toggle('has-touch', settings.touch !== 'off' && (isTouch || matchMedia('(pointer: coarse)').matches));
function syncTouch() {
  const show = settings.touch !== 'off' && (isTouch || matchMedia('(pointer: coarse)').matches);
  $('touch').hidden = !show;
  document.body.classList.toggle('has-touch', show);
  if (!!input.tiltOn !== (show && settings.steering === 'tilt')) applySteering();
}
input.bindSteerPair($('t-left'), $('t-right'), () => haptics.play('select', 0));
input.bindGasButton($('t-gas'), (up) => { if (up) nitroHint(); });
input.bindTouchButton($('t-brake'), 'brake');
input.bindTouchButton($('t-up'), 'up');
input.bindTouchButton($('t-down'), 'down');

// ---------- Brake doubles as reverse ----------
// The pedal says so ("Brake & reverse"), switches to "Reverse" with a back arrow while the car
// backs up, and on a touch screen the first drive points it out once.
const brakeBtn = $('t-brake');
const tips = settings.tips || (settings.tips = {});
let reverseShown = false;
function syncBrakePedal() {
  const rev = mode !== 'walk' && mode !== 'fly' && mode !== 'sky' && (jeep.vF < -0.3 || (input.throttle < 0 && Math.abs(jeep.vF) < 0.6));
  if (rev === reverseShown) return;
  reverseShown = rev;
  brakeBtn.classList.toggle('is-reverse', rev);
  brakeBtn.setAttribute('aria-label', rev ? 'Reverse. Let go to stop' : 'Brake. Keep holding to reverse');
}
function showReverseTip() {
  if (tips.reverse || !isTouch || !started) return;
  // Wait for a clear moment: driving, no menu open, and no place card where the bubble would go.
  if (mode === 'walk' || mode === 'sky' || !brakeBtn.offsetParent || document.querySelector('dialog[open]') || !$('infocard').hidden) { setTimeout(showReverseTip, 3000); return; }
  tips.reverse = true; store.save();
  const tip = $('coach-reverse'), b = brakeBtn.getBoundingClientRect();
  tip.hidden = false;
  // The bubble reaches left from the pedal, so it stays clear of Go and its nitro hint.
  const left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, b.left + b.width / 2 - tip.offsetWidth + 28));
  tip.style.left = `${left}px`;
  tip.style.top = `${b.top - tip.offsetHeight - 12}px`;
  tip.style.setProperty('--arrow', `${b.left + b.width / 2 - left}px`);
  const hide = () => { tip.hidden = true; };
  setTimeout(hide, 7000);
  tip.addEventListener('pointerdown', hide, { once: true });
  brakeBtn.addEventListener('pointerdown', hide, { once: true });
}
// Nitro lives on Go: slide the finger up from Go to boost, back down to ease off. The ring
// around Go shows how much is left.
let nitroHinted = false, onBike = null;
function nitroHint() {
  if (mode !== 'chase' && mode !== 'lookup') return; // on foot the slide jumps; in the air it does nothing
  haptics.play('heavy', 0);
  if (nitroHinted === (jeep?.spec.bike ? 'bike' : 'car')) return;
  nitroHinted = jeep?.spec.bike ? 'bike' : 'car';
  hud.toast(jeep?.spec.bike ? 'Wheelie! Slide back down to bring the front down.' : 'Nitro! Slide back down to ease off.', { seconds: 2, priority: 2 });
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
$('intro-challenge').textContent = challenge.title;
// ---------- Garage ----------
// The start screen's vehicle panel: what it is, its name in the brackets, and four stats either
// side, each a value and a ten-step bar.
const KIND_LABEL = { jeep: '1940s field car', vintage: '1930s coupé', camper: '1960s camper van', race: 'Mid-engine supercar', bike: 'Café racer', heli: 'Twin-engine helicopter' };
function vehicleStats(kind) {
  const seg = (v) => Math.max(1, Math.min(10, Math.round(v * 10)));
  if (kind === 'heli') return [['Top speed', '223', 'km/h', 9], ['Range', 'All', 'Iceland', 10], ['Climb', 'Fast', '', 8], ['Landing', 'Flat', 'ground', 6]];
  const v = VEHICLES[kind], kmh = Math.round(v.maxSpeed * 3.6), off = (v.offroad.gravel + v.offroad.moss + v.offroad.sand) / 3;
  const litres = TANKS[kind]?.litres;
  return [['Top speed', String(kmh), 'km/h', seg(kmh / 240)], ['Off-road', String(Math.round(off * 10)), '/ 10', seg(off)],
    ['Wading depth', v.wade.toFixed(1), 'm', seg(v.wade / 2.8)], litres ? ['Fuel tank', String(litres), 'L', seg(litres / 90)] : ['Weight', 'Light', '', 3]];
}
function introInfo(kind, ids = { name: 'intro-car', kick: 'intro-kick', l: 'gx-stats-l', r: 'gx-stats-r' }) {
  const name = $(ids.name);
  name.textContent = kind === 'heli' ? 'Helicopter' : VEHICLES[kind].name;
  // The name fills its brackets: as large as fits, never cut off.
  name.style.fontSize = '';
  requestAnimationFrame(() => { let f = parseFloat(getComputedStyle(name).fontSize); while (name.scrollWidth > name.clientWidth + 1 && f > 18) name.style.fontSize = `${(f -= 2)}px`; });
  $(ids.kick).textContent = KIND_LABEL[kind] || '';
  // Each bar fills segment by segment and each number counts up, so a switch is seen, not just swapped.
  const stats = vehicleStats(kind).map(([t, v, u, n], row) => `<div class="gx-stat"><div class="gx-t">${t}</div><div class="gx-v"><span class="gx-num" data-to="${v}">${v}</span><small>${u}</small></div><div class="gx-segs">${Array.from({ length: 10 }, (_, i) => `<i${i < n ? ' class="on"' : ''} style="--i:${i + row * 2}"></i>`).join('')}</div></div>`);
  $(ids.l).innerHTML = stats.slice(0, 2).join('');
  $(ids.r).innerHTML = stats.slice(2).join('');
  for (const el of [$(ids.l), $(ids.r)]) for (const num of el.querySelectorAll('.gx-num')) {
    const to = parseFloat(num.dataset.to);
    if (!Number.isFinite(to) || matchMedia('(prefers-reduced-motion: reduce)').matches) continue;
    const dec = (num.dataset.to.split('.')[1] || '').length, t0 = performance.now();
    const step = () => { const u = Math.min(1, (performance.now() - t0) / 700), e = 1 - Math.pow(1 - u, 3); num.textContent = (to * e).toFixed(dec); if (u < 1) requestAnimationFrame(step); };
    num.textContent = (0).toFixed(dec); requestAnimationFrame(step);
  }
}

// ---------- Cover ----------
// The start screen plays from the first frame: the aurora sky, and the chosen vehicle on wet
// ground in front of it. The arrows change vehicle (the same as the garage), and the car models
// start loading now, so the cover and the car you drive both have them as early as possible.
const COVER_ORDER = [...VEHICLE_ORDER, 'heli'];
const gg = { cover: null, sky: null, kind: null }; // the menu's garage view (below)
const introSky = startAuroraSky($('intro-sky'));
const cover = new Cover($('intro-hero'), { spot: document.querySelector('.cv-spot'), small: isTouch });
cover.paused = true; // nothing to draw behind the splash; it starts when the splash lifts
const coverKind = () => (settings.vehicle === 'heli' ? 'heli' : VEHICLES[settings.vehicle] ? settings.vehicle : 'jeep');
introInfo(coverKind());
// The splash comes first; the garage (and the vehicle rolling in) only once you press a key or tap,
// which also lets the sound play. The island keeps loading the whole time.
$('intro').classList.add('is-splash');
const spBar = setInterval(() => { $('sp-bar').style.width = `${startBtn.getAttribute('aria-valuenow') || 0}%`; if (!startBtn.disabled) $('sp-bar').style.width = '100%'; }, 200);
function closeSplash() {
  if (!$('intro').classList.contains('is-splash')) return;
  wakeUiSfx();
  // Every car's arrival sound, fetched now so a switch never waits for it.
  $('intro').classList.remove('is-splash');
  cover.paused = false;
  $('intro').classList.add('is-garage-in');
  clearInterval(spBar);
  setTimeout(() => { $('splash').hidden = true; }, 700);
  setTimeout(() => { const k = coverKind(); cover.show(k, true); if (cover.car && k === 'heli') sfx.arrive(k); }, 450);
}
// CHASING is set exactly as wide as GREEN below it: its letter spacing is worked out from both widths.
function fitSplashTitle() {
  const a = document.querySelector('.sp-a'), b = document.querySelector('.sp-b');
  if (!a || !b) return;
  // The ink of each word (first letter's left to last letter's right), so spacing after the last
  // letter never counts.
  const ink = (el) => { const t = el.firstChild, r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1); const l = r.getBoundingClientRect().left; r.setStart(t, t.length - 1); r.setEnd(t, t.length); const rt = r.getBoundingClientRect(); return rt.right - l; };
  a.style.letterSpacing = '0px'; a.style.marginRight = '0px';
  const lastB = (() => { const t = b.firstChild, r = document.createRange(); r.setStart(t, t.length - 1); r.setEnd(t, t.length); return r.getBoundingClientRect().width - parseFloat(getComputedStyle(b).letterSpacing); })();
  const wb = ink(b) - (parseFloat(getComputedStyle(b).letterSpacing) || 0) + 0 * lastB, wa = ink(a);
  const n = a.textContent.length, sp = Math.max(0, (wb - wa) / (n - 1));
  a.style.letterSpacing = `${sp}px`; a.style.marginRight = `${-sp}px`;
}
document.fonts.ready.then(fitSplashTitle);
addEventListener('resize', fitSplashTitle);
$('splash').addEventListener('pointerdown', (e) => { e.preventDefault(); closeSplash(); });
addEventListener('keydown', (e) => { if ($('intro').classList.contains('is-splash') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); closeSplash(); } }, true);
loadCarModels((kind) => {
  cover.refresh(kind);
  gg.cover?.refresh(kind);
  resetCarThumbs();
  if (jeep && jeep.kind === kind && ride === 'car') jeep.setType(kind);
  renderGarage();
});
for (const [id, step] of [['cv-prev', -1], ['cv-next', 1]]) $(id).addEventListener('click', () => {
  const i = COVER_ORDER.indexOf(coverKind());
  const kind = COVER_ORDER[(i + step + COVER_ORDER.length) % COVER_ORDER.length];
  haptics.play('light');
  setVehicle(kind, false);
  sfx.switcher();
  cover.show(kind, true);
  if (cover.car && kind === 'heli') setTimeout(() => sfx.arrive(kind), 120);
});
const startBtn = $('start');
startBtn.disabled = true;
// The start screen keeps only a settings button; the menu holds everything else.
document.body.classList.add('pre-start');
$('gx-menu').addEventListener('click', () => { haptics.play('select'); sheet.go('settings'); setCat('trip'); });
addEventListener('keydown', (e) => {
  if (started || document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); $(k === 'arrowleft' ? 'cv-prev' : 'cv-next').click(); }
  else if (k === 'enter' && !startBtn.disabled && document.activeElement?.tagName !== 'SELECT') { e.preventDefault(); startBtn.click(); }
});
startBtn.addEventListener('click', () => {
  audio.start();
  audio.setMuted(audio.muted);
  started = true;
  store.data.trips++; store.save();
  track('game_start', { month: clock.m.name, vehicle: settings.vehicle || 'jeep', graphics: qualityName, input: isTouch ? 'touch' : 'keyboard', trip_number: store.data.trips });
  $('intro').classList.add('is-leaving');
  document.body.classList.remove('pre-start');
  // The cover fades out over the island; then its two canvases let go of their GPU contexts.
  setTimeout(() => { $('intro').hidden = true; cover.dispose(); introSky.stop(); }, 900);
  hud.show();
  syncTouch();
  playOpening();
  setTimeout(() => { if (!document.getElementById('sheet').open) ggPrewarm(); }, 9000);
  // On a computer the refuel line sits under the fuel reading, as text, and nothing moves for it.
  if (!document.body.classList.contains('has-touch')) $('hx-fuelside').append($('fuel-act'));
  if (settings.steering === 'tilt') Input.askTilt().then(applySteering);
  if (isTouch) { touchLayout(); goLandscape(); }
  canvas.focus();
  setTimeout(() => hud.toast(isTouch ? 'The Kp, bottom right, is how strong the aurora is. Tap it for the aurora radio.' : 'The Kp, bottom right, is how strong the aurora is. Click it, or press K, for the aurora radio.', { seconds: 7 }), 4200);
  setTimeout(showReverseTip, 8000);
});

// The opening, like a game's first shot: widescreen bars, the camera sweeping down onto the car, a
// title card with where and when you are, then the bars lift, the HUD comes up and the gauges wake.
function playOpening() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = reduce ? 0 : 3400;
  if (dur) openingCam = { t0: performance.now(), dur };
  const p = activePos(), where = describePlace(p.x, p.z).label;
  $('op-kick').textContent = `Day ${clock.day + 1} · ${clock.m.name} · ${clock.label()}`;
  $('op-place').textContent = where;
  document.body.classList.add('is-opening');
  hud.boot = performance.now() + dur - 600; // the gauges wake as the camera settles
  setTimeout(() => document.body.classList.remove('is-opening'), dur + 400);
}

// ---------- Photo mode ----------
let lastSky = null;
const photo = new PhotoMode({
  camera, renderer, canvas, getPost: () => post, groundAt: (x, z) => Math.max(heightAt(x, z), waterLevelAt(x, z)),
  onShot: () => { const a = lastAurora || lastSky; if (a && performance.now() - lastShot > 900) logSighting(a, { manual: true }); },
  onChange: (on) => { track(on ? 'photo_open' : 'photo_close'); if (on) hud.toast('Photo mode. Esc to leave.', { seconds: 2, priority: 2 }); },
});
function openPhoto() { if (started && !document.querySelector('dialog[open]') && mode !== 'sky') photo.open(); }
$('mo-photo')?.addEventListener('click', () => openPhoto());
function snapPostcard() { if (lastAurora && performance.now() - lastShot > 1200) logSighting(lastAurora, { manual: true }); }
$('mo-look').addEventListener('click', () => { if (mode === 'chase' || mode === 'walk') toggleLookUp(); });
$('mo-rec').addEventListener('click', () => toggleRecording());
$('mo-card').addEventListener('click', () => snapPostcard());

addEventListener('keydown', (e) => {
  if (!started || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k === 'j' && mode === 'fly') jump();
  else if ((k === 'j' || k === ' ') && mode === 'sky') diver.open();
  else if (k === 'c') cycleView();
  else if (k === 'e') toggleWalk();
  else if (k === 'l') toggleLookUp();
  else if (k === 'u') setMuted(!audio.muted);
  else if (k === 'm') mapUI?.open();
  else if (k === 'v') cycleVehicle();
  else if (k === 'n') notebook.open();
  else if (k === 'r') toggleRecording();
  else if (k === 'p') snapPostcard();
  else if (k === 'x') toggleSit();
  else if (k === 'h') learn.open();
  else if (k === 'f') fuelAction();
  else if (k === 'k') $('radio').classList.toggle('is-open');
  else if (k === 'b') toggleBeam();
  else if (k === 'o') openPhoto();
});

// The car wash at a fuel station: rolling through slowly, the brushes spin, water sprays from
// the bar and drums on the roof, and the dirt comes off. Faster than a crawl it only half works.
function carWash(dt, sp) {
  const W = dt && ride === 'car' && mode === 'chase' && jeep.boat < 0.1 ? stations.washAt(jeep.pos.x, jeep.pos.z) : null;
  if (W && !washing) {
    washDirtIn = carDirt.dirt;
    if (!washTipShown) { washTipShown = true; hud.toast(`Car wash at ${W.s.name}. Roll through slowly.`, { seconds: 3.5, priority: 1 }); }
    track('car_wash', { station: W.s.name });
  }
  if (!W && washing && washDirtIn > 0.12) {
    hud.toast(carDirt.dirt < 0.05 ? 'Clean again.' : 'Still a bit dirty. Go through again, slower.', { seconds: 2.5, priority: 1 });
    carDirt.saved = carDirt.dirt; store.save();
  }
  washing = W;
  stations.updateWash(dt, W);
  if (!W) return;
  const slow = clamp(1.5 - sp / 5, 0.3, 1);
  carDirt.dirt = Math.max(0, carDirt.dirt - dt * 1.1 * slow);
  grime.uDirt.value = carDirt.dirt;
  for (const q of stations.washPoints(W.s)) for (let k = Math.floor(dt * 30 + Math.random()); k > 0; k--) spray.emit(q.x, q.y, q.z, (Math.random() - 0.5) * 1.5, -2 - Math.random() * 2, (Math.random() - 0.5) * 1.5, 1, 0.3, 0.6);
}

// Snow underfoot or under the tyres: snowy ground, or a road in winter.
function onSnow(x, z, surface = surfaceAt(x, z)) {
  if (surface === 'snow') return true;
  return (surface === 'paved' || surface === 'gravel') && roadSnow > 0.3;
}
// Boot prints, one at each footfall, on snow.
function footprints() {
  if (walker.state !== 'walk' || walker.speedSmooth < 0.2) { footStep = -1; return; }
  const step = Math.floor(walker.stride * 2) % 2;
  if (step === footStep) return;
  footStep = step;
  const h = walker.heading, side = step ? 1 : -1, x = walker.pos.x + Math.cos(h) * 0.11 * side, z = walker.pos.z - Math.sin(h) * 0.11 * side;
  if (onSnow(x, z)) snowTracks.foot(x, walker.groundAt(x, z) + 0.03, z, h, performance.now() / 1000);
}

// ---------- Hot pools ----------
// In: a soft splash and, the first time, a word on what to do. Standing still a few seconds he
// leans back to watch the sky (the sitting view, with time running faster), and steam curls off
// the water round about.
function soakUpdate(dt) {
  const ev = walker.soakEvent; walker.soakEvent = null;
  if (ev === 'in') {
    audio.splash(0.18, 'puddle'); haptics.play('light');
    track('hot_pool', { place: walker.bath?.lm?.id });
    if (!soakTipShown) { soakTipShown = true; hud.toast(`${walker.bath?.lm?.name || 'Hot water'}. Warm at last. Stand still to lean back and watch the sky.`, { seconds: 4.5, priority: 2 }); }
  }
  if (ev === 'out' && sitting) toggleSit(false);
  if (!walker.soaking) { soakStill = 0; return; }
  const B = walker.bath, still = walker.speedSmooth < 0.08 && !input.throttle && !input.steer && dt > 0;
  soakStill = still ? soakStill + dt : 0;
  if (soakStill > 3 && !sitting) toggleSit(true);
  if (dt && bathSteam) {
    // Pale wisps that hang low over the water: lit faintly at night, never darker than the sky.
    const light = 1 - (lastSkyDark || 0) * 0.6;
    bathSteam.mat.color.setRGB(0.93 * light, 0.95 * light, 0.96 * light);
    for (let k = Math.floor(dt * 8 + Math.random()); k > 0; k--) {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3.5;
      bathSteam.emit(walker.pos.x + Math.cos(a) * r, B.y + 0.05, walker.pos.z + Math.sin(a) * r, 0, 0.1 + Math.random() * 0.15, 0, 1, 0.3, 2.5 + Math.random() * 1.5);
    }
  }
}

// ---------- Learn, sitting, nitro option ----------
const learn = new Learn();
sheet.register('learn', () => learn.open());
// Sit down on foot: lower view, free look, and time passes faster while you rest and watch.
function toggleSit(force) {
  if (mode === 'sky') return;
  if (mode !== 'walk') { hud.toast('Step out of the car first (E), then sit down.', { seconds: 2.5 }); return; }
  sitting = force ?? !sitting;
  walker.setSitting?.(sitting);
  if (sitting) {
    sitSpeedBefore = clock.speed; clock.speed = Math.max(clock.speed, 6);
    track('sit_down');
    look.pitch = 0.45; look.walkYaw = 0;
    hud.toast(walker.soaking ? `Leaning back in the hot water. Time passes faster while you soak. Drag to look around${isTouch ? '' : ', X to sit up'}, move to get going.` : 'Sitting down. Time passes faster while you rest. Drag to look around, X to stand.', { seconds: 4.5, priority: 2 });
  } else clock.speed = sitSpeedBefore;
  $('t-sit').setAttribute('aria-pressed', String(sitting));
}
$('t-sit').addEventListener('click', () => toggleSit());
$('t-walk').addEventListener('click', () => toggleWalk());
function applyNitroSetting() {
  const on = settings.nitro !== 'off'; // on unless switched off in Settings
  input.nitroAllowed = on;
  $('nitro-bar').parentElement.hidden = !on;
  document.body.classList.toggle('nitro-off', !on);
}
$('set-nitro').addEventListener('change', (e) => { settings.nitro = e.target.value; store.save(); applyNitroSetting(); });
// Helicopter controls: easy (flown like the car, holding its height) or the full manual set.
function heliHelp() {
  return (heli.easy
  ? (isTouch ? 'Helicopter. Go takes off and flies forward, Brake slows to a hover, hold it when stopped to land. Arrows turn; Up and Down set the height.' : 'Helicopter. Up takes off and flies forward, Down slows to a hover; hold it when stopped to land. Left and Right turn; Space and Shift set the height.')
  : (isTouch ? 'Helicopter. The rotor is spooling up. Hold Up to lift off, Go to fly forward, arrows to turn, Down to land on flat ground.' : 'Helicopter. The rotor is spooling up. Space to lift off, W and S to fly forward and back, A and D to turn, Shift to come down. Land on flat ground.'))
  + (isTouch ? ` Above ${MIN_JUMP} m, tap Jump to skydive.` : ` Above ${MIN_JUMP} m, J jumps out with a parachute.`);
}
$('set-heli').addEventListener('change', (e) => { settings.heli = e.target.value; store.save(); heli.easy = settings.heli !== 'manual'; if (ride === 'heli' && mode === 'fly') hud.toast(heliHelp(), { seconds: 6, priority: 2 }); });

// ---------- Skydiving ----------
function jump() {
  if (mode !== 'fly' || ride !== 'heli') return;
  if (heli.landed) { hud.toast(`Take off and climb above ${MIN_JUMP} m to jump.`, { seconds: 2.5, priority: 2 }); return; }
  if (heli.agl < MIN_JUMP) { hud.toast(`Climb above ${MIN_JUMP} m to jump. You are at ${Math.round(heli.agl)} m.`, { seconds: 2.5, priority: 2 }); return; }
  if (!diver.loaded) { hud.toast('Getting your parachute ready. Try again in a moment.', { seconds: 2.5 }); return; }
  flySky = false; heli.cockpitOn = false;
  mode = 'sky'; skyView = 'chase'; look.orbit = 0; look.skyPitch = 0;
  skyOff.copy(camera.position).sub(heli.pos); skyHeading = null; skyAim = null;
  diver.start(heli);
  heli.autopilot('park', diver.pos);
  document.body.classList.add('is-skydiving');
  haptics.play('medium');
  track('skydive_jump', { agl: Math.round(heli.agl) });
  badges.feat('jump');
  hud.toast(isTouch ? 'Out of the door! Arrows turn, Go glides forward, Brake slows your fall. Tap Open for your parachute.' : 'Out of the door! Left and Right turn, Up glides forward, Down slows your fall. Space opens your parachute.', { seconds: 6, priority: 3 });
  syncLookButton();
}
const SKY_LAND = {
  water: 'Splashdown! You swim to the shore.',
  roof: 'You land on a roof and climb down.',
  steep: 'Too steep to stand there: you slide down to flatter ground.',
  soft: 'A soft landing. Nicely flared!',
  firm: 'Down! You run it out. For a softer landing, hold Down (Brake) from about 8 m up: that is the flare.',
  hard: 'A hard landing: you roll and get up. Come in straight, not turning, and hold Down (Brake) from about 8 m up.',
};
function diverEvents(evs) {
  for (const e of evs) {
    if (e.type === 'prompt') hud.toast(isTouch ? 'Open your parachute: tap Open.' : 'Open your parachute: press Space.', { seconds: 3, priority: 3 });
    else if (e.type === 'open') {
      haptics.play('heavy'); audio.thud?.(4);
      track('skydive_open', { auto: e.auto, agl: e.agl });
      if (e.auto) hud.toast('Your automatic opener fired the parachute.', { seconds: 3.5, priority: 3 });
    } else if (e.type === 'flying') hud.toast(isTouch ? 'Canopy open. Arrows steer, Brake slows you. To land, hold Brake from about 8 m up, all the way down.' : 'Canopy open. Left and Right steer, Down brakes, Up dives. To land softly, hold Down from about 8 m up, all the way down.', { seconds: 5, priority: 3 });
    else if (e.type === 'touchdown') {
      haptics.play(e.soft ? 'medium' : 'heavy');
      if (e.water) audio.splash?.(1); else audio.thud?.(e.soft ? 2 : 5);
      const why = e.water ? 'water' : e.roof ? 'roof' : e.moved ? 'steep' : e.kind || (e.soft ? 'soft' : 'hard');
      hud.toast(SKY_LAND[why], { seconds: 4, priority: 3 });
      track('skydive_land', { how: why });
      if (e.water || e.moved) { $('fade').classList.add('is-on'); setTimeout(() => $('fade').classList.remove('is-on'), 450); }
    } else if (e.type === 'down') landOnFoot(e.spot, e.heading);
  }
}
// Down: on foot where he landed, still in his pack and helmet, the helicopter on its way to land.
function landOnFoot(spot, heading) {
  mode = 'walk'; afterJump = true; leashOnHeli = null; walkTilt = false; look.walkYaw = 0;
  walker.land(spot.x, spot.z, heading);
  jumpAnchor = { pos: new THREE.Vector3(spot.x, spot.y, spot.z), heading };
  document.body.classList.remove('is-skydiving');
  setTimeout(() => { if (afterJump && mode === 'walk') hud.toast(isTouch ? 'On the ground. Tap Call to bring the helicopter over, or pick a car in Menu, Cars.' : 'On the ground. Press E to call the helicopter over, or V for a car.', { seconds: 5, priority: 2 }); }, 4200);
  syncLookButton();
}
function endJump() {
  afterJump = false; jumpAnchor = null; leashOnHeli = null; heliComing = false;
  if (mode === 'sky') mode = 'walk';
  diver.stop();
  walker.setCar?.(ride === 'heli' ? heli : jeep);
  document.body.classList.remove('is-skydiving');
}
// The helicopter is landed and stopped right beside you.
$('la-call').addEventListener('click', () => { haptics.play('select'); sfx.confirm(); callHeli(); });
$('la-car').addEventListener('click', () => { haptics.play('medium'); sfx.switcher(); setVehicle(settings.car && VEHICLES[settings.car] ? settings.car : 'jeep'); });
function heliBeside() { return heli.landed && !heli.auto && Math.hypot(walker.pos.x - heli.pos.x, walker.pos.z - heli.pos.z) < 16; }
function callHeli() {
  const d = Math.round(Math.hypot(walker.pos.x - heli.pos.x, walker.pos.z - heli.pos.z));
  if (heli.auto?.phase === 'come') { hud.toast(`The helicopter is on its way, ${d} m out.`, { seconds: 2.5, priority: 2 }); return; }
  const pad = heli.findPad(walker.pos.x, walker.pos.z, walker.pos, 18, 400);
  if (!pad) { hud.toast('No flat ground near here for the helicopter. Walk to flatter ground and call again.', { seconds: 3.5, priority: 2 }); return; }
  heli.autopilot('come', walker.pos); heli.auto.pad = pad; heliComing = true;
  track('skydive_call_heli', { dist: d });
  hud.toast('The helicopter is on its way. When it has landed, press E beside it to get in.'.replace('press E beside it', isTouch ? 'tap Get in' : 'press E beside it'), { seconds: 3.5, priority: 2 });
}
// Who the walker is tethered to: where he landed, until the helicopter lands near him.
function walkLeash() {
  const v = ride === 'heli' ? heli : jeep;
  if (!afterJump) return v;
  const near = ride === 'heli' && heli.landed && !heli.auto && Math.hypot(walker.pos.x - heli.pos.x, walker.pos.z - heli.pos.z) < CONFIG.vehicle.walkRadius * 0.9;
  if (near !== leashOnHeli) { walker.setCar(near ? heli : null); leashOnHeli = near; }
  return near ? heli : jumpAnchor;
}
// The Jump / Open / Call / Get in button (touch), and the first-time tip on a keyboard.
const JUMP_BTN = { jump: ['Jump', 'Jump out with a parachute'], open: ['Open', 'Open your parachute'], call: ['Call', 'Call the helicopter'], board: ['Get in', 'Get in the helicopter'] };
function syncJumpButton() {
  let st = '';
  if (mode === 'fly' && !heli.landed && heli.agl >= MIN_JUMP) st = 'jump';
  else if (mode === 'sky' && diver.falling) st = 'open';
  else if (mode === 'walk' && afterJump && ride === 'heli') st = heliBeside() ? 'board' : heli.auto?.phase === 'come' ? '' : 'call';
  // Landed from a jump: two plain choices at the top, call the helicopter over or take a car here.
  const landed = mode === 'walk' && afterJump && ride === 'heli' && !heliBeside();
  $('land-acts').hidden = !landed;
  document.body.classList.toggle('land-on', landed);
  if (landed) {
    const coming = heli.auto?.phase === 'come';
    $('la-call').disabled = coming;
    $('la-call').querySelector('span').textContent = coming ? 'Helicopter on its way' : 'Call helicopter';
  }
  if (st === jumpBtnState) return;
  jumpBtnState = st;
  const b = $('t-jump');
  b.hidden = !st; b.dataset.act = st;
  if (st) { b.querySelector('span').textContent = JUMP_BTN[st][0]; b.setAttribute('aria-label', JUMP_BTN[st][1]); }
}
$('t-jump').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const act = $('t-jump').dataset.act;
  haptics.play('medium');
  if (act === 'jump') jump();
  else if (act === 'open') diver.open();
  else if (act === 'call') callHeli();
  else if (act === 'board') getIn();
});
applyNitroSetting();

// ---------- Fuel ----------
// The gauge under the speed, warnings with a route to the nearest station, and one button that
// refuels under a station's roof or, with the tank dry, tows you to the nearest station.
const fuel = new FuelTank(store);
let fuelWarned = 1, fuelMode = '', fuelText = '', fuelStart = 0;
function applyFuelSetting() {
  fuel.on = settings.fuel !== 'off';
  document.body.classList.toggle('fuel-off', !fuel.on);
  if (!fuel.on && jeep) jeep.power = 1;
}
$('set-fuel').value = settings.fuel || 'on';
$('set-fuel').addEventListener('change', (e) => { settings.fuel = e.target.value; store.save(); applyFuelSetting(); });
applyFuelSetting();
function fuelAction() {
  if (mode === 'sky') return;
  if (fuelMode === 'refuel') {
    fuel.filling = !fuel.filling;
    if (fuel.filling) haptics.play('medium', 0);
  } else if (fuelMode === 'tow') towToStation();
}
$('fuel-act').addEventListener('click', fuelAction);
function towToStation() {
  const n = stations?.nearest(jeep.pos.x, jeep.pos.z);
  if (!n) return;
  const b = stations.bay(n.station);
  if (nav.active) nav.stop();
  putCar(b.x, b.z, b.heading);
  track('fuel_tow', { station: n.station.name, distance_km: Math.round(n.dist / 100) / 10 });
  hud.toast(`Towed to the fuel station at ${n.station.name}. ${isTouch ? 'Tap' : 'Press F or click'} Refuel to fill up.`, { seconds: 5, priority: 3 });
}
function fuelTick(dt) {
  const kind = jeep.kind, driving = mode !== 'walk' && ride === 'car';
  let lvl = fuel.level(kind);
  // Pumping: stop if the car moves off, finish when the tank is full.
  const here = driving && fuel.on && Math.abs(jeep.vF) < 1.2 && !jeep.boatOn ? stations?.at(jeep.pos.x, jeep.pos.z) : null;
  if (fuel.filling && !here) fuel.filling = false;
  if (fuel.filling && fuel.fill(dt, kind)) {
    fuel.filling = false;
    const added = fuel.litres(kind, 1 - fuelStart);
    haptics.play('success');
    hud.toast(`Tank full. That took ${added} litres.`, { seconds: 3, priority: 2 });
    track('fuel_refuel', { station: here.name, litres: added, vehicle: kind });
  }
  lvl = fuel.level(kind);
  const g = $('fuel');
  $('fuel-bar').style.transform = `scaleX(${lvl.toFixed(3)})`;
  g.classList.toggle('is-low', lvl < 0.2 && lvl > 0);
  g.classList.toggle('is-empty', lvl <= 0);
  g.setAttribute('aria-valuenow', String(Math.round(lvl * 100)));
  if (!fuel.on) { if (fuelMode) { fuelMode = ''; $('fuel-act').hidden = true; document.body.classList.remove('fuel-prompt'); } return; }
  // Low fuel: say so twice on the way down, with a route to the nearest station.
  if (lvl > 0.3) fuelWarned = 1;
  const step = lvl < 0.08 ? 0.08 : lvl < 0.2 ? 0.2 : 1;
  if (step < fuelWarned && lvl > 0 && driving && !here) {
    fuelWarned = step;
    const n = stations?.nearest(jeep.pos.x, jeep.pos.z);
    if (n) {
      const label = `${n.station.name} fuel station`;
      hud.toast(`${step < 0.1 ? 'Almost out of fuel' : 'Fuel is getting low'}: ${fuel.litres(kind)} litres left. The nearest station is at ${n.station.name}, ${formatDistance(n.dist)} away.`, {
        seconds: 7, priority: 3, action: nav.dest?.label === label ? null : { label: 'Route', run: () => { driveTo(n.station.x, n.station.z, label); haptics.play('medium'); } },
      });
      haptics.play('warning', 0);
    }
  }
  // The button: refuel under a roof, or a tow once the tank is dry and the car has stopped.
  const m = here && lvl < 0.995 ? 'refuel' : driving && lvl <= 0 && Math.abs(jeep.vF) < 0.5 ? 'tow' : '';
  const b = $('fuel-act');
  if (m !== fuelMode) { if (m === 'refuel') fuelStart = lvl; fuelMode = m; b.hidden = !m; document.body.classList.toggle('fuel-prompt', !!m); b.classList.toggle('is-tow', m === 'tow'); }
  if (!m) return;
  const n = m === 'tow' ? stations?.nearest(jeep.pos.x, jeep.pos.z) : null;
  // Short: what is wrong and the key; the button's own key label follows (F), touch shows no key.
  const press = document.body.classList.contains('has-touch') ? '' : ' · Press';
  const text = m === 'tow' ? `Out of fuel${press}` : fuel.filling ? `Filling · ${fuel.litres(kind)} L` : `Refuel${press}`;
  if (text !== fuelText) { fuelText = text; $('fuel-act-text').innerHTML = text; b.setAttribute('aria-label', m === 'tow' ? `Out of fuel. Get a tow to the fuel station at ${n?.station.name}` : fuel.filling ? 'Stop filling' : 'Refuel the car'); }
  b.style.setProperty('--p', m === 'refuel' ? lvl.toFixed(3) : '0');
}

// ---------- Vehicles ----------
let pendingVehicle = null;
function setVehicle(kind, announce = true) {
  if (mode === 'sky') { hud.toast('Land first, then change vehicles.', { seconds: 2.5, priority: 2 }); return; }
  if (kind === 'heli') { boardHeli(announce); return; }
  if (!VEHICLES[kind]) return;
  // Mid-game, a car whose model is still on its way comes once it is in, never as a stand-in.
  pendingVehicle = kind;
  if (jeep && !modelReady(kind)) {
    if (announce) hud.toast(`Bringing the ${VEHICLES[kind].name.toLowerCase()}…`, { seconds: 2, priority: 2 });
    introInfo(kind);
    whenModel(kind).then(() => { if (pendingVehicle === kind) setVehicle(kind, announce); }); // unless another was picked meanwhile
    return;
  }
  if (ride === 'heli' && jeep && !leaveHeli()) return;
  settings.vehicle = kind; settings.car = kind; store.save();
  if (jeep) {
    jeep.setType(kind);
    audio.setEngine(VEHICLES[kind].engine);
    if (announce) hud.toast(`Now driving the ${VEHICLES[kind].name.toLowerCase()}.`, { seconds: 2.5, priority: 2 });
    if (announce) track('vehicle_change', { vehicle: kind });
  }
  introInfo(kind);
  renderGarage();
}
// The helicopter takes the car's place, standing where the car was with its rotor starting up.
// The car's headlamps move to its nose as landing lights (moved, not added: a new light would
// make every material rebuild its shader).
const LAMP_HOME = { head: null, spread: null };
function boardHeli(announce = true) {
  pendingVehicle = 'heli';
  settings.vehicle = 'heli'; store.save();
  introInfo('heli');
  renderGarage();
  if (!jeep || !heli) return;
  if (!heli.model) { heli.ready.then(() => boardHeli(announce)).catch(() => hud.toast('The helicopter could not load. Try again in a moment.', { seconds: 3 })); return; }
  if (ride === 'heli') return;
  if (mode === 'walk') walker.exit();
  ride = 'heli';
  heli.place(jeep.pos.x, jeep.pos.z, jeep.heading);
  heli.root.visible = true; heli.engineOn = true; heli.rpm = 0;
  jeep.vF = 0; jeep.body.visible = false; jeep.blob.visible = false;
  LAMP_HOME.head = jeep.headlight.position.clone(); LAMP_HOME.spread = jeep.spread.position.clone();
  heli.body.add(jeep.headlight, jeep.headlight.target, jeep.spread, jeep.spread.target);
  jeep.headlight.position.set(0, 0.5, heli.nose - 0.6); jeep.headlight.target.position.set(0, -40, heli.nose + 70);
  jeep.spread.position.set(0, 0.4, heli.nose - 1); jeep.spread.target.position.set(0, -14, heli.nose + 9);
  mode = 'fly'; flyHeading = null; camOff.set(0, 0, 0); flySky = false;
  if (driveView === 'hood') driveView = 'chase';
  look.cabYaw = 0; look.cabPitch = 0; look.orbit = 0;
  audio.setEngine(null); // the helicopter's own sounds replace the car's engine
  document.body.classList.add('is-flying');
  syncLookButton();
  if (announce) {
    hud.toast(heliHelp(), { seconds: 7, priority: 2 });
    track('vehicle_change', { vehicle: 'heli' });
  }
}
// Back to a car: only once landed. The car stands where the helicopter was, or on the nearest
// road if that is too far out for it.
function leaveHeli() {
  const jumped = afterJump && mode === 'walk';
  // In the air the switch still happens: the car is set down on the nearest road below, behind a
  // quick fade, rather than refusing with "land first".
  const airborne = !heli.landed && !jumped;
  if (airborne) { $('flash').classList.remove('is-on'); void $('flash').offsetWidth; $('flash').classList.add('is-on'); }
  const from = jumped ? walker.pos.clone() : heli.pos.clone();
  if (jumped) { endJump(); heli.auto = null; heli.engineOn = false; }
  if (mode === 'walk') walker.exit();
  ride = 'car';
  heli.root.visible = false; heli.engineOn = false; heli.rpm = 0;
  jeep.root.add(jeep.headlight, jeep.headlight.target, jeep.spread, jeep.spread.target);
  if (LAMP_HOME.head) { jeep.headlight.position.copy(LAMP_HOME.head); jeep.spread.position.copy(LAMP_HOME.spread); }
  jeep.headlight.target.position.set(0, -2.6, 60); jeep.spread.target.position.set(0, -1.6, 16);
  jeep.body.visible = true; jeep.blob.visible = true;
  const r = nearestRoadAnywhere(from.x, from.z);
  const far = !r || Math.hypot(r.x - from.x, r.z - from.z) > CONFIG.vehicle.offRoadLimit * 0.8;
  if ((far || airborne) && r) jeep.place(r.x, r.z, r.heading); else jeep.place(from.x, from.z, jumped ? walker.heading : heli.heading);
  mode = 'chase'; camHeading = jeep.heading;
  document.body.classList.remove('is-flying');
  syncLookButton();
  return true;
}
// V (or a tap on the car) goes round every vehicle: the cars in order, then the helicopter, then
// back to the first car.
function cycleVehicle() {
  if (mode === 'sky') { hud.toast('Land first, then change vehicles.', { seconds: 2.5, priority: 2 }); return; }
  if (ride === 'heli') { setVehicle(VEHICLE_ORDER[0]); return; }
  const i = VEHICLE_ORDER.indexOf(jeep.kind);
  setVehicle(i === VEHICLE_ORDER.length - 1 ? 'heli' : VEHICLE_ORDER[i + 1]);
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
    return `<button class="car-card ${on ? 'is-on' : ''}" data-pick="${k}" aria-pressed="${on}">${img}<span class="car-info"><h3>${v.name}</h3><p class="car-tag">${v.tagline}</p><p class="car-blurb">${v.blurb}</p>
      <span class="car-stats"><span>Top speed</span>${bar(v.maxSpeed, 66)}<span>Off-road</span>${bar(off, 1)}<span>Water</span>${bar(v.wade, 1.9)}</span></span></button>`;
  }).join('');
  // The helicopter, after the cars.
  const hs = $('garage').open || list.dataset.wantThumbs ? heli?.thumb() : null, onH = settings.vehicle === 'heli';
  list.insertAdjacentHTML('beforeend', `<button class="car-card ${onH ? 'is-on' : ''}" data-pick="heli" aria-pressed="${onH}">${hs ? `<img class="car-pic" src="${hs}" alt="" />` : ''}<span class="car-info"><h3>Helicopter</h3><p class="car-tag">Fly anywhere and see the whole island.</p><p class="car-blurb">A twin-engine Eurocopter EC135 in red and white. Follow the coast, climb over the glaciers, and land on any flat ground.</p>
      <span class="car-stats"><span>Top speed</span>${bar(62, 66)}<span>Reach</span>${bar(1, 1)}<span>Altitude</span>${bar(1, 1)}</span></span></button>`);
  list.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { haptics.play('medium'); setVehicle(b.dataset.pick); $('garage').close(); }));
}
// The menu's garage on a computer is the start screen again: the vehicle on its turntable under
// the aurora, its name and stats, arrows to look through them and Drive this to take one. Its two
// canvases exist only while the page is open.
const ggDesk = () => true; // the turntable garage on every screen
function ggCurrent() { return ride === 'heli' || settings.vehicle === 'heli' ? 'heli' : jeep?.kind || coverKind(); }
function ggShow(kind, arrive) {
  gg.kind = kind;
  gg.cover?.show(kind, arrive);
  introInfo(kind, { name: 'gg-name', kick: 'gg-kick', l: 'gg-stats-l', r: 'gg-stats-r' });
  const here = kind === ggCurrent();
  $('gg-drive-label').textContent = here ? (kind === 'heli' ? 'Flying this' : 'Driving this') : kind === 'heli' ? 'Fly this' : 'Drive this';
  $('gg-drive').classList.toggle('is-here', here);
}
// Built once and kept (paused while the page is shut), so the garage opens straight away; it is
// first made a few seconds into the drive, in the background.
function ggMake() {
  if (gg.cover) return;
  gg.sky = startAuroraSky($('gg-sky'));
  gg.cover = new Cover($('gg-hero'), { spot: $('gg-spot') });
}
function ggOpen() {
  if (!ggDesk()) return;
  ggMake();
  gg.cover.paused = false; gg.sky.resume?.();
  if (gg.kind !== ggCurrent() || !gg.cover.car) ggShow(ggCurrent(), false); else ggShow(gg.kind, false);
}
function ggClose() { if (gg.cover) gg.cover.paused = true; gg.sky?.pause?.(); }
function ggPrewarm() {
  ggMake();
  ggShow(ggCurrent(), false);
  // Draw it once out of sight so its shaders are ready, then rest.
  requestAnimationFrame(() => { try { gg.cover.render(); } catch { /* ignore */ } ggClose(); });
}
function ggStep(d) {
  const i = COVER_ORDER.indexOf(gg.kind);
  haptics.play('light');
  const kind = COVER_ORDER[(i + d + COVER_ORDER.length) % COVER_ORDER.length];
  sfx.switcher();
  ggShow(kind, true);
  if (gg.cover?.car && kind === 'heli') setTimeout(() => sfx.arrive(kind), 120);
}
$('gg-prev').addEventListener('click', () => ggStep(-1));
$('gg-next').addEventListener('click', () => ggStep(1));
$('gg-drive').addEventListener('click', () => {
  if (gg.kind === ggCurrent()) { sheet.close(); return; }
  haptics.play('medium'); setVehicle(gg.kind); sheet.close();
});
$('sheet').addEventListener('keydown', (e) => {
  if (sheet.current !== 'garage' || !gg.cover) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); ggStep(e.key === 'ArrowLeft' ? -1 : 1); }
  else if (e.key === 'Enter' && !e.target.matches?.('button')) { e.preventDefault(); $('gg-drive').click(); }
});
$('sheet').addEventListener('close', ggClose);
function openGarage() { $('garage-list').dataset.wantThumbs = '1'; renderGarage(); $('garage').showModal(); ggOpen(); }
sheet.register('garage', openGarage);
sheet.register('map', () => mapUI?.open());
// Opening the menu stops the vehicle where it is: no speed carried into the pause, so closing
// the menu does not shoot it off again. The helicopter holds its hover.
$('sheet').addEventListener('toggle', () => { if (!$('sheet').open || !started) return; if (jeep) { jeep.vF = 0; jeep.vL = 0; } if (heli?.vel) heli.vel.set(0, 0, 0); });
sheet.onShow = (page) => { track('menu_open', { page }); if (page !== 'garage') ggClose(); };
// Tap the vehicle itself to switch to the next one, round and round: the cars in order, then the
// helicopter, then back to the first car.
const carRay = new THREE.Raycaster(), carTap = new THREE.Vector2();
let tapStart = null;
canvas.addEventListener('pointerdown', (e) => { tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  const s = tapStart; tapStart = null;
  if (!s || !jeep || !started || mode === 'walk' || mode === 'sky') return;
  if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8 || performance.now() - s.t > 400) return;
  const r = canvas.getBoundingClientRect();
  carTap.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  carRay.setFromCamera(carTap, camera);
  const target = ride === 'heli' ? heli?.root : jeep.body;
  if (target && carRay.intersectObject(target, true).length) { haptics.play('medium', 0); cycleVehicle(); }
});
setVehicle(settings.vehicle || 'jeep', false);

// Flying: say why it will not land, jolt on a hard touchdown, and blow dust or spray from the
// ground under the rotor when low. Each message waits a few seconds before it repeats.
const HELI_SAYS = {
  steep: 'Too steep to land here. Find flatter ground.', water: 'You cannot land on water. Find flat ground.',
  fast: 'Too fast to land. Slow down first.', hard: 'Hard landing! Ease down more gently.',
  wall: 'Rock ahead. Climb to clear it.', edge: 'That is the edge of the map. Turn back toward Iceland.',
  spooling: 'The rotor is still spooling up. Lift off in a moment.',
  landing: 'Coming down to land.',
};
const heliSaid = {};
let wasLanded = true;
function flyFeedback(dt) {
  const wmsg = heli.warning;
  if (wmsg && HELI_SAYS[wmsg] && !(clock.realSeconds - (heliSaid[wmsg] ?? -99) < 5)) { heliSaid[wmsg] = clock.realSeconds; hud.toast(HELI_SAYS[wmsg], { seconds: 2.5, priority: 1 }); }
  if (heli.touchdown) { heli.touchdown = false; haptics.play(heli.impact > 0.25 ? 'heavy' : 'medium'); if (heli.impact <= 0.25 && !wasLanded) hud.toast('Landed. Press E to step out.', { seconds: 2.2, priority: 1 }); audio.thud?.(2 + heli.impact * 8); }
  if (wasLanded && !heli.landed) { haptics.play('light'); badges.feat('fly'); }
  wasLanded = heli.landed;
  // Downwash: the ground under the rotor kicks up dust or spray within about two rotor widths.
  if (!heli.landed && heli.rpm > 0.8 && heli.agl < 22) {
    const k = 1 - heli.agl / 22, wet = heli.floor(heli.pos.x, heli.pos.z).water;
    const fx = heli.floor(heli.pos.x, heli.pos.z).y;
    const n = Math.round(k * (wet ? 3 : 2));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
      (wet ? spray : dust).emit(heli.pos.x + Math.cos(a) * r, fx + 0.3, heli.pos.z + Math.sin(a) * r, Math.cos(a) * 9 * k, 1.5 + Math.random() * 2, Math.sin(a) * 9 * k, 1, 0.6, wet ? 0.9 : 1.6);
    }
  }
}

// Spray, dust, splashes and knocks.
// The dirt on the car, kept between visits: a long drive leaves its mark.
const carDirt = store.data.carDirt ||= { dirt: 0, color: [0.36, 0.3, 0.22] };
carDirt.saved = carDirt.dirt;
grime.uDirt.value = carDirt.dirt; setDirtColor(carDirt.color);

function vehicleEffects(dt) {
  const fx = Math.sin(jeep.heading), fz = Math.cos(jeep.heading), rx = fz, rz = -fx;
  const sp = jeep.speed;
  if (dt && updateGrime(carDirt, { dt, surface: jeep.surface, sp, depth: jeep.depth, rain: rain.intensity, wet: wetness, roadSnow, boat: jeep.boat })) { carDirt.saved = carDirt.dirt; store.save(); }
  carWash(dt, sp);
  const wheelsWorld = jeep.wheels.map((w) => [jeep.pos.x + rx * w.x + fx * w.z, jeep.pos.z + rz * w.x + fz * w.z, w.x]);
  const inPuddle = wheelsWorld.some(([x, z]) => puddles.at(x, z));
  const inWater = jeep.depth > 0.05;
  // Splash on the way in.
  // How hard a puddle is hit: nothing at a crawl, a full sheet of spray at 90 km/h.
  const hit = Math.min(1, Math.max(0, (sp - 1) / 24));
  if (inPuddle && !wasInPuddle && sp > 1) { audio.splash(hit, 'puddle'); if (hit > 0.25) haptics.play('light'); }
  if (inWater && !wasInWater && sp > 2) { audio.splash(Math.min(1, sp / 18 + jeep.depth * 0.4)); haptics.play(sp > 10 ? 'heavy' : 'medium'); }
  // Pools the land does not know about (a waterfall's plunge pool, a crater lake): wheels in
  // one splash, throw spray and send rings across it.
  const pool = !inWater && dt ? poolAt(jeep.pos.x, jeep.pos.z) : null;
  const inPool = pool != null && Math.abs(pool - jeep.pos.y) < 1.2;
  if (inPool && !wasInPool && sp > 1.5) { audio.splash(Math.min(1, sp / 18)); haptics.play('medium'); }
  wasInPool = inPool;
  if (inPool && dt) {
    if (Math.random() < dt * (1.5 + sp * 0.4)) { const [x, z] = wheelsWorld[Math.floor(Math.random() * wheelsWorld.length)]; waterFx.ring(x, pool, z, Math.min(1, 0.35 + sp / 12), { r0: 0.8, speed: 1.4 + sp * 0.15, life: 2.8 }); }
    if (sp > 1.5) for (const [x, z, side] of wheelsWorld) for (let k = Math.ceil(Math.min(1, sp / 15) * 5); k > 0; k--) { const out = Math.sign(side) * (0.5 + sp * 0.1 * Math.random()); waterFx.drops.emit(x, pool + 0.08, z, rx * out + fx * sp * 0.2 * Math.random(), 1 + sp * 0.12 * Math.random(), rz * out + fz * sp * 0.2 * Math.random(), 0.6 + Math.random() * 0.5, 0.15 + Math.random() * 0.35); }
  }
  // Rings: across a puddle from each wheel in it, and over open water from a wading car.
  if (inPuddle && sp > 0.5 && dt) for (const [x, z] of wheelsWorld) if ((!wasPuddleRing || Math.random() < dt * 5) && puddles.at(x, z)) puddles.ripple(x, z, Math.min(1, 0.15 + sp / 18));
  wasPuddleRing = inPuddle;
  if (inWater && jeep.boat < 0.5 && dt && Math.random() < dt * (1.5 + sp * 0.4)) {
    const [x, z] = wheelsWorld[Math.floor(Math.random() * wheelsWorld.length)];
    waterFx.ring(x, waterLevelAt(x, z), z, Math.min(1, 0.35 + sp / 12), { r0: 0.8, speed: 1.4 + sp * 0.15, life: 2.8 });
  }
  wasInPuddle = inPuddle; wasInWater = inWater;
  boatEffects(dt);
  // Water off the tyres, as water: clusters of droplets thrown out in a fan from each wheel in
  // it (out to the side, a little forward with the car, up in an arc that falls back), a fine
  // mist hanging behind at speed, and rings where it is disturbed. In a lake or river it is a
  // heavy wash; in a puddle it scales with how hard you hit it, from a lip of water pushed aside
  // at a crawl to a sheet thrown high at speed.
  const throwWater = (x, z, y, side, k, heavy, n) => {
    for (let i = 0; i < n; i++) {
      // Flung off the tyre: fast out to the side (low and flat) or up (steep and short), a little
      // forward with the car, from the tyre's outer edge so the body does not hide it.
      const fan = Math.random(), sgn = Math.sign(side) || 1;
      const out = sgn * (0.8 + sp * (0.16 + 0.3 * fan)) + (Math.random() - 0.5) * 0.8;
      const fwd = sp * (0.1 + 0.45 * Math.random()), up = (heavy ? 1.5 : 0.7) + sp * (0.1 + 0.26 * (1 - fan)) * (0.6 + Math.random() * 0.6);
      const ox = x + rx * sgn * 0.25, oz = z + rz * sgn * 0.25;
      waterFx.splash.emit(ox + (Math.random() - 0.5) * 0.3, y + 0.06, oz + (Math.random() - 0.5) * 0.3, rx * out + fx * fwd, up, rz * out + fz * fwd, 0.5 + k * 0.6, 0.18 + k * (heavy ? 0.6 : 0.45) * (0.6 + Math.random() * 0.8));
    }
    if (k > 0.35 && Math.random() < k * (heavy ? 0.5 : 0.25)) waterFx.mist.emit(x - fx * 0.6, y + 0.3, z - fz * 0.6, rx * Math.sign(side) * 1.2 - fx * sp * 0.15, 0.5 + Math.random() * 0.5, rz * Math.sign(side) * 1.2 - fz * sp * 0.15, 1.1 + k, 1 + k * 1.6);
  };
  // The big throw is the moment a tyre hits the water; after that a steady spray while it runs
  // through, measured in time, not frames, so a fast pass at a low frame rate still splashes.
  if (dt && jeep.boat < 0.5) wheelsWorld.forEach(([x, z, side], i) => {
    const inPud = !inWater && puddles.at(x, z), wet = inWater || inPud;
    const k = inWater ? Math.min(1, Math.min(1, sp / 14) * (0.6 + Math.min(1, jeep.depth))) : Math.max(0.1, hit);
    const y = inWater ? waterLevelAt(x, z) : heightAt(x, z) + 0.17;
    if (wet && sp > 1) {
      if (!tyreIn[i]) throwWater(x, z, y, side, k, inWater, Math.ceil(6 + k * (inWater ? 60 : 46)));
      tyreSpray[i] = (tyreSpray[i] || 0) + k * (inWater ? 160 : 110) * dt;
      const n = Math.floor(tyreSpray[i]); tyreSpray[i] -= n;
      if (n) throwWater(x, z, y, side, k, inWater, n);
    }
    tyreIn[i] = wet;
  });
  jeep.wadeLevel = jeep.boat > 0.5 ? Math.min(0.8, sp / 16) : inWater ? Math.min(1, jeep.depth * 0.7 + sp / 25) : inPuddle ? Math.min(0.6, sp / 30) : 0;
  // Snow: every wheel throws powder up and out to the side, and it falls back as the car passes,
  // more of it the faster you go.
  if (jeep.surface === 'snow' && sp > 1.5 && !jeep.air) {
    const n = Math.ceil(Math.min(1, sp / 16) * 8);
    wheelsWorld.forEach(([x, z, side], k) => {
      const out = Math.sign(side) * (1.6 + sp * 0.08);
      powder.emit(x, heightAt(x, z) + 0.25, z, rx * out - fx * sp * 0.25, 2.6 + sp * 0.12, rz * out - fz * sp * 0.25, n, 1.8, 1.0);
      // A soft cloud hangs behind the rear wheels.
      if (k >= 2 && Math.random() < Math.min(1, sp / 12)) powderCloud.emit(x, heightAt(x, z) + 0.6, z, rx * Math.sign(side) * 0.8 - fx * sp * 0.15, 1.2, rz * Math.sign(side) * 0.8 - fz * sp * 0.15, 1, 1.2, 1.6);
    });
  }
  // Dust off-road: a trail of soft billows thrown up behind the rear wheels, thicker the faster
  // you go, hanging in the air and drifting with the wind, the colour of the ground. Not when
  // the ground is wet.
  const dusty = jeep.surface === 'gravel' || jeep.surface === 'sand' || jeep.surface === 'moss';
  if (!inWater && sp > 4 && dusty && wetness < 0.4 && dt && !jeep.air) {
    trailDust.mat.color.setHex(jeep.surface === 'sand' ? 0x55514c : jeep.surface === 'moss' ? 0x9a9274 : 0xb6a07c);
    trailCarry += Math.min(1, (sp - 4) / 18) * 26 * (1 - wetness * 2) * dt;
    for (; trailCarry >= 1; trailCarry--) for (const [x, z] of wheelsWorld.slice(2)) trailDust.emit(x - fx * 0.6, heightAt(x, z) + 0.5, z - fz * 0.6, -fx * sp * 0.18 + (Math.random() - 0.5) * 1.5, 0.7 + Math.random() * 1.1, -fz * sp * 0.18 + (Math.random() - 0.5) * 1.5, 1, 1.6, 3.4);
  }
  // Wet tyres print tracks out of a puddle or the water, fading as each tyre dries (about 14 m),
  // and the prints themselves dry away over half a minute (WetTracks). Rain wets everything, so
  // there they would not show.
  if (dt && jeep.boat < 0.1 && !jeep.air) {
    const now = performance.now() / 1000;
    wheelsWorld.forEach(([x, z], i) => {
      const inIt = puddles.at(x, z) || inWater || inPool;
      const L = tyreLast[i], moved = L ? Math.hypot(x - L[0], z - L[1]) : 0; tyreLast[i] = [x, z];
      tyreWet[i] = inIt ? 1 : Math.max(0, tyreWet[i] - moved / 14);
      if (!inIt && wetness < 0.5) wetTracks.mark(i, x, heightAt(x, z) + (jeep.surface === 'paved' ? 0.17 : 0.06), z, jeep.heading, tyreWet[i] * (jeep.surface === 'paved' ? 1 : 0.6), now);
    });
  }
  // Ruts in the snow: on a snowy road or across snowy ground, each tyre presses its track.
  if (dt) {
    const now = performance.now() / 1000;
    wheelsWorld.forEach(([x, z], i) => snowTracks.tyre(i, x, heightAt(x, z) + (jeep.surface === 'paved' ? 0.17 : 0.06), z, jeep.heading, now, jeep.boat < 0.1 && !jeep.air && !inWater && onSnow(x, z, jeep.surface), jeep.model.bike ? 0.09 : 0.2));
  }
  // Skid marks from the rear wheels while the tyres slide: rubber on tarmac, scuffs elsewhere.
  if (jeep.boat < 0.1 && !jeep.air && dt) wheelsWorld.slice(2).forEach(([x, z], i) => skids.mark(i, x, heightAt(x, z) + (jeep.surface === 'paved' ? 0.17 : 0.05), z, jeep.heading, onSnow(x, z, jeep.surface) ? 0 : jeep.slip || 0, jeep.surface === 'paved')); // on snow the ruts show the slide
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

// Boat mode: say when it changes; the wake, foam and spray are drawn by BoatWater.
let boatToldOnce = false, wasPuddleRing = false, wasInPool = false, trailCarry = 0;
function boatEffects(dt) {
  const ev = jeep.boatEvent; jeep.boatEvent = null;
  if (ev === 'boat') {
    hud.toast(boatToldOnce ? 'Boat mode.' : 'Too deep to wade, so it floats: boat mode. Cruise out, then head back to the shore to drive on.', { seconds: boatToldOnce ? 1.8 : 4.5, priority: 2 });
    boatToldOnce = true; haptics.play('medium'); track('boat_mode', { vehicle: jeep.kind });
  } else if (ev === 'car') hud.toast('Wheels down. Back on the road.', { seconds: 2, priority: 2 });
  boatWater.update(dt, jeep, camera, renderer.domElement.height);
}

// Feel the drive: a kick when nitro fires and a soft pulse while it burns, an ABS-style
// flutter under hard braking, a tick each time the speed climbs past another 20 km/h,
// and a light grumble on rough ground.
let wasBoosting = false, hapticClock = 0, lastSpeedStep = 0, thudded = false;
// On foot: a tap on each jump, and a thud on landing from a drop.
function walkHaptics() {
  if (walker.jumped) { walker.jumped = false; haptics.play('light'); }
  if (walker.landed > 0.4 && !thudded) { haptics.play('medium'); thudded = true; }
  if (!walker.landed) thudded = false;
}
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
  else if (kmh > 20 && !jeep.air && (jeep.surface === 'gravel' || jeep.surface === 'sand' || jeep.surface === 'moss' || jeep.surface === 'snow')) { haptics.play('select'); hapticClock = Math.max(0.3, 0.7 - kmh / 300); }
}

// Jump to any spot: the nearest road there, facing the place if it is a landmark.
// Drive there: plan a road route from here and guide the way with the chip, the maps and a beacon.
function driveTo(x, z, label) {
  nav.start({ x, z, label }, activePos());
  hud.toast(`Route set. Follow the blue line to ${label}; a column of light marks the spot.`, { seconds: 5, priority: 2 });
  track('nav_start', { destination: label, distance_km: Math.round(nav.route.length / 100) / 10 });
}

// Put the car down somewhere new, back in it, with the camera behind.
function putCar(x, z, heading) {
  if (afterJump || mode === 'sky') endJump();
  if (mode === 'walk') walker.exit();
  jeep.place(x, z, heading);
  if (ride === 'heli') { heli.place(x, z, heading); mode = 'fly'; flyHeading = null; camOff.set(0, 0, 0); infoDismissed = null; return; }
  mode = 'chase';
  camHeading = heading;
  camera.position.set(x - Math.sin(heading) * jeep.model.camDist, heightAt(x, z) + jeep.model.camHeight, z - Math.cos(heading) * jeep.model.camDist);
  camera.lookAt(x, heightAt(x, z) + 1.5, z);
  infoDismissed = null;
}

function fastTravel(x, z, label, face) {
  if (mode === 'sky') { hud.toast('Land first, then travel.', { seconds: 2.5, priority: 2 }); return; }
  const r = nearestRoadAnywhere(x, z);
  if (!r) return;
  const d = Math.hypot(x - r.x, z - r.z);
  const heading = face && d > 8 ? Math.atan2(x - r.x, z - r.z) : r.heading;
  putCar(r.x, r.z, heading);
  track('fast_travel', { destination: label || describePlace(r.x, r.z).label });
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
  const paused = !started || !!document.querySelector('dialog[open]') || !!photo?.on;
  input.enabled = !paused;
  const t = now / 1000;

  if (!paused) clock.tick(dt);
  const w = wind(clock.realSeconds);

  if (sitting && (mode !== 'walk' || input.throttle || input.steer)) toggleSit(false);
  $('t-sit').hidden = mode !== 'walk';
  // Phones: Out when the car has stopped, In while on foot (E on a keyboard).
  {
    const tw = $('t-walk'), on = ride === 'car' && (mode === 'walk' || (mode === 'chase' && jeep.speed < 1 && jeep.boat < 0.1 && !jeep.air));
    if (tw.hidden === on) tw.hidden = !on;
    const lbl = mode === 'walk' ? 'In' : 'Out';
    if (on && tw.lastChild.textContent !== lbl) { tw.lastChild.textContent = lbl; tw.setAttribute('aria-label', mode === 'walk' ? 'Get back in' : 'Step out'); }
  }
  $('t-up').hidden = $('t-down').hidden = mode !== 'fly';
  if (mode === 'sky') {
    heli.fly(paused ? 0 : dt, w, diver.pos);
    diverEvents(diver.update(paused ? 0 : dt, { throttle: input.throttle, steer: input.steer }, w));
  } else if (mode === 'walk') {
    if (ride === 'heli') heli.fly(paused ? 0 : dt, w, walker.pos); else jeep.update(dt, input, w, false);
    if (landmarks && !walker.bathAt) { walker.bathAt = (x, z, m) => landmarks.bathAt(x, z, m); walker.rimAt = (x, z) => landmarks.rimAt(x, z); }
    walker.update(dt, input, walkLeash(), obstacles);
    soakUpdate(dt);
    if (dt) footprints();
    if (afterJump) {
      // Still in his pack and helmet (not while sitting: the camera is in his head), the canopy
      // falling in where he landed, and word when the helicopter is down beside him.
      diver.update(paused ? 0 : dt, null, w);
      walkerBones ||= walker.man ? bonesOf(walker.man) : null;
      diver.helmet.visible = !sitting;
      fitGear(walkerBones, diver.pack, sitting ? null : diver.helmet);
      if (heliComing && !heli.auto) { heliComing = false; hud.toast(isTouch ? 'The helicopter has landed. Tap Get in when you are beside it.' : 'The helicopter has landed. Walk over and press E to get in.', { seconds: 3.5, priority: 2 }); }
    }
    obstacles.resolve(walker.pos, 0.4, true);
    wildlife.pushOut(walker.pos, 0.3); // nor through the animals
    // Swimming: a splash going in, and spray off his arms as he strokes.
    if (walker.splashed) { audio.splash(walker.splashed); const wl = waterLevelAt(walker.pos.x, walker.pos.z); spray.emit(walker.pos.x, wl + 0.1, walker.pos.z, 0, 2.6, 0, Math.ceil(walker.splashed * 14), 1.4, 0.7); walker.splashed = 0; if (!swimTipShown) { swimTipShown = true; hud.toast('Swimming. The water is cold, so stay near the shore.', { seconds: 3, priority: 2 }); } }
    if (walker.swimming && walker.speedSmooth > 0.3 && Math.random() < dt * 7) {
      const wl = waterLevelAt(walker.pos.x, walker.pos.z), side = Math.random() < 0.5 ? -1 : 1, h = walker.heading;
      spray.emit(walker.pos.x + Math.sin(h) * 0.9 + Math.cos(h) * side * 0.35, wl + 0.05, walker.pos.z + Math.cos(h) * 0.9 - Math.sin(h) * side * 0.35, 0, 1.2, 0, 2, 0.7, 0.45);
    }
    walkHaptics();
  } else if (mode === 'fly') {
    heli.update(paused ? 0 : dt, { throttle: input.throttle, steer: input.steer, lift: input.lift }, w);
    if (!paused) flyFeedback(dt);
    // High enough to skydive: say so once each flight.
    if (heli.landed) jumpTipShown = false;
    else if (!jumpTipShown && heli.agl >= MIN_JUMP) { jumpTipShown = true; hud.toast(isTouch ? 'High enough to skydive: tap Jump to jump out.' : 'High enough to skydive: press J to jump out.', { seconds: 4, priority: 2 }); }
  } else {
    if (!paused) jeep.power = fuel.burn(dt, jeep, input.throttle);
    jeep.update(paused ? 0 : dt, input, w, !paused);
    if (!paused) vehicleEffects(dt);
  }
  spray.update(dt);
  bathSteam?.update(dt);
  dust.update(dt);
  washDust.update(dt);
  trailDust.update(dt);
  powder.update(dt);
  powderCloud.update(dt);

  const p = activePos();
  const g = started ? guaranteeLevel() : 0;
  if (g > 0.5 && !guaranteeToastShown) {
    guaranteeToastShown = true;
    hud.toast('The radio crackles: activity is building and the sky is clearing. Find a dark spot and look up.', { seconds: 8, priority: 2 });
  }
  const a = forecast.evaluate({ x: p.x, z: p.z, clock, dt, guaranteeActive: g });

  lastSky = a;
  if (!(started && document.querySelector('dialog[open]'))) updateCamera(dt); // the view holds still while a menu is open
  forecast.cloudOffset(clock.realSeconds, cloudOffset);
  auroraVisSmoothed = aurora.update(dt, t, camera, a);
  const { dark, sunDir } = sky.update({ camera, clock, cloud: a.cloud, cloudOffset, city: a.city, auroraVis: auroraVisSmoothed, auroraTint: aurora.tint, t, focus: p });
  lastSkyDark = dark;
  surfaceUniforms.uCloudCover.value = a.cloud;
  surfaceUniforms.uCloudOffset.value.copy(cloudOffset);
  surfaceUniforms.uSunDir.value.copy(sunDir);
  if (HD.on) updateAtmosphere(sunDir, surfaceUniforms.uSunUp.value);
  surfaceUniforms.uSunUp.value = smoothstep(-2, 8, clock.sunElevation()) * (1 - dark);
  surfaceUniforms.uTime.value = t;
  if (postReflectorMat) {
    postReflectorMat.emissiveIntensity = dark * 0.8;
    const B = postReflectorMat.userData.beam, inCar = ride === 'car' && mode !== 'walk' && mode !== 'sky';
    B.uBeam.value = inCar ? dark : 0; B.uReach.value = jeep.highBeam ? 190 : 90;
    B.uCarPos.value.copy(jeep.pos); B.uCarDir.value.set(Math.sin(jeep.heading), Math.cos(jeep.heading));
  }
  // The beam button shows on phones once it is dark enough for headlights.
  { const tb = $('t-beam'); if (tb) tb.hidden = !(ride === 'car' && dark > 0.35 && mode === 'chase'); }
  if (lakeMat) lakeMat.emissive.copy(aurora.tint).multiplyScalar(auroraVisSmoothed * 0.03 * dark); // the real reflection does the rest (skyreflect.js)

  landmarks.update(dt, t, { wind: w, dark, auroraTint: aurora.tint, auroraVis: auroraVisSmoothed, player: p });
  // Wildlife, and a word about each species the first time you see it.
  for (const sp of wildlife.update(paused ? 0 : dt, { pos: p, car: ride === 'heli' ? null : jeep, camera, clock, dark, highBeam: !!jeep.highBeam, walking: mode === 'walk', walkSpeed: walker.speedSmooth })) {
    const seen = store.data.wildlife || (store.data.wildlife = {});
    if (seen[sp]) continue;
    seen[sp] = new Date().toISOString(); store.save();
    hud.toast(WILDLIFE_NOTES[sp], { seconds: 4.5, priority: 1 });
    track('wildlife_seen', { species: sp });
  }
  // Snow showers: winter months under cloud, in drifting bands, heavier on high ground and in the
  // north. In midwinter most cloud brings some snow.
  const winter = WINTER[clock.month];
  const band = snowNoise(p.x * 0.0022 + clock.realSeconds * 0.004, p.z * 0.0022) * 0.5 + 0.5;
  const altitude = Math.max(0, (heightAt(p.x, p.z) - 6) / 30) + Math.max(0, -p.z / 1050);
  let snowTarget = winter > 0.2 && a.cloud > 0.4 ? clamp((band - 0.5 + winter * 0.25) * 2.6 + altitude * 0.8, 0, 1) * clamp((a.cloud - 0.4) * 4, 0, 1) * Math.min(1, winter * 1.1) : 0;
  if (forceSnow != null) snowTarget = forceSnow;
  const inside = mode === 'chase' && driveView === 'cockpit';
  snow.update(dt, camera, snowTarget, w, inside ? jeep.interior.views.cockpit.snowFade ?? 0.6 : 0.4);
  // Winter on the roads: packed snow, ploughed banks and black ice, more where the land is white
  // and while it snows. It changes slowly, so driving along never shows it switching.
  const roadSnowTarget = winter * clamp(0.5 + snowAt(p.x, p.z) * 0.7 + snow.intensity * 0.4, 0, 1);
  roadSnow += (roadSnowTarget - roadSnow) * Math.min(1, dt / (Math.abs(roadSnowTarget - roadSnow) > 0.5 ? 1 : 25));
  surfaceUniforms.uRoadSnow.value = roadSnow;
  // The first patch of black ice of the trip gets a word of warning.
  if (!iceWarned && started && ride === 'car' && mode === 'chase' && jeep.ice > 0.5 && jeep.kmh > 25) {
    iceWarned = true;
    hud.toast('Black ice. Brake gently and steer smoothly, or it slides.', { seconds: 4.5, priority: 1 });
  }
  // Headlights: the flakes and drops in their beams light up.
  {
    const H = headlightUniforms, lit = ride === 'car' && mode !== 'walk' && mode !== 'sky' && jeep.boat < 0.5;
    H.uAmbient.value = 1 - dark * 0.88;
    H.uBeamOn.value = lit ? smoothstep(0.3, 0.7, dark) : 0;
    H.uBeamReach.value = jeep.highBeam ? 190 : 90;
    const hl = jeep.model.headlight;
    H.uLampPos.value.set(0, hl[1], hl[2]).applyMatrix4(jeep.root.matrixWorld);
    H.uLampDir.value.set(Math.sin(jeep.heading), jeep.highBeam ? -0.02 : -0.08, Math.cos(jeep.heading)).normalize();
  }
  // The dirt's pattern is fixed to the car: the shader takes the world into the car's frame.
  jeep.root.updateMatrixWorld();
  grime.uCarInv.value.copy(jeep.root.matrixWorld).invert();
  if (snow.intensity > 0.02) { sky.fog.density += snow.intensity * 0.0012; sky.fog.color.lerp(new THREE.Color(0xd9dfe4), snow.intensity * 0.5); }
  // Rain: under thick cloud, in drifting bands of showers, where it is not cold enough to snow.
  // The ground gets wet within half a minute of rain and takes a few minutes to dry.
  const rainBand = snowNoise(p.x * 0.0018 - clock.realSeconds * 0.005 + 40, p.z * 0.0018 + 17) * 0.5 + 0.5;
  let rainTarget = a.cloud > 0.55 ? clamp((rainBand - 0.42) * 3.2, 0, 1) * clamp((a.cloud - 0.55) * 4, 0, 1) * (1 - clamp(snowTarget * 2, 0, 1)) : 0;
  if (forceRain != null) rainTarget = forceRain;
  rain.update(paused ? 0 : dt, camera.position, rainTarget, w, inside ? 1.4 : 0.5, 1 - dark * 0.8, (x, z) => waterAt(x, z) ?? heightAt(x, z));
  const R = rain.intensity;
  wetness = clamp(wetness + (R > 0.05 ? dt / 25 : -dt / 200), 0, 1);
  surfaceUniforms.uRain.value = R; surfaceUniforms.uWet.value = wetness;
  puddles.update(t, R);
  wetTracks.update(performance.now() / 1000);
  snowTracks.update(performance.now() / 1000);
  if (R > 0.02) { sky.fog.density += R * 0.0007; sky.fog.color.lerp(new THREE.Color(0x8d969e), R * 0.35); }
  windscreen.update(paused ? 0 : dt, R, jeep.speed, inside && ride === 'car' && jeep.boat < 0.5 && started);
  // Up in the helicopter the air between you and the land thins out: the haze is in the lowest
  // few hundred metres, so the farther coast stays in view.
  if (mode === 'fly' || mode === 'sky') sky.fog.density /= 1 + Math.max(0, camera.position.y - Math.max(0, heightAt(camera.position.x, camera.position.z)) - 60) / 220;
  // Ambient occlusion shades corners a few metres across: from a few hundred metres up it shows
  // nothing, and it would draw the whole island a second time, so it rests while you fly high.
  if (post?.ao) post.ao.enabled = !((mode === 'fly' && heli.agl > 150 && driveView !== 'cockpit') || (mode === 'sky' && diver.agl > 150));
  const wash = rotorWash(dt);
  grass?.update(camera, w, mode === 'walk' || mode === 'sky' ? null : ride === 'heli' ? (heli.landed ? { x: heli.pos.x, z: heli.pos.z, r: 3.2 } : null) : { x: jeep.pos.x, z: jeep.pos.z, r: jeep.model.bike ? 1.1 : 2.3 }, wash);
  waterFx?.update(paused ? 0 : dt, camera, renderer.domElement.height, 1 - dark * 0.85, wash?.onWater ? wash : null);
  scatter?.hdRocks?.update(dt, camera.position);
  props?.setNight(dark);
  towns?.setNight(dark);
  stations?.setNight(dark);
  jeep.setLights(dark);
  if (heli) heli.dark = dark;
  waterUniforms.uLight.value = 1 - dark * 0.82;
  if (boatWater) boatWater.light = 1 - dark * 0.85;
  waterUniforms.uTint.value.copy(aurora.tint).multiplyScalar(auroraVisSmoothed * 0.1 * dark);
  world.waterMat.emissive.copy(aurora.tint).multiplyScalar(auroraVisSmoothed * 0.02 * dark);

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
  // Places you can hear: surf near the sea coast, strong wind up high and in exposed country,
  // sheep close by.
  {
    const inCar = mode !== 'walk' && mode !== 'sky' && started && !(ride === 'heli' && driveView !== 'cockpit' && mode !== 'fly');
    const surf = Math.pow(clamp(1 - coastAt(p.x, p.z) / 140, 0, 1), 1.6) * (ride === 'heli' && heli.agl > 40 ? 0.3 : 1);
    const high = clamp((heightAt(p.x, p.z) - 22) / 50, 0, 1) * clamp(exposureAt(p.x, p.z) * 1.4, 0, 1) * (0.6 + 0.4 * clamp(w.strength / 8, 0, 1));
    audio.placeUpdate(audio.ctx?.currentTime || 0, { fall: waterProx, surf, high, inCar });
    if (started && !paused && wildlife && Math.random() < dt * 0.5) {
      let nearest = 1e9;
      for (const an of wildlife.animals) if (an.sp === 'sheep') nearest = Math.min(nearest, Math.hypot(an.x - p.x, an.z - p.z));
      if (nearest < 60 && Math.random() < 0.6) audio.bleat(nearest, inCar);
    }
  }
  audio.update(dt, { heli: ride === 'heli' ? { rpm: heli.rpm, load: heli.thrust / 9.81, inside: mode === 'fly' && driveView === 'cockpit', near: mode === 'walk' ? Math.hypot(walker.pos.x - heli.pos.x, walker.pos.z - heli.pos.z) : mode === 'sky' ? Math.max(1, diver.pos.distanceTo(heli.pos)) : 0 } : null, speed: mode === 'walk' ? 0 : mode === 'sky' ? diver.speed : ride === 'heli' ? heli.speed * 0.5 : jeep.speed, wind: w.strength, exposure: exposureAt(p.x, p.z), waterProx, iceProx, inCar: mode !== 'walk' && mode !== 'sky' && started, wade: mode === 'walk' || mode === 'sky' ? 0 : jeep.wadeLevel || 0, nitro: mode !== 'walk' && mode !== 'sky' && jeep.boosting, throttle: mode === 'chase' ? input.throttle : 0, voice: ride === 'car' ? jeep.spec.engine?.voice : null, surface: jeep.surface, grounded: !jeep.air, gear: ride === 'car' ? jeep.gear || 0 : 0, shifting: ride === 'car' && !!jeep.shifting, rain: Math.max(rain?.intensity || 0, washing ? 0.85 : 0), slip: ride === 'car' && mode === 'chase' ? jeep.slip || 0 : 0, boat: ride === 'car' && mode !== 'walk' && mode !== 'sky' ? Math.max(0, Math.min(1, (jeep.boat - 0.4) / 0.4)) : 0 });

  if (started) {
    if (jeep.warning && mode !== 'walk' && mode !== 'sky') hud.toast(jeep.warning, { seconds: 2.5, priority: 1 });
    if (mode === 'walk' && walker.blocked === 'deep') hud.toast('The water is freezing out here. Swim back to the shore.', { seconds: 2.5 });
    if (mode === 'walk' && walker.blocked === 'far') hud.toast(afterJump && !leashOnHeli ? (isTouch ? 'Stay near where you landed. Tap Call for the helicopter.' : 'Stay near where you landed. Press E to call the helicopter.') : `Stay close to the ${ride === 'heli' ? 'helicopter' : 'car'}. Press E to get back in.`, { seconds: 2.5 });
    syncJumpButton();
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const bearing = Math.atan2(fwd.x, -fwd.z);
    if (Math.floor(clock.realSeconds * 2) !== lastWhere) { lastWhere = Math.floor(clock.realSeconds * 2); hud.whereText = describePlace(p.x, p.z).label; hud.nextWindowText = nextWindowLabel(); hud.nextText = nextPlaceText(p); }
    $('nitro-bar').style.transform = `scaleX(${jeep.nitro.toFixed(3)})`;
    $('nitro-bar').parentElement.classList.toggle('is-on', jeep.boosting);
    $('t-gas').style.setProperty('--tank', jeep.nitro.toFixed(3));
    $('t-gas').classList.toggle('is-boosting', jeep.boosting);
    if (onBike !== !!jeep.spec.bike) { onBike = !!jeep.spec.bike; document.body.classList.toggle('on-bike', onBike); }
    if (!paused) fuelTick(dt);
    nav.update(dt, activePos(), activeHeading(), t);
    mapUI.route = nav.route?.pts || null; mapUI.dest = nav.dest;
    mapUI.lineMode = !!document.querySelector('.hx')?.offsetParent;
    if (mapUI.lineMode) worldMarks(dt);
    mapUI.update(dt, activePos(), activeHeading());
    if (jeep.boatOn && started) badges.feat('boat');
    hud.update(dt, {
      kmh: mode === 'sky' ? diver.kmh : ride === 'heli' ? heli.kmh : jeep.kmh, walking: mode === 'walk', altitude: mode === 'fly' ? heli.pos.y : mode === 'sky' ? diver.agl : null, where: hud.whereText || '', clockLabel: clock.label(), season: clock.season, monthName: clock.m.name, aurora: a,
      bearingDeg: THREE.MathUtils.radToDeg(bearing), windBearingDeg: THREE.MathUtils.radToDeg(Math.atan2(w.x, -w.z)), windStrength: w.strength,
      lookingUp: up, lookingUpWrongWay: upAnyDir && !up, lookTimer, loggedThisWindow, busy: !started || paused || mode === 'sky' || !!document.querySelector('dialog[open]'),
      now: clock.gameHours, nightStart: clock.nightIndex * 24 + 12 + 4, history: forecast.history.get(clock.nightIndex),
      predict: (h) => forecast.predictedAt(h, clock.gameHours), nextWindow: hud.nextWindowText,
      kick: mode === 'walk' ? 'On foot' : ride === 'heli' ? 'Helicopter' : jeep.spec.name, next: hud.nextText, gear: gearText(),
      dayText: `${clock.m.name} · ${a.summer ? 'Midnight sun' : a.active ? 'Aurora out now' : hud.nextWindowText ? `Lights likely ${hud.nextWindowText}` : a.dark < CONFIG.aurora.minDarkness ? 'Waiting for dark' : 'Dark sky'}`,
      nitro: jeep.nitro, boosting: jeep.boosting,
      fuel: fuel.on && ride === 'car' && mode !== 'walk' ? { level: fuel.level(jeep.kind), litres: fuel.litres(jeep.kind) } : null,
      agl: mode === 'fly' ? Math.max(0, heli.agl) : mode === 'sky' ? Math.max(0, diver.agl) : null,
    });
  }

  mirrors.update(renderer, scene, camera, jeep.body, started && mode === 'chase' && driveView === 'cockpit' && !!jeep.model.mirrors);
  // Behind the cover the island is hidden: draw a few frames to warm it up, then none until Start.
  if (started || coverWarmFrames-- > 0) {
    skyRefl?.update(scene, camera.position, smoothstep(0.25, 0.75, dark));
    if (post) post.render(t, (lastPostState = { aurora: auroraVisSmoothed, dark }));
    else renderer.render(scene, camera);
  }
  if (captureRequest) { const cb = captureRequest; captureRequest = null; cb(renderer.domElement.toDataURL('image/jpeg', 0.88)); }
  tickPlay(dt, { playing: !paused, driving: mode !== 'walk' && ride === 'car', metresPerSecond: jeep.vF, kmh: jeep.kmh, boosting: jeep.boosting });
  if (started) syncBrakePedal();
  if (started) {
    const inside = mode === 'chase' && driveView !== 'chase';
    turnWheel(jeep.interior, jeep.steerVis);
    driver.update(jeep, ride === 'car' && mode !== 'walk' && mode !== 'lookup', mode === 'chase' && driveView === 'cockpit');
    if (inside && driveView === 'cockpit') updateInterior(jeep.interior, { kmh: jeep.kmh, steer: jeep.steerVis, music: audio.music && volumes.music > 0 && !audio.muted ? trackTitle(audio.music.i) : null });
    // Nitro from inside: the exhaust flames are behind you, so the screen edges glow instead.
    const glow = inside && jeep.boosting;
    if (glow !== boostGlowOn) { boostGlowOn = glow; $('boost-glow').classList.toggle('is-on', glow); }
  }
  input.endFrame();

  // If the device is struggling, first draw fewer pixels; only when that is not enough, step
  // quality down once.
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 4) {
    const fps = fpsFrames / fpsAcc;
    window.__fps = fps;
    if (started && !paused) adaptResolution(fps);
    if (started && fps < (isTouch ? 24 : 40) && resScale <= RES_MIN && !autoDowngraded && !settings.quality && qualityName !== 'low') {
      autoDowngraded = true;
      holdFrame(() => setQuality(qualityName === 'high' ? 'medium' : 'low', false));
      settings.autoQuality = qualityName; store.save();
      track('graphics_auto_lowered', { to: qualityName, fps: Math.round(fps) });
      hud.toast('Lowered graphics quality to keep things smooth, and it stays lower next time. You can change it in Settings.', { seconds: 5 });
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
let pctShown = 0, pctSeg = { from: 0, to: 0, t0: 0, dur: 1 }, pTarget = 0;
function startProgress(p, ms, label) {
  p = pTarget = Math.max(p, pTarget); // the bar never heads backwards
  startBtn.style.setProperty('--dur', `${ms}ms`);
  startBtn.style.setProperty('--p', p.toFixed(3));
  startLabel.textContent = label;
  countUp(); // catch the number up on the old step before starting the new one
  pctSeg = { from: pctShown, to: p, t0: performance.now(), dur: Math.max(1, ms) };
}
function countUp() {
  const t = Math.min(1, (performance.now() - pctSeg.t0) / pctSeg.dur);
  pctShown = Math.max(pctShown, pctSeg.from + (pctSeg.to - pctSeg.from) * (1 - (1 - t) * (1 - t)));
  const pct = Math.round(pctShown * 100);
  startPct.textContent = `${pct}%`;
  startBtn.setAttribute('aria-valuenow', String(pct));
}
// A plain timer, not animation frames, so the number keeps up even when frames are scarce.
const countTimer = setInterval(countUp, 50);
const bootStart = performance.now();
requestAnimationFrame(() => setTimeout(async () => {
  try {
    await buildWorld(startProgress);
    // Back in the helicopter if that is what you last flew.
    if (settings.vehicle === 'heli') await heli.ready.then(() => boardHeli(false)).catch(() => {});
    // Your car starts as its real model, never the code-built stand-in: wait for its file (it has
    // been loading since the page opened), for at most half a minute.
    if (!modelReady(jeep.kind)) {
      startProgress(0.9, 4000, 'Parking your car');
      await Promise.race([whenModel(jeep.kind), new Promise((r) => setTimeout(r, 30000))]);
      if (ride === 'car' && modelReady(jeep.kind)) jeep.setType(jeep.kind);
    }
    // Park the camera behind the jeep for the intro view.
    camera.position.set(jeep.pos.x - Math.sin(jeep.heading) * 12, jeep.pos.y + 5, jeep.pos.z - Math.cos(jeep.heading) * 12);
    camera.lookAt(jeep.pos.x, jeep.pos.y + 2, jeep.pos.z);
    const left = Math.max(900, MIN_LOAD_MS - (performance.now() - bootStart));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    startProgress(0.93, left * 0.55, 'Waking the aurora');
    // Start drawing the scene once the finish is moving, so the bar glides through the first
    // frame (which can take a moment) and the scene is alive behind the start screen.
    await nextPaint();
    requestAnimationFrame(frame);
    await wait(left * 0.55);
    startProgress(1, left * 0.45, 'Warming up the engine');
    await wait(left * 0.45 + 60);
    clearInterval(countTimer);
    startBtn.classList.remove('is-loading');
    startBtn.classList.add('is-ready');
    startBtn.removeAttribute('role'); startBtn.removeAttribute('aria-valuenow'); startBtn.removeAttribute('aria-label');
    startLabel.textContent = 'Start driving';
    startBtn.disabled = false;
    haptics.play('success');
    const shared = readSharedSighting();
    if (shared) renderSharedSighting(shared);
  } catch (err) {
    clearInterval(countTimer);
    console.error(err);
    startBtn.classList.add('is-failed');
    startLabel.textContent = 'Could not build the island';
    $('loading').textContent = 'Something went wrong while building the island. Try reloading, or lower the quality in Settings.';
  }
}, 30));

// Handy for tuning from the browser console.
window.chasingGreen = {
  clock, forecast, CONFIG, store, linkFor, scene, renderer, camera, mirrors, driver, setVehicle, fastTravel, input, badges, hud, notebook, THREE, get jeep() { return jeep; },
  get obstacles() { return obstacles; }, get scene() { return scene; }, Vec3: THREE.Vector3, get puddles() { return puddles; }, get mapUI() { return mapUI; }, get snow() { return snow; },
  nearestRoad: (x, z, r) => nearestRoad(x, z, r), coastAt, roadDistAt, shoreDistAt, groundAt, solidTopAt, get wildlife() { return wildlife; },
  roadPaths: () => roadPaths, fuel, putCar, get stations() { return stations; }, stageTimes,
  heightAt: (x, z) => heightAt(x, z), get skyRefl() { return skyRefl; },
  snowAt: (x, z) => snowAt(x, z),
  waterLevelAt: (x, z) => waterLevelAt(x, z),
  get kerid() { return KERID; },
  // Make it rain (0 to 1), or null to let the weather decide.
  set rain(v) { forceRain = v; }, set snowFall(v) { forceSnow = v; }, get roadSnow() { return roadSnow; }, get snowTracks() { return snowTracks; }, iceAt: (x, z) => iceAt(x, z), setMonth: (m) => setMonth(m), get dirt() { return carDirt; }, setDirt(v, c) { carDirt.dirt = v; if (c) carDirt.color = c; grime.uDirt.value = v; setDirtColor(carDirt.color); }, get rain() { return rain?.intensity || 0; }, get wetness() { return wetness; }, set wetness(v) { wetness = v; },
  poolAt: (x, z) => poolAt(x, z), get pools() { return poolSurfaces; }, get skids() { return skids; }, get wetTracks() { return wetTracks; }, get waterFx() { return waterFx; },
  get bridges() { return bridges; },
  get jumps() { return JUMPS; },
  // Debug switches for tracking down rendering problems.
  // Render one frame now through the same pipeline as the game (for captures from the console).
  get post() { return post; },
  get sky() { return sky; },
  renderNow() { if (post) post.render(clock.realSeconds, lastPostState); else renderer.render(scene, camera); },
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
  get jeep() { return jeep; }, get heli() { return heli; }, get diver() { return diver; }, get afterJump() { return afterJump; }, jump: () => jump(), callHeli: () => callHeli(), get ride() { return ride; }, get walker() { return walker; }, get audio() { return audio; }, get sitting() { return sitting; }, get canyon() { return CANYONS[0]; }, get landmarks() { return landmarks; }, get aurora() { return aurora; }, get mode() { return mode; },
  setMode: (m) => { mode = m; },
  // Render one still with a forced aurora, from a given camera, at any size. Used to make the
  // share image and, frame by frame with a rising t, the share video. Returns a PNG data URL,
  // or what grab(canvas) returns, and puts the renderer back the way it was.
  still({ from, to, kp = 7.2, type = AURORA_TYPES.curtains, hour = 23.6, w = 1200, h = 630, scale = 2, fov, t = 40, grab } = {}) {
    const A = CONFIG.aurora;
    const state = {
      vis: 0.2 + 0.8 * smoothstep(A.minKp, A.fullKp, kp), curtains: 1 + 3 * smoothstep(A.minKp, 7.5, kp),
      pink: type === AURORA_TYPES.pink ? 1 : smoothstep(4.5, 6.5, kp), red: type === AURORA_TYPES.red ? 1 : 0, corona: type === AURORA_TYPES.corona ? 1 : 0,
      ...(type === AURORA_TYPES.pulsating ? { breakup: 0, diffuse: 0.7, pulse: 1 } : {}),
    };
    const saved = { hours: clock.gameHours, aspect: camera.aspect, fov: camera.fov, pr: renderer.getPixelRatio() };
    clock.gameHours = hour;
    camera.position.set(...from); camera.lookAt(...to);
    if (fov) camera.fov = fov;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setPixelRatio(1); renderer.setSize(w * scale, h * scale, false);
    jeep.setLights(1); jeep.sync?.(0);
    Object.assign(aurora.smooth, state);
    aurora.update(0, t, camera, state);
    sky.update({ camera, clock, cloud: 0.04, cloudOffset, city: { overhead: 0, horizon: 0, dirX: 1, dirZ: 0 }, auroraVis: state.vis, auroraTint: aurora.tint, t });
    waterUniforms.uLight.value = 0.25;
    if (post) { post.setSize(); post.render(t, { aurora: state.vis, dark: 1 }); } else renderer.render(scene, camera);
    const url = grab ? grab(renderer.domElement) : renderer.domElement.toDataURL('image/png');
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

const SET_CAT = { 'set-view': 'controls', 'set-month': 'trip', 'set-speed': 'trip', 'set-fuel': 'trip', 'set-nitro': 'trip', 'set-places': 'trip', 'set-quality': 'picture', 'set-look': 'picture', 'set-rocks': 'picture', 'set-full': 'picture', 'set-sound': 'sound', 'set-heli': 'controls', 'set-haptics': 'controls', 'set-steering': 'controls' };
const SET_NOTE = {
  'set-view': 'Where you watch from: behind the car, on the hood, or from the driver\'s seat. C changes it while driving.',
  'set-month': 'Sets the sun, the length of the night and how often the aurora comes out.',
  'set-speed': 'How fast the clock runs. Faster brings the night, and the lights, sooner.',
  'set-fuel': 'Off and the tank never runs dry. On and you stop at stations to fill up.',
  'set-nitro': 'A burst of speed on Space. The tank refills on its own as you drive.',
  'set-places': 'When the place panel shows: at every place, only places you have not stamped, or never.',
  'set-quality': 'Low runs smoothest; High draws more grass, rocks and longer views.',
  'set-look': 'Realistic uses real Icelandic elevation and textures. Classic is the original, simpler look.',
  'set-rocks': 'How many rocks lie around the land. Changes on the next load.',
  'set-full': 'Fill the whole screen with the island.',
  'set-sound': 'All sound on or off. The volumes below set each part.',
  'set-heli': 'Easy flies like the car: steer and go. Manual gives you lift, pitch and turn yourself.',
  'set-haptics': 'Little buzzes for bumps, stamps and the aurora.',
  'set-steering': 'Steer with the arrow buttons or by tilting the phone like a wheel.',
  volume: 'Drag, or choose the row and use left and right.',
};

// ---------- Settings: tap a choice instead of opening a drop-down ----------
// Each short select in Settings gets a row of buttons that drive it, so the same change
// handlers run. The long month list keeps its drop-down.
for (const sel of document.querySelectorAll('.settings-grid select:not(.month-select)')) {
  const seg = document.createElement('div');
  seg.className = ['seg', ...['desk-only', 'touch-only'].filter((c) => sel.classList.contains(c))].join(' ');
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
  // Three or more choices also get a stepper (◂ value ▸), which the computer menu shows instead.
  if (sel.options.length > 2) seg.after(stepper(sel));
}
function stepper(sel) {
  const st = document.createElement('div');
  st.className = 'step';
  st.innerHTML = '<button type="button" class="st-prev" aria-label="Previous"><svg viewBox="0 0 10 10"><path d="M7 1 2 5l5 4z"/></svg></button><span class="st-val"></span><button type="button" class="st-next" aria-label="Next"><svg viewBox="0 0 10 10"><path d="m3 1 5 4-5 4z"/></svg></button>';
  const val = st.querySelector('.st-val');
  const show = () => { val.textContent = sel.options[sel.selectedIndex]?.textContent || ''; };
  const go = (d) => {
    const n = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + d));
    if (n === sel.selectedIndex) return;
    sel.selectedIndex = n; sel.dispatchEvent(new Event('change', { bubbles: true })); show();
  };
  st.querySelector('.st-prev').addEventListener('click', () => go(-1));
  st.querySelector('.st-next').addEventListener('click', () => go(1));
  st.step = go;
  sel.addEventListener('change', show);
  settingsDialog.addEventListener('sync', show);
  show();
  return st;
}
$('set-month').closest('.select-wrap').after(stepper($('set-month')));
// Each setting becomes one row (a label and its control), so the menu can light the chosen row.
// On phones the row box drops away (display: contents) and the grid lays the parts out as before.
for (const label of [...document.querySelectorAll('.settings-grid > label')]) {
  const row = document.createElement('div');
  row.className = ['srow', ...['desk-only', 'touch-only'].filter((c) => label.classList.contains(c))].join(' ');
  label.before(row);
  let n = label.nextElementSibling;
  row.append(label);
  while (n && n.tagName !== 'LABEL') { const next = n.nextElementSibling; row.append(n); n = next; }
  row.dataset.cat = SET_CAT[label.htmlFor] || 'trip';
  row.dataset.key = label.htmlFor;
}
for (const el of document.querySelectorAll('#settings .credits, #settings .panel-actions')) el.dataset.cat = 'about';
$('sound').querySelector('.sound-list').dataset.cat = 'sound';

// ---------- Settings on computers: groups on the left, an info panel on the right ----------
function setCat(cat) {
  const page = $('settings');
  page.dataset.cat = cat;
  for (const b of page.querySelectorAll('.set-cats button')) { const on = b.dataset.cat === cat; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); }
  const first = sheet.rows()[0];
  if (first) sheet.select(first);
}
for (const b of document.querySelectorAll('#settings .set-cats button')) b.addEventListener('click', () => { sfx.tick(); setCat(b.dataset.cat); });
sheet.onTab = (page) => {
  if (page === 'notebook') { notebook.nextTab?.(); return; }
  const cats = [...document.querySelectorAll('#settings .set-cats button')].map((b) => b.dataset.cat);
  setCat(cats[(cats.indexOf($('settings').dataset.cat) + 1) % cats.length]);
};
// The info panel says what the chosen setting does; Month also shows its light and a year of nights.
function darkByMonth() {
  const keep = clock.month, out = [];
  for (let i = 0; i < 12; i++) { clock.month = i; out.push(clock.darkHours()); }
  clock.month = keep;
  return out;
}
let darkYear = null;
document.addEventListener('row-select', (e) => {
  const row = e.detail;
  if (!row.closest('#settings')) return;
  const key = row.dataset.key || (row.querySelector('input[type=range]') ? 'volume' : '');
  const label = row.querySelector('label')?.querySelector('b')?.textContent || row.querySelector('label')?.textContent || '';
  $('sn-kick').textContent = { trip: 'Trip', picture: 'Picture', sound: 'Sound', controls: 'Controls', about: 'About' }[row.dataset.cat || $('settings').dataset.cat] || '';
  $('sn-title').textContent = key === 'set-month' ? clock.m.name : label;
  $('sn-text').textContent = SET_NOTE[key] || row.querySelector('label span')?.textContent || '';
  let extra = '';
  if (key === 'set-month') {
    const m = clock.m, day = Math.max(0, Math.min(24, m.sunset - m.sunrise)), dark = clock.darkHours();
    darkYear ||= darkByMonth();
    extra = `<div class="sn-three"><div><span>Day</span><b>${day.toFixed(1)} h</b></div><div><span>Dark</span><b>${dark.toFixed(1)} h</b></div><div><span>Aurora</span><b class="g">${m.chance}</b></div></div>
      <div class="sn-bars">${darkYear.map((d, i) => `<i class="${i === clock.month ? 'on' : ''}" style="height:${Math.max(3, (d / 20) * 100).toFixed(0)}%"></i>`).join('')}</div>
      <div class="sn-lbl">${'JFMAMJJASOND'.split('').map((c) => `<span>${c}</span>`).join('')}</div><p class="sn-tip">${m.tip}</p>`;
  } else if (key === 'set-heli' || key === 'set-nitro' || key === 'set-speed') {
    extra = `<dl class="sn-keys"><div><dt>Drive</dt><dd>W A S D</dd></div><div><dt>Nitro</dt><dd>Space</dd></div><div><dt>Look up</dt><dd>L</dd></div><div><dt>View</dt><dd>C</dd></div><div><dt>Vehicle</dt><dd>V</dd></div><div><dt>Step out</dt><dd>E</dd></div><div><dt>Map</dt><dd>M</dd></div><div><dt>Postcard</dt><dd>P</dd></div></dl>`;
  }
  $('sn-extra').innerHTML = extra;
});
$('set-month').addEventListener('change', () => { const r = document.querySelector('#settings .srow.is-sel'); if (r) document.dispatchEvent(new CustomEvent('row-select', { detail: r })); });

// Fullscreen and sound as plain rows.
$('set-full').addEventListener('change', (e) => {
  const on = e.target.value === 'on';
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => { e.target.value = 'off'; settingsDialog.dispatchEvent(new Event('sync')); });
  if (!on && document.fullscreenElement) document.exitFullscreen?.();
});
document.addEventListener('fullscreenchange', () => { $('set-full').value = document.fullscreenElement ? 'on' : 'off'; settingsDialog.dispatchEvent(new Event('sync')); });
$('set-sound').addEventListener('change', (e) => setMuted(e.target.value === 'off'));

// On computers the volumes live under Settings > Sound; phones keep their own Sound page.
function placeSoundList() {
  const list = document.querySelector('.sound-list'), desk = true; // volumes live under Settings > Sound everywhere
  if (desk && list.parentElement.id !== 'settings') $('settings').querySelector('.settings-grid').after(list);
  if (!desk && list.parentElement.id === 'settings') $('sound').append(list);
}
placeSoundList();
new MutationObserver(placeSoundList).observe(document.body, { attributes: true, attributeFilter: ['class'] });
