import { describe, expect, it } from 'vitest';
import { createScreenShake } from './shake';
import { prefersReducedMotion } from '../config/visual';

// The calm default (shakeIntensity 0) must produce no camera motion at all, so
// the war-room juice never jolts a nystagmus player who has not opted in.
describe('screen shake', () => {
  it('is a no-op at the calm default, adding no camera offset', () => {
    const shake = createScreenShake();
    shake.add(1);
    const offset = shake.step(0.016);
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
    expect(offset.z).toBe(0);
  });

  it('prefersReducedMotion is safe (and false) with no matchMedia', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
