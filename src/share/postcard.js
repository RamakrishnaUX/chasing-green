// Draws a sighting postcard onto a canvas and handles sharing or saving it.

const PHRASES = {
  'Green arc': ['A quiet green arc hung low over', 'A soft band of green settled over', 'A single pale arc lay across the sky above'],
  'Green curtains': ['Green curtains rolled slowly over', 'Folds of green light drifted across', 'The sky over'],
  'Pink-topped curtains': ['Pink-edged curtains danced above', 'Green and rose light poured over', 'The curtains turned pink at the top above'],
  'Red aurora': ['A rare red aurora burned over', 'The sky went deep red above', 'Crimson light, the rare kind, spread over'],
  Corona: ['The lights met directly overhead at', 'A corona opened straight above', 'Rays poured down from one point above'],
};
const ENDINGS = ['while the radio held at Kp', 'with the radio reading Kp', 'as the forecast touched Kp'];

const QUIET = ['A quiet stop at', 'Pulled over for a while at', 'Watched the sky for a bit at'];
export function captionFor(s) {
  if (s.type === 'Sky' || s.type === 'Night sky') {
    const q = QUIET[s.n % QUIET.length];
    return s.type === 'Sky' ? `${q} ${s.place}. No lights yet, just the road and the sky.` : `${q} ${s.place}. Dark and clear, waiting for the lights at Kp ${s.kp.toFixed(1)}.`;
  }
  const list = PHRASES[s.type] || PHRASES['Green curtains'];
  const p = list[s.n % list.length];
  const e = ENDINGS[(s.n * 7) % ENDINGS.length];
  const tail = p.endsWith('The sky over') ? ` ${s.place} lit up green` : ` ${s.place}`;
  return `${p}${tail} ${e} ${s.kp.toFixed(1)}.`;
}

// The postcard, as a real one: the photo on the left with "Greetings from Iceland" across it,
// and the back on the right with a stamp in the corner (evenly perforated all round), a round
// postmark with cancellation lines running onto the stamp, a handwritten note, address lines
// and a small line of trip details. Landscape 3:2.
const INK = 'rgba(52, 58, 62, 0.72)';
const PAPER = '#efebe2';
const PEN = '#26315c';

// Cover-fit an image into a rectangle, cropping the overflow.
function cover(ctx, img, x, y, w, h, zoom = 1) {
  const ir = img.width / img.height, r = w / h;
  let sw = img.width, sh = img.height;
  if (ir > r) sw = img.height * r; else sh = img.width / r;
  sw /= zoom; sh /= zoom;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// The stamp: white paper with a hole every `step` px on all four sides, the same spacing on
// each side, so the corners match; a green aurora panel inside.
function stamp(cols, rows, step, bite) {
  const W = cols * step, H = rows * step, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, W, H);
  const m = step * 0.75, gr = g.createLinearGradient(0, m, 0, H - m);
  gr.addColorStop(0, '#174d3b'); gr.addColorStop(0.55, '#2c7f60'); gr.addColorStop(1, '#66dfb0');
  g.fillStyle = gr; g.fillRect(m, m, W - 2 * m, H - 2 * m);
  // A faint aurora band across the panel.
  g.strokeStyle = 'rgba(162,246,211,0.35)'; g.lineWidth = 10; g.lineCap = 'round';
  g.beginPath(); g.moveTo(m, H * 0.36); g.bezierCurveTo(W * 0.35, H * 0.18, W * 0.6, H * 0.5, W - m, H * 0.3); g.stroke();
  g.fillStyle = '#f4f8f6';
  g.font = `700 ${Math.round(step * 1.05)}px "Saira", system-ui, sans-serif`;
  if ('letterSpacing' in g) g.letterSpacing = '3px';
  g.textBaseline = 'top'; g.fillText('ÍSLAND', m + step * 0.5, m + step * 0.45);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  // Aurora glyph: a curtain over a hill line.
  g.strokeStyle = '#f4f8f6'; g.lineWidth = 3;
  const gx = m + step * 0.6, gy = H * 0.52;
  g.beginPath(); g.moveTo(gx, gy + 14); g.bezierCurveTo(gx + 14, gy - 16, gx + 26, gy + 10, gx + 34, gy - 6); g.bezierCurveTo(gx + 42, gy - 20, gx + 52, gy - 4, gx + 58, gy + 4); g.stroke();
  g.beginPath(); g.moveTo(gx, gy + 26); g.lineTo(gx + 58, gy + 26); g.stroke();
  g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.font = `700 ${Math.round(step * 1.4)}px "Saira", system-ui, sans-serif`;
  g.fillText('120 kr', W - m - step * 0.4, H - m - step * 0.45);
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  const hole = (x, y) => { g.beginPath(); g.arc(x, y, bite, 0, Math.PI * 2); g.fill(); };
  for (let i = 0; i <= cols; i++) { hole(i * step, 0); hole(i * step, H); }
  for (let j = 0; j <= rows; j++) { hole(0, j * step); hole(W, j * step); }
  return c;
}

