import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

// virtual:asset-list: every file the game downloads (public/models, sounds, music), so src/preload.js
// can fetch them all before Start. version changes whenever any of them does.
function assetList() {
  const ID = 'virtual:asset-list', RID = '\0' + ID;
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.startsWith('.') ? [] : [join(dir, e.name)]));
  return {
    name: 'asset-list',
    resolveId: (id) => (id === ID ? RID : null),
    load(id) {
      if (id !== RID) return null;
      const pub = join(process.cwd(), 'public');
      const files = ['models', 'sounds', 'music'].flatMap((d) => walk(join(pub, d))).sort();
      const h = createHash('sha1');
      for (const f of files) { const s = statSync(f); h.update(`${relative(pub, f)}:${s.size}:${s.mtimeMs}`); }
      const list = files.map((f) => relative(pub, f).split('\\').join('/'));
      return `export const files = ${JSON.stringify(list)};\nexport const version = ${JSON.stringify(h.digest('hex').slice(0, 10))};`;
    },
  };
}

// `npm run build` makes a normal multi-file build in dist/.
// `npm run build:single` inlines everything into one HTML file (handy for hosting a single page).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [assetList(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 900,
    target: 'es2020',
  },
}));
