// Render-side city: all towers merged into one mesh with a tiling window texture
// (UVs in metres so windows keep a constant size), plus masts with red beacons.
window.BF = window.BF || {};

BF.buildCity = (scene, terrain) => {
  const bs = terrain.buildings;
  if (!bs.length) return null;

  // Window texture: one tile = 16 m x 16 m = 4 windows x 4 floors
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = BF.rng(4711);
  g.fillStyle = '#b9bcc0'; g.fillRect(0, 0, 128, 128);
  for (let fy = 0; fy < 4; fy++) for (let wx = 0; wx < 4; wx++) {
    const x = wx * 32 + 4, y = fy * 32 + 6, lit = r();
    const grad = g.createLinearGradient(x, y, x + 24, y + 22);
    const base = lit < 0.15 ? [120, 150, 175] : [38 + lit * 20, 58 + lit * 25, 78 + lit * 30];
    grad.addColorStop(0, `rgb(${base.map((v) => Math.min(255, v + 40)).join(',')})`);
    grad.addColorStop(1, `rgb(${base.join(',')})`);
    g.fillStyle = grad; g.fillRect(x, y, 24, 22);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;

  // Build one merged BufferGeometry
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const tints = [[1, 1, 1], [0.82, 0.88, 0.95], [0.95, 0.9, 0.82], [0.7, 0.76, 0.84], [0.88, 0.88, 0.88]];
  const T = 16; // metres per texture tile
  const face = (verts, n, uvs, tint) => {
    const o = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...verts[i]); nor.push(...n); uv.push(...uvs[i]); col.push(...tint); }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  for (const b of bs) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.base, y1 = b.top;
    const tint = tints[Math.floor(r() * tints.length)], v1 = (y1 - y0) / T, uw = b.w / T, ud = b.d / T, off = r();
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[off, 0], [off + uw, 0], [off + uw, v1], [off, v1]], tint);   // +Z
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[off, 0], [off + uw, 0], [off + uw, v1], [off, v1]], tint); // -Z
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[off, 0], [off + ud, 0], [off + ud, v1], [off, v1]], tint);  // +X
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[off, 0], [off + ud, 0], [off + ud, v1], [off, v1]], tint); // -X
    const roof = tint.map((t) => t * 0.55), ruv = [0.005, 0.005];                                                                             // roof: plain facade pixel
    face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [ruv, ruv, ruv, ruv], roof);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ map: tex, vertexColors: true, shininess: 40, specular: 0x333333 }));
  scene.add(mesh);

  // Rooftop masts with blinking red aviation beacons on the tallest towers
  const mastMat = new THREE.MeshPhongMaterial({ color: 0x777777 });
  const beaconMat = new THREE.SpriteMaterial({ map: BF.softTexture(), color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const beacons = [];
  for (const b of bs) {
    if (!b.mast) continue;
    const h = 25 + (b.h % 7) * 3;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, h, 6), mastMat); m.position.set(b.x, b.top + h / 2, b.z); scene.add(m);
    const s = new THREE.Sprite(beaconMat); s.position.set(b.x, b.top + h + 1, b.z); s.scale.set(9, 9, 1); scene.add(s); beacons.push(s);
  }
  return {
    update(t) { const on = Math.floor(t * 1.2) % 2 === 0; for (const s of beacons) s.visible = on; },
  };
};
