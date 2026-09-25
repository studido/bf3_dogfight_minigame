# Dogfight 313 — v0.1 prototype

Standalone browser jet-combat prototype with BF3-style air mechanics: spring-back throttle,
the 313 turn-speed sweet spot, heat-seekers with lock tones, flares or ECM jamming, radar,
and keyboard/mouse/controller support. Single-player vs AI for now; the sim is built so a
2–4 player lobby can be added in v0.2.

## Run it

Double-click `index.html` (Chrome or Edge recommended). Three.js loads from a CDN, so you need
an internet connection the first time. No install, no server.

The start screen shows the build number (e.g. `build 0.1.18`). If it doesn't match the latest
update, close the tab and reopen `index.html` (or press Ctrl+F5).

Click the screen to capture the mouse. Plug in a controller any time; it's picked up automatically.

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
| `js/main.js` | Loop (fixed 60 Hz sim), camera, menus |
| `docs/VIDEO_ANALYSIS.md` | Measurements from the reference clips |
| `docs/PROGRESS.md` | Build status and next steps |

Original project: no Battlefield assets, names or audio are used.
