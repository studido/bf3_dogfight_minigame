// Render-side building clusters (v0.1.39): real 3D models placed where terrain.js says.
//
//  - Models are base64 GLB scripts (assets/models/city_<key>.glb.js), loaded once in the
//    background and kept, so a new match only re-places them. The sim never waits for
//    them: collision comes from the baked height grids in js/city-data.js.
//  - 'city' = a complete dense city tile (two instances at different scales/rotations),
//    'ny' = 19 New York landmark towers (one cluster), 'panel' = 12-storey panel blocks
//    (estates and hamlets; drawn as InstancedMeshes, one draw call per material).
//  - Materials become plain MeshStandardMaterial (no clearcoat / specular extensions),
//    colours used as-is like the rest of the display-space scene, anisotropic filtering on.
//  - Placement: each instance's model-space origin is its footprint centre and base
//    (ox, oy, oz from city-data.js), so the visuals line up with the collision grids.
window.BF = window.BF || {};

(() => {
  const loads = {};   // key -> Promise<THREE.Object3D | null> (parsed glTF scene)
  function loadModel(key) {
    if (loads[key]) return loads[key];
    return (loads[key] = new Promise((resolve) => {
      const id = 'city_' + key;
      const parse = () => {
        const b64 = BF.ASSETS && BF.ASSETS[id];
        if (!b64 || !THREE.GLTFLoader) { resolve(null); return; }
        let buf;
        try { buf = BF.b64bytes(b64); delete BF.ASSETS[id]; } catch (e) { console.warn('city model unreadable', key, e); resolve(null); return; }
        THREE.GLTFLoader.useImageElements = true;
        new THREE.GLTFLoader().parse(buf.buffer, '', (g) => { prep(g.scene); resolve(g.scene); },
          (err) => { console.warn('city model failed to parse', key, err); resolve(null); });
      };
      if (BF.ASSETS && BF.ASSETS[id]) { parse(); return; }
      const el = document.createElement('script');
      el.src = 'assets/models/' + id + '.glb.js?v=' + (BF.BUILD || '');
      el.onload = parse; el.onerror = () => resolve(null);
      (document.head || document.body).appendChild(el);
    }));
  }

  // Swap every material for a plain standard one (shared per source material)
  function prep(root) {
    const cache = new Map();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m0 = o.material;
      if (!cache.has(m0)) {
        const m = new THREE.MeshStandardMaterial({
          name: m0.name, color: m0.color ? m0.color.clone() : new THREE.Color(1, 1, 1), map: m0.map || null,
          // no normal maps: the panel's uses a second UV set three r128 can't read, and at
          // flying distances they add nothing
          metalness: 0, roughness: Math.max(m0.roughness ?? 1, 0.7),
          transparent: !!m0.transparent, alphaTest: m0.alphaTest || 0, side: m0.side, opacity: m0.opacity,
        });
        for (const t of [m.map]) if (t) { t.encoding = THREE.LinearEncoding; t.anisotropy = BF._maxAniso || 4; t.needsUpdate = true; }
        cache.set(m0, m);
      }
      o.material = cache.get(m0);
    });
  }

  // One placeable object for a model (or one named part of it), origin at footprint centre/base
  function template(scene, d, part) {
    const wrap = new THREE.Group(), off = new THREE.Group();
    off.position.set(-d.ox, -d.oy, -d.oz); wrap.add(off);
    if (!part) off.add(scene.clone(true));
    else {
      const src = scene.getObjectByName(part);
      if (!src) return null;
      const c = src.clone(true);
      src.matrixWorld.decompose(c.position, c.quaternion, c.scale); // keep its place in the source scene
      off.add(c);
    }
    return wrap;
  }

  function streetTexture() {
    const sc = document.createElement('canvas'); sc.width = sc.height = 128;
    const g = sc.getContext('2d');
    g.fillStyle = '#7a7b7c'; g.fillRect(0, 0, 128, 128);
    // Streets centred in the tile (symmetric, so the canvas flipY doesn't shift them)
    g.fillStyle = '#3c3e41'; g.fillRect(0, 49, 128, 30); g.fillRect(49, 0, 30, 128);
    g.fillStyle = '#c9b46a'; g.fillRect(0, 63, 128, 2); g.fillRect(63, 0, 2, 128);   // centre lines
    const t = new THREE.CanvasTexture(sc); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = BF._maxAniso || 4;
    return t;
  }

  // ---- City tile with an organic outline (v0.1.40) ----
  // terrain.js decides which footprints (connected regions of the height grid) stay
  // (ins.keep). Here every triangle is assigned to the footprint under it and dropped with
  // it; the tile's own street mesh (long strips spanning the whole square) is replaced by
  // a ground plane painted only around the kept blocks: pavement next to buildings, then
  // asphalt, transparent beyond.
  function streetMask(d, keep) {
    const R = d._reg, W = d.w, H = d.h, dist = new Uint8Array(W * H).fill(255), q = [];
    for (let j = 0; j < W * H; j++) if (R.lab[j] && keep[R.lab[j]]) { dist[j] = 0; q.push(j); }
    for (let h = 0; h < q.length; h++) {                       // BFS out to 3 cells
      const c = q[h], i = c % W, k = (c - i) / W, nd = dist[c] + 1;
      if (nd > 3) continue;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= W || kk >= H) continue;
        const c2 = kk * W + ii; if (dist[c2] > nd) { dist[c2] = nd; q.push(c2); }
      }
    }
    return dist;
  }
  function groundPlane(d, dist) {
    const W = d.w, H = d.h, U = 3, c = document.createElement('canvas'); c.width = W * U; c.height = H * U;
    const g = c.getContext('2d'), img = g.createImageData(W * U, H * U), px = img.data;
    const at = (i, k) => dist[Math.min(H - 1, Math.max(0, k)) * W + Math.min(W - 1, Math.max(0, i))];
    for (let y = 0; y < H * U; y++) for (let x = 0; x < W * U; x++) {
      // bilinear distance for smooth outlines at 3x the grid resolution
      const fx = x / U - 0.5, fy = y / U - 0.5, i = Math.floor(fx), k = Math.floor(fy), u = fx - i, v = fy - k;
      const D = (at(i, k) * (1 - u) + at(i + 1, k) * u) * (1 - v) + (at(i, k + 1) * (1 - u) + at(i + 1, k + 1) * u) * v;
      const o = (y * W * U + x) * 4;
      if (D > 3.2) continue;
      const side = D < 1.3, n = ((x * 73 + y * 151) % 17) - 8;
      px[o] = (side ? 140 : 66) + n; px[o + 1] = (side ? 138 : 68) + n; px[o + 2] = (side ? 132 : 72) + n; px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.anisotropy = BF._maxAniso || 4;
    const geo = new THREE.PlaneGeometry(W * d.cell, H * d.cell); geo.rotateX(-Math.PI / 2);
    geo.translate(d.x0 + W * d.cell / 2, -0.002, d.z0 + H * d.cell / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    return m;
  }
  // Clone of the tile keeping only the triangles of kept footprints (+ small street props)
  function cityInstance(src, ins) {
    const d = ins.d, R = d._reg, W = d.w, H = d.h, dist = streetMask(d, ins.keep);
    const obj = template(src, d);
    obj.updateMatrixWorld(true);
    const v = new THREE.Vector3(), cent = new THREE.Vector3();
    const labelNear = (i, k) => {
      for (let r = 0; r <= 2; r++) for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
        const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= W || kk >= H) continue;
        const l = R.lab[kk * W + ii]; if (l) return l;
      }
      return 0;
    };
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry, pos = geo.attributes.position, idx = geo.index, M = o.matrixWorld;
      const n = idx ? idx.count : pos.count, out = [];
      // quantized glTF positions are normalized integers; three r128's getX() doesn't
      // denormalize, so scale them back to the node-space values the matrices expect
      const arr = pos.array, nq = !pos.normalized ? 1 : arr instanceof Int16Array ? 1 / 32767 : arr instanceof Uint16Array ? 1 / 65535 : arr instanceof Int8Array ? 1 / 127 : arr instanceof Uint8Array ? 1 / 255 : 1;
      const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (let t = 0; t < n; t += 3) {
        cent.set(0, 0, 0); let maxY = -1e9;
        for (let j = 0; j < 3; j++) {
          const vi = idx ? idx.getX(t + j) : t + j;
          P[j].fromBufferAttribute(pos, vi).multiplyScalar(nq).applyMatrix4(M); cent.add(P[j]); maxY = Math.max(maxY, P[j].y);
        }
        cent.multiplyScalar(1 / 3);
        const i = Math.floor((cent.x - d.x0) / d.cell), k = Math.floor((cent.z - d.z0) / d.cell);
        const ic = Math.min(W - 1, Math.max(0, i)), kc = Math.min(H - 1, Math.max(0, k));
        let keepIt;
        const l = maxY > 0.02 ? labelNear(ic, kc) : 0;
        if (l) keepIt = !!ins.keep[l];
        else {
          const e = Math.max(P[0].distanceTo(P[1]), P[1].distanceTo(P[2]), P[0].distanceTo(P[2]));
          // flat ground pieces go (the painted ground plane replaces them, no z-fighting);
          // small raised street props near kept blocks stay
          keepIt = maxY > 0.02 && e < 1.0 && dist[kc * W + ic] <= 3;
        }
        if (keepIt) for (let j = 0; j < 3; j++) out.push(idx ? idx.getX(t + j) : t + j);
      }
      const g2 = new THREE.BufferGeometry();
      for (const k of Object.keys(geo.attributes)) g2.setAttribute(k, geo.attributes[k]); // shared vertex data
      g2.setIndex(out); g2.boundingSphere = geo.boundingSphere || (geo.computeBoundingSphere(), geo.boundingSphere);
      o.geometry = g2;
      o.visible = out.length > 0;
    });
    obj.children[0].add(groundPlane(d, dist));
    return obj;
  }

  BF.buildCity = (scene, terrain) => {
    const LIFT = 0.35; // m above the levelled pad, so model ground planes never z-fight the terrain
    const M = BF.CITY_MODELS || {};
    const group = new THREE.Group(); group.name = 'city'; scene.add(group);

    // Paved street-grid ground under clusters whose models have no ground of their own:
    // one 120 m block quad per block inside the cluster's organic outline (or under a tower)
    let stex = null;
    for (const C of terrain.clusters) {
      if (C.ground !== 'street') continue;
      stex = stex || streetTexture();
      const towers = new Set(C.items.filter((it) => it.part).map((it) => Math.round(it.x / 120) + ',' + Math.round(it.z / 120)));
      const pos = [], uv = [], idx = [];
      for (let i = -5; i <= 5; i++) for (let k = -5; k <= 5; k++) {
        const bx = i * 120, bz = k * 120, c = Math.cos(C.rot), sn = Math.sin(C.rot);
        const wx = C.x + bx * c + bz * sn, wz = C.z - bx * sn + bz * c;
        if (!towers.has(i + ',' + k) && !terrain.inBlob(C, wx, wz)) continue;
        const o = pos.length / 3;
        for (const [dx, dz] of [[-60, -60], [60, -60], [60, 60], [-60, 60]]) { pos.push(bx + dx, 0, bz + dz); uv.push((bx + dx) / 120, -(bz + dz) / 120); }
        idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const g = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: stex, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
      g.position.set(C.x, C.level + LIFT - 0.1, C.z); g.rotation.y = C.rot;
      group.add(g);
    }

    const byModel = {};
    for (const ins of terrain.instances) (byModel[ins.it.model] = byModel[ins.it.model] || []).push(ins);
    const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const placeMatrix = (ins) => tmpM.compose(tmpP.set(ins.x, ins.C.level + LIFT, ins.z), tmpQ.setFromAxisAngle(up, ins.rot), tmpS.setScalar(ins.s));

    for (const key of Object.keys(byModel)) {
      loadModel(key).then((src) => {
        if (!src || !group.parent) return; // failed, or the world was rebuilt meanwhile
        const list = byModel[key];
        if (key === 'panel') {
          // Instanced: one InstancedMesh per sub-mesh of the panel block
          const tpl = template(src, M.panel);
          tpl.updateMatrixWorld(true);
          tpl.traverse((o) => {
            if (!o.isMesh) return;
            const im = new THREE.InstancedMesh(o.geometry, o.material, list.length), local = o.matrixWorld.clone(), w = new THREE.Matrix4();
            list.forEach((ins, i) => im.setMatrixAt(i, w.multiplyMatrices(placeMatrix(ins), local)));
            im.instanceMatrix.needsUpdate = true;
            im.frustumCulled = false; // instances span the whole map
            group.add(im);
          });
          return;
        }
        for (const ins of list) {
          const obj = ins.keep ? cityInstance(src, ins) : template(src, ins.d, ins.it.part);
          if (!obj) continue;
          placeMatrix(ins).decompose(obj.position, obj.quaternion, obj.scale);
          obj.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
          obj.updateMatrixWorld(true);
          group.add(obj);
        }
      });
    }
    return { update() {} };
  };
})();
