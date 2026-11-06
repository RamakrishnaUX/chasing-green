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
| Brake and reverse | S or down arrow; keep holding once stopped to reverse | Brake pill, labelled "Brake & reverse"; keep holding once stopped and it switches to a down arrow and "Reverse". A one-time bubble points it out on the first drive |
| Handbrake | Shift | |
| Change view (chase, hood, cockpit) | C | Steering-wheel button, top right |
| Step out and get back in | E | Menu, Step out / Get in |
| Look up (quick toggle) | L | Look button (glows green when the aurora is out) |
| Capture a postcard | Click the shutter while looking up | Tap the shutter while looking up (postcards also save on their own when the aurora is out, again at each new place) |
| Sit down (on foot) | X | Sit button |
| Look around | Drag with the mouse | Drag with a finger |
| Switch vehicle (the cars in turn, then the helicopter) | V, or click the car | Tap the car, or Menu, Cars |
| Map: drive there or jump there | M | Tap the minimap |
| Steer by tilting the phone | | Menu, Settings, Steering, Tilt phone |
| Learn about the aurora | H, or any (i) on the radio | Menu, Learn, or any (i) on the radio |
| Field notebook | N | Notebook button |
| Record a 15 second clip | R | Menu, Settings, Record |
| Mute | U | Menu, Settings, Sound |
| Nitro boost (on by default, can be turned off in Settings) | Space | Slide up from Go; the ring around Go shows the tank |
| Walk and run on foot | WASD or arrow keys: forward walks, held on (or tapped again quickly) he breaks into a run; hold Shift to keep walking | Hold Go: a walk, then a run |
| Jump on foot | Space | Slide up from Go |
| Climb a rock or cliff (on foot) | Run into it and keep going; back off to let go | Hold Go against it; Brake to let go |
| Refuel, or a tow when the tank is dry (fuel is on by default, can be turned off in Settings) | F, or the Refuel button | The Refuel button |

There is no race and no timer. Nitro is a speed boost that is on by default; you can switch it off in Settings.

**Drive there or jump there.** Tap any place on the map, a landmark pin or open ground, and a card offers both. Jump there drops the car on the nearest road straight away. Drive there plans a route along the roads (cutting across country only for the last stretch to a place off the road) and guides you:

- A blue line on the minimap and the full map.
- A chip under the minimap with an arrow that points the way, leading into bends, and the distance left. Its × stops the route.
- A slim, faint pillar of light over the destination, about 70 m tall, that widens a little far away.
- The route re-plans if you wander more than about 120 m off it, and ends with an "arrived" toast within 30 m.

Routing lives in `src/world/route.js` (the roads become a graph, joined wherever roads meet, searched with Dijkstra) and the guidance in `src/ui/nav.js`.

On both maps you are a blue arrow with a white rim and a pulsing halo (and a "You" tag on the full map), so you never get mixed up with the white and green landmark dots.

**Tilt steering (phones).** Settings, Steering, Tilt phone: hold the phone like a steering wheel. The roll is read from gravity in screen space, so it works in landscape or portrait however far the phone leans back, with a 3° dead zone and full lock at about 24°. iOS asks for motion access on the next tap. The arrow buttons stay until real tilt readings arrive, and a device with no sensor falls back to buttons.

**Views.** C (or the steering-wheel button) cycles three driving views, and the game remembers your choice:

- **Chase**: the camera behind the car.
- **Hood**: low on the bonnet.
- **Cockpit**: the driver's seat, with a modelled interior for each car. The steering wheel turns with your steering, the speed and rev needles move, the radio shows the track that is playing, and the screen edges glow when you boost. Drag to look around the cabin; the view drifts back to the road as you drive. The windscreen clears in this view. The wing mirrors (and the camper's rear-view mirror) show the road behind, live: a small camera looks back from your seat, and each pixel of the glass looks up where a ray from your eye bounces to, so the left mirror shows behind-left, the right one behind-right, the right way round as you look around. The glass is aimed at the driver's eye like real mirrors and the wing mirrors are slightly convex. Phones draw it smaller, every other frame and without grass.

The interiors and the eye position for each view are built in `src/vehicle/interiors.js`.

**Step out and sit.** Park, press E (or Menu, Step out) to get out, walk anywhere near the car (black sand at Reynisfjara and Diamond Beach included), then press X to sit. Sitting lowers the view to your own eyes (your body is not drawn meanwhile), lets you look freely, and makes time pass six times faster so you can wait for the sky. Press X again or start walking to stand up.

## Cars

| Car | Looks | Handling | Deepest water |
| --- | --- | --- | --- |
| Trail 4x4 | 1940s open-topped field car in olive drab: slotted grille, white star on the bonnet, fold-down windscreen, jerry can and spare on the back, canvas seats, no roof between you and the sky | Balanced, best on gravel, mud and fords | 1.9 m |
| Vintage roadster | 1930s coupe in deep maroon and black: long wings with a spare on each, wire wheels, round lamps on stalks at the back, a wooden dash | Slow and soft, with lots of body roll | 0.6 m |
| Supercar | Low orange hypercar with dark wheels, slashed lamps front and back, vents over the engine | Fast and stiff, poor off-road | 0.3 m |
| Camper van | 1960s split-window bus in sky blue and white, seats for nine | Slow and steady, fine on gravel | 1.0 m |
| Cafe racer | Yellow tank, brown bench seat, flat bars and fat tyres, ridden in an open leather helmet and goggles | Quick and nimble, leans into every bend, fair on gravel | 0.45 m (it cannot float) |

Handling lives in `src/vehicle/specs.js` (including suspension stiffness). All five are models from Sketchfab, loaded in the background (`public/models/car_*.glb`, 1.2 to 2.7 MB), with the old models built in code (`src/vehicle/models.js`) standing in until they arrive. There are no brand logos: the 4x4 carries only army markings, and the camper's maker's badge is cut off its nose.

