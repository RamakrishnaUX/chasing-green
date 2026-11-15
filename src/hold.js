// A short hold on the island build. While the start screen plays something the player is
// watching (the vehicle rolling onto the turntable), the build waits at its next pause instead of
// taking the main thread, so that motion is not broken up by a long build step.
let until = 0;
export const holdBuild = (ms) => { until = Math.max(until, performance.now() + ms); };
// A promise to await at a pause point while a hold is on; null when there is none.
export const held = () => { const left = until - performance.now(); return left > 0 && !document.hidden ? new Promise((r) => setTimeout(r, left)) : null; };
