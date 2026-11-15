// The Together page and the room behind it: start a room, send the link, see who is here, leave.
// main.js gives it the game's side: what to send each tenth of a second, the clock, the month.
import { Room, roomLink, newCode, cleanName, MAX_PLAYERS } from '../net/room.js';
import { Remotes } from '../net/remotes.js';

const SEND_EVERY = 0.1; // seconds: ten states a second
const CLOCK_EVERY = 2; // the lead puts the time in one state in twenty
const $ = (id) => document.getElementById(id);

export const DOING = {
  chase: 'Driving', lookup: 'Watching the sky', walk: 'On foot', fly: 'Flying', sky: 'Skydiving',
};

export class Together {
  // game: { scene, hud, track, haptics, settings, save(), seed, month(), clock() -> ck, setClock(ck, snap),
  //         onEvent(peer, ev), describe(state) -> text, myPos() -> {x, z} }
  constructor(game) {
    this.g = game;
    this.room = null;
    this.remotes = new Remotes(game.scene);
    this.sendT = 0; this.clockT = 0;
    this.listT = 0;
    this.bindUI();
    const link = roomLink();
    if (link) this.join(link, true);
  }

  get on() { return !!this.room; }
  get count() { return this.room ? this.room.count : 1; }

  // ---------- Joining and leaving ----------
  start() {
    if (this.room) return;
    const code = newCode();
    this.join({ code, seed: this.g.seed, month: this.g.month(), net: new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'p2p' }, false);
    this.g.track('room_create', {});
  }
  join(link, fromLink) {
    const g = this.g;
    this.room = new Room({
      ...link, name: g.settings.name,
      hooks: {
        onPeer: (p) => {
          this.remotes.add(p);
          g.hud.toast(`${p.name} joined.`, { seconds: 3, priority: 2 });
          g.haptics?.play?.('success');
          this.render();
        },
        onRename: (p) => { this.remotes.list.get(p.id)?.rename(); this.render(); },
        onLeave: (p) => { this.remotes.remove(p.id); this.onPeerLeft?.(p.id); g.hud.toast(`${p.name} left.`, { seconds: 3, priority: 2 }); this.render(); },
        onState: (p, s) => this.remotes.state(p, s),
        onEvent: (p, ev) => g.onEvent(p, ev),
        onClock: (ck, snap) => g.setClock(ck, snap),
        onFull: () => { g.hud.toast(`That room is full (${MAX_PLAYERS} players).`, { seconds: 4, priority: 2 }); this.leave(true); },
      },
    });
    // The link stays in the address, so a reload comes back into the room.
    try { history.replaceState(null, '', this.room.link); } catch { /* ignore */ }
    this.fromLink = fromLink;
    this.render();
    this.room.connect(() => g.clock()).then((ok) => {
      if (!this.room) return;
      if (!ok) { g.hud.toast('Could not reach the room. Check your connection and try again.', { seconds: 4, priority: 2 }); this.leave(true); return; }
      if (fromLink) g.track('room_join', {});
      this.render();
    });
  }
  leave(quiet = false) {
    if (!this.room) return;
    this.room.leave();
    this.room = null;
    this.remotes.clear();
    try { const u = new URL(location.href); for (const k of ['room', 'seed', 'm', 'net']) u.searchParams.delete(k); history.replaceState(null, '', u.toString()); } catch { /* ignore */ }
    if (!quiet) this.g.hud.toast('You left the room.', { seconds: 2.5, priority: 2 });
    this.render();
  }
  // Said once the trip starts, so it is not lost behind the start screen.
  greet() {
    if (!this.room) return;
    const n = this.count - 1;
    this.g.hud.toast(n ? `Exploring together with ${this.names()}.` : 'You are in the room. Friends who open the link will appear here.', { seconds: 4.5, priority: 2 });
  }
  names() {
    const ns = [...this.room.peers.values()].filter((p) => p.hello).map((p) => p.name);
    return ns.length <= 2 ? ns.join(' and ') : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`;
  }

  // ---------- Each frame ----------
  // pack() builds this player's state; called only when one is due.
  tick(dt, env, pack) {
    if (!this.room) return;
    this.sendT -= dt; this.clockT -= dt;
    if (this.sendT <= 0 && env.started) {
      this.sendT += SEND_EVERY; if (this.sendT < 0) this.sendT = SEND_EVERY;
      const s = pack();
      if (this.room.isLead && this.clockT <= 0) { this.clockT = CLOCK_EVERY; s.ck = this.g.clock(); }
      this.room.sendState(s);
    }
    this.remotes.update(dt, env);
    if (this.page && !this.page.hidden && (this.listT -= dt) <= 0) { this.listT = 1; this.renderPeople(); }
  }
  event(ev) { this.room?.sendEvent(ev); }

  // ---------- The page ----------
  bindUI() {
    this.page = $('together');
    if (!this.page) return;
    const name = $('tg-name');
    name.value = this.g.settings.name || '';
    name.addEventListener('change', () => {
      const v = cleanName(name.value);
      name.value = v === 'Traveller' && !name.value.trim() ? '' : v;
      this.g.settings.name = name.value || undefined; this.g.save();
      this.room?.rename(name.value);
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    $('tg-start').addEventListener('click', () => this.start());
    $('tg-leave').addEventListener('click', () => this.leave());
    $('tg-copy').addEventListener('click', async () => {
      if (!this.room) return;
      try { await navigator.clipboard.writeText(this.room.link); this.flash('Invite link copied. Send it to a friend.'); }
      catch { this.flash('Could not copy. Select the link above and copy it.'); }
    });
    const share = $('tg-share');
    share.hidden = !navigator.share;
    share.addEventListener('click', () => {
      if (!this.room) return;
      navigator.share({ title: 'Chasing Green', text: 'Come and chase the northern lights with me.', url: this.room.link }).catch(() => {});
    });
    this.render();
  }
  flash(text) {
    const s = $('tg-status'); if (!s) return;
    s.textContent = text; clearTimeout(this.flashT);
    this.flashT = setTimeout(() => this.render(), 3500);
  }
  render() {
    if (!this.page) return;
    const r = this.room, on = !!r;
    this.page.classList.toggle('is-in', on);
    $('tg-start').hidden = on;
    $('tg-leave').hidden = $('tg-copy').hidden = !on;
    $('tg-share').hidden = !on || !navigator.share;
    $('tg-room').hidden = !on;
    if (on) $('tg-link').textContent = r.link;
    const tab = document.querySelector('.sheet-tabs [data-page="together"] .tab-count');
    if (tab) { tab.textContent = on && r.count > 1 ? String(r.count) : ''; tab.hidden = !(on && r.count > 1); }
    $('tg-status').textContent = !on ? '' : r.status === 'connecting' ? 'Opening the room…' : r.count > 1 ? `${r.count} of ${MAX_PLAYERS} here` : 'Waiting for friends. Send them the link.';
    this.renderPeople();
    this.onRender?.();
  }
  renderPeople() {
    const ul = $('tg-people');
    if (!ul || !this.room) return;
    const me = this.g.myPos(), rows = [`<li><i style="--c:#2f8fff"></i><b>${esc(this.room.name)}</b><span>You</span></li>`];
    for (const p of this.room.peers.values()) {
      if (!p.hello) continue;
      const r = this.remotes.list.get(p.id), s = p.state;
      const d = r && s ? Math.hypot(r.pos.x - me.x, r.pos.z - me.z) : null;
      const what = s ? this.g.describe(s) : 'Starting';
      const far = d == null ? '' : d >= 1000 ? ` · ${(d / 1000).toFixed(1)} km away` : d > 30 ? ` · ${Math.round(d / 10) * 10} m away` : ' · beside you';
      rows.push(`<li><i style="--c:${r?.color || '#fff'}"></i><b>${esc(p.name)}</b><span>${esc(what)}${far}</span></li>`);
    }
    const html = rows.join('');
    if (ul.innerHTML !== html) ul.innerHTML = html;
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
