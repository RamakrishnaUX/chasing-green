// The menu on computers: a row of names along the bottom (Map, Vehicle, World, Journey, Together,
// Learn) with a few icons on the right, which comes in with the mouse and goes with the rest of the
// controls. Vehicle and World open one frosted band above the row; the others open their pages as
// before. Clicking the open tab again, Esc, or a click on the road closes the band.
import { BLUEPRINT } from './cover.js';
import { VEHICLES, VEHICLE_ORDER } from '../vehicle/specs.js';
import { PEOPLE } from '../vehicle/person.js';

const $ = (id) => document.getElementById(id);

export function slowMenu({ go, vehicle, setVehicle, person, setPerson, onOpen }) {
  const root = $('sm');
  if (!root || document.body.classList.contains('has-touch')) return null;
  const tabs = [...root.querySelectorAll('.sm-tab')];
  const panels = [...root.querySelectorAll('.sm-panel')];
  let open = '';

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

  // ---- World: the settings sheet's own controls, driven through their change events ----
  const pickers = [...root.querySelectorAll('[data-set]')];
  for (const box of pickers) {
    const sel = $(box.dataset.set);
    box.innerHTML = [...sel.options].map((o) => `<button type="button" class="sm-tile" data-v="${o.value}" aria-pressed="false">${o.value === '1' || o.value === '2' || o.value === '4' ? `${o.value}×` : o.textContent}</button>`).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b || sel.value === b.dataset.v) return;
      sel.value = b.dataset.v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      showWorld();
    });
  }
  const month = $('set-month');
  const stepMonth = (d) => {
    const n = month.options.length, i = (month.selectedIndex + d + n) % n;
    month.selectedIndex = i;
    month.dispatchEvent(new Event('change', { bubbles: true }));
    showWorld();
  };
  $('sm-mprev').addEventListener('click', () => stepMonth(-1));
  $('sm-mnext').addEventListener('click', () => stepMonth(1));
  function showWorld() {
    $('sm-month').textContent = month.selectedOptions[0]?.textContent || '';
    for (const box of pickers) {
      const v = $(box.dataset.set).value;
      for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    }
  }

  // ---- The band ----
  function show(name) {
    open = name;
    root.classList.toggle('is-open', !!name);
    document.body.classList.toggle('sm-open', !!name);
    for (const t of tabs) if (t.hasAttribute('aria-selected')) t.setAttribute('aria-selected', String(t.dataset.t === name));
    for (const p of panels) p.hidden = p.dataset.p !== name;
    if (name === 'vehicle') { showVehicle(); showPerson(); }
    if (name === 'world') showWorld();
    onOpen?.(!!name);
  }
  const toggle = (name) => show(open === name ? '' : name);
  for (const t of tabs) {
    t.addEventListener('click', () => {
      const k = t.dataset.t;
      if (k === 'vehicle' || k === 'world') toggle(k);
      else { show(''); go(k); }
    });
  }
  // A click anywhere outside the menu (the road, the sky) puts the band away.
  addEventListener('pointerdown', (e) => { if (open && !root.contains(e.target)) show(''); }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopImmediatePropagation(); show(''); }
  }, true);

  // ---- The icons mirror the buttons they stand in for ----
  const mirror = (id, from, sync) => {
    const src = $(from);
    $(id).addEventListener('click', () => src.click());
    if (sync) { sync(); new MutationObserver(sync).observe(src, { attributes: true, attributeFilter: ['aria-pressed', 'class'] }); }
  };
  mirror('sm-mute', 'btn-mute', () => $('sm-mute').classList.toggle('is-muted', $('btn-mute').getAttribute('aria-pressed') === 'true'));
  mirror('sm-rec', 'btn-record', () => $('sm-rec').classList.toggle('is-rec', $('btn-record').classList.contains('is-recording')));
  mirror('sm-settings', 'btn-settings');
  $('sm-radio').addEventListener('click', () => $('radio').classList.toggle('is-open'));

  return {
    get open() { return open; },
    toggle,
    close: () => show(''),
    refresh() { if (open === 'vehicle') { showVehicle(); showPerson(); } if (open === 'world') showWorld(); },
  };
}
