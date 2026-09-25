# Build progress

## v0.1: built, awaiting first flight test

Everything in the v0.1 scope is written (see README for the file map). Verified headlessly:

- Flight model in Node: spring-back returns to 345; a 360° turn takes **6.3 s at 313**,
  8.3 s at 300, 9.1 s at cruise 345, 11.3 s at 285. Brake-feathering on the clip-1 rhythm
  (1.9 s on / 3.5 s off) holds roughly 290–333.
- Combat in Node: lock in 1.6 s; an unflared missile hits for 42; flares decoy it; ECM
  breaks the lock and jams the missile.
- AI furball (5 jets, 3 min): kills come from missiles and cannon; the ram-collision
  problem is fixed.
- Full game loop smoke test with the DOM and WebGL stubbed: menus, pause, restart, camera
  modes and tuning panel run with no errors.

**Not yet verified:** how it actually looks and performs on a real GPU. The sandbox has no
browser with WebGL, so the first real render happens on the user's machine.

## Decisions
- Three.js r128 from cdnjs, classic scripts so index.html opens from disk. Global `BF`.
- `sim.js` is pure state driven by per-jet Controls → a future Node server can run it.
- Throttle: release = cruise, W = throttle up, Shift = afterburner, S = brake.
- Countermeasure loadout: flares OR ECM (one key), picked at start or in the pause menu.
- Linear colour output with no tone mapping, to avoid a seam between the sky shader and the fog.

## v0.1.1: first round of feedback
- Controller: right stick = pitch/roll, left stick = yaw (option in pause menu to swap).
- Controller camera on R3; Y/△ switches weapon. Keyboard: RMB/R switches, 1/2 select directly.
- One weapon active at a time; lock-on only runs with heat-seekers selected; a missile
  fires on the press, so holding the trigger doesn't ripple both missiles.
- Speed retune from clip 1 (was: gravity 40, brake 11, AB 40 → loop band 271–366, not
  holdable). Now gravity 25, brake 20, AB 70. A simulated pilot tapping AB on the climb and
  holding brake on the descent holds **309–317** in a continuous loop (AB 7 %, brake 39 %,
  brake held ~2.3 s per loop; clip measured 6 % / 31 % / ~1.9 s). Flat turn: 311–317 with
  about 20 % brake.
- Saved tuning and bindings are versioned. Older saves are discarded so new defaults apply.
- AI keeps heat-seekers up while hunting and switches to guns for close shots.

## v0.1.2: second round of feedback
- F/A-18-style cockpit (`js/cockpit.js`), drawn as a second pass so it never clips into
  terrain. It has an instrument panel with three green MFDs (radar B-scope, SMS/stores,
  ENERGY page with the 313 band), UFCP keypad, glare shield, HUD with twin combiner glass,
  windscreen bars, canopy bow with three mirrors, canopy rails and side consoles. It is lit
  by the real sun direction.
- Green F-18 HUD symbology clipped to the combiner: pitch ladder (dashed below the horizon),
  waterline, heading tape, airspeed box (turns gold at 313), altitude box, Mach, G, throttle
  state, GUN pipper or AIM-9 seeker circle, SHOOT cue, countermeasure status.
- Afterburner 70 → 130. A simulated tap-only pilot holds 309–323 in tight, medium and wide
  loops (at 70 the wide loop fell to 149). Old saves keep their other tuning; only
  boostRate is reset (config migrations in `config.js`).
- "AI uses missiles" toggle on the start screen and pause menu (verified: 0 AI launches when off).

## v0.1.3: afterburner fix
- Root cause: the afterburner *tank*, not the thrust. With a 6 s tank and a 1.5 s refill
  delay, taps every ~1.5 s never refilled, so the afterburner died after about 18 s of
  tapping. Now it's a 10 s tank, 0.25 s delay and 1.5 s/s refill. Tapping 0.5 s on / 0.5 s off
  lasts over a minute; long continuous burns still empty it.
- Tested through the real keyboard path: a straight vertical climb with 0.5 s taps every
  1–1.5 s holds or gains speed for 20 s+ (it used to drop to 228 once the tank ran dry).
- HUD shows "AFTERBURNER EMPTY" if you press it with the tank dry. Refill delay and refill
  rate are now in the tuning panel. Config migration v4 resets only the afterburner values.

