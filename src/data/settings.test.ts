import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  effectivePulseScale,
  effectiveShake,
  effectiveVisibilityFloor,
  loadSettings,
  masterVolume,
  motionReduced,
  saveSettings,
  type Settings,
} from './settings';

// No DOM in the test env: localStorage and matchMedia are absent, so the store
// falls back to the shipped defaults and never throws. saveSettings still
// updates the in-memory current settings, which is what the effective getters
// read, so the motion/shake logic is verifiable here.
describe('settings', () => {
  it('falls back to the shipped calm defaults with no storage', () => {
    const s = loadSettings();
    expect(s.masterVolume).toBe(0.7);
    expect(s.textScale).toBe(1);
    expect(s.highContrast).toBe(false);
    expect(s.shakeIntensity).toBe(0);
    expect(s.motionLevel).toBe('calm');
    expect(masterVolume()).toBe(0.7);
  });

  it('calm motion: shake off, pulse eased, not reduced', () => {
    saveSettings({ ...base(), motionLevel: 'calm', shakeIntensity: 0.2 });
    expect(motionReduced()).toBe(false);
    expect(effectiveShake()).toBe(0.2); // slider applies in calm
    expect(effectivePulseScale()).toBe(0.7);
  });

  it('reduced motion: shake forced to zero, pulse a whisper', () => {
    saveSettings({ ...base(), motionLevel: 'reduced', shakeIntensity: 0.3 });
    expect(motionReduced()).toBe(true);
    expect(effectiveShake()).toBe(0); // reduced gates the slider off
    expect(effectivePulseScale()).toBe(0.35);
  });

  it('full motion: shake at the slider, pulse full', () => {
    saveSettings({ ...base(), motionLevel: 'full', shakeIntensity: 0.25 });
    expect(effectiveShake()).toBe(0.25);
    expect(effectivePulseScale()).toBe(1);
  });

  it('reflects the visibility floor and master volume it is given', () => {
    saveSettings({ ...base(), visibilityFloor: 0.8, masterVolume: 0.4 });
    expect(effectiveVisibilityFloor()).toBe(0.8);
    expect(masterVolume()).toBe(0.4);
  });
});

// A fresh visitor who asked the OS for reduced motion, and has saved nothing,
// must get 'reduced' as their default. Stub matchMedia and re-import the module
// fresh so the boot-time read runs against it.
describe('reduced-motion default for a fresh visitor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('defaults to reduced when the OS asks for reduced motion', async () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q.includes('reduce') }),
    });
    vi.resetModules();
    const fresh = await import('./settings');
    expect(fresh.loadSettings().motionLevel).toBe('reduced');
  });
});

function base(): Settings {
  return {
    masterVolume: 0.7,
    textScale: 1,
    highContrast: false,
    shakeIntensity: 0,
    visibilityFloor: 0.35,
    motionLevel: 'calm',
  };
}
