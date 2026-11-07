// One glass sheet holds the map, cars, notebook, learn and settings pages. Each page keeps the
// small dialog-like surface the rest of the game already uses (showModal, close, open), so the
// code that fills a page does not need to know it now lives inside a shared sheet.
import { haptics } from './haptics.js';
import { sfx } from '../audio/uisfx.js';

const $ = (id) => document.getElementById(id);

export class Sheet {
  constructor() {
    this.dialog = $('sheet');
    this.current = null;
    this.openers = {};
    this.tabs = [...this.dialog.querySelectorAll('.sheet-tabs [data-page]')];
    this.tabPages = ['settings', 'notebook'];
    this.pages = [...this.dialog.querySelectorAll('.sheet-page')];
    for (const page of this.pages) {
      const name = page.dataset.page;
      page.showModal = () => this.show(name);
      page.close = () => { if (this.current === name) this.close(); };
      Object.defineProperty(page, 'open', { get: () => this.dialog.open && this.current === name });
    }
    for (const tab of this.tabs) tab.addEventListener('click', () => { haptics.play('select'); if (this.current !== tab.dataset.page) sfx.whoosh(); this.go(tab.dataset.page); });
    // Sounds for everything else inside: a clack for a choice, a tick for small tools, and an
    // engine blip with a chime for buttons that do something.
    this.dialog.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.closest('.sheet-tabs') || b.id === 'sheet-close') return;
      if (b.closest('.seg')) sfx.clack(); else if (b.closest('.map-tools, .map-pick-close, .info-i')) sfx.tick(); else sfx.confirm();
    });
    this.dialog.addEventListener('change', (e) => { if (e.target.matches('input[type=range], select')) sfx.clack(); });
    // Keys, like a console menu: Q and E change section, up and down choose a row, left and
    // right change its value.
    this.dialog.addEventListener('keydown', (e) => this.key(e));
    this.dialog.addEventListener('cancel', (e) => { if (this.editing) { e.preventDefault(); this.setEdit(false); } });
    this.dialog.addEventListener('close', () => { this.setEdit(false); this.focusRail(null); this.select(null); });
    this.dialog.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const row = e.target.closest('.srow, .sound-row');
      if (row && !row.classList.contains('is-sel')) { this.select(row); sfx.tick(); }
    });
    $('sheet-close').addEventListener('click', () => this.close());
    // Tap the dimmed area around the sheet to close it.
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.close(); });
    this.dialog.addEventListener('close', () => { this.current = null; this.onClose?.(); });
  }

  // Each page registers how it fills itself; tabs call that so a page is fresh when shown.
  register(name, opener) { this.openers[name] = opener; }
  go(name) { if (this.openers[name]) this.openers[name](); else this.show(name); }

  show(name) {
    this.current = name;
    for (const page of this.pages) page.hidden = page.dataset.page !== name;
    for (const tab of this.tabs) { const on = tab.dataset.page === name; tab.classList.toggle('is-on', on); tab.setAttribute('aria-selected', String(on)); }
    this.dialog.dataset.page = name;
    if (!this.dialog.open) {
      sfx.whoosh();
      this.dialog.showModal();
      // Opening a dialog focuses its first button, which would ring the Map tab whatever page
      // is open. The sheet takes focus itself instead; Tab still moves into the controls.
      this.dialog.tabIndex = -1;
      this.dialog.focus({ preventScroll: true });
    }
    this.onShow?.(name);
    // Bring the open section's tab into view in a strip that scrolls sideways.
    const tab = this.tabs.find((t) => t.dataset.page === name), strip = tab?.parentElement;
    if (tab && strip && strip.scrollWidth > strip.clientWidth) {
      const l = tab.offsetLeft - strip.offsetLeft, r = l + tab.offsetWidth;
      if (l < strip.scrollLeft) strip.scrollLeft = l - 12; else if (r > strip.scrollLeft + strip.clientWidth * 0.85) strip.scrollLeft = r - strip.clientWidth * 0.85 + 12;
    }
    this.dialog.scrollLeft = 0;
    // Choose the first row, so the keys and the info panel start somewhere.
    if (!this.dialog.querySelector('.sheet-page:not([hidden]) .is-sel')) { const r = this.rows()[0]; if (r && !document.body.classList.contains('has-touch')) this.select(r); }
  }

  close() { if (this.dialog.open) this.dialog.close(); }

  // ---------- Keys, like a TV or console menu ----------
  // Focus is either on the page's section rail (left) or in its content. Up and down move; right or
  // Enter go from the rail into the content, left goes back. On a setting, Enter picks it up: left
  // and right then change it, and Enter or Esc puts it down again.
  page() { return this.pages.find((p) => p.dataset.page === this.current); }
  rail() {
    const p = this.page();
    return p ? [...p.querySelectorAll('.set-cats button, :scope > .seg-tabs .tab, .jr-rail button')].filter((r) => r.offsetParent) : [];
  }
  rows() {
    const p = this.page();
    return p ? [...p.querySelectorAll('.srow, .sound-row, .panel-actions .btn')].filter((r) => r.offsetParent) : [];
  }

  select(row) {
    for (const r of this.dialog.querySelectorAll('.is-sel')) r.classList.remove('is-sel');
    row?.classList.add('is-sel');
    row?.scrollIntoView({ block: 'nearest' });
    if (row) document.dispatchEvent(new CustomEvent('row-select', { detail: row }));
  }
  focusRail(btn) {
    for (const r of this.dialog.querySelectorAll('.is-focus')) r.classList.remove('is-focus');
    this.zone = btn ? 'rail' : 'content';
    this.dialog.classList.toggle('in-rail', !!btn);
    if (btn) { btn.classList.add('is-focus'); this.setEdit(false); }
  }
  setEdit(on) {
    this.editing = on;
    for (const r of this.dialog.querySelectorAll('.is-edit')) r.classList.remove('is-edit');
    if (on) this.dialog.querySelector('.sheet-page:not([hidden]) .is-sel')?.classList.add('is-edit');
  }
  // Change the chosen row's value one step left or right.
  nudge(row, d) {
    const seg = row.querySelector('.seg'), range = row.querySelector('input[type=range]'), sel = row.querySelector('select.month-select'), step = row.querySelector('.step');
    if (step && getComputedStyle(step).display !== 'none') step.step(d);
    else if (seg) {
      const bs = [...seg.querySelectorAll('button')], on = bs.findIndex((b) => b.classList.contains('is-on'));
      const n = Math.max(0, Math.min(bs.length - 1, on + d));
      if (n !== on) bs[n].click();
    } else if (range) {
      const v = Math.max(+range.min, Math.min(+range.max, +range.value + d * (+range.step || 1)));
      if (v !== +range.value) { range.value = v; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true })); sfx.clack(); }
    } else if (sel) {
      const n = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + d));
      if (n !== sel.selectedIndex) { sel.selectedIndex = n; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  }

  key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key, typing = e.target.matches?.('input:not([type=range]), textarea');
    if (typing) return;
    const order = this.tabs.filter((t) => t.offsetParent).map((t) => t.dataset.page), i = order.indexOf(this.current);
    if (k === 'q' || k === 'Q' || k === 'e' || k === 'E') {
      const n = order[(i + (k.toLowerCase() === 'e' ? 1 : -1) + order.length) % order.length];
      e.preventDefault(); haptics.play('select'); sfx.whoosh(); this.focusRail(null); this.setEdit(false); this.go(n);
      return;
    }
    if (k === 'Tab' && !e.shiftKey && this.onTab && this.tabPages?.includes(this.current) && !document.body.classList.contains('has-touch')) {
      e.preventDefault(); sfx.tick(); this.onTab(this.current);
      return;
    }
    // Esc puts a setting down before it would close the menu.
    if (k === 'Escape' && this.editing) { e.preventDefault(); this.setEdit(false); sfx.tick(); return; }
    const rail = this.rail(), rows = this.rows();
    const ri = rail.findIndex((r) => r.classList.contains('is-focus')), on = rail.findIndex((r) => r.classList.contains('is-on'));

    // On the rail: up and down choose a section (it opens as you land on it); right or Enter go in.
    if (this.zone === 'rail' && rail.length) {
      e.preventDefault();
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        const n = Math.max(0, Math.min(rail.length - 1, (ri < 0 ? on : ri) + (k === 'ArrowDown' ? 1 : -1)));
        if (n !== ri) { rail[n].click(); this.focusRail(this.rail()[n] || rail[n]); sfx.tick(); }
      } else if (k === 'ArrowRight' || k === 'Enter') {
        this.focusRail(null); sfx.tick();
        const first = this.rows()[0];
        if (first) this.select(first);
        else { const g = this.page().querySelector('.tab-body:not([hidden]) .badges .badge'); g?.click(); }
      }
      return;
    }

    // The badge grid: arrows move around the medals; left from the first column goes to the rail.
    const grid = this.page()?.querySelector('.tab-body:not([hidden]) .badges');
    if (grid && k.startsWith('Arrow')) {
      const items = [...grid.children], i2 = Math.max(0, items.findIndex((x) => x.classList.contains('is-sel')));
      const cols = items.filter((x) => x.offsetTop === items[0].offsetTop).length || 1;
      e.preventDefault();
      if (k === 'ArrowLeft' && i2 % cols === 0 && rail.length) { this.focusRail(rail[Math.max(0, on)]); sfx.tick(); return; }
      const n = Math.max(0, Math.min(items.length - 1, i2 + { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k]));
      if (n !== i2) { items[n].click(); items[n].scrollIntoView({ block: 'nearest' }); sfx.tick(); }
      return;
    }

    const at = rows.findIndex((r) => r.classList.contains('is-sel'));
    // Holding a setting: left and right change it; Enter or up/down put it down.
    if (this.editing && at >= 0) {
      if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); this.nudge(rows[at], k === 'ArrowRight' ? 1 : -1); return; }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); this.setEdit(false); sfx.confirm(); return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') this.setEdit(false);
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      const n = at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (k === 'ArrowDown' ? 1 : -1)));
      if (n !== at) { this.select(rows[n]); sfx.tick(); }
      return;
    }
    if (k === 'ArrowLeft' && rail.length) { e.preventDefault(); this.select(null); this.focusRail(rail[Math.max(0, on)]); sfx.tick(); return; }
    if ((k === 'Enter' || k === ' ') && at >= 0) {
      e.preventDefault();
      const row = rows[at];
      if (row.matches('.btn')) { row.click(); return; }
      this.setEdit(true); sfx.clack();
    }
  }
}