## v0.1.4: afterburner input bugs
- Tuning-panel sliders kept keyboard focus, and keydown ignored any focused INPUT, so all
  flight keys (including Shift) died after touching a slider. Now only text fields swallow
  keys; sliders lose focus on the next flight key.
- Windows + NumLock: Shift held with a numpad key makes Windows send a fake Shift release,
  which cut the afterburner during numpad pull-ups. Fake releases around numpad presses
  are now filtered. ShiftRight is also bound.
- Controller: afterburner moved to RT/R2 (the right thumb is on the flight stick, so A/✕
  couldn't be reached). Cruise throttle-up is LB/L1. Bindings version 3 resets saved
  bindings once.
- F1 panel has a live readout: throttle state the sim sees, raw inputs, tank, boostRate,
  climb angle, and speed change per second.

## v0.1.5: throttle model and retune
- Afterburner is now a modifier on throttle-up (W + Shift, RT + R3). Flames, meter and
  audio only activate while both are held.
- Controller: RT/R2 = throttle up, R3 = afterburner, L3 = camera (bindings v4).
- The F1 readout had shown `boostRate 1`. Slider ranges came from the current value, so a
  value dragged to 0 got a 0–1 slider after reload. Ranges now come from the defaults,
  double-clicking a name resets it, and bad saved values fall back to defaults.
- Found that the hidden 2200 m ceiling (−30/s) had skewed the earlier wide-loop tests (the
  reason AB went to 130). The ceiling is now 3000 m at −20/s with a HUD warning.
- Retune (full flight-section reset, config v6): **AB 55, brake 28**, gravity 25. The simulated
  pilot holds W on the climb, taps AB when slow and brakes on the descent. It holds 310–317 in
  tight, medium and wide loops with brake about 32 % and AB about 7 % of the time (clip: 31 % / 6 %).
  Straight up: W alone −11/s; W + 0.5 s AB taps every 1.5 s +4/s; W + AB held +30/s.
  Vertical dive with full brake: −3/s.

## v0.1.6
- Cannon: continuous fire before overheat went from ~1.6 s to 4.0 s (heat per round
  0.055 → 0.033). Cooldown after overheating is unchanged at ~1.9 s. Config v7 resets
  only cannonHeat.
- Air radar: 2× diameter (radius 92 → 184 px), same 2.6 km range, heading-up.
  - Direction of flight: forward view cone and dashed heading line, a heading readout box,
    and a rotating compass ring with N (gold) / E / S / W.
  - Contacts are arrows pointing their direction of travel, with ▲/▼ if more than 150 m
    above or below you, and a ring around your lock target. Missiles aimed at you show red.
  - The team score panel moved up to sit above the radar.
  - Range cut to a third (2600 → 870 m). At 313 a 2-circle fight is ~350 m across, so
    about 40 % of the scope. Contacts beyond range pin to the rim, dimmed. Range is
    tunable in F1 → Camera → radarRange.

## v0.1.7: pitch-dependent brake and afterburner
- Brake blends from `brakeRate` (level, 55) to `brakeRateDive` (nose straight down, 45) as
  the nose drops. AB blends from `boostRate` (level, 50) to `boostRateClimb` (nose straight
  up, 92). Gravity 25 → 40.
- Level brake 345 → 313 in 0.58 s (was 1.15 s). Vertical dive with full brake −5/s; 45° dive
  with brake −20/s. Free vertical dive +36/s (was +22).
- Straight up: W alone −26/s; W + 0.5 s AB taps every 1.5 s holds exactly; W + AB held +52/s.
  Level AB +50/s.
- Loops hold 310–318 at all sizes with brake about 28 % and AB about 10 % of the time.
  Config v8 resets gravity/brake/AB only.

## v0.1.8: sense of speed
- `flight.groundSpeedScale = 1.5`: jets cover 1.5× more ground per HUD speed unit
  (345 → 144 m/s instead of 96). Energy tuning and turn rates are untouched, and the
  loop/brake/AB tests give identical numbers. Turn circles are 1.5× larger.
- Scaled with it: missile speed 250 → 375 m/s, lock range 1000 → 1400 m, cannon muzzle
  speed 1000 → 1300 m/s, cannon range 900 → 1100 m, radar range 870 → 1300 m (the
  2-circle fight still spans ~40 % of the scope), and AI distance thresholds ×1.4.
  Config v9.
- City (`js/city.js`, buildings in `js/terrain.js`): a flattened 650 m-radius plateau at the
  map centre with a street-grid ground, 178 towers (median 96 m, tallest 327 m, tallest in
  the middle). One merged mesh with a tiling window texture and 5 rooftop masts with blinking
  red beacons. Trees and villages are kept clear of it.
- Towers are solid: jets crash ("hit a building"), and bullets and missiles impact them.
  The AI probes terrain and rooftops ahead and pulls up. AI weapon switching has a 1.5 s
  cooldown.

## v0.1.9
- Ceiling fix: the old 3000 m ceiling was only a −20/s drag, so AI (and players) boosting
  hard could zoom well past it. Now, for every jet: above `world.ceiling` (3000 m) there is
  no throttle-up or afterburner, the nose is pushed over (up to 55°/s by 150 m over), and
  there is a hard cap at +200 m. Tested: W+AB held straight up peaks at 3200 m; the AI
  furball maxed at 3142 m.
- "AI uses ECM jammer" toggle (start screen and pause menu). Every AI carries ECM and fires
  it when a lock passes 55 %, when locked, or when a missile is inside 1200 m. Off: enemies
  alternate flares/ECM and wingmen carry flares. 3-min furball with it on: 11 ECM uses and
  6 launches (locks kept getting broken). AI flare reaction distances were scaled for the
  faster missiles (1000 / 650 m).
- Radar range 1000 m (config v10).

## v0.1.10: brake scaling
- Brake = lerp(level 55, dive 36, diveK^0.5) × (1 + 1.0 × (speed − 330)/100 above 330).
  The square-root blend weakens the brake quickly as the nose drops. The speed term makes
  it bite hard when fast.
- In loops, brake is now held about 70 % of the descent (was 59 %) to stay at 310–318.
  A straight-down dive with full brake at 313 gains +4/s (it settles near ~340 as the
  high-speed term kicks in); at 450 it sheds −36/s.
- Level: 313 → 290 in 0.43 s, 450 → 313 in 1.75 s (was 2.5), 550 → 313 in 2.4 s (was 4.3).
  Config v11 resets brakeRateDive; new keys are in F1.

## v0.1.11: BF3 roll cam
- New third-person camera (`js/rollcam.js`), chosen with "Chase camera" on the start screen
  and pause menu (BF3 roll cam, the default, or Full chase). Tuning lives in F1 → Camera → rollCam*.
- Headless camera test (level rolls, knife-edge turn, continuous loops, loops with rolls,
  split-S): horizon tilt ≤ 5.4°, camera pitch ≤ 55°, jet never off screen. Max camera
  rotation 4°/frame, which is the capped swing over the top.

## v0.1.12: roll cam framing
- Bug: in dives and pull-downs the camera stopped at its 55° pitch limit while the jet kept
  going, so the nose or wings left the screen (test: 105–349 frames per manoeuvre had part
  of the jet off screen).
- More clip 4 frames (5–8 s, 22–27 s, 30–38 s): diving, the camera looks almost straight
  down at the jet's back with the horizon out of frame. So the limit is now asymmetric:
  55° up, 80° down.
- Framing guard: after aiming, the jet's 7 extremities (nose, exhaust, wingtips, fin tips,
  belly) are projected. If any is outside 86 % of the screen half-size, the aim rotates
  toward it, the horizon re-levels, and the correction feeds back into the lag state.
  Result: 0 off-screen frames in all 9 test manoeuvres (loops, split-S, diving turn,
  push-over, vertical dive, rolling descents).

