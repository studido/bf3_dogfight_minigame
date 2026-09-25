// BF3-style "roll cam" for the third-person view.
//
// Behaviour taken from reference clips 4 and 5 (docs/VIDEO_ANALYSIS.md):
//  - The horizon stays level. The camera keeps world-up and ignores the jet's bank, so
//    the jet rolls freely in the frame.
//  - The camera sits well back (the jet is ~1/6–1/8 of the screen width).
//  - Its aim lags the jet heavily: in pulls, dives and turns the jet wanders across
//    most of the screen (up to ~75 % of the way to the edge) and then drifts back.
//  - Pitch follows with a limit: ~55° looking up (never inverted), ~80° looking down.
//  - Over the top of a loop the camera stays upright and swings around behind the jet.
//
// Smoothness: every axis is a critically damped spring (continuous position AND
// velocity, so no kinks when the stick input changes). The aim offset is soft-limited
// (tanh) rather than clamped. The on-screen guard uses only the jet's centre and a
// bounding radius, which doesn't change as the jet rolls. Nothing here reacts to roll,
// which is what caused the old jerkiness when rolling (camera-roll follow and a
// wingtip-based framing check).
window.BF = window.BF || {};

(() => {
  const V3 = THREE.Vector3;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const dirFrom = (yaw, pitch, out) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const levelBasis = (fwd) => {
    const right = new V3(0, 1, 0).cross(fwd).normalize().negate();
    return { right, up: new V3().crossVectors(right, fwd).normalize() };
  };

  // Critically damped spring step. s = {x, v}; err = target - x (already wrapped for angles).
  const spring = (s, err, w, dt, vmax = Infinity, amax = Infinity) => {
    s.v += BF.clamp(w * w * err - 2 * w * s.v, -amax, amax) * dt; // accel cap: big swings ease in
    if (vmax < Infinity) s.v = vmax * Math.tanh(s.v / vmax); // soft speed cap (no kink when it engages)
    s.x += s.v * dt;
  };

  BF.RollCam = class {
    constructor() { this.init = false; this.lastT = -1; this.pos = new V3(); this.look = new V3(); this.up = new V3(0, 1, 0); }

    limits(C) { return { up: (C.rollCamPitchLimit ?? 55) * BF.DEG, down: (C.rollCamPitchLimitDown ?? 80) * BF.DEG }; }

    reset(quat, C) {
      const f = BF.forwardOf(quat, new V3()), L = this.limits(C);
      const yaw = Math.atan2(f.x, -f.z), pitch = BF.clamp(Math.asin(BF.clamp(f.y, -1, 1)), -L.down, L.up);
      this.boomYaw = { x: yaw, v: 0 }; this.boomPitch = { x: pitch, v: 0 };
      this.aimYaw = { x: yaw, v: 0 }; this.aimPitch = { x: pitch, v: 0 };
      this.targetYaw = yaw; this.swing = 0; this.init = true;
    }

    // Yaw error along the short way, except on a ~180° flip (over the top of a loop),
    // where it keeps turning the way it started instead of wobbling.
    yawErr(cur, target) {
      let d = wrap(target - cur);
      if (Math.abs(d) > 2.8) { if (!this.swing) this.swing = Math.sign(d) || 1; d = this.swing * Math.abs(d); }
      else if (Math.abs(d) < 1.5) this.swing = 0;
      return d;
    }

    update(dt, jetPos, quat, C, lookBack, time, camera) {
      if (!this.init || time - this.lastT > 0.5) this.reset(quat, C);
      this.lastT = time;
      dt = Math.min(dt, 1 / 30); // keep the springs stable through frame hitches
      const f = BF.forwardOf(quat, new V3()), L = this.limits(C);

      // Heading target from the nose's horizontal direction. It fades out as the nose
      // nears vertical (heading is undefined there), so the target glides rather than jumps.
      const hLen = Math.hypot(f.x, f.z);
      const newYaw = Math.atan2(f.x, -f.z), trust = BF.clamp((hLen - 0.08) / 0.25, 0, 1);
      this.targetYaw += wrap(newYaw - this.targetYaw) * trust;
      const targetPitch = BF.clamp(Math.asin(BF.clamp(f.y, -1, 1)), -L.down, L.up);

      // Boom (where the camera sits): follows the nose fairly quickly
      const wB = C.rollCamBoomRate ?? 4.5, vMax = (C.rollCamMaxYawRate ?? 230) * BF.DEG;
      spring(this.boomYaw, this.yawErr(this.boomYaw.x, this.targetYaw), wB, dt, vMax, (C.rollCamMaxYawAccel ?? 700) * BF.DEG);
      spring(this.boomPitch, targetPitch - this.boomPitch.x, wB, dt);
      // Aim (where the camera looks): follows the boom slowly, so the jet wanders on screen
      const wA = C.rollCamLookRate ?? 2.0;
      spring(this.aimYaw, wrap(this.boomYaw.x - this.aimYaw.x), wA, dt, vMax);
      spring(this.aimPitch, this.boomPitch.x - this.aimPitch.x, wA, dt);

      // Soft-limit how far the aim may trail the boom (tanh: smooth, no hard stop)
      const lim = (C.rollCamMaxOffset ?? 30) * BF.DEG;
      let dy = wrap(this.aimYaw.x - this.boomYaw.x) * Math.cos(this.boomPitch.x), dp = this.aimPitch.x - this.boomPitch.x;
      const m = Math.hypot(dy, dp);
      if (m > 1e-6) { const s = (lim * Math.tanh(m / lim)) / m; dy *= s; dp *= s; }
      let aimYaw = this.boomYaw.x + dy / Math.max(Math.cos(this.boomPitch.x), 0.2), aimPitch = this.boomPitch.x + dp;
      const flip = lookBack ? Math.PI : 0;
      const boom = dirFrom(this.boomYaw.x + flip, lookBack ? -this.boomPitch.x : this.boomPitch.x, new V3());
      const dist = C.rollCamDistance ?? 38, height = C.rollCamHeight ?? 8.5;
      this.pos.copy(jetPos).addScaledVector(boom, -dist).addScaledVector(levelBasis(boom).up, height);

      // Keep the whole jet on screen with a stateless soft clamp on the jet's angular
      // position in view (centre + bounding radius, so rolling can't affect it). Inside
      // ~60 % of the allowed zone nothing happens. Beyond that, the jet's on-screen angle
      // is eased (tanh) toward the edge limit and never passes it. Being a smooth function
      // of the geometry, it can't oscillate frame to frame.
      aimPitch = BF.clamp(aimPitch, -85 * BF.DEG, 85 * BF.DEG);
      if (camera) {
        const sgn = lookBack ? -1 : 1;
        for (let it = 0; it < 2; it++) {
          const look = dirFrom(aimYaw + flip, sgn * aimPitch, new V3()), B = levelBasis(look);
          const d = new V3().subVectors(jetPos, this.pos), dd = d.length();
          const z = d.dot(look); if (z <= 0.05) break;
          const ax = Math.atan2(d.dot(B.right), z), ay = Math.atan2(d.dot(B.up), z);
          // Apparent jet radius: from dead astern only the wingspan matters (and a roll just
          // spins the wingtips around the centre, so it's roll-invariant). Side-on, the
          // length matters too. Blend by the angle between the nose and the view direction.
          const sinA = new V3().crossVectors(f, d.clone().normalize()).length();
          const jr = (C.rollCamJetRadius ?? 7.6) + ((C.rollCamJetHalfLength ?? 10.6) - (C.rollCamJetRadius ?? 7.6)) * sinA;
          const margin = C.rollCamFrameMargin ?? 0.95, rad = Math.asin(Math.min(jr / dd, 0.9));
          const tanV = Math.tan(camera.fov * BF.DEG / 2), tanH = tanV * camera.aspect;
          const Ax = Math.max(0.05, Math.atan(margin * tanH) - rad), Ay = Math.max(0.05, Math.atan(margin * tanV) - rad);
          const soft = (a, A) => { const s0 = 0.75 * A, m = Math.abs(a); if (m <= s0) return a; return Math.sign(a) * (s0 + (A - s0) * Math.tanh((m - s0) / (A - s0))); };
          const shX = ax - soft(ax, Ax), shY = ay - soft(ay, Ay);
          if (Math.abs(shX) < 1e-5 && Math.abs(shY) < 1e-5) break;
          aimYaw += sgn * shX / Math.max(Math.cos(aimPitch), 0.2);
          aimPitch = BF.clamp(aimPitch + sgn * shY, -85 * BF.DEG, 85 * BF.DEG);
        }
      }
      const look = dirFrom(aimYaw + flip, lookBack ? -aimPitch : aimPitch, this.look);
      const B = levelBasis(look);
      const tilt = (C.rollCamRollFollow ?? 0) * Math.PI / 2 * Math.sin(Math.atan2(-BF.rightOf(quat, new V3()).dot(B.up), BF.upOf(quat, new V3()).dot(B.up)));
      this.up.copy(B.up).applyAxisAngle(look, tilt);
      return { position: this.pos, look: this.look, up: this.up };
    }
  };
})();
