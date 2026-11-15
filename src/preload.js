// Everything the game downloads is downloaded before Start, so nothing loads in the middle of a
// drive: every model (the cars, the helicopter, the person, every animal), every sound and both
// music tracks. The list is made at build time from public/ (vite.config.js, virtual:asset-list).
//
// Files are kept in the browser's Cache Storage, on disk rather than in memory, so holding them
// costs a phone nothing (iPhone closes a page that holds too much memory and loads it again). A
// later visit, or a reload, reads them straight from there, without the network. The cache is
// named for this build, and older builds' caches are deleted.
//
// The game's own code keeps calling fetch() as before (three.js's loaders, the audio): fetch is
// wrapped so a listed file is answered from the cache, waiting for its download if that is still
// under way rather than starting a second one.
import { files, version } from 'virtual:asset-list';

const BASE = import.meta.env.BASE_URL;
const NAME = `chasing-green-assets-${version}`;
const realFetch = window.fetch.bind(window);
const abs = (u) => new URL(u, location.href).href;
const URLS = files.map((f) => abs(BASE + f));
const listed = new Set(URLS);
// url -> Promise<boolean> (true once it is in the cache, or held in memory when there is no cache)
const ready = new Map();
const memory = new Map(); // url -> ArrayBuffer, only where Cache Storage is unavailable
let cachePromise = null;
const openCache = () => (cachePromise ||= (typeof caches !== 'undefined' && window.isSecureContext
  ? caches.open(NAME).catch(() => null) : Promise.resolve(null)));

const TYPES = { glb: 'model/gltf-binary', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const typeOf = (u) => TYPES[u.split('?')[0].split('.').pop().toLowerCase()] || 'application/octet-stream';

let bytesDone = 0;
const sizes = new Map();
const fileProgress = new Map(); // url -> 0..1 while it downloads
// How far along a listed file is (0..1): 1 once it is in the cache. path: as in public/.
export function progressOf(path) {
  const url = abs(BASE + path);
  return fileProgress.get(url) ?? 0;
}

function get(url, attempt = 0) {
  if (ready.has(url)) return ready.get(url);
  const p = (async () => {
    const cache = await openCache();
    if (cache && await cache.match(url)) { fileProgress.set(url, 1); return true; }
    let res;
    try {
      res = await realFetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
    } catch (e) {
      // A dropped connection on a phone: try again a couple of times before giving up on it (the
      // game then fetches it the ordinary way if it is ever asked for).
      ready.delete(url);
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); return get(url, attempt + 1); }
      throw e;
    }
    // Read in pieces where the browser allows, so the start screen can show how far along a file
    // is (the car being "built" on the turntable while its model downloads).
    let buf;
    const total = +res.headers.get('Content-Length') || 0;
    if (res.body?.getReader && total) {
      const reader = res.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.byteLength;
        fileProgress.set(url, Math.min(0.99, got / total));
      }
      const all = new Uint8Array(got);
      let o = 0; for (const v of parts) { all.set(v, o); o += v.byteLength; }
      buf = all.buffer;
    } else buf = await res.arrayBuffer();
    fileProgress.set(url, 1);
    sizes.set(url, buf.byteLength); bytesDone += buf.byteLength;
    if (cache) {
      try { await cache.put(url, new Response(buf, { headers: { 'Content-Type': typeOf(url), 'Content-Length': String(buf.byteLength) } })); return true; } catch { /* storage full: keep it in memory */ }
    }
    memory.set(url, buf);
    return true;
  })();
  ready.set(url, p);
  return p;
}

// Answer a listed file from the cache (or memory). Returns null if it is not available that way.
async function answer(url) {
  try { await get(url); } catch { return null; }
  const mem = memory.get(url);
  if (mem) return new Response(mem.slice(0), { status: 200, headers: { 'Content-Type': typeOf(url) } });
  const cache = await openCache();
  const hit = cache && await cache.match(url);
  return hit || null;
}

window.fetch = function (input, init) {
  const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (method === 'GET' && raw && !raw.startsWith('blob:') && !raw.startsWith('data:')) {
    const url = abs(raw);
    if (listed.has(url)) return answer(url).then((r) => r || realFetch(input, init));
  }
  return realFetch(input, init);
};

// Download every listed file. onProgress(fraction 0..1). A few at a time, so a phone's connection
// is kept busy without one big file starving the others. Never rejects: a file that will not come
// is left for the game to fetch the ordinary way.
//
// The order matters on a slow phone: the vehicle you last chose comes first, on its own for a
// moment so it has the whole connection (it is what the start screen shows), then the other
// vehicles, then everything else; the music comes last and does not hold up Start (it streams
// from the cache once it is in, and plays from the network until then).
const MUSIC = (u) => /\/music\//.test(u);
function chosenVehicle() {
  try { const s = JSON.parse(localStorage.getItem('chasing-green:v1') || '{}').settings || {}; return s.vehicle === 'heli' ? 'heli' : s.vehicle || 'jeep'; } catch { return 'jeep'; }
}
const rank = (u, first) => (u.endsWith(first) ? 0 : /\/models\/(car_|heli|person|helmet)/.test(u) ? 1 : MUSIC(u) ? 3 : 2);
export function preloadAll(onProgress) {
  const first = chosenVehicle() === 'heli' ? '/models/heli.glb' : `/models/car_${chosenVehicle()}.glb`;
  const queue = URLS.slice().sort((a, b) => rank(a, first) - rank(b, first));
  const gate = queue.filter((u) => !MUSIC(u));
  let done = 0;
  const total = gate.length;
  let lead = null;
  const worker = async (i) => {
    // The chosen vehicle goes first, alone, for up to 6 s; then all four lanes share the rest.
    if (i > 0) await Promise.race([lead, new Promise((r) => setTimeout(r, 6000))]).catch(() => {});
    while (queue.length) {
      const url = queue.shift();
      const p = get(url);
      if (i === 0 && !lead) lead = p;
      try { await p; } catch (e) { console.warn('preload', e?.message || e); }
      if (!MUSIC(url)) { done++; onProgress?.(done / total); if (done >= total) gateDone.resolve(); }
    }
  };
  const gateDone = {}; gateDone.p = new Promise((r) => { gateDone.resolve = r; });
  // lead is set synchronously by the first worker before the others look at it.
  Promise.all(Array.from({ length: 4 }, (_, i) => worker(i))).then(() => gateDone.resolve());
  return gateDone.p;
}

// A URL for a listed file that plays without the network (the music, streamed by an <audio>
// element, which does not go through fetch).
const blobs = new Map();
export async function offlineURL(u) {
  const url = abs(u);
  if (!listed.has(url)) return u;
  if (blobs.has(url)) return blobs.get(url);
  // Music still downloading (it comes last and does not hold up Start): stream it from the network.
  if (MUSIC(url) && fileProgress.get(url) !== 1) {
    const cache = await openCache();
    if (!memory.has(url) && !(cache && await cache.match(url))) return u;
  }
  const r = await answer(url);
  if (!r) return u;
  const b = URL.createObjectURL(await r.blob());
  blobs.set(url, b);
  return b;
}

// Delete the caches older builds left behind.
if (typeof caches !== 'undefined') caches.keys().then((keys) => keys.filter((k) => k.startsWith('chasing-green-assets-') && k !== NAME).forEach((k) => caches.delete(k))).catch(() => {});

// Start downloading straight away, while the page and the island get going.
export const preloadProgress = { value: 0 };
export const allAssets = preloadAll((f) => { preloadProgress.value = f; });
