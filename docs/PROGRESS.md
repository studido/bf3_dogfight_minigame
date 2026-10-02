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

## v0.1.27: room code in pause menu + remote ECM smoke fix
- Pause menu shows the room code with a "friends can join anytime" hint while an online
  match is running, so nobody has to back out to the lobby to share the code.
- Fixed invisible remote ECM: sim.step skipped *all* work for remote jets, so jet-owned
  `ecmPuff` events were never emitted on observers — only the ecmUntil window replicates.
  Remote jets now emit their own smoke puffs locally while jamming (and stop when dead,
  since a stale ecmUntil from the net stream otherwise lingers on a corpse). Regression
  test in test/mp-sim.js.

## v0.1.28: remote jet smoothness
- Remote jets looked ~"30 Hz stepping" despite interpolation: net state sent positions
  rounded to **whole meters** (±0.5 m noise per 30 Hz sample ≈ 17% of per-tick travel at
  313 km/h), so the 120 ms interp buffer just glided between jittered points. Positions
  now go out at 0.1 m precision; payload stays tiny.
- If any residual pumping survives bad-network jitter, next lever is keying interp off
  sender step counter instead of arrival time.

## v0.1.29: remote-jet visual convergence
- **The model interpolated; everything attached to it stepped.** HUD markers/lock box
  (`hud.js`), wingtip vapour + damage smoke (`effects.js`) and remote cannon tracers
  (`main.js`) all read `j.pos` — the raw 30 Hz net snapshot — while the 3D model rendered
  the 120 ms-delayed interpolated path. Result: the name diamond visibly stepped relative
  to the jet, trails popped ~10 m ahead, tracers appeared in front of the nose.
  Frame sync now stores the on-screen transform as `dispPos`/`dispQuat` on every jet and
  all those consumers draw from it. Remote tracers spawn from a lightweight view of the
  interpolated transform (`v` object passed to `sim.fireRound`).
- **Interp timeline de-jittered**: netBuf samples were stamped with raw arrival time, so
  WebSocket burstiness (two packets in one frame, then a silent 60 ms) translated into
  speed pumping through the interpolator — invisible in straight flight, obvious while
  rolling/turning. Samples are now re-spaced onto the sender's 30 Hz cadence
  (`netNextAt`), with genuine latency spikes still accepted at real time.

## v0.1.30: remote visual polish (tracers, contrails)
- Tracers were drawn as a full 0.025 s streak (~25 m at muzzle velocity) from the very
  first tick, so the tail poked ~8 m *behind* the firing jet — fine for your own gun
  (camera hides it), weird on a remote jet you're watching. Bullets now carry `age` and
  the streak grows from zero, emerging from the gun like a real tracer burst. Applies to
  all jets.
- Remote jets never showed wingtip vapour: `effects.js` gates it on `j.rates.p > 38`
  but remote jets never run `flight()`, leaving rates at 0. The frame sync now derives a
  smoothed pitch rate from consecutive interpolated quats (`dispQuatPrev` delta) for
  remote jets, so hard pulls leave vapour like locally-simulated jets.

## v0.1.31: team select (lobby + mid-match)
- Relay: every player carries a `team` pick (0/1, `null` = auto) in the roster; a new
  `{t:'team', v}` message works in the lobby and mid-match. Clients resolve teams
  deterministically from the roster: explicit picks stand, AUTO fills the lighter side
  (AI jets count toward team 2), ties go to team 1. Same inputs on every machine, so
  all clients agree without a server arbiter.
- Lobby: TEAM 1 / TEAM 2 / AUTO buttons for everyone (host included); roster lists each
  player's pick.
- Pause menu (online only): TEAM 1 / TEAM 2 switch. The relay roster broadcast drives
  it: `syncMpRosterJets` detects a resolved-team change and calls `switchJetTeam` —
  rebuilds the per-team model paint, clears the interp buffer (no cross-map glide),
  and `sim.spawn` respawns the jet on the new side of the map. Own jet also re-snaps
  the camera. Regression tests: relay test covers team messages; mp-sim covers
  team-side spawn placement.

