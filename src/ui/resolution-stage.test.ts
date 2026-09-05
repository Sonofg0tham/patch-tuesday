import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResolutionStage } from './resolution-stage';

interface FakeStage {
  dataset: Record<string, string>;
  hidden: boolean;
  textContent: string;
  style: {
    values: Record<string, string>;
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

function fakeStage(): FakeStage {
  const values: Record<string, string> = {};
  return {
    dataset: {},
    hidden: false,
    textContent: 'stale route detail',
    style: {
      values,
      setProperty(name, value) {
        values[name] = value;
      },
      removeProperty(name) {
        delete values[name];
      },
    },
  };
}

describe('resolution analysis stage', () => {
  afterEach(() => vi.useRealTimers());

  it('shows one non-positional sweep only for the analysis lead', () => {
    vi.useFakeTimers();
    const element = fakeStage();
    const stage = createResolutionStage(element as unknown as HTMLElement);

    stage.showAnalysis({ reducedMotion: false, durationMs: 250 });

    expect(element.hidden).toBe(false);
    expect(element.dataset).toEqual({ state: 'analysis', motion: 'sweep' });
    expect(element.textContent).toBe('');
    expect(element.style.values['--resolution-analysis-duration']).toBe('250ms');

    vi.advanceTimersByTime(249);
    expect(stage.isActive()).toBe(true);
    vi.advanceTimersByTime(1);

    expect(stage.isActive()).toBe(false);
    expect(element.hidden).toBe(true);
    expect(element.dataset).toEqual({});
  });

  it('uses a static reduced-motion cue and clear cannot be undone by its old timer', () => {
    vi.useFakeTimers();
    const element = fakeStage();
    const stage = createResolutionStage(element as unknown as HTMLElement);

    stage.showAnalysis({ reducedMotion: true, durationMs: 250 });
    expect(element.dataset.motion).toBe('static');
    expect(stage.isActive()).toBe(true);

    stage.clear();
    vi.advanceTimersByTime(500);

    expect(stage.isActive()).toBe(false);
    expect(element.hidden).toBe(true);
    expect(element.dataset).toEqual({});
    expect(element.style.values).toEqual({});
  });
});
