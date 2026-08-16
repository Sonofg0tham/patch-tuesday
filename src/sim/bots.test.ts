import { describe, it, expect } from 'vitest';
import { loadTopology } from '../data/topology';
import {
  greedyBot,
  randomBot,
  runBot,
  runBotRecorded,
  type Bot,
  type BotDecision,
} from './bots';
import { SIM_CONFIG } from './config';
import { makeGameState, makeTopology } from './fixtures';
import { createRng, hashSeed } from './rng';

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

function scriptedBot(): Bot {
  const actions: BotDecision[] = [
    { kind: 'isolate' as const, node: 'SRV' },
    { kind: 'restore' as const, node: 'P0' },
    'end-turn',
  ];
  return () => actions.shift() ?? 'end-turn';
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
      () => 'end-turn',
      { ...SIM_CONFIG, spreadChance: 0, dwellTurns: 0, encryptAfterTurns: 10 },
      1,
    );

    expect(outcome.turns).toBe(2);
  });

  it('records downtime for a lifecycle-advanced hidden declaration hour', () => {
    const record = runBotRecorded(
      hiddenFootholdTopology,
      'hidden-downtime',
      scriptedBot(),
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
      scriptedBot(),
      hiddenFootholdConfig,
      1,
    );
    const record = runBotRecorded(
      hiddenFootholdTopology,
      'hidden-parity',
      scriptedBot(),
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

  it('both policies declare containment whenever the public gate permits', () => {
    const clean = makeGameState({
      DC: { state: 'clean', infectedTurns: 0 },
      BK: { state: 'clean', infectedTurns: 0 },
    });
    const declarationTopology = makeTopology(
      [
        { id: 'DC', type: 'domain-controller', edr: true },
        { id: 'BK', type: 'backup', edr: true },
      ],
      [],
    );

    expect(greedyBot(clean, declarationTopology, SIM_CONFIG, createRng(1))).toBe(
      'declare-containment',
    );
    expect(randomBot(clean, declarationTopology, SIM_CONFIG, createRng(1))).toBe(
      'declare-containment',
    );
  });

  it('greedy recovery improves the highest-value legal critical service before filing', () => {
    const recoveryTopology = makeTopology(
      [
        { id: 'SRV', type: 'server' },
        { id: 'DC', type: 'domain-controller' },
        { id: 'WS', type: 'workstation' },
      ],
      [],
    );
    const recovery = makeGameState(
      {
        SRV: { state: 'clean', infectedTurns: 0, isolated: true },
        DC: { state: 'clean', infectedTurns: 0, isolated: true },
        WS: { state: 'clean', infectedTurns: 0, isolated: true },
      },
      { phase: 'recovery', ap: 2 },
    );

    expect(greedyBot(recovery, recoveryTopology, SIM_CONFIG, createRng(1))).toEqual({
      kind: 'reconnect',
      node: 'DC',
    });
  });

  it('greedy reconnects an apparently clean isolated node beside visible infection at 50 percent pressure', () => {
    const pressureTopology = makeTopology(
      [
        { id: 'R', type: 'router', edr: true },
        { id: 'I', edr: true },
      ],
      [['R', 'I']],
    );
    const pressureState = makeGameState(
      {
        R: { state: 'clean', infectedTurns: 0, isolated: true },
        I: { state: 'infected', infectedTurns: 1, isolated: true },
      },
      { pressure: 50, ap: 1, backupCredits: 0 },
    );

    expect(greedyBot(pressureState, pressureTopology, SIM_CONFIG, createRng(1))).toEqual({
      kind: 'reconnect',
      node: 'R',
    });
  });

  it('greedy never deliberately reconnects a visibly infected isolated node', () => {
    const pressureTopology = makeTopology([{ id: 'I', edr: true }], []);
    const pressureState = makeGameState(
      { I: { state: 'infected', infectedTurns: 1, isolated: true } },
      { pressure: 50, ap: 1, backupCredits: 0 },
    );

    expect(greedyBot(pressureState, pressureTopology, SIM_CONFIG, createRng(1))).toBe(
      'end-turn',
    );
  });

  it('greedy relieves greater pressure weight before considering visible threat risk', () => {
    const pressureTopology = makeTopology(
      [
        { id: 'R', type: 'router', edr: true },
        { id: 'S', type: 'server', edr: true },
        { id: 'I', edr: true },
      ],
      [['R', 'I']],
    );
    const pressureState = makeGameState(
      {
        R: { state: 'clean', infectedTurns: 0, isolated: true },
        S: { state: 'clean', infectedTurns: 0, isolated: true },
        I: { state: 'infected', infectedTurns: 1, isolated: true },
      },
      { pressure: 50, ap: 1, backupCredits: 0 },
    );

    expect(greedyBot(pressureState, pressureTopology, SIM_CONFIG, createRng(1))).toEqual({
      kind: 'reconnect',
      node: 'R',
    });
  });

  it('greedy breaks equal-weight pressure ties by visible risk and then id', () => {
    const pressureTopology = makeTopology(
      [
        { id: 'A', type: 'server', edr: true },
        { id: 'B', type: 'server', edr: true },
        { id: 'Y', type: 'server', edr: true },
        { id: 'Z', type: 'server', edr: true },
        { id: 'I', edr: true },
      ],
      [['A', 'I']],
    );
    const pressureState = makeGameState(
      {
        A: { state: 'clean', infectedTurns: 0, isolated: true },
        B: { state: 'clean', infectedTurns: 0, isolated: true },
        Y: { state: 'patched', infectedTurns: 0, isolated: true },
        Z: { state: 'encrypted', infectedTurns: 3, isolated: true },
        I: { state: 'infected', infectedTurns: 1, isolated: true },
      },
      { pressure: 50, ap: 1, backupCredits: 0 },
    );

    expect(greedyBot(pressureState, pressureTopology, SIM_CONFIG, createRng(1))).toEqual({
      kind: 'reconnect',
      node: 'Y',
    });
  });

  it('random recovery uses its deterministic 25 percent filing decision', () => {
    const recoveryTopology = makeTopology([{ id: 'SRV', type: 'server' }], []);
    const recovery = makeGameState(
      { SRV: { state: 'clean', infectedTurns: 0, isolated: true } },
      { phase: 'recovery', ap: 2 },
    );
    const first = randomBot(recovery, recoveryTopology, SIM_CONFIG, createRng(hashSeed('file-now')));
    const second = randomBot(recovery, recoveryTopology, SIM_CONFIG, createRng(hashSeed('file-now')));

    expect(first).toEqual(second);
    expect(first).toBe('file-review');
  });

  it('records containment, filing, pressure and premature declarations in outcomes', () => {
    const visible = makeTopology(
      [
        { id: 'P0', edr: true },
        { id: 'BK', type: 'backup', edr: true },
      ],
      [],
    );
    const outcome = runBot(visible, 'outcome-metrics', greedyBot, {
      ...SIM_CONFIG,
      dwellTurns: 0,
      spreadChance: 0,
    });
    const premature = runBot(
      makeTopology([{ id: 'HIDDEN', edr: false }], []),
      'premature-metric',
      greedyBot,
      { ...SIM_CONFIG, dwellTurns: 0, spreadChance: 0, encryptAfterTurns: 2 },
    );

    expect(outcome).toMatchObject({
      status: 'won',
      containmentTurn: 1,
      filingTurn: 1,
      maxPressure: 0,
      prematureDeclarations: 0,
    });
    expect(premature.prematureDeclarations).toBe(2);
    expect(premature.containmentTurn).toBeNull();
    expect(premature.filingTurn).toBeNull();
  });

  it('tracks peak pressure even when recovery later relieves it', () => {
    const pressureTopology = makeTopology(
      [
        { id: 'P0', edr: true },
        { id: 'R', type: 'router', edr: true },
        { id: 'BK', type: 'backup', edr: true },
      ],
      [],
    );
    const decisions: BotDecision[] = [
      { kind: 'isolate', node: 'R' },
      { kind: 'emergency' },
      { kind: 'restore', node: 'P0' },
      'end-turn',
      'declare-containment',
      { kind: 'reconnect', node: 'R' },
      'file-review',
    ];
    const outcome = runBot(
      pressureTopology,
      'peak-pressure',
      () => decisions.shift() ?? 'file-review',
      { ...SIM_CONFIG, dwellTurns: 0, spreadChance: 0 },
    );

    expect(outcome.status).toBe('won');
    expect(outcome.containmentTurn).toBe(2);
    expect(outcome.filingTurn).toBe(2);
    expect(outcome.maxPressure).toBe(8);
  });

  it('runBot and runBotRecorded finish in the same final state', () => {
    const testConfig = { ...SIM_CONFIG, dwellTurns: 0, spreadChance: 0 };
    const outcome = runBot(topology, 'policy-lock', greedyBot, testConfig);
    const record = runBotRecorded(topology, 'policy-lock', greedyBot, testConfig);

    expect(record.final.status).toBe(outcome.status);
    expect(record.final.turn).toBe(outcome.turns);
    expect(record.final.score).toBe(outcome.score);
    expect(record.final.backupCredits).toBe(testConfig.backupCredits - outcome.backupsUsed);
    expect(record.final.emergencyUsed).toBe(outcome.emergencyUsed);
  });
});