## v0.1.13: smoother roll cam (rewrite of js/rollcam.js)
- Two roll-dependent jerk sources removed:
  1. Camera tilt of 6 % × sin(bank) rocked the horizon ±4.4° at the roll rate. BF3 keeps
     it level, so the default is now 0.
  2. The framing guard projected the wingtips, which sweep in and out as the jet rolls,
     so it kept nudging the aim. It is now a stateless soft clamp on the jet's centre plus
     a bounding radius (roll-invariant).
- Every axis is now a critically damped spring (smooth velocity, not just position). The aim
  trail is soft-limited with tanh instead of clamped, the swing-speed cap is soft, and the
  heading target fades near vertical instead of switching at a threshold.
- Fitted to clip 5: camera 38 m back and 8.5 m up (was 24/6.5), aim spring 1.6, boom
  spring 4.5, aim trail up to 36°.
- Camera test (11 manoeuvres, 60 fps and jittery 40–144 fps): pure rolls and roll reversals
  give 0°/s camera motion (was up to 36°/s of rocking), horizon tilt 0°, 0 off-screen
  frames. Peak camera turn in loops is 127°/s (was ~340°/s).

## v0.1.14: roll cam framing back to close
- v0.1.13's clip-5 fit (38 m back, slow aim) felt too zoomed out and let the jet roam too
  much. Framing is back to v0.1.12 (24 m back, aim trail ≤ 14°), with the smooth
  springs, level horizon and roll-invariant on-screen guard kept. Height is 4.5 m, so the
  jet rests slightly below centre.
