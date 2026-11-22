// The menu on computers: a row of names along the bottom (Map, Vehicle, World, Journey, Together,
// Learn, Settings) with a few icons on the right, which comes in with the mouse and goes with the
// rest of the controls. Vehicle, World and Settings open one floating glass panel above the row;
// the others open their pages as before. Clicking the open tab again, Esc, or a click on the road
// puts the panel away.
//
// The panel drives the settings sheet's own controls (their selects and sliders), so every change
// runs the handlers it always did; the sheet's Settings and Sound pages are simply not shown here.
import { BLUEPRINT } from './cover.js';
import { VEHICLES, VEHICLE_ORDER } from '../vehicle/specs.js';
import { PEOPLE } from '../vehicle/person.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// What each panel holds. Rows name the sheet's controls by id.
const WORLD = ['set-month', 'set-speed', 'set-places', 'set-fuel', 'set-nitro'];
const CATS = [
  { k: 'picture', name: 'Picture', rows: ['set-quality', 'set-look', 'set-rocks', 'set-full'] },
  { k: 'sound', name: 'Sound', rows: ['set-sound', 'vol-master', 'vol-music', 'vol-car', 'vol-ambience'] },
  { k: 'controls', name: 'Controls', rows: ['set-view', 'set-heli'] },
  { k: 'keys', name: 'Keys' },
  { k: 'about', name: 'About' },
];
const KEYS = [
  ['W A S D', 'Drive'], ['Space', 'Nitro'], ['C', 'Camera'], ['V', 'Vehicle'], ['M', 'Map'], ['E', 'Step out or in'],
  ['J', 'Jump, open the chute'], ['F', 'Refuel'], ['L', 'Look up'], ['K', 'Aurora radio'], ['R', 'Record a clip'], ['U', 'Mute'],
  ['O', 'Photo mode'], ['P', 'Postcard of the sky'], ['N', 'Notebook'], ['Esc', 'Close'],
];
const short = (t) => t.replace(/^(\d)x$/, '$1×').replace(/ \(like the car\)$/, '');

