// Stylised Iceland. Real latitude and longitude are squashed into game units.
// One game unit is roughly 300 m, so the Ring Road loop is a few minutes of driving.

// WS scales the whole island. 1.6 makes a lap of the Ring Road about 60% longer than the original.
export const WS = 2.4;
export function toWorld(lat, lon) {
  return { x: (lon + 19) * 160 * WS, z: -(lat - 64.8) * 360 * WS };
}

const ll = (arr) => arr.map(([lat, lon]) => toWorld(lat, lon));

// Rough coastline, clockwise from the Reykjanes tip.
export const COAST = ll([
  [63.81, -22.7], [64.0, -22.65], [64.15, -21.97], [64.32, -22.08], [64.55, -22.25],
  [64.78, -22.4], [64.8, -23.4], [64.85, -23.95], [64.93, -23.8], [64.97, -23.3],
  [65.05, -22.6], [65.2, -22.0], [65.4, -22.4], [65.5, -24.4], [66.0, -23.8],
  [66.4, -23.0], [66.45, -22.4], [66.2, -22.0], [65.7, -21.4], [65.75, -20.5],
  [66.1, -20.2], [65.75, -19.6], [66.1, -18.8], [65.92, -18.3], [65.73, -18.05],
  [66.1, -17.9], [66.15, -16.9], [66.13, -16.5], [66.5, -16.0], [66.2, -15.2],
  [65.8, -14.6], [65.5, -13.6], [65.1, -13.5], [64.75, -14.0], [64.4, -14.6],
  [64.22, -15.2], [64.0, -16.0], [63.98, -16.6], [63.8, -17.3], [63.55, -18.0],
  [63.39, -18.8], [63.38, -19.1], [63.45, -19.6], [63.55, -20.3], [63.78, -21.0],
  [63.82, -21.8],
]);

// Roads. type: paved or gravel.
export const ROADS = [
  {
    name: 'Ring Road',
    type: 'paved',
    loop: true,
    points: ll([
      [64.13, -21.85], [64.0, -21.18], [63.94, -21.0], [63.83, -20.4], [63.6, -19.99],
      [63.515, -19.5], [63.43, -19.0], [63.6, -18.3], [63.78, -18.05], [63.95, -17.0],
      [64.035, -16.18], [64.27, -15.25], [64.55, -14.62], [64.68, -14.35], [65.0, -14.25],
      [65.26, -14.4], [65.45, -15.4], [65.62, -16.5], [65.665, -16.95], [65.7, -17.5],
      [65.68, -18.09], [65.55, -18.8], [65.55, -19.45], [65.66, -20.28], [65.25, -20.9],
      [65.15, -21.1], [64.85, -21.55], [64.54, -21.92], [64.35, -21.85],
    ]),
  },
  {
    name: 'Golden Circle',
    type: 'paved',
    points: ll([[64.13, -21.85], [64.2, -21.5], [64.255, -21.13], [64.21, -20.73], [64.31, -20.3], [64.318, -20.13]]),
  },
  {
    name: 'Biskupstungnabraut',
    type: 'paved',
    points: ll([[64.31, -20.3], [64.1, -20.55], [63.94, -21.0]]),
  },
  {
    name: 'Snæfellsnes',
    type: 'paved',
    points: ll([[64.54, -21.92], [64.72, -22.25], [64.86, -22.75], [64.9, -23.05], [64.925, -23.25]]),
  },
  {
    name: 'Dettifoss road',
    type: 'gravel',
    points: ll([[65.56, -16.12], [65.68, -16.3], [65.8, -16.38]]),
  },
  {
    name: 'Jökuldalur',
    type: 'gravel',
    points: ll([[65.327, -14.75], [65.25, -15.05], [65.175, -15.24]]),
  },
  {
    name: 'Reykjanes (Blue Lagoon)',
    type: 'paved',
    points: ll([[64.13, -21.85], [64.06, -22.05], [63.95, -22.3], [63.885, -22.43]]),
  },
  {
    name: 'Reykjavík waterfront',
    type: 'paved',
    points: ll([[64.13, -21.85], [64.138, -21.9], [64.146, -21.935]]),
  },
  {
    name: 'Diamond Circle',
    type: 'paved',
    points: ll([[65.7, -17.5], [65.85, -17.42], [66.035, -17.33], [66.06, -16.95], [66.035, -16.55], [65.92, -16.45], [65.8, -16.38]]),
  },
  {
    name: 'Hengifoss road',
    type: 'paved',
    points: ll([[65.26, -14.4], [65.17, -14.62], [65.095, -14.84]]),
  },
  {
    name: 'Dyrhólaey road',
    type: 'paved',
    points: ll([[63.452, -19.12], [63.425, -19.125], [63.405, -19.13]]),
  },
  {
    name: 'Skaftafell road',
    type: 'paved',
    points: ll([[63.972, -16.93], [64.0, -16.95], [64.016, -16.965]]),
  },
  {
    name: 'Fjaðrárgljúfur road',
    type: 'gravel',
    points: ll([[63.73, -18.12], [63.75, -18.15], [63.768, -18.175]]),
  },
  // Route 93 to Seyðisfjörður: a gentle valley road with snowy mountains either side.
  { name: 'Seyðisfjörður road', type: 'paved', profile: 'pass', summit: 5, points: ll([[65.26, -14.4], [65.232, -14.34], [65.208, -14.27], [65.228, -14.205], [65.268, -14.175], [65.288, -14.135], [65.262, -14.105]]) },
  { name: 'Westfjords', type: 'paved', points: ll([[65.25, -20.9], [65.42, -21.6], [65.55, -22.3], [65.73, -23.1], [65.9, -23.3], [66.07, -23.13]]) },
  { name: 'Siglufjörður road', type: 'paved', points: ll([[65.68, -18.09], [65.9, -18.4], [66.15, -18.91]]) },
  { name: 'Þjórsárdalur', type: 'gravel', points: ll([[63.83, -20.4], [64.0, -20.0], [64.21, -19.69]]) },
  { name: 'F208 Landmannalaugar', type: 'gravel', points: ll([[64.0, -20.0], [63.98, -19.5], [63.98, -19.06]]) },
  { name: 'Flúðir road', type: 'paved', points: ll([[64.1, -20.55], [64.16, -20.44], [64.14, -20.31]]) },
  { name: 'Hvammsvík road', type: 'paved', points: ll([[64.38, -21.86], [64.39, -21.65]]) },
  { name: 'Reykjanes tip', type: 'gravel', points: ll([[63.885, -22.43], [63.87, -22.68]]) },
  { name: 'Snæfellsnes south', type: 'paved', points: ll([[64.72, -22.25], [64.8, -22.9], [64.82, -23.35], [64.77, -23.6]]) },
  { name: 'Vatnsnes', type: 'gravel', points: ll([[65.66, -20.28], [65.62, -20.6]]) },
  { name: 'Sólheimajökull road', type: 'gravel', points: ll([[63.5, -19.4], [63.53, -19.37]]) },
  { name: 'Hraunfossar road', type: 'paved', points: ll([[64.6, -21.85], [64.68, -21.2], [64.7, -20.97]]) },
  {
    name: 'Kjölur (F35)',
    type: 'gravel',
    points: ll([[64.318, -20.13], [64.6, -19.92], [64.85, -19.6], [65.2, -19.7], [65.585, -19.72]]),
  },
];

