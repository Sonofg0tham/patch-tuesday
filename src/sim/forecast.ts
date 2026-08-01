// The threat forecast (Phase 7): which nodes the worm could reach next turn.
//
// This is a readability aid, not new information. Everything it marks is
// already on screen: an infected node you can see, a cable you can see, and a
// neighbour you can see. On a 24-node 3D board, tracing that by eye every turn
// is a perception chore, and the interesting decision ("which of these do I
// protect, and with what") was getting buried under it. This surfaces the same
// conclusion so the player spends their thinking on the trade-off instead.
//
// The critical rule: it reads the VISIBLE view, never the true state. An
// infection sitting on a node with no EDR coverage is invisible, so its
// neighbours are not marked, and the player gets no warning at all. That is not
// a limitation to work around, it is the point. The holes in this forecast are
// exactly the holes in your sensor coverage, which is design pillar 2 made
// literal: the scariest node on the board is still the one showing green
// because nothing is watching it.

import type { Topology } from '../data/topology';
import type { GameState, VisibleState } from './types';

export interface ForecastEdge {
  /** The visibly infected node the threat would come from. */
  source: string;
  /** The apparently clean node it could reach. */
  target: string;
}

export interface Forecast {
  /** Nodes that could be infected next turn, from what the player can see. */
  atRisk: string[];
  /** The routes it would take, for drawing direction on the cables. */
  edges: ForecastEdge[];
}

/**
 * Mirrors the spread rules in stepTurn() exactly, but from the visible view:
 * a visibly infected node spreads along a live cable to an apparently clean
 * neighbour. Encrypted nodes are excluded because an encrypted node has stopped
 * spreading, and patched ones because they cannot be infected.
 *
 * A node that merely looks clean but is secretly already infected will be
 * marked at risk. That over-report is harmless (the player cannot tell either
 * way, and protecting it is not a wasted instinct) and keeping it is what stops
 * the forecast leaking the fog.
 */
export function forecastSpread(
  view: Record<string, VisibleState>,
  state: GameState,
  topology: Topology,
): Forecast {
  const edges: ForecastEdge[] = [];
  const atRisk = new Set<string>();

  for (const node of topology.nodes) {
    if (view[node.id] !== 'infected') continue;
    // An isolated node's cables are cut, in both directions.
    if (state.nodes[node.id]?.isolated) continue;

    for (const neighbourId of node.neighbours) {
      if (state.nodes[neighbourId]?.isolated) continue;
      if (view[neighbourId] !== 'clean') continue;
      edges.push({ source: node.id, target: neighbourId });
      atRisk.add(neighbourId);
    }
  }

  return { atRisk: [...atRisk].sort((a, b) => a.localeCompare(b)), edges };
}
