import { loadTopology } from '../src/data/topology';
import { greedyBot, randomBot, runBot, type BotOutcome } from '../src/sim/bots';
import { SIM_CONFIG, type SimConfig } from '../src/sim/config';
import { evaluatePacingGate, type PacingGateResult } from '../src/sim/pacing-gate';
import { runSpreadStats } from '../src/sim/stats';

const RUNS = 4000;
const topology = loadTopology();

interface Candidate {
  cap: number;
  dwell: number;
  chance: number;
  encryptAfterTurns: number;
}

interface CandidateResult {
  candidate: Candidate;
  gate: PacingGateResult;
}

const ORIGINAL_CANDIDATES: readonly Candidate[] = [
  { cap: 3, dwell: 3, chance: 0.6, encryptAfterTurns: 3 },
  { cap: 4, dwell: 3, chance: 0.6, encryptAfterTurns: 3 },
  { cap: 5, dwell: 3, chance: 0.6, encryptAfterTurns: 3 },
  { cap: 3, dwell: 2, chance: 0.6, encryptAfterTurns: 3 },
  { cap: 3, dwell: 3, chance: 0.6, encryptAfterTurns: 3 },
  { cap: 3, dwell: 2, chance: 0.55, encryptAfterTurns: 3 },
  { cap: 3, dwell: 2, chance: 0.6, encryptAfterTurns: 3 },
  { cap: 3, dwell: 2, chance: 0.65, encryptAfterTurns: 3 },
];

const LIFETIME_CANDIDATES: readonly Candidate[] = [4, 5, 6, 7, 8].map(
  (encryptAfterTurns) => ({
    cap: 3,
    dwell: 2,
    chance: 0.6,
    encryptAfterTurns,
  }),
);

const LIFETIME_SEVEN_CHANCE_CANDIDATES: readonly Candidate[] = [0.7, 0.8, 0.9, 1].map(
  (chance) => ({
    cap: 3,
    dwell: 2,
    chance,
    encryptAfterTurns: 7,
  }),
);

const LIFETIME_SEVEN_CAP_CANDIDATES: readonly Candidate[] = [4, 5].map((cap) => ({
  cap,
  dwell: 2,
  chance: 1,
  encryptAfterTurns: 7,
}));

function evaluate(candidate: Candidate): CandidateResult {
  const config: SimConfig = {
    ...SIM_CONFIG,
    spreadAttemptCap: candidate.cap,
    dwellTurns: candidate.dwell,
    spreadChance: candidate.chance,
    encryptAfterTurns: candidate.encryptAfterTurns,
  };
  const greedy: BotOutcome[] = [];
  const random: BotOutcome[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    greedy.push(runBot(topology, `pacing-greedy-${index}`, greedyBot, config));
    random.push(runBot(topology, `pacing-random-${index}`, randomBot, config));
  }
  const undefended = runSpreadStats(topology, {
    runs: RUNS,
    threshold: config.lossBlastRadius,
    maxTurns: 500,
    seedPrefix: 'pacing-undefended',
    config,
  });
  return {
    candidate,
    gate: evaluatePacingGate({ greedy, random, undefendedLossRate: undefended.lossRate }),
  };
}

function report(result: CandidateResult): void {
  const { candidate, gate } = result;
  const m = gate.metrics;
  const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;
  console.log(
    `cap=${candidate.cap} dwell=${candidate.dwell} chance=${candidate.chance.toFixed(2)} lifetime=${candidate.encryptAfterTurns} ${gate.pass ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `  greedy raw win ${percent(m.greedyWinRate)} | greedy sub-reportable ${percent(m.greedySubReportableRate)} | random win ${percent(m.randomWinRate)}`,
  );
  console.log(
    `  greedy finish ${m.greedyAverageTurn.toFixed(2)} | random finish ${m.randomAverageTurn.toFixed(2)}`,
  );
  console.log(
    `  early ${percent(m.earlyFinishRate)} | late ${percent(m.lateRunRate)} | undefended ${percent(m.undefendedLossRate)} | greedy pressure ${percent(m.greedyHighPressureRate)}`,
  );
  console.log(`  failures: ${gate.failures.length === 0 ? 'none' : gate.failures.join(', ')}`);
}

function outside(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return (minimum - value) / minimum;
  if (value > maximum) return (value - maximum) / maximum;
  return 0;
}

function misses(result: CandidateResult): number[] {
  const m = result.gate.metrics;
  return [
    outside(m.greedySubReportableRate, 0.45, 0.7),
    outside(m.randomWinRate, 0.15, 0.3),
    outside(m.greedyAverageTurn, 10, 14),
    outside(m.randomAverageTurn, 10, 16),
    Math.max(0, (m.earlyFinishRate - 0.15) / 0.15),
    Math.max(0, (m.lateRunRate - 0.25) / 0.25),
    Math.max(0, (0.8 - m.undefendedLossRate) / 0.8),
    outside(m.greedyHighPressureRate, 0.2, 0.5),
  ];
}

function compareDiagnostic(a: CandidateResult, b: CandidateResult): number {
  const aMisses = misses(a);
  const bMisses = misses(b);
  const aTotal = aMisses.reduce((total, miss) => total + miss, 0);
  const bTotal = bMisses.reduce((total, miss) => total + miss, 0);
  return (
    a.gate.failures.length - b.gate.failures.length ||
    aTotal - bTotal ||
    Math.max(...aMisses) - Math.max(...bMisses) ||
    a.candidate.encryptAfterTurns - b.candidate.encryptAfterTurns ||
    a.candidate.cap - b.candidate.cap ||
    a.candidate.dwell - b.candidate.dwell ||
    a.candidate.chance - b.candidate.chance
  );
}

const measured: CandidateResult[] = [];
let selected: CandidateResult | null = null;

console.log(
  `Phase 8 pacing sweep, ${RUNS} greedy + ${RUNS} random + ${RUNS} undefended seeds per candidate.`,
);
for (const candidate of [
  ...ORIGINAL_CANDIDATES,
  ...LIFETIME_CANDIDATES,
  ...LIFETIME_SEVEN_CHANCE_CANDIDATES,
  ...LIFETIME_SEVEN_CAP_CANDIDATES,
]) {
  const result = evaluate(candidate);
  measured.push(result);
  report(result);
  if (result.gate.pass) {
    selected = result;
    break;
  }
}

if (!selected) {
  const diagnostic = [...measured].sort(compareDiagnostic)[0];
  const c = diagnostic.candidate;
  console.error(`No approved candidate passed after ${measured.length} measured attempts.`);
  console.error(
    `DIAGNOSTIC BEST cap=${c.cap} dwell=${c.dwell} chance=${c.chance.toFixed(2)} lifetime=${c.encryptAfterTurns} failures=${diagnostic.gate.failures.length}`,
  );
  process.exitCode = 1;
} else {
  const c = selected.candidate;
  console.log(
    `LOCK cap=${c.cap} dwell=${c.dwell} chance=${c.chance.toFixed(2)} lifetime=${c.encryptAfterTurns}`,
  );
}
