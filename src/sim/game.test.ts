import { describe, it, expect } from 'vitest';
import { loadTopology } from '../data/topology';
import { SIM_CONFIG } from './config';
import { makeGameState, makeTopology } from './fixtures';
import {
  applyPlayerAction,
  declareContainment,
  endTurn,
  fileReview,
  replay,
} from './game';
import type { Move } from './types';
import { stepTurn, visibleStateOf } from './worm';

const noSpreadConfig = { ...SIM_CONFIG, spreadChance: 0, dwellTurns: 0 };
const threeTurnEncryption = { ...SIM_CONFIG, encryptAfterTurns: 3 };

function makeCleanGameState(topology: ReturnType<typeof makeTopology>) {
  return makeGameState(
    Object.fromEntries(topology.nodes.map((node) => [node.id, { state: 'clean' as const, infectedTurns: 0 }])),
  );
}

describe('actions: legality and effects', () => {
  const topology = makeTopology(
    [{ id: 'A' }, { id: 'B' }, { id: 'BK', type: 'backup' }],
    [['A', 'B'], ['A', 'BK']],
  );

  it('deploy sensor covers only the target node and spends 1 AP', () => {
    const state = makeGameState({
      A: { state: 'clean', infectedTurns: 0 },
      B: { state: 'infected', infectedTurns: 1 },
      BK: { state: 'clean', infectedTurns: 0 },
    });
    const r = applyPlayerAction(state, { kind: 'scan', node: 'A' }, topology);
    expect(r.ok).toBe(true);
    expect(r.state.ap).toBe(SIM_CONFIG.apPerTurn - 1);
    expect(r.state.nodes.A.revealed).toBe(true);
    expect(r.state.nodes.B.revealed).toBeFalsy(); // neighbours are NOT revealed
  });

  it('deploy sensor reveals a hidden infection on the covered node', () => {
    const topo = makeTopology([{ id: 'BLIND' }], []); // no EDR
    const state = makeGameState({ BLIND: { state: 'infected', infectedTurns: 1 } });
    // Before the sensor the infection is hidden; after, it is visible.
    expect(visibleStateOf(topo.byId.get('BLIND')!, state.nodes.BLIND)).toBe('clean');
    const r = applyPlayerAction(state, { kind: 'scan', node: 'BLIND' }, topo);
    expect(visibleStateOf(topo.byId.get('BLIND')!, r.state.nodes.BLIND)).toBe('infected');
  });

  it('isolate then reconnect toggles the flag and each costs 1 AP', () => {
    const state = makeGameState({ A: { state: 'clean', infectedTurns: 0 }, B: { state: 'clean', infectedTurns: 0 }, BK: { state: 'clean', infectedTurns: 0 } });
    const isolated = applyPlayerAction(state, { kind: 'isolate', node: 'A' }, topology);
    expect(isolated.state.nodes.A.isolated).toBe(true);
    expect(isolated.state.ap).toBe(SIM_CONFIG.apPerTurn - 1);
    const blocked = applyPlayerAction(isolated.state, { kind: 'isolate', node: 'A' }, topology);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/already isolated/);
    const reconnected = applyPlayerAction(isolated.state, { kind: 'reconnect', node: 'A' }, topology);
    expect(reconnected.state.nodes.A.isolated).toBe(false);
  });

  it('patch immunises a clean node for 2 AP and refuses a patched one', () => {
    const state = makeGameState({ A: { state: 'clean', infectedTurns: 0 }, B: { state: 'clean', infectedTurns: 0 }, BK: { state: 'clean', infectedTurns: 0 } });
    const patched = applyPlayerAction(state, { kind: 'patch', node: 'A' }, topology);
    expect(patched.ok).toBe(true);
    expect(patched.state.nodes.A.state).toBe('patched');
    expect(patched.state.ap).toBe(SIM_CONFIG.apPerTurn - 2);
    const again = applyPlayerAction(patched.state, { kind: 'patch', node: 'A' }, topology);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/already patched/);
  });

  it('a patched node is immune to spread', () => {
    const line = makeTopology([{ id: 'A' }, { id: 'P' }], [['A', 'P']]);
    const state = makeGameState({
      A: { state: 'infected', infectedTurns: 0 },
      P: { state: 'patched', infectedTurns: 0 },
    });
    for (let i = 0; i < 40; i += 1) {
      const next = stepTurn({ ...state, seed: `p${i}`, rngState: i }, line, { ...SIM_CONFIG, spreadChance: 1 });
      expect(next.nextState.nodes.P.state).toBe('patched');
    }
  });

  it('a patch probe is accepted, recorded and costs 1 AP', () => {
    const state = makeGameState({ A: { state: 'infected', infectedTurns: 1 }, B: { state: 'clean', infectedTurns: 0 }, BK: { state: 'clean', infectedTurns: 0 } });
    const r = applyPlayerAction(state, { kind: 'patch', node: 'A' }, topology);
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/infected/);
    expect(r.state.nodes.A.revealed).toBe(true); // fog pierced
    expect(r.state.ap).toBe(SIM_CONFIG.apPerTurn - 1); // probe cost, not 2
    expect(r.state.nodes.A.state).toBe('infected'); // not patched
    expect(r.events).toEqual([
      { kind: 'action', action: 'patch', node: 'A', outcome: 'probe', apSpent: 1, reason: expect.any(String) },
    ]);
  });

  it('isolation blocks spread across the cut cable', () => {
    const line = makeTopology([{ id: 'A' }, { id: 'B' }], [['A', 'B']]);
    const state = makeGameState({
      A: { state: 'infected', infectedTurns: 0 },
      B: { state: 'clean', infectedTurns: 0, isolated: true },
    });
    for (let i = 0; i < 40; i += 1) {
      const next = stepTurn({ ...state, seed: `i${i}`, rngState: i }, line, { ...SIM_CONFIG, spreadChance: 1 });
      expect(next.nextState.nodes.B.state).toBe('clean');
    }
  });
});

