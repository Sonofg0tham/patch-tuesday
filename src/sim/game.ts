// The game layer on top of the WORM: the six player actions, the AP economy,
// scoring, win and lose, and turn resolution. All pure logic, no Three.js. A
// whole game is a seed plus an ordered list of moves, so replay() reproduces
// any run exactly, which is what the determinism test relies on.

import type { Topology } from '../data/topology';
import { SIM_CONFIG, type SimConfig } from './config';
import type {
  ActionResult,
  GameState,
  Move,
  PlayerAction,
  TurnEvent,
  TurnResult,
} from './types';
import { blastRadius, createInitialState, infectedCount, stepTurn } from './worm';

// A fresh copy of the state with its nodes cloned, so actions never mutate the
// caller's state.
function cloneState(state: GameState): GameState {
  const nodes: GameState['nodes'] = {};
  for (const [id, ns] of Object.entries(state.nodes)) nodes[id] = { ...ns };
  return { ...state, nodes };
}

function actionEvent(action: PlayerAction, ok: boolean, reason?: string): TurnEvent {
  return { kind: 'action', action: action.kind, node: action.node, ok, reason };
}

// A blocked action: the original state is returned unchanged, with a reason.
function reject(state: GameState, action: PlayerAction, reason: string): ActionResult {
  return { state, ok: false, reason, events: [actionEvent(action, false, reason)] };
}

function accept(state: GameState, action: PlayerAction): ActionResult {
  return { state, ok: true, events: [actionEvent(action, true)] };
}

function apReason(need: number, have: number): string {
  return `not enough AP (need ${need}, have ${have})`;
}

// Restores are only possible while a Backup Node survives.
function backupAvailable(state: GameState, topology: Topology): boolean {
  return topology.nodes.some(
    (n) => n.type === 'backup' && state.nodes[n.id]?.state !== 'encrypted',
  );
}

// Validates and applies one player action, deterministically (no RNG). Blocked
// actions carry a plain-English reason. The patch probe is the one block that
// still changes state: it reveals a hidden infection and costs 1 AP.
export function applyPlayerAction(
  state: GameState,
  action: PlayerAction,
  topology: Topology,
  config: SimConfig = SIM_CONFIG,
): ActionResult {
  if (state.status !== 'playing') return reject(state, action, 'the incident is over');

  const next = cloneState(state);

  if (action.kind === 'emergency') {
    if (next.emergencyUsed) return reject(state, action, 'emergency budget already spent');
    next.ap += config.emergencyApBonus;
    next.emergencyUsed = true;
    return accept(next, action);
  }

  const nodeId = action.node;
  if (!nodeId) return reject(state, action, 'no target node');
  const node = topology.byId.get(nodeId);
  const ns = next.nodes[nodeId];
  if (!node || !ns) return reject(state, action, 'unknown node');

  switch (action.kind) {
    case 'scan': {
      // Deploy Sensor: place permanent EDR coverage on this node only. Like
      // built-in EDR, it reveals the node's true state now and any future
      // infection the turn it lands. No neighbour reveal.
      const cost = config.actionCosts.scan;
      if (next.ap < cost) return reject(state, action, apReason(cost, next.ap));
      next.ap -= cost;
      ns.revealed = true;
      return accept(next, action);
    }
    case 'isolate': {
      if (ns.isolated) return reject(state, action, 'already isolated');
      const cost = config.actionCosts.isolate;
      if (next.ap < cost) return reject(state, action, apReason(cost, next.ap));
      next.ap -= cost;
      ns.isolated = true;
      ns.isolationAge = 0;
      return accept(next, action);
    }
    case 'reconnect': {
      if (!ns.isolated) return reject(state, action, 'not isolated');
      const cost = config.actionCosts.reconnect;
      if (next.ap < cost) return reject(state, action, apReason(cost, next.ap));
      next.ap -= cost;
      ns.isolated = false;
      ns.isolationAge = 0;
      return accept(next, action);
    }
    case 'patch': {
      if (ns.state === 'patched') return reject(state, action, 'already patched');
      if (ns.state === 'infected' || ns.state === 'encrypted') {
        // Probe: reveals the hidden truth and costs 1 AP, but does not patch.
        const cost = config.patchProbeCost;
        if (next.ap < cost) return reject(state, action, apReason(cost, next.ap));
        next.ap -= cost;
        ns.revealed = true;
        const reason = `cannot patch, ${node.label} is ${ns.state}`;
        return { state: next, ok: false, reason, events: [actionEvent(action, false, reason)] };
      }
      const cost = config.actionCosts.patch;
      if (next.ap < cost) return reject(state, action, apReason(cost, next.ap));
      next.ap -= cost;
      ns.state = 'patched';
      return accept(next, action);
    }
    case 'restore': {
      if (ns.state !== 'infected' && ns.state !== 'encrypted') {
        return reject(state, action, 'nothing to restore here');
      }
      if (!backupAvailable(next, topology)) {
        return reject(state, action, 'backup node encrypted, restores unavailable');
      }
      if (next.backupCredits <= 0) return reject(state, action, 'no backup credits left');
      const cost = config.actionCosts.restore;
      if (next.ap < cost) return reject(state, action, apReason(cost, next.ap));
      next.ap -= cost;
      next.backupCredits -= 1;
      ns.state = 'clean';
      ns.infectedTurns = 0;
      return accept(next, action);
    }
    default:
      return reject(state, action, 'unknown action');
  }
}

