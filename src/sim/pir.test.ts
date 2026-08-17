import { describe, expect, it } from 'vitest';
import { buildPir, ratingOf, RunRecorder, type LoggedEvent, type RunRecord } from './pir';
import { SIM_CONFIG } from './config';
import { makeGameState, makeTopology } from './fixtures';
import {
  applyPlayerAction,
  declareContainment,
  endTurn,
  fileReview,
} from './game';
import type { GameState, NodeState, PlayerAction, TurnEvent } from './types';
import { blastRadius, createInitialState, encryptedCount, infectedCount } from './worm';

// A small, controlled estate: 1 DC, 1 backup, 1 router, 1 server, 4 workstations
// (8 nodes, so blast fractions are clean quarters).
const topology = makeTopology(
  [
    { id: 'DC-01', type: 'domain-controller', edr: true },
    { id: 'BACKUP-01', type: 'backup', edr: true },
    { id: 'RTR', type: 'router', edr: false },
    { id: 'SRV', type: 'server', edr: true },
    { id: 'WS-1', type: 'workstation', edr: false },
    { id: 'WS-2', type: 'workstation', edr: false },
    { id: 'WS-3', type: 'workstation', edr: true },
    { id: 'WS-4', type: 'workstation', edr: true },
  ],
  [
    ['RTR', 'DC-01'],
    ['RTR', 'BACKUP-01'],
    ['RTR', 'SRV'],
    ['RTR', 'WS-1'],
    ['WS-1', 'WS-2'],
    ['RTR', 'WS-3'],
    ['RTR', 'WS-4'],
  ],
);

const clean: Record<string, NodeState> = Object.fromEntries(
  topology.nodes.map((n) => [n.id, { state: 'clean', infectedTurns: 0 } as NodeState]),
);

function nodesWith(encrypted: string[]): Record<string, NodeState> {
  const out: Record<string, NodeState> = {};
  for (const [id, ns] of Object.entries(clean)) out[id] = { ...ns };
  for (const id of encrypted) out[id] = { state: 'encrypted', infectedTurns: 3 };
  return out;
}

function record(overrides: {
  initial?: GameState;
  final: GameState;
  log?: LoggedEvent[];
  downtimeHours?: number;
  abandoned?: boolean;
}): RunRecord {
  return {
    scenarioName: topology.name,
    seed: 'test',
    initial: overrides.initial ?? makeGameState(clean),
    final: overrides.final,
    log: overrides.log ?? [],
    downtimeHours: overrides.downtimeHours ?? 0,
    abandoned: overrides.abandoned,
  };
}

const ev = (turn: number, event: TurnEvent): LoggedEvent => ({ turn, event });

