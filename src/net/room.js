// Exploring together: a room of up to eight players on the same island, under the same sky.
//
// There is no game server. Players find each other through Trystero (public Nostr relays carry
// only the encrypted connection offers) and then talk directly, browser to browser, over WebRTC
// data channels. Everything about the room travels in its link:
//   ?room=<code>&seed=<trip seed>&m=<month>
// The code is the room's secret (it also keys the encryption of the offers); the seed gives
// everyone the same forecast, clouds and wind; the month the same sun and season. Once connected,
// the player who has been in the room longest (the lead) keeps everyone's clock in step.
//
// Each player simulates only themselves and sends where they are about ten times a second
// (remotes.js draws the others). Messages:
//   hello  {v, name, person, age, clock, seed, lb}   to each player who joins, and to all on a name change
//   lb     {ready, playing, pct}            where this player is before the trip: loading, ready in
//                                           the lobby, or out on the island (every second until then)
//   s      {m, r, k, c?, h?, p?, ck?}       state, ten times a second (see Room.state below)
//   ev     {type: 'month' | 'speed' | 'go' | ..., ...}   a shared setting changed, the trip begun
//
// A friend can also join with just the code (six letters and numbers, read out or typed). Without
// the link they do not know the seed, so everyone takes the seed of the longest in the room (the
// lead) from their hello, and the month comes with the lead's clock.
//
// ?net=local swaps the network for a BroadcastChannel, so two tabs of the same browser can play
// together offline (used by the tests).

import { personKey, personId } from '../vehicle/person.js';

const APP_ID = 'chasing-green-together-v1';
export const MAX_PLAYERS = 8;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i: read aloud without mistakes

// Six characters: short enough to read out or type on a phone (31^6, near a billion codes).
export function newCode(n = 6) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return [...a].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
// K7F-Q2X: in capitals, split in two, as it is shown and read out.
export function formatCode(code) {
  const c = String(code || '').toUpperCase();
  return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c.replace(/(.{4})(?=.)/g, '$1-');
}
// What someone typed or pasted into the code box: a code (any case, with or without the dash or
// spaces) or a whole invite link. null if it cannot be a room.
export function parseCode(text) {
  const t = String(text || '').trim();
  if (/^https?:\/\/|[?&]room=/.test(t)) { const l = roomLink(/^https?:/.test(t) ? t : `${location.origin}/${t.replace(/^\/*/, '')}`); return l ? { ...l, fromLink: true } : null; }
  const code = t.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (code.length < 6 || code.length > 16) return null;
  return { code };
}

// The room in this page's address, if any.
export function roomLink(href = location.href) {
  try {
    const u = new URL(href), code = (u.searchParams.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (code.length < 6) return null;
    const seed = Number(u.searchParams.get('seed')), m = Number(u.searchParams.get('m'));
    return {
      code,
      seed: Number.isFinite(seed) && seed > 0 ? seed >>> 0 : hashSeed(code),
      month: Number.isInteger(m) && m >= 0 && m < 12 ? m : null,
      net: u.searchParams.get('net') === 'local' ? 'local' : 'p2p',
    };
  } catch { return null; }
}
export function linkFor({ code, seed, month, net }) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('room', code); u.searchParams.set('seed', String(seed >>> 0)); u.searchParams.set('m', String(month));
  if (net === 'local') u.searchParams.set('net', 'local');
  return u.toString();
}
function hashSeed(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) || 1; }

// The Nostr relays that carry the offers. Trystero's own list picks five by app id, and for ours
// those five were dead or refused its (ephemeral) messages, so two players with the same link
// never met. These were each checked to introduce two players in a few seconds (Nov 2026); any
// one relay both players reach is enough, so all of them are used at once.
const RELAYS = [
  'wss://relay.nostr.net', 'wss://nostr-pub.wellorder.net',
  'wss://nostr.oxtr.dev', 'wss://nos.lol', 'wss://relay.damus.io',
];
// Two STUN servers, so a player behind a home router still finds their public address if one is down.
const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

