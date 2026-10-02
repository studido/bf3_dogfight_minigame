// Render-side world: terrain mesh, trees, water, sky, fog, clouds, sun.
window.BF = window.BF || {};

// Cumulus cloud textures: 4 variants, 256x192, drawn once. Puffs (metaballs) along a flat
// base with smaller ones stacked on top, edges broken up with noise, lit from above:
// white tops, blue-grey flat bases, slightly brighter thin edges (sun shining through).
BF.cloudTextures = (() => {
  let texs = null;
  return () => {
    if (texs) return texs;
    texs = [];
    const W = 256, H = 192, noise = BF.makeNoise(31337);
    for (let v = 0; v < 4; v++) {
      const r = BF.rng(500 + v * 17), puffs = [], baseY = 0.6; // base line, in width units (H = 0.75)
      const nb = 4 + Math.floor(r() * 3);
      for (let i = 0; i < nb; i++) {                       // base row
        const x = 0.18 + (i + 0.5) / nb * 0.64 + (r() - 0.5) * 0.05, rad = 0.1 + r() * 0.07;
        puffs.push([x, baseY - rad * 0.55, rad]);
      }
      const nt = 2 + Math.floor(r() * 3);
      for (let i = 0; i < nt; i++) {                       // towers, overlapping the base row
        const x = 0.3 + r() * 0.4, rad = 0.11 + r() * 0.07;
        puffs.push([x, baseY - 0.12 - r() * 0.12 - rad * 0.6, rad]);
      }
      // small billows around the upper surface of every big puff (the cauliflower texture)
      for (const [px, py, pr] of puffs.slice()) for (let i = 0; i < 5; i++) {
        const ang = -Math.PI * (0.1 + r() * 0.8), rad = pr * (0.3 + r() * 0.2);
        puffs.push([px + Math.cos(ang) * pr * 0.8, Math.min(py + Math.sin(ang) * pr * 0.8, baseY - rad * 0.5), rad]);
      }
      let top = 1; for (const p of puffs) top = Math.min(top, p[1] - p[2]);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
      const sx = -0.45, sy = -0.7, sz = 0.55;              // light: from upper left, towards the viewer
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const u = x / W, w = y / W;                          // square units (width = 1)
        // metaball field: smooth union of the puffs, its gradient gives a soft surface normal
        let F = 0, gx = 0, gy = 0;
        for (const [px, py, pr] of puffs) {
          const dx = (u - px) / pr, dy = (w - py) / pr, f = Math.exp(-2.2 * (dx * dx + dy * dy));
          F += f; gx += f * dx / pr; gy += f * dy / pr;
        }
        let dens = (F - 0.32) * 1.6;
        if (dens < -0.35) continue;
        const gl = Math.hypot(gx, gy) * 0.18, nx = gx * 0.18 / (gl + 1), ny = gy * 0.18 / (gl + 1), q0 = Math.hypot(nx, ny);
        const nz = noise.fbm(u * 9 + v * 13, w * 9, 5) - 0.5, nz2 = noise.fbm(u * 26 - v * 7, w * 26, 3) - 0.5;
        dens += nz * 0.45 + nz2 * 0.15;
        dens *= BF.clamp((baseY + 0.012 - w) / 0.03, 0, 1);  // flat base
        const a = Math.pow(BF.clamp((dens - 0.02) / 0.45, 0, 1), 1.3); // soft, wispy edges
        if (a <= 0) continue;
        // per-puff sphere shading (cauliflower look) + darker towards the flat base
        const nzz = Math.sqrt(Math.max(0, 1 - Math.min(q0, 1) ** 2)), lam = Math.max(0, nx * sx + ny * sy + nzz * sz);
        const hgt = BF.clamp((baseY - w) / (baseY - top + 1e-3), 0, 1); // 0 base .. 1 top
        let L = 0.6 + 0.2 * Math.pow(hgt, 0.6) + 0.26 * lam + nz * 0.13 + nz2 * 0.07 + (1 - a) * 0.1;
        L = BF.clamp(L, 0, 1.04);
        const i = (y * W + x) * 4;
        d[i] = Math.min(255, 255 * L * (0.93 + 0.07 * hgt)); d[i + 1] = Math.min(255, 255 * L * (0.955 + 0.045 * hgt)); d[i + 2] = Math.min(255, 255 * L);
        d[i + 3] = 255 * a;
      }
      g.putImageData(img, 0, 0);
      texs.push(new THREE.CanvasTexture(c));
    }
    return texs;
  };
})();

BF.softTexture = (() => {
  let tex = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(c); return tex;
  };
})();

// Sky backdrop: Poly Haven "Kloofendal 48d Partly Cloudy (Pure Sky)" (CC0), tone-mapped
// from the 4K EXR to an 8-bit equirect JPEG (assets/sky). The photo's sun sits at 47.9 deg
// elevation, u = 0.5948 across the image; our sun is placed at that elevation and the
// image is rotated so the two line up.
BF.SKY_SUN_U = 0.5948;
BF.SKY_FOG = 0xa1a4b0; // average colour of the photo's horizon band: terrain fog fades into it
BF.skyTexture = (() => {
  let tex = null;
  return () => {
    if (tex || !BF.ASSETS || !BF.ASSETS.sky) return tex;
    tex = new THREE.TextureLoader().load(BF.ASSETS.sky);
    // No mipmaps: atan() wraps at the image seam, and the derivative jump there would pick a
    // tiny mip and draw a visible vertical line. The sky's texel density matches the screen anyway.
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  };
})();

