import type { Topology } from '../data/topology';
import type { Rng } from './rng';
import type { GameState } from './types';

export interface SpreadRoute {
  source: string;
  target: string;
}

export interface SpreadSchedule {
  eligibleSources: number;
  eligibleEdges: number;
  attempts: SpreadRoute[];
}

// Builds this hour's hidden threat schedule from true simulation state. The
// forecast intentionally does not use this, because it must show every visible
// possible route rather than leak the seeded selection to the player.
export function scheduleSpreadAttempts(
  state: GameState,
  topology: Topology,
  rng: Rng,
  attemptCap: number,
): SpreadSchedule {
  const candidates: SpreadRoute[] = [];
  let eligibleEdges = 0;

  const sourceIds = Object.keys(state.nodes)
    .filter((id) => state.nodes[id].state === 'infected' && !state.nodes[id].isolated)
    .sort((a, b) => a.localeCompare(b));

  for (const source of sourceIds) {
    const node = topology.byId.get(source);
    if (!node) continue;

    const targets = node.neighbours
      .filter((target) => state.nodes[target]?.state === 'clean' && !state.nodes[target]?.isolated)
      .sort((a, b) => a.localeCompare(b));
    eligibleEdges += targets.length;

    if (targets.length > 0) {
      candidates.push({ source, target: rng.pick(targets) });
    }
  }

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng.next() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }

  return {
    eligibleSources: candidates.length,
    eligibleEdges,
    attempts: candidates.slice(0, Math.max(0, attemptCap)),
  };
}
