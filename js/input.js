// Keyboard + mouse + gamepad -> a plain Controls object. The sim only ever sees
// Controls, which is what a network client would send to a server later.
window.BF = window.BF || {};

BF.ACTIONS = [
  ['throttleUp', 'Cruise throttle up'],
  ['boost', 'Afterburner'],
  ['brake', 'Brake'],
  ['pitchUp', 'Pitch up (nose up)'],
  ['pitchDown', 'Pitch down'],
  ['rollLeft', 'Roll left'],
  ['rollRight', 'Roll right'],
  ['yawLeft', 'Yaw left'],
  ['yawRight', 'Yaw right'],
  ['fire', 'Fire selected weapon'],
  ['switchWeapon', 'Switch weapon (cannon / missile)'],
  ['selectCannon', 'Select cannon'],
  ['selectMissile', 'Select heat-seeker'],
  ['counter', 'Countermeasure (flares/ECM)'],
  ['camera', 'Toggle camera'],
  ['lookBack', 'Look back (hold)'],
  ['pause', 'Pause / menu'],
  ['tuning', 'Tuning panel'],
];

BF.DEFAULT_BINDS = {
  throttleUp: ['KeyW', 'Pad:7'],               // Pad:7 = RT / R2
  boost: ['ShiftLeft', 'ShiftRight', 'Pad:11'], // Pad:11 = R3; afterburner = throttle-up + this
  brake: ['KeyS', 'Pad:6'],
  pitchUp: ['ArrowDown', 'Numpad5'],
  pitchDown: ['ArrowUp', 'Numpad8'],
  rollLeft: ['ArrowLeft', 'Numpad4'],
  rollRight: ['ArrowRight', 'Numpad6'],
  yawLeft: ['KeyA'],
  yawRight: ['KeyD'],
  fire: ['Mouse0', 'Space', 'Pad:5'],
  switchWeapon: ['KeyR', 'Mouse2', 'Pad:3'],   // Pad:3 = Y / Triangle
  selectCannon: ['Digit1'],
  selectMissile: ['Digit2'],
  counter: ['KeyX', 'Pad:2'],
  camera: ['KeyC', 'Pad:10'],                  // Pad:10 = L3 (left stick click)
  lookBack: ['KeyV', 'Pad:1'],
  pause: ['KeyP', 'Escape', 'Pad:9'],
  tuning: ['F1', 'Backquote'],
};

BF.BINDS_VERSION = 4;

BF.DEFAULT_INPUT_SETTINGS = {
  mouseSensitivity: 1.0,
  mouseInvertY: false,
  mouseReturn: 10,     // how fast the mouse "stick" re-centres (1/s)
  padInvertY: false,
  padDeadzone: 0.12,
  padExpo: 1.6,        // >1 = finer control near centre
  padFlightStick: 'right', // 'right' = right stick pitch/roll, left stick yaw
};

