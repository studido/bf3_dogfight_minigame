// AI pilots produce Controls exactly like a human would, so they fly with the
// same flight model (including riding the 313 turn speed).
window.BF = window.BF || {};

(() => {
  const V3 = THREE.Vector3;
  const inv = new THREE.Quaternion(), local = new V3(), desired = new V3(), tmp = new V3();

  // Difficulty presets. "medium" is exactly the AI as it was before difficulty existed.
  //   evadeRange: missile distance at which they start evading
  //   flareRange: furthest a missile can be when they pop flares/ECM
  //   breakTurn:  how hard they turn away from a missile (0 = keeps attacking, 1 = full break)
  //   sloppy:     chance of zoning out on speed control for a few seconds at a time
  //   speedMode:  'bang' = brake/boost at the band edges; 'pd' = feathers toward 313 and
  //               anticipates climbs/dives (hard)
  //   defensive:  breaks when someone behind is getting a lock, before any missile is fired
  BF.AI_LEVELS = {
    veryEasy: { aimError: 4.0, fireCone: 2.5, skill: 0.2, reactionTime: 1.3, flareChance: 0.35, evadeRange: 450, flareRange: 350, breakTurn: 0, sloppy: 0.5, speedMode: 'bang', defensive: false },
    easy:     { aimError: 2.6, fireCone: 3.0, skill: 0.5, reactionTime: 0.8, flareChance: 0.6, evadeRange: 750, flareRange: 550, breakTurn: 0.6, sloppy: 0.2, speedMode: 'bang', defensive: false },
    medium:   { aimError: 1.6, fireCone: 3.5, skill: 0.8, reactionTime: 0.45, flareChance: 0.8, evadeRange: 1000, flareRange: 650, breakTurn: 1, sloppy: 0, speedMode: 'bang', defensive: false },
    hard:     { aimError: 1.3, fireCone: 3.7, skill: 0.9, reactionTime: 0.32, flareChance: 0.88, evadeRange: 1150, flareRange: 650, breakTurn: 1, speedMode: 'pd', pdNoise: 14, pdDeadband: 3, pdLead: 0.5, sloppy: 0.28, smartBreak: true, defensive: false },
    extreme:  { aimError: 1.0, fireCone: 4.0, skill: 0.95, reactionTime: 0.22, flareChance: 0.96, evadeRange: 1400, flareRange: 700, breakTurn: 1, sloppy: 0, speedMode: 'pd', pdNoise: 6, pdDeadband: 1.5, pdLead: 0.8, smartBreak: true, defensive: true },
  };
  BF.applyAiDifficulty = (cfg, level) => {
    const p = BF.AI_LEVELS[level] || BF.AI_LEVELS.medium;
    Object.assign(cfg.ai, p, { difficulty: BF.AI_LEVELS[level] ? level : 'medium' });
  };

  BF.AIPilot = class {
    constructor(sim, jet) {
      this.sim = sim; this.jet = jet; this.targetId = null; this.retargetT = 0;
      this.noise = new V3(); this.noiseT = 0; this.reactT = 0; this.missileDelay = 0;
      this.jinkT = 0; this.jinkDir = 1;
    }

    pickTarget() {
      const j = this.jet; let best = null, bestD = Infinity;
      for (const o of this.sim.jets) {
        if (!o.alive || o.team === j.team) continue;
        let d = o.pos.distanceTo(j.pos);
        if (this.sim.t < o.ecmUntil && d > 1000) continue; // jamming: off their radar beyond visual range
        if (o.lock.targetId === j.id) d *= 0.6; // go after whoever is on us
        if (o.id === this.targetId) d *= 0.8;   // stickiness
        if (d < bestD) { bestD = d; best = o; }
      }
      this.targetId = best ? best.id : null;
    }

    update(dt) {
      const j = this.jet, sim = this.sim, A = sim.cfg.ai, c = BF.emptyControls();
      j.ctl = c;
      if (!j.alive) return;
      this.retargetT -= dt;
      if (this.retargetT <= 0) { this.pickTarget(); this.retargetT = 2.5 + sim.rand() * 1.5; }
      let tgt = this.targetId != null ? sim.jet(this.targetId) : null;
      // A jamming target beyond ~1 km drops off the AI's radar: it loses track until the jam ends
      if (tgt && sim.t < tgt.ecmUntil && tgt.pos.distanceTo(j.pos) > 1000) tgt = null;
      const fwd = BF.forwardOf(j.quat, new V3());
      let mode = 'cruise', dist = Infinity, angleOff = Math.PI;

      // Slowly-varying aim error
      this.noiseT -= dt;
      if (this.noiseT <= 0) {
        this.noiseT = 0.6;
        const e = A.aimError * BF.DEG;
        this.noise.set((sim.rand() - 0.5) * 2 * e, (sim.rand() - 0.5) * 2 * e, (sim.rand() - 0.5) * 2 * e);
      }

      // Default: fly toward the middle at a sane altitude
      desired.set(-j.pos.x, 0, -j.pos.z).normalize(); desired.y = BF.clamp((700 - j.pos.y) / 1200, -0.3, 0.4); desired.normalize();

      if (tgt && tgt.alive) {
        tmp.subVectors(tgt.pos, j.pos); dist = tmp.length();
        const lead = BF.clamp(dist / sim.cfg.weapons.cannonSpeed, 0, 1.2);
        desired.copy(tgt.pos).addScaledVector(tgt.vel, dist < 1400 ? lead : 0).sub(j.pos).normalize().add(this.noise).normalize();
        angleOff = fwd.angleTo(desired);
        mode = 'attack';
      }

      // Missile evasion
      const th = sim.threatsTo(j);
      const evadeRange = A.evadeRange ?? 1000, flareRange = A.flareRange ?? 650, breakTurn = A.breakTurn ?? 1;
      if (th.incoming.length && th.nearestMissile < evadeRange) {
        this.reactT += dt;
        if (this.reactT > A.reactionTime && sim.t >= j.counterReadyT && th.nearestMissile < flareRange) {
          if (sim.rand() < A.flareChance) c.counter = true; else j.counterReadyT = sim.t + 1.5; // "missed" the tone
        }
        // Break turn perpendicular to the closest missile
        const m = th.incoming.reduce((a, b) => (a.pos.distanceTo(j.pos) < b.pos.distanceTo(j.pos) ? a : b));
        tmp.subVectors(j.pos, m.pos).normalize();
        const brk = new V3().crossVectors(tmp, new V3(0, 1, 0)).normalize();
        // Hard: break toward whichever side is closer to the current heading (keeps energy)
        if (A.smartBreak) this.jinkDir = brk.dot(fwd) >= 0 ? 1 : -1;
        brk.multiplyScalar(this.jinkDir).addScaledVector(tmp, 0.3).normalize();
        if (breakTurn >= 1) desired.copy(brk);
        else if (breakTurn > 0) desired.lerp(brk, breakTurn).normalize();
        if (breakTurn > 0) mode = 'evade';
      } else { this.reactT = 0; if (sim.rand() < dt * 0.3) this.jinkDir *= -1; }

      // Hard: defensive break when someone behind is building a lock, before they fire
      if (A.defensive && mode !== 'evade') {
        for (const o of sim.jets) {
          if (!o.alive || o.team === j.team || o.lock.targetId !== j.id) continue;
          tmp.subVectors(o.pos, j.pos); const d = tmp.length();
          if (d < 1500 && o.lock.t / sim.cfg.weapons.missileLockTime > 0.3 && tmp.dot(fwd) < 0) {
            const brk = new V3().crossVectors(tmp.normalize(), new V3(0, 1, 0)).normalize();
            desired.copy(brk.dot(fwd) >= 0 ? brk : brk.negate()).addScaledVector(fwd, 0.2).normalize();
            mode = 'evade'; break;
          }
        }
      }

      // ECM mode: jam proactively as soon as someone is getting a lock (ECM breaks
      // locks and blocks new ones), not just when a missile is already close.
      const ecmMode = A.ecmMode === true ? 'threat' : A.ecmMode || 'off';
      // "Constant" (testing): jam every time it's ready whenever any enemy is within
      // 2.5 km, on a short 6 s cooldown, so you actually get to see it.
      j.ecmCooldown = ecmMode === 'spam' ? 6 : undefined;
      if (ecmMode === 'spam' && j.loadout === 'ecm' && sim.t >= j.counterReadyT && !c.counter) {
        if (sim.jets.some((o) => o.alive && o.team !== j.team && o.pos.distanceTo(j.pos) < 2500)) c.counter = true;
      }
      if (ecmMode === 'threat' && j.loadout === 'ecm' && sim.t >= j.counterReadyT && !c.counter) {
        let lockProg = 0;
        for (const o of sim.jets) if (o.alive && o.lock.targetId === j.id) lockProg = Math.max(lockProg, o.lock.t / sim.cfg.weapons.missileLockTime);
        if (th.lockedBy || lockProg > 0.55 || (th.incoming.length && th.nearestMissile < 1200)) {
          this.ecmReact = (this.ecmReact || 0) + dt;
          if (this.ecmReact > A.reactionTime) { c.counter = true; this.ecmReact = 0; }
        } else this.ecmReact = 0;
      }

      // Don't ram: break right if a head-on pass is about to get too close
      for (const o of sim.jets) {
        if (o === j || !o.alive) continue;
        tmp.subVectors(o.pos, j.pos); const d = tmp.length();
        if ((d < 320 && tmp.dot(fwd) > 0 && tmp.dot(o.vel) < 0) || (d < 130 && tmp.dot(fwd) > d * 0.5)) {
          desired.addScaledVector(BF.rightOf(j.quat, new V3()), 1.2).addScaledVector(BF.upOf(j.quat, new V3()), 0.4).normalize();
          angleOff = 0; break;
        }
      }

      // Boundary
      if (j.nearBoundary) { desired.set(-j.pos.x, 0.1, -j.pos.z).normalize(); mode = 'boundary'; }

      // Ground avoidance has final say
      // Probe several points ahead against terrain AND rooftops (city towers)
      let clearAhead = Infinity;
      for (const lt of [0.5, 1.2, 2.0, 2.8]) {
        tmp.copy(j.pos).addScaledVector(j.vel, lt);
        clearAhead = Math.min(clearAhead, tmp.y - sim.terrain.obstacleHeight(tmp.x, tmp.z, 20));
      }
      const overTower = j.pos.y - sim.terrain.obstacleHeight(j.pos.x, j.pos.z, 20);
      if (j.altitude < 140 || overTower < 60 || clearAhead < 120 || (fwd.y < -0.35 && j.altitude < 450)) {
        desired.set(fwd.x, 0, fwd.z).normalize(); desired.y = 0.8; desired.normalize();
        mode = 'pullup';
      }

      this.steer(c, desired, mode === 'pullup');

      // Speed discipline: ride 313 in turn fights
      const s = j.speed, turning = angleOff > 20 * BF.DEG || mode === 'evade';
      // Sloppy pilots zone out on speed control for a few seconds at a time
      this.lapseT = (this.lapseT ?? 0) - dt;
      if (this.lapseT <= 0) { this.lapsing = sim.rand() < (A.sloppy || 0); this.lapseT = this.lapsing ? 2 + sim.rand() * 2 : 3; }
      // Hard: speed derivative (smoothed) for the anticipating controller
      if (this.prevSpeed != null) this.dvF = BF.damp(this.dvF || 0, (s - this.prevSpeed) / Math.max(dt, 1e-3), 8, dt);
      this.prevSpeed = s;
      if (mode === 'pullup') { c.throttleUp = 1; if (s < 300) c.boost = 1; }
      else if (this.lapsing) { /* not managing speed right now */ }
      else if (turning && A.speedMode === 'pd') {
        // Aim at 313 (with a slowly wandering small error, so it isn't perfect) and act on
        // where speed is heading: u = error + 0.8 s x rate of change.
        this.spdNoiseT = (this.spdNoiseT ?? 0) - dt;
        if (this.spdNoiseT <= 0) { this.spdNoise = (sim.rand() - 0.5) * (A.pdNoise ?? 6); this.spdNoiseT = 1.5; }
        const u = (s - 313 - this.spdNoise) + (A.pdLead ?? 0.8) * (this.dvF || 0), db = A.pdDeadband ?? 1.5;
        if (u > db) c.brake = BF.clamp(u / 10, 0.25, 1);
        else if (u < -db) { c.throttleUp = 1; if (u < -4 && j.boostTank > 1) c.boost = 1; }
      }
      else if (turning) {
        const hi = 313 + (1 - A.skill) * 40, lo = 305 - (1 - A.skill) * 30;
        if (s > hi) c.brake = 1; else if (s < lo) c.boost = j.boostTank > 1 ? 1 : 0, c.throttleUp = 1;
      } else if (dist > 1300) c.boost = j.boostTank > 2 ? 1 : 0, c.throttleUp = 1;
      else if (dist < 360 && angleOff < 30 * BF.DEG) c.brake = 0.6;

      // Guns and missiles
      // One weapon at a time, like the player: guns up close, heat-seekers at range.
      if (tgt && mode === 'attack') {
        const W = sim.cfg.weapons;
        const gunsSolution = angleOff < A.fireCone * BF.DEG && dist < 900;
        // Keep heat-seekers up while hunting; swap to guns only for a close, clean shot.
        const closeGuns = dist < 750 && angleOff < 12 * BF.DEG;
        const lockInProgress = j.weapon === 'missile' && j.lock.targetId != null;
        const stayGuns = j.weapon === 'cannon' && dist < 1100 && angleOff < 30 * BF.DEG; // hysteresis
        const want = A.useMissiles !== false && j.missiles > 0 && ((!closeGuns && !stayGuns) || lockInProgress) ? 'missile' : 'cannon';
        if (want !== j.weapon && sim.t - (this.lastSwitch || -9) > 1.5) { c.selectWeapon = want; this.lastSwitch = sim.t; }
        if (j.weapon === 'cannon' && gunsSolution) c.fire = true;
        if (j.weapon === 'missile' && j.lock.locked && dist < W.missileLockRange * 0.95) {
          this.missileDelay += dt;
          if (this.missileDelay > 0.4 + sim.rand() * 0.6 && !j.prevFire) { c.fire = true; this.missileDelay = 0; }
        } else this.missileDelay = 0;
      }
    }

    // Classic "roll the target onto the lift vector, then pull".
    steer(c, dir, urgent) {
      const j = this.jet;
      inv.copy(j.quat).invert();
      local.copy(dir).applyQuaternion(inv);
      const lx = local.x, ly = local.y, lz = -local.z;
      const off = Math.acos(BF.clamp(lz, -1, 1));
      const rollErr = Math.atan2(lx, ly); // 0 = target straight "up" in canopy
      if (off < 8 * BF.DEG && !urgent) {
        // Fine tracking: small pitch/yaw, gently level wings
        c.pitch = BF.clamp(ly * 9, -1, 1);
        c.yaw = BF.clamp(lx * 9, -1, 1);
        c.roll = BF.clamp(rollErr * 0.3 * (ly > 0 ? 1 : 0), -1, 1);
      } else {
        c.roll = BF.clamp(rollErr * 2.2, -1, 1);
        const aligned = Math.max(0, 1 - Math.abs(rollErr) / (70 * BF.DEG));
        c.pitch = BF.clamp(aligned * (off > 20 * BF.DEG ? 1 : off / (20 * BF.DEG)), 0, 1);
        c.yaw = BF.clamp(lx * 2, -1, 1) * 0.3;
      }
    }
  };
})();