BF.buildWorld = (scene, terrain, cfg) => {
  const skyTex = BF.skyTexture();
  const FOG = new THREE.Color(skyTex ? BF.SKY_FOG : 0xb9cad6);
  scene.fog = new THREE.Fog(FOG, 900, 7500);
  scene.background = FOG;

  // Lights
  // Sun: same compass direction as before, raised to the photo's 47.9 deg elevation
  const sunEl = (skyTex ? 47.86 : 33.4) * Math.PI / 180, sunH = new THREE.Vector2(0.45, -0.7).normalize();
  const sunDir = new THREE.Vector3(sunH.x * Math.cos(sunEl), Math.sin(sunEl), sunH.y * Math.cos(sunEl));
  const skyOff = BF.SKY_SUN_U - (Math.atan2(sunDir.z, sunDir.x) / (2 * Math.PI) + 0.5);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.05); sun.position.copy(sunDir).multiplyScalar(1000); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.62));

  // Sky dome with vertical gradient (ignores fog)
  const skyGeo = new THREE.SphereGeometry(20000, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f6fb8) }, mid: { value: new THREE.Color(0x8fb6da) }, bot: { value: FOG }, sunDir: { value: sunDir },
      map: { value: skyTex }, hasMap: { value: skyTex ? 1 : 0 }, uOff: { value: skyOff } },
    // Direction is normalised per FRAGMENT: normalising per vertex on this 32x16 dome made the
    // gradient visibly faceted (lighter polygon bands in the sky).
    vertexShader: 'varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, bot, sunDir; uniform sampler2D map; uniform float hasMap, uOff; varying vec3 vW;
      void main(){ vec3 dir = normalize(vW); float h = dir.y; float s = max(dot(dir, sunDir), 0.0); vec3 c;
        if (hasMap > 0.5) {
          // Equirect lookup, rotated so the photo's sun matches ours. Below the horizon the
          // "pure sky" photo is a mirror image, so fade it out into the fog colour.
          vec2 uv = vec2(fract(atan(dir.z, dir.x) / 6.2831853 + 0.5 + uOff), asin(clamp(h, -1.0, 1.0)) / 3.1415927 + 0.5);
          c = texture2D(map, uv).rgb;
          c = mix(bot, c, smoothstep(-0.03, 0.02, h));
          c += vec3(1.0, 0.95, 0.85) * pow(s, 900.0) * 3.0;   // HDR sun disc, so it blooms
        } else {
          c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0),0.7)) : bot;
          c = mix(bot, c, smoothstep(-0.02, 0.12, h));
          c += vec3(1.0,0.93,0.78) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.35);
        }
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat); scene.add(sky);

  // Terrain: smooth, detailed mesh with photo texture splatting (js/terrain-render.js)
  // Lakes are shaded inside the terrain shader (no separate water plane, see terrain-render.js)
  const ground = BF.buildTerrainMesh(scene, terrain, cfg);
  const noise = BF.makeNoise(4242);
  BF.buildRoads(scene, terrain, ground);

  // Trees: real models near the camera, impostor cards beyond (see trees.js)
  const trees = BF.buildTrees(scene, terrain, cfg, ground);
  const r = BF.rng(99);

  // (v0.1.39: the box villages are gone; panel-block hamlets from terrain.js replace them)

  // Clouds (v0.1.39): cumulus billboards from procedurally drawn textures: cauliflower
  // puffs with noisy edges, a flat darker base, bright sunlit tops (see BF.cloudTextures).
  // With the photo sky, fog would tint them the horizon grey and they'd read as smudges
  // against the photo clouds, so they skip fog.
  const cloudTex = BF.cloudTextures();
  const cloudMats = cloudTex.map((t) => new THREE.SpriteMaterial({ map: t, transparent: true, opacity: 0.93, depthWrite: false, fog: !skyTex }));
  const clouds = new THREE.Group();
  for (let c = 0; c < (skyTex ? 34 : 60); c++) {
    const cx = (r() - 0.5) * cfg.world.size * 1.7, cz = (r() - 0.5) * cfg.world.size * 1.7, base = 1000 + r() * 650;
    const n = 2 + Math.floor(r() * 3), big = 0.7 + r() * 0.6;
    for (let k = 0; k < n; k++) {
      const sp = new THREE.Sprite(cloudMats[Math.floor(r() * cloudMats.length)]);
      const w = (420 + r() * 520) * big, h = w * 0.75;
      sp.scale.set(w, h, 1);
      // texture base sits 20 % above the bottom edge, so this lines every puff's base up
      sp.position.set(cx + (r() - 0.5) * 700 * big, base + h * 0.3 + (r() - 0.5) * 30, cz + (r() - 0.5) * 700 * big);
      clouds.add(sp);
    }
  }
  scene.add(clouds);

  // Boundary walls: faint red curtain at the combat-area edge
  const half = cfg.world.size / 2, wallMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, fog: false });
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(cfg.world.size, 3000), wallMat);
    w.position.set(i === 0 ? half : i === 1 ? -half : 0, 1500, i === 2 ? half : i === 3 ? -half : 0);
    if (i < 2) w.rotation.y = Math.PI / 2;
    scene.add(w);
  }

  // Building clusters (3D models; see city.js)
  const city = BF.buildCity(scene, terrain);

  return {
    sky, sunDir,
    update(camPos, t = 0) {
      sky.position.copy(camPos); if (city) city.update(t);
      ground.material.userData.uni.uTime.value = t % 1000; // water ripple drift
      trees.update(camPos);
      // The red combat-area curtain only fades in within ~900 m of the edge. Always-on it
      // drew a faint, hard-edged band across the sky from anywhere on the map.
      const toEdge = half - Math.max(Math.abs(camPos.x), Math.abs(camPos.z));
      wallMat.opacity = 0.12 * BF.clamp((900 - toEdge) / 700, 0, 1);
      wallMat.visible = wallMat.opacity > 0.001;
    },
  };
};
