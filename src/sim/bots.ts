// Scripted policies that play the game headlessly, so balance can be measured
// without rendering. Both policies use the visible view and a seeded, separate
// RNG stream. Recorded and unrecorded runs share the same state machine.

import type { Topology, TopologyNode } from '../data/topology';
import { SIM_CONFIG, type SimConfig } from './config';
import {
  applyPlayerAction,
  canDeclareContainment,
  declareContainment,
  endTurn,
  fileReview,
} from './game';
import { RunRecorder, type RunRecord } from './pir';
import { createRng, hashSeed, type Rng } from './rng';
import type { GameState, PlayerAction, TurnEvent } from './types';
import { blastRadius, createInitialState, toVisibleView } from './worm';

export type BotDecision = PlayerAction | 'end-turn' | 'declare-containment' | 'file-review';

export interface BotOutcome {
  status: GameState['status'];
  turns: number;
  containmentTurn: number | null;
  filingTurn: number | null;
  maxPressure: number;
  prematureDeclarations: number;
  blastRadius: number;
  score: number;
  backupsUsed: number;
  emergencyUsed: boolean;
}

export type Bot = (
  state: GameState,
  topology: Topology,
  config: SimConfig,
  rng: Rng,
) => BotDecision;

interface DriverHooks {
  transition(before: GameState, after: GameState, events: TurnEvent[], hourAdvanced: boolean): void;
}

interface DriverResult {
  final: GameState;
  containmentTurn: number | null;
  filingTurn: number | null;
  maxPressure: number;
  prematureDeclarations: number;
}

const NO_HOOKS: DriverHooks = { transition: () => undefined };
const MAX_DECISIONS_PER_HOUR = 30;

function driveBot(
  topology: Topology,
  seed: string,
  bot: Bot,
  config: SimConfig,
  maxHours: number,
  hooks: DriverHooks,
): DriverResult {
  let state = createInitialState(topology, seed, config);
  const rng = createRng(hashSeed(`${seed}:bot`));
  let containmentTurn: number | null = null;
  let filingTurn: number | null = null;
  let maxPressure = state.pressure;
  let prematureDeclarations = 0;
  let decisionHour = state.turn;
  let decisionsThisHour = 0;

  const transition = (next: GameState, events: TurnEvent[]): void => {
    const before = state;
    const hourAdvanced = next.turn !== before.turn;
    hooks.transition(before, next, events, hourAdvanced);
    state = next;
    maxPressure = Math.max(maxPressure, state.pressure);
    if (hourAdvanced) {
      decisionHour = state.turn;
      decisionsThisHour = 0;
    }
  };

  while (state.status === 'playing' && state.turn <= maxHours) {
    if (state.turn !== decisionHour) {
      decisionHour = state.turn;
      decisionsThisHour = 0;
    }
    decisionsThisHour += 1;

    if (decisionsThisHour > MAX_DECISIONS_PER_HOUR) {
      const result = endTurn(state, topology, config);
      transition(result.nextState, result.events);
      continue;
    }

    const decision = bot(state, topology, config, rng);
    if (decision === 'end-turn') {
      const result = endTurn(state, topology, config);
      transition(result.nextState, result.events);
      continue;
    }
    if (decision === 'declare-containment') {
      const declarationTurn = state.turn;
      const result = declareContainment(state, topology, config);
      const event = result.events.find((item) => item.kind === 'containment-declaration');
      if (event?.kind === 'containment-declaration') {
        if (event.confirmed) containmentTurn = declarationTurn;
        else prematureDeclarations += 1;
      }
      transition(result.nextState, result.events);
      continue;
    }
    if (decision === 'file-review') {
      const reviewTurn = state.turn;
      const result = fileReview(state);
      if (result.nextState.status === 'won') filingTurn = reviewTurn;
      transition(result.nextState, result.events);
      continue;
    }

    const result = applyPlayerAction(state, decision, topology, config);
    if (result.ok) transition(result.state, result.events);
  }

  return { final: state, containmentTurn, filingTurn, maxPressure, prematureDeclarations };
}

export function runBot(
  topology: Topology,
  seed: string,
  bot: Bot,
  config: SimConfig = SIM_CONFIG,
  maxHours = 60,
): BotOutcome {
  const result = driveBot(topology, seed, bot, config, maxHours, NO_HOOKS);
  const state = result.final;
  return {
    status: state.status,
    turns: state.turn,
    containmentTurn: result.containmentTurn,
    filingTurn: result.filingTurn,
    maxPressure: result.maxPressure,
    prematureDeclarations: result.prematureDeclarations,
    blastRadius: blastRadius(state),
    score: state.score,
    backupsUsed: config.backupCredits - state.backupCredits,
    emergencyUsed: state.emergencyUsed,
  };
}

export function runBotRecorded(
  topology: Topology,
  seed: string,
  bot: Bot,
  config: SimConfig = SIM_CONFIG,
  scenarioName = topology.name,
  maxHours = 60,
): RunRecord {
  const recorder = new RunRecorder();
  let initial: GameState | null = null;
  const result = driveBot(topology, seed, bot, config, maxHours, {
    transition(before, after, events, hourAdvanced) {
      initial ??= before;
      recorder.record(before.turn, events);
      if (hourAdvanced) recorder.tickDowntime(after);
    },
  });

  return {
    scenarioName,
    seed,
    initial: initial ?? createInitialState(topology, seed, config),
    final: result.final,
    log: recorder.log,
    downtimeHours: recorder.downtimeHours,
  };
}

