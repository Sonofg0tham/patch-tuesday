import { describe, it, expect } from 'vitest';
import { loadTopology } from '../data/topology';
import { SIM_CONFIG } from './config';
import { makeGameState, makeTopology } from './fixtures';
import type { GameState } from './types';
import {
  blastRadius,
  createInitialState,
  encryptedCount,
  infectedCount,
  stepTurn,
} from './worm';

const CONFIG = SIM_CONFIG;

const NO_DWELL = { ...SIM_CONFIG, dwellTurns: 0 };

describe('patient zero', () => {
  it('infects exactly one workstation, deterministically per seed (no dwell)', () => {
    const topology = loadTopology();
    const a = createInitialState(topology, 'DEMO', NO_DWELL);
    const b = createInitialState(topology, 'DEMO', NO_DWELL);
    expect(a).toEqual(b);

    const infected = Object.entries(a.nodes).filter(([, n]) => n.state === 'infected');
    expect(infected).toHaveLength(1);
    const [zeroId] = infected[0];
    expect(topology.byId.get(zeroId)?.type).toBe('workstation');
    expect(a.turn).toBe(1);
  });

  it('varies patient zero across seeds', () => {
    const topology = loadTopology();
    const zeros = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const state = createInitialState(topology, `seed-${i}`, NO_DWELL);
      const [id] = Object.entries(state.nodes).find(([, n]) => n.state === 'infected') ?? [];
      if (id) zeros.add(id);
    }
    expect(zeros.size).toBeGreaterThan(1);
  });
});

describe('dwell time', () => {
  it('hands the player a foothold at T+01h, deterministically', () => {
    const topology = loadTopology();
    const a = createInitialState(topology, 'DWELL', { ...SIM_CONFIG, dwellTurns: 3 });
    const b = createInitialState(topology, 'DWELL', { ...SIM_CONFIG, dwellTurns: 3 });
    expect(a).toEqual(b); // reproducible from the seed

    // The clock is reset to T+01h and the player's resources are untouched.
    expect(a.turn).toBe(1);
    expect(a.ap).toBe(SIM_CONFIG.apPerTurn);
    expect(a.score).toBe(0);
    expect(a.status).toBe('playing');

    // More than one node is compromised: an established foothold.
    const touched = Object.values(a.nodes).filter((n) => n.state !== 'clean' && n.state !== 'patched');
    expect(touched.length).toBeGreaterThan(1);
  });

  it('with dwellTurns 0 leaves a single patient zero', () => {
    const topology = loadTopology();
    const state = createInitialState(topology, 'DWELL', NO_DWELL);
    const infected = Object.values(state.nodes).filter((n) => n.state === 'infected');
    expect(infected).toHaveLength(1);
  });
});

