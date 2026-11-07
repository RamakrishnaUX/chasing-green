// A looping aurora over dark mountains, drawn with one fragment shader on its own canvas. It needs
// nothing from the game, so it can play from the first frame while the island is still loading.
const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
const fs = `
precision highp float;
uniform vec2 uRes; uniform float uT;
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(vec2(i, 0.0)), h(vec2(i + 1.0, 0.0)), f); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float rfbm(float x){ float s = 0.0, a = 0.55; for (int i = 0; i < 6; i++) { s += a * (1.0 - abs(n(x) * 2.0 - 1.0)); x = x * 2.1 + 3.7; a *= 0.48; } return s; }
float fbm(float x){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(x); x = x * 2.03 + 7.1; a *= 0.5; } return s; }
// One curtain: a wavy lower edge, light streaming up from it in vertical rays, folds of brightness along it.
vec3 curtain(vec2 uv, float t, float seed, float base, float amp, float bright) {
  float x = uv.x * 1.6 + seed;
  float edge = base + amp * (fbm(x * 0.9 + t * 0.035) - 0.5) + 0.05 * sin(x * 2.1 + t * 0.11 + seed)
    + 0.018 * sin(x * 9.0 + t * 0.35 + seed * 2.0) + 0.008 * sin(x * 23.0 - t * 0.5);
  float d = uv.y - edge;
  if (d < -0.02) return vec3(0.0);
  float lower = smoothstep(-0.012, 0.004, d);
  float rays = n(x * 38.0 + t * 0.25) * n(x * 11.0 - t * 0.12);
  // A thin bright hem, with rays streaming up from it.
  float rise = exp(-max(d, 0.0) * 14.0) * (0.6 + 0.4 * rays) + exp(-max(d, 0.0) * 3.2) * rays * rays * 0.9;
  float folds = 0.3 + 0.7 * smoothstep(0.25, 0.75, fbm(x * 2.2 - t * 0.06 + seed * 3.0));
  float I = lower * rise * folds * bright;
  // Green at the base turning violet-pink high up, as oxygen gives way to nitrogen.
  vec3 green = vec3(0.24, 1.0, 0.58), teal = vec3(0.1, 0.75, 0.7), pink = vec3(0.75, 0.32, 0.85);
  vec3 c = mix(green, teal, smoothstep(0.02, 0.18, d));
  c = mix(c, pink, smoothstep(0.14, 0.42, d) * 0.7);
  return c * I + green * exp(-max(d, 0.0) * 70.0) * lower * 0.5 * bright * folds;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  float t = uT;
  // Night sky: deep blue high up, a faint teal haze over the horizon.
  vec3 col = mix(vec3(0.03, 0.09, 0.09), vec3(0.012, 0.025, 0.045), smoothstep(0.2, 0.5, uv.y));
  col = mix(col, vec3(0.004, 0.008, 0.02), smoothstep(0.45, 1.0, uv.y));
  // Stars: sparse, of different brightness, twinkling a little.
  vec2 sp = gl_FragCoord.xy / 3.0; vec2 cell = floor(sp); vec2 fr = fract(sp) - 0.5;
  float s = h(cell), mag = h(cell + 3.1);
  float star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fr)) * (0.25 + 0.75 * mag * mag);
  float tw = 0.75 + 0.25 * sin(t * (0.8 + 2.0 * h(cell + 1.7)) + s * 40.0);
  col += vec3(0.86, 0.9, 1.0) * star * tw * smoothstep(0.25, 0.7, uv.y);
  // Aurora: three curtains at different depths, sliding and folding slowly.
  vec3 a = curtain(p, t, 0.0, 0.5, 0.22, 1.05) + curtain(p, t * 0.8, 5.3, 0.66, 0.16, 0.55) + curtain(p, t * 1.15, 11.7, 0.42, 0.14, 0.35);
  a *= smoothstep(-0.2, 0.55, 1.0 - abs(uv.x - 0.32) * 1.1); // brightest to the left, behind the title
  col += a * 0.85;
  // Glow on the horizon under the curtains.
  col += vec3(0.05, 0.22, 0.15) * exp(-abs(uv.y - 0.3) * 12.0) * 0.3 * smoothstep(1.0, 0.0, abs(uv.x - 0.35));
  // Mountains: a far range of sharp ridges with a thin rim of aurora light, a black range in front.
  float r1 = 0.16 + 0.2 * rfbm(p.x * 0.9 + 3.0);
  float r2 = 0.07 + 0.12 * rfbm(p.x * 1.6 + 11.0);
  if (uv.y < r1) col = vec3(0.005, 0.009, 0.012) + vec3(0.03, 0.12, 0.08) * smoothstep(r1 - 0.003, r1, uv.y) + vec3(0.006, 0.02, 0.018) * smoothstep(r1 - 0.1, r1, uv.y);
  if (uv.y < r2) col = vec3(0.003, 0.005, 0.007) + vec3(0.02, 0.07, 0.05) * smoothstep(r2 - 0.003, r2, uv.y);
  // Still water in front: the sky's glow, dim and softly broken.
  if (uv.y < 0.0) { float ry = 0.16 - uv.y; vec3 refl = curtain(vec2(p.x, ry), t, 0.0, 0.46, 0.22, 1.05) * 0.25; col = vec3(0.004, 0.008, 0.012) + refl * (0.6 + 0.4 * n2(vec2(p.x * 60.0, uv.y * 400.0 + t))); }
  // Filmic shoulder, a fine grain, and a little vignette.
  col = 1.0 - exp(-col * 1.35);
  col += (h(gl_FragCoord.xy + fract(t) * 100.0) - 0.5) * 0.012;
  col *= 1.0 - 0.35 * pow(length(uv - vec2(0.45, 0.55)), 2.2);
  gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);
}`;

// Draws until stop() is called. Pauses while the page is hidden. Returns { stop }.
export function startAuroraSky(canvas, { start = 40, maxDpr = 1.5 } = {}) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return { stop() {} };
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'uRes'), uT = gl.getUniformLocation(prog, 'uT');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  let raf = 0, running = true;
  const draw = () => {
    if (!running) return;
    const dpr = Math.min(devicePixelRatio, maxDpr), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform2f(uRes, w, h);
    // With reduced motion the sky holds still.
    gl.uniform1f(uT, start + (reduce ? 0 : (performance.now() - t0) / 1000));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(draw);
  };
  draw();
  return { stop() { running = false; cancelAnimationFrame(raf); gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
}