// Shallow river crossings on the highland track. The first sits a little way up Kjölur from
// Gullfoss and the last a little short of Landmannalaugar, so the track has room to come down
// off the high ground to each.
export const FORDS = ll([[64.525, -19.974], [65.02, -19.64], [65.38, -19.72], [63.99, -19.411]]);

// Lakes carved into the terrain (water sits at y = 0).
export const LAKES = [
  { ...toWorld(64.15, -21.12), r: 26 * WS, depth: 3 }, // Þingvallavatn
  { ...toWorld(65.6, -17.0), r: 19 * WS, depth: 2 }, // Mývatn
  { ...toWorld(64.078, -16.23), r: 15 * WS, depth: 4, stretch: 1.6 }, // Jökulsárlón
];

// Stuðlagil: a basalt-column canyon cut into the valley floor.
const STUDLAGIL = toWorld(65.165, -15.36);
// Fjaðrárgljúfur: a winding gorge carved into the land north of its road end.
const FJ = [[63.78, -18.172], [63.815, -18.192], [63.85, -18.168], [63.885, -18.192], [63.92, -18.175]].map(([a, b]) => toWorld(a, b));
export const CANYONS = [
  { a: { x: STUDLAGIL.x - 12 * WS, z: STUDLAGIL.z - 28 * WS }, b: { x: STUDLAGIL.x + 12 * WS, z: STUDLAGIL.z + 28 * WS }, w: 13, depth: 12 },
  ...FJ.slice(0, -1).map((p, i) => ({ a: p, b: FJ[i + 1], w: 15, depth: 22, taperA: i === 0, taperB: i === FJ.length - 2 })),
];

