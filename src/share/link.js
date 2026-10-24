import { AURORA_TYPES } from '../aurora/forecast.js';

const TYPE_LIST = Object.values(AURORA_TYPES);

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeSighting(s) {
  const arr = [1, s.n, s.place, Math.round(s.hour * 10) / 10, Math.round(s.kp * 10) / 10, TYPE_LIST.indexOf(s.type), s.season === 'Summer' ? 1 : 0, Math.round(s.x), Math.round(s.z), s.clock, s.date];
  return b64urlEncode(JSON.stringify(arr));
}

export function decodeSighting(code) {
  try {
    const a = JSON.parse(b64urlDecode(code));
    if (!Array.isArray(a) || a[0] !== 1) return null;
    return {
      n: a[1] | 0, place: String(a[2]).slice(0, 60), hour: +a[3], kp: Math.min(9, Math.max(0, +a[4])),
      type: TYPE_LIST[a[5]] || TYPE_LIST[1], season: a[6] ? 'Summer' : 'Winter', x: +a[7], z: +a[8],
      clock: String(a[9]).slice(0, 5), date: a[10],
    };
  } catch { return null; }
}

// Supports ?s=CODE (normal hosting) and #s.CODE (hosts that only pass the hash through).
export function readSharedSighting() {
  const q = new URLSearchParams(location.search).get('s');
  if (q) return decodeSighting(q);
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('s.')) return decodeSighting(h.slice(2));
  return null;
}

// The single-file build runs inside a hosted viewer that only passes #tokens through to the page.
const HASH_LINKS = import.meta.env.MODE === 'single';

export function linkFor(s) {
  const code = encodeSighting(s);
  if (HASH_LINKS) {
    const ref = document.referrer && document.referrer.startsWith('https://claude.ai') ? document.referrer : location.href;
    return `${ref.split('#')[0]}#s.${code}`;
  }
  const base = location.href.split('#')[0].split('?')[0];
  return `${base}?s=${code}`;
}
