// Authoritative game simulation. Pure state + fixed-step update driven only by
// per-jet Controls. No rendering, DOM or audio here, so this file can later run
// on a Node server for multiplayer. Renderer/audio read `sim.events` each frame.
window.BF = window.BF || {};

(() => {
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0), AZ = new V3(0, 0, 1);
  const tmpQ = new Q(), tmpV = new V3(), tmpV2 = new V3(), tmpV3 = new V3();

  BF.forwardOf = (q, out = new V3()) => out.set(0, 0, -1).applyQuaternion(q);
  BF.upOf = (q, out = new V3()) => out.set(0, 1, 0).applyQuaternion(q);
  BF.rightOf = (q, out = new V3()) => out.set(1, 0, 0).applyQuaternion(q);

  class Jet {
    constructor(id, team, name, isAI) {
      Object.assign(this, { id, team, name, isAI });
      this.pos = new V3(); this.quat = new Q(); this.vel = new V3();
      this.speed = 345; this.rates = { p: 0, r: 0, y: 0 };
      this.alive = false; this.respawnT = 0; this.kills = 0; this.deaths = 0;
      this.ctl = BF.emptyControls();
    }
  }

  BF.Sim = class {
    constructor(cfg, seed = 1337) {
      this.cfg = cfg; this.t = 0; this.rand = BF.rng(seed);
      this.terrain = BF.makeTerrain(seed, cfg.world);
      this.jets = []; this.missiles = []; this.flares = []; this.bullets = [];
      this.events = []; this.nextId = 1;
    }

    addJet(team, name, isAI) {
      const j = new Jet(this.nextId++, team, name, isAI);
      this.jets.push(j); this.spawn(j); return j;
    }
    jet(id) { return this.jets.find((j) => j.id === id); }

    spawn(j) {
      const c = this.cfg, half = this.terrain.half, r = this.rand;
      // Spawn on the team's side, heading toward the middle.
      const side = j.team === 0 ? 1 : -1;
      j.pos.set((r() - 0.5) * half * 0.8, 0, side * half * 0.62 + (r() - 0.5) * 600);
      j.pos.y = Math.max(this.terrain.height(j.pos.x, j.pos.z) + 350, 650);
      const yaw = Math.atan2(-j.pos.x, -j.pos.z) + Math.PI + (r() - 0.5) * 0.4;
      j.quat.setFromAxisAngle(AY, yaw);
      j.speed = c.flight.cruiseSpeed; j.rates = { p: 0, r: 0, y: 0 };
      j.health = c.jet.health; j.alive = true; j.lastDamageT = -99; j.lastAttacker = null;
      j.boostTank = c.flight.boostSeconds; j.boostIdleT = 0; j.brakeEff = 0;
      j.cannonHeat = 0; j.cannonCd = 0; j.overheated = false;
      j.missiles = c.weapons.missileCount; j.missileReloadT = 0;
      j.lock = { targetId: null, t: 0, locked: false };
      j.counterReadyT = this.t; j.ecmUntil = -1; j.ecmPuffT = 0;
      j.oobT = 0; j.spawnT = this.t;
      j.loadout = j.loadout || 'flares';
      j.weapon = 'cannon'; j.prevFire = false;
      BF.forwardOf(j.quat, j.vel).multiplyScalar(j.speed * BF.KMH * (c.flight.groundSpeedScale || 1));
      this.events.push({ type: 'spawn', jet: j.id });
    }

    step(dt) {
      this.t += dt;
      for (const j of this.jets) {
        if (!j.alive) {
          j.respawnT -= dt;
          if (j.respawnT <= 0) this.spawn(j);
          continue;
        }
        this.flight(j, dt);
        this.weapons(j, dt);
        this.countermeasures(j, dt);
      }
      this.updateLocks(dt);
      this.updateBullets(dt);
      this.updateMissiles(dt);
      this.updateFlares(dt);
      this.checkJetCollisions();
    }

    // ---------------- Flight model ----------------
    flight(j, dt) {
      const F = this.cfg.flight, c = j.ctl;
      // Throttle: spring-loaded to cruise.
      let target = F.cruiseSpeed, rate = F.springRate;
      j.boosting = false;
      // Brake and afterburner strength depend on pitch: brake blends toward
      // brakeRateDive as the nose points down, afterburner toward boostRateClimb as it
      // points up. That lets brake be strong in level flight without owning dives,
      // and afterburner fight gravity in a climb without being huge on the level.
      const fy = BF.forwardOf(j.quat, tmpV).y, climbK = Math.max(0, fy), diveK = Math.max(0, -fy);
      // ...and brake strength scales smoothly with speed, like airbrake drag:
      // (speed / 313)^brakeSpeedExp. It's 1.0 at 313, so the balance there is unchanged. It
      // bites harder when fast and fades when slow, with no kink or cliff anywhere.
      const brakeSpeedK = Math.pow(Math.max(j.speed, 60) / (F.brakeRefSpeed ?? 313), F.brakeSpeedExp ?? 2);
      const brakeRate = BF.lerp(F.brakeRate, F.brakeRateDive ?? F.brakeRate, Math.pow(diveK, F.brakeDiveCurve ?? 1)) * brakeSpeedK;
      // Brake effort eases in and out (~0.12 s) instead of switching on and off
      // instantly, so tapping or feathering S doesn't jolt the speed.
      j.brakeEff = BF.approach(j.brakeEff || 0, c.brake > 0.05 ? c.brake : 0, (F.brakeRamp ?? 8) * dt);
      const boostRate = BF.lerp(F.boostRate, F.boostRateClimb ?? F.boostRate, climbK);
      if (j.brakeEff > 0.02) { target = F.brakeSpeed; rate = brakeRate * j.brakeEff; }
      // Afterburner is a modifier on throttle-up (BF3-style): it only lights while
      // throttle-up is also held. Tank, flames and audio all follow j.boosting.
      else if (c.boost && c.throttleUp > 0.05 && j.boostTank > 0) {
        target = F.boostSpeed; rate = boostRate; j.boosting = true;
        j.boostTank = Math.max(0, j.boostTank - dt); j.boostIdleT = 0;
      } else if (c.throttleUp > 0.05) {
        target = F.throttleUpSpeed; rate = j.speed < target ? F.throttleUpRate * c.throttleUp : F.springRate;
      }
      // Above the ceiling the engines choke: no throttle-up or afterburner (applies to
      // every jet, AI included).
      const ceiling = this.cfg.world.ceiling || 3000, over = j.pos.y - ceiling;
      if (over > 0) { j.boosting = false; target = Math.min(target, j.speed); }
      if (!j.boosting) {
        j.boostIdleT += dt;
        if (j.boostIdleT > F.boostRechargeDelay) j.boostTank = Math.min(F.boostSeconds, j.boostTank + F.boostRecharge * dt);
      }
      j.speed = BF.approach(j.speed, target, rate * dt);
      const fwd = BF.forwardOf(j.quat, tmpV);
      j.speed -= F.gravitySpeed * fwd.y * dt;                  // climbing bleeds, diving gains
      j.speed -= F.turnBleed * Math.abs(j.rates.p) / 60 * dt;  // hard pulls bleed energy
      j.speed = BF.clamp(j.speed, F.minSpeed, F.maxSpeed);

      // Rotation rates chase stick input.
      const stall = BF.clamp((F.stallSpeed - j.speed) / F.stallSpeed, 0, 1);
      const rollMul = BF.lerp(1, F.rollAtLowSpeed, BF.clamp((F.cruiseSpeed - j.speed) / (F.cruiseSpeed - F.stallSpeed), 0, 1));
      const want = {
        p: c.pitch * BF.curve(F.pitchCurve, j.speed),
        r: c.roll * F.rollRate * rollMul,
        y: c.yaw * F.yawRate,
      };
      for (const k of ['p', 'r', 'y']) j.rates[k] = BF.damp(j.rates[k], want[k], F.controlResponse, dt);
      j.pitchRateMax = BF.curve(F.pitchCurve, j.speed);

      // Apply local rotations: +X pitch up, -Y yaw right, -Z roll right.
      tmpQ.setFromAxisAngle(AX, j.rates.p * BF.DEG * dt); j.quat.multiply(tmpQ);
      tmpQ.setFromAxisAngle(AY, -j.rates.y * BF.DEG * dt); j.quat.multiply(tmpQ);
      tmpQ.setFromAxisAngle(AZ, -j.rates.r * BF.DEG * dt); j.quat.multiply(tmpQ);

      // Stall: nose falls toward the ground.
      if (stall > 0) {
        BF.forwardOf(j.quat, fwd);
        const axis = tmpV2.crossVectors(fwd, tmpV3.set(0, -1, 0));
        if (axis.lengthSq() > 1e-6) {
          axis.normalize();
          tmpQ.setFromAxisAngle(axis, stall * 70 * BF.DEG * dt);
          j.quat.premultiply(tmpQ);
        }
      }
      // Ceiling: nose is pushed over, harder the further above it you are.
      const ceilK = BF.clamp(over / 150, 0, 1);
      if (ceilK > 0) {
        BF.forwardOf(j.quat, fwd);
        const axis = tmpV2.crossVectors(fwd, tmpV3.set(0, -1, 0));
        if (axis.lengthSq() > 1e-6) { axis.normalize(); tmpQ.setFromAxisAngle(axis, ceilK * 55 * BF.DEG * dt); j.quat.premultiply(tmpQ); }
      }
      j.quat.normalize();
      j.stalling = stall > 0;

      BF.forwardOf(j.quat, fwd);
      // groundSpeedScale: how fast the jet moves over the world per HUD speed unit.
      // Energy tuning (all in HUD units/s) and turn rates (deg/s) are unaffected.
      j.vel.copy(fwd).multiplyScalar(j.speed * BF.KMH * (F.groundSpeedScale || 1));
      j.pos.addScaledVector(j.vel, dt);
      if (stall > 0) j.pos.y -= stall * 25 * dt;

      // Terrain + boundary
      const ground = this.terrain.height(j.pos.x, j.pos.z);
      j.altitude = j.pos.y - ground;
      if (j.altitude < F.groundClearance) return this.kill(j, null, 'crash');
      const bld = this.terrain.buildingAt(j.pos.x, j.pos.z, 4);
      if (bld && j.pos.y < bld.top + 2) return this.kill(j, null, 'building');
      const half = this.terrain.half, edge = Math.max(Math.abs(j.pos.x), Math.abs(j.pos.z));
      j.nearBoundary = edge > half - this.cfg.world.boundaryWarn;
      if (edge > half) {
        j.oobT += dt;
        if (j.oobT > this.cfg.world.outOfBoundsTime) return this.kill(j, null, 'boundary');
      } else j.oobT = 0;
      // Ceiling drag + hard cap 200 m above it (HUD warns)
      j.aboveCeiling = j.pos.y > ceiling;
      if (j.aboveCeiling) j.speed -= 20 * dt;
      if (j.pos.y > ceiling + 200) { j.pos.y = ceiling + 200; j.speed -= 40 * dt; }

      // Repair
      if (this.t - j.lastDamageT > this.cfg.jet.regenDelay) j.health = Math.min(this.cfg.jet.health, j.health + this.cfg.jet.regenRate * dt);
    }

    // ---------------- Weapons ----------------
    weapons(j, dt) {
      const W = this.cfg.weapons, c = j.ctl;
      // Weapon selection: one weapon active at a time (BF3-style)
      const prevWeapon = j.weapon;
      if (c.selectWeapon) j.weapon = c.selectWeapon;
      else if (c.switchWeapon) j.weapon = j.weapon === 'cannon' ? 'missile' : 'cannon';
      if (j.weapon !== prevWeapon) {
        j.lock.targetId = null; j.lock.t = 0; j.lock.locked = false;
        this.events.push({ type: 'weaponSwitch', jet: j.id, weapon: j.weapon });
      }
      const firePressed = c.fire && !j.prevFire; j.prevFire = c.fire;
      j.cannonCd -= dt;
      j.cannonHeat = Math.max(0, j.cannonHeat - W.cannonCool * dt);
      if (j.overheated && j.cannonHeat < 0.35) j.overheated = false;
      j.firing = false;
      if (c.fire && j.weapon === 'cannon' && !j.overheated) {
        j.firing = true;
        while (j.cannonCd <= 0) {
          j.cannonCd += 1 / W.cannonRps;
          this.fireRound(j);
          j.cannonHeat += W.cannonHeat;
          if (j.cannonHeat >= 1) { j.overheated = true; this.events.push({ type: 'overheat', jet: j.id }); break; }
        }
      } else if (j.cannonCd < 0) j.cannonCd = 0;

      // Missile reload + launch
      if (j.missiles < W.missileCount) {
        j.missileReloadT += dt;
        if (j.missileReloadT >= W.missileReload) { j.missiles++; j.missileReloadT = 0; }
      }
      if (firePressed && j.weapon === 'missile' && j.missiles > 0) {
        j.missiles--;
        const fwd = BF.forwardOf(j.quat, new V3());
        const m = {
          id: this.nextId++, owner: j.id, target: j.lock.locked ? j.lock.targetId : null,
          pos: j.pos.clone().addScaledVector(BF.upOf(j.quat, tmpV), -1.5), dir: fwd,
          speed: j.vel.length(), life: W.missileLife, armed: 0.25,
        };
        this.missiles.push(m);
        this.events.push({ type: 'missileLaunch', jet: j.id, missile: m.id, target: m.target });
      }
    }

    fireRound(j) {
      const W = this.cfg.weapons, r = this.rand;
      const fwd = BF.forwardOf(j.quat, new V3());
      const s = W.cannonSpread * BF.DEG;
      const dir = fwd.clone()
        .addScaledVector(BF.rightOf(j.quat, tmpV), (r() - 0.5) * 2 * s)
        .addScaledVector(BF.upOf(j.quat, tmpV2), (r() - 0.5) * 2 * s).normalize();
      const pos = j.pos.clone().addScaledVector(fwd, 8);
      const vel = dir.multiplyScalar(W.cannonSpeed).add(j.vel);
      this.bullets.push({ owner: j.id, team: j.team, pos, vel, life: W.cannonRange / W.cannonSpeed });
      this.events.push({ type: 'shot', jet: j.id });
    }

    updateBullets(dt) {
      const W = this.cfg.weapons, R2 = W.hitRadius * W.hitRadius;
      const seg = new V3(), toC = new V3();
      this.bullets = this.bullets.filter((b) => {
        b.life -= dt;
        seg.copy(b.vel).multiplyScalar(dt);
        const len2 = seg.lengthSq();
        for (const j of this.jets) {
          if (!j.alive || j.team === b.team) continue;
          // Segment-sphere test (jet moved this tick; test against its current pos)
          toC.subVectors(j.pos, b.pos);
          const t = BF.clamp(toC.dot(seg) / len2, 0, 1);
          const dx = b.pos.x + seg.x * t - j.pos.x, dy = b.pos.y + seg.y * t - j.pos.y, dz = b.pos.z + seg.z * t - j.pos.z;
          if (dx * dx + dy * dy + dz * dz < R2) {
            this.damage(j, W.cannonDamage, b.owner, 'cannon');
            this.events.push({ type: 'hit', jet: j.id, by: b.owner, pos: j.pos.clone(), kind: 'cannon' });
            return false;
          }
        }
        b.pos.add(seg);
        if (b.pos.y < this.terrain.obstacleHeight(b.pos.x, b.pos.z)) {
          this.events.push({ type: 'impact', pos: b.pos.clone() });
          return false;
        }
        return b.life > 0;
      });
    }

    // Lock-on: target must stay inside the cone for missileLockTime.
    updateLocks(dt) {
      const W = this.cfg.weapons, cosCone = Math.cos(W.missileLockCone * BF.DEG);
      for (const j of this.jets) {
        if (!j.alive) continue;
        // Lock-on only runs with heat-seekers selected
        if (j.weapon !== 'missile') { j.lock.targetId = null; j.lock.t = 0; j.lock.locked = false; continue; }
        const fwd = BF.forwardOf(j.quat, tmpV);
        let best = null, bestScore = -1;
        for (const o of this.jets) {
          if (o === j || !o.alive || o.team === j.team || this.t < o.ecmUntil) continue;
          tmpV2.subVectors(o.pos, j.pos);
          const d = tmpV2.length();
          if (d > W.missileLockRange || d < 40) continue;
          const cos = tmpV2.dot(fwd) / d;
          if (cos < cosCone) continue;
          const score = cos - d / W.missileLockRange * 0.05 + (o.id === j.lock.targetId ? 0.05 : 0);
          if (score > bestScore) { bestScore = score; best = o; }
        }
        const L = j.lock;
        if (!best) { L.targetId = null; L.t = 0; L.locked = false; continue; }
        if (best.id !== L.targetId) { L.targetId = best.id; L.t = 0; L.locked = false; }
        L.t += dt;
        if (!L.locked && L.t >= W.missileLockTime) { L.locked = true; this.events.push({ type: 'locked', jet: j.id, target: best.id }); }
      }
    }

    breakLocksOn(j) {
      for (const o of this.jets) if (o.lock.targetId === j.id) { o.lock.targetId = null; o.lock.t = 0; o.lock.locked = false; }
    }

    updateMissiles(dt) {
      const W = this.cfg.weapons, turn = W.missileTurnRate * BF.DEG * dt;
      const desired = new V3(), tv = new V3();
      this.missiles = this.missiles.filter((m) => {
        m.life -= dt; m.armed -= dt;
        m.speed = BF.approach(m.speed, W.missileSpeed, 270 * dt);
        let tgtPos = null, tgtVel = null;
        if (typeof m.target === 'number') {
          const t = this.jet(m.target);
          if (!t || !t.alive || this.t < t.ecmUntil) {
            m.target = null; this.events.push({ type: 'missileLost', missile: m.id });
            // Jammed missiles go stupid and wander off
            m.dir.x += (this.rand() - 0.5) * 0.35; m.dir.y += (this.rand() - 0.5) * 0.35; m.dir.normalize();
          }
          else { tgtPos = t.pos; tgtVel = t.vel; }
        } else if (m.target && m.target.flare) {
          const f = m.target.flare; if (f.life > 0) { tgtPos = f.pos; tgtVel = f.vel; } else m.target = null;
        }
        if (tgtPos) {
          const d = tv.subVectors(tgtPos, m.pos).length();
          const tgo = d / Math.max(m.speed, 1);
          desired.copy(tgtPos).addScaledVector(tgtVel, tgo * 0.7).sub(m.pos).normalize();
          const ang = m.dir.angleTo(desired);
          if (ang > 1e-4) {
            const axis = tv.crossVectors(m.dir, desired).normalize();
            m.dir.applyAxisAngle(axis, Math.min(ang, turn)).normalize();
          }
        }
        m.pos.addScaledVector(m.dir, m.speed * dt);
        // Proximity fuse vs any enemy jet
        if (m.armed <= 0) {
          const owner = this.jet(m.owner);
          for (const j of this.jets) {
            if (!j.alive || j.id === m.owner || (owner && owner.team === j.team)) continue;
            if (j.pos.distanceTo(m.pos) < W.missileProximity) {
              this.damage(j, W.missileDamage, m.owner, 'missile');
              this.events.push({ type: 'explode', pos: m.pos.clone(), size: 1, missile: m.id });
              return false;
            }
          }
        }
        if (m.target && m.target.flare && m.pos.distanceTo(m.target.flare.pos) < 8) {
          this.events.push({ type: 'explode', pos: m.pos.clone(), size: 0.6, missile: m.id }); return false;
        }
        if (m.pos.y < this.terrain.obstacleHeight(m.pos.x, m.pos.z) || m.life <= 0) {
          this.events.push({ type: 'explode', pos: m.pos.clone(), size: 0.7, missile: m.id }); return false;
        }
        return true;
      });
    }

    // ---------------- Countermeasures ----------------
    countermeasures(j, dt) {
      const C = this.cfg.countermeasures;
      if (j.ctl.counter && this.t >= j.counterReadyT) {
        if (j.loadout === 'ecm') {
          j.ecmUntil = this.t + C.ecmDuration; j.counterReadyT = this.t + (j.ecmCooldown ?? C.ecmCooldown); j.ecmPuffT = 0;
          this.breakLocksOn(j);
          this.events.push({ type: 'ecm', jet: j.id });
        } else {
          j.counterReadyT = this.t + C.flareCooldown;
          const fl = [];
          const up = BF.upOf(j.quat, new V3()), right = BF.rightOf(j.quat, new V3());
          for (let i = 0; i < C.flareCount; i++) {
            const side = i % 2 ? 1 : -1, r = this.rand;
            const vel = j.vel.clone().multiplyScalar(0.35)
              .addScaledVector(right, side * (18 + r() * 14)).addScaledVector(up, -8 - r() * 10);
            const f = { id: this.nextId++, owner: j.id, pos: j.pos.clone(), vel, life: C.flareBurn + r() * 0.8, delay: i * 0.08 };
            this.flares.push(f); fl.push(f);
          }
          // Every missile chasing this jet goes for a flare.
          for (const m of this.missiles) if (m.target === j.id) { m.target = { flare: fl[(this.rand() * fl.length) | 0] }; this.events.push({ type: 'missileDecoyed', missile: m.id }); }
          this.breakLocksOn(j);
          this.events.push({ type: 'flares', jet: j.id });
        }
      }
      if (this.t < j.ecmUntil) {
        j.ecmPuffT -= dt;
        if (j.ecmPuffT <= 0) { j.ecmPuffT = 0.12; this.events.push({ type: 'ecmPuff', pos: j.pos.clone(), vel: j.vel.clone() }); }
      }
    }

    updateFlares(dt) {
      this.flares = this.flares.filter((f) => {
        if (f.delay > 0) { f.delay -= dt; const o = this.jet(f.owner); if (o) f.pos.copy(o.pos); return true; }
        f.life -= dt; f.vel.y -= 9.8 * dt; f.vel.multiplyScalar(1 - 0.6 * dt);
        f.pos.addScaledVector(f.vel, dt);
        return f.life > 0;
      });
    }

    checkJetCollisions() {
      for (let a = 0; a < this.jets.length; a++) for (let b = a + 1; b < this.jets.length; b++) {
        const A = this.jets[a], B = this.jets[b];
        if (A.alive && B.alive && A.pos.distanceToSquared(B.pos) < 16) { this.kill(A, B.id, 'collision'); this.kill(B, A.id, 'collision'); }
      }
    }

    // ---------------- Damage ----------------
    damage(j, amt, byId, kind) {
      if (!j.alive) return;
      if (this.t - j.spawnT < 2) return; // brief spawn protection
      j.health -= amt; j.lastDamageT = this.t; j.lastAttacker = byId;
      if (j.health <= 0) this.kill(j, byId, kind);
    }

    kill(j, byId, how) {
      if (!j.alive) return;
      // Crashes after recent damage credit the attacker (BF-style)
      if (byId == null && j.lastAttacker != null && this.t - j.lastDamageT < 8) byId = j.lastAttacker;
      j.alive = false; j.health = 0; j.deaths++; j.respawnT = this.cfg.jet.respawnDelay;
      const killer = byId != null ? this.jet(byId) : null;
      if (killer && killer !== j) killer.kills++;
      this.breakLocksOn(j);
      for (const m of this.missiles) if (m.target === j.id) m.target = null;
      this.events.push({ type: 'kill', jet: j.id, by: byId, how, pos: j.pos.clone(), vel: j.vel.clone() });
    }

    // Snapshot for HUD / future networking.
    threatsTo(j) {
      const incoming = this.missiles.filter((m) => m.target === j.id);
      const lockers = this.jets.filter((o) => o.alive && o.lock.targetId === j.id);
      return {
        incoming, nearestMissile: incoming.reduce((d, m) => Math.min(d, m.pos.distanceTo(j.pos)), Infinity),
        lockedBy: lockers.some((o) => o.lock.locked), lockingBy: lockers.length > 0,
      };
    }
  };
})();
