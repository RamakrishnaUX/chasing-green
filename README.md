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
| Step out and get back in | E | Out (shows once the car has stopped) / In |
| Look up (quick toggle) | L | Look button (glows green when the aurora is out) |
| Capture a postcard | Click the shutter while looking up, or press P | Tap the shutter while looking up (postcards also save on their own when the aurora is out, again at each new place) |
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
| Wheelie (on the bike, in place of nitro) | Space, with the throttle on | Slide up from Go |
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

**Step out and sit.** Park, press E (or tap Out on a phone) to get out, walk anywhere near the car (black sand at Reynisfjara and Diamond Beach included), then press X to sit. Sitting lowers the view to your own eyes (your body is not drawn meanwhile), lets you look freely, and makes time pass six times faster so you can wait for the sky. Press X again or start walking to stand up.

## Splash

The game opens on a splash over the aurora: CHASING, smaller, tracking in from wide letters, and GREEN below it, wiped on in the aurora green; then one line, "Follow the forecast, find a dark sky, and look up when the green comes out.", with a thin loading line. The island loads from the first frame, behind the splash and then the garage. Any key or a tap opens the garage, and that same press lets the sound play: the chosen vehicle rolls onto the turntable with its own recorded engine (idling in, one blip of the revs as it stops, then fading) and its lights click on. The turntable grows or shrinks smoothly to each vehicle. When the drive starts the gauges power up: fuel sweeps in, then nitro from the centre out to both sides, then the Kp.

## Start screen

The start screen is a garage. It plays from the first frame, while the island is still being built: a looping aurora over dark mountains (`src/ui/auroraSky.js`, one shader that needs nothing from the game), and in front of it the chosen vehicle on a turntable (`src/ui/cover.js`). The turntable is part of the 3D scene, so the vehicle always stands on it: a dark glossy floor with the vehicle's reflection, and a glowing rim with tick marks that turns slowly. The vehicle is lit like a studio shot, with a green rim light from the aurora and a glow on each headlamp.

The vehicle's name sits in brackets at the top with arrows either side, and what it is above it (a 1940s field car). Its four stats lean in toward it from both sides, each a value and a ten-step bar: top speed, off-road, wading depth and fuel tank (the helicopter shows its own). The month, tonight's daylight, dark hours and aurora chance sit at the bottom left with today's challenge, and Start Drive at the bottom right, filling as the island loads.

The arrows step through every car and the helicopter and change your vehicle the same way the garage does. The one you pick rolls in onto its mark with its engine (the helicopter comes down from above onto the pad, rotors turning, and winds down), then its headlights flicker on; the turntable gives a clunk and a short servo whirr as it switches. Car models start loading at once; a vehicle appears only once its real model is in, never as a code-built stand-in. On phones held upright the stats sit in two columns under the vehicle.

## Driving display

On a computer the driving display follows the game's look, with no boxes behind the readouts: a compass tape across the top with a green caret, the vehicle and the place you are in at the top left with the nearest place you have not found yet (or your route), and the time at the top right with the month and when the lights are likely. At the bottom centre sits the speed cluster: the gear (or Nitro, Flying, On foot) over the speed, a thin nitro line under it, and under them one thick band, as on a scooter dash: flat on both sides, stepping down at an angle under the speed, with slanted ends and a faint second band below for depth. Every cut across it, its ends and each fill's edges, runs toward one vanishing point above the middle, like the edges of a road, and each fill's moving tip bows outward toward the side it is filling. Fuel fills the left of it out from the centre (warm, red near the centre when low), nitro fills the dip and drains toward the middle as you use it, and the Kp fills the right out from the centre with the flowing aurora gradient. Fuel in litres sits above the left, the Kp above the right. There is no vehicle name or compass at the top; only a larger menu button sits in the top-right corner, and the time is bottom right beside the Kp (beside the menu on a phone). When the aurora comes, only the aurora shows: the place, minimap, markers and tips step away and the cluster dims (view, record, mute and the notebook are on C, R, U and N, and the camera is also in Settings > Controls); refuel and tow appear as a short line under the fuel side of the band ("Out of fuel · Press F", "Refuel · Press F"), and nothing moves for it; the compass steps aside while the aurora is out. In the helicopter the left of the band is altitude. The minimap becomes just the road: the roads around you as thin lines, heading up, the stretch ahead in green and fuel stations as amber diamonds; click it for the full map. Markers float over the world with their distance, with nothing behind them, only for things within 800 m and in view: one in front (the nearest place you have not found, else the nearest place, else fuel) and at most one more behind it, smaller, lighter and quieter. The aurora radio stays out of the way until you click the Kp in the cluster (or press K); toasts and buttons wear the same dark panels with a green edge. Phones and tablets get the same driving display, sized for the hand. Every unit along the top (the place you are in, the next spot, tips, the aurora call, badges, the route, the clock and the menu button) wears one dress: the same smoked glass with a hairline edge, 32 px tall on one line along the top, 13 px type, and a small mint glyph in front (a pin for the place, a moon for the clock, an arrow for the next spot; the route's arrow is blue like its line) instead of coloured discs. Beyond that: the place top left with the road-line minimap under it, the ribbon cluster above the controls (between them held sideways), and the Kp opening the radio. There are no labels in the world and no place panel on a phone; instead a quiet Next spot line at the top centre (smoked glass, no coloured ring) names the nearest unfound place within a kilometre, with a small arrow that points the way and its distance. The top centre shows one message at a time: a badge first, then a tip, then the aurora call, then the next spot. A tip that arrives while a badge is up waits under it with its clock stopped and gets its full time once the badge has gone; on a computer the same holds for badges and tips.

## Places, the aurora and badges

Coming near a place shows a small sign at the top left, in place of the place name (it fades in, no zoom): "New place found" (or "Back again"), the name on a green road sign (lit at the top and falling off toward the foot, a soft diagonal sheen, fine reflective grain and a silver border) with the kind of place and how many you have found along its foot, one line about it, how many places you have found and what kind of place it is. More opens the legend and a fact; the panel tucks itself away after a while of driving.

When the lights first come out, AURORA spans the top of the screen with the time, the Kp on a single flowing gradient bar, and three round actions: Look up (L), Record (R) and Postcard (P, which takes the photo). It stays about nine seconds, goes the moment you look up, and the screen edge glows green, breathing slowly, while the aurora is out. After the moment, a prompt says plainly what to do: "The aurora is out. Press L to look up" ("Tap Look" on a phone).

Badges (`src/ui/badges.js`) come from what the notebook already keeps and a few feats: first aurora, five and all thirteen waterfalls, hot springs, geology, ten, thirty and all places, a corona, a red aurora, five sightings, flying the helicopter, a parachute jump, walking, floating the car and a daily challenge. A new badge drops in at the top of the screen as one small smoked-glass card: the medal flips over once and catches the light over a soft green bloom, beside "Badge earned", the badge's name and one line on how you earned it. It stays about five seconds. The notebook has a Badges tab with every medal, earned ones first, and progress on the rest.

## Postcards

Every photo becomes a postcard (`src/share/postcard.js`), drawn like a real one: the photo on the left with "Greetings from Iceland" across its foot, and the back on the right. The back has a green aurora stamp in the corner, perforated evenly on all four sides; a round Reykjavík postmark with the date and wavy cancellation lines running onto the stamp; a handwritten note in Caveat about what you saw and where; three address lines; and a small line of trip details (place, time, Kp). On a computer the card sits tilted on the blurred road with the options beside it: Frame (Postcard, Polaroid or Film), your own Note, written on the card in Caveat, and Filter (None, Night, Warm, Mono); then Share postcard (Enter), Save image (S), Take another (P) and Copy link (L).

## Menus

On a computer the menu fills the screen over the blurred road, like a console game's front end: a dark tab bar across the top (Journey, Map, Garage, Notebook, Learn, Settings) with Q and E either side and a green line under the open section, and the keys along the foot.

- **Journey**: places found, sightings, postcards, badges, trips, today's challenge and tonight's outlook.
- **Journey** (the notebook is part of it): Overview, Places, Badges, Sightings and Today, with their counts. Badges are a grid of medals with the chosen one in full on the right (what it is for, when you earned it, progress).
- **Settings**: groups on the left (Trip, Picture, Sound, Controls, About), the group's rows in the middle, and a panel on the right that says what the chosen setting does. Month shows its day, dark hours, aurora chance and a year of nights. Three or more choices are a ◂ value ▸ stepper; two are an ON | OFF pill. The keys work like a TV or console menu: up and down move, left and right move between the section rail and the settings, Enter picks a setting up (its value glows and its arrows pulse), left and right then change it, and Enter or Esc puts it down; Tab moves to the next group. The corner button is a gear, and the menu's close button opens exactly where it was.

The start screen keeps only a settings button at the top right, which opens the menu (Journey, Notebook, Learn and Settings before the drive); Enter starts the drive and the arrow keys change vehicle. In the menu, Garage on a computer is the start screen again: the vehicle on its turntable under the aurora, its name and stats, arrows (or left and right) to look through them, and Drive this (Enter) to take one. Its 3D view exists only while the page is open. Phones and tablets get the same menus, made for thumbs: full screen over the blurred road, the sections across the top (swipe for more), each page's own sections as chips, and rows with 44 px steppers and switches. The menu's Garage is the turntable there too. The touch layout is for touch screens only; a computer always gets the computer layout.

The menus have their own sounds, made on the spot (`src/audio/uisfx.js`): a dry tick moving between rows, a clack changing a value, a whoosh and a low thud changing section, and a short engine blip with a chime for buttons that do something. A badge gets three bright rising notes. They follow the game's mute and All sound volume.

## Cars

| Car | Looks | Handling | Deepest water |
| --- | --- | --- | --- |
| Trail 4x4 | 1940s open-topped field car in olive drab: slotted grille, white star on the bonnet, fold-down windscreen, jerry can and spare on the back, canvas seats, no roof between you and the sky | Balanced, best on gravel, mud and fords | 1.9 m |
| Vintage car | 1930s coupe in deep maroon and black: long wings with a spare on each, wire wheels, round lamps on stalks at the back, a wooden dash | Slow and soft, with lots of body roll | 0.6 m |
| Supercar | Low orange hypercar with dark wheels, slashed lamps front and back, vents over the engine | Fast and stiff, poor off-road | 0.3 m |
| Camper van | 1960s split-window bus in sky blue and white, seats for nine | Slow and steady, fine on gravel | 1.0 m |
| Cafe racer | Yellow tank, brown bench seat, flat bars and fat tyres, ridden in an open leather helmet and goggles | Quick and nimble, leans into every bend, fair on gravel | 0.45 m (it cannot float) |

