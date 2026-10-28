// Road routing for "Drive there". The road polylines become a graph: points along a road join
// their neighbours, and points of different roads that meet (a road ending on another, or two
// roads crossing) join each other. Dijkstra finds the shortest way along it.
import { roadPaths } from './terrain.js';

const SPACING = 14; // keep a node about every 14 m: plenty for a guide line
const JOIN = 16; // nodes of two roads closer than this are a junction
const CELL = 64;

let graph = null;

function build() {
  const nodes = [];
  const hash = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  const add = (x, z, path) => {
    const id = nodes.length;
    nodes.push({ x, z, path, e: [] });
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    (hash.get(k) || hash.set(k, []).get(k)).push(id);
    return id;
  };
  const link = (a, b) => {
    if (a === b || nodes[a].e.some(([n]) => n === b)) return;
    const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
    nodes[a].e.push([b, d]); nodes[b].e.push([a, d]);
  };
  roadPaths.forEach((path, pi) => {
    const p = path.pts;
    let prev = add(p[0].x, p[0].z, pi), first = prev, run = 0;
    for (let i = 1; i < p.length; i++) {
      run += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
      if (run < SPACING && i < p.length - 1) continue;
      run = 0;
      const id = add(p[i].x, p[i].z, pi);
      link(prev, id);
      prev = id;
    }
    if (path.loop) link(prev, first);
  });
  // Junctions: join each node to the nearest node of every other road within reach.
  for (let a = 0; a < nodes.length; a++) {
    const n = nodes[a], cx = Math.floor(n.x / CELL), cz = Math.floor(n.z / CELL);
    const best = new Map(); // other path -> [node, distance]
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const b of hash.get(key(cx + i, cz + j)) || []) {
        if (nodes[b].path === n.path) continue;
        const d = Math.hypot(nodes[b].x - n.x, nodes[b].z - n.z);
        if (d < JOIN && (!best.has(nodes[b].path) || d < best.get(nodes[b].path)[1])) best.set(nodes[b].path, [b, d]);
      }
    }
    for (const [b] of best.values()) link(a, b);
  }
  return { nodes, hash, key };
}

function nearestNode(x, z) {
  const { nodes, hash, key } = graph;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let r = 1; r < 400; r *= 2) {
    let best = -1, bd = Infinity;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      for (const id of hash.get(key(cx + i, cz + j)) || []) {
        const d = Math.hypot(nodes[id].x - x, nodes[id].z - z);
        if (d < bd) { bd = d; best = id; }
      }
    }
    // A hit in the ring is only certainly the nearest once the search reaches past its distance.
    if (best >= 0 && bd <= r * CELL) return best;
  }
  return -1;
}

function dijkstra(s, t) {
  const { nodes } = graph;
  const dist = new Float64Array(nodes.length).fill(Infinity), from = new Int32Array(nodes.length).fill(-1);
  const heap = [[0, s]];
  dist[s] = 0;
  const push = (item) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === t) break;
    if (d > dist[u]) continue;
    for (const [v, w] of nodes[u].e) if (d + w < dist[v]) { dist[v] = d + w; from[v] = u; push([dist[v], v]); }
  }
  if (!isFinite(dist[t])) return null;
  const ids = [];
  for (let u = t; u !== -1; u = from[u]) ids.push(u);
  return ids.reverse();
}

// The way from one point to another: along the roads where they help, straight across the
// last stretch to a place off the road. Returns { pts: [{x, z}], length }.
export function planRoute(from, to) {
  graph ||= build();
  const s = nearestNode(from.x, from.z), t = nearestNode(to.x, to.z);
  let pts = [{ x: from.x, z: from.z }];
  const ids = s >= 0 && t >= 0 ? dijkstra(s, t) : null;
  const direct = Math.hypot(to.x - from.x, to.z - from.z);
  if (ids) {
    const road = ids.map((id) => ({ x: graph.nodes[id].x, z: graph.nodes[id].z }));
    let len = 0;
    for (let i = 1; i < road.length; i++) len += Math.hypot(road[i].x - road[i - 1].x, road[i].z - road[i - 1].z);
    // Skip the roads when going cross-country is much shorter (both ends far from any road).
    if (len < direct * 4 || direct > 600) pts = pts.concat(road);
  }
  pts.push({ x: to.x, z: to.z });
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return { pts, length };
}
