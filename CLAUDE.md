# Chasing Green

A browser game: drive, fly, walk, swim and ride round Iceland chasing the aurora. Vite + Three.js
0.169, plain ES modules, no framework. Live at https://chasing-green.vercel.app; repo
RamakrishnaUX/chasing-green, branch `main`.

`README.md` (≈760 lines) is the full design record: how each system works and why. Don't read it
whole. `grep -n '^##' README.md` lists its sections; read only the one you need. Its "Project
structure" section maps every file. When you change how something behaves, update its section.

## Rules from the owner (always apply)

- **Every change: test, commit, push to `main`, deploy.** No branches or PRs unless asked.
- **Test with real input** (clicks, taps, keys, the touch buttons) at desktop (1280×800) **and**
  phone (844×390 landscape, touch) sizes. Hit-test every button you add. Phone mirrors desktop:
  every feature works on both.
- **Polish bar is Apple-level and realistic.** Real models, real motion clips and physically
  plausible behaviour, not placeholders.
- **Get assets yourself; don't ask permission.** Sketchfab and similar downloads go through the
  owner's signed-in browser (Brave, via the Claude in Chrome tools); files land in `~/Downloads`
  (sometimes as `.com.brave.Browser.*` temp files). Copy them out, then delete them. **Never enter
  a password or log in.** Credit CC-BY assets in `index.html` (the credits in Settings) and in the
  README's credits tables.
- **No leaderboard** for now.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `__test.html` (an untracked scratch file) or `downloads/` (source assets; ignored).

## Build, run, deploy

```bash
npx vite build                      # must pass before any test or deploy
npx vite preview --port 4173 --host 127.0.0.1   # or preview_start "chasing-green-preview"
```

Deploy from a clean copy of the committed tree (keeps untracked files out), with `$S` set to
your scratchpad:

```bash
D=$S/deploy-$(git rev-parse --short HEAD); rm -rf $D; mkdir -p $D; git checkout-index -a -f --prefix=$D/; cp -R .vercel $D/; cd $D && npx --yes vercel@latest --prod --yes
```

It prints JSON at the end; that's normal. Success is `Aliased https://chasing-green.vercel.app`.

## Testing (headless Chromium via playwright-core)

Keep test scripts in your scratchpad, not the repo. Set up once per session:
`npm i playwright-core` in a scratch folder. Chromium is at
`~/Library/Caches/ms-playwright/chromium-1155/chrome-mac/Chromium.app/Contents/MacOS/Chromium`.
Launch with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.

Boot sequence:

1. Seed settings: `localStorage['chasing-green:v1'] = {settings:{month, look:'classic', quality:'medium'}}`.
2. Load the page, click `#splash`, wait for `.is-ready` (attached, up to 5 min), then click it.

`window.chasingGreen` exposes the game for tests:

- **State:** `riding`, `walker`, `wildlife`, `jeep`, `heli`, `diver`, `clock`.
- **Placement:** `putCar(x,z,h)`, `walkerSet(x,z,h)`, `nearestRoad(x,z,r)`, `groundAt`, `waterLevelAt`.
- **Camera:** `camHold = true` freezes the game camera so you can place it yourself.
- **Weather:** `rain`, `snowFall`.

The README's "Testing from the browser console" section has more.

To keep context small:

- Check **numbers first** (bone and world positions, angles, speeds, logged each frame through
  `requestAnimationFrame`). Take screenshots only to confirm, and combine several into one grid image.
- **Reproduce the owner's exact view or screenshot before fixing.** If a bug is intermittent, loop
  the test (several runs, varied headings and positions) until it shows, and again after the fix.
- Run long test loops in the background or in a subagent; report only pass or fail and the key numbers.

Shell gotchas: no `timeout` command on this Mac, and foreground `sleep` is blocked (poll in a loop
instead). Read big files (`main.js` ≈3,100 lines, `style.css`, `terrain.js`) with `grep -n` and
line ranges, never whole.

## Where things are

- **Main loop, modes and input wiring:** `src/main.js`. The game state is spread across module-level
  variables there. The `window.chasingGreen` test API is near the end of the file.
- **Vehicles and the player:** `src/vehicle/`.
  - `jeep.js`, `heli.js`, `boat.js`: the cars, helicopter and boat.
  - `walker.js`: on foot, swimming and climbing.
  - `horseride.js`: riding.
  - `skydiver.js`: skydiving.
  - `driver.js`: the driver in the seat, plus shared bone helpers (`wpos`, `setWorldQuat`,
    `frameQuat`, `turnWorld`).
- **The world:** `src/world/`.
  - `terrain.js`: ground, roads and water levels.
  - `wildlife.js`: animal behaviour.
  - `animalRigs.js`: animal skeletons and clips.
  - `landmarks*.js`, `towns.js`, `stations.js`: places and fuel.
  - `sky.js`, `hd.js`, `post.js`: lighting and the realistic look.
- **Aurora:** `src/aurora/`. **UI:** `src/ui/` (HUD, menus as `sheet.js`, `photomode.js`,
  `minimap.js`). **Audio:** `src/audio/`.
- **Asset pipelines** (run from inside the project; they need its `node_modules`):
  - `tools/person/process.mjs` builds `public/models/person.glb`: Mixamo clips, retargeted, run
    in place.
  - `tools/animals/`, `tools/cars/`, `tools/heli/`: the animals, cars and helicopter.
  - Source files live in `downloads/`.

## Hard-won gotchas

- **Person model:**
  - Mixamo rig, T-pose bind facing +Z, Y up.
  - Bone names look like `mixamorigLeftArm_09`; `bonesOf()` (in `skydiver.js`) strips the
    prefix and the numeric suffix.
  - Pose limbs outright from rest frames (see `horseride.js`), not by nudging the idle clip, or
    their roll drifts.
- **Animal rig roots:** set the facing with `root.rotation.set(0, heading, 0)`. Never restore it
  from a quaternion and then set only `.y`. The Euler can come back as (π, y′, π) and the animal
  gets drawn facing the wrong way.
- **Rider's hands:** placed from the seat in the horse's heading frame. The horse's neck and
  withers bones swing too much to anchor to.
- **Clip speed matches ground speed** everywhere (walk, run, gallop, swim), so feet never skate.
  Root motion is removed in the asset tools.
