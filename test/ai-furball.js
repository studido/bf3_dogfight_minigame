// Headless AI furball test. Runs the real sim + AI in Node with a minimal
// THREE math stub (Vector3/Quaternion only) and reports combat metrics per
// difficulty. Usage: node test/ai-furball.js [seconds] [level ...]
'use strict';
const fs = require('fs');
const path = require('path');

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  distanceToSquared(v) { const dx = v.x - this.x, dy = v.y - this.y, dz = v.z - this.z; return dx * dx + dy * dy + dz * dz; }
  cross(v) { return this.crossVectors(this, v); }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx;
    return this;
  }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  angleTo(v) {
    const d = this.length() * v.length();
    if (d < 1e-9) return Math.PI / 2;
    const c = this.dot(v) / d;
    return Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
  }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  applyAxisAngle(axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
    const ax = axis.x, ay = axis.y, az = axis.z;
    const x = this.x, y = this.y, z = this.z;
    const d = ax * x + ay * y + az * z;
    const cx = ay * z - az * y, cy = az * x - ax * z, cz = ax * y - ay * x;
    this.x = x * c + cx * s + ax * d * k;
    this.y = y * c + cy * s + ay * d * k;
    this.z = z * c + cz * s + az * d * k;
    return this;
  }
  applyQuaternion(q) {
    const { x, y, z } = this, { x: qx, y: qy, z: qz, w: qw } = q;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
}

class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  setFromAxisAngle(axis, angle) {
    const h = angle / 2, s = Math.sin(h);
    this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s; this.w = Math.cos(h);
    return this;
  }
  static mul(a, b, out) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    out.x = ax * bw + aw * bx + ay * bz - az * by;
    out.y = ay * bw + aw * by + az * bx - ax * bz;
    out.z = az * bw + aw * bz + ax * by - ay * bx;
    out.w = aw * bw - ax * bx - ay * by - az * bz;
    return out;
  }
  multiply(q) { return Q.mul(this, q, this); }
  premultiply(q) { return Q.mul(q, this, this); }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= l; this.y /= l; this.z /= l; this.w /= l; return this;
  }
  invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
}

globalThis.window = globalThis;
globalThis.THREE = { Vector3: V3, Quaternion: Q };

for (const f of ['config.js', 'util.js', 'terrain.js', 'sim.js', 'ai.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  (0, eval)(code);
}

const BF = window.BF;
BF.emptyControls = () => ({ pitch: 0, roll: 0, yaw: 0, throttleUp: 0, boost: 0, brake: 0, fire: false, switchWeapon: false, selectWeapon: null, counter: false, lookBack: false });

const seconds = +process.argv[2] || 180;
const levels = process.argv.slice(3).length ? process.argv.slice(3) : ['medium', 'hard', 'extreme'];
const DT = 1 / 60;

function run(level, seed) {
  const cfg = BF.cloneConfig(BF.DEFAULT_CONFIG);
  BF.applyAiDifficulty(cfg, level);
  const sim = new BF.Sim(cfg, seed);
  const pilots = [];
  for (let i = 0; i < 3; i++) pilots.push(new BF.AIPilot(sim, sim.addJet(1, 'E' + i, true)));
  pilots.push(new BF.AIPilot(sim, sim.addJet(0, 'P', true)));

  const stats = {
    deaths: {}, cannonHits: 0, missileHits: 0, overshoots: 0,
    fireTicks: 0, spdSamples: 0, spdErr: 0,
    kills: 0, merges: 0, gunSolTicks: 0, engageTicks: 0, aliveTicks: 0,
  };
  const prevOver = pilots.map(() => 0);
  const steps = Math.round(seconds / DT);
  const fwd = new V3(), toT = new V3();

  for (let step = 0; step < steps; step++) {
    pilots.forEach((p, i) => {
      const wasOver = prevOver[i];
      p.update(DT);
      if (p.overT > 0 && wasOver <= 0 && p.jet.alive) stats.overshoots++;
      prevOver[i] = p.overT;
      if (!p.jet.alive) return;
      const j = p.jet;
      stats.aliveTicks++;
      if (j.ctl.fire) stats.fireTicks++;
      if (p.targetId != null) {
        const tgt = sim.jet(p.targetId);
        if (tgt && tgt.alive) {
          toT.subVectors(tgt.pos, j.pos);
          const d = toT.length();
          if (d < 2600) stats.engageTicks++;
          if (d < 900 && BF.forwardOf(j.quat, fwd).angleTo(toT.normalize()) < cfg.ai.fireCone * BF.DEG) stats.gunSolTicks++;
        }
      }
    });
    sim.step(DT);
    for (const e of sim.events) {
      if (e.type === 'hit' && e.kind === 'cannon') stats.cannonHits++;
      if (e.type === 'kill') {
        stats.deaths[e.how] = (stats.deaths[e.how] || 0) + 1;
        stats.kills++;
      }
    }
    sim.events.length = 0;
    // sample speed discipline + merge geometry once per second
    if (step % 60 === 0) {
      for (const p of pilots) {
        const j = p.jet;
        if (!j.alive || p.targetId == null) continue;
        const tgt = sim.jet(p.targetId);
        if (!tgt) continue;
        toT.subVectors(tgt.pos, j.pos);
        const d = toT.length();
        BF.forwardOf(j.quat, fwd);
        const off = fwd.angleTo(toT.normalize());
        if (off > 20 * BF.DEG) { stats.spdSamples++; stats.spdErr += Math.abs(j.speed - 313); }
        if (d < 60) stats.merges++;
      }
    }
  }
  return { stats };
}

let anyFail = false;
for (const level of levels) {
  try {
    const { stats } = run(level, +(process.env.SEED || 1337));
    const hitsPerMin = (stats.cannonHits / (seconds / 60)).toFixed(1);
    const spdErr = stats.spdSamples ? (stats.spdErr / stats.spdSamples).toFixed(1) : '-';
    const gunPct = (100 * stats.gunSolTicks / Math.max(1, stats.aliveTicks)).toFixed(1);
    const engPct = (100 * stats.engageTicks / Math.max(1, stats.aliveTicks)).toFixed(1);
    console.log(`${level}: deaths ${JSON.stringify(stats.deaths)} | cannonHits ${stats.cannonHits} (${hitsPerMin}/min) | gunTime ${gunPct}% | engaged<2.6km ${engPct}% | overshoots ${stats.overshoots} | nearMiss<60m ${stats.merges} | avg|speed-313| ${spdErr} | fireTicks ${stats.fireTicks}`);
    if (!Number.isFinite(stats.cannonHits)) anyFail = true;
  } catch (e) {
    anyFail = true;
    console.error(`${level}: CRASHED`, e.stack);
  }
}
process.exit(anyFail ? 1 : 0);
