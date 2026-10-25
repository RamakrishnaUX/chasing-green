# Chasing Green

A quiet road trip around Iceland. There is no score, no timer and nothing to fight. The only goal is to see the northern lights.

Drive. Wait. Look up.

## Setup

You need Node 18 or newer.

```bash
npm install
npm run dev        # local dev server with hot reload
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

There is also `npm run build:single`, which inlines everything into one HTML file in `dist-single/`. Use it when a host only accepts a single page. In that build, share links use `#s.CODE` instead of `?s=CODE`, because some hosted viewers only pass the hash through to the page.

## Deploying to Vercel

Push the repo to GitHub and import it in Vercel. Vercel detects Vite on its own, so the defaults work: build command `npm run build`, output directory `dist`. There is no backend and nothing to configure. Share links (`?s=...`) work on any static host because they are read in the browser.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Drive | WASD or arrow keys | Left and right buttons, Go (play button) and Brake |
| Handbrake | Shift | |
| Change camera (chase, look up, step out) | C | Menu, Settings, Camera |
| Look up (quick toggle) | L | Look button (glows green when the aurora is out) |
| Capture a postcard | Click the shutter while looking up | Tap the shutter while looking up (postcards also save on their own when the aurora is out, again at each new place) |
| Sit down (on foot) | X | Sit button |
| Look around | Drag with the mouse | Drag with a finger |
| Switch car | V, or click the car | Tap the car, or Menu, Cars |
| Map and fast travel | M | Tap the minimap |
| Learn about the aurora | H, or any (i) on the radio | Menu, Learn, or any (i) on the radio |
| Field notebook | N | Notebook button |
| Record a 15 second clip | R | Menu, Settings, Record |
| Mute | U | Menu, Settings, Sound |
| Nitro boost (on by default, can be turned off in Settings) | Space | Slide up from Go; the ring around Go shows the tank |

There is no race and no timer. Nitro is a speed boost that is on by default; you can switch it off in Settings.

**Step out and sit.** Park, press C until you are on foot, walk anywhere near the car (black sand at Reynisfjara and Diamond Beach included), then press X to sit. Sitting lowers the view, lets you look freely, and makes time pass six times faster so you can wait for the sky. Press X again or start walking to stand up.

## Cars

| Car | Looks | Handling | Deepest water |
| --- | --- | --- | --- |
| Trail 4x4 | Four-door off-roader in lime green: seven-slot grille, round LED lamps, roll bar, tube doors, snorkel, winch with red strap, beadlock wheels on mud-terrain tyres | Balanced, best on gravel, mud and fords | 1.9 m |
| Vintage roadster | 1930s two-seater in maroon and cream: long fenders, finned chrome radiator, spotlamps, side exhausts, wire wheels with whitewalls, cream leather, wood wheel | Slow and soft, with lots of body roll | 0.6 m |
| Supercar | Low orange hypercar: carbon splitter and intake, side intakes, wide haunches, wraparound light strips, black multi-spoke wheels, tinted cabin | Fast and stiff, poor off-road | 0.3 m |
| Camper van | Split-window camper, white over mint and 1.4 times the size of the other cars: wide raked windscreen, round lamps, louvred side window, white bumpers, mint wheels with white caps, and an AURORA graffiti piece in yellow, orange and pink over a violet burst down both sides, tagged "chasing green" | Slow and steady, fine on gravel | 1.0 m |

Handling lives in `src/vehicle/specs.js` (including suspension stiffness), and the models are built in code in `src/vehicle/models.js`. There are no brand logos; the 4x4 wears a plain "Trail" badge.

## Months

Pick the month on the start screen or in Settings. It defaults to the real current month. Each month uses approximate Reykjavík sunrise and sunset times and noon sun height, which set daylight, how dark the night gets, and the aurora chance. A month card shows daylight hours, hours dark enough for aurora, the chance (low, medium or high) and a tip.

- September to April: good chances, with the equinox months a little more active.
- May and August: low chances, short or bright nights.
- June and July: midnight sun. The radio says so, and no aurora appears.

Switching month updates the sky, light and forecast straight away. Month data lives in `CONFIG.months` in `src/config.js`.

## Learning about the aurora

Every term on the radio has an (i) button: Kp, the forecast, Activity, Clouds, Darkness and City glow. Each opens the Learn panel at that entry, written in two or three plain sentences, some with a small drawing. The panel also covers aurora types and the solar wind and magnetosphere, and has a six-step "How auroras work" lesson. The text lives in `src/ui/learn.js`.

