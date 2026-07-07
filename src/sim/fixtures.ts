// Test-only helpers for building small controlled topologies. Not imported by
// the game, so it never reaches the bundle. Kept out of *.test.ts so several
// suites can share it.

import type { Cable, NodeType, Topology, TopologyNode } from '../data/topology';

export interface NodeSpec {
  id: string;
  type?: NodeType;
  edr?: boolean;
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
