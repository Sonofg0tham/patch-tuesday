import { describe, expect, it } from 'vitest';
import { bestFor, recentRuns, recordRun, type RunHistoryEntry } from './storage';
import { RATING_RANK } from '../sim/pir';

const entry: RunHistoryEntry = {
  scenarioId: 'random',
  scenarioName: 'RANDOM ESTATE // X',
  seed: 'X',
  rating: 'CONTAINED',
  blastPct: 12,
  turns: 5,
  won: true,
};

// The test environment has no DOM, so localStorage is absent. The store must
// degrade gracefully rather than throw, because a broken save can never be
// allowed to stop a new incident from starting.
describe('run storage (no DOM)', () => {
  it('records a run without throwing and returns the built store', () => {
    const store = recordRun(entry);
    expect(store.bestByScenario.random).toBe('CONTAINED');
    expect(store.history[0]).toEqual(entry);
  });

  it('reads back gracefully with no persistence available', () => {
    expect(() => bestFor('random')).not.toThrow();
    expect(() => recentRuns()).not.toThrow();
    expect(bestFor('random')).toBeNull();
    expect(recentRuns()).toEqual([]);
  });

  it('ranks ratings best-to-worst so the best is kept', () => {
    expect(RATING_RANK['NEAR MISS']).toBeGreaterThan(RATING_RANK.CONTAINED);
    expect(RATING_RANK.CONTAINED).toBeGreaterThan(RATING_RANK['REPORTABLE INCIDENT']);
    expect(RATING_RANK['REPORTABLE INCIDENT']).toBeGreaterThan(RATING_RANK['TOTAL LOSS']);
  });
});
