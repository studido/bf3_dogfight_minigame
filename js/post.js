// Post-processing chain (BF3-look pass 1): HDR bloom, filmic tone map + teal/warm
// grade, vignette, procedural sun glare + dirty-lens streaks, FXAA. Uses the r128
// three.js example scripts vendored in js/vendor (MIT, three.js project).
window.BF = window.BF || {};

BF.buildPost = (renderer, scene, camera) => {
  const hdr = renderer.capabilities.isWebGL2; // HalfFloat RT keeps >1 values (sun, AB) for a proper HDR bloom threshold

  // ---- Filmic tone map + split tone + vignette + sun glare + dirty lens ----
  const GradeShader = {
    uniforms: {
      tDiffuse: { value: null },
      uExpo: { value: 1.35 },   // exposure into the ACES curve (linear input)
      uSat: { value: 0.94 },    // slight mid desaturation
      uVig: { value: 0.26 },
      uSunUv: { value: new THREE.Vector2(-10, -10) },
      uSunOn: { value: 0 },
      uAspect: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uExpo, uSat, uVig, uSunOn, uAspect;
      uniform vec2 uSunUv; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
      float hash(float n){ return fract(sin(n*127.1)*43758.545); }
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec2 asp = vec2(uAspect, 1.0);
        vec2 p = (vUv - 0.5) * 2.0 * asp;          // aspect-corrected screen NDC, y in [-1,1]
        vec2 sp = (uSunUv - 0.5) * 2.0 * asp;

        // --- Sun glare: anamorphic horizontal streak + glow + ghosts + halo ---
        vec3 warm = vec3(1.0, 0.82, 0.6), cool = vec3(0.7, 0.8, 1.0);
        float dy = p.y - sp.y;
        float streak = exp(-dy * dy * 900.0) * exp(-pow(p.x - sp.x, 2.0) * 3.0) * 0.55;
        float glow = exp(-dot(p - sp, p - sp) * 9.0) * 0.35;
        c += warm * (streak + glow) * uSunOn;
        for (int i = 0; i < 4; i++) {
          float t = float(i) / 3.0;
          vec2 gp = mix(sp, -sp * 0.75, t);
          float r = mix(0.05, 0.11, t), d = length(p - gp);
          vec3 tint = mix(warm, cool, t);
          c += tint * exp(-d * d / (r * r)) * (0.10 - t * 0.02) * uSunOn;
        }
        float haloR = 0.32;
        c += cool * exp(-pow(length(p) - haloR, 2.0) * 800.0) * 0.06 * uSunOn;

        // --- Dirty lens: faint irregular bars that catch the sun ---
        for (int j = 0; j < 6; j++) {
          float fj = float(j);
          float x0 = (hash(fj + 1.0) - 0.5) * 1.6;
          float tilt = (hash(fj + 7.0) - 0.5) * 0.15;
          float d = (p.x - x0) - p.y * tilt;
          float bar = exp(-d * d * 30000.0) * (0.012 + hash(fj + 3.0) * 0.02);
          c += vec3(0.9, 0.95, 1.0) * bar * (0.4 + 0.6 * uSunOn);
        }

        // --- Filmic tone map ---
        c = aces(c * uExpo);

        // --- BF3 split tone: teal shadows, warm highlights, slight mid desat ---
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += vec3(0.012, 0.030, 0.048) * (1.0 - smoothstep(0.0, 0.5, lum));   // teal lift
        c *= mix(vec3(1.0), vec3(1.07, 1.01, 0.90), smoothstep(0.55, 0.95, lum)); // warm gain
        c = mix(vec3(lum), c, uSat);

        // --- Vignette ---
        float vig = 1.0 - dot(p, p) * uVig;
        c *= clamp(vig, 0.0, 1.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  };

  const rt = new THREE.WebGLRenderTarget(4, 4, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });
  const composer = new THREE.EffectComposer(renderer, rt);
  composer.addPass(new THREE.RenderPass(scene, camera));

  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(4, 4),
    0.5,   // strength — restraint: BF3 blooms hard at the sun but not all over
    0.55,  // radius
    hdr ? 1.0 : 0.85);
  composer.addPass(bloom);

  const grade = new THREE.ShaderPass(GradeShader);
  composer.addPass(grade);

  const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
  composer.addPass(fxaa);

  const tmpV = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  return {
    render(dt) { composer.render(dt); },
    setSize(w, h) {
      const pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      grade.uniforms.uAspect.value = w / h;
      fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    },
    // Sun screen position + visibility for the glare/dirty-lens overlays.
    setSun(sunDir, cam) {
      cam.getWorldDirection(tmpDir);
      tmpV.copy(sunDir).multiplyScalar(8000).add(cam.position).project(cam);
      const g = grade.uniforms;
      if (tmpV.z > 1 || tmpDir.dot(sunDir) <= 0) { g.uSunOn.value = 0; return; }
      const m = Math.max(Math.abs(tmpV.x), Math.abs(tmpV.y));
      g.uSunOn.value = 1 - THREE.MathUtils.smoothstep(m, 0.9, 1.35); // flares hang on slightly off-screen
      g.uSunUv.value.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
    },
    uniforms: grade.uniforms, bloom,
  };
};
