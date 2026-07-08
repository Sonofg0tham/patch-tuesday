import { describe, it, expect } from 'vitest';
import { loadTopology } from '../data/topology';
import { SIM_CONFIG } from './config';
import { makeGameState, makeTopology } from './fixtures';
import { applyPlayerAction, endTurn, replay } from './game';
import type { Move } from './types';
import { stepTurn, visibleStateOf } from './worm';

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

  it('the failed patch probe reveals a hidden infection and costs 1 AP', () => {
    const state = makeGameState({ A: { state: 'infected', infectedTurns: 1 }, B: { state: 'clean', infectedTurns: 0 }, BK: { state: 'clean', infectedTurns: 0 } });
    const r = applyPlayerAction(state, { kind: 'patch', node: 'A' }, topology);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/infected/);
    expect(r.state.nodes.A.revealed).toBe(true); // fog pierced
    expect(r.state.ap).toBe(SIM_CONFIG.apPerTurn - 1); // probe cost, not 2
    expect(r.state.nodes.A.state).toBe('infected'); // not patched
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
  it('wins when no infected nodes remain (worm contained below the loss line)', () => {
    // Three-node estate: one isolated infected node burns out to encrypted
    // (33% blast, under the 60% loss line), leaving no infected. Contained.
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }, { id: 'C' }], []);
    let state = makeGameState({
      A: { state: 'infected', infectedTurns: 2, isolated: true },
      B: { state: 'clean', infectedTurns: 0 },
      C: { state: 'clean', infectedTurns: 0 },
    });
    state = endTurn(state, topology).nextState; // A -> encrypted, no infected left
    expect(state.status).toBe('won');
  });

  it('loses when the domain controller is encrypted', () => {
    const topology = makeTopology([{ id: 'DC', type: 'domain-controller' }], []);
    let state = makeGameState({ DC: { state: 'infected', infectedTurns: 2 } });
    state = endTurn(state, topology).nextState;
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

  it('the incident cannot be acted on after it ends', () => {
    // Undefended run to a terminal state, then an action must be refused.
    const state = replay(topology, 'S51', Array.from({ length: 25 }, () => ({ kind: 'end-turn' as const })));
    expect(state.status).not.toBe('playing');
    const r = applyPlayerAction(state, { kind: 'scan', node: 'DC-01' }, topology);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/incident is over/);
  });
});
