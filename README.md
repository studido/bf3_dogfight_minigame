# Dogfight 313 — v0.2 prototype

Standalone browser jet-combat prototype with BF3-style air mechanics: spring-back throttle,
the 313 turn-speed sweet spot, heat-seekers with lock tones, flares or ECM jamming, radar,
and keyboard/mouse/controller support. Single-player vs AI, or 2–4 player online dogfights
through a WebSocket relay (room codes, join-in-progress, reconnect resume).

## Run it

Double-click `index.html` (Chrome or Edge recommended). Three.js loads from a CDN, so you need
an internet connection the first time. No install, no server.

The start screen shows the build number (e.g. `build 0.1.18`). If it doesn't match the latest
update, close the tab and reopen `index.html` (or press Ctrl+F5).

Click the screen to capture the mouse. Plug in a controller any time; it's picked up automatically.

## Multiplayer

- **HOST ONLINE** creates a room and shows a 4-letter code. Share the code; friends enter it and press **JOIN ONLINE**. Works from any machine — no port forwarding, both connect out to the relay.
- The host picks AI settings in the lobby and starts the match — but late comers can also **join mid-match**, they drop straight into the furball.
- Each player flies their own jet; everyone can see everyone. The host additionally runs the AI enemies.
- Pause menu → **Leave match** to bail out. A brief connection drop auto-reconnects (~1 min grace).

## Controls

