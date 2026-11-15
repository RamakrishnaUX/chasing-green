// A person and their Mixamo clips, FBX to one glTF: node tools/person/convert.mjs
// (PERSON=jody for Jody; David by default). The character (David or Jody, Mixamo) and every clip
// were downloaded from Mixamo on that character, so the clips drive their own skeleton as they are:
// no retargeting. The FBX files (downloads/<person>) are read by three.js's FBXLoader in headless
// Chromium (tools/person/convert.html, served by the Vite dev server, which must be running:
// npx vite --port 5179), scaled to metres and written to downloads/<person>/<person>.glb, which
// process.mjs then makes the game's person.glb (David) or person-jody.glb (Jody).
// Needs, not saved to package.json: npm i --no-save playwright-core (and Chromium from Playwright).
import { chromium } from 'playwright-core';
import fs from 'fs';
import os from 'os';

const PORT = process.env.PORT || 5179;
const WHO = process.env.PERSON || 'david', DIR = `downloads/${WHO}`;
// File (downloads/david/<file>.fbx), the name the game knows it by, and whether to hold the hips
// in place across the ground (the game moves him; the climbs keep their rise to be measured).
export const CLIPS = [
  ['breathing-idle', 'idle', true], ['walking', 'walk', true], ['walking-backwards', 'back', true],
  ['running', 'run', true], ['jumping', 'jump', true], ['falling-idle', 'fall', true], ['kneeling-idle', 'kneel', true],
  ['swimming', 'swim', true], ['treading-water', 'tread', true],
  ['climbing', 'climb', false], ['climbing-up-wall', 'climbUp', false], ['climbing-to-top', 'climbTop', false], ['hanging-idle', 'hang', true],
  ['driving', 'drive', true],
];

const exe = process.env.CHROMIUM || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1155/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/tools/person/convert.html`);
await page.waitForFunction(() => window.ready);
const info = await page.evaluate((u) => window.character(u), `/${DIR}/${WHO}.fbx`);
console.log("bind diff", info.bindDiff, "bind matrices off identity", info.bindMatrices, "missing textures", info.missing, "extra bones", info.extraBones, "offset", info.extraOffset, "scale", info.scale, "size", info.size.map((v) => v.toFixed(3)), "bones", info.bones);
for (const m of info.meshes) console.log(" ", m);
if (process.env.BONES) console.log(info.boneNames);
for (const [file, name, inPlace] of CLIPS) {
  if (!fs.existsSync(`${DIR}/${file}.fbx`)) { console.log('missing', file); continue; }
  console.log(JSON.stringify(await page.evaluate(([u, n, p]) => window.clip(u, n, p), [`/${DIR}/${file}.fbx`, name, inPlace])));
}
const b64 = await page.evaluate(() => window.exportGLB());
fs.writeFileSync(`${DIR}/${WHO}.glb`, Buffer.from(b64, 'base64'));
console.log(`wrote ${DIR}/${WHO}.glb`, fs.statSync(`${DIR}/${WHO}.glb`).size, 'bytes');
await browser.close();
