// PIR verification: earns NEAR MISS through a legal public-action response,
// catalogues the other ratings reached by the locked reference bots, and prints
// sample reviews so every finding can be traced to the raw event log. The
// command fails if any rating is absent. Run: npm run pir

import { generateTopology } from '../src/data/topology-gen';
import { SIM_CONFIG } from '../src/sim/config';
import { greedyBot, randomBot, runBotRecorded, type Bot } from '../src/sim/bots';
import {
  applyPlayerAction,
  declareContainment,
  endTurn,
  fileReview,
} from '../src/sim/game';
import { buildPir, RunRecorder, type Pir, type Rating, type RunRecord } from '../src/sim/pir';
import type { PlayerAction } from '../src/sim/types';
import { createInitialState, encryptedCount, infectedCount } from '../src/sim/worm';

const BOTS: [string, Bot][] = [
  ['greedy', greedyBot],
  ['random', randomBot],
];

interface Hit {
  seed: string;
  actor: string;
  pir: Pir;
  record: RunRecord;
  inheritedEncrypted: number;
}

// Renders the raw event log so it can be read next to the findings: every
// finding must trace back to an event here (verification that the PIR is
// generated from the run, not narrated freely).
function formatLog(record: RunRecord): string {
  const lines = ['RAW EVENT LOG (the source the findings are built from):'];
  for (const { turn, event } of record.log) {
    const t = `T+${String(turn).padStart(2, '0')}h`;
    if (event.kind === 'spread-attempt') {
      if (event.success) lines.push(`  ${t}  spread ${event.source} -> ${event.target} (hit)`);
    } else if (event.kind === 'action') {
      if (event.outcome !== 'blocked') lines.push(`  ${t}  action ${event.action}${event.node ? ' ' + event.node : ''}`);
    } else if (event.kind === 'infected') {
      lines.push(`  ${t}  infected ${event.node}`);
    } else if (event.kind === 'encrypted') {
      lines.push(`  ${t}  ENCRYPTED ${event.node}`);
    } else if (event.kind === 'override') {
      lines.push(`  ${t}  OVERRIDE ${event.node}`);
    } else if (event.kind === 'containment-declaration') {
      lines.push(`  ${t}  containment declaration ${event.confirmed ? 'CONFIRMED' : 'FAILED'}`);
    } else if (event.kind === 'recovery-hour') {
      lines.push(`  ${t}  recovery hour advanced`);
    } else if (event.kind === 'review-filed') {
      lines.push(`  ${t}  REVIEW FILED`);
    }
  }
  return lines.join('\n');
}

function format(hit: Hit): string {
  const { pir } = hit;
  const lines: string[] = [];
  lines.push('='.repeat(66));
  lines.push('POST-INCIDENT REVIEW');
  lines.push(`${pir.scenarioName}    seed ${pir.seed}    [ ${hit.actor} ]`);
  lines.push(`RATING: ${pir.rating}`);
  lines.push('-'.repeat(66));
  for (const m of pir.metrics) lines.push(`  ${(m.label + ':').padEnd(28)} ${m.value}`);
  lines.push('-'.repeat(66));
  lines.push('FINDINGS');
  for (const f of pir.findings) lines.push(`  [${f.severity.toUpperCase().padEnd(8)}] T+${String(f.turn).padStart(2, '0')}h  ${f.text}`);
  lines.push('='.repeat(66));
  return lines.join('\n');
}

