// Jet models. Forward is -Z, up is +Y.
//  - BF.buildJetModel(team): the F/A-18E/F GLB (assets/models/fa18.glb) once loaded,
//    otherwise the low-poly primitive jet below (fallback, ~16 m long).
// Both return a Group with the same userData API: missiles[], flames[], glows[],
// setThrottle(t, boosting).
window.BF = window.BF || {};

BF.buildJetModelPrimitive = (team) => {
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

// ---------------- F/A-18E/F model (GLB) ----------------
// Model: "Boeing F/A-18E/F Super Hornet" from Sketchfab (see README credits).
// Optimised with gltf-transform (spec-gloss -> metal-rough, textures 4K -> 2K, dedup,
// prune, quantize): 10.3 MB -> 2.1 MB, ~58k triangles.
// Model space: nose +X, up +Y, span on Z, nose at x=7.39, tail at x=-10.68, fuselage
// centre y~0.5. Game space wants nose -Z, so rotate +90 deg about Y and recentre.
(() => {
  const FA18 = {
    rotY: Math.PI / 2,
    offset: [1.65, -0.5, 0],      // model-space shift so the jet's centre sits on the sim position
    nozzles: [[0.5, -0.17, 8.25], [-0.5, -0.17, 8.25]],   // exhaust centres, game space
    nozzleR: 0.45,
  };
  BF.JET_SPEC = FA18;
  let templates = null; // [team0Group, team1Group]
  const jetMats = [];    // every prepared material (all qualities), for the sky reflection
  let env = null;
  const ENV_INTENSITY = { glass: 1.2, paint: 0.55 };
  // Sky reflections: once the sky photo has decoded, prefilter it (PMREM) and hand it to the
  // jet materials. Called every frame from main.js; it does nothing after the first success.
  BF.ensureJetEnv = (renderer) => {
    if (env) return;
    const tex = BF.skyTexture && BF.skyTexture();
    if (!tex || !tex.image || !tex.image.complete || !tex.image.naturalWidth) return;
    const pm = new THREE.PMREMGenerator(renderer);
    env = pm.fromEquirectangular(tex).texture;
    pm.dispose();
    for (const m of jetMats) applyEnv(m);
  };
  function applyEnv(m) {
    if (!env) return;
    m.envMap = env;
    m.envMapIntensity = (m.name || '').toLowerCase() === 'glass' ? ENV_INTENSITY.glass : ENV_INTENSITY.paint;
    m.needsUpdate = true;
  }

  function prepTemplate(src, team) {
    const root = new THREE.Group();
    const pivot = new THREE.Group(); pivot.rotation.y = FA18.rotY; root.add(pivot);
    const model = src.clone(true); model.position.set(...FA18.offset); pivot.add(model);
    // Team 1 (red) gets its own material copies with a darker, greener-grey paint
    const cache = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m0 = o.material;
      if (!cache.has(m0)) {
        const m = m0.clone();
        // No environment map: a PMREM sky env blew the jet out into a white bloom blob
        // with this scene's lighting. Direct sun + hemisphere light read well on their own.
        if (m.emissive) m.emissive.set(0x000000);
        // Anisotropic filtering keeps the paint and markings sharp at glancing angles
        if (m.map) { m.map.anisotropy = BF._maxAniso || 1; m.map.needsUpdate = true; }
        const name = (m0.name || '').toLowerCase();
        if (name === 'glass') { m.color.set(0x2a3644); m.metalness = 0.2; m.roughness = 0.15; }
        else { m.metalness = Math.min(m.metalness ?? 0, 0.35); m.roughness = Math.max(m.roughness ?? 1, 0.45); }
        if (team === 1 && m.color && name !== 'glass') m.color.multiply(new THREE.Color(0.72, 0.76, 0.66));
        jetMats.push(m); applyEnv(m);
        cache.set(m0, m);
      }
      o.material = cache.get(m0);
      o.frustumCulled = true;
    });
    return root;
  }

  // Texture quality: 'high' = 4K, 'medium' = 2K (default), 'low' = 1K. Each is its own
  // base64 script (assets/models/fa18_<q>.glb.js), loaded only when chosen, so players on
  // Medium/Low never download the 12 MB 4K file. A <script> tag works from file:// too.
  BF.TEXTURE_QUALITIES = ['low', 'medium', 'high'];
  const loads = {};      // quality -> Promise<boolean>
  let current = null;    // quality whose templates are active
  function loadScript(q) {
    return new Promise((resolve) => {
      if (BF.ASSETS && BF.ASSETS['fa18_' + q]) { resolve(true); return; }
      const el = document.createElement('script');
      el.src = 'assets/models/fa18_' + q + '.glb.js?v=' + (BF.BUILD || '');
      el.onload = () => resolve(!!(BF.ASSETS && BF.ASSETS['fa18_' + q]));
      el.onerror = () => resolve(false);
      (document.head || document.body).appendChild(el);
    });
  }
  function parse(q) {
    return new Promise((resolve) => {
      if (!THREE.GLTFLoader) { resolve(null); return; }
      let buf;
      try {
        const bin = atob(BF.ASSETS['fa18_' + q]); buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        delete BF.ASSETS['fa18_' + q]; // free the base64 string once decoded
      } catch (e) { console.warn('F/A-18 model data unreadable', e); resolve(null); return; }
      THREE.GLTFLoader.useImageElements = true; // decode textures via <img>, not fetch(): works from file:// too
      new THREE.GLTFLoader().parse(buf.buffer, '', (gltf) => resolve([prepTemplate(gltf.scene, 0), prepTemplate(gltf.scene, 1)]),
        (err) => { console.warn('F/A-18 model failed to parse', err); resolve(null); });
    });
  }
  let wanted = null;     // last quality asked for (quick switches: only the latest wins)
  const parsed = {};     // quality -> templates (kept, so switching back is instant)
  // Load (if needed) and activate a texture quality. Resolves true when its templates are
  // active; false leaves the previous model (or the primitive jet) in place.
  BF.loadJetModels = (renderer, quality = 'medium') => {
    const q = BF.TEXTURE_QUALITIES.includes(quality) ? quality : 'medium';
    wanted = q;
    BF._maxAniso = Math.min(8, renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1);
    if (!loads[q]) {
      loads[q] = loadScript(q).then((ok) => (ok ? parse(q) : null)).then((t) => {
        if (t) parsed[q] = t;
        else { console.warn('F/A-18 model (' + q + ') unavailable, keeping the current jet'); delete loads[q]; }
        return !!t;
      });
    }
    return loads[q].then((ok) => {
      if (!ok || !parsed[q] || wanted !== q) return false; // a newer choice superseded this one
      templates = parsed[q]; current = q;
      return true;
    });
  };
  BF.jetModelQuality = () => current;

  // ---- In-flight missile model, taken from the jet model's own missile ----
  // Returns { obj, rails: [R, L] (jet-local launch points), length } built from the current
  // templates, or null while only the primitive jet exists. The missile points along -z.
  let missileInfo = null, missileFor = null;
  BF.missileModel = () => {
    if (!templates) return null;
    if (missileFor === templates) return missileInfo;
    missileFor = templates; missileInfo = null;
    const root = templates[0]; root.updateMatrixWorld(true);
    const box = (node) => {
      // Bounds from the indexed vertices (the shared quantised accessors span the whole
      // airframe, so geometry.boundingBox would be the whole jet)
      const b = new THREE.Box3(), v = new THREE.Vector3();
      node.traverse((o) => {
        if (!o.isMesh) return;
        const pos = o.geometry.attributes.position, idx = o.geometry.index, arr = pos.array;
        const nq = !pos.normalized ? 1 : arr instanceof Int16Array ? 1 / 32767 : arr instanceof Uint16Array ? 1 / 65535 : arr instanceof Int8Array ? 1 / 127 : arr instanceof Uint8Array ? 1 / 255 : 1;
        const n = idx ? idx.count : pos.count;
        for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).multiplyScalar(nq).applyMatrix4(o.matrixWorld); b.expandByPoint(v); }
      });
      return b;
    };
    const nodes = ['missile_R', 'missile_L'].map((n) => root.getObjectByName(n));
    if (!nodes[0] || !nodes[1]) return null;
    const boxes = nodes.map(box), rails = boxes.map((b) => b.getCenter(new THREE.Vector3()));
    const src = nodes[1], c = rails[1], size = boxes[1].getSize(new THREE.Vector3());
    const obj = new THREE.Group(), inner = new THREE.Group(); obj.add(inner);
    inner.position.copy(c).negate();
    src.traverse((o) => {
      if (!o.isMesh) return;
      const m = new THREE.Mesh(o.geometry, o.material); m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); inner.add(m);
    });
    missileInfo = { obj, rails, length: Math.max(size.x, size.z) };
    return missileInfo;
  };
  BF.jetModelsReady = () => !!templates;

  BF.buildJetModel = (team) => {
    if (!templates) return BF.buildJetModelPrimitive(team);
    const g = new THREE.Group();
    g.add(templates[team === 1 ? 1 : 0].clone(true)); // shares geometry + materials

    // The two outer underwing missiles are their own nodes (split offline, v0.1.47), so the
    // one just fired disappears from the pylon and comes back on reload. Order [R, L]:
    // main.js shows index i while i < missiles left, so L goes first, then R.
    g.userData.missiles = ['missile_R', 'missile_L'].map((n) => g.getObjectByName(n)).filter(Boolean);

    // Afterburner: hot nozzle glow + additive flame cone per engine
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameGeo = new THREE.ConeGeometry(FA18.nozzleR * 0.9, 4, 12, 1, true); flameGeo.rotateX(Math.PI / 2); flameGeo.translate(0, 0, 2);
    const glowMat = new THREE.SpriteMaterial({ map: BF.softTexture(), color: 0xffa050, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    g.userData.flames = []; g.userData.glows = [];
    for (const [x, y, z] of FA18.nozzles) {
      const f = new THREE.Mesh(flameGeo, flameMat); f.position.set(x, y, z); g.add(f); g.userData.flames.push(f);
      const s = new THREE.Sprite(glowMat); s.position.set(x, y, z + 0.2); g.add(s); g.userData.glows.push(s);
    }
    g.userData.setThrottle = (t, boosting) => {
      const len = boosting ? 1.2 + Math.random() * 0.2 : 0.1 + t * 0.4;
      for (const f of g.userData.flames) { f.scale.set(1, 1, len); f.material.opacity = boosting ? 0.85 : 0.4; }
      for (const s of g.userData.glows) { const k = boosting ? 2.6 : 0.9 + t * 0.7; s.scale.set(k, k, 1); }
    };
    return g;
  };
})();
