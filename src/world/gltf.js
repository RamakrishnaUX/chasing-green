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
  g.scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) for (const k in m) if (m[k]?.isTexture) fit(m[k]);
  });
}
