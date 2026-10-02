// Audio (v0.1.46): recorded engine / afterburner / cannon layers + synthesised tones.
//
// Recordings (assets/sounds/sounds.js, base64 MP3 so file:// works; see README credits):
//  - engine:  F-15 cockpit drone loop. Pitch follows throttle and speed.
//  - howl:    F-4 J79 at power (exterior engine howl). Pitch/level follow throttle.
//  - ab:      F-4 afterburner roar loop, faded in while the afterburner is lit.
//  - abLight: the afterburner light-off thump, one-shot on ignition.
//  - gun:     real M61A2 burst. Attack, then a loop inside the burst while the trigger is
//             held, then the spin-down tail on release. Other jets' guns use the same
//             sound, quieter and duller with distance.
// Cockpit vs outside: inside, the cockpit drone dominates and the exterior layers are
// low-passed (heard through the airframe); outside, the howl and roar dominate.
// Loops are pre-crossfaded with padding (see the asset header), so they're seamless.
// Until the recordings decode (or if they're missing) the old synthesised engine and gun
// are used. Lock tones, warnings, explosions etc. stay synthesised.
window.BF = window.BF || {};

BF.Audio = class {
  constructor() { this.ok = false; this.volume = 0.6; this.buf = {}; this.samples = false; }

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
      // Synth engine (fallback): filtered noise + low saw
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
      // Exterior bus: everything heard "outside the airframe" (low-passed in the cockpit)
      this.extFilter = ctx.createBiquadFilter(); this.extFilter.type = 'lowpass'; this.extFilter.frequency.value = 18000; this.extFilter.Q.value = 0.5;
      this.extFilter.connect(this.master);
      this.ok = true;
      this.loadSamples();
    } catch (e) { console.warn('Audio unavailable', e); }
  }

  // Decode the recordings, then build the looping layers
  loadSamples() {
    const S = BF.ASSETS && BF.ASSETS.sounds;
    if (!S) return;
    const ctx = this.ctx, jobs = [];
    for (const [k, s] of Object.entries(S)) {
      const bytes = BF.b64bytes(s.data.slice(s.data.indexOf(',') + 1));
      jobs.push(new Promise((resolve) => {
        const ok = (b) => { this.buf[k] = { b, ...s, data: undefined }; resolve(); };
        try { const p = ctx.decodeAudioData(bytes.buffer, ok, () => resolve()); if (p && p.catch) p.catch(() => resolve()); } catch (e) { resolve(); }
      }));
    }
    Promise.all(jobs).then(() => {
      delete BF.ASSETS.sounds;
      const B = this.buf;
      if (!B.engine || !B.howl || !B.ab) return;
      const loop = (k, dest) => {
        const src = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = 0;
        src.buffer = B[k].b; src.loop = true; src.loopStart = B[k].loopStart; src.loopEnd = B[k].loopEnd;
        src.connect(g).connect(dest); src.start(0, B[k].loopStart + Math.random() * (B[k].loopEnd - B[k].loopStart));
        return { src, g };
      };
      this.L = { engine: loop('engine', this.master), howl: loop('howl', this.extFilter), ab: loop('ab', this.extFilter) };
      this.samples = true;
      this.engGain.gain.value = 0; this.whineGain.gain.value = 0;
    });
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

  // One-shot of a decoded recording (optionally a slice), through an optional filter
  play(k, { gain = 1, rate = 1, from = 0, dest = this.master, lowpass = 0 } = {}) {
    const B = this.buf[k]; if (!B) return null;
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = B.b; src.playbackRate.value = rate; g.gain.value = gain;
    let node = src;
    if (lowpass) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node.connect(f); node = f; }
    node.connect(g).connect(dest); src.start(c.currentTime, from);
    return { src, g };
  }

  // A held-trigger gun voice: attack + loop while firing, spin-down tail on release
  gunVoice(v, firing, gain, lowpass, rate) {
    const c = this.ctx, t = c.currentTime, B = this.buf.gun;
    if (!B) return;
    if (firing && !v.on) {
      const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lowpass;
      src.buffer = B.b; src.loop = true; src.loopStart = B.loopStart; src.loopEnd = B.loopEnd; src.playbackRate.value = rate;
      g.gain.value = gain; src.connect(f).connect(g).connect(this.master); src.start(t, 0.02);
      Object.assign(v, { on: true, src, g, f });
    } else if (!firing && v.on) {
      v.g.gain.setTargetAtTime(0, t, 0.025); v.src.stop(t + 0.2);
      this.play('gun', { gain: gain * 0.9, from: B.tail, lowpass, rate });
      v.on = false;
    } else if (v.on) {
      v.g.gain.setTargetAtTime(gain, t, 0.05); v.f.frequency.setTargetAtTime(lowpass, t, 0.05);
    }
  }

  // Called every frame with the local player's state.
  update(me, sim, cfg, camMode) {
    if (!this.ok || !me) return;
    const t = this.ctx.currentTime, alive = me.alive, inCockpit = camMode === 'cockpit' && alive;
    const sp = alive ? me.speed : 0, c = me.ctl;
    if (this.samples) {
      // Throttle state 0..1 (brake / cruise / mil / afterburner), smoothed like spool-up
      const thrT = !alive ? 0 : me.boosting ? 1 : c.brake > 0.05 ? 0.25 : c.throttleUp > 0.05 ? 0.8 : 0.55;
      this.thr = this.thr === undefined ? thrT : this.thr + (thrT - this.thr) * Math.min(1, (thrT > this.thr ? 2.2 : 1.4) / 60);
      const k = this.thr, spd = BF.clamp((sp - 313) / 900, -0.2, 0.25), L = this.L;
      L.engine.src.playbackRate.setTargetAtTime(0.86 + 0.24 * k + spd * 0.5, t, 0.08);
      L.howl.src.playbackRate.setTargetAtTime(0.82 + 0.3 * k + spd * 0.4, t, 0.08);
      const ab = alive && me.boosting ? 1 : 0;
      L.engine.g.gain.setTargetAtTime(!alive ? 0 : inCockpit ? 0.5 + 0.3 * k : 0.12 + 0.08 * k, t, 0.12);
      L.howl.g.gain.setTargetAtTime(!alive ? 0 : inCockpit ? 0.12 + 0.25 * k : 0.3 + 0.45 * k, t, 0.12);
      L.ab.g.gain.setTargetAtTime(ab * (inCockpit ? 0.55 : 0.85), t, ab ? 0.12 : 0.35);
      this.extFilter.frequency.setTargetAtTime(inCockpit ? 1400 : 18000, t, 0.1);
      // Afterburner light-off thump (not on every flicker)
      if (ab && !this.abWas && t - (this.abLitAt || -9) > 1.2) {
        this.play('abLight', { gain: inCockpit ? 0.5 : 0.8, dest: this.extFilter }); this.abLitAt = t;
      }
      this.abWas = ab;
    } else {
      this.engFilter.frequency.setTargetAtTime(300 + sp * 2.2 + (me.boosting ? 1800 : 0), t, 0.1);
      this.engGain.gain.setTargetAtTime(alive ? 0.10 + (me.boosting ? 0.14 : 0) + (c.throttleUp ? 0.03 : 0) : 0, t, 0.15);
      this.whine.frequency.setTargetAtTime(90 + sp * 0.35 + (c.brake ? -20 : 0), t, 0.2);
      this.whineGain.gain.setTargetAtTime(alive ? 0.035 : 0, t, 0.2);
    }

    // Guns: our own (held trigger) and the nearest other jet that's firing
    if (this.buf.gun) {
      this.myGun = this.myGun || {}; this.otherGun = this.otherGun || {};
      const mine = alive && t - (this.myShotAt || -9) < 0.09;
      this.gunVoice(this.myGun, mine, inCockpit ? 0.75 : 0.9, inCockpit ? 5000 : 16000, 1);
      const o = this.otherShot, theirs = !!o && t - o.at < 0.12;
      const a = o ? BF.clamp(1 - o.d / 2200, 0, 1) ** 2 : 0;
      this.gunVoice(this.otherGun, theirs && a > 0.01, 0.8 * a, 600 + 9000 * a, 1);
    }

    // Lock tone: pulsing while acquiring, solid when locked (heat-seeker growl)
    const Lk = me.lock; let tg = 0;
    if (alive && Lk.targetId != null && me.missiles > 0) {
      if (Lk.locked) { this.tone.frequency.setTargetAtTime(1320, t, 0.01); tg = 0.06; }
      else {
        const kk = Lk.t / cfg.weapons.missileLockTime, rate = 3 + kk * 9;
        this.tone.frequency.setTargetAtTime(900 + kk * 250, t, 0.01);
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

  event(ev, me, camPos, sim) {
    if (!this.ok || !me) return;
    const dist = (p) => (p ? p.distanceTo(camPos) : 0);
    const att = (p) => BF.clamp(1 - dist(p) / 2500, 0, 1) ** 2;
    switch (ev.type) {
      case 'shot':
        if (ev.jet === me.id) {
          this.myShotAt = this.ctx.currentTime;
          if (!this.buf.gun) this.burst({ freq: 260, q: 0.8, dur: 0.03, gain: 0.22, decay: 0.05 });
        } else if (this.buf.gun && sim) {
          const j = sim.jets.find((x) => x.id === ev.jet), d = j ? dist(j.dispPos || j.pos) : 9e9;
          const o = this.otherShot;
          // follow the nearest firing jet
          if (!o || this.ctx.currentTime - o.at > 0.12 || d <= o.d || o.id === ev.jet) this.otherShot = { id: ev.jet, d, at: this.ctx.currentTime };
        }
        break;
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