describe('PIR ratings', () => {
  it('earns a NEAR MISS through legal containment and recovery from three infections', () => {
    const legalTopology = makeTopology(
      [
        { id: 'EDGE', edr: true },
        { id: 'MIDDLE', edr: true },
        { id: 'BACKUP', type: 'backup', edr: true },
      ],
      [
        ['EDGE', 'MIDDLE'],
        ['MIDDLE', 'BACKUP'],
      ],
    );
    const initial = createInitialState(legalTopology, 'legal-near-miss', SIM_CONFIG);
    const recorder = new RunRecorder();
    let state = initial;

    const act = (action: PlayerAction): void => {
      const turn = state.turn;
      const result = applyPlayerAction(state, action, legalTopology, SIM_CONFIG);
      expect(result.ok).toBe(true);
      recorder.record(turn, result.events);
      state = result.state;
    };
    const advance = (): void => {
      const turn = state.turn;
      const result = endTurn(state, legalTopology, SIM_CONFIG);
      recorder.record(turn, result.events);
      state = result.nextState;
      recorder.tickDowntime(state);
    };

    expect(infectedCount(state)).toBe(3);
    act({ kind: 'emergency' });
    act({ kind: 'restore', node: 'EDGE' });
    act({ kind: 'isolate', node: 'MIDDLE' });
    act({ kind: 'isolate', node: 'BACKUP' });
    advance();

    act({ kind: 'restore', node: 'MIDDLE' });
    advance();
    act({ kind: 'restore', node: 'BACKUP' });

    const declarationTurn = state.turn;
    const declaration = declareContainment(state, legalTopology, SIM_CONFIG);
    expect(declaration.events).toEqual([{ kind: 'containment-declaration', confirmed: true }]);
    recorder.record(declarationTurn, declaration.events);
    state = declaration.nextState;

    act({ kind: 'reconnect', node: 'MIDDLE' });
    act({ kind: 'reconnect', node: 'BACKUP' });
    const filingTurn = state.turn;
    const filing = fileReview(state);
    recorder.record(filingTurn, filing.events);
    state = filing.nextState;

    const run: RunRecord = {
      scenarioName: legalTopology.name,
      seed: initial.seed,
      initial,
      final: state,
      log: recorder.log,
      downtimeHours: recorder.downtimeHours,
    };
    const pir = buildPir(run, legalTopology, SIM_CONFIG);

    expect(state.status).toBe('won');
    expect(blastRadius(state)).toBeLessThan(0.25);
    expect(encryptedCount(state)).toBe(0);
    expect(recorder.log.some(({ event }) => event.kind === 'encrypted')).toBe(false);
    expect(
      recorder.log.some(
        ({ event }) => event.kind === 'containment-declaration' && !event.confirmed,
      ),
    ).toBe(false);
    expect(
      legalTopology.nodes.some(
        (node) =>
          node.type !== 'workstation' && state.nodes[node.id].isolated === true,
      ),
    ).toBe(false);
    expect(pir.rating).toBe('NEAR MISS');
  });

  it('gives TOTAL LOSS precedence over the reportable threshold', () => {
    const final = makeGameState(nodesWith(['WS-1', 'WS-2']), {
      status: 'lost',
      lossReason: 'blast-radius',
    });
    expect(ratingOf(record({ final }), topology)).toBe('TOTAL LOSS');
  });

  it('is NEAR MISS when nothing encrypted after detection, even with inherited encryption', () => {
    // A node arrived encrypted from the dwell; the response added none.
    const initial = makeGameState(nodesWith(['WS-1']), { patientZero: 'WS-1' });
    const final = makeGameState(nodesWith(['WS-1']), { status: 'won' });
    const rec = record({ initial, final, log: [] });
    expect(ratingOf(rec, topology)).toBe('NEAR MISS');
  });

  it('is CONTAINED when encryption happened after detection but blast stayed under 25%', () => {
    const final = makeGameState(nodesWith(['WS-1']), { status: 'won' }); // 1/8 = 12.5%
    const rec = record({ final, log: [ev(2, { kind: 'encrypted', node: 'WS-1' })] });
    expect(ratingOf(rec, topology)).toBe('CONTAINED');
  });

  it('is REPORTABLE INCIDENT at exactly 25 percent blast radius', () => {
    const final = makeGameState(nodesWith(['WS-1', 'WS-2']), { status: 'won' }); // 2/8 = 25%
    const rec = record({ final, log: [ev(4, { kind: 'review-filed' })] });
    expect(ratingOf(rec, topology)).toBe('REPORTABLE INCIDENT');
  });

  it('caps an otherwise near miss at CONTAINED after a premature declaration', () => {
    const final = makeGameState(nodesWith([]), { status: 'won' });
    const rec = record({
      final,
      log: [
        ev(3, { kind: 'containment-declaration', confirmed: false }),
        ev(6, { kind: 'containment-declaration', confirmed: true }),
        ev(6, { kind: 'review-filed' }),
      ],
    });

    expect(ratingOf(rec, topology)).toBe('CONTAINED');
  });

  it('caps an otherwise near miss at CONTAINED when a critical service is left isolated', () => {
    const finalNodes = nodesWith([]);
    finalNodes.RTR.isolated = true;
    const final = makeGameState(finalNodes, { status: 'won', phase: 'recovery' });
    const rec = record({
      final,
      log: [
        ev(3, { kind: 'containment-declaration', confirmed: true }),
        ev(3, { kind: 'review-filed' }),
      ],
    });

    expect(ratingOf(rec, topology)).toBe('CONTAINED');
  });
});

