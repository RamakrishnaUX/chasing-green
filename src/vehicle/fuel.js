// Fuel: each car keeps its own tank, saved between visits. It burns with distance driven: more
// under power, three times as fast on nitro, a little more off-road and afloat; coasting uses
// little and standing still none. Near empty the engine starts to cough, then cuts out.
// range: metres on a full tank at a steady cruise.
export const TANKS = {
  jeep: { litres: 80, range: 9000 },
  vintage: { litres: 45, range: 7000 },
  camper: { litres: 90, range: 10000 },
  race: { litres: 70, range: 8500 },
};
const RESERVE = 0.015; // the last of the tank, where the engine misfires
const FILL = 0.3; // share of a tank pumped per second

export class FuelTank {
  constructor(store) {
    this.store = store;
    this.levels = store.data.fuel || (store.data.fuel = {});
    this.on = true;
    this.filling = false;
    this.t = 0;
    this.dirty = 0;
  }

  level(kind) { return this.levels[kind] ?? 1; }
  litres(kind, share = this.level(kind)) { return Math.round((TANKS[kind]?.litres || 60) * share); }
  empty(kind) { return this.on && this.level(kind) <= 0; }

  // Burn fuel for this frame and return the engine's power (1 full, 0 dead).
  burn(dt, car, throttle) {
    this.t += dt;
    if (!this.on) return 1;
    const kind = car.kind, T = TANKS[kind] || TANKS.jeep;
    let lvl = this.level(kind);
    const d = Math.abs(car.vF) * dt;
    if (d > 0 && lvl > 0) {
      let f = throttle > 0 ? 0.35 + 0.65 * throttle : 0.2;
      if (car.boosting) f *= 3;
      if (car.boatOn) f *= 1.3; else if (car.surface !== 'paved') f *= 1.15;
      lvl = Math.max(0, lvl - (d * f) / T.range);
      this.levels[kind] = lvl;
      this.dirty += dt;
    }
    if (this.dirty > 5) this.save();
    if (lvl <= 0) return 0;
    if (lvl < RESERVE) return Math.sin(this.t * 9) + Math.sin(this.t * 3.7) > 0.5 ? 0.1 : 1;
    return 1;
  }

  // Pump some fuel in; returns true once the tank is full.
  fill(dt, kind) {
    const lvl = Math.min(1, this.level(kind) + dt * FILL);
    this.levels[kind] = lvl;
    if (lvl >= 1) { this.save(); return true; }
    return false;
  }

  save() { this.dirty = 0; this.store.save(); }
}
