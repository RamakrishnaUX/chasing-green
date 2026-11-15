// The splash picker's portraits: node tools/person/portrait.mjs (Vite dev server running on 5179).
// Each person (src/vehicle/person.js) is rendered from their game model, head and shoulders with a
// green rim light, on a clear background, to public/people/<id>.webp.
// Needs, not saved to package.json: npm i --no-save playwright-core sharp@0.33
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import fs from 'fs';
import os from 'os';

const PORT = process.env.PORT || 5179;
const PEOPLE = { david: 'person.glb', jody: 'person-jody.glb' };
const exe = process.env.CHROMIUM || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1155/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/tools/person/portrait.html`);
await page.waitForFunction(() => window.ready);
fs.mkdirSync('public/people', { recursive: true });
for (const [id, file] of Object.entries(PEOPLE)) {
  const png = await page.evaluate((u) => window.portrait(u), `/models/${file}`);
  const out = `public/people/${id}.webp`;
  await sharp(Buffer.from(png.split(',')[1], 'base64')).webp({ quality: 86, alphaQuality: 90 }).toFile(out);
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
}
await browser.close();
