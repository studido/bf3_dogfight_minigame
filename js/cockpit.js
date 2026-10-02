// F/A-18-style cockpit (v0.1.43), modelled on reference renders of a Super Hornet front
// office: canopy bow arch with bolts and grab pads, HUD with twin posts and a tinted
// combiner, glare shield with standby compass and GO/NO-GO lights, two DDIs and the UFC
// across the top of the panel, the colour moving-map AMPCD below, engine/fuel display,
// standby instruments, canopy jettison handle, sills and side consoles.
//
// Layout is authored in "reference screen" coordinates (fx, fy in 0..1 of a 16:9 frame,
// as in the reference images) plus a depth, and converted to camera space with S(). The
// cockpit view uses a lens shift (camera.setViewOffset) that puts the boresight 27 % down
// the screen, as in the reference, so the HUD sits high and the panel fills the lower part.
// The world camera gets the same shift (main.js), so the HUD symbology still lines up.
//
// Rendered as a second pass after the world (never clips into terrain). Displays are live
// canvas textures: radar PPI, attack B-scope, UFC, engine page, colour moving map built from
// the actual terrain, standby attitude/altimeter/airspeed/VSI, AOA indexer.
window.BF = window.BF || {};

// Boresight (where the nose / guns point) on screen in cockpit view: exactly the centre of
// the HUD combiner glass (glass spans ref fy 0.173..0.42, + the 0.06 layout shift). The
// glass sits on the HUD base on the glare shield (v0.1.48: it used to float ~8 cm above it).
BF.COCKPIT_BORESIGHT = (0.173 + 0.42) / 2 + 0.06;

