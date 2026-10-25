// One glass sheet holds the map, cars, notebook, learn and settings pages. Each page keeps the
// small dialog-like surface the rest of the game already uses (showModal, close, open), so the
// code that fills a page does not need to know it now lives inside a shared sheet.
import { haptics } from './haptics.js';

const $ = (id) => document.getElementById(id);

export class Sheet {
  constructor() {
    this.dialog = $('sheet');
    this.current = null;
    this.openers = {};
    this.tabs = [...this.dialog.querySelectorAll('.sheet-tabs [data-page]')];
    this.pages = [...this.dialog.querySelectorAll('.sheet-page')];
    for (const page of this.pages) {
      const name = page.dataset.page;
      page.showModal = () => this.show(name);
      page.close = () => { if (this.current === name) this.close(); };
      Object.defineProperty(page, 'open', { get: () => this.dialog.open && this.current === name });
    }
    for (const tab of this.tabs) tab.addEventListener('click', () => { haptics.play('select'); this.go(tab.dataset.page); });
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
      this.dialog.showModal();
      // Opening a dialog focuses its first button, which would ring the Map tab whatever page
      // is open. The sheet takes focus itself instead; Tab still moves into the controls.
      this.dialog.tabIndex = -1;
      this.dialog.focus({ preventScroll: true });
    }
    this.onShow?.(name);
  }

  close() { if (this.dialog.open) this.dialog.close(); }
}
