// Pure, fog-safe situation guidance. This module accepts only the presentation
// projection, public incident context and topology metadata. It has no access
// to true infection state or secret events.

import type { NodeType, Topology } from '../data/topology';
import { SIM_CONFIG, type SimConfig } from '../sim/config';
import type {
  NodePresentationState,
  PresentationView,
} from '../sim/telemetry';
import type { ActionKind, IncidentPhase, VisibleState } from '../sim/types';
import { ACTION_CATALOGUE, type ActionDef } from './actions';

export const OBJECTIVES = {
  preventEncryption: 'Prevent known encryption',
  relievePressure: 'Relieve business pressure',
  breakRoute: 'Break a known propagation route',
  eradicateVisible: 'Eradicate observed compromise',
  verifyBlindSpots: 'Verify containment across blind spots',
  declareContainment: 'Declare containment',
  recoverCritical: 'Recover isolated critical services',
  restoreLoss: 'Restore encrypted assets',
  fileReview: 'File the Post-Incident Review',
} as const;

export interface SituationContext {
  phase: IncidentPhase;
  pressure: number;
  backupCredits: number;
}

export interface ActionConsequence {
  action: ActionKind;
  label: string;
  apCost: number;
  cutLinks?: number;
  restoredLinks?: number;
  pressurePerHour?: number;
  impactPerHour?: number;
  backupCost?: number;
  apGain?: number;
}

export interface ActionConsequencesModel {
  statusText: string;
  knownEncryptionInHours?: number;
  actions: readonly ActionConsequence[];
}

export type CoverageKind = 'built-in' | 'sensor' | 'none';

export interface NodeInspectionModel {
  id: string;
  label: string;
  type: NodeType;
  role: string;
  visibleState: VisibleState;
  observed: boolean;
  isolated: boolean;
  isolationAge: number;
  coverage: CoverageKind;
  connectionLabels: readonly string[];
  consequences: ActionConsequencesModel;
}

export function deriveObjective(
  view: PresentationView,
  topology: Topology,
  context: SituationContext,
  config: SimConfig = SIM_CONFIG,
): string {
  if (context.phase === 'recovery') {
    const criticalIsolated = topology.nodes.some(
      (node) => isCritical(node.type) && view.nodes[node.id]?.isolated,
    );
    if (criticalIsolated) return OBJECTIVES.recoverCritical;

    const backupNodes = topology.nodes.filter((node) => node.type === 'backup');
    const backupSurvives = backupNodes.some(
      (node) => view.nodes[node.id]?.visibleState !== 'encrypted',
    );
    const restorableLoss = Object.values(view.nodes).some(
      (node) => node.visibleState === 'encrypted',
    );
    if (restorableLoss && backupSurvives && context.backupCredits > 0) {
      return OBJECTIVES.restoreLoss;
    }
    return OBJECTIVES.fileReview;
  }

  const visibleInfected = Object.values(view.nodes).filter(
    (node) => node.visibleState === 'infected',
  );
  if (visibleInfected.some((node) => (node.turnsToEncryption ?? Number.POSITIVE_INFINITY) <= 1)) {
    return OBJECTIVES.preventEncryption;
  }

  if (context.pressure >= config.pressureMax * 0.8) return OBJECTIVES.relievePressure;

  if (hasVisibleRoute(view, topology)) return OBJECTIVES.breakRoute;
  if (visibleInfected.length > 0) return OBJECTIVES.eradicateVisible;

  if (Object.values(view.nodes).some((node) => !node.observed)) {
    return OBJECTIVES.verifyBlindSpots;
  }
  return OBJECTIVES.declareContainment;
}

/**
 * Describes operational consequences from public data only. A hidden infected
 * asset and a genuinely clean uncovered asset therefore produce byte-for-byte
 * identical guidance.
 */
