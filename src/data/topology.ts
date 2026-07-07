// Topology types and loader. The network is data, not code: the estate lives
// in topology.json and is hand-editable (see the schema note in the Phase 1
// PR). This module validates that data, converts grid cells to centred world
// positions, and builds the adjacency each node exposes to the inspector.

import rawTopology from './topology.json';

export const NODE_TYPES = [
  'workstation',
  'server',
  'domain-controller',
  'backup',
  'router',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

// One node as authored in the JSON.
interface RawNode {
  id: string;
  label: string;
  type: NodeType;
  role: string;
  col: number;
  row: number;
  edr: boolean;
}

// A node after loading: world position resolved, neighbours attached.
export interface TopologyNode extends RawNode {
  x: number; // world X, board centred on the origin
  z: number; // world Z
  neighbours: string[]; // ids of directly cabled nodes, sorted
}

export interface Cable {
  a: string;
  b: string;
}

export interface Topology {
  name: string;
  spacing: number;
  nodes: TopologyNode[];
  cables: Cable[];
  byId: Map<string, TopologyNode>;
  // Half extents of the board in world units, for camera fitting and pan bounds.
  halfWidth: number;
  halfDepth: number;
}

// Loads and validates the bundled topology. Throws loudly on any malformed
// data so a bad hand-edit fails at boot, not silently mid-game.
export function loadTopology(): Topology {
  const data = rawTopology as {
    name: string;
    grid: { spacing: number };
    nodes: RawNode[];
    cables: [string, string][];
  };

  const spacing = data.grid.spacing;
  if (!(spacing > 0)) throw new Error('topology.grid.spacing must be positive');
  if (data.nodes.length === 0) throw new Error('topology has no nodes');

  const cols = data.nodes.map((n) => n.col);
  const rows = data.nodes.map((n) => n.row);
  const midCol = (Math.min(...cols) + Math.max(...cols)) / 2;
  const midRow = (Math.min(...rows) + Math.max(...rows)) / 2;

  const byId = new Map<string, TopologyNode>();
  const seenCell = new Set<string>();
  const nodes: TopologyNode[] = data.nodes.map((raw) => {
    if (!NODE_TYPES.includes(raw.type)) {
      throw new Error(`node ${raw.id} has unknown type "${raw.type}"`);
    }
    if (byId.has(raw.id)) throw new Error(`duplicate node id "${raw.id}"`);
    const cell = `${raw.col},${raw.row}`;
    if (seenCell.has(cell)) {
      throw new Error(`two nodes share grid cell ${cell} (${raw.id})`);
    }
    seenCell.add(cell);

    const node: TopologyNode = {
      ...raw,
      x: (raw.col - midCol) * spacing,
      z: (raw.row - midRow) * spacing,
      neighbours: [],
    };
    byId.set(node.id, node);
    return node;
  });

  const cables: Cable[] = data.cables.map(([a, b]) => {
    const nodeA = byId.get(a);
    const nodeB = byId.get(b);
    if (!nodeA) throw new Error(`cable references unknown node "${a}"`);
    if (!nodeB) throw new Error(`cable references unknown node "${b}"`);
    if (!nodeA.neighbours.includes(b)) nodeA.neighbours.push(b);
    if (!nodeB.neighbours.includes(a)) nodeB.neighbours.push(a);
    return { a, b };
  });

  for (const node of nodes) node.neighbours.sort();

  const halfWidth = ((Math.max(...cols) - Math.min(...cols)) * spacing) / 2;
  const halfDepth = ((Math.max(...rows) - Math.min(...rows)) * spacing) / 2;

  return { name: data.name, spacing, nodes, cables, byId, halfWidth, halfDepth };
}
