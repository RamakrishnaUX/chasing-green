// The start screen's choice: play solo, or play with friends. Multiplayer opens a lobby beside
// the Start button: create a room (and read its code out or send the link) or join one with a
// friend's code. Nobody is sent out alone: the trip starts only when the host presses Start
// together, which needs at least two people in the room with their islands loaded. Then every
// screen counts 3, 2, 1 at once and everyone sets off side by side. Someone who arrives after the
// others have set off gets Join them, and comes out next to the host.
//
// Message (room 'ev'): {type: 'go', id, start: {x, z, h}, lineup: [ids]}   the host started the trip
import { formatCode, MAX_PLAYERS } from '../net/room.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BEAT = 1000; // ms per beat of the 3, 2, 1
const LOOK = 12000; // ms to look for a room joined by code before saying nobody is there

export class Lobby {
  // game: { together, settings, save(), loaded(), started(), begin(), place(start, slot), pos(),
  //         soloLabel(), startBtn, setLabel(text), haptics, track }
  constructor(game) {
    this.g = game;
    this.mode = game.together.on || game.settings.playMode === 'multi' ? 'multi' : 'solo';
    this.joining = false; // the code box is open
    this.counting = null;
    this.bind();
    // Names, loading bars and "looking for the room" move on their own: redraw every second.
    this.timer = setInterval(() => { if (!this.g.started() && this.multi) this.render(); }, 1000);
    this.render();
  }
  get multi() { return this.mode === 'multi'; }
  get t() { return this.g.together; }

  // ---------- Choosing ----------
  setMode(m) {
    if (this.counting || m === this.mode) return;
    this.mode = m;
    this.g.settings.playMode = m; this.g.save();
    this.g.haptics?.play?.('select');
    // Back to solo leaves the room: a trip alone should not carry friends along.
    if (m === 'solo' && this.t.on) this.t.leave(true);
    this.err('');
    this.render();
    if (m === 'multi' && !this.t.on) requestAnimationFrame(() => (this.joining ? $('lb-code') : $('lb-create'))?.focus({ preventScroll: true }));
    this.g.track('play_mode', { mode: m });
  }
  create() {
    if (this.t.on) return;
    this.t.start();
    this.joining = false;
    this.g.haptics?.play?.('success');
    this.render();
  }
  join() {
    const box = $('lb-code'), why = this.t.joinCode(box.value);
    if (why) { this.err(why); this.g.haptics?.play?.('warning'); box.focus(); return; }
    this.joining = false; box.value = '';
    this.err('');
    this.render();
  }
  err(text) { const e = $('lb-err'); if (e) { e.textContent = text; e.hidden = !text; } }

  // ---------- The big button (main.js asks before it starts a solo trip) ----------
  // In multiplayer the Start button is the lobby's: true means it was handled here.
  press() {
    if (!this.multi) return false;
    const s = this.state();
    if (s.action === 'host') this.go();
    else if (s.action === 'late') this.late();
    return true;
  }
  // What the room is waiting for, and what the big button does about it.
  state() {
    const r = this.t.room, g = this.g;
    if (!r) return { label: 'Create or join a room', action: null };
    if (this.counting) return { label: 'Starting…', action: null };
    if (!g.loaded()) return { label: 'Loading the island', action: null };
    const ps = this.t.players(), others = ps.filter((p) => !p.me);
    const out = others.filter((p) => p.lb?.playing);
    if (out.length) return { label: 'Join them', action: 'late' };
    const host = ps.find((p) => p.host);
    if (!host?.me) return { label: `Waiting for ${host?.name || 'the host'}`, action: null };
    if (!others.length) return { label: 'Waiting for friends', action: null };
    const loading = others.filter((p) => !p.lb?.ready);
    if (loading.length) return { label: loading.length === 1 ? `${loading[0].name} is loading` : `${loading.length} still loading`, action: null };
    return { label: 'Start together', action: 'host' };
  }
  syncStart() {
    const b = this.g.startBtn;
    if (!this.g.loaded() || this.g.started()) return;
    const s = this.multi ? this.state() : { label: this.g.soloLabel(), action: 'solo' };
    this.g.setLabel(s.label);
    b.disabled = !s.action;
    b.classList.toggle('is-waiting', !s.action);
  }

