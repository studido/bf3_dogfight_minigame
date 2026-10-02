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
// Value noise + fBm, seeded (the original, kept for things that want its look).
BF.makeValueNoise = (seed) => {
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

// Gradient (Perlin) noise + fBm, seeded, output ~0..1. Value noise lines up with the grid
// and makes blocky, axis-aligned hills; gradient noise gives natural terrain shapes.
BF.makeNoise = (seed) => {
  const r = BF.rng(seed), perm = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (xi, yi, x, y) => { const h = perm[(perm[xi & 255] + yi) & 255]; return gx[h] * x + gy[h] * y; };
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = fade(xf), w = fade(yf);
    const a = grad(xi, yi, xf, yf), b = grad(xi + 1, yi, xf - 1, yf), c = grad(xi, yi + 1, xf, yf - 1), d = grad(xi + 1, yi + 1, xf - 1, yf - 1);
    const n = a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w; // ~[-0.7, 0.7]
    return n * 0.72 + 0.5;
  };
  noise.fbm = (x, y, oct = 5) => {
    let f = 1, amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += noise(x * f + i * 17.3, y * f - i * 9.1) * amp; norm += amp; f *= 2.03; amp *= 0.5; }
    return sum / norm;
  };
  return noise;
};

// Base64 -> Uint8Array without atob (works in any JS context, e.g. a headless sim)
BF.b64bytes = (s) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', T = new Uint8Array(128);
  for (let i = 0; i < 64; i++) T[A.charCodeAt(i)] = i;
  const n = s.length, pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, out = new Uint8Array(n * 3 / 4 - pad);
  for (let i = 0, j = 0; i < n; i += 4) {
    const v = (T[s.charCodeAt(i)] << 18) | (T[s.charCodeAt(i + 1)] << 12) | (T[s.charCodeAt(i + 2)] << 6) | T[s.charCodeAt(i + 3)];
    if (j < out.length) out[j++] = v >> 16; if (j < out.length) out[j++] = (v >> 8) & 255; if (j < out.length) out[j++] = v & 255;
  }
  return out;
};
