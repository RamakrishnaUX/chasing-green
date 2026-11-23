// The menu's Vehicle tiles: node tools/cars/thumbs.mjs (Vite dev server running; PORT, default 5179).
// Each vehicle is rendered from its game model, three-quarters on in a soft studio light with a
// contact shadow, on a clear background, to public/vehicles/<kind>.webp.
// Uses playwright-core and sharp from node_modules (npm i --no-save playwright-core sharp@0.33).
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import fs from 'fs';
import os from 'os';

const PORT = process.env.PORT || 5179;
const KINDS = ['jeep', 'vintage', 'camper', 'race', 'bike', 'heli'];
const exe = process.env.CHROMIUM || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1155/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/tools/cars/thumbs.html`);
await page.waitForFunction(() => window.ready);
fs.mkdirSync('public/vehicles', { recursive: true });
for (const kind of KINDS) {
  const png = await page.evaluate((k) => window.thumb(k), kind);
  const out = `public/vehicles/${kind}.webp`;
  await sharp(Buffer.from(png.split(',')[1], 'base64')).webp({ quality: 88, alphaQuality: 92 }).toFile(out);
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
}
await browser.close();