// A round postmark: two rings, words around the edge, the date across the middle.
function postmark(ctx, x, y, r, rot, top, mid, bottom) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = INK; ctx.fillStyle = INK;
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 0, r * 0.64, 0, Math.PI * 2); ctx.stroke();
  const arcText = (text, radius, dir) => {
    const chars = [...text.toUpperCase()];
    const spread = Math.min(Math.PI * 0.95, chars.length * 0.14);
    const size = Math.min(r * 0.17, (spread * radius) / chars.length / 0.72);
    ctx.font = `700 ${Math.round(size)}px "Saira", system-ui, sans-serif`;
    chars.forEach((ch, i) => {
      const a = dir * (-spread / 2 + (spread * (i + 0.5)) / chars.length);
      ctx.save(); ctx.rotate(a); ctx.translate(0, -radius * dir);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
  };
  arcText(top, r * 0.82, 1);
  arcText(bottom, r * 0.82, -1);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 0.22)}px "Saira", system-ui, sans-serif`;
  ctx.fillText(mid[0], 0, -r * 0.13);
  ctx.fillText(mid[1], 0, r * 0.15);
  ctx.restore();
}

// Wavy cancellation lines.
function waves(ctx, x, y, w, rows, gap, amp) {
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  for (let k = 0; k < rows; k++) {
    ctx.beginPath();
    for (let i = 0; i <= w; i += 3) {
      const yy = y + k * gap + Math.sin((i / w) * Math.PI * 3 + k * 0.5) * amp;
      i ? ctx.lineTo(x + i, yy) : ctx.moveTo(x + i, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Break text into lines that fit a width.
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export async function drawPostcard(canvas, s, image) {
  canvas.width = 1500; canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  // The canvas only gets these fonts if they are loaded first; nothing else on screen uses Caveat.
  try { await Promise.all(['500 46px Caveat', '600 44px Caveat', '400 50px Michroma', '700 20px Saira', '600 17px Saira'].map((f) => document.fonts.load(f))); } catch { /* fall back */ }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

  // Paper, with a little grain.
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
  }

  // Front: the photo on the left.
  const PX = 26, PY = 26, PW = 830, PH = H - 52;
  ctx.fillStyle = '#0d1520'; ctx.fillRect(PX, PY, PW, PH);
  if (image) cover(ctx, image, PX, PY, PW, PH);
  // A dark fade at the foot of the photo so the greeting reads without a shadow.
  const fade = ctx.createLinearGradient(0, PY + PH * 0.62, 0, PY + PH);
  fade.addColorStop(0, 'rgba(4,10,9,0)'); fade.addColorStop(1, 'rgba(4,10,9,0.72)');
  ctx.fillStyle = fade; ctx.fillRect(PX, PY + PH * 0.6, PW, PH * 0.4);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.font = '400 50px "Michroma", "Saira", sans-serif';
  const g1 = 'Greetings from ';
  ctx.fillStyle = '#f4f8f6'; ctx.fillText(g1, PX + 40, PY + PH - 44);
  ctx.fillStyle = '#66dfb0'; ctx.fillText('Iceland', PX + 40 + ctx.measureText(g1).width, PY + PH - 44);

  // Back: a centre line.
  const BX = PX + PW + 34, BR = W - 48;
  ctx.strokeStyle = 'rgba(40,44,46,0.28)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(BX - 4, 70); ctx.lineTo(BX - 4, H - 70); ctx.stroke();

  // The stamp, top right, with a soft shadow.
  const step = 20, st = stamp(9, 11, step, 5.5), SX = BR - st.width, SY = 46;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  ctx.translate(SX + st.width / 2, SY + st.height / 2); ctx.rotate(0.02);
  ctx.drawImage(st, -st.width / 2, -st.height / 2);
  ctx.restore();

  // Postmark beside it, cancellation lines running onto the stamp.
  const d = new Date(s.date || Date.now());
  postmark(ctx, SX - 120, SY + 120, 82, -0.12, 'Reykjavík · Iceland', [`${d.getDate()} ${MONTHS[d.getMonth()]}`, String(d.getFullYear())], 'Aurora post');
  waves(ctx, SX - 40, SY + 92, 150, 4, 17, 6);

  // The note, in handwriting.
  ctx.fillStyle = PEN; ctx.textAlign = 'left';
  ctx.font = '500 46px "Caveat", "Bradley Hand", cursive';
  const NX = BX + 22, NW = BR - NX;
  const lines = wrap(ctx, `${captionFor(s)} Wish you were here.`, NW);
  let y = 392;
  for (const l of lines.slice(0, 5)) { ctx.fillText(l, NX, y); y += 58; }
  ctx.font = '600 44px "Caveat", "Bradley Hand", cursive';
  ctx.fillText('— from the Ring Road', NX, y + 6);

  // Address lines and the trip details.
  ctx.strokeStyle = 'rgba(40,44,46,0.3)'; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) { const ly = H - 210 + i * 52; ctx.beginPath(); ctx.moveTo(NX, ly); ctx.lineTo(BR, ly); ctx.stroke(); }
  ctx.fillStyle = 'rgba(40,44,46,0.62)';
  ctx.font = '600 17px "Saira", system-ui, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  let meta = `RING ROAD · ${s.place.toUpperCase()} · ${s.clock} · KP ${s.kp.toFixed(1)}`;
  if (ctx.measureText(meta).width > BR - NX) meta = `${s.place.toUpperCase()} · ${s.clock} · KP ${s.kp.toFixed(1)}`;
  ctx.fillText(meta, NX, H - 56);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
}

export function canvasBlob(canvas, type = 'image/png') {
  return new Promise((res) => canvas.toBlob(res, type, 0.92));
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export async function sharePostcard(canvas, s, link) {
  const blob = await canvasBlob(canvas);
  const file = new File([blob], `chasing-green-sighting-${s.n}.png`, { type: 'image/png' });
  const text = `${captionFor(s)} Sighting #${s.n} in Chasing Green.`;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Chasing Green', text, url: link });
      return 'shared';
    }
    if (navigator.share) { await navigator.share({ title: 'Chasing Green', text, url: link }); return 'shared'; }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  download(blob, file.name);
  return 'downloaded';
}
