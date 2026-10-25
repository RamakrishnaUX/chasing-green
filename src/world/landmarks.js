import * as THREE from 'three';
import { createWaterMaterial } from './materials.js';
import { toWorld, LAKES, CANYONS, WS } from './geo.js';
import { heightAt, nearestRoad, roadDistAt } from './terrain.js';
import { mulberry32, clamp, createNoise2D } from './noise.js';
import * as More from './landmarks_more.js';
import { EXTRA } from './landmarks_extra.js';
import { waterLevelAt } from './terrain.js';
import { rockMaterial } from './materials.js';

const DESC = {
  seljalandsfoss: 'A tall waterfall you can walk all the way behind.',
  skogafoss: 'A wide, thundering waterfall with a stairway up the cliff beside it.',
  reynisfjara: 'Black sand, basalt columns and sea stacks on the wild south coast.',
  jokulsarlon: 'A glacier lagoon full of drifting icebergs.',
  gullfoss: 'A huge two-step waterfall dropping into a canyon.',
  thingvellir: 'A rift valley where two continental plates pull apart.',
  kirkjufell: 'The cone-shaped mountain everyone photographs, with a small waterfall in front.',
  studlagil: 'A canyon of basalt columns with blue-green water running through it.',
  myvatn: 'A shallow lake ringed by craters, lava and steam.',
  dettifoss: 'One of the most powerful waterfalls in Europe.',
};

