// All gameplay tuning lives here. The in-game tuning panel (F1) edits these live
// and can export/import them as JSON. Speeds are in HUD units (km/h); the sim
// converts to m/s internally.
window.BF = window.BF || {};
// Build number: shown on the start screen. index.html loads every script with ?v=<build> so the
// browser can't keep running stale cached files after an update (bump both together).
BF.BUILD = '0.1.24';

BF.DEFAULT_CONFIG = {
  flight: {
    // --- Throttle (spring-loaded: release returns to cruise) ---
    cruiseSpeed: 345,        // where the throttle springs back to (clip 3: 340-350)
    throttleUpSpeed: 430,    // target while holding "cruise throttle up" (W)
    boostSpeed: 560,         // target while holding afterburner (Shift)
    brakeSpeed: 150,         // target while holding brake (S)
    springRate: 8,           // units/s pull back toward cruise on release
    throttleUpRate: 14,      // units/s accel while W
    // Brake/afterburner blend with pitch (see sim.js flight()):
    boostRate: 37.5,         // AB accel in level flight (AB only works with throttle-up held). -25% in v0.1.15
    boostRateClimb: 69,      // AB accel pointing straight up (-25% in v0.1.15)
    brakeRate: 55,           // brake decel in level flight: 345 -> 313 in ~0.6 s
    brakeRateDive: 36,       // brake decel pointing straight down (at 313: slightly under gravity)
    brakeDiveCurve: 0.5,     // <1 = brake weakens quickly as the nose drops (hold it most of the way down)
    brakeSpeedExp: 2,        // brake x (speed / brakeRefSpeed)^exp: smooth, harder when fast, softer when slow
    brakeRefSpeed: 313,      // speed where that factor is exactly 1 (the balance at 313 is unchanged)
    brakeRamp: 8,            // brake effort eases in/out at this rate (1/s): ~0.12 s from 0 to full
    boostSeconds: 10,        // afterburner tank: ~10 s of continuous burn
    boostRechargeDelay: 0.25,// s after release before refilling
    boostRecharge: 1.5,      // tank seconds regained per second
                             // -> tapping (0.5 s on / 0.5 s off) is sustainable for over a minute;
                             //    only long continuous burns empty the tank

    // --- Energy ---
    turnBleed: 2.5,          // units/s lost at full pitch-pull
    gravitySpeed: 40,        // units/s gained/lost at vertical dive/climb
                             // Loops hold 310-318 with ~10% AB taps on the climb and ~28% brake
                             // on the descent (clip 1 measured 6% / 31%). Free dive gains +36/s.
    minSpeed: 90,
    maxSpeed: 650,
    stallSpeed: 150,         // below this the nose drops and controls go mushy

    // --- Turn curve: [speed, pitch rate deg/s]. Sharp peak at 313, cliff below 300. ---
    pitchCurve: [
      [0, 12], [150, 16], [250, 24], [285, 32], [300, 44],
      [313, 58], [325, 50], [345, 40], [400, 33], [480, 27], [650, 22]
    ],
    rollRate: 238,           // deg/s at full stick (was 190, +25% in v0.1.19)
    yawRate: 26,             // deg/s at full rudder
    controlResponse: 9,      // how fast actual rates chase stick input (1/s)
    rollAtLowSpeed: 0.6,     // roll-rate multiplier at stall speed

    groundClearance: 3,      // m, crash below this over terrain
    groundSpeedScale: 1.5,   // world metres moved per HUD speed unit, x (1/3.6). 1.5 = 50% faster over the
                             // ground than a literal km/h, for sense of speed. Energy & turn rates unchanged.
  },

  weapons: {
    cannonRps: 18,
    cannonSpeed: 1300,       // m/s (scaled with groundSpeedScale)
    cannonSpread: 0.35,      // deg
    cannonDamage: 2.2,
    cannonRange: 1100,       // m
    cannonHeat: 0.033,       // heat per round; overheats at 1 (~3.9 s continuous fire, was ~1.6 s)
    cannonCool: 0.35,        // heat/s cooling
    hitRadius: 7,            // m, arcade-generous jet hitbox

    missileLockTime: 1.6,    // s target must stay in cone
    missileLockCone: 16,     // deg half-angle
    missileLockRange: 1400,  // m
    missileSpeed: 375,       // m/s (keeps the same closure vs. the faster jets)
    missileTurnRate: 52,     // deg/s
    missileLife: 7,          // s
    missileProximity: 12,    // m
    missileDamage: 42,
    missileReload: 7,        // s per missile
    missileCount: 2,
  },

  countermeasures: {
    // BF3 made you pick one; loadout is chosen in the pause menu.
    flareCooldown: 17,
    flareCount: 8,           // decoys per deployment
    flareBurn: 2.5,          // s
    ecmCooldown: 20,
    ecmDuration: 4,          // s you cannot be locked
    ecmCloudLife: 6,         // s the smoke hangs in the air
  },

  jet: {
    health: 100,
    regenDelay: 10,          // s without damage before repair starts
    regenRate: 4,            // hp/s
    respawnDelay: 4,
  },

  ai: {
    count: 3,
    aimError: 1.6,           // deg
    reactionTime: 0.45,      // s before flaring an incoming missile
    flareChance: 0.8,
    fireCone: 3.5,           // deg, cannon fires when target within
    skill: 0.8,              // 0..1 speed discipline around 313
    difficulty: 'medium',    // menu: veryEasy / easy / medium / hard (sets the AI values here, see ai.js)
    useMissiles: true,       // menu toggle: AI guns-only for testing
    ecmMode: 'off',          // menu: 'off' (mixed flares/ECM, react to missiles), 'threat' (all ECM, jam when
                             // being locked), 'spam' (all ECM, jam whenever ready, 6 s cooldown: testing)
  },

  world: {
    size: 9000,              // m, square combat area
    boundaryWarn: 200,       // m inside the edge
    outOfBoundsTime: 10,     // s before death
    heightScale: 520,
    ceiling: 3000,           // m: above this engines choke, nose is pushed over; hard cap +200 m
  },

  camera: {
    chaseDistance: 24,
    chaseHeight: 6.5,
    positionLag: 7,          // higher = tighter
    rollLag: 3.2,            // lower = jet banks more in frame (BF3 style)
    baseFov: 70,
    boostFov: 82,
    radarRange: 750,         // m centre to rim
    style: 'roll',           // 'roll' = BF3 roll cam, 'chase' = full chase (menu)
    // BF3 roll cam (js/rollcam.js). Framing matches the v0.1.12 feel (close, jet stays near
    // centre), now on smooth springs.
    rollCamDistance: 24,     // m behind (same as the full chase cam)
    rollCamHeight: 4.5,      // m above the boom: the jet rests a little below centre
    rollCamBoomRate: 10,     // spring rate: how fast the camera swings behind the nose
    rollCamLookRate: 5.2,    // spring rate: how fast the aim catches up (lower = jet wanders more)
    rollCamMaxOffset: 14,    // deg: soft limit on how far the aim trails (keeps the jet near centre)
    rollCamPitchLimit: 55,   // deg: camera pitch clamp looking up (never goes inverted)
    rollCamPitchLimitDown: 80, // deg: clamp looking down (dives go near top-down, as in BF3)
    rollCamRollFollow: 0,    // share of the jet's bank the camera copies. BF3 keeps it level (0).
    rollCamMaxYawRate: 230,  // deg/s: cap on the camera's swing (over the top of a loop takes ~0.8 s)
    rollCamFrameMargin: 0.95,// the whole jet stays inside this fraction of the screen half-size
    rollCamJetRadius: 7.6,   // m: jet half-wingspan (its size seen from behind)
    rollCamJetHalfLength: 10.6, // m: jet half-length (its size seen side-on)
    rollCamMaxYawAccel: 700, // deg/s^2: how quickly the swing over the top can build up
  },
};