## Landmarks

55 landmarks are on the map and built in the world, each with a one-line description, a short legend where there is one, and a shareable fact on its info card. The card opens small (the name, plus the one-liner on desktop) and More shows the legend and the fact. Settings, Place cards chooses when it pops up: for every place, only for places not yet stamped (the default on phones), or never:

Reykjavík district (Hallgrímskirkja, Harpa, Sun Voyager, Perlan, the Laugavegur rainbow street), Seyðisfjörður (the blue church and its rainbow street), Dynjandi and Ísafjörður in the Westfjords, Siglufjörður, Háifoss, Landmannalaugar, Kvernufoss, Öxarárfoss, Silfra, Barnafoss with Hraunfossar, Sólheimajökull, the Sólheimasandur plane wreck (a stripped DC-3 on a plain of black sand), Víkurfjara, Secret Lagoon, Friðheimar, Hvammsvík, Reykjadalur, the Bridge Between Continents, Búðakirkja, Arnarstapi, Hvítserkur, Dimmuborgir, Grjótagjá, Mývatn Nature Baths, GeoSea, Blue Lagoon, Þingvellir, Strokkur Geyser (erupts every minute or two, with a bulging-water warning first), Gullfoss, Kerið Crater, Seljalandsfoss, Gljúfrabúi, Skógafoss (with its stairway), Dyrhólaey, Reynisfjara, Vík í Mýrdal, Eldhraun, Fjaðrárgljúfur, Skaftafell, Svartifoss, Jökulsárlón, Diamond Beach, Hengifoss, Stuðlagil, Dettifoss, Ásbyrgi, Húsavík, Goðafoss, Hverir, Mývatn, Hveravellir and Kirkjufell.

They sit on the Ring Road or a detour: Reykjanes (Blue Lagoon), the Reykjavík waterfront, the Golden Circle, Snæfellsnes, Dyrhólaey, Fjaðrárgljúfur, Skaftafell, Hengifoss, Jökuldalur (Stuðlagil), the Diamond Circle (Húsavík, Ásbyrgi, Dettifoss) and Kjölur (Hveravellir). Positions come from approximate real coordinates. The Reykjavík sights are really within 2 km of each other, so they are spread out a little at the game's scale. Towns have houses, and Reykjavík and Akureyri have lit apartment blocks.

## How the aurora system works

Everything lives in `src/aurora/forecast.js` and is tuned from `src/config.js`.

**The forecast.** Each night (noon to noon) gets its own seeded curve on a 0 to 9 scale, like Kp. It starts from a quiet base level, then adds two to four activity windows, which are bell-shaped bumps placed somewhere in the dark hours. About one night in ten also gets a big storm window. The radio shows what has happened so far tonight as a solid green line, and a dashed prediction ahead. The prediction is deliberately fuzzy, and gets fuzzier the further ahead it looks.

**The four conditions.** The aurora only appears when all of these are true at the player's position:

1. It is dark. Darkness comes from the sun's elevation, which depends on the season. Winter gives about 15 hours of usable dark, with a low golden sun the rest of the day. Summer has the midnight sun, so the aurora never shows.
2. The local cloud cover is below the threshold. Clouds are a drifting noise field. The south coast leans cloudy and the north and highlands lean clear.
3. The forecast is at or above the minimum (Kp 3 by default).
4. You are away from city light. Reykjavík and, more faintly, Akureyri wash the aurora out near town.

**What you see.** Visibility sets the brightness. The forecast also sets how many curtains appear (one to four), when the tops turn pink (around Kp 5 to 6), and when red shows (Kp 7 and up). A corona can open directly overhead at Kp 6 and up, but only rarely and only under a clear sky. The display eases in and out over a few seconds, so it breathes rather than switching on.

**The first night guarantee.** For a brand new player with no sightings, a modest window opens 8 in-game hours into the first night (8 real minutes at normal speed). It lifts the forecast to about Kp 4.3 and thins the clouds around the player. It stays open until a sighting is logged or nine more in-game hours pass. Players still need to get out of the city glow and look up, so it feels earned. It never runs in summer.

**Logging a sighting.** Look up while the aurora is active, facing roughly north or close to straight overhead, and hold the view for 3 seconds. The sighting is logged with its number, place, time, forecast and type. The same display can't be logged twice in a row, unless it upgrades to a rarer type (a corona during a green display, say) or four minutes pass.

