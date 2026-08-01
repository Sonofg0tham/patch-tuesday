import { describe, expect, it } from 'vitest';
import { makeGameState, makeTopology } from './fixtures';
import { forecastSpread } from './forecast';
import { toVisibleView } from './worm';
import type { NodeState, VisibleState } from './types';

const node = (over: Partial<NodeState> = {}): NodeState => ({
  state: 'clean',
  infectedTurns: 0,
  ...over,
});

describe('the threat forecast', () => {
  it('marks the clean neighbours of a visibly infected node', () => {
    const topology = makeTopology(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
      ],
    );
    const view: Record<string, VisibleState> = {
      A: 'clean',
      B: 'infected',
      C: 'clean',
      D: 'clean',
    };
    const state = makeGameState({
      A: node(),
      B: node({ state: 'infected' }),
      C: node(),
      D: node(),
    });

    const forecast = forecastSpread(view, state, topology);
    expect(forecast.atRisk).toEqual(['A', 'C']);
    // D is two hops away, so it is not reachable next turn.
    expect(forecast.atRisk).not.toContain('D');
    expect(forecast.edges).toHaveLength(2);
  });

  it('respects isolation in both directions, exactly as the spread does', () => {
    const topology = makeTopology(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );
    const view: Record<string, VisibleState> = { A: 'clean', B: 'infected', C: 'clean' };

    // Isolating the target cuts its cable.
    const targetCut = makeGameState({
      A: node({ isolated: true }),
      B: node({ state: 'infected' }),
      C: node(),
    });
    expect(forecastSpread(view, targetCut, topology).atRisk).toEqual(['C']);

    // Isolating the source cuts everything it touches.
    const sourceCut = makeGameState({
      A: node(),
      B: node({ state: 'infected', isolated: true }),
      C: node(),
    });
    expect(forecastSpread(view, sourceCut, topology).atRisk).toEqual([]);
  });

  it('ignores encrypted sources, which have stopped spreading', () => {
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }], [['A', 'B']]);
    const view: Record<string, VisibleState> = { A: 'encrypted', B: 'clean' };
    const state = makeGameState({ A: node({ state: 'encrypted' }), B: node() });
    expect(forecastSpread(view, state, topology).atRisk).toEqual([]);
  });

  it('never marks a patched or already-compromised neighbour', () => {
    const topology = makeTopology(
      [{ id: 'SRC' }, { id: 'P' }, { id: 'E' }, { id: 'I' }],
      [
        ['SRC', 'P'],
        ['SRC', 'E'],
        ['SRC', 'I'],
      ],
    );
    const view: Record<string, VisibleState> = {
      SRC: 'infected',
      P: 'patched',
      E: 'encrypted',
      I: 'infected',
    };
    const state = makeGameState({
      SRC: node({ state: 'infected' }),
      P: node({ state: 'patched' }),
      E: node({ state: 'encrypted' }),
      I: node({ state: 'infected' }),
    });
    expect(forecastSpread(view, state, topology).atRisk).toEqual([]);
  });

  it('stays blind where the EDR coverage is, and never leaks the fog', () => {
    // The whole point. An infection on an uncovered node reads clean, so the
    // forecast cannot see it and gives the player no warning. If this test ever
    // fails, the forecast has become an x-ray and design pillar 2 is dead.
    const topology = makeTopology(
      [
        { id: 'DARK', edr: false },
        { id: 'LIT', edr: true },
        { id: 'NEIGHBOUR', edr: true },
      ],
      [
        ['DARK', 'NEIGHBOUR'],
        ['LIT', 'NEIGHBOUR'],
      ],
    );
    const state = makeGameState({
      DARK: node({ state: 'infected' }), // really infected, but nothing is watching
      LIT: node(),
      NEIGHBOUR: node(),
    });

    const view = toVisibleView(state, topology);
    expect(view.DARK).toBe('clean'); // the fog is doing its job
    expect(forecastSpread(view, state, topology).atRisk).toEqual([]);

    // Deploy a sensor on it and the same real danger becomes visible.
    const revealed = makeGameState({
      DARK: node({ state: 'infected', revealed: true }),
      LIT: node(),
      NEIGHBOUR: node(),
    });
    const revealedView = toVisibleView(revealed, topology);
    expect(revealedView.DARK).toBe('infected');
    expect(forecastSpread(revealedView, revealed, topology).atRisk).toEqual(['NEIGHBOUR']);
  });

  it('does not double-count a node threatened from two directions', () => {
    const topology = makeTopology(
      [{ id: 'L' }, { id: 'MID' }, { id: 'R' }],
      [
        ['L', 'MID'],
        ['R', 'MID'],
      ],
    );
    const view: Record<string, VisibleState> = { L: 'infected', MID: 'clean', R: 'infected' };
    const state = makeGameState({
      L: node({ state: 'infected' }),
      MID: node(),
      R: node({ state: 'infected' }),
    });
    const forecast = forecastSpread(view, state, topology);
    expect(forecast.atRisk).toEqual(['MID']);
    // Both routes are still reported, so the board can show it is pincered.
    expect(forecast.edges).toHaveLength(2);
  });
});
