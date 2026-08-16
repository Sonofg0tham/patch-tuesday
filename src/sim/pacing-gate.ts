import type { BotOutcome } from './bots';

export interface PacingGateInput {
  greedy: readonly BotOutcome[];
  random: readonly BotOutcome[];
  undefendedLossRate: number;
}

export interface PacingGateResult {
  pass: boolean;
  failures: string[];
  metrics: {
    greedyWinRate: number;
    greedySubReportableRate: number;
    randomWinRate: number;
    greedyAverageTurn: number;
    randomAverageTurn: number;
    earlyFinishRate: number;
    lateRunRate: number;
    undefendedLossRate: number;
    greedyHighPressureRate: number;
  };
}

const rate = (
  outcomes: readonly BotOutcome[],
  predicate: (outcome: BotOutcome) => boolean,
): number => (outcomes.length === 0 ? 0 : outcomes.filter(predicate).length / outcomes.length);

const averageTurn = (outcomes: readonly BotOutcome[]): number =>
  outcomes.length === 0
    ? 0
    : outcomes.reduce((total, outcome) => total + outcome.turns, 0) / outcomes.length;

const inBand = (value: number, minimum: number, maximum: number): boolean =>
  value >= minimum && value <= maximum;

export function evaluatePacingGate(input: PacingGateInput): PacingGateResult {
  const allRuns = [...input.greedy, ...input.random];
  const metrics = {
    greedyWinRate: rate(input.greedy, (outcome) => outcome.status === 'won'),
    greedySubReportableRate: rate(
      input.greedy,
      (outcome) => outcome.status === 'won' && outcome.blastRadius < 0.25,
    ),
    randomWinRate: rate(input.random, (outcome) => outcome.status === 'won'),
    greedyAverageTurn: averageTurn(input.greedy),
    randomAverageTurn: averageTurn(input.random),
    earlyFinishRate: rate(allRuns, (outcome) => outcome.turns < 6),
    lateRunRate: rate(allRuns, (outcome) => outcome.turns > 16),
    undefendedLossRate: input.undefendedLossRate,
    greedyHighPressureRate: rate(input.greedy, (outcome) => outcome.maxPressure >= 80),
  };
  const failures: string[] = [];

  if (!inBand(metrics.greedySubReportableRate, 0.45, 0.7)) {
    failures.push('greedy sub-reportable rate');
  }
  if (!inBand(metrics.randomWinRate, 0.15, 0.3)) failures.push('random win rate');
  if (!inBand(metrics.greedyAverageTurn, 10, 14)) failures.push('greedy average finish');
  if (!inBand(metrics.randomAverageTurn, 10, 16)) failures.push('random average finish');
  if (metrics.earlyFinishRate >= 0.15) failures.push('early finish rate');
  if (metrics.lateRunRate >= 0.25) failures.push('late run rate');
  if (metrics.undefendedLossRate < 0.8) failures.push('undefended loss rate');
  if (!inBand(metrics.greedyHighPressureRate, 0.2, 0.5)) {
    failures.push('greedy high pressure rate');
  }

  return { pass: failures.length === 0, failures, metrics };
}
