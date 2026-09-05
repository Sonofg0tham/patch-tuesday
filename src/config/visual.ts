// The war-room presentation knobs (Phase 5, extended in Phase 7). Craig tunes
// feel by editing these numbers; nothing here changes the simulation. Motion
// values are deliberately calm by default (nystagmus): the state pulses stay
// because motion is a required non-colour cue, but screen shake and camera
// kicks ship near-zero and are Craig's to raise. prefersReducedMotion()
// attenuates them to nothing on top of these values, so a reduced-motion
// visitor never sees a kick regardless.

export interface VisualConfig {
  /**
   * Readability floor for the nystagmus rule (0..1). Raises the ambient light
   * and a minimum emissive on every node so no silhouette is ever lost in the
   * dramatic shadows. 0 is fully cinematic, 1 is flat and maximally legible.
   */
  visibilityFloor: number;
  /** Strength of the additive halo glow behind nodes and along cables. */
  glowIntensity: number;
  /** Depth of the infected-node pulse (0..1 of its emissive). A state cue. */
  pulseAmplitude: number;
  /** Pulse cycles per second for infected nodes. */
  pulseSpeed: number;
  /**
   * Screen-shake magnitude in world units. Overrides and defeat add the most
   * trauma, an encryption a little. Ships at 0 (calm default, nystagmus); raise
   * it to feel the impacts. prefers-reduced-motion forces it off regardless.
   */
  shakeIntensity: number;
  /** Node scale-punch on its own encryption (0..1 dip). Subtle by default. */
  encryptImpactScale: number;
  /**
   * Camera exposure into the ACES filmic tone mapper. The whole image brightens
   * or darkens from here; every light intensity below is balanced against it.
   */
  exposure: number;
  /** How much of the environment map the chassis reflect (0..1). */
  envIntensity: number;
  /** Airborne dust motes in the light. 0 disables the particle field. */
  dustCount: number;
  /** Speed of the energy pulses travelling along live cables, in units/second. */
  cableFlowSpeed: number;
}

export const VISUAL_CONFIG: VisualConfig = {
  visibilityFloor: 0.35,
  glowIntensity: 1,
  pulseAmplitude: 0.5,
  pulseSpeed: 1.6,
  shakeIntensity: 0,
  encryptImpactScale: 0.12,
  exposure: 1.15,
  envIntensity: 0.85,
  dustCount: 420,
  cableFlowSpeed: 0.55,
};

// The post-processing knobs (Phase 7). Separated from VISUAL_CONFIG because
// these are image-wide effects rather than board behaviour, and because the
// quality tier can switch several of them off together.
export interface PostConfig {
  /** Bloom intensity. The main dial for how much emissive surfaces bleed. */
  bloomStrength: number;
  /** Bloom spread. Higher is a softer, wider halo. */
  bloomRadius: number;
  /** Luminance above which a pixel blooms. Low values bloom the whole image. */
  bloomThreshold: number;
  /** Lens colour separation towards the frame edge. 0 disables it. */
  aberration: number;
  /** Corner darkening, 0..1. */
  vignette: number;
  /** Sensor grain. Attenuated by the motion level, forced to 0 at reduced. */
  grain: number;
  /** Static CRT scanline depth. Also gated by the motion level. */
  scanline: number;
}

export const POST_CONFIG: PostConfig = {
  bloomStrength: 0.5,
  bloomRadius: 0.6,
  // High enough that only genuinely hot surfaces bloom. Drop it and the whole
  // board hazes over, which costs the magenta its shock value.
  bloomThreshold: 0.85,
  aberration: 0.0022,
  vignette: 0.42,
  grain: 0.045,
  scanline: 0.012,
};

// True when the visitor has asked the OS for reduced motion. Read live so the
// setting is respected without a reload. Guarded for non-browser (test) contexts.
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
