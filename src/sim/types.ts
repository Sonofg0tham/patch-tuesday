// Simulation state and event types. Pure data, no behaviour, no Three.js.
//
// Two layers matter: the TRUE state (what is really happening) and the VISIBLE
// state (what the player is allowed to see through the fog of war). The sim
// owns the true state; the visible layer is derived from it and the node's EDR
// coverage. The renderer only ever reads the visible layer outside debug mode.

// True infection state of a node. Phase 3 adds patched / isolated / restored.
export type TrueState = 'clean' | 'infected' | 'encrypted';

// What the player sees. Same shape as TrueState in this phase, but reached
// through the fog: an uncovered infected node reads 'clean' until it encrypts.
export type VisibleState = 'clean' | 'infected' | 'encrypted';

export interface NodeState {
  state: TrueState;
  /** Completed turns spent infected. Drives the encryption clock. */
  infectedTurns: number;
}

// The whole run, serialisable and reproducible from its seed. rngState carries
// the PRNG cursor so the run can be resumed or replayed exactly.
export interface GameState {
  seed: string;
  rngState: number;
  turn: number;
  nodes: Record<string, NodeState>;
}

// Everything that happened in a turn, in order. Drives both the spread
// animation and the debug overlay. Nothing here is rendering-specific.
export type TurnEvent =
  | { kind: 'patient-zero'; node: string }
  | { kind: 'spread-attempt'; source: string; target: string; roll: number; success: boolean }
  | { kind: 'infected'; node: string }
  | { kind: 'encrypted'; node: string };

export interface TurnResult {
  nextState: GameState;
  events: TurnEvent[];
}
