// Low-poly jet built from primitives. Forward is -Z, up is +Y. ~16 m long.
window.BF = window.BF || {};

BF.buildJetModel = (team) => {
  const g = new THREE.Group();
  const body = new THREE.MeshPhongMaterial({ color: team === 0 ? 0xa4acb4 : 0x5f6b55, flatShading: true, shininess: 6 });
  const dark = new THREE.MeshPhongMaterial({ color: team === 0 ? 0x6d757d : 0x3f4838, flatShading: true, shininess: 6 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x1b2430, emissive: 0x0a1420, flatShading: true, shininess: 6 });
  const metal = new THREE.MeshPhongMaterial({ color: 0x3a3a3a, flatShading: true, shininess: 6 });

  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };

  // Fuselage + nose
  const fus = new THREE.CylinderGeometry(0.95, 1.25, 12, 8); fus.rotateX(Math.PI / 2); add(fus, body, 0, 0, 0);
  const nose = new THREE.ConeGeometry(0.95, 4.5, 8); nose.rotateX(-Math.PI / 2); add(nose, body, 0, 0, -8.25);
  const canopy = new THREE.SphereGeometry(0.8, 8, 6); canopy.scale(1, 0.8, 2.6); add(canopy, glass, 0, 0.85, -4.6);
  // Intakes / engine block
  const eng = new THREE.BoxGeometry(3.2, 1.3, 7); add(eng, dark, 0, -0.35, 2.6);

  // Wing from a flat shape, mirrored
  const wingShape = (pts) => {
    const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // shape XY -> XZ plane
    return geo;
  };
  const wing = wingShape([[1.1, -2.2], [7.6, 2.6], [7.6, 3.8], [1.1, 4.4]]);
  for (const sx of [1, -1]) { const w = add(wing, body, 0, -0.1, 0); w.scale.x = sx; }
  // Leading-edge extensions
  const lex = wingShape([[0.9, -6.5], [1.6, -2.0], [1.1, -1.5]]);
  for (const sx of [1, -1]) { const w = add(lex, body, 0, 0.1, 0); w.scale.x = sx; }
  // Horizontal stabilisers
  const stab = wingShape([[1.0, 4.6], [4.0, 6.6], [4.0, 7.4], [1.0, 7.2]]);
  for (const sx of [1, -1]) { const w = add(stab, dark, 0, -0.2, 0); w.scale.x = sx; }
  // Twin canted tails
  const tailS = new THREE.Shape(); tailS.moveTo(0, 0); tailS.lineTo(3.4, 0); tailS.lineTo(4.4, 3.4); tailS.lineTo(3.2, 3.4); tailS.lineTo(0.2, 0.3);
  const tailGeo = new THREE.ExtrudeGeometry(tailS, { depth: 0.16, bevelEnabled: false }); tailGeo.rotateY(-Math.PI / 2);
  for (const sx of [1, -1]) {
    const t = add(tailGeo, body, sx * 1.1, 0.6, 2.2);
    t.rotation.z = -sx * 0.35;
  }
  // Nozzles
  const nozGeo = new THREE.CylinderGeometry(0.62, 0.52, 1.4, 8); nozGeo.rotateX(Math.PI / 2);
  for (const sx of [1, -1]) add(nozGeo, metal, sx * 0.72, -0.3, 6.6);

  // Missiles on rails (visibility driven by ammo)
  const misGeo = new THREE.CylinderGeometry(0.13, 0.13, 3, 6); misGeo.rotateX(Math.PI / 2);
  const misMat = new THREE.MeshLambertMaterial({ color: 0xe4e4e4 });
  g.userData.missiles = [add(misGeo, misMat, 4.4, -0.45, 1.8), add(misGeo, misMat, -4.4, -0.45, 1.8)];

  // Afterburner flames: additive cones + glow sprites
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.5, 4, 8, 1, true); flameGeo.rotateX(Math.PI / 2); flameGeo.translate(0, 0, 2);
  const glowMat = new THREE.SpriteMaterial({ map: BF.softTexture(), color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  g.userData.flames = []; g.userData.glows = [];
  for (const sx of [1, -1]) {
    const f = add(flameGeo, flameMat, sx * 0.72, -0.3, 7.2); g.userData.flames.push(f);
    const s = new THREE.Sprite(glowMat); s.position.set(sx * 0.72, -0.3, 7.4); s.scale.set(2.2, 2.2, 1); g.add(s); g.userData.glows.push(s);
  }

  // Throttle 0..1 -> flame length
  g.userData.setThrottle = (t, boosting) => {
    const len = boosting ? 1.3 + Math.random() * 0.25 : 0.15 + t * 0.55;
    for (const f of g.userData.flames) { f.scale.set(1, 1, len); f.material.opacity = boosting ? 0.9 : 0.5; }
    for (const s of g.userData.glows) { const k = boosting ? 4.2 : 2 + t * 1.5; s.scale.set(k, k, 1); }
  };
  return g;
};
