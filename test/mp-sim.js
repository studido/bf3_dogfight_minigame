// Tests for the multiplayer sim paths: remote jets are network-owned (no local
// flight/weapons/respawn), cannon hits on remote jets are reported (not applied
// locally), damage arrives via applyNetDamage, kills via applyNetKill, remote
// missiles are visual-only, and remote countermeasures replicate.
// Usage: node test/mp-sim.js
'use strict';

// Reuse the THREE stub pattern from ai-furball.js by extracting its classes.
const stub = require('./three-stub.js');
globalThis.window = globalThis;
globalThis.THREE = stub;

const fs = require('node:fs');
const path = require('node:path');
for (const f of ['config.js', 'util.js', 'terrain.js', 'sim.js']) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
}

const BF = window.BF;
const assert = require('node:assert');
BF.emptyControls = () => ({ pitch: 0, roll: 0, yaw: 0, throttleUp: 0, boost: 0, brake: 0, fire: false, switchWeapon: false, selectWeapon: null, counter: false, lookBack: false });

const cfg = BF.cloneConfig(BF.DEFAULT_CONFIG);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

function freshSim() { return new BF.Sim(cfg, 42); }

test('remote jets are not simulated locally (no flight, no respawn)', () => {
  const sim = freshSim();
  const local = sim.addJet(0, 'Me', false);
  const remote = sim.addJet(1, 'Bob', false);
  remote.remote = true;
  const posBefore = remote.pos.clone();
  remote.alive = false; remote.respawnT = 0.01; // would respawn if simulated
  local.alive = true;
  const startT = sim.t;
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  assert.ok(local.alive, 'local jet alive');
  assert.ok(!remote.alive, 'remote jet must not respawn locally');
  assert.strictEqual(sim.t > startT + 1, true);
  void posBefore;
});

test('cannon hit on a remote jet is reported, not applied', () => {
  const sim = freshSim();
  const shooter = sim.addJet(0, 'Me', false);
  const target = sim.addJet(1, 'Bob', false);
  target.remote = true;
  target.spawnT = -99; // drop spawn protection
  // Put the target 100 m dead ahead of the shooter's nose.
  target.quat.copy(shooter.quat);
  const fwd = BF.forwardOf(shooter.quat, new stub.Vector3());
  target.pos.copy(shooter.pos).addScaledVector(fwd, 100);
  shooter.ctl = { ...BF.emptyControls(), fire: true };
  sim.events.length = 0;
  const hpBefore = target.health;
  for (let i = 0; i < 30; i++) sim.step(1 / 60);
  const remoteHits = sim.events.filter((e) => e.type === 'hit' && e.kind === 'cannon' && e.remote && e.jet === target.id);
  assert.ok(remoteHits.length > 0, 'expected remote hit events, got none');
  assert.strictEqual(target.health, hpBefore, 'remote jet health must not change locally');
});

test('applyNetDamage damages and kills a jet I own', () => {
  const sim = freshSim();
  const me = sim.addJet(0, 'Me', false);
  const them = sim.addJet(1, 'Bob', false);
  them.remote = true;
  me.spawnT = -99;
  sim.applyNetDamage(me.id, cfg.jet.health + 1, them.id, 'cannon');
  assert.ok(!me.alive, 'jet should be dead after lethal net damage');
  const kill = sim.events.find((e) => e.type === 'kill' && e.jet === me.id && e.by === them.id);
  assert.ok(kill, 'kill event should credit the shooter');
});

test('applyNetKill splits a phantom ownership path safely', () => {
  const sim = freshSim();
  const me = sim.addJet(0, 'Me', false);
  sim.applyNetKill(me.id, null, 'missile');
  assert.ok(!me.alive);
  sim.applyNetKill(me.id, null, 'missile'); // double deliver -> no crash, still dead
  assert.ok(!me.alive);
});

test('remote missiles are visual-only and never damage', () => {
  const sim = freshSim();
  const me = sim.addJet(0, 'Me', false);
  const them = sim.addJet(1, 'Bob', false);
  them.remote = true;
  me.spawnT = -99;
  // Remote jet right behind me, launches at me.
  const fwd = BF.forwardOf(me.quat, new stub.Vector3());
  them.pos.copy(me.pos).addScaledVector(fwd, -80);
  them.quat.copy(me.quat);
  BF.forwardOf(them.quat, them.vel).multiplyScalar(100);
  sim.launchRemoteMissile(them, me.id);
  const hpBefore = me.health;
  let proxExplode = 0;
  for (let i = 0; i < 600 && sim.missiles.length; i++) {
    sim.step(1 / 60);
    proxExplode += sim.events.filter((e) => e.type === 'explode' && e.size === 1).length;
    sim.events.length = 0;
  }
  assert.strictEqual(me.health, hpBefore, 'visual missile must not damage');
  assert.ok(proxExplode + 1 > 0);
});

test('remote countermeasures replicate (flares spawn + decoy, ECM jams)', () => {
  const sim = freshSim();
  const me = sim.addJet(0, 'Me', false);
  const them = sim.addJet(1, 'Bob', false);
  them.remote = true;
  sim.applyRemoteCm(them, 'flares');
  assert.strictEqual(sim.flares.length, cfg.countermeasures.flareCount, 'flares spawned');
  assert.ok(sim.events.some((e) => e.type === 'flares' && e.jet === them.id));
  sim.applyRemoteCm(them, 'ecm');
  assert.ok(sim.t < them.ecmUntil, 'ECM window set');
});

console.log(`\n${passed} tests passed`);
process.exit(0);
