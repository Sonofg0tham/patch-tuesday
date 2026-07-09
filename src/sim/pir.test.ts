import { describe, expect, it } from 'vitest';
import { buildPir, ratingOf, type LoggedEvent, type RunRecord } from './pir';
import { makeGameState, makeTopology } from './fixtures';
import type { GameState, NodeState, TurnEvent } from './types';

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
  it('is TOTAL LOSS when the run was lost', () => {
    const final = makeGameState(nodesWith(['DC-01']), { status: 'lost', lossReason: 'domain-controller' });
    expect(ratingOf(record({ final }))).toBe('TOTAL LOSS');
  });

  it('is NEAR MISS when nothing encrypted after detection, even with inherited encryption', () => {
    // A node arrived encrypted from the dwell; the response added none.
    const initial = makeGameState(nodesWith(['WS-1']), { patientZero: 'WS-1' });
    const final = makeGameState(nodesWith(['WS-1']), { status: 'won' });
    const rec = record({ initial, final, log: [] });
    expect(ratingOf(rec)).toBe('NEAR MISS');
  });

  it('is CONTAINED when encryption happened after detection but blast stayed under 25%', () => {
    const final = makeGameState(nodesWith(['WS-1']), { status: 'won' }); // 1/8 = 12.5%
    const rec = record({ final, log: [ev(2, { kind: 'encrypted', node: 'WS-1' })] });
    expect(ratingOf(rec)).toBe('CONTAINED');
  });

  it('is REPORTABLE INCIDENT when blast reached the 25-60% band', () => {
    const final = makeGameState(nodesWith(['WS-1', 'WS-2', 'SRV']), { status: 'won' }); // 3/8 = 37.5%
    const rec = record({ final, log: [ev(2, { kind: 'encrypted', node: 'WS-1' })] });
    expect(ratingOf(rec)).toBe('REPORTABLE INCIDENT');
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
      ev(3, { kind: 'action', action: 'emergency', ok: true }),
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
  it('reports the dwell as time-to-detect and tallies the run', () => {
    const final = makeGameState(nodesWith(['WS-1']), {
      status: 'won',
      turn: 6,
      backupCredits: 0,
      emergencyUsed: true,
    });
    const log: LoggedEvent[] = [
      ev(2, { kind: 'encrypted', node: 'WS-1' }),
      ev(3, { kind: 'action', action: 'emergency', ok: true }),
      ev(4, { kind: 'override', node: 'RTR' }),
    ];
    const pir = buildPir(record({ final, log, downtimeHours: 9 }), topology);
    const metric = (label: string): string => pir.metrics.find((m) => m.label === label)?.value ?? '';
    expect(metric('Time to detect')).toContain('preceded detection by 3 hours');
    expect(metric('Time to contain')).toBe('T+06h');
    expect(metric('Downtime')).toContain('9 host-hours');
    expect(metric('Backup credits burned')).toBe('2 of 2');
    expect(metric('Business overrides')).toContain('T+04h');
    expect(metric('Emergency change control')).toContain('BYPASSED at T+03h');
  });
});