function playLegalNearMiss(): Hit {
  const seed = 'legal-near-miss';
  const topology = generateTopology(seed);
  if (topology.nodes.length !== 24) {
    throw new Error(`NEAR MISS drill expected a 24-node estate, received ${topology.nodes.length}`);
  }
  if (topology.nodes.filter((node) => node.type === 'domain-controller').length !== 1) {
    throw new Error('NEAR MISS drill expected one domain controller');
  }
  const initial = createInitialState(topology, seed, SIM_CONFIG);
  if (infectedCount(initial) !== 3) {
    throw new Error(`NEAR MISS drill expected three infections, received ${infectedCount(initial)}`);
  }
  const patientZero = initial.patientZero;
  if (!patientZero) throw new Error('NEAR MISS drill did not select patient zero');
  const infectedIds = topology.nodes
    .filter((node) => initial.nodes[node.id].state === 'infected')
    .map((node) => node.id);
  const isolatedIds = infectedIds
    .filter((id) => id !== patientZero)
    .sort((a, b) => a.localeCompare(b));
  if (!infectedIds.includes(patientZero) || isolatedIds.length !== 2) {
    throw new Error('NEAR MISS drill did not open with patient zero and two later infections');
  }

  const recorder = new RunRecorder();
  let state = initial;
  const act = (action: PlayerAction): void => {
    const turn = state.turn;
    const result = applyPlayerAction(state, action, topology, SIM_CONFIG);
    if (!result.ok) throw new Error(`NEAR MISS drill action ${action.kind} was blocked: ${result.reason}`);
    recorder.record(turn, result.events);
    state = result.state;
  };
  const advance = (): void => {
    const turn = state.turn;
    const result = endTurn(state, topology, SIM_CONFIG);
    recorder.record(turn, result.events);
    state = result.nextState;
    recorder.tickDowntime(state);
  };

  act({ kind: 'emergency' });
  act({ kind: 'restore', node: patientZero });
  for (const id of isolatedIds) act({ kind: 'isolate', node: id });
  advance();
  act({ kind: 'restore', node: isolatedIds[0] });
  advance();
  act({ kind: 'restore', node: isolatedIds[1] });

  const declarationTurn = state.turn;
  const declaration = declareContainment(state, topology, SIM_CONFIG);
  if (
    declaration.events.length !== 1 ||
    declaration.events[0].kind !== 'containment-declaration' ||
    !declaration.events[0].confirmed
  ) {
    throw new Error('NEAR MISS drill containment declaration was not confirmed');
  }
  recorder.record(declarationTurn, declaration.events);
  state = declaration.nextState;
  for (const id of isolatedIds) act({ kind: 'reconnect', node: id });

  const filingTurn = state.turn;
  const filing = fileReview(state);
  recorder.record(filingTurn, filing.events);
  state = filing.nextState;

  const record: RunRecord = {
    scenarioName: topology.name,
    seed,
    initial,
    final: state,
    log: recorder.log,
    downtimeHours: recorder.downtimeHours,
  };
  const pir = buildPir(record, topology, SIM_CONFIG);
  if (state.status !== 'won' || pir.rating !== 'NEAR MISS') {
    throw new Error(`NEAR MISS drill finished ${state.status} with rating ${pir.rating}`);
  }
  if (record.log.some(({ event }) => event.kind === 'encrypted')) {
    throw new Error('NEAR MISS drill allowed post-detection encryption');
  }
  if (topology.nodes.some((node) => state.nodes[node.id].isolated === true)) {
    throw new Error('NEAR MISS drill filed with an isolated node');
  }

  return {
    seed,
    actor: 'legal public-action response',
    pir,
    record,
    inheritedEncrypted: encryptedCount(initial),
  };
}

const legalNearMiss = playLegalNearMiss();
const found = new Map<Rating, Hit>([['NEAR MISS', legalNearMiss]]);
let inheritedNearMiss: Hit | null = null;
let recoveryFinding: Hit | null = null;
const SCAN = 6000;

for (let i = 0; i < SCAN; i += 1) {
  const seed = `demo-${i}`;
  const topology = generateTopology(seed);
  for (const [botName, bot] of BOTS) {
    const record = runBotRecorded(topology, seed, bot, SIM_CONFIG);
    const pir = buildPir(record, topology, SIM_CONFIG);
    const inheritedEncrypted = encryptedCount(record.initial);
    const hit: Hit = { seed, actor: `${botName} bot`, pir, record, inheritedEncrypted };
    if (!found.has(pir.rating)) found.set(pir.rating, hit);
    if (!inheritedNearMiss && pir.rating === 'NEAR MISS' && inheritedEncrypted > 0) {
      inheritedNearMiss = hit;
    }
    if (
      !recoveryFinding &&
      pir.findings.some((finding) =>
        finding.text.includes('remained isolated when the review was filed'),
      )
    ) {
      recoveryFinding = hit;
    }
  }
  if (found.size === 4 && recoveryFinding) break;
}

const order: Rating[] = ['NEAR MISS', 'CONTAINED', 'REPORTABLE INCIDENT', 'TOTAL LOSS'];
console.log(`\nRatings reached through legal simulation and procedural bot samples:\n`);
for (const r of order) {
  const hit = found.get(r);
  console.log(`  ${r.padEnd(20)} ${hit ? `seed ${hit.seed} (${hit.actor})` : 'NOT REACHED'}`);
}

const missingRatings = order.filter((rating) => !found.has(rating));
if (missingRatings.length > 0) {
  console.error(`\nMissing PIR ratings: ${missingRatings.join(', ')}`);
  process.exitCode = 1;
}

console.log(`\n--- SAMPLE REVIEWS ---`);
for (const r of order) {
  const hit = found.get(r);
  if (hit) console.log('\n' + format(hit));
}

console.log(`\n--- FINDINGS-MATCH-LOG CHECK (REPORTABLE example) ---`);
const traceable = found.get('REPORTABLE INCIDENT');
if (traceable) {
  console.log(`\n${formatLog(traceable.record)}`);
  console.log(`\nThe review built from that log:\n\n${format(traceable)}`);
}

console.log(`\n--- NEAR MISS REDEFINITION CHECK ---`);
if (inheritedNearMiss) {
  console.log(`A NEAR MISS on a board that opened with ${inheritedNearMiss.inheritedEncrypted} node(s) already encrypted from the dwell:`);
  console.log('\n' + format(inheritedNearMiss));
} else {
  console.log('No NEAR MISS with inherited encryption found in the scan.');
}

console.log(`\n--- RECOVERY FINDING CHECK ---`);
if (recoveryFinding) {
  console.log('A filed review with a critical service still isolated:');
  console.log('\n' + format(recoveryFinding));
} else {
  console.log('No critical-service recovery finding found in the scan.');
  process.exitCode = 1;
}
