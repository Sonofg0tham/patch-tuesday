import { describe, expect, it } from 'vitest';
import { createAudio, SOUND_NAMES } from './audio';

// WebAudio is browser-only, so these cover what is verifiable without a context:
// the sound roster is complete, and the whole API is safe to call before the
// context is unlocked (no window access, no throw), which is what the autoplay
// policy relies on.
describe('audio module', () => {
  it('exposes the full war-room sound roster', () => {
    for (const name of [
      'confirm',
      'denied',
      'spread',
      'encrypt',
      'encrypt-heavy',
      'defeat',
      'contain',
      'override',
    ]) {
      expect(SOUND_NAMES).toContain(name);
    }
    expect(new Set(SOUND_NAMES).size).toBe(SOUND_NAMES.length);
  });

  it('is a silent no-op before unlock (autoplay policy), never throwing', () => {
    const audio = createAudio();
    expect(() => {
      for (const name of SOUND_NAMES) audio.play(name);
      audio.setMasterVolume(0.5);
      audio.setBlastIntensity(0.7);
      audio.setPressure(0.3);
    }).not.toThrow();
  });
});