| Car | Model | By | Licence |
| --- | --- | --- | --- |
| Trail 4x4 | [Willy Jeep](https://sketchfab.com/3d-models/willy-jeep-b635f6d5a7a045cf9bae3cc71952cd23), thinned from 297,000 triangles to 122,000 | [AnilG](https://sketchfab.com/AnilkumarG) | CC BY 4.0 |
| Supercar | [Fictional supercar - V12 Goblin](https://sketchfab.com/3d-models/fictional-supercar-v12-goblin-0a20e49ad5774d778567cb5c3f345786), repainted orange | [ollitei](https://sketchfab.com/ollitei) | CC BY 4.0 |
| Vintage roadster | [Retro Car](https://sketchfab.com/3d-models/retro-car-2836e72f327f4d6f9fe836d646496927) | [pisarenok](https://sketchfab.com/pisarenok) | CC BY 4.0 |
| Camper van | [Volkswagen Kombi Micro Bus](https://sketchfab.com/3d-models/volkswagen-kombi-micro-bus-d34fd744db1c4f84ad40c854ddbff9e9), badge removed, cab mirrored to left-hand drive | [winterborn](https://sketchfab.com/winterborn) | CC BY 4.0 |
| Cafe racer | [Cafe Racer](https://sketchfab.com/3d-models/cafe-racer-c02dec85ac0541b8ab6dd56098706b50) | [Andrei Milin](https://sketchfab.com/milinam2002) | CC BY 4.0 |
| Rider's helmet | [moto helmet](https://sketchfab.com/3d-models/moto-helmet-6c75ac1b13a047bd86742f37ce25adac), side badges and their mounts removed | [sayedgamal655](https://sketchfab.com/sayedgamal655) | CC BY 4.0 |

`tools/cars/process.mjs <kind>` turns a download in `downloads/` into the game's file: it bakes every part into one car facing +z with the ground at y = 0, scales it to length, splits out the four wheels (by name, or, where they are merged into the chassis, cut out of it around each axle, taking only pieces wholly inside a wheel so the arches stay on the body) so they spin and steer, moves the lamp lenses to "lamp" and "tail" materials the game lights at night, takes off badges, shuts parts modelled open (the camper's engine lid, swung down on its hinge), mirrors a right-hand-drive cab (the camper's) so the wheel sits in front of the left-hand seat the game drives from, cuts the steering wheel out as a part of its own (its rim fitted with a plane to find the centre and the column's line, kept on the part as `pivot` because compressing the file moves the part's origin) so it turns about its own centre with the steering, thins dense models, makes part-metal paint matte and recolours it (the 4x4's brown, rusty olive becomes a flat olive drab, its muddy tyres dark rubber), turns spec-gloss materials into metal-rough ones (the supercar's paint comes out of its specular map), and compresses it. The 4x4, vintage car and camper bring their own cabins for the cockpit view; the supercar keeps the built-in one. Every steering wheel turns with the steering, in every view (the open 4x4's shows from outside too). The cars are sized against each other when they load (`scale` in `models.js`, the whole model at once so each keeps its shape): the supercar is the smallest (4.55 m long, 1.16 m tall), the old roadster at its true size (5 m long, 1.93 m tall: lower and slimmer than the 4x4, and tall enough inside for its driver to sit up), the 4x4 bigger and bulkier (4.5 m long, 2.05 m tall, 2.1 m wide, on bigger tyres), and the camper van much the biggest at 5.6 m long and 2.5 m tall. Their footprints for collisions (`radius`, `halfLength` in `specs.js`) and chase cameras follow; the chase camera sits at nearly the same distance behind each, so the van looks as big as it is. **The driver** (`src/vehicle/driver.js`) is the man you walk as, at the wheel whenever you are in a car, posed by hand. He is drawn at his car's own scale (the cars are scaled up from their models' roughly true sizes to set them against each other, and he grows with them: 1.25 times in the 4x4, 1.4 in the camper), so he keeps his proportions to the car. He sits on the car's own seat, found by casting rays into the car (the footwell floor, then the cushion 15 to 60 cm above it, the backrest just behind and the roof overhead); of a range of postures (leaning back or forward, sitting further forward on the cushion) the most natural one that both reaches the wheel and keeps his head under the roof is used, so he reclines in the supercar and sits up in the camper. His feet rest on the floor, knees bent, short of the footwell's front wall (found the same way). His hands hold the rim a little above quarter to three: each hand carries on from its forearm (the wrist bends 10 to 50 degrees, the forearm takes the twist as a real one does), the rim crosses the palm, the thumb lies over the top, and the fingers are drawn together and close round it. The hands turn with the wheel and slide on it past about 70 degrees rather than cross. He is seen from outside; in the driver's view the camera is his eyes, so he is not drawn. The supercar's built-in wheel shows from outside too, so he has something in his hands. The mirror glass is cut out when a car loads (`mirrors` boxes in `models.js`: the backward-facing triangles inside them).

**The cafe racer** has two wheels and is handled as one. `tools/cars/bike.mjs` prepares it and the rider's helmet: the model is all one material, so it is cut up by shape. The tyres are the two pieces standing on the ground; each wheel is every piece (a run of triangles joined at their corners) lying wholly inside a cylinder round its axle. The steering (fork, clamps, flat bars, levers, headlamp and indicators) is every piece within 25 cm of the steering axis, through the middles of the two fork clamps (a 22 degree rake), and is saved as `steer` with its +z up that axis. The grips are the outer 13 cm of each end of the handlebar itself (the widest piece in the steering; the flat levers in front of them run across too, but are not the bar), kept on the steering part for the rider's hands. The headlamp's lens becomes a lamp of its own, so it shines at night. It carries no maker's marks. It is drawn 1.1 times its true size (2.2 m long) so it sits right under its rider, who is not scaled. In the game the front wheel hangs in the fork and turns with it (`steer.attach`); the bars turn well over at walking pace and only a little at speed. It leans into its turns by the angle that balances the turn at its speed (tan lean = speed x turn rate / g, at most about 37 degrees, upright at walking pace), about the line where its tyres touch the road, and follows the ground nose to tail on its two wheels but stays upright across a slope (`syncBike` in `jeep.js`). It cannot float: it stops at water deeper than it can ford ("Too deep for the bike"). Its chase camera sits closer and follows more tightly than a car's, so it does not shrink into the distance at speed. In the garage its picture is framed closer than the cars' (theirs share one distance, to show their sizes against each other). **The rider** (`ride` in `driver.js`) sits astride the bench just behind the tank (`seatZ`; the seat's height found by casting down onto it), leaning forward by the lean nearest the bike's own (`lean`: fairly upright behind flat bars) that still reaches the grips (about 40 degrees here), head raised to look down the road; his hands close round the grips, the palm over the top and the thumb round underneath, fingers by the levers, and go round with the bars; his knees bend forward to his feet on the pegs (`pegs`). He wears the open leather helmet with goggles, set on his head each frame square to it. Off the bike he walks bare-headed.

## Helicopter

Pick **Helicopter** at the end of the Cars tab. It stands where your car was, rotor spooling up, and the car comes back (on the spot, or on the nearest road if that is too far out) when you pick a car again after landing. V gets you there too: it goes round the four cars and then the helicopter, and from the helicopter (once landed) back to the 4x4.

It flies like the car by default (Settings, Helicopter: Easy). It holds a cruise height above the ground by itself, following hills and the coast, and starts at 30 m.

| Action (Easy) | Keyboard | Touch |
| --- | --- | --- |
| Take off and fly forward | Up / W | Go |
| Slow to a hover; held once stopped, come down and land | Down / S | Brake |
| Turn | Left / Right, A / D | Left and right arrows |
| Raise / lower the cruise height | Space / Shift | Up / Down |

Manual (Settings, Helicopter: Manual) is the full set: Space and Shift climb and descend (let go and it holds its height), W and S fly forward and back, A and D turn, and it lands when you come down onto flat ground.

| Action (both) | Keyboard | Touch |
| --- | --- | --- |
| Chase or cockpit view | C | Steering-wheel button |
| Look at the sky from above the rotor | L | Look |
| Step out (once landed) | E | Menu, Step out |
| Jump out with a parachute (above 300 m; see Skydiving) | J | Jump |
| Pull the chase camera back | Mouse wheel | |

- **The model** is a Eurocopter EC135 ("Elicopter SMURD Romania" by [solid3DDD](https://sketchfab.com/solid3ddd), [Sketchfab](https://sketchfab.com/3d-models/d505c4eba9ef46c1b8725d1977bd0263), CC BY 4.0), with the Romanian rescue service's names, emblems, flags and numbers painted out of the body texture (`tools/heli/livery.mjs`) and the model slimmed to 101,000 triangles and 1.6 MB (`tools/heli/process.mjs`). Main rotor, Fenestron fan, doors and cabin are separate parts.
- **Flight** (`src/vehicle/heli.js`) works as a light helicopter does, with the stabilisation a modern one has. The rotor spools up over about five seconds, and lift is its thrust along the mast, growing with the square of its speed. The collective sets a climb or descent rate (10 m/s up, 7 down) and holds height when let go. The cyclic tilts the disc up to 20 degrees, so the tilted thrust pulls it along. Drag grows with the square of airspeed, giving a top speed of about 225 km/h (0 to 100 in about 10 s). Let go and it trims itself back to a hover. Turning banks it (bank from speed and turn rate, up to 30 degrees) and the flight path follows the nose round. The tail fin weathervanes it into the airflow, the wind drifts it, turbulence grows near the ground and in gusts, and the airframe shudders through translational lift. Ground effect adds lift within a rotor's width of the ground. Moving over rising ground it looks ahead and climbs to keep clear; a face too tall to clear stops it.
- **Landing** happens only where the ground under all four skid corners is within about 11 degrees of level, not on water (it hovers 2.5 m above it), and at walking pace. Near the ground the descent slows on its own for a gentle touchdown. Rocks, cliff tops and basalt columns count as ground, and the HUD and the second flight display say why it will not settle.
- **The cockpit**: both cyclic sticks and both collective levers move with your inputs (dual controls, swung in the shader about their pivots since they are part of the cabin mesh). The four flight displays are live: horizon with pitch ladder and bank pointer, speed and altitude tapes and heading on one; rotor speed, torque, height above the ground, climb rate and a compass on the other.
- **Seeing the whole island**: the view reaches out to 16 km as you climb, the haze thins with height, the sea plane reaches past the horizon, and the chase camera tilts down and hangs back so the land fills the view. From the 3,600 m ceiling all of Iceland fits on screen. Ambient occlusion rests above 150 m, where it shows nothing and would draw the island twice, so flying high costs less than driving.
- **Details**: the rotor blades fade into a blurred disc as they speed up, with a faint ring from the painted tips; red, green and white navigation lights, a flashing red beacon and a white strobe; the car's headlamps become a landing light under the nose at night (moved, not added, so no shader rebuilds); downwash kicks up dust or spray when low; and the sound is a rotor beat at the blade-passing rate, turbine whine and fan hiss, muffled in the cockpit and fading as you walk away.

## Skydiving

Above **300 m** in the helicopter you can jump out with a parachute (J, or the red **Jump** button above Go on a phone). He steps off the side door, rolls face down with his pack on, falls at up to about 200 km/h, opens a red and white ram-air canopy, flies it down and lands on his feet. The helicopter flies itself meanwhile, and lands nearby.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Jump (helicopter above 300 m) | J | Jump |
| Free fall: turn | Left / Right | Arrows |
| Free fall: glide forward (track) / slow the fall | Up / Down | Go / Brake |
| Open the parachute | Space or J | Open |
| Canopy: steer (held, a spiral that comes down faster) | Left / Right | Arrows |
| Canopy: dive (front risers) / brakes, and the flare just before the ground | Up / Down | Go / Brake |
| Chase view or his own eyes | C | |
| On the ground: call the helicopter, or get in beside it | E | Call / Get in |
| On the ground: a car instead | V | Menu, Cars |

- **Physics** (`src/vehicle/skydiver.js`): face down he falls at about 54 m/s, tracking about 49 down and 22 forward, spread out 45. Opening takes 2.6 s, most of the speed going in the middle of it. The canopy flies at about 10 m/s and sinks at 5; the front risers make it 13.5 and 7.5; brakes 3.2 and 3.4; a held turn winds into a spiral that sinks up to 14 m/s. Airspeed lags the controls, so pulling the brakes quickly turns the speed into lift for a moment: the flare. The game's wind drifts both, and soft walls keep him inside the map.
- **Nothing ends badly.** An automatic opener fires once the ground, under him or ahead along his path, is closer than the canopy needs to open at his speed plus a margin (about 120 m at full speed), so a jump with no pull at all still lands. A landing is soft when it comes down gently and slowly through the air (flared, or on deep brakes); anything firmer is a forward roll and he stands up. He never stays in water, on a roof or on a slope too steep to stand on: he is put on the nearest ground he can stand on (the shore, beside the building, the foot of the slope), behind a quick fade. Ground contact is checked along his whole path each frame, at most a metre at a time, so at 55 m/s and 20 frames a second he cannot pass through the ground or a roof.
- **Locked while in the air**: changing vehicles (V, the Cars tab, tapping a car), fast travel, getting in or out (E), looking up (L), sitting (X) and fuel or towing (F). C switches the camera instead. Menus pause the fall like everything else. Recording a clip works throughout.
- **The empty helicopter** (`fly` in `heli.js`) keeps its engine on and is flown by an autopilot through its own easy controls (so it keeps its terrain following and gentle touchdowns): it stops and hovers, then finds flat, dry, open ground nearby (nine points within 4 m all within 0.9 m of each other, no roof, not on water, at least 30 m from you) and lands there, and shuts down. Over the sea it flies to the nearest such ground. Called (E, or Call), it starts up, flies over and lands on flat ground 18 m or more from you, or tells you to walk to flatter ground if there is none within 400 m. It comes down from high up three times faster than a pilot would with passengers. If the ground under it turns out steep or wet, it tries elsewhere; if you walk under it, it picks another spot.
- **On the ground** he keeps his pack and helmet until he gets back in. The on-foot leash (120 m) is centred where he landed until the helicopter has landed near him; E and C call it from afar and only get in beside it (16 m). Choosing a car puts you in it, beside you or on the nearest road.
- **The canopy** is built in code: nine cells in an arc, an airfoil section open at the front, 30 suspension lines to the risers at his shoulders and steering lines to his hands. It streams out of the pack as a bundle, spreads and inflates, banks with the turns, and after landing sinks forward, deflates and lies flat, then is packed away. **The pack** is a rounded black container with a red handle; it and the helmet are fitted to his bones each frame, on the jumper and then on the walker.
- **The jumper** is the same man, posed by hand with the driver's tools (`driver.js`): the exit (standing in the door, then rolling flat), the box (arms out and bent, knees bent, head up to the horizon), tracking (arms swept back, legs straight), hanging under the canopy (hands on the toggles, pulled down to turn or flare, legs together and forward near the ground) and the landing roll.

## Fuel

Each car has its own tank, saved between visits, shown as a pump and a bar under the speed: white, amber below a fifth, red and blinking when empty. Turn it off in Settings, Fuel.

| Car | Tank | Range on a full tank |
| --- | --- | --- |
| Trail 4x4 | 80 litres | about 9 km |
| Vintage roadster | 45 litres | about 7 km |
| Camper van | 90 litres | about 10 km |
| Supercar | 70 litres | about 8.5 km |

- **Burning it.** Fuel goes with distance, not time: under power it burns at the full rate, coasting at a fifth, and standing still not at all, so waiting for the aurora costs nothing. Nitro burns three times as fast, and off-road and afloat a little more. In the last 1.5% the engine coughs and loses power now and then; at empty it stops and the car rolls to a halt.
- **Warnings.** At a fifth of a tank and again near empty a message gives the litres left and the nearest station, with a Route button that sets up Drive there to it.
- **Stations.** Six, on the Ring Road outside Selfoss, Vík, Höfn, Egilsstaðir, Akureyri and Borgarnes, so a full tank always reaches the next: a forecourt open to the road, a lit roof over two pump islands, a small shop, and a sign by the road reading ELDSNEYTI (Icelandic for fuel). At night the roof, the shop and the sign light up. Each sits on a level pad, and they show as amber squares on the minimap and the map.
- **Refuelling.** Stop under a station's roof and a Refuel button appears (F on a keyboard). It fills in about three seconds, the button filling with it; press again to stop. Driving off stops it too.
- **Running dry.** Once the car has stopped with an empty tank the button offers a tow to the nearest station, which leaves you at the pumps ready to refuel.

The sites are chosen when the world is built (`src/world/stations.js`): a level, dry spot beside the Ring Road 60 to 340 m out of town, clear of landmarks and other roads. Tanks and burn rates are in `src/vehicle/fuel.js`.

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

Reykjavík district (Hallgrímskirkja, Harpa, Sun Voyager, Perlan, the Laugavegur rainbow street), Seyðisfjörður (the blue church and its rainbow street), Dynjandi and Ísafjörður in the Westfjords, Siglufjörður, Háifoss, Landmannalaugar, Kvernufoss, Öxarárfoss, Silfra, Barnafoss with Hraunfossar, Sólheimajökull, the Sólheimasandur plane wreck (a stripped DC-3 on a plain of black sand), Víkurfjara, Secret Lagoon, Friðheimar, Hvammsvík, Reykjadalur, the Bridge Between Continents, Búðakirkja, Arnarstapi, Hvítserkur, Hásteinsvöllur on Heimaey, Dimmuborgir, Grjótagjá, Mývatn Nature Baths, GeoSea, Blue Lagoon, Þingvellir, Strokkur Geyser (erupts every minute or two, with a bulging-water warning first), Gullfoss, Kerið Crater, Seljalandsfoss, Gljúfrabúi, Skógafoss (with its stairway), Dyrhólaey, Reynisfjara, Vík í Mýrdal, Eldhraun, Fjaðrárgljúfur, Skaftafell, Svartifoss, Jökulsárlón, Diamond Beach, Hengifoss, Stuðlagil, Dettifoss, Ásbyrgi, Húsavík, Goðafoss, Hverir, Mývatn, Hveravellir and Kirkjufell.

They sit on the Ring Road or a detour: Reykjanes (Blue Lagoon), the Reykjavík waterfront, the Golden Circle, Snæfellsnes, Dyrhólaey, Fjaðrárgljúfur, Skaftafell, Hengifoss, Jökuldalur (Stuðlagil), the Diamond Circle (Húsavík, Ásbyrgi, Dettifoss) and Kjölur (Hveravellir). Positions come from approximate real coordinates. The Reykjavík sights are really within 2 km of each other, so they are spread out a little at the game's scale. Towns have houses, and Reykjavík and Akureyri have lit apartment blocks.

## Wildlife

Animals live where and when they really do (`src/world/wildlife.js`). The first time you see each one, a short note says what it is (saved, so it shows once).

- **Sheep** roam free in the hills from May to October in groups of three to seven, sometimes onto the road; in winter only a few stay out. **Icelandic horses** graze near farms all year, in bay, chestnut, grey, black, palomino and white. **Reindeer** live only in the east, in herds of four to nine. An **arctic fox** (white in winter, brown or dark in summer) turns up alone now and then, and at night its eyes shine green-gold in your headlights.
- Herd animals graze, wander a little, and run off when a car or someone running comes close: sheep at 14 m, horses at 9 m, the skittish reindeer at 38 m (a runner gets three quarters as near). Walk up to them instead and they only amble a few steps aside (sheep at 5 m, horses at 3.5 m; foxes and reindeer stay warier); follow one and it moves off again. Their bodies are solid to someone on foot. Herds are seeded per 220 m cell, so the same flock is in the same field when you come back.
- **The models** are real, rigged and animated ones from Sketchfab (credits below), drawn by `src/world/animalRigs.js`. Each species is fetched the first time it is needed (`public/models/*.glb`, 0.06 to 2.9 MB each).
- **Up close** (within 70 m, the nearest 6 horses, 14 sheep, 8 reindeer and 3 foxes; about half that on phones and Low quality) each animal is a full rig with its own skeleton, crossfading between its clips: idle, walk, and for the reindeer grazing, trotting and running. Clip speed follows ground speed (measured from the planted hooves, root motion taken out), so hooves do not skate; a fleeing horse goes into a fast tölt. On top of the clips the neck is bent in code: down to graze (the base of the neck swings down and the head tips at the poll until the muzzle reaches the grass, worked out once from each model) with a chewing nod, and up and turned to watch you when you come close. The sheep model has no walk, so its legs are swung by code: each hoof planted and pushed back, then lifted, folded and swung forward quickly, in a four-beat walk that turns into a trot (diagonal pairs together) as it speeds up, the stride lengthening with speed and the body dipping a little with each step; the far-off instances get four steps of the same walk. Rigs further than 35 m are stepped at half rate, and only those within 32 m cast shadows.
- **Further off** they are instances of a low-poly copy of the model baked in six poses (standing, grazing, four steps of the walk), one draw call per pose in use.
- **Coats** are the model's own texture recoloured per animal by its brightness against the texture's typical brightness, so shading, markings and hair stay: horses bay with black points, chestnut, flaxen chestnut, black, grey, palomino, dun and white, with their own mane colour; white, black, brown and grey sheep, some with dark faces and legs; the arctic fox white in winter, brown or blue-grey in summer; grey-brown reindeer (the model is an elk, retinted and scaled down, so its antlers are an elk's).
- **Seals** are a scanned harbour seal, instanced; the vertex shader lifts and turns the head and raises the hind flippers a little, as a resting seal bends into a banana. **Whales and dolphins** play their swim cycle as they surface, blow, roll and dive.
- A field of horses adds about 60 draw calls and 0.35 million triangles (about 8% of the frame); the animals update in under a tenth of a millisecond.
- **Seals** haul out at Jökulsárlón, Diamond Beach and Ytri Tunga, lift their heads now and then, and slip into the water if you get close, hauling out again once it is quiet.
- **Puffins** stand about in little groups on the clifftops at Dyrhólaey from May to August, the arch's grassy top and the sea stacks, turning their heads, while a flock wheels round on fast-whirring wings, low over the sea and up past the cliffs.
- **Humpback whales** feed in Skjálfandi Bay off Húsavík from April to October: under water most of the time, then a blow, the long back rolling over, and the fluke lifting as they dive. In winter **orcas** come into the fjords on the north side of Snæfellsnes after the herring. They keep clear of a boat (orcas 35 m, humpbacks 55 m), swinging out round it, and stay down if it comes on too fast.
- Take the boat out at speed, away from land, and a pod of **white-beaked dolphins** may come to ride the bow wave, swimming alongside 6 to 9 m out from the hull, porpoising and now and then leaping, until you slow down or near the shore.

### Animal models

| Animal | Model | Author | Licence |
| --- | --- | --- | --- |
| Horse | [HORSE - Realistic 3D Model (DEMO FREE)](https://sketchfab.com/3d-models/horse-realistic-3d-model-demo-free-65d6a70a6721495f938c93e80a5998e4) | [WildMesh 3D](https://sketchfab.com/WildMesh_3D) | CC BY-NC 4.0 |
| Sheep | [Sheep-Test (Non-Commercial)](https://sketchfab.com/3d-models/196bb78e6e6343888d09f468a6a9dbc7) | [Nyilonelycompany](https://sketchfab.com/Nyilonelycompany) | CC BY-NC 4.0 |
| Arctic fox | [FOX - Realistic 3D Model (DEMO FREE)](https://sketchfab.com/3d-models/83b1b144712c43d282d90c2fb15ba450) | [WildMesh 3D](https://sketchfab.com/WildMesh_3D) | CC BY-NC 4.0 |
| Reindeer | [Realistic Animated Elk 3D Model](https://sketchfab.com/3d-models/787834f9caa2474d9f1814b807c072d7) | [WildMesh 3D](https://sketchfab.com/WildMesh_3D) | CC BY 4.0 |
| Harbour seal | [Spotted Harbor Seal](https://sketchfab.com/3d-models/eff1b6181eca4a8aaca2cb0a19a1df38) | [c4rn4g3](https://sketchfab.com/c4rn4g3) | CC BY 4.0 |
| Puffin | [Atlantic Puffin - Low poly](https://sketchfab.com/3d-models/00c3f6de0c5b494bbf2885ff99ee6b96) | [Troels](https://sketchfab.com/troelsbp) | CC BY 4.0 |
| Humpback | [Humpback Whale (Swimming)](https://sketchfab.com/3d-models/f4912be9163a4f45b2480df8ccb8b2c6) | [Connlan_Immure](https://sketchfab.com/Connlan_Immure) | CC BY 4.0 |
| Orca | [Female Orca](https://sketchfab.com/3d-models/e5eb46758cd242efabe49954cdd16980) | [neurodolphin](https://sketchfab.com/labmonkey) | CC BY-NC 4.0 |
| Dolphin | [Dolphin](https://sketchfab.com/3d-models/c24dc835a6aa4d3c827450513525cdb8) | [Alex_Pfe](https://sketchfab.com/Alex_Pfe) | CC BY 4.0 |

All are changed for the game: saddle, teeth, bubbles and the puffin's rock removed, meshes slimmed, unused bones and clips dropped, textures shrunk, coats recoloured. Four are non-commercial (CC BY-NC), so the game as a whole must stay non-commercial while it uses them. To rebuild one, download its glTF into `downloads/<name>/` and run `node tools/animals/process.mjs <name>` (settings in `tools/animals/models.json`; the packages it needs are listed at the top of the script).

## How the aurora system works

Everything lives in `src/aurora/forecast.js` and is tuned from `src/config.js`.

**The forecast.** Each night (noon to noon) gets its own seeded curve on a 0 to 9 scale, like Kp. It starts from a quiet base level, then adds two to four activity windows somewhere in the dark hours. About one night in ten also gets a big storm window.

**Substorms.** Each window is a substorm with the three phases real ones have (lengths in `CONFIG.forecast.phases`, in game hours, so minutes of real time):

1. Growth, about 30 to 60 minutes: a single quiet arc sits low in the north and slowly brightens. It shows faintly even before Kp has properly risen, when a real display is on its way, and the radio says so: "A faint arc is forming in the north. Stay put."
2. Breakup, 20 to 30 minutes: the arc suddenly flares, splits into folding curtains and sweeps overhead. Kp jumps, the curtains move about three times faster, the rays sharpen, and the whole display is much brighter and shimmers.
3. Recovery, 1 to 2.5 hours: the light spreads into soft, dim patches that fade away, some pulsing on and off every few seconds (pulsating aurora, a sighting type of its own).

`Forecast.phaseAt` reports the phase; the aurora shader takes it as uniforms (`uGrowth`, `uBreak`, `uDiffuse`, `uPulse`) and runs the curtains on their own clock, `uFlow`, so a breakup speeds them up without a jump. The Learn panel explains substorms and pulsating aurora. To test from the console: `chasingGreen.forecast.debugPhase = { phase: 'breakup', breakup: 1 }`. The radio shows what has happened so far tonight as a solid green line, and a dashed prediction ahead. The prediction is deliberately fuzzy, and gets fuzzier the further ahead it looks.

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
- **The character** on foot is a rigged man in a long dark coat ("Man In Coat - Human Rigged Model" by [Saitam](https://sketchfab.com/saitam_ha), [Sketchfab](https://sketchfab.com/3d-models/man-in-coat-human-rigged-model-cd71038373d5427099a7970f1a1af2df), CC BY 4.0), moving with motion-captured Mixamo clips: idle, walk, a walk backwards, run, jump and kneel, taken from "ETB Animated" by [Royaleyourdad](https://sketchfab.com/royaleyourdad) ([Sketchfab](https://sketchfab.com/3d-models/etb-animated-use-animation-dropdown-to-see-all-6795caee22124716bab954326306d3e3), CC BY 4.0). Both rigs are Mixamo's, so `tools/person/process.mjs` matches the bones by name and retargets the clips: each bone makes the same turn in the world away from its own rest pose as the clip's bone does from the clip's (the two rest poses differ by a few degrees a bone, which, copied straight across, bent his knees and tipped him back). It scales the hips to his height and holds them in place (`public/models/person.glb`, 1.1 MB). Forward walks (about 5 km/h); held on for most of a second he speeds up to a run (about 15 km/h), and tapping it again quickly gets him there sooner; Shift keeps him walking, letting go he slows to a stop in a stride or two, back steps him backwards, and Space is a small standing hop. Each clip's own pace was measured off the planted foot (the walk 1.06 m/s, the run 3.0 m/s), the speeds sit close to them, and walk and run share one stride, as far along as the ground covered, so the feet neither slide nor fall out of step as one blends into the other; the camera drops back a little as he runs. He climbs anything too steep to walk up, boulders, cliffs, sea stacks and basalt columns, at 1.4 m/s, reaching hand over hand, pulls himself over the top, drops off ledges and lands with a crouch. The car is solid: he runs round it. He can roam 120 m from it.
- **Post-processing** (medium and high quality). Subtle bloom for the sun, headlights and aurora, then a light colour grade, vignette and film grain.

### Realistic look (desktop)

On desktop (Medium and High) the game loads a realistic layer on top of the classic one; phones and Low always keep the classic look and never download it. Settings, Look switches between Realistic and Classic (applies on reload). Everything lives in `src/world/hd.js`, with small hooks in the terrain, road, sky, landmark and post code.

- **Scanned surfaces.** Poly Haven textures (CC0) in `public/hd/` (about 20 MB): grass, slope earth, cliff rock, lava moss, black sand and snow on the terrain (blended by the classic layer weights, mapped from three sides on steep ground), asphalt and gravel on roads. The photos give detail and normals; the game's palette (seasons, grey basalt, black sand) stays.
- **Landmarks and props** get the same detail, chosen by colour (grass, moss, rock, snow); painted things stay clean. Natural landmarks are also weathered: their solids are subdivided and pushed in and out by noise, so hills, cliffs and sea stacks stop looking like cylinders and boxes (basalt columns keep their shape).
- **Scanned rocks** (Poly Haven rock_moss_set_01) replace the boulders, drawn within 700 m of the camera.
- **Eroded mountains.** A finer terrain mesh with ridges and gullies cut into mountain faces, kept off the roads.
- **Light.** Long sun shadows traced across the height map (mountains shade valleys at any distance; the shadow map still handles the car's surroundings), ambient occlusion, a stronger sun with less flat sky fill, height fog that thins towards peaks and warms towards the sun, and a slightly more contrasty grade.
- **Clouds** are a raymarched layer with depth, shaped from warped cellular noise into puffy cells with flat bases: lit tops, grey bellies and a glow towards the sun. Low in the sky they hand over to the flat layer, and streaky cirrus shows only in fair weather. The daytime sky itself is physically based (Preetham scattering).
- **Waterfalls** break into ropes of water with gaps, and their spray is a cloud of fine, faint droplets.
- **Cars** built in code (the stand-ins while the models load) pick up patchy road grime towards the wheels, which also turns the paint matte there. The Sketchfab cars keep their own textures, which carry their own wear.
- **Eldhraun's moss** uses its intended deep grey-green (the classic look keeps its paler mounds).
- **Grass** has its own shade per blade (dead straw among live olive), varied heights, a denser and wider field, and sun glowing through the tips when you look towards it.
- **Rock and snow** lose the painted streaks up close (they swirled on weathered faces), dark rock breaks through snow on steep ground, mountains in the middle distance get rocky relief, and Landmannalaugar's rhyolite is muted.
- **Camera look**: AgX tone mapping, which rolls off bright sky and snow like a camera instead of clipping.

- **Real landforms.** The realistic terrain is shaped from real elevation: Copernicus DEM GLO-90 tiles for Iceland, baked onto the game grid (`public/hd/terrain/iceland_dem.bin`, 1536 x 1066 heights in metres, gzipped, about 1.1 MB) and squeezed with a compressing curve (500 m becomes 30 units, 2,000 m becomes 85), because the island is about 125 times smaller than life. Beside roads the land eases to a blurred copy so grades stay drivable, it fades in from the game's own coastline, and erosion detail rides on top. Lakes, canyons, lava fields, Kerið and the ice caps keep their own shaping, and the snow line is set in real metres by month. If the file fails to load, the generated mountains are used.

  Elevation data: Copernicus DEM GLO-90, © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. The same credit is shown under Settings on desktop.
- **Middle distance.** Past about 40 m the same scans are also laid at a large scale (30 to 60 m), so hills keep patches and grain where the fine detail has blurred away.
- **Fords** on real terrain run at their own river level just under the banks (a patch of water of their own), so the track dips about a metre into the stream instead of down to sea level.
- **Landmannalaugar's hut** has walls, a pitched green roof, a door and windows instead of a plain box.

Cost: on the test machine the realistic look took about twice the classic frame time (the game's dynamic resolution absorbs part of it) and a few seconds more to build the world.

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
    route.js         road graph and Dijkstra routing for Drive there
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
    stations.js      the six fuel stations: sites, buildings and night lights
    effects.js       road puddles, spray and dust particles
  aurora/
    forecast.js      Kp curve, clouds, city light, visibility rules, aurora type
    aurora.js        raymarched curtain shader on a sky dome
  vehicle/
    jeep.js          jeep model and driving physics
    walker.js        step-out character: moving, climbing and mixing his clips
    heli.js          the helicopter: model, flight, landing, cockpit controls and displays, autopilot
    skydiver.js      the parachute jump: free fall, canopy, landing, the jumper's poses, pack and canopy
    models.js        the cars, loaded from their files, with stand-ins built in code
    interiors.js     dashboards, wheels and dials for the cockpit view, plus each car's hood and cockpit eye
    mirrors.js       live wing and rear-view mirrors for the cockpit view
    specs.js         handling, wading depth and nitro for each car
    fuel.js          each car's tank and how fast it burns
    input.js         keyboard, touch buttons, drag to look
  ui/
    hud.js           radio, compass, readouts, toasts, look-up meter
    notebook.js      sightings, stamps, today's challenge
    minimap.js       minimap, full map, the drive-or-jump card and fast travel
    nav.js           Drive there: guide chip, beacon and route progress
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

Cars ford shallow water with their wheels under and the body above the surface, at reduced speed. The supercar wades up to 0.55 m, the roadster 0.95 m and the camper 1 m; the Trail 4x4 could wade 2.8 m but floats from 1.4 m.

### Boat mode

Drive into water deeper than that and the car turns into a boat (`src/vehicle/boat.js`). Over about a second and a half a white V-hull with an orange rubbing strake drops out from under the body, the wheels rise and fold flat onto its deck (the fender flares tuck away), and a water jet and navigation lights come out: red to port, green to starboard, white at the stern. One kit fits every car; it is sized from each body's length and width.

- **Handling.** It floats on the hull's waterline, bobs on the swell, lifts its bow and leans out of turns at speed, and slides through turns as a boat does. Top speed is about 55 km/h in the 4x4, 40 in the roadster and camper and 67 in the supercar, and nitro works on the water too (the 4x4 reaches nearly 80), digging the jet in and lifting the bow further. It steers with the jet, so it turns even when slow. The wind only nudges a boat (a fifth of its push on a car), or with so little grip it would drift sideways like a leaf.
- **Getting to the water.** Off-road you can roam 70 m from a road, but you can always head toward the sea or a lake, and anywhere within 200 m of the shore is open (`shoreDistAt` in terrain.js gives the distance to the nearest sea or lake shore). Only moving away from both the road and the water is stopped, so nearly every shore can be reached: driving like a player from the nearest road, 119 of 123 shore points spread round the island reached the water (the rest are behind farm walls or under a bridge), where only 17% of the coastline used to lie within reach.
- **Range.** It can go 400 m out from the shore, past the edge of the land map where that is close (south of Vík, off the far west). Past that it slides along the limit and is told to turn back toward the shore.
- **Back ashore.** In water shallower than 60% of the floating depth the wheels come down, the hull folds away and it drives up the beach. A car that comes ashore far from a road can always drive back toward it.
- **On the water** (`BoatWater` in boat.js): a foam collar hugs the hull, piling up at the bow; the wake is a churned trail straight behind plus two bow-wave arms running out at the Kelvin angle (19.5 degrees), all in streaked, lacy foam that spreads and settles over about nine seconds; the jet throws a rooster tail of droplets and a drift of mist, heavier on nitro; and sheets of spray come off the bow at speed, more on the outside of a turn. Spray fades and grows as it flies, is fogged, and dims at night with the foam. The hull's hiss replaces the wading sound. You cannot step out on the water.
- **Heimaey and Hásteinsvöllur.** Vestmannaeyjar's one lived-on island lies off the south coast (`ISLES` in `geo.js`): the town by the harbour, Heimaklettur's cliffs, the cones of Eldfell and Helgafell, the ridge of Dalfjall and Stórhöfði at the southern tip, with its own coast in the same signed-distance coastline as the mainland and its own hills in place of the real elevation (it is drawn larger than life and a little further south than its 63.43 N, because the stadium is built at full size, and so there is open water to the mainland). Drive into the sea and float across, fly, or fast travel to its road. Its football ground, Hásteinsvöllur, is a full-size 105 by 68 m grass pitch, mown in stripes and marked out, with goals and nets and corner flags; the concrete south stand has the changing rooms and the players' tunnel underneath and its clubhouse windows at the back, the larger north stand is built into a grassy bank, and the rock Hásteinn stands behind the west goal under the ridge. The pitch is level ground (a flat on the island, then a pad) and solid turf to drive or walk on; the stands, dugouts and goals are walls (a car stops at the back of the net). The whole island is open to drive, with no road limit, and farms stay on the mainland.
- **Sea arches.** Boats pass through the arches at Dyrhólaey, Arnarstapi and Hvítserkur. The solid ground grid (solids.js) keeps a ceiling for each cell: where a landform starts above the water with open water under it, anything lower than that passes beneath. Faces below the water tell solid rock (a buried bottom) from an opening, upright faces are traced along their own line at their own height rather than across their bounding box, and a car's wheels ignore rock more than about a metre above it (the centre and bumper checks still stop it at walls). The arches reach down to the seabed, and Hvítserkur stands a little further out in clear water. Both of its doorways take any of the cars afloat: the narrow one beside the trunk is 4.4 m wide and 5.6 m high, the big one under the body 8.8 m wide and 5.8 m high. Cells at the edge of an overhang (the face of an arch above its opening), which get a top only from the allowance at a face's edge and nothing about what is beneath, take the roof of an open neighbour; they had been solid to the water, a wall across the doorway. Small landforms (under 120 m across) are traced at half-metre cells rather than metre ones, so a doorway a few metres wide keeps its width. A car set down under an arch (fast travel, recovery) stands on the water, not against the roof. Rock standing in the sea reaches down to the seabed, never stopping above the water: the stacks at Dyrhólaey and Reynisdrangar keep their tops and carry their taper on down, the boulders by the Arnarstapi arch stand on the bottom (`kit.bed` gives a landmark the local height of the ground, or the seabed under water), and the cliff behind Kirkjufellsfoss reaches the lowest ground under it where the bank falls to the sea.
- **Where.** Off any shore near a road: the south coast at Vík, round Snæfellsnes, below Siglufjörður, and on Þingvallavatn. The highland fords are at most 0.4 m deep, so they are still waded.

## Grounding

Nothing should float. Before any built landmark (buildings, churches, pools, waterfalls, geysers, caves, bridges) is placed, the land under it is levelled into a pad that fades out at the edge and stays clear of roads. Houses sit on their highest corner with a foundation down to the lowest. A parked car holds still: below walking pace with no throttle, wind and slopes no longer creep it along.

Nothing can be driven into, either. Landmark landforms (Kirkjufell, sea stacks, cliffs, lava pillars and hummocks, crater rims, ice) are traced into a height map when the world is built (`src/world/solids.js`), and the ground under wheels and boots is the land or the landform on top, whichever is higher. On a road it is the road itself, which is drawn 13 cm above the land (8 cm at the shoulders, 17 cm on junction patches), so tyres and shoes sit on the tarmac rather than in it. Slopes up to about 50 degrees are driven or walked up like any hill; anything steeper is a wall to the car and a climb on foot. Boulders and landmark rock (cliff blocks, basalt columns, the glacier tongue) carry their height in the obstacle set too, so on foot they are ground to climb rather than walls; hidden walls and hit boxes stay walls. A sample under the middle of the car keeps small lumps between the wheels from poking through the floor. Buildings, caves, pools, bridges and the plane wreck keep their walls instead, and no landform sits on a road.

## Performance

- Landmarks, farms and the car are built from many small parts. Once their collisions are read, static parts that share a material are merged into one mesh (`src/world/bake.js`), which took the scene from about 5,500 meshes to about 1,600 and cut draw calls roughly in half. Moving parts (wheels, mud bubbles, the geyser) and see-through or locally shaded materials are left as they are.
- Dynamic resolution: when frames run long the game draws fewer pixels (down to 60% of the preset, never below 0.55 of a CSS pixel) and steps back up when there is room. Only if that is not enough does it drop the quality preset.
- Bloom only runs from dusk on, when lights and the aurora need it, and Medium uses 2x instead of 4x multisampling.
- **Terrain tiles.** The island is one height grid but is drawn as tiles that share its vertex buffers, so the camera and the sun's shadow camera skip the tiles they cannot see instead of drawing the whole island (over three million triangles on the realistic look) in every pass.
- **Bridges** are merged like landmarks (each was some 75 parts).
- **No freezes from shaders.** Every shader is compiled while the world loads, including things hidden at that moment (night lights, the aurora, the route beacon) and the bloom passes used from dusk. The sun keeps casting shadows when it is too weak to matter and its shadow map simply stops updating: switching shadows off and on used to change every material's shader, so the whole scene recompiled at every dusk and dawn.
- **Ice** is drawn without a refraction pass, which re-rendered the whole scene every frame the ice was on screen.

On the realistic look, in addition (measured on an M1 Pro at 1600 x 1000, about 33 ms a frame before and 20 ms after):

- **Clouds** are raymarched into a panorama of the sky, an eighth of it each frame, and the dome reads the panorama. They drift slowly and sit hundreds of metres up, so a panorama a few frames old looks the same, and the slices can afford twice the march steps with no dither.
- **Scanned rocks** are full scans (10,000 to 16,000 triangles each) only within 90 m, where they cast shadows; further out, to 500 m, each is a low-poly boulder in the same material.
- **Ambient occlusion** leaves out grass blades and far boulders, which add many triangles to its pass and little shading.
- **Grass** keeps its density over a slightly smaller circle (46 m instead of 54 m).

## Weather and snow

The snow line follows the month: down to about 16 m in January, rising through spring, and only the ice caps stay white in summer. Snow covers every slope above the line, thinner on steep rock, so it follows each mountain's shape. Snow showers fall from October to March in cold spots: high ground, the far north, and anywhere under thick cloud, in slow drifting bands. The haze thickens and whitens while it snows. Flakes drift with the wind.

## Buildings

Towns have about a quarter of the buildings they once had, and each house is more detailed: a foundation, fascia boards, framed windows that glow at night, a coloured door, a chimney and a roof ridge. Reykjavík and Akureyri keep a few apartment blocks with lit windows. Farms are fewer too.

## What gets saved

All of this is stored in the browser's localStorage, with no account and no server: sightings, a small JPEG thumbnail for each (up to 40 kept), landmark stamps, completed daily challenges, the fuel in each car's tank and settings. Clear notebook in Settings wipes everything except the settings.

## Music

Two tracks play in turn on the car stereo, streamed from `public/music`: "Road to Sunset" by Serge Pavkin and "Atmospheric" by alex1990z, both from Pixabay under the Pixabay Content License. They run through a cabin EQ (a little more bass, softer treble) into the same mix as the engine. At the set levels (`CONFIG.music.volume`, and `CONFIG.engineVolume` at 70% of the original engine) the music sits well over the idling engine, a little over it at 60 km/h and about level at 100 km/h. On foot it drops to a third and is muffled, as if heard through the car doors.

The Sound tab in the menu has a slider for each group: All sound, Music (the stereo), Car (engine, nitro, wading, splashes and knocks) and Ambience (wind, water and ice). Levels are saved; Music at zero also stops streaming. The quick Sound button and U still mute everything. The northern lights make no sound: the old high hum and crackle were removed because they sounded wrong.

## Analytics

Play is measured with Google Analytics 4 (property "Chasing Green", ID set in `CONFIG.analytics.id`). `src/analytics.js` sends nothing on localhost; add `?ga_debug` to a URL to log events in the console and see them live under Admin, DebugView.

- `game_start`: month, vehicle, graphics, input (touch or keyboard), trip number.
- `play_milestone` and `distance_milestone`: at 1 to 120 minutes of actual play and 1 to 500 km driven.
- `session_summary`: sent when the tab is hidden or closed, with the play seconds, km driven, nitro boosts, aurora sightings and new stamps since the last summary, so they add up across visits. Top speed rides along.
- Actions: `landmark_stamp`, `aurora_sighting`, `sky_photo`, `challenge_complete`, `postcard_share`, `postcard_save`, `postcard_link_copy`, `fact_share`, `vehicle_change`, `fast_travel`, `nav_start`, `nav_arrive`, `nav_stop`, `menu_open`, `look_up`, `step_out`, `sit_down`, `setting_change`, `graphics_auto_lowered`.

Event parameters such as landmark, vehicle, place and aurora type are registered as custom dimensions, and play time, distance driven, nitro boosts, aurora sightings and new stamps as custom metrics. Visitors with an ad blocker are not counted.

### Roads and landmarks on the ground

Both looks fit roads and landmarks to the finished land (`src/world/terrain.js`):

- **Road surfaces** follow the terrain mesh exactly, with a short skirt under each edge, so no road floats over a dip or sinks into a bump. The land beside a road is level with it out to the verge, and between two legs of road at different heights it slopes smoothly from one to the other.
- **Junctions and shared stretches.** A road that meets or runs beside one listed before it takes that road's height and eases back to its own profile, faded as an offset so it keeps its own rise and fall. Where two roads share the same strip, only the earlier one is drawn.
- **Landmark pads.** Built landmarks stand on level ground that fades into the land around; pads that touch share one height. A road that crosses a pad, or skirts it closely, runs at the pad's level, and either side keeps within its usual grade (7% on tarmac, 12% on gravel). Where that cannot be met (two pads at different levels, or a jump, bridge or ford in the way) the road keeps its own height and the land between is banked. The level ground under a landmark is never cut away, except right under a road.
- **Fords.** The ramp down to a ford is as long as its banks need for about a 7% grade, and never past the road's end. The ford near Gullfoss sits a little way up Kjölur and the one at Landmannalaugar a little short of the hut, so the track has room to come down to each.
- **Rocks** are kept off streets, churchyards and squares, as the grass already was.
- **Models.** Gullfoss's upper step stands on rock down to the ground, and the Landmannalaugar hut's walls reach down to its lowest corner. The grassy knolls under Perlan and Vík's church are laid over the land rather than set on it as flat-bottomed cones, so their rims follow the slope instead of hanging in the air, and they are solid: you drive up them, not into them.
- **Bridges.** The ground under a deck is kept at least 1.2 m below it (a river bank used to rise through the end of one deck, a ridge the car hit as it drove on), and the abutments and piers sit under the deck where they stand: on a sloping bridge an abutment set at the middle height stood up out of the road at the lower end like a barrier.
- **Smooth at speed.** Every road's profile is rounded into vertical curves over about 13 m either way, so the corners left where a grade limit, a pad or a ford meets the rest of the road no longer throw the car up or drop it away (bridge decks, the wet stretch of a ford and jump ramps keep their exact heights). Bridge decks meet the road at their own ends instead of a lip of 10 cm or more. The car's suspension follows the ground's own rise and fall and only smooths the bumps on top: it used to ease the whole height, lag below a climb and then snap up whenever it fell 25 cm behind, a fast judder on long climbs at speed.
- **The Ring Road's loop** is closed smoothly near Reykjavík; its heights are worked out from one end round to the other, and used to meet with a 0.8 m step.

### Reykjavík and the ice

- **Harpa** is a dark, angular hall wrapped in a honeycomb of glass cells, each a shallow six-sided prism of iridescent glass that shifts between sea green, gold and violet with the angle and glows its own colour at night.
- **Hallgrímskirkja's** concrete has a fine grain, faint rain streaks down the columns and a little grime at the foot, so it reads as weathered concrete rather than flat paint.
- **Diamond Beach** lies on black sand (Breiðamerkursandur), and its ice, like the icebergs in Jökulsárlón, is rounded and polished by the waves, frosty white on top and deep blue underneath, instead of faceted crystals.
- Town windows light up one by one at night as intended; the per-window colour never reached the shader before, so every window glowed.

### Roads by the sea

A few roads (round Snæfellsnes, into Siglufjörður, at the Bridge between Continents) run just off the drawn coastline, as the real ones run on a thin strip of shore. Land is kept under any road there (`rawHeight` in `src/world/terrain.js`), so arriving at Arnarstapi or the Bridge between Continents puts the car level on the road, not in the sea.

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
