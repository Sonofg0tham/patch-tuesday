// The threat's tuning knobs, in one place. Craig tunes the game by editing
// these numbers; nothing here reaches into rendering. All values are starting
// points from GAME_DESIGN.md and are meant to be moved.

export interface SimConfig {
  /** Base chance an infected node infects a clean neighbour it reaches. */
  spreadChance: number;
  /** Turns a node stays infected before it encrypts (and stops spreading). */
  encryptAfterTurns: number;
  /** Which node type patient zero is drawn from. */
  patientZeroType: 'workstation' | 'server' | 'router' | 'backup' | 'domain-controller';
  /** Prefer the lowest-degree (edge / leaf) candidates for patient zero. */
  patientZeroEdgeOnly: boolean;
  /** Fraction of the estate encrypted that counts as the board being lost. */
  lossBlastRadius: number;
}

export const SIM_CONFIG: SimConfig = {
  spreadChance: 0.6,
  encryptAfterTurns: 3,
  patientZeroType: 'workstation',
  patientZeroEdgeOnly: true,
  lossBlastRadius: 0.6,
};
