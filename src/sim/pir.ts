// The Post-Incident Review (Phase 4), as pure logic. A run is recorded as an
// ordered event log; this module turns that log plus the final state into a
// one-page review: metrics, a rating, and findings drawn from what actually
// happened, each with a node name and a T+ timestamp. No DOM here; ui/pir.ts
// renders the object this produces.
//
// The tone is dry and procedural. The humour is in what it states flatly:
// "containment overridden by business pressure" is delivered as neutrally as a
// timestamp.

import type { NodeType, Topology } from '../data/topology';
import { SIM_CONFIG, type SimConfig } from './config';
import type { GameState, TurnEvent } from './types';
import { blastRadius, encryptedCount } from './worm';

// NEAR MISS is judged on the response, not encryption inherited from the
// opening dwell. Phase 8 also requires a sound containment declaration and
// completed recovery of critical services.
export type Rating = 'NEAR MISS' | 'CONTAINED' | 'REPORTABLE INCIDENT' | 'TOTAL LOSS';
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';

// Best-to-worst, so storage can keep the best rating a scenario has earned.
export const RATING_RANK: Record<Rating, number> = {
  'NEAR MISS': 3,
  CONTAINED: 2,
  'REPORTABLE INCIDENT': 1,
  'TOTAL LOSS': 0,
};

export interface PirFinding {
  turn: number;
  severity: Severity;
  text: string;
}

export interface PirMetric {
  label: string;
  value: string;
}

export interface Pir {
  scenarioName: string;
  seed: string;
  rating: Rating;
  won: boolean;
  /** The player walked away mid-incident: shown as ABANDONED, not rated. */
  abandoned: boolean;
  metrics: PirMetric[];
  findings: PirFinding[];
}

// One logged event, tagged with the turn (the incident hour) it occurred in.
export interface LoggedEvent {
  turn: number;
  event: TurnEvent;
}

// Everything the review needs about a finished run, gathered by the driver
// (interactive play or a headless bot) so buildPir stays pure.
export interface RunRecord {
  scenarioName: string;
  seed: string;
  initial: GameState;
  final: GameState;
  log: LoggedEvent[];
  /** Node-hours of isolation downtime accrued over the run. */
  downtimeHours: number;
  /** The run was abandoned mid-incident from the pause menu. */
  abandoned?: boolean;
}

// Accumulates the event log and downtime as a run plays, so interactive and
// headless drivers produce byte-identical records (and therefore reviews).
export class RunRecorder {
  readonly log: LoggedEvent[] = [];
  downtimeHours = 0;

  // Records the events a turn produced, tagged with that turn's hour.
  record(turn: number, events: TurnEvent[]): void {
    for (const event of events) this.log.push({ turn, event });
  }

  // Adds one hour of downtime for each node isolated at the close of a turn.
  tickDowntime(state: GameState): void {
    for (const ns of Object.values(state.nodes)) if (ns.isolated) this.downtimeHours += 1;
  }
}

const TPLUS = (turn: number): string => `T+${String(turn).padStart(2, '0')}h`;

// Severity for a node encrypting, by what the node is worth to the estate.
function encryptionSeverity(type: NodeType): Severity {
  switch (type) {
    case 'domain-controller':
      return 'Critical';
    case 'backup':
    case 'server':
      return 'High';
    case 'router':
      return 'Medium';
    default:
      return 'Low';
  }
}

const SEVERITY_RANK: Record<Severity, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Info: 4,
};

interface CoverageGap {
  turn: number;
  count: number;
}

interface IncidentAnalysis {
  coverageGaps: Map<string, CoverageGap>;
  prematureDeclarations: LoggedEvent[];
  containmentConfirmed: LoggedEvent | undefined;
  reviewFiled: LoggedEvent | undefined;
  hasPostDetectionEncryption: boolean;
}

const CRITICAL_SERVICE_TYPES = new Set<NodeType>([
  'router',
  'server',
  'backup',
  'domain-controller',
]);

