import { describe, expect, it } from 'vitest';
import type { BotOutcome } from './bots';
import { evaluatePacingGate } from './pacing-gate';

interface FabricatedOptions {
  winRate: number;
  averageTurn: number;
  subReportableRate?: number;
  earlyRate?: number;
  lateRate?: number;
  highPressureRate?: number;
}

function fabricatedOutcomes({
  winRate,
  averageTurn,
  subReportableRate = 0,
  earlyRate = 0,
  lateRate = 0,
  highPressureRate = 0.3,
}: FabricatedOptions): BotOutcome[] {
  const count = 100;
  const wins = Math.round(winRate * count);
  const subReportable = Math.round(subReportableRate * count);
  const early = Math.round(earlyRate * count);
  const late = Math.round(lateRate * count);
  const ordinary = count - early - late;
  const ordinaryTurn =
    ordinary === 0 ? averageTurn : (averageTurn * count - early * 5 - late * 17) / ordinary;

  return Array.from({ length: count }, (_, index) => ({
    status: index < wins ? 'won' : 'lost',
    turns: index < early ? 5 : index < early + late ? 17 : ordinaryTurn,
    containmentTurn: index < wins ? 11 : null,
    filingTurn: index < wins ? 12 : null,
    maxPressure: index < highPressureRate * count ? 80 : 79,
    prematureDeclarations: 0,
    blastRadius: index < subReportable ? 0.24 : index < wins ? 0.25 : 0.6,
    score: 100,
    backupsUsed: 1,
    emergencyUsed: false,
  }));
}

function passingInput() {
  return {
    greedy: fabricatedOutcomes({
      winRate: 0.9,
      subReportableRate: 0.6,
      averageTurn: 12,
    }),
    random: fabricatedOutcomes({ winRate: 0.2, averageTurn: 13 }),
    undefendedLossRate: 0.85,
  };
}

describe('Phase 8 pacing gate', () => {
  it('gates sub-reportable greedy containment while retaining raw survival as a diagnostic', () => {
    const result = evaluatePacingGate(passingInput());

    expect(result.pass).toBe(true);
    expect(result.metrics.greedyWinRate).toBe(0.9);
    expect(result.metrics.greedySubReportableRate).toBe(0.6);
    expect(result.failures).toEqual([]);
  });

  it('excludes an exactly 25 percent blast radius from sub-reportable containment', () => {
    const base: BotOutcome = {
      status: 'won',
      turns: 12,
      containmentTurn: 11,
      filingTurn: 12,
      maxPressure: 80,
      prematureDeclarations: 0,
      blastRadius: 0.249,
      score: 100,
      backupsUsed: 1,
      emergencyUsed: false,
    };
    const result = evaluatePacingGate({
      greedy: [base, { ...base, blastRadius: 0.25, maxPressure: 79 }],
      random: fabricatedOutcomes({ winRate: 0.2, averageTurn: 13 }),
      undefendedLossRate: 0.85,
    });

    expect(result.metrics.greedyWinRate).toBe(1);
    expect(result.metrics.greedySubReportableRate).toBe(0.5);
    expect(result.pass).toBe(true);
  });

  it('rejects every missed band with one stable label', () => {
    const result = evaluatePacingGate({
      greedy: fabricatedOutcomes({
        winRate: 0.9,
        subReportableRate: 0.44,
        averageTurn: 14.01,
        earlyRate: 0.16,
        lateRate: 0.26,
        highPressureRate: 0.51,
      }),
      random: fabricatedOutcomes({
        winRate: 0.31,
        averageTurn: 16.01,
        earlyRate: 0.16,
        lateRate: 0.26,
      }),
      undefendedLossRate: 0.79,
    });

    expect(result.failures).toEqual([
      'greedy sub-reportable rate',
      'random win rate',
      'greedy average finish',
      'random average finish',
      'early finish rate',
      'late run rate',
      'undefended loss rate',
      'greedy high pressure rate',
    ]);
  });

  it('accepts every inclusive lower boundary', () => {
    const result = evaluatePacingGate({
      greedy: fabricatedOutcomes({
        winRate: 0.9,
        subReportableRate: 0.45,
        averageTurn: 10,
        highPressureRate: 0.2,
      }),
      random: fabricatedOutcomes({ winRate: 0.15, averageTurn: 10 }),
      undefendedLossRate: 0.8,
    });

    expect(result.pass).toBe(true);
  });

  it('accepts every inclusive upper boundary', () => {
    const result = evaluatePacingGate({
      greedy: fabricatedOutcomes({
        winRate: 1,
        subReportableRate: 0.7,
        averageTurn: 14,
        highPressureRate: 0.5,
      }),
      random: fabricatedOutcomes({ winRate: 0.3, averageTurn: 16 }),
      undefendedLossRate: 1,
    });

    expect(result.pass).toBe(true);
  });

  it('rejects the exclusive early boundary at exactly 15 percent', () => {
    const result = evaluatePacingGate({
      greedy: fabricatedOutcomes({
        winRate: 0.9,
        subReportableRate: 0.6,
        averageTurn: 12,
        earlyRate: 0.15,
      }),
      random: fabricatedOutcomes({ winRate: 0.2, averageTurn: 13, earlyRate: 0.15 }),
      undefendedLossRate: 0.85,
    });

    expect(result.metrics.earlyFinishRate).toBe(0.15);
    expect(result.failures).toEqual(['early finish rate']);
  });

  it('rejects the exclusive late boundary at exactly 25 percent', () => {
    const result = evaluatePacingGate({
      greedy: fabricatedOutcomes({
        winRate: 0.9,
        subReportableRate: 0.6,
        averageTurn: 14,
        lateRate: 0.25,
      }),
      random: fabricatedOutcomes({ winRate: 0.2, averageTurn: 15, lateRate: 0.25 }),
      undefendedLossRate: 0.85,
    });

    expect(result.metrics.lateRunRate).toBe(0.25);
    expect(result.failures).toEqual(['late run rate']);
  });
});
