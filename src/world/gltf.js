// Every .glb model in the game loads through here.
//
// On phones each picture inside a model is shrunk to 512 pixels at most before it reaches the
// graphics card. Phones draw the island at one pixel per point, where the car is a few hundred
// pixels across, so the difference does not show. The full-size pictures (up to 2048) came to
// several hundred megabytes, and iPhone closes a page that holds that much and loads it again
// from the start. A model loaded more than once (the person for the driver, the walker and the
// skydiver; the helmet; the helicopter on the start screen and in the game) shares one copy of
// each picture.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const MAX = 512;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const byKey = new Map(); // "url#image" -> THREE.Source, shared between loads of the same model

// Once a phone has a picture on the game's graphics card, the shrunk copy in the page (a canvas or
// bitmap, about a megabyte each) is let go: it is never read again, and on iPhone every one counts
// toward the memory that gets a page closed. releasePictures(renderer) does it (main.js calls it
// after Start and now and then when you are stopped), for each picture whose every texture the
// game's renderer has uploaded. The cars and the helicopter keep theirs: the start screen and the
// Garage draw them again in drawing contexts of their own. If a let-go picture were ever needed
// again (the graphics card's memory was lost), a 1 x 1 stand-in is uploaded instead of an error.
const users = new Map(); // THREE.Source -> Set of textures using it
let blank = null;
const freeable = (d) => d instanceof HTMLCanvasElement || (typeof ImageBitmap !== 'undefined' && d instanceof ImageBitmap) || d instanceof HTMLImageElement;
function track(t) {
  let set = users.get(t.source);
  if (!set) users.set(t.source, (set = new Set()));
  set.add(t);
}
export function releasePictures(renderer) {
  let n = 0;
  for (const [src, set] of users) {
    if (![...set].every((t) => renderer.properties.get(t).__webglTexture)) continue;
    const c = src.data;
    users.delete(src);
    if (!freeable(c)) continue;
    blank ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    src.data = blank;
    if (c instanceof HTMLCanvasElement) c.width = c.height = 0; // frees the canvas's memory at once
    else c.close?.(); // an ImageBitmap; a plain image is simply dropped
    for (const [k, v] of byKey) if (v === src) byKey.delete(k); // a later load decodes afresh
    n++;
  }
  return n;
}

export function loadGLTF(url) {
  return loader.loadAsync(url).then((g) => { if (isTouch) shrinkPictures(g, url); return g; });
}

function shrinkPictures(g, url) {
  const done = new Map(); // picture -> its (shrunk) source, within this load
  const seen = new Set(); // a texture used by several materials is seen once
  const json = g.parser.json;
  const fit = (t) => {
    if (seen.has(t)) return;
    seen.add(t);
    const img = t.image;
    if (!img) return;
    if (done.has(img)) { t.source = done.get(img); return; }
    // Which picture in the file this is. The models keep their pictures as WebP, which the file
    // names under that extension rather than in the usual place.
    const def = json.textures?.[g.parser.associations.get(t)?.textures], ext = def?.extensions || {};
    const image = def?.source ?? ext.EXT_texture_webp?.source ?? ext.EXT_texture_avif?.source ?? ext.KHR_texture_basisu?.source;
    const key = Number.isInteger(image) ? `${url}#${image}` : null;
    const kept = key && byKey.get(key);
    if (kept) { done.set(img, kept); t.source = kept; if (kept.data !== img) img.close?.(); return; }
    const w = img.width || 0, h = img.height || 0;
    if (w > MAX || h > MAX) {
      const s = MAX / Math.max(w, h), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      img.close?.(); // free the full-size picture now rather than whenever it is collected
      t.image = c;
      t.needsUpdate = true;
    }
    done.set(img, t.source);
    if (key) byKey.set(key, t.source);
  };
  const tracked = new Set();
  g.scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) for (const k in m) if (m[k]?.isTexture) fit(m[k]);
  });
  // Every texture now points at its final picture: note it, to be let go once uploaded.
  if (/car_|heli/.test(url)) return;
  g.scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) for (const k in m) { const t = m[k]; if (t?.isTexture && !tracked.has(t) && freeable(t.source.data)) { tracked.add(t); track(t); } }
  });
}
