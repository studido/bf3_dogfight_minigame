// F/A-18-style cockpit, rendered as a second pass on top of the world so it never
// clips into terrain. Geometry is in camera space (x right, y up, -z forward, eye at 0).
window.BF = window.BF || {};

BF.Cockpit = class {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(70, 1, 0.03, 20);
    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a2a2a, 0.55); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 0.85); this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.mfdT = 0;
    this.build();
  }

  build() {
    const S = this.scene;
    const mat = (c, o = {}) => new THREE.MeshPhongMaterial({ color: c, flatShading: true, shininess: 10, ...o });
    const GREY = mat(0x3a4046), DARK = mat(0x1d2023), FRAME = mat(0x474d53), KNOB = mat(0x15171a), SILVER = mat(0xa9b3bb, { shininess: 60 });
    const box = (w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0, parent = S) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.set(rx, ry, rz); parent.add(b); return b;
    };

    // Instrument panel (tilted back), glare shield on top
    const panel = new THREE.Group(); panel.position.set(0, -0.38, -0.62); panel.rotation.x = -0.25; S.add(panel);
    box(1.1, 0.5, 0.06, GREY, 0, 0, 0, 0, 0, 0, panel);
    const glare = box(1.04, 0.05, 0.44, DARK, 0, -0.135, -0.84, -0.06);
    // Glare-shield front lip (curved look with two angled boxes)
    box(0.46, 0.05, 0.12, DARK, -0.36, -0.14, -0.64, -0.06, 0.3); box(0.46, 0.05, 0.12, DARK, 0.36, -0.14, -0.64, -0.06, -0.3);
    this.glare = glare;

    // MFDs: left DDI, right DDI, centre AMPCD (canvas textures)
    this.mfds = [];
    const mfd = (x, y, w, h, kind) => {
      const bezel = new THREE.Group(); bezel.position.set(x, y, 0.035); panel.add(bezel);
      box(w + 0.07, h + 0.07, 0.03, KNOB, 0, 0, 0, 0, 0, 0, bezel);
      // Bezel push-buttons (5 per side)
      for (let i = 0; i < 5; i++) {
        const t = -h / 2 + (i + 0.5) * (h / 5);
        box(0.018, 0.018, 0.012, FRAME, -w / 2 - 0.022, t, 0.018, 0, 0, 0, bezel); box(0.018, 0.018, 0.012, FRAME, w / 2 + 0.022, t, 0.018, 0, 0, 0, bezel);
        box(0.018, 0.018, 0.012, FRAME, -w / 2 + (i + 0.5) * (w / 5), h / 2 + 0.022, 0.018, 0, 0, 0, bezel);
      }
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const tex = new THREE.CanvasTexture(c);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
      scr.position.z = 0.017; bezel.add(scr);
      this.mfds.push({ c, g: c.getContext('2d'), tex, kind });
    };
    mfd(-0.3, 0.06, 0.19, 0.19, 'radar');
    mfd(0.3, 0.06, 0.19, 0.19, 'stores');
    mfd(0, -0.1, 0.2, 0.18, 'energy');

    // UFCP under the HUD with keypad
    const ufc = new THREE.Group(); ufc.position.set(0, 0.14, 0.05); panel.add(ufc);
    box(0.24, 0.13, 0.05, KNOB, 0, 0, 0, 0, 0, 0, ufc);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) box(0.022, 0.018, 0.01, FRAME, -0.03 + k * 0.03, 0.035 - r * 0.025, 0.028, 0, 0, 0, ufc);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.016), new THREE.MeshBasicMaterial({ color: 0x3aff6a }));
    strip.position.set(0, 0.055, 0.027); ufc.add(strip);
    for (const sx of [-1, 1]) for (let r = 0; r < 5; r++) box(0.028, 0.012, 0.01, FRAME, sx * 0.09, 0.04 - r * 0.02, 0.028, 0, 0, 0, ufc);

    // HUD: body on the glare shield + twin combiner glasses
    box(0.3, 0.06, 0.16, KNOB, 0, -0.12, -0.72);
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xa8ffc0, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
    this.combiner = new THREE.Group(); this.combiner.position.set(0, 0.07, -0.72); this.combiner.rotation.x = 0.12; S.add(this.combiner);
    for (const dz of [0, -0.03]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.34), glassMat); p.position.z = dz; this.combiner.add(p); }
    for (const sx of [-1, 1]) box(0.012, 0.35, 0.04, FRAME, sx * 0.185, 0, -0.015, 0, 0, 0, this.combiner);
    box(0.38, 0.012, 0.04, FRAME, 0, 0.175, -0.015, 0, 0, 0, this.combiner);

    // Canopy: windscreen side bars + canopy bow arch over the pilot + rails
    const tube = (pts, r, m) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      S.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 6, false), m));
    };
    tube([[-0.52, -0.13, -0.95], [-0.49, 0.1, -0.62], [-0.43, 0.3, -0.25], [-0.38, 0.4, -0.08]], 0.022, FRAME);
    tube([[0.52, -0.13, -0.95], [0.49, 0.1, -0.62], [0.43, 0.3, -0.25], [0.38, 0.4, -0.08]], 0.022, FRAME);
    tube([[-0.6, -0.3, -0.04], [-0.5, 0.2, -0.06], [-0.26, 0.48, -0.08], [0, 0.54, -0.08], [0.26, 0.48, -0.08], [0.5, 0.2, -0.06], [0.6, -0.3, -0.04]], 0.045, FRAME);
    // Rear-view mirrors on the bow
    for (const [x, y, rz] of [[-0.24, 0.47, 0.35], [0, 0.515, 0], [0.24, 0.47, -0.35]]) box(0.13, 0.045, 0.012, SILVER, x, y, -0.14, 0.3, 0, rz);
    // Canopy rails and side consoles
    for (const sx of [-1, 1]) {
      box(0.06, 0.06, 1.6, FRAME, sx * 0.6, -0.22, -0.15);
      box(0.3, 0.1, 1.0, GREY, sx * 0.55, -0.5, -0.15);
      for (let k = 0; k < 4; k++) { const kb = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.025, 8), KNOB); kb.position.set(sx * 0.52, -0.44, -0.5 + k * 0.12); S.add(kb); }
    }
    // Faint canopy glass tint + sun streak
    const canopyGlass = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.035, side: THREE.BackSide, depthWrite: false }));
    canopyGlass.position.set(0, -0.3, -0.2); canopyGlass.scale.set(0.5, 0.65, 1); S.add(canopyGlass);
  }

  // Keep projection in sync with the world camera and aim the sun correctly.
  sync(camera, sunDir) {
    this.cam.fov = camera.fov; this.cam.aspect = camera.aspect; this.cam.updateProjectionMatrix();
    const inv = camera.quaternion.clone().invert();
    this.sun.position.copy(sunDir).applyQuaternion(inv).multiplyScalar(5);
    this.hemi.position.set(0, 1, 0).applyQuaternion(inv);
  }

  render(renderer) {
    renderer.autoClear = false; renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    renderer.autoClear = true;
  }

  // Screen-space rectangle of the HUD combiner (for drawing symbology).
  combinerRect(W, H) {
    this.combiner.updateMatrixWorld(true);
    const pts = [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]].map(([x, y]) => {
      const v = new THREE.Vector3(x, y, 0).applyMatrix4(this.combiner.matrixWorld).project(this.cam);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  // Green monochrome MFD pages, refreshed at ~12 Hz.
  updateMFDs(dt, me, sim, cfg) {
    this.mfdT -= dt; if (this.mfdT > 0) return; this.mfdT = 0.08;
    const G = '#6dff7a', GD = 'rgba(109,255,122,0.35)';
    for (const m of this.mfds) {
      const g = m.g; g.fillStyle = '#020803'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = G; g.fillStyle = G; g.lineWidth = 2; g.font = 'bold 16px Consolas, monospace'; g.textBaseline = 'middle';
      if (m.kind === 'radar') {
        // B-scope: azimuth ±60°, range 5 km
        g.fillText('RWS', 12, 16); g.fillText('5', 12, 44); g.textAlign = 'right'; g.fillText('RDR ATTK', 244, 16); g.textAlign = 'left';
        g.strokeStyle = GD; g.lineWidth = 1;
        for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(28, 40 + i * 50); g.lineTo(228, 40 + i * 50); g.stroke(); }
        g.beginPath(); g.moveTo(128, 40); g.lineTo(128, 240); g.stroke();
        g.strokeRect(28, 40, 200, 200);
        const fwd = BF.forwardOf(me.quat, new THREE.Vector3()), right = BF.rightOf(me.quat, new THREE.Vector3());
        for (const j of sim.jets) {
          if (j === me || !j.alive || sim.t < j.ecmUntil) continue; // jammers are invisible
          const d = new THREE.Vector3().subVectors(j.pos, me.pos), r = d.length(); if (r > 5000) continue;
          const az = Math.atan2(d.dot(right), d.dot(fwd)) / BF.DEG; if (Math.abs(az) > 60) continue;
          const x = 128 + az / 60 * 100, y = 240 - r / 5000 * 200;
          g.fillStyle = j.team === me.team ? GD : G; g.fillRect(x - 5, y - 5, 10, 10);
          if (me.lock.targetId === j.id) { g.strokeStyle = G; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke(); }
        }
      } else if (m.kind === 'stores') {
        g.textAlign = 'center'; g.fillText('SMS', 128, 16);
        // Top-down jet outline with stations
        g.beginPath(); g.moveTo(128, 50); g.lineTo(140, 110); g.lineTo(200, 150); g.lineTo(200, 162); g.lineTo(140, 150); g.lineTo(138, 190); g.lineTo(158, 205);
        g.lineTo(98, 205); g.lineTo(118, 190); g.lineTo(116, 150); g.lineTo(56, 162); g.lineTo(56, 150); g.lineTo(116, 110); g.closePath(); g.stroke();
        const W2 = cfg.weapons;
        for (let i = 0; i < W2.missileCount; i++) {
          const x = i === 0 ? 40 : 216, ready = i < me.missiles;
          g.fillStyle = ready ? G : GD; g.fillText(ready ? '9X' : '--', x, 140);
        }
        g.fillStyle = G;
        const sel = (label, on, x, y) => { g.fillText(label, x, y); if (on) g.strokeRect(x - 34, y - 12, 68, 24); };
        sel('GUN', me.weapon === 'cannon', 70, 232); sel('AIM-9', me.weapon === 'missile', 186, 232);
        g.fillText(me.overheated ? 'GUN HOT' : `HEAT ${Math.round((me.cannonHeat || 0) * 100)}`, 128, 40);
        const cd = Math.max(0, me.counterReadyT - sim.t);
        g.fillText(`${me.loadout === 'ecm' ? 'ECM' : 'FLR'} ${cd > 0 ? cd.toFixed(0) + 's' : 'RDY'}`, 128, 118);
      } else {
        // Energy page: the 313 game in one glance
        g.textAlign = 'center'; g.fillText('ENERGY', 128, 16);
        const s = me.speed, map = (v) => 30 + BF.clamp((v - 240) / 160, 0, 1) * 196;
        g.fillStyle = GD; g.fillRect(map(300), 60, map(320) - map(300), 34);
        g.strokeStyle = G; g.strokeRect(30, 60, 196, 34);
        g.fillStyle = G; g.fillRect(map(313) - 1, 54, 2, 46);
        g.fillStyle = '#fff'; g.fillRect(map(s) - 2, 56, 4, 42);
        g.fillStyle = G; g.font = 'bold 34px Consolas, monospace'; g.fillText(String(Math.round(s)), 128, 130);
        g.font = 'bold 16px Consolas, monospace';
        const c = me.ctl, st = c.brake > 0.05 ? 'SPD BRK' : me.boosting ? 'AB' : c.throttleUp > 0.05 ? 'MIL+' : 'CRUISE';
        g.fillText(st, 128, 168);
        g.textAlign = 'left'; g.fillText('AB', 30, 206);
        g.strokeRect(60, 198, 166, 16); g.fillRect(60, 198, 166 * me.boostTank / cfg.flight.boostSeconds, 16);
        g.fillText(`ALT ${Math.round(me.altitude)}`, 30, 238); g.textAlign = 'right'; g.fillText(`${Math.round(me.pitchRateMax || 0)}°/s`, 226, 238);
      }
      g.textAlign = 'left';
      m.tex.needsUpdate = true;
    }
  }
};