- Spring rates were set so the lag matches the old first-order filters (boom 10, aim 5.2). The swing
  over the top has an acceleration cap (700°/s²).
- The on-screen radius is the wingspan from behind, blending to the length side-on, so it
  is still roll-invariant.
- Test: jet stays within x ±0.24, y −0.37…+0.04 of centre across all manoeuvres (v0.1.13:
  ±0.53), 0 off-screen frames, 0°/s camera motion in pure rolls. Config v13.

## v0.1.15: smoother brake, afterburner −25 %
- Brake speed scaling is now (speed/313)² instead of "1 + (speed − 330)/100 above 330"
  (which had a kink at 330 and no fade when slow). It's exactly 1.0 at 313, so the descent
  balance is unchanged: loops still need brake ~70 % of the way down; 90° dive at 313 with
  brake +3/s (was +4), 45° dive −10/s (was −11).
- Level brake decel at 250 / 313 / 400 / 500: −31 / −47 / −73 / −109 per s. Softer when
  slow, so braking at 313 no longer falls off a cliff; still strong when fast
  (450 → 313 in 1.8 s, 550 → 313 in 2.5 s).
- Brake effort eases in and out over ~0.12 s (`brakeRamp`) instead of switching instantly.
- Afterburner −25 %: level 50 → 37.5, climb 92 → 69. Straight up with 0.5 s taps, you now
  need one per ~1 s to hold speed (+1.7/s), not one per 1.5 s (−7.7/s). AB held +29/s (was
  +52). In loops the tap pilot sits at 300–319 with AB ~15–19 %. Config v14.

## v0.1.16: AI ECM menu
- The "AI uses ECM jammer" checkbox became a 3-way "AI ECM jammer" setting:
  - **Normal:** mixed flares/ECM, react to close missiles.
  - **Jam when locked:** all AI carry ECM and jam when they're being locked.
  - **Jam constantly (testing):** jam whenever ready and an enemy is within 2.5 km, on a 6 s cooldown.
- 2-minute test with 3 enemies: 2 / 6 / 48 enemy jams respectively.
- Visibility: a blinking gold "ECM" tag over jamming jets, a kill-feed line "Name [ECM JAMMING]
  distance" for jams within 3 km, and "LOCK JAMMED" when you have missiles selected and are
  in range.

## v0.1.17: radar
- Radar range 750 m (config v15).
- Contacts and your own marker are now top-down fighter silhouettes (swept wings, tailplanes),
  about 25 % larger than the old arrows.
- ECM: a jamming jet disappears from your radar and the cockpit radar MFD for the jam's
  duration. The AI also loses track of a jamming target beyond 1 km (tested: the AI dropped the
  player as a target at 1.76 km while jammed). Within 1 km it still sees you visually.

