// Runs the two bots over many seeded games and reports win rates and average
// outcomes, against the 7.8-turn undefended baseline. Run with: npm run bots
//
// This tells us whether the current action economy gives a naive defender a
// fighting chance. Instrument, don't tune: a bot that wins never or always is a
// flag for the worksheet, not an excuse to change numbers on the spot.

import { loadTopology } from '../src/data/topology';
import { SIM_CONFIG } from '../src/sim/config';
import { greedyBot, randomBot, runBot, type Bot, type BotOutcome } from '../src/sim/bots';

const RUNS = Number(process.argv[2] ?? 5000);
const topology = loadTopology();

interface Summary {
  wins: number;
  losses: number;
  unfinished: number;
  avgTurns: number;
  avgBlast: number;
  avgScore: number;
  avgBackups: number;
  emergencyRate: number;
}

function summarise(bot: Bot): Summary {
  const outcomes: BotOutcome[] = [];
  for (let i = 0; i < RUNS; i += 1) outcomes.push(runBot(topology, `bot-${i}`, bot));
  const wins = outcomes.filter((o) => o.status === 'won').length;
  const losses = outcomes.filter((o) => o.status === 'lost').length;
  const mean = (pick: (o: BotOutcome) => number): number =>
    outcomes.reduce((sum, o) => sum + pick(o), 0) / outcomes.length;
  return {
    wins,
    losses,
    unfinished: outcomes.length - wins - losses,
    avgTurns: mean((o) => o.turns),
    avgBlast: mean((o) => o.blastRadius),
    avgScore: mean((o) => o.score),
    avgBackups: mean((o) => o.backupsUsed),
    emergencyRate: outcomes.filter((o) => o.emergencyUsed).length / outcomes.length,
  };
}

function report(name: string, s: Summary): void {
  const pct = (n: number): string => `${Math.round((n / RUNS) * 100)}%`;
  console.log(`\n${name}`);
  console.log(`  Win rate            ${pct(s.wins)} (${s.wins}/${RUNS})`);
  console.log(`  Loss rate           ${pct(s.losses)}`);
  console.log(`  Avg turns to finish ${s.avgTurns.toFixed(1)}`);
  console.log(`  Avg blast radius     ${(s.avgBlast * 100).toFixed(0)}%`);
  console.log(`  Avg score (penalty)  ${s.avgScore.toFixed(0)}`);
  console.log(`  Avg backups used     ${s.avgBackups.toFixed(2)} of ${SIM_CONFIG.backupCredits}`);
  console.log(`  Emergency used       ${(s.emergencyRate * 100).toFixed(0)}% of runs`);
}

console.log(`Bot results over ${RUNS} games of "${topology.name}"`);
console.log(`Baseline: undefended board is lost in ~7.8 turns (86% reach 60% encryption).`);
report('Random-legal bot', summarise(randomBot));
report('Greedy heuristic bot', summarise(greedyBot));
console.log('');