export const LANDMARKS = [
  {
    id: 'seljalandsfoss', name: 'Seljalandsfoss', kind: 'waterfall', glyph: 'falls',
    ll: [63.6156, -19.9886], away: 24,
    legend: 'Its shy neighbour Gljúfrabúi, whose name means canyon dweller, hides inside a gorge a short walk north.',
    fact: 'The water drops about 60 metres, and a path runs right behind the curtain so you can see the falls from the inside.',
  },
  {
    id: 'skogafoss', name: 'Skógafoss', kind: 'waterfall', glyph: 'falls',
    ll: [63.5321, -19.5114], away: 26,
    legend: 'The settler Þrasi is said to have hidden a chest of gold behind the falls. Boys once grabbed its ring before the chest slipped away, and the ring ended up on the church door at Skógar.',
    fact: 'About 60 metres high and 25 wide. On sunny days the spray throws up a rainbow, often a double one.',
  },
  {
    id: 'reynisfjara', name: 'Reynisfjara', kind: 'beach', glyph: 'columns',
    ll: [63.4044, -19.045], away: 0,
    legend: 'The sea stacks of Reynisdrangar are said to be trolls who tried to drag a ship ashore at night and turned to stone when the sun came up.',
    fact: 'The sand is black basalt. Sneaker waves can surge far up the beach without warning, so never turn your back on the sea.',
  },
  {
    id: 'jokulsarlon', name: 'Jökulsárlón', kind: 'lagoon', glyph: 'ice',
    ll: [64.078, -16.23], away: 0,
    legend: 'Njáls saga places the farm of Kári Sölmundarson at Breiðá, close to here. The glacier later swallowed that land.',
    fact: 'Iceland’s deepest lake, at more than 250 metres. Icebergs calve from Breiðamerkurjökull and drift out to sea, washing up on Diamond Beach.',
  },
  {
    id: 'gullfoss', name: 'Gullfoss', kind: 'waterfall', glyph: 'falls',
    ll: [64.3271, -20.1199], offset: [26, 4],
    legend: 'Sigríður Tómasdóttir, a farmer’s daughter, fought plans to harness the falls for power. The story says she threatened to throw herself in if the work went ahead.',
    fact: 'The Hvítá river drops about 32 metres in two steps, then vanishes into a narrow canyon.',
  },
  {
    id: 'thingvellir', name: 'Þingvellir', kind: 'rift', glyph: 'rift',
    ll: [64.2559, -21.13], offset: [0, -48],
    legend: 'From the Law Rock, the lawspeaker recited the laws of the land from memory to everyone gathered for the Alþingi.',
    fact: 'The Alþingi first met here in 930. The valley sits in the rift where the North American and Eurasian plates pull apart.',
  },
  {
    id: 'kirkjufell', name: 'Kirkjufell', kind: 'mountain', glyph: 'peak',
    ll: [64.9415, -23.3058], offset: [-40, 6], reach: 80,
    legend: 'Its name means Church Mountain, after its steeple shape. It has watched over the fishing town of Grundarfjörður for centuries.',
    fact: 'It rises 463 metres from the shore and is often called the most photographed mountain in Iceland.',
  },
  {
    id: 'studlagil', name: 'Stuðlagil', kind: 'canyon', glyph: 'columns',
    ll: [65.165, -15.36], away: 0, reach: 46,
    legend: 'Icelanders have long compared basalt columns to organ pipes, and their shape inspired the design of Hallgrímskirkja in Reykjavík.',
    fact: 'The canyon was hidden under the glacial river Jökla until a dam upstream lowered the water in 2009, revealing one of the largest displays of basalt columns in Iceland. Walk in from either end to stand by the river.',
  },
  {
    id: 'myvatn', name: 'Mývatn', kind: 'lake', glyph: 'crater',
    ll: [65.648, -17.0], away: 0,
    legend: 'Folklore says the Yule Lads, the thirteen mischief makers of Icelandic Christmas, live in the lava maze of Dimmuborgir by the lake.',
    fact: 'The name means Midge Lake. The small craters on its shore are pseudocraters, made when lava flowed over wet ground and trapped water burst into steam.',
  },
  {
    id: 'dettifoss', name: 'Dettifoss', kind: 'waterfall', glyph: 'falls',
    ll: [65.8147, -16.3846], away: 28,
    legend: 'Just north, the horseshoe canyon of Ásbyrgi is said to be the hoofprint of Sleipnir, Odin’s eight-legged horse.',
    fact: 'One of Europe’s most powerful waterfalls. Grey glacial water from Vatnajökull falls about 44 metres, and you feel the spray before you see it.',
  },
  {
    id: 'bluelagoon', name: 'Blue Lagoon', kind: 'pool', glyph: 'pool', ll: [63.88, -22.449], away: 22,
    desc: 'Milky blue geothermal water steaming in a black lava field on Reykjanes.',
    fact: 'The lagoon is fed by water from a nearby geothermal power plant. Silica in the water gives it that pale blue colour.',
  },
  {
    id: 'hallgrimskirkja', name: 'Hallgrímskirkja', kind: 'building', glyph: 'church', pos: [-445, 205],
    desc: 'Reykjavík\u2019s great concrete church, its tower stepped like basalt columns.',
    fact: 'At about 74 metres it is one of the tallest buildings in Iceland, and it took 41 years to finish.',
  },
  {
    id: 'harpa', name: 'Harpa Concert Hall', kind: 'building', glyph: 'harpa', pos: [-481, 217],
    desc: 'A glass concert hall on the harbour that glows in colour after dark.',
    fact: 'Its facade, designed with artist Olafur Eliasson, is made of glass panels inspired by basalt columns.',
  },
  {
    id: 'sunvoyager', name: 'Sun Voyager', kind: 'sculpture', glyph: 'ship', pos: [-486, 228],
    desc: 'A steel dreamboat sculpture on the Reykjavík shore, facing the sea.',
    legend: 'It is often mistaken for a Viking ship, but the artist meant it as a dreamboat and an ode to the sun.',
    fact: 'Jón Gunnar Árnason designed it, and it was unveiled in 1990.',
  },
  {
    id: 'perlan', name: 'Perlan', kind: 'building', glyph: 'dome', pos: [-440, 290],
    desc: 'A glass dome on a wooded hill above Reykjavík, with views over the city.',
    fact: 'The dome sits on top of giant tanks that store hot water for heating the city.',
  },
  {
    id: 'kerid', name: 'Kerið Crater', kind: 'crater', glyph: 'crater', ll: [64.105, -20.88], away: 0, reach: 70,
    desc: 'A volcanic crater with red scoria walls and a teal lake at the bottom.',
    fact: 'The crater is about 55 metres deep, and the lake in it is fed by groundwater.',
  },
  {
    id: 'fjadrargljufur', name: 'Fjaðrárgljúfur', kind: 'canyon', glyph: 'canyon', ll: [63.79, -18.18], away: 0, reach: 60,
    desc: 'A winding canyon with moss-covered walls and a river far below.',
    fact: 'The canyon is up to about 100 metres deep and runs for around 2 kilometres.',
  },
  {
    id: 'skaftafell', name: 'Skaftafell', kind: 'park', glyph: 'ice', ll: [64.016, -16.966], offset: [30, -30], reach: 50,
    desc: 'Part of Vatnajökull National Park, where a glacier tongue reaches the valley.',
    fact: 'Skaftafell was its own national park until 2008, when it became part of Vatnajökull National Park.',
  },
  {
    id: 'svartifoss', name: 'Svartifoss', kind: 'waterfall', glyph: 'falls', ll: [64.04, -16.99], away: 0, reach: 44,
    desc: 'A waterfall framed by hanging black basalt columns.',
    fact: 'Its name means Black Falls, after the dark basalt columns around it.',
  },
  {
    id: 'strokkur', name: 'Strokkur Geyser', kind: 'geyser', glyph: 'geyser', ll: [64.3125, -20.3], away: 20,
    desc: 'A geyser that erupts every few minutes. Watch the water bulge just before it blows.',
    legend: 'Its neighbour, the Great Geysir, gave the world the word geyser.',
    fact: 'Strokkur erupts every 5 to 10 minutes, usually 15 to 20 metres high.',
  },
  {
    id: 'dyrholaey', name: 'Dyrhólaey', kind: 'headland', glyph: 'arch', ll: [63.392, -19.13], away: 0, reach: 60,
    desc: 'A cliff headland with a huge sea arch and a lighthouse on top.',
    fact: 'The name means door-hole island, after the great arch in the headland.',
  },
  {
    id: 'godafoss', name: 'Goðafoss', kind: 'waterfall', glyph: 'falls', ll: [65.6828, -17.55], away: 28,
    desc: 'A wide horseshoe waterfall in the north, the waterfall of the gods.',
    legend: 'The story goes that when Iceland became Christian in the year 1000, the lawspeaker threw his old pagan idols into the falls.',
    fact: 'It is about 12 metres high and 30 metres wide.',
  },
  {
    id: 'diamondbeach', name: 'Diamond Beach', kind: 'beach', glyph: 'ice', ll: [64.024, -16.18], away: 0, reach: 44,
    desc: 'Icebergs from the lagoon wash up and glitter on the black sand.',
    fact: 'The ice drifts out of Jökulsárlón to the sea, and the waves push chunks back onto the beach.',
  },
  {
    id: 'gljufrabui', name: 'Gljúfrabúi', kind: 'waterfall', glyph: 'falls', ll: [63.6256, -20.06], away: 28,
    desc: 'A hidden waterfall inside a narrow gorge, a short walk from Seljalandsfoss.',
    fact: 'Its name means canyon dweller. You have to step into the gorge to see it properly.',
  },
  {
    id: 'hengifoss', name: 'Hengifoss', kind: 'waterfall', glyph: 'falls', ll: [65.095, -14.86], away: 30, reach: 46,
    desc: 'A tall, thin waterfall in a cliff striped with red clay.',
    fact: 'At about 128 metres it is one of the tallest waterfalls in Iceland. The red bands are old soil layers between lava flows.',
  },
  {
    id: 'asbyrgi', name: 'Ásbyrgi', kind: 'horseshoe', glyph: 'canyon', ll: [65.985, -16.72], away: 0, reach: 50,
    desc: 'A horseshoe canyon with sheer cliffs and birch woods inside.',
    legend: 'Old stories say the horseshoe was made by Sleipnir, Odin\u2019s eight-legged horse, touching down.',
    fact: 'It is about 3.5 kilometres long, with cliffs up to 100 metres high, carved by huge glacial floods.',
  },
  {
    id: 'hverir', name: 'Hverir', kind: 'geothermal', glyph: 'steam', ll: [65.641, -16.81], away: 22,
    desc: 'Steaming vents and bubbling mud pots on orange and ochre ground.',
    fact: 'The rotten egg smell is hydrogen sulphide from the hot ground. Stay on the paths, the crust can be thin.',
  },
  {
    id: 'vik', name: 'Vík í Mýrdal', kind: 'town', glyph: 'church', ll: [63.42, -19.006], away: 26,
    desc: 'The southernmost village, with a red-roofed church on the hill above.',
    fact: 'If the Katla volcano erupts and floods the plain, locals are told to head up to the church on the hill.',
  },
  {
    id: 'husavik', name: 'Húsavík', kind: 'town', glyph: 'church', ll: [66.045, -17.34], away: 24,
    desc: 'A harbour town in the north with a wooden church from 1907.',
    fact: 'It is often called the whale watching capital of Iceland.',
  },
  {
    id: 'eldhraun', name: 'Eldhraun', kind: 'lava', glyph: 'lava', ll: [63.72, -18.34], away: 22,
    desc: 'A vast lava field buried under thick, soft grey-green moss.',
    fact: 'It formed in the Laki eruption of 1783 and 1784, one of the largest lava flows in recorded history. The moss grows so slowly that footprints last for years.',
  },
  {
    id: 'hveravellir', name: 'Hveravellir', kind: 'geothermal', glyph: 'steam', ll: [64.866, -19.56], away: 20,
    desc: 'Hot springs and steam vents on the high Kjölur plateau.',
    legend: 'The outlaw Fjalla-Eyvindur is said to have hidden out here in the 1700s.',
    fact: 'It sits between two glaciers, Langjökull and Hofsjökull, on the old highland route across Iceland.',
  },
  { id: 'seydisfjordur', name: 'Seyðisfjarðarkirkja', kind: 'town', glyph: 'church', ll: [65.263, -13.995], away: 0, reach: 40, model: 'rainbowChurch',
    desc: 'The pale blue wooden church at the end of a rainbow-painted street, deep in a fjord.',
    fact: 'The street in front of the church was first painted in rainbow colours in 2016, and the town repaints it every year.' },
  { id: 'dynjandi', name: 'Dynjandi', kind: 'waterfall', glyph: 'falls', ll: [65.73, -23.2], away: 34, reach: 50, model: 'falls', params: { width: 10, height: 36, fan: 2.6, tiers: 3 },
    desc: 'A huge fan-shaped waterfall tumbling down the Westfjords, wide at the bottom and narrow at the top.',
    fact: 'The main fall is about 100 metres high and spreads to about 60 metres wide at its foot. Its name means thundering.' },
  { id: 'haifoss', name: 'Háifoss', kind: 'waterfall', glyph: 'falls', ll: [64.21, -19.69], away: 30, reach: 46, model: 'falls', params: { width: 2.4, height: 48, cliffWidth: 34, canyon: true },
    desc: 'One of Iceland\u2019s tallest waterfalls, dropping into a deep canyon in the highlands.',
    fact: 'It falls about 122 metres. The name simply means High Falls.' },
  { id: 'kvernufoss', name: 'Kvernufoss', kind: 'waterfall', glyph: 'falls', ll: [63.525, -19.44], away: 26, model: 'falls', params: { width: 2.6, height: 16, walkBehind: true, cliffWidth: 20 },
    desc: 'Skógafoss\u2019s quiet neighbour, in a mossy gorge you can walk behind.',
    fact: 'It is a short walk from the Skógar museum, and far fewer people visit it than Skógafoss.' },
  { id: 'oxararfoss', name: 'Öxarárfoss', kind: 'waterfall', glyph: 'falls', ll: [64.267, -21.117], offset: [36, -52], model: 'falls', params: { width: 4, height: 9, cliffWidth: 22 },
    desc: 'A small waterfall pouring over the edge of the rift at Þingvellir.',
    fact: 'The river Öxará was probably diverted into the rift by the settlers, so the Alþingi had water close by.' },
  { id: 'barnafoss', name: 'Barnafoss', kind: 'waterfall', glyph: 'falls', ll: [64.70, -20.97], away: 26, model: 'falls', params: { width: 7, height: 6, cliffWidth: 40, springs: true },
    desc: 'Blue-white water churning through a narrow lava chute, beside the spring-fed Hraunfossar.',
    fact: 'Next door, Hraunfossar is a line of waterfalls that seeps straight out of the edge of a lava field.' },
  { id: 'solheimajokull', name: 'Sólheimajökull', kind: 'park', glyph: 'ice', ll: [63.53, -19.37], away: 36, reach: 50, model: 'glacier',
    desc: 'A glacier tongue you can walk up to from the south coast.',
    fact: 'It flows down from Mýrdalsjökull and has been shrinking by tens of metres a year.' },
  { id: 'planewreck', name: 'Sólheimasandur Plane Wreck', kind: 'wreck', glyph: 'plane', ll: [63.459, -19.365], offset: [35, 14], reach: 40, model: 'planeWreck',
    desc: 'The bare silver shell of a DC-3 lying on an empty plain of black sand.',
    legend: 'The crew walked away. The wings, tail and engines were taken off for parts, and the body was left where it stopped.',
    fact: 'A US Navy Douglas C-117, a Super DC-3, came down on the sand here on 21 November 1973. Everyone on board survived.' },
  { id: 'vikurfjara', name: 'Víkurfjara', kind: 'beach', glyph: 'columns', ll: [63.412, -18.99], away: 0, reach: 40, model: 'beach',
    desc: 'The black sand beach at Vík, looking out at the Reynisdrangar stacks.',
    fact: 'It faces straight into the North Atlantic, with nothing between here and Antarctica.' },
  { id: 'secretlagoon', name: 'Secret Lagoon', kind: 'pool', glyph: 'pool', ll: [64.14, -20.31], away: 22, model: 'hotpool', params: { color: 0x3fa6c4, r: 9, hut: true },
    desc: 'A simple old hot pool at Flúðir, with a little geyser beside it.',
    fact: 'Built in 1891, it is the oldest swimming pool in Iceland.' },
  { id: 'fridheimar', name: 'Friðheimar', kind: 'town', glyph: 'dome', ll: [64.16, -20.44], away: 22, model: 'greenhouse',
    desc: 'A tomato farm where you eat lunch among the greenhouse vines.',
    fact: 'The greenhouses are lit and heated with geothermal energy, so tomatoes grow all year.' },
  { id: 'hvammsvik', name: 'Hvammsvík Hot Springs', kind: 'pool', glyph: 'pool', ll: [64.39, -21.65], away: 22, model: 'hotpool', params: { color: 0x2f8ea8, r: 6, pools: 4, sea: true },
    desc: 'Hot pools built into the shore of a fjord, close to Reykjavík.',
    fact: 'Some of the pools are right at the tide line, so the sea comes in and cools them twice a day.' },
  { id: 'reykjadalur', name: 'Reykjadalur Hot Spring', kind: 'geothermal', glyph: 'steam', ll: [64.03, -21.2], away: 30, model: 'hotriver',
    desc: 'A steaming valley with a warm river you can bathe in.',
    fact: 'The walk up the valley from Hveragerði takes about an hour, and the river gets warmer the further up you go.' },
  { id: 'bridgecontinents', name: 'Bridge Between Continents', kind: 'bridge', glyph: 'rift', ll: [63.87, -22.68], away: 20, model: 'bridge',
    desc: 'A footbridge across a sandy rift between the North American and Eurasian plates.',
    fact: 'The plates move apart by about two centimetres a year.' },
  { id: 'budakirkja', name: 'Búðakirkja', kind: 'town', glyph: 'church', ll: [64.82, -23.38], away: 24, model: 'church', params: { black: true },
    desc: 'The small black church standing alone on a lava field on Snæfellsnes.',
    fact: 'The present church was built in 1848, on the site of one that was first built in 1703.' },
  { id: 'arnarstapi', name: 'Arnarstapi', kind: 'headland', glyph: 'arch', ll: [64.77, -23.62], away: 0, reach: 44, model: 'arch', params: { small: true },
    desc: 'A fishing hamlet above a coast of basalt arches and bird cliffs.',
    fact: 'The stone arch of Gatklettur is the best known of several arches carved by the sea here.' },
  { id: 'hvitserkur', name: 'Hvítserkur', kind: 'headland', glyph: 'arch', ll: [65.72, -20.62], away: 0, reach: 44, model: 'stack',
    desc: 'A 15 metre rock stack standing in the sea like a drinking dragon.',
    fact: 'Its base has been reinforced with concrete so the waves do not finally knock it down.' },
  { id: 'dimmuborgir', name: 'Dimmuborgir', kind: 'lava', glyph: 'lava', ll: [65.59, -16.91], away: 26, model: 'pillars',
    desc: 'A maze of dark lava pillars and arches near Mývatn.',
    fact: 'The name means dark castles. The pillars formed when a lava lake drained away and left its crust standing.' },
  { id: 'grjotagja', name: 'Grjótagjá', kind: 'cave', glyph: 'pool', ll: [65.63, -16.88], away: 22, model: 'cave',
    desc: 'A small lava cave with a hot spring glowing blue inside.',
    fact: 'The water got too hot for bathing after eruptions in the 1970s and 80s, and it is still slowly cooling.' },
  { id: 'naturebaths', name: 'Mývatn Nature Baths', kind: 'pool', glyph: 'pool', ll: [65.63, -16.84], away: 24, model: 'hotpool', params: { color: 0x6fc3d3, r: 12, hut: true },
    desc: 'The north\u2019s answer to the Blue Lagoon, with milky blue water above the lake.',
    fact: 'The water comes up from a borehole at well over 100 degrees and is cooled before it reaches the pool.' },
  { id: 'geosea', name: 'GeoSea', kind: 'pool', glyph: 'pool', ll: [66.05, -17.36], offset: [-30, -10], model: 'hotpool', params: { color: 0x2f8ea8, r: 8, sea: true },
    desc: 'Warm sea-water pools on the cliff edge at Húsavík, looking out over the bay.',
    fact: 'The water is heated sea water, so it is salty, and you may spot whales while you soak.' },
  { id: 'landmannalaugar', name: 'Landmannalaugar', kind: 'mountain', glyph: 'peak', ll: [63.98, -19.06], away: 36, reach: 60, model: 'rhyolite',
    desc: 'Rainbow-coloured rhyolite mountains and a hot stream, deep in the highlands.',
    fact: 'The colours come from rhyolite, a volcanic rock that weathers into reds, yellows and greens. The road in is only open in summer.' },
  { id: 'silfra', name: 'Silfra', kind: 'rift', glyph: 'rift', ll: [64.255, -21.12], offset: [-40, -40], model: 'silfra',
    desc: 'A crack between the continents filled with glass-clear water.',
    fact: 'The water is filtered through lava for decades, which is why you can see more than 100 metres through it.' },
  { id: 'laugavegur', name: 'Laugavegur', kind: 'town', glyph: 'harpa', pos: [-452, 216], model: 'rainbowStreet',
    desc: 'Reykjavík\u2019s main shopping street, with a rainbow painted up Skólavörðustígur toward the church.',
    fact: 'The rainbow was painted for Reykjavík Pride and was made permanent in 2019.' },
  { id: 'isafjordur', name: 'Ísafjörður', kind: 'town', glyph: 'church', ll: [66.07, -23.13], away: 22, model: 'church', params: { walls: 0xf2f0ea, roof: 0x8a2a24, hill: 0 },
    desc: 'The capital of the Westfjords, squeezed onto a spit of sand in a fjord.',
    fact: 'The town sits on a gravel spit called Eyri, with mountains rising almost straight out of the sea around it.' },
];

