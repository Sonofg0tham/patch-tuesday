// The sole boundary between true simulation state and normal presentation.
// Everything outside this module receives visible state and observable events,
// never hidden infection, secret routes or RNG rolls.

import type { Topology } from '../data/topology';
import { SIM_CONFIG, type SimConfig } from './config';
import type {
  ActionKind,
  ActionOutcome,
  GameState,
  TurnEvent,
  VisibleState,
} from './types';
import { visibleStateOf } from './worm';

export interface NodePresentationState {
  id: string;
  visibleState: VisibleState;
  /** Whether the displayed status is verified rather than merely apparent. */
  observed: boolean;
  isolated: boolean;
  isolationAge: number;
  /** Built-in or deployed persistent coverage. */
  edr: boolean;
  /** Present only for infection the player can already observe. */
  turnsToEncryption?: number;
}

export interface PresentationView {
  nodes: Record<string, NodePresentationState>;
}

export type ObservableTurnEvent =
  | { kind: 'attempt'; source: string; target: string; success: boolean }
  | { kind: 'telemetry-gap'; attempts: number }
  | { kind: 'infected'; node: string }
  | { kind: 'encrypted'; node: string }
  | { kind: 'override'; node: string }
  | {
      kind: 'action';
      action: ActionKind;
      node?: string;
      outcome: ActionOutcome;
      apSpent: number;
      reason?: string;
    }
  | { kind: 'containment-declaration'; confirmed: boolean }
  | { kind: 'recovery-hour' }
  | { kind: 'review-filed' };

/**
 * Builds the complete public board model. Hidden infection deliberately has
 * exactly the same output as a genuinely clean, uncovered asset.
 */
export function toPresentationView(
  state: GameState,
  topology: Topology,
  config: SimConfig = SIM_CONFIG,
): PresentationView {
  const nodes: Record<string, NodePresentationState> = {};

  for (const node of topology.nodes) {
    const trueNode = state.nodes[node.id];
    if (!trueNode) continue;

    const visibleState = visibleStateOf(node, trueNode);
    const edr = node.edr || Boolean(trueNode.revealed);
    const observed = edr || visibleState === 'patched' || visibleState === 'encrypted';
    const presentation: NodePresentationState = {
      id: node.id,
      visibleState,
      observed,
      isolated: Boolean(trueNode.isolated),
      isolationAge: trueNode.isolationAge ?? 0,
      edr,
    };

    if (visibleState === 'infected' && observed) {
      presentation.turnsToEncryption = Math.max(
        0,
        config.encryptAfterTurns - trueNode.infectedTurns,
      );
    }

    nodes[node.id] = presentation;
  }

  return { nodes };
}

/**
 * Projects one resolution into information the player was entitled to see.
 * Routes are localised only when both endpoints were observed before the
 * resolution began. Every other attempt contributes to one anonymous gap.
 */
export function projectTurnEvents(
  events: readonly TurnEvent[],
  beforeState: GameState,
  afterState: GameState,
  topology: Topology,
): ObservableTurnEvent[] {
  const before = toPresentationView(beforeState, topology);
  const after = toPresentationView(afterState, topology);
  const projected: ObservableTurnEvent[] = [];
  let gap: Extract<ObservableTurnEvent, { kind: 'telemetry-gap' }> | null = null;

  for (const event of events) {
    switch (event.kind) {
      case 'spread-attempt': {
        const sourceObserved = before.nodes[event.source]?.observed === true;
        const targetObserved = before.nodes[event.target]?.observed === true;
        if (sourceObserved && targetObserved) {
          projected.push({
            kind: 'attempt',
            source: event.source,
            target: event.target,
            success: event.success,
          });
        } else if (gap === null) {
          gap = { kind: 'telemetry-gap', attempts: 1 };
          projected.push(gap);
        } else {
          gap.attempts += 1;
        }
        break;
      }
      case 'infected':
        if (after.nodes[event.node]?.visibleState === 'infected') {
          projected.push({ kind: 'infected', node: event.node });
        }
        break;
      case 'encrypted':
        projected.push({ kind: 'encrypted', node: event.node });
        break;
      case 'override':
        projected.push({ kind: 'override', node: event.node });
        break;
      case 'action':
        projected.push({ ...event });
        break;
      case 'containment-declaration':
        projected.push({ ...event });
        break;
      case 'recovery-hour':
        projected.push({ kind: 'recovery-hour' });
        break;
      case 'review-filed':
        projected.push({ kind: 'review-filed' });
        break;
      case 'patient-zero':
        // Initial access is PIR evidence, not live operational telemetry.
        break;
    }
  }

  return projected;
}