describe('spread mechanics', () => {
  // A infected, B clean, single cable A-B. One step should infect B at ~60%.
  function twoNodeInfectionRate(trials: number): number {
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }], [['A', 'B']]);
    let infected = 0;
    for (let i = 0; i < trials; i += 1) {
      const state = makeGameState(
        { A: { state: 'infected', infectedTurns: 0 }, B: { state: 'clean', infectedTurns: 0 } },
        { seed: `t-${i}` },
      );
      const next = stepTurn(state, topology, CONFIG).nextState;
      if (next.nodes.B.state === 'infected') infected += 1;
    }
    return infected / trials;
  }

  it('infects a clean neighbour at roughly the configured chance', () => {
    const rate = twoNodeInfectionRate(6000);
    expect(rate).toBeGreaterThan(0.56);
    expect(rate).toBeLessThan(0.64);
  });

  it('never spreads from an encrypted node', () => {
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }], [['A', 'B']]);
    for (let i = 0; i < 50; i += 1) {
      const state = makeGameState(
        { A: { state: 'encrypted', infectedTurns: 9 }, B: { state: 'clean', infectedTurns: 0 } },
        { seed: `e${i}` },
      );
      const next = stepTurn(state, topology, CONFIG);
      expect(next.nextState.nodes.B.state).toBe('clean');
    }
  });

  it('does not attempt against a neighbour that is not clean', () => {
    // A infected, its only neighbour B also infected: no clean neighbour to
    // roll against, so no attempts and no new infections.
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }], [['A', 'B']]);
    const state = makeGameState(
      { A: { state: 'infected', infectedTurns: 0 }, B: { state: 'infected', infectedTurns: 0 } },
      { seed: 'waste' },
    );
    const { events } = stepTurn(state, topology, CONFIG);
    expect(events.filter((e) => e.kind === 'spread-attempt')).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'infected')).toHaveLength(0);
  });

  it('rolls against every clean neighbour in one turn (per-cable spread)', () => {
    // A hub infected, three clean leaves: with a high chance it should infect
    // more than one in a single turn, which one-cable spread could never do.
    const topology = makeTopology(
      [{ id: 'HUB' }, { id: 'L1' }, { id: 'L2' }, { id: 'L3' }],
      [['HUB', 'L1'], ['HUB', 'L2'], ['HUB', 'L3']],
    );
    const greedy = { ...CONFIG, spreadChance: 1 };
    const state = makeGameState(
      {
        HUB: { state: 'infected', infectedTurns: 0 },
        L1: { state: 'clean', infectedTurns: 0 },
        L2: { state: 'clean', infectedTurns: 0 },
        L3: { state: 'clean', infectedTurns: 0 },
      },
      { seed: 'hub' },
    );
    const next = stepTurn(state, topology, greedy).nextState;
    expect(next.nodes.L1.state).toBe('infected');
    expect(next.nodes.L2.state).toBe('infected');
    expect(next.nodes.L3.state).toBe('infected');
  });
});

describe('encryption clock', () => {
  it('encrypts a node after exactly the configured number of infected turns', () => {
    // Isolated infected node with no neighbours: it just ages and encrypts.
    const topology = makeTopology([{ id: 'A' }], []);
    let state: GameState = makeGameState({ A: { state: 'infected', infectedTurns: 0 } }, { seed: 'clock' });
    // After turns 1 and 2 it is still infected; after turn 3 it encrypts.
    state = stepTurn(state, topology, CONFIG).nextState;
    expect(state.nodes.A.state).toBe('infected');
    state = stepTurn(state, topology, CONFIG).nextState;
    expect(state.nodes.A.state).toBe('infected');
    const third = stepTurn(state, topology, CONFIG);
    expect(third.nextState.nodes.A.state).toBe('encrypted');
    expect(third.events.some((e) => e.kind === 'encrypted' && e.node === 'A')).toBe(true);
  });
});

describe('determinism', () => {
  it('produces byte-identical state after 20 turns from the same seed', () => {
    const topology = loadTopology();
    const run = (): GameState => {
      let state = createInitialState(topology, 'DETERMINISM');
      for (let i = 0; i < 20; i += 1) state = stepTurn(state, topology).nextState;
      return state;
    };
    expect(run()).toEqual(run());
  });

  it('diverges for different seeds', () => {
    const topology = loadTopology();
    const run = (seed: string): GameState => {
      let state = createInitialState(topology, seed);
      for (let i = 0; i < 20; i += 1) state = stepTurn(state, topology).nextState;
      return state;
    };
    expect(run('seed-x')).not.toEqual(run('seed-y'));
  });
});

describe('instrumentation', () => {
  it('counts infected, encrypted and blast radius', () => {
    const state = makeGameState({
      A: { state: 'encrypted', infectedTurns: 3 },
      B: { state: 'infected', infectedTurns: 1 },
      C: { state: 'clean', infectedTurns: 0 },
      D: { state: 'encrypted', infectedTurns: 3 },
    });
    expect(encryptedCount(state)).toBe(2);
    expect(infectedCount(state)).toBe(1);
    expect(blastRadius(state)).toBe(0.5);
  });
});