describe('actions: restore and backups', () => {
  const topology = makeTopology([{ id: 'A' }, { id: 'BK', type: 'backup' }], [['A', 'BK']]);

  it('restore cleans an infected node, spends 2 AP and a credit', () => {
    const state = makeGameState({ A: { state: 'infected', infectedTurns: 2 }, BK: { state: 'clean', infectedTurns: 0 } });
    const r = applyPlayerAction(state, { kind: 'restore', node: 'A' }, topology);
    expect(r.ok).toBe(true);
    expect(r.state.nodes.A.state).toBe('clean');
    expect(r.state.nodes.A.infectedTurns).toBe(0);
    expect(r.state.backupCredits).toBe(SIM_CONFIG.backupCredits - 1);
    expect(r.state.ap).toBe(SIM_CONFIG.apPerTurn - 2);
  });

  it('restore is blocked when the backup node is encrypted', () => {
    const state = makeGameState({ A: { state: 'infected', infectedTurns: 2 }, BK: { state: 'encrypted', infectedTurns: 3 } });
    const r = applyPlayerAction(state, { kind: 'restore', node: 'A' }, topology);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/backup node encrypted/);
  });

  it('restore is blocked with no credits left', () => {
    const state = makeGameState({ A: { state: 'infected', infectedTurns: 2 }, BK: { state: 'clean', infectedTurns: 0 } }, { backupCredits: 0 });
    const r = applyPlayerAction(state, { kind: 'restore', node: 'A' }, topology);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no backup credits/);
  });
});