**Daily challenge.** Each date picks one challenge from a seeded list in `src/challenges.js`. On days when the challenge is "Find a red aurora", the storm chance goes up so it is actually possible.

## How the world is drawn

Everything is generated in code. There are no image or model files.

- **Terrain.** A heightmap of rolling golden plains with big mountain massifs: ridged crests, flat-topped table mountains and layered basalt terraces. A road distance field keeps open plains along every road, so the classic view is always road, plains, then mountains behind. Ice caps sit on top as smooth domes.
- **Surface shading.** The terrain shader paints grass, hay fields, earth, layered rock, scree, snow on ledges and upper slopes, black sand, lava moss and glacier ice from slope, height and noise. Fine detail and bump only appear up close, so distant slopes stay clean.
- **Grass.** A field of tens of thousands of thin blades that follows the camera on the GPU. It reads terrain height and a "where grass grows" map, so it stops at roads, shoulders, sand, water and ice, and it sways with the game's wind.
- **Roads.** Dark grainy asphalt with white edge lines, a dashed centre line, gravel shoulders and yellow marker posts. Highland tracks are gravel with ruts.
- **Sky and light.** A physically based daytime sky (Preetham scattering), baked into an environment map that lights and reflects the whole scene. There are sun shadows, lit clouds and distance haze. At night a separate sky takes over with stars, moon, city glow and the aurora.
- **Water.** A custom shader reads the terrain under the water to get its depth: shallow turquoise over sand, deep blue further out, moving caustic light in the shallows, foam where water meets the shore and rocks, and sky reflections. The sea, the glacier lagoon, the clear lakes, Kerið and the Blue Lagoon each have their own colours. Rivers flow, with visible direction and white rapids where they drop.
- **Waterfalls.** Curved, streaked water sheets that arc off the lip, a churning foam boil in the pool, wet dark rock and moss around them, and lit mist that drifts with the wind.
- **Cloud shadows** drift over the land and grass, and each car has a soft contact shadow.
- **Details.** Farms with red roofs, barns, fences and birch groves, weathered boulders, and glacier ice built as faceted crystals with hard edges. Farm windows light up after dark.
- **The character** on foot is an articulated figure: hooded jacket, backpack, arms and legs with elbows and knees, a proper walk cycle and a sitting pose.
- **Post-processing** (medium and high quality). Subtle bloom for the sun, headlights and aurora, then a light colour grade, vignette and film grain.

### Quality presets

| Preset | Grass | Sun shadows | Post-processing | Notes |
| --- | --- | --- | --- | --- |
| Low | 9,000 clumps, 26 unit radius | Off | Off | Default on phones and tablets. Draw distance 1,500 |
| Medium | 30,000 clumps, 44 unit radius | 2048 map | On | Default on desktop. Draw distance 2,300 |
| High | 64,000 clumps, 62 unit radius | 4096 map, wider area | On, with ambient occlusion | For dedicated GPUs. Draw distance 3,200 |

**Rock density** (Few, Normal or Many) is in Settings and applies on the next load. Normal has about 73% fewer rocks than earlier versions; rocks gather in clusters near slopes, cliffs, the coast and lava, never on roads or shoulders.

If the frame rate stays under 40, the game drops one preset by itself (unless you picked one in Settings). Terrain detail changes apply on the next load.

## Tuning in `src/config.js`

Change a value, save, and the dev server reloads.

| You want | Change |
| --- | --- |
| More or fewer nights with lights | `forecast.baseMin`, `forecast.baseMax`, `forecast.windowAmpMin`, `forecast.windowAmpMax` |
| More activity windows per night | `forecast.windowsMin`, `forecast.windowsMax` |
| Longer or shorter displays | `forecast.windowWidthHours` |
| More big storms (pink, red, corona) | `forecast.stormChance`, `forecast.stormAmp` |
| A less reliable radio | `forecast.forecastNoise` |
| Aurora at lower activity | `aurora.minKp` (and `aurora.fullKp` for when it reaches full strength) |
| Cloudier or clearer skies overall | `clouds.globalBias` (positive is cloudier) |
| Cloud systems that move faster | `clouds.driftSpeed`, `clouds.driftDirection` |
| Bigger or smaller cloud systems | `clouds.scale` |
| Regional weather | `clouds.southBias`, `clouds.northBias` |
| How much a gap in the clouds must clear | `aurora.maxCloud` |
| Stronger or weaker city glow | `cities` (radius and strength) and `aurora.cityGlowPenalty` |
| The first night window | `aurora.guarantee` |
| Faster days | `time.secondsPerGameHour` |
| Brighter or darker overall | `exposure` |
| Higher or lower winter sun | `time.seasons.Winter.maxSunElevation` |
| Grass density and reach | `quality.*.grass`, `quality.*.grassRadius` |

