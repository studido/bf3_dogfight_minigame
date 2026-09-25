// Multiplayer client: talks to the relay server (see relay repo PROTOCOL.md).
// Handles connect/reconnect with resume, room create/join, and gives main.js a
// tiny event API. All game messages are plain JSON.
window.BF = window.BF || {};

(() => {
  const LS = 'bf3dog.net.';
  const RECONNECT_BASE_MS = 500, RECONNECT_MAX_MS = 8000;

  BF.NET_DEFAULT_URL = 'wss://bf3-dogfight-relay.fly.dev';

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
      if (this.connected || (this.ws && this.ws.readyState === 0)) return Promise.resolve();
      this.wantConnection = true;
      return new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.onopen = () => {
          settled = true;
          this.backoff = RECONNECT_BASE_MS;
          // resume a room if we were in one (server gives a ~1 min grace)
          const saved = this._savedSession();
          if (saved) this.send({ t: 'resume', code: saved.code, id: saved.id, token: saved.token });
          this.emit('open', {});
          resolve();
        };
        ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this._onMessage(m); };
        ws.onclose = () => {
          this.ws = null;
          this.emit('close', {});
          if (!settled) { settled = true; reject(new Error('could not reach server')); }
          this._scheduleReconnect();
        };
        ws.onerror = () => { /* onclose follows */ };
      });
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
      this.connect().then(() => this.send({ t: 'create', name }))
        .catch(() => this.emit('error', { t: 'error', code: 'connect', msg: 'could not reach server' }));
    }
    join(code, name) {
      this.connect().then(() => this.send({ t: 'join', code, name }))
        .catch(() => this.emit('error', { t: 'error', code: 'connect', msg: 'could not reach server' }));
    }
    leave() { if (this.room) { this.send({ t: 'leave' }); this._clearRoom(); } }
    setSettings(d) { this.send({ t: 'settings', d }); }
    setReady(v) { this.send({ t: 'ready', v }); }
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

    _savedSession() {
      try {
        const s = JSON.parse(localStorage.getItem(LS + 'session') || 'null');
        return s && s.code && s.id && s.token ? s : null;
      } catch { return null; }
    }
    _saveSession() {
      localStorage.setItem(LS + 'session', JSON.stringify({ code: this.room.code, id: this.room.id, token: this.room.token }));
    }
    _forgetSession() { localStorage.removeItem(LS + 'session'); }
    _clearRoom() { this.room = null; this._forgetSession(); }
  };
})();
