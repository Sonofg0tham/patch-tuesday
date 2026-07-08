// The scenarios a run can be played on. MERIDIAN MUTUAL is the hand-authored
// board, kept as a named scenario. RANDOM ESTATE builds a fresh procedural
// board from the run's seed. Both return the same Topology shape, so the rest
// of the game treats them identically.

import { loadTopology, type Topology } from './topology';
import { generateTopology } from './topology-gen';

export interface Scenario {
  id: string;
  name: string;
  kind: 'authored' | 'random';
  /** A one-line briefing blurb for the incident-briefing screen. */
  blurb: string;
  build(seed: string): Topology;
}

export const MERIDIAN: Scenario = {
  id: 'meridian',
  name: 'MERIDIAN MUTUAL // HQ ESTATE',
  kind: 'authored',
  blurb: 'The hand-authored estate. The same board every time: learn it.',
  build: () => loadTopology(),
};

export const RANDOM: Scenario = {
  id: 'random',
  name: 'RANDOM ESTATE',
  kind: 'random',
  blurb: 'A fresh procedural estate per seed. You have never seen this one.',
  build: (seed) => generateTopology(seed),
};

export const SCENARIOS: Scenario[] = [MERIDIAN, RANDOM];

export function scenarioById(id: string | null): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? MERIDIAN;
}