### Testing from the browser console

The game exposes a small helper as `chasingGreen`:

```js
chasingGreen.clock.gameHours = 23;       // jump to 23:00
chasingGreen.clock.speed = 0;            // freeze time
chasingGreen.forecast.debugKp = 7.5;     // force the forecast
chasingGreen.forecast.debugCloud = 0;    // force a clear sky
chasingGreen.teleport('jokulsarlon');    // jump to a landmark (call with no id to list them)
chasingGreen.forecast.debugKp = null;    // back to the simulation
chasingGreen.photo(64.86, -22.75);       // stand on the road at a latitude and longitude, eye height
```

## Project structure

```
src/
  main.js            game loop, cameras, sightings, landmarks, UI wiring
  config.js          every tunable number
  storage.js         localStorage for sightings, thumbnails, stamps, settings
  challenges.js      daily challenge from the date seed
  world/
    geo.js           coastline, roads, fords, lakes, ice caps, place names
    terrain.js       heightmap, terrain mesh, roads, water, spatial queries
    noise.js         simplex noise and a seeded random number generator
    sky.js           daytime scattering sky, night sky, clouds, lighting, fog, environment map
    time.js          game clock and seasonal sun path
    landmarks.js     landmark list, waterfalls, mist, lagoon ice, colliders
    landmarks_more.js  models for the newer landmarks (churches, Harpa, geyser, canyons and more)
    towns.js         houses and apartment blocks
    materials.js     terrain, road and water shaders
    grass.js         GPU grass field that follows the camera
    props.js         farms, fences and birch groves
    scatter.js       boulders
    post.js          bloom, colour grade, vignette
    obstacles.js     solid rocks, cliffs, buildings and trees
    effects.js       road puddles, spray and dust particles
  aurora/
    forecast.js      Kp curve, clouds, city light, visibility rules, aurora type
    aurora.js        raymarched curtain shader on a sky dome
  vehicle/
    jeep.js          jeep model and driving physics
    walker.js        step-out character
    models.js        the three car models, built in code
    specs.js         handling, wading depth and nitro for each car
    input.js         keyboard, touch buttons, drag to look
  ui/
    hud.js           radio, compass, readouts, toasts, look-up meter
    notebook.js      sightings, stamps, today's challenge
    minimap.js       minimap, full map and fast travel
    learn.js         Learn panel entries and the How auroras work lesson
    style.css
  audio/
    audio.js         procedural wind, water, ice and engine, the music player, and the volume groups
  share/
    postcard.js      postcard image, caption, share and save
    link.js          encode a sighting into a URL
    recorder.js      15 second clip capture
```

## Scale

The island is 2.4 times bigger than the original in both directions, so a lap of the Ring Road is about 7,900 units instead of 3,300, and every drive takes correspondingly longer. The scale lives in `WS` in `src/world/geo.js`; terrain resolution, lakes, ice caps, city glow, the minimap and the clouds all follow it.

The road from Egilsstaðir to Seyðisfjörður is a long hairpin climb over the Fjarðarheiði pass, as the real Route 93 is. The road has its own smooth height profile (`profile: 'pass'` and `summit` on the road in `src/world/geo.js`), so it rises to a summit at a drivable gradient and drops back to the fjord, while the mountains beside it (`PASSES`) climb past the snow line. The blue church and the rainbow street sit down by the water at the end.

## Jumps, bridges and handling

- **Nitro** is on by default: hold Space. It can be switched off in Settings.
- **Jumps:** four sharp road crests on long straights (south coast, Kjölur, near Mývatn, the north). At speed the car takes off, flies with no steering or throttle, and lands with a suspension squash; hard landings bounce once, scrub speed, thud and knock the camera. Jump points live in `JUMPS` in `src/world/geo.js` and snap to the nearest road.
- **Bridges** on five real Ring Road river crossings (Þjórsá, Markarfljót, Gígjukvísl, Jökulsá á Fjöllum, Hvítá): a carved valley with a flowing river, a level concrete deck on piers, and solid steel railings. `BRIDGES` in `src/world/geo.js`.
- **Steering** eases in, is gentler at speed, and the chase camera follows a smoothed heading.
- **Roads** are smoothed over long distances with a gradient limit (7% on tarmac, 12% on gravel). Marker posts and fence posts are checked against every road, junction and bridge.

