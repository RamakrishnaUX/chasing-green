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
  // Above the preset: a computer with plenty of room to spare draws 30% more pixels each way, for a
  // sharper picture. Only reached after a long smooth spell with frames well inside the budget.
  { res: 1.3, sky: 2, skyEvery: 1, mirrors: 0, shadowEvery: 1 },
  // res: share of the quality's pixel ratio; sky: night reflection faces per frame (0 = off) and
  // how many frames apart; mirrors: extra frames between mirror redraws; shadowEvery: frames
  // between shadow redraws. The first step keeps every pixel: a change of resolution softens the
  // picture and costs a hitch while the buffers are remade, so it comes second. (The aurora's
  // detail is left alone: changing it rebuilds its shader, a stall in the middle of play.)
  { res: 1, sky: 2, skyEvery: 1, mirrors: 0, shadowEvery: 1 },
  { res: 1, sky: 1, skyEvery: 2, mirrors: 1, shadowEvery: 2 },
  { res: 0.85, sky: 1, skyEvery: 3, mirrors: 2, shadowEvery: 2 },
  { res: 0.75, sky: 1, skyEvery: 3, mirrors: 2, shadowEvery: 3 },
  { res: 0.65, sky: 0, skyEvery: 3, mirrors: 3, shadowEvery: 3 },
];

const BASE = 1;
export class Governor {
  // touch: a phone or tablet; apply(level, why): put a level's settings into effect.
  constructor({ touch, apply }) {
    this.touch = touch; this.apply = apply;
    // Level 1 is the preset as it is; phones never go above it (their budget is heat and battery).
    this.level = BASE; this.floor = touch ? BASE : 0;
    this.times = []; this.since = 0; this.good = 0; this.wait = 12; this.lastUp = -1e9; this.clock = 0;
    this.lowBattery = false; this.fps = 0; this.slow = 0;
    this.cadence = 60; this.cadenceWait = 20; this.cadenceGood = 0; this.cadenceTry = -1e9;
    try {
      navigator.getBattery?.().then((b) => {
        const upd = () => { this.lowBattery = !b.charging && b.level <= 0.2; this.floor = this.lowBattery ? BASE + 1 : this.touch ? BASE : 0; if (this.level < this.floor) this.set(this.floor, 'battery'); };
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
    // A 120 Hz screen (ProMotion and the like): a steady beat. Run uncapped, a frame of 10 to 30 ms
    // shows for one, two or three refreshes in turn, which reads as judder however high the
    // average; every frame on the same beat is smooth. The beat is the fastest the frames can hold
    // at full quality (frame): 60, or 40 (three refreshes, just as even), or 30.
    if (this.refreshMs && this.refreshMs < 12) return 1000 / this.cadence;
    return 0;
  }

  // Every animation tick (drawn or skipped): learns the screen's refresh interval.
  tick(now) {
    if (this._lt != null) {
      const d = now - this._lt;
      if (d > 3 && d < 50) {
        (this._ticks ||= []).push(d);
        if (this._ticks.length >= 90) { this._ticks.sort((a, b) => a - b); this.refreshMs = this._ticks[this._ticks.length >> 2]; this._ticks.length = 0; }
      }
    }
    this._lt = now;
  }

  set(level, why) {
    level = Math.max(this.floor, Math.min(this.max, level));
    if (level === this.level) return;
    this.level = level;
    this.apply(level, why);
  }

  // Each drawn frame: ms since the last one, the cap it was meant to keep, and whether the game
  // is running (menus and loading do not count).
  // calm: moving slowly or not at all, when a sharper picture can come back unnoticed.
  frame(ms, gapMs, active, calm = true) {
    if (!active || ms > 400) { this.times.length = 0; this.since = 0; this.slow = 0; return; }
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
      // One slow spell can be a burst of one-off work (a new stretch of island coming into view):
      // wait for a second unless it is far too slow.
      if (++this.slow < 2 && p75 < target * 2) return;
      this.slow = 0;
      // A step that has just come back and could not be held waits twice as long next time.
      if (this.clock - this.lastUp < 20) { this.wait = Math.min(120, this.wait * 2); this.lastUp = -1e9; }
      this.lastDown = this.clock;
      this.cadenceGood = 0;
      // On a 120 Hz screen the beat slows to 40 before any pixels or detail go, so the picture
      // stays as it is and only the beat changes (a step to 60 that could not hold waits longer
      // before it is tried again).
      const hi = this.refreshMs && this.refreshMs < 12 && !this.touch;
      if (hi && this.cadence === 60) {
        if (this.clock - this.cadenceTry < 15) this.cadenceWait = Math.min(240, this.cadenceWait * 2);
        this.cadence = 40; return;
      }
      if (this.level < this.max) this.set(this.level + 1, 'slow');
      else if (hi && this.cadence === 40) this.cadence = 30;
      else this.exhausted = true;
    } else if (p75 < target * 1.06) {
      this.slow = 0;
      this.good += 1.5;
      // Bringing pixels back remakes the buffers, a hitch: only while calm.
      const sharper = this.level > this.floor && LEVELS[this.level - 1].res !== LEVELS[this.level].res;
      // Going above the preset wants real room: the slow frames a fifth inside the budget.
      const above = this.level - 1 < BASE && p75 > target * 0.8;
      if (this.good >= this.wait && this.level > this.floor && (calm || !sharper) && !above) { this.good = 0; this.lastUp = this.clock; this.set(this.level - 1, 'room'); }
      // With everything back and frames on the beat for a good while, try the next faster beat.
      if (this.level <= BASE && this.cadence < 60) {
        this.cadenceGood += 1.5;
        if (this.cadenceGood >= this.cadenceWait) { this.cadenceGood = 0; this.cadenceTry = this.clock; this.cadence = this.cadence === 30 ? 40 : 60; }
      }
      // A long smooth spell earns back the patience lost to see-sawing.
      if (this.clock - (this.lastDown ?? 0) > 90 && this.wait > 12) { this.wait = Math.max(12, this.wait / 2); this.lastDown = this.clock; }
    } else { this.good = 0; this.slow = 0; }
  }
}
