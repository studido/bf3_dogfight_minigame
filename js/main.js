// Game bootstrap: fixed-step sim, rendering, camera, menus.
(() => {
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const cfg = BF.CONFIG, STEP = 1 / 60;
  const $ = (id) => document.getElementById(id);

  // ---------- Renderer / scene ----------
  const glCanvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  // Linear output with no tone mapping keeps custom shaders (sky, particles) and
  // built-in materials consistent, so the fogged horizon meets the sky without a seam.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(cfg.camera.baseFov, 1, 0.5, 30000);
  const hud = new BF.HUD($('hud'));
  const input = new BF.Input(glCanvas);
  const audio = new BF.Audio();
  let sim, world, effects, me, ais = [], models = new Map();
  let camMode = 'chase', paused = true, started = false;
  const camQ = new Q(), camPos = new V3();

  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    hud.resize(w, h, Math.min(devicePixelRatio, 2));
  };
  addEventListener('resize', resize); resize();

  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2500); };

  // ---------- Match setup ----------
  const opts = (() => { try { return JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); } catch (e) { return {}; } })();
  if (opts.name) $('opt-name').value = opts.name;
  if (opts.enemies) $('opt-enemies').value = opts.enemies;
  if (opts.wing != null) $('opt-wing').value = opts.wing;
  if (opts.loadout) $('opt-loadout').value = opts.loadout;
  if (opts.aiMissiles === false) $('opt-aimsl').checked = false;
  if (opts.aiEcm) $('opt-aiecm').value = opts.aiEcm === true ? 'threat' : opts.aiEcm;
  if (opts.camStyle) $('opt-camstyle').value = opts.camStyle;
  cfg.camera.style = $('opt-camstyle').value;

  const ENEMY = ['Viper', 'Hex', 'Rook', 'Ghost', 'Talon', 'Nomad'], WING = ['Jester', 'Mako', 'Frost'];

  function newMatch() {
    // Tear down old scene
    while (scene.children.length) scene.remove(scene.children[0]);
    models.clear();
    const seed = 1337;
    sim = new BF.Sim(cfg, seed);
    world = BF.buildWorld(scene, sim.terrain, cfg);
    effects = new BF.Effects(scene);
    const o = { name: $('opt-name').value.trim() || 'Pilot', enemies: +$('opt-enemies').value, wing: +$('opt-wing').value, loadout: $('opt-loadout').value, aiMissiles: $('opt-aimsl').checked, aiEcm: $('opt-aiecm').value, camStyle: $('opt-camstyle').value };
    cfg.camera.style = o.camStyle;
    cfg.ai.useMissiles = o.aiMissiles; cfg.ai.ecmMode = o.aiEcm;
    try { localStorage.setItem('bf3dog.opts', JSON.stringify(o)); } catch (e) {}
    me = sim.addJet(0, o.name, false); me.loadout = o.loadout;
    ais = [];
    for (let i = 0; i < o.wing; i++) ais.push(new BF.AIPilot(sim, sim.addJet(0, WING[i], true)));
    for (let i = 0; i < o.enemies; i++) { const j = sim.addJet(1, ENEMY[i], true); ais.push(new BF.AIPilot(sim, j)); }
    applyAiLoadouts();
    for (const j of sim.jets) { const m = BF.buildJetModel(j.team); scene.add(m); models.set(j.id, m); j.prevPos = j.pos.clone(); j.prevQuat = j.quat.clone(); }
    sim.events.length = 0;
    camQ.copy(me.quat); camPos.copy(me.pos);
    $('p-loadout').value = me.loadout; $('p-aimsl').checked = cfg.ai.useMissiles; $('p-aiecm').value = cfg.ai.ecmMode || 'off'; $('p-camstyle').value = cfg.camera.style;
  }

  // AI countermeasures: ECM mode gives every AI the jammer; otherwise enemies alternate
  // flares / ECM and wingmen carry flares.
  function applyAiLoadouts() {
    let e = 0;
    for (const a of ais) { const j = a.jet; j.loadout = cfg.ai.ecmMode && cfg.ai.ecmMode !== 'off' ? 'ecm' : j.team === 1 ? (e++ % 2 ? 'ecm' : 'flares') : 'flares'; }
  }

  // ---------- Menus ----------
  let pauseChangedAt = 0;
  function setPaused(p) {
    if (performance.now() - pauseChangedAt < 250) return; // Esc both unlocks the mouse and fires keydown
    pauseChangedAt = performance.now();
    paused = p;
    $('pause').style.display = p && started ? 'flex' : 'none';
    audio.suspend(p);
    if (p && document.pointerLockElement) document.exitPointerLock();
    if (!p) { glCanvas.requestPointerLock && glCanvas.requestPointerLock(); }
    if (p) renderBinds();
  }
  $('play').onclick = () => {
    audio.init(); newMatch(); started = true; $('start').style.display = 'none'; setPaused(false);
    toast(BF.configReset || input.bindsReset ? 'Defaults updated: your old tuning/bindings were reset' : BF.configMigrated ? 'Afterburner default updated (your other tuning was kept)' : 'Click the screen to capture the mouse · F1 opens the tuning panel');
  };
  $('resume').onclick = () => setPaused(false);
  $('restart').onclick = () => { newMatch(); setPaused(false); };
  $('p-loadout').onchange = (e) => {
    me.loadout = e.target.value; me.counterReadyT = Math.max(me.counterReadyT, sim.t + 3);
    try { const o = JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); o.loadout = me.loadout; localStorage.setItem('bf3dog.opts', JSON.stringify(o)); } catch (err) {}
  };
  const S = input.settings;
  $('p-sens').value = S.mouseSensitivity; $('p-sens').oninput = (e) => { S.mouseSensitivity = +e.target.value; input.save(); };
  $('p-invm').checked = S.mouseInvertY; $('p-invm').onchange = (e) => { S.mouseInvertY = e.target.checked; input.save(); };
  $('p-invp').checked = S.padInvertY; $('p-invp').onchange = (e) => { S.padInvertY = e.target.checked; input.save(); };
  $('p-stick').value = S.padFlightStick || 'right'; $('p-stick').onchange = (e) => { S.padFlightStick = e.target.value; input.save(); };
  $('p-aimsl').onchange = (e) => {
    cfg.ai.useMissiles = e.target.checked; $('opt-aimsl').checked = e.target.checked;
    try { const o = JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); o.aiMissiles = e.target.checked; localStorage.setItem('bf3dog.opts', JSON.stringify(o)); } catch (err) {}
  };
  $('p-aiecm').onchange = (e) => {
    cfg.ai.ecmMode = e.target.value; $('opt-aiecm').value = e.target.value; applyAiLoadouts();
    try { const o = JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); o.aiEcm = e.target.value; localStorage.setItem('bf3dog.opts', JSON.stringify(o)); } catch (err) {}
  };
  $('p-camstyle').onchange = (e) => {
    cfg.camera.style = e.target.value; $('opt-camstyle').value = e.target.value;
    try { const o = JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); o.camStyle = e.target.value; localStorage.setItem('bf3dog.opts', JSON.stringify(o)); } catch (err) {}
  };
  $('p-vol').value = audio.volume; $('p-vol').oninput = (e) => audio.setVolume(+e.target.value);
  $('resetbinds').onclick = () => { input.binds = BF.cloneConfig(BF.DEFAULT_BINDS); input.save(); renderBinds(); };

  function renderBinds() {
    const box = $('binds'); box.innerHTML = '';
    for (const [act, label] of BF.ACTIONS) {
      const row = document.createElement('div'); row.className = 'bind';
      row.innerHTML = `<span>${label}</span>`;
      for (let slot = 0; slot < 3; slot++) {
        const b = document.createElement('button'); b.textContent = BF.Input.label(input.binds[act][slot]);
        b.onclick = (ev) => {
          ev.stopPropagation(); b.classList.add('listening'); b.textContent = 'press…';
          setTimeout(() => {
            input.listenCb = (code) => {
              input.listenCb = null;
              if (code === 'Delete' || code === 'Backspace') input.binds[act].splice(slot, 1);
              else if (code !== 'Escape') {
                for (const a of Object.keys(input.binds)) input.binds[a] = input.binds[a].filter((c) => c !== code); // unbind elsewhere
                input.binds[act][slot] = code; input.binds[act] = input.binds[act].filter(Boolean);
              }
              input.save(); renderBinds();
            };
          }, 150);
        };
        row.appendChild(b);
      }
      box.appendChild(row);
    }
  }
  // Mouse clicks while rebinding
  addEventListener('mousedown', (e) => { if (input.listenCb && e.target.closest && !e.target.closest('.bind')) input.listenCb('Mouse' + e.button); });

  const cockpit = new BF.Cockpit();
  let combiner = null;
  const tuning = new BF.TuningPanel($('ui'), () => (me && me.alive ? me.speed : null), () => me);

  input.onAction = (a, extra) => {
    if (a === 'padConnected') return toast('Controller connected: ' + String(extra).slice(0, 40));
    if (!started) return;
    if (a === 'pause') setPaused(!paused);
    if (a === 'camera') camMode = camMode === 'chase' ? 'cockpit' : 'chase';
    if (a === 'tuning') tuning.toggle();
  };
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && started && !paused && !tuning.open) setPaused(true);
  });

  // ---------- Events -> effects/audio/HUD ----------
  const howText = { cannon: 'cannon', missile: 'heat-seeker', crash: 'crashed', building: 'hit a building', boundary: 'deserted', collision: 'mid-air' };
  function handleEvents() {
    for (const ev of sim.events) {
      effects.handle(ev, sim);
      audio.event(ev, me, camera.position);
      if (ev.type === 'hit' || (ev.type === 'explode' && ev.missile)) {
        if (ev.by === me.id && ev.type === 'hit') hud.hitMarkerT = 0.12;
        if (ev.jet === me.id) hud.damageFlash = Math.min(1, hud.damageFlash + 0.25);
      }
      if (ev.type === 'kill') {
        const v = sim.jet(ev.jet), k = ev.by != null ? sim.jet(ev.by) : null;
        const col = (j) => (j.team === me.team ? '#7fd0ff' : '#ffb14a');
        if (k && k !== v) hud.addFeed(`${k.name}  [${howText[ev.how] || ev.how}]  ${v.name}`, col(k));
        else hud.addFeed(`${v.name}  [${howText[ev.how] || ev.how}]`, col(v));
        if (v === me) { me.killedBy = k && k !== me ? `by ${k.name} (${howText[ev.how]})` : howText[ev.how]; hud.damageFlash = 1; }
        if (k === me && v !== me) hud.flashMsg(`ENEMY DESTROYED  ${v.name}`, '#ffd84a', 2.5);
      }
      if (ev.type === 'missileDecoyed' && sim.flares.length) { /* visual handled by flares */ }
      if (ev.type === 'missileLost' && me.loadout === 'ecm' && sim.t < me.ecmUntil) hud.flashMsg('MISSILE JAMMED', '#8dff7a', 1.5);
      if (ev.type === 'ecm' && ev.jet !== me.id) {
        const j = sim.jet(ev.jet), d = j ? j.pos.distanceTo(me.pos) : Infinity;
        if (j && d < 3000) hud.addFeed(`${j.name}  [ECM JAMMING]  ${Math.round(d)}m`, '#ffd84a');
        if (j && j.team !== me.team && me.weapon === 'missile' && d < cfg.weapons.missileLockRange * 1.5) hud.flashMsg('LOCK JAMMED', '#ffd84a', 1.5);
      }
      if (ev.type === 'flares' && ev.jet === me.id && sim.missiles.some((m) => m.target && m.target.flare && sim.flares.includes(m.target.flare) && m.target.flare.owner === me.id)) hud.flashMsg('MISSILE DECOYED', '#8dff7a', 1.5);
    }
    sim.events.length = 0;
  }

  // ---------- Camera ----------
  const tmpV = new V3(), tmpV2 = new V3(), tmpQ = new Q(), rollCam = new BF.RollCam();
  let fov = cfg.camera.baseFov, shake = 0;
  function updateCamera(dt, pos, quat) {
    const C = cfg.camera;
    const model = models.get(me.id);
    if (camMode === 'cockpit' && me.alive) {
      model.visible = false;
      camera.position.copy(pos).add(tmpV.set(0, 0.95, -4.2).applyQuaternion(quat));
      camera.quaternion.copy(quat);
      if (me.ctl.lookBack) camera.quaternion.multiply(tmpQ.setFromAxisAngle(new V3(0, 1, 0), Math.PI));
    } else if (C.style === 'roll' && me.alive) {
      // BF3 roll cam: level horizon, lagged + clamped pitch, jet rolls freely in frame.
      const r = rollCam.update(dt, pos, quat, C, me.ctl.lookBack, sim.t, camera);
      camera.position.copy(r.position);
      const g = sim.terrain.height(camera.position.x, camera.position.z) + 3;
      if (camera.position.y < g) camera.position.y = g;
      camera.up.copy(r.up);
      camera.lookAt(tmpV.copy(camera.position).add(r.look));
      camPos.copy(camera.position); camQ.copy(quat); // keeps a switch back to full chase smooth
    } else {
      // Full chase: camera orientation lags the jet, so the jet banks/pitches within the frame.
      camQ.slerp(quat, 1 - Math.exp(-C.rollLag * dt));
      const back = me.ctl.lookBack ? -1 : 1;
      const offset = tmpV.set(0, C.chaseHeight, C.chaseDistance * back).applyQuaternion(camQ);
      const target = tmpV2.copy(pos).add(offset);
      camPos.lerp(target, 1 - Math.exp(-C.positionLag * 6 * dt));
      if (!me.alive) camPos.copy(pos).add(tmpV.set(0, 30, 60));
      camera.position.copy(camPos);
      const g = sim.terrain.height(camera.position.x, camera.position.z) + 3;
      if (camera.position.y < g) camera.position.y = g;
      camera.up.set(0, 1, 0).applyQuaternion(camQ);
      camera.lookAt(tmpV.copy(pos).add(BF.forwardOf(camQ, tmpV2).multiplyScalar(40 * back)));
    }
    // FOV widens with speed / afterburner, small shake on guns
    const wantFov = C.baseFov + BF.clamp((me.speed - cfg.flight.cruiseSpeed) / 250, 0, 1) * (C.boostFov - C.baseFov) * 0.6 + (me.boosting ? (C.boostFov - C.baseFov) * 0.4 : 0);
    fov = BF.damp(fov, me.alive ? wantFov : C.baseFov, 3, dt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    shake = me.firing ? 0.06 : BF.damp(shake, 0, 10, dt);
    if (shake > 0.001) camera.rotateZ((Math.random() - 0.5) * shake * 0.1), camera.rotateX((Math.random() - 0.5) * shake * 0.08);
  }

  // ---------- Main loop ----------
  let last = performance.now(), acc = 0, pendSwitch = false, pendCounter = false, pendFire = false, pendSelect = null;
  const iPos = new V3(), iQuat = new Q();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!started) { renderer.render(scene, camera); return; }
    const ctl = input.poll(dt);
    me.ctlDevice = input.lastDevice;
    if (!paused) {
      acc += dt;
      // Edge-triggered buttons are held until a sim step consumes them (high-Hz monitors)
      pendSwitch = pendSwitch || ctl.switchWeapon; pendCounter = pendCounter || ctl.counter;
      pendSelect = ctl.selectWeapon || pendSelect; pendFire = pendFire || ctl.fire;
      while (acc >= STEP) {
        me.ctl = { ...ctl, fire: pendFire, switchWeapon: pendSwitch, selectWeapon: pendSelect, counter: pendCounter };
        pendSwitch = pendCounter = pendFire = false; pendSelect = null;
        for (const a of ais) a.update(STEP);
        for (const j of sim.jets) { j.prevPos.copy(j.pos); j.prevQuat.copy(j.quat); }
        sim.step(STEP);
        acc -= STEP;
      }
      handleEvents();
    }
    const alpha = paused ? 1 : acc / STEP;
    // Sync models (interpolated)
    for (const j of sim.jets) {
      const m = models.get(j.id);
      m.visible = j.alive;
      if (!j.alive) continue;
      m.position.lerpVectors(j.prevPos, j.pos, alpha);
      m.quaternion.slerpQuaternions(j.prevQuat, j.quat, alpha);
      const thr = j.ctl.brake > 0.05 ? 0 : j.ctl.throttleUp > 0.05 ? 0.8 : 0.4;
      m.userData.setThrottle(thr, j.boosting);
      m.userData.missiles.forEach((mm, i) => (mm.visible = i < j.missiles));
    }
    const mm = models.get(me.id);
    iPos.copy(me.alive ? mm.position : me.pos); iQuat.copy(me.alive ? mm.quaternion : me.quat);
    updateCamera(dt, iPos, iQuat);
    world.update(camera.position, sim.t);
    effects.update(paused ? 0 : dt, sim, camera, innerHeight * renderer.getPixelRatio());
    renderer.render(scene, camera);
    combiner = null;
    if (camMode === 'cockpit' && me.alive && !me.ctl.lookBack) {
      cockpit.sync(camera, world.sunDir);
      cockpit.updateMFDs(dt, me, sim, cfg);
      cockpit.render(renderer);
      combiner = cockpit.combinerRect(innerWidth, innerHeight);
    }
    hud.draw(dt, { sim, me, cam: camera, camMode, cfg, effects, paused, combiner });
    audio.update(me, sim, cfg);
    tuning.draw(dt);
  }
  // Idle backdrop behind the start screen
  (() => {
    const s = new BF.Sim(cfg, 1337); BF.buildWorld(scene, s.terrain, cfg);
    camera.position.set(-600, 520, 2600); camera.lookAt(0, 250, 0);
  })();
  requestAnimationFrame(frame);

  // Expose for debugging / future netcode
  window.game = { get sim() { return sim; }, get me() { return me; }, input, camera };
})();
