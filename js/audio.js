// Synthesised audio (no sound files): engine, cannon, lock tones, warnings, explosions.
window.BF = window.BF || {};

BF.Audio = class {
  constructor() { this.ok = false; this.volume = 0.6; }

  init() {
    if (this.ok) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
      // Shared noise buffer
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // Engine: filtered noise + low saw
      const en = ctx.createBufferSource(); en.buffer = buf; en.loop = true;
      this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
      en.connect(this.engFilter).connect(this.engGain).connect(this.master); en.start();
      this.whine = ctx.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 120;
      this.whineF = ctx.createBiquadFilter(); this.whineF.type = 'lowpass'; this.whineF.frequency.value = 900;
      this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
      this.whine.connect(this.whineF).connect(this.whineGain).connect(this.master); this.whine.start();
      // Tone generator for lock / warning
      this.tone = ctx.createOscillator(); this.tone.type = 'square'; this.tone.frequency.value = 1000;
      this.toneGain = ctx.createGain(); this.toneGain.gain.value = 0;
      this.tone.connect(this.toneGain).connect(this.master); this.tone.start();
      this.warn = ctx.createOscillator(); this.warn.type = 'triangle'; this.warn.frequency.value = 850;
      this.warnGain = ctx.createGain(); this.warnGain.gain.value = 0;
      this.warn.connect(this.warnGain).connect(this.master); this.warn.start();
      this.ok = true;
    } catch (e) { console.warn('Audio unavailable', e); }
  }

  setVolume(v) { this.volume = v; if (this.ok) this.master.gain.value = v; }
  suspend(p) { if (this.ok) p ? this.ctx.suspend() : this.ctx.resume(); }

  burst({ freq = 800, q = 1, type = 'bandpass', dur = 0.08, gain = 0.3, decay = 0.06, when = 0 }) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur + decay);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random() * 1.5); s.stop(t + dur + decay + 0.05);
  }

  // Called every frame with the local player's state.
  update(me, sim, cfg) {
    if (!this.ok || !me) return;
    const t = this.ctx.currentTime, alive = me.alive;
    const sp = alive ? me.speed : 0;
    this.engFilter.frequency.setTargetAtTime(300 + sp * 2.2 + (me.boosting ? 1800 : 0), t, 0.1);
    this.engGain.gain.setTargetAtTime(alive ? 0.10 + (me.boosting ? 0.14 : 0) + (me.ctl.throttleUp ? 0.03 : 0) : 0, t, 0.15);
    this.whine.frequency.setTargetAtTime(90 + sp * 0.35 + (me.ctl.brake ? -20 : 0), t, 0.2);
    this.whineGain.gain.setTargetAtTime(alive ? 0.035 : 0, t, 0.2);

    // Lock tone: pulsing while acquiring, solid when locked (heat-seeker growl)
    const L = me.lock; let tg = 0;
    if (alive && L.targetId != null && me.missiles > 0) {
      if (L.locked) { this.tone.frequency.setTargetAtTime(1320, t, 0.01); tg = 0.06; }
      else {
        const k = L.t / cfg.weapons.missileLockTime, rate = 3 + k * 9;
        this.tone.frequency.setTargetAtTime(900 + k * 250, t, 0.01);
        tg = (sim.t * rate) % 1 < 0.45 ? 0.05 : 0;
      }
    }
    this.toneGain.gain.setTargetAtTime(tg, t, 0.008);

    // Threat warnings
    const th = alive ? sim.threatsTo(me) : { incoming: [], lockedBy: false, lockingBy: false };
    let wg = 0;
    if (th.incoming.length) { this.warn.frequency.setTargetAtTime(1150, t, 0.01); wg = (sim.t * 10) % 1 < 0.5 ? 0.09 : 0; }
    else if (th.lockedBy) { this.warn.frequency.setTargetAtTime(950, t, 0.01); wg = (sim.t * 4) % 1 < 0.5 ? 0.07 : 0; }
    else if (th.lockingBy) { this.warn.frequency.setTargetAtTime(800, t, 0.01); wg = (sim.t * 2) % 1 < 0.3 ? 0.05 : 0; }
    this.warnGain.gain.setTargetAtTime(wg, t, 0.008);
  }

  event(ev, me, camPos) {
    if (!this.ok || !me) return;
    const dist = (p) => (p ? p.distanceTo(camPos) : 0);
    const att = (p) => BF.clamp(1 - dist(p) / 2500, 0, 1) ** 2;
    switch (ev.type) {
      case 'shot': if (ev.jet === me.id) this.burst({ freq: 260, q: 0.8, dur: 0.03, gain: 0.22, decay: 0.05 }); break;
      case 'hit': if (ev.by === me.id) this.burst({ freq: 2400, q: 6, dur: 0.02, gain: 0.25, decay: 0.03 });
        else if (ev.jet === me.id) this.burst({ freq: 700, q: 2, dur: 0.03, gain: 0.35, decay: 0.05 }); break;
      case 'explode': case 'kill': { const a = att(ev.pos) * (ev.type === 'kill' ? 1 : 0.7); if (a > 0.01) this.burst({ freq: 180, type: 'lowpass', dur: 0.3, gain: 0.8 * a, decay: 1.1 }); break; }
      case 'missileLaunch': if (ev.jet === me.id) this.burst({ freq: 1200, type: 'lowpass', dur: 0.6, gain: 0.35, decay: 0.8 }); break;
      case 'flares': case 'ecm': if (ev.jet === me.id) { for (let i = 0; i < 4; i++) this.burst({ freq: 3000, q: 1.5, dur: 0.05, gain: 0.18, decay: 0.12, when: i * 0.09 }); } break;
      case 'weaponSwitch': if (ev.jet === me.id) this.burst({ freq: 1800, q: 4, dur: 0.02, gain: 0.2, decay: 0.04 }); break;
      case 'overheat': if (ev.jet === me.id) this.burst({ freq: 4000, q: 8, dur: 0.15, gain: 0.12, decay: 0.2 }); break;
    }
  }
};