describe('actions: emergency budget and AP limits', () => {
  const topology = makeTopology([{ id: 'A' }], []);

  it('emergency grants bonus AP once per run', () => {
    const state = makeGameState({ A: { state: 'clean', infectedTurns: 0 } });
    const first = applyPlayerAction(state, { kind: 'emergency' }, topology);
    expect(first.ok).toBe(true);
    expect(first.state.ap).toBe(SIM_CONFIG.apPerTurn + SIM_CONFIG.emergencyApBonus);
    expect(first.state.emergencyUsed).toBe(true);
    const second = applyPlayerAction(first.state, { kind: 'emergency' }, topology);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already spent/);
  });

  it('blocks an action the player cannot afford, with a reason', () => {
    const state = makeGameState({ A: { state: 'clean', infectedTurns: 0 } }, { ap: 1 });
    const r = applyPlayerAction(state, { kind: 'patch', node: 'A' }, topology);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not enough AP/);
  });
});

describe('turn resolution: score and win/lose', () => {
  it('does not automatically win when no infected nodes remain', () => {
    // Three-node estate: one isolated infected node burns out to encrypted
    // (33% blast, under the 60% loss line), leaving no infected. Contained.
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }, { id: 'C' }], []);
    let state = makeGameState({
      A: { state: 'infected', infectedTurns: 2, isolated: true },
      B: { state: 'clean', infectedTurns: 0 },
      C: { state: 'clean', infectedTurns: 0 },
    });
    state = endTurn(state, topology, threeTurnEncryption).nextState; // A -> encrypted, no infected left
    expect(state.status).toBe('playing');
  });

  it('loses when the domain controller is encrypted', () => {
    const topology = makeTopology([{ id: 'DC', type: 'domain-controller' }], []);
    let state = makeGameState({ DC: { state: 'infected', infectedTurns: 2 } });
    state = endTurn(state, topology, threeTurnEncryption).nextState;
    expect(state.status).toBe('lost');
    expect(state.lossReason).toBe('domain-controller');
  });

  it('loses on blast radius across the estate', () => {
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }, { id: 'C' }], []);
    // Two of three already encrypted (67% >= 60%). One more turn settles status.
    let state = makeGameState({
      A: { state: 'encrypted', infectedTurns: 3 },
      B: { state: 'encrypted', infectedTurns: 3 },
      C: { state: 'clean', infectedTurns: 0 },
    });
    state = endTurn(state, topology).nextState;
    expect(state.status).toBe('lost');
    expect(state.lossReason).toBe('blast-radius');
  });

  it('accrues score from encrypted bleed each turn', () => {
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }], []);
    let state = makeGameState({
      A: { state: 'encrypted', infectedTurns: 3 },
      B: { state: 'clean', infectedTurns: 0 },
    });
    const before = state.score;
    state = endTurn(state, topology).nextState;
    expect(state.score).toBeGreaterThan(before);
  });

  it('refreshes AP at the start of each turn', () => {
    const topology = makeTopology([{ id: 'A' }], []);
    let state = makeGameState({ A: { state: 'clean', infectedTurns: 0 } }, { ap: 0 });
    state = endTurn(state, topology).nextState;
    expect(state.ap).toBe(SIM_CONFIG.apPerTurn);
  });
});