## v0.1.18: stale-file fix
- The user saw the old radar (1.0 km label, jammers still shown) after v0.1.17. Checked:
  the code on disk is correct (a headless radar draw test gives a 750 m label, and a jamming
  contact isn't drawn), and a saved v14 config migrates to 750. So the browser was running
  cached copies of the old files.
- Every script and the stylesheet now load with `?v=<build>` (cache-busting), and the start
  screen shows the build number. Bump `BF.BUILD` in config.js and the `?v=` in index.html
  together on each update.

## v0.1.19
- Roll rate 190 → 238°/s (+25 %). Config v16 resets only rollRate. Build 0.1.19.

## v0.1.20
- The project now lives in the git repo `bf3_dogfight_minigame` (GitHub: studido/bf3_dogfight_minigame).
- Speed and altitude boxes moved 20 % of the way from their old position toward the screen
  edge (outer edge at 230 + 0.2 × (half-width − 230) px from centre). On short screens the
  speed box is kept clear of the radar.
- Pause-menu toggle "Speed & altitude HUD" (saved). Starting a match now merges saved menu
  options instead of overwriting them. Build 0.1.20.

## v0.1.21: AI difficulty
- "AI difficulty" on the start screen and pause menu: Very easy / Easy / Medium / Hard.
  Medium is exactly the previous AI. Presets live in `BF.AI_LEVELS` (ai.js) and cover aim
  error, fire cone, reaction time, flare chance, evade and flare range, break-turn strength,
  speed "sloppiness" (zoning out) and speed controller.
- Hard adds a feathering speed controller (error + 0.8 s × rate of change, partial brake,
  AB taps, small wandering target error), energy-keeping break direction, and defensive
  breaks when someone behind is past 30 % lock.
- Measured (3-min 5-jet furball, and 30 single-missile shots from 1.1 km per level):

  | Level | Hard-turning time in 300–320 | Gold 310–316 | Over 330 | Missiles that hit |
  |---|---|---|---|---|
  | Very easy | 13 % | 3 % | 54 % | 25 / 30 |
  | Easy | 13 % | 4 % | 35 % | 8 / 30 |
  | Medium | 17 % | 4 % | 2 % | 1 / 30 |
  | Hard | 75 % | 36 % | 9 % | 0 / 30 |

## v0.1.22: difficulty spread
- The old Hard became **Extremely hard**. The new **Hard** uses the feathering speed controller
  with a larger wandering target error (±7), a 3-unit deadband, less anticipation (0.5 s) and
  28 % zone-outs. It has no pre-emptive defensive breaks, slightly worse aim and reactions,
  and 88 % flare chance.
- The v0.1.21 "300–320" column was misleading. Medium rides the 299/321 band edges, so
  it's close to 313 most of the time but rarely inside a narrow window. Re-measured by
  average distance from 313 while hard turning:

  | Level | Avg miss from 313 | Within ±10 | Gold 310–316 |
  |---|---|---|---|
  | Very easy | 31.8 | 13 % | 3 % |
  | Easy | 21.8 | 13 % | 4 % |
  | Medium | 11.5 | 47 % | 4 % |
  | Hard | 11.7 | 67 % | 26 % |
  | Extremely hard | 9.4 | 75 % | 36 % |

- The single/paired-missile test saturates from Medium up (Medium 1/30 hits, Hard and Extremely
  hard 0/30). Lone missiles vs flares are too easy to dodge to separate them.

## v0.1.23: hard/extremely-hard BFM (dogfighting overhaul)
- Hard and Extremely hard now fly basic fighter manoeuvres instead of pure lead-pursuit
  (all gated on new `bfm`/`burst` preset flags; veryEasy/easy/medium are untouched):
  - **Lag/pure pursuit switching**: tracks line-of-sight rate vs the target; while the
    target is crossing fast, aims behind its flight path (lag pursuit, keeps energy and
    stops nose-chasing the turn circle), then converts to lead pursuit once the LOS
    settles (`lagK`/`maxLag` per difficulty).
  - **Off-angle merge entry**: when approaching head-on from 1.4–4.2 km, aims for a point
    offset to one side of the target (150–650 m) so merges open at an angle instead of
    neutral head-ons; the side re-rolls after each close pass.
  - **Overshoot control**: inside `overDist` on the target's six with closure past
    `overClosure`, pulls up and brakes (~1 s) to avoid blowing through, with a 3 s
    re-arm cooldown.
  - **Approach speed discipline**: the 313 PD controller now also runs during the attack
    run inside 1.6 km, so they arrive at corner speed instead of cruising in at 345.
  - **Gun burst discipline** (`burst`): fires until ~55% heat, holds until ~15%, instead
    of overheating mid-solution.
- New headless test: `node test/ai-furball.js [seconds] [levels]` (minimal THREE math
  stub, runs the real sim + AI). 3-min furballs, seeds 1337/7/42:

  | Level | Gun time (of alive ticks) | Avg miss from 313 while turning |
  |---|---|---|
  | Medium | 7.3–9.8 % | 21–43 |
  | Hard | 8.1–13.6 % | 13–21 |
  | Extremely hard | 9.1–15.1 % | 5–8 |

## v0.1.24: multiplayer over the relay server (v0.2 milestone)
Lobby + full client netcode against `minigame_relay_server` (see that repo's
PROTOCOL.md). Default server: wss://bf3-dogfight-relay.fly.dev (editable on the
start screen, saved to localStorage).

