// Phase 4 verification: proves all four PIR ratings are reachable in real play
// across procedural seeds, and prints a full sample review as text so the voice
// can be read before loading the preview. Also hunts for the redefinition case:
// a NEAR MISS on a board that opened with a node already encrypted from the
// dwell (judged on the response, not the inherited dwell). Run: npm run pir

import { generateTopology } from '../src/data/topology-gen';
import { SIM_CONFIG } from '../src/sim/config';
import { greedyBot, randomBot, runBotRecorded, type Bot } from '../src/sim/bots';
import { buildPir, type Pir, type Rating, type RunRecord } from '../src/sim/pir';
import { encryptedCount } from '../src/sim/worm';

const BOTS: [string, Bot][] = [
  ['greedy', greedyBot],
  ['random', randomBot],
];

interface Hit {
  seed: string;
  botName: string;
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
      if (event.ok) lines.push(`  ${t}  action ${event.action}${event.node ? ' ' + event.node : ''}`);
    } else if (event.kind === 'infected') {
      lines.push(`  ${t}  infected ${event.node}`);
    } else if (event.kind === 'encrypted') {
      lines.push(`  ${t}  ENCRYPTED ${event.node}`);
    } else if (event.kind === 'override') {
      lines.push(`  ${t}  OVERRIDE ${event.node}`);
    }
  }
  return lines.join('\n');
}

function format(hit: Hit): string {
  const { pir } = hit;
  const lines: string[] = [];
  lines.push('='.repeat(66));
  lines.push('POST-INCIDENT REVIEW');
  lines.push(`${pir.scenarioName}    seed ${pir.seed}    [ played by ${hit.botName} bot ]`);
  lines.push(`RATING: ${pir.rating}`);
  lines.push('-'.repeat(66));
  for (const m of pir.metrics) lines.push(`  ${(m.label + ':').padEnd(28)} ${m.value}`);
  lines.push('-'.repeat(66));
  lines.push('FINDINGS');
  for (const f of pir.findings) lines.push(`  [${f.severity.toUpperCase().padEnd(8)}] T+${String(f.turn).padStart(2, '0')}h  ${f.text}`);
  lines.push('='.repeat(66));
  return lines.join('\n');
}

const found = new Map<Rating, Hit>();
let inheritedNearMiss: Hit | null = null;
const SCAN = 6000;

for (let i = 0; i < SCAN; i += 1) {
  const seed = `demo-${i}`;
  const topology = generateTopology(seed);
  for (const [botName, bot] of BOTS) {
    const record = runBotRecorded(topology, seed, bot, SIM_CONFIG);
    const pir = buildPir(record, topology, SIM_CONFIG);
    const inheritedEncrypted = encryptedCount(record.initial);
    const hit: Hit = { seed, botName, pir, record, inheritedEncrypted };
    if (!found.has(pir.rating)) found.set(pir.rating, hit);
    if (!inheritedNearMiss && pir.rating === 'NEAR MISS' && inheritedEncrypted > 0) {
      inheritedNearMiss = hit;
    }
  }
  if (found.size === 4 && inheritedNearMiss) break;
}

const order: Rating[] = ['NEAR MISS', 'CONTAINED', 'REPORTABLE INCIDENT', 'TOTAL LOSS'];
console.log(`\nRatings reached scanning procedural seeds (greedy + random bots):\n`);
for (const r of order) {
  const hit = found.get(r);
  console.log(`  ${r.padEnd(20)} ${hit ? `seed ${hit.seed} (${hit.botName})` : 'NOT REACHED'}`);
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
