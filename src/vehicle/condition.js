// The car's condition: 100% as it left the garage, 0% broken down. Each vehicle keeps its own,
// saved between visits, like the fuel. Knocks take it down by how hard they were (a scrape at
// walking pace costs nothing, a crash at 70 km/h about a third), hard landings a little, and
// driving off the roads wears it slowly (more for cars that are bad off-road), as tearing across
// moss and lava does to a real car. Below a quarter the engine loses power; at nothing it limps.
// Any fuel station puts it right.
import { clamp } from '../world/noise.js';

export class Condition {
  constructor(store) {
    this.store = store;
    this.levels = store.data.condition || (store.data.condition = {});
    this.dirty = 0;
  }

  level(kind) { return this.levels[kind] ?? 1; }
  pct(kind) { return Math.round(this.level(kind) * 100); }
  set(kind, v) { this.levels[kind] = clamp(v, 0, 1); this.dirty++; if (this.dirty > 20) this.save(); }
  save() { this.dirty = 0; this.store.save(); }

  // A knock at speed (m/s, the speed into what was hit). Returns the share lost (0..1).
  crash(kind, speed, bike = false) {
    if (speed < 3) return 0;
    // A rider has no cage round him: the same knock costs a bike more.
    const loss = Math.min(0.65, Math.pow((speed - 3) / 40, 1.3) * (bike ? 1.3 : 1));
    this.set(kind, this.level(kind) - loss);
    this.save();
    return loss;
  }

  // A landing after a jump: how hard it met the ground (m/s down, across the slope).
  landing(kind, impact) {
    if (impact < 7) return 0;
    const loss = Math.min(0.2, (impact - 7) * 0.012);
    this.set(kind, this.level(kind) - loss);
    return loss;
  }

  // Off the road for `metres`; off: how well the car copes with this ground (its top-speed share
  // there, specs.js offroad). 1% about every 200 m in the 4x4 on moss, every 100 m in the supercar.
  wear(kind, metres, off) {
    if (metres <= 0) return;
    this.set(kind, this.level(kind) - metres * Math.max(0.1, 1.25 - off) / 8000);
  }

  repair(kind) { this.levels[kind] = 1; this.save(); }

  // The engine's share of its power: full above a quarter, fading to a limp at nothing.
  power(kind) { const l = this.level(kind); return l >= 0.25 ? 1 : 0.3 + 0.7 * (l / 0.25); }
}
