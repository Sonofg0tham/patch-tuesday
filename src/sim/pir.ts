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

// NEAR MISS is redefined for Phase 4: dwell means nodes can arrive encrypted at
// detection, so "nothing encrypted ever" is unreachable on some seeds. You are
// judged on the response, not the inherited dwell, so NEAR MISS is "no
// additional encryption after detection".
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

// Rating thresholds are the review's own definition (not economy tuning): NEAR
// MISS = no encryption after detection, CONTAINED < 25% blast, REPORTABLE
// 25-60%, TOTAL LOSS on defeat.
export function ratingOf(record: RunRecord): Rating {
  if (record.final.status === 'lost') return 'TOTAL LOSS';
  // Encryption events only fire during play turns (dwell events are not logged),
  // so any 'encrypted' event is encryption the player let happen after detection.
  const additional = record.log.some((e) => e.event.kind === 'encrypted');
  if (!additional) return 'NEAR MISS';
  return blastRadius(record.final) < 0.25 ? 'CONTAINED' : 'REPORTABLE INCIDENT';
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

  const rating = ratingOf(record);
  const won = final.status === 'won';
  const total = topology.nodes.length;
  const dwell = config.dwellTurns;

  // --- Metrics ---
  const overrides = record.log.filter((e) => e.event.kind === 'override');
  const emergency = record.log.find(
    (e) => e.event.kind === 'action' && e.event.action === 'emergency' && e.event.ok,
  );
  const metrics: PirMetric[] = [
    { label: 'Time to detect', value: `${TPLUS(1)} (initial access preceded detection by ${dwell} hours)` },
    {
      label: 'Time to contain',
      value: won ? TPLUS(final.turn) : `not contained (incident lost at ${TPLUS(final.turn)})`,
    },
    {
      label: 'Blast radius',
      value: `${Math.round(blastRadius(final) * 100)}% (${encryptedCount(final)}/${total} encrypted)`,
    },
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

  // EDR coverage gaps: an uncovered node that spread the worm before it was ever
  // seen. Grouped by source, dated at its first successful spread.
  const gapSpreads = new Map<string, { turn: number; count: number }>();
  for (const { turn, event } of record.log) {
    if (event.kind !== 'spread-attempt' || !event.success) continue;
    const src = topology.byId.get(event.source);
    if (!src) continue;
    const uncovered = !src.edr && final.nodes[event.source]?.revealed !== true;
    if (!uncovered) continue;
    const seen = gapSpreads.get(event.source);
    if (seen) seen.count += 1;
    else gapSpreads.set(event.source, { turn, count: 1 });
  }
  for (const [id, { turn, count }] of gapSpreads) {
    findings.push({
      turn,
      severity: 'High',
      text: `EDR coverage gap on ${label(id)} (${role(id)}) allowed undetected lateral movement: ${count} host${count === 1 ? '' : 's'} infected from it before it was seen.`,
    });
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

  return { scenarioName: record.scenarioName, seed: record.seed, rating, won, metrics, findings };
}