  // ---------- Setting off ----------
  go() {
    const r = this.t.room;
    if (!r || this.counting) return;
    const p = this.g.pos();
    const lineup = [r.selfId, ...this.t.players().filter((q) => !q.me && q.lb?.ready && !q.lb?.playing).map((q) => q.id)].sort();
    const ev = { type: 'go', id: Math.random().toString(36).slice(2, 10), start: { x: +p.x.toFixed(2), z: +p.z.toFixed(2), h: +p.heading.toFixed(3) }, lineup };
    r.sendEvent(ev);
    this.count(ev);
    this.g.track('room_go', { players: lineup.length });
  }
  onEvent(peer, ev) {
    if (ev.type !== 'go' || this.g.started() || this.counting || !this.t.room) return;
    if (!Array.isArray(ev.lineup) || !ev.lineup.includes(this.t.room.selfId) || !ev.start) return;
    // Still loading when the host pressed it: wait here, and Join them once the island is in.
    if (!this.g.loaded()) return;
    this.count(ev);
  }
  // 3, 2, 1 on every screen, then off together, each in their own slot behind the start.
  count(ev) {
    const slot = Math.max(0, ev.lineup.indexOf(this.t.room.selfId));
    this.counting = ev;
    this.render();
    const el = $('round-count');
    el.classList.add('is-top');
    let n = 3;
    const beat = () => {
      if (!this.counting) return;
      // Left the room mid-count: stay on the start screen.
      if (!this.t.room) { this.counting = null; el.hidden = true; el.classList.remove('is-top'); this.render(); return; }
      el.textContent = n > 0 ? String(n) : 'Go'; el.hidden = false;
      el.classList.remove('is-on'); void el.offsetWidth; el.classList.add('is-on');
      this.g.haptics?.play?.(n > 0 ? 'select' : 'heavy');
      if (n > 0) { n--; setTimeout(beat, BEAT); return; }
      this.counting = null;
      this.g.place(ev.start, slot);
      this.g.begin();
      setTimeout(() => { el.hidden = true; el.classList.remove('is-top'); }, 900);
    };
    beat();
  }
  // The others are already out: come out beside the host (or whoever has been out longest).
  late() {
    const ps = this.t.players().filter((p) => !p.me && p.lb?.playing);
    const lead = ps.find((p) => p.host) || ps[0];
    const at = lead && this.t.remotes.list.get(lead.id);
    // (Only once their first state has come in: before that the copy of them stands at 0, 0.)
    if (at && this.t.room.peers.get(lead.id)?.state && Number.isFinite(at.pos.x)) this.g.place({ x: at.pos.x, z: at.pos.z, h: at.heading || 0 }, 2);
    this.g.begin();
  }

