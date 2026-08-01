// The post-processing stack (Phase 7). Everything that happens to the image
// after the board is drawn: bloom so emissive surfaces bleed light the way a
// real camera sees them, then a single combined film pass doing the colour
// grade, chromatic aberration, vignette, scanlines and grain.
//
// Phase 5 deliberately avoided postprocessing to protect the 60fps floor on
// integrated graphics. That constraint has not gone away, so this ships with
// three quality tiers and a working "off" path: at LOW the composer is bypassed
// entirely and the renderer draws straight to the canvas, exactly as before.
// The tier auto-selects from a measured frame cost at boot and the player can
// override it in settings.
//
// Accessibility: grain and scanlines are motion and pattern on top of the whole
// screen, which is the last thing a nystagmus player needs. Both are attenuated
// by the motion level and forced to zero at "reduced", independently of tier.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { POST_CONFIG } from '../config/visual';

export type QualityTier = 'low' | 'medium' | 'high';

export interface PostFx {
  /** Draw a frame. Falls back to a direct render at the LOW tier. */
  render(elapsed: number): void;
  setSize(width: number, height: number): void;
  setQuality(tier: QualityTier): void;
  quality(): QualityTier;
  /**
   * Blast radius 0..1. The grade drifts as the estate falls: the image loses a
   * little of its clean cyan and picks up the infection's magenta in the
   * shadows, so the room itself looks sicker the worse things get.
   */
  setInfectionLevel(fraction: number): void;
  /** Grain and scanline strength multiplier, 0 at reduced motion. */
  setFilmAmount(amount: number): void;
  dispose(): void;
}

// The combined film pass. One fullscreen shader doing all the cheap screen-space
// work at once: five effects, one texture read budget, no intermediate targets.
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberration: { value: POST_CONFIG.aberration },
    uVignette: { value: POST_CONFIG.vignette },
    uGrain: { value: POST_CONFIG.grain },
    uScanline: { value: POST_CONFIG.scanline },
    uInfection: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uScanline;
    uniform float uInfection;
    uniform vec2 uResolution;
    varying vec2 vUv;

    // Cheap hash noise for the grain. Deterministic per pixel per frame.
    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec2 centred = vUv - 0.5;
      float radius = length(centred);

      // Chromatic aberration: the channels separate towards the edge of the
      // frame the way a real lens does. Quadratic, so the centre stays clean.
      vec2 offset = centred * radius * radius * uAberration;
      vec3 colour;
      colour.r = texture2D(tDiffuse, vUv + offset).r;
      colour.g = texture2D(tDiffuse, vUv).g;
      colour.b = texture2D(tDiffuse, vUv - offset).b;

      // Grade: a soft S-curve for contrast, cool shadows, and a magenta lift in
      // the darks that grows with the blast radius. The room turns as the
      // estate does, which is the whole cyan-versus-magenta story applied to
      // the image itself rather than to individual nodes.
      colour = clamp(colour, 0.0, 1.0);
      colour = colour * colour * (3.0 - 2.0 * colour) * 0.35 + colour * 0.65;
      float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      float shadowMask = 1.0 - smoothstep(0.0, 0.45, luma);
      colour += vec3(0.012, 0.020, 0.036) * shadowMask;                     // cool shadows
      colour += vec3(0.075, 0.0, 0.045) * shadowMask * uInfection;          // the sickness
      // A touch of saturation so the cyan reads as a colour, not a grey-blue.
      colour = mix(vec3(luma), colour, 1.12);

      // Vignette: the war-room display falls off at the corners.
      colour *= 1.0 - uVignette * smoothstep(0.35, 0.95, radius);

      // Scanlines: a fixed, non-moving horizontal modulation. Static by design,
      // so it never becomes drifting motion for a nystagmus player.
      if (uScanline > 0.0) {
        float lines = sin(vUv.y * uResolution.y * 1.5708);
        colour *= 1.0 - uScanline * (0.5 + 0.5 * lines);
      }

      // Grain, weighted towards the shadows where real sensor noise lives.
      if (uGrain > 0.0) {
        float n = hash(vUv * uResolution + fract(uTime) * 137.0) - 0.5;
        colour += n * uGrain * (0.35 + 0.65 * shadowMask);
      }

      gl_FragColor = vec4(max(colour, 0.0), 1.0);
    }
  `,
};

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  initialTier: QualityTier = 'high',
): PostFx {
  let tier: QualityTier = initialTier;
  let filmAmount = 1;
  let width = Math.max(1, renderer.domElement.width);
  let height = Math.max(1, renderer.domElement.height);

  // A multisampled target at HIGH gives real geometry antialiasing through the
  // composer, which the renderer's own `antialias: true` cannot provide once
  // we are drawing into an offscreen buffer. Costs fill rate, hence the tier.
  const makeTarget = (samples: number): THREE.WebGLRenderTarget =>
    new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType, // HDR headroom, so bright emissive can bloom
      samples,
      colorSpace: THREE.LinearSRGBColorSpace,
    });

  let composer = new EffectComposer(renderer, makeTarget(4));
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    POST_CONFIG.bloomStrength,
    POST_CONFIG.bloomRadius,
    POST_CONFIG.bloomThreshold,
  );

  // Tone mapping and the sRGB conversion happen here, so the film pass below
  // works in display space where grain and grade behave predictably.
  const outputPass = new OutputPass();

  const filmPass = new ShaderPass(FilmShader);
  filmPass.uniforms.uResolution.value.set(width, height);

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.addPass(filmPass);

  function applyTier(): void {
    // MEDIUM keeps bloom and the grade but drops multisampling; LOW bypasses
    // the composer completely, which is the honest fallback for weak hardware.
    bloomPass.enabled = tier !== 'low';
    filmPass.enabled = tier !== 'low';
    if (tier === 'high') {
      bloomPass.strength = POST_CONFIG.bloomStrength;
      filmPass.uniforms.uAberration.value = POST_CONFIG.aberration;
    } else {
      // A cheaper bloom and no lens separation at MEDIUM.
      bloomPass.strength = POST_CONFIG.bloomStrength * 0.8;
      filmPass.uniforms.uAberration.value = 0;
    }
    applyFilmAmount();
  }

  function applyFilmAmount(): void {
    filmPass.uniforms.uGrain.value = POST_CONFIG.grain * filmAmount;
    filmPass.uniforms.uScanline.value = POST_CONFIG.scanline * filmAmount;
  }

  function rebuildComposer(samples: number): void {
    composer.dispose();
    composer = new EffectComposer(renderer, makeTarget(samples));
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);
    composer.addPass(filmPass);
    composer.setSize(width, height);
  }

  applyTier();

  return {
    render(elapsed) {
      if (tier === 'low') {
        renderer.render(scene, camera);
        return;
      }
      filmPass.uniforms.uTime.value = elapsed;
      composer.render();
    },
    setSize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
      filmPass.uniforms.uResolution.value.set(width, height);
    },
    setQuality(next) {
      if (next === tier) return;
      const wasMultisampled = tier === 'high';
      tier = next;
      const wantsMultisampled = tier === 'high';
      if (wasMultisampled !== wantsMultisampled) rebuildComposer(wantsMultisampled ? 4 : 0);
      applyTier();
    },
    quality: () => tier,
    setInfectionLevel(fraction) {
      filmPass.uniforms.uInfection.value = Math.max(0, Math.min(1, fraction));
    },
    setFilmAmount(amount) {
      filmAmount = Math.max(0, Math.min(1, amount));
      applyFilmAmount();
    },
    dispose() {
      composer.dispose();
      bloomPass.dispose();
    },
  };
}
