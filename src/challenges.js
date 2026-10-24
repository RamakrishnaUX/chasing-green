import { mulberry32, hashString } from './world/noise.js';

const WATERFALLS = ['seljalandsfoss', 'skogafoss', 'gullfoss', 'dettifoss'];
const NEAR = 140; // how close a sighting must be to count as "at" a landmark

export const CHALLENGES = [
  { id: 'red', title: 'Find a red aurora', detail: 'Red light only shows when the radio climbs past 7. Storm odds are higher than usual today.', check: (s) => s.type === 'Red aurora' },
  { id: 'lagoon', title: 'See the lights from a glacier lagoon', detail: 'Drive east to Jökulsárlón and wait for a clear spell over the ice.', check: (s) => s.nearId === 'jokulsarlon' && s.nearDist < NEAR },
  { id: 'waterfall', title: 'Photograph the lights over a waterfall', detail: 'Any waterfall counts. Park close, step out, and look up.', check: (s) => WATERFALLS.includes(s.nearId) && s.nearDist < NEAR },
  { id: 'corona', title: 'See a corona overhead', detail: 'On the strongest nights the curtains meet directly above you. Look straight up.', check: (s) => s.type === 'Corona' },
  { id: 'kirkjufell', title: 'Catch the lights over Kirkjufell', detail: 'Head west along Snæfellsnes to Church Mountain.', check: (s) => s.nearId === 'kirkjufell' && s.nearDist < NEAR },
  { id: 'beach', title: 'See the lights from the black sand', detail: 'Reynisfjara, near Vík. Keep the sea stacks in frame.', check: (s) => s.nearId === 'reynisfjara' && s.nearDist < NEAR },
  { id: 'strong', title: 'Log a sighting with the radio at 5 or higher', detail: 'Watch the forecast graph and be under a clear sky when it peaks.', check: (s) => s.kp >= 5 },
  { id: 'rift', title: 'See the lights over Þingvellir', detail: 'Stand between two continents and look up.', check: (s) => s.nearId === 'thingvellir' && s.nearDist < NEAR },
  { id: 'north', title: 'See the lights by Mývatn', detail: 'The north is often clearer than the south coast.', check: (s) => s.nearId === 'myvatn' && s.nearDist < NEAR },
];

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dailyChallenge(d = new Date()) {
  const key = todayKey(d);
  const r = mulberry32(hashString('chasing-green:' + key));
  const c = CHALLENGES[Math.floor(r() * CHALLENGES.length)];
  return { ...c, key };
}
