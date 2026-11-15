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
//   hello  {v, name, person, age, clock}   to each player who joins, and to all on a name change
//   s      {m, r, k, c?, h?, p?, ck?}       state, ten times a second (see Room.state below)
//   ev     {type: 'month' | 'speed', ...}   a shared setting changed
//
// ?net=local swaps the network for a BroadcastChannel, so two tabs of the same browser can play
// together offline (used by the tests).

import { PEOPLE, personId } from '../vehicle/person.js';

const APP_ID = 'chasing-green-together-v1';
export const MAX_PLAYERS = 8;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i: read aloud without mistakes

export function newCode() {
  const a = crypto.getRandomValues(new Uint8Array(10));
  return [...a].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
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

// ---------- Transports: the same three calls whatever carries the messages ----------
async function p2pTransport(code) {
  const { joinRoom, selfId } = await import('trystero');
  const room = joinRoom({ appId: APP_ID, password: code }, `cg-${hashSeed(code).toString(36)}`);
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
  // hooks: onPeer(peer), onLeave(peer), onState(peer, state), onEvent(peer, ev), onClock(clock), onFull()
  constructor({ code, seed, month, net = 'p2p', name, hooks }) {
    this.code = code; this.seed = seed >>> 0; this.month = month; this.net = net;
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
      p.name = cleanName(d.name); p.person = PEOPLE[d.person] ? d.person : 'david'; p.since = since; p.hello = true; p.last = performance.now();
      if (first) this.hooks.onPeer?.(p);
      else this.hooks.onRename?.(p);
      // The one who has been here longest keeps the time; take it from them the moment they say hello.
      if (d.clock && this.lead() === id) this.hooks.onClock?.(d.clock, true);
    });
    t.on('full', () => { this.hooks.onFull?.(); this.leave(); });
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
  hello() { return { v: 1, name: this.name, person: personId(), age: Date.now() - this.since, clock: this.getClock?.() }; }
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
    try { this.t?.leave(); } catch { /* already gone */ }
    this.t = null; this.peers.clear(); this.status = 'closed';
  }
}
export function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Traveller'; }
