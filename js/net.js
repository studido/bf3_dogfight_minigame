// Multiplayer client: talks to the relay server (see relay repo PROTOCOL.md).
// Handles connect/reconnect with resume, room create/join, and gives main.js a
// tiny event API. All game messages are plain JSON.
window.BF = window.BF || {};

(() => {
  const LS = 'bf3dog.net.';
  const RECONNECT_BASE_MS = 500, RECONNECT_MAX_MS = 8000;

  BF.NET_DEFAULT_URL = 'wss://bf3-dogfight-relay.fly.dev';

  // Interpolation timestamp for an incoming 30 Hz snapshot of jet j arriving at time
  // `at` (s). Samples are spread at the sender's cadence (WebSocket often delivers two
  // at once then nothing), but the stamp also catches back up to real time after a
  // burst. Otherwise one network hiccup would add its delay to that jet for good. It
  // bleeds off up to 4 ms per packet, snaps if more than 0.1 s ahead, and stays monotonic.
  BF.netStamp = (j, at, hz) => {
    let sat = Math.max(at, j.netNextAt || 0);
    const ahead = sat - at;
    if (ahead > 0.1) sat = at;
    const b = j.netBuf, lastAt = b && b.length ? b[b.length - 1].at : -Infinity;
    sat = Math.max(sat, lastAt + 0.001);
    j.netNextAt = sat + 1 / hz - Math.min(Math.max(0, ahead), 0.004);
    return sat;
  };

  // Outbound game events are batched into the next state message. Cannon hits on the
  // same victim by the same shooter merge into one entry with summed damage.
  BF.queueNetEvent = (queue, e) => {
    if (e.kind === 'hit') {
      const same = queue.find((q) => q.kind === 'hit' && q.jetSlot === e.jetSlot && q.bySlot === e.bySlot && q.w === e.w);
      if (same) { same.dmg += e.dmg; return queue; }
    }
    queue.push(e);
    return queue;
  };

  BF.Net = class {
    constructor() {
      this.url = localStorage.getItem(LS + 'url') || BF.NET_DEFAULT_URL;
      this.ws = null;
      this.handlers = {};            // t -> [fn]
      this.room = null;              // { code, id, token, hostId, players, started, seed }
      this.wantConnection = false;
      this.backoff = RECONNECT_BASE_MS;
      this.reconnectT = null;
    }

    get myId() { return this.room ? this.room.id : null; }
    get isHost() { return !!(this.room && this.room.hostId === this.room.id); }
    get connected() { return !!(this.ws && this.ws.readyState === 1); }

    on(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); return this; }
    emit(t, m) { for (const fn of this.handlers[t] || []) fn(m); }

    setUrl(url) {
      this.url = url;
      localStorage.setItem(LS + 'url', url);
    }

    // Open the socket and keep it open. safe to call repeatedly.
    connect() {
      if (this.connected) return Promise.resolve();
      // Still connecting: wait for that socket instead of pretending we're open (a
      // create/join sent now would be silently dropped).
      if (this.ws && this.ws.readyState === 0 && this.connecting) return this.connecting;
      this.wantConnection = true;
      this.connecting = new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.onopen = () => {
          if (this.ws !== ws) return; // superseded by a newer socket
          settled = true;
          this.backoff = RECONNECT_BASE_MS;
          // resume a room if we were in one (server gives a ~1 min grace)
          const saved = this._savedSession();
          if (saved) this.send({ t: 'resume', code: saved.code, id: saved.id, token: saved.token });
          this.emit('open', {});
          resolve();
        };
        ws.onmessage = (e) => { if (this.ws !== ws) return; let m; try { m = JSON.parse(e.data); } catch { return; } this._onMessage(m); };
        ws.onclose = (e) => {
          if (!settled) { settled = true; reject(new Error('could not reach server')); }
          // A late close from an old socket must not clobber the live one.
          if (this.ws !== ws) return;
          this.ws = null;
          this.connecting = null;
          if (e && e.code === 4001) {
            // 'replaced': this same session was resumed from somewhere else (another tab
            // or window). Reconnecting would steal it back and start a tug-of-war.
            this.wantConnection = false;
            this.room = null;
            this.emit('replaced', {});
            this.emit('close', {});
            return;
          }
          this.emit('close', {});
          this._scheduleReconnect();
        };
        ws.onerror = () => { /* onclose follows */ };
      });
      return this.connecting;
    }

    disconnect() {
      this.wantConnection = false;
      clearTimeout(this.reconnectT);
      this.leave();
      if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
    }

    _scheduleReconnect() {
      if (!this.wantConnection || this.reconnectT) return;
      this.reconnectT = setTimeout(() => {
        this.reconnectT = null;
        this.backoff = Math.min(RECONNECT_MAX_MS, this.backoff * 2);
        this.connect().catch(() => { /* retry cycle handles itself */ });
      }, this.backoff);
      this.emit('reconnectWait', { ms: this.backoff });
    }

    send(m) { if (this.connected) this.ws.send(JSON.stringify(m)); }

    create(name) {
      this._forgetSession(); // explicit user action: never auto-resume an old room
      this.connect().then(() => this.send({ t: 'create', name }))
        .catch(() => this.emit('error', { t: 'error', code: 'connect', msg: 'could not reach server' }));
    }
    join(code, name) {
      this._forgetSession();
      this.connect().then(() => this.send({ t: 'join', code: code.toUpperCase(), name }))
        .catch(() => this.emit('error', { t: 'error', code: 'connect', msg: 'could not reach server' }));
    }
    leave() { if (this.room) { this.send({ t: 'leave' }); this._clearRoom(); } }
    setSettings(d) { this.send({ t: 'settings', d }); }
    setReady(v) { this.send({ t: 'ready', v }); }
    setTeam(v) { this.send({ t: 'team', v }); }
    start(seed) { this.send({ t: 'start', seed }); }
    sendState(d) { this.send({ t: 'state', d }); }
    sendEvent(d) { this.send({ t: 'event', d }); }

    _onMessage(m) {
      switch (m.t) {
        case 'joined':
          this.room = {
            code: m.code, id: m.id, token: m.token, hostId: m.hostId,
            settings: m.settings, seed: m.seed, started: m.started, players: m.players,
          };
          this._saveSession();
          break;
        case 'roster':
          if (this.room) this.room.players = m.players;
          break;
        case 'settings':
          if (this.room) this.room.settings = m.d;
          break;
        case 'start':
          if (this.room) { this.room.seed = m.seed; this.room.started = true; }
          break;
        case 'ended':
          this._clearRoom();
          break;
        case 'error':
          if (m.code === 'badResume') this._forgetSession();
          break;
      }
      this.emit(m.t, m);
    }

    // The resumable session is stored per TAB (sessionStorage): two tabs in one browser
    // must not share an identity, or each reconnect would sever the other.
    _savedSession() {
      try {
        const s = JSON.parse(sessionStorage.getItem(LS + 'session') || 'null');
        return s && s.code && s.id && s.token ? s : null;
      } catch { return null; }
    }
    _saveSession() {
      try { sessionStorage.setItem(LS + 'session', JSON.stringify({ code: this.room.code, id: this.room.id, token: this.room.token })); } catch { /* ignore */ }
    }
    _forgetSession() { try { sessionStorage.removeItem(LS + 'session'); localStorage.removeItem(LS + 'session'); } catch { /* ignore */ } }
    _clearRoom() { this.room = null; this._forgetSession(); }
  };
})();
