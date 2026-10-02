// Pure terrain height function + building clusters. The sim uses this for collision
// (no mesh needed), so a headless server can run the exact same world. Building collision
// comes from height grids baked from the 3D models (js/city-data.js), not from the meshes.
window.BF = window.BF || {};

BF.makeTerrain = (seed, cfg) => {
  const n1 = BF.makeNoise(seed), n2 = BF.makeNoise(seed + 17), n3 = BF.makeNoise(seed + 91);
  const half = cfg.size / 2, H = cfg.heightScale;
  const WATER = 4;
  const smooth = (a, b, x) => { const t = BF.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // Terrain shape (v0.1.38): gradient-noise lowlands, domain-warped so nothing lines up
  // with the axes, plus ridged multifractal mountains (sharp ridgelines, eroded-looking
  // flanks). Ranges ring the map edge, with a few inner ranges; rolling valleys in between.
  const n4 = BF.makeNoise(seed + 203);
  const ridged = (x, z, oct) => {
    let sum = 0, amp = 0.5, f = 1, w = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      let r = 1 - Math.abs(n2(x * f, z * f) * 2 - 1); r *= r; r *= w;
      w = r * 1.6; if (w > 1) w = 1;
      sum += r * amp; norm += amp; amp *= 0.5; f *= 2.03;
    }
    return sum / norm;
  };
  const raw = (x, z) => {
    const wx = x + (n3.fbm(x * 0.00025 + 11, z * 0.00025 - 4, 3) - 0.5) * 900;
    const wz = z + (n3.fbm(x * 0.00025 - 7, z * 0.00025 + 5, 3) - 0.5) * 900;
    const base = n1.fbm(wx * 0.00035 + 3.1, wz * 0.00035 - 1.7, 5);
    const r = Math.max(Math.abs(x), Math.abs(z)) / half;
    const ringMask = smooth(0.45, 1.05, r);
    const rangeMask = smooth(0.52, 0.75, n4.fbm(wx * 0.0003, wz * 0.0003, 3));
    const mask = Math.max(ringMask, rangeMask * 0.75);
    const m = ridged(wx * 0.0005, wz * 0.0005, 6);
    const low = Math.pow(base, 1.6) * 0.42;
    const mtn = Math.pow(m, 1.3) * 1.25 * mask;
    const detail = (n3.fbm(x * 0.006, z * 0.006, 3) - 0.5) * 0.03;
    return (low + mtn + detail) * H - 55;
  };
  // ---- Building clusters (v0.1.39) ----
  // Each cluster sits on a levelled pad: flat over the buildings' footprint (+ pad), then
  // blending back into the natural terrain over `blend` metres. Items are model instances
  // in cluster-local metres; `part` picks one tower out of the New York set.
  const PI = Math.PI;
  // Downtown: the landmark towers packed close (60-130 m apart), ringed by panel blocks
  const NY = [
    ['tower_one_16', 0, 0, 0], ['emp_state._final_14', -120, 18, 0], ['christler_17', 114, -24, 0.3],
    ['new_york_times_19', -36, -126, 0], ['woolworth_18', 72, 114, 0], ['metlife_15', -138, 138, PI / 2],
    ['g2_9', 132, 102, 0], ['g6_13', -132, -120, 0], ['g3_10', 36, -228, 0], ['g1_8', -228, 0, 0],
    ['g5_12', 216, 12, 0], ['flatiron_20', -10, 240, 0], ['g4_11', 180, -150, 0.2],
    ['b1_0', -270, -200, 0], ['b2_1', 228, -252, 0], ['b3_2', 252, 180, 0], ['b4_3', -252, 180, 0],
    ['b5_4', 120, 252, 0], ['b6_5', -180, -252, 0],
  ].map(([part, x, z, rot]) => ({ model: 'ny', part, x, z, rot, scale: 80 }));
  for (const v of [-240, -80, 80, 240]) {
    NY.push({ model: 'panel', x: v, z: -345, rot: 0, scale: 1 }, { model: 'panel', x: v, z: 345, rot: PI, scale: 1 });
    if (Math.abs(v) < 200) NY.push({ model: 'panel', x: -365, z: v, rot: PI / 2, scale: 1 }, { model: 'panel', x: 365, z: v, rot: -PI / 2, scale: 1 });
  }
  // Fill the empty downtown blocks (120 m grid, block centres at multiples of 120) with
  // pairs of panel blocks, skipping any block a tower already stands in.
  {
    const M0 = BF.CITY_MODELS || {}, half = (it) => {
      const d = it.part ? M0.ny && M0.ny[it.part] : M0[it.model]; if (!d) return [0, 0];
      const rx = d.sx * it.scale / 2, rz = d.sz * it.scale / 2, c = Math.abs(Math.cos(it.rot)), sn = Math.abs(Math.sin(it.rot));
      return [rx * c + rz * sn, rx * sn + rz * c];
    };
    const taken = NY.map((it) => { const [hx, hz] = half(it); return [it.x - hx, it.z - hz, it.x + hx, it.z + hz]; });
    const free = (x0, z0, x1, z1) => !taken.some((t) => x0 < t[2] + 8 && x1 > t[0] - 8 && z0 < t[3] + 8 && z1 > t[1] - 8);
    for (let i = -3; i <= 3; i++) for (let k = -2; k <= 2; k++) {
      const bx = i * 120, bz = k * 120;
      if (!free(bx - 44, bz - 44, bx + 44, bz + 44)) continue;
      const alongX = (i + k) & 1, pair = alongX ? [[bx, bz - 22, 0], [bx, bz + 22, PI]] : [[bx - 22, bz, PI / 2], [bx + 22, bz, -PI / 2]];
      for (const [x, z, rot] of pair) { NY.push({ model: 'panel', x, z, rot, scale: 1 }); taken.push([x - 30, z - 30, x + 30, z + 30]); }
    }
  }
  const panelRows = (cols, rows, dx, dz, rot0 = 0) => {
    const out = [];
    for (let i = 0; i < cols; i++) for (let k = 0; k < rows; k++)
      out.push({ model: 'panel', x: (i - (cols - 1) / 2) * dx, z: (k - (rows - 1) / 2) * dz, rot: rot0 + ((i + k) % 3 === 2 ? PI : 0), scale: 1 });
    return out;
  };
  const CLUSTERS = [
    { id: 'metro', x: -700, z: -1000, rot: 0.25, pad: 40, blend: 450, items: [{ model: 'city', x: 0, z: 0, rot: 0, scale: 95 }] },
    { id: 'harbour', x: -1500, z: 1350, rot: PI / 2 + 0.4, pad: 40, blend: 400, items: [{ model: 'city', x: 0, z: 0, rot: 0, scale: 60 }] },
    { id: 'skyline', x: 2150, z: -1000, rot: 0.35, pad: 45, blend: 400, ground: 'street', items: NY },
    { id: 'estate', x: -2500, z: -1900, rot: -0.4, pad: 50, blend: 300, dirt: true, items: panelRows(4, 5, 85, 75) },
  ];
  // A few small panel-block hamlets on the valley floors (deterministic from the seed)
  {
    const r = BF.rng(seed + 777); let tries = 0;
    while (CLUSTERS.length < 10 && tries++ < 400) {
      const x = (r() - 0.5) * cfg.size * 0.8, z = (r() - 0.5) * cfg.size * 0.8;
      const h = raw(x, z);
      if (h < WATER + 8 || h > 140 || Math.abs(z) > 2450) continue;
      if (Math.abs(raw(x + 250, z) - h) + Math.abs(raw(x, z + 250) - h) > 50) continue; // flat-ish only
      if (CLUSTERS.some((c) => Math.hypot(c.x - x, c.z - z) < 1500)) continue;
      const n = 2 + Math.floor(r() * 3);
      CLUSTERS.push({ id: 'hamlet' + CLUSTERS.length, x, z, rot: r() * PI, pad: 40, blend: 220, dirt: true, items: panelRows(n, 1 + (r() < 0.5 ? 1 : 0), 80, 70) });
    }
  }
  // ---- Organic outlines (v0.1.40) ----
  // Every cluster gets a polar outline: a radius per angle around its centre, wobbled by a
  // few low harmonics, so towns are blobs rather than squares. For the city tile, whole
  // buildings/blocks (connected footprints in its height grid) are kept or dropped by that
  // outline, with a few stragglers just outside it; the dropped ones lose collision too.
  const M = BF.CITY_MODELS || {};
  const NB = 72, TAU = PI * 2;
  const toWorld = (cx, cz, rot, lx, lz) => [cx + lx * Math.cos(rot) + lz * Math.sin(rot), cz - lx * Math.sin(rot) + lz * Math.cos(rot)];
  const wobble = (rng, amp) => {
    const h = [2, 3, 4, 5, 7].map((k) => [k, rng() * TAU, (rng() - 0.5) * 2 / k]);
    const t = new Float32Array(NB);
    for (let i = 0; i < NB; i++) { const a = i / NB * TAU; let v = 0; for (const [k, ph, w] of h) v += Math.sin(k * a + ph) * w; t[i] = 1 + v * amp; }
    return t;
  };
  const polar = (tab, ang) => {
    let f = (ang / TAU) * NB; f = ((f % NB) + NB) % NB;
    const i = Math.floor(f), j = (i + 1) % NB, u = f - i;
    return tab[i] * (1 - u) + tab[j] * u;
  };
  const angOf = (C, x, z) => Math.atan2(z - C.z, x - C.x);
  // Connected building footprints in a model's height grid (q >= 2), cached per model
  const regions = (d) => {
    if (d._reg) return d._reg;
    const g = d._bytes || (d._bytes = BF.b64bytes(d.q)), W = d.w, H = d.h, lab = new Int32Array(W * H), cx = [0], cz = [0], n = [0];
    let nr = 0; const st = [];
    for (let s0 = 0; s0 < W * H; s0++) {
      if (lab[s0] || g[s0] < 2) continue;
      nr++; cx.push(0); cz.push(0); n.push(0); lab[s0] = nr; st.push(s0);
      while (st.length) {
        const c = st.pop(), i = c % W, k = (c - i) / W;
        cx[nr] += i; cz[nr] += k; n[nr]++;
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= W || kk >= H) continue;
          const c2 = kk * W + ii; if (!lab[c2] && g[c2] >= 2) { lab[c2] = nr; st.push(c2); }
        }
      }
    }
    for (let r = 1; r <= nr; r++) { cx[r] = d.x0 + (cx[r] / n[r] + 0.5) * d.cell; cz[r] = d.z0 + (cz[r] / n[r] + 0.5) * d.cell; }
    return (d._reg = { lab, count: nr, cx, cz, n });
  };

  const instances = [];
  for (const C of CLUSTERS) {
    const rng = BF.rng(seed * 7 + C.x * 3 + C.z), reach = [];   // reach: [x, z, radius] circles that must sit on the pad
    C.blob = null;
    const city = C.items.length === 1 && C.items[0].model === 'city';
    if (city) {
      const it = C.items[0], d = M.city, s = it.scale;
      if (d) {
        const hs = Math.min(d.sx, d.sz) / 2 * s, w = wobble(rng, 0.45);
        C.blob = w.map((v, i) => {
          const a = i / NB * TAU, la = a + C.rot + it.rot;                    // direction in the tile's own frame
          const edge = hs / Math.max(Math.abs(Math.cos(la)), Math.abs(Math.sin(la)));
          return Math.min(hs * 0.68 * v, edge * 0.97);
        });
      }
    } else if (C.ground === 'street') {
      C.blob = wobble(rng, 0.4).map((v) => 430 * v);
    }
    for (const it of C.items) {
      const d = it.part ? M.ny && M.ny[it.part] : M[it.model];
      if (!d) continue;
      const s = it.scale, rx = d.sx * s / 2, rz = d.sz * s / 2;
      const [wx, wz] = toWorld(C.x, C.z, C.rot, it.x, it.z);
      const ins = { C, it, d, x: wx, z: wz, rot: C.rot + it.rot, s, r: Math.hypot(rx, rz), keep: null };
      if (it.model === 'panel' && C.blob) {             // street-grid fillers: only inside the outline
        if (Math.hypot(wx - C.x, wz - C.z) > polar(C.blob, angOf(C, wx, wz))) continue;
      }
      if (it.model === 'city' && C.blob) {
        const R = regions(d), keep = new Uint8Array(R.count + 1), cs = Math.cos(ins.rot), sn = Math.sin(ins.rot);
        for (let r = 1; r <= R.count; r++) {
          const px = wx + s * (R.cx[r] * cs + R.cz[r] * sn), pz = wz + s * (-R.cx[r] * sn + R.cz[r] * cs);
          const rr = Math.hypot(px - C.x, pz - C.z) / polar(C.blob, angOf(C, px, pz));
          const h = ((r * 2654435761) ^ (seed * 97 + C.x | 0)) >>> 0;  // stable per-region dice
          if (rr < 1 || (rr < 1.2 && (h % 1000) / 1000 < (1.2 - rr) / 0.2 * 0.55)) {
            keep[r] = 1;
            reach.push([px, pz, Math.sqrt(R.n[r] / PI) * d.cell * s + 12]);
          }
        }
        ins.keep = keep;
      } else reach.push([wx, wz, Math.max(rx, rz)]);
      instances.push(ins);
    }
    // Pad outline: wobbly blob (if any) grown to cover every kept building, smoothed, + pad
    const t = new Float32Array(NB);
    for (let i = 0; i < NB; i++) {
      const a = i / NB * TAU, ux = Math.cos(a), uz = Math.sin(a);
      let r = C.blob ? C.blob[i] : 0;
      for (const [x, z, rad] of reach) {
        const dx = x - C.x, dz = z - C.z, along = dx * ux + dz * uz, perp = Math.abs(-dx * uz + dz * ux);
        if (perp < rad) r = Math.max(r, along + Math.sqrt(rad * rad - perp * perp));
      }
      t[i] = r;
    }
    const pw = wobble(rng, 0.3);
    C.R = t.map((_, i) => { let m = 0; for (let k = -3; k <= 3; k++) m = Math.max(m, t[(i + k + NB) % NB]); return m; })
      .map((v, i, arr) => (arr[(i + NB - 1) % NB] + v * 2 + arr[(i + 1) % NB]) / 4 + C.pad * pw[i]);
    C.rMax = Math.max(...C.R);
    // Pad level: mean natural height over the outline, kept above the water
    let sum = raw(C.x, C.z), n = 1;
    for (let i = 0; i < NB; i += 6) for (const f of [0.35, 0.7, 1]) {
      const a = i / NB * TAU, rr = C.R[i] * f; sum += raw(C.x + Math.cos(a) * rr, C.z + Math.sin(a) * rr); n++;
    }
    C.level = Math.max(sum / n, WATER + 6);
  }
  // Signed distance (m, approximate) from a cluster's outline: <= 0 inside
  const clusterDist = (C, x, z) => Math.hypot(x - C.x, z - C.z) - polar(C.R, angOf(C, x, z));
  // Nearest cluster and the distance to it (used by the renderer for trees / ground layers)
  const nearestCluster = (x, z) => {
    let best = null, bd = Infinity;
    for (const C of CLUSTERS) {
      if (Math.abs(x - C.x) > C.rMax + bd || Math.abs(z - C.z) > C.rMax + bd) continue;
      const d = clusterDist(C, x, z); if (d < bd) { bd = d; best = C; }
    }
    return { cluster: best, dist: bd };
  };
  // Inside a cluster's building outline (no pad)? Used for city ground and filler placement.
  const inBlob = (C, x, z) => !!C.blob && Math.hypot(x - C.x, z - C.z) < polar(C.blob, angOf(C, x, z));

  const height = (x, z) => {
    let h = raw(x, z);
    for (const C of CLUSTERS) {
      const lim = C.rMax + C.blend;
      if (Math.abs(x - C.x) > lim || Math.abs(z - C.z) > lim) continue;
      const d = clusterDist(C, x, z);
      if (d < C.blend) h = BF.lerp(C.level, h, smooth(0, C.blend, d));
    }
    return Math.max(h, WATER - 6);
  };

  // ---- Building collision: spatial hash of instances over 250 m cells ----
  const CELL = 250, hash = new Map(), key = (i, k) => i * 4096 + k;
  instances.forEach((ins) => {
    ins.grid = ins.d.q && (ins.d._bytes || (ins.d._bytes = BF.b64bytes(ins.d.q)));
    ins.cos = Math.cos(ins.rot); ins.sin = Math.sin(ins.rot);
    for (let i = Math.floor((ins.x - ins.r) / CELL); i <= Math.floor((ins.x + ins.r) / CELL); i++)
      for (let k = Math.floor((ins.z - ins.r) / CELL); k <= Math.floor((ins.z + ins.r) / CELL); k++) {
        const kk = key(i, k); if (!hash.has(kk)) hash.set(kk, []); hash.get(kk).push(ins);
      }
  });
  const ROOF_MIN = 3; // m: ignore street furniture / kerbs
  // Building (if any) whose footprint, grown by `margin` metres, contains (x, z):
  // { top, base } of the tallest grid cell found, else null.
  const buildingAt = (x, z, margin = 0) => {
    const list = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    let top = -Infinity, base = 0;
    for (const ins of list) {
      const dx = x - ins.x, dz = z - ins.z;
      if (dx * dx + dz * dz > (ins.r + margin) * (ins.r + margin) || !ins.grid) continue;
      // world -> model units around the bbox centre
      const d = ins.d, lx = (dx * ins.cos - dz * ins.sin) / ins.s, lz = (dx * ins.sin + dz * ins.cos) / ins.s, m = margin / ins.s;
      const i0 = Math.max(0, Math.floor((lx - m - d.x0) / d.cell)), i1 = Math.min(d.w - 1, Math.floor((lx + m - d.x0) / d.cell));
      const k0 = Math.max(0, Math.floor((lz - m - d.z0) / d.cell)), k1 = Math.min(d.h - 1, Math.floor((lz + m - d.z0) / d.cell));
      let q = 0;
      const lab = ins.keep && d._reg.lab;
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
        const j = k * d.w + i, v = ins.grid[j];
        if (v > q && (!lab || ins.keep[lab[j]])) q = v;   // dropped city blocks have no collision
      }
      const hgt = q / 255 * d.maxH * ins.s;
      if (hgt >= ROOF_MIN && ins.C.level + hgt > top) { top = ins.C.level + hgt; base = ins.C.level; }
    }
    return top > -Infinity ? { top, base } : null;
  };
  // Highest solid surface at (x, z): ground or rooftop (for AI and effects)
  const obstacleHeight = (x, z, margin = 0) => {
    const g = height(x, z), b = buildingAt(x, z, margin);
    return b ? Math.max(g, b.top) : g;
  };

  // ---- Roads (v0.1.40) ----
  // Towns are linked by roads routed with A* over a 50 m grid: cost grows with slope and
  // altitude, lakes are impassable, so roads follow valleys and skirt lakes. A minimum
  // spanning tree links every town, plus a few extra links and two highways leaving the
  // map. Paths are smoothed (Chaikin) and resampled every 8 m. Render-only (the sim never
  // reads them), but deterministic so every player sees the same network.
  const roads = [];
  {
    const G = 50, N = Math.ceil((half + 900) * 2 / G), o = -(N * G) / 2;
    const hgt = new Float32Array(N * N);
    for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) hgt[k * N + i] = height(o + (i + 0.5) * G, o + (k + 0.5) * G);
    const cellOf = (x, z) => [BF.clamp(Math.floor((x - o) / G), 0, N - 1), BF.clamp(Math.floor((z - o) / G), 0, N - 1)];
    const wet = (j) => hgt[j] < WATER + 1.5;
    const astar = (sx, sz, tx, tz) => {
      const [si, sk] = cellOf(sx, sz), [ti, tk] = cellOf(tx, tz), S = sk * N + si, T = tk * N + ti;
      const gs = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
      const heap = [], push = (f, j) => { heap.push([f, j]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
      const hEst = (j) => Math.hypot(j % N - ti, ((j / N) | 0) - tk) * G;
      gs[S] = 0; push(hEst(S), S);
      while (heap.length) {
        const [, j] = pop(); if (closed[j]) continue; closed[j] = 1;
        if (j === T) break;
        const i = j % N, k = (j / N) | 0;
        for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
          if (!di && !dk) continue;
          const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= N || kk >= N) continue;
          const j2 = kk * N + ii; if (closed[j2]) continue;
          if (wet(j2) && j2 !== T) continue;
          const len = (di && dk ? 1.4142 : 1) * G, slope = Math.abs(hgt[j2] - hgt[j]) / len;
          const cost = len * (1 + 60 * slope * slope + Math.max(0, hgt[j2] - 160) / 120);
          const g2 = gs[j] + cost;
          if (g2 < gs[j2]) { gs[j2] = g2; from[j2] = j; push(g2 + hEst(j2), j2); }
        }
      }
      if (from[T] < 0 && T !== S) return null;
      const out = []; for (let j = T; j >= 0; j = from[j]) out.push([o + (j % N + 0.5) * G, o + (((j / N) | 0) + 0.5) * G]);
      out.reverse(); out[0] = [sx, sz]; out[out.length - 1] = [tx, tz];
      return out;
    };
    // Network: MST over the towns + extra short links + two highways off the map
    const nodes = CLUSTERS.map((C) => [C.x, C.z]);
    const edges = [], inTree = [0];
    while (inTree.length < nodes.length) {
      let best = null;
      for (const a2 of inTree) nodes.forEach((n2, b2) => {
        if (inTree.includes(b2)) return;
        const d = Math.hypot(n2[0] - nodes[a2][0], n2[1] - nodes[a2][1]);
        if (!best || d < best[2]) best = [a2, b2, d];
      });
      edges.push(best); inTree.push(best[1]);
    }
    nodes.forEach((n1, a2) => {
      const near = nodes.map((n2, b2) => [b2, Math.hypot(n2[0] - n1[0], n2[1] - n1[1])]).filter(([b2]) => b2 !== a2).sort((p, q) => p[1] - q[1]);
      const [b2, d] = near[1] || [];
      if (b2 !== undefined && d < 3200 && !edges.some((e) => (e[0] === a2 && e[1] === b2) || (e[0] === b2 && e[1] === a2))) edges.push([a2, b2, d]);
    });
    for (const exit of [[-half - 800, -1300], [half + 800, 600]]) {
      let bi = 0, bd = Infinity; nodes.forEach((n2, b2) => { const d = Math.hypot(n2[0] - exit[0], n2[1] - exit[1]); if (d < bd) { bd = d; bi = b2; } });
      nodes.push(exit); edges.push([bi, nodes.length - 1, bd]);
    }
    for (const [a2, b2] of edges) {
      let pts = astar(nodes[a2][0], nodes[a2][1], nodes[b2][0], nodes[b2][1]);
      if (!pts) continue;
      // String-pull: skip grid waypoints while the straight line stays dry and gentle,
      // so roads run in long natural lines instead of 50 m grid stair-steps
      const clear = (p, q) => {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 25));
        let prev = height(p[0], p[1]);
        for (let i = 1; i <= n; i++) {
          const x = p[0] + (q[0] - p[0]) * i / n, z = p[1] + (q[1] - p[1]) * i / n, h = height(x, z);
          if (h < WATER + 1.5 || Math.abs(h - prev) / (L / n) > 0.09) return false;
          prev = h;
        }
        return true;
      };
      const pulled = [pts[0]];
      for (let i = 0; i < pts.length - 1;) {
        let j = Math.min(pts.length - 1, i + 40);
        while (j > i + 1 && !clear(pts[i], pts[j])) j--;
        pulled.push(pts[j]); i = j;
      }
      pts = pulled;
      for (let it = 0; it < 3; it++) {                       // Chaikin smoothing
        const q = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
          q.push([x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25], [x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75]);
        }
        q.push(pts[pts.length - 1]); pts = q;
      }
      const res = [pts[0]]; let carry = 0;                    // resample every 8 m
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], L = Math.hypot(x1 - x0, z1 - z0);
        let t = 8 - carry;
        while (t <= L) { res.push([x0 + (x1 - x0) * t / L, z0 + (z1 - z0) * t / L]); t += 8; }
        carry = L - (t - 8);
      }
      // stop where the road reaches a town's buildings (its streets take over)
      const inside = ([x, z]) => CLUSTERS.some((C) => clusterDist(C, x, z) < 0 && (C.blob ? inBlob(C, x, z) && buildingAt(x, z, 25) : clusterDist(C, x, z) < -C.pad * 0.5));
      let i0 = 0, i1 = res.length - 1;
      while (i0 < i1 && inside(res[i0])) i0++;
      while (i1 > i0 && inside(res[i1])) i1--;
      const seg = res.slice(Math.max(0, i0 - 3), i1 + 4);
      if (seg.length > 4) roads.push(seg);
    }
  }
  // Distance (m) to the nearest road centreline, via a 100 m spatial hash of the segments
  const RC = 100, rhash = new Map(), rkey = (i, k) => i * 4096 + k;
  roads.forEach((pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const kk = rkey(Math.floor(pts[i][0] / RC), Math.floor(pts[i][1] / RC));
      if (!rhash.has(kk)) rhash.set(kk, []); rhash.get(kk).push(pts[i], pts[i + 1]);
    }
  });
  const roadDist = (x, z) => {
    let best = Infinity; const ci = Math.floor(x / RC), ck = Math.floor(z / RC);
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      const l = rhash.get(rkey(ci + di, ck + dk)); if (!l) continue;
      for (let i = 0; i < l.length; i += 2) {
        const [ax, az] = l[i], [bx, bz] = l[i + 1], ex = bx - ax, ez = bz - az;
        const t = BF.clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1), 0, 1);
        const d = Math.hypot(x - ax - ex * t, z - az - ez * t); if (d < best) best = d;
      }
    }
    return best;
  };

  // ---- Forests (v0.1.41) ----
  // A few medium forests (about 1.1-1.7 km across) with wobbly outlines, on lowland or
  // gentle hills away from the towns. Render-only (trees.js fills them, the ground shader
  // gives them a forest floor); deterministic from the seed.
  const forests = [];
  {
    const r = BF.rng(seed + 4049); let tries = 0;
    while (forests.length < 3 && tries++ < 600) {
      const x = (r() - 0.5) * cfg.size * 0.85, z = (r() - 0.5) * cfg.size * 0.85, h = height(x, z);
      if (h < WATER + 10 || h > 260 || Math.abs(z) > 3800) continue;
      if (nearestCluster(x, z).dist < 900) continue;
      if (forests.some((f) => Math.hypot(f.x - x, f.z - z) < 2600)) continue;
      const base = 550 + r() * 300;
      forests.push({ x, z, R: wobble(r, 0.35).map((v) => base * v) });
    }
    for (const f of forests) f.rMax = Math.max(...f.R);
  }
  // 0 outside .. 1 inside a forest (90 m soft edge)
  const forestAt = (x, z) => {
    let v = 0;
    for (const f of forests) {
      if (Math.abs(x - f.x) > f.rMax + 100 || Math.abs(z - f.z) > f.rMax + 100) continue;
      const d = Math.hypot(x - f.x, z - f.z) - polar(f.R, Math.atan2(z - f.z, x - f.x));
      v = Math.max(v, 1 - smooth(-90, 0, d));
    }
    return v;
  };

  return { height, water: WATER, half, clusters: CLUSTERS, instances, nearestCluster, inBlob, polar, roads, roadDist, forests, forestAt, buildingAt, obstacleHeight };
};