BF.cloneConfig = (c) => JSON.parse(JSON.stringify(c));
BF.CONFIG = BF.cloneConfig(BF.DEFAULT_CONFIG);
// Bump when defaults change meaningfully: old saved tuning is discarded so
// everyone picks up the new defaults (export a preset first to keep yours).
BF.CONFIG_VERSION = 16;
// Keys whose defaults changed in a version: dropped from older saves, everything else kept.
BF.CONFIG_MIGRATIONS = {
  3: [['flight', 'boostRate']],
  4: [['flight', 'boostRate'], ['flight', 'boostSeconds'], ['flight', 'boostRechargeDelay'], ['flight', 'boostRecharge']],
  5: [['flight', 'boostRate']], // v0.1.4 slider bug could trap boostRate at 0-1
  6: [['flight', '*']],         // full flight retune (AB now requires throttle-up)
  7: [['weapons', 'cannonHeat']],
  8: [['flight', 'gravitySpeed'], ['flight', 'brakeRate'], ['flight', 'boostRate']], // pitch-dependent brake/AB
  9: [['weapons', 'cannonSpeed'], ['weapons', 'cannonRange'], ['weapons', 'missileLockRange'], ['weapons', 'missileSpeed'], ['camera', 'radarRange']], // 1.5x ground speed
  10: [['camera', 'radarRange']],
  11: [['flight', 'brakeRateDive']],
  12: [['camera', 'rollCamBoomRate'], ['camera', 'rollCamLookRate'], ['camera', 'rollCamMaxOffset'], ['camera', 'rollCamRollFollow'], ['camera', 'rollCamFrameMargin']], // smoother roll cam
  13: [['camera', 'rollCamJetRadius'], ['camera', 'rollCamDistance'], ['camera', 'rollCamHeight'], ['camera', 'rollCamBoomRate'], ['camera', 'rollCamLookRate'], ['camera', 'rollCamMaxOffset']], // back to close framing
  14: [['flight', 'boostRate'], ['flight', 'boostRateClimb']], // AB -25%, smooth brake curve
  15: [['camera', 'radarRange']],
  16: [['flight', 'rollRate']],
};
try {
  const saved = JSON.parse(localStorage.getItem('bf3dog.config') || 'null');
  if (saved && saved._v >= 2) {
    for (const [v, keys] of Object.entries(BF.CONFIG_MIGRATIONS)) {
      if (saved._v < +v) for (const [sec, k] of keys) if (saved[sec]) { if (k === '*') delete saved[sec]; else delete saved[sec][k]; BF.configMigrated = true; }
    }
    for (const k of Object.keys(BF.CONFIG)) if (saved[k]) Object.assign(BF.CONFIG[k], saved[k]);
    // Sanitise: any numeric setting that isn't a finite number falls back to its default.
    for (const [sec, vals] of Object.entries(BF.DEFAULT_CONFIG)) for (const [k, d] of Object.entries(vals)) {
      if (typeof d === 'number' && !Number.isFinite(BF.CONFIG[sec][k])) { BF.CONFIG[sec][k] = d; BF.configMigrated = true; }
    }
    if (BF.configMigrated) localStorage.setItem('bf3dog.config', JSON.stringify({ ...BF.CONFIG, _v: BF.CONFIG_VERSION }));
  } else if (saved) { localStorage.removeItem('bf3dog.config'); BF.configReset = true; }
} catch (e) { /* storage unavailable: use defaults */ }
BF.saveConfig = () => { try { localStorage.setItem('bf3dog.config', JSON.stringify({ ...BF.CONFIG, _v: BF.CONFIG_VERSION })); } catch (e) {} };
BF.KMH = 1 / 3.6; // HUD units -> m/s
