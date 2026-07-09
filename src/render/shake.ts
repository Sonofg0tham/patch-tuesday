// Trauma-based screen shake for the war room's impacts. Events add trauma;
// trauma decays every frame and drives a random camera offset whose magnitude
// is trauma-squared (so small knocks stay gentle and only big ones jolt). The
// magnitude is scaled by VISUAL_CONFIG.shakeIntensity, which ships at zero
// (calm default, nystagmus), and prefers-reduced-motion forces it to a no-op
// regardless. The offset is transient: main applies it for the render then
// removes it, so the controls never accumulate drift.

import * as THREE from 'three';
import { effectiveShake } from '../data/settings';

export interface ScreenShake {
  /** Add trauma (0..1). Overrides and defeat add a lot; encryption a little. */
  add(trauma: number): void;
  /** Advance decay and return the camera offset to apply this frame. */
  step(dt: number): THREE.Vector3;
}

export function createScreenShake(): ScreenShake {
  const offset = new THREE.Vector3();
  let trauma = 0;

  return {
    add(amount) {
      // Read live so the settings slider (and reduced motion) take effect
      // without a reload; zero magnitude means no trauma ever builds.
      if (effectiveShake() <= 0) return;
      trauma = Math.min(1, trauma + amount);
    },
    step(dt) {
      offset.set(0, 0, 0);
      const magnitude = effectiveShake();
      if (magnitude <= 0 || trauma <= 0) return offset;
      trauma = Math.max(0, trauma - dt * 1.8); // ~0.55s to fully settle
      const shake = magnitude * trauma * trauma;
      offset.set(
        (Math.random() * 2 - 1) * shake,
        (Math.random() * 2 - 1) * shake * 0.6,
        (Math.random() * 2 - 1) * shake,
      );
      return offset;
    },
  };
}
