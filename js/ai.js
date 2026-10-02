// AI pilots produce Controls exactly like a human would, so they fly with the
// same flight model (including riding the 313 turn speed).
window.BF = window.BF || {};

(() => {
  const V3 = THREE.Vector3;
  const inv = new THREE.Quaternion(), local = new V3(), desired = new V3(), tmp = new V3();
  const losV = new V3(), aimV = new V3(), rgtV = new V3(), closV = new V3();

  // Difficulty presets. "medium" is exactly the AI as it was before difficulty existed.
  //   evadeRange: missile distance at which they start evading
  //   flareRange: furthest a missile can be when they pop flares/ECM
  //   breakTurn:  how hard they turn away from a missile (0 = keeps attacking, 1 = full break)
  //   sloppy:     chance of zoning out on speed control for a few seconds at a time
  //   speedMode:  'bang' = brake/boost at the band edges; 'pd' = feathers toward 313 and
  //               anticipates climbs/dives (hard)
  //   defensive:  breaks when someone behind is getting a lock, before any missile is fired
  BF.AI_LEVELS = {
    // Target practice: never shoots or pops countermeasures, cruises between waypoints, and
    // when chased only makes wide, gentle turns (bank <= 35 deg, light pull). See updatePassive().
    passive:  { aimError: 0, fireCone: 0, skill: 0.5, reactionTime: 9, flareChance: 0, evadeRange: 0, flareRange: 0, breakTurn: 0, sloppy: 0, speedMode: 'bang', defensive: false, passive: true },
    veryEasy: { aimError: 4.0, fireCone: 2.5, skill: 0.2, reactionTime: 1.3, flareChance: 0.35, evadeRange: 450, flareRange: 350, breakTurn: 0, sloppy: 0.5, speedMode: 'bang', defensive: false },
    // easy (v0.1.52): same behaviours, but softer hands: stick capped at 60 % and the
    // control inputs lag ~0.35 s behind what it wants, so turns are wider and later
    easy:     { aimError: 3.0, fireCone: 3.0, skill: 0.5, reactionTime: 1.0, flareChance: 0.6, evadeRange: 750, flareRange: 550, breakTurn: 0.6, sloppy: 0.2, speedMode: 'bang', defensive: false, stickMax: 0.6, ctlLag: 0.35 },
    medium:   { aimError: 1.6, fireCone: 3.5, skill: 0.8, reactionTime: 0.45, flareChance: 0.8, evadeRange: 1000, flareRange: 650, breakTurn: 1, sloppy: 0, speedMode: 'bang', defensive: false },
    hard:     { aimError: 1.3, fireCone: 3.7, skill: 0.9, reactionTime: 0.32, flareChance: 0.88, evadeRange: 1150, flareRange: 650, breakTurn: 1, speedMode: 'pd', pdNoise: 14, pdDeadband: 3, pdLead: 0.5, sloppy: 0.28, smartBreak: true, defensive: false, bfm: true, burst: true, lagK: 0.9, maxLag: 1.0, overDist: 230, overClosure: 22 },
    // extreme (v0.1.52): hunts the human players first and never lets up (afterburner to
    // close, quicker missile shots, earlier gun), sharper tracking, and a guns-defence
    // jink with reversals when someone has it in their gunsight
    extreme:  { aimError: 0.7, fireCone: 4.5, skill: 0.95, reactionTime: 0.18, flareChance: 0.97, evadeRange: 1400, flareRange: 700, breakTurn: 1, sloppy: 0, speedMode: 'pd', pdNoise: 6, pdDeadband: 1.5, pdLead: 0.8, smartBreak: true, defensive: true, bfm: true, burst: true, lagK: 1.2, maxLag: 1.4, overDist: 280, overClosure: 15, huntPlayer: true, aggressive: true, sharpTrack: true, gunsDefense: true },
  };
  BF.applyAiDifficulty = (cfg, level) => {
    const p = BF.AI_LEVELS[level] || BF.AI_LEVELS.medium;
    // Clear every level-specific key first, so options from a previous level (e.g. bfm,
    // passive) don't leak into one that doesn't set them
    for (const L of Object.values(BF.AI_LEVELS)) for (const k of Object.keys(L)) delete cfg.ai[k];
    Object.assign(cfg.ai, p, { difficulty: BF.AI_LEVELS[level] ? level : 'medium' });
  };

  BF.AIPilot = class {
    constructor(sim, jet) {
      this.sim = sim; this.jet = jet; this.targetId = null; this.retargetT = 0;
      this.noise = new V3(); this.noiseT = 0; this.reactT = 0; this.missileDelay = 0;
      this.jinkT = 0; this.jinkDir = 1;
      this.prevLos = new V3(); this.prevLosSet = false; this.losRate = 0;
      this.entrySide = null; this.overT = 0; this.overCd = 0; this.heatHold = false;
    }

    pickTarget() {
      const j = this.jet; let best = null, bestD = Infinity;
      for (const o of this.sim.jets) {
        if (!o.alive || o.team === j.team) continue;
        let d = o.pos.distanceTo(j.pos);
        if (this.sim.t < o.ecmUntil && d > 1000) continue; // jamming: off their radar beyond visual range
        if (o.lock.targetId === j.id) d *= 0.6; // go after whoever is on us
        if (o.id === this.targetId) d *= 0.8;   // stickiness
        if (this.sim.cfg.ai.huntPlayer && !o.isAI) d *= 0.35; // very hard: goes for the humans
        if (d < bestD) { bestD = d; best = o; }
      }
      this.targetId = best ? best.id : null;
    }

    update(dt) {
      const j = this.jet, sim = this.sim, A = sim.cfg.ai, c = BF.emptyControls();
      j.ctl = c;
      if (!j.alive) return;
      if (A.passive) { this.updatePassive(dt, c); return; }
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
        if (A.bfm) {
          if (this.entrySide == null) this.entrySide = sim.rand() < 0.5 ? -1 : 1;
          losV.subVectors(tgt.pos, j.pos).normalize();
          this.losRate = BF.damp(this.losRate || 0, this.prevLosSet ? losV.angleTo(this.prevLos) / Math.max(dt, 1e-3) : 0, 6, dt);
          this.prevLos.copy(losV); this.prevLosSet = true;
          const tgtFwd = BF.forwardOf(tgt.quat, closV);
          const aspect = tgtFwd.dot(losV); // +1: target flying away from us; -1: head-on
          const closure = tmp.subVectors(j.vel, tgt.vel).dot(losV);
          aimV.copy(tgt.pos);
          if (aspect < -0.2 && dist > 1400 && dist < 4200) {
            aimV.addScaledVector(BF.rightOf(tgt.quat, rgtV), this.entrySide * BF.clamp(dist * 0.3, 150, 650));
          } else if (dist < 400) this.entrySide = sim.rand() < 0.5 ? -1 : 1;
          const lagT = BF.clamp(this.losRate * (A.lagK ?? 1), 0, A.maxLag ?? 1.2);
          aimV.addScaledVector(tgt.vel, lead - lagT);
          desired.subVectors(aimV, j.pos).normalize().add(this.noise).normalize();
          angleOff = fwd.angleTo(desired);
          mode = 'attack';
          if (this.overCd > 0) this.overCd -= dt;
          if (this.overT > 0) this.overT -= dt;
          else if (this.overCd <= 0 && dist < (A.overDist ?? 260) && aspect > 0.5 && closure > (A.overClosure ?? 10)) { this.overT = 1.0; this.overCd = 3; }
          if (this.overT > 0) {
            desired.copy(fwd).multiplyScalar(0.4).addScaledVector(BF.upOf(j.quat, rgtV), 1).normalize();
            angleOff = fwd.angleTo(desired);
            mode = 'overshoot';
          }
        } else {
          desired.copy(tgt.pos).addScaledVector(tgt.vel, dist < 1400 ? lead : 0).sub(j.pos).normalize().add(this.noise).normalize();
          angleOff = fwd.angleTo(desired);
          mode = 'attack';
        }
      } else { this.prevLosSet = false; this.losRate = 0; this.overT = 0; this.overCd = 0; }

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

      // Very hard: guns defence. Someone within 1 km behind with us in their gunsight:
      // hard out-of-plane jink with a reversal every ~1 s (spoils the tracking solution,
      // and the reversal often turns the tables)
      if (A.gunsDefense && mode !== 'evade') {
        for (const o of sim.jets) {
          if (!o.alive || o.team === j.team) continue;
          tmp.subVectors(j.pos, o.pos); const d = tmp.length();
          if (d > 1000 || tmp.dot(fwd) < 0) continue;                       // must be behind us
          if (BF.forwardOf(o.quat, aimV).dot(tmp.normalize()) < Math.cos(9 * BF.DEG)) continue; // not in their sight
          this.gdT = (this.gdT ?? 0) - dt;
          if (this.gdT <= 0) { this.gdDir = -(this.gdDir || 1); this.gdT = 0.8 + sim.rand() * 0.5; }
          desired.copy(BF.rightOf(j.quat, rgtV)).multiplyScalar(this.gdDir).addScaledVector(BF.upOf(j.quat, closV), 0.6).addScaledVector(fwd, 0.3).normalize();
          mode = 'evade'; break;
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
      // Easy: softer hands. Stick authority capped and inputs lag behind (not when pulling
      // up from the ground; that stays crisp so it doesn't fly into hills)
      if (mode !== 'pullup' && (A.stickMax || A.ctlLag)) {
        const m = A.stickMax || 1;
        c.pitch = BF.clamp(c.pitch, -m, m); c.roll = BF.clamp(c.roll, -m, m); c.yaw = BF.clamp(c.yaw, -m, m);
        if (A.ctlLag) {
          const pc = this.prevCtl || (this.prevCtl = { pitch: 0, roll: 0, yaw: 0 }), k = 1 - Math.exp(-dt / A.ctlLag);
          for (const key of ['pitch', 'roll', 'yaw']) { pc[key] += (c[key] - pc[key]) * k; c[key] = pc[key]; }
        }
      } else if (this.prevCtl) { this.prevCtl.pitch = c.pitch; this.prevCtl.roll = c.roll; this.prevCtl.yaw = c.yaw; }

      // Speed discipline: ride 313 in turn fights
      const s = j.speed, turning = angleOff > 20 * BF.DEG || mode === 'evade';
      // Sloppy pilots zone out on speed control for a few seconds at a time
      this.lapseT = (this.lapseT ?? 0) - dt;
      if (this.lapseT <= 0) { this.lapsing = sim.rand() < (A.sloppy || 0); this.lapseT = this.lapsing ? 2 + sim.rand() * 2 : 3; }
      // Hard: speed derivative (smoothed) for the anticipating controller
      if (this.prevSpeed != null) this.dvF = BF.damp(this.dvF || 0, (s - this.prevSpeed) / Math.max(dt, 1e-3), 8, dt);
      this.prevSpeed = s;
      if (mode === 'pullup') { c.throttleUp = 1; if (s < 300) c.boost = 1; }
      else if (A.aggressive && mode === 'attack' && dist > 1200 && angleOff < 35 * BF.DEG) { c.throttleUp = 1; if (j.boostTank > 1) c.boost = 1; } // very hard: burner in to close
      else if (this.overT > 0) c.brake = 0.8;
      else if (this.lapsing) { /* not managing speed right now */ }
      else if ((turning || (A.bfm && mode === 'attack' && dist < 1600)) && A.speedMode === 'pd') {
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
        const gunsSolution = angleOff < A.fireCone * BF.DEG && dist < (A.aggressive ? 1000 : 900);
        // Keep heat-seekers up while hunting; swap to guns only for a close, clean shot.
        const closeGuns = dist < 750 && angleOff < 12 * BF.DEG;
        const lockInProgress = j.weapon === 'missile' && j.lock.targetId != null;
        const stayGuns = j.weapon === 'cannon' && dist < 1100 && angleOff < 30 * BF.DEG; // hysteresis
        const want = A.useMissiles !== false && j.missiles > 0 && ((!closeGuns && !stayGuns) || lockInProgress) ? 'missile' : 'cannon';
        if (want !== j.weapon && sim.t - (this.lastSwitch || -9) > 1.5) { c.selectWeapon = want; this.lastSwitch = sim.t; }
        if (j.weapon === 'cannon' && gunsSolution) {
          if (A.burst) {
            if (j.cannonHeat > 0.55) this.heatHold = true;
            else if (j.cannonHeat < 0.15) this.heatHold = false;
            if (!this.heatHold) c.fire = true;
          } else c.fire = true;
        }
        if (j.weapon === 'missile' && j.lock.locked && dist < W.missileLockRange * 0.95) {
          this.missileDelay += dt;
          const wait = A.aggressive ? 0.12 + sim.rand() * 0.2 : 0.4 + sim.rand() * 0.6;
          if (this.missileDelay > wait && !j.prevFire) { c.fire = true; this.missileDelay = 0; }
        } else this.missileDelay = 0;
      }
    }

    // Target-practice pilot: wanders between waypoints at a lazy cruise. When someone is on
    // its tail it just starts a wide, gentle turn one way and holds it. Bank is capped at
    // 35 deg and the pull is light, so it can't out-turn anybody. Ground and boundary
    // avoidance still apply (so it doesn't fly into hills).
    updatePassive(dt, c) {
      const j = this.jet, sim = this.sim, fwd = BF.forwardOf(j.quat, new V3());
      const right = BF.rightOf(j.quat, new V3()), up = BF.upOf(j.quat, new V3());
      const half = sim.cfg.world.size / 2;
      // waypoints
      this.wpT = (this.wpT ?? 0) - dt;
      if (!this.wp || this.wpT <= 0 || Math.hypot(this.wp.x - j.pos.x, this.wp.z - j.pos.z) < 600) {
        this.wp = new V3((sim.rand() - 0.5) * half * 1.3, 600 + sim.rand() * 600, (sim.rand() - 0.5) * half * 1.3);
        this.wpT = 25 + sim.rand() * 15;
      }
      desired.subVectors(this.wp, j.pos); desired.y = BF.clamp(desired.y / Math.max(400, Math.hypot(desired.x, desired.z)), -0.2, 0.2) * Math.hypot(desired.x, desired.z); desired.normalize();
      // chased? (an enemy within 1.5 km in our rear hemisphere)
      let chased = false;
      for (const o of sim.jets) {
        if (!o.alive || o.team === j.team) continue;
        tmp.subVectors(o.pos, j.pos);
        if (tmp.length() < 1500 && tmp.normalize().dot(fwd) < -0.3) { chased = true; break; }
      }
      if (chased) {
        if (!this.wasChased) this.turnDir = sim.rand() < 0.5 ? -1 : 1;
        desired.copy(fwd).addScaledVector(right, 0.6 * this.turnDir); desired.y = 0; desired.normalize();
        desired.y = BF.clamp((800 - j.pos.y) / 2000, -0.15, 0.15); desired.normalize();
      }
      this.wasChased = chased;
      // Near the edge of the combat area it turns back properly (dying to the boundary
      // would just be silly); everywhere else the turns stay wide.
      if (j.nearBoundary) {
        desired.set(-j.pos.x, 0, -j.pos.z).normalize(); desired.y = BF.clamp((800 - j.pos.y) / 1500, -0.2, 0.2); desired.normalize();
        this.steer(c, desired, false); if (j.speed < 280) c.throttleUp = 1;
        return;
      }
      // terrain / rooftops ahead: normal steering, pull up hard
      let clearAhead = Infinity;
      for (const lt of [0.8, 1.6, 2.6]) {
        tmp.copy(j.pos).addScaledVector(j.vel, lt);
        clearAhead = Math.min(clearAhead, tmp.y - sim.terrain.obstacleHeight(tmp.x, tmp.z, 20));
      }
      if (j.altitude < 160 || clearAhead < 140 || (fwd.y < -0.3 && j.altitude < 450)) {
        desired.set(fwd.x, 0, fwd.z).normalize(); desired.y = 0.8; desired.normalize();
        this.steer(c, desired, true); c.throttleUp = 1;
        return;
      }
      // Gentle steering: aim at most 25 deg off the nose (a lazy target for the normal
      // steering), then cap the pull and the bank so the turn stays wide
      const off = fwd.angleTo(desired), maxOff = 25 * BF.DEG;
      if (off > maxOff) { tmp.crossVectors(fwd, desired).normalize(); desired.copy(fwd).applyAxisAngle(tmp, maxOff); }
      this.steer(c, desired, false);
      c.pitch = BF.clamp(c.pitch, -0.2, 0.3);
      if (fwd.y > desired.y + 0.04) c.pitch = Math.min(c.pitch, 0.04); // don't climb away in the banked turn
      c.yaw *= 0.4;
      const bank = Math.atan2(-right.y, up.y), cap = 35 * BF.DEG;
      if (Math.abs(bank) > cap) c.roll = BF.clamp(-(bank - Math.sign(bank) * cap) * 2.5, -0.6, 0.6);
      else c.roll = BF.clamp(c.roll, -0.5, 0.5);
      // lazy cruise speed, never the 313 turn band
      if (j.speed < 280) c.throttleUp = 1;
      else if (j.speed > 340) c.brake = 0.3;
    }

    // Classic "roll the target onto the lift vector, then pull".
    steer(c, dir, urgent) {
      const j = this.jet;
      inv.copy(j.quat).invert();
      local.copy(dir).applyQuaternion(inv);
      const lx = local.x, ly = local.y, lz = -local.z;
      const off = Math.acos(BF.clamp(lz, -1, 1));
      const rollErr = Math.atan2(lx, ly); // 0 = target straight "up" in canopy
      const sharp = this.sim.cfg.ai.sharpTrack, fine = sharp ? 6 : 8, g = sharp ? 13 : 9;
      if (off < fine * BF.DEG && !urgent) {
        // Fine tracking: small pitch/yaw, gently level wings
        c.pitch = BF.clamp(ly * g, -1, 1);
        c.yaw = BF.clamp(lx * g, -1, 1);
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
