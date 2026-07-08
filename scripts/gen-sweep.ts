// The Phase 4 balance gate. The locked economy was tuned on one hand-authored
// board; this sweep proves it survives procedural variety. For each seed it
// generates a fresh estate and runs the undefended baseline plus both bots on
// it, then reports the aggregate next to the hand-authored MERIDIAN numbers.
//
// The gate: greedy must hold 40-70% and random must stay above 15% on the
// procedural boards. If it fails, tighten the GENERATOR (config.extraEdges,
// coverage, ranges), never the economy. Run with: npm run gen [runs]

import { loadTopology, type Topology } from '../src/data/topology';
import { generateTopology } from '../src/data/topology-gen';
import { SIM_CONFIG, GEN_CONFIG } from '../src/sim/config';
import { runToThreshold } from '../src/sim/stats';
import { greedyBot, randomBot, runBot, type Bot } from '../src/sim/bots';

const RUNS = Number(process.argv[2] ?? 4000);

// Breadth-first reachability from the first node: a board is fully connected
// only if every node is reached.
function isConnected(t: Topology): boolean {
  const seen = new Set<string>([t.nodes[0].id]);
  const queue = [t.nodes[0].id];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const n of t.byId.get(id)?.neighbours ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === t.nodes.length;
}

function botWin(bot: Bot, topology: Topology, seed: string): { won: boolean; blast: number; turns: number } {
  const o = runBot(topology, seed, bot, SIM_CONFIG);
  return { won: o.status === 'won', blast: o.blastRadius, turns: o.turns };
}

interface Agg {
  undefReached: number;
  undefTurns: number[];
  randomWins: number;
  greedyWins: number;
  greedyBlast: number[];
  greedyTurns: number[];
  disconnected: number;
  badCount: number;
  extraEdges: number[];
  maxDegree: number[];
}

function sweep(label: string, boardFor: (i: number) => Topology): Agg {
  const a: Agg = {
    undefReached: 0, undefTurns: [], randomWins: 0, greedyWins: 0,
    greedyBlast: [], greedyTurns: [], disconnected: 0, badCount: 0,
    extraEdges: [], maxDegree: [],
  };
  for (let i = 0; i < RUNS; i += 1) {
    const topology = boardFor(i);
    if (!isConnected(topology)) a.disconnected += 1;
    if (topology.nodes.length !== GEN_CONFIG.nodeCount) a.badCount += 1;
    a.extraEdges.push(topology.cables.length - (topology.nodes.length - 1));
    a.maxDegree.push(Math.max(...topology.nodes.map((n) => n.neighbours.length)));

    const seed = `${label}-${i}`;
    const undef = runToThreshold(topology, seed, SIM_CONFIG.lossBlastRadius, 500, SIM_CONFIG);
    if (undef !== null) { a.undefReached += 1; a.undefTurns.push(undef); }
    if (botWin(randomBot, topology, seed).won) a.randomWins += 1;
    const g = botWin(greedyBot, topology, seed);
    if (g.won) a.greedyWins += 1;
    a.greedyBlast.push(g.blast);
    a.greedyTurns.push(g.turns);
  }
  return a;
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
const pct = (n: number): string => `${((n / RUNS) * 100).toFixed(0)}%`;

function report(label: string, a: Agg): void {
  console.log(
    `${label.padEnd(18)} | undef ${pct(a.undefReached).padStart(4)} @ ${mean(a.undefTurns).toFixed(1).padStart(4)}t` +
      ` | random ${pct(a.randomWins).padStart(4)}` +
      ` | greedy ${pct(a.greedyWins).padStart(4)} @ ${mean(a.greedyTurns).toFixed(1).padStart(4)}t blast ${(mean(a.greedyBlast) * 100).toFixed(0).padStart(3)}%`,
  );
  console.log(
    `${' '.repeat(18)} | structure: extra edges ${mean(a.extraEdges).toFixed(1)} (max degree ${mean(a.maxDegree).toFixed(1)})` +
      ` | disconnected ${a.disconnected} | wrong-size ${a.badCount}`,
  );
}

const meridian = loadTopology();

console.log(`\nPhase 4 balance gate: ${RUNS} games each. Gate: greedy 40-70%, random > 15%.\n`);
report('HAND-AUTHORED', sweep('meridian', () => meridian));
report('PROCEDURAL', sweep('gen', (i) => generateTopology(`gen-${i}`)));

console.log('\n(Hand-authored uses one fixed board with varied worm seeds; procedural generates a fresh board per seed.)\n');