## v0.1.32: netcode review fixes (relay v0.1.2)
1. **Interp timeline recovers after hiccups** (`BF.netStamp`, net.js). Before this, one 300 ms
   stall followed by a burst left that jet drawn 0.3 s further behind for the rest of the
   match (up to ~0.4 s, the buffer cap). Now the stamp bleeds off up to 4 ms per packet,
   snaps if more than 0.1 s ahead, and stays monotonic.
2. **Cannon hits test remote jets at `dispPos`** (where they are drawn), not the newest
   snapshot ~0.12 s × 144 m/s ≈ 17 m ahead (hit radius 7 m). Remote missiles also launch
   from the drawn jet.
3. **Per-tab session** (sessionStorage), so two tabs can't resume each other's slot. Close
   code 4001 ("replaced") no longer auto-reconnects; it ends the match with a toast. Stale
   socket events are ignored, and `connect()` while CONNECTING waits instead of dropping
   create/join.
4. **Events batched into the 30 Hz state message** (`d.ev`). Cannon hits merge per
   victim+shooter. Before this, a host whose AI landed hits sent ~88 msgs/s and, once past
   the 120-message burst, ~40 % of messages (states and hits) were dropped by the relay's
   50 msg/s limit. Now each client sends 30 msgs/s. Receivers still accept legacy `event`
   messages.
5. **Relay: host grace window** (20 s). A host drop sends `hostWait`; resuming sends
   `hostBack`. An explicit host leave still ends the room immediately.
6. **Lobby callsigns HTML-escaped.**
- Tests: `test/net-client.js` (7 new), `test/mp-sim.js` (+3), relay `test/relay.test.js`
  (+1, 14 total). All pass. Full-page headless smoke (single player + a faked 2-player
  room) also passes.

## v0.1.33: hotfix — vendor load order broke the start menu
- v0.1.32 loaded ShaderPass/RenderPass/etc. *before* EffectComposer.js, but r128's
  passes extend `THREE.Pass`, which is defined **inside** EffectComposer.js. Result:
  "Class extends value undefined" at load, game bootstrap aborted, all menu buttons
  dead. Folded the order into index.html with a comment; cache-busters bumped.
  Headless load-order regression check: node one-liner evals all 8 vendor files in
  index.html order against a Proxy THREE stub (both orders verified).

## v0.1.32: post-processing — bloom, filmic grade, sun glare, FXAA (BF3 look pass 1)
- All rendering now runs through an EffectComposer (r128 example scripts vendored into
  js/vendor so the game still runs from disk): UnrealBloom on an HDR target (WebGL2
  HalfFloat), then the grade pass, then FXAA.
- Grade pass (js/post.js): ACES-style filmic tone map, BF3 split tone (teal shadows /
  warm highlights / slight mid desaturation), vignette, procedural sun glare
  (anamorphic horizontal streak + glow + ghost chain + halo ring) driven by the sun's
  screen position, and faint dirty-lens bars that brighten when looking sunward.

## v0.1.34: graphics pass 1 redo + F/A-18 model
- **Post-processing rebuilt** (`js/post.js`). Pass 1 looked hazy, washed out and streaky:
  - ACES tone mapping on display-space colours flattened contrast. Now the grade works in
    display space (gentle S-curve, soft shoulder above 0.8 only).
  - Bloom fired on the whole sky. Now only HDR > ~1 blooms (sun disc, afterburners, flares).
  - The always-on "dirty lens" bars caused the faint vertical lines, and a halo ring sat
    around the sun. Both removed; sun glare is a small glow plus 2 faint ghosts, only
    with the sun in view.
  - The vignette doubled up with the HUD's. Post no longer vignettes and the HUD
    vignette is lighter.
  - On WebGL2 the scene renders into a 4x MSAA HDR target (canvas MSAA is lost with a
    composer); FXAA is only the WebGL1 fallback.