  // ---------- The card ----------
  bind() {
    for (const b of document.querySelectorAll('#gx-mode button')) b.addEventListener('click', () => this.setMode(b.dataset.mode));
    $('lb-create').addEventListener('click', () => this.create());
    $('lb-show-join').addEventListener('click', () => { this.joining = true; this.err(''); this.render(); requestAnimationFrame(() => $('lb-code').focus()); });
    $('lb-back').addEventListener('click', () => { this.joining = false; this.err(''); this.render(); });
    $('lb-form').addEventListener('submit', (e) => { e.preventDefault(); this.join(); });
    $('lb-code').addEventListener('input', () => this.err(''));
    $('lb-leave').addEventListener('click', () => { if (this.counting) return; this.t.leave(true); this.render(); });
    $('lb-copy').addEventListener('click', async () => {
      const r = this.t.room; if (!r) return;
      try { await navigator.clipboard.writeText(r.link); this.note('Invite link copied'); } catch { this.note('Could not copy. Read out the code instead'); }
    });
    $('lb-codeshow').addEventListener('click', async () => {
      const r = this.t.room; if (!r) return;
      try { await navigator.clipboard.writeText(formatCode(r.code)); this.note('Code copied'); } catch { /* the code is on screen */ }
    });
    const share = $('lb-share');
    share.hidden = !navigator.share;
    share.addEventListener('click', () => {
      const r = this.t.room; if (!r) return;
      navigator.share({ title: 'Chasing Green', text: `Come and chase the northern lights with me. Room code ${formatCode(r.code)}.`, url: r.link }).catch(() => {});
    });
    const name = $('lb-name');
    name.value = this.g.settings.name || '';
    name.addEventListener('change', () => this.t.setName(name.value));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    // Typing in the lobby is not driving the garage: keep keys inside its fields.
    for (const f of [name, $('lb-code')]) f.addEventListener('keydown', (e) => e.stopPropagation());
  }
  note(text) {
    const s = $('lb-status'); if (!s) return;
    this.noteText = text; clearTimeout(this.noteT);
    this.noteT = setTimeout(() => { this.noteText = ''; this.render(); }, 2600);
    this.render();
  }
  render() {
    const intro = $('intro'); if (!intro) return;
    const multi = this.multi, r = this.t.room;
    intro.classList.toggle('is-multi', multi);
    for (const b of document.querySelectorAll('#gx-mode button')) { const on = b.dataset.mode === this.mode; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); b.disabled = !!this.counting && !on; }
    $('lobby').hidden = !multi;
    if (multi) {
      $('lb-pick').hidden = !!r || this.joining;
      $('lb-joinbox').hidden = !!r || !this.joining;
      $('lb-room').hidden = !r;
      const name = $('lb-name');
      if (document.activeElement !== name) name.value = this.g.settings.name || '';
      if (r) this.renderRoom(r);
    }
    this.syncStart();
  }
  renderRoom(r) {
    $('lb-codeshow').textContent = formatCode(r.code);
    $('lb-leave').disabled = !!this.counting;
    const ps = this.t.players();
    const rows = ps.map((p) => {
      const lb = p.lb || {};
      const what = lb.playing ? 'On the island' : lb.ready ? 'Ready' : `Loading ${Math.round((lb.pct || 0) * 100)}%`;
      const tags = `${p.me ? '<em>You</em>' : ''}${p.host ? '<em class="is-host">Host</em>' : ''}`;
      return `<li class="${lb.ready || lb.playing ? 'is-ready' : ''}"><i style="--c:${p.color}"></i><b>${esc(p.name)}</b>${tags}<span>${what}</span></li>`;
    });
    // Empty seats, so a room of one reads as waiting rather than finished.
    if (ps.length < 2) rows.push('<li class="is-empty"><i></i><b>Waiting for a friend</b><span>Send the code</span></li>');
    const html = rows.join('');
    const ul = $('lb-people');
    if (ul.innerHTML !== html) ul.innerHTML = html;
    $('lb-count').textContent = `${ps.length} of ${MAX_PLAYERS}`;
    let status = this.noteText || '';
    if (!status) {
      if (r.status === 'connecting') status = 'Opening the room…';
      else if (ps.length < 2 && this.t.byCode && performance.now() - this.t.joinedAt < LOOK) status = 'Looking for the room…';
      else if (ps.length < 2 && this.t.byCode) status = 'Nobody here yet. Check the code with your friend, or wait for them.';
      else if (ps.length < 2) status = 'Friends pick Multiplayer and enter this code, or open the link.';
      else if (this.counting) status = 'Get ready…';
      else { const s = this.state(); status = s.action === 'host' ? 'Everyone is in. Start when you are ready.' : s.action === 'late' ? 'The others have already set off.' : this.g.loaded() ? 'Everyone sets off together when the host starts.' : 'Your island is still loading.'; }
    }
    const st = $('lb-status');
    if (st.textContent !== status) st.textContent = status;
  }
  // Once the trip is under way the start screen is gone; the lobby stops.
  stop() { clearInterval(this.timer); }
}