| Action | Keyboard + mouse | Controller |
|---|---|---|
| Pitch / roll | Mouse, or Arrows / Numpad | Right stick |
| Yaw | A / D | Left stick |
| Cruise throttle up | W | RT / R2 |
| Afterburner (hold with throttle up) | W + Shift | RT / R2 + R3 |
| Brake | S | LT (analog) |
| Fire selected weapon | LMB / Space | RB |
| Switch weapon (cannon ⇄ heat-seeker) | RMB / R (1 / 2 direct) | Y / △ |
| Flares / ECM | X | X / □ |
| Camera (chase / cockpit) | C | L3 |
| Look back | V (hold) | B / ○ |
| Menu | P / Esc | Start |
| Tuning panel | F1 / ` | — |

Releasing all throttle keys springs back to cruise (345). Everything is rebindable in the pause menu.
One weapon is active at a time; missile lock-on only runs with heat-seekers selected.

## The core mechanic

The speed box turns **green at 300–320** and **gold at 313 ±3**. Turn rate peaks at 313 and
drops off a cliff below 300. The throttle keeps pulling you back toward cruise.

In a looping fight: **tap afterburner on the way up, hold brake through a good part of the
way down.** In a flat turn, feather the brake. Gravity, brake and afterburner rates were
tuned so a pilot flying that rhythm holds 309–317 (see `docs/VIDEO_ANALYSIS.md`).

## Tuning (F1)

The tuning panel edits every gameplay number live: throttle rates, the turn curve (drag the
points), weapons, countermeasure cooldowns, camera lag and AI. **Export JSON** to share a
preset with other pilots; paste one in and hit **Import** to try theirs. Settings persist
in the browser.

## Files

| File | Role |
|---|---|
| `js/config.js` | All tuning defaults |
| `js/sim.js` | Authoritative simulation: flight, weapons, countermeasures, damage. No rendering, so it can run on a server later |
| `js/ai.js` | AI pilots. They output the same Controls a player does |
| `js/input.js` | Keyboard / mouse / gamepad → Controls, rebinding |
| `js/terrain.js` | Pure terrain height function (shared by sim and renderer) |
| `js/world.js`, `jet-model.js`, `effects.js` | Visuals |
| `js/cockpit.js` | F/A-18-style cockpit + MFD pages (second render pass) |
| `js/hud.js`, `audio.js`, `tuning-panel.js` | HUD, synth audio, live tuning |
| `js/net.js` | Multiplayer client: room create/join, reconnect, state/event relay (see the `dogfight-relay` repo for the server + PROTOCOL.md) |
| `js/main.js` | Loop (fixed 60 Hz sim), camera, menus, lobby |
| `docs/VIDEO_ANALYSIS.md` | Measurements from the reference clips |
| `docs/PROGRESS.md` | Build status and next steps |

Original project: no Battlefield assets, names or audio are used.

## Credits

- F/A-18E/F Super Hornet 3D model: ["Boeing F/A-18E/F \"Super Hornet\""](https://sketchfab.com/3d-models/boeing-fa-18ef-super-hornet-f71e9fea01e24fea9b1b380161d21d38) by [andertan](https://sketchfab.com/andertan), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Changes: converted to metal-roughness materials, textures resized (4K/2K/1K variants), geometry quantised, re-oriented for the game; team paint tint applied at runtime.
- Sky: ["Kloofendal 48d Partly Cloudy (Pure Sky)"](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) from Poly Haven, CC0.
- Ground textures: Poly Haven ["Aerial Grass Rock"](https://polyhaven.com/a/aerial_grass_rock), ["Forrest Ground 01"](https://polyhaven.com/a/forrest_ground_01), ["Aerial Rocks 02"](https://polyhaven.com/a/aerial_rocks_02), ["Snow 02"](https://polyhaven.com/a/snow_02), CC0. Resized to 2K/1K, normal and roughness packed into one texture.
- City tile: ["city pack"](https://sketchfab.com/3d-models/city-pack-6456747d1bfe42f59d388ca555571f2f) by [Pasha](https://sketchfab.com/Pasha.), [Sketchfab Standard licence](https://sketchfab.com/licenses). Optimised (deduplicated, quantised).
- ["New York Buildings"](https://sketchfab.com/3d-models/new-york-buildings-e7922fe0f7b14ed786f84529f9217dac) by [sumitmangela](https://sketchfab.com/sumitmangela), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Changes: textures resized to 1K and JPEG-compressed, geometry quantised, a stray fragment removed, towers rearranged.
- ["Detailed 12 storey panel apartment building"](https://sketchfab.com/3d-models/detailed-12-storey-panel-apartment-building-cb7064bec48845fea62a830b2c692fb1) by [bean (alwayshasbean)](https://sketchfab.com/alwayshasbean), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Changes: converted to metal-roughness, JPEG textures, LOD1 removed.
- Lake ripple texture: derived from the "Water 0341" photo texture supplied with the project (source/licence: see the original download).
- Trees: "Jabami Anime Tree" v1, v2, v3 and v5 by [JABAMI Production](https://sketchfab.com/JabamiProduction), [Sketchfab Standard licence](https://sketchfab.com/licenses). Merged into one file, trunks simplified, leaves recoloured in the shader.
- Cockpit textures: Poly Haven ["Blue Metal Plate"](https://polyhaven.com/a/blue_metal_plate) and ["Metal Plate 02"](https://polyhaven.com/a/metal_plate_02), CC0 (resized to 2K, desaturated).
- Particle textures: [Particle Pack](https://kenney.nl/assets/particle-pack) by Kenney (www.kenney.nl), CC0.
- Sounds (Freesound):
  - Cockpit engine: ["F-15 Eagle Cockpit Avionics"](https://freesound.org/people/SoundFX.studio/sounds/456269/) by [SoundFX.studio](https://soundfx.studio), [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Changes: level-flattened, loop-crossfaded. Non-commercial licence: replace it before any commercial use.
  - Engine howl, afterburner roar and light-off: ["Afterburner sound"](https://freesound.org/people/StoneyJ/sounds/104883/) by StoneyJ, CC0.
  - Cannon: ["M61A2 Minigun"](https://freesound.org/people/Seidhepriest/sounds/611449/) by Seidhepriest, CC0.
- three.js r128 and its example scripts (EffectComposer, UnrealBloomPass, FXAA, GLTFLoader): MIT, three.js authors.
