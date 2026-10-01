// Tests for the multiplayer client (js/net.js) and the v0.1.32 netcode fixes:
// interpolation stamps recover after a burst, events batch and merge, the session is
// per-tab, stale socket events are ignored, and a 4001 'replaced' close doesn't reconnect.
// Usage: node test/net-client.js
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert');
globalThis.window = globalThis;
const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage = mkStore();
globalThis.sessionStorage = mkStore();
const sockets = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; }
  _open() { this.readyState = 1; this.onopen && this.onopen(); }
  _close(code = 1006) { this.readyState = 3; this.onclose && this.onclose({ code }); }
  _msg(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
}
globalThis.WebSocket = FakeWS;
const timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
globalThis.clearTimeout = () => {};
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', 'net.js'), 'utf8'));
const BF = window.BF;
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

(async () => {
  await test('interp stamp: one 300 ms stall no longer delays a jet permanently', () => {
    const j = { netBuf: [] }, NET = 1 / 30; let worst = 0, final = 0;
    for (let i = 0; i < 300; i++) {
      let at = i * NET; if (i >= 60 && i < 69) at = 69 * NET; // 9 packets held 0.3 s, then a burst
      const s = BF.netStamp(j, at, 30); j.netBuf.push({ at: s }); if (j.netBuf.length > 12) j.netBuf.shift();
      if (i > 69) worst = Math.max(worst, s - at);
      final = s - at;
    }
    assert.ok(final < 0.005, `stamp should converge back to real time, still ${final.toFixed(3)} s ahead`);
    assert.ok(worst <= 0.1, `never more than 0.1 s ahead after the burst (was ${worst.toFixed(3)})`);
  });

  await test('interp stamp: timeline stays monotonic, even spacing kept under normal jitter', () => {
    const j = { netBuf: [] }; let prev = -1;
    for (let i = 0; i < 200; i++) { const at = i / 30 + (i % 2 ? 0.012 : 0); const s = BF.netStamp(j, at, 30); assert.ok(s > prev); prev = s; j.netBuf.push({ at: s }); }
  });

  await test('events batch: cannon hits on the same victim by the same shooter merge', () => {
    const q = [];
    for (let i = 0; i < 18; i++) BF.queueNetEvent(q, { kind: 'hit', jetSlot: 1, bySlot: 0, dmg: 2.2, w: 'c' });
    BF.queueNetEvent(q, { kind: 'hit', jetSlot: 2, bySlot: 0, dmg: 2.2, w: 'c' });
    BF.queueNetEvent(q, { kind: 'hit', jetSlot: 1, bySlot: 0, dmg: 42, w: 'm' });
    BF.queueNetEvent(q, { kind: 'cm', jetSlot: 0, what: 'flares' });
    assert.strictEqual(q.length, 4);
    assert.ok(Math.abs(q[0].dmg - 18 * 2.2) < 1e-9);
  });

  const net = new BF.Net();
  await test('session is stored per tab (sessionStorage), not shared across tabs', () => {
    net.create('A'); sockets[0]._open();
    sockets[0]._msg({ t: 'joined', code: 'K7QX', id: 3, token: 'abc', hostId: 3, players: [] });
    assert.ok(sessionStorage.getItem('bf3dog.net.session'));
    assert.strictEqual(localStorage.getItem('bf3dog.net.session'), null);
  });

  await test('create while still connecting waits for the socket instead of dropping the message', async () => {
    const n2 = new BF.Net(); const before = sockets.length;
    const p1 = n2.connect(); n2.create('B'); // second call during CONNECTING
    assert.strictEqual(sockets.length, before + 1, 'must not open a second socket');
    sockets[before]._open(); await p1; await new Promise((r) => process.nextTick(r));
    assert.ok(sockets[before].sent.some((m) => m.t === 'create'), 'create should be sent once open');
  });

  await test("a late close from an old socket doesn't clobber the live one", () => {
    const n3 = new BF.Net(); const i0 = sockets.length;
    n3.connect(); const old = sockets[i0]; old._open();
    old._close(1006); // drop -> reconnect scheduled
    timers.pop().fn(); const fresh = sockets[sockets.length - 1]; fresh._open();
    assert.ok(n3.connected);
    old.onclose && old.onclose({ code: 1006 }); // stale duplicate close event
    assert.ok(n3.connected, 'live socket must survive a stale close');
    assert.strictEqual(n3.ws, fresh);
  });

  await test("4001 'replaced' close: no auto-reconnect, emits 'replaced'", () => {
    const n4 = new BF.Net(); const i0 = sockets.length; let replaced = false;
    n4.on('replaced', () => { replaced = true; });
    n4.connect(); sockets[i0]._open();
    const tBefore = timers.length;
    sockets[i0]._close(4001);
    assert.ok(replaced);
    assert.strictEqual(timers.length, tBefore, 'must not schedule a reconnect');
    assert.strictEqual(n4.wantConnection, false);
  });

  console.log(`\n${passed} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