describe('business pressure', () => {
  // A lone infected node (no cables, so it never spreads or encrypts within a
  // couple of turns) keeps the incident 'playing' so multi-turn pressure tests
  // are not cut short by a win.
  const SENTINEL = { INF: { state: 'infected' as const, infectedTurns: 0 } };

  it('rises while a node is isolated and falls when nothing is', () => {
    const topology = makeTopology([{ id: 'R', type: 'router' }, { id: 'INF' }], []);
    // Isolate the router: weight 18 exceeds recovery 10, so pressure climbs.
    let state = makeGameState({ R: { state: 'clean', infectedTurns: 0, isolated: true }, ...SENTINEL });
    state = endTurn(state, topology).nextState;
    const afterIsolated = state.pressure;
    expect(afterIsolated).toBe(SIM_CONFIG.pressureWeight.router - SIM_CONFIG.pressureRecoveryPerTurn);

    // Nothing isolated now: pressure recovers toward zero.
    state.nodes.R.isolated = false;
    state = endTurn(state, topology).nextState;
    expect(state.pressure).toBeLessThan(afterIsolated);
  });

  it('a router raises pressure faster than a workstation', () => {
    const line = makeTopology([{ id: 'X' }], []);
    const router = makeGameState({ X: { state: 'clean', infectedTurns: 0, isolated: true } });
    const routerTopo = makeTopology([{ id: 'X', type: 'router' }], []);
    const wsAfter = endTurn(router, line).nextState.pressure;
    const rtAfter = endTurn(router, routerTopo).nextState.pressure;
    expect(rtAfter).toBeGreaterThan(wsAfter);
  });

  it('isolation age increments while isolated and resets on reconnect', () => {
    const topology = makeTopology([{ id: 'A' }, { id: 'INF' }], []);
    let state = applyPlayerAction(
      makeGameState({ A: { state: 'clean', infectedTurns: 0 }, ...SENTINEL }),
      { kind: 'isolate', node: 'A' },
      topology,
    ).state;
    expect(state.nodes.A.isolationAge).toBe(0);
    state = endTurn(state, topology).nextState;
    expect(state.nodes.A.isolationAge).toBe(1);
    state = endTurn(state, topology).nextState;
    expect(state.nodes.A.isolationAge).toBe(2);
    state = applyPlayerAction(state, { kind: 'reconnect', node: 'A' }, topology).state;
    expect(state.nodes.A.isolationAge).toBe(0);
  });

  it('a maxed meter force-reconnects the longest-isolated node with a finding', () => {
    const topology = makeTopology([{ id: 'OLD' }, { id: 'NEW' }], []);
    const state = makeGameState(
      {
        OLD: { state: 'clean', infectedTurns: 0, isolated: true, isolationAge: 5 },
        NEW: { state: 'clean', infectedTurns: 0, isolated: true, isolationAge: 1 },
      },
      { pressure: SIM_CONFIG.pressureMax, turn: 7 },
    );
    const result = endTurn(state, topology);
    expect(result.nextState.nodes.OLD.isolated).toBe(false); // oldest forced back
    expect(result.nextState.nodes.NEW.isolated).toBe(true); // newer one kept
    expect(result.events.some((e) => e.kind === 'override' && e.node === 'OLD')).toBe(true);
    expect(result.nextState.findings).toContainEqual({ turn: 7, kind: 'business-override', node: 'OLD' });
  });

  it('steady bleed: still-maxed next turn forces another reconnect', () => {
    // Three routers isolated (load 54) far exceed recovery, so after one forced
    // reconnect the meter is still maxed and forces the next-oldest.
    const topology = makeTopology(
      [{ id: 'A', type: 'router' }, { id: 'B', type: 'router' }, { id: 'C', type: 'router' }, { id: 'INF' }],
      [],
    );
    let state = makeGameState(
      {
        A: { state: 'clean', infectedTurns: 0, isolated: true, isolationAge: 5 },
        B: { state: 'clean', infectedTurns: 0, isolated: true, isolationAge: 4 },
        C: { state: 'clean', infectedTurns: 0, isolated: true, isolationAge: 3 },
        ...SENTINEL,
      },
      { pressure: SIM_CONFIG.pressureMax },
    );
    state = endTurn(state, topology).nextState;
    expect(state.nodes.A.isolated).toBe(false);
    expect(state.pressure).toBe(SIM_CONFIG.pressureMax); // still pinned
    const second = endTurn(state, topology);
    expect(second.events.some((e) => e.kind === 'override' && e.node === 'B')).toBe(true);
  });
});

