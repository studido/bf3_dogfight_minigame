// Road ribbons (v0.1.40): the A* road network from terrain.js, drawn as textured strips
// draped on the terrain mesh.
//
//  - Vertex heights come from the rendered terrain triangles themselves (same grid and
//    triangulation as the PlaneGeometry in terrain-render.js), not from terrain.height(),
//    so the strip lies on the surface you actually see instead of floating or sinking
//    between the 24 m mesh vertices.
//  - A small lift plus a depth bias (polygonOffset, which scales with depth precision)
//    keeps it on top at any distance, so it doesn't flicker the way the old water plane did.
//  - Texture: procedural two-lane asphalt, 24 m per repeat: gravel shoulders, solid white
//    edge lines, dashed centre line.
window.BF = window.BF || {};

(() => {
  let roadTex = null;
  function texture() {
    if (roadTex) return roadTex;
    const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data, r = BF.rng(2024);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, v = (y + 0.5) / H, i = (y * W + x) * 4, n = (r() - 0.5) * 22;
      let col;
      if (u < 0.08 || u > 0.92) col = [118 + n, 112 + n, 98 + n];                       // gravel shoulder
      else {
        col = [64 + n * 0.6, 66 + n * 0.6, 70 + n * 0.6];                               // asphalt
        const tyre = Math.abs(Math.abs(u - 0.5) - 0.22) < 0.05 ? -6 : 0;                 // darker wheel tracks
        col = col.map((cc) => cc + tyre);
        if (Math.abs(u - 0.105) < 0.009 || Math.abs(u - 0.895) < 0.009) col = [205 + n * 0.3, 205 + n * 0.3, 198 + n * 0.3]; // edge lines
        if (Math.abs(u - 0.5) < 0.008 && (v % 0.5) < 0.125) col = [215, 215, 208];     // 3 m dash every 12 m
      }
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    roadTex = new THREE.CanvasTexture(c);
    roadTex.wrapS = THREE.ClampToEdgeWrapping; roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.anisotropy = BF._maxAniso || 4;
    return roadTex;
  }

  // Height of the rendered terrain surface at (x, z): the mesh's own triangle interpolation
  function meshSampler(ground) {
    const { size, segs } = ground.userData.grid, pos = ground.geometry.attributes.position, s = size / segs, h0 = -size / 2;
    const yAt = (ix, iz) => pos.getY(iz * (segs + 1) + ix);
    return (x, z) => {
      const fx = BF.clamp((x - h0) / s, 0, segs - 1e-4), fz = BF.clamp((z - h0) / s, 0, segs - 1e-4);
      const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
      // PlaneGeometry cell (rotated flat): triangles (a, b, d) and (b, c, d), diagonal b-d
      const ha = yAt(ix, iz), hb = yAt(ix, iz + 1), hc = yAt(ix + 1, iz + 1), hd = yAt(ix + 1, iz);
      return u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
    };
  }

  BF.meshHeightSampler = meshSampler; // trees.js plants on the same surface

  BF.buildRoads = (scene, terrain, ground) => {
    if (!terrain.roads || !terrain.roads.length || !ground) return null;
    const hAt = meshSampler(ground), HALF = 5.5, LIFT = 0.25, ACROSS = [-1, -0.5, 0, 0.5, 1];
    const pos = [], uv = [], idx = [];
    for (const pts of terrain.roads) {
      let along = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        if (i) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
        const base = pos.length / 3;
        for (const f of ACROSS) {
          const x = p[0] - tz * HALF * f, z = p[1] + tx * HALF * f;
          pos.push(x, hAt(x, z) + LIFT, z); uv.push((f + 1) / 2, along / 24);
        }
        if (i) {
          const prev = base - ACROSS.length;
          for (let k = 0; k < ACROSS.length - 1; k++) idx.push(prev + k, prev + k + 1, base + k, prev + k + 1, base + k + 1, base + k); // counter-clockwise from above
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: texture(), roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    mesh.name = 'roads';
    scene.add(mesh);
    return mesh;
  };
})();
