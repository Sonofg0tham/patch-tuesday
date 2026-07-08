// Procedural topology generator (Phase 4). Produces a seeded estate that varies
// the board while preserving the structural properties the locked economy was
// tuned against: 24 nodes, a hub-and-spoke core, segment switches with
// workstation leaves, the crown jewels (DC and backup) hung off the core rather
// than out on the edge, ~58 percent EDR coverage with one fully blind segment,
// and a base spanning tree (so every board is fully connected) plus a small
// seeded budget of cross-links for structural variety.
//
// Pure and deterministic: the same seed always yields the same board. No
// Three.js, no DOM. The output is a Topology, identical in shape to the
// hand-authored board, so the renderer, the sim and the bots treat both alike.

import {
  assembleTopology,
  type NodeType,
  type RawNode,
  type Topology,
} from './topology';
import { GEN_CONFIG, type TopoGenConfig } from '../sim/config';
import { createRng, hashSeed, type Rng } from '../sim/rng';

// Departmental flavour so a generated estate reads like a real one and the PIR
// can name segments. Picked without replacement per board.
const DEPARTMENTS = ['FIN', 'OPS', 'HR', 'DEV', 'SALES', 'LEGAL', 'ENG', 'MKTG'];
const SERVER_ROLES = [
  ['MAIL', 'Exchange mail server'],
  ['SQL', 'SQL Server database'],
  ['APP', 'Line-of-business app server'],
  ['WEB', 'IIS web server'],
  ['FILE', 'Windows file server'],
  ['DNS', 'DNS resolver'],
  ['PRINT', 'Print server'],
  ['VPN', 'VPN concentrator'],
] as const;

// A leaf of the tree, before positions and adjacency are assembled.
interface GenNode {
  id: string;
  type: NodeType;
  role: string;
  edr: boolean;
  col: number;
  row: number;
}

function intRange(rng: Rng, [min, max]: [number, number]): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Rows: infrastructure across the top, then the core, the switches, and the
// workstation blocks beneath their segment. Generous gaps keep the cables
// legible from the fixed camera.
const ROW_INFRA = 0;
const ROW_CORE = 3;
const ROW_SWITCH = 6;
const ROW_WS = 8;
const SEG_WIDTH = 4; // max workstation columns per segment block

