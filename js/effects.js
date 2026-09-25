// Particles (smoke, fire, flares, ECM clouds, vapor), tracers, explosions.
window.BF = window.BF || {};

(() => {
  const V3 = THREE.Vector3;

  class Particles {
    constructor(scene, max, additive) {
      this.max = max; this.list = [];
      const geo = new THREE.BufferGeometry();
      this.aPos = new Float32Array(max * 3); this.aCol = new Float32Array(max * 3);
      this.aSize = new Float32Array(max); this.aAlpha = new Float32Array(max);
      geo.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(this.aCol, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('size', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('alpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
      this.geo = geo;
      const mat = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 800 }, fogColor: { value: new THREE.Color(0xb9cad6) }, fogFar: { value: 7500 } },
        vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; varying float vD;
          uniform float scale;
          void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z;
            gl_PointSize = min(size * scale / max(-mv.z, 0.1), 600.0); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vC; varying float vA; varying float vD; uniform vec3 fogColor; uniform float fogFar;
          void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0; if (r > 1.0) discard;
            float a = vA * (1.0 - r) * (1.0 - r);
            vec3 c = ${additive ? 'vC' : 'mix(vC, fogColor, clamp(vD / fogFar, 0.0, 1.0))'};
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
        this.aAlpha[n] = p.a * (t < 0.08 ? t / 0.08 : 1 - Math.pow(t, p.fadePow || 1.5));
        n++; out.push(p);
      }
      this.list = out;
      this.geo.setDrawRange(0, n);
      for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
    }
  }

  const C = (h) => new THREE.Color(h);
  const WHITE = C(0xf2f2f2), SMOKE = C(0xd9d9d9), DARK = C(0x2c2a28), FIRE = C(0xff8a2a), HOT = C(0xffe2a0),
    ECM = C(0xeee8f6), FLARE = C(0xffb870), VAPOR = C(0xffffff), DUST = C(0x9a8f78);

  BF.Effects = class {
    constructor(scene) {
      this.scene = scene;
      this.smoke = new Particles(scene, 6000, false);
      this.fire = new Particles(scene, 2500, true);
      this.ecmPuffs = []; // for lens-smear test
      // Tracers
      this.maxTr = 600;
      this.trPos = new Float32Array(this.maxTr * 6);
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
      this.trGeo = tg;
      this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.tracers.frustumCulled = false; scene.add(this.tracers);
      // Missile head glows
      this.missileGlow = new Map();
      this.glowMat = new THREE.SpriteMaterial({ map: BF.softTexture(), color: 0xfff0c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      this.r = Math.random;
    }

    jitter(k) { return new V3((this.r() - 0.5) * k, (this.r() - 0.5) * k, (this.r() - 0.5) * k); }

    explosion(pos, size = 1, vel = null) {
      for (let i = 0; i < 26 * size; i++) this.fire.emit({ pos: pos.clone(), vel: this.jitter(60 * size).add(vel ? vel.clone().multiplyScalar(0.3) : new V3()), drag: 2.5, life: 0.5 + this.r() * 0.6, s0: 6 * size, s1: 18 * size, col: this.r() < 0.4 ? HOT : FIRE, a: 1 });
      for (let i = 0; i < 18 * size; i++) this.smoke.emit({ pos: pos.clone().add(this.jitter(8 * size)), vel: this.jitter(22 * size), drag: 1.2, grav: -2, life: 3 + this.r() * 3, s0: 8 * size, s1: 30 * size, col: DARK, a: 0.75 });
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
        case 'impact': this.smoke.emit({ pos: ev.pos.clone(), vel: new V3(0, 6, 0), life: 1.2, s0: 2, s1: 7, col: DUST, a: 0.6 }); break;
        case 'hit': for (let i = 0; i < 3; i++) this.fire.emit({ pos: ev.pos.clone().add(this.jitter(4)), vel: this.jitter(20), life: 0.25, s0: 2, s1: 4, col: HOT, a: 1 }); break;
        case 'ecmPuff': {
          const cfg = sim.cfg.countermeasures;
          for (let i = 0; i < 3; i++) {
            const p = this.smoke.emit({ pos: ev.pos.clone().add(this.jitter(10)), vel: ev.vel.clone().multiplyScalar(0.12).add(this.jitter(8)), drag: 0.8,
              life: cfg.ecmCloudLife * (0.7 + this.r() * 0.5), s0: 10, s1: 42, col: ECM, a: 0.8, fadePow: 2.5 });
            this.ecmPuffs.push(p);
          }
          break;
        }
      }
    }

    update(dt, sim, camera, viewportH) {
      // Missile smoke trails + head glow
      const alive = new Set();
      for (const m of sim.missiles) {
        alive.add(m.id);
        for (let i = 0; i < 2; i++) this.smoke.emit({ pos: m.pos.clone().addScaledVector(m.dir, -2 - i * m.speed * dt * 0.5), vel: this.jitter(2), life: 3.2 + this.r(), s0: 1.8, s1: 9, col: SMOKE, a: 0.65 });
        this.fire.emit({ pos: m.pos.clone().addScaledVector(m.dir, -1.5), vel: null, life: 0.08, s0: 3, s1: 2, col: HOT, a: 1 });
        let g = this.missileGlow.get(m.id);
        if (!g) { g = new THREE.Sprite(this.glowMat); g.scale.set(7, 7, 1); this.scene.add(g); this.missileGlow.set(m.id, g); }
        g.position.copy(m.pos);
      }
      for (const [id, g] of this.missileGlow) if (!alive.has(id)) { this.scene.remove(g); this.missileGlow.delete(id); }

      // Flares
      for (const f of sim.flares) {
        if (f.delay > 0) continue;
        this.fire.emit({ pos: f.pos.clone(), vel: null, life: 0.12, s0: 7, s1: 5, col: this.r() < 0.5 ? HOT : FLARE, a: 1 });
        if (this.r() < 0.6) this.smoke.emit({ pos: f.pos.clone(), vel: this.jitter(2), life: 2.2, s0: 1.5, s1: 6, col: WHITE, a: 0.45 });
      }

      // Jets: wingtip vapour in hard pulls, damage smoke
      for (const j of sim.jets) {
        if (!j.alive) continue;
        const jp = j.dispPos || j.pos, jq = j.dispQuat || j.quat; // remote jets: on-screen transform
        const right = BF.rightOf(jq, new V3()), fwd = BF.forwardOf(jq, new V3());
        if (Math.abs(j.rates.p) > 38) {
          for (const sx of [1, -1]) this.smoke.emit({ pos: jp.clone().addScaledVector(right, 7.4 * sx).addScaledVector(fwd, -3), vel: null, life: 0.7, s0: 0.5, s1: 1.4, col: VAPOR, a: 0.5 });
        }
        if (j.health < 50 && this.r() < 0.7) this.smoke.emit({ pos: jp.clone().addScaledVector(fwd, -7), vel: this.jitter(3), life: 2.5, s0: 2, s1: 9, col: DARK, a: 0.55 * (1 - j.health / 50) + 0.2 });
        if (j.health < 25 && this.r() < 0.5) this.fire.emit({ pos: jp.clone().addScaledVector(fwd, -6), vel: null, life: 0.2, s0: 3, s1: 1.5, col: FIRE, a: 1 });
      }

      // Debris
      if (this.debris) this.debris = this.debris.filter((d) => {
        d.t -= dt; d.vel.y -= 9.8 * dt; d.pos.addScaledVector(d.vel, dt);
        this.fire.emit({ pos: d.pos.clone(), vel: null, life: 0.3, s0: 3, s1: 1, col: FIRE, a: 1 });
        this.smoke.emit({ pos: d.pos.clone(), vel: null, life: 2, s0: 2, s1: 7, col: DARK, a: 0.5 });
        return d.t > 0 && d.pos.y > sim.terrain.obstacleHeight(d.pos.x, d.pos.z);
      });

      // Tracers (every 2nd round visible, like tracer belts)
      let n = 0;
      for (let i = 0; i < sim.bullets.length && n < this.maxTr; i += 2) {
        const b = sim.bullets[i];
        this.trPos.set([b.pos.x, b.pos.y, b.pos.z, b.pos.x - b.vel.x * 0.025, b.pos.y - b.vel.y * 0.025, b.pos.z - b.vel.z * 0.025], n * 6); n++;
      }
      this.trGeo.setDrawRange(0, n * 2); this.trGeo.attributes.position.needsUpdate = true;

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