- **Lobby**: HOST ONLINE / JOIN ONLINE on the start screen; lobby shows the room code,
  player list (host/ready/dropped), host-only AI options (count, difficulty, missiles,
  ECM); host also shares the current flight/weapons/countermeasures tuning as settings.
  Host presses START MATCH → everyone launches on the same broadcast seed/tuning.
- **Ownership model**: every client simulates only its own jets. Humans join in roster
  order → jet creation order is identical on every machine, so slot indices line up.
  Host additionally runs the AI pilots and streams them.
- **Sync**: own jets broadcast 30 Hz (pos/quat/speed/health/flags/weapon/missiles);
  remote jets are rendered ~120 ms in the past with snapshot interpolation; gameplay
  (locks, bullet tests, missile PD) uses the latest received pose.
- **Combat**: shooter-authoritative guns (my sim reports hits on your jets, you apply
  the damage to your own sim), missiles flown/reported by the launcher and replicated
  visually elsewhere; flares/ECM replicate so decoys/jams converge on all machines;
  kills are announced by the victim's owner for the shared kill feed; server connection
  loss shows a reconnect notice and auto-resumes the room slot (~1 min grace).
- **sim.js**: `j.remote` gates flight/weapons/CM/respawn (network-owned), visual-only
  tracer bullets/missiles that never damage, `applyNetDamage/applyNetKill/
  applyRemoteCm/launchRemoteMissile` entry points, local collision kills apply only to
  non-remote jets.
- Tests: `test/mp-sim.js` (6 tests: remote gates, remote-hit reporting, net damage/
  kill, visual missiles, remote CM). `test/three-stub.js` now holds the shared THREE
  math stub used by both headless test harnesses.

Still open for netcode polish: adaptive send rate when engaged, per-player ping in the
lobby, host migration, pause-menu tuning changes mid-match (one diverging client can
desync tuning — friends' rule: don't).

## v0.1.25: multiplayer hotfix
- index.html: a corrupted lobby `<div>` (broken `id="lobby"`) silently killed every
  `$('lobby')` lookup — that was why HOST ONLINE appeared to do nothing.
- net.js create/join now clear any saved resume session up front (explicit user action
  must never auto-resume an old room, which could also hijack the host slot after the
  server's resume take-over change).
- Verified end-to-end against the live relay (create/join/settings/ready/start/state/
  event relay, graceful + zombie resume) via Node probes driving the real `js/net.js`.
- Relay server v0.1.1 (separate repo): resume now uses token-verified take-over so
  reconnecting while the server still sees a zombie old socket succeeds; 11 relay
  tests pass, deployed as the same `bf3-dogfight-relay` URL.

## v0.1.26: leave match + join in progress
- Pause menu gains a **Leave match** button (single-player drops straight back to the
  start screen; online it does the old restart-button leave behavior). The redundant
  restart relabel in online matches is gone — the restart button is hidden while mp.
- **Join in progress**: the relay already allowed joining a started room; the client
  now handles it. A late joiner skips the lobby and flies straight in on the shared
  seed/settings; everyone mid-match gets the roster and adds their jet. Slot layout
  stays consistent across machines: human jets live before the AI block, leavers are
  fully removed mid-match so slots always equal the current roster order.
- Relay repo: regression test locks in that joining a started room returns
  `joined{started:true, seed}` and traffic flows; PROTOCOL.md documents it.
  No server change needed, no redeploy.

## Known gaps and next steps
- AI still has about 2 mid-air collisions per 3 minutes in a 5-jet furball.
1. First flight test by the community → tune the turn curve, brake/spring rates and camera lag
   (share presets via Tuning → Export JSON).
2. AI cannon accuracy is low; most AI kills are missiles.
3. No radial motion blur (only edge speed streaks and a vignette). A post-processing pass could add it.
4. v0.2: Node WebSocket relay lobby (2–4 players), room codes, interpolation,
   shooter-authoritative hits.
