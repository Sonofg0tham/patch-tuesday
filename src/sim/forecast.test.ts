import { describe, expect, it } from 'vitest';
import { makeGameState, makeTopology } from './fixtures';
import { forecastSpread } from './forecast';
import { toPresentationView, type PresentationView } from './telemetry';
import type { NodeState, VisibleState } from './types';

const node = (over: Partial<NodeState> = {}): NodeState => ({
  state: 'clean',
  infectedTurns: 0,
  ...over,
});

const presentation = (
  visible: Record<string, VisibleState>,
  isolated: readonly string[] = [],
): PresentationView => ({
  nodes: Object.fromEntries(
    Object.entries(visible).map(([id, visibleState]) => [
      id,
      {
        id,
        visibleState,
        observed: true,
        isolated: isolated.includes(id),
        isolationAge: 0,
        edr: true,
      },
    ]),
  ),
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
    const view = presentation({
      A: 'clean',
      B: 'infected',
      C: 'clean',
      D: 'clean',
    });

    const forecast = forecastSpread(view, topology);
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
    const visible: Record<string, VisibleState> = { A: 'clean', B: 'infected', C: 'clean' };

    // Isolating the target cuts its cable.
    const targetCut = presentation(visible, ['A']);
    expect(forecastSpread(targetCut, topology).atRisk).toEqual(['C']);

    // Isolating the source cuts everything it touches.
    const sourceCut = presentation(visible, ['B']);
    expect(forecastSpread(sourceCut, topology).atRisk).toEqual([]);
  });

  it('ignores encrypted sources, which have stopped spreading', () => {
    const topology = makeTopology([{ id: 'A' }, { id: 'B' }], [['A', 'B']]);
    const view = presentation({ A: 'encrypted', B: 'clean' });
    expect(forecastSpread(view, topology).atRisk).toEqual([]);
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
    const view = presentation({
      SRC: 'infected',
      P: 'patched',
      E: 'encrypted',
      I: 'infected',
    });
    expect(forecastSpread(view, topology).atRisk).toEqual([]);
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

    const view = toPresentationView(state, topology);
    expect(view.nodes.DARK.visibleState).toBe('clean'); // the fog is doing its job
    expect(forecastSpread(view, topology).atRisk).toEqual([]);

    // Deploy a sensor on it and the same real danger becomes visible.
    const revealed = makeGameState({
      DARK: node({ state: 'infected', revealed: true }),
      LIT: node(),
      NEIGHBOUR: node(),
    });
    const revealedView = toPresentationView(revealed, topology);
    expect(revealedView.nodes.DARK.visibleState).toBe('infected');
    expect(forecastSpread(revealedView, topology).atRisk).toEqual(['NEIGHBOUR']);
  });

  it('returns the same forecast for a hidden infection and a genuinely clean blind node', () => {
    const topology = makeTopology(
      [
        { id: 'BLIND', edr: false },
        { id: 'NEIGHBOUR', edr: true },
      ],
      [['BLIND', 'NEIGHBOUR']],
    );
    const hidden = toPresentationView(
      makeGameState({
        BLIND: node({ state: 'infected' }),
        NEIGHBOUR: node(),
      }),
      topology,
    );
    const clean = toPresentationView(
      makeGameState({
        BLIND: node(),
        NEIGHBOUR: node(),
      }),
      topology,
    );

    expect(hidden).toEqual(clean);
    expect(forecastSpread(hidden, topology)).toEqual(forecastSpread(clean, topology));
  });

  it('does not double-count a node threatened from two directions', () => {
    const topology = makeTopology(
      [{ id: 'L' }, { id: 'MID' }, { id: 'R' }],
      [
        ['L', 'MID'],
        ['R', 'MID'],
      ],
    );
    const view = presentation({ L: 'infected', MID: 'clean', R: 'infected' });
    const forecast = forecastSpread(view, topology);
    expect(forecast.atRisk).toEqual(['MID']);
    // Both routes are still reported, so the board can show it is pincered.
    expect(forecast.edges).toHaveLength(2);
  });
});
