// Live tuning panel (F1 / `). Edits BF.CONFIG in place; export/import JSON so
// pilots can share feel presets with each other.
window.BF = window.BF || {};

BF.TuningPanel = class {
  constructor(root, getSpeed, getJet) {
    this.root = root; this.getSpeed = getSpeed; this.getJet = getJet || (() => null); this.lastSpd = null; this.dSpd = 0; this.open = false;
    this.build();
  }

  build() {
    const C = BF.CONFIG, groups = {
      'Throttle & energy': ['flight', ['cruiseSpeed', 'throttleUpSpeed', 'boostSpeed', 'brakeSpeed', 'springRate', 'throttleUpRate', 'boostRate', 'boostRateClimb', 'brakeRate', 'brakeRateDive', 'brakeDiveCurve', 'brakeSpeedExp', 'brakeRefSpeed', 'brakeRamp', 'boostSeconds', 'boostRechargeDelay', 'boostRecharge', 'turnBleed', 'gravitySpeed', 'stallSpeed']],
      'Handling': ['flight', ['rollRate', 'yawRate', 'controlResponse', 'rollAtLowSpeed', 'groundSpeedScale']],
      'Weapons': ['weapons', ['cannonRps', 'cannonDamage', 'cannonSpread', 'cannonHeat', 'missileLockTime', 'missileLockCone', 'missileLockRange', 'missileSpeed', 'missileTurnRate', 'missileDamage', 'missileReload']],
      'Countermeasures': ['countermeasures', ['flareCooldown', 'ecmCooldown', 'ecmDuration', 'ecmCloudLife']],
      'Camera': ['camera', ['chaseDistance', 'chaseHeight', 'positionLag', 'rollLag', 'baseFov', 'boostFov', 'radarRange', 'rollCamBoomRate', 'rollCamLookRate', 'rollCamPitchLimit', 'rollCamRollFollow', 'rollCamMaxOffset', 'rollCamMaxYawRate', 'rollCamPitchLimitDown', 'rollCamFrameMargin', 'rollCamDistance', 'rollCamHeight', 'rollCamJetRadius', 'rollCamMaxYawAccel']],
      'AI': ['ai', ['aimError', 'skill', 'reactionTime', 'flareChance', 'fireCone']],
    };
    const el = document.createElement('div'); el.id = 'tuning'; el.style.display = 'none';
    el.innerHTML = `<div class="tp-head"><b>TUNING</b><span>changes apply live · F1 to close</span></div>
      <canvas id="tp-curve" width="340" height="150"></canvas>
      <div class="tp-note">Turn curve: drag points up/down. Gold line = current speed.</div>
      <div id="tp-diag"></div>
      <div id="tp-groups"></div>
      <div class="tp-btns"><button id="tp-export">Export JSON</button><button id="tp-import">Import JSON</button><button id="tp-reset">Reset defaults</button></div>
      <textarea id="tp-json" spellcheck="false" placeholder="Paste a preset here, then Import"></textarea>`;
    this.root.appendChild(el); this.el = el;
    const gEl = el.querySelector('#tp-groups');
    this.inputs = [];
    for (const [title, [sec, keys]] of Object.entries(groups)) {
      const box = document.createElement('details'); box.open = title === 'Throttle & energy';
      box.innerHTML = `<summary>${title}</summary>`;
      for (const k of keys) {
        // Slider range comes from the DEFAULT value, so a setting dragged to 0 can
        // always be dragged back (the old range came from the current value and trapped it).
        const v = C[sec][k], d = BF.DEFAULT_CONFIG[sec][k];
        const max = k === 'skill' || k === 'flareChance' || k === 'rollAtLowSpeed' ? 1 : Math.max(1, Math.ceil(Math.max(d * 3, v * 1.5)));
        const step = max <= 1 ? 0.01 : max <= 10 ? 0.05 : max <= 100 ? 0.5 : 1;
        const row = document.createElement('label'); row.className = 'tp-row';
        row.innerHTML = `<span title="Double-click to reset to default (${d})">${k}</span><input type="range" min="0" max="${max}" step="${step}"><em></em>`;
        const inp = row.querySelector('input'), out = row.querySelector('em');
        const sync = () => { inp.value = C[sec][k]; out.textContent = (+C[sec][k]).toFixed(step < 1 ? 2 : 0); };
        inp.addEventListener('input', () => { C[sec][k] = +inp.value; out.textContent = (+inp.value).toFixed(step < 1 ? 2 : 0); BF.saveConfig(); });
        row.querySelector('span').addEventListener('dblclick', () => { C[sec][k] = d; sync(); BF.saveConfig(); });
        sync(); this.inputs.push(sync); box.appendChild(row);
      }
      gEl.appendChild(box);
    }
    el.querySelector('#tp-export').onclick = () => {
      const t = el.querySelector('#tp-json'); t.value = JSON.stringify(BF.CONFIG, null, 1); t.select();
      try { navigator.clipboard.writeText(t.value); } catch (e) {}
    };
    el.querySelector('#tp-import').onclick = () => {
      try {
        const s = JSON.parse(el.querySelector('#tp-json').value);
        for (const k of Object.keys(BF.CONFIG)) if (s[k]) Object.assign(BF.CONFIG[k], s[k]);
        BF.saveConfig(); this.inputs.forEach((f) => f());
      } catch (e) { alert('That JSON did not parse: ' + e.message); }
    };
    el.querySelector('#tp-reset').onclick = () => {
      const d = BF.cloneConfig(BF.DEFAULT_CONFIG);
      for (const k of Object.keys(d)) Object.assign(BF.CONFIG[k], d[k]);
      BF.saveConfig(); this.inputs.forEach((f) => f());
    };
    // Curve editor
    const cv = this.cv = el.querySelector('#tp-curve');
    let drag = -1;
    const toXY = (p) => ({ x: 20 + (p[0] / 650) * 310, y: 135 - (p[1] / 80) * 125 });
    cv.addEventListener('mousedown', (e) => {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      BF.CONFIG.flight.pitchCurve.forEach((p, i) => { const q = toXY(p); if (Math.hypot(q.x - mx, q.y - my) < 9) drag = i; });
    });
    addEventListener('mousemove', (e) => {
      if (drag < 0) return;
      const r = cv.getBoundingClientRect(), my = e.clientY - r.top;
      BF.CONFIG.flight.pitchCurve[drag][1] = Math.round(BF.clamp((135 - my) / 125 * 80, 2, 80));
    });
    addEventListener('mouseup', () => { if (drag >= 0) BF.saveConfig(); drag = -1; });
    this.toXY = toXY;
  }

  toggle() {
    this.open = !this.open; this.el.style.display = this.open ? 'block' : 'none';
    if (this.open) { this.inputs.forEach((f) => f()); if (document.pointerLockElement) document.exitPointerLock(); }
  }

  draw(dt = 1 / 60) {
    if (!this.open) return;
    // Live input/throttle readout: shows exactly what the flight model is receiving.
    const j = this.getJet();
    if (j && j.alive) {
      if (this.lastSpd != null && dt > 0) this.dSpd = BF.lerp(this.dSpd, (j.speed - this.lastSpd) / dt, 0.1);
      this.lastSpd = j.speed;
      const c = j.ctl, F = BF.CONFIG.flight;
      const state = c.brake > 0.05 ? 'BRAKE' : j.boosting ? 'AFTERBURNER' : c.boost && !(c.throttleUp > 0.05) ? 'AB PRESSED – HOLD THROTTLE UP TOO' : c.boost ? 'AB PRESSED – TANK EMPTY' : c.throttleUp > 0.05 ? 'THROTTLE UP (not AB)' : 'CRUISE';
      const climb = Math.asin(BF.clamp(BF.forwardOf(j.quat, new THREE.Vector3()).y, -1, 1)) / BF.DEG;
      this.el.querySelector('#tp-diag').innerHTML =
        `<b>${state}</b> · ${j.ctlDevice || ''}<br>` +
        `inputs: AB ${c.boost ? 'ON' : 'off'} · brake ${c.brake.toFixed(2)} · thr ${c.throttleUp.toFixed(2)}<br>` +
        `tank ${j.boostTank.toFixed(1)}/${F.boostSeconds}s · boostRate ${F.boostRate} · climb ${climb.toFixed(0)}°<br>` +
        `speed ${j.speed.toFixed(0)} · change <b>${this.dSpd >= 0 ? '+' : ''}${this.dSpd.toFixed(0)}/s</b>`;
    }
    const g = this.cv.getContext('2d'), pts = BF.CONFIG.flight.pitchCurve;
    g.clearRect(0, 0, 340, 150);
    g.strokeStyle = 'rgba(127,227,255,0.15)'; g.lineWidth = 1;
    for (let s = 0; s <= 650; s += 50) { const x = this.toXY([s, 0]).x; g.beginPath(); g.moveTo(x, 10); g.lineTo(x, 135); g.stroke(); }
    const band = [this.toXY([300, 0]).x, this.toXY([320, 0]).x];
    g.fillStyle = 'rgba(141,255,122,0.12)'; g.fillRect(band[0], 10, band[1] - band[0], 125);
    g.strokeStyle = '#7fe3ff'; g.lineWidth = 2; g.beginPath();
    pts.forEach((p, i) => { const q = this.toXY(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke();
    g.fillStyle = '#fff'; pts.forEach((p) => { const q = this.toXY(p); g.beginPath(); g.arc(q.x, q.y, 4, 0, 7); g.fill(); });
    const s = this.getSpeed();
    if (s != null) {
      const x = this.toXY([s, 0]).x; g.strokeStyle = '#ffd84a'; g.beginPath(); g.moveTo(x, 10); g.lineTo(x, 135); g.stroke();
      g.fillStyle = '#ffd84a'; g.font = '11px sans-serif'; g.fillText(`${Math.round(s)} → ${BF.curve(pts, s).toFixed(0)}°/s`, Math.min(x + 4, 260), 20);
    }
    g.fillStyle = 'rgba(127,227,255,0.7)'; g.font = '10px sans-serif';
    g.fillText('speed →', 280, 146); g.fillText('°/s', 2, 12);
  }
};
