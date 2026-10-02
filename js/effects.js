// Particles (smoke, fire, flares, ECM clouds, vapor), tracers, explosions, muzzle flashes.
// v0.1.45: particles are textured from an atlas built from Kenney's Particle Pack (CC0,
// assets/particles.js): billowy smoke, fire puffs, muzzle flashes, sparks, star glints,
// a blast burst, debris and a shockwave ring. Each particle has its own cell, rotation and
// spin. Until the atlas loads (or if it's missing) particles fall back to soft round dots.
window.BF = window.BF || {};

(() => {
  const V3 = THREE.Vector3;

  class Particles {
    constructor(scene, max, additive) {
      this.max = max; this.list = [];
      const geo = new THREE.BufferGeometry();
      this.aPos = new Float32Array(max * 3); this.aCol = new Float32Array(max * 3);
      this.aSize = new Float32Array(max); this.aAlpha = new Float32Array(max);
      this.aTex = new Float32Array(max); this.aRot = new Float32Array(max);
      geo.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(this.aCol, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('size', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('alpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('tex', new THREE.BufferAttribute(this.aTex, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('rot', new THREE.BufferAttribute(this.aRot, 1).setUsage(THREE.DynamicDrawUsage));
      this.geo = geo;
      const mat = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 800 }, fogColor: { value: new THREE.Color(0xb9cad6) }, fogFar: { value: 7500 }, tAtlas: { value: null }, uAtlas: { value: 0 } },
        vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; attribute float tex; attribute float rot;
          varying vec3 vC; varying float vA; varying float vD; varying float vT; varying float vR;
          uniform float scale;
          void main(){ vC = color; vA = alpha; vT = tex; vR = rot; vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z;
            gl_PointSize = min(size * scale / max(-mv.z, 0.1), 900.0); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vC; varying float vA; varying float vD; varying float vT; varying float vR;
          uniform vec3 fogColor; uniform float fogFar; uniform sampler2D tAtlas; uniform float uAtlas;
          void main(){
            vec2 d = gl_PointCoord - 0.5;
            float a; vec3 shade = vec3(1.0);
            if (uAtlas > 0.5) {
              float cs = cos(vR), sn = sin(vR);
              vec2 q = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) + 0.5;   // rotated sprite
              if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) discard;
              vec2 cell = vec2(mod(vT, 4.0), floor(vT / 4.0));
              vec4 t = texture2D(tAtlas, (cell + vec2(q.x, 1.0 - q.y)) / 4.0);
              a = vA * t.a; shade = vec3(t.r);
              if (a < 0.004) discard;
            } else {
              float r = dot(d,d) * 4.0; if (r > 1.0) discard;
              a = vA * (1.0 - r) * (1.0 - r);
            }
            vec3 c = vC * shade;
            ${additive ? '' : 'c = mix(c, fogColor, clamp(vD / fogFar, 0.0, 1.0));'}
            gl_FragColor = vec4(c, a); }`,
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.mat = mat;
      this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; scene.add(this.points);
    }
    emit(p) { if (this.list.length >= this.max) this.list.shift(); p.age = 0; this.list.push(p); return p; }
    update(dt, viewportH, fov) {
      this.mat.uniforms.scale.value = viewportH / (2 * Math.tan(fov * BF.DEG / 2));
      let n = 0;
      const out = [];
      for (const p of this.list) {
        p.age += dt; if (p.age >= p.life) continue;
        if (p.vel) { p.vel.y -= (p.grav || 0) * dt; if (p.drag) p.vel.multiplyScalar(1 - p.drag * dt); p.pos.addScaledVector(p.vel, dt); }
        const t = p.age / p.life;
        this.aPos.set([p.pos.x, p.pos.y, p.pos.z], n * 3);
        this.aCol.set([p.col.r, p.col.g, p.col.b], n * 3);
        this.aSize[n] = BF.lerp(p.s0, p.s1, Math.sqrt(t));
        this.aAlpha[n] = p.a * (t < (p.fadeIn ?? 0.08) ? t / (p.fadeIn ?? 0.08) : 1 - Math.pow(t, p.fadePow || 1.5));
        this.aTex[n] = p.tex ?? 14; this.aRot[n] = (p.rot || 0) + (p.spin || 0) * p.age;
        n++; out.push(p);
      }
      this.list = out;
      this.geo.setDrawRange(0, n);
      for (const k of ['position', 'color', 'size', 'alpha', 'tex', 'rot']) this.geo.attributes[k].needsUpdate = true;
    }
  }

  // Atlas cells (see assets/particles.js)
  const T = { smoke: [0, 1, 2, 3], fire: [4, 5], muzzleSide: 6, muzzle: 7, spark: 8, star: 9, star2: 10, glint: 11, blast: 12, dirt: 13, soft: 14, ring: 15 };
  let atlasTex = null, atlasLoading = null;
  function loadAtlas() {
    if (atlasLoading) return atlasLoading;
    return (atlasLoading = new Promise((resolve) => {
      const done = () => {
        if (!(BF.ASSETS && BF.ASSETS.particles)) { resolve(null); return; }
        new THREE.TextureLoader().load(BF.ASSETS.particles, (t) => { delete BF.ASSETS.particles; atlasTex = t; resolve(t); }, undefined, () => resolve(null));
      };
      if (BF.ASSETS && BF.ASSETS.particles) { done(); return; }
      const el = document.createElement('script');
      el.src = 'assets/particles.js?v=' + (BF.BUILD || '');
      el.onload = done; el.onerror = () => resolve(null);
      (document.head || document.body).appendChild(el);
    }));
  }

  // Tracer streak texture: u across (glow profile), v along (0 tail .. 1 head)
  let tracerTex = null;
  function tracerTexture() {
    if (tracerTex) return tracerTex;
    const W = 32, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5, v = 1 - (y + 0.5) / H;          // canvas row 0 = head (flipY)
      const core = Math.exp(-(u * u) / 0.004), halo = Math.exp(-(u * u) / 0.03);
      const along = Math.pow(v, 1.6) * (1 - Math.max(0, v - 0.94) / 0.06 * 0.5);
      const i = (y * W + x) * 4, a = Math.min(1, (core * 1.0 + halo * 0.55) * along);
      d[i] = 255; d[i + 1] = 200 + 55 * core; d[i + 2] = 110 + 140 * core; d[i + 3] = a * 255;
    }
    g.putImageData(im, 0, 0);
    tracerTex = new THREE.CanvasTexture(c);
    return tracerTex;
  }

  const C = (h) => new THREE.Color(h);
  const WHITE = C(0xf2f2f2), SMOKE = C(0xd9d9d9), DARK = C(0x2c2a28), FIRE = C(0xff8a2a), HOT = C(0xffe2a0),
    ECM = C(0xeee8f6), FLARE = C(0xffb870), VAPOR = C(0xffffff), DUST = C(0x9a8f78);

  BF.Effects = class {
    constructor(scene) {
      this.scene = scene;
      this.smoke = new Particles(scene, 9000, false);
      this.fire = new Particles(scene, 2500, true);
      this.ecmPuffs = []; // for lens-smear test
      // Tracers
      // Tracers (v0.1.50): every round is a camera-facing glowing streak (white-hot core,
      // amber edges, bright head fading to the tail), widened with distance so a burst
      // stays readable from the cockpit at gun range. One dynamic mesh, one draw call.
      this.maxTr = 1200;
      this.trPos = new Float32Array(this.maxTr * 4 * 3); this.trUv = new Float32Array(this.maxTr * 4 * 2);
      const tIdx = new Uint16Array(this.maxTr * 6);
      for (let i = 0; i < this.maxTr; i++) { const o = i * 4; tIdx.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6); }
      for (let i = 0; i < this.maxTr; i++) this.trUv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
      tg.setAttribute('uv', new THREE.BufferAttribute(this.trUv, 2));
      tg.setIndex(new THREE.BufferAttribute(tIdx, 1));
      this.trGeo = tg;
      this.tracers = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: tracerTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      this.tracers.frustumCulled = false; scene.add(this.tracers);
      // Missile head glows
      this.missileVis = new Map(); this.fwdAxis = new V3(0, 0, -1);
      this.motorGlowMat = new THREE.SpriteMaterial({ map: BF.softTexture(), color: 0xffd9a0, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      // motor plume: additive cone pointing backwards (+z) from the missile's tail
      this.plumeGeo = new THREE.ConeGeometry(0.16, 2.4, 10, 1, true); this.plumeGeo.rotateX(Math.PI / 2); this.plumeGeo.translate(0, 0, 1.2);
      this.plumeMat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.glowMat = new THREE.SpriteMaterial({ map: BF.softTexture(), color: 0xfff0c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      this.r = Math.random;
      loadAtlas().then((t) => { if (!t) return; for (const P of [this.smoke, this.fire]) { P.mat.uniforms.tAtlas.value = t; P.mat.uniforms.uAtlas.value = 1; } });
    }
    pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
    rnd() { return this.r() * Math.PI * 2; }

    jitter(k) { return new V3((this.r() - 0.5) * k, (this.r() - 0.5) * k, (this.r() - 0.5) * k); }

    explosion(pos, size = 1, vel = null) {
      const carry = () => (vel ? vel.clone().multiplyScalar(0.3) : new V3());
      // initial blast flash + shockwave ring
      this.fire.emit({ pos: pos.clone(), vel: carry(), drag: 3, life: 0.2, s0: 18 * size, s1: 34 * size, col: HOT, a: 0.75, tex: T.blast, rot: this.rnd(), fadeIn: 0.01 });
      this.fire.emit({ pos: pos.clone(), vel: carry(), drag: 3, life: 0.45, s0: 10 * size, s1: 90 * size, col: C(0xffd9a0), a: 0.35, tex: T.ring, rot: this.rnd(), fadeIn: 0.01, fadePow: 0.7 });
      // rolling fireball
      for (let i = 0; i < 18 * size; i++) this.fire.emit({ pos: pos.clone().add(this.jitter(4 * size)), vel: this.jitter(45 * size).add(carry()), drag: 2.5, life: 0.45 + this.r() * 0.6, s0: 8 * size, s1: 22 * size, col: this.r() < 0.25 ? HOT : FIRE, a: 0.55, tex: this.pick(T.fire), rot: this.rnd(), spin: (this.r() - 0.5) * 3 });
      // sparks flung out
      for (let i = 0; i < 14 * size; i++) this.fire.emit({ pos: pos.clone(), vel: this.jitter(160 * size).add(carry()), drag: 1.2, grav: 9.8, life: 0.5 + this.r() * 0.7, s0: 1.6, s1: 0.8, col: HOT, a: 1, tex: T.spark, rot: this.rnd(), fadeIn: 0.01 });
      // dark smoke that lingers and rises
      for (let i = 0; i < 14 * size; i++) this.smoke.emit({ pos: pos.clone().add(this.jitter(8 * size)), vel: this.jitter(18 * size).add(carry()), drag: 1.2, grav: -2, life: 3.5 + this.r() * 3, s0: 10 * size, s1: 36 * size, col: DARK, a: 0.8, tex: this.pick(T.smoke), rot: this.rnd(), spin: (this.r() - 0.5) * 0.4 });
    }

    // Muzzle flash on the F/A-18's nose gun (top centre of the nose)
    muzzleFlash(j) {
      const p = j.dispPos || j.pos, q = j.dispQuat || j.quat;
      const fwd = BF.forwardOf(q, new V3()), up = BF.upOf(q, new V3());
      const at = p.clone().addScaledVector(fwd, 9.5).addScaledVector(up, 0.55).add(j.vel.clone().multiplyScalar(0.016));
      // seen from the cockpit the flash is only ~5 m away: keep it from swallowing the HUD
      const k = this.camPos ? BF.clamp(at.distanceTo(this.camPos) / 25, 0.3, 1) : 1;
      this.fire.emit({ pos: at, vel: j.vel.clone(), life: 0.045, s0: (3.2 + this.r() * 1.5) * k, s1: 2.5 * k, col: HOT, a: 1, tex: this.r() < 0.5 ? T.muzzle : T.star2, rot: this.rnd(), fadeIn: 0.01 });
      if (this.r() < 0.35) this.smoke.emit({ pos: at.clone(), vel: j.vel.clone().multiplyScalar(0.85).add(this.jitter(3)), drag: 2, life: 0.8, s0: 1.2, s1: 4, col: C(0xbfbfbf), a: 0.25, tex: this.pick(T.smoke), rot: this.rnd() });
    }

    handle(ev, sim) {
      switch (ev.type) {
        case 'explode': this.explosion(ev.pos, ev.size); break;
        case 'kill': {
          this.explosion(ev.pos, 1.8, ev.vel);
          // Falling burning debris
          for (let i = 0; i < 6; i++) {
            const d = { pos: ev.pos.clone(), vel: ev.vel.clone().multiplyScalar(0.5).add(this.jitter(50)), t: 2 + this.r() * 2 };
            (this.debris = this.debris || []).push(d);
          }
          break;
        }
        case 'shot': { const j = sim.jets.find((x) => x.id === ev.jet); if (j && j.alive) this.muzzleFlash(j); break; }
        case 'impact':
          this.smoke.emit({ pos: ev.pos.clone(), vel: new V3(0, 6, 0), life: 1.4, s0: 2, s1: 8, col: DUST, a: 0.65, tex: this.pick(T.smoke), rot: this.rnd() });
          if (this.r() < 0.5) this.smoke.emit({ pos: ev.pos.clone(), vel: new V3(0, 10, 0).add(this.jitter(6)), grav: 9.8, life: 0.7, s0: 3, s1: 4, col: C(0x5e5444), a: 0.9, tex: T.dirt, rot: this.rnd() });
          break;
        case 'hit': {
          // Cannon strike on a jet: bright flash, sparks and a small dark smoke puff that ride
          // along with the target, scaled up with distance so hits read at gun range.
          const j = sim.jets.find((x) => x.id === ev.jet), v = ev.vel ? ev.vel.clone() : j ? j.vel.clone() : new V3();
          const k = this.camPos ? BF.clamp(ev.pos.distanceTo(this.camPos) / 220, 1, 3.5) : 1;
          this.fire.emit({ pos: ev.pos.clone(), vel: v.clone(), life: 0.09, s0: 4 * k, s1: 6 * k, col: HOT, a: 1, tex: T.star, rot: this.rnd(), fadeIn: 0.01 });
          this.fire.emit({ pos: ev.pos.clone(), vel: v.clone(), life: 0.14, s0: 3 * k, s1: 5 * k, col: FIRE, a: 0.8, tex: this.pick(T.fire), rot: this.rnd(), fadeIn: 0.01 });
          for (let i = 0; i < 6; i++) this.fire.emit({ pos: ev.pos.clone(), vel: v.clone().add(this.jitter(70)), grav: 9.8, life: 0.35 + this.r() * 0.2, s0: 0.9 * k, s1: 0.5 * k, col: HOT, a: 1, tex: T.spark, rot: this.rnd(), fadeIn: 0.01 });
          this.smoke.emit({ pos: ev.pos.clone(), vel: v.clone().multiplyScalar(0.85).add(this.jitter(4)), drag: 1.5, life: 0.9 + this.r() * 0.4, s0: 1.5 * k, s1: 5 * k, col: C(0x4a4642), a: 0.7, tex: this.pick(T.smoke), rot: this.rnd(), spin: (this.r() - 0.5) * 2 });
          break;
        }
        case 'ecmPuff': {
          const cfg = sim.cfg.countermeasures;
          for (let i = 0; i < 3; i++) {
            const p = this.smoke.emit({ pos: ev.pos.clone().add(this.jitter(10)), vel: ev.vel.clone().multiplyScalar(0.12).add(this.jitter(8)), drag: 0.8,
              life: cfg.ecmCloudLife * (0.7 + this.r() * 0.5), s0: 12, s1: 48, col: ECM, a: 0.85, fadePow: 2.5, tex: this.pick(T.smoke), rot: this.rnd(), spin: (this.r() - 0.5) * 0.3 });
            this.ecmPuffs.push(p);
          }
          break;
        }
      }
    }

    update(dt, sim, camera, viewportH) {
      this.camPos = camera.position;
      // Missiles (v0.1.47): the jet model's own missile in flight, a flickering motor plume
      // and glow at the tail, and a continuous smoke trail laid down by distance (every
      // ~2.2 m along the path, so it's unbroken at any frame rate) that billows, drifts
      // and lingers. Right after launch the model slides off its pylon onto the sim path.
      const alive = new Set(), MI = BF.missileModel ? BF.missileModel() : null;
      for (const m of sim.missiles) {
        alive.add(m.id);
        let v = this.missileVis.get(m.id);
        if (!v) {
          v = { group: new THREE.Group(), last: m.pos.clone(), t: 0, off: new V3() };
          if (MI) v.group.add(MI.obj.clone(true));
          else { const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 8), new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.5 })); body.rotation.x = Math.PI / 2; v.group.add(body); }
          const L = MI ? MI.length : 3;
          const plume = new THREE.Mesh(this.plumeGeo, this.plumeMat); plume.position.z = L / 2; v.group.add(plume); v.plume = plume;
          const glow = new THREE.Sprite(this.motorGlowMat); glow.position.z = L / 2 + 0.25; glow.scale.set(2, 2, 1); v.group.add(glow); v.glow = glow;
          // launched from a pylon: start the model there and blend onto the sim path
          const j = sim.jets.find((x) => x.id === m.owner);
          if (j && MI) {
            const side = BF.clamp(j.missiles, 0, 1); // the one just fired (see jet-model.js)
            const rail = MI.rails[side].clone().applyQuaternion(j.dispQuat || j.quat).add(j.dispPos || j.pos);
            v.off.copy(rail).sub(m.pos);
            // launch puff: a quick burst of motor smoke at the rail
            for (let i = 0; i < 8; i++) this.smoke.emit({ pos: rail.clone().add(this.jitter(2)), vel: j.vel.clone().multiplyScalar(0.6).add(this.jitter(10)), drag: 2.5, life: 1.8 + this.r(), s0: 2, s1: 9, col: SMOKE, a: 0.55, tex: this.pick(T.smoke), rot: this.rnd() });
            this.fire.emit({ pos: rail.clone(), vel: j.vel.clone(), life: 0.12, s0: 6, s1: 4, col: HOT, a: 1, tex: T.blast, rot: this.rnd(), fadeIn: 0.01 });
          }
          v.last.copy(m.pos).add(v.off);
          this.scene.add(v.group); this.missileVis.set(m.id, v);
        }
        v.t += dt;
        const pos = m.pos.clone().addScaledVector(v.off, Math.exp(-v.t / 0.12));
        v.group.position.copy(pos);
        v.group.quaternion.setFromUnitVectors(this.fwdAxis, m.dir);
        const fl = 0.75 + this.r() * 0.5; v.plume.scale.set(1, 1, fl); v.glow.scale.setScalar(1.8 + this.r() * 0.8);
        // trail: particles spaced along the path since last frame, starting at the tail
        const tail = pos.clone().addScaledVector(m.dir, -((MI ? MI.length : 3) / 2 + 0.6));
        const seg = tail.clone().sub(v.last), len = seg.length(), step = 2.2;
        const n = Math.min(60, Math.floor(len / step));
        for (let i = 1; i <= n; i++) {
          const p = v.last.clone().addScaledVector(seg, (i * step) / len);
          this.smoke.emit({ pos: p, vel: this.jitter(1.2).add(new V3(0, 0.4, 0)), drag: 0.3, life: 5 + this.r() * 2.5, s0: 1.6, s1: 13 + this.r() * 5, col: SMOKE, a: 0.5, fadeIn: 0.02, fadePow: 1.2, tex: this.pick(T.smoke), rot: this.rnd(), spin: (this.r() - 0.5) * 0.4 });
          if (i % 3 === 0) this.fire.emit({ pos: p.clone(), vel: null, life: 0.07, s0: 2.5, s1: 1.5, col: FIRE, a: 0.8, tex: this.pick(T.fire), rot: this.rnd() });
        }
        if (n > 0) v.last.addScaledVector(seg, (n * step) / len);
      }
      for (const [id, v] of this.missileVis) if (!alive.has(id)) { this.scene.remove(v.group); this.missileVis.delete(id); }

      // Flares
      for (const f of sim.flares) {
        if (f.delay > 0) continue;
        this.fire.emit({ pos: f.pos.clone(), vel: null, life: 0.1, s0: 9 + this.r() * 4, s1: 6, col: this.r() < 0.5 ? HOT : FLARE, a: 1, tex: this.r() < 0.5 ? T.star : T.glint, rot: this.rnd(), fadeIn: 0.01 });
        if (this.r() < 0.6) this.smoke.emit({ pos: f.pos.clone(), vel: this.jitter(2), life: 2.4, s0: 1.8, s1: 7, col: WHITE, a: 0.45, tex: this.pick(T.smoke), rot: this.rnd() });
      }

      // Jets: wingtip vapour in hard pulls, damage smoke
      for (const j of sim.jets) {
        if (!j.alive) continue;
        const jp = j.dispPos || j.pos, jq = j.dispQuat || j.quat; // remote jets: on-screen transform
        const right = BF.rightOf(jq, new V3()), fwd = BF.forwardOf(jq, new V3());
        if (Math.abs(j.rates.p) > 38) {
          for (const sx of [1, -1]) this.smoke.emit({ pos: jp.clone().addScaledVector(right, 7.4 * sx).addScaledVector(fwd, -3), vel: null, life: 0.7, s0: 0.5, s1: 1.4, col: VAPOR, a: 0.5 });
        }
        if (j.health < 50 && this.r() < 0.7) this.smoke.emit({ pos: jp.clone().addScaledVector(fwd, -7), vel: this.jitter(3), life: 2.5, s0: 2.5, s1: 11, col: DARK, a: 0.55 * (1 - j.health / 50) + 0.2, tex: this.pick(T.smoke), rot: this.rnd(), spin: (this.r() - 0.5) * 0.6 });
        if (j.health < 25 && this.r() < 0.5) this.fire.emit({ pos: jp.clone().addScaledVector(fwd, -6), vel: null, life: 0.2, s0: 3.5, s1: 1.5, col: FIRE, a: 1, tex: this.pick(T.fire), rot: this.rnd() });
      }

      // Debris
      if (this.debris) this.debris = this.debris.filter((d) => {
        d.t -= dt; d.vel.y -= 9.8 * dt; d.pos.addScaledVector(d.vel, dt);
        this.fire.emit({ pos: d.pos.clone(), vel: null, life: 0.3, s0: 3.5, s1: 1, col: FIRE, a: 1, tex: this.pick(T.fire), rot: this.rnd() });
        this.smoke.emit({ pos: d.pos.clone(), vel: null, life: 2.2, s0: 2.5, s1: 8, col: DARK, a: 0.5, tex: this.pick(T.smoke), rot: this.rnd() });
        return d.t > 0 && d.pos.y > sim.terrain.obstacleHeight(d.pos.x, d.pos.z);
      });

      // Tracers: every round, a straight streak behind the bullet (grows from the muzzle)
      let n = 0;
      const cp = camera.position, dirV = new V3(), side = new V3(), toCam = new V3();
      for (let i = 0; i < sim.bullets.length && n < this.maxTr; i++) {
        const b = sim.bullets[i], sp = b.vel.length(); if (sp < 1) continue;
        dirV.copy(b.vel).multiplyScalar(1 / sp);
        const len = Math.min(sp * 0.032, sp * b.age + 2);
        toCam.subVectors(cp, b.pos); const dist = toCam.length();
        side.crossVectors(dirV, toCam); if (side.lengthSq() < 1e-6) side.set(0, 1, 0); side.normalize();
        const w = Math.max(0.28, dist * 0.0016);                       // constant-ish screen width far away
        const hx = b.pos.x, hy = b.pos.y, hz = b.pos.z, tx = hx - dirV.x * len, ty = hy - dirV.y * len, tz = hz - dirV.z * len;
        const sx = side.x * w, sy = side.y * w, sz = side.z * w, o = n * 12;
        this.trPos[o] = tx - sx; this.trPos[o + 1] = ty - sy; this.trPos[o + 2] = tz - sz;
        this.trPos[o + 3] = tx + sx; this.trPos[o + 4] = ty + sy; this.trPos[o + 5] = tz + sz;
        this.trPos[o + 6] = hx + sx; this.trPos[o + 7] = hy + sy; this.trPos[o + 8] = hz + sz;
        this.trPos[o + 9] = hx - sx; this.trPos[o + 10] = hy - sy; this.trPos[o + 11] = hz - sz;
        n++;
      }
      this.trGeo.setDrawRange(0, n * 6); this.trGeo.attributes.position.needsUpdate = true;

      this.smoke.update(dt, viewportH, camera.fov); this.fire.update(dt, viewportH, camera.fov);

      // How deep is the camera inside ECM smoke? (drives lens bokeh overlay)
      this.ecmPuffs = this.ecmPuffs.filter((p) => p.age < p.life);
      let inSmoke = 0;
      for (const p of this.ecmPuffs) {
        const r = BF.lerp(p.s0, p.s1, Math.sqrt(p.age / p.life)) * 0.5;
        const d = camera.position.distanceTo(p.pos);
        if (d < r * 1.4) inSmoke = Math.max(inSmoke, (1 - d / (r * 1.4)) * (1 - p.age / p.life));
      }
      this.cameraInSmoke = inSmoke;
    }
  };
})();
