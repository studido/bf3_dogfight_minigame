// Terrain rendering (v0.1.38): smooth, detailed ground with photo texture splatting.
//
//  - Mesh: 640x640 grid over 15.3 km (~24 m spacing), heights from terrain.height() (the
//    same function the sim uses for collision), normals from the height function itself,
//    smooth shaded.
//  - Four layers: grass, dirt, rock, snow. Per-vertex weights from slope, altitude and noise
//    (attribute `splat`), so they blend smoothly.
//  - Each layer has a colour map and a packed normal+roughness map (normal X/Y in R/G,
//    roughness in B; Z is rebuilt in the shader). The real ones are Poly Haven photo
//    textures (assets/terrain/<set>_<q>.js, base64 so file:// works), 2K for Medium/High
//    texture quality and 1K for Low, loaded in the background. Until then (or if missing)
//    procedurally generated stand-ins are used. Packing keeps it at 9 texture units and
//    ~180 MB of VRAM at 2K (4K would be ~700 MB for ground you mostly see from 300 m up).
//  - Anti-tiling: every layer is sampled at two scales and blended, a large-scale "macro"
//    noise varies brightness and hue, and rock uses triplanar mapping so cliffs don't
//    stretch.
window.BF = window.BF || {};

(() => {
  // Poly Haven texture sets (CC0) and their real-world tile sizes in metres
  BF.TERRAIN_LAYERS = [
    { key: 'grass', set: 'aerial_grass_rock', tile: 70 },
    { key: 'dirt', set: 'forrest_ground_01', tile: 22 },
    { key: 'rock', set: 'aerial_rocks_02', tile: 60 },
    { key: 'snow', set: 'snow_02', tile: 35 },
  ];

  // ---- Procedural stand-in textures (used until the photo textures load) ----
  function canvasTex(size, paint, srgb) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), img = g.createImageData(size, size);
    paint(img.data, size);
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function tileNoise(seed) {
    // Tileable fBm on a torus: sample 4D-ish by mixing wrapped coords
    const n = BF.makeNoise(seed);
    return (u, v, oct) => {
      const a = u * Math.PI * 2, b = v * Math.PI * 2, R = 2.2;
      return n.fbm(Math.cos(a) * R + Math.sin(b) * 0.37, Math.sin(a) * R + Math.cos(b) * R * 0.9, oct);
    };
  }
  const STAND_IN = {
    grass: { base: [74, 98, 52], var: [38, 34, 20], rough: 0.92 },
    dirt: { base: [104, 88, 64], var: [36, 30, 22], rough: 0.95 },
    rock: { base: [118, 114, 106], var: [46, 44, 40], rough: 0.85 },
    snow: { base: [228, 232, 238], var: [18, 16, 12], rough: 0.6 },
  };
  function standIn(key, seed) {
    const S = 256, st = STAND_IN[key], nz = tileNoise(seed), hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = nz(x / S, y / S, 5);
    const diff = canvasTex(S, (d) => {
      for (let i = 0; i < S * S; i++) {
        const v = hgt[i] - 0.5;
        d[i * 4] = st.base[0] + v * st.var[0] * 2; d[i * 4 + 1] = st.base[1] + v * st.var[1] * 2; d[i * 4 + 2] = st.base[2] + v * st.var[2] * 2; d[i * 4 + 3] = 255;
      }
    }, false);
    const nor = canvasTex(S, (d) => {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
        const hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
        const nx = -hx * 6, ny = -hy * 6, nzv = 1, l = Math.hypot(nx, ny, nzv), i = (y * S + x) * 4;
        d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = st.rough * 255; d[i + 3] = 255;
      }
    }, false);
    return { diff, nr: nor };
  }

  // Large-scale variation map (brightness / hue drift over kilometres)
  function macroTex() {
    const nz = tileNoise(9091);
    return canvasTex(512, (d, S) => {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = nz(x / S, y / S, 5), b = nz((x / S + 0.31) % 1, (y / S + 0.57) % 1, 4), i = (y * S + x) * 4;
        d[i] = a * 255; d[i + 1] = b * 255; d[i + 2] = 128; d[i + 3] = 255;
      }
    }, false);
  }

  // ---- Photo texture loading (assets/terrain/<set>_<q>.js -> BF.ASSETS['terrain_<set>_<q>']) ----
  // Textures are cached per set+quality, so a new match (which rebuilds the world) reuses them.
  const setCache = {};
  function loadSet(set, q) {
    const sfx = q ? '_' + q : '', key = 'terrain_' + set + sfx;
    if (setCache[key]) return setCache[key];
    return (setCache[key] = new Promise((resolve) => {
      const done = () => {
        const a = BF.ASSETS && BF.ASSETS[key];
        if (!a || !a.diff || !a.nr) { delete setCache[key]; resolve(null); return; }
        const L = new THREE.TextureLoader(), out = {};
        let pending = 2;
        const fin = () => { if (--pending === 0) { delete BF.ASSETS[key]; resolve(out); } };
        for (const k of ['diff', 'nr']) {
          out[k] = L.load(a[k], fin, undefined, fin);
          out[k].wrapS = out[k].wrapT = THREE.RepeatWrapping;
          out[k].anisotropy = Math.min(8, BF._maxAniso || 8);
        }
      };
      if (BF.ASSETS && BF.ASSETS[key]) { done(); return; }
      const el = document.createElement('script');
      el.src = 'assets/terrain/' + set + sfx + '.js?v=' + (BF.BUILD || '');
      el.onload = done; el.onerror = () => { delete setCache[key]; resolve(null); };
      (document.head || document.body).appendChild(el);
    }));
  }
  // Texture quality setting -> terrain asset tier. High shares the 2K set (see header).
  const tierOf = (q) => (q === 'low' ? 'low' : 'medium');
  let terrQ = 'medium', liveMat = null, liveStandIns = null;
  function applyPhotos(mat, standIns, tier) {
    BF.TERRAIN_LAYERS.forEach((L, i) => {
      loadSet(L.set, tier).then((t) => {
        if (mat !== liveMat || tierOf(terrQ) !== tier) return; // superseded
        const u = mat.userData.uni;
        // Colours stay as-is (no sRGB decode): the whole scene is authored in display space
        u['tDiff' + i].value = t ? t.diff : standIns[i].diff;
        u['tNR' + i].value = t ? t.nr : standIns[i].nr;
        u.uPhoto.value.setComponent(i, t ? 1 : 0);
      });
    });
  }
  BF.setTerrainQuality = (q) => {
    const changed = tierOf(q) !== tierOf(terrQ);
    terrQ = q;
    if (changed && liveMat) applyPhotos(liveMat, liveStandIns, tierOf(q));
  };

  // Water stand-ins until assets/terrain/water.js loads (flat colour, flat normal)
  const flatTex = (r, g, b) => canvasTex(4, (d) => { for (let i = 0; i < 16; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; } }, false);
  let waterStandIn = null;

  // ---- Shader (MeshStandardMaterial + onBeforeCompile) ----
  const VERT_PARS = `
    attribute vec4 splat;
    attribute float aForest;
    varying float vForest;
    varying vec4 vSplat;
    varying vec3 vWPos;
    varying vec3 vWNorm;`;
  const VERT_MAIN = `
    vSplat = splat;
    vForest = aForest;
    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vWNorm = normalize(mat3(modelMatrix) * objectNormal);`;
  const FRAG_PARS = `
    varying vec4 vSplat;
    varying float vForest;
    varying vec3 vWPos;
    varying vec3 vWNorm;
    uniform sampler2D tDiff0, tDiff1, tDiff2, tDiff3;
    uniform sampler2D tNR0, tNR1, tNR2, tNR3;   // normal X/Y in RG, roughness in B
    uniform sampler2D tMacro;
    // Lakes are shaded here, not by a separate water plane: a flat plane meeting gently
    // sloping shores z-fought (24-bit depth at 2-4 km is 0.5-2 m), so shorelines crawled
    // around as the camera moved. Now the shoreline is simply where this surface crosses
    // the water level, exact per pixel and perfectly stable.
    uniform sampler2D tWaterDiff, tWaterNR;
    uniform float uWater, uTime;
    uniform vec3 uSkyRefl;
    float terrWater;      // 0 land .. 1 water
    float terrWet;        // damp band just above the waterline
    uniform vec4 uTile;        // tile size (m) per layer
    uniform vec4 uSrgb;        // 1 = layer textures are sRGB photos (decode), 0 = stand-ins
    uniform vec4 uPhoto;       // 1 = photo texture loaded for that layer
    uniform float uNormStr;
    vec3 toLin(vec3 c, float on) { return mix(c, pow(c, vec3(2.2)), on); }
    // Two-scale sample to break up visible tiling
    vec4 dual(sampler2D t, vec2 p, float tile) {
      vec2 a = p / tile, b = mat2(0.8, -0.6, 0.6, 0.8) * p / (tile * 3.7) + vec2(0.37, 0.11);
      return mix(texture2D(t, a), texture2D(t, b), 0.4);
    }
    // Triplanar for rock (no stretching on cliffs)
    vec4 tri(sampler2D t, vec3 p, vec3 n, float tile) {
      vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
      return texture2D(t, p.zy / tile) * w.x + texture2D(t, p.xz / tile) * w.y + texture2D(t, p.xy / tile) * w.z;
    }
    vec4 terrW;          // final layer weights
    vec3 terrColour;
    float terrRough;
    vec3 terrNormalW;
    void terrainSample() {
      vec4 w = max(vSplat, 0.0);
      // macro variation also nudges the blend so layer borders aren't uniform
      vec4 mac = texture2D(tMacro, vWPos.xz / 4200.0);
      vec4 mac2 = texture2D(tMacro, vWPos.xz / 900.0 + 0.5);
      w.y *= 0.6 + mac2.r * 0.9;           // dirt patches come and go
      w /= max(w.x + w.y + w.z + w.w, 1e-4);
      terrW = w;
      vec3 N = normalize(vWNorm);
      vec3 c0 = toLin(dual(tDiff0, vWPos.xz, uTile.x).rgb, uSrgb.x);
      // The Poly Haven grass photo is dry olive; under this sun it read as yellow steppe.
      // Pull it toward a temperate green (keeps its detail, only the hue/saturation move).
      float l0 = dot(c0, vec3(0.2126, 0.7152, 0.0722));
      c0 = mix(c0, mix(l0 * vec3(0.80, 1.02, 0.62), c0, 0.45) * 0.9, uPhoto.x);
      vec3 c1 = toLin(dual(tDiff1, vWPos.xz, uTile.y).rgb, uSrgb.y);
      vec3 c2 = toLin(tri(tDiff2, vWPos, N, uTile.z).rgb, uSrgb.z);
      vec3 c3 = toLin(dual(tDiff3, vWPos.xz, uTile.w).rgb, uSrgb.w);
      vec3 c = c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w;
      // kilometre-scale brightness and hue drift (fields, sun-dried slopes)
      float bright = 0.82 + mac.r * 0.36;
      vec3 hue = mix(vec3(0.94, 1.02, 0.92), vec3(1.06, 1.0, 0.9), mac.g);
      c *= bright * mix(vec3(1.0), hue, w.x + w.y);
      // shaded forest floor: darker, cooler green under the canopy
      c *= mix(vec3(1.0), vec3(0.42, 0.5, 0.36), vForest);
      terrColour = c;
      vec3 p0 = dual(tNR0, vWPos.xz, uTile.x).xyz, p1 = dual(tNR1, vWPos.xz, uTile.y).xyz;
      vec3 p2 = texture2D(tNR2, vWPos.xz / uTile.z).xyz, p3 = dual(tNR3, vWPos.xz, uTile.w).xyz;
      float r2 = tri(tNR2, vWPos, N, uTile.z).b;   // rock roughness: triplanar like its colour
      terrRough = p0.b * w.x + p1.b * w.y + r2 * w.z + p3.b * w.w;
      // Tangent-space normals (OpenGL convention), blended by weight, in a world frame
      // built from the terrain's geometric normal (u along +X, v along +Z). Only X/Y are
      // stored; the blend renormalises, so Z = 1 works as the up component.
      vec2 nxy = (p0.xy * 2.0 - 1.0) * w.x + (p1.xy * 2.0 - 1.0) * w.y
               + (p2.xy * 2.0 - 1.0) * w.z * N.y + (p3.xy * 2.0 - 1.0) * w.w;
      vec3 nt = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.04)));
      nt.xy *= uNormStr;
      vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
      vec3 B = normalize(cross(T, N));   // +Z: image 'up' with flipY textures
      terrNormalW = normalize(T * nt.x + B * nt.y + N * max(nt.z, 0.2));

      // ---- Water ----
      float depth = uWater - vWPos.y;
      terrWater = smoothstep(-0.05, 0.35, depth);
      terrWet = (1.0 - terrWater) * (1.0 - smoothstep(0.0, 1.6, -depth));
      terrColour *= 1.0 - 0.3 * terrWet;
      terrRough = mix(terrRough, 0.5, terrWet);
      if (terrWater > 0.0) {
        // two ripple layers drifting in different directions
        vec2 wp = vWPos.xz;
        vec2 r1 = texture2D(tWaterNR, wp / 38.0 + vec2(0.011, 0.006) * uTime).xy * 2.0 - 1.0;
        vec2 r2 = texture2D(tWaterNR, mat2(0.6, -0.8, 0.8, 0.6) * wp / 23.0 - vec2(0.008, 0.013) * uTime).xy * 2.0 - 1.0;
        vec3 wn = normalize(vec3((r1.x + r2.x) * 0.35, 1.0, (r1.y + r2.y) * 0.35));
        vec3 det = texture2D(tWaterDiff, wp / 55.0 + vec2(0.004, 0.002) * uTime).rgb / vec3(0.21, 0.33, 0.43);
        vec3 deep = vec3(0.07, 0.15, 0.20), shallow = vec3(0.20, 0.30, 0.29);
        vec3 wc = mix(shallow, deep, smoothstep(0.3, 5.0, depth)) * mix(vec3(1.0), det, 0.35);
        terrColour = mix(terrColour, wc, terrWater);
        terrRough = mix(terrRough, 0.12, terrWater);
        terrNormalW = normalize(mix(terrNormalW, wn, terrWater));
      }
    }`;

  function makeMaterial(layers, macro) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    const uni = {
      tMacro: { value: macro }, uNormStr: { value: 1.0 },
      tWaterDiff: { value: waterStandIn.diff }, tWaterNR: { value: waterStandIn.nr },
      uWater: { value: 4 }, uTime: { value: 0 }, uSkyRefl: { value: new THREE.Color(0x9fb3c8) },
      uTile: { value: new THREE.Vector4(...BF.TERRAIN_LAYERS.map((l) => l.tile)) },
      uSrgb: { value: new THREE.Vector4(0, 0, 0, 0) },
      uPhoto: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    layers.forEach((L, i) => { uni['tDiff' + i] = { value: L.diff }; uni['tNR' + i] = { value: L.nr }; });
    mat.userData.uni = uni;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_MAIN);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <map_fragment>', 'terrainSample();\n diffuseColor.rgb = terrColour;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(terrRough, 0.35, 1.0);')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(terrNormalW, 0.0)).xyz);')
        // sky reflection on the water: Fresnel blend toward the sky/haze colour
        .replace('#include <fog_fragment>', `if (terrWater > 0.0) {
            vec3 V = normalize(cameraPosition - vWPos);
            float fres = 0.04 + 0.96 * pow(1.0 - max(dot(V, terrNormalW), 0.0), 5.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uSkyRefl, clamp(fres, 0.0, 0.85) * terrWater);
          }
          #include <fog_fragment>`);
    };
    return mat;
  }

  // Per-vertex splat weights: grass / dirt / rock / snow
  function splatAt(terrain, x, z, h, ny, noise) {
    const slope = 1 - ny;                                    // 0 flat .. 1 vertical
    let rock = BF.clamp((slope - 0.18) / 0.22, 0, 1);
    rock = Math.max(rock, BF.clamp((h - 380) / 160, 0, 1) * BF.clamp((slope - 0.06) / 0.2, 0, 1));
    let snow = BF.clamp((h - 470) / 70, 0, 1) * (1 - BF.clamp((slope - 0.35) / 0.25, 0, 1));
    const n = noise.fbm(x * 0.0022 + 5, z * 0.0022 - 3, 3);
    let dirt = BF.clamp((n - 0.56) / 0.14, 0, 1) * 0.85;
    dirt = Math.max(dirt, 1 - BF.clamp((h - terrain.water - 2) / 4, 0, 1)); // narrow beaches
    // Worn ground around towns: under and just around the footprint, fading out
    const nc = terrain.nearestCluster(x, z);
    if (nc.cluster) dirt = Math.max(dirt, (nc.cluster.dirt ? 0.55 : 1) * (1 - BF.clamp(nc.dist / 140, 0, 1)));
    // worn verges along the roads
    if (terrain.roadDist) dirt = Math.max(dirt, 0.7 * (1 - BF.clamp((terrain.roadDist(x, z) - 6) / 22, 0, 1)));
    snow *= 1 - rock * 0.6;
    const grass = Math.max(0, 1 - rock - snow - dirt * 0.9);
    return [grass, dirt * (1 - rock), rock * (1 - snow), snow];
  }

  BF.buildTerrainMesh = (scene, terrain, cfg) => {
    const size = cfg.world.size * 1.7, segs = 640;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, nor = geo.attributes.normal, splat = new Float32Array(pos.count * 4);
    const noise = BF.makeNoise(4242), e = 6;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = terrain.height(x, z);
      pos.setY(i, h);
      const dx = (terrain.height(x + e, z) - terrain.height(x - e, z)) / (2 * e);
      const dz = (terrain.height(x, z + e) - terrain.height(x, z - e)) / (2 * e);
      const l = Math.hypot(dx, 1, dz), ny = 1 / l;
      nor.setXYZ(i, -dx / l, ny, -dz / l);
      splat.set(splatAt(terrain, x, z, h, ny, noise), i * 4);
    }
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    const forest = new Float32Array(pos.count);
    if (terrain.forestAt) for (let i = 0; i < pos.count; i++) forest[i] = terrain.forestAt(pos.getX(i), pos.getZ(i));
    geo.setAttribute('aForest', new THREE.BufferAttribute(forest, 1));
    geo.computeBoundingSphere();

    const layers = BF.TERRAIN_LAYERS.map((L, i) => standIn(L.key, 700 + i * 31));
    waterStandIn = waterStandIn || { diff: flatTex(54, 84, 110), nr: flatTex(128, 128, 40) };
    const mat = makeMaterial(layers, macroTex());
    mat.userData.uni.uWater.value = terrain.water;
    loadSet('water', '').then((t) => { if (t && mat === liveMat) { mat.userData.uni.tWaterDiff.value = t.diff; mat.userData.uni.tWaterNR.value = t.nr; } });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.grid = { size, segs }; // roads.js drapes onto these exact triangles
    scene.add(mesh);

    // Swap in the Poly Haven photo textures as each set arrives
    liveMat = mat; liveStandIns = layers;
    applyPhotos(mat, layers, tierOf(terrQ));
    return mesh;
  };
})();
