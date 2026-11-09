// Keeping the picture smooth, the phone cool and the battery going.
//
// The governor watches how long frames take. When they run long it sheds work one step at a time,
// starting with what the eye misses least (how often the water's night reflection and the mirrors
// are redrawn), then draws fewer pixels, then shadows. When frames have room to
// spare for a good while it brings each step back, and waits longer each time a step it brought
// back had to go again, so it settles instead of see-sawing.
//
// It also sets the frame cap. Phones run at 30 frames a second. A computer runs as fast as the
// screen, but drops to 30 while nothing is moving (you are parked and watching the sky), while the
// window is in the background, and when the battery is low and not charging.

export const LEVELS = [
  // res: share of the quality's pixel ratio; sky: night reflection faces per frame (0 = off) and
  // how many frames apart; mirrors: extra frames between mirror redraws; shadowEvery: frames
  // between shadow redraws. (The aurora's detail is left alone: changing it rebuilds its shader,
  // a stall in the middle of play.)
  { res: 1, sky: 2, skyEvery: 1, mirrors: 0, shadowEvery: 1 },
  { res: 0.9, sky: 1, skyEvery: 1, mirrors: 1, shadowEvery: 1 },
  { res: 0.8, sky: 1, skyEvery: 2, mirrors: 1, shadowEvery: 2 },
  { res: 0.7, sky: 1, skyEvery: 3, mirrors: 2, shadowEvery: 2 },
  { res: 0.6, sky: 0, skyEvery: 3, mirrors: 3, shadowEvery: 3 },
];

export class Governor {
  // touch: a phone or tablet; apply(level, why): put a level's settings into effect.
  constructor({ touch, apply }) {
    this.touch = touch; this.apply = apply;
    this.level = 0; this.floor = 0;
    this.times = []; this.since = 0; this.good = 0; this.wait = 12; this.lastUp = -1e9; this.clock = 0;
    this.lowBattery = false; this.fps = 0;
    try {
      navigator.getBattery?.().then((b) => {
        const upd = () => { this.lowBattery = !b.charging && b.level <= 0.2; this.floor = this.lowBattery ? 1 : 0; if (this.level < this.floor) this.set(this.floor, 'battery'); };
        upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd);
      }).catch(() => {});
    } catch { /* no battery API */ }
  }

  get max() { return LEVELS.length - 1; }
  get settings() { return LEVELS[this.level]; }

  // The frame cap, in milliseconds between frames (0: as fast as the screen).
  // menu: a dialog or the title is up; photo: photo mode; still: nothing has moved for a while.
  gap({ menu, photo, still }) {
    if (menu) return 1000 / 20;
    if (this.touch || photo || still || this.lowBattery || !document.hasFocus()) return 1000 / 30;
    return 0;
  }

  set(level, why) {
    level = Math.max(this.floor, Math.min(this.max, level));
    if (level === this.level) return;
    this.level = level;
    this.apply(level, why);
  }

  // Each drawn frame: ms since the last one, the cap it was meant to keep, and whether the game
  // is running (menus and loading do not count).
  frame(ms, gapMs, active) {
    if (!active || ms > 400) { this.times.length = 0; this.since = 0; return; }
    this.times.push(ms); this.since += ms; this.clock += ms / 1000;
    if (this.since < 1500 || this.times.length < 20) return;
    const t = this.times.slice().sort((a, b) => a - b), p75 = t[Math.floor(t.length * 0.75)];
    const mean = this.since / this.times.length;
    this.fps = 1000 / mean;
    this.times.length = 0; this.since = 0;
    // What a smooth frame takes here: the cap, or a 60 Hz screen's frame.
    const target = gapMs || 1000 / 60;
    if (p75 > target * 1.2) {
      this.good = 0;
      // A step that has just come back and could not be held waits twice as long next time.
      if (this.clock - this.lastUp < 20) { this.wait = Math.min(120, this.wait * 2); this.lastUp = -1e9; }
      this.lastDown = this.clock;
      if (this.level < this.max) this.set(this.level + 1, 'slow');
      else this.exhausted = true;
    } else if (p75 < target * 1.06) {
      this.good += 1.5;
      if (this.good >= this.wait && this.level > this.floor) { this.good = 0; this.lastUp = this.clock; this.set(this.level - 1, 'room'); }
      // A long smooth spell earns back the patience lost to see-sawing.
      if (this.clock - (this.lastDown ?? 0) > 90 && this.wait > 12) { this.wait = Math.max(12, this.wait / 2); this.lastDown = this.clock; }
    } else this.good = 0;
  }
}
