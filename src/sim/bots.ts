// Scripted policies that play the game headlessly, so we can measure how the
// action economy holds up against the worm without a human. Two bots: a
// random-legal flailer (the floor) and a simple greedy heuristic (a naive but
// deliberate defender). Both play on the VISIBLE view, the same fog a player
// sees, so their results are a fair difficulty signal. Pure logic, seeded, no
// rendering.

import type { Topology, TopologyNode } from '../data/topology';
import { SIM_CONFIG, type SimConfig } from './config';
import { createRng, hashSeed, type Rng } from './rng';
import { applyPlayerAction, endTurn } from './game';
import type { PlayerAction } from './types';
import { blastRadius, createInitialState, toVisibleView } from './worm';

export interface BotOutcome {
  status: 'won' | 'lost' | 'playing';
  turns: number;
  blastRadius: number;
  score: number;
  backupsUsed: number;
  emergencyUsed: boolean;
}

// A bot returns the next action to take this turn, or null to end the turn.
export type Bot = (
  state: import('./types').GameState,
  topology: Topology,
  config: SimConfig,
  rng: Rng,
) => PlayerAction | null;

// Drives one seeded game to a terminal state under a bot policy. The bot's RNG
// is a separate stream seeded from the game seed, so bot play is reproducible.
export function runBot(
  topology: Topology,
  seed: string,
  bot: Bot,
  config: SimConfig = SIM_CONFIG,
  maxTurns = 60,
): BotOutcome {
  let state = createInitialState(topology, seed, config);
  const rng = createRng(hashSeed(`${seed}:bot`));

  for (let turn = 1; turn <= maxTurns && state.status === 'playing'; turn += 1) {
    // Act until the bot ends the turn or a guard trips (illegal picks waste an
    // attempt but never loop forever).
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const action = bot(state, topology, config, rng);
      if (!action) break;
      const result = applyPlayerAction(state, action, topology, config);
      if (result.ok) state = result.state;
    }
    state = endTurn(state, topology, config).nextState;
  }

  return {
    status: state.status,
    turns: state.turn,
    blastRadius: blastRadius(state),
    score: state.score,
    backupsUsed: config.backupCredits - state.backupCredits,
    emergencyUsed: state.emergencyUsed,
  };
}

const ACTION_KINDS = ['scan', 'isolate', 'reconnect', 'patch', 'restore'] as const;

// Random-legal bot: spends AP on random affordable actions, ends the turn when
// out of AP. The performance floor.
export const randomBot: Bot = (state, topology, _config, rng) => {
  if (state.ap < 1) return null;
  if (!state.emergencyUsed && rng.chance(0.05)) return { kind: 'emergency' };
  const kind = rng.pick(ACTION_KINDS);
  const node = rng.pick(topology.nodes).id;
  return { kind, node };
};

// Greedy heuristic: restore crown jewels, isolate infected hubs, deploy sensors
// ahead of the spread frontier, patch chokepoints. Plays on the visible view
// like a person, so a sensor's one-node reveal actually costs it information.
export const greedyBot: Bot = (state, topology, config, _rng) => {
  const visible = toVisibleView(state, topology);
  const value = (n: TopologyNode): number => config.nodeValue[n.type];
  const degree = (n: TopologyNode): number => n.neighbours.length;
  const covered = (n: TopologyNode): boolean => n.edr || Boolean(state.nodes[n.id].revealed);

  const infected = topology.nodes.filter((n) => visible[n.id] === 'infected');

  // In trouble and short on AP: reach for the emergency budget.
  if (infected.length >= 2 && !state.emergencyUsed && state.ap < 2) {
    return { kind: 'emergency' };
  }

  if (infected.length > 0) {
    // Restore the most valuable infected node while credits and a backup last.
    const backupAlive = topology.nodes.some(
      (n) => n.type === 'backup' && state.nodes[n.id].state !== 'encrypted',
    );
    if (state.ap >= config.actionCosts.restore && state.backupCredits > 0 && backupAlive) {
      const target = highest(infected, value);
      if (target) return { kind: 'restore', node: target.id };
    }
    // Otherwise cut the highest-degree infected node off to stop it spreading.
    if (state.ap >= config.actionCosts.isolate) {
      const target = highest(
        infected.filter((n) => !state.nodes[n.id].isolated),
        degree,
      );
      if (target) return { kind: 'isolate', node: target.id };
    }
  }

  // Deploy a sensor. A sensor now covers one node, so place it ahead of the
  // spread frontier: a clean, unmonitored node next to a visible infection,
  // where the worm lands next and will be seen the turn it arrives. With no
  // visible frontier, cover the biggest unmonitored hub instead, to catch
  // spread routing invisibly through it and to surface a hidden foothold.
  const compromised = new Set(
    topology.nodes.filter((n) => visible[n.id] === 'infected' || visible[n.id] === 'encrypted').map((n) => n.id),
  );
  const uncovered = topology.nodes.filter((n) => !covered(n) && visible[n.id] === 'clean');
  if (state.ap >= config.actionCosts.scan && uncovered.length > 0) {
    const frontier = uncovered.filter((n) => n.neighbours.some((id) => compromised.has(id)));
    const target =
      frontier.length > 0 ? highest(frontier, value) : highest(uncovered, degree);
    if (target) return { kind: 'scan', node: target.id };
  }

  // Then reinforce a chokepoint: patch the highest-degree clean router.
  const chokepoints = topology.nodes.filter(
    (n) => n.type === 'router' && state.nodes[n.id].state === 'clean',
  );
  if (state.ap >= config.actionCosts.patch && chokepoints.length > 0) {
    const target = highest(chokepoints, degree);
    if (target) return { kind: 'patch', node: target.id };
  }

  return null; // nothing worth doing, end the turn
};

function highest(nodes: TopologyNode[], score: (n: TopologyNode) => number): TopologyNode | null {
  let best: TopologyNode | null = null;
  let bestScore = -Infinity;
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const s = score(node);
    if (s > bestScore) {
      bestScore = s;
      best = node;
    }
  }
  return best;
}