- **Sky:** normalising per fragment fixed faceted bands on the dome. The red combat-area
  curtain only fades in within ~900 m of the edge (it drew a band across the sky).
- **F/A-18E/F model** (`assets/models/fa18.glb`, from the user's Sketchfab download):
  - Optimised with gltf-transform (spec-gloss to metal-rough, 4K to 2K textures, dedup,
    prune, quantize): 10.3 MB → 2.1 MB, ~58k triangles. Also embedded as base64
    (`fa18.glb.js`) so it loads from file://.
  - GLTFLoader (r128) vendored, patched to decode textures through `<img>`.
  - Rotated/recentred to game space; afterburner flames and glows sit on the real nozzles.
    Red team uses darker grey-green paint copies.
  - Missiles are part of the model (merged meshes), so they don't disappear per shot yet.
  - Falls back to the primitive jet if loading fails.
- **New dev tool:** `/tmp/pv/build.py` (not in repo) bundles the game into one HTML for
  the app's preview panel and scripts camera shots, so renders can be checked without
  user screenshots.

## v0.1.35: texture quality setting + model credits
- **Texture quality** menu option (start screen and pause, saved): Low 1K / **Medium 2K
  (default)** / High 4K jet textures.
  - Each quality is its own base64 script (`assets/models/fa18_<q>.glb.js`: 2.1 / 2.9 /
    12.2 MB) loaded only when chosen, so Medium/Low players never download the 4K file.
  - Switching mid-match swaps every jet to the new model once it's decoded; quick
    switches only apply the latest choice, and decoded qualities stay cached.
  - Preview renders confirm Low vs High (the VFA-103 lettering and panel lines are crisp
    on High).
  - GPU memory: 4K ≈ 180 MB of textures, 2K ≈ 45 MB, 1K ≈ 12 MB. Shared by all jets.
- **Credits:** "Boeing F/A-18E/F Super Hornet" by andertan (Sketchfab), CC BY 4.0. Shown on
  the start screen and in the README with the changes made, as the licence requires.
- Regenerate the variants from the source GLB with gltf-transform: `metalrough` →
  `resize --width N --height N` (skip for 4K) → `dedup` → `prune` → `quantize`, then
  base64-wrap.

## v0.1.37: photo sky (HDRI) + jet reflections
- **Sky backdrop:** Poly Haven "Kloofendal 48d Partly Cloudy (Pure Sky)" (CC0).
  - The 75 MB 4K EXR is tone-mapped (1 − e^(−1.15x), gamma 2.2) to a 385 KB equirect
    JPEG (`assets/sky/`, base64-wrapped for file://).
  - Sky shader samples it per fragment, rotated so the photo's sun (47.9° up, u = 0.595)
    lines up with the game sun, which was raised from 33° to 47.9° to match. The photo's
    mirrored lower half fades into the fog colour. An HDR sun disc keeps the bloom.
  - No mipmaps on the sky texture, to avoid a seam line where `atan` wraps.
- **Fog colour** = the photo's average horizon colour (#a1a4b0), so distant terrain fades
  straight into the photo. 3D clouds: 70 → 38, unfogged, 0.75 opacity, so they don't show as
  grey smudges against the photo clouds.
- **Jet reflections are back:** PMREM-prefiltered sky (paint 0.55, canopy 1.2), built once the
  photo decodes (`BF.ensureJetEnv`). The v0.1.34 blow-out came from the generated env
  scene; the photo env renders correctly (checked in preview).
- The ground HDRI ("Alps field") isn't used. It's a ground-level photo and conflicts with
  our terrain.

## v0.1.38: realistic terrain shape and splat shader
- **Shape:** gradient (Perlin) noise replaces value noise (no grid artifacts), domain-warped
  so nothing lines up with the axes. Rolling lowlands plus ridged-multifractal mountains
  (sharp ridgelines, eroded flanks). Ranges ring the map with a few inner ranges. Heights
  run from -2 to 621 m, about 1 % water.
- **Mesh:** 640x640 grid over 15.3 km (about 24 m spacing), smooth normals taken from the
  height function itself (`js/terrain-render.js`).
- **Splat shader** (MeshStandardMaterial + onBeforeCompile): four layers (grass, dirt,
  rock, snow) weighted per vertex by slope, altitude and noise. Each layer is sampled at
  two scales against tiling. Kilometre-scale macro variation, triplanar rock on cliffs,
  blended tangent-space normals. Procedural stand-in textures are used until the photos
  load.

## v0.1.39: Poly Haven ground textures, building clusters, cumulus clouds
- **Ground textures:** Poly Haven (CC0) aerial_grass_rock, forrest_ground_01,
  aerial_rocks_02 and snow_02, built from the 4K sources.
  - Per set: `diff` (colour) + `nr` (normal X/Y in R/G, roughness in B; the shader rebuilds
    Z). JPEG q95 with 4:4:4 chroma, so the normal channels stay sharp. Normals are
    downsampled as vectors and renormalised.
  - 2K for Medium/High texture quality (`assets/terrain/<set>_medium.js`, about 41 MB
    total), 1K for Low (`_low.js`, about 10 MB). That's 9 texture units, about 180 MB of
    VRAM at 2K. 4K would be about 700 MB for ground mostly seen from 300 m up, so High
    stays at 2K. Switching quality reloads them; loaded sets are cached across matches.
  - The grass photo is dry olive and read as yellow steppe under this sun, so the shader
    pulls it toward temperate green. Its detail is kept; only hue and saturation change.
- **Building clusters** replace the procedural box city and the box villages
  (`js/terrain.js` layout, `js/city.js` rendering):
  - *Metro* (-700, -1000): "city pack" tile at x95, about 1.27 km square, towers up to
    285 m. *Harbour* (-1500, 1350): the same tile at x60, rotated. It shares GPU memory
    with Metro.
  - *Skyline* (2150, -1000): the 19 New York landmark towers at x80 (up to 422 m) on a
    paved 120 m street grid. Empty blocks are filled with panel apartment pairs.
  - *Estate* (-2500, -1900): 20 panel blocks. Six *hamlets* of 2-6 panel blocks sit on
    flat valley floors (deterministic from the seed). Panels are InstancedMeshes.
  - Each cluster sits on a levelled pad: flat over the footprint, blending back into the
    terrain over 220-450 m. The pad's level is the mean natural height.
  - **Collision** uses height grids baked offline from the models (`js/city-data.js`,
    147 KB). The grid cells are 4.75 m (metro), 2.85 m (harbour), 1.6 m (NY) and 1 m
    (panel). Heights are rounded up so they're conservative. `buildingAt` /
    `obstacleHeight` keep their API (about 1 µs per call), so the sim, AI, bullets and
    missiles work unchanged, and a headless sim needs no 3D data.
  - Models: `assets/models/city_{city,ny,panel}.glb.js` (13.5 / 3.8 / 1.8 MB). Build steps:
    gltf-transform `dedup`/`prune`/`quantize`, plus `jpeg --formats "*" --quality 92`
    (NY, panel) and `metalrough` (panel). The panel's LOD1 was dropped. A stray 10-triangle
    fragment floating 180 m from One WTC was removed. Building texture VRAM is about
    100 MB.
  - Materials become plain MeshStandardMaterial (no clearcoat/specular extensions), with
    colours used as-is like the rest of the scene.
- **Clouds:** procedural cumulus billboards replace the soft round blobs. There are 4
  variants (256x192), each a metaball base row with towers and small billows on top and
  noise-broken edges. They're lit from above with a soft surface normal from the metaball
  gradient: white tops, blue-grey flat bases. 34 clouds of 2-4 sprites, bases aligned at
  1000-1650 m.
- Tests now load `city-data.js`, so AI and multiplayer runs include building collision.
  No building deaths in the AI furball runs.

## v0.1.40: stable lakes, organic towns, roads
- **Lake shorelines no longer jitter.** The flat water plane met gently sloping shores at a
  shallow angle. At 2-4 km, 24-bit depth only resolves 0.5-2 m, so the plane and the
  terrain z-fought and the shoreline crawled tens of metres as the camera moved. The plane
  is gone. Water is now shaded in the terrain shader wherever the surface lies below the
  water level, so the shoreline is exact per pixel and can't flicker.
  - Look: depth-tinted colour (shallow green-teal to deep blue), two ripple normal
    layers drifting in different directions, detail from the "Water 0341" photo
    (`assets/terrain/water.js`, 330 KB), low roughness for sun glints, and a Fresnel sky
    reflection. A damp band above the waterline and narrower beaches (dirt now fades out
    2-6 m above the water instead of covering everything below 11 m).
- **Organic town outlines.** Each town has a polar outline: a radius per angle, wobbled by
  low harmonics.
  - City tile (Metro, Harbour): connected building footprints from its height grid are
    kept or dropped by that outline, with a few stragglers just outside. Dropped ones lose
    their collision as well. Every triangle is assigned to the footprint under it. The
    tile's own street mesh is replaced by a ground plane painted only around kept blocks
    (pavement, then asphalt, transparent beyond). Note: the quantised glTF positions
    needed manual denormalisation, because three r128's `getX()` doesn't do it.
  - Skyline: 120 m street blocks and filler panels only inside the outline (tower blocks
    always kept). Estates and hamlets get wobbly pads.
  - Pads follow the outline (grown to cover every kept building), so the terrain blends
    out along a natural edge instead of a rectangle.
- **Roads** (`terrain.roads`, `js/roads.js`): A* over a 50 m grid where cost rises with
  slope and altitude and lakes are impassable. A minimum spanning tree links every town,
  plus short extra links and two highways leaving the map.
  - Paths are string-pulled into long straight runs, Chaikin-smoothed, resampled every 8 m,
    and stop where they reach a town's buildings.
  - Drawn as ribbons draped on the rendered terrain triangles (same grid and
    triangulation as the mesh), lifted 0.25 m with a depth bias.
  - Procedural two-lane texture: gravel shoulders, white edge lines, dashed centre line.
    Trees keep 16 m clear, and the verges are worn.
  - `terrain.roadDist(x, z)` is available for gameplay or AI later.
  - Built with the terrain (~0.37 s total for a new map, deterministic).

## v0.1.41: real trees and forests
- The cone trees are replaced by the four Jabami tree models (`assets/models/trees.glb.js`,
  2.2 MB). They're merged into one GLB, textures are deduplicated (17 down to 9), and the
  trunks are simplified to about 35 % (bark detail is invisible from the air).
- **Three medium forests** (`terrain.forests`, about 1.1-1.9 km across, wobbly outlines,
  on lowland or gentle hills away from towns). Trees sit on a jittered 11 m grid with
  noise clearings, and are mature size (15-25 m). The ground underneath is a darker,
  cooler forest floor (`aForest` vertex attribute in the terrain shader). Groves of
  scattered trees across the map stay as before, now with the real models.
- **Two tiers, so tens of thousands of trees stay cheap:**
  - Within 280 m: real models as InstancedMeshes (one per type and sub-mesh), refilled
    from a 200 m spatial grid each time the camera moves 30 m.
  - Beyond that: every tree is an impostor in one InstancedMesh: two crossed vertical
    cards plus a horizontal card for the view from above. Their textures are an atlas
    rendered once from the real models at startup, so near and far match. A shader hides
    impostors inside the near radius, and their alpha is boosted so distant crowns don't
    thin out in the mipmaps.
- Leaves: the anime textures are mint green, so the leaf shader desaturates and darkens them
  toward a natural green and bends normals toward up, so foliage is lit like a canopy.
  Impostor cards use the same up normal on both faces. Without it, back faces went
  dark, which showed as black specks.
- Trees are planted on the rendered terrain surface (`BF.meshHeightSampler`), and kept
  off towns, roads (14 m), water and cliffs.
- Licence note: the Jabami trees are under the Sketchfab Standard licence (see README).

## v0.1.42: tree refill hitch fix, frame-rate readout
- **Trees:** the near-tree refill uploaded every 3000-slot instance buffer in full (about
  3 MB) each time the camera moved 30 m, several times a second at speed, which caused
  frame hitches. It now uploads only the used slots, and refills every 60 m (radius NEAR + 90,
  so coverage is unchanged).
- **F2** toggles a frame-rate readout: average fps, frame time and the worst frame over 0.5 s.
- Note on "input lag" at low frame rates: the sim and controls are frame-rate independent
  (fixed 60 Hz steps). A GPU-bound frame still delays what you see, though, and roll shows it
  most because attitude changes are instantly visible.

## v0.1.43: cockpit rebuilt from reference images
- `js/cockpit.js` is rewritten to match two reference renders of a Super Hornet front
  office. It's all procedural geometry and canvas textures; no reference pixels are used.
  - Canopy bow arch with bolts, grab pads and an outer rim. Sills and side walls.
  - Glare shield hood with vents, standby compass, GO/NO-GO lights and a BIT button.
  - HUD: two posts, a tinted hexagonal combiner and an AOA indexer. The indexer reads
    the 313 band: green on speed, amber slow, red fast.
  - Panel face with seams, screws and labels.
  - Two DDIs with bezel buttons and knobs. Left: radar PPI, heading up, 5 km. Right:
    attack B-scope with target range and countermeasure status.
  - UFC keypad with a speed scratchpad.
  - AMPCD colour moving map, built once from the real terrain (height tint, hill
    shading, lakes, forests, roads, towns), heading up, 3 km, with jets as diamonds.
  - Engine page (RPM, EGT and nozzle bars, AB tank, HP).
  - Standby attitude ball, altimeter, airspeed and VSI dials.
  - Canopy jettison handle, PUSH TO JETT button, caution lights, side consoles with
    placards, stick grip.
- Layout is authored in reference-image coordinates. The cockpit view uses a lens shift
  (`camera.setViewOffset`) so the boresight sits 27 % down the screen, like the
  reference. The world camera and the HUD symbology use the same shift, so aiming still
  lines up. (`setViewOffset` sets `aspect = fullWidth / fullHeight`, so the real aspect is
  passed as the width.)
- In the cockpit the 2D radar overlay is hidden, because the left DDI is the radar.

## v0.1.44: cockpit fixes and metal textures
- **Holes fixed.** The panel face, side walls and hood were built from screen-space
  polygons. Because fy runs downward, the triangles ended up facing away from the eye and
  were back-face culled. The winding is now flipped where needed.
- **HUD centred.** The boresight in cockpit view is now exactly the centre of the
  combiner glass (`BF.COCKPIT_BORESIGHT`). The gun pipper sits on the boresight (rounds
  fly along the nose); it used to be drawn 30 px above it. All symbology is laid out and
  sized relative to the glass.
- **Textures:** Poly Haven (CC0) blue_metal_plate (desaturated to grey) is used on the
  panel face, hood, side walls, bezels and placards. metal_plate_02 is used on the canopy
  arch. Both are 2K colour, normal and roughness maps (`assets/cockpit/*.js`, about 6 MB
  total), loaded in the background, with the procedural look as the fallback.
- Note: the file preview panel crops the right side of 1280 px renders, so the cockpit can
  look off-centre there even when it's centred in the game.

## v0.1.45: Kenney particle textures
- `assets/particles.js`: a 1024 px atlas (4x4 cells) built from Kenney's Particle Pack (CC0):
  4 smoke puffs, 2 fire puffs, 2 muzzle flashes, spark, 2 star glints, small glow, blast
  burst, dirt debris, soft dot and shockwave ring. About 0.5 MB, loaded with the page.
- The particle shader samples a cell per particle with its own rotation and spin. It falls
  back to the old soft dots if the atlas is missing.
- Effects:
  - Explosions: blast flash, shockwave ring, rolling textured fireball, sparks with
    gravity, then billowing dark smoke.
  - New nose-gun muzzle flash per round, scaled down when the camera is in the cockpit,
    with a little gun smoke.
  - Cannon hits: star flash plus sparks. Ground impacts: dust plus dirt clods.
  - Flares: star glints. Missile, damage, debris and ECM smoke now use the smoke textures.

## v0.1.46: recorded engine, afterburner and cannon sounds
- `assets/sounds/sounds.js` (about 750 KB, base64 MP3) holds five clips cut from three
  Freesound recordings. Every loop is level-flattened (no pumping) and
  crossfaded, with padding so `loopStart`/`loopEnd` sit inside the buffer and loop seamlessly:
  - `engine`: F-15 cockpit drone, 9.8 s loop.
  - `howl`: F-4 J79 power howl, 0.6-5.8 s of the F-4 recording.
  - `ab`: afterburner roar, 22-28.6 s.
  - `abLight`: afterburner light-off thump, 6.0-9.6 s, fades out.
  - `gun`: the real M61A2 burst. Attack, then a 0.8-2.95 s loop region with a
    crossfaded seam, then the 3.0 s+ spin-down tail.
- Engine: throttle state (brake / cruise / mil / AB) is smoothed like spool-up and drives
  the pitch of the drone and the howl. Speed adds a little pitch too.
  - In the cockpit: the drone dominates and the exterior layers go through a 1.4 kHz low-pass.
  - Outside: the howl and roar dominate.
- Afterburner: the roar fades in when the afterburner lights (fast attack, slower release),
  with a light-off thump (at most once per 1.2 s).
- Cannon: a held-trigger voice. It starts with the burst's attack, loops while rounds keep
  coming (within 90 ms), and plays the spin-down tail on release or overheat. The nearest
  other jet that's firing uses the same voice, quieter and low-passed with distance.
- Lock and warning tones, explosions, flares and the rest stay synthesised. The synth
  engine and gun are the fallback until the recordings decode.
- Licence note: the F-15 drone is CC BY-NC (credited on the start screen and in the
  README). The other two are CC0.

## v0.1.47: missile model, launch and trail
- **The missiles on the jet are real parts now.** `tools/splitmsl.mjs` moves the two outer
  underwing missiles out of the merged F/A-18 meshes (by connected component and zone) into
  `missile_L` / `missile_R` nodes in all three quality GLBs. The pylon rails stay on the jet.
  The missile just fired disappears from its pylon and comes back on reload (L first, then R).
- **In-flight model:** `BF.missileModel()` builds the flying missile from that same
  geometry. It shares buffers with the jet, so it costs no extra memory. Its bounds are
  computed from the indexed, dequantised vertices, because the shared accessors span the
  whole airframe. It also returns the jet-local rail positions.
- **Launch:** the model starts on its pylon and slides onto the sim's path (exponential
  blend, about 0.12 s), with a motor flash and a puff of smoke at the rail.
- **In flight:** an additive motor plume cone that flickers, a small hot glow at the
  nozzle, and a smoke trail laid down by distance (every 2.2 m along the path, so it's
  unbroken at any frame rate). The smoke billows from 1.6 to about 15 m, drifts up slightly
  and lingers 5-7.5 s, with ember sparks along it.
  - The smoke pool went from 6000 to 9000 particles.
  - The primitive-jet fallback gets a plain cylinder missile.

## v0.1.48: HUD glass seated on its base
- The combiner glass was about 8 cm above the HUD base on the glare shield, with the posts
  showing underneath. It now spans ref fy 0.173-0.42, so its lower edge sits on the base.
  The posts are shortened to match.
- The cockpit-view boresight follows the glass centre (`BF.COCKPIT_BORESIGHT` = 0.3565), so
  the pipper stays centred on the glass. It's now about 9 % of the screen lower, which also
  shows more sky above the nose.

## v0.1.49: cockpit hit markers, radar in cockpit, jet health slider
- Cockpit view now shows the white hit marker on the boresight, matching the chase view.
- The regular 2D air radar is visible in cockpit view again.
- **Jet health** slider on the start screen: 10-200, step 5, default 50 (half the old 100),
  saved with the other options.
  - Single player: applied to `cfg.jet.health` at match start.
  - Multiplayer: the host's value goes into the lobby settings (`jetHealth`) and is
    applied on every machine. The lobby summary shows it.
  - The relay passes settings through untouched, so no server change is needed.
  - Damage values are unchanged, so 50 HP means about half as many hits to kill.

## v0.3 housekeeping: LaunchGame.html and the jet icon
- `index.html` is renamed `LaunchGame.html`. The game is opened from disk, not
  web-hosted, so nothing depends on the old name. README, config comment and the dev
  harnesses are updated.
- Jet icon (`assets/icon/`): a top-down F/A-18 silhouette on a dark-blue tile with
  afterburner glow and a HUD-green arc, drawn procedurally. Available as `jet.ico`
  (16-256 px) and as PNGs, with `jet_64.png` used as the browser-tab favicon.
- Windows always shows `.html` files with the browser's icon. A local `Dogfight 313.url`
  shortcut with the jet icon points at `LaunchGame.html` by absolute path; it's
  git-ignored. The README explains how to make one.

## v0.3 desktop build (Electron)
- three.js r128 is now bundled (`js/vendor/three.min.js`, the same file the CDN served), so
  the game and the exe run fully offline.
- `electron/main.js`: one window (1600x900, opens maximised) with the jet icon and no
  menu. F11 toggles fullscreen (Esc stays pause). External links (credits) open in the
  normal browser.
  - Chromium flags: `ignore-gpu-blocklist` (WebGL on older laptop drivers) and
    `autoplay-policy=no-user-gesture-required`.
  - `backgroundThrottling: false`, so a match doesn't stall when the window loses focus.
  - Context isolation and sandbox on, no Node in the page.
- `package.json`: electron ^44.5.1, electron-builder ^26.15.3.
  - `npm start` runs from source.
  - `npm run build` makes `dist/Dogfight313.exe` (portable x64, asar, icon
    `assets/icon/jet.ico`). The packaged files are the game files only (no test/docs/tools).
  - It has to be built on Windows: the dev sandbox can't download Electron binaries or run
    the Windows packaging tools.
- `.gitignore`: `node_modules/`, `dist/`.
- **Release workflow** (`.github/workflows/release.yml`): pushing a `v*` tag builds the
  portable exe on `windows-latest` (Node 22, `npm ci`, electron-builder `--publish never`)
  and attaches `Dogfight313.exe` to that tag's GitHub Release (softprops/action-gh-release,
  auto-generated notes). A manual "Run workflow" builds without a release and keeps the
  exe as a 14-day artifact. `electronLanguages: ["en-US"]` trims the Chromium locales.


## Known gaps and next steps
- AI still has about 2 mid-air collisions per 3 minutes in a 5-jet furball.
1. First flight test by the community → tune the turn curve, brake/spring rates and camera lag
   (share presets via Tuning → Export JSON).
2. AI cannon accuracy is low; most AI kills are missiles.
3. No radial motion blur (only edge speed streaks and a vignette). A post-processing pass could add it.
4. v0.2: Node WebSocket relay lobby (2–4 players), room codes, interpolation,
   shooter-authoritative hits.