## Kerið and Hallgrímskirkja

- **Kerið** is one shared shape (`KERID`, `keridProfile` in `src/world/geo.js`) used by both the land the car drives on and the detailed surface you see: an oval crater on a low mossy hill, red scoria walls with moss and scree streaks, a dark lava ledge band, a scree apron with boulders, a teal lake, and the red rim path.
- **Hallgrímskirkja** has fluted organ-pipe wings stepping down in a concave curve and bending back along the nave, a ribbed tower with slit windows and three clock faces, a belfry with pointed openings, a stepped crenellated top with a gold cross, the stained-glass lancet over the door with its red emblem, low railings and patterned paving. At night it is uplit, brightest at the base.

## Water

Cars ford shallow water with their wheels under and the body above the surface, at reduced speed. The Trail 4x4 fords up to 2.8 m, the roadster 0.95 m and the supercar 0.55 m.

## Grounding

Nothing should float. Before any built landmark (buildings, churches, pools, waterfalls, geysers, caves, bridges) is placed, the land under it is levelled into a pad that fades out at the edge and stays clear of roads. Houses sit on their highest corner with a foundation down to the lowest. A parked car holds still: below walking pace with no throttle, wind and slopes no longer creep it along.

Nothing can be driven into, either. Landmark landforms (Kirkjufell, sea stacks, cliffs, lava pillars and hummocks, crater rims, ice) are traced into a height map when the world is built (`src/world/solids.js`), and the ground under wheels and boots is the land or the landform on top, whichever is higher. Slopes up to about 50 degrees are driven or walked up like any hill; anything steeper is a wall. A sample under the middle of the car keeps small lumps between the wheels from poking through the floor. Buildings, caves, pools, bridges and the plane wreck keep their walls instead, and no landform sits on a road.

## Performance

- Landmarks, farms and the car are built from many small parts. Once their collisions are read, static parts that share a material are merged into one mesh (`src/world/bake.js`), which took the scene from about 5,500 meshes to about 1,600 and cut draw calls roughly in half. Moving parts (wheels, mud bubbles, the geyser) and see-through or locally shaded materials are left as they are.
- Dynamic resolution: when frames run long the game draws fewer pixels (down to 60% of the preset, never below 0.55 of a CSS pixel) and steps back up when there is room. Only if that is not enough does it drop the quality preset.
- Bloom only runs from dusk on, when lights and the aurora need it, and Medium uses 2x instead of 4x multisampling.

## Weather and snow

The snow line follows the month: down to about 16 m in January, rising through spring, and only the ice caps stay white in summer. Snow covers every slope above the line, thinner on steep rock, so it follows each mountain's shape. Snow showers fall from October to March in cold spots: high ground, the far north, and anywhere under thick cloud, in slow drifting bands. The haze thickens and whitens while it snows. Flakes drift with the wind.

## Buildings

Towns have about a quarter of the buildings they once had, and each house is more detailed: a foundation, fascia boards, framed windows that glow at night, a coloured door, a chimney and a roof ridge. Reykjavík and Akureyri keep a few apartment blocks with lit windows. Farms are fewer too.

## What gets saved

All of this is stored in the browser's localStorage, with no account and no server: sightings, a small JPEG thumbnail for each (up to 40 kept), landmark stamps, completed daily challenges and settings. Clear notebook in Settings wipes everything except the settings.

## Music

Two tracks play in turn on the car stereo, streamed from `public/music`: "Road to Sunset" by Serge Pavkin and "Atmospheric" by alex1990z, both from Pixabay under the Pixabay Content License. They run through a cabin EQ (a little more bass, softer treble) into the same mix as the engine. At the set levels (`CONFIG.music.volume`, and `CONFIG.engineVolume` at 70% of the original engine) the music sits well over the idling engine, a little over it at 60 km/h and about level at 100 km/h. On foot it drops to a third and is muffled, as if heard through the car doors.

The Sound tab in the menu has a slider for each group: All sound, Music (the stereo), Car (engine, nitro, wading, splashes and knocks) and Ambience (wind, water and ice). Levels are saved; Music at zero also stops streaming. The quick Sound button and U still mute everything. The northern lights make no sound: the old high hum and crackle were removed because they sounded wrong.