// ---------- Transports: the same three calls whatever carries the messages ----------
async function p2pTransport(code) {
  const { joinRoom, selfId } = await import('trystero');
  const room = joinRoom({ appId: APP_ID, password: code, relayConfig: { urls: RELAYS }, rtcConfig: { iceServers: ICE } }, `cg-${hashSeed(code).toString(36)}`);
  const actions = {};
  const action = (name) => (actions[name] ||= room.makeAction(name));
  return {
    selfId,
    send: (name, data, to) => action(name).send(data, to ? { target: to } : undefined),
    on: (name, fn) => { action(name).onMessage = (data, { peerId }) => fn(data, peerId); },
    onJoin: (fn) => { room.onPeerJoin = fn; },
    onLeave: (fn) => { room.onPeerLeave = fn; },
    leave: () => room.leave(),
  };
}
function localTransport(code) {
  const selfId = Math.random().toString(36).slice(2, 10);
  const bc = new BroadcastChannel(`cg-room-${code}`);
  const handlers = {}, seen = new Set();
  let join = () => {}, leave = () => {};
  const post = (msg) => bc.postMessage({ ...msg, from: selfId });
  bc.onmessage = ({ data }) => {
    if (data.from === selfId || (data.to && data.to !== selfId)) return;
    if (data.kind === 'bye') { if (seen.delete(data.from)) leave(data.from); return; }
    if (!seen.has(data.from)) { seen.add(data.from); join(data.from); if (data.kind !== 'here') post({ kind: 'here', to: data.from }); }
    if (data.kind === 'msg') handlers[data.name]?.(data.data, data.from);
  };
  const ping = setInterval(() => post({ kind: 'here' }), 3000);
  setTimeout(() => post({ kind: 'here' }), 0);
  return {
    selfId,
    send: (name, data, to) => post({ kind: 'msg', name, data, to }),
    on: (name, fn) => { handlers[name] = fn; },
    onJoin: (fn) => { join = fn; },
    onLeave: (fn) => { leave = fn; },
    leave: () => { clearInterval(ping); post({ kind: 'bye' }); bc.close(); },
  };
}

// ---------- The room ----------
export class Room {
  // hooks: onPeer(peer), onLeave(peer), onState(peer, state), onEvent(peer, ev), onClock(clock), onFull(),
  //        onLobby(peer), onSeed(seed)
  constructor({ code, seed, month, net = 'p2p', name, hooks }) {
    this.code = code; this.seed = seed >>> 0; this.month = month; this.net = net;
    this.lb = { ready: false, playing: false, pct: 0 }; // this player before the trip (see 'lb')
    this.name = name || 'Traveller';
    this.hooks = hooks;
    this.since = Date.now();
    this.peers = new Map(); // id -> { id, name, since, state, last }
    this.status = 'connecting';
    this.t = null;
  }
  get link() { return linkFor(this); }
  get count() { return 1 + [...this.peers.values()].filter((p) => p.hello).length; }

