// Simulation state and event types. Pure data, no behaviour, no Three.js.
//
// Two layers matter: the TRUE state (what is really happening) and the VISIBLE
// state (what the player is allowed to see through the fog of war). The sim
// owns the true state; the visible layer is derived from it and the node's EDR
// coverage. The renderer only ever reads the visible layer outside debug mode.

// True infection state of a node. 'patched' nodes are immune and cannot be
// infected. Isolation and reveal are per-node flags, not states.
export type TrueState = 'clean' | 'infected' | 'encrypted' | 'patched';

// What the player sees. Reached through the fog: an uncovered infected node
// reads 'clean' until it encrypts, unless it has been scanned (revealed).
export type VisibleState = 'clean' | 'infected' | 'encrypted' | 'patched';

export interface NodeState {
  state: TrueState;
  /** Completed turns spent infected. Drives the encryption clock. */
  infectedTurns: number;
  /** Cables cut by Isolate: spread cannot cross, services are offline. */
  isolated?: boolean;
  /** Scanned or probed: the player sees this node's true state from now on. */
  revealed?: boolean;
}

// The whole run, serialisable and reproducible from its seed. rngState carries
// the PRNG cursor so the run can be resumed or replayed exactly. Everything
// here is plain data so a game is a seed plus an ordered list of moves.
export interface GameState {
  seed: string;
  rngState: number;
  turn: number;
  nodes: Record<string, NodeState>;
  /** Action points remaining this turn. */
  ap: number;
  /** Restore credits left (the Backup Node holds these). */
  backupCredits: number;
  /** The once-per-run emergency budget, and the permanent PIR flag. */
  emergencyUsed: boolean;
  /** Running penalty: downtime plus encrypted value bled. Higher is worse. */
  score: number;
  status: 'playing' | 'won' | 'lost';
  lossReason?: 'domain-controller' | 'blast-radius';
}

// The six player actions. `node` is omitted only for the emergency budget.
export type ActionKind =
  | 'scan'
  | 'isolate'
  | 'reconnect'
  | 'patch'
  | 'restore'
  | 'emergency';

export interface PlayerAction {
  kind: ActionKind;
  node?: string;
}

// A move in a replayable game: a player action or the end of the turn.
export type Move = PlayerAction | { kind: 'end-turn' };

// Everything that happened, in order. Drives the spread animation, the debug
// overlay, and the action log. Nothing here is rendering-specific.
export type TurnEvent =
  | { kind: 'patient-zero'; node: string }
  | { kind: 'spread-attempt'; source: string; target: string; roll: number; success: boolean }
  | { kind: 'infected'; node: string }
  | { kind: 'encrypted'; node: string }
  | { kind: 'action'; action: ActionKind; node?: string; ok: boolean; reason?: string };

export interface TurnResult {
  nextState: GameState;
  events: TurnEvent[];
}

export interface ActionResult {
  state: GameState;
  ok: boolean;
  reason?: string;
  events: TurnEvent[];
}
