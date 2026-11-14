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

function get(url, attempt = 0) {
  if (ready.has(url)) return ready.get(url);
  const p = (async () => {
    const cache = await openCache();
    if (cache && await cache.match(url)) return true;
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
    const buf = await res.arrayBuffer();
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
export function preloadAll(onProgress) {
  let done = 0;
  const total = URLS.length;
  const queue = URLS.slice();
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try { await get(url); } catch (e) { console.warn('preload', e?.message || e); }
      done++;
      onProgress?.(done / total);
    }
  };
  return Promise.all(Array.from({ length: 4 }, worker));
}

// A URL for a listed file that plays without the network (the music, streamed by an <audio>
// element, which does not go through fetch).
const blobs = new Map();
export async function offlineURL(u) {
  const url = abs(u);
  if (!listed.has(url)) return u;
  if (blobs.has(url)) return blobs.get(url);
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