  async connect(getClock) {
    this.getClock = getClock;
    try { this.t = this.net === 'local' ? localTransport(this.code) : await p2pTransport(this.code); }
    catch (e) { console.warn('Room did not connect', e); this.status = 'failed'; return false; }
    if (this.left) { this.t.leave(); return false; }
    const t = this.t;
    this.selfId = t.selfId;
    this.status = 'open';
    t.onJoin((id) => {
      if (!this.peers.has(id)) this.peers.set(id, { id, name: '…', since: Infinity, state: null, last: performance.now(), hello: false });
      t.send('hello', this.hello(), id);
    });
    t.onLeave((id) => {
      const p = this.peers.get(id);
      if (!p) return;
      this.peers.delete(id);
      if (p.hello) this.hooks.onLeave?.(p);
    });
    t.on('hello', (d, id) => {
      if (!d || d.v !== 1) return;
      let p = this.peers.get(id);
      if (!p) { p = { id, state: null, hello: false }; this.peers.set(id, p); }
      const first = !p.hello;
      // A room holds eight: a ninth player is told, and nobody draws them.
      const since = Date.now() - Math.max(0, Number(d.age) || 0);
      if (first && this.count >= MAX_PLAYERS) { if (since > this.since) t.send('full', {}, id); return; }
      p.name = cleanName(d.name); p.person = personKey(d.person); p.since = since; p.hello = true; p.last = performance.now();
      // (A player on an older page says nothing about the lobby: they are out on the island.)
      p.lb = lobbyOf(d.lb) || p.lb || { ready: true, playing: true, pct: 1 };
      // Everyone shares the lead's sky: someone who came in with only the code takes it now.
      const seed = Number(d.seed) >>> 0;
      if (seed && seed !== this.seed && this.lead() === id) { this.seed = seed; this.hooks.onSeed?.(seed); }
      if (first) this.hooks.onPeer?.(p);
      else this.hooks.onRename?.(p);
      // The one who has been here longest keeps the time; take it from them the moment they say hello.
      if (d.clock && this.lead() === id) this.hooks.onClock?.(d.clock, true);
    });
    t.on('full', () => { this.hooks.onFull?.(); this.leave(); });
    t.on('lb', (d, id) => {
      const p = this.peers.get(id), lb = lobbyOf(d);
      if (!p?.hello || !lb) return;
      p.last = performance.now();
      const changed = !p.lb || p.lb.ready !== lb.ready || p.lb.playing !== lb.playing || Math.abs((p.lb.pct || 0) - lb.pct) > 0.004;
      p.lb = lb;
      if (changed) this.hooks.onLobby?.(p);
    });
    // Until the trip starts nothing else goes out, so a word every second keeps everyone counted
    // as here (lead() drops anyone silent for 2.5 s) and their loading bars moving.
    this.beat = setInterval(() => { if (!this.lb.playing && this.peers.size) t.send('lb', this.lb); }, 1000);
    t.on('s', (d, id) => {
      const p = this.peers.get(id);
      if (!p?.hello || !d) return;
      p.last = performance.now();
      p.state = d;
      this.hooks.onState?.(p, d);
      if (d.ck && (this.lead() === id || this.away)) this.hooks.onClock?.(d.ck, !!this.away);
    });
    t.on('ev', (d, id) => { const p = this.peers.get(id); if (p?.hello && d?.type) this.hooks.onEvent?.(p, d); });
    return true;
  }
  // How long we have been in, not when we came: two computers' clocks can disagree by minutes.
  hello() { return { v: 1, name: this.name, person: personId(), age: Date.now() - this.since, clock: this.getClock?.(), seed: this.seed, lb: this.lb }; }
  // Loading (pct), ready in the lobby, or out on the island: told to the others when it changes.
  setLobby(patch) {
    const lb = { ...this.lb, ...patch };
    const changed = lb.ready !== this.lb.ready || lb.playing !== this.lb.playing;
    this.lb = lb;
    if (changed && this.t && this.peers.size) this.t.send('lb', lb);
  }
  // The longest in the room keeps the time (ties go to the lower id), among those playing now: a
  // page in the background stops (its clock with it), so it hands the time on, and on coming back
  // (away, for a moment) takes the time from the others before it keeps it again.
  lead() {
    const now = performance.now();
    let best = this.away ? null : this.selfId, since = this.away ? Infinity : this.since;
    for (const p of this.peers.values()) {
      if (!p.hello || now - p.last > 2500) continue;
      if (p.since < since || (p.since === since && (best === null || p.id < best))) { best = p.id; since = p.since; }
    }
    return best ?? this.selfId;
  }
  get isLead() { return this.lead() === this.selfId; }
  rename(name) { this.name = cleanName(name); if (this.t) this.t.send('hello', this.hello()); }
  sendState(state) { if (this.t && this.peers.size) this.t.send('s', state); }
  sendEvent(ev) { if (this.t && this.peers.size) this.t.send('ev', ev); }
  leave() {
    this.left = true;
    clearInterval(this.beat);
    try { this.t?.leave(); } catch { /* already gone */ }
    this.t = null; this.peers.clear(); this.status = 'closed';
  }
}
function lobbyOf(d) {
  if (!d || typeof d !== 'object') return null;
  return { ready: !!d.ready, playing: !!d.playing, pct: Math.max(0, Math.min(1, Number(d.pct) || 0)) };
}
export function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Traveller'; }