// Reconstructs what the responder knew at each event. Opening EDR coverage is
// known at detection. A deployed sensor or accepted patch probe expands that
// knowledge only after its own event is reached in the ordered log.
function analyseIncident(record: RunRecord, topology: Topology): IncidentAnalysis {
  const known = new Set(
    topology.nodes.filter((node) => node.edr).map((node) => node.id),
  );
  const coverageGaps = new Map<string, CoverageGap>();
  const prematureDeclarations: LoggedEvent[] = [];
  let containmentConfirmed: LoggedEvent | undefined;
  let reviewFiled: LoggedEvent | undefined;
  let hasPostDetectionEncryption = false;

  for (const logged of record.log) {
    const { turn, event } = logged;

    if (event.kind === 'spread-attempt' && event.success && !known.has(event.source)) {
      if (topology.byId.has(event.source)) {
        const gap = coverageGaps.get(event.source);
        if (gap) gap.count += 1;
        else coverageGaps.set(event.source, { turn, count: 1 });
      }
      continue;
    }

    if (event.kind === 'action' && event.node) {
      const sensorApplied = event.action === 'scan' && event.outcome === 'applied';
      const patchProbeAccepted = event.action === 'patch' && event.outcome === 'probe';
      if (sensorApplied || patchProbeAccepted) known.add(event.node);
      continue;
    }

    if (event.kind === 'encrypted') {
      hasPostDetectionEncryption = true;
      continue;
    }

    if (event.kind === 'containment-declaration') {
      if (event.confirmed) containmentConfirmed ??= logged;
      else prematureDeclarations.push(logged);
      continue;
    }

    if (event.kind === 'review-filed') reviewFiled ??= logged;
  }

  return {
    coverageGaps,
    prematureDeclarations,
    containmentConfirmed,
    reviewFiled,
    hasPostDetectionEncryption,
  };
}

function unrecoveredCriticalServices(record: RunRecord, topology: Topology): string[] {
  return topology.nodes
    .filter(
      (node) =>
        CRITICAL_SERVICE_TYPES.has(node.type) && record.final.nodes[node.id]?.isolated === true,
    )
    .map((node) => node.id);
}

function ratingFrom(
  record: RunRecord,
  topology: Topology,
  analysis: IncidentAnalysis,
): Rating {
  if (record.final.status === 'lost') return 'TOTAL LOSS';
  if (blastRadius(record.final) >= 0.25) return 'REPORTABLE INCIDENT';

  const hasPrematureDeclaration = analysis.prematureDeclarations.length > 0;
  const hasUnrecoveredCriticalService =
    analysis.reviewFiled !== undefined && unrecoveredCriticalServices(record, topology).length > 0;
  if (
    analysis.hasPostDetectionEncryption ||
    hasPrematureDeclaration ||
    hasUnrecoveredCriticalService
  ) {
    return 'CONTAINED';
  }
  return 'NEAR MISS';
}

// Rating thresholds are the review's own definition, not economy tuning.
export function ratingOf(record: RunRecord, topology: Topology): Rating {
  return ratingFrom(record, topology, analyseIncident(record, topology));
}

