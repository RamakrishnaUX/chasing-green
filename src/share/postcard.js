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

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function drawPostcard(canvas, s, image) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  await document.fonts?.ready;
  ctx.fillStyle = '#0d1520';
  ctx.fillRect(0, 0, W, H);
  if (image) {
    const ir = image.width / image.height, cr = W / H;
    let sw = image.width, sh = image.height, sx = 0, sy = 0;
    if (ir > cr) { sw = image.height * cr; sx = (image.width - sw) / 2; } else { sh = image.width / cr; sy = (image.height - sh) / 2; }
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, W, H);
  }
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, 'rgba(13,21,32,0)');
  g.addColorStop(1, 'rgba(13,21,32,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // White border like a printed card.
  ctx.strokeStyle = 'rgba(231,236,239,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, W - 56, H - 56);

  const pad = 72;
  ctx.fillStyle = '#e7ecef';
  ctx.font = '400 30px "Atkinson Hyperlegible", system-ui, sans-serif';
  ctx.fillText(`${s.place}   ${s.clock}, ${s.season.toLowerCase()} night`, pad, H - 214);
  ctx.font = '400 84px "Young Serif", Georgia, serif';
  ctx.fillText(`Sighting #${s.n}`, pad, H - 130);
  ctx.font = '400 28px "Young Serif", Georgia, serif';
  ctx.fillStyle = 'rgba(231,236,239,0.88)';
  wrap(ctx, captionFor(s), W - pad * 2 - 280).forEach((l, i) => ctx.fillText(l, pad, H - 84 + i * 34));

  // Stamp-like mark with the type and forecast.
  ctx.save();
  ctx.translate(W - 170, H - 160);
  ctx.rotate(-0.12);
  ctx.strokeStyle = '#5cf2a0';
  ctx.fillStyle = '#5cf2a0';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 86, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 76, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = '700 22px "Atkinson Hyperlegible", system-ui, sans-serif';
  ctx.fillText(s.type, 0, -8, 140);
  ctx.font = '400 40px "Young Serif", Georgia, serif';
  ctx.fillText(`Kp ${s.kp.toFixed(1)}`, 0, 34);
  ctx.restore();

  ctx.textAlign = 'right';
  ctx.font = '400 30px "Young Serif", Georgia, serif';
  ctx.fillStyle = '#e7ecef';
  ctx.fillText('Chasing Green', W - pad, 92);
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
