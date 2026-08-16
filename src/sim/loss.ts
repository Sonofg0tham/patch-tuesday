import type { Topology } from '../data/topology';
import type { SimConfig } from './config';
import type { GameState } from './types';

export type LossReason = NonNullable<GameState['lossReason']>;

export function getLossReason(
  state: GameState,
  topology: Topology,
  config: SimConfig,
): LossReason | null {
  const domainControllerEncrypted = topology.nodes.some(
    (node) =>
      node.type === 'domain-controller' && state.nodes[node.id]?.state === 'encrypted',
  );
  if (domainControllerEncrypted) return 'domain-controller';

  const nodeStates = Object.values(state.nodes);
  const encrypted = nodeStates.filter((node) => node.state === 'encrypted').length;
  const blastRadius = nodeStates.length === 0 ? 0 : encrypted / nodeStates.length;
  return blastRadius >= config.lossBlastRadius ? 'blast-radius' : null;
}
