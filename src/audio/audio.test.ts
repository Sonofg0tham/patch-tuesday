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
      'handover',
    ]) {
      expect(SOUND_NAMES).toContain(name);
    }
    expect(new Set(SOUND_NAMES).size).toBe(SOUND_NAMES.length);
  });

  it('is a silent no-op before unlock (autoplay policy), never throwing', () => {
    const audio = createAudio();
    expect(() => {
      for (const name of SOUND_NAMES) audio.play(name);
      // Positioned effects take the same path; a pan before unlock must also
      // be a no-op rather than reaching for a context that does not exist.
      audio.play('spread', { pan: -0.8 });
      audio.play('handover');
      audio.setMasterVolume(0.5);
      audio.setMusicVolume(0.4);
      audio.setSfxVolume(0.9);
      audio.setBlastIntensity(0.7);
      audio.setPressure(0.3);
      audio.resolve('lost');
    }).not.toThrow();
  });
});