describe('PIR findings', () => {
  it('records initial access and inherited encryption from the opening state', () => {
    const initial = makeGameState(nodesWith(['WS-1']), { patientZero: 'WS-1' });
    const final = makeGameState(nodesWith(['WS-1']), { status: 'won' });
    const pir = buildPir(record({ initial, final }), topology);
    const texts = pir.findings.map((f) => f.text).join('\n');
    expect(texts).toContain('Initial access via WS-1');
    expect(texts).toContain('already encrypted when the incident was detected');
  });

  it('flags an EDR coverage gap when an uncovered, unseen node spread the worm', () => {
    const final = makeGameState(nodesWith([]), { status: 'won' });
    const log = [
      ev(1, { kind: 'spread-attempt', source: 'WS-1', target: 'WS-2', roll: 0.1, success: true }),
    ];
    const pir = buildPir(record({ final, log }), topology);
    const gap = pir.findings.find((f) => f.text.includes('EDR coverage gap on WS-1'));
    expect(gap).toBeDefined();
    expect(gap?.severity).toBe('High');
  });

  it('keeps an earlier coverage-gap finding after a sensor is deployed', () => {
    const finalNodes = nodesWith([]);
    finalNodes['WS-1'].revealed = true;
    const final = makeGameState(finalNodes, { status: 'won' });
    const log = [
      ev(2, { kind: 'spread-attempt', source: 'WS-1', target: 'WS-2', roll: 0.1, success: true }),
      ev(3, { kind: 'action', action: 'scan', node: 'WS-1', outcome: 'applied', apSpent: 1 }),
      ev(4, { kind: 'spread-attempt', source: 'WS-1', target: 'RTR', roll: 0.1, success: true }),
      ev(5, { kind: 'review-filed' }),
    ] satisfies LoggedEvent[];

    const gap = buildPir(record({ final, log }), topology).findings.find((finding) =>
      finding.text.includes('EDR coverage gap on WS-1'),
    );

    expect(gap?.text).toContain('1 host infected from it before it was seen');
    expect(gap?.turn).toBe(2);
  });

  it('treats built-in EDR as known from detection', () => {
    const final = makeGameState(nodesWith([]), { status: 'won' });
    const log = [
      ev(2, { kind: 'spread-attempt', source: 'WS-3', target: 'RTR', roll: 0.1, success: true }),
      ev(4, { kind: 'review-filed' }),
    ];

    const texts = buildPir(record({ final, log }), topology).findings.map((finding) => finding.text);

    expect(texts.some((text) => text.includes('EDR coverage gap on WS-3'))).toBe(false);
  });

  it('adds patch-probe knowledge only from the accepted probe timestamp', () => {
    const finalNodes = nodesWith([]);
    finalNodes['WS-1'].revealed = true;
    const final = makeGameState(finalNodes, { status: 'won' });
    const log = [
      ev(2, { kind: 'spread-attempt', source: 'WS-1', target: 'WS-2', roll: 0.1, success: true }),
      ev(3, { kind: 'action', action: 'patch', node: 'WS-1', outcome: 'probe', apSpent: 1 }),
      ev(4, { kind: 'spread-attempt', source: 'WS-1', target: 'RTR', roll: 0.1, success: true }),
      ev(5, { kind: 'review-filed' }),
    ] satisfies LoggedEvent[];

    const gap = buildPir(record({ final, log }), topology).findings.find((finding) =>
      finding.text.includes('EDR coverage gap on WS-1'),
    );

    expect(gap?.text).toContain('1 host infected from it before it was seen');
    expect(gap?.turn).toBe(2);
  });

  it('does not treat a blocked sensor as coverage knowledge', () => {
    const final = makeGameState(nodesWith([]), { status: 'won' });
    const log = [
      ev(2, {
        kind: 'action',
        action: 'scan',
        node: 'WS-1',
        outcome: 'blocked',
        apSpent: 0,
        reason: 'not enough AP',
      }),
      ev(3, { kind: 'spread-attempt', source: 'WS-1', target: 'WS-2', roll: 0.1, success: true }),
      ev(4, { kind: 'review-filed' }),
    ] satisfies LoggedEvent[];

    const texts = buildPir(record({ final, log }), topology).findings.map((finding) => finding.text);

    expect(texts.some((text) => text.includes('EDR coverage gap on WS-1'))).toBe(true);
  });

  it('records a failed containment declaration as a High finding', () => {
    const final = makeGameState(nodesWith([]), { status: 'won' });
    const log = [
      ev(3, { kind: 'containment-declaration', confirmed: false }),
      ev(5, { kind: 'containment-declaration', confirmed: true }),
      ev(5, { kind: 'review-filed' }),
    ];

    const finding = buildPir(record({ final, log }), topology).findings.find((item) =>
      item.text.includes('Containment was declared prematurely'),
    );

    expect(finding).toMatchObject({ turn: 3, severity: 'High' });
  });

  it.each([
    ['RTR', 'Medium'],
    ['SRV', 'Medium'],
    ['BACKUP-01', 'High'],
    ['DC-01', 'High'],
  ] as const)('records %s left isolated at filing as a %s recovery finding', (nodeId, severity) => {
    const finalNodes = nodesWith([]);
    finalNodes[nodeId].isolated = true;
    const final = makeGameState(finalNodes, { status: 'won', phase: 'recovery' });
    const log = [
      ev(4, { kind: 'containment-declaration', confirmed: true }),
      ev(6, { kind: 'review-filed' }),
    ];

    const finding = buildPir(record({ final, log }), topology).findings.find((item) =>
      item.text.includes(`${nodeId} (test node) remained isolated when the review was filed`),
    );

    expect(finding).toMatchObject({ turn: 6, severity });
  });

  it('does not create a recovery finding for an isolated workstation', () => {
    const finalNodes = nodesWith([]);
    finalNodes['WS-1'].isolated = true;
    const final = makeGameState(finalNodes, { status: 'won', phase: 'recovery' });
    const log = [
      ev(4, { kind: 'containment-declaration', confirmed: true }),
      ev(6, { kind: 'review-filed' }),
    ];

    const texts = buildPir(record({ final, log }), topology).findings.map((finding) => finding.text);

    expect(texts.some((text) => text.includes('remained isolated when the review was filed'))).toBe(false);
    expect(ratingOf(record({ final, log }), topology)).toBe('NEAR MISS');
  });

  it('grades encryption by asset value, and calls out the domain controller and backup', () => {
    const final = makeGameState(nodesWith(['DC-01', 'BACKUP-01', 'WS-1']), {
      status: 'lost',
      lossReason: 'domain-controller',
    });
    const log = [
      ev(4, { kind: 'encrypted', node: 'WS-1' }),
      ev(5, { kind: 'encrypted', node: 'BACKUP-01' }),
      ev(5, { kind: 'encrypted', node: 'DC-01' }),
    ];
    const pir = buildPir(record({ final, log }), topology);
    const dc = pir.findings.find((f) => f.text.startsWith('DC-01'));
    const backup = pir.findings.find((f) => f.text.startsWith('BACKUP-01'));
    const ws = pir.findings.find((f) => f.text.startsWith('WS-1') && f.text.includes('encrypted'));
    expect(dc?.severity).toBe('Critical');
    expect(backup?.severity).toBe('High');
    expect(ws?.severity).toBe('Low');
    expect(dc?.text).toContain("domain controller is in the worm's hands");
    expect(backup?.text).toContain('Restore capability is lost');
  });

  it('states the business override and the emergency change flatly', () => {
    const final = makeGameState(nodesWith([]), { status: 'won', emergencyUsed: true });
    const log: LoggedEvent[] = [
      ev(3, { kind: 'action', action: 'emergency', outcome: 'applied', apSpent: 0 }),
      ev(4, { kind: 'override', node: 'RTR' }),
    ];
    const pir = buildPir(record({ final, log }), topology);
    const texts = pir.findings.map((f) => f.text).join('\n');
    expect(texts).toContain('Containment on RTR');
    expect(texts).toContain('overridden by business pressure');
    expect(texts).toContain('Emergency change control invoked');
  });

  it('orders findings by hour, then by severity within the hour', () => {
    const final = makeGameState(nodesWith(['DC-01', 'WS-1']), { status: 'lost', lossReason: 'domain-controller' });
    const log = [
      ev(5, { kind: 'encrypted', node: 'WS-1' }), // Low, T+05h
      ev(5, { kind: 'encrypted', node: 'DC-01' }), // Critical, T+05h
      ev(2, { kind: 'override', node: 'RTR' }), // Medium, T+02h
    ];
    const pir = buildPir(record({ final, log }), topology);
    const turns = pir.findings.map((f) => f.turn);
    expect(turns).toEqual([...turns].sort((a, b) => a - b));
    // Within T+05h, Critical (DC) comes before Low (WS).
    const t5 = pir.findings.filter((f) => f.turn === 5);
    expect(t5[0].text.startsWith('DC-01')).toBe(true);
  });
});

