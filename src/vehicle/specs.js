// Handling for each vehicle. Speeds are world units per second (the speedometer shows them x 3.6).
// offroad: top speed multiplier per surface. wade: deepest water it can drive through; any deeper
// and it floats as a boat (boat: its speed on the water).

export const VEHICLES = {
  jeep: {
    name: 'Trail 4x4',
    tagline: 'Goes anywhere and wades the deepest rivers.',
    blurb: 'A 1940s open-topped field car in olive drab, with a fold-down windscreen and a spare on the back. Balanced on gravel, mud and fords, and wades the deepest.',
    susp: { k: 7, roll: 1 },
    maxSpeed: 42, accel: 14, brake: 26, reverseMax: 9, steerRate: 1.75, grip: 8, handbrakeGrip: 1.6,
    offroad: { paved: 1, gravel: 0.96, moss: 0.88, sand: 0.82, snow: 0.8, ford: 0.75 },
    wade: 2.8, waterDrag: 0.5,
    boat: { maxSpeed: 17, accel: 7 },
    nitro: { speed: 1.45, accel: 2.0 },
    radius: 1.19, halfLength: 1.13,
    engine: { voice: 'v8' }, // a big cross-plane V8 (audio/engines.js)
  },
  vintage: {
    name: 'Vintage car',
    tagline: 'Slow, soft and full of charm.',
    blurb: 'A 1930s coupe in deep maroon and black, with wire wheels, spares on the wings and a wooden dash. Slow, soft and floaty. Take your time.',
    susp: { k: 3.2, roll: 2.4 },
    maxSpeed: 30, accel: 8, brake: 18, reverseMax: 7, steerRate: 1.6, grip: 7, handbrakeGrip: 1.4,
    offroad: { paved: 1, gravel: 0.82, moss: 0.62, sand: 0.55, snow: 0.48, ford: 0.5 },
    wade: 0.95, waterDrag: 0.9,
    boat: { maxSpeed: 13, accel: 5 },
    nitro: { speed: 1.4, accel: 1.8 },
    radius: 1.0, halfLength: 2.1,
    engine: { voice: 'six' }, // an old straight six
  },
  camper: {
    name: 'Camper van',
    tagline: 'A classic split-window bus.',
    blurb: 'A 1960s split-window bus in sky blue and white, seats for nine and a high, wide view. Take it slow and sleep anywhere.',
    susp: { k: 4.5, roll: 1.8 },
    maxSpeed: 30, accel: 9, brake: 20, reverseMax: 8, steerRate: 1.5, grip: 7.5, handbrakeGrip: 1.5,
    offroad: { paved: 1, gravel: 0.86, moss: 0.7, sand: 0.6, snow: 0.55, ford: 0.55 },
    wade: 1.0, waterDrag: 1.0,
    boat: { maxSpeed: 13, accel: 5 },
    nitro: { speed: 1.4, accel: 1.8 },
    radius: 1.36, halfLength: 2.3,
    engine: { voice: 'flat4' }, // an air-cooled flat four, as in the old VW bus
  },
  // Two wheels: it leans into its turns, its bars turn with the steering, and it cannot float
  // (it stops at water deeper than it can ford).
  bike: {
    name: 'Cafe racer',
    tagline: 'Light, quick, and leans into every bend.',
    blurb: 'A yellow-tanked cafe racer with a brown bench seat, flat bars and fat tyres, ridden in an open leather helmet and goggles. Quick and nimble on tarmac, fair on gravel, and it cannot swim.',
    bike: true,
    susp: { k: 9, roll: 1 },
    maxSpeed: 52, accel: 21, brake: 30, reverseMax: 3, steerRate: 2.2, grip: 9, handbrakeGrip: 2.2,
    offroad: { paved: 1, gravel: 0.74, moss: 0.52, sand: 0.42, snow: 0.38, ford: 0.4 },
    wade: 0.45, waterDrag: 1.3,
    nitro: { speed: 1.4, accel: 2.0 },
    radius: 0.62, halfLength: 1.2,
    engine: { voice: 'twin' }, // a 270-degree parallel twin, as in a Triumph Scrambler
  },
  race: {
    name: 'Supercar',
    tagline: 'Fastest on tarmac. Hates gravel.',
    blurb: 'Low, fast and stiff. Brilliant on tarmac, hates gravel and water.',
    susp: { k: 13, roll: 0.4 },
    maxSpeed: 66, accel: 24, brake: 38, reverseMax: 9, steerRate: 1.9, grip: 11, handbrakeGrip: 2.0,
    offroad: { paved: 1, gravel: 0.6, moss: 0.42, sand: 0.36, snow: 0.32, ford: 0.3 },
    wade: 0.55, waterDrag: 1.4,
    boat: { maxSpeed: 21, accel: 9 },
    nitro: { speed: 1.5, accel: 2.2 },
    radius: 1.05, halfLength: 1.75,
    engine: { voice: 'race' }, // a flat-plane V8
  },
};
export const VEHICLE_ORDER = ['jeep', 'vintage', 'camper', 'race', 'bike'];

// Rolling resistance per surface, before each vehicle's off-road ability is applied.
export const SURFACE_DRAG = { paved: 0.03, gravel: 0.08, moss: 0.14, sand: 0.2, snow: 0.18, ford: 0.35 };
