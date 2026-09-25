// Canvas-2D HUD in the BF3 cyan style.
window.BF = window.BF || {};

(() => {
  const CY = '#7fe3ff', CYD = 'rgba(40,150,190,0.35)', RED = '#ff4a3a', ORG = '#ffb14a', GRN = '#8dff7a', GOLD = '#ffd84a';
  const V3 = THREE.Vector3, tmp = new V3();

  BF.HUD = class {
    constructor(canvas) {
      this.c = canvas; this.g = canvas.getContext('2d');
      this.feed = []; this.hitMarkerT = 0; this.damageFlash = 0; this.msgs = [];
    }
    resize(w, h, dpr) { this.c.width = w * dpr; this.c.height = h * dpr; this.c.style.width = w + 'px'; this.c.style.height = h + 'px'; this.w = w; this.h = h; this.dpr = dpr; }
    addFeed(text, color) { this.feed.unshift({ text, color, t: 6 }); this.feed.length = Math.min(this.feed.length, 6); }
    flashMsg(text, color = CY, t = 2) { this.msgs = [{ text, color, t }]; }

    project(pos, cam) {
      tmp.copy(pos).project(cam);
      if (tmp.z > 1 || tmp.z < -1) return null;
      return { x: (tmp.x * 0.5 + 0.5) * this.w, y: (-tmp.y * 0.5 + 0.5) * this.h };
    }

    panel(x, y, w, h) { const g = this.g; g.fillStyle = 'rgba(10,40,60,0.42)'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(127,227,255,0.35)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
    text(t, x, y, size = 14, color = CY, align = 'left', bold = true) {
      const g = this.g; g.font = `${bold ? '600 ' : ''}${size}px "Segoe UI", "Rajdhani", Arial, sans-serif`;
      g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = color;
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 3; g.fillText(t, x, y); g.shadowBlur = 0;
    }
    bar(x, y, w, h, frac, color) { const g = this.g; g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, w, h); g.fillStyle = color; g.fillRect(x, y, w * BF.clamp(frac, 0, 1), h); }

    draw(dt, S) {
      const { sim, me, cam, camMode, cfg, effects, paused } = S;
      const g = this.g, W = this.w, H = this.h;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      if (!me) return;

      // ECM lens smear (white bokeh blobs)
      if (effects.cameraInSmoke > 0.01) {
        const a = BF.clamp(effects.cameraInSmoke * 1.6, 0, 0.85);
        g.fillStyle = `rgba(240,236,248,${a * 0.45})`; g.fillRect(0, 0, W, H);
        const seed = [0.2, 0.7, 0.45, 0.85, 0.1, 0.6, 0.33, 0.92];
        for (let i = 0; i < 8; i++) {
          const x = seed[i] * W, y = seed[(i + 3) % 8] * H, r = 60 + seed[(i + 5) % 8] * 120;
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, `rgba(255,255,255,${a * 0.7})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        }
      }

      // Speed streaks + vignette when fast
      const fastK = me.alive ? BF.clamp((me.speed - 420) / 150, 0, 1) + (me.boosting ? 0.35 : 0) : 0;
      if (fastK > 0.02) {
        g.strokeStyle = `rgba(255,255,255,${0.10 * fastK})`; g.lineWidth = 1.5;
        for (let i = 0; i < 26; i++) {
          const a = (i * 2.399 + sim.t * 3.1) % (Math.PI * 2), r0 = Math.min(W, H) * (0.42 + ((i * 0.37 + sim.t * 1.7) % 0.4)), r1 = r0 + 60 + fastK * 90;
          g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); g.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); g.stroke();
        }
      }
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${0.35 + fastK * 0.25})`);
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
      if (this.damageFlash > 0) {
        const dg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
        dg.addColorStop(0, 'rgba(255,0,0,0)'); dg.addColorStop(1, `rgba(200,0,0,${this.damageFlash * 0.5})`);
        g.fillStyle = dg; g.fillRect(0, 0, W, H); this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
      }


      // Enemy / friendly markers + lock box
      for (const j of sim.jets) {
        if (j === me || !j.alive) continue;
        const p = this.project(tmp.copy(j.pos).add(new V3(0, 4, 0)), cam); if (!p) continue;
        const d = j.pos.distanceTo(me.pos), enemy = j.team !== me.team, col = enemy ? RED : '#6ab7ff';
        if (d > 5000) continue;
        g.save(); g.translate(p.x, p.y - 14); g.rotate(Math.PI / 4); g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(-5, -5, 10, 10);
        if (enemy) { g.fillStyle = col; g.fillRect(-2, -2, 4, 4); }
        g.restore();
        this.text(`${j.name}  ${Math.round(d)}m`, p.x, p.y - 30, 11, col, 'center');
        if (sim.t < j.ecmUntil && Math.floor(sim.t * 5) % 2 === 0) this.text('ECM', p.x, p.y - 44, 12, GOLD, 'center');
        if (me.lock.targetId === j.id && me.alive) {
          const k = BF.clamp(me.lock.t / cfg.weapons.missileLockTime, 0, 1);
          const sz = me.lock.locked ? 22 : 60 - k * 38;
          const blink = me.lock.locked || Math.floor(sim.t * 8) % 2 === 0;
          const p2 = this.project(j.pos, cam);
          if (p2 && blink) {
            g.strokeStyle = me.lock.locked ? RED : ORG; g.lineWidth = 2; g.strokeRect(p2.x - sz, p2.y - sz, sz * 2, sz * 2);
            if (me.lock.locked) this.text('LOCKED', p2.x, p2.y + sz + 12, 12, RED, 'center');
          }
        }
      }

      const cockpit = camMode === 'cockpit' && me.alive && S.combiner;
      if (cockpit) { this.f18Hud(me, sim, cfg, S.combiner, cam); this.warnings(me, sim, cfg); }
      else if (me.alive) {
        // Aim reticle: where the nose points, far ahead
        const aim = this.project(tmp.copy(me.pos).addScaledVector(BF.forwardOf(me.quat, new V3()), 600), cam);
        if (aim) {
          g.strokeStyle = me.overheated ? RED : CY; g.lineWidth = 1.5;
          g.beginPath(); g.arc(aim.x, aim.y, 14, 0, 7); g.stroke();
          g.beginPath(); g.moveTo(aim.x - 24, aim.y); g.lineTo(aim.x - 16, aim.y); g.moveTo(aim.x + 16, aim.y); g.lineTo(aim.x + 24, aim.y); g.moveTo(aim.x, aim.y + 16); g.lineTo(aim.x, aim.y + 22); g.stroke();
          if (this.hitMarkerT > 0) {
            g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
            for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { g.moveTo(aim.x + sx * 6, aim.y + sy * 6); g.lineTo(aim.x + sx * 12, aim.y + sy * 12); }
            g.stroke(); this.hitMarkerT -= dt;
          }
          const wl = me.weapon === 'missile' ? `MSL ×${me.missiles}` : me.overheated ? 'GUN HOT' : 'GUN';
          this.text(wl, aim.x + 30, aim.y + 14, 11, me.weapon === 'missile' && me.missiles === 0 ? ORG : 'rgba(127,227,255,0.85)');
        }
        this.flightBlock(me, cfg, sim);
        this.warnings(me, sim, cfg);
      }

      this.scorePanel(sim, me);
      this.radar(sim, me, cfg);
      this.vehiclePanel(me, sim, cfg);
      this.killFeed(dt);

      if (!me.alive) {
        this.text('YOU WERE KILLED', W / 2, H * 0.38, 30, RED, 'center');
        if (me.killedBy) this.text(me.killedBy, W / 2, H * 0.38 + 34, 16, '#fff', 'center');
        this.text(`Respawning in ${Math.max(0, me.respawnT).toFixed(1)}`, W / 2, H * 0.38 + 62, 14, CY, 'center');
      }
      for (const m of this.msgs) { this.text(m.text, W / 2, H * 0.22, 18, m.color, 'center'); m.t -= dt; }
      this.msgs = this.msgs.filter((m) => m.t > 0);
      if (paused) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H); }
    }

    flightBlock(me, cfg, sim) {
      const W = this.w, H = this.h, cx = W / 2, cy = H / 2 + 40, g = this.g;
      // Speed box (left of centre). Green inside 300-320, gold at 313 ±3.
      const s = Math.round(me.speed);
      const inBand = s >= 300 && s <= 320, sweet = Math.abs(s - 313) <= 3;
      const col = sweet ? GOLD : inBand ? GRN : s < 300 ? ORG : CY;
      const bx = cx - 230, by = cy - 26;
      this.panel(bx, by, 110, 52);
      this.text('SPD', bx + 8, by + 12, 10, CY);
      this.text(String(s), bx + 102, by + 30, 28, col, 'right');
      // Mini tape showing the 313 window
      const tx = bx, ty = by + 58, tw = 110;
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(tx, ty, tw, 6);
      const map = (v) => tx + BF.clamp((v - 250) / 150, 0, 1) * tw;
      g.fillStyle = 'rgba(141,255,122,0.55)'; g.fillRect(map(300), ty, map(320) - map(300), 6);
      g.fillStyle = GOLD; g.fillRect(map(313) - 1, ty - 2, 2, 10);
      g.fillStyle = '#fff'; g.fillRect(map(me.speed) - 1.5, ty - 4, 3, 14);
      // Throttle state
      const c = me.ctl; const st = c.brake > 0.05 ? ['BRAKE', ORG] : me.boosting ? ['AFTERBURNER', '#ff8a4a'] : c.throttleUp > 0.05 ? ['THROTTLE +', CY] : ['CRUISE', 'rgba(127,227,255,0.7)'];
      this.text(st[0], bx, ty + 20, 11, st[1]);
      // Afterburner tank
      this.bar(bx, ty + 32, tw, 4, me.boostTank / cfg.flight.boostSeconds, '#ff9a5a');

      // Altitude (right of centre)
      const ax = cx + 120, ay = cy - 26;
      this.panel(ax, ay, 110, 52);
      this.text('ALT', ax + 8, ay + 12, 10, CY);
      this.text(String(Math.round(me.altitude)), ax + 102, ay + 30, 28, me.altitude < 80 ? ORG : CY, 'right');
      this.text(`G-TURN ${Math.round(me.pitchRateMax || 0)}°/s`, ax, ay + 66, 11, 'rgba(127,227,255,0.8)');
    }

    warnings(me, sim, cfg) {
      const W = this.w, H = this.h, th = sim.threatsTo(me), blink = Math.floor(sim.t * 6) % 2 === 0;
      let y = H * 0.3;
      if (th.incoming.length) { if (blink) this.text(`MISSILE  ${Math.round(th.nearestMissile)}m`, W / 2, y, 24, RED, 'center'); y += 30; }
      else if (th.lockedBy) { if (blink) this.text('LOCKED ON', W / 2, y, 20, RED, 'center'); y += 26; }
      else if (th.lockingBy) { this.text('LOCK WARNING', W / 2, y, 16, ORG, 'center'); y += 24; }
      if (me.stalling) { if (blink) this.text('STALL', W / 2, y, 20, ORG, 'center'); y += 26; }
      const fwd = BF.forwardOf(me.quat, new V3());
      if (me.altitude < 150 && fwd.y < -0.15 && blink) { this.text('PULL UP', W / 2, y, 22, RED, 'center'); y += 28; }
      if (me.oobT > 0) this.text(`RETURN TO THE COMBAT AREA  ${Math.ceil(cfg.world.outOfBoundsTime - me.oobT)}`, W / 2, y, 18, RED, 'center');
      else if (me.nearBoundary) this.text('APPROACHING COMBAT AREA LIMIT', W / 2, y, 14, ORG, 'center');
      if (me.overheated) this.text('OVERHEAT', W / 2, H / 2 + 110, 14, RED, 'center');
      if (me.ctl.boost && me.ctl.throttleUp > 0.05 && me.boostTank <= 0.05) this.text('AFTERBURNER EMPTY', W / 2, H / 2 + 130, 14, ORG, 'center');
      if (me.aboveCeiling) this.text('ALTITUDE CEILING', W / 2, H / 2 + 150, 14, ORG, 'center');
    }

    scorePanel(sim, me) {
      const x = 24, y = this.h - 24 - this.radarR() * 2 - 8 - 44 - 58; // above the radar + heading box
      this.panel(x, y, 190, 58);
      const k0 = sim.jets.filter((j) => j.team === 0).reduce((a, j) => a + j.kills, 0);
      const k1 = sim.jets.filter((j) => j.team === 1).reduce((a, j) => a + j.kills, 0);
      this.text('BLUE', x + 10, y + 18, 13, '#7fd0ff'); this.text(String(k0), x + 90, y + 18, 13, '#7fd0ff', 'right');
      this.bar(x + 100, y + 14, 80, 7, k0 / Math.max(k0 + k1, 1), '#7fd0ff');
      this.text('RED', x + 10, y + 40, 13, ORG); this.text(String(k1), x + 90, y + 40, 13, ORG, 'right');
      this.bar(x + 100, y + 36, 80, 7, k1 / Math.max(k0 + k1, 1), ORG);
    }

    radar(sim, me, cfg) {
      // Heading-up air radar: your nose is always up the screen. Compass ring rotates
      // around it; contacts are arrows pointing the way they're flying.
      const g = this.g, R = this.radarR(), cx = 24 + R + 4, cy = this.h - 24 - R - 4, range = cfg.camera.radarRange || 870;
      const f = BF.forwardOf(me.quat, new V3()), hdg = Math.atan2(f.x, -f.z);
      const toR = (p) => {
        const dx = p.x - me.pos.x, dz = p.z - me.pos.z;
        const rx = dx * Math.cos(hdg) + dz * Math.sin(hdg), ry = -dx * Math.sin(hdg) + dz * Math.cos(hdg);
        return { x: cx + rx / range * R, y: cy + ry / range * R };
      };
      // Top-down fighter silhouette (nose up), size = half its length in px
      const JET = [[0, -1], [0.1, -0.72], [0.14, -0.4], [0.2, -0.18], [0.92, 0.2], [0.92, 0.34], [0.2, 0.3], [0.2, 0.62],
        [0.5, 0.82], [0.5, 0.94], [0.14, 0.88], [0.12, 1], [-0.12, 1], [-0.14, 0.88], [-0.5, 0.94], [-0.5, 0.82], [-0.2, 0.62],
        [-0.2, 0.3], [-0.92, 0.34], [-0.92, 0.2], [-0.2, -0.18], [-0.14, -0.4], [-0.1, -0.72]];
      const arrow = (x, y, ang, size, fill) => {
        g.save(); g.translate(x, y); g.rotate(ang);
        g.fillStyle = fill; g.beginPath();
        JET.forEach(([px, py], i) => (i ? g.lineTo(px * size, py * size) : g.moveTo(px * size, py * size)));
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1; g.stroke(); g.restore();
      };
      g.save();
      g.beginPath(); g.arc(cx, cy, R, 0, 7);
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, R); rg.addColorStop(0, 'rgba(60,200,230,0.30)'); rg.addColorStop(1, 'rgba(30,120,160,0.55)');
      g.fillStyle = rg; g.fill(); g.strokeStyle = 'rgba(160,240,255,0.75)'; g.lineWidth = 2; g.stroke();
      g.clip();
      // Forward view cone + heading line (direction of flight)
      const cone = 30 * BF.DEG;
      const cg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      cg.addColorStop(0, 'rgba(220,255,255,0.28)'); cg.addColorStop(1, 'rgba(220,255,255,0.04)');
      g.fillStyle = cg; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, -Math.PI / 2 - cone, -Math.PI / 2 + cone); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.setLineDash([6, 5]);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - R); g.stroke(); g.setLineDash([]);
      // Range rings (labelled)
      g.strokeStyle = 'rgba(180,250,255,0.2)'; g.lineWidth = 1;
      for (const k of [1 / 3, 2 / 3]) { g.beginPath(); g.arc(cx, cy, R * k, 0, 7); g.stroke(); }
      // Combat area edge
      const half = cfg.world.size / 2; g.strokeStyle = 'rgba(255,80,60,0.65)'; g.lineWidth = 1.5; g.beginPath();
      [[half, half], [half, -half], [-half, -half], [-half, half], [half, half]].forEach(([x, z], i) => { const p = toR({ x, z }); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
      g.stroke();
      // Contacts: arrows in their direction of travel, ▲/▼ if well above/below you
      for (const j of sim.jets) {
        if (j === me || !j.alive) continue;
        if (sim.t < j.ecmUntil) continue; // ECM jamming: invisible on radar
        const p = toR(j.pos), jf = BF.forwardOf(j.quat, new V3());
        // Out of range: pin to the rim so you still know which way they are
        const ox = p.x - cx, oy = p.y - cy, od = Math.hypot(ox, oy), out = od > R - 8;
        if (out) { p.x = cx + ox / od * (R - 8); p.y = cy + oy / od * (R - 8); }
        g.globalAlpha = out ? 0.55 : 1;
        const rel = Math.atan2(jf.x, -jf.z) - hdg;
        const col = j.team === me.team ? '#8fd4ff' : RED;
        arrow(p.x, p.y, rel, 9.5, col); // ~25% bigger than the old arrow
        const dy = j.pos.y - me.pos.y;
        if (Math.abs(dy) > 150) this.text(dy > 0 ? '▲' : '▼', p.x + 15, p.y - 10, 10, col, 'center');
        if (me.lock.targetId === j.id) { g.strokeStyle = me.lock.locked ? RED : ORG; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, 14, 0, 7); g.stroke(); }
        g.globalAlpha = 1;
      }
      for (const m of sim.missiles) { const p = toR(m.pos); g.fillStyle = m.target === me.id ? RED : '#fff'; g.fillRect(p.x - 2, p.y - 2, 4, 4); }
      g.restore();
      // Compass ring outside the scope (rotates with heading)
      g.strokeStyle = 'rgba(160,240,255,0.6)'; g.lineWidth = 1.5;
      for (let d = 0; d < 360; d += 15) {
        const a = d * BF.DEG - hdg - Math.PI / 2, big = d % 45 === 0;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R - (big ? 9 : 5)), cy + Math.sin(a) * (R - (big ? 9 : 5))); g.stroke();
      }
      for (const [lbl, d] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
        const a = d * BF.DEG - hdg - Math.PI / 2;
        this.text(lbl, cx + Math.cos(a) * (R + 11), cy + Math.sin(a) * (R + 11), 12, lbl === 'N' ? GOLD : CY, 'center');
      }
      // Own jet + heading readout at 12 o'clock
      arrow(cx, cy, 0, 12, '#fff');
      const hdgDeg = Math.round(((hdg / BF.DEG) + 360) % 360);
      this.panel(cx - 24, cy - R - 32, 48, 18);
      this.text(String(hdgDeg).padStart(3, '0') + '°', cx, cy - R - 23, 12, '#fff', 'center');
      this.text(range >= 1000 ? `${(range / 1000).toFixed(1)} km` : `${Math.round(range)} m`, cx + R * 0.72, cy + R * 0.9, 10, 'rgba(160,240,255,0.7)', 'center');
    }

    radarR() { return Math.min(184, this.h * 0.26); } // 2× the old 92 px (shrinks only on very small windows)

    vehiclePanel(me, sim, cfg) {
      const W = this.w, H = this.h, x = W - 260, y = H - 170, w = 236;
      this.panel(x, y, w, 146);
      const hp = Math.max(0, me.health) / cfg.jet.health;
      this.text('HULL', x + 10, y + 16, 11, CY); this.bar(x + 60, y + 11, 120, 9, hp, hp < 0.3 ? RED : CY); this.text(`${Math.round(hp * 100)}%`, x + w - 10, y + 16, 13, CY, 'right');
      // Selected-weapon highlight
      const sel = me.weapon === 'missile' ? 64 : 40, g = this.g;
      g.fillStyle = 'rgba(127,227,255,0.16)'; g.fillRect(x + 2, y + sel - 10, w - 4, 20);
      g.fillStyle = GOLD; g.fillRect(x + 2, y + sel - 10, 3, 20);
      const dim = (wpn) => (me.weapon === wpn ? CY : 'rgba(127,227,255,0.45)');
      this.text('CANNON', x + 10, y + 40, 11, dim('cannon')); this.bar(x + 60, y + 35, 120, 9, me.cannonHeat || 0, me.overheated ? RED : ORG);
      this.text(me.overheated ? 'HOT' : 'READY', x + w - 10, y + 40, 11, me.overheated ? RED : CY, 'right');
      const W2 = cfg.weapons;
      this.text('HEAT-SEEKER', x + 10, y + 64, 11, dim('missile'));
      for (let i = 0; i < W2.missileCount; i++) this.bar(x + 100 + i * 22, y + 59, 16, 9, i < me.missiles ? 1 : i === me.missiles ? me.missileReloadT / W2.missileReload : 0, i < me.missiles ? CY : CYD);
      this.text(`×${me.missiles}`, x + w - 10, y + 64, 13, CY, 'right');
      const cd = Math.max(0, me.counterReadyT - sim.t);
      const name = me.loadout === 'ecm' ? 'ECM JAM' : 'FLARES';
      const active = me.loadout === 'ecm' && sim.t < me.ecmUntil;
      this.text(name, x + 10, y + 88, 11, CY);
      this.bar(x + 100, y + 83, 80, 9, 1 - cd / (me.loadout === 'ecm' ? cfg.countermeasures.ecmCooldown : cfg.countermeasures.flareCooldown), cd > 0 ? CYD : GRN);
      this.text(active ? 'ACTIVE' : cd > 0 ? `${cd.toFixed(0)}s` : 'READY', x + w - 10, y + 88, 12, active ? GOLD : cd > 0 ? CY : GRN, 'right');
      this.text(`K ${me.kills}   D ${me.deaths}`, x + 10, y + 116, 13, CY);
      this.text(me.name, x + w - 10, y + 116, 12, 'rgba(127,227,255,0.8)', 'right');
      this.text(`${me.ctlDevice || ''}`, x + w - 10, y + 134, 10, 'rgba(127,227,255,0.55)', 'right');
    }

    killFeed(dt) {
      let y = 26;
      for (const f of this.feed) { f.t -= dt; this.text(f.text, this.w - 24, y, 13, f.color, 'right'); y += 20; }
      this.feed = this.feed.filter((f) => f.t > 0);
    }

    // F/A-18-style green HUD symbology, clipped to the combiner glass.
    f18Hud(me, sim, cfg, R, cam) {
      const g = this.g, W = this.w, H = this.h, GR = '#7dff8a';
      const cx = W / 2, cy = H / 2, hw = (R.x1 - R.x0) / 2;
      const f = (H / 2) / Math.tan(cam.fov * BF.DEG / 2); // px per unit tan
      const fwd = BF.forwardOf(me.quat, new V3()), up = BF.upOf(me.quat, new V3()), right = BF.rightOf(me.quat, new V3());
      const pitch = Math.asin(BF.clamp(fwd.y, -1, 1)) / BF.DEG;
      const roll = Math.atan2(-right.y, up.y);
      const hdg = ((Math.atan2(fwd.x, -fwd.z) / BF.DEG) + 360) % 360;
      const gLoad = 1 + (me.speed * BF.KMH) * Math.abs(me.rates.p * BF.DEG) / 9.81;
      const txt = (t, x, y, size = 13, align = 'center', col = GR) => {
        g.font = `600 ${size}px Consolas, "Courier New", monospace`; g.textAlign = align; g.textBaseline = 'middle';
        g.fillStyle = col; g.shadowColor = 'rgba(0,40,0,0.8)'; g.shadowBlur = 4; g.fillText(t, x, y); g.shadowBlur = 0;
      };
      g.save();
      g.beginPath(); g.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); g.clip();
      g.strokeStyle = GR; g.lineWidth = 1.6; g.shadowColor = 'rgba(0,40,0,0.8)'; g.shadowBlur = 3;

      // Pitch ladder, rotated with roll around the boresight
      g.save(); g.translate(cx, cy); g.rotate(-roll);
      for (let p = -90; p <= 90; p += 5) {
        const a = (p - pitch) * BF.DEG; if (Math.abs(a) > 0.6) continue;
        const y = -f * Math.tan(a), w = p === 0 ? hw * 0.8 : hw * 0.3, gap = hw * 0.16;
        g.setLineDash(p < 0 ? [7, 5] : []);
        g.beginPath();
        g.moveTo(-gap - w, y); g.lineTo(-gap, y); g.moveTo(gap, y); g.lineTo(gap + w, y);
        if (p !== 0) { const tick = p > 0 ? 7 : -7; g.moveTo(-gap - w, y); g.lineTo(-gap - w, y + tick); g.moveTo(gap + w, y); g.lineTo(gap + w, y + tick); }
        g.stroke();
        if (p !== 0) { txt(String(Math.abs(p)), -gap - w - 14, y, 11); txt(String(Math.abs(p)), gap + w + 14, y, 11); }
      }
      g.setLineDash([]); g.restore();

      // Waterline / gun cross at boresight
      g.beginPath();
      g.moveTo(cx - 22, cy); g.lineTo(cx - 10, cy); g.lineTo(cx - 5, cy + 7); g.lineTo(cx, cy); g.lineTo(cx + 5, cy + 7); g.lineTo(cx + 10, cy); g.lineTo(cx + 22, cy);
      g.stroke();
      if (me.weapon === 'cannon') { g.beginPath(); g.arc(cx, cy - 34, 16, 0, 7); g.moveTo(cx, cy - 34 - 3); g.lineTo(cx, cy - 34 + 3); g.stroke(); }
      else { g.beginPath(); g.arc(cx, cy, hw * 0.42, 0, 7); g.stroke(); } // AIM-9 seeker circle

      // Heading tape (top)
      const ty = R.y0 + 24, span = 30;
      const tw = hw * 0.62;
      g.beginPath(); g.moveTo(cx - tw, ty + 10); g.lineTo(cx + tw, ty + 10); g.stroke();
      for (let h = Math.ceil((hdg - span) / 5) * 5; h <= hdg + span; h += 5) {
        const x = cx + (h - hdg) / span * tw, big = h % 10 === 0;
        g.beginPath(); g.moveTo(x, ty + 10); g.lineTo(x, ty + (big ? 2 : 6)); g.stroke();
        if (big && h % 30 === 0) txt(String(((h % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, ty - 6, 11);
      }
      txt(String(Math.round(hdg)).padStart(3, '0'), cx, ty + 24, 13); g.strokeRect(cx - 18, ty + 15, 36, 18);

      // Airspeed (left) and altitude (right) boxes
      const bx = cx - hw * 0.72, ax = cx + hw * 0.72, by = cy - 30;
      const s = Math.round(me.speed), sweet = Math.abs(s - 313) <= 3, band = s >= 300 && s <= 320;
      g.strokeStyle = sweet ? GOLD : GR; g.lineWidth = sweet ? 2.4 : 1.6; g.strokeRect(bx - 32, by - 12, 64, 24); g.strokeStyle = GR; g.lineWidth = 1.6;
      txt(String(s), bx, by, 16, 'center', sweet ? GOLD : GR);
      if (band) txt(sweet ? '313' : '◄ ►', bx, by + 22, 10, 'center', sweet ? GOLD : GR);
      g.strokeRect(ax - 34, by - 12, 68, 24); txt(String(Math.round(me.pos.y)), ax, by, 16);
      txt(`R ${Math.round(me.altitude)}`, ax, by + 22, 11);
      // Left column: Mach, G, throttle state
      txt(`M ${(me.speed * BF.KMH / 340).toFixed(2)}`, bx - 32, by + 48, 12, 'left');
      txt(`G ${gLoad.toFixed(1)}`, bx - 32, by + 66, 12, 'left');
      const c = me.ctl; txt(c.brake > 0.05 ? 'SPD BRK' : me.boosting ? 'AB' : c.throttleUp > 0.05 ? 'MIL' : '', bx - 32, by + 84, 12, 'left');
      // Right column: weapon + countermeasure
      txt(me.weapon === 'missile' ? `9X ${me.missiles}` : me.overheated ? 'GUN HOT' : 'GUN', ax + 34, by + 48, 12, 'right');
      if (me.weapon === 'missile' && me.lock.locked) txt('SHOOT', ax + 34, by + 66, 12, 'right');
      const cd = Math.max(0, me.counterReadyT - sim.t);
      txt(`${me.loadout === 'ecm' ? 'ECM' : 'FLR'} ${cd > 0 ? Math.ceil(cd) : 'RDY'}`, ax + 34, by + 84, 12, 'right');
      g.restore();
    }
  };
})();