export function generateTopology(seed: string, config: TopoGenConfig = GEN_CONFIG): Topology {
  const rng = createRng(hashSeed(`${seed}:topo`));

  // 1. Counts. DC and backup are always singletons; workstations take the
  //    remainder so every board has exactly nodeCount nodes.
  const routerCount = intRange(rng, config.routers);
  const serverCount = intRange(rng, config.servers);
  const switchCount = routerCount - 1; // routers minus the core hub
  const wsCount = config.nodeCount - 2 - routerCount - serverCount;
  if (wsCount < switchCount) {
    throw new Error(`generator: not enough workstations (${wsCount}) for ${switchCount} segments`);
  }

  const departments = shuffle(rng, DEPARTMENTS).slice(0, switchCount);
  const serverRoles = shuffle(rng, SERVER_ROLES).slice(0, serverCount);

  // 2. Distribute workstations across the segments, at least one each,
  //    round-robin so the split is even and deterministic.
  const perSegment: number[] = new Array(switchCount).fill(0);
  for (let i = 0; i < wsCount; i += 1) perSegment[i % switchCount] += 1;

  // 3. Build nodes tier by tier, with collision-free grid cells.
  const nodes: GenNode[] = [];
  const cables: [string, string][] = [];

  const segmentsWidth = switchCount * (SEG_WIDTH + 1) - 1;
  const topWidth = 2 + serverCount; // DC + backup + servers on the infra row
  const totalCols = Math.max(segmentsWidth, topWidth, 1);
  const segOffset = Math.max(0, Math.floor((totalCols - segmentsWidth) / 2));
  const topOffset = Math.max(0, Math.floor((totalCols - topWidth) / 2));

  // Core hub, centred.
  const coreId = 'CORE-RTR';
  nodes.push({ id: coreId, type: 'router', role: 'Core switch', edr: true, col: Math.floor(totalCols / 2), row: ROW_CORE });

  // Infrastructure across the top: DC, servers, backup. All hang off the core.
  // Covered by default, like the hand-authored board.
  let topCol = topOffset;
  const dcId = 'DC-01';
  nodes.push({ id: dcId, type: 'domain-controller', role: 'Active Directory domain controller', edr: true, col: topCol, row: ROW_INFRA });
  cables.push([coreId, dcId]);
  topCol += 1;
  for (const [tag, role] of serverRoles) {
    const id = `SRV-${tag}`;
    nodes.push({ id, type: 'server', role, edr: true, col: topCol, row: ROW_INFRA });
    cables.push([coreId, id]);
    topCol += 1;
  }
  const backupId = 'BACKUP-01';
  nodes.push({ id: backupId, type: 'backup', role: 'Backup repository', edr: true, col: topCol, row: ROW_INFRA });
  cables.push([coreId, backupId]);

  // Segments: a switch off the core, workstations off the switch. One whole
  // segment is left fully blind (no EDR) as the meaningful coverage gap; the
  // rest get coverage from a budget below.
  const blindSegment = Math.floor(rng.next() * switchCount);
  const switchIds: string[] = [];
  const wsBySegment: string[][] = [];

  for (let s = 0; s < switchCount; s += 1) {
    const dept = departments[s];
    const baseCol = segOffset + s * (SEG_WIDTH + 1);
    const swId = `${dept}-SW`;
    nodes.push({ id: swId, type: 'router', role: `${dept} segment switch`, edr: false, col: baseCol + Math.floor(SEG_WIDTH / 2), row: ROW_SWITCH });
    cables.push([coreId, swId]);
    switchIds.push(swId);

    const segWs: string[] = [];
    for (let k = 0; k < perSegment[s]; k += 1) {
      const id = `${dept}-${String(k + 1).padStart(2, '0')}`;
      nodes.push({
        id,
        type: 'workstation',
        role: `${dept} workstation`,
        edr: false, // coverage assigned below
        col: baseCol + (k % SEG_WIDTH),
        row: ROW_WS + Math.floor(k / SEG_WIDTH),
      });
      cables.push([swId, id]);
      segWs.push(id);
    }
    wsBySegment.push(segWs);
  }

  // 4. EDR coverage. The core, DC, backup and servers are already covered.
  //    Cover workstations (never the blind segment) until we reach the target,
  //    picking in a shuffled order so the gap placement varies by seed.
  const target = Math.round(config.edrCoverage * config.nodeCount);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let covered = nodes.filter((n) => n.edr).length;
  const coverable = shuffle(
    rng,
    wsBySegment.flatMap((ws, s) => (s === blindSegment ? [] : ws)),
  );
  for (const id of coverable) {
    if (covered >= target) break;
    const node = byId.get(id);
    if (node && !node.edr) {
      node.edr = true;
      covered += 1;
    }
  }

  // 5. Extra cables beyond the tree: cross-segment switch links, adding cycles
  //    and alternate spread paths between segments (the structural variety
  //    knob). Only switch-to-switch links are used: multi-homing a workstation
  //    hands the worm a leaf-level jump between segments, which the balance gate
  //    showed collapses the casual-play floor, so it is deliberately excluded.
  //    A board with a single segment switch has no candidates and stays a pure
  //    tree, so cycles appear only on the busier layouts.
  const existing = new Set(cables.map(([a, b]) => cableKey(a, b)));
  const candidates: [string, string][] = [];
  for (let i = 0; i < switchIds.length; i += 1) {
    for (let j = i + 1; j < switchIds.length; j += 1) {
      candidates.push([switchIds[i], switchIds[j]]);
    }
  }
  const extraTarget = intRange(rng, config.extraEdges);
  const pool = shuffle(rng, candidates);
  let added = 0;
  for (const [a, b] of pool) {
    if (added >= extraTarget) break;
    const key = cableKey(a, b);
    if (existing.has(key)) continue;
    existing.add(key);
    cables.push([a, b]);
    added += 1;
  }

  const rawNodes: RawNode[] = nodes.map((n) => ({
    id: n.id,
    label: n.id,
    type: n.type,
    role: n.role,
    col: n.col,
    row: n.row,
    edr: n.edr,
  }));

  const name = `RANDOM ESTATE // ${seed.toUpperCase()}`;
  return assembleTopology(name, config.spacing, rawNodes, cables);
}

function cableKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