export function slowMenu({ go, vehicle, setVehicle, person, setPerson, sync, notes = {}, onOpen }) {
  const root = $('sm');
  if (!root || document.body.classList.contains('has-touch')) return null;
  const tabs = [...root.querySelectorAll('.sm-tab')];
  const panels = [...root.querySelectorAll('.sm-panel')];
  const ind = root.querySelector('.sm-ind');
  let open = '', cat = 'picture';

  // ---- Vehicle: the garage's own outlines, one tile each, the helicopter last ----
  const kinds = [...VEHICLE_ORDER, 'heli'];
  const tagline = (k) => (k === 'heli' ? 'Fly anywhere and see the whole island.' : VEHICLES[k].tagline);
  const nameOf = (k) => (k === 'heli' ? 'Helicopter' : VEHICLES[k].name);
  $('sm-vehicles').innerHTML = kinds.map((k) => `<button type="button" class="sm-tile is-wide" data-k="${k}" aria-label="${nameOf(k)}" aria-pressed="false"><svg viewBox="0 -4 240 104" aria-hidden="true">${BLUEPRINT[k].d.map((d) => `<path d="${d}"/>`).join('')}</svg></button>`).join('');
  $('sm-people').innerHTML = Object.values(PEOPLE).map((p) => `<button type="button" class="sm-tile is-face" data-p="${p.id}" aria-label="${p.name}" aria-pressed="false"><img src="./people/${p.id}.webp" alt="" width="160" height="160" decoding="async"></button>`).join('');
  const showVehicle = () => {
    const k = vehicle();
    for (const b of $('sm-vehicles').children) b.setAttribute('aria-pressed', String(b.dataset.k === k));
    $('sm-vcap').innerHTML = `<b>${nameOf(k)}</b>`;
    $('sm-vcap').append(tagline(k));
  };
  const showPerson = () => {
    const id = person();
    for (const b of $('sm-people').children) b.setAttribute('aria-pressed', String(b.dataset.p === id));
    $('sm-pcap').innerHTML = `<b>${PEOPLE[id]?.name || ''}</b>`;
  };
  $('sm-vehicles').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    setVehicle(b.dataset.k);
    setTimeout(showVehicle, 60); // a ride can refuse (skydiving), so show what actually happened
  });
  $('sm-people').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) { setPerson(b.dataset.p); showPerson(); } });

  // ---- Rows: one per sheet control, as a segmented choice, a stepper or a slider ----
  const labelOf = (id) => document.querySelector(`label[for="${id}"]`);
  function rowHtml(id) {
    const el = $(id);
    if (!el) return '';
    const lab = labelOf(id);
    if (el.matches('input.vol')) {
      const name = lab?.querySelector('b')?.textContent || lab?.textContent || '', sub = lab?.querySelector('span')?.textContent || '';
      return `<div class="sm-r is-vol" data-id="${id}"><span class="sm-rl">${esc(name)}<small>${esc(sub)}</small></span><input type="range" class="sm-range" min="${el.min}" max="${el.max}" step="${el.step}" aria-label="${esc(name)}"><output></output></div>`;
    }
    const name = esc(lab?.textContent.trim() || '');
    if (el.classList.contains('month-select')) {
      return `<div class="sm-r" data-id="${id}"><span class="sm-rl">${name}</span><div class="sm-step"><button type="button" data-d="-1" aria-label="Earlier month"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 1.5 3 5l3.5 3.5"/></svg></button><b></b><button type="button" data-d="1" aria-label="Later month"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5 7 5 3.5 8.5"/></svg></button></div></div>`;
    }
    return `<div class="sm-r" data-id="${id}"><span class="sm-rl">${name}</span><div class="sm-seg" role="radiogroup" aria-label="${name}">${[...el.options].map((o) => `<button type="button" role="radio" data-v="${esc(o.value)}" aria-checked="false">${esc(short(o.textContent))}</button>`).join('')}</div></div>`;
  }
  // Show each row's current value, read from the sheet's control.
  function syncRows(box) {
    for (const r of box.querySelectorAll('.sm-r[data-id]')) {
      const el = $(r.dataset.id);
      if (!el) continue;
      if (r.classList.contains('is-vol')) {
        const inp = r.querySelector('input');
        if (document.activeElement !== inp) inp.value = el.value;
        inp.style.setProperty('--p', `${(el.value - el.min) / (el.max - el.min) * 100}%`);
        r.querySelector('output').textContent = `${el.value}%`;
      } else if (r.querySelector('.sm-step')) {
        r.querySelector('.sm-step b').textContent = el.selectedOptions[0]?.textContent || '';
      } else {
        for (const b of r.querySelectorAll('[data-v]')) b.setAttribute('aria-checked', String(b.dataset.v === el.value));
      }
    }
  }
  function wireRows(box, hint) {
    box.addEventListener('click', (e) => {
      const r = e.target.closest('.sm-r[data-id]'), el = r && $(r.dataset.id);
      if (!el) return;
      const b = e.target.closest('[data-v]'), d = e.target.closest('[data-d]');
      if (b && el.value !== b.dataset.v) { el.value = b.dataset.v; el.dispatchEvent(new Event('change', { bubbles: true })); }
      if (d) { const n = el.options.length; el.selectedIndex = (el.selectedIndex + +d.dataset.d + n) % n; el.dispatchEvent(new Event('change', { bubbles: true })); }
      syncRows(box);
    });
    box.addEventListener('input', (e) => {
      const r = e.target.closest('.sm-r.is-vol'), el = r && $(r.dataset.id);
      if (!el) return;
      el.value = e.target.value; el.dispatchEvent(new Event('input', { bubbles: true })); syncRows(box);
    });
    box.addEventListener('change', (e) => { const r = e.target.closest('.sm-r.is-vol'); if (r) $(r.dataset.id)?.dispatchEvent(new Event('change', { bubbles: true })); });
    // What a setting does, under the rows, for the one under the pointer or in focus.
    const say = (e) => {
      const r = e.target.closest?.('.sm-r[data-id]');
      if (!r) return;
      const t = notes[r.dataset.id] || (r.classList.contains('is-vol') ? notes.volume : '') || '';
      if (hint.textContent !== t) hint.textContent = t;
    };
    box.addEventListener('pointerover', say);
    box.addEventListener('focusin', say);
  }

  $('sm-world').innerHTML = WORLD.map(rowHtml).join('');
  wireRows($('sm-world'), $('sm-whint'));
  wireRows($('sm-setrows'), $('sm-shint'));
  $('sm-cats').innerHTML = CATS.map((c) => `<button type="button" role="tab" data-c="${c.k}" aria-selected="false">${c.name}</button>`).join('');
  $('sm-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) showCat(b.dataset.c); });
  function showCat(k) {
    cat = k;
    for (const b of $('sm-cats').children) b.setAttribute('aria-selected', String(b.dataset.c === k));
    const c = CATS.find((x) => x.k === k), box = $('sm-setrows');
    box.className = `sm-rows is-${k}`;
    // Until the pointer finds a row, the line under them says what the first one does.
    $('sm-shint').textContent = c.rows ? notes[c.rows[0]] || '' : '';
    if (c.rows) {
      box.innerHTML = c.rows.map(rowHtml).join('');
      syncRows(box);
    } else if (k === 'keys') {
      box.innerHTML = `<dl class="sm-keys">${KEYS.map(([key, what]) => `<div><dt>${key.split(' ').map((x) => `<kbd>${x}</kbd>`).join('')}</dt><dd>${what}</dd></div>`).join('')}</dl>`;
    } else {
      const credits = [...document.querySelectorAll('#settings .credits')].filter((p) => !p.classList.contains('touch-only')).map((p) => `<p>${esc(p.textContent.trim())}</p>`).join('');
      box.innerHTML = `<div class="sm-about"><div class="sm-credits">${credits}</div><div class="sm-danger"><span>Your sightings, stamps and challenge progress</span><button type="button" id="sm-reset">Clear notebook</button></div></div>`;
      $('sm-reset').addEventListener('click', () => $('set-reset').click());
    }
  }

  // ---- The panel ----
  // While one of the sheet's pages is open (Map, Journey, Learn, Together), it floats as a panel
  // above the row: the row stays in view and marks that page, and a click on the row, which lies
  // under the sheet's backdrop, still reaches the tab or icon there once the sheet has closed.
  const sheetEl = $('sheet'), SHEET_TAB = { map: 'map', notebook: 'journey', learn: 'learn', together: 'together' };
  let sheetTab = '';
  const watchSheet = () => {
    const on = !!sheetEl?.open;
    sheetTab = on ? SHEET_TAB[sheetEl.dataset.page] || '' : '';
    document.body.classList.toggle('sm-sheet', on);
    if (on && open) show('');
    place();
  };
  if (sheetEl) {
    new MutationObserver(watchSheet).observe(sheetEl, { attributes: true, attributeFilter: ['open', 'data-page'] });
    sheetEl.addEventListener('click', (e) => {
      if (e.target !== sheetEl) return;
      const hit = [...root.querySelectorAll('.sm-tab, .sm-icons button')].find((b) => { const r = b.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
      if (!hit) return;
      // (The sheet may have closed itself already, so the page it was showing is read from the sheet.)
      const same = hit.dataset.t && hit.dataset.t === SHEET_TAB[sheetEl.dataset.page];
      if (sheetEl.open) sheetEl.close();
      if (!same) setTimeout(() => hit.click(), 0);
    });
  }
  function place() {
    const t = tabs.find((x) => x.dataset.t === (open || sheetTab));
    if (!t) { ind.style.opacity = '0'; for (const x of tabs) x.classList.remove('is-on'); return; }
    const s = t.querySelector('span'), base = t.parentElement.getBoundingClientRect(), r = s.getBoundingClientRect();
    ind.style.opacity = '1';
    for (const x of tabs) x.classList.toggle('is-on', x === t);
    ind.style.width = `${r.width}px`;
    ind.style.transform = `translateX(${r.left - base.left}px)`;
  }
  function show(name, sub) {
    if (name) sync?.();
    open = name;
    root.classList.toggle('is-open', !!name);
    document.body.classList.toggle('sm-open', !!name);
    for (const t of tabs) t.classList.toggle('is-on', t.dataset.t === (name || sheetTab));
    for (const t of tabs) if (t.hasAttribute('aria-selected')) t.setAttribute('aria-selected', String(t.dataset.t === name));
    for (const p of panels) p.hidden = p.dataset.p !== name;
    if (name === 'vehicle') { showVehicle(); showPerson(); }
    if (name === 'world') { syncRows($('sm-world')); $('sm-whint').textContent = notes[WORLD[0]] || ''; }
    if (name === 'settings') showCat(sub || cat);
    place();
    onOpen?.(!!name);
  }
  const toggle = (name) => show(open === name ? '' : name);
  for (const t of tabs) {
    t.addEventListener('click', () => {
      const k = t.dataset.t;
      if (k === 'vehicle' || k === 'world' || k === 'settings') toggle(k);
      else { show(''); go(k); }
    });
  }
  addEventListener('resize', place);
  // A click anywhere outside the menu (the road, the sky) puts the panel away.
  addEventListener('pointerdown', (e) => { if (open && !root.contains(e.target) && !e.target.closest?.('dialog')) show(''); }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open && !document.querySelector('dialog[open]')) { e.preventDefault(); e.stopImmediatePropagation(); show(''); }
  }, true);

  // ---- The icons mirror the buttons they stand in for ----
  const mirror = (id, from, syncIcon) => {
    const src = $(from);
    $(id).addEventListener('click', () => src.click());
    if (syncIcon) { syncIcon(); new MutationObserver(syncIcon).observe(src, { attributes: true, attributeFilter: ['aria-pressed', 'class'] }); }
  };
  mirror('sm-mute', 'btn-mute', () => $('sm-mute').classList.toggle('is-muted', $('btn-mute').getAttribute('aria-pressed') === 'true'));
  mirror('sm-rec', 'btn-record', () => $('sm-rec').classList.toggle('is-rec', $('btn-record').classList.contains('is-recording')));
  $('sm-radio').addEventListener('click', () => $('radio').classList.toggle('is-open'));

  return {
    get open() { return open; },
    show,
    toggle,
    close: () => show(''),
    refresh() { if (open) show(open); },
  };
}
