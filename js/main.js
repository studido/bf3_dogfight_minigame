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

  $('build').textContent = BF.BUILD;
  // ---------- Match setup ----------
  const opts = (() => { try { return JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); } catch (e) { return {}; } })();
  if (opts.name) $('opt-name').value = opts.name;
  if (opts.enemies) $('opt-enemies').value = opts.enemies;
  if (opts.wing != null) $('opt-wing').value = opts.wing;
  if (opts.loadout) $('opt-loadout').value = opts.loadout;
  if (opts.aiMissiles === false) $('opt-aimsl').checked = false;
  if (opts.aiDiff) $('opt-aidiff').value = opts.aiDiff;
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
    const o = { name: $('opt-name').value.trim() || 'Pilot', enemies: +$('opt-enemies').value, wing: +$('opt-wing').value, loadout: $('opt-loadout').value, aiMissiles: $('opt-aimsl').checked, aiEcm: $('opt-aiecm').value, camStyle: $('opt-camstyle').value, aiDiff: $('opt-aidiff').value };
    BF.applyAiDifficulty(cfg, o.aiDiff);
    cfg.camera.style = o.camStyle;
    cfg.ai.useMissiles = o.aiMissiles; cfg.ai.ecmMode = o.aiEcm;
    // Merge, so menu-only options (e.g. the speed/altitude HUD toggle) aren't wiped
    try { const prev = JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); localStorage.setItem('bf3dog.opts', JSON.stringify({ ...prev, ...o })); } catch (e) {}
    me = sim.addJet(0, o.name, false); me.loadout = o.loadout;
    ais = [];
    for (let i = 0; i < o.wing; i++) ais.push(new BF.AIPilot(sim, sim.addJet(0, WING[i], true)));
    for (let i = 0; i < o.enemies; i++) { const j = sim.addJet(1, ENEMY[i], true); ais.push(new BF.AIPilot(sim, j)); }
    applyAiLoadouts();
    for (const j of sim.jets) { const m = BF.buildJetModel(j.team); scene.add(m); models.set(j.id, m); j.prevPos = j.pos.clone(); j.prevQuat = j.quat.clone(); }
    sim.events.length = 0;
    camQ.copy(me.quat); camPos.copy(me.pos);
    $('p-loadout').value = me.loadout; $('p-aimsl').checked = cfg.ai.useMissiles; $('p-aidiff').value = cfg.ai.difficulty || 'medium'; $('p-aiecm').value = cfg.ai.ecmMode || 'off'; $('p-camstyle').value = cfg.camera.style;
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
    const showRoom = p && started && mp && net.room;
    $('p-room').style.display = showRoom ? '' : 'none';
    if (showRoom) $('p-roomcode').textContent = net.room.code;
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
  $('restart').onclick = () => { if (mp) endMatch(); else { newMatch(); setPaused(false); } };
  $('leavematch').onclick = () => endMatch();
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
  // Speed / altitude HUD boxes on or off (saved with the other menu options)
  let showFlightHud = opts.flightHud !== false;
  $('p-flighthud').checked = showFlightHud;
  $('p-flighthud').onchange = (e) => {
    showFlightHud = e.target.checked;
    try { const o = JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); o.flightHud = showFlightHud; localStorage.setItem('bf3dog.opts', JSON.stringify(o)); } catch (err) {}
  };
  $('p-aidiff').onchange = (e) => {
    BF.applyAiDifficulty(cfg, e.target.value); $('opt-aidiff').value = e.target.value;
    try { const o = JSON.parse(localStorage.getItem('bf3dog.opts') || '{}'); o.aiDiff = e.target.value; localStorage.setItem('bf3dog.opts', JSON.stringify(o)); } catch (err) {}
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

  // ---------- Online play (relay server) ----------
  const net = new BF.Net();
  let mp = false, netSlots = [];
  const NET_HZ = 30;
  let netAcc = 0;
  const myName = () => $('opt-name').value.trim() || 'Pilot';
  const setStatus = (t) => {
    const inLobby = $('lobby').style.display === 'flex';
    $(inLobby ? 'lobby-status' : 'mp-status').textContent = t;
  };
  $('opt-server').value = net.url;

  $('mp-create').onclick = () => {
    if (net.room) net.leave();
    net.setUrl($('opt-server').value.trim() || BF.NET_DEFAULT_URL);
    setStatus('Connecting…');
    net.create(myName());
  };
  $('mp-join').onclick = () => {
    const code = $('mp-code').value.trim().toUpperCase();
    if (code.length !== 4) { setStatus('Enter the 4-letter room code'); return; }
    if (net.room) net.leave();
    net.setUrl($('opt-server').value.trim() || BF.NET_DEFAULT_URL);
    setStatus('Connecting…');
    net.join(code, myName());
  };

  const DIFF_LABEL = { veryEasy: 'very easy', easy: 'easy', medium: 'medium', hard: 'hard', extreme: 'extremely hard' };
  function lobbySettings() {
    return {
      enemies: +$('lob-enemies').value, aiDiff: $('lob-aidiff').value,
      aiMissiles: $('lob-aimsl').checked, aiEcm: $('lob-aiecm').value,
      tune: { flight: cfg.flight, weapons: cfg.weapons, countermeasures: cfg.countermeasures },
    };
  }
  function pushLobbySettings() { if (net.isHost) net.setSettings(lobbySettings()); }
  for (const id of ['lob-enemies', 'lob-aidiff', 'lob-aimsl', 'lob-aiecm']) $(id).onchange = pushLobbySettings;

  function describeSettings(d) {
    d = d || {};
    return `AI: ${d.enemies ?? 0} ${DIFF_LABEL[d.aiDiff] || 'medium'} enemies · missiles ${d.aiMissiles === false ? 'off' : 'on'} · ECM ${d.aiEcm || 'mixed'}`;
  }
  function renderLobby() {
    const room = net.room;
    if (!room) return;
    $('lob-code').textContent = room.code;
    const meP = room.players.find((p) => p.id === net.myId);
    $('lobby-players').innerHTML = room.players.map((p) =>
      `<li>${p.name}${p.host ? ' <b>[HOST]</b>' : ''}${p.ready ? ' <b>[READY]</b>' : ''}${p.connected ? '' : ' [dropped]'}</li>`).join('');
    $('lob-ready').style.display = net.isHost ? 'none' : '';
    $('lob-ready').textContent = meP && meP.ready ? 'NOT READY' : 'READY';
    $('lob-start').style.display = net.isHost ? '' : 'none';
    $('lobby-hostopts').style.display = net.isHost ? 'grid' : 'none';
    if (!net.isHost) $('lobby-status').textContent = 'Waiting for the host to start.';
  }

  net.on('joined', (m) => {
    setStatus('');
    if (mp && started) { toast('Reconnected'); return; }
    if (m.started) { startMpMatch(net.room.seed); toast('Joined match in progress'); return; }
    $('start').style.display = 'none';
    $('lobby').style.display = 'flex';
    renderLobby();
    pushLobbySettings();
    if (!net.isHost && net.room.settings) $('lobby-hostnote').textContent = describeSettings(net.room.settings);
  });
  net.on('roster', () => { renderLobby(); syncMpRosterJets(); });

  // Roster changed while a match is running: give late joiners a jet and drop
  // jets whose owner left for good. Human jets are inserted before the AI block
  // and leavers fully removed, so slot indices always equal roster order — the
  // same layout a late-joining client builds from scratch.
  function syncMpRosterJets() {
    if (!mp || !started || !sim || !net.room) return;
    const players = net.room.players;
    for (const p of players) {
      if (netSlots.some((j) => !j.isAI && j.ownerNet === p.id)) continue;
      const j = sim.addJet(0, p.name, false);
      j.ownerNet = p.id; j.remote = p.id !== net.myId; j.netBuf = [];
      const mdl = BF.buildJetModel(0);
      scene.add(mdl); models.set(j.id, mdl);
      j.prevPos = j.pos.clone(); j.prevQuat = j.quat.clone();
      netSlots.splice(netSlots.filter((k) => !k.isAI).length, 0, j);
      hud.addFeed(`${p.name} connected`, '#7fd0ff');
    }
    for (let i = netSlots.length - 1; i >= 0; i--) {
      const j = netSlots[i];
      if (j.isAI || players.some((p) => p.id === j.ownerNet)) continue;
      netSlots.splice(i, 1);
      const k = sim.jets.indexOf(j); if (k >= 0) sim.jets.splice(k, 1);
      const mdl = models.get(j.id); if (mdl) { scene.remove(mdl); models.delete(j.id); }
    }
  }
  net.on('settings', (m) => { if (!net.isHost) $('lobby-hostnote').textContent = describeSettings(m.d); });
  net.on('error', (m) => setStatus(m.msg || m.code));
  net.on('reconnectWait', () => setStatus('Connection lost — retrying…'));
  net.on('close', () => { if (!started) setStatus('Disconnected'); else toast('Connection dropped — reconnecting…'); });

  $('lob-ready').onclick = () => {
    const meP = net.room && net.room.players.find((p) => p.id === net.myId);
    net.setReady(!(meP && meP.ready));
  };
  $('lob-start').onclick = () => net.start((Math.random() * 2 ** 31) | 0);
  $('lob-leave').onclick = () => { net.leave(); $('lobby').style.display = 'none'; $('start').style.display = 'flex'; setStatus(''); };

  net.on('ended', (m) => {
    if (started && mp) endMatch();
    else { $('lobby').style.display = 'none'; $('start').style.display = 'flex'; }
    toast('Match ended: ' + m.reason);
  });
  net.on('start', (m) => startMpMatch(m.seed));
  net.on('from', (m) => {
    if (!mp || !started || !sim) return;
    if (m.k === 'state') applyNetState(m.from, m.d && m.d.jets);
    else if (m.k === 'event') handleNetEvent(m.from, m.d);
  });

  function endMatch() {
    mp = false; started = false; netSlots = [];
    net.leave();
    paused = true;
    $('pause').style.display = 'none';
    $('lobby').style.display = 'none';
    $('start').style.display = 'flex';
    $('restart').textContent = 'Restart match';
    $('restart').style.display = '';
    audio.suspend(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function startMpMatch(seed) {
    audio.init();
    const d = (net.room && net.room.settings) || {};
    newMatchMp(seed, d);
    mp = true; started = true;
    $('lobby').style.display = 'none';
    $('start').style.display = 'none';
    $('restart').style.display = 'none';
    setPaused(false);
  }

  // All clients build the same jets in the same order: humans in join order, then
  // host-run AI enemies. Slot = index in netSlots; jet ids therefore match on every machine.
  function newMatchMp(seed, d) {
    while (scene.children.length) scene.remove(scene.children[0]);
    models.clear();
    if (d.tune) {
      if (d.tune.flight) Object.assign(cfg.flight, d.tune.flight);
      if (d.tune.weapons) Object.assign(cfg.weapons, d.tune.weapons);
      if (d.tune.countermeasures) Object.assign(cfg.countermeasures, d.tune.countermeasures);
    }
    BF.applyAiDifficulty(cfg, d.aiDiff || 'medium');
    cfg.ai.useMissiles = d.aiMissiles !== false;
    cfg.ai.ecmMode = d.aiEcm || 'off';
    sim = new BF.Sim(cfg, seed);
    world = BF.buildWorld(scene, sim.terrain, cfg);
    effects = new BF.Effects(scene);
    ais = [];
    netSlots = [];
    const players = net.room ? net.room.players : [];
    for (const p of players) {
      const j = sim.addJet(0, p.name, false);
      j.ownerNet = p.id; j.remote = p.id !== net.myId; j.netBuf = [];
      if (!j.remote) { me = j; j.loadout = $('opt-loadout').value; j.counterReadyT = sim.t + 2; }
      netSlots.push(j);
    }
    const nAi = Math.max(0, Math.min(4, +(d.enemies ?? 3)));
    for (let i = 0; i < nAi; i++) {
      const j = sim.addJet(1, ENEMY[i % ENEMY.length], true);
      j.ownerNet = net.room.hostId; j.remote = !net.isHost; j.netBuf = [];
      j.loadout = cfg.ai.ecmMode !== 'off' ? 'ecm' : (i % 2 ? 'ecm' : 'flares');
      if (net.isHost) ais.push(new BF.AIPilot(sim, j));
      netSlots.push(j);
    }
    for (const j of sim.jets) {
      const mdl = BF.buildJetModel(j.team);
      scene.add(mdl); models.set(j.id, mdl);
      j.prevPos = j.pos.clone(); j.prevQuat = j.quat.clone();
    }
    sim.events.length = 0;
    camQ.copy(me.quat); camPos.copy(me.pos);
    $('p-loadout').value = me.loadout; $('p-aimsl').checked = cfg.ai.useMissiles; $('p-aidiff').value = cfg.ai.difficulty || 'medium'; $('p-aiecm').value = cfg.ai.ecmMode || 'off'; $('p-camstyle').value = cfg.camera.style;
  }

  function slotOf(j) { return j ? netSlots.indexOf(j) : -1; }

  function sendNetState() {
    const jets = [];
    for (let s = 0; s < netSlots.length; s++) {
      const j = netSlots[s];
      if (j.remote) continue;
      const flags = (j.alive ? 1 : 0) | (j.boosting ? 2 : 0) | (j.firing ? 4 : 0);
      jets.push([s, +j.pos.x.toFixed(1), +j.pos.y.toFixed(1), +j.pos.z.toFixed(1),
        +j.quat.x.toFixed(3), +j.quat.y.toFixed(3), +j.quat.z.toFixed(3), +j.quat.w.toFixed(3),
        Math.round(j.speed), +j.health.toFixed(1), flags, j.weapon === 'missile' ? 1 : 0, j.missiles]);
    }
    net.sendState({ jets });
  }

  function applyNetState(fromId, jets) {
    if (!jets) return;
    const at = performance.now() * 0.001;
    for (const a of jets) {
      const j = netSlots[a[0]];
      if (!j || !j.remote || j.ownerNet !== fromId) continue;
      const [, x, y, z, qx, qy, qz, qw, spd, hp, flags, wpn, msl] = a;
      (j.netBuf = j.netBuf || []).push({ at, x, y, z, qx, qy, qz, qw });
      if (j.netBuf.length > 12) j.netBuf.shift();
      j.pos.set(x, y, z);
      j.quat.set(qx, qy, qz, qw).normalize();
      BF.forwardOf(j.quat, j.vel).multiplyScalar(spd * BF.KMH * (cfg.flight.groundSpeedScale || 1));
      j.speed = spd; j.health = hp; j.missiles = msl; j.weapon = wpn ? 'missile' : 'cannon';
      const wasAlive = j.alive;
      j.alive = !!(flags & 1); j.boosting = !!(flags & 2); j.netFiring = !!(flags & 4);
      if (!wasAlive && j.alive) sim.events.push({ type: 'spawn', jet: j.id });
    }
  }

  // Outbound: report what my sim decided about jets owned by others.
  function forwardEvent(ev) {
    const src = ev.jet != null ? sim.jet(ev.jet) : null;
    if (ev.type === 'hit' && ev.remote && src) {
      net.sendEvent({
        kind: 'hit', jetSlot: slotOf(src), bySlot: slotOf(sim.jet(ev.by)),
        dmg: ev.kind === 'missile' ? cfg.weapons.missileDamage : cfg.weapons.cannonDamage,
        w: ev.kind === 'missile' ? 'm' : 'c',
      });
    } else if (ev.type === 'kill' && src && !src.remote) {
      net.sendEvent({ kind: 'kill', jetSlot: slotOf(src), bySlot: ev.by != null ? slotOf(sim.jet(ev.by)) : -1, how: ev.how });
    } else if ((ev.type === 'flares' || ev.type === 'ecm') && src && !src.remote) {
      net.sendEvent({ kind: 'cm', jetSlot: slotOf(src), what: ev.type });
    } else if (ev.type === 'missileLaunch' && src && !src.remote) {
      net.sendEvent({ kind: 'msl', jetSlot: slotOf(src), targetSlot: ev.target != null ? slotOf(sim.jet(ev.target)) : -1 });
    }
  }

  // Inbound: the owner of a jet applies damage/kills; visuals replicate everywhere.
  function handleNetEvent(fromId, d) {
    if (!d || d.jetSlot == null) return;
    const j = netSlots[d.jetSlot];
    if (!j) return;
    const byJet = d.bySlot != null && d.bySlot >= 0 ? netSlots[d.bySlot] : null;
    switch (d.kind) {
      case 'hit':
        if (j.remote) break; // not mine; that owner applies it
        sim.applyNetDamage(j.id, d.dmg, byJet ? byJet.id : null, d.w === 'm' ? 'missile' : 'cannon');
        break;
      case 'kill':
        if (!j.remote) break; // mine; my sim already announced it
        sim.applyNetKill(j.id, byJet ? byJet.id : null, d.how);
        break;
      case 'cm':
        if (j.remote) sim.applyRemoteCm(j, d.what);
        break;
      case 'msl':
        if (j.remote) sim.launchRemoteMissile(j, d.targetSlot != null && d.targetSlot >= 0 ? netSlots[d.targetSlot].id : undefined);
        break;
    }
  }

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
      if (mp) forwardEvent(ev);
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
      if (mp && net.room) {
        netAcc += dt;
        const stepT = 1 / NET_HZ;
        while (netAcc >= stepT) { netAcc -= stepT; sendNetState(); }
      }
    }
    const alpha = paused ? 1 : acc / STEP;
    // Sync models (interpolated)
    for (const j of sim.jets) {
      const m = models.get(j.id);
      m.visible = j.alive;
      if (!j.alive) continue;
      if (j.remote) {
        const b = j.netBuf;
        if (b && b.length) {
          const rt = now * 0.001 - 0.12;
          let i = 0;
          while (i < b.length - 1 && b[i + 1].at <= rt) i++;
          const a = b[i], nxt = b[Math.min(i + 1, b.length - 1)];
          const k = nxt.at > a.at ? BF.clamp((rt - a.at) / (nxt.at - a.at), 0, 1) : 1;
          m.position.set(BF.lerp(a.x, nxt.x, k), BF.lerp(a.y, nxt.y, k), BF.lerp(a.z, nxt.z, k));
          tmpQ.set(a.qx, a.qy, a.qz, a.qw); iQuat.set(nxt.qx, nxt.qy, nxt.qz, nxt.qw);
          m.quaternion.slerpQuaternions(tmpQ, iQuat, k);
        } else { m.position.copy(j.pos); m.quaternion.copy(j.quat); }
        m.userData.setThrottle(j.netFiring ? 0.8 : 0.4, j.boosting);
        m.userData.missiles.forEach((mm2, i2) => (mm2.visible = i2 < j.missiles));
        if (j.netFiring && j.weapon === 'cannon') {
          j.netFireCd = (j.netFireCd || 0) - dt;
          if (j.netFireCd < -0.2) j.netFireCd = 0;
          while (j.netFireCd <= 0) { j.netFireCd += 1 / cfg.weapons.cannonRps; sim.fireRound(j, true); }
        } else j.netFireCd = 0;
        continue;
      }
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
    hud.draw(dt, { sim, me, cam: camera, camMode, cfg, effects, paused, combiner, showFlightHud });
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