// The running penalty accrued this turn: encrypted nodes bleed value, isolated
// nodes cost downtime. Rounded so the score stays a tidy integer.
function turnPenalty(state: GameState, topology: Topology, config: SimConfig): number {
  let penalty = 0;
  for (const node of topology.nodes) {
    const ns = state.nodes[node.id];
    const value = config.nodeValue[node.type];
    if (ns.state === 'encrypted') penalty += value * config.encryptedBleedPerTurn;
    if (ns.isolated) penalty += value * config.isolationDowntimePerTurn;
  }
  return Math.round(penalty);
}

// Sets the win/lose status. Lose takes precedence over win. Lose if the domain
// controller is encrypted or the blast radius crosses the threshold; win if no
// infected nodes remain (the worm is contained, even if some nodes were lost).
function applyStatus(state: GameState, topology: Topology, config: SimConfig): void {
  const dcEncrypted = topology.nodes.some(
    (n) => n.type === 'domain-controller' && state.nodes[n.id]?.state === 'encrypted',
  );
  if (dcEncrypted) {
    state.status = 'lost';
    state.lossReason = 'domain-controller';
    return;
  }
  if (blastRadius(state) >= config.lossBlastRadius) {
    state.status = 'lost';
    state.lossReason = 'blast-radius';
    return;
  }
  if (infectedCount(state) === 0) state.status = 'won';
}

// Business pressure added this turn: each isolated node contributes its
// type weight (a router costs the business more than a workstation).
function pressureLoad(state: GameState, topology: Topology, config: SimConfig): number {
  let load = 0;
  for (const node of topology.nodes) {
    if (state.nodes[node.id].isolated) load += config.pressureWeight[node.type];
  }
  return load;
}

// The single longest-isolated node, for the business override. Ties break by id
// so the choice is deterministic.
function longestIsolated(state: GameState, topology: Topology): string | null {
  let victim: string | null = null;
  let bestAge = -1;
  for (const node of [...topology.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const ns = state.nodes[node.id];
    if (!ns.isolated) continue;
    const age = ns.isolationAge ?? 0;
    if (age > bestAge) {
      bestAge = age;
      victim = node.id;
    }
  }
  return victim;
}

// Ends the turn: a business override may force a reconnect, then the worm
// spreads, isolation ages, business pressure accrues, AP refreshes, score
// accrues, and win/lose settles.
export function endTurn(
  state: GameState,
  topology: Topology,
  config: SimConfig = SIM_CONFIG,
): TurnResult {
  if (state.status !== 'playing') return { nextState: state, events: [] };

  const events: TurnEvent[] = [];

  // 1. Business override at the start of the spread phase: if pressure is
  //    maxed, the business force-reconnects the oldest containment, ready or
  //    not. Steady bleed: one node per turn while the meter sits at max.
  let working = state;
  if (state.pressure >= config.pressureMax) {
    const victim = longestIsolated(state, topology);
    if (victim) {
      working = cloneState(state);
      working.nodes[victim].isolated = false;
      working.nodes[victim].isolationAge = 0;
      working.findings = [
        ...working.findings,
        { turn: state.turn, kind: 'business-override', node: victim },
      ];
      events.push({ kind: 'override', node: victim });
    }
  }

  // 2. The worm spreads (across any freshly force-reconnected cable).
  const spread = stepTurn(working, topology, config);
  const next = spread.nextState;
  events.push(...spread.events);

  // 3. Age isolation for every node still isolated.
  for (const node of topology.nodes) {
    const ns = next.nodes[node.id];
    if (ns.isolated) ns.isolationAge = (ns.isolationAge ?? 0) + 1;
  }

  // 4. Accumulate business pressure, then let it recover a little each turn.
  next.pressure = clamp(
    next.pressure + pressureLoad(next, topology, config) - config.pressureRecoveryPerTurn,
    0,
    config.pressureMax,
  );

  // 5. Refresh AP, accrue score, settle win/lose.
  next.ap = config.apPerTurn;
  next.score += turnPenalty(next, topology, config);
  applyStatus(next, topology, config);
  return { nextState: next, events };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Replays a whole game from its seed and move list. Same inputs, same output,
// every time: this is what makes a run reproducible for debugging.
export function replay(
  topology: Topology,
  seed: string,
  moves: Move[],
  config: SimConfig = SIM_CONFIG,
): GameState {
  let state = createInitialState(topology, seed, config);
  for (const move of moves) {
    if (move.kind === 'end-turn') state = endTurn(state, topology, config).nextState;
    else state = applyPlayerAction(state, move, topology, config).state;
  }
  return state;
}
