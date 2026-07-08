// Headless statistics over the undefended board. Runs many seeded simulations
// to the loss threshold and reports the distribution of turns taken, plus how
// often the worm fizzles out on its own. This is pure sim, no rendering, and
// it produces the difficulty baseline Phase 3's action economy pushes against.

import type { Topology } from '../data/topology';
import { SIM_CONFIG, type SimConfig } from './config';
import { createInitialState, stepTurn, blastRadius, infectedCount } from './worm';

export interface StatsOptions {
  runs: number;
  /** Blast radius (fraction encrypted) that ends a run as "reached". */
  threshold: number;
  /** Safety cap on turns per run. */
  maxTurns: number;
  /** Seed prefix, so a stats run is itself reproducible. */
  seedPrefix?: string;
  /** Optional config override; defaults to SIM_CONFIG. */
  config?: SimConfig;
}

export interface StatsResult {
  runs: number;
  threshold: number;
  /** Turns-to-threshold for the runs that reached it. */
  samples: number[];
  reached: number;
  /** Runs where the worm died out below the threshold. */
  fizzled: number;
  fizzleRate: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
  /** Turn bucket -> count, for the runs that reached the threshold. */
  histogram: Record<number, number>;
}

// One run: returns the number of End Turns taken to first reach the threshold,
// or null if the worm fizzled (no infected nodes left below the threshold) or
// the cap was hit.
export function runToThreshold(
  topology: Topology,
  seed: string,
  threshold: number,
  maxTurns: number,
  config: SimConfig = SIM_CONFIG,
): number | null {
  let state = createInitialState(topology, seed, config);
  for (let step = 1; step <= maxTurns; step += 1) {
    state = stepTurn(state, topology, config).nextState;
    if (blastRadius(state) >= threshold) return step;
    if (infectedCount(state) === 0) return null; // fizzled
  }
  return null; // hit the cap
}

export function runSpreadStats(topology: Topology, options: StatsOptions): StatsResult {
  const { runs, threshold, maxTurns, seedPrefix = 'stats', config = SIM_CONFIG } = options;
  const samples: number[] = [];
  let fizzled = 0;

  for (let i = 0; i < runs; i += 1) {
    const result = runToThreshold(topology, `${seedPrefix}-${i}`, threshold, maxTurns, config);
    if (result === null) fizzled += 1;
    else samples.push(result);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const quantile = (q: number): number =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

  const histogram: Record<number, number> = {};
  for (const s of samples) histogram[s] = (histogram[s] ?? 0) + 1;

  return {
    runs,
    threshold,
    samples,
    reached: samples.length,
    fizzled,
    fizzleRate: runs === 0 ? 0 : fizzled / runs,
    mean: samples.length === 0 ? 0 : samples.reduce((a, b) => a + b, 0) / samples.length,
    median: quantile(0.5),
    p10: quantile(0.1),
    p90: quantile(0.9),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    histogram,
  };
}
