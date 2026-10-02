// Post-processing (BF3 look, pass 2: rebuilt for clarity).
//
// What went wrong in pass 1, and what this does instead:
//  - The scene's colours are authored for direct display, so pushing everything through
//    an ACES curve (+35 % exposure) flattened contrast and washed the image out. Now the
//    grade works in display space: a gentle S-curve and a little saturation, plus a soft
//    shoulder that only touches values above 0.8 (the sun disc, afterburners, flares).
//  - Bloom fired on the whole bright sky and clouds (threshold ~1 on an LDR-ish image),
//    which read as milky haze. Now it only picks up genuinely hot pixels (>1 in the HDR
//    buffer: sun disc, afterburners, flares, explosions), and does so moderately.
//  - The "dirty lens" bars were always on (40 % even with no sun), and drew the faint
//    vertical lines. Removed, along with the halo ring. Sun glare is a small soft glow
//    plus faint ghosts, only when the sun is actually in view.
//  - The vignette doubled up with the HUD's own vignette, so the corners went black.
//    Post no longer vignettes; the HUD's vignette is lighter.
//  - Rendering into a render target loses the canvas MSAA, so edges shimmered. On WebGL2
//    the scene renders into a 4x multisampled HDR target; FXAA is only the fallback.
window.BF = window.BF || {};

BF.buildPost = (renderer, scene, camera) => {
  const gl2 = renderer.capabilities.isWebGL2;

  const GradeShader = {
    uniforms: {
      tDiffuse: { value: null },
      uContrast: { value: 0.22 },  // 0 = none, 1 = full smoothstep S-curve
      uSat: { value: 1.0 },
      uSunUv: { value: new THREE.Vector2(-10, -10) },
      uSunOn: { value: 0 },
      uAspect: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uContrast, uSat, uSunOn, uAspect, uTime;
      uniform vec2 uSunUv; varying vec2 vUv;
      // Soft shoulder above k: identical below, rolls smoothly toward 1 above (no clipping).
      vec3 shoulder(vec3 x){ float k = 0.8; vec3 o = x - k; return mix(x, k + (1.0 - k) * (1.0 - exp(-o / (1.0 - k))), step(k, x)); }
      float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec2 asp = vec2(uAspect, 1.0);
        vec2 p = (vUv - 0.5) * 2.0 * asp, sp = (uSunUv - 0.5) * 2.0 * asp;

        // Sun: small soft glow + two faint ghosts along the axis through screen centre
        if (uSunOn > 0.001) {
          vec3 warm = vec3(1.0, 0.86, 0.66);
          float d2 = dot(p - sp, p - sp);
          c += warm * (exp(-d2 * 22.0) * 0.28 + exp(-d2 * 3.0) * 0.06) * uSunOn;
          for (int i = 1; i <= 2; i++) {
            vec2 gp = sp * (-0.35 * float(i));
            float r = 0.04 + 0.03 * float(i);
            float g = exp(-dot(p - gp, p - gp) / (r * r));
            c += mix(warm, vec3(0.6, 0.8, 1.0), 0.5 * float(i)) * g * 0.035 * uSunOn;
          }
        }

        c = shoulder(max(c, 0.0));
        // Gentle contrast S-curve and saturation
        c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(mix(vec3(lum), c, uSat), 0.0);
        // BF3 split tone, kept subtle: cool-teal shadows, slightly warm highlights
        c += vec3(-0.004, 0.006, 0.016) * (1.0 - smoothstep(0.0, 0.45, lum));
        c *= mix(vec3(1.0), vec3(1.02, 1.0, 0.97), smoothstep(0.6, 1.0, lum));
        // Tiny dither to stop banding in the sky gradient (invisible otherwise)
        c += (rand(vUv) - 0.5) / 255.0;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  };

  const rtOpts = {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, type: gl2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
  };
  let rt;
  if (gl2 && THREE.WebGLMultisampleRenderTarget) { rt = new THREE.WebGLMultisampleRenderTarget(4, 4, rtOpts); rt.samples = 4; }
  else rt = new THREE.WebGLRenderTarget(4, 4, rtOpts);
  const composer = new THREE.EffectComposer(renderer, rt);
  composer.addPass(new THREE.RenderPass(scene, camera));

  // Only genuinely hot pixels bloom (HDR > ~1): sun disc, afterburners, flares, blasts.
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(4, 4), gl2 ? 0.55 : 0.35, 0.35, gl2 ? 1.05 : 0.97);
  composer.addPass(bloom);

  const grade = new THREE.ShaderPass(GradeShader);
  composer.addPass(grade);

  let fxaa = null;
  if (!(rt.isWebGLMultisampleRenderTarget)) { fxaa = new THREE.ShaderPass(THREE.FXAAShader); composer.addPass(fxaa); }

  const tmpV = new THREE.Vector3(), tmpDir = new THREE.Vector3();
  let t = 0;
  return {
    render(dt) { t += dt || 0; grade.uniforms.uTime.value = t % 100; composer.render(dt); },
    setSize(w, h) {
      const pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      grade.uniforms.uAspect.value = w / h;
      if (fxaa) fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    },
    // Sun screen position + visibility, for the glare.
    setSun(sunDir, cam) {
      cam.getWorldDirection(tmpDir);
      tmpV.copy(sunDir).multiplyScalar(8000).add(cam.position).project(cam);
      const g = grade.uniforms;
      if (tmpV.z > 1 || tmpDir.dot(sunDir) <= 0) { g.uSunOn.value = 0; return; }
      const m = Math.max(Math.abs(tmpV.x), Math.abs(tmpV.y));
      g.uSunOn.value = 1 - THREE.MathUtils.smoothstep(m, 0.85, 1.1);
      g.uSunUv.value.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
    },
    uniforms: grade.uniforms, bloom,
  };
};
