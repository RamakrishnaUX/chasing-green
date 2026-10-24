import { CONFIG } from '../config.js';
import { smoothstep } from './noise.js';

// gameHours counts up from the start of the trip (startHour on day 0).
export class Clock {
  constructor(month = new Date().getMonth(), gameHours = CONFIG.time.startHour) {
    this.month = month;
    this.gameHours = gameHours;
    this.realSeconds = 0;
    this.speed = 1;
  }
  tick(dt) {
    this.realSeconds += dt;
    this.gameHours += (dt * this.speed) / CONFIG.time.secondsPerGameHour;
  }
  get m() { return CONFIG.months[this.month]; }
  // Visual season: summer greens from May to August, winter colours otherwise.
  get season() { return this.month >= 4 && this.month <= 7 ? 'Summer' : 'Winter'; }
  set season(v) { this.month = v === 'Summer' ? 6 : 11; }
  get midnightSun() { return !!this.m.midnightSun; }
  // Hours of real darkness (dark enough for aurora) in a day, worked out from the sun path.
  darkHours() { let n = 0; for (let h = 0; h < 24; h += 0.25) if (this.darkness(h) >= CONFIG.aurora.minDarkness) n += 0.25; return n; }
  get hourOfDay() { return ((this.gameHours % 24) + 24) % 24; }
  get day() { return Math.floor(this.gameHours / 24); }
  // Nights run noon to noon so a single night never splits across two indexes.
  get nightIndex() { return Math.floor((this.gameHours - 12) / 24); }
  get nightLocal() { return this.gameHours - 12 - this.nightIndex * 24; } // 0 at noon, 12 at midnight

  sunElevation(hour = this.hourOfDay) {
    const s = this.m;
    const noon = (s.sunrise + s.sunset) / 2;
    const half = ((s.sunset - s.sunrise) / 2 / 12) * Math.PI;
    const A = s.maxSunElevation / (1 - Math.cos(half));
    const B = -A * Math.cos(half);
    return A * Math.cos(((hour - noon) / 12) * Math.PI) + B; // degrees
  }
  sunAzimuth(hour = this.hourOfDay) {
    // Sun due south at solar noon, swinging east to west.
    const s = this.m;
    const noon = (s.sunrise + s.sunset) / 2;
    return Math.PI + ((hour - noon) / 12) * Math.PI;
  }
  darkness(hour = this.hourOfDay) {
    return smoothstep(-1, -8, this.sunElevation(hour));
  }
  label(hours = this.gameHours) {
    const h = ((hours % 24) + 24) % 24;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
