import { describe, it, expect } from 'vitest';
import { loadTopology } from '../data/topology';
import { SIM_CONFIG } from './config';
import { runSpreadStats, runToThreshold } from './stats';

// Pin these baseline stats to no dwell, so they keep asserting the documented
// ~7.8-turn undefended figure regardless of the shipped dwellTurns default.
const NO_DWELL = { ...SIM_CONFIG, dwellTurns: 0 };

describe('spread statistics', () => {
  it('every run terminates: it either reaches the threshold or fizzles', () => {
    const topology = loadTopology();
    const result = runSpreadStats(topology, { runs: 400, threshold: 0.6, maxTurns: 500, config: NO_DWELL });
    // reached + fizzled must account for every run (no run hits the cap).
    expect(result.reached + result.fizzled).toBe(result.runs);
  });

  it('turns-to-60% sit in a plausible band on the undefended board', () => {
    const topology = loadTopology();
    const result = runSpreadStats(topology, { runs: 800, threshold: 0.6, maxTurns: 500, config: NO_DWELL });
    // With per-cable spread the worm reaches 60% in most runs, in a handful of
    // turns. Wide bands, just sanity fences around the measured behaviour.
    expect(result.reached).toBeGreaterThan(result.runs * 0.5);
    expect(result.mean).toBeGreaterThan(3);
    expect(result.mean).toBeLessThan(30);
    expect(result.min).toBeGreaterThanOrEqual(1);
    expect(result.p10).toBeLessThanOrEqual(result.median);
    expect(result.median).toBeLessThanOrEqual(result.p90);
  });

  it('is reproducible: the same seed set gives the same numbers', () => {
    const topology = loadTopology();
    const a = runSpreadStats(topology, { runs: 200, threshold: 0.6, maxTurns: 500 });
    const b = runSpreadStats(topology, { runs: 200, threshold: 0.6, maxTurns: 500 });
    expect(a.samples).toEqual(b.samples);
    expect(a.fizzled).toBe(b.fizzled);
  });

  it('a single run returns a turn count or null (fizzle)', () => {
    const topology = loadTopology();
    const outcome = runToThreshold(topology, 'one-run', 0.6, 500);
    expect(outcome === null || outcome >= 1).toBe(true);
  });
});
