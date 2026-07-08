// The game's tuning knobs, in one place. Craig tunes the game by editing these
// numbers; nothing here reaches into rendering. All values are starting points
// from GAME_DESIGN.md and are meant to be moved. See the Phase 3 PR worksheet
// for what each does to difficulty.

import type { ActionKind } from './types';
import type { NodeType } from '../data/topology';

export interface SimConfig {
  // --- The threat ---
  /** Base chance an infected node infects a clean neighbour it reaches. */
  spreadChance: number;
  /** Turns a node stays infected before it encrypts (and stops spreading). */
  encryptAfterTurns: number;
  /** Which node type patient zero is drawn from. */
  patientZeroType: NodeType;
  /** Prefer the lowest-degree (edge / leaf) candidates for patient zero. */
  patientZeroEdgeOnly: boolean;
  /** Fraction of the estate encrypted that counts as the board being lost. */
  lossBlastRadius: number;
  /**
   * Pre-player spread turns the worm runs before the incident is detected at
   * T+01h, so the player is paged to an established foothold rather than a lone
   * patient zero. These turns do not spend AP or accrue score.
   */
  dwellTurns: number;

  // --- The action economy ---
  /** Action points granted at the start of each turn. */
  apPerTurn: number;
  /** Restore credits at the start of a run (held by the Backup Node). */
  backupCredits: number;
  /** Extra AP the once-per-run emergency budget grants this turn. */
  emergencyApBonus: number;
  /** AP cost of each action. */
  actionCosts: Record<Exclude<ActionKind, 'emergency'>, number>;
  /** AP a failed patch costs when it probes (and reveals) a hidden infection. */
  patchProbeCost: number;

  // --- Scoring (running penalty, higher is worse) ---
  /** Value of each node type, the basis for downtime and bleed penalties. */
  nodeValue: Record<NodeType, number>;
  /** Penalty per turn for each encrypted node, as a fraction of its value. */
  encryptedBleedPerTurn: number;
  /** Penalty per turn for each isolated node, as a fraction of its value. */
  isolationDowntimePerTurn: number;

  // --- Business pressure (sustained isolation threatens the run) ---
  /** Pressure ceiling; at max the business force-reconnects your oldest node. */
  pressureMax: number;
  /** Pressure added per turn for each isolated node, by type (router heaviest). */
  pressureWeight: Record<NodeType, number>;
  /** Pressure shed each turn, so light isolation is tolerable and recovers. */
  pressureRecoveryPerTurn: number;
}

export const SIM_CONFIG: SimConfig = {
  spreadChance: 0.6,
  encryptAfterTurns: 3,
  patientZeroType: 'workstation',
  patientZeroEdgeOnly: true,
  lossBlastRadius: 0.6,
  dwellTurns: 3,

  apPerTurn: 2,
  backupCredits: 2,
  emergencyApBonus: 2,
  actionCosts: {
    scan: 1,
    isolate: 1,
    reconnect: 1,
    patch: 2,
    restore: 2,
  },
  patchProbeCost: 1,

  nodeValue: {
    workstation: 10,
    server: 40,
    router: 25,
    backup: 50,
    'domain-controller': 100,
  },
  encryptedBleedPerTurn: 0.25,
  isolationDowntimePerTurn: 0.15,

  pressureMax: 100,
  pressureWeight: {
    workstation: 4,
    server: 12,
    router: 18,
    backup: 12,
    'domain-controller': 15,
  },
  pressureRecoveryPerTurn: 10,
};

// --- Procedural topology generation (Phase 4) ---
//
// The generator produces seeded estates that vary the board while keeping the
// locked economy in balance. Every constraint here is derived from the
// hand-authored MERIDIAN MUTUAL board, measured: 24 nodes; 1 DC, 1 backup, 3
// routers, 5 servers, 14 workstations; a hub-and-spoke tree (23 cables, density
// 0.958) with three hubs (degree 9, 8, 8); 58 percent EDR coverage with the
// finance segment switch blind. The band-holding rule is absolute: if a wider
// envelope breaks the balance gate, tighten the generator, never the economy.
export interface TopoGenConfig {
  /** Total nodes on every generated board (fixed, so the economy tuning holds). */
  nodeCount: number;
  /** World spacing between grid cells, matching the hand-authored board. */
  spacing: number;
  /** Routers per board, inclusive range (one is the core hub, rest are switches). */
  routers: [min: number, max: number];
  /** Servers per board, inclusive range. */
  servers: [min: number, max: number];
  /** Target fraction of nodes with EDR coverage (~MERIDIAN's 58 percent). */
  edrCoverage: number;
  /**
   * Extra cables added beyond the connecting spanning tree, inclusive range.
   * These create cycles and cross-segment links: the structural variety knob.
   * Higher means more spread paths and weaker isolation, so this is the first
   * value the balance gate tightens if greedy drops out of band.
   */
  extraEdges: [min: number, max: number];
}

export const GEN_CONFIG: TopoGenConfig = {
  nodeCount: 24,
  spacing: 2.2,
  // Two routers means a single segment switch holding every workstation: a
  // degree-17 hub that cascades the moment it lights up. The balance gate
  // measured that at greedy ~35 percent / random ~10 percent, so the minimum
  // is three routers (two or three segment switches), which distributes the
  // workstations and matches the hand-authored board's hub sizes.
  routers: [3, 4],
  servers: [4, 6],
  edrCoverage: 0.58,
  // Pinned to zero by the balance gate. Cross-segment cycles give the worm
  // alternate spread paths and weaken isolation; each ~0.5 average cross-links
  // measured a ~3 point drop in the random (casual) win rate, taking it below
  // the 15 percent floor. Structural variety therefore comes from the
  // tree-preserving dimensions (segment count, server count, workstation split,
  // coverage gap, layout), not from cycles. Raising this needs a new balance
  // decision, not a generator tweak.
  extraEdges: [0, 0],
};