// Shared uniforms so every waterfall dims at night and picks up aurora light.
export const waterUniforms = { uTime: { value: 0 }, uLight: { value: 1 }, uTint: { value: new THREE.Color(0x000000) } };

const FALL_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FALL_FRAG = /* glsl */ `
uniform float uTime; uniform float uLight; uniform vec3 uTint; uniform vec3 uColor; uniform float uSpeed;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  float t = uTime * uSpeed;
  // Long vertical streaks: three layers falling at different speeds.
  // Turbulence: warp the coordinates first so the streaks twist and bunch into strands.
  float warp = n(vec2(vUv.x * 5.0, vUv.y * 2.0 + t * 0.25)) - 0.5;
  vec2 q = vec2(vUv.x + warp * 0.06 * (1.0 - vUv.y), vUv.y);
  float s1 = n(vec2(q.x * 26.0, q.y * 1.4 + t * 0.55));
  float s2 = n(vec2(q.x * 61.0 + 3.0, q.y * 3.2 + t * 0.9));
  float s3 = n(vec2(q.x * 9.0 - 7.0, q.y * 0.6 + t * 0.35));
  float strands = smoothstep(0.3, 0.7, n(vec2(q.x * 14.0, q.y * 0.5 + t * 0.2)));
  float streak = (s1 * 0.5 + s2 * 0.3 + s3 * 0.2) * (0.88 + 0.12 * strands);
  // The sheet turns to white froth as it falls and air gets mixed in.
  float froth = smoothstep(0.75, 0.15, vUv.y) * (0.5 + 0.5 * s2);
  float lip = smoothstep(0.9, 1.0, vUv.y);           // glassy water just over the edge
  float foam = smoothstep(0.25, 0.0, vUv.y);         // churning at the bottom
  // Ragged edges that wobble as the water moves.
  float raggedL = 0.06 + 0.07 * n(vec2(vUv.y * 9.0 + t * 0.4, 1.0));
  float raggedR = 0.06 + 0.07 * n(vec2(vUv.y * 9.0 + t * 0.4, 7.0));
  float edge = smoothstep(0.0, raggedL, vUv.x) * smoothstep(1.0, 1.0 - raggedR, vUv.x);
  float highlight = smoothstep(0.72, 0.95, s2 * 0.6 + s1 * 0.4);
  vec3 body = mix(uColor * 0.72, vec3(1.0), streak * 0.55 + foam * 0.5 + froth * 0.2);
  body = mix(body, uColor * 0.55, lip * 0.6);
  body += highlight * 0.45 * (0.5 + uLight);
  vec3 c = body * uLight + uTint * 0.7;
  float a = (0.5 + 0.5 * streak) * edge;
  a = max(a, froth * 0.5 * edge * smoothstep(0.25, 0.6, streak));
  a = mix(a, 0.85 * edge, lip);
  a = clamp(a + foam * 0.35, 0.0, 0.97);
  gl_FragColor = vec4(c, a);
}`;

