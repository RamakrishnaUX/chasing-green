// Weld a triangle soup by quantised position and UV; report how many vertices remain.
export function weldQuantized(doc, prim, { pq = 1e-4, uq = 1e-3 } = {}) {
  const P = prim.getAttribute('POSITION'), U = prim.getAttribute('TEXCOORD_0'), n = P.getCount();
  const pa = P.getArray(), ua = U ? U.getArray() : null, map = new Map(), remap = new Uint32Array(n), keep = [];
  const ext = Math.max(...P.getMax([]).map((v, i) => v - P.getMin([])[i]));
  for (let i = 0; i < n; i++) {
    let k = Math.round(pa[i * 3] / ext / pq) + ',' + Math.round(pa[i * 3 + 1] / ext / pq) + ',' + Math.round(pa[i * 3 + 2] / ext / pq);
    if (ua) k += '|' + Math.round(ua[i * 2] / uq) + ',' + Math.round(ua[i * 2 + 1] / uq);
    let j = map.get(k); if (j === undefined) { j = keep.length; map.set(k, j); keep.push(i); } remap[i] = j;
  }
  for (const s of prim.listSemantics()) {
    const a = prim.getAttribute(s), es = a.getElementSize(), src = a.getArray(), dst = new src.constructor(keep.length * es);
    keep.forEach((i, j) => { for (let c = 0; c < es; c++) dst[j * es + c] = src[i * es + c]; });
    prim.setAttribute(s, doc.createAccessor().setType(a.getType()).setArray(dst).setNormalized(a.getNormalized()).setBuffer(a.getBuffer()));
  }
  const I = prim.getIndices(); const idx = I ? I.getArray() : null; const m = idx ? idx.length : n; const out = new Uint32Array(m);
  for (let i = 0; i < m; i++) out[i] = remap[idx ? idx[i] : i];
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(out).setBuffer(P.getBuffer()));
  return keep.length;
}
// Smooth, area-weighted vertex normals (seams by UV get the same normal, by position).
export function smoothNormals(doc, prim) {
  const P = prim.getAttribute('POSITION').getArray(), I = prim.getIndices().getArray(), n = P.length / 3;
  const key = new Map(), group = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const k = P[i * 3].toFixed(5) + ',' + P[i * 3 + 1].toFixed(5) + ',' + P[i * 3 + 2].toFixed(5); let g = key.get(k); if (g === undefined) { g = key.size; key.set(k, g); } group[i] = g; }
  const acc = new Float32Array(key.size * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { const g = group[v] * 3; acc[g] += nx; acc[g + 1] += ny; acc[g + 2] += nz; }
  }
  const N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const g = group[i] * 3, l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1; N[i * 3] = acc[g] / l; N[i * 3 + 1] = acc[g + 1] / l; N[i * 3 + 2] = acc[g + 2] / l; }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(prim.getAttribute('POSITION').getBuffer()));
}
