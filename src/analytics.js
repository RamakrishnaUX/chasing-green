// Google Analytics 4. The tag only loads when CONFIG.analytics.id is set and the page is not
// running on this machine, so local play and tests send nothing. Add ?ga_debug to the URL to
// send hits anyway and see them live in Analytics under Admin, DebugView.
//
// Besides one-off events (a stamp, a sighting, a share), the game keeps two running totals,
// time actually playing and distance driven. They go out as milestones while you play and as
// a summary (only the amounts since the last summary) whenever the tab is hidden or closed,
// so they can be added up across visits.
import { CONFIG } from './config.js';

const ID = CONFIG.analytics?.id || '';
const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const debug = new URLSearchParams(location.search).has('ga_debug');
const on = !!ID && (!local || debug);

const PLAY_MINUTES = [1, 3, 5, 10, 20, 30, 45, 60, 90, 120];
const DRIVE_KM = [1, 5, 10, 25, 50, 100, 200, 500];

if (on) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ID, debug ? { debug_mode: true } : {});
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ID)}`;
  document.head.append(s);
}

// Send one event. Any failure is swallowed: analytics must never break the game.
export function track(name, params = {}) {
  if (debug) console.debug('[analytics]', name, params);
  if (!on) return;
  try { window.gtag('event', name, params); } catch { /* blocked or not loaded */ }
}

const run = { play: 0, metres: 0, topKmh: 0, nitro: 0, sightings: 0, stamps: 0 };
const sent = { play: 0, metres: 0, nitro: 0, sightings: 0, stamps: 0 };
let nextMinute = 0, nextKm = 0, wasBoosting = false;

// Called every frame while the game runs. Counts only time with the tab in view and no menu
// open, and only distance the car itself covers (not walking, not fast travel).
export function tickPlay(dt, { playing, driving, metresPerSecond, kmh, boosting }) {
  if (!playing || document.hidden) return;
  run.play += dt;
  if (driving) {
    run.metres += Math.abs(metresPerSecond) * dt;
    run.topKmh = Math.max(run.topKmh, kmh);
    if (boosting && !wasBoosting) run.nitro++;
    wasBoosting = boosting;
  }
  while (nextMinute < PLAY_MINUTES.length && run.play >= PLAY_MINUTES[nextMinute] * 60) {
    track('play_milestone', { milestone_minutes: PLAY_MINUTES[nextMinute], total_km: km(run.metres) });
    nextMinute++;
  }
  while (nextKm < DRIVE_KM.length && run.metres >= DRIVE_KM[nextKm] * 1000) {
    track('distance_milestone', { milestone_km: DRIVE_KM[nextKm], total_play_minutes: Math.round(run.play / 6) / 10 });
    nextKm++;
  }
}

export function countSighting() { run.sightings++; }
export function countStamp() { run.stamps++; }

const km = (m) => Math.round(m / 100) / 10;

// The amounts since the last summary, so adding every summary up gives the true totals.
function sendSummary(reason) {
  const play = Math.round(run.play - sent.play);
  if (play < 2) return;
  track('session_summary', {
    reason,
    play_seconds: play,
    distance_km: km(run.metres - sent.metres),
    top_speed_kmh: Math.round(run.topKmh),
    nitro_boosts: run.nitro - sent.nitro,
    sightings: run.sightings - sent.sightings,
    new_stamps: run.stamps - sent.stamps,
    transport_type: 'beacon',
  });
  Object.assign(sent, { play: run.play, metres: run.metres, nitro: run.nitro, sightings: run.sightings, stamps: run.stamps });
}
addEventListener('visibilitychange', () => { if (document.hidden) sendSummary('hidden'); });
addEventListener('pagehide', () => sendSummary('closed'));
