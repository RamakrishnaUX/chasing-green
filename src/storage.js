// Everything persists in localStorage. Thumbnails live under their own keys so the main record stays small.

const KEY = 'chasing-green:v1';
const THUMB = (n) => `chasing-green:thumb:${n}`;
const MAX_THUMBS = 40;

const fresh = () => ({
  sightings: [],
  stamps: {}, // landmark id -> ISO date first visited
  challenges: {}, // date key -> { id, done: ISO date }
  settings: { quality: null, season: 'Winter', speed: 1, touch: 'auto', muted: false },
  trips: 0,
});

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
function safeDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

export const store = {
  data: fresh(),
  load() {
    const raw = safeGet(KEY);
    if (raw) {
      try { this.data = { ...fresh(), ...JSON.parse(raw) }; this.data.settings = { ...fresh().settings, ...this.data.settings }; }
      catch { this.data = fresh(); }
    }
    return this.data;
  },
  save() { safeSet(KEY, JSON.stringify(this.data)); },

  addSighting(s, thumbDataUrl) {
    this.data.sightings.push(s);
    if (thumbDataUrl) {
      if (!safeSet(THUMB(s.n), thumbDataUrl)) {
        // Storage full: drop the oldest thumbnails and try again.
        this.pruneThumbs(10);
        safeSet(THUMB(s.n), thumbDataUrl);
      }
    }
    this.pruneThumbs(MAX_THUMBS);
    this.save();
  },
  thumb(n) { return safeGet(THUMB(n)); },
  pruneThumbs(keep) {
    const ns = this.data.sightings.map((s) => s.n);
    const drop = ns.slice(0, Math.max(0, ns.length - keep));
    drop.forEach((n) => safeDel(THUMB(n)));
  },
  nextSightingNumber() { return (this.data.sightings.at(-1)?.n || 0) + 1; },

  stamp(id) {
    if (this.data.stamps[id]) return false;
    this.data.stamps[id] = new Date().toISOString();
    this.save();
    return true;
  },
  clear() {
    this.data.sightings.forEach((s) => safeDel(THUMB(s.n)));
    const settings = this.data.settings;
    this.data = fresh();
    this.data.settings = settings;
    this.save();
  },
};
