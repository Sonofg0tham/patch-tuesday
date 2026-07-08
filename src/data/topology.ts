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

// One node as authored in the JSON, or as emitted by the procedural generator.
export interface RawNode {
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

// Assembles validated raw nodes and cable pairs into a Topology: resolves grid
// cells to centred world positions, wires the adjacency each node exposes, and
// measures the half extents for camera fitting. Shared by the JSON loader and
// the procedural generator so both boards behave identically. Throws loudly on
// malformed data (unknown type, duplicate id, shared cell, dangling cable) so a
// bad board fails at build, not silently mid-game.
export function assembleTopology(
  name: string,
  spacing: number,
  rawNodes: RawNode[],
  cableList: [string, string][],
): Topology {
  if (!(spacing > 0)) throw new Error('topology spacing must be positive');
  if (rawNodes.length === 0) throw new Error('topology has no nodes');

  const cols = rawNodes.map((n) => n.col);
  const rows = rawNodes.map((n) => n.row);
  const midCol = (Math.min(...cols) + Math.max(...cols)) / 2;
  const midRow = (Math.min(...rows) + Math.max(...rows)) / 2;

  const byId = new Map<string, TopologyNode>();
  const seenCell = new Set<string>();
  const nodes: TopologyNode[] = rawNodes.map((raw) => {
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

  const cables: Cable[] = cableList.map(([a, b]) => {
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

  return { name, spacing, nodes, cables, byId, halfWidth, halfDepth };
}

// Loads and validates the bundled hand-authored topology (the MERIDIAN MUTUAL
// scenario). The network is data, not code, so a bad hand-edit fails at boot.
export function loadTopology(): Topology {
  const data = rawTopology as {
    name: string;
    grid: { spacing: number };
    nodes: RawNode[];
    cables: [string, string][];
  };
  return assembleTopology(data.name, data.grid.spacing, data.nodes, data.cables);
}
