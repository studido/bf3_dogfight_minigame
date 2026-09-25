// Pure terrain height function + city buildings. The sim uses this for collision
// (no mesh needed), so a headless server can run the exact same world.
window.BF = window.BF || {};

BF.makeTerrain = (seed, cfg) => {
  const n1 = BF.makeNoise(seed), n2 = BF.makeNoise(seed + 17), n3 = BF.makeNoise(seed + 91);
  const half = cfg.size / 2, H = cfg.heightScale;
  const WATER = 4;
  const smooth = (a, b, x) => { const t = BF.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // City plateau near the map centre: flat inside cityRadius, blends out to cityBlend.
  const CITY = { x: 0, z: 0, radius: 650, blend: 1050, ground: 40 };

  const raw = (x, z) => {
    const base = n1.fbm(x * 0.00042 + 3.1, z * 0.00042 - 1.7, 5);
    const ridgeN = n2.fbm(x * 0.0009, z * 0.0009, 4);
    const ridge = 1 - Math.abs(ridgeN * 2 - 1);
    const detail = n3.fbm(x * 0.004, z * 0.004, 3);
    const r = Math.max(Math.abs(x), Math.abs(z)) / half;
    const ring = smooth(0.5, 1.15, r);           // mountains toward the map edge
    let h = Math.pow(base, 2.0) * 0.75 + ridge * ridge * ridge * (0.25 + ring * 0.9) + detail * 0.035;
    return h * H - 60;
  };
  const height = (x, z) => {
    let h = raw(x, z);
    const d = Math.hypot(x - CITY.x, z - CITY.z);
    if (d < CITY.blend) h = BF.lerp(CITY.ground, h, smooth(CITY.radius, CITY.blend, d));
    return Math.max(h, WATER - 6);
  };

  // ---- Buildings: deterministic grid of high-rises, tallest in the middle ----
  const rnd = BF.rng(seed + 555), buildings = [], CELL = 110;
  for (let gx = -6; gx <= 6; gx++) for (let gz = -6; gz <= 6; gz++) {
    const bx = CITY.x + gx * CELL, bz = CITY.z + gz * CELL, rc = Math.hypot(bx - CITY.x, bz - CITY.z);
    if (rc > CITY.radius - 60) continue;
    if (rnd() < 0.12) continue;                         // plazas / parks
    const core = Math.exp(-(rc * rc) / (330 * 330));    // 1 in the middle, fades out
    const n = rnd() < 0.35 ? 1 : rnd() < 0.6 ? 2 : 4;   // towers per block
    for (let k = 0; k < n; k++) {
      const sub = n === 1 ? 0 : n === 2 ? (k ? 1 : -1) : 0;
      const w = n === 1 ? 44 + rnd() * 26 : 26 + rnd() * 14, dpt = n === 1 ? 44 + rnd() * 26 : 26 + rnd() * 14;
      const ox = n === 4 ? ((k & 1) ? 24 : -24) : n === 2 ? sub * 24 : 0, oz = n === 4 ? ((k & 2) ? 24 : -24) : 0;
      const h = 35 + core * (90 + rnd() * 170) + rnd() * 45;
      buildings.push({ x: bx + ox, z: bz + oz, w, d: dpt, h, base: CITY.ground - 2, top: CITY.ground + h, mast: core > 0.7 && rnd() < 0.35 });
    }
  }
  // Spatial hash so collision checks only look at nearby towers
  const hash = new Map(), key = (i, k) => i * 1000 + k;
  buildings.forEach((b, idx) => {
    for (let i = Math.floor((b.x - b.w / 2) / CELL); i <= Math.floor((b.x + b.w / 2) / CELL); i++)
      for (let k = Math.floor((b.z - b.d / 2) / CELL); k <= Math.floor((b.z + b.d / 2) / CELL); k++) {
        const kk = key(i, k); if (!hash.has(kk)) hash.set(kk, []); hash.get(kk).push(idx);
      }
  });
  // Building (if any) whose footprint, grown by `margin`, contains (x, z)
  const buildingAt = (x, z, margin = 0) => {
    if (Math.abs(x - CITY.x) > CITY.radius + 60 || Math.abs(z - CITY.z) > CITY.radius + 60) return null;
    const list = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    let best = null;
    for (const idx of list) {
      const b = buildings[idx];
      if (Math.abs(x - b.x) <= b.w / 2 + margin && Math.abs(z - b.z) <= b.d / 2 + margin && (!best || b.top > best.top)) best = b;
    }
    return best;
  };
  // Highest solid surface at (x, z): ground or rooftop (for AI and effects)
  const obstacleHeight = (x, z, margin = 0) => {
    const g = height(x, z), b = buildingAt(x, z, margin);
    return b ? Math.max(g, b.top) : g;
  };

  return { height, water: WATER, half, city: CITY, buildings, buildingAt, obstacleHeight };
};