const FALL_CURVE_VERT = /* glsl */ `varying vec2 vUv; uniform float uArc;
void main(){
  vUv = uv;
  vec3 p = position;
  float d = 1.0 - uv.y;                    // 0 at the lip, 1 at the bottom
  p.z += uArc * (sqrt(d) * 0.9 + d * 0.3);  // water arcs out off the lip, then drops
  p.x *= 1.0 + d * 0.14;                    // and spreads as it falls
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

// Churning white water where the falls hit the pool.
const BOIL_FRAG = /* glsl */ `
uniform float uTime; uniform float uLight; uniform vec3 uTint; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 q = vUv - 0.5; float r = length(q) * 2.0; float a = atan(q.y, q.x);
  float churn = n(vec2(a * 3.0, r * 6.0 - uTime * 1.3)) * 0.6 + n(vec2(a * 7.0 + uTime * 0.3, r * 14.0 - uTime * 2.2)) * 0.4;
  float alpha = smoothstep(1.0, 0.2, r) * smoothstep(0.25, 0.7, churn);
  gl_FragColor = vec4(vec3(0.95, 0.97, 0.98) * uLight + uTint * 0.5, alpha * 0.85);
}`;

function fallMaterial(color = 0xdbe9f2, speed = 2.6, arc = 1.2) {
  return new THREE.ShaderMaterial({
    vertexShader: FALL_CURVE_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...waterUniforms, uColor: { value: new THREE.Color(color) }, uSpeed: { value: speed }, uArc: { value: arc } },
  });
}
const boilMaterial = () => new THREE.ShaderMaterial({ vertexShader: FALL_VERT, fragmentShader: BOIL_FRAG, transparent: true, depthWrite: false, uniforms: { ...waterUniforms } });
const wetRock = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.22, metalness: 0.05 });
const mossMat = new THREE.MeshStandardMaterial({ color: 0x3f5a24, roughness: 0.98 });

// Moss tufts: soft green lumps along the lip and sides of a fall.
function mossTufts(g, width, height, count, rand, cliffW = width + 26) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mossMat);
    const side = rand() < 0.5 ? -1 : 1;
    const onLip = rand() < 0.75;
    const reach = Math.max(0.5, Math.min(6, (cliffW - width) / 2 - 1));
    const x = onLip ? (rand() - 0.5) * Math.min(width + 10, cliffW - 1) : side * (width / 2 + 0.6 + rand() * reach);
    const y = onLip ? height + 0.4 : rand() * height;
    m.position.set(x, y, 0.4 + rand() * 0.6);
    const sc = 0.5 + rand() * 1.2;
    m.scale.set(sc * 1.3, sc * 0.55, sc * 1.0);
    m.rotation.set(rand(), rand() * 3, rand());
    g.add(m);
  }
}

const rockNoise = createNoise2D(808);

// A roughened, subdivided block that uses the terrain shader, so it reads as layered basalt
// with grass or snow on top instead of a flat box.
function rockBox(w, h, d, rough = 0.6) {
  const g = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)), Math.max(2, Math.round(d / 2)));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < -h / 2 + 0.01) continue; // keep the base flat
    const n = rockNoise(x * 0.35 + z * 0.21, y * 0.4) * rough;
    const n2 = rockNoise(x * 0.9 - 7, z * 0.9 + y * 0.3) * rough * 0.5;
    p.setXYZ(i, x + n * Math.sign(x) * 0.6, y + (y > h / 2 - 0.01 ? n2 * 1.2 : 0), z + n2 * Math.sign(z) * 0.8);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, rockMaterial());
}

// Irregular ice: a subdivided sphere pushed in and out, flattened, with a sharp waterline.
// Glacier ice: a faceted crystal. Starts from a subdivided sphere, then every face is pushed
// in or out by its own amount and the mesh is split so each facet keeps a hard edge.
function iceGeometry(size, rand) {
  const base = new THREE.IcosahedronGeometry(size, 2);
  const p = base.attributes.position;
  const k = [rand() * 6, rand() * 6, rand() * 6];
  const sx = 0.8 + rand() * 0.6, sy = 0.5 + rand() * 0.35, sz = 0.8 + rand() * 0.6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Large lumps, then sharp noise that snaps vertices onto a few planes.
    const n = 1 + 0.22 * Math.sin(x * 2.1 / size + k[0]) * Math.sin(z * 1.7 / size + k[1]) + 0.12 * Math.sin(y * 3.3 / size + k[2]);
    const snap = 0.12 * size;
    let nx = x * n * sx, ny = y * n * sy, nz = z * n * sz;
    nx = Math.round(nx / snap) * snap; ny = Math.round(ny / snap) * snap; nz = Math.round(nz / snap) * snap;
    p.setXYZ(i, nx, Math.max(ny, -size * 0.3), nz);
  }
  // Split faces so normals are flat per facet, then jut some facets out.
  const g = base.toNonIndexed();
  const q = g.attributes.position;
  const v = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let f = 0; f < q.count; f += 3) {
    if (rand() > 0.3) continue;
    c.set(0, 0, 0);
    for (let j = 0; j < 3; j++) c.add(v.fromBufferAttribute(q, f + j));
    c.multiplyScalar(1 / 3);
    e1.fromBufferAttribute(q, f + 1).sub(v.fromBufferAttribute(q, f)); e2.fromBufferAttribute(q, f + 2).sub(v);
    nrm.crossVectors(e1, e2).normalize();
    const push = (rand() - 0.4) * 0.16 * size;
    for (let j = 0; j < 3; j++) { v.fromBufferAttribute(q, f + j).addScaledVector(nrm, push); q.setXYZ(f + j, v.x, v.y, v.z); }
  }
  g.computeVertexNormals();
  return g;
}

const basalt = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0,  color: 0x2b2f33, flatShading: true });
const basaltLight = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0,  color: 0x3c4247, flatShading: true });
const moss = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0,  color: 0x46553f, flatShading: true });
const poolMat = createWaterMaterial(0x16424a, { roughness: 0.08, ripple: 1.4 });

// Soft round sprite drawn on a canvas, so particles read as spray rather than squares.
let softSprite = null;
function sprite() {
  if (softSprite) return softSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  softSprite = new THREE.CanvasTexture(c);
  return softSprite;
}

function makeMist(count, spread, height) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.2) * 6;
    seed[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xdfe9ef, size: 2.2, map: sprite(), transparent: true, opacity: 0.3, depthWrite: false, sizeAttenuation: true });
  const pts = new THREE.Points(g, m);
  pts.userData = { seed, spread, height };
  return pts;
}

const mistWind = { x: 0, z: 0 };
function animateMist(pts, dt) {
  pts.material.color.setScalar(0.35 + waterUniforms.uLight.value * 0.6);
  const p = pts.geometry.attributes.position.array;
  const { seed, spread, height } = pts.userData;
  for (let i = 0; i < seed.length; i++) {
    p[i * 3 + 1] += (0.8 + seed[i] * 1.8) * dt;
    p[i * 3 + 2] += (0.6 + seed[i]) * dt + mistWind.z * dt * 0.3;
    p[i * 3] += Math.sin(p[i * 3 + 1] * 0.5 + seed[i] * 6) * dt * 0.4 + mistWind.x * dt * 0.3;
    if (p[i * 3 + 1] > height) {
      p[i * 3] = (Math.random() - 0.5) * spread;
      p[i * 3 + 1] = 0;
      p[i * 3 + 2] = (Math.random() - 0.2) * 4;
    }
  }
  pts.geometry.attributes.position.needsUpdate = true;
}

// A cliff face with a waterfall pouring off its front edge. Local +z faces the viewer.
function makeWaterfall({ width, height, walkBehind = false, color, cliffWidth }) {
  const g = new THREE.Group();
  const cw = cliffWidth || width + 26;
  const depth = 14;
  if (walkBehind) {
    const side = (cw - width - 8) / 2;
    const l = rockBox(side, height + 6, depth);
    l.position.set(-(width + 8) / 2 - side / 2, (height + 6) / 2 - 3, -depth / 2);
    const r = rockBox(side, height + 6, depth); r.position.copy(l.position); r.position.x *= -1;
    const back = rockBox(width + 8, height + 6, depth - 6);
    back.position.set(0, (height + 6) / 2 - 3, -depth / 2 - 3);
    const lip = rockBox(width + 8, 4, 6, 0.3);
    lip.position.set(0, height + 1, -3);
    [l, r, back].forEach((m) => (m.userData.collide = true));
    g.add(l, r, back, lip);
  } else {
    const c = rockBox(cw, height + 6, depth);
    c.position.set(0, (height + 6) / 2 - 3, -depth / 2);
    c.userData.collide = true;
    g.add(c);
  }
  const rand = mulberry32(Math.round(width * 131 + height * 17));
  // Wet, dark rock behind the water.
  const wet = new THREE.Mesh(new THREE.PlaneGeometry(width + 3, height + 2), wetRock);
  wet.position.set(0, height / 2, walkBehind ? -5.9 : 0.05);
  g.add(wet);
  // The water sheet, two layers for depth.
  const arc = Math.min(2.4, 0.6 + height * 0.05);
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(width, height + 1, 6, 18), fallMaterial(color, 2.6, arc));
  fall.position.set(0, height / 2, walkBehind ? 0.4 : 0.6);
  g.add(fall);
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.15, height + 1, 6, 18), fallMaterial(color, 3.4, arc * 1.15));
  veil.material.uniforms.uColor.value.multiplyScalar(1.1);
  veil.position.set(0, height / 2, (walkBehind ? 0.4 : 0.6) + 0.25);
  veil.scale.set(1, 1, 1);
  g.add(veil);
  // Pool, foam boil at the impact, moss.
  const pool = new THREE.Mesh(new THREE.CircleGeometry(width * 0.8 + 4, 28), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.12, 5);
  g.add(pool);
  const boil = new THREE.Mesh(new THREE.CircleGeometry(width * 0.75 + 2, 28), boilMaterial());
  boil.rotation.x = -Math.PI / 2;
  boil.position.set(0, 0.33, arc + 1.2);
  g.add(boil);
  mossTufts(g, width, height, Math.round(10 + width), rand, cw);
  // Mist: soft, lit by the sky, drifting with the wind.
  const mist = makeMist(Math.round(140 + width * 7), width + 8, height * 0.7);
  mist.position.set(0, 0.5, arc + 1.5);
  mist.material.size = 2.9 + width * 0.04;
  mist.material.opacity = 0.3;
  g.add(mist);
  return { group: g, mists: [mist] };
}

function makeColumns(rand) {
  const g = new THREE.Group();
  const cols = new THREE.Group();
  cols.position.set(30, 0, 6);
  cols.rotation.y = -0.5;
  g.add(cols);
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6);
  for (let i = 0; i < 70; i++) {
    const row = Math.floor(i / 14), col = i % 14;
    const h = 3 + Math.abs(Math.sin(col * 0.7)) * 10 + rand() * 3 + row * 1.6;
    const m = new THREE.Mesh(geo, rand() > 0.5 ? basalt : basaltLight);
    m.scale.set(0.95, h, 0.95);
    m.position.set((col - 7) * 1.7 + (row % 2) * 0.85, h / 2 - 1, -row * 1.5 - 4);
    m.userData.collideCircle = 0.9;
    cols.add(m);
  }
  // Sea stacks offshore.
  [[-14, 40, 20], [-4, 52, 26], [8, 46, 16]].forEach(([x, z, h]) => {
    const sg = new THREE.CylinderGeometry(1.2 + rand() * 1.2, 4.4, h, 7, 8);
    const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) { const k = 1 + rockNoise(sp.getY(i) * 0.4 + x, i * 0.3) * 0.18; sp.setX(i, sp.getX(i) * k); sp.setZ(i, sp.getZ(i) * k); }
    sg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(sp.count * 3), 3));
    sg.computeVertexNormals();
    const s = new THREE.Mesh(sg, rockMaterial());
    s.position.set(x, h / 2 - 4, z);
    s.rotation.y = rand() * 3;
    g.add(s);
  });
  return g;
}

function makeKirkjufell() {
  // Witch-hat profile: a broad grassy skirt, steep layered flanks and a narrow summit.
  const prof = [[32, 0], [29, 2], [24, 5], [19.5, 10], [16, 15], [13, 20], [10.4, 25], [8, 29.5], [5.8, 33.5], [3.6, 37], [1.6, 39.5], [0, 40.5]];
  const pts = [];
  for (let i = 0; i < prof.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      pts.push(new THREE.Vector2(prof[i][0] + (prof[i + 1][0] - prof[i][0]) * t, prof[i][1] + (prof[i + 1][1] - prof[i][1]) * t));
    }
  }
  pts.push(new THREE.Vector2(0, 40.5));
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.translate(0, -2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.01) continue;
    const a = Math.atan2(z, x);
    // Rock bands: flanks step in and out a little every couple of units of height.
    const fr = (y / 2.4) % 1;
    const band = (fr < 0.7 ? 0 : (fr - 0.7) / 0.3) * 0.7;
    const gully = rockNoise(a * 3.2, y * 0.08) * 0.09 + rockNoise(a * 9, y * 0.25) * 0.04;
    const k = 1 + gully + band / Math.max(r, 3);
    pos.setX(i, x * k + y * 0.1);
    pos.setZ(i, z * k);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3), 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, rockMaterial());
  m.scale.set(1, 1, 0.75);
  m.userData.collideCircle = 25;
  return m;
}

function makeRift() {
  const g = new THREE.Group();
  const wall = new THREE.BoxGeometry(5, 7, 90, 1, 2, 10);
  const p = wall.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.sin(p.getZ(i) * 0.15) * 0.8 * (p.getY(i) > 0 ? 1 : 0));
  wall.computeVertexNormals();
  const a = rockBox(5, 7, 90, 0.9);
  a.position.set(-6, 2.5, 0);
  const b = rockBox(5, 7, 90, 0.9);
  b.position.set(6, 1.5, 0);
  b.scale.y = 0.8;
  a.userData.collide = true;
  b.userData.collide = true;
  // A small flagpole marks the Law Rock.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 7, 5), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0,  color: 0xcfd5d9 }));
  pole.position.set(-3.2, 9.5, -8);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0,  color: 0x2c5aa0, side: THREE.DoubleSide }));
  flag.position.set(-2.0, 12.2, -8);
  g.add(a, b, pole, flag);
  g.rotation.y = Math.PI / 4;
  return g;
}

export class Landmarks {
  constructor(scene, { quality = 'medium', beforeBuild = null } = {}) {
    this.quality = quality;
    this.scene = scene;
    this.mists = [];
    this.ice = [];
    this.steam = [];
    this.updaters = [];
    this.nightMats = [];
    this.auroraMats = [];
    this.onEvent = null;
    this.colliders = [];
    const rand = mulberry32(99);
    this.list = LANDMARKS.map((def) => {
      const w = def.pos ? { x: def.pos[0] * WS, z: def.pos[1] * WS } : toWorld(def.ll[0], def.ll[1]);
      let x = w.x, z = w.z, facing = 0;
      const road = nearestRoad(x, z, 300);
      if (def.offset) { x += def.offset[0]; z += def.offset[1]; }
      else if (def.away && road) {
        let dx = x - road.px, dz = z - road.pz;
        let d = Math.hypot(dx, dz);
        if (d < 2) {
          // Sitting right on the road: step off sideways, to whichever side is higher and drier.
          const sx = road.seg.bx - road.seg.ax, sz = road.seg.bz - road.seg.az, L = Math.hypot(sx, sz) || 1;
          const px = -sz / L, pz = sx / L;
          const hA = heightAt(road.px + px * def.away, road.pz + pz * def.away), hB = heightAt(road.px - px * def.away, road.pz - pz * def.away);
          const sgn = hA >= hB ? 1 : -1;
          dx = px * sgn; dz = pz * sgn; d = 1;
        }
        x = road.px + (dx / d) * def.away;
        z = road.pz + (dz / d) * def.away;
      }
      // Never build in the sea: step toward the road until the ground is dry.
      for (let k = 0; k < 30 && heightAt(x, z) < waterLevelAt(x, z) + 0.8 && def.kind !== 'headland' && def.kind !== 'beach'; k++) {
        const rr = nearestRoad(x, z, 300);
        if (!rr) break;
        const dx = rr.px - x, dz = rr.pz - z, d = Math.hypot(dx, dz) || 1;
        x += (dx / d) * 2; z += (dz / d) * 2;
      }
      const r2 = nearestRoad(x, z, 300);
      if (r2) facing = Math.atan2(r2.px - x, r2.pz - z); // face the nearest road
      if (['lake', 'lagoon', 'beach', 'canyon', 'headland'].includes(def.kind)) facing = z < -150 * WS ? Math.PI : 0; // sea is north on the north coast
      return { ...def, desc: def.desc || DESC[def.id] || '', x, z, facing };
    });
    beforeBuild?.(this.list);
    for (const lm of this.list) this.build(lm, rand);
  }

  build(lm, rand) {
    const y = heightAt(lm.x, lm.z);
    const root = new THREE.Group();
    root.userData.lmId = lm.id;
    root.position.set(lm.x, y, lm.z);
    root.rotation.y = lm.facing;
    let g;
    switch (lm.id) {
      case 'seljalandsfoss': g = makeWaterfall({ width: 4, height: 22, walkBehind: true }); break;
      case 'skogafoss': g = makeWaterfall({ width: 13, height: 22 }); break;
      case 'dettifoss': g = makeWaterfall({ width: 34, height: 14, color: 0xb8b2a2, cliffWidth: 60 }); break;
      case 'gullfoss': {
        const upper = makeWaterfall({ width: 22, height: 5, cliffWidth: 34 });
        upper.group.position.set(0, 9, -10);
        const lower = makeWaterfall({ width: 14, height: 10, cliffWidth: 26 });
        lower.group.rotation.y = Math.PI / 2.4;
        lower.group.position.set(-14, 0, 0);
        g = { group: new THREE.Group(), mists: [...upper.mists, ...lower.mists] };
        g.group.add(upper.group, lower.group);
        break;
      }
      default: g = null;
    }
    if (g) { root.add(g.group); this.mists.push(...g.mists); }

    // New landmarks, built in landmarks_more.js.
    const cs = Math.cos(lm.facing), sn = Math.sin(lm.facing);
    const kit = {
      rand, quality: this.quality, baseY: y, waterUniforms, cs, sn, lmX: lm.x, lmZ: lm.z, iceGeometry, makeMist, makeWaterfall, fallMaterial, rockBox, rockMaterial,
      ground: (lx, lz) => heightAt(lm.x + lx * cs + lz * sn, lm.z - lx * sn + lz * cs) - y,
      roadDist: (lx, lz) => roadDistAt(lm.x + lx * cs + lz * sn, lm.z - lx * sn + lz * cs),
      nightLit: (mat, k, base = 0) => this.nightMats.push({ mat, k, base }),
      auroraLit: (mat, k) => this.auroraMats.push({ mat, k, base: mat.emissiveIntensity }),
      update: (fn) => this.updaters.push(fn),
      emit: (type) => this.onEvent?.(type, lm),
      mists: (list) => this.mists.push(...list),
      steam: (pts, speed = 0.6) => this.steam.push(pts),
    };
    const builders = {
      hallgrimskirkja: More.buildHallgrimskirkja, harpa: More.buildHarpa, sunvoyager: More.buildSunVoyager, perlan: More.buildPerlan,
      bluelagoon: More.buildBlueLagoon, kerid: More.buildKerid, hverir: More.buildHverir, hveravellir: More.buildHveravellir,
      strokkur: More.buildStrokkur, svartifoss: More.buildSvartifoss, godafoss: More.buildGodafoss, gljufrabui: More.buildGljufrabui,
      hengifoss: More.buildHengifoss, asbyrgi: More.buildAsbyrgi, dyrholaey: More.buildDyrholaey,
      skaftafell: More.buildSkaftafell, diamondbeach: More.buildDiamondBeach, eldhraun: More.buildEldhraun,
      vik: (k) => More.buildChurch(k, { hill: 9 }), husavik: (k) => More.buildChurch(k, { hill: 0, roof: 0x8a2a24, scale: 1.2 }),
    };
    if (builders[lm.id]) root.add(builders[lm.id](kit));
    else if (lm.model && EXTRA[lm.model]) root.add(EXTRA[lm.model](kit, lm.params || {}));
    if (lm.id === 'skogafoss') {
      // The stairway up the slope beside the falls.
      const stepMat = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.9 });
      for (let i = 0; i < 34; i++) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.9), stepMat);
        st.position.set(23 + i * 0.05, 0.2 + i * 0.68, 4 - i * 0.62);
        st.castShadow = st.receiveShadow = true;
        root.add(st);
      }
    }
    if (lm.id === 'reynisfjara') root.add(makeColumns(rand));
    if (lm.id === 'kirkjufell') {
      root.add(makeKirkjufell());
      // Kirkjufellsfoss: a small two-step falls between the road and the mountain.
      const upper = makeWaterfall({ width: 6, height: 3.2, cliffWidth: 13 });
      upper.group.position.set(22, -1.5, 16);
      const lower = makeWaterfall({ width: 4, height: 2.4, cliffWidth: 9 });
      lower.group.position.set(27, -2.4, 21);
      lower.group.rotation.y = -0.4;
      root.add(upper.group, lower.group);
      this.mists.push(...upper.mists, ...lower.mists);
    }
    if (lm.id === 'studlagil') this.buildCanyon(rand);
    if (lm.id === 'thingvellir') root.add(makeRift());
    if (lm.id === 'jokulsarlon') this.buildLagoon(lm, rand);
    if (lm.id === 'myvatn') this.buildMyvatn(lm, root, rand);
    root.traverse((m) => { if (m.isMesh && !m.material.transparent) { m.castShadow = true; m.receiveShadow = true; } });
    this.scene.add(root);
    lm.root = root;
    this.collectColliders(root);
  }

  collectColliders(obj) {
    obj.updateMatrixWorld(true);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
    obj.traverse((m) => {
      if (!m.isMesh) return;
      if (m.userData.collideCircle) {
        m.getWorldPosition(p);
        this.colliders.push({ circle: true, x: p.x, z: p.z, r: m.userData.collideCircle });
      } else if (m.userData.collide) {
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        m.matrixWorld.decompose(p, q, sc);
        e.setFromQuaternion(q, 'YXZ');
        const c = new THREE.Vector3().addVectors(bb.min, bb.max).multiplyScalar(0.5).applyMatrix4(m.matrixWorld);
        this.colliders.push({ x: c.x, z: c.z, rot: e.y, hx: ((bb.max.x - bb.min.x) / 2) * sc.x, hz: ((bb.max.z - bb.min.z) / 2) * sc.z });
      }
    });
  }

  // Hand every landmark collider to the shared obstacle set.
  registerObstacles(obs) {
    for (const c of this.colliders) {
      if (c.circle) obs.addCircle(c.x, c.z, c.r, 'cliff');
      else obs.addBox(c.x, c.z, c.rot, c.hx, c.hz, 'cliff');
    }
  }

  // Pushes a moving point out of solid landmark shapes. Returns true if it moved.
  resolve(pos, r) {
    let hit = false;
    for (const c of this.colliders) {
      if (Math.abs(pos.x - c.x) > 90 || Math.abs(pos.z - c.z) > 90) continue;
      if (c.circle) {
        const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
        if (d < min && d > 1e-4) { pos.x = c.x + (dx / d) * min; pos.z = c.z + (dz / d) * min; hit = true; }
        continue;
      }
      const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
      const dx = pos.x - c.x, dz = pos.z - c.z;
      // World to box space (inverse of a yaw rotation).
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      const ex = c.hx + r, ez = c.hz + r;
      if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
        const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
        let nx = lx, nz = lz;
        if (px < pz) nx = Math.sign(lx || 1) * ex; else nz = Math.sign(lz || 1) * ez;
        pos.x = c.x + nx * cs + nz * sn;
        pos.z = c.z - nx * sn + nz * cs;
        hit = true;
      }
    }
    return hit;
  }

  buildLagoon(lm, rand) {
    // Glacier tongue on the north side of the lagoon.
    const tongue = new THREE.Mesh(new THREE.BoxGeometry(46, 9, 16, 8, 2, 2), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0, color: 0xd6e6ee }));
    const p = tongue.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + (rand() - 0.5) * 4);
    tongue.geometry.computeVertexNormals();
    tongue.position.set(lm.x, heightAt(lm.x, lm.z - 24) + 3, lm.z - 24);
    tongue.userData.collide = true;
    this.collectColliders(tongue);
    this.scene.add(tongue);
    const iceMats = [0xcfe9f4, 0xa9d6ea, 0x8fc7e3, 0xe4f2f8].map((c) => new THREE.MeshPhysicalMaterial({ roughness: 0.08, metalness: 0, color: c, emissive: 0x0d2230, emissiveIntensity: 0.5, clearcoat: 1, clearcoatRoughness: 0.05, flatShading: true }));
    for (let i = 0; i < 42; i++) {
      const size = 0.6 + Math.pow(rand(), 2) * 3.2;
      const geo = iceGeometry(size, rand);
      geo.scale(1, 0.6 + rand() * 0.7, 1);
      const m = new THREE.Mesh(geo, iceMats[i % 4]);
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.55;
      const chunk = { mesh: m, cx: lm.x, cz: lm.z, a, r, speed: (0.004 + rand() * 0.01) * (rand() > 0.5 ? 1 : -1), bob: rand() * 6, size, spin: (rand() - 0.5) * 0.05 };
      this.ice.push(chunk);
      this.scene.add(m);
    }
    // A scatter of ice on the black sand of Diamond Beach, south of the road.
    for (let i = 0; i < 16; i++) {
      const s = 0.4 + rand() * 1.2;
      const m = new THREE.Mesh(iceGeometry(s, rand), iceMats[i % 4]);
      const x = lm.x + (rand() - 0.5) * 50, z = lm.z + 30 + rand() * 12;
      m.position.set(x, heightAt(x, z) + s * 0.3, z);
      m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      this.scene.add(m);
    }
  }

  buildCanyon(rand) {
    const c = CANYONS[0];
    const dx = c.b.x - c.a.x, dz = c.b.z - c.a.z, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    const geo = new THREE.CylinderGeometry(0.62, 0.62, 1, 6);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0,  color: 0xffffff, flatShading: true });
    const per = Math.floor(L * 0.86 / 1.05);
    const ROWS = 6;
    const mesh = new THREE.InstancedMesh(geo, mat, per * 2 * ROWS);
    const tones = [0x44474a, 0x55575a, 0x5f5a54, 0x8a5c3c, 0x9a6a44, 0x3a3d40].map((h) => new THREE.Color(h));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    const floorAt = (t) => heightAt(c.a.x + dx * t, c.a.z + dz * t);
    for (const sgn of [-1, 1]) {
      for (let row = 0; row < ROWS; row++) {
        for (let i = 0; i < per; i++) {
          const t = 0.07 + (i / per) * 0.86;
          const off = (c.w * 0.48 + row * 1.05 + (i % 2) * 0.5) * sgn;
          const x = c.a.x + dx * t + nx * off, z = c.a.z + dz * t + nz * off;
          const floor = floorAt(t) - 0.5;
          const rim = heightAt(c.a.x + dx * t + nx * (c.w + 1.5) * sgn, c.a.z + dz * t + nz * (c.w + 1.5) * sgn);
          const h = Math.max(2, rim - floor - 0.3 + rand() * 0.5);
          q.setFromAxisAngle(up, rand() * 0.5);
          m.compose(v.set(x, floor, z), q, sc.set(1, h, 1));
          mesh.setMatrixAt(n, m);
          // Rust streaks run in vertical bands, as in the real canyon.
          const band = Math.sin(t * 40 + sgn) > 0.55 ? 3 + Math.floor(rand() * 2) : Math.floor(rand() * 3);
          mesh.setColorAt(n, tones[band === 3 || band === 4 ? band : band === 2 ? 5 : band]);
          n++;
        }
      }
      // The column band is solid. You get into the canyon from either end, where it ramps down.
      const band = ROWS * 1.05 + 0.6;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(band, 10, L * 0.86), new THREE.MeshBasicMaterial());
      wall.visible = false;
      const mid = c.w * 0.48 + band / 2 - 0.4;
      wall.position.set((c.a.x + c.b.x) / 2 + nx * mid * sgn, 0, (c.a.z + c.b.z) / 2 + nz * mid * sgn);
      wall.rotation.y = Math.atan2(ux, uz);
      wall.userData.collide = true;
      this.scene.add(wall);
      this.collectColliders(wall);
    }
    mesh.count = n;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  buildMyvatn(lm, root, rand) {
    // Pseudo-craters: grassy rings, measured at their true spot (the root may be rotated).
    const craterMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, color: 0x5d6b3f });
    const baseY = heightAt(lm.x, lm.z);
    const cr = Math.cos(root.rotation.y), sr = Math.sin(root.rotation.y);
    const worldOf = (x, z) => [lm.x + x * cr + z * sr, lm.z - x * sr + z * cr];
    for (let i = 0; i < 9; i++) {
      const x = 21 + (i % 3) * 7.5 + rand() * 2, z = -1 + Math.floor(i / 3) * 6.5 + rand() * 2;
      const [wx, wz] = worldOf(x, z);
      if (waterLevelAt(wx, wz) > heightAt(wx, wz)) continue; // not in the lake
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2 + rand() * 1.6, 1.1, 10, 20), craterMat);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.z = 0.6;
      ring.position.set(x, heightAt(wx, wz) - baseY - 0.25, z);
      ring.receiveShadow = true;
      root.add(ring);
    }
    for (let i = 0; i < 3; i++) {
      const s = makeMist(40, 2, 9);
      s.material = s.material.clone();
      s.material.opacity = 0.22;
      s.material.size = 4.5;
      { const [wx, wz] = worldOf(-24 - i * 6, 4 + i * 3); s.position.set(-24 - i * 6, heightAt(wx, wz) - baseY + 0.5, 4 + i * 3); }
      root.add(s);
      this.steam.push(s);
    }
  }

  update(dt, t, env = {}) {
    waterUniforms.uTime.value = t;
    if (env.wind) { mistWind.x = env.wind.x; mistWind.z = env.wind.z; }
    for (const fn of this.updaters) fn(dt, t, env);
    const dark = env.dark ?? 0;
    for (const n of this.nightMats) n.mat.emissiveIntensity = n.base + n.k * dark;
    if (env.auroraTint) for (const a of this.auroraMats) { a.mat.emissive.copy(env.auroraTint).multiplyScalar(0.15 + (env.auroraVis || 0) * a.k * dark); }
    for (const m of this.mists) animateMist(m, dt);
    for (const s of this.steam) animateMist(s, dt * 0.6);
    const lag = LAKES[2];
    for (const c of this.ice) {
      c.a += c.speed * dt;
      const rx = lag.r * lag.stretch, rz = lag.r;
      const x = c.cx + Math.cos(c.a) * c.r * rx;
      const z = c.cz + Math.sin(c.a) * c.r * rz;
      c.mesh.position.set(x, (lag.level || 0) + 0.1 + Math.sin(t * 0.6 + c.bob) * 0.12, z);
      c.mesh.rotation.y += c.spin * dt;
      c.mesh.rotation.z = Math.sin(t * 0.4 + c.bob) * 0.04;
    }
  }

  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const lm of this.list) {
      const d = Math.hypot(lm.x - x, lm.z - z);
      if (d < bd) { bd = d; best = lm; }
    }
    return { lm: best, dist: bd };
  }
}
