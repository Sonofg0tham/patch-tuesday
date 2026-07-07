// Prints the spread difficulty baseline: over many seeded runs of the
// undefended board, how many turns until 60% of the estate is encrypted, and
// how often the worm fizzles out on its own. Run with: npm run stats
//
// This is the number Phase 3's action economy will push against.

import { loadTopology } from '../src/data/topology';
import { SIM_CONFIG } from '../src/sim/config';
import { runSpreadStats } from '../src/sim/stats';

const RUNS = Number(process.argv[2] ?? 20000);
const topology = loadTopology();
const result = runSpreadStats(topology, { runs: RUNS, threshold: SIM_CONFIG.lossBlastRadius, maxTurns: 500 });

const line = (label: string, value: string | number): void => {
  console.log(`${label.padEnd(26)} ${value}`);
};

console.log(`\nSpread stats over ${RUNS} undefended runs of "${topology.name}"`);
console.log(`Threshold: ${Math.round(SIM_CONFIG.lossBlastRadius * 100)}% of ${topology.nodes.length} nodes encrypted`);
console.log(`Config: spreadChance=${SIM_CONFIG.spreadChance}, encryptAfterTurns=${SIM_CONFIG.encryptAfterTurns}\n`);

line('Reached threshold', `${result.reached} (${Math.round((result.reached / RUNS) * 100)}%)`);
line('Fizzled (worm died out)', `${result.fizzled} (${Math.round(result.fizzleRate * 100)}%)`);
line('Turns to 60%: mean', result.mean.toFixed(1));
line('Turns to 60%: median', result.median);
line('Turns to 60%: p10 - p90', `${result.p10} - ${result.p90}`);
line('Turns to 60%: min - max', `${result.min} - ${result.max}`);

console.log('\nHistogram (turns : runs)');
const turns = Object.keys(result.histogram)
  .map(Number)
  .sort((a, b) => a - b);
const peak = Math.max(...turns.map((t) => result.histogram[t]));
for (const t of turns) {
  const count = result.histogram[t];
  const bar = '#'.repeat(Math.max(1, Math.round((count / peak) * 40)));
  console.log(`${String(t).padStart(3)} : ${String(count).padStart(5)}  ${bar}`);
}
console.log('');