describe('containment and recovery lifecycle', () => {
  const topology = makeTopology(
    [
      { id: 'VISIBLE', edr: true },
      { id: 'HIDDEN', edr: false },
      { id: 'RTR', type: 'router' },
      { id: 'BK', type: 'backup' },
    ],
    [['VISIBLE', 'HIDDEN']],
  );

  it('a visible infection blocks declaration without spending AP', () => {
    const state = makeCleanGameState(topology);
    state.nodes.VISIBLE = { state: 'infected', infectedTurns: 0 };
    state.ap = 1;

    const result = declareContainment(state, topology, noSpreadConfig);

    expect(result.nextState).toBe(state);
    expect(result.events).toEqual([]);
    expect(result.nextState.ap).toBe(1);
  });

  it('a hidden foothold makes a containment declaration fail without localisation', () => {
    const state = makeCleanGameState(topology);
    state.nodes.HIDDEN = { state: 'infected', infectedTurns: 0 };
    state.ap = 1;

    const result = declareContainment(state, topology, noSpreadConfig);

    expect(result.nextState.phase).toBe('active');
    expect(result.nextState.ap).toBe(noSpreadConfig.apPerTurn);
    expect(result.nextState.turn).toBe(state.turn + 1);
    expect(result.events[0]).toEqual({ kind: 'containment-declaration', confirmed: false });
    expect(result.events[0]).not.toHaveProperty('node');
    expect(result.nextState.findings).toContainEqual({
      turn: state.turn,
      kind: 'premature-declaration',
    });
  });

  it('a clean true estate enters recovery without resolving another hour', () => {
    const state = makeCleanGameState(topology);
    state.ap = 1;

    const result = declareContainment(state, topology);

    expect(result.nextState).toMatchObject({ phase: 'recovery', status: 'playing', ap: 2 });
    expect(result.nextState.turn).toBe(state.turn);
    expect(result.events).toEqual([{ kind: 'containment-declaration', confirmed: true }]);
  });

  it('rejects active-only commands in recovery without spending AP', () => {
    const state = makeCleanGameState(topology);
    state.phase = 'recovery';
    state.ap = 2;

    for (const action of [
      { kind: 'scan' as const, node: 'VISIBLE' },
      { kind: 'isolate' as const, node: 'VISIBLE' },
      { kind: 'patch' as const, node: 'VISIBLE' },
      { kind: 'emergency' as const },
    ]) {
      const result = applyPlayerAction(state, action, topology);
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
      expect(result.events[0]).toMatchObject({ kind: 'action', outcome: 'blocked', apSpent: 0 });
    }
  });

  it('allows only reconnect and restore in recovery', () => {
    const reconnectable = makeCleanGameState(topology);
    reconnectable.phase = 'recovery';
    reconnectable.nodes.RTR.isolated = true;
    const reconnected = applyPlayerAction(reconnectable, { kind: 'reconnect', node: 'RTR' }, topology);
    expect(reconnected.ok).toBe(true);

    const restorable = makeCleanGameState(topology);
    restorable.phase = 'recovery';
    restorable.nodes.VISIBLE = { state: 'infected', infectedTurns: 0 };
    const restored = applyPlayerAction(restorable, { kind: 'restore', node: 'VISIBLE' }, topology);
    expect(restored.ok).toBe(true);
  });

  it('a recovery hour has no threat events but still accrues business accounting', () => {
    const state = makeCleanGameState(topology);
    state.phase = 'recovery';
    state.nodes.RTR = { state: 'clean', infectedTurns: 0, isolated: true, isolationAge: 0 };
    state.pressure = 70;
    const beforeScore = state.score;

    const result = endTurn(state, topology, noSpreadConfig);

    expect(result.events[0]).toEqual({ kind: 'recovery-hour' });
    expect(result.events.some((event) => event.kind === 'spread-attempt' || event.kind === 'encrypted')).toBe(false);
    expect(result.nextState.nodes.RTR.isolationAge).toBe(1);
    expect(result.nextState.pressure).toBeGreaterThan(0);
    expect(result.nextState.score).toBeGreaterThan(beforeScore);
  });

  it('a successful declaration does not accrue pressure or impact', () => {
    const state = makeCleanGameState(topology);
    state.nodes.RTR = { state: 'clean', infectedTurns: 0, isolated: true, isolationAge: 4 };
    state.pressure = 30;
    state.score = 10;

    const result = declareContainment(state, topology);

    expect(result.nextState.pressure).toBe(30);
    expect(result.nextState.score).toBe(10);
    expect(result.nextState.nodes.RTR.isolationAge).toBe(4);
  });

  it('loss takes precedence during recovery accounting', () => {
    const state = makeCleanGameState(topology);
    state.phase = 'recovery';
    state.nodes.BK = { state: 'encrypted', infectedTurns: 3 };
    state.nodes.VISIBLE = { state: 'encrypted', infectedTurns: 3 };
    state.nodes.HIDDEN = { state: 'encrypted', infectedTurns: 3 };

    expect(endTurn(state, topology).nextState.status).toBe('lost');
  });

  it('filing the review is the only successful terminal transition', () => {
    const state = makeCleanGameState(topology);
    state.phase = 'recovery';

    expect(fileReview(state).nextState.status).toBe('won');
    expect(fileReview(makeCleanGameState(topology)).nextState.status).toBe('playing');
  });

  it('a redundant sensor spends nothing', () => {
    const state = makeCleanGameState(topology);
    state.nodes.VISIBLE.revealed = true;

    const result = applyPlayerAction(state, { kind: 'scan', node: 'VISIBLE' }, topology);

    expect(result.ok).toBe(false);
    expect(result.state.ap).toBe(state.ap);
    expect(result.events[0]).toMatchObject({ kind: 'action', outcome: 'blocked', apSpent: 0 });
  });
});

