import { describe, it, expect } from 'vitest';
import { loadTopology } from '../data/topology';
import { SIM_CONFIG } from './config';
import { makeTopology } from './fixtures';
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

  it('is reproducible: the same seed set gives the same numbers', () => {
    const topology = loadTopology();
    const a = runSpreadStats(topology, { runs: 200, threshold: 0.6, maxTurns: 500 });
    const b = runSpreadStats(topology, { runs: 200, threshold: 0.6, maxTurns: 500 });
    expect(a.samples).toEqual(b.samples);
    expect(a.fizzled).toBe(b.fizzled);
    expect(a.lossRate).toBe(b.lossRate);
  });

  it('a single run returns a turn count or null (fizzle)', () => {
    const topology = loadTopology();
    const outcome = runToThreshold(topology, 'one-run', 0.6, 500);
    expect(outcome === null || outcome >= 1).toBe(true);
  });

  it('reports the literal undefended loss rate', () => {
    const topology = loadTopology();
    const result = runSpreadStats(topology, {
      runs: 200,
      threshold: 0.6,
      maxTurns: 500,
      seedPrefix: 'loss-rate',
    });

    expect(result.lossRate).toBe(result.reached / 200);
  });

  it('reports zero response hours when dwell already crossed the loss threshold', () => {
    const topology = makeTopology([{ id: 'WS' }], []);
    const turns = runToThreshold(topology, 'lost-at-handover', 0.6, 500, {
      ...SIM_CONFIG,
      dwellTurns: 1,
      encryptAfterTurns: 1,
      spreadChance: 0,
    });

    expect(turns).toBe(0);
  });
});