BF.Input = class {
  constructor(canvas) {
    this.canvas = canvas;
    this.binds = BF.cloneConfig(BF.DEFAULT_BINDS);
    this.settings = { ...BF.DEFAULT_INPUT_SETTINGS };
    try {
      // Saved binds from an older default layout are dropped so new defaults apply.
      const b = JSON.parse(localStorage.getItem('bf3dog.binds') || 'null');
      if (b && b._v === BF.BINDS_VERSION) { delete b._v; Object.assign(this.binds, b); }
      else if (b) this.bindsReset = true;
      const s = JSON.parse(localStorage.getItem('bf3dog.input') || 'null'); if (s) Object.assign(this.settings, s);
    } catch (e) {}
    this.down = new Set();        // currently held codes
    this.pressedEdge = new Set(); // codes pressed since last poll
    this.mouseStick = { x: 0, y: 0 };
    this.padIndex = null;
    this.padPrev = [];
    this.lastDevice = 'keyboard';
    this.listenCb = null;         // rebinding capture
    this.onAction = () => {};     // UI actions: camera, pause, tuning

    // Windows quirk: with NumLock on, pressing a numpad key while Shift is held makes
    // Windows send a fake Shift keyup (and a fake Shift keydown when the numpad key is
    // released). BF-style numpad flying + Shift afterburner would silently cut the
    // afterburner, so fake Shift releases around numpad presses are ignored.
    this.shiftUpTimers = {};
    this.shiftHeldByNumpad = new Set();
    const isShift = (c) => c === 'ShiftLeft' || c === 'ShiftRight';
    const isNumpad = (c) => /^Numpad\d$|^NumpadDecimal$/.test(c);
    addEventListener('keydown', (e) => {
      if (this.listenCb) { e.preventDefault(); this.listenCb(e.code); return; }
      if (['F1', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      const t = e.target, tag = t && t.tagName;
      // Only real text fields swallow keys. Sliders/checkboxes (tuning panel) must not
      // steal flight keys, so drop focus from them and carry on.
      if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['range', 'checkbox'].includes(t.type))) return;
      if (tag === 'INPUT' && t.blur) t.blur();
      if (isShift(e.code) && this.shiftUpTimers[e.code]) { clearTimeout(this.shiftUpTimers[e.code]); delete this.shiftUpTimers[e.code]; }
      if (isNumpad(e.code)) {
        for (const sc of Object.keys(this.shiftUpTimers)) { clearTimeout(this.shiftUpTimers[sc]); delete this.shiftUpTimers[sc]; this.shiftHeldByNumpad.add(sc); }
      }
      if (!this.down.has(e.code)) this.pressedEdge.add(e.code);
      this.down.add(e.code); this.lastDevice = 'keyboard';
      this._uiCheck(e.code);
    });
    addEventListener('keyup', (e) => {
      if (isShift(e.code) && this.down.has(e.code)) {
        // Defer: a numpad keydown in the next few ms means this release was fake.
        clearTimeout(this.shiftUpTimers[e.code]);
        this.shiftUpTimers[e.code] = setTimeout(() => { delete this.shiftUpTimers[e.code]; this.down.delete(e.code); }, 35);
        return;
      }
      this.down.delete(e.code);
      if (isNumpad(e.code) && this.shiftHeldByNumpad.size) {
        // Windows re-sends Shift keydown right after if Shift is really still held.
        for (const sc of [...this.shiftHeldByNumpad]) {
          this.shiftHeldByNumpad.delete(sc);
          this.shiftUpTimers[sc] = setTimeout(() => { delete this.shiftUpTimers[sc]; this.down.delete(sc); }, 35);
        }
      }
    });
    addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (this.listenCb) { this.listenCb('Mouse' + e.button); return; }
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock && canvas.requestPointerLock(); return; }
      const c = 'Mouse' + e.button; this.down.add(c); this.pressedEdge.add(c); this.lastDevice = 'mouse';
    });
    addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      const s = 0.0045 * this.settings.mouseSensitivity;
      this.mouseStick.x = BF.clamp(this.mouseStick.x + e.movementX * s, -1, 1);
      this.mouseStick.y = BF.clamp(this.mouseStick.y + e.movementY * s * (this.settings.mouseInvertY ? -1 : 1), -1, 1);
      this.lastDevice = 'mouse';
    });
    addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this.onAction('padConnected', e.gamepad.id); });
    addEventListener('gamepaddisconnected', (e) => { if (this.padIndex === e.gamepad.index) this.padIndex = null; });
  }

  save() {
    try {
      localStorage.setItem('bf3dog.binds', JSON.stringify({ ...this.binds, _v: BF.BINDS_VERSION }));
      localStorage.setItem('bf3dog.input', JSON.stringify(this.settings));
    } catch (e) {}
  }

  _uiCheck(code) {
    for (const a of ['camera', 'pause', 'tuning']) if (this.binds[a].includes(code)) this.onAction(a);
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex != null && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p) { this.padIndex = p.index; return p; }
    return null;
  }

  _padAxis(v) {
    const dz = this.settings.padDeadzone, a = Math.abs(v);
    if (a < dz) return 0;
    return Math.sign(v) * Math.pow((a - dz) / (1 - dz), this.settings.padExpo);
  }

  // Analog 0..1 value of an action from all bound sources.
  _val(action, pad) {
    let v = 0;
    for (const code of this.binds[action] || []) {
      if (code.startsWith('Pad:')) {
        const b = pad && pad.buttons[+code.slice(4)];
        if (b) v = Math.max(v, b.value > 0.05 ? b.value : b.pressed ? 1 : 0);
      } else if (this.down.has(code)) v = 1;
    }
    return v;
  }

  // Poll once per frame. Returns Controls.
  poll(dt) {
    const pad = this._pad();
    // Pad button edges for UI actions + rebinding capture
    if (pad) {
      pad.buttons.forEach((b, i) => {
        const was = this.padPrev[i]; this.padPrev[i] = b.pressed;
        if (b.pressed && !was) {
          this.lastDevice = 'gamepad';
          if (this.listenCb) { this.listenCb('Pad:' + i); return; }
          this.pressedEdge.add('Pad:' + i); this._uiCheck('Pad:' + i);
        }
      });
    }
    // Mouse stick recentres
    const k = 1 - Math.exp(-this.settings.mouseReturn * dt);
    this.mouseStick.x -= this.mouseStick.x * k;
    this.mouseStick.y -= this.mouseStick.y * k;

    let pitch = this._val('pitchUp', pad) - this._val('pitchDown', pad);
    let roll = this._val('rollRight', pad) - this._val('rollLeft', pad);
    let yaw = this._val('yawRight', pad) - this._val('yawLeft', pad);
    // Mouse: up = nose up, sideways = roll (BF3 default)
    pitch += -this.mouseStick.y * 2.2;
    roll += this.mouseStick.x * 2.2;
    if (pad) {
      const ax = pad.axes;
      // Flight stick (pitch/roll) defaults to the RIGHT stick; the other stick's X is yaw.
      const right = this.settings.padFlightStick !== 'left';
      const fx = this._padAxis(ax[right ? 2 : 0] || 0), fy = this._padAxis(ax[right ? 3 : 1] || 0);
      const yx = this._padAxis(ax[right ? 0 : 2] || 0);
      if (fx || fy || yx) this.lastDevice = 'gamepad';
      roll += fx;
      pitch += (this.settings.padInvertY ? -fy : fy); // stick back (positive) = nose up
      yaw += yx;
    }
    const edge = (a) => (this.binds[a] || []).some((c) => this.pressedEdge.has(c));
    const ctl = {
      pitch: BF.clamp(pitch, -1, 1),
      roll: BF.clamp(roll, -1, 1),
      yaw: BF.clamp(yaw, -1, 1),
      throttleUp: this._val('throttleUp', pad),
      boost: this._val('boost', pad) > 0.5 ? 1 : 0,
      brake: this._val('brake', pad),
      fire: this._val('fire', pad) > 0.5,
      switchWeapon: edge('switchWeapon'),
      selectWeapon: edge('selectCannon') ? 'cannon' : edge('selectMissile') ? 'missile' : null,
      counter: edge('counter'),
      lookBack: this._val('lookBack', pad) > 0.5,
    };
    this.pressedEdge.clear();
    return ctl;
  }

  static label(code) {
    if (!code) return '—';
    if (code.startsWith('Pad:')) {
      const n = ['A/✕', 'B/○', 'X/□', 'Y/△', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];
      return 'Pad ' + (n[+code.slice(4)] || code.slice(4));
    }
    if (code.startsWith('Mouse')) return ['LMB', 'MMB', 'RMB', 'Mouse4', 'Mouse5'][+code.slice(5)] || code;
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Arrow ').replace(/(\w)(Left|Right)$/, '$1 $2');
  }
};

BF.emptyControls = () => ({ pitch: 0, roll: 0, yaw: 0, throttleUp: 0, boost: 0, brake: 0, fire: false, switchWeapon: false, selectWeapon: null, counter: false, lookBack: false });