(() => {
  const V3 = THREE.Vector3;
  const TANV = Math.tan(35 * Math.PI / 180), TANH = TANV * 16 / 9; // layout reference: 70° vfov, 16:9
  const BS = 1 - 2 * BF.COCKPIT_BORESIGHT;                          // boresight NDC y
  const SHIFT = 0.06;                                                // ref image fy -> our fy
  const S = (fx, fy, d) => new V3((2 * fx - 1) * TANH * d, ((1 - 2 * (fy + SHIFT)) - BS) * TANV * d, -d);
  const panelD = (fy) => 0.86 - (fy - 0.5) * 0.36;                   // panel leans back toward the top

  // ---------- small canvas helpers ----------
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const texOf = (c, repeat) => { const t = new THREE.CanvasTexture(c); t.anisotropy = 4; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return t; };
  function noiseTex(base, amp, size = 256, seed = 7) {
    const c = canvas(size, size), g = c.getContext('2d'), im = g.createImageData(size, size), r = BF.rng(seed);
    for (let i = 0; i < size * size; i++) {
      const n = (r() - 0.5) * amp + (r() < 0.004 ? -amp * 1.5 : 0);
      im.data[i * 4] = base[0] + n; im.data[i * 4 + 1] = base[1] + n; im.data[i * 4 + 2] = base[2] + n; im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return texOf(c, true);
  }
  function stripes(w, h, a, b, n) {
    const c = canvas(w, h), g = c.getContext('2d');
    g.fillStyle = a; g.fillRect(0, 0, w, h); g.fillStyle = b;
    const step = (w + h) / n;
    for (let i = -n; i < n * 2; i++) { g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step + step / 2, 0); g.lineTo(i * step + step / 2 - h, h); g.lineTo(i * step - h, h); g.fill(); }
    return texOf(c);
  }

  BF.Cockpit = class {
    constructor() {
      this.scene = new THREE.Scene();
      this.cam = new THREE.PerspectiveCamera(70, 1, 0.03, 20);
      this.hemi = new THREE.HemisphereLight(0xe4ecf8, 0x4a4640, 0.95); this.scene.add(this.hemi);
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));
      this.sun = new THREE.DirectionalLight(0xfff1d6, 0.8); this.scene.add(this.sun); this.scene.add(this.sun.target);
      this.mfdT = 0; this.screens = {}; this.mapFor = null;
      this.build();
    }

    build() {
      const Sc = this.scene;
      const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.2, ...o });
      const M = {
        panel: std(0xffffff, { map: noiseTex([46, 50, 55], 10, 256, 3) }),
        hood: std(0xffffff, { map: noiseTex([36, 39, 43], 7, 256, 5), roughness: 0.9 }),
        bezel: std(0x202326, { roughness: 0.6 }),
        button: std(0x9aa1a8, { roughness: 0.5, metalness: 0.1 }),
        knob: std(0x141618, { roughness: 0.4, metalness: 0.5 }),
        frame: std(0x5d5851, { roughness: 0.62, metalness: 0.35 }),
        rim: std(0x66778c, { roughness: 0.45, metalness: 0.4 }),
        sill: std(0x8a99ab, { roughness: 0.5, metalness: 0.3 }),
        wall: std(0xffffff, { map: noiseTex([58, 63, 70], 10, 256, 11) }),
        pad: std(0x3e4a5a, { roughness: 0.45 }),
        black: std(0x0f1113, { roughness: 0.5 }),
        silver: std(0xb8c0c8, { roughness: 0.25, metalness: 0.85 }),
        grey: std(0xc4c8cc, { roughness: 0.5 }),
        jett: std(0xffffff, { map: stripes(64, 256, '#d9b21e', '#16181a', 10), roughness: 0.55 }),
      };
      this.M = M; this.detailMats = [];
      const facing = (o, at = new V3(0, 0, 0)) => { o.lookAt(at); return o; };
      const add = (o) => { Sc.add(o); return o; };
      // Box facing the eye, centred between two reference points at a depth
      const plate = (fx0, fy0, fx1, fy1, d, mat, th = 0.012) => {
        const a = S(fx0, fy0, d), b = S(fx1, fy1, d);
        const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b.x - a.x), Math.abs(b.y - a.y), th), mat);
        m.position.copy(S((fx0 + fx1) / 2, (fy0 + fy1) / 2, d)); return add(facing(m));
      };
      // Beam between two 3D points (w across, h up)
      const beam = (p, q, w, h, mat) => {
        const len = p.distanceTo(q), m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
        m.position.copy(p).add(q).multiplyScalar(0.5); m.lookAt(q); return add(m);
      };
      const knob = (fx, fy, d, r, mat = M.knob, h = 0.016) => {
        const geo = new THREE.CylinderGeometry(r, r * 1.1, h, 14); geo.rotateX(Math.PI / 2);
        const m = new THREE.Mesh(geo, mat); m.position.copy(S(fx, fy, d)); return add(facing(m));
      };
      const light = (fx, fy, d, w, color) => {
        const m = plate(fx - w / 2, fy - w * 0.7, fx + w / 2, fy + w * 0.7, d, new THREE.MeshBasicMaterial({ color }), 0.006); return m;
      };
      // Flat polygon in reference coordinates with a per-vertex depth function -> mesh
      const poly = (pts, depth, mat, uvBox) => {
        const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
        const geo = new THREE.ShapeGeometry(shape, 6), pos = geo.attributes.position, uv = geo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const fx = pos.getX(i), fy = pos.getY(i), p = S(fx, fy, depth(fx, fy));
          if (uvBox) uv.setXY(i, (fx - uvBox[0]) / (uvBox[2] - uvBox[0]), 1 - (fy - uvBox[1]) / (uvBox[3] - uvBox[1]));
          pos.setXYZ(i, p.x, p.y, p.z);
        }
        // fy runs downward, so the mapping mirrors the shape: flip the winding where the
        // triangles ended up facing away from the eye (they were back-face culled = holes)
        const ix = geo.index, a = new V3(), b = new V3(), c = new V3();
        a.fromBufferAttribute(pos, ix.getX(0)); b.fromBufferAttribute(pos, ix.getX(1)); c.fromBufferAttribute(pos, ix.getX(2));
        const nrm = new V3().crossVectors(b.clone().sub(a), c.clone().sub(a));
        if (nrm.dot(a) > 0) for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); }
        geo.computeVertexNormals();
        return add(new THREE.Mesh(geo, mat));
      };
      const mirror = (pts) => pts.map(([x, y]) => [1 - x, y]).reverse();

      // ---------- Canopy bow arch ----------
      const archRef = [[0.112, 0.74], [0.118, 0.56], [0.145, 0.39], [0.205, 0.23], [0.295, 0.11], [0.395, 0.05], [0.5, 0.035], [0.605, 0.05], [0.705, 0.11], [0.795, 0.23], [0.855, 0.39], [0.882, 0.56], [0.888, 0.74]];
      const AD = 0.62, arch = new THREE.CatmullRomCurve3(archRef.map(([x, y]) => S(x, y, AD)));
      const prof = new THREE.Shape(); prof.moveTo(-0.05, -0.04); prof.lineTo(0.05, -0.04); prof.lineTo(0.055, 0.0); prof.lineTo(0.042, 0.036); prof.lineTo(-0.042, 0.036); prof.lineTo(-0.055, 0.0); prof.closePath();
      add(new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { steps: 90, bevelEnabled: false, extrudePath: arch }), M.frame));
      // thin blue-grey outer rim
      const c0 = S(0.5, 0.5, AD);
      const rimPts = archRef.map(([x, y]) => { const p = S(x, y, AD); return p.clone().sub(c0).multiplyScalar(1.085).add(c0).add(new V3(0, 0, 0.02)); });
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts), 80, 0.011, 6, false), M.rim));
      // bolts along the inner edge
      const boltGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.016, 6); boltGeo.rotateX(Math.PI / 2);
      for (let t = 0.07; t < 0.95; t += 0.072) {
        const p = arch.getPointAt(t), inward = c0.clone().sub(p).setZ(0).normalize();
        const b = new THREE.Mesh(boltGeo, M.knob); b.position.copy(p).addScaledVector(inward, 0.028).add(new V3(0, 0, 0.035)); add(facing(b));
        const b2 = new THREE.Mesh(boltGeo, M.knob); b2.position.copy(p).addScaledVector(inward, -0.03).add(new V3(0, 0, 0.034)); add(facing(b2));
      }
      // grab pads on both sides of the bow
      for (const s of [-1, 1]) {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.pad);
        pad.scale.set(0.036, 0.12, 0.022); pad.position.copy(S(s < 0 ? 0.168 : 0.832, 0.33, AD - 0.04)); pad.rotation.z = s * 0.3; add(pad);
      }

      // ---------- Sills and side walls ----------
      for (const s of [0, 1]) {
        const X = (x) => (s ? 1 - x : x);
        beam(S(X(0.0), 0.775, 0.48), S(X(0.255), 0.648, 0.86), 0.07, 0.05, M.sill);
        const wall = [[0.0, 0.81], [0.258, 0.668], [0.272, 0.69], [0.272, 1.0], [0.0, 1.0]];
        poly(s ? mirror(wall) : wall, (fx) => 0.5 + Math.min(fx, 1 - fx) * 1.3, M.wall, [0, 0.6, 1, 1]);
      }

      // ---------- Glare shield hood ----------
      const lip = [[0.255, 0.655], [0.29, 0.615], [0.33, 0.567], [0.38, 0.523], [0.43, 0.497], [0.5, 0.49], [0.57, 0.497], [0.62, 0.523], [0.67, 0.567], [0.71, 0.615], [0.745, 0.655]];
      {
        const near = lip.map(([x, y]) => S(x, y, panelD(y) - 0.04)), far = lip.map(([x, y]) => S(0.5 + (x - 0.5) * 1.08, y - 0.038, 1.25));
        const pos = [], idx = [];
        for (let i = 0; i < lip.length; i++) { pos.push(near[i].x, near[i].y, near[i].z, far[i].x, far[i].y, far[i].z); }
        for (let i = 0; i < lip.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        const huv = []; lip.forEach(([x]) => huv.push(x * 2, 0, x * 2, 0.6));
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(huv, 2)); g.setIndex(idx); g.computeVertexNormals();
        const n = g.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
        add(new THREE.Mesh(g, M.hood)).material.side = THREE.DoubleSide;
        // front lip band
        const band = [], bi = [];
        lip.forEach(([x, y]) => { const a = S(x, y, panelD(y) - 0.04), b = S(x, y + 0.018, panelD(y) - 0.04); band.push(a.x, a.y, a.z, b.x, b.y, b.z); });
        for (let i = 0; i < lip.length - 1; i++) { const a = i * 2; bi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(band, 3)); bg.setIndex(bi); bg.computeVertexNormals();
        add(new THREE.Mesh(bg, M.black.clone())).material.side = THREE.DoubleSide;
      }
      // vent grilles either side of the UFC top
      for (const x0 of [0.395, 0.57]) {
        const c = canvas(64, 64), g = c.getContext('2d'); g.fillStyle = '#1a1c1f'; g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#3a3e43'; for (let i = 0; i < 8; i++) g.fillRect(4, 4 + i * 7.5, 56, 3);
        plate(x0, 0.475, x0 + 0.035, 0.53, 0.86, std(0xffffff, { map: texOf(c) }), 0.008);
      }
      // standby compass on the coaming + GO / NO GO + BIT
      plate(0.46, 0.425, 0.54, 0.47, 0.98, M.grey, 0.03);
      const cg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24), std(0x3f6c99, { roughness: 0.15, metalness: 0.3 }));
      cg.position.copy(S(0.5, 0.428, 1.06)); add(cg);
      const cmp = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.05, 12), M.silver); cmp.position.copy(S(0.497, 0.405, 0.98)); add(cmp);
      const cmpTop = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), M.silver); cmpTop.position.copy(S(0.497, 0.385, 0.98)); add(cmpTop);
      this.goLight = light(0.532, 0.468, 0.84, 0.009, 0x2bff62);
      light(0.532, 0.497, 0.84, 0.009, 0xe8ecef);
      knob(0.552, 0.486, 0.84, 0.009, M.bezel);

      // ---------- HUD ----------
      const HD = 0.95;
      beam(S(0.428, 0.24, HD), S(0.434, 0.445, 0.9), 0.012, 0.03, M.black);
      beam(S(0.572, 0.24, HD), S(0.566, 0.445, 0.9), 0.012, 0.03, M.black);
      plate(0.425, 0.425, 0.575, 0.47, 0.92, M.bezel, 0.05);
      const glassRef = [[0.437, 0.173], [0.563, 0.173], [0.577, 0.225], [0.574, 0.42], [0.426, 0.42], [0.423, 0.225]];
      this.glassRef = glassRef; this.HD = HD;
      {
        const c = canvas(64, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
        gr.addColorStop(0, 'rgba(170,255,235,0.30)'); gr.addColorStop(1, 'rgba(150,235,215,0.14)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
        const glass = poly(glassRef, () => HD, new THREE.MeshBasicMaterial({ map: texOf(c), transparent: true, depthWrite: false, side: THREE.DoubleSide }), [0.42, 0.165, 0.58, 0.425]);
        glass.renderOrder = 10;
        const edge = glassRef.map(([x, y]) => S(x, y, HD - 0.002)); edge.push(edge[0]);
        add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), new THREE.LineBasicMaterial({ color: 0x8fd8c6, transparent: true, opacity: 0.6 })));
      }
      // AOA indexer on the left post
      plate(0.397, 0.302, 0.413, 0.368, 0.9, M.black, 0.02);
      this.aoa = [0.315, 0.335, 0.355].map((fy, i) => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), new THREE.MeshBasicMaterial({ color: [0xffa020, 0x30ff60, 0xff3020][i] }));
        m.position.copy(S(0.405, fy, 0.882)); return add(facing(m));
      });

      // ---------- Instrument panel face ----------
      const panelPts = [[0.27, 0.668], ...lip.slice(1, -1).map(([x, y]) => [x, y + 0.016]), [0.73, 0.668], [0.73, 1.06], [0.27, 1.06]];
      const deco = canvas(1024, 1024); this.drawPanelDecals(deco);
      this.deco = deco; this.decoMat = std(0xffffff, { map: texOf(deco), roughness: 0.78 });
      poly(panelPts, (fx, fy) => panelD(fy), this.decoMat, [0.27, 0.48, 0.73, 1.06]);

      // DDIs, UFC, AMPCD, EFD, standby instruments
      const screen = (key, fx0, fy0, fx1, fy1, d, w, h) => {
        const c = canvas(w, h), t = texOf(c);
        const a = S(fx0, fy0, d), b = S(fx1, fy1, d);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(b.x - a.x), Math.abs(b.y - a.y)), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
        m.position.copy(S((fx0 + fx1) / 2, (fy0 + fy1) / 2, d)); add(facing(m));
        this.screens[key] = { c, g: c.getContext('2d'), t, w, h };
      };
      const bezelFace = (labels, w = 256, h = 256) => {
        const c = canvas(w, h), g = c.getContext('2d');
        g.fillStyle = '#25282c'; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
        g.fillStyle = '#d9dde2'; g.font = 'bold 11px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const [t, x, y] of labels) g.fillText(t, x * w, y * h);
        return [M.bezel, M.bezel, M.bezel, M.bezel, std(0xffffff, { map: texOf(c), roughness: 0.6 }), M.bezel];
      };
      const ddi = (key, fx0, fx1) => {
        const fy0 = 0.535, fy1 = 0.748, d = panelD(0.64) - 0.015;
        const bz = plate(fx0, fy0, fx1, fy1, d, M.bezel, 0.025);
        bz.material = bezelFace([['NIGHT', 0.3, 0.05], ['DAY', 0.7, 0.05], ['OFF', 0.62, 0.02], ['AUTO', 0.38, 0.02], ['BRT', 0.12, 0.96], ['CONT', 0.88, 0.96]]);
        const sx0 = fx0 + 0.02, sx1 = fx1 - 0.02, sy0 = fy0 + 0.05, sy1 = fy1 - 0.035;
        screen(key, sx0, sy0, sx1, sy1, d - 0.014, 384, 384);
        for (let i = 0; i < 5; i++) {
          const t = sy0 + (i + 0.5) * (sy1 - sy0) / 5, u = sx0 + (i + 0.5) * (sx1 - sx0) / 5, bw = 0.0085;
          plate(fx0 + 0.006, t - bw, fx0 + 0.006 + 2 * bw * 0.62, t + bw, d - 0.016, M.button, 0.008);
          plate(fx1 - 0.006 - 2 * bw * 0.62, t - bw, fx1 - 0.006, t + bw, d - 0.016, M.button, 0.008);
          plate(u - bw * 0.62, fy0 + 0.024, u + bw * 0.62, fy0 + 0.04, d - 0.016, M.button, 0.008);
          plate(u - bw * 0.62, fy1 - 0.026, u + bw * 0.62, fy1 - 0.012, d - 0.016, M.button, 0.008);
        }
        knob((fx0 + fx1) / 2, fy0 + 0.012, d - 0.02, 0.008);
        knob(fx0 + 0.012, fy1 - 0.012, d - 0.02, 0.006); knob(fx1 - 0.012, fy1 - 0.012, d - 0.02, 0.006);
      };
      ddi('left', 0.312, 0.432);
      ddi('right', 0.568, 0.688);
      // UFC
      {
        const d = panelD(0.6) - 0.02;
        const bz = plate(0.437, 0.515, 0.563, 0.685, d, M.bezel, 0.03);
        bz.material = bezelFace([['COMM 1', 0.1, 0.38], ['COMM 2', 0.1, 0.62], ['COMM 3', 0.1, 0.86], ['BRT', 0.38, 0.95], ['CONT', 0.6, 0.95], ['SYM', 0.85, 0.95]]);
        screen('ufc', 0.462, 0.528, 0.553, 0.655, d - 0.017, 384, 320);
        for (const fy of [0.565, 0.605, 0.645]) knob(0.448, fy, d - 0.02, 0.0085, M.button);
        for (const fx of [0.475, 0.505, 0.535]) knob(fx, 0.673, d - 0.02, 0.006);
      }
      // knob row under the UFC
      for (const [fx, fy] of [[0.462, 0.71], [0.5, 0.71], [0.538, 0.71], [0.475, 0.74], [0.525, 0.74]]) knob(fx, fy, panelD(fy) - 0.012, 0.01, M.knob, 0.022);
      // AMPCD (colour moving map)
      {
        const d = panelD(0.87) - 0.015;
        const bz = plate(0.43, 0.76, 0.57, 0.995, d, M.bezel, 0.025);
        bz.material = bezelFace([['BRT', 0.12, 0.03], ['CN', 0.88, 0.03]]);
        screen('map', 0.447, 0.79, 0.553, 0.965, d - 0.014, 384, 512);
        for (let i = 0; i < 5; i++) {
          const t = 0.8 + (i + 0.5) * 0.165 / 5;
          plate(0.433, t - 0.009, 0.442, t + 0.009, d - 0.016, M.button, 0.008); plate(0.558, t - 0.009, 0.567, t + 0.009, d - 0.016, M.button, 0.008);
        }
      }
      // Engine / fuel display
      {
        const d = panelD(0.83) - 0.012;
        const bz = plate(0.33, 0.765, 0.425, 0.905, d, M.bezel, 0.02);
        bz.material = bezelFace([['BINGO', 0.12, 0.06], ['MODE', 0.12, 0.45], ['SEL', 0.12, 0.75]]);
        screen('efd', 0.36, 0.775, 0.42, 0.895, d - 0.012, 256, 384);
        for (const fy of [0.79, 0.835, 0.88]) knob(0.343, fy, d - 0.014, 0.0075);
      }
      // Standby instruments
      {
        const d = panelD(0.85) - 0.01;
        plate(0.565, 0.765, 0.705, 0.95, d, M.bezel, 0.02);
        const dial = (key, fx, fy, r) => {
          const a = S(fx - r, fy, d), b = S(fx + r, fy, d), rad = Math.abs(b.x - a.x) / 2;
          const c = canvas(160, 160), t = texOf(c);
          const m = new THREE.Mesh(new THREE.CircleGeometry(rad, 32), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
          m.position.copy(S(fx, fy, d - 0.013)); add(facing(m));
          const ring = new THREE.Mesh(new THREE.TorusGeometry(rad * 1.05, rad * 0.12, 6, 32), M.black); ring.position.copy(m.position); add(facing(ring));
          this.screens[key] = { c, g: c.getContext('2d'), t, w: 160, h: 160 };
        };
        dial('adi', 0.592, 0.81, 0.03); dial('alt', 0.585, 0.905, 0.022); dial('asi', 0.632, 0.905, 0.022); dial('vvi', 0.68, 0.905, 0.022);
        plate(0.63, 0.778, 0.69, 0.84, d - 0.01, M.black, 0.01);
      }
      // Left-edge caution lights, PUSH TO JETT, right-edge switches
      light(0.298, 0.632, panelD(0.63) - 0.012, 0.014, 0xf2c32a); light(0.298, 0.652, panelD(0.65) - 0.012, 0.014, 0xf2c32a);
      light(0.29, 0.69, panelD(0.69) - 0.012, 0.022, 0x30c040);
      {
        const geo = new THREE.CylinderGeometry(0.018, 0.02, 0.012, 20); geo.rotateX(Math.PI / 2);
        const m = new THREE.Mesh(geo, [M.black, M.jett, M.black]); m.position.copy(S(0.29, 0.775, panelD(0.775) - 0.012)); add(facing(m));
      }
      for (const fy of [0.66, 0.72]) {
        knob(0.705, fy, panelD(fy) - 0.01, 0.006, M.silver, 0.03);
      }
      light(0.705, 0.692, panelD(0.69) - 0.01, 0.014, 0xf2c32a);

      // ---------- Canopy jettison handle (left) ----------
      beam(S(0.212, 0.655, 0.6), S(0.205, 0.88, 0.56), 0.022, 0.016, M.jett);
      plate(0.19, 0.875, 0.225, 0.92, 0.56, M.black, 0.03);
      beam(S(0.212, 0.65, 0.61), S(0.235, 0.645, 0.64), 0.014, 0.014, M.black);

      // ---------- Side consoles ----------
      const consoleFace = (lines, w = 512, h = 256) => {
        const c = canvas(w, h), g = c.getContext('2d');
        g.fillStyle = '#2b2f34'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#4b5057'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12);
        g.fillStyle = '#dfe3e8'; g.font = 'bold 15px Arial'; g.textBaseline = 'middle';
        for (const [t, x, y] of lines) g.fillText(t, x * w, y * h);
        const m = std(0xffffff, { map: texOf(c) }); this.detailMats.push(m); return m;
      };
      plate(0.0, 0.94, 0.215, 1.08, 0.56, consoleFace([['LAUNCH BAR', 0.06, 0.2], ['FLAP', 0.4, 0.2], ['SELECT JETT', 0.62, 0.15], ['AUTO', 0.4, 0.4], ['FULL', 0.4, 0.55], ['ANTISKID', 0.4, 0.78], ['R FUS', 0.86, 0.35], ['STORES', 0.82, 0.8]]), 0.02);
      knob(0.17, 0.985, 0.54, 0.012, std(0xc0221c, { roughness: 0.35 }), 0.02);
      for (const fx of [0.06, 0.1]) knob(fx, 1.0, 0.54, 0.004, M.silver, 0.03);
      plate(0.785, 0.94, 1.0, 1.08, 0.56, consoleFace([['WINGFOLD', 0.1, 0.25], ['HOLD', 0.12, 0.55], ['SPREAD', 0.1, 0.8], ['BRAVO', 0.42, 0.45], ['LANDING', 0.72, 0.15], ['WHEELS', 0.72, 0.32], ['FLAPS', 0.72, 0.46], ['HOOK', 0.72, 0.6], ['HARNESS', 0.72, 0.75]]), 0.02);
      knob(0.83, 1.0, 0.54, 0.004, M.silver, 0.03);

      // ---------- Stick grip (bottom centre) ----------
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.16, 12), M.black);
      grip.position.copy(S(0.5, 1.02, 0.5)); grip.rotation.x = 0.5; add(grip);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), M.black); cap.position.copy(S(0.5, 0.985, 0.5)); add(cap);
      const red = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), std(0xc0221c)); red.position.copy(S(0.488, 0.985, 0.47)); add(red);

      // Canopy glass: faint tint
      const canopyGlass = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.03, side: THREE.BackSide, depthWrite: false }));
      canopyGlass.position.set(0, -0.3, -0.2); canopyGlass.scale.set(0.55, 0.7, 1); add(canopyGlass);

      this.drawUFC(0);
      this.loadTextures();
    }

    // Panel face decals: seams, screws, small labels around the displays
    drawPanelDecals(c, img) {
      const g = c.getContext('2d'), W = c.width, H = c.height;
      const X = (fx) => (fx - 0.27) / 0.46 * W, Y = (fy) => (fy - 0.48) / 0.58 * H;
      const r = BF.rng(17);
      g.fillStyle = '#2d3136'; g.fillRect(0, 0, W, H);
      if (img) {
        // painted-metal photo (Poly Haven blue_metal_plate, desaturated), toned to panel grey
        g.globalAlpha = 0.85; g.drawImage(img, 0, 0, W, H); g.globalAlpha = 1;
        g.fillStyle = 'rgba(46,50,55,0.25)'; g.fillRect(0, 0, W, H);
      } else for (let i = 0; i < 9000; i++) { const v = 40 + r() * 16; g.fillStyle = `rgba(${v},${v + 3},${v + 7},0.35)`; g.fillRect(r() * W, r() * H, 2, 2); }
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3;
      for (const [x0, y0, x1, y1] of [[0.3, 0.755, 0.7, 0.755], [0.43, 0.68, 0.43, 1.05], [0.57, 0.68, 0.57, 1.05], [0.3, 0.92, 0.43, 0.92]]) { g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke(); }
      g.fillStyle = '#16181b';
      for (const [fx, fy] of [[0.29, 0.6], [0.71, 0.6], [0.3, 1.0], [0.7, 1.0], [0.44, 0.76], [0.56, 0.76], [0.33, 0.93], [0.68, 0.96]]) { g.beginPath(); g.arc(X(fx), Y(fy), 6, 0, 7); g.fill(); }
      g.fillStyle = '#d8dce1'; g.font = 'bold 15px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const L = (t, fx, fy) => g.fillText(t, X(fx), Y(fy));
      L('NORM', 0.452, 0.695); L('DAY', 0.5, 0.695); L('NIGHT', 0.5, 0.725); L('BAL', 0.548, 0.695);
      L('BARO', 0.475, 0.755); L('INS', 0.525, 0.755); L('AUTO', 0.525, 0.768);
      L('HUD', 0.345, 0.915); L('HMD', 0.37, 0.915); L('REC', 0.395, 0.915); L('MAN', 0.415, 0.915);
      L('AUTO', 0.298, 0.615); L('ENT', 0.305, 0.69); L('A/C', 0.705, 0.645); L('OFF', 0.705, 0.675); L('TR', 0.705, 0.708); L('FIRE', 0.705, 0.738); L('EXTGH', 0.705, 0.75);
      g.font = 'bold 17px Arial'; L('PUSH TO', 0.29, 0.81); L('JETT', 0.29, 0.825);
      L('GO', 0.519, 0.468 + 0.016); L('NO GO', 0.515, 0.497 + 0.016); L('BIT', 0.552, 0.505);
    }

    // Poly Haven metal textures (assets/cockpit/*.js, base64 so file:// works). Until they
    // load (or if missing) the procedural materials stay as they are.
    loadTextures() {
      const load = (name) => new Promise((resolve) => {
        const key = 'cockpit_' + name;
        const done = () => {
          const a = BF.ASSETS && BF.ASSETS[key]; if (!a) { resolve(null); return; }
          const L = new THREE.TextureLoader(), out = {}; let n = 3;
          const fin = () => { if (--n === 0) { delete BF.ASSETS[key]; resolve(out); } };
          for (const k of ['diff', 'nor', 'rough']) {
            out[k] = L.load(a[k], fin, undefined, fin);
            out[k].wrapS = out[k].wrapT = THREE.RepeatWrapping; out[k].anisotropy = BF._maxAniso || 4;
          }
        };
        if (BF.ASSETS && BF.ASSETS[key]) { done(); return; }
        const el = document.createElement('script');
        el.src = 'assets/cockpit/' + name + '.js?v=' + (BF.BUILD || '');
        el.onload = done; el.onerror = () => resolve(null);
        (document.head || document.body).appendChild(el);
      });
      const M = this.M, set = (m, t, o = {}) => {
        if (o.map) m.map = t.diff;
        m.normalMap = t.nor; m.normalScale = new THREE.Vector2(o.ns || 0.7, o.ns || 0.7); m.roughnessMap = t.rough;
        if (o.color !== undefined) m.color.set(o.color);
        if (o.rough !== undefined) m.roughness = o.rough;
        m.needsUpdate = true;
      };
      load('panel').then((t) => {
        if (!t) return;
        set(M.hood, t, { map: true, color: 0x8a9096, rough: 1 });
        set(M.wall, t, { map: true, color: 0xb4bac2, rough: 1 });
        set(M.bezel, t, { ns: 0.5, rough: 0.9 });
        set(M.sill, t, { ns: 0.6, rough: 0.8 });
        for (const m of this.detailMats) set(m, t, { ns: 0.5, rough: 1 });
        set(this.decoMat, t, { ns: 0.6, rough: 1 });
        // panel colour: redraw the decal canvas over the photo once it has decoded
        this.drawPanelDecals(this.deco, t.diff.image); this.decoMat.map.needsUpdate = true;
      });
      load('frame').then((t) => {
        if (!t) return;
        set(M.frame, t, { map: true, color: 0xc4bdb4, rough: 1 });
        t.diff.repeat.set(3, 3); t.nor.repeat.set(3, 3); t.rough.repeat.set(3, 3);
      });
    }

    // UFC keypad (green keys); the scratchpad shows the airspeed
    drawUFC(speed) {
      const s = this.screens.ufc; if (!s) return;
      const g = s.g, W = s.w, H = s.h, G = '#39ff5a';
      g.fillStyle = '#020804'; g.fillRect(0, 0, W, H);
      g.strokeStyle = G; g.fillStyle = G; g.lineWidth = 3; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeRect(6, 6, 236, 44); g.font = 'bold 28px Consolas, monospace'; g.fillText(String(Math.round(speed)).padStart(3, ' ') + ' KPH', 124, 29);
      g.font = 'bold 26px Arial';
      const key = (t, x, y, w = 56, h = 44, sz = 26) => { g.strokeRect(x, y, w, h); g.font = `bold ${sz}px Arial`; g.fillText(t, x + w / 2, y + h / 2 + 1); };
      key('ILS', 254, 6, 60, 44, 22); key('VOX', 320, 6, 58, 44, 16);
      const rows = [['1', '2', '3', 'A/P', 'RALT'], ['4', '5', '6', 'TCN', 'EW'], ['7', '8', '9', 'IFF', 'FLIR'], ['CLR', '0', 'ENT', 'MDI', '']];
      rows.forEach((row, ri) => row.forEach((t, ci) => {
        const x = 6 + ci * 62 + (ci >= 3 ? 10 : 0), y = 60 + ri * 64;
        if (t || ci < 4) key(t, x, y, ci >= 3 ? 58 : 56, 56, t.length > 2 ? 18 : 26);
      }));
      s.t.needsUpdate = true;
    }

    // Colour relief map of the whole world (once per terrain): greens to yellow with height,
    // lakes, forests, roads and towns, like the reference AMPCD moving map.
    buildMap(terrain) {
      const N = 512, span = terrain.half * 2 * 1.15, c = canvas(N, N), g = c.getContext('2d'), im = g.createImageData(N, N);
      const lowC = [44, 132, 44], midC = [128, 186, 48], hiC = [222, 214, 60];
      for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * span, z = (k / N - 0.5) * span, h = terrain.height(x, z), o = (k * N + i) * 4;
        let col;
        if (h < terrain.water) col = [38, 92, 205];
        else { const t = BF.clamp(h / 380, 0, 1); col = t < 0.5 ? lowC.map((v, j) => v + (midC[j] - v) * t * 2) : midC.map((v, j) => v + (hiC[j] - v) * (t - 0.5) * 2); }
        const f = terrain.forestAt ? terrain.forestAt(x, z) : 0; if (f > 0) col = col.map((v, j) => v * (1 - f * 0.35) + [20, 90, 30][j] * f * 0.35);
        // hill shading
        const e = span / N, sh = BF.clamp(1 + (terrain.height(x - e, z - e) - h) * 0.012, 0.7, 1.25);
        im.data[o] = col[0] * sh; im.data[o + 1] = col[1] * sh; im.data[o + 2] = col[2] * sh; im.data[o + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      const P = (x, z) => [(x / span + 0.5) * N, (z / span + 0.5) * N];
      g.lineCap = 'round';
      for (const [w, col] of [[4, '#c0408a'], [2, '#ffffff']]) {
        g.strokeStyle = col; g.lineWidth = w;
        for (const r of terrain.roads || []) { g.beginPath(); r.forEach(([x, z], i) => { const [px, py] = P(x, z); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); }
      }
      for (const C of terrain.clusters || []) {
        g.fillStyle = 'rgba(200,200,205,0.75)'; g.beginPath();
        for (let i = 0; i <= 36; i++) { const a = i / 36 * Math.PI * 2, rr = terrain.polar(C.R, a), [px, py] = P(C.x + Math.cos(a) * rr, C.z + Math.sin(a) * rr); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
        g.fill();
        const [px, py] = P(C.x, C.z); g.fillStyle = '#d23aa0'; g.beginPath(); g.moveTo(px, py - 5); g.lineTo(px + 5, py); g.lineTo(px, py + 5); g.lineTo(px - 5, py); g.fill();
      }
      return { c, span, N };
    }

    // Keep projection (incl. the lens shift) in sync with the world camera, aim the sun.
    sync(camera, sunDir) {
      this.cam.fov = camera.fov; this.cam.aspect = camera.aspect;
      if (camera.view && camera.view.enabled) { const v = camera.view; this.cam.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height); }
      else this.cam.clearViewOffset();
      this.cam.updateProjectionMatrix();
      const inv = camera.quaternion.clone().invert();
      this.sun.position.copy(sunDir).applyQuaternion(inv).multiplyScalar(5);
      this.hemi.position.set(0, 1, 0).applyQuaternion(inv);
    }

    render(renderer) {
      renderer.autoClear = false; renderer.clearDepth();
      renderer.render(this.scene, this.cam);
      renderer.autoClear = true;
    }

    // Screen-space bounding rectangle of the HUD combiner glass (symbology is clipped to it).
    combinerRect(W, H) {
      const pts = this.glassRef.map(([x, y]) => {
        const v = S(x, y, this.HD).project(this.cam);
        return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
      });
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }

    // Displays, refreshed at ~12 Hz
    updateMFDs(dt, me, sim, cfg) {
      this.mfdT -= dt; if (this.mfdT > 0) return; this.mfdT = 0.08;
      const fwd = BF.forwardOf(me.quat, new V3()), right = BF.rightOf(me.quat, new V3()), up = BF.upOf(me.quat, new V3());
      const hdg = Math.atan2(fwd.x, -fwd.z), pitch = Math.asin(BF.clamp(fwd.y, -1, 1)), roll = Math.atan2(-right.y, up.y);
      const G = '#56ff6c', GD = 'rgba(86,255,108,0.35)', mono = (sz) => `bold ${sz}px Consolas, "Courier New", monospace`;
      const contacts = sim.jets.filter((j) => j !== me && j.alive && !(sim.t < j.ecmUntil));

      // Left DDI: radar PPI, heading up, 5 km
      { const s = this.screens.left, g = s.g, W = s.w, cx = W / 2, cy = W / 2 + 14, R = 150, rng = 5000;
        g.fillStyle = '#010702'; g.fillRect(0, 0, W, W);
        g.strokeStyle = G; g.fillStyle = G; g.lineWidth = 2; g.font = mono(16); g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText('RWS', 10, 16); g.fillText('5', 10, 38); g.textAlign = 'right'; g.fillText('RDR ATTK', W - 10, 16); g.textAlign = 'left';
        for (const rr of [R, R * 0.66, R * 0.33]) { g.strokeStyle = rr === R ? G : GD; g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.stroke(); }
        g.strokeStyle = G;
        for (let a = 0; a < 360; a += 10) { const t = (a * Math.PI / 180) - hdg, l = a % 30 ? 6 : 12; g.beginPath(); g.moveTo(cx + Math.sin(t) * R, cy - Math.cos(t) * R); g.lineTo(cx + Math.sin(t) * (R - l), cy - Math.cos(t) * (R - l)); g.stroke(); }
        g.font = mono(13); g.textAlign = 'center';
        for (const [t, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) { const r2 = (a * Math.PI / 180) - hdg; g.fillText(t, cx + Math.sin(r2) * (R + 12), cy - Math.cos(r2) * (R + 12)); }
        g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 6, cy + 6); g.lineTo(cx - 6, cy + 6); g.closePath(); g.stroke();
        for (const j of contacts) {
          const dx = j.pos.x - me.pos.x, dz = j.pos.z - me.pos.z, r = Math.hypot(dx, dz); if (r > rng) continue;
          const b = Math.atan2(dx, -dz) - hdg, x = cx + Math.sin(b) * r / rng * R, y = cy - Math.cos(b) * r / rng * R;
          g.fillStyle = j.team === me.team ? GD : G; g.fillRect(x - 5, y - 5, 10, 10);
          if (me.lock.targetId === j.id) { g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke(); }
        }
        g.fillStyle = G; g.textAlign = 'left'; g.font = mono(13); g.fillText(`HDG ${String(Math.round(((hdg / BF.DEG) + 360) % 360)).padStart(3, '0')}`, 10, W - 14);
        g.textAlign = 'right'; g.fillText(me.weapon === 'missile' ? `9X ${me.missiles}` : 'GUN', W - 10, W - 14);
        s.t.needsUpdate = true; }

      // Right DDI: attack B-scope (azimuth fan, 0..5 km)
      { const s = this.screens.right, g = s.g, W = s.w, x0 = 40, x1 = W - 40, y0 = 50, y1 = W - 40;
        g.fillStyle = '#020a05'; g.fillRect(0, 0, W, W);
        g.strokeStyle = GD; g.lineWidth = 1.5;
        for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo((x0 + x1) / 2 + i * 12, y1); g.lineTo((x0 + x1) / 2 + i * (x1 - x0) / 6, y0); g.stroke(); }
        for (let i = 1; i < 4; i++) { const y = y0 + i * (y1 - y0) / 4; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
        g.strokeStyle = G; g.lineWidth = 2;
        for (const j of contacts) {
          const d = new V3().subVectors(j.pos, me.pos), r = d.length(); if (r > 5000) continue;
          const az = Math.atan2(d.dot(right), d.dot(fwd)) / BF.DEG; if (Math.abs(az) > 60) continue;
          const x = (x0 + x1) / 2 + az / 60 * (x1 - x0) / 2, y = y1 - r / 5000 * (y1 - y0);
          g.fillStyle = j.team === me.team ? GD : G; g.fillRect(x - 5, y - 4, 10, 8);
          if (me.lock.targetId === j.id) { g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke(); }
        }
        g.fillStyle = G; g.font = mono(15); g.textAlign = 'left'; g.textBaseline = 'middle';
        const vs = Math.round((me.vel ? me.vel.y : 0) * 60);
        g.fillText(`${vs >= 0 ? '+' : ''}${vs}M/MIN`, 10, 16); g.fillText(`${Math.round(me.pos.y)}M`, 10, 36);
        g.textAlign = 'right'; const lk = me.lock.targetId != null ? sim.jets.find((j) => j.id === me.lock.targetId) : null;
        if (lk) { const dd = lk.pos.distanceTo(me.pos); g.fillText(`TGT ${lk.name || ''}`, W - 10, 16); g.fillText(`${(dd / 1000).toFixed(1)}KM`, W - 10, 36); }
        g.textAlign = 'left'; g.fillText(`${Math.round(me.speed)}KPH`, 10, W - 14);
        const cd = Math.max(0, me.counterReadyT - sim.t); g.textAlign = 'right';
        g.fillText(`${me.loadout === 'ecm' ? 'ECM' : 'FLR'} ${cd > 0 ? Math.ceil(cd) : 'RDY'}`, W - 10, W - 14);
        s.t.needsUpdate = true; }

      // UFC scratchpad
      this.drawUFC(me.speed);

      // Engine page: two engines' RPM / temp / nozzle bars + fuel-style AB tank
      { const s = this.screens.efd, g = s.g, W = s.w, H = s.h;
        g.fillStyle = '#030605'; g.fillRect(0, 0, W, H);
        const c = me.ctl, thr = me.boosting ? 1 : c.brake > 0.05 ? 0.55 : c.throttleUp > 0.05 ? 0.9 : 0.75;
        const bars = [['RPM', thr * 0.95 + 0.03], ['EGT', thr * 0.85], ['NOZ', me.boosting ? 0.9 : 0.25]];
        g.font = mono(15); g.textAlign = 'center'; g.textBaseline = 'middle';
        const drawBar = (i, t, v) => {
          for (const e of [0, 1]) {
            const x = 24 + i * 78 + e * 30, top = 40, bot = 280, h = (bot - top) * BF.clamp(v + (e ? 0.01 : 0), 0, 1);
            g.strokeStyle = '#3c5a44'; g.lineWidth = 2; g.strokeRect(x, top, 20, bot - top);
            g.fillStyle = v > 0.92 ? '#ff4433' : '#3cff5c'; g.fillRect(x + 3, bot - h, 14, h);
            g.fillStyle = '#ff4433'; g.fillRect(x - 3, top + (bot - top) * 0.08, 26, 3);
          }
          g.fillStyle = '#e6f0e8'; g.fillText(t, 24 + i * 78 + 25, 20); g.fillStyle = '#3cff5c'; g.fillText(String(Math.round(v * 100)), 24 + i * 78 + 25, 300);
        };
        bars.forEach(([t, v], i) => drawBar(i, t, v));
        g.fillStyle = '#e6f0e8'; g.textAlign = 'left'; g.fillText('AB', 12, 340);
        g.strokeStyle = '#3cff5c'; g.strokeRect(44, 330, 200, 20); g.fillStyle = '#ffd23c'; g.fillRect(46, 332, 196 * me.boostTank / cfg.flight.boostSeconds, 16);
        g.fillStyle = '#e6f0e8'; g.fillText(`HP ${Math.round(me.health)}`, 12, 372);
        s.t.needsUpdate = true; }

      // AMPCD moving map, heading up, 3 km radius
      { const s = this.screens.map, g = s.g, W = s.w, H = s.h;
        if (!this.mapFor || this.mapFor.terrain !== sim.terrain) this.mapFor = { terrain: sim.terrain, ...this.buildMap(sim.terrain) };
        const mp = this.mapFor, cx = W / 2, cy = H * 0.62, pxPerM = (W * 0.5) / 3000;
        g.fillStyle = '#0a1a0a'; g.fillRect(0, 0, W, H);
        g.save(); g.translate(cx, cy); g.rotate(-hdg); g.scale(pxPerM * mp.span / mp.N, pxPerM * mp.span / mp.N);
        g.drawImage(mp.c, -(me.pos.x / mp.span + 0.5) * mp.N, -(me.pos.z / mp.span + 0.5) * mp.N);
        g.restore();
        for (const j of sim.jets) {
          if (j === me || !j.alive) continue;
          const dx = j.pos.x - me.pos.x, dz = j.pos.z - me.pos.z, b = Math.atan2(dx, -dz) - hdg, r = Math.hypot(dx, dz) * pxPerM;
          const x = cx + Math.sin(b) * r, y = cy - Math.cos(b) * r; if (x < 0 || y < 0 || x > W || y > H) continue;
          g.fillStyle = j.team === me.team ? '#2a8cff' : '#ff2a6a'; g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.fill();
        }
        g.fillStyle = '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, cy - 12); g.lineTo(cx + 9, cy + 10); g.lineTo(cx, cy + 5); g.lineTo(cx - 9, cy + 10); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(W - 112, H - 70, 104, 62); g.fillStyle = '#ffd23c'; g.font = mono(15); g.textAlign = 'center';
        g.fillText('TERRAIN', W - 60, H - 56); g.fillStyle = '#ffffff'; g.fillText(`${Math.round(me.altitude)}M`, W - 60, H - 36); g.fillText('3KM', W - 60, H - 18);
        g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.fillText(String(Math.round(((hdg / BF.DEG) + 360) % 360)).padStart(3, '0'), cx - 16, 16);
        s.t.needsUpdate = true; }

      // Standby attitude indicator
      { const s = this.screens.adi, g = s.g, W = s.w, c = W / 2;
        g.save(); g.beginPath(); g.arc(c, c, c, 0, 7); g.clip();
        g.translate(c, c); g.rotate(-roll); const py = pitch / BF.DEG * 2.2;
        g.fillStyle = '#3d8fd6'; g.fillRect(-W, -W * 2 + py, W * 2, W * 2); g.fillStyle = '#7a4a24'; g.fillRect(-W, py, W * 2, W * 2);
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-W, py); g.lineTo(W, py); g.stroke();
        for (const p of [-20, -10, 10, 20]) { const y = py - p * 2.2; g.beginPath(); g.moveTo(-14, y); g.lineTo(14, y); g.stroke(); }
        g.restore();
        g.strokeStyle = '#ffb020'; g.lineWidth = 4; g.beginPath(); g.moveTo(c - 40, c); g.lineTo(c - 12, c); g.lineTo(c, c + 8); g.lineTo(c + 12, c); g.lineTo(c + 40, c); g.stroke();
        s.t.needsUpdate = true; }
      // Altimeter / airspeed / VSI dials
      const dial = (key, v, label, max) => {
        const s = this.screens[key], g = s.g, W = s.w, c = W / 2;
        g.fillStyle = '#111316'; g.beginPath(); g.arc(c, c, c, 0, 7); g.fill();
        g.strokeStyle = '#e8ecf0'; g.lineWidth = 2;
        for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2, l = i % 2 ? 6 : 12; g.beginPath(); g.moveTo(c + Math.sin(a) * (c - 4), c - Math.cos(a) * (c - 4)); g.lineTo(c + Math.sin(a) * (c - 4 - l), c - Math.cos(a) * (c - 4 - l)); g.stroke(); }
        g.fillStyle = '#e8ecf0'; g.font = 'bold 15px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, c, c + 30);
        const a = (v / max) * Math.PI * 2; g.lineWidth = 4; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(a) * (c - 18), c - Math.cos(a) * (c - 18)); g.stroke();
        g.fillStyle = '#333'; g.beginPath(); g.arc(c, c, 5, 0, 7); g.fill();
        s.t.needsUpdate = true;
      };
      dial('alt', me.pos.y % 1000, 'ALT', 1000); dial('asi', me.speed, 'KPH', 800); dial('vvi', BF.clamp((me.vel ? me.vel.y : 0) * 60 / 3000, -0.45, 0.45) + 0.5, 'VS', 1);

      // AOA indexer: top amber = slow, centre green = in the 313 band, bottom red = fast
      const s = me.speed;
      this.aoa[0].visible = s < 300; this.aoa[1].visible = s >= 300 && s <= 326; this.aoa[2].visible = s > 326;
    }
  };
})();