// Builds the whole review. Pure: same record in, same review out.
export function buildPir(
  record: RunRecord,
  topology: Topology,
  config: SimConfig = SIM_CONFIG,
): Pir {
  const { initial, final } = record;
  const label = (id: string): string => topology.byId.get(id)?.label ?? id;
  const role = (id: string): string => topology.byId.get(id)?.role ?? 'unknown asset';
  const typeOf = (id: string): NodeType => topology.byId.get(id)?.type ?? 'workstation';

  const analysis = analyseIncident(record, topology);
  const rating = ratingFrom(record, topology, analysis);
  const won = final.status === 'won';
  const abandoned = record.abandoned ?? false;
  const total = topology.nodes.length;
  const dwell = config.dwellTurns;

  // --- Metrics ---
  const overrides = record.log.filter((e) => e.event.kind === 'override');
  const emergency = record.log.find(
    (e) => e.event.kind === 'action' && e.event.action === 'emergency' && e.event.outcome !== 'blocked',
  );
  const containmentTurn = analysis.containmentConfirmed?.turn;
  const filingTurn = analysis.reviewFiled?.turn;
  const recoveryDuration =
    containmentTurn !== undefined && filingTurn !== undefined
      ? Math.max(0, filingTurn - containmentTurn)
      : undefined;
  const metrics: PirMetric[] = [
    { label: 'Time to detect', value: `${TPLUS(1)} (initial access preceded detection by ${dwell} hours)` },
    {
      label: 'Time to contain',
      value: abandoned
        ? `response abandoned at ${TPLUS(final.turn)}`
        : containmentTurn !== undefined
          ? TPLUS(containmentTurn)
          : final.status === 'lost'
            ? `not contained (incident lost at ${TPLUS(final.turn)})`
            : 'not recorded',
    },
    { label: 'Time to file', value: filingTurn === undefined ? 'not filed' : TPLUS(filingTurn) },
    {
      label: 'Recovery duration',
      value:
        recoveryDuration === undefined
          ? 'not applicable'
          : `${recoveryDuration} hour${recoveryDuration === 1 ? '' : 's'}`,
    },
    {
      label: 'Blast radius',
      value: `${Math.round(blastRadius(final) * 100)}% (${encryptedCount(final)}/${total} encrypted)`,
    },
    { label: 'Impact', value: String(final.score) },
    { label: 'Downtime', value: `${record.downtimeHours} host-hours isolated` },
    {
      label: 'Backup credits burned',
      value: `${config.backupCredits - final.backupCredits} of ${config.backupCredits}`,
    },
    {
      label: 'Business overrides',
      value:
        overrides.length === 0
          ? 'none'
          : `${overrides.length} (${overrides.map((e) => TPLUS(e.turn)).join(', ')})`,
    },
    {
      label: 'Emergency change control',
      value: emergency ? `BYPASSED at ${TPLUS(emergency.turn)}` : 'not invoked',
    },
  ];

  // --- Findings, from the recorded events and the opening/closing states ---
  const findings: PirFinding[] = [];

  // Initial access and the dwell the worm enjoyed, revealed here for the first time.
  if (initial.patientZero) {
    const z = initial.patientZero;
    findings.push({
      turn: 1,
      severity: 'Info',
      text: `Initial access via ${label(z)} (${role(z)}). The worm dwelled undetected for ${dwell} hours before EDR flagged the incident at ${TPLUS(1)}.`,
    });
  }

  // Nodes that arrived already encrypted, inherited from the dwell (not the
  // responder's doing, but they count against the blast radius).
  for (const node of topology.nodes) {
    if (initial.nodes[node.id]?.state === 'encrypted') {
      findings.push({
        turn: 1,
        severity: 'Info',
        text: `${node.label} (${node.role}) was already encrypted when the incident was detected; inherited from the dwell, not the response.`,
      });
    }
  }

  // EDR coverage gaps are reconstructed chronologically, so later coverage
  // cannot rewrite what was unknown when a spread succeeded.
  for (const [id, { turn, count }] of analysis.coverageGaps) {
    findings.push({
      turn,
      severity: 'High',
      text: `EDR coverage gap on ${label(id)} (${role(id)}) allowed undetected lateral movement: ${count} host${count === 1 ? '' : 's'} infected from it before it was seen.`,
    });
  }

  for (const declaration of analysis.prematureDeclarations) {
    findings.push({
      turn: declaration.turn,
      severity: 'High',
      text: 'Containment was declared prematurely while hidden infection remained. The response hour was committed without confirming eradication.',
    });
  }

  if (analysis.reviewFiled) {
    for (const id of unrecoveredCriticalServices(record, topology)) {
      const type = typeOf(id);
      findings.push({
        turn: analysis.reviewFiled.turn,
        severity: type === 'backup' || type === 'domain-controller' ? 'High' : 'Medium',
        text: `${label(id)} (${role(id)}) remained isolated when the review was filed; service recovery was incomplete.`,
      });
    }
  }

  // Encryption that happened on the responder's watch.
  for (const { turn, event } of record.log) {
    if (event.kind !== 'encrypted') continue;
    const type = typeOf(event.node);
    let text = `${label(event.node)} (${role(event.node)}) encrypted.`;
    if (type === 'domain-controller') {
      text = `${label(event.node)} (${role(event.node)}) encrypted. The domain controller is in the worm's hands; the incident is a total loss.`;
    } else if (type === 'backup') {
      text = `${label(event.node)} (${role(event.node)}) encrypted. Restore capability is lost for the remainder of the incident.`;
    }
    findings.push({ turn, severity: encryptionSeverity(type), text });
  }

  // Containment overridden by the business. Stated flatly.
  for (const { turn, event } of overrides) {
    if (event.kind !== 'override') continue;
    findings.push({
      turn,
      severity: 'Medium',
      text: `Containment on ${label(event.node)} (${role(event.node)}) overridden by business pressure; the node was reconnected before eradication was complete.`,
    });
  }

  // The emergency change, if it was pulled.
  if (emergency && emergency.event.kind === 'action') {
    findings.push({
      turn: emergency.turn,
      severity: 'Medium',
      text: `Emergency change control invoked: ${config.emergencyApBonus} additional action points granted outside the change process. Recorded for the audit.`,
    });
  }

  // Order by hour, then by severity within the hour.
  findings.sort((a, b) => a.turn - b.turn || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return { scenarioName: record.scenarioName, seed: record.seed, rating, won, abandoned, metrics, findings };
}
