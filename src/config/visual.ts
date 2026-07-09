// The war-room presentation knobs (Phase 5). Craig tunes feel by editing these
// numbers; nothing here changes the simulation. Motion values are deliberately
// calm by default (nystagmus): the state pulses stay because motion is a
// required non-colour cue, but screen shake and camera kicks ship near-zero and
// are Craig's to raise. prefersReducedMotion() attenuates them to nothing on
// top of these values, so a reduced-motion visitor never sees a kick regardless.

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
}

export const VISUAL_CONFIG: VisualConfig = {
  visibilityFloor: 0.35,
  glowIntensity: 1,
  pulseAmplitude: 0.5,
  pulseSpeed: 1.6,
  shakeIntensity: 0,
  encryptImpactScale: 0.12,
};

// True when the visitor has asked the OS for reduced motion. Read live so the
// setting is respected without a reload. Guarded for non-browser (test) contexts.
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
