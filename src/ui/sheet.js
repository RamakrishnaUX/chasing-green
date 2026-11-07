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

  rows() {
    const page = this.pages.find((p) => p.dataset.page === this.current);
    return page ? [...page.querySelectorAll('.srow, .sound-row')].filter((r) => r.offsetParent) : [];
  }

  select(row) {
    for (const r of this.dialog.querySelectorAll('.is-sel')) r.classList.remove('is-sel');
    row?.classList.add('is-sel');
    row?.scrollIntoView({ block: 'nearest' });
    if (row) document.dispatchEvent(new CustomEvent('row-select', { detail: row }));
  }

  key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key, typing = e.target.matches?.('input:not([type=range]), textarea');
    if (typing) return;
    const order = this.tabs.filter((t) => t.offsetParent).map((t) => t.dataset.page), i = order.indexOf(this.current);
    if (k === 'q' || k === 'Q' || k === 'e' || k === 'E') {
      const n = order[(i + (k.toLowerCase() === 'e' ? 1 : -1) + order.length) % order.length];
      e.preventDefault(); haptics.play('select'); sfx.whoosh(); this.go(n);
      return;
    }
    // Tab moves between the groups inside a page (settings groups, notebook sections).
    if (k === 'Tab' && !e.shiftKey && this.onTab && this.tabPages?.includes(this.current) && !document.body.classList.contains('has-touch')) {
      e.preventDefault(); sfx.tick(); this.onTab(this.current);
      return;
    }
    // The badge grid: arrows move around the medals.
    const grid = this.dialog.querySelector('.sheet-page:not([hidden]) .tab-body:not([hidden]) .badges');
    if (grid && k.startsWith('Arrow')) {
      const items = [...grid.children], i = Math.max(0, items.findIndex((x) => x.classList.contains('is-sel')));
      const cols = items.filter((x) => x.offsetTop === items[0].offsetTop).length || 1;
      const n = Math.max(0, Math.min(items.length - 1, i + { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k]));
      e.preventDefault();
      if (n !== i) { items[n].click(); items[n].scrollIntoView({ block: 'nearest' }); sfx.tick(); }
      return;
    }
    const rows = this.rows();
    if (!rows.length) return;
    const at = rows.findIndex((r) => r.classList.contains('is-sel'));
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      const n = at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (k === 'ArrowDown' ? 1 : -1)));
      if (n !== at) { this.select(rows[n]); sfx.tick(); }
      return;
    }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && at >= 0) {
      e.preventDefault();
      const row = rows[at], d = k === 'ArrowRight' ? 1 : -1;
      const seg = row.querySelector('.seg');
      const range = row.querySelector('input[type=range]');
      const sel = row.querySelector('select.month-select');
      const step = row.querySelector('.step');
      if (step && getComputedStyle(step).display !== 'none') step.step(d);
      else if (seg) {
        const bs = [...seg.querySelectorAll('button')], on = bs.findIndex((b) => b.classList.contains('is-on'));
        const n = Math.max(0, Math.min(bs.length - 1, on + d));
        if (n !== on) bs[n].click();
      } else if (range) {
        const v = Math.max(+range.min, Math.min(+range.max, +range.value + d * (+range.step || 1)));
        if (v !== +range.value) { range.value = v; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true })); }
      } else if (sel) {
        const n = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + d));
        if (n !== sel.selectedIndex) { sel.selectedIndex = n; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      }
    }
  }
}