const ACTION_KINDS = ['scan', 'isolate', 'reconnect', 'patch', 'restore'] as const;
const CRITICAL_TYPES = new Set(['server', 'router', 'backup', 'domain-controller']);

function legalRecoveryActions(
  state: GameState,
  topology: Topology,
  config: SimConfig,
  criticalOnly: boolean,
): PlayerAction[] {
  const actions: PlayerAction[] = [];
  for (const node of [...topology.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (criticalOnly && !CRITICAL_TYPES.has(node.type)) continue;
    const reconnect = { kind: 'reconnect' as const, node: node.id };
    const restore = { kind: 'restore' as const, node: node.id };
    if (applyPlayerAction(state, restore, topology, config).ok) actions.push(restore);
    if (applyPlayerAction(state, reconnect, topology, config).ok) actions.push(reconnect);
  }
  return actions;
}

export const randomBot: Bot = (state, topology, config, rng) => {
  if (canDeclareContainment(state, topology)) return 'declare-containment';
  if (state.phase === 'recovery') {
    const actions = legalRecoveryActions(state, topology, config, false);
    if (actions.length === 0 || rng.chance(0.25)) return 'file-review';
    return rng.pick(actions);
  }
  if (state.ap < 1) return 'end-turn';
  if (!state.emergencyUsed && rng.chance(0.05)) return { kind: 'emergency' };
  return { kind: rng.pick(ACTION_KINDS), node: rng.pick(topology.nodes).id };
};

export const greedyBot: Bot = (state, topology, config, _rng) => {
  if (canDeclareContainment(state, topology)) return 'declare-containment';
  if (state.phase === 'recovery') {
    const actions = legalRecoveryActions(state, topology, config, true).sort((a, b) => {
      const aNode = topology.byId.get(a.node as string) as TopologyNode;
      const bNode = topology.byId.get(b.node as string) as TopologyNode;
      return (
        config.nodeValue[bNode.type] - config.nodeValue[aNode.type] ||
        (a.kind === b.kind ? 0 : a.kind === 'restore' ? -1 : 1) ||
        aNode.id.localeCompare(bNode.id)
      );
    });
    return actions[0] ?? 'file-review';
  }

  const visible = toVisibleView(state, topology);
  const value = (node: TopologyNode): number => config.nodeValue[node.type];
  const degree = (node: TopologyNode): number => node.neighbours.length;
  const covered = (node: TopologyNode): boolean => node.edr || Boolean(state.nodes[node.id].revealed);
  const infected = topology.nodes.filter((node) => visible[node.id] === 'infected');

  if (infected.length >= 2 && !state.emergencyUsed && state.ap < 2) {
    return { kind: 'emergency' };
  }

  if (infected.length > 0) {
    const backupAlive = topology.nodes.some(
      (node) => node.type === 'backup' && state.nodes[node.id].state !== 'encrypted',
    );
    if (state.ap >= config.actionCosts.restore && state.backupCredits > 0 && backupAlive) {
      const target = highest(infected, value);
      if (target) return { kind: 'restore', node: target.id };
    }
    if (state.ap >= config.actionCosts.isolate) {
      const target = highest(
        infected.filter((node) => !state.nodes[node.id].isolated),
        degree,
      );
      if (target) return { kind: 'isolate', node: target.id };
    }
  }

  if (state.pressure >= config.pressureMax * 0.5 && state.ap >= config.actionCosts.reconnect) {
    const reconnectable = topology.nodes
      .filter((node) => state.nodes[node.id].isolated && visible[node.id] !== 'infected')
      .sort((a, b) => {
        const pressureDifference =
          config.pressureWeight[b.type] - config.pressureWeight[a.type];
        if (pressureDifference !== 0) return pressureDifference;

        const risk = (node: TopologyNode): number => {
          if (visible[node.id] === 'patched' || visible[node.id] === 'encrypted') return 0;
          const hasVisibleCompromisedNeighbour = node.neighbours.some(
            (id) => visible[id] === 'infected' || visible[id] === 'encrypted',
          );
          return hasVisibleCompromisedNeighbour ? 2 : 1;
        };
        return risk(a) - risk(b) || a.id.localeCompare(b.id);
      });
    const target = reconnectable[0];
    if (target) return { kind: 'reconnect', node: target.id };
  }

  const compromised = new Set(
    topology.nodes
      .filter((node) => visible[node.id] === 'infected' || visible[node.id] === 'encrypted')
      .map((node) => node.id),
  );
  const uncovered = topology.nodes.filter(
    (node) => !covered(node) && visible[node.id] === 'clean',
  );
  if (state.ap >= config.actionCosts.scan && uncovered.length > 0) {
    const frontier = uncovered.filter((node) =>
      node.neighbours.some((id) => compromised.has(id)),
    );
    const target = frontier.length > 0 ? highest(frontier, value) : highest(uncovered, degree);
    if (target) return { kind: 'scan', node: target.id };
  }

  const chokepoints = topology.nodes.filter(
    (node) => node.type === 'router' && state.nodes[node.id].state === 'clean',
  );
  if (state.ap >= config.actionCosts.patch && chokepoints.length > 0) {
    const target = highest(chokepoints, degree);
    if (target) return { kind: 'patch', node: target.id };
  }

  return 'end-turn';
};

function highest(
  nodes: readonly TopologyNode[],
  score: (node: TopologyNode) => number,
): TopologyNode | null {
  let best: TopologyNode | null = null;
  let bestScore = -Infinity;
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const candidateScore = score(node);
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      best = node;
    }
  }
  return best;
}
