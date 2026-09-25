# Reference video analysis

Three reference clips of BF3 jet gameplay, analysed frame-by-frame (ffmpeg frame extraction +
pixel analysis of the key-press overlay). These notes drive the defaults in `js/config.js`.

## Clip 1 — dogfight with key-press overlay (portrait phone capture, ~30 s)

Third-person turn fight, low over terrain, against an enemy jet. A key visualiser shows `Shift`
and `S`; a black ball covers the key while it is held.

Measured at 20 fps over 26.5 s:

| Key | Pattern | Numbers |
|---|---|---|
| `S` (brake) | Rhythmic holds | Held 1.75–2.0 s, released 2.75–4.2 s. **~31 % duty cycle.** 5 presses. |
| `Shift` | Quick bursts | 3–5 taps of ~0.1 s, 0.2–0.4 s apart, then idle for 2–10 s |

**Interpretation:** the throttle springs back to cruise when released. Holding 313 in a sustained
turn means *feathering the brake* against that pull. The Shift bursts are short speed nudges when
the jet sags below ~300.

## Clip 2 — valley map, mixed third-person/cockpit (~25 s)

- **ECM jammer**, ~4–5.5 s: hard pull-up, dense white/lavender smoke billows from the jet and
  hangs in the air. The camera gets soft white "bokeh" blobs when inside it.
- **ECM ready state**, ~10 s: cockpit HUD text **`ECM JAM READY`** → it is on a cooldown.
  Another smoke burst follows at ~11 s in third person.
- **Flares**: red/orange trails, visually distinct from ECM smoke.
- Heavy bloom and sun glare, distance haze, afterburner glow on the twin nozzles.

## Clip 3 — cockpit tutorial with captions (~44 s)

Captions, verbatim in meaning:

- Normal cruise speed is **340–350**, which gives a pretty big turning radius.
- Brake down to **305–315** and the jet turns much faster and tighter.
- **Below 300 the turns get really bad.**
- **313 is the sweet spot**; anything **300–320** is good for starters.
- Pilot holds ~313 while the enemy doesn't → wins the turn fight.

**Design implication:** the turn-rate curve is a sharp peak at 313 with a steep cliff below 300,
not a gentle hill.

## Look and feel checklist

- Chase camera lags behind the jet and does **not** fully roll with it; the jet visibly banks
  inside the frame.
- Radial motion blur on the ground in low, tight turns; bloom; sun glare; haze.
- Cyan HUD: circular radar bottom-left (objectives + team tickets), jet health + weapon panel
  bottom-right, kill feed top-right, lock icon.
- Cockpit view with canopy frame, HUD text on the glass.
- Most fighting is low turn-fights near terrain → terrain collision and ground detail matter.

## Controls (confirmed with community)

Four throttle states: release = spring back to cruise · `W` cruise throttle up · `Shift`
afterburner · `S` brake. All rebindable.

## Speed tuning derived from clip 1

Clip 1 is a vertical (looping) fight, with the view alternating between sky and ground.
The brake cycle (~5.4 s) roughly matches one loop at 313 (~6.3 s), which suggests one
long brake hold per descent and Shift bursts on the climb. Gravity, brake and afterburner
rates were grid-searched so that a pilot using that feedback rhythm holds 309–317 in a
continuous loop, with duty cycles close to the clip's (AB ~7 %, brake ~39 %).

## Clip 4: roll cam reference (38 s, third person, loops and turns)

Frames sampled at 1–8 fps, with close looks at 0–2.5 s (roll-out from knife-edge) and
19–22 s (over the top of a loop).

- **Horizon stays level.** The jet rolls from knife-edge to wings-level over ~2 s and the
  horizon barely moves (< ~5°). The camera does not copy the jet's bank.
- **Pitch follows, with lag and a limit.** In a vertical climb the view shows only sky
  with the horizon at the bottom edge (camera ~+35–55°), and the jet sits in the upper half
  of the frame. Diving shows ground with the horizon near the top (camera ~−40–55°). The
  camera never goes inverted.
- **Over the top of a loop** (19.3–21.5 s) the camera stays upright. The view goes from the
  jet's white belly (climbing) to its dark back (diving) over ~0.6–0.8 s as the camera
  swings around behind it, horizon level the whole time.
- **The jet drifts on screen.** In hard pulls it moves toward its lift direction (upper
  right while climbing in a turn) instead of staying fixed. At rest it sits low-centre.

Implemented in `js/rollcam.js`: world-up camera, boom yaw/pitch damped toward the nose
direction (pitch clamped ±55°, heading held while the nose is near vertical, swing capped
at 230°/s), aim lagging the boom by up to 14°, and a tilt of 6 % × sin(bank).

Follow-up frames (5–8 s, 22–27 s, 30–38 s): in dives the camera goes nearly top-down (~70–80°)
and the whole jet stays in frame, often centred or upper-centre. It is never cut off by the
screen edge. Climbing, the camera stops lower (~55°) and the jet sits high in the frame.

## Clip 5: roll cam, second reference (48 s)

Sampled at 1 fps across the whole clip and 3 fps with a screen grid over six 8 s
windows (~150 frames).

- **Horizon:** level in essentially every third-person frame, including during full
  rolls. The camera copies none of the bank. (v0.1.11 tilted 6 % × sin(bank), which rocked
  the view at the roll rate. That was the main source of the "jerky when rolling".)
- **Jet size:** about 1/4–1/7 of the screen width, varying as it pulls away and comes back.
  The camera is further back than our full chase cam (now 38 m vs 24 m).
- **Jet wanders a lot:** screen positions range from x ≈ ±0.7 and y ≈ −0.6…+0.8. For
  example, 0–1.7 s is a pull-up where the jet travels from the bottom of the screen to the
  top-right, then the view catches up over ~1 s. This is a slow aim (time constant
  ~0.6 s) trailing a faster boom.
- **Motion is smooth:** no snaps or corrections are visible. The jet eases toward the edge and
  back, and never leaves the screen.