describe('replay determinism (seed + moves)', () => {
  const topology = loadTopology();
  const moves: Move[] = [
    { kind: 'scan', node: 'FIN-SW' },
    { kind: 'isolate', node: 'FINANCE-02' },
    { kind: 'end-turn' },
    { kind: 'patch', node: 'DC-01' },
    { kind: 'emergency' },
    { kind: 'scan', node: 'CORE-RTR' },
    { kind: 'end-turn' },
    { kind: 'end-turn' },
    { kind: 'reconnect', node: 'FINANCE-02' },
    { kind: 'end-turn' },
  ];

  it('two replays of the same seed and moves are byte-identical', () => {
    const a = replay(topology, 'REPLAY', moves);
    const b = replay(topology, 'REPLAY', moves);
    expect(a).toEqual(b);
  });

  it('a different move order diverges', () => {
    const a = replay(topology, 'REPLAY', moves);
    const shuffled: Move[] = [{ kind: 'end-turn' }, ...moves];
    const b = replay(topology, 'REPLAY', shuffled);
    expect(a).not.toEqual(b);
  });

  it('replays declaration, recovery and filing byte-for-byte', () => {
    const recoveryTopology = makeTopology([{ id: 'A' }, { id: 'BK', type: 'backup' }], []);
    const recoveryMoves: Move[] = [
      { kind: 'restore', node: 'A' },
      { kind: 'declare-containment' },
      { kind: 'end-turn' },
      { kind: 'file-review' },
    ];
    const a = replay(recoveryTopology, 'RECOVERY', recoveryMoves, noSpreadConfig);
    const b = replay(recoveryTopology, 'RECOVERY', recoveryMoves, noSpreadConfig);

    expect(a).toEqual(b);
    expect(a.status).toBe('won');
  });

  it('the incident cannot be acted on after it ends', () => {
    const finished = makeGameState(
      Object.fromEntries(topology.nodes.map((node) => [node.id, { state: 'clean' as const, infectedTurns: 0 }])),
      { phase: 'recovery' },
    );
    const state = fileReview(finished).nextState;
    const r = applyPlayerAction(state, { kind: 'scan', node: 'DC-01' }, topology);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/incident is over/);
  });
});