// Craters carved into the land (Kerið).
export const PITS = [];
// Kerið: an oval crater. One shape drives both the carved land and the detailed surface.
export const KERID = { ...toWorld(64.105, -20.88), rx: 62, rz: 44, rot: 0.35, base: null };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixv = (a, b, t) => a + (b - a) * t;
// Edge wobble by angle, so the oval is irregular like the real crater.
export function keridWob(a) { return 1 + 0.06 * Math.sin(a * 3 + 1.3) + 0.035 * Math.sin(a * 7 + 0.4); }
// u: 0 at the centre, about 0.8 at the rim crest, 1.15 where it meets the land.
export function keridU(x, z) {
  const K = KERID, dx = x - K.x, dz = z - K.z, c = Math.cos(K.rot), s = Math.sin(K.rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.hypot(lx / K.rx, lz / K.rz) / keridWob(Math.atan2(lz / K.rz, lx / K.rx));
}
// Height relative to the surrounding land: lake bed, scree apron, steep walls, rim, outer slope.
export function keridProfile(u) {
  if (u < 0.36) return -21 + 2 * sm(0, 0.36, u);
  if (u < 0.47) return mixv(-19, -15.5, sm(0.36, 0.47, u));
  if (u < 0.8) return mixv(-15.5, 2.4, Math.pow((u - 0.47) / 0.33, 1.45));
  if (u < 0.86) return 2.4;
  return mixv(2.4, 0, sm(0.86, 1.15, u));
}

// Mountain passes: here the road climbs over the massif instead of skirting it (Fjarðarheiði to Seyðisfjörður).
// Flat valley floors where towns sit: no mountains inside these circles.
export const FLATS = [{ ...toWorld(64.105, -20.88), r: 75 * WS }, { ...toWorld(65.263, -13.99), r: 70 * WS }, { ...toWorld(65.245, -14.24), r: 52 * WS }];

// cap: the road itself never climbs above this height inside the pass; the mountains beside it do.
export const PASSES = [];

// Bridges on the Ring Road over real river crossings: Þjórsá, Markarfljót, Gígjukvísl on
// Skeiðarársandur, Jökulsá á Fjöllum and Hvítá. A valley is carved under each, with a river.
export const BRIDGES = [[63.86, -20.65], [63.7, -20.22], [63.93, -17.35], [65.5, -15.8], [64.72, -21.63]].map(([a, b]) => toWorld(a, b));

// Jump crests on long, straight stretches (a sign warns you before each one).
export const JUMPS = [[63.539, -18.55], [64.95, -19.65], [65.66, -17.25], [65.57, -19.05]].map(([a, b]) => toWorld(a, b));

// Ice caps. Height is added on top of the land.
export const GLACIERS = [
  { ...toWorld(64.42, -16.8), r: 160 * WS, h: 90 }, // Vatnajökull
  { ...toWorld(64.62, -20.25), r: 58 * WS, h: 60 }, // Langjökull
  { ...toWorld(63.64, -19.1), r: 40 * WS, h: 55 }, // Mýrdalsjökull
  { ...toWorld(64.8, -18.9), r: 40 * WS, h: 48 }, // Hofsjökull
];

// Lava fields (dark, mossy, bumpy).
export const LAVA = [
  { ...toWorld(63.9, -22.2), r: 70 * WS }, // Reykjanes
  { ...toWorld(63.75, -18.2), r: 60 * WS }, // Eldhraun
  { ...toWorld(65.45, -16.6), r: 70 * WS }, // Mývatn lava
];

// Black sand plains inland from the shore (outwash sandur), painted and driven as beach sand.
export const SANDS = [
  { ...toWorld(63.4605, -19.29), r: 40 * WS, top: 11 }, // Sólheimasandur, around the plane wreck
];

// Names used to describe where a sighting happened.
export const PLACES = [
  { name: 'Reykjavík', ...toWorld(64.13, -21.85) },
  { name: 'Selfoss', ...toWorld(63.94, -21.0) },
  { name: 'Hella', ...toWorld(63.83, -20.4) },
  { name: 'Vík', ...toWorld(63.42, -19.0) },
  { name: 'Kirkjubæjarklaustur', ...toWorld(63.78, -18.05) },
  { name: 'Höfn', ...toWorld(64.27, -15.25) },
  { name: 'Djúpivogur', ...toWorld(64.68, -14.35) },
  { name: 'Egilsstaðir', ...toWorld(65.26, -14.4) },
  { name: 'Jökuldalur', ...toWorld(65.25, -15.05) },
  { name: 'Akureyri', ...toWorld(65.68, -18.09) },
  { name: 'Varmahlíð', ...toWorld(65.55, -19.45) },
  { name: 'Blönduós', ...toWorld(65.66, -20.28) },
  { name: 'Borgarnes', ...toWorld(64.54, -21.92) },
  { name: 'Geysir', ...toWorld(64.31, -20.3) },
  { name: 'Hveravellir', ...toWorld(64.85, -19.6) },
  { name: 'Grundarfjörður', ...toWorld(64.925, -23.25) },
  { name: 'Húsavík', ...toWorld(66.045, -17.34) },
  { name: 'Keflavík', ...toWorld(64.0, -22.55) },
  { name: 'Seyðisfjörður', ...toWorld(65.263, -14.01) },
  { name: 'Siglufjörður', ...toWorld(66.15, -18.91) },
  { name: 'Ísafjörður', ...toWorld(66.07, -23.13) },
  { name: 'Flúðir', ...toWorld(64.14, -20.31) },
];

// Where a new trip begins: near Hveragerði on the Ring Road, east of the Reykjavík glow.
export const START = toWorld(63.98, -21.15);
