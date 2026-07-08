// Test-only helpers for building small controlled topologies. Not imported by
// the game, so it never reaches the bundle. Kept out of *.test.ts so several
// suites can share it.

import type { Cable, NodeType, Topology, TopologyNode } from '../data/topology';
import { SIM_CONFIG } from './config';
import { hashSeed } from './rng';
import type { GameState, NodeState } from './types';

export interface NodeSpec {
  id: string;
  type?: NodeType;
  edr?: boolean;
}

// Builds a full GameState around a node map, filling the economy fields with
// sensible defaults so individual tests need only supply the nodes they care
// about. Overrides let a test pin ap, backupCredits, status, and so on.
export function makeGameState(
  nodes: Record<string, NodeState>,
  overrides: Partial<GameState> = {},
): GameState {
  return {
    seed: overrides.seed ?? 'test',
    rngState: overrides.rngState ?? hashSeed(overrides.seed ?? 'test'),
    turn: 1,
    nodes,
    ap: SIM_CONFIG.apPerTurn,
    backupCredits: SIM_CONFIG.backupCredits,
    emergencyUsed: false,
    score: 0,
    pressure: 0,
    findings: [],
    status: 'playing',
    ...overrides,
  };
}

// Builds a Topology from a flat node list and cable pairs. Positions are laid
// out on a line; they do not matter to the sim, only the adjacency does.
export function makeTopology(specs: NodeSpec[], cablePairs: [string, string][]): Topology {
  const nodes: TopologyNode[] = specs.map((spec, index) => ({
    id: spec.id,
    label: spec.id,
    type: spec.type ?? 'workstation',
    role: 'test node',
    col: index,
    row: 0,
    edr: spec.edr ?? false,
    x: index,
    z: 0,
    neighbours: [],
  }));

  const byId = new Map<string, TopologyNode>();
  for (const node of nodes) byId.set(node.id, node);

  const cables: Cable[] = cablePairs.map(([a, b]) => {
    const nodeA = byId.get(a);
    const nodeB = byId.get(b);
    if (!nodeA || !nodeB) throw new Error(`cable references unknown node ${a}/${b}`);
    if (!nodeA.neighbours.includes(b)) nodeA.neighbours.push(b);
    if (!nodeB.neighbours.includes(a)) nodeB.neighbours.push(a);
    return { a, b };
  });
  for (const node of nodes) node.neighbours.sort();

  return { name: 'fixture', spacing: 1, nodes, cables, byId, halfWidth: nodes.length, halfDepth: 1 };
}
