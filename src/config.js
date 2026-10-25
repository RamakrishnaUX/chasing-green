// Every number worth tuning lives here. Change a value, save, and Vite reloads the game.

export const CONFIG = {
  // ---------- Analytics ----------
  // Google Analytics 4 measurement ID (G-XXXXXXXXXX). Empty sends nothing. See src/analytics.js.
  analytics: { id: 'G-GZTW8WMR34' },

  // ---------- Time ----------
  time: {
    // Real seconds per in-game hour. 60 means a full day takes 24 real minutes.
    secondsPerGameHour: 60,
    // Game clock (hours, 0 to 24) when a new trip begins.
    startHour: 16.25,
    seasons: {
      // Winter: sun up roughly 10:00 to 17:00 and low all day (golden light). About 15 hours of usable dark.
      Winter: { sunrise: 10.0, sunset: 17.0, maxSunElevation: 12 },
      // Summer: the sun dips but never sets, so the sky never gets dark enough for aurora.
      Summer: { sunrise: 3.0, sunset: 24.0, maxSunElevation: 48, midnightSun: true },
    },
    defaultSeason: 'Winter',
  },

  // ---------- Months ----------
  // Approximate Reykjavík values for the middle of each month: sunrise and sunset (local clock),
  // how high the sun gets at noon (degrees), and how likely aurora is (scales the forecast).
  months: [
    { name: 'January', sunrise: 11.0, sunset: 16.3, maxSunElevation: 4.5, aurora: 1.0, chance: 'High', tip: 'Best chance: from 8pm to 2am. Nights are long and cold, so dress warmly.' },
    { name: 'February', sunrise: 9.6, sunset: 17.7, maxSunElevation: 11, aurora: 1.05, chance: 'High', tip: 'Best chance: after 9pm. The days are getting longer, but nights are still dark.' },
    { name: 'March', sunrise: 7.9, sunset: 19.3, maxSunElevation: 21, aurora: 1.15, chance: 'High', tip: 'Best chance: after 10pm. The equinox months are often the most active.' },
    { name: 'April', sunrise: 6.1, sunset: 20.9, maxSunElevation: 33, aurora: 0.7, chance: 'Medium', tip: 'Best chance: after 11pm. Nights are getting short, so be patient.' },
    { name: 'May', sunrise: 4.4, sunset: 22.5, maxSunElevation: 43, aurora: 0.15, chance: 'Low', tip: 'The sky barely gets dark. Aurora is very unlikely this month.' },
    { name: 'June', sunrise: 3.0, sunset: 24.0, maxSunElevation: 49.5, aurora: 0, chance: 'None', tip: 'Midnight sun. No aurora this month, but lovely long drives.', midnightSun: true },
    { name: 'July', sunrise: 3.8, sunset: 23.3, maxSunElevation: 46.5, aurora: 0, chance: 'None', tip: 'Midnight sun. No aurora this month, but the highland roads are open.', midnightSun: true },
    { name: 'August', sunrise: 5.4, sunset: 21.6, maxSunElevation: 38, aurora: 0.35, chance: 'Low', tip: 'Darkness returns late in the month. A faint chance after midnight.' },
    { name: 'September', sunrise: 7.0, sunset: 19.8, maxSunElevation: 27, aurora: 1.15, chance: 'High', tip: 'Best chance: after 10pm. Aurora season is back, and it is not too cold yet.' },
    { name: 'October', sunrise: 8.5, sunset: 18.1, maxSunElevation: 16, aurora: 1.05, chance: 'High', tip: 'Best chance: after 9pm. Autumn colours by day, aurora by night.' },
    { name: 'November', sunrise: 10.0, sunset: 16.5, maxSunElevation: 7, aurora: 1.0, chance: 'High', tip: 'Best chance: from 7pm. Long nights give you plenty of time.' },
    { name: 'December', sunrise: 11.3, sunset: 15.5, maxSunElevation: 2.7, aurora: 1.0, chance: 'High', tip: 'Best chance: any time after 6pm. Only about four hours of daylight.' },
  ],

  // ---------- Aurora forecast (Kp-like scale, 0 to 9) ----------
  forecast: {
    baseMin: 1.2, // quiet background level for a night, picked at random between min and max
    baseMax: 2.1,
    windowsMin: 2, // number of activity windows (substorms) per night
    windowsMax: 4,
    windowAmpMin: 1.6, // how much each window adds at its peak
    windowAmpMax: 3.0,
    windowWidthHours: [0.5, 1.4], // how long each window lasts (gaussian width, game hours)
    stormChance: 0.1, // chance a night carries one big storm window
    stormAmp: [4.3, 5.7],
    stormChanceRedChallenge: 0.45, // storm chance when today's challenge asks for a red aurora
    jitter: 0.35, // small wobble on top of the curve
    forecastNoise: 0.8, // how fuzzy the radio's predicted curve is compared with what actually happens
  },

  // ---------- Visibility rules ----------
  aurora: {
    minKp: 3.0, // forecast must reach this before anything shows
    fullKp: 6.0, // forecast at which the display reaches full strength
    maxCloud: 0.45, // local cloud cover must be below this
    minDarkness: 0.7, // 0 = full day, 1 = full night
    cityGlowPenalty: 0.85, // how strongly city light washes the aurora out (0 to 1)
    activeThreshold: 0.16, // visibility needed to count as an active aurora
    redKp: 7.0, // forecast at or above this can produce a red aurora
    coronaKp: 6.0, // forecast at or above this can produce a corona overhead
    coronaChancePerMinute: 0.25,
    coronaDurationSec: 45,
    lookUpSecondsToLog: 3,
    newPlaceDistance: 350, // world units you must move before looking up again gives a new postcard
    // First night guarantee. A modest window opens this many real minutes into the first trip
    // and stays open until the player logs a sighting (or the cap is reached).
    guarantee: { startMinutes: 8, kpFloor: 4.3, clearRadius: 400, maxMinutes: 9 },
  },

  // ---------- Clouds ----------
  clouds: {
    scale: 0.00067, // spatial size of cloud systems (smaller = bigger systems)
    driftSpeed: 1.4, // world units per real second the cloud field moves (slow, so shadows do not race over the ground)
    driftDirection: [0.8, -0.35], // wind blows clouds this way (x, z)
    evolveSpeed: 0.003, // how fast the cloud field changes shape over time
    globalBias: -0.04, // add to make the whole island cloudier, subtract for clearer skies
    // Regional bias: south coast is cloudier, the north and the highlands are clearer.
    southBias: 0.12,
    northBias: -0.12,
  },

  // ---------- City lights ----------
  cities: [
    { name: 'Reykjavík', x: -1129, z: 562, radius: 435, strength: 1.0 },
    { name: 'Akureyri', x: 349, z: -760, radius: 262, strength: 0.55 },
  ],

  // ---------- Wind ----------
  wind: {
    baseStrength: 3.0,
    gustStrength: 7.0,
    gustSpeed: 0.18,
  },

  // ---------- Vehicle ----------
  vehicle: {
    maxSpeed: 26, // world units per second on paved road (displayed as km/h x 3.6)
    accel: 9,
    brake: 18,
    reverseMax: 7,
    steerRate: 1.7,
    grip: 7.5,
    handbrakeGrip: 1.4,
    drag: { paved: 0.05, gravel: 0.45, moss: 0.75, sand: 0.9, ford: 2.2 },
    maxSpeedFactor: { paved: 1.0, gravel: 0.72, moss: 0.55, sand: 0.5, ford: 0.28 },
    windPush: 0.55, // how much wind nudges the car
    offRoadLimit: 70, // how far from any road the jeep can roam
    walkSpeed: 4.2,
    walkRadius: 60,
  },

  // ---------- Rendering ----------
  quality: {
    low: { pixelRatio: 1.0, auroraSteps: 8, terrainRes: 560, shadowSize: 0, grass: 9000, grassRadius: 26, rocks: 200, post: false, far: 2000 },
    medium: { pixelRatio: 1.25, auroraSteps: 12, terrainRes: 800, shadowSize: 2048, grass: 30000, grassRadius: 44, rocks: 570, post: true, msaa: 2, far: 3000 },
    high: { pixelRatio: 2.0, auroraSteps: 20, terrainRes: 1080, shadowSize: 4096, grass: 64000, grassRadius: 62, rocks: 1050, post: true, far: 4200, ao: true },
  },
  defaultQuality: 'medium',
  rockDensity: { few: 0.5, normal: 1, many: 1.8 }, // multiplier on the rock count for the chosen quality
  exposure: 0.95, // overall brightness after filmic tone mapping

  landmarkRadius: 34, // how close you must be to collect a landmark stamp
};
