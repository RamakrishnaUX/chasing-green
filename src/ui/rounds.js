// Challenge rounds, inside a room (together.js): anyone picks a challenge and starts it, everyone is
// lined up at the same spot, a countdown runs on every screen, and a results card closes it.
//
//   race    Race to a place: first to reach a landmark (cars only, the route shown to all).
//   aurora  Aurora hunt: night falls for everyone; first to log a sighting wins. The lights are
//           out, but the clouds are not cleared: finding a clear, dark sky is the game.
//   hunt    Team hunt: reach five nearby landmarks between you before the time runs out.
//
// Messages (room 'ev'):
//   {type: 'round', round}               the round: kind, target or list, start spot, line-up, limit
//   {type: 'finish', id, t, kp?}         a player finished, t seconds after Go
//   {type: 'claim', id, lm, t}           a team hunt landmark reached
//   {type: 'endround', id}               someone ended it early
// Each player times themselves from their own Go and checks their own goal: among colleagues,
// trust is the anti-cheat.
//
// A round is only among players out on the island: it needs at least one other there, and anyone
// still in the lobby (or loading) is neither lined up nor pulled out of it by a countdown.

const COUNT = 4; // seconds of countdown: 3, 2, 1, Go
// Metres from a landmark's middle that count as there (as for its stamp: some stand back from the road).
const ARRIVE = 100;
const CLAIM = 110;
export const KINDS = {
  race: { title: 'Race to a place', short: 'Race', limit: 15 * 60, note: 'First to reach the place wins. Cars only; everyone gets the route.' },
  aurora: { title: 'Aurora hunt', short: 'Aurora hunt', limit: 10 * 60, note: 'Night falls for everyone and the lights come out, but the clouds stay. First to find a clear, dark sky and log a sighting wins.' },
  hunt: { title: 'Team hunt', short: 'Team hunt', limit: 15 * 60, note: 'Five places nearby. Reach them between you before the time runs out. Split up.' },
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;

export class Rounds {
  // game: { together, landmarks(), pos(), place(start, slot, carsOnly), hold(on), navTo(lm), navStop(),
  //         night(hours), auroraFloor(on), canAurora(), closeMenu(), started(), hud, haptics, track }
  constructor(game) {
    this.g = game;
    this.r = null; // the round now (or just finished)
    this.kind = 'race';
    this.bindUI();
  }
  get room() { return this.g.together.room; }
  get live() { return this.r && (this.r.state === 'count' || this.r.state === 'run'); }
  // The others out on the island now (each says so as they set off: room.js 'lb').
  out() { return [...(this.room?.peers.values() || [])].filter((q) => q.hello && q.lb?.playing !== false); }

  // ---------- Starting ----------
  start() {
    if (!this.room || this.live) return;
    if (!this.out().length) { this.flash('A round needs at least two of you on the island. Wait for a friend to join you.'); return; }
    const kind = this.kind, p = this.g.pos(), lms = this.g.landmarks();
    if (kind === 'aurora' && !this.g.canAurora()) { this.flash('No aurora in the midnight sun. Pick a darker month in Settings first.'); return; }
    const near = lms.map((l) => ({ l, d: Math.hypot(l.x - p.x, l.z - p.z) })).sort((a, b) => a.d - b.d);
    const round = {
      id: Math.random().toString(36).slice(2, 10), kind, by: this.room.name, limit: KINDS[kind].limit,
      start: { x: p.x, z: p.z, h: p.heading },
      lineup: [this.room.selfId, ...this.out().map((q) => q.id)].sort(),
    };
    if (kind === 'race') {
      const pick = $('rd-target').value;
      const pool = near.filter((n) => n.d > 700 && n.d < 2400);
      const t = pick !== 'auto' ? near.find((n) => n.l.id === pick) : pool[Math.floor(Math.random() * pool.length)] || near.find((n) => n.d > 400);
      if (!t) return;
      round.target = t.l.id;
    }
    if (kind === 'hunt') round.list = near.filter((n) => n.d > 150).slice(0, 5).map((n) => n.l.id);
    if (kind === 'aurora') round.hours = this.g.nightHours();
    this.room.sendEvent({ type: 'round', round });
    this.begin(round);
    this.g.track('round_start', { kind, players: round.lineup.length });
  }
  begin(round) {
    const me = this.room.selfId, slot = Math.max(0, round.lineup.indexOf(me));
    this.r = { ...round, state: 'count', t0: performance.now() / 1000, results: {}, claims: {}, left: new Set() };
    this.g.closeMenu();
    this.g.place(round.start, slot, round.kind === 'race');
    this.g.hold(true);
    if (round.kind === 'aurora') { this.g.night(round.hours); this.g.auroraFloor(true); }
    if (round.kind === 'race') { const lm = this.lm(round.target); if (lm) this.g.navTo(lm); }
    this.lastCount = null;
    this.render();
  }
  lm(id) { return this.g.landmarks().find((l) => l.id === id); }
  name(id) { return id === this.room?.selfId ? 'You' : this.room?.peers.get(id)?.name || 'Someone'; }

  // ---------- Messages from the others ----------
  onEvent(peer, ev) {
    // Not lined up (still in the lobby, or joined after it was set): sit this one out.
    if (ev.type === 'round' && ev.round?.kind in KINDS) { if (!this.live && this.g.started() && ev.round.lineup?.includes(this.room?.selfId)) { this.begin(ev.round); this.g.hud.toast(`${peer.name} started a round: ${KINDS[ev.round.kind].title}.`, { seconds: 3, priority: 3 }); } return; }
    const r = this.r;
    if (!r || ev.id !== r.id) return;
    if (ev.type === 'finish' && !r.results[peer.id]) {
      r.results[peer.id] = { t: +ev.t, kp: ev.kp };
      if (r.state === 'run') this.g.hud.toast(r.kind === 'race' ? `${peer.name} reached ${this.lm(r.target)?.name}.` : `${peer.name} logged a sighting.`, { seconds: 2.5, priority: 2 });
      this.check();
    } else if (ev.type === 'claim' && r.list?.includes(ev.lm) && !r.claims[ev.lm]) {
      r.claims[ev.lm] = { by: peer.id, t: +ev.t };
      this.g.hud.toast(`${peer.name} found ${this.lm(ev.lm)?.name}.`, { seconds: 2.5, priority: 2 });
      this.check();
    } else if (ev.type === 'endround') this.finish(`${peer.name} ended the round.`);
  }
  peerLeft(id) { if (this.r && this.live) { this.r.left.add(id); this.check(); } }

  // ---------- Each frame ----------
  tick() {
    const r = this.r;
    if (!r || !this.live) return;
    const now = performance.now() / 1000, since = now - r.t0;
    if (r.state === 'count') {
      const n = Math.ceil(COUNT - since);
      if (n !== this.lastCount) { this.lastCount = n; this.countdown(n > 0 ? String(n) : 'Go'); this.g.haptics?.play?.(n > 0 ? 'select' : 'heavy'); }
      if (since >= COUNT) { r.state = 'run'; r.go = now; this.g.hold(false); }
      return;
    }
    const t = now - r.go, me = this.room?.selfId, p = this.g.pos();
    if (r.kind === 'race' && !r.results[me]) {
      const lm = this.lm(r.target);
      if (lm && Math.hypot(lm.x - p.x, lm.z - p.z) < ARRIVE) this.mine({ t });
    }
    if (r.kind === 'hunt') for (const id of r.list) {
      if (r.claims[id]) continue;
      const lm = this.lm(id);
      if (lm && Math.hypot(lm.x - p.x, lm.z - p.z) < CLAIM) {
        r.claims[id] = { by: me, t };
        this.room?.sendEvent({ type: 'claim', id: r.id, lm: id, t: +t.toFixed(2) });
        this.g.hud.toast(`Found ${lm.name}. ${r.list.length - Object.keys(r.claims).length || 'None'} to go.`, { seconds: 2.5, priority: 3 });
        this.g.haptics?.play?.('success');
        this.check();
      }
    }
    if (t >= r.limit) this.finish("Time's up.");
    this.hudUpdate(t);
  }
  // A sighting logged (main.js logSighting): the aurora hunt's finish.
  sighting(s) {
    const r = this.r, me = this.room?.selfId;
    if (!r || r.state !== 'run' || r.kind !== 'aurora' || r.results[me] || !s.active) return;
    this.mine({ t: performance.now() / 1000 - r.go, kp: s.kp });
  }
  mine(res) {
    const r = this.r, me = this.room.selfId;
    r.results[me] = res;
    this.room.sendEvent({ type: 'finish', id: r.id, t: +res.t.toFixed(2), kp: res.kp });
    const place = Object.values(r.results).filter((x) => x.t <= res.t).length;
    this.g.hud.toast(r.kind === 'race' ? `You reached ${this.lm(r.target)?.name}: ${ord(place)}, ${fmt(res.t)}.` : `Sighting logged: ${ord(place)}, ${fmt(res.t)}.`, { seconds: 3.5, priority: 3 });
    this.g.haptics?.play?.('success');
    if (r.kind === 'race') this.g.navStop();
    this.check();
  }
  // Over when everyone still here is done (or the team has every place).
  check() {
    const r = this.r;
    if (!r || !this.live) return;
    const here = r.lineup.filter((id) => !r.left.has(id) && (id === this.room?.selfId || this.room?.peers.has(id)));
    if (r.kind === 'hunt' ? r.list.every((id) => r.claims[id]) : here.every((id) => r.results[id])) this.finish(null);
  }
  end() { if (!this.live) return; this.room?.sendEvent({ type: 'endround', id: this.r.id }); this.finish('You ended the round.'); }
  finish(why) {
    const r = this.r;
    if (!r || !this.live) return;
    r.state = 'done'; r.why = why; r.total = r.go ? performance.now() / 1000 - r.go : 0;
    this.g.hold(false);
    if (r.kind === 'aurora') this.g.auroraFloor(false);
    if (r.kind === 'race') this.g.navStop();
    $('round-hud').hidden = true;
    this.results();
    this.render();
    this.g.track('round_end', { kind: r.kind, players: r.lineup.length, done: !why });
  }

  // ---------- On screen ----------
  countdown(text) {
    const el = $('round-count');
    el.textContent = text; el.hidden = false;
    el.classList.remove('is-on'); void el.offsetWidth; el.classList.add('is-on');
    clearTimeout(this.countT); this.countT = setTimeout(() => { el.hidden = true; }, text === 'Go' ? 900 : 1100);
    $('round-hud').hidden = false;
    this.hudUpdate(0);
  }
  hudUpdate(t) {
    const r = this.r, el = $('round-hud');
    if (!r) return;
    const left = Math.max(0, r.limit - t), p = this.g.pos();
    let goal = '';
    if (r.kind === 'race') { const lm = this.lm(r.target); goal = r.results[this.room?.selfId] ? 'Finished. Waiting for the others' : lm ? `${lm.name} · ${fmtDist(Math.hypot(lm.x - p.x, lm.z - p.z))}` : ''; }
    else if (r.kind === 'aurora') goal = r.results[this.room?.selfId] ? 'Logged. Waiting for the others' : 'Find a clear, dark sky and look up';
    else {
      const got = Object.keys(r.claims).length;
      goal = `${got} of ${r.list.length} found`;
    }
    const html = `<p class="rh-k">${esc(KINDS[r.kind].short)}</p><p class="rh-t">${fmt(left)}</p><p class="rh-g">${esc(goal)}</p>` +
      (r.kind === 'hunt' ? `<ul class="rh-list">${r.list.map((id) => { const lm = this.lm(id), c = r.claims[id]; return `<li class="${c ? 'is-got' : ''}">${esc(lm?.name || id)}${c ? '' : ` <span>${fmtDist(Math.hypot(lm.x - p.x, lm.z - p.z))}</span>`}</li>`; }).join('')}</ul>` : '');
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  results() {
    const r = this.r, card = $('round-results');
    let rows = '', head = '';
    if (r.kind === 'hunt') {
      const got = r.list.filter((id) => r.claims[id]).length, all = got === r.list.length;
      head = all ? `All ${got} found in ${fmt(Math.max(...r.list.map((id) => r.claims[id].t)))}` : `${got} of ${r.list.length} found`;
      rows = r.list.map((id) => { const c = r.claims[id]; return `<li class="${c ? '' : 'is-miss'}"><b>${esc(this.lm(id)?.name || id)}</b><span>${c ? `${esc(this.name(c.by))} · ${fmt(c.t)}` : 'Not reached'}</span></li>`; }).join('');
    } else {
      const done = r.lineup.filter((id) => r.results[id]).sort((a, b) => r.results[a].t - r.results[b].t);
      const rest = r.lineup.filter((id) => !r.results[id]);
      const first = done[0];
      head = first ? `${first === this.room?.selfId ? 'You win' : `${esc(this.name(first))} wins`}` : 'Nobody made it';
      rows = done.map((id, i) => `<li><i>${i + 1}</i><b>${esc(this.name(id))}</b><span>${fmt(r.results[id].t)}${r.results[id].kp ? ` · radio ${r.results[id].kp}` : ''}</span></li>`).join('') +
        rest.map((id) => `<li class="is-miss"><i>–</i><b>${esc(this.name(id))}</b><span>${r.left.has(id) || (id !== this.room?.selfId && !this.room?.peers.has(id)) ? 'Left' : 'Did not finish'}</span></li>`).join('');
    }
    card.innerHTML = `<p class="rr-k">${esc(KINDS[r.kind].title)}${r.kind === 'race' ? ` · ${esc(this.lm(r.target)?.name || '')}` : ''}</p><h3 class="rr-h">${head}</h3>${r.why ? `<p class="rr-why">${esc(r.why)}</p>` : ''}<ol class="rr-list">${rows}</ol><div class="rr-actions"><button class="btn btn-primary" id="rr-again">Another round</button><button class="btn" id="rr-close">Close</button></div>`;
    card.hidden = false;
    $('rr-close').addEventListener('click', () => { card.hidden = true; });
    $('rr-again').addEventListener('click', () => { card.hidden = true; this.g.openTogether(); });
    this.g.haptics?.play?.('success');
  }

  // ---------- The picker on the Together page ----------
  bindUI() {
    for (const b of document.querySelectorAll('#rd-kinds button')) b.addEventListener('click', () => { this.kind = b.dataset.kind; this.render(); });
    $('rd-start').addEventListener('click', () => this.start());
    $('rd-end').addEventListener('click', () => this.end());
    addEventListener('keydown', (e) => { const c = $('round-results'); if (!c.hidden && (e.key === 'Escape' || e.key === 'Enter') && !document.querySelector('dialog[open]')) { e.preventDefault(); c.hidden = true; } });
  }
  flash(text) { $('rd-note').textContent = text; clearTimeout(this.flashT); this.flashT = setTimeout(() => this.render(), 3500); }
  // Fill the destination list with the places nearest first.
  fillTargets() {
    const sel = $('rd-target'), p = this.g.pos(), keep = sel.value;
    const list = this.g.landmarks().map((l) => ({ l, d: Math.hypot(l.x - p.x, l.z - p.z) })).filter((n) => n.d > 300).sort((a, b) => a.d - b.d).slice(0, 14);
    sel.innerHTML = `<option value="auto">Surprise me</option>${list.map((n) => `<option value="${n.l.id}">${esc(n.l.name)} · ${fmtDist(n.d)}</option>`).join('')}`;
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }
  render() {
    const box = $('rounds'); if (!box) return;
    box.hidden = !this.room;
    // Left the room mid-round: put everything back.
    if (!this.room && this.live) {
      this.r.state = 'done'; this.g.hold(false); this.g.navStop(); this.g.auroraFloor(false);
      $('round-hud').hidden = true; $('round-count').hidden = true;
    }
    if (!this.room) return;
    for (const b of document.querySelectorAll('#rd-kinds button')) { const on = b.dataset.kind === this.kind; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    $('rd-target-row').hidden = this.kind !== 'race';
    if (this.kind === 'race') this.fillTargets();
    const alone = !this.out().length;
    $('rd-note').textContent = this.live ? `${KINDS[this.r.kind].title} under way.` : alone ? 'Rounds start once a friend is out on the island with you.' : KINDS[this.kind].note;
    $('rd-start').hidden = this.live;
    $('rd-start').disabled = alone;
    $('rd-end').hidden = !this.live;
  }
}
const fmtDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`);
