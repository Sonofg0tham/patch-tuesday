import { describe, it, expect } from 'vitest';
import { loadTopology } from '../data/topology';
import { greedyBot, randomBot, runBot, runBotRecorded, type Bot } from './bots';
import { SIM_CONFIG } from './config';
import { makeTopology } from './fixtures';

const hiddenFootholdTopology = makeTopology(
  [
    { id: 'P0', edr: true },
    { id: 'DC', type: 'domain-controller', edr: false },
    { id: 'SRV', type: 'server' },
    { id: 'BK', type: 'backup' },
  ],
  [['P0', 'DC']],
);

const hiddenFootholdConfig = {
  ...SIM_CONFIG,
  apPerTurn: 3,
  spreadChance: 1,
  dwellTurns: 1,
  encryptAfterTurns: 2,
};

function isolateThenRestoreBot(): Bot {
  const actions = [
    { kind: 'isolate' as const, node: 'SRV' },
    { kind: 'restore' as const, node: 'P0' },
  ];
  return () => actions.shift() ?? null;
}

describe('bots', () => {
  const topology = loadTopology();

  it('both bots always reach a terminal state within the cap', () => {
    for (let i = 0; i < 60; i += 1) {
      const random = runBot(topology, `t-${i}`, randomBot, undefined, 80);
      const greedy = runBot(topology, `t-${i}`, greedyBot, undefined, 80);
      expect(random.status).not.toBe('playing');
      expect(greedy.status).not.toBe('playing');
    }
  });

  it('bot runs are reproducible for the same seed', () => {
    expect(runBot(topology, 'repro', greedyBot)).toEqual(runBot(topology, 'repro', greedyBot));
  });

  it('resolves one hidden false declaration hour in a one-decision run', () => {
    const outcome = runBot(
      makeTopology([{ id: 'HIDDEN', edr: false }], []),
      'hidden-only',
      () => null,
      { ...SIM_CONFIG, spreadChance: 0, dwellTurns: 0, encryptAfterTurns: 10 },
      1,
    );

    expect(outcome.turns).toBe(2);
  });

  it('records downtime for a lifecycle-advanced hidden declaration hour', () => {
    const record = runBotRecorded(
      hiddenFootholdTopology,
      'hidden-downtime',
      isolateThenRestoreBot(),
      hiddenFootholdConfig,
      hiddenFootholdTopology.name,
      1,
    );

    expect(record.final.turn).toBe(2);
    expect(record.downtimeHours).toBe(1);
  });

  it('keeps recorded and unrecorded lifecycle runs aligned', () => {
    const outcome = runBot(
      hiddenFootholdTopology,
      'hidden-parity',
      isolateThenRestoreBot(),
      hiddenFootholdConfig,
      1,
    );
    const record = runBotRecorded(
      hiddenFootholdTopology,
      'hidden-parity',
      isolateThenRestoreBot(),
      hiddenFootholdConfig,
      hiddenFootholdTopology.name,
      1,
    );

    expect(outcome).toMatchObject({
      status: record.final.status,
      turns: record.final.turn,
      score: record.final.score,
      backupsUsed: hiddenFootholdConfig.backupCredits - record.final.backupCredits,
      emergencyUsed: record.final.emergencyUsed,
    });
  });
});
