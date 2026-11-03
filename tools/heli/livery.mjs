// Paint the agency markings off the helicopter's body texture: names, emblems, flags, roundels
// and tail numbers. Each patch is filled with the colour most common around its edge, so a
// marking on red becomes red and one on the grey stripes becomes grey.
// node tools/heli/livery.mjs <in.png> <out.png>
import sharp from 'sharp';

// Patches in a 1400-pixel view of the atlas: x0, y0, x1, y1.
const PATCHES = [
  [580, 0, 680, 80], [750, 10, 795, 280], [875, 90, 920, 355], [1165, 230, 1230, 295], [232, 298, 338, 385],
  [288, 425, 335, 505], [636, 560, 685, 630], [925, 395, 1015, 485], [1195, 565, 1255, 625], [865, 675, 910, 730],
  [838, 740, 940, 795], [780, 735, 835, 980], [955, 675, 1005, 915], [188, 730, 342, 775], [25, 815, 115, 920],
  [408, 922, 468, 983], [66, 1062, 124, 1120], [203, 1058, 343, 1098], [685, 880, 780, 925], [698, 945, 750, 1000],
  [572, 888, 603, 938], [1022, 1040, 1068, 1065], [890, 1118, 940, 1142], [352, 758, 385, 782], [226, 1192, 288, 1254],
  [312, 1232, 348, 1272], [965, 1212, 1003, 1253], [382, 1195, 408, 1295], [470, 1235, 495, 1295],
];

const [src, out] = process.argv.slice(2);
const img = sharp(src);
const { width: W, height: H } = await img.metadata();
const buf = await img.ensureAlpha().raw().toBuffer();
const k = W / 1400;
for (const [a, b, c, d] of PATCHES) {
  const x0 = Math.max(0, Math.floor(a * k)), y0 = Math.max(0, Math.floor(b * k)), x1 = Math.min(W - 1, Math.ceil(c * k)), y1 = Math.min(H - 1, Math.ceil(d * k));
  // The commonest colour on the edge, in coarse buckets, averaged within its bucket.
  const tally = new Map();
  const edge = (x, y) => {
    const i = (y * W + x) * 4, key = (buf[i] >> 4) << 8 | (buf[i + 1] >> 4) << 4 | buf[i + 2] >> 4;
    const t = tally.get(key) || [0, 0, 0, 0]; t[0]++; t[1] += buf[i]; t[2] += buf[i + 1]; t[3] += buf[i + 2]; tally.set(key, t);
  };
  for (let x = x0; x <= x1; x++) { edge(x, y0); edge(x, y1); }
  for (let y = y0; y <= y1; y++) { edge(x0, y); edge(x1, y); }
  const [n, r, g, bl] = [...tally.values()].sort((p, q) => q[0] - p[0])[0];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * W + x) * 4; buf[i] = r / n; buf[i + 1] = g / n; buf[i + 2] = bl / n;
  }
}
await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().png().toFile(out);
console.log('cleaned', PATCHES.length, 'markings ->', out);