Handling lives in `src/vehicle/specs.js` (including suspension stiffness). All five are models from Sketchfab, loaded in the background (`public/models/car_*.glb`, 1.2 to 2.7 MB), with the old models built in code (`src/vehicle/models.js`) standing in until they arrive. There are no brand logos: the 4x4 carries only army markings, and the camper's maker's badge is cut off its nose.

| Car | Model | By | Licence |
| --- | --- | --- | --- |
| Trail 4x4 | [Willy Jeep](https://sketchfab.com/3d-models/willy-jeep-b635f6d5a7a045cf9bae3cc71952cd23), thinned from 297,000 triangles to 122,000 | [AnilG](https://sketchfab.com/AnilkumarG) | CC BY 4.0 |
| Supercar | [Fictional supercar - V12 Goblin](https://sketchfab.com/3d-models/fictional-supercar-v12-goblin-0a20e49ad5774d778567cb5c3f345786), repainted orange | [ollitei](https://sketchfab.com/ollitei) | CC BY 4.0 |
| Vintage car | [Retro Car](https://sketchfab.com/3d-models/retro-car-2836e72f327f4d6f9fe836d646496927) | [pisarenok](https://sketchfab.com/pisarenok) | CC BY 4.0 |
| Camper van | [Volkswagen Kombi Micro Bus](https://sketchfab.com/3d-models/volkswagen-kombi-micro-bus-d34fd744db1c4f84ad40c854ddbff9e9), badge removed, cab mirrored to left-hand drive | [winterborn](https://sketchfab.com/winterborn) | CC BY 4.0 |
| Cafe racer | [Cafe Racer](https://sketchfab.com/3d-models/cafe-racer-c02dec85ac0541b8ab6dd56098706b50) | [Andrei Milin](https://sketchfab.com/milinam2002) | CC BY 4.0 |
| Rider's helmet | [moto helmet](https://sketchfab.com/3d-models/moto-helmet-6c75ac1b13a047bd86742f37ce25adac), side badges and their mounts removed | [sayedgamal655](https://sketchfab.com/sayedgamal655) | CC BY 4.0 |

`tools/cars/process.mjs <kind>` turns a download in `downloads/` into the game's file: it bakes every part into one car facing +z with the ground at y = 0, scales it to length, splits out the four wheels (by name, or, where they are merged into the chassis, cut out of it around each axle, taking only pieces wholly inside a wheel so the arches stay on the body) so they spin and steer, moves the lamp lenses to "lamp" and "tail" materials the game lights at night, takes off badges, shuts parts modelled open (the camper's engine lid, swung down on its hinge), mirrors a right-hand-drive cab (the camper's) so the wheel sits in front of the left-hand seat the game drives from, cuts the steering wheel out as a part of its own (its rim fitted with a plane to find the centre and the column's line, kept on the part as `pivot` because compressing the file moves the part's origin) so it turns about its own centre with the steering, thins dense models, makes part-metal paint matte and recolours it (the 4x4's brown, rusty olive becomes a flat olive drab, its muddy tyres dark rubber), turns spec-gloss materials into metal-rough ones (the supercar's paint comes out of its specular map), and compresses it. The 4x4, vintage car and camper bring their own cabins for the cockpit view; the supercar keeps the built-in one. Every steering wheel turns with the steering, in every view (the open 4x4's shows from outside too). The cars are sized against each other when they load (`scale` in `models.js`, the whole model at once so each keeps its shape): the supercar is the smallest (4.55 m long, 1.16 m tall), the old roadster at its true size (5 m long, 1.93 m tall: lower and slimmer than the 4x4, and tall enough inside for its driver to sit up), the 4x4 bigger and bulkier (4.5 m long, 2.05 m tall, 2.1 m wide, on bigger tyres), and the camper van much the biggest at 5.6 m long and 2.5 m tall. Their footprints for collisions (`radius`, `halfLength` in `specs.js`) and chase cameras follow; the chase camera sits at nearly the same distance behind each, so the van looks as big as it is. **The driver** (`src/vehicle/driver.js`) is the man you walk as, at the wheel whenever you are in a car, posed by hand. He is drawn at his car's own scale (the cars are scaled up from their models' roughly true sizes to set them against each other, and he grows with them: 1.25 times in the 4x4, 1.4 in the camper), so he keeps his proportions to the car. He sits on the car's own seat, found by casting rays into the car (the footwell floor, then the cushion 15 to 60 cm above it, the backrest just behind and the roof overhead); of a range of postures (leaning back or forward, sitting further forward on the cushion) the most natural one that both reaches the wheel and keeps his head under the roof is used, so he reclines in the supercar and sits up in the camper. His feet rest on the floor, knees bent, short of the footwell's front wall (found the same way). His hands hold the rim a little above quarter to three: each hand carries on from its forearm (the wrist bends 10 to 50 degrees, the forearm takes the twist as a real one does), the rim crosses the palm, the thumb lies over the top, and the fingers are drawn together and close round it. The hands turn with the wheel and slide on it past about 70 degrees rather than cross. He is seen from outside; in the driver's view the camera is his eyes, so he is not drawn. The supercar's built-in wheel shows from outside too, so he has something in his hands. The mirror glass is cut out when a car loads (`mirrors` boxes in `models.js`: the backward-facing triangles inside them).

**The cafe racer** has two wheels and is handled as one. `tools/cars/bike.mjs` prepares it and the rider's helmet: the model is all one material, so it is cut up by shape. The tyres are the two pieces standing on the ground; each wheel is every piece (a run of triangles joined at their corners) lying wholly inside a cylinder round its axle. The steering (fork, clamps, flat bars, levers, headlamp and indicators) is every piece within 25 cm of the steering axis, through the middles of the two fork clamps (a 22 degree rake), and is saved as `steer` with its +z up that axis. The grips are the outer 13 cm of each end of the handlebar itself (the widest piece in the steering; the flat levers in front of them run across too, but are not the bar), kept on the steering part for the rider's hands. The headlamp's lens becomes a lamp of its own, so it shines at night. It carries no maker's marks. It is drawn 1.1 times its true size (2.2 m long) so it sits right under its rider, who is not scaled. In the game the front wheel hangs in the fork and turns with it (`steer.attach`); the bars turn well over at walking pace and only a little at speed, left for left and right for right (`turnWheel` in `interiors.js`: the bike's steering axis points the other way from a car's column, so its sign is flipped). **Wheelie** (`wheelieStep` in `jeep.js`): the bike has no nitro; Space, or a slide up from Go, lifts the front to its balance point (about 29 degrees) on a spring, where it hovers with a little waver as a rider holds it on the throttle. It needs the throttle on (or some speed), the ground under it and no deep water. The bike turns about where its back tyre meets the road, so that tyre stays down, and steers a little less with the front up. Let go and the front falls back, landing on its tyre with a nudge into the fork. In the air it keeps its attitude. The nitro gauge and the ring around Go are hidden on the bike, and the first slide shows "Wheelie!". It leans into its turns by the angle that balances the turn at its speed (tan lean = speed x turn rate / g, at most about 37 degrees, upright at walking pace), about the line where its tyres touch the road, and follows the ground nose to tail on its two wheels but stays upright across a slope (`syncBike` in `jeep.js`). It cannot float: it stops at water deeper than it can ford ("Too deep for the bike"). **Its sound** (the `twin` voice in `audio/engines.js`; see Engine sounds) is a parallel twin with a 270-degree crank, as in a Triumph Bonneville or Scrambler: two exhaust pulses each cycle, 270 and then 450 degrees apart (the uneven beat that makes it lope), each a crack of exhaust noise ringing in the pipe over a low thump, looped and played at the revs through five gears (changing up near 6,800 rpm), brighter on the throttle. Roll off at speed and its exhaust nearly always pops and crackles, three to seven blasts, with the odd one while coasting at high revs. Its chase camera sits closer and follows more tightly than a car's, so it does not shrink into the distance at speed. In the garage its picture is framed closer than the cars' (theirs share one distance, to show their sizes against each other). **The rider** (`ride` in `driver.js`) sits astride the bench just behind the tank (`seatZ`; the seat's height found by casting down onto it), leaning forward by the lean nearest the bike's own (`lean`: fairly upright behind flat bars) that still reaches the grips (about 40 degrees here), head raised to look down the road; his hands close round the grips, the palm over the top and the thumb round underneath, fingers by the levers, and go round with the bars; his knees bend forward to his feet on the pegs (`pegs`). He wears the open leather helmet with goggles, set on his head each frame square to it. Off the bike he walks bare-headed.

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
| Canopy: dive (front risers) / brakes; held from about 8 m up, the flare | Up / Down | Go / Brake |
| Chase view or his own eyes | C | |
| On the ground: call the helicopter, or get in beside it | E | Call / Get in |
| On the ground: a car instead | V | Menu, Cars |

- **Physics** (`src/vehicle/skydiver.js`). Free fall: face down about 53 m/s, tracking 49 down and 22 forward, spread out 45; body positions are springs and turns have inertia, so nothing snaps. The canopy is a wing, flown from its forces: a 20 m² nine-cell canopy carrying 95 kg, its lift and drag coefficients blended between trim (0.54 and 0.234), full brakes (1.9 and 1.0) and full front risers (0.385 and 0.183). Each step solves speed along the flight path (drag and gravity) and the path's angle (lift, tilted by the bank, against gravity), so the glide comes out of the forces: 10.5 m/s forward and 4.6 down at trim, 5.3 and 2.7 in deep brakes, 12.5 and 5.8 on the risers. **Opening**: the pilot chute pulls the bag out (0.45 s to line stretch), then the canopy inflates over 1.5 s, half-open mostly drag, the slider holding the shock near 2.5 g; it loses about 120 m and opens slightly off heading, with its brakes stowed, released 0.7 s after it flies. **Controls are hands**: each toggle and the risers are springs (about 0.4 s), and held brakes pull both toggles down progressively, about a second to the hips, as a flare is flown. **Turns**: the toggle difference sets a yaw rate that builds with lag and scales with airspeed; he swings out into the bank the turn needs (tan bank = speed × turn rate / g) as a damped pendulum (1.7 rad/s), so a turn rolls in and out smoothly with a slight settle, the banked lift sinks him faster, and held a while the nose drops and the turn tightens (a spiral, about 1.4 rad/s, 50°, 6 m/s down). Fore and aft he swings as a 5 m pendulum against the wing's surges (forward in a flare, back on the risers), and the wing stays nearly level above him. **The flare**: braking pitches the wing up at once while its drag builds over 0.4 s, and pitch damping (lift falls as the path curves up) stops it ballooning, so held from about 6 to 12 m up the path levels out, the sink falls to 0 to 2 m/s and the speed bleeds to 4 to 7 m/s by touchdown. Under a canopy he always lands on his feet and runs it out: a few strides, longer the faster he is going (no faster than a sprint, 6.5 m/s, as the canopy's drag takes the rest), slowing to a stop over a couple of seconds, knees bending more the harder he came in (under 3 m/s down a soft landing, unflared about 4.6 a firm one). Only something far harder (7 m/s down or 16 across, a diving turn into the ground) or no canopy at all is a roll. The canopy flies on a little further than his run-out, sinks as it loses pressure and lies flat in front of him. Sub-steps of at most 1/120 s keep it the same at any frame rate. The game's wind drifts both, and soft walls keep him inside the map.
- **Nothing ends badly.** An automatic opener fires once the ground, under him or ahead along his path, is closer than the canopy needs to open at his speed plus a margin (about 120 m at full speed), so a jump with no pull at all still lands. A landing is soft when it comes down gently and slowly through the air (flared, or on deep brakes); anything firmer is a forward roll and he stands up. He never stays in water, on a roof or on a slope too steep to stand on: he is put on the nearest ground he can stand on (the shore, beside the building, the foot of the slope), behind a quick fade. Ground contact is checked along his whole path each frame, at most a metre at a time, so at 55 m/s and 20 frames a second he cannot pass through the ground or a roof.
- **Locked while in the air**: changing vehicles (V, the Cars tab, tapping a car), fast travel, getting in or out (E), looking up (L), sitting (X) and fuel or towing (F). C switches the camera instead. Menus pause the fall like everything else. Recording a clip works throughout.
- **The empty helicopter** (`fly` in `heli.js`) keeps its engine on and is flown by an autopilot through its own easy controls (so it keeps its terrain following and gentle touchdowns): it stops and hovers, then finds flat, dry, open ground nearby (nine points within 4 m all within 0.9 m of each other, no roof, not on water, at least 30 m from you) and lands there, and shuts down. Over the sea it flies to the nearest such ground. Called (E, or Call), it starts up, flies over and lands on flat ground 18 m or more from you, or tells you to walk to flatter ground if there is none within 400 m. It comes down from high up three times faster than a pilot would with passengers. If the ground under it turns out steep or wet, it tries elsewhere; if you walk under it, it picks another spot.
- **On the ground** he keeps his pack and helmet until he gets back in. The on-foot leash (120 m) is centred where he landed until the helicopter has landed near him; E and C call it from afar and only get in beside it (16 m). Choosing a car puts you in it, beside you or on the nearest road.
- **The canopy** is built in code, as a sport canopy is made: nine fat, pillowy cells in an arc (the top skin bulges up between the ribs, the bottom a little down), a thick airfoil (17%) with the cell mouths open across the front and the dark rib walls seen inside, tapering to the tips, in navy, white and red. Lines run from four points along each rib, join in cascades and come down to four dark risers at his shoulders through a red slider, which slides down as it opens; the steering lines gather from the tail to his hands. It streams out of the pack as a bundle, spreads and inflates, banks with the turns, and after landing sinks forward, deflates and lies flat on the ground, then is packed away. (Sketchfab had no ram-air canopy that was both original and better than this: the good-looking ones are game rips.) Under the canopy the camera rides level with the wing, behind it, and drops toward him near the ground. **The pack** is a rounded black container with a red handle; it and the helmet are fitted to his bones each frame, on the jumper and then on the walker.
- **The jumper** is the same man, posed by hand with the driver's tools (`driver.js`): the exit (standing in the door, then rolling flat), the box (arms out and bent, knees bent, head up to the horizon), tracking (arms swept back, legs straight), hanging under the canopy (hands on the toggles, pulled down to turn or flare, legs together and forward near the ground) and the landing roll.

## Sunset and sunrise

Above 12 degrees the sky is physical (Preetham scattering). Below it a painted sky modelled on real sunsets blends in (fully by 5 degrees), keyed to the sun's height at 10, 4, 0.5, -2, -5 and -10 degrees (`elRamp` in sky.js):

- **Golden hour**: the horizon under the sun turns gold, the sun's glow warms and widens.
- **Sunset**: under the sun a fiery red-orange band, a peach glow above it fading through a thin green-cyan band into deepening blue; the disk and its glow redden as they near the horizon, and the glow lingers after it sets.
- **Opposite the sun** the horizon blushes pink, and as the sun goes down the Earth's shadow rises there as a blue-grey band under the pink belt of Venus.
- **Clouds** are lit from below: gold, then orange, crimson, pink and last violet as the sun sinks, hottest toward the sun, cool lilac-grey away from it. Under a full deck the low sun reaches only the cloud near the horizon on its own side, so overcast evenings are a grey-violet lid over a glowing strip.
- The water and wet ground reflect this sky (it is in the environment map too), the fog takes the horizon's colour so distant hills fade into it, and sunlight turns deep orange near the horizon. Sunrise runs the same in reverse.

## Photo mode

O (or Photo mode in the aurora bar) holds the game still, hides the HUD and hands you the camera (`src/ui/photomode.js`): drag to look, WASD to move (Shift for faster), Q and E to go down and up, scroll or pinch to zoom; on a phone, drag, pinch and a move pad. Exposure brightens or darkens the shot; where the picture runs through the effects pipeline (not on Low), Focus and Blur throw the background or foreground soft (a depth-of-field pass, on only in photo mode). Take postcard (or Enter) saves the frame to the Journey like any sighting. Esc or O leaves.

## The aurora at its strongest

On top of the substorm phases (a quiet arc, a breakup, pulsing patches): in a breakup the curtains flicker several times a second, unevenly along their length, and the lower border flushes magenta (nitrogen). At high Kp a faint red glow hangs high above the curtains. A strong breakup overhead at Kp 5 and up brings a corona: rays all round converging on a point near the zenith, each flaring and fading, light streaming along them toward the centre, green low and violet to red toward the radiant point, which is itself dim.

## Driving feel

How hard the tyres are working sideways (the cornering load against what the car can hold, a slide, or locking up under hard braking at speed) drives two things: a tyre squeal on tarmac (a rough, wavering tone near 1 kHz that rises with speed) and skid marks from the rear wheels (dark rubber on tarmac, pale scuffs on gravel and grass, the oldest overwritten after 1,600 strips): darkest down the middle of the tyre and soft at its ragged edges, with the tread printed across them and the rubber laid unevenly along them, fading in as a slide starts and out as the tyre grips again. The chase camera stays level through corners. It keeps its distance from the car at any speed: it eases round turns and over bumps but never drops behind as you speed up, and as the view widens with speed and nitro it comes in by as much, so the car keeps its size on screen (only a hint of pull-back) while the world around it stretches. The opening shot after Start sweeps down onto the car as an offset over this follow camera that eases out to nothing, so it lands exactly where the follow camera is, with no settle or snap at the end. Tyres slide when you steer hard for the speed (from full lock at about 40 km/h, or under half lock at 100) and when you brake hard from about 25 km/h. Off the tarmac (gravel roads, grass, sand) a light haze of dust rises behind the rear wheels, more of it the faster you go, coloured by the ground, drifting and hanging in the air, faded close to the camera so it never hides the car, and gone when the ground is wet.

## Places you can hear

From recordings (`public/sounds/place`): the roar of a waterfall grows as you come near it, surf runs along the sea coast, strong gusting wind blows up on the passes and high exposed ground, and sheep close by bleat now and then. From inside a vehicle all of it is quieter and muffled.

| Sound | Recording | By | Licence |
| --- | --- | --- | --- |
| Waterfall | [Waterfall](https://freesound.org/s/840024/) | Ultra-Edward | CC0 |
| Surf | [Ambiance_Ocean_Ribeira_Grande_Loop_Stereo_02](https://freesound.org/s/829629/) | Nox_Sound | CC0 |
| Wind | [mountain wind heavy strong gusts Swiss Alps](https://freesound.org/s/454092/) | kyles | CC0 |
| Sheep | [Sheep baa](https://freesound.org/s/669765/), [Ewe Shetland Sheep Baa](https://freesound.org/s/692900/), [Sheep baaing 5](https://freesound.org/s/710300/) | Chipsplease, satoristudios3, michaelperfect | CC0 |

## Rain

Under thick cloud, showers drift across the island in bands, wherever it is not cold enough to snow (main.js; `chasingGreen.rain = 1` forces it). Streaks fall through a box that follows the camera, slanted by the wind and fading close to the eye so none fall inside the cabin, and drops burst on the ground and water all round (`RainFall` in effects.js). Raindrop rings spread on every puddle, pool, lake and the sea. The ground gets wet within half a minute and takes a few minutes to dry: wet tarmac darkens and turns smooth enough to mirror the sky and headlights, the land darkens a little. From the driver's seat drops land on the windscreen and gather, creep down it when slow and are driven up and aside at speed, and the wipers sweep them away, faster in heavier rain (`Windscreen`). The rain is heard all round outside, and from inside a vehicle as drumming on the roof with the rain outside muffled.

| Sound | Recording | By | Licence |
| --- | --- | --- | --- |
| Rain | [R30-25a-Steady Heavy Rain](https://freesound.org/s/486272/) | craigsmith | CC0 |
| Rain on the roof | [Inside a car in the rain](https://freesound.org/s/448125/) | derjuli | CC0 |

## Night driving

Dipped beam by default; B (or the Beam button that shows on a phone once it is dark) switches to full beam, brighter and reaching about twice as far, aimed higher up the road. The marker posts' reflectors send the headlights back toward the car: faint on their own, blazing where the beam falls on them, further down the road on full beam. Animals caught in the beam looking back show eyeshine, two bright points in their own colour: green-gold for a fox, pale green for a sheep, blue-green for a horse, deep blue for a reindeer in the winter dark.

## Water you disturb

- **Puddles** (`Puddles` in effects.js) are water, not stains: one mesh in the game's physical material, so each reflects the real sky (the scene's environment, clouds and all) with the right Fresnel, strongly at a low angle as from the driver's seat and hardly at all looking straight down, where the wet black tarmac shows through. The sun glints off them, a breeze barely shivers them, their outline is ragged and soft, and the tarmac round each is darkened by the wet. Driving through sends rings across them from each wheel. How much water flies goes with the speed: rolling through slowly the tyres only push a little aside, low and close, with a soft, short, muffled slosh; fast, they throw a sheet of spray from each wheel in the water and the full hiss of it.
- **Water off the tyres** is thrown as water: crisp separate droplets flung from the outer edge of each tyre in the water, fast and low out to the side or steep and short upward, a little forward with the car, falling back with gravity; a big throw the moment a tyre hits the water and a steady spray while it runs through (timed in seconds, so a fast pass at a low frame rate still splashes), scaled by speed in a puddle and heavier in a lake or river, with a fine mist at speed.
- **Wet tyre tracks**: out of a puddle or the water each tyre prints a dark wet track that thins over the next 14 m or so as the tyre dries, and the prints dry away over half a minute (`WetTracks` in effects.js). In rain everything is wet, so they do not show.
- **Ripple rings** (`WaterFx` in waterfx.js) spread across lakes and the sea from a wading car's wheels: each a wave front, a bright crest with a dark trough just inside, widening, softening and fading.
- **Rotor downwash.** The air comes straight down under the rotor, turns at the ground and runs out flat in every direction, strongest at full rotor speed close down and gone by about 25 m up, so everything is pushed outward from under it. Grass is blown flat in pulses as the blades pass. On land, dust billows out low along the ground in a ring, coloured by the ground: black off the volcanic beaches, grey off gravel, a pale dun off dry grass and earth (snow is lifted as powder). On water, a band of water roughened by gusts and flecked with white races outward, rings spread from under the rotor a few a second, and mist and spray are thrown out flat across the surface.
- **Kerið's crater lake** is part of the land's water level (`waterLevelAt`), like the big lakes: drive down the scree and the car wades in, then floats as a boat where it gets deep, instead of driving about on the lake bed under the water.
- **Pools and crater lakes** (waterfall plunge pools, Kerið's lake, ponds) are water too, not just the sea and the big lakes: every mesh in a water material is found (`scanPools` in main.js), so wheels splash, spray and send rings across them and the rotor wash ruffles them like the sea, kept inside a small pool's edge. A pool laid on the ground gets a bowl depth (`bowl` in createWaterMaterial), clear and dark in the middle with foam only round its rim, where before the shallow-water foam turned it into a white disc. Each set of water options compiles its own shader.
- **Fords** are shallow, clear river water (their own water material in terrain.js): the stony bed shows through, brown at the edges and darker where it deepens, with the sky laid over it and a little flow on the surface. They used the lakes' water before, whose shoreline foam covered anything that shallow and turned the whole crossing milky blue.
- **Splashes** play recordings (`public/sounds/water`), each a little faster or slower every time: a tyre through a puddle, a splash into water, and a big one for a fast or deep plunge.

| Sound | Recording | By | Licence |
| --- | --- | --- | --- |
| Tyre through a puddle | [Water Puddle Splash](https://freesound.org/s/563021/) | cookies policy | CC0 |
| Splash | [Watersplash](https://freesound.org/s/469608/) | Sheyvan | CC0 |
| Big splash | [Big Water Splash](https://freesound.org/s/442773/) | qubodup | CC0 |

## Winter

From October to April the months bring winter (`WINTER` in main.js, strongest from December to February):

- **Snow on the roads.** Packed snow lies on the road, worn back to dark tracks by the wheels, with drifts reaching in from the edges and the ploughed snow banked along both sides; the yellow marker posts stand along the edges as before (road shader in materials.js, `uRoadSnow`). There is more of it where the land is white and while it snows, and it changes slowly as you drive, so it never switches in view. Wet weather does not darken the snow the way it darkens bare tarmac.
- **Black ice.** Patches of glazed ice, dark and glossy enough to mirror the sky and headlights, lie on the roads. `iceAt` (terrain.js) finds the same patches as the shader, so they are really slippery: on ice the car keeps going the way it was heading while you turn, slides, brakes and pulls away poorly, and grips again once off it; it is quiet and leaves no rubber. Packed snow takes some grip too, and so does snow off the road. The first patch of each trip gets a word of warning.
- **Snow showers** drift across the island under cloud, more often in midwinter and heavier on high ground and in the north (`chasingGreen.snowFall = 1` forces them). At night the flakes are dim grey shapes until they drift into the headlights, where they light up, further out on full beam; raindrops catch the beams the same way (`headlightUniforms` in effects.js).
- **Tracks in the snow.** On a snowy road or across snowy ground each tyre presses a rut with a tread pattern, and on foot each step leaves a boot print (`SnowTracks` in effects.js). They darken the snow by multiplying over it, so they read right by day, by moonlight and in the headlights, and they fill in over a few minutes. Skid marks are left off on snow, where the ruts already show the slide.
- **Ploughed banks.** The verge's outer edge rises into a snow bank in winter (in the road's vertex shader), and the verge is lit as if nearly flat, so the bumps of the land under it never show as a toothed edge in low light.

## The moon

The moon has phases and its own path (time.js): the trip starts in the middle of the chosen month in a real year and follows the real lunar month from there, so the phase changes night by night. It rises about 50 minutes later each day and rides the path the sun takes half a year later, so a full moon in winter is high all night. The sky draws it as a lit sphere showing its phase, with darker seas and a faint earthshine, and the glow round it, the moonlight on the land and how many stars it drowns all follow the phase. A bright moon up in the sky washes out a faint display (`moonGate` in forecast.js) while a strong one still shines through, so waiting for moonset, or for a dark week, is part of the chase. The aurora radio shows the moon's phase and whether it is up, and says when it is what stands in the way.

## The night sky in the water

After dusk the water mirrors the night sky: the aurora, the moon and the stars (`SkyReflection` in skyreflect.js). A small cube of just the sky dome, the clouds and the aurora is drawn round the camera, a couple of faces each frame, and every water surface (the sea, lakes, Kerið, fords, hot pools and puddles) adds it as a reflection by Fresnel: faint looking straight down, strong at a grazing angle, steady enough on calm water to show the curtains upside down, wobbled by the ripples. Water itself is darker at night, so what you see on it is the sky. (By day the water reflects the baked sky environment as before.)

## A car that gets dirty

Driving picks up dirt (`grime.js`): pale dust off gravel, dark peaty mud off the moss and wet gravel, black grit off the sand, grey slush off winter roads, silt from fords and road spray in the wet. It builds up from the wheels: a solid coat on the sills and arches, a patchy band above that reaches higher the dirtier the car gets, and spatters above that, with the paint gone matte and the shine gone from the clearcoat under it. New dirt blends into the colour of what is already there. Rain slowly rinses it off, and deep water or a spell as a boat washes most of it away. It is kept between visits, so a long drive leaves its mark, and it shows in postcards. Every car gets it, the Sketchfab cars included.

**Car wash.** Every fuel station has a drive-through wash past the end of its roof, in the lane between the pumps, under a BÍLAÞVOTTUR sign (Icelandic for car wash). Roll through slowly and the brushes spin up, water sprays down from the bar and drums on the roof, and the car comes out clean; faster than a crawl it only half works, and it tells you to go through again (`washAt` and `updateWash` in stations.js, `carWash` in main.js).

The brushes (`src/world/washbrush.js`) are made of foam strips, about 3,000 of them over two upright brushes and one across the top, mostly blue with a few grey and white. Standing still the strips hang limp off the shaft like a mop (the upright ones slump down their shafts); spinning, they fling straight out, trail behind the turn and flutter. Against the car they fold over and lie along its panels: each strip is worked out in the vertex shader, step by step from the shaft, and a step that would end inside the car is pushed back out onto its surface. The car is two rounded boxes (its body to the bonnet line, and its cabin), measured once from the vertices of the model you drive. The overhead brush rides up over the bonnet and the windscreen on a spring. Wet brushes go darker and glossy, fling water off their tips along the turn and drip once they stop, drying over a minute and a half. Only the wash nearest you has brushes: one set moves to it.

## Waves on the shore

(`src/world/surf.js`.) Swell rolls in from the open sea every nine seconds or so, each wave a different size. It rises as the sea shallows, steepens, and breaks where the water gets too shallow to hold it (about 1.1 to 1.7 times its height): out on a gentle beach, right at the water's edge on a steep one like Reynisfjara. A breaking wave throws white water down its face, glows green-blue at its thin top, and runs on as a churning band that leaves lacy foam on the water. Crests reach the shore at slightly different moments along it, so they break in sections.

At the shore each wave runs up the sand as a thin glassy sheet with a band of bubbles at its front and slows. Then it drains rather than sliding back in one piece: the sheet thins from the top down so the sand shows through, its edge breaks into scallops and fingers, the foam on it streams back down the beach with the water (its direction found from the distance to the waterline across the screen), and a line of foam is left where it reached, which fades as it sinks in. The black sand stays dark and softly shining for a while. Most waves run 3 to 7 m up the beach. About one in ten is a **sneaker wave** that runs nearly three times as far: the first time one reaches you it warns you never to turn your back on the sea, and on foot it shoves you up the beach and tugs you back down it. Any wave that reaches you splashes round your feet or the tyres, and the surf you hear swells as each wave breaks.

It is drawn as a patch of water (280 m across, 200 m on Low) laid over the sea and the shore round you whenever you are near the coast. It is clear wherever nothing is happening, so the sea shows through, and the sea's own shoreline foam fades out under it. Everything is a function of time, place, the ground height and the distance from the waterline. That distance is worked out once for the whole island from the height grid (where the ground drops below the sea, placed between grid points, then spread with a chamfer sweep), and the game asks the same question of any point (`waterAt`) for the splashes and the warning. Nothing grows on the sand the waves reach.

## Hot pools

The Blue Lagoon, Secret Lagoon, Hvammsvík, Mývatn Nature Baths, GeoSea and Hveravellir have pools you can get into (`kit.bath` in the landmark builders; `bathAt` and `rimAt` in landmarks.js). Park, step out and walk up over the rim: you sink to your shoulders and wade slowly. Stand still for a few seconds and you lean back to watch the sky: the sitting view with your eyes just above the water and time passing six times faster, so a hot pool is a warm place to wait for the lights, and a display seen from the water is logged like any other. The water mirrors the aurora overhead. Steam drifts low over the water round you, and the pools' own steam thins out close to you so it never blots out the sky. Walk on to sit up, and on out over the rim to leave.

## Fuel

Each car has its own tank, saved between visits, shown as a pump and a bar under the speed: white, amber below a fifth, red and blinking when empty. Turn it off in Settings, Fuel.

| Car | Tank | Range on a full tank |
| --- | --- | --- |
| Trail 4x4 | 80 litres | about 9 km |
| Vintage car | 45 litres | about 7 km |
| Camper van | 90 litres | about 10 km |
| Supercar | 70 litres | about 8.5 km |

- **Burning it.** Fuel goes with distance, not time: under power it burns at the full rate, coasting at a fifth, and standing still not at all, so waiting for the aurora costs nothing. Nitro burns three times as fast, and off-road and afloat a little more. In the last 1.5% the engine coughs and loses power now and then; at empty it stops and the car rolls to a halt.
- **Warnings.** At a fifth of a tank and again near empty a message gives the litres left and the nearest station, with a Route button that sets up Drive there to it.
- **Stations.** Six, on the Ring Road outside Selfoss, Vík, Höfn, Egilsstaðir, Akureyri and Borgarnes, so a full tank always reaches the next: a forecourt open to the road, a lit roof over two pump islands, a small shop, and a sign by the road reading ELDSNEYTI (Icelandic for fuel). At night the roof, the shop and the sign light up. Each sits on a level pad, on a spot by its town (within about 260 m, closer preferred) chosen to be flat underfoot and level with the land around it (within about 40 m; land falling away counts more than land rising, since a forecourt cut into a slope looks natural and one on a mound does not), and kept out of the river valley carved under each bridge, which used to leave a station standing on a mound above the fields. Selfoss's still stands near its bridge, as the real one does. They show as amber squares on the minimap and the map.
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

**Dynjandi** (`dynjandi` in `landmarks_extra.js`) is built as it really looks: not a sheer drop but a broad hillside of basalt ledges, one lava flow on the next, with the river spreading down it like a bridal veil, about 15 m wide at the lip and 31 m at the foot over a 48 m fall (the real one is about 30 m, 60 m and 100 m). The hillside is one terraced surface with 28 uneven ledges, taller near the top and deeper near the foot, their edges wandering across the face and the same bands running right across the hill, which keeps climbing in rounded shoulders behind the lip. The water follows the ledges: on each one it breaks white down the riser and churns across the shelf, every ledge spilling a little wider or narrower and a little off line, under a second, finer layer of spray. A river runs in across the plateau to the lip; at the foot are white water, a dark pool and drifting spray. The hill is solid ground: it can be climbed on foot, and its risers are walls. It stands 32 m or more from any road.

## Wildlife

Animals live where and when they really do (`src/world/wildlife.js`). The first time you see each one, a short note says what it is (saved, so it shows once).

- **Sheep** roam free in the hills from May to October in groups of three to seven, sometimes onto the road; in winter only a few stay out. **Icelandic horses** graze near farms all year, in bay, chestnut, grey, black, palomino and white. **Reindeer** live only in the east, in herds of four to nine. An **arctic fox** (white in winter, brown or dark in summer) turns up alone now and then, and at night its eyes shine green-gold in your headlights.
- Herd animals graze, wander a little, and run off when a car or someone running comes close: sheep at 14 m, horses at 9 m, the skittish reindeer at 38 m (a runner gets three quarters as near). Walk up to them instead and they only amble a few steps aside (sheep at 5 m, horses at 1.6 m, so you can walk up to one and ride it; foxes and reindeer stay warier); follow one and it moves off again. Their bodies are solid to someone on foot. Herds are seeded per 220 m cell, so the same flock is in the same field when you come back.
- **The models** are real, rigged and animated ones from Sketchfab (credits below), drawn by `src/world/animalRigs.js`. Each species is fetched the first time it is needed (`public/models/*.glb`, 0.06 to 2.9 MB each).
- **Up close** (within 70 m, the nearest 6 horses, 14 sheep, 8 reindeer and 3 foxes; about half that on phones and Low quality) each animal is a full rig with its own skeleton, crossfading between its clips: idle, grazing, walk, and a gallop for the horse (a trot and a run for the reindeer). Clip speed follows ground speed (measured from the planted hooves, root motion taken out), so hooves do not skate: a horse walks up to about 2.4 m/s and gallops above it, the gallop slowed for a canter. On top of the clips the neck is bent in code: down to graze where a model has no grazing clip, and up and turned to watch you when you come close. The sheep model has no walk, so its legs are placed by code: each hoof is planted on the ground while the body passes over it, then lifted in an arc and put down ahead, and the two bones of the leg are bent to reach it (two-bone inverse kinematics), so the knees and hocks fold the way the leg already bends at rest; a four-beat walk turns into a trot (diagonal pairs together) as it speeds up, the stride lengthening with speed and the body dipping a little with each step. (Swinging each bone by a set angle, as before, kinked the hind legs and splayed the hooves.) The far-off instances get four steps of the same walk. Rigs further than 35 m are stepped at half rate, and only those within 32 m cast shadows.
- **Further off** they are instances of a low-poly copy of the model baked in six poses (standing, grazing, four steps of the walk), one draw call per pose in use.
- **Coats** are the model's own texture recoloured per animal by its brightness against the texture's typical brightness, so shading, markings and hair stay. The horse's texture is a skewbald, so a mask made when the model is processed (`paintMask` in `tools/animals/process.mjs`, kept in the material's unused occlusion slot) says where it is coat, white patch or bare skin (the pink of the muzzle and gums, which keeps its own colour), with each patch's shading taken against its own typical brightness and the edges between them filled in from either side, so a solid coat shows no outline of the patches. Horses come bay with black points, chestnut, flaxen chestnut, black, grey, palomino, dun and white, and as skewbald and piebald paints, with their own mane colour; white, black, brown and grey sheep, some with dark faces and legs; the arctic fox white in winter, brown or blue-grey in summer; grey-brown reindeer (the model is an elk, retinted and scaled down, so its antlers are an elk's). Up close (except on Low) fur and wool get a soft sheen, light caught in the tips of the hair that is brightest at grazing angles and gives fleece its fuzzy edge against the light; the belly and the insides of the legs are a little darker, the sky reaching them less; eyes are wet and glossy. The horse keeps its normal maps (fine folds of skin and muscle), its colour at 2048 pixels.
- **Seals** are a scanned harbour seal, instanced; the vertex shader lifts and turns the head and raises the hind flippers a little, as a resting seal bends into a banana. **Whales and dolphins** play their swim cycle as they surface, blow, roll and dive.
- A field of horses adds about 60 draw calls and 0.35 million triangles (about 8% of the frame); the animals update in under a tenth of a millisecond.
- **Seals** haul out at Jökulsárlón, Diamond Beach and Ytri Tunga, lift their heads now and then, and slip into the water if you get close, hauling out again once it is quiet.
- **Puffins** stand about in little groups on the clifftops at Dyrhólaey from May to August, the arch's grassy top and the sea stacks, turning their heads, while a flock wheels round on fast-whirring wings, low over the sea and up past the cliffs.
- **Humpback whales** feed in Skjálfandi Bay off Húsavík from April to October: under water most of the time, then a blow, the long back rolling over, and the fluke lifting as they dive. In winter **orcas** come into the fjords on the north side of Snæfellsnes after the herring. They keep clear of a boat (orcas 35 m, humpbacks 55 m), swinging out round it, and stay down if it comes on too fast.
- Take the boat out at speed, away from land, and a pod of **white-beaked dolphins** may come to ride the bow wave, swimming alongside 6 to 9 m out from the hull, porpoising and now and then leaping, until you slow down or near the shore.

### Riding a horse

On foot beside one of the horses in the fields, E (or **Ride** on a phone, where the In/Out button becomes Ride) puts you in the saddle: it is saddled and bridled, and you sit it with your feet in the stirrups and the reins in your hands (`src/vehicle/horseride.js`). The horses let someone walking come right up to them.

- **Forward** walks it on; held, it picks up into a canter and then a full gallop at 36 km/h. Shift keeps a walk. **Steering** turns it, tighter when slow and on the spot when stopped. **Back** slows it and, once stopped, backs it up a few steps (the walk played in reverse). **Space** (a slide up from Go) jumps.
- It will not go into water deeper than its belly or up a slope steeper than it can climb, and says so.
- The rider leans forward into the canter and gallop. His arms and legs are posed outright each frame from his rest (T-pose) frames: each elbow and knee bends about its own hinge towards a set direction, the forearms turn the hands over by a fixed amount (thumbs on top, palms a little down), and the fingers close round the reins. Nothing is left over from his idle clip, so his arms do not twist as the horse turns or the view moves round. His hands go to a fixed place low in front of the saddle (forward and lower as he leans in), set from the seat in the horse's heading as his body is. They used to follow the horse's neck, which swings and twists a long way as it grazes and canters, and that could pull his hands round behind his back. When he gets on, the horse is briefly set back at the origin to find the seat and irons in its bones; it is turned back afterwards by its heading alone (restored from its quaternion, the turn could come back as half turns about two other axes, and the horse was then drawn facing the wrong way under him). The camera sits higher and further back than on foot and keeps up at a gallop; the speed shows in the cluster, with On horseback above it.
- **E** (**Off**) gets you down on its left side, and it stays where you left it to graze. Ridden a long way from the car, you find the car parked on the road nearest you (the helicopter lands beside you).
- **Sound.** A hoofbeat as each hoof lands, in step with its legs: the walk and gallop clips were measured for where each hoof comes down (`FALLS` in `horseride.js`: the walk's four-beat left hind, left fore, right hind, right fore; the gallop's two hinds then the leading fore), and `hoofbeats()` reports the ones crossed each frame, played in their true spacing a frame late so a slow frame never bunches them. Each is one of several recorded takes (`public/sounds/horse`, see "Hooves and swimming" below), on what it is crossing: shod hooves ringing on tarmac, a duller thud and a crunch of stones on gravel, muffled on moss and sand, softer still in snow, a slosh in a ford. Fore hooves land a little harder than hinds, and all harder at the gallop; landing a jump, two hard together. It snorts as you get on, now and then while it stands, and blows out once it pulls up after a long gallop.
- The horse is the wildlife's own animal, driven by the rider instead of its herd; other animals take a galloping horse as they would someone running.

### Animal models

| Animal | Model | Author | Licence |
| --- | --- | --- | --- |
| Horse | [Horse](https://sketchfab.com/3d-models/horse-a6f860e43e364619bccb174a1ac7d0c9), with its saddle and bridle (shown only when ridden); six of its 28 clips kept | [Henry S](https://sketchfab.com/henry_7) | CC BY 4.0 |
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
- **The character** on foot is a rigged man in a long dark coat ("Man In Coat - Human Rigged Model" by [Saitam](https://sketchfab.com/saitam_ha), [Sketchfab](https://sketchfab.com/3d-models/man-in-coat-human-rigged-model-cd71038373d5427099a7970f1a1af2df), CC BY 4.0), moving with motion-captured Mixamo clips: idle, walk, a walk backwards, run, jump and kneel, taken from "ETB Animated" by [Royaleyourdad](https://sketchfab.com/royaleyourdad) ([Sketchfab](https://sketchfab.com/3d-models/etb-animated-use-animation-dropdown-to-see-all-6795caee22124716bab954326306d3e3), CC BY 4.0), and a front crawl and treading water from "Warrior Swimming" ([Sketchfab](https://sketchfab.com/3d-models/warrior-swimming-408e5b157c0949f0a9d04442b8dfa059)) and "Treading Water (2)" ([Sketchfab](https://sketchfab.com/3d-models/treading-water-2-5a52bc60a2fd40218128a066367c6c33)) by [Appsbypaulhamilton](https://sketchfab.com/Appsbypaulhamilton) (CC BY 4.0). Both rigs are Mixamo's, so `tools/person/process.mjs` matches the bones by name and retargets the clips: each bone makes the same turn in the world away from its own rest pose as the clip's bone does from the clip's (the two rest poses differ by a few degrees a bone, which, copied straight across, bent his knees and tipped him back). It scales the hips to his height and holds them in place; the crawl swims forward through its clip, so its steady travel is taken out and the surge of each stroke kept (`public/models/person.glb`, 1.4 MB). Forward walks (about 5 km/h); held on for most of a second he speeds up to a run (about 15 km/h), and tapping it again quickly gets him there sooner; Shift keeps him walking, letting go he slows to a stop in a stride or two, back steps him backwards, and Space is a small standing hop. Each clip's own pace was measured off the planted foot (the walk 1.06 m/s, the run 3.0 m/s), the speeds sit close to them, and walk and run share one stride, as far along as the ground covered, so the feet neither slide nor fall out of step as one blends into the other; the camera drops back a little as he runs. He climbs anything too steep to walk up, boulders, cliffs, sea stacks and basalt columns, at 1.4 m/s, reaching hand over hand, pulls himself over the top, drops off ledges and lands with a crouch. The car is solid: he runs round it. He can roam 120 m from it. In water deeper than his chest he swims a front crawl, flat along the surface with his face in the water, turning to breathe and kicking, at about 3.4 km/h (the clip swims a slow 0.36 m/s, so its strokes are played up to half as fast again); stopped, he treads water upright with his head and shoulders out, sculling with his hands. A splash going in, and spray off his arms. The water is cold, so he can swim about 35 m from where he went in before he is told to head back.
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

Graphics: **Auto** (the default) picks Low on phones and Medium on computers and keeps the frame rate up by shedding detail as it needs to (see Performance); only if that is not enough does it drop one preset. It remembers the drop for the device, but not for ever: a busy spell (a browser full of tabs, a video in another window) can cause one as much as a slow machine, so the full preset is tried again a day later, then two, four and so on each time it has to drop again, and a visit that holds the full preset for five minutes forgets the drop. Picking Low, Medium or High fixes the preset. Terrain detail changes apply on the next load.

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
  perf.js            the governor: sheds and restores detail, sets the frame cap
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
    washbrush.js     car wash brushes made of foam strips that fold against the car
    surf.js          waves breaking and running up the beach, sneaker waves
    effects.js       road puddles, spray and dust particles
  aurora/
    forecast.js      Kp curve, clouds, city light, visibility rules, aurora type
    aurora.js        raymarched curtain shader on a sky dome
  vehicle/
    jeep.js          jeep model and driving physics
    walker.js        step-out character: moving, climbing, swimming and mixing his clips
    horseride.js     riding a horse: mounting, gaits and steering, the rider in the saddle
    heli.js          the helicopter: model, flight, landing, cockpit controls and displays, autopilot
    skydiver.js      the parachute jump: free fall, canopy, landing, the jumper's poses, pack and canopy
    models.js        the cars, loaded from their files, with stand-ins built in code
    interiors.js     dashboards, wheels and dials for the cockpit view, plus each car's hood and cockpit eye
    mirrors.js       live wing and rear-view mirrors for the cockpit view
    specs.js         handling, wading depth and nitro for each car
    fuel.js          each car's tank and how fast it burns
    input.js         keyboard, touch buttons, drag to look
  ui/
    cover.js         the start screen's hero shot: one vehicle at a time on wet ground
    auroraSky.js     the start screen's looping aurora sky, one shader on its own canvas
    hud.js           radio, compass, readouts, toasts, look-up meter
    notebook.js      sightings, stamps, today's challenge
    minimap.js       minimap, full map, the drive-or-jump card and fast travel
    nav.js           Drive there: guide chip, beacon and route progress
    learn.js         Learn panel entries and the How auroras work lesson
    style.css
  audio/
    audio.js         procedural wind, water, ice, tyres and engine, the music player, and the volume groups
    engines.js       each vehicle's engine voice: firing order, pipes, revs, gears, pops, and the cars' recorded loops
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
- **Jumps:** four sharp road crests on long straights (south coast, Kjölur, near Mývatn, the north). The car takes off where the road drops away faster than gravity (14 m/s²) can pull it down after it, checked a moment ahead along its path, so ordinary crests only make it light. In the air it has no steering or throttle, keeps the attitude it left with (the nose easing toward its flight path) and its wheels hang down. It lands on its springs: how hard is how fast it meets the ground across the ground's own slope, so a landing on a downslope is gentle; the body sinks up to 0.3 m over its wheels, rebounds once and settles, rocking on the axle that touched first, and it loses a little speed. Only past the bump stops does the whole car bounce. Hard landings thud and knock the camera. Jump points live in `JUMPS` in `src/world/geo.js` and snap to the nearest road.
- **Bridges** on five real Ring Road river crossings (Þjórsá, Markarfljót, Gígjukvísl, Jökulsá á Fjöllum, Hvítá): a carved valley with a flowing river, a level concrete deck on piers, and solid steel railings. `BRIDGES` in `src/world/geo.js`.
- **Steering** eases in, is gentler at speed, and the chase camera follows a smoothed heading.
- **Roads** are smoothed over long distances with a gradient limit (7% on tarmac, 12% on gravel). Marker posts and fence posts are checked against every road, junction and bridge.

## Kerið and Hallgrímskirkja

- **Kerið** is one shared shape (`KERID`, `keridProfile` in `src/world/geo.js`) used by both the land the car drives on and the detailed surface you see: an oval crater on a low mossy hill, red scoria walls with moss and scree streaks, a dark lava ledge band, a scree apron with boulders, a teal lake, and the red rim path.
- **Hallgrímskirkja** has fluted organ-pipe wings stepping down in a concave curve and bending back along the nave, a ribbed tower with slit windows and three clock faces, a belfry with pointed openings, a stepped crenellated top with a gold cross, the stained-glass lancet over the door with its red emblem, low railings and patterned paving. At night it is uplit, brightest at the base. Its pad sits a little above the Ring Road (`cap` on a pad in `flattenPads`), so the road is not left running along a cliff under it.

## Walk-in buildings: Harpa and Hallgrímskirkja

Cars never get into either (each has a car-only footprint box: `carOnly` in `obstacles.js`), but you can walk in through the front door (`src/world/halls.js`). **Harpa**: the glass front has a doorway with its doors open; inside, the foyer's dark polished floor, the glass cells seen from within (you look out through them), the dark mirrored ceiling with small warm lights, a café counter, benches, and a broad flight of stairs up to a raised upper foyer with a glass balustrade. Through a doorway from the foyer is Eldborg, the main hall: deep red walls, a stage with a grand piano under an acoustic canopy, two blocks of red seats with an aisle, and balcony tiers. **Hallgrímskirkja**: the tower's door opens into a vestibule and on into the nave: white concrete, slender pillars and pointed arches, pews either side of an aisle, the altar with candles under three tall windows, and the organ's silver pipes on a gallery over the way in. Hidden walls keep you to the rooms; the stairs and stage are steps you climb. Inside, the walking camera comes in closer and stays within the room (`rooms`, `roomAt` in `landmarks.js`). Every other landmark building (huts, houses, halls) is now solid to cars and on foot too; it had been drawn but never registered.

## Water

Cars ford shallow water with their wheels under and the body above the surface, at reduced speed. The supercar wades up to 0.55 m, the roadster 0.95 m and the camper 1 m; the Trail 4x4 could wade 2.8 m but floats from 1.4 m.

### Boat mode

Drive into water deeper than that and the car turns into a boat (`src/vehicle/boat.js`). Over about a second and a half a planing hull drops out from under the body, the wheels rise and fold flat onto its deck (the fender flares tuck away), and an outboard motor, tilted up while the hull unfolds, trims down into the water with the navigation lights coming on: red and green on the foredeck, white on a short stern mast. The hull is a deep V with a chine flat and a spray rail each side, its sheer rising gently along the boat and sweeping up into a raked bow that runs well ahead of the car's nose. It is painted in bands that keep to the sheer: antifouling below the water, a mint boot stripe at the waterline, navy topsides, a mint pinstripe, a white sheer band and a charcoal rubbing strake. The car sits on a teak cockpit floor inside white-lined sides, ahead of it a white crowned foredeck carries a stainless bow rail. The outboard has a glossy black cowling with a mint stripe, a leg reaching below the hull, an anti-ventilation plate, a skeg and a three-blade propeller that spins with the throttle and speed; it swings with the steering. One kit fits every car; it is sized from each body's length and width.

- **Handling.** It floats on the hull's waterline, bobs on the swell, lifts its bow and leans out of turns at speed, and slides through turns as a boat does. Top speed is about 55 km/h in the 4x4, 40 in the roadster and camper and 67 in the supercar, and nitro works on the water too (the 4x4 reaches nearly 80), digging the propeller in and lifting the bow further. It steers with the outboard, so it turns even when slow. Climbing onto the plane the bow rises most around 25 km/h (the hump), then settles a little. The wind only nudges a boat (a fifth of its push on a car), or with so little grip it would drift sideways like a leaf.
- **Getting to the water.** Off-road you can roam 70 m from a road, but you can always head toward the sea or a lake, and anywhere within 200 m of the shore is open (`shoreDistAt` in terrain.js gives the distance to the nearest sea or lake shore). Only moving away from both the road and the water is stopped, so nearly every shore can be reached: driving like a player from the nearest road, 119 of 123 shore points spread round the island reached the water (the rest are behind farm walls or under a bridge), where only 17% of the coastline used to lie within reach.
- **Range.** It can go 400 m out from the shore, past the edge of the land map where that is close (south of Vík, off the far west). Past that it slides along the limit and is told to turn back toward the shore.
- **Back ashore.** In water shallower than 60% of the floating depth the wheels come down, the hull folds away and it drives up the beach. A car that comes ashore far from a road can always drive back toward it.
- **On the water** (`BoatWater` in boat.js): a foam collar hugs the hull, piling up at the bow; the wake is a churned trail straight behind plus two bow-wave arms running out at the Kelvin angle (19.5 degrees), all in streaked, lacy foam that spreads and settles over about nine seconds; the propeller throws a rooster tail of droplets and a drift of mist, heavier on nitro; and sheets of spray come off the bow at speed, more on the outside of a turn. Spray fades and grows as it flies, is fogged, and dims at night with the foam. You cannot step out on the water.
- **Sound.** Afloat, the car's engine gives way to the outboard, heard from on board: three loops cut from Freesound recordings made on outboard boats, fetched the first time you float (`public/sounds/engines/boat_*.wav`, made as the car loops were, below). Exhaust bubbling at idle, a low throb pushing through the water, and the run up on the plane; each is sped up with the throttle and speed, and they hand over between 22 and 47 km/h as the hull climbs onto the plane, the way a real boat's note changes. Over them, the bow washing through the water (a hiss that brightens with speed and a low churn) and the hull slapping the chop: a knock now and then at rest, a quick run of them at speed, and on the plane the odd hard slam with spray. The wading sound fades out.

| Loop | Recording | By | Licence |
| --- | --- | --- | --- |
| Idle | [speed boat outboard motors low gear bubbling gurgling bassy2](https://freesound.org/s/454201/) | kyles | CC0 |
| Low speed | [speed boat outboard motor medium engine throb2 muffled](https://freesound.org/s/454197/) | kyles | CC0 |
| On the plane | [outboard motor boat onboard high speed](https://freesound.org/s/637744/) | kyles | CC0 |
- **Heimaey and Hásteinsvöllur.** Vestmannaeyjar's one lived-on island lies off the south coast (`ISLES` in `geo.js`): the town by the harbour, Heimaklettur's cliffs, the cones of Eldfell and Helgafell, the ridge of Dalfjall and Stórhöfði at the southern tip, with its own coast in the same signed-distance coastline as the mainland and its own hills in place of the real elevation (it is drawn larger than life and a little further south than its 63.43 N, because the stadium is built at full size, and so there is open water to the mainland). Drive into the sea and float across, fly, or fast travel to its road. Its football ground, Hásteinsvöllur, is a full-size 105 by 68 m grass pitch, mown in stripes and marked out, with goals and nets and corner flags; the concrete south stand has the changing rooms and the players' tunnel underneath and its clubhouse windows at the back, the larger north stand is built into a grassy bank, and the rock Hásteinn stands behind the west goal under the ridge. The pitch is level ground (a flat on the island, then a pad) and solid turf to drive or walk on; the stands, dugouts and goals are walls (a car stops at the back of the net). The whole island is open to drive, with no road limit, and farms stay on the mainland.
- **Sea arches.** Boats pass through the arches at Dyrhólaey, Arnarstapi and Hvítserkur. The solid ground grid (solids.js) keeps a ceiling for each cell: where a landform starts above the water with open water under it, anything lower than that passes beneath. Faces below the water tell solid rock (a buried bottom) from an opening, upright faces are traced along their own line at their own height rather than across their bounding box, and a car's wheels ignore rock more than about a metre above it (the centre and bumper checks still stop it at walls). The arches reach down to the seabed, and Hvítserkur stands a little further out in clear water. Both of its doorways take any of the cars afloat: the narrow one beside the trunk is 4.4 m wide and 5.6 m high, the big one under the body 8.8 m wide and 5.8 m high. Cells at the edge of an overhang (the face of an arch above its opening), which get a top only from the allowance at a face's edge and nothing about what is beneath, take the roof of an open neighbour; they had been solid to the water, a wall across the doorway. Small landforms (under 120 m across) are traced at half-metre cells rather than metre ones, so a doorway a few metres wide keeps its width. A car set down under an arch (fast travel, recovery) stands on the water, not against the roof. Rock standing in the sea reaches down to the seabed, never stopping above the water: the stacks at Dyrhólaey and Reynisdrangar keep their tops and carry their taper on down, the boulders by the Arnarstapi arch stand on the bottom (`kit.bed` gives a landmark the local height of the ground, or the seabed under water), and the cliff behind Kirkjufellsfoss reaches the lowest ground under it where the bank falls to the sea.
- **Where.** Off any shore near a road: the south coast at Vík, round Snæfellsnes, below Siglufjörður, and on Þingvallavatn. The highland fords are at most 0.4 m deep, so they are still waded.

## Grounding

Nothing should float. Before any built landmark (buildings, churches, pools, waterfalls, geysers, caves, bridges) is placed, the land under it is levelled into a pad that fades out at the edge and stays clear of roads. Houses sit on their highest corner with a foundation down to the lowest. A parked car holds still: below walking pace with no throttle, wind and slopes no longer creep it along.

Nothing can be driven into, either. A mound or crater rim built as a landform is solid down to the land, so it is ground under a wheel however steep (up to what the bumper check lets the car climb); only a landform with open space beneath it (an arch) is treated as a roof. Kerið's detailed surface lies on the land outside its rim and faces up, so nothing drives beneath it. Landmark landforms (Kirkjufell, sea stacks, cliffs, lava pillars and hummocks, crater rims, ice) are traced into a height map when the world is built (`src/world/solids.js`), and the ground under wheels and boots is the land or the landform on top, whichever is higher. On a road it is the road itself, which is drawn 13 cm above the land (8 cm at the shoulders, 17 cm on junction patches), so tyres and shoes sit on the tarmac rather than in it. Slopes up to about 50 degrees are driven or walked up like any hill; anything steeper is a wall to the car and a climb on foot. Boulders and landmark rock (cliff blocks, basalt columns, the glacier tongue) carry their height in the obstacle set too, so on foot they are ground to climb rather than walls; hidden walls and hit boxes stay walls. A sample under the middle of the car keeps small lumps between the wheels from poking through the floor. Buildings, caves, pools, bridges and the plane wreck keep their walls instead, and no landform sits on a road.

## Performance

- Landmarks, farms and the car are built from many small parts. Once their collisions are read, static parts that share a material are merged into one mesh (`src/world/bake.js`), which took the scene from about 5,500 meshes to about 1,600 and cut draw calls roughly in half. Moving parts (wheels, mud bubbles, the geyser) and see-through or locally shaded materials are left as they are.
- **Keeping it smooth, cool and easy on the battery** (`src/perf.js`). A governor watches how long frames take. When they run long (the slowest quarter of frames over 20% past the target for two 1.5 s spells in a row, or one spell twice the target; a single slow spell is often one-off work, such as new scenery coming into view) it sheds work one step at a time: first how often the water's night reflection, the mirrors and the shadows are redrawn, keeping every pixel; then fewer pixels (85%, 75%, then 65% of the preset, never below 0.55 of a CSS pixel), and last the night reflection altogether. A new resolution is put in just before a frame is drawn, so nothing has to cover the canvas (it used to lay a still of the last frame over the moving game while it faded, which looked like lag and blur), but remaking the buffers is still a hitch, so a sharper picture only comes back while you are going slowly or stopped. (It never changes the aurora's detail: that rebuilds its shader, a stall in the middle of play.) It starts measuring 6 s after Start. After 12 s with room to spare it brings a step back; if a step it brings back has to go again soon after, it waits twice as long next time, so it settles instead of see-sawing. Only when every step is shed and frames are still slow, and you are stopped or slow, does it drop the quality preset (Graphics: Auto, the default). The frame cap: phones run at 30 fps; a computer runs at the screen's rate but drops to 30 while nothing moves for 20 s (parked, watching the sky), while the window is in the background, in photo mode, and when the battery is low and not charging (which also keeps the first step shed); menus and the title run at 20. Snow tracks are not drawn at all once the last one has faded (on a phone they cost about 2 ms a frame even when empty). `chasingGreen.governor` shows the level and the measured fps.
- Bloom only runs from dusk on, when lights and the aurora need it, and Medium uses 2x instead of 4x multisampling.
- **Terrain tiles.** The island is one height grid but is drawn as tiles that share its vertex buffers, so the camera and the sun's shadow camera skip the tiles they cannot see instead of drawing the whole island (over three million triangles on the realistic look) in every pass.
- **Bridges** are merged like landmarks (each was some 75 parts).
- **Distant land is simpler.** Each terrain tile has three index buffers over the same vertices (every grid point, every second, every fourth), and far tiles draw the coarser ones (`updateTerrainLod` in terrain.js; full detail within 240 m on Low, 360 m on Medium, 500 m on High, every fourth point beyond 800, 1,100 or 1,500 m). The outer ring of a coarse tile still meets its edge at every grid point, a fan from each border cell's centre, so tiles of different detail always share their edges and no cracks open. On a phone this took the land from about 680,000 triangles a frame to about 60,000, with no visible difference from the road.
- **Roads in pieces.** Each road is drawn as pieces about 250 m long that share one set of vertices, so the camera skips the stretches it cannot see (the Ring Road alone is over 100,000 triangles); on Low, pieces beyond 1.3 km are not drawn. The whole road is kept for refitting it to the ground.
- **Far landmarks.** Small landmarks are not drawn beyond a distance that grows with their size (450 m or twelve times their radius on Low, 1.8 times that on Medium, 2.6 on High); mountains and glaciers stay in view.
- **Fewer matrices.** Anything hidden (the parked helicopter, the walker while you drive, far landmarks) skips having its matrices worked out each frame, things that never move (land tiles, roads) never do, and the extra renders for the night reflection and the mirrors reuse the frame's matrices instead of working out the whole scene's again. Each frame asks the page whether a menu is open once, and whether the driving display shows only when its size changes (asking that every frame made the browser lay the page out again).
- **No shader stalls.** The game no longer checks each new shader for errors outside development: the check makes the browser wait for the compile to finish.
- Measured in Chromium emulating a phone with its processor slowed four times: about 1.2 million triangles and 450 draw calls a frame before, about 800,000 and 300 after (the car alone is some 150,000), and the frame rate holding its cap of 30 where it had fallen below it.
- **No freezes from shaders.** Every shader is compiled while the world loads, including things hidden at that moment (night lights, the aurora, the route beacon) and the bloom passes used from dusk. The sun keeps casting shadows when it is too weak to matter and its shadow map simply stops updating: switching shadows off and on used to change every material's shader, so the whole scene recompiled at every dusk and dawn. Shaders are built for where they really draw: with the finishing passes on, the scene is drawn into a picture those passes work on, which needs a different build of every shader from drawing straight to the screen, and the sky's light map (for reflections) has to exist first; the load used to build the screen versions before that map existed, so most objects stalled the game the first time they came into view, which was just as you set off. Each shader's first-use setup is done during the load too, the driver is seated and the engine sound built before Start, and animals, which download as you near a herd, build their shaders in the background and appear once they are ready. Two other one-off stalls wait until you have stopped and left the controls for a moment: releasing the title screen's drawing context, and readying the garage's car.
- **Ice** is drawn without a refraction pass, which re-rendered the whole scene every frame the ice was on screen.
- **Nothing drawn under a menu.** The menus cover the game with a dark blur and the game is paused under them, so the island (and the clouds' panorama, the mirrors and the night reflection) is drawn once or twice as a menu opens and then held, redrawn only when something changes the picture (Graphics, Month, a resize). It used to be redrawn 20 times a second under a full-screen blur; on a graphics card already busy with other tabs, the two together could stall the page for minutes.
- **No hidden vehicle pictures.** Opening the Garage used to make a second drawing context and render a picture of every vehicle for a card list that is never shown (the turntable replaced it), a stall of about 1.6 s on an M1 Pro each time. Those pictures are gone.

On the realistic look, in addition (measured on an M1 Pro at 1600 x 1000, about 33 ms a frame before and 20 ms after):

- **Clouds** (the realistic look) are marched through a deck between 420 and 800 m, as seen from below; from inside the deck or above it (the helicopter, a parachute) that march came out as dark seams across the sky, so up there the flat cloud layer takes over, handing over as you climb from 370 to 420 m. The GLSL `smoothstep` calls in the sky shaders are also replaced by `sstep`, defined for edges given high to low (GLSL leaves that undefined).
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

### Engine sounds

Every vehicle has its own engine (`audio/engines.js`, chosen by `engine.voice` in `specs.js`), heard as its exhaust: a train of firing pulses, one per cylinder per engine cycle, at the crank angles its firing order sets. Each pulse rings the pipe it leaves through (a few decaying partials) over a low thump and a crack of noise; cylinders on different banks leave through different pipes, so an uneven firing order burbles or putters and an even one hums or screams. A loop of a few cycles is built once per engine and played faster or slower for the revs, through a boost at the engine's body and a filter that opens with revs and throttle.

The cafe racer's twin is built this way. **The four cars play real engine recordings** (`rec` in `engines.js`, `recMix` in `audio.js`): loops cut from Freesound recordings, each held at one rpm, in `public/sounds/engines` (22 kHz mono WAV, 1 to 2.4 s, 40 to 110 KB; each car's set is fetched the first time it is driven, and its built voice plays until then). For any revs the two loops either side play together, crossfaded over the middle of the gap (equal power, on a log scale), each sped up or slowed to the revs over its own recorded rpm, so the pair always agree on pitch and each stays near the speed it was recorded at. The gears, clutch dip, throttle filter, pops and tyres are as below.

| Car | Loops (rpm) | Recording | By | Licence |
| --- | --- | --- | --- | --- |
| Trail 4x4 | 1,090, 1,375, 1,450 | [Jeep-CJ5-1965-final](https://freesound.org/s/234902/) (an old four-cylinder Jeep warming up and driving away) | a deleted Freesound user | CC0 |
| Supercar | 820, 1,930, 2,780, 3,260, 4,070 | [Audi R8 Idling Reving Backfire](https://freesound.org/s/457733/) (V10) | Jonas_Jocys | CC BY 4.0 |
| Camper van | 700 | [Volkswagen Beetle 1961](https://freesound.org/s/544344/) (air-cooled flat four) | klankbeeld | CC BY-SA 3.0 (the loop cut from it is shared under the same licence) |
| | 2,590, 2,750 | [Volkswagen Type 2_revving up2](https://freesound.org/s/332695/) | nhaudio | CC BY 4.0 |
| Vintage car | 645, 725, 1,010, 1,210 | [Veteran car](https://freesound.org/s/77096/) (idling, climbing a steep hill and driving on) | juskiddink | CC BY 4.0 |

**How the loops were made** (in the browser, from Freesound's high-quality previews): each recording's harmonic comb was measured on its steady stretches (the spacing of its exhaust harmonics, from the autocorrelation of a whitened 16,384-point spectrum); the engine's speed is that spacing times 60, or times 30 where the comb is the four-cylinder firing rate (the Jeep and the veteran car), or times 120 where it is the half-order (the R8, whose V10 firing line at five times the crank speed confirms it). Rising stretches were tracked frame by frame and resampled at a varying rate so each loop holds one pitch, cut where its end best matches its start, joined with a 0.1 to 0.2 s equal-power crossfade, high-passed at 28 Hz (circularly, so the seam stays clean) and levelled to -16 dBFS. Loops from different recordings of one car are matched by these rpm figures, not by ear.

The built voices, still used for the bike and as each car's stand-in while its loops load:

| Vehicle | Engine | Character |
| --- | --- | --- |
| Trail 4x4 | Cross-plane V8 (banks L R R L R L L R) | Deep, lumpy off-beat burble; the odd burble on lifting off |
| Vintage car | Straight six, even firing | Soft, smooth hum through a quiet pipe; very rarely a backfire |
| Camper van | Air-cooled flat four, as in the old VW bus (banks L R R L) | Raspy, clattering putter |
| Cafe racer | 270-degree parallel twin | Loping Scrambler beat; pops on almost every lift |
| Supercar | Flat-plane V8 (banks alternating) | Hard, rising scream; crackles on the overrun |

Each has its revs (idle and redline) and gearing: it changes up near the redline and down once the revs fall well off, with a short dip in the sound at each change, as the clutch goes in. **Changing down** off the throttle, the lower gear bites: a quick blip of the revs, a short lurch of engine braking and a dip of the nose; off the throttle the engine holds the car back harder in the low gears. **The gearbox is in the driving too** (`jeep.js`), with the same gears, so the car and its sound change together: changing up under power the pull eases to about a third for a moment (0.11 s in the supercar, 0.13 on the bike, 0.26 in the 4x4, 0.3 in the camper, 0.36 in the vintage car) and the nose dips slightly as the weight comes forward; then the clutch bites, a light shove in the back for a third of a second as the tail settles, a little more in the low gears. Both are kept small (about a degree of pitch in first gear) so a change reads as a nudge, not a rock.

**No audible loop at high revs.** Every engine loop plays on two players at once, the second half a loop behind and 0.7% faster, so they drift against each other. Played fast, a short loop comes round several times a second and its ends can be heard; once a loop repeats faster than every 1.6 s its twin is blended in (equal power by 0.8 s), so the seams never line up and the pattern never quite repeats. The built voices are also longer (at least 32 cycles; the bike's 40), so even at the redline they take most of a second to come round. On a throttle lift above about two-fifths of the redline the exhaust may pop, how readily, how many and how hard set per engine (`pops`); each pop is a blast of noise in the pipe's band, a low punch falling in pitch and a crack on top. The helicopter has its own rotor and turbine sounds instead. Under them all, the tyres: a low roar that grows with speed, deeper and rougher off the tarmac with a gritty crunch on gravel, silent in the air and on the water.

### Hooves and swimming

Riding and swimming play recordings from Freesound (`loadBody` and on in `audio.js`), fetched the first time you get on a horse or into the water. The one-shots are sprites: several takes in fixed slots of one 22 kHz mono WAV, one picked each time (never the same twice running) and played a few percent faster or slower. The takes were picked by machine from each recording (the cleanest onsets, each rising well over the noise and clear of the next hit), cut from just before the onset, faded out and levelled to the same peak (strokes and snorts by loudness).

- **Hooves** (`hoof_hard.wav`, six takes of 0.25 s; `hoof_soft.wav`, six of 0.25 s): a shod horse clip-clopping down a road for tarmac, a horse trotting on soft ground for everything else, filtered and mixed per surface (see "Riding a horse"). A hoof on a road is a "clop", not a slap: a low thump of the horse's weight and a hollow ring near 800 to 900 Hz that dies away over 40 to 90 ms. The first tarmac takes, from steps on concrete, had neither (gone in 20 ms) and sounded like hand claps, so the tarmac takes were chosen by measuring that ring and decay across several road recordings, and each is cut to start just before its main strike (some begin with a faint scuff that smeared at the gallop).
- **Snorts** (`snort.wav`, four takes of 1 s).
- **Swimming** (`stroke.wav`, six takes of 0.8 s): a splash as each hand goes into the water, seen from his hands crossing the surface (`swimStrokes` in `main.js`, with a little spray where it goes in), louder and brighter the faster he swims. Under it `water.wav`, 5.6 s of a swimmer in open water looped with an equal-power crossfade: louder, brighter and quicker with his pace, quiet while he treads water, and faint as you wade a hot pool.

| Sound | Recording | By | Licence |
| --- | --- | --- | --- |
| Hooves on tarmac | [Horse Clip Clopping Downhill (stereo)](https://freesound.org/s/182504/) | swiftoid | CC0 |
| Hooves off the road | [SFX - Horse - Trot.wav](https://freesound.org/s/581834/) | MrFizzywig | CC0 |
| Snorts | [G38-16-Four Horse Snorts.wav](https://freesound.org/s/437111/) | craigsmith | CC0 |
| Strokes | [G54-26-Person Swimming.wav](https://freesound.org/s/438845/) | craigsmith | CC0 |
| Water round a swimmer | [Swimming in open water, sedate breaststroke](https://freesound.org/s/337682/) | YleArkisto | CC BY 4.0 |

The Sound tab in the menu has a slider for each group: All sound, Music (the stereo), Car (engine, nitro, wading, splashes and knocks, and the hooves and swimming) and Ambience (wind, water and ice). Levels are saved; Music at zero also stops streaming. The quick Sound button and U still mute everything. The northern lights make no sound: the old high hum and crackle were removed because they sounded wrong.

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