## Analytics

Play is measured with Google Analytics 4 (property "Chasing Green", ID set in `CONFIG.analytics.id`). `src/analytics.js` sends nothing on localhost; add `?ga_debug` to a URL to log events in the console and see them live under Admin, DebugView.

- `game_start`: month, vehicle, graphics, input (touch or keyboard), trip number.
- `play_milestone` and `distance_milestone`: at 1 to 120 minutes of actual play and 1 to 500 km driven.
- `session_summary`: sent when the tab is hidden or closed, with the play seconds, km driven, nitro boosts, aurora sightings and new stamps since the last summary, so they add up across visits. Top speed rides along.
- Actions: `landmark_stamp`, `aurora_sighting`, `sky_photo`, `challenge_complete`, `postcard_share`, `postcard_save`, `postcard_link_copy`, `fact_share`, `vehicle_change`, `fast_travel`, `menu_open`, `look_up`, `step_out`, `sit_down`, `setting_change`, `graphics_auto_lowered`.

Event parameters such as landmark, vehicle, place and aurora type are registered as custom dimensions, and play time, distance driven, nitro boosts, aurora sightings and new stamps as custom metrics. Visitors with an ad blocker are not counted.

## Known limitations

- Graphics are generated in code with no model or texture files, so they are stylised realism, not photo-real. Matching a modern console game would need gigabytes of hand-made assets and a different engine.
- Reykjavík museums (Whales of Iceland, the art and maritime museums, the Settlement Exhibition, Aurora Reykjavík, the phallological museum), Laugardalslaug, Vatnajökull and Langjökull ice caves, Þórsmörk, Hornstrandir and the Laugavegur hiking trail are not built. Interiors and trails do not suit a driving game, and the ice caves would need proper modelling.

- Shadows are a single wide shadow map that follows you, not true cascaded shadows. three.js's cascaded shadow add-on rewrites the same shader code as the game's custom terrain and grass shaders, so it was left out. High quality uses a wider, sharper map instead.
- Rivers flow in canyons and from waterfalls (Stuðlagil, Fjaðrárgljúfur, Goðafoss, Gljúfrabúi), but there is no full river network across the island.
- Landmark models are built in code from simple shapes. They aim to be recognisable at a glance, not exact replicas.
- Ice uses real refraction (transmission) on Medium and High, which adds a rendering pass when ice is on screen. Low uses plain glossy ice.

- Performance was tuned by reasoning and checked only in a software renderer, not on real laptop or phone GPUs. The grass field, sun shadows, post-processing and the aurora shader are the heaviest parts. Quality presets and an automatic step down are in place, but test on target devices before a launch. Integrated laptop GPUs will probably want Low or Medium.
- It is realistic in style but still procedural and real-time, so it will not match photographs exactly. Mountains are built from noise, not real elevation data.
- Share links carry the sighting's details, not its screenshot. Opening a link re-renders that sky at that spot, so it will look similar to the original, not identical.
- Clip export is WebM in Chrome, Edge and Firefox. Safari falls back to MP4 where MediaRecorder supports it, and older Safari versions can't record at all.
- The Web Share API with image files works on most phones. On desktop the Share button usually falls back to downloading the image.
- Collisions use simple circles and boxes, not full physics. Cars bounce off obstacles but do not flip, and fences are not solid.
- Iceland is heavily simplified: the scale is compressed, the coastline is rough, and only nine stops are modelled.
- The legend lines on the info cards are short retellings of well-known folklore and saga references. Facts and legends should get a proper check before any marketing use.
- Fonts (Young Serif and Atkinson Hyperlegible) load from Google Fonts. Offline, the game falls back to system fonts.

## Next step ideas

- Render the aurora at half resolution and upscale it, which would cut its cost by about four times.
- Use real Icelandic elevation data (it is openly available) for the terrain instead of noise.
- Distance-based terrain detail (chunked levels of detail) so the land up close can be much finer.
- A camera mode with exposure and white balance for "real" aurora photos, scored on composition.
- More stops: Snæfellsjökull, Hraunfossar, Stokksnes, the Westfjords.
- Weather events such as snowstorms that close highland roads, and a road conditions screen on the radio.
- Make the moon phase affect how faint aurora shows.
- A shared map of where everyone saw the lights (this would need a small backend).
- Seasonal shoulder months (September, March) with shorter nights and higher equinox activity.