describe('PIR abandoned runs', () => {
  it('marks an abandoned run and reframes time-to-contain', () => {
    const final = makeGameState(nodesWith(['WS-1']), { status: 'playing', turn: 4 });
    const pir = buildPir(record({ final, log: [], abandoned: true }), topology);
    expect(pir.abandoned).toBe(true);
    const contain = pir.metrics.find((m) => m.label === 'Time to contain')?.value ?? '';
    expect(contain).toBe('response abandoned at T+04h');
  });
});

describe('PIR metrics', () => {
  it('uses lifecycle events for containment, filing and recovery metrics', () => {
    const final = makeGameState(nodesWith(['WS-1']), {
      status: 'won',
      turn: 6,
      backupCredits: 0,
      emergencyUsed: true,
      score: 42,
      phase: 'recovery',
    });
    const log: LoggedEvent[] = [
      ev(2, { kind: 'encrypted', node: 'WS-1' }),
      ev(3, { kind: 'action', action: 'emergency', outcome: 'applied', apSpent: 0 }),
      ev(4, { kind: 'containment-declaration', confirmed: true }),
      ev(4, { kind: 'override', node: 'RTR' }),
      ev(4, { kind: 'recovery-hour' }),
      ev(5, { kind: 'recovery-hour' }),
      ev(6, { kind: 'review-filed' }),
    ];
    const pir = buildPir(record({ final, log, downtimeHours: 9 }), topology);
    const metric = (label: string): string => pir.metrics.find((m) => m.label === label)?.value ?? '';
    expect(metric('Time to detect')).toContain('preceded detection by 2 hours');
    expect(metric('Time to contain')).toBe('T+04h');
    expect(metric('Time to file')).toBe('T+06h');
    expect(metric('Recovery duration')).toBe('2 hours');
    expect(metric('Impact')).toBe('42');
    expect(metric('Downtime')).toContain('9 host-hours');
    expect(metric('Backup credits burned')).toBe('3 of 3');
    expect(metric('Business overrides')).toContain('T+04h');
    expect(metric('Emergency change control')).toContain('BYPASSED at T+03h');
  });
});
