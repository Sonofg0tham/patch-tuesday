// The WORM: the Phase 2 threat, as pure logic. Game state and topology in,
// resolved state plus an ordered event log out. No Three.js, no DOM, no shared
// mutable state. Everything random flows through the seeded RNG carried in
// GameState, so a run is fully determined by its seed.

import type { Topology, TopologyNode } from '../data/topology';
import { SIM_CONFIG, type SimConfig } from './config';
import { createRng, hashSeed } from './rng';
import type {
  GameState,
  NodeState,
  TurnEvent,
  TurnResult,
  VisibleState,
} from './types';

// Builds the opening position: turn 1, every node clean except patient zero,
// which is a random edge workstation. Deterministic for a given seed.
export function createInitialState(
  topology: Topology,
  seed: string,
  config: SimConfig = SIM_CONFIG,
): GameState {
  const nodes: Record<string, NodeState> = {};
  for (const node of topology.nodes) {
    nodes[node.id] = { state: 'clean', infectedTurns: 0 };
  }

  const rng = createRng(hashSeed(seed));
  const zero = pickPatientZero(topology, config, rng);
  nodes[zero.id] = { state: 'infected', infectedTurns: 0 };

  let state: GameState = {
    seed,
    rngState: rng.state(),
    turn: 1,
    nodes,
    ap: config.apPerTurn,
    backupCredits: config.backupCredits,
    emergencyUsed: false,
    score: 0,
    pressure: 0,
    findings: [],
    status: 'playing',
  };

  // Dwell time: the worm spreads for a few turns before the incident is
  // detected, so the player is handed an established foothold, not a lone
  // patient zero. These pre-player turns spread and age the infection but do
  // not spend AP or accrue score; the clock is reset to T+01h at handover.
  for (let i = 0; i < config.dwellTurns; i += 1) {
    state = stepTurn(state, topology, config).nextState;
  }

  return { ...state, turn: 1 };
}

// Patient zero: a random node of the configured type, preferring the
// lowest-degree (edge / leaf) candidates when patientZeroEdgeOnly is set.
function pickPatientZero(
  topology: Topology,
  config: SimConfig,
  rng: ReturnType<typeof createRng>,
): TopologyNode {
  const ofType = topology.nodes.filter((n) => n.type === config.patientZeroType);
  const candidates = ofType.length > 0 ? ofType : topology.nodes;

  let pool = candidates;
  if (config.patientZeroEdgeOnly) {
    const minDegree = Math.min(...candidates.map((n) => n.neighbours.length));
    pool = candidates.filter((n) => n.neighbours.length === minDegree);
  }
  // Sort by id so the pool order does not depend on JSON authoring order.
  return rng.pick([...pool].sort((a, b) => a.id.localeCompare(b.id)));
}

// Resolves one turn: infected nodes attempt to spread, then the encryption
// clock advances. Returns the next state and the ordered events that produced
// it. Pure: it reads state and topology and returns fresh state.
export function stepTurn(
  state: GameState,
  topology: Topology,
  config: SimConfig = SIM_CONFIG,
): TurnResult {
  const rng = createRng(state.rngState);
  const nodes: Record<string, NodeState> = {};
  for (const [id, ns] of Object.entries(state.nodes)) nodes[id] = { ...ns };
  const events: TurnEvent[] = [];

  // Only nodes infected at the start of the turn spread, in a fixed id order so
  // RNG consumption is deterministic. Nodes infected this turn wait until next.
  const spreaders = Object.keys(nodes)
    .filter((id) => nodes[id].state === 'infected')
    .sort((a, b) => a.localeCompare(b));

  for (const sourceId of spreaders) {
    const source = topology.byId.get(sourceId);
    if (!source) continue;
    // Per-cable spread: the node rolls against each clean neighbour it can
    // reach this turn along a live cable. A neighbour infected earlier this
    // turn is no longer clean and is skipped. Neighbours are pre-sorted, so
    // RNG use is fixed.
    for (const targetId of liveNeighbours(source, nodes)) {
      if (nodes[targetId].state !== 'clean') continue;
      const roll = rng.next();
      const success = roll < config.spreadChance;
      events.push({ kind: 'spread-attempt', source: sourceId, target: targetId, roll, success });
      if (success) {
        nodes[targetId] = { ...nodes[targetId], state: 'infected', infectedTurns: 0 };
        events.push({ kind: 'infected', node: targetId });
      }
    }
  }

  // Age every node that was infected at the start of the turn. New infections
  // this turn keep infectedTurns at 0 and start ageing next turn.
  for (const id of spreaders) {
    const ns = nodes[id];
    ns.infectedTurns += 1;
    if (ns.infectedTurns >= config.encryptAfterTurns) {
      ns.state = 'encrypted';
      events.push({ kind: 'encrypted', node: id });
    }
  }

  return {
    nextState: { ...state, rngState: rng.state(), turn: state.turn + 1, nodes },
    events,
  };
}

// Neighbours reachable along a live cable. A cable is live only if neither of
// its endpoints is isolated, so isolating a node cuts spread in both directions.
function liveNeighbours(node: TopologyNode, nodes: Record<string, NodeState>): string[] {
  if (nodes[node.id]?.isolated) return [];
  return node.neighbours.filter((id) => !nodes[id]?.isolated);
}

// The fog of war. Visible state is a pure function of true state, EDR coverage
// and whether the node has been scanned. Patched and encrypted nodes are always
// visible; an infected node is visible only if it has EDR or has been revealed.
export function visibleStateOf(node: TopologyNode, ns: NodeState): VisibleState {
  if (ns.state === 'encrypted') return 'encrypted';
  if (ns.state === 'patched') return 'patched';
  if (ns.state === 'infected') return node.edr || ns.revealed ? 'infected' : 'clean';
  return 'clean';
}

// The visible layer for the whole board: what the renderer draws in normal play.
export function toVisibleView(state: GameState, topology: Topology): Record<string, VisibleState> {
  const view: Record<string, VisibleState> = {};
  for (const node of topology.nodes) {
    view[node.id] = visibleStateOf(node, state.nodes[node.id]);
  }
  return view;
}

// The true layer: every node's real state, ignoring the fog. Debug mode only.
export function toTrueView(state: GameState): Record<string, VisibleState> {
  const view: Record<string, VisibleState> = {};
  for (const [id, ns] of Object.entries(state.nodes)) view[id] = ns.state;
  return view;
}

// Instrumentation helpers, used by the HUD and the stats harness.

export function encryptedCount(state: GameState): number {
  return Object.values(state.nodes).filter((n) => n.state === 'encrypted').length;
}

export function infectedCount(state: GameState): number {
  return Object.values(state.nodes).filter((n) => n.state === 'infected').length;
}

export function blastRadius(state: GameState): number {
  const total = Object.keys(state.nodes).length;
  return total === 0 ? 0 : encryptedCount(state) / total;
}
