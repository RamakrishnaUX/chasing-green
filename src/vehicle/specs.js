// Handling for each vehicle. Speeds are world units per second (the speedometer shows them x 3.6).
// offroad: top speed multiplier per surface. wade: deepest water it can drive through.

export const VEHICLES = {
  jeep: {
    name: 'Trail 4x4',
    tagline: 'Goes anywhere and wades the deepest rivers.',
    blurb: 'Four-door off-roader. Balanced on gravel, mud and fords, and wades the deepest.',
    susp: { k: 7, roll: 1 },
    maxSpeed: 42, accel: 14, brake: 26, reverseMax: 9, steerRate: 1.75, grip: 8, handbrakeGrip: 1.6,
    offroad: { paved: 1, gravel: 0.96, moss: 0.88, sand: 0.82, snow: 0.8, ford: 0.75 },
    wade: 2.8, waterDrag: 0.5,
    nitro: { speed: 1.45, accel: 2.0 },
    radius: 1.05, halfLength: 1.35,
    engine: { base: 34, perSpeed: 1.7, type: 'sawtooth', rumble: 0.9 },
  },
  vintage: {
    name: 'Vintage roadster',
    tagline: 'Slow, soft and full of charm.',
    blurb: '1930s two-seater in maroon and cream. Slow, soft and floaty. Take your time.',
    susp: { k: 3.2, roll: 2.4 },
    maxSpeed: 30, accel: 8, brake: 18, reverseMax: 7, steerRate: 1.6, grip: 7, handbrakeGrip: 1.4,
    offroad: { paved: 1, gravel: 0.82, moss: 0.62, sand: 0.55, snow: 0.48, ford: 0.5 },
    wade: 0.95, waterDrag: 0.9,
    nitro: { speed: 1.4, accel: 1.8 },
    radius: 0.95, halfLength: 1.45,
    engine: { base: 26, perSpeed: 1.3, type: 'square', rumble: 1.2 },
  },
  camper: {
    name: 'Camper van',
    tagline: 'A big two-tone bus with an AURORA piece.',
    blurb: 'A classic split-window camper, white over mint, with a bold AURORA graffiti piece down both sides. The biggest ride on the island. Take it slow and sleep anywhere.',
    susp: { k: 4.5, roll: 1.8 },
    maxSpeed: 30, accel: 9, brake: 20, reverseMax: 8, steerRate: 1.5, grip: 7.5, handbrakeGrip: 1.5,
    offroad: { paved: 1, gravel: 0.86, moss: 0.7, sand: 0.6, snow: 0.55, ford: 0.55 },
    wade: 1.0, waterDrag: 1.0,
    nitro: { speed: 1.4, accel: 1.8 },
    radius: 1.5, halfLength: 2.8,
    engine: { base: 30, perSpeed: 1.4, type: 'square', rumble: 1.1 },
  },
  race: {
    name: 'Supercar',
    tagline: 'Fastest on tarmac. Hates gravel.',
    blurb: 'Low, fast and stiff. Brilliant on tarmac, hates gravel and water.',
    susp: { k: 13, roll: 0.4 },
    maxSpeed: 66, accel: 24, brake: 38, reverseMax: 9, steerRate: 1.9, grip: 11, handbrakeGrip: 2.0,
    offroad: { paved: 1, gravel: 0.6, moss: 0.42, sand: 0.36, snow: 0.32, ford: 0.3 },
    wade: 0.55, waterDrag: 1.4,
    nitro: { speed: 1.5, accel: 2.2 },
    radius: 1.0, halfLength: 1.5,
    engine: { base: 60, perSpeed: 2.6, type: 'sawtooth', rumble: 0.5 },
  },
};
export const VEHICLE_ORDER = ['jeep', 'vintage', 'camper', 'race'];

// Rolling resistance per surface, before each vehicle's off-road ability is applied.
export const SURFACE_DRAG = { paved: 0.03, gravel: 0.08, moss: 0.14, sand: 0.2, snow: 0.18, ford: 0.35 };
