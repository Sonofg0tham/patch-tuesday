// Sweeps dwell time (the pre-player foothold) and reports how difficulty moves
// with structure alone, no other numbers touched. For each N it runs the
// undefended baseline plus both bots. Run with: npm run dwell [runs]
//
// N=0 is the Phase 3 reference (a lone patient zero). The shipped default is 2.

import { loadTopology } from '../src/data/topology';
import { SIM_CONFIG, type SimConfig } from '../src/sim/config';
import { runSpreadStats } from '../src/sim/stats';
import { greedyBot, randomBot, runBot, type Bot, type BotOutcome } from '../src/sim/bots';

const RUNS = Number(process.argv[2] ?? 4000);
const DWELLS = [0, 1, 2, 3];
const topology = loadTopology();

function withDwell(n: number): SimConfig {
  return { ...SIM_CONFIG, dwellTurns: n };
}

function botWinRate(bot: Bot, config: SimConfig): { winPct: number; avgTurns: number; avgBlast: number } {
  const outcomes: BotOutcome[] = [];
  for (let i = 0; i < RUNS; i += 1) outcomes.push(runBot(topology, `bot-${i}`, bot, config));
  const wins = outcomes.filter((o) => o.status === 'won').length;
  const mean = (pick: (o: BotOutcome) => number): number =>
    outcomes.reduce((sum, o) => sum + pick(o), 0) / outcomes.length;
  return {
    winPct: (wins / RUNS) * 100,
    avgTurns: mean((o) => o.turns),
    avgBlast: mean((o) => o.blastRadius) * 100,
  };
}

const pad = (s: string | number, w: number): string => String(s).padStart(w);

console.log(`\nDwell-time sweep over ${RUNS} games each, on "${topology.name}".`);
console.log('Nothing tuned but dwellTurns. N=0 is the Phase 3 reference (lone patient zero).\n');

console.log(
  `${pad('N', 2)} | ${pad('undef reach60%', 14)} ${pad('undef turns', 11)} ${pad('undef fizzle%', 13)} |` +
    ` ${pad('random win%', 11)} ${pad('r.turns', 7)} | ${pad('greedy win%', 11)} ${pad('g.turns', 7)} ${pad('g.blast%', 8)}`,
);
console.log('-'.repeat(120));

for (const n of DWELLS) {
  const config = withDwell(n);
  const undef = runSpreadStats(topology, {
    runs: RUNS,
    threshold: SIM_CONFIG.lossBlastRadius,
    maxTurns: 500,
    config,
  });
  const random = botWinRate(randomBot, config);
  const greedy = botWinRate(greedyBot, config);

  console.log(
    `${pad(n, 2)} | ${pad(`${Math.round((undef.reached / RUNS) * 100)}%`, 14)} ${pad(undef.mean.toFixed(1), 11)} ${pad(`${Math.round(undef.fizzleRate * 100)}%`, 13)} |` +
      ` ${pad(`${random.winPct.toFixed(0)}%`, 11)} ${pad(random.avgTurns.toFixed(1), 7)} |` +
      ` ${pad(`${greedy.winPct.toFixed(0)}%`, 11)} ${pad(greedy.avgTurns.toFixed(1), 7)} ${pad(`${greedy.avgBlast.toFixed(0)}%`, 8)}`,
  );
}

console.log('\nundef turns = mean player-turns from T+01h to 60% encryption, among runs that reach it.\n');