export function deriveActionConsequences(
  nodeId: string,
  view: PresentationView,
  topology: Topology,
  catalogue: readonly ActionDef[] = ACTION_CATALOGUE,
  config: SimConfig = SIM_CONFIG,
): ActionConsequencesModel {
  const node = topology.byId.get(nodeId);
  const presentation = view.nodes[nodeId];
  if (!node || !presentation) {
    return { statusText: 'Status unavailable.', actions: [] };
  }

  const liveLinks = presentation.isolated
    ? 0
    : node.neighbours.filter((id) => !view.nodes[id]?.isolated).length;
  const reconnectLinks = presentation.isolated
    ? node.neighbours.filter((id) => !view.nodes[id]?.isolated).length
    : 0;
  const pressure = config.pressureWeight[node.type];
  const impact = config.nodeValue[node.type] * config.isolationDowntimePerTurn;
  const actions = catalogue.map((definition): ActionConsequence => {
    const base: ActionConsequence = {
      action: definition.kind,
      label: definition.label,
      apCost: actionCost(definition.kind, config),
    };

    switch (definition.kind) {
      case 'isolate':
        return {
          ...base,
          cutLinks: liveLinks,
          pressurePerHour: pressure,
          impactPerHour: impact,
        };
      case 'reconnect':
        return {
          ...base,
          restoredLinks: reconnectLinks,
          pressurePerHour: -pressure,
          impactPerHour: -impact,
        };
      case 'restore':
        return { ...base, backupCost: 1 };
      case 'emergency':
        return { ...base, apGain: config.emergencyApBonus };
      case 'scan':
      case 'patch':
        return base;
    }
  });

  const result: ActionConsequencesModel = {
    statusText: statusText(presentation),
    actions,
  };
  if (presentation.turnsToEncryption !== undefined) {
    result.knownEncryptionInHours = presentation.turnsToEncryption;
  }
  return result;
}

export function deriveNodeInspectionModel(
  nodeId: string | null,
  view: PresentationView,
  topology: Topology,
  catalogue: readonly ActionDef[] = ACTION_CATALOGUE,
  config: SimConfig = SIM_CONFIG,
): NodeInspectionModel | null {
  if (nodeId === null) return null;
  const node = topology.byId.get(nodeId);
  const presentation = view.nodes[nodeId];
  if (!node || !presentation) return null;

  return {
    id: node.id,
    label: node.label,
    type: node.type,
    role: node.role,
    visibleState: presentation.visibleState,
    observed: presentation.observed,
    isolated: presentation.isolated,
    isolationAge: presentation.isolationAge,
    coverage: node.edr ? 'built-in' : presentation.edr ? 'sensor' : 'none',
    connectionLabels: node.neighbours.map((id) => topology.byId.get(id)?.label ?? id),
    consequences: deriveActionConsequences(nodeId, view, topology, catalogue, config),
  };
}

function hasVisibleRoute(view: PresentationView, topology: Topology): boolean {
  return topology.nodes.some((source) => {
    const sourceState = view.nodes[source.id];
    if (sourceState?.visibleState !== 'infected' || sourceState.isolated) return false;
    return source.neighbours.some((targetId) => {
      const targetState = view.nodes[targetId];
      return targetState?.visibleState === 'clean' && !targetState.isolated;
    });
  });
}

function isCritical(type: NodeType): boolean {
  return type === 'router' || type === 'server' || type === 'backup' || type === 'domain-controller';
}

function actionCost(kind: ActionKind, config: SimConfig): number {
  return kind === 'emergency' ? 0 : config.actionCosts[kind];
}

function statusText(node: NodePresentationState): string {
  if (!node.observed) return 'Status uncertain. No sensor coverage.';
  switch (node.visibleState) {
    case 'clean':
      return 'Status: clean';
    case 'infected':
      return 'Status: INFECTED';
    case 'encrypted':
      return 'Status: ENCRYPTED';
    case 'patched':
      return 'Status: PATCHED (immune)';
  }
}
