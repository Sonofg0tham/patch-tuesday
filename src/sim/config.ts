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
}

export const SIM_CONFIG: SimConfig = {
  spreadChance: 0.6,
  encryptAfterTurns: 3,
  patientZeroType: 'workstation',
  patientZeroEdgeOnly: true,
  lossBlastRadius: 0.6,
  dwellTurns: 2,

  apPerTurn: 3,
  backupCredits: 3,
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
};
