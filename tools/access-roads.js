// Works out the turn-offs to sights that stand well back from their road (geo.js ACCESS).
// Paste into the browser console with the game loaded. It walks from the nearest point on a main
// road straight towards each landmark and stops short of anything in the way (rocks, walls,
// water, a cliff or a climb of more than 12 m), and short of the sight's own level ground. Sights
// whose turn-off would be under 18 m are left reached from the road itself. Prints entries for
// ACCESS in geo.js.
(() => {
  const G = window.chasingGreen, O = G.obstacles, WS = 3.36;
  const PAD = { building: 32, town: 30, sculpture: 12, pool: 26, geothermal: 24, cave: 16, bridge: 18, waterfall: 34, geyser: 18, wreck: 18, stadium: 80 };
  const main = G.roadPaths().filter((p) => !p.spur);
  const ll = (x, z) => [+(64.8 - z / (360 * WS)).toFixed(5), +(x / (160 * WS) - 19).toFixed(5)];
  const out = [];
  for (const l of G.landmarks.list) {
    let bd = 1e9, R = null, rp = null;
    for (const p of main) for (const q of p.pts) { const d = Math.hypot(q.x - l.x, q.z - l.z); if (d < bd) { bd = d; R = q; rp = p; } }
    const dx = (l.x - R.x) / bd, dz = (l.z - R.z) / bd, h0 = G.heightAt(R.x, R.z);
    let last = 0, prevH = h0;
    for (let s = 6; s <= bd; s += 1.5) {
      const x = R.x + dx * s, z = R.z + dz * s, h = G.heightAt(x, z);
      if (O.resolve({ x, z }, 3.2, false, h, 1.6) || G.waterLevelAt(x, z) > h - 0.4 || G.solidTopAt(x, z) > h + 0.3) break;
      if ((s > 14 && Math.abs(h - prevH) / 1.5 > 0.8) || Math.abs(h - h0) > 12) break;
      prevH = h; last = s;
    }
    const clear = Math.max(14, 0.7 * (PAD[l.kind] || l.reach || 34));
    const len = Math.min(last - 5, bd - clear);
    if (len < 18) continue;
    out.push(`  { id: '${l.id}', type: '${rp.type}', from: ${JSON.stringify(ll(R.x, R.z))}, to: ${JSON.stringify(ll(R.x + dx * len, R.z + dz * len))} },`);
  }
  return out.join('\n');
})();
