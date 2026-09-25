// Render-side world: terrain mesh, trees, water, sky, fog, clouds, sun.
window.BF = window.BF || {};

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

BF.buildWorld = (scene, terrain, cfg) => {
  const FOG = new THREE.Color(0xb9cad6);
  scene.fog = new THREE.Fog(FOG, 900, 7500);
  scene.background = FOG;

  // Lights
  const sunDir = new THREE.Vector3(0.45, 0.55, -0.7).normalize();
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.05); sun.position.copy(sunDir).multiplyScalar(1000); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.62));

  // Sky dome with vertical gradient (ignores fog)
  const skyGeo = new THREE.SphereGeometry(20000, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f6fb8) }, mid: { value: new THREE.Color(0x8fb6da) }, bot: { value: FOG }, sunDir: { value: sunDir } },
    vertexShader: 'varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, bot, sunDir; varying vec3 vW;
      void main(){ float h = vW.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0),0.7)) : bot;
        c = mix(bot, c, smoothstep(-0.02, 0.12, h));
        float s = max(dot(normalize(vW), sunDir), 0.0);
        c += vec3(1.0,0.93,0.78) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.35);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat); scene.add(sky);

  // Terrain mesh (flat-shaded low-poly look)
  const size = cfg.world.size * 1.7, segs = 230;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  const noise = BF.makeNoise(4242), col = new THREE.Color();
  const grassA = new THREE.Color(0x4f7a35), grassB = new THREE.Color(0x6f8c3e), dry = new THREE.Color(0x8a7d55),
    rock = new THREE.Color(0x7b7a74), snow = new THREE.Color(0xe8eef2), sand = new THREE.Color(0xa99c78);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrain.height(x, z);
    pos.setY(i, h);
    const e = 12, slope = Math.hypot(terrain.height(x + e, z) - terrain.height(x - e, z), terrain.height(x, z + e) - terrain.height(x, z - e)) / (2 * e);
    const n = noise.fbm(x * 0.003, z * 0.003, 3);
    col.copy(grassA).lerp(grassB, n);
    if (n > 0.62) col.lerp(dry, (n - 0.62) * 2.2);
    if (h < terrain.water + 6) col.copy(sand);
    col.lerp(rock, BF.clamp((slope - 0.45) * 2.2, 0, 1));
    if (h > 430) col.lerp(snow, BF.clamp((h - 430) / 80, 0, 1) * (slope < 0.9 ? 1 : 0.4));
    const cd = Math.hypot(x - terrain.city.x, z - terrain.city.z);
    if (cd < terrain.city.blend) col.lerp(new THREE.Color(0x6b6d70), 1 - BF.clamp((cd - terrain.city.radius) / (terrain.city.blend - terrain.city.radius), 0, 1));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 6 }));
  scene.add(ground);

  // Water
  const water = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: 0x3d6b86, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2; water.position.y = terrain.water; scene.add(water);

  // Trees: instanced low-poly cones in noise-driven clusters
  const treeGeo = new THREE.ConeGeometry(5, 16, 5); treeGeo.translate(0, 8, 0);
  const treeCount = 5000;
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshPhongMaterial({ color: 0x2f5227, flatShading: true, shininess: 6 }), treeCount);
  const r = BF.rng(99), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let placed = 0;
  for (let tries = 0; tries < treeCount * 12 && placed < treeCount; tries++) {
    const x = (r() - 0.5) * cfg.world.size * 1.3, z = (r() - 0.5) * cfg.world.size * 1.3;
    if (noise.fbm(x * 0.0016 + 9, z * 0.0016, 3) < 0.52) continue;
    const h = terrain.height(x, z);
    if (h < terrain.water + 8 || h > 380) continue;
    if (Math.hypot(x - terrain.city.x, z - terrain.city.z) < terrain.city.blend) continue; // keep the city clear
    const k = 0.7 + r() * 0.9;
    m.compose(p.set(x, h - 1, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), s.set(k, k * (0.8 + r() * 0.5), k));
    trees.setMatrixAt(placed++, m);
  }
  trees.count = placed; scene.add(trees);

  // A few villages of boxes near the valley floor
  const houseGeo = new THREE.BoxGeometry(14, 8, 18); houseGeo.translate(0, 4, 0);
  const houses = new THREE.InstancedMesh(houseGeo, new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }), 400);
  let hc = 0;
  for (let v = 0; v < 14; v++) {
    const cx = (r() - 0.5) * cfg.world.size * 0.9, cz = (r() - 0.5) * cfg.world.size * 0.9;
    if (terrain.height(cx, cz) > 200 || terrain.height(cx, cz) < terrain.water + 5) continue;
    if (Math.hypot(cx - terrain.city.x, cz - terrain.city.z) < terrain.city.blend + 300) continue;
    for (let k = 0; k < 25 && hc < 400; k++) {
      const x = cx + (r() - 0.5) * 350, z = cz + (r() - 0.5) * 350, h = terrain.height(x, z);
      m.compose(p.set(x, h - 0.5, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 3), s.set(1, 1, 1));
      houses.setMatrixAt(hc++, m);
    }
  }
  houses.count = hc; scene.add(houses);

  // Clouds: billboard sprite clusters
  const cloudMat = new THREE.SpriteMaterial({ map: BF.softTexture(), color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: true });
  const clouds = new THREE.Group();
  for (let c = 0; c < 70; c++) {
    const cx = (r() - 0.5) * cfg.world.size * 1.6, cz = (r() - 0.5) * cfg.world.size * 1.6, cy = 900 + r() * 700;
    for (let k = 0; k < 7; k++) {
      const sp = new THREE.Sprite(cloudMat);
      const sc = 260 + r() * 380; sp.scale.set(sc, sc * 0.6, 1);
      sp.position.set(cx + (r() - 0.5) * 500, cy + (r() - 0.5) * 90, cz + (r() - 0.5) * 500);
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

  // City: street-grid ground disc + towers
  const C = terrain.city, sc = document.createElement('canvas'); sc.width = sc.height = 128;
  const sg = sc.getContext('2d'); sg.fillStyle = '#6d6f72'; sg.fillRect(0, 0, 128, 128);
  sg.fillStyle = '#3a3c3f'; sg.fillRect(0, 0, 128, 44); sg.fillRect(0, 0, 44, 128);       // streets (40 m of each 110 m block)
  sg.fillStyle = '#d8c46a'; sg.fillRect(0, 21, 128, 2); sg.fillRect(21, 0, 2, 128);        // centre lines
  const stex = new THREE.CanvasTexture(sc); stex.wrapS = stex.wrapT = THREE.RepeatWrapping;
  const streets = new THREE.Mesh(new THREE.CircleGeometry(C.radius + 10, 48),
    new THREE.MeshPhongMaterial({ map: stex, shininess: 4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  streets.rotation.x = -Math.PI / 2; streets.position.set(C.x, C.ground + 0.3, C.z);
  // UVs in metres: one texture tile per 110 m block, aligned with the building grid
  const suv = streets.geometry.attributes.uv, sp = streets.geometry.attributes.position;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, (sp.getX(i) + 55 + 22) / 110, (sp.getY(i) + 55 + 22) / 110);
  scene.add(streets);
  const city = BF.buildCity(scene, terrain);

  return { sky, sunDir, update(camPos, t = 0) { sky.position.copy(camPos); if (city) city.update(t); } };
};
