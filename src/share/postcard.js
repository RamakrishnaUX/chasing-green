// Draws a sighting postcard onto a canvas and handles sharing or saving it.

const PHRASES = {
  'Green arc': ['A quiet green arc hung low over', 'A soft band of green settled over', 'A single pale arc lay across the sky above'],
  'Green curtains': ['Green curtains rolled slowly over', 'Folds of green light drifted across', 'The sky over'],
  'Pink-topped curtains': ['Pink-edged curtains danced above', 'Green and rose light poured over', 'The curtains turned pink at the top above'],
  'Red aurora': ['A rare red aurora burned over', 'The sky went deep red above', 'Crimson light, the rare kind, spread over'],
  Corona: ['The lights met directly overhead at', 'A corona opened straight above', 'Rays poured down from one point above'],
};
const ENDINGS = ['while the radio held at Kp', 'with the radio reading Kp', 'as the forecast touched Kp'];

export function captionFor(s) {
  const list = PHRASES[s.type] || PHRASES['Green curtains'];
  const p = list[s.n % list.length];
  const e = ENDINGS[(s.n * 7) % ENDINGS.length];
  const tail = p.endsWith('The sky over') ? ` ${s.place} lit up green` : ` ${s.place}`;
  return `${p}${tail} ${e} ${s.kp.toFixed(1)}.`;
}

// The postcard is a perforated paper stamp laid over a blurred copy of the sky: a serif
// "Postcard from <place>" title, the photo set in the middle, two inked postmarks and wavy
// cancellation lines. Portrait 4:5, ready for sharing.
const INK = 'rgba(28, 30, 34, 0.78)';
const PAPER = '#ece7dc';

// Cover-fit an image into a rectangle, cropping the overflow.
function cover(ctx, img, x, y, w, h, zoom = 1) {
  const ir = img.width / img.height, r = w / h;
  let sw = img.width, sh = img.height;
  if (ir > r) sw = img.height * r; else sh = img.width / r;
  sw /= zoom; sh /= zoom;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// A soft blur that works in every browser: shrink, then stretch back with smoothing.
function blurred(img, W, H) {
  const small = document.createElement('canvas');
  small.width = Math.round(W / 14); small.height = Math.round(H / 14);
  const s = small.getContext('2d');
  s.imageSmoothingQuality = 'high';
  cover(s, img, 0, 0, small.width, small.height, 1.15);
  return small;
}

// The stamp: paper with semicircle bites along every edge, plus a little grain.
function stamp(W, H, bite, step) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  // Grain.
  for (let i = 0; i < W * H / 60; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)';
    g.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
  }
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000'; // holes need a solid colour, or they only partly cut through
  const holes = (len, at) => { const n = Math.round(len / step); const d = len / n; for (let i = 0; i <= n; i++) at(i * d); };
  const hole = (x, y) => { g.beginPath(); g.arc(x, y, bite, 0, Math.PI * 2); g.fill(); };
  holes(W, (x) => { hole(x, 0); hole(x, H); });
  holes(H, (y) => { hole(0, y); hole(W, y); });
  return c;
}

// A round postmark: two rings, the place around the edge and the date across the middle.
function postmark(ctx, x, y, r, rot, top, mid, bottom) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2); ctx.stroke();
  // dir 1 runs along the top edge, dir -1 along the bottom edge; both read left to right.
  const arcText = (text, radius, dir) => {
    ctx.font = `700 ${Math.round(r * 0.2)}px "Atkinson Hyperlegible", system-ui, sans-serif`;
    const chars = [...text.toUpperCase()];
    const spread = Math.min(Math.PI * 0.9, chars.length * 0.16);
    chars.forEach((ch, i) => {
      const a = dir * (-spread / 2 + (spread * (i + 0.5)) / chars.length);
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -radius * dir);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
  };
  arcText(top, r * 0.83, 1);
  arcText(bottom, r * 0.83, -1);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 0.24)}px "Atkinson Hyperlegible", system-ui, sans-serif`;
  ctx.fillText(mid, 0, 0);
  ctx.restore();
}

// Wavy cancellation lines.
function waves(ctx, x, y, w, rows, gap, amp) {
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (let k = 0; k < rows; k++) {
    ctx.beginPath();
    for (let i = 0; i <= w; i += 4) {
      const yy = y + k * gap + Math.sin((i / w) * Math.PI * 2.2 + k * 0.4) * amp;
      i ? ctx.lineTo(x + i, yy) : ctx.moveTo(x + i, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Shrink a font until the text fits the width.
function fitFont(ctx, text, maxW, size, family) {
  let s = size;
  do { ctx.font = `400 ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 20);
}

export async function drawPostcard(canvas, s, image) {
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  await document.fonts?.ready;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

  // Background: the same sky, blurred and dimmed, filling the card.
  ctx.fillStyle = '#0d1520';
  ctx.fillRect(0, 0, W, H);
  if (image) ctx.drawImage(blurred(image, W, H), 0, 0, W, H);
  ctx.fillStyle = 'rgba(8, 14, 22, 0.18)';
  ctx.fillRect(0, 0, W, H);

  // The stamp, with a soft shadow so it sits on the photo.
  const SX = 110, SY = 135, SW = W - 220, SH = H - 270;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
  ctx.drawImage(stamp(SW, SH, 26, 66), SX, SY);
  ctx.restore();

  // Title.
  const serif = '"Young Serif", Georgia, "Times New Roman", serif';
  ctx.fillStyle = '#16181b';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  ctx.font = `400 46px ${serif}`;
  ctx.fillText('POSTCARD FROM', W / 2, SY + 150);
  fitFont(ctx, s.place.toUpperCase(), SW - 140, 46, serif);
  ctx.fillText(s.place.toUpperCase(), W / 2, SY + 206);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  // The photo, set into the middle of the stamp.
  const PW = 470, PH = 560, PX = (W - PW) / 2, PY = SY + 270;
  ctx.fillStyle = '#0d1520';
  ctx.fillRect(PX, PY, PW, PH);
  if (image) cover(ctx, image, PX, PY, PW, PH);

  // Postmarks and cancellation lines, inked over the edges like the real thing.
  const d = new Date(s.date || Date.now());
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
  postmark(ctx, PX - 40, PY + 120, 72, -0.18, 'Iceland', date, 'Chasing Green');
  postmark(ctx, PX + PW + 6, PY + PH + 36, 66, 0.22, `Kp ${s.kp.toFixed(1)}`, s.clock, s.type);
  waves(ctx, PX + 30, PY + PH + 30, 230, 3, 26, 9);

  // A small line at the foot of the stamp.
  ctx.fillStyle = 'rgba(22,24,27,0.72)';
  ctx.font = '700 22px "Atkinson Hyperlegible", system-ui, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillText(`NO. ${s.n}  ·  ${s.type.toUpperCase()}  ·  ${s.season.toUpperCase()}`, W / 2, SY + SH - 56);
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
