// Math, seeded RNG, and noise. No THREE dependency except the vector helpers.
window.BF = window.BF || {};

BF.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
BF.lerp = (a, b, t) => a + (b - a) * t;
BF.DEG = Math.PI / 180;
// Frame-rate independent smoothing: move `a` toward `b` with rate k (1/s).
BF.damp = (a, b, k, dt) => BF.lerp(a, b, 1 - Math.exp(-k * dt));
// Move toward target by at most `step`.
BF.approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// Piecewise-linear lookup over [[x, y], ...] sorted by x.
BF.curve = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
};

// Deterministic RNG (mulberry32) so a future server and clients agree.
BF.rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// 2D value noise + fBm, seeded.
BF.makeNoise = (seed) => {
  const r = BF.rng(seed), perm = new Uint8Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const s = (t) => t * t * (3 - 2 * t);
  const v = (x, y) => vals[perm[(perm[x & 255] + y) & 255]];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = s(xf), w = s(yf);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return BF.lerp(BF.lerp(a, b, u), BF.lerp(c, d, u), w);
  };
  noise.fbm = (x, y, oct = 5) => {
    let f = 1, amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += noise(x * f, y * f) * amp; norm += amp; f *= 2.03; amp *= 0.5; }
    return sum / norm;
  };
  return noise;
};
