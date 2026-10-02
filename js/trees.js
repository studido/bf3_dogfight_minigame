// Trees (v0.1.41): the Jabami tree models (4 types) replace the old cones, scattered in
// noise-driven groves plus a few medium forests (terrain.forests).
//
// Tens of thousands of full models would be millions of triangles, so there are two tiers:
//  - Near (< NEAR m from the camera): real models, as InstancedMeshes (one per type and
//    sub-mesh) refilled from a spatial grid whenever the camera has moved ~60 m.
//  - Far: every tree as an impostor, three textured cards (two crossed vertical cards plus
//    a horizontal one for the view from above), all in a single InstancedMesh. The card
//    textures are rendered once from the real models into an atlas, so they match. A
//    shader discards impostors inside NEAR, where the real models stand.
// Leaves: the anime textures are mint green, so the leaf shader desaturates and darkens
// them toward a natural green, and bends their normals toward "up" so foliage is lit like
// a canopy (and the near models match the impostors).
// Trees sit on the rendered terrain surface (BF.meshHeightSampler), not the analytic
// height, so they never float between the 24 m mesh vertices.
window.BF = window.BF || {};

(() => {
  const TYPES = ['tree_v1', 'tree_v2', 'tree_v3', 'tree_v5'];
  const NEAR = 280;            // m: real models inside this radius, impostors beyond
  const COLS = 4, ATLAS_W = 2048, ATLAS_H = 1024;

  // ---- Model loading (base64 GLB, works from file://) ----
  let loading = null;
  function loadTrees() {
    if (loading) return loading;
    return (loading = new Promise((resolve) => {
      const parse = () => {
        const b64 = BF.ASSETS && BF.ASSETS.trees;
        if (!b64 || !THREE.GLTFLoader) { resolve(null); return; }
        let buf;
        try { buf = BF.b64bytes(b64); delete BF.ASSETS.trees; } catch (e) { resolve(null); return; }
        THREE.GLTFLoader.useImageElements = true;
        new THREE.GLTFLoader().parse(buf.buffer, '', (g) => resolve(prep(g.scene)), (err) => { console.warn('tree models failed to parse', err); resolve(null); });
      };
      if (BF.ASSETS && BF.ASSETS.trees) { parse(); return; }
      const el = document.createElement('script');
      el.src = 'assets/models/trees.glb.js?v=' + (BF.BUILD || '');
      el.onload = parse; el.onerror = () => resolve(null);
      (document.head || document.body).appendChild(el);
    }));
  }

  // Leaf look: desaturate/darken the mint-green anime leaves, canopy-style normals
  function leafShader(sh) {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.42) * vec3(0.6, 0.68, 0.5);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.7));`);
  }

  // Per type: sub-meshes with their matrices relative to a base-centred origin, plus size
  function prep(scene) {
    const out = {};
    scene.updateMatrixWorld(true);
    const mats = new Map();
    for (const name of TYPES) {
      const root = scene.getObjectByName(name);
      if (!root) continue;
      const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
      const toBase = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
      const parts = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const m0 = o.material, leaf = !/tron/i.test(m0.name || '');
        if (!mats.has(m0)) {
          const m = new THREE.MeshStandardMaterial({
            map: m0.map || null, color: m0.color ? m0.color.clone() : new THREE.Color(1, 1, 1),
            roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
            alphaTest: leaf ? 0.5 : 0, transparent: false,
          });
          if (m.map) { m.map.encoding = THREE.LinearEncoding; m.map.anisotropy = BF._maxAniso || 4; }
          if (leaf) m.onBeforeCompile = leafShader;
          else m.color.multiplyScalar(0.8);
          mats.set(m0, m);
        }
        parts.push({ geometry: o.geometry, material: mats.get(m0), local: new THREE.Matrix4().multiplyMatrices(toBase, o.matrixWorld) });
      });
      const size = box.getSize(new THREE.Vector3());
      out[name] = { parts, w: Math.max(size.x, size.z), h: size.y };
    }
    return out;
  }

  // ---- Impostor atlas: side view (row 0) and top view (row 1) of each type ----
  let atlas = null;
  function bakeAtlas(tpl) {
    if (atlas) return atlas;
    const R = BF._renderer;
    if (!R) return null;
    const rt = new THREE.WebGLRenderTarget(ATLAS_W, ATLAS_H, { format: THREE.RGBAFormat });
    rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    const sc = new THREE.Scene(); sc.add(new THREE.AmbientLight(0xffffff, 1)); // output = albedo
    const prevRT = R.getRenderTarget(), prevClear = R.getClearColor(new THREE.Color()), prevAlpha = R.getClearAlpha(), prevAuto = R.autoClear;
    R.setRenderTarget(rt); R.setClearColor(0x46603a, 0); // leaf-ish colour under alpha 0: no dark fringes in the mips R.autoClear = false; R.clear();
    const cw = ATLAS_W / COLS, ch = ATLAS_H / 2;
    TYPES.forEach((name, col) => {
      const t = tpl[name]; if (!t) return;
      const g = new THREE.Group();
      for (const p of t.parts) { const m = new THREE.Mesh(p.geometry, p.material); m.matrixAutoUpdate = false; m.matrix.copy(p.local); g.add(m); }
      sc.add(g);
      const hw = t.w / 2;
      // side: looking along -z, frame the whole tree
      const side = new THREE.OrthographicCamera(-hw, hw, t.h, 0, -100, 100);
      side.position.set(0, 0, 50); side.lookAt(0, 0, 0); side.updateMatrixWorld();
      // render-target viewports are in target pixels (no pixel ratio), set on the target itself
      const cell = (x, y) => { rt.viewport.set(x, y, cw, ch); rt.scissor.set(x, y, cw, ch); rt.scissorTest = true; R.setRenderTarget(rt); };
      cell(col * cw, 0);
      R.render(sc, side);
      // top: looking down, image up = -z
      const top = new THREE.OrthographicCamera(-hw, hw, hw, -hw, 0.1, t.h + 100);
      top.position.set(0, t.h + 50, 0); top.up.set(0, 0, -1); top.lookAt(0, 0, 0); top.updateMatrixWorld();
      cell(col * cw, ch);
      R.render(sc, top);
      sc.remove(g);
    });
    rt.scissorTest = false;
    R.setRenderTarget(prevRT); R.setClearColor(prevClear, prevAlpha); R.autoClear = prevAuto;
    BF._treeAtlas = rt; // (kept for debugging views)
    return (atlas = rt.texture);
  }

  // Unit impostor: two crossed vertical cards (row 0) + one horizontal card at 60 % (row 1)
  function impostorGeometry() {
    const pos = [], uv = [], row = [], nor = [], idx = [];
    const quad = (vs, uvs, r) => {
      const o = pos.length / 3;
      vs.forEach((v, i) => { pos.push(...v); uv.push(...uvs[i]); row.push(r); nor.push(0, 1, 0); });
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    quad([[-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0]], U, 0);
    quad([[0, 0, 0.5], [0, 0, -0.5], [0, 1, -0.5], [0, 1, 0.5]], U, 0);
    quad([[-0.5, 0.6, 0.5], [0.5, 0.6, 0.5], [0.5, 0.6, -0.5], [-0.5, 0.6, -0.5]], [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aRow', new THREE.Float32BufferAttribute(row, 1));
    g.setIndex(idx);
    return g;
  }

  // ---- Placement ----
  function place(terrain, cfg, hAt) {
    const T = [], r = BF.rng(99), noise = BF.makeNoise(4242), W = cfg.world.size;
    const ok = (x, z, h) => {
      if (h < terrain.water + 3 || h > 400) return false;
      if (terrain.nearestCluster(x, z).dist < 50) return false;   // keep the towns clear
      if (terrain.roadDist(x, z) < 14) return false;              // and the roads
      const sl = Math.abs(terrain.height(x + 6, z) - terrain.height(x - 6, z)) + Math.abs(terrain.height(x, z + 6) - terrain.height(x, z - 6));
      return sl < 14;                                              // no trees on cliffs
    };
    const add = (x, z, type, s) => {
      const h = hAt(x, z);
      if (!ok(x, z, h)) return;
      T.push({ x, y: h - 0.3, z, yaw: r() * Math.PI * 2, s, type, tint: 0.82 + r() * 0.3 });
    };
    // Groves: noise-driven scatter across the map
    for (let i = 0; i < 70000 && T.length < 6000; i++) {
      const x = (r() - 0.5) * W * 1.3, z = (r() - 0.5) * W * 1.3;
      if (noise.fbm(x * 0.0016 + 9, z * 0.0016, 3) < 0.53) continue;
      const k = r(), type = k < 0.2 ? 0 : k < 0.35 ? 1 : k < 0.7 ? 2 : 3;
      add(x, z, type, [1.5, 1.0, 1.7, 1.3][type] * (0.8 + r() * 0.45));
    }
    // Forests: jittered 14 m grid inside each outline, with a few clearings
    for (const f of terrain.forests || []) {
      for (let gx = -f.rMax; gx <= f.rMax; gx += 11) for (let gz = -f.rMax; gz <= f.rMax; gz += 11) {
        const x = f.x + gx + (r() - 0.5) * 8, z = f.z + gz + (r() - 0.5) * 8;
        const d = terrain.forestAt(x, z);
        if (d <= 0 || r() > d * 0.88) continue;
        if (noise.fbm(x * 0.004 - 3, z * 0.004 + 8, 3) < 0.36) continue; // clearings
        const k = r(), type = k < 0.5 ? 3 : k < 0.75 ? 2 : k < 0.92 ? 1 : 0;
        add(x, z, type, [1.7, 1.15, 2.0, 1.55][type] * (0.85 + r() * 0.35)); // mature forest: 15-25 m
      }
    }
    return T;
  }

  BF.buildTrees = (scene, terrain, cfg, ground) => {
    if (!ground || !BF.meshHeightSampler) return { update() {} };
    const trees = place(terrain, cfg, BF.meshHeightSampler(ground));
    const group = new THREE.Group(); group.name = 'trees'; scene.add(group);
    // 200 m spatial grid for the near-tier refill
    const CELL = 200, grid = new Map(), key = (i, k) => i * 4096 + k;
    trees.forEach((t, i) => { const kk = key(Math.floor(t.x / CELL), Math.floor(t.z / CELL)); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(i); });

    let near = null, lastFill = null;
    const m4 = new THREE.Matrix4(), w4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();

    loadTrees().then((tpl) => {
      if (!tpl || !group.parent) return;
      const tex = bakeAtlas(tpl);
      // Far tier: every tree as an impostor
      if (tex) {
        const geo = impostorGeometry(), n = trees.length, aCol = new Float32Array(n);
        const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.uNear = { value: NEAR };
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aRow;\nattribute float aCol;\nvarying float vCamDist;')
            .replace('#include <uv_vertex>', `#include <uv_vertex>
              vUv = vec2((aCol + uv.x) / ${COLS}.0, (aRow + uv.y) / 2.0);
              vCamDist = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);`);
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uNear;\nvarying float vCamDist;')
            .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vCamDist < uNear) discard;')
            // mip levels average the leaf alpha down; boost it so distant crowns stay solid
            .replace('#include <alphatest_fragment>', 'diffuseColor.a = clamp(diffuseColor.a * 1.7, 0.0, 1.0);\n#include <alphatest_fragment>')
            // the baked albedo lacks the near models' sunlit leaf highlights; lift it to match
            .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0;')
            // lit as canopy from both sides (DoubleSide would flip the normal down on back faces)
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
        };
        const im = new THREE.InstancedMesh(geo, mat, n);
        trees.forEach((t, i) => {
          const T = tpl[TYPES[t.type]]; aCol[i] = t.type;
          im.setMatrixAt(i, m4.compose(v3.set(t.x, t.y, t.z), q.setFromAxisAngle(up, t.yaw), s3.set(T.w * t.s, T.h * t.s, T.w * t.s)));
          im.setColorAt(i, col.setRGB(t.tint, t.tint, t.tint * 0.95));
        });
        geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 1));
        im.frustumCulled = false;
        group.add(im);
      }
      // Near tier: real models, refilled around the camera
      near = TYPES.map((name, ti) => {
        const T = tpl[name]; if (!T) return null;
        const cap = Math.min(3000, trees.filter((t) => t.type === ti).length) || 1;
        return T.parts.map((p) => {
          const im = new THREE.InstancedMesh(p.geometry, p.material, cap);
          im.count = 0; im.frustumCulled = false; im.userData.local = p.local; im.userData.cap = cap;
          im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
          group.add(im);
          return im;
        });
      });
      lastFill = null;
    });

    function refill(cam) {
      const R = NEAR + 90, ci = Math.floor(cam.x / CELL), ck = Math.floor(cam.z / CELL), span = Math.ceil(R / CELL);
      const counts = [0, 0, 0, 0];
      for (let dk = -span; dk <= span; dk++) for (let di = -span; di <= span; di++) {
        const l = grid.get(key(ci + di, ck + dk)); if (!l) continue;
        for (const i of l) {
          const t = trees[i], dx = t.x - cam.x, dz = t.z - cam.z;
          if (dx * dx + dz * dz > R * R) continue;
          const set = near[t.type]; if (!set) continue;
          const n = counts[t.type]; if (n >= set[0].userData.cap) continue;
          w4.compose(v3.set(t.x, t.y, t.z), q.setFromAxisAngle(up, t.yaw), s3.setScalar(t.s));
          col.setRGB(t.tint, t.tint, t.tint * 0.95);
          for (const im of set) { im.setMatrixAt(n, m4.multiplyMatrices(w4, im.userData.local)); im.setColorAt(n, col); }
          counts[t.type]++;
        }
      }
      // Upload only the used part of each instance buffer (the full 3000-slot buffers were
      // ~3 MB per refill, several times a second at speed: visible frame hitches)
      near.forEach((set, ti) => {
        if (!set) return;
        for (const im of set) {
          const n = counts[ti];
          im.count = n;
          im.instanceMatrix.updateRange.offset = 0; im.instanceMatrix.updateRange.count = n * 16; im.instanceMatrix.needsUpdate = true;
          im.instanceColor.updateRange.offset = 0; im.instanceColor.updateRange.count = n * 3; im.instanceColor.needsUpdate = true;
        }
      });
    }

    return {
      count: trees.length,
      update(camPos) {
        if (!near) return;
        if (!lastFill || lastFill.distanceToSquared(camPos) > 60 * 60) { refill(camPos); lastFill = (lastFill || new THREE.Vector3()).copy(camPos); }
      },
    };
  };
})();
