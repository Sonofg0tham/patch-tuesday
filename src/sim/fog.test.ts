import { describe, it, expect } from 'vitest';
import { makeTopology } from './fixtures';
import type { GameState } from './types';
import { toTrueView, toVisibleView, visibleStateOf } from './worm';

describe('fog of war', () => {
  const topology = makeTopology(
    [
      { id: 'COVERED', edr: true },
      { id: 'BLIND', edr: false },
    ],
    [],
  );
  const covered = topology.byId.get('COVERED')!;
  const blind = topology.byId.get('BLIND')!;

  it('reveals an infection on an EDR-covered node', () => {
    expect(visibleStateOf(covered, { state: 'infected', infectedTurns: 1 })).toBe('infected');
  });

  it('hides an infection on an uncovered node until it encrypts', () => {
    expect(visibleStateOf(blind, { state: 'infected', infectedTurns: 2 })).toBe('clean');
    expect(visibleStateOf(blind, { state: 'encrypted', infectedTurns: 3 })).toBe('encrypted');
  });

  it('always shows a clean node as clean', () => {
    expect(visibleStateOf(covered, { state: 'clean', infectedTurns: 0 })).toBe('clean');
    expect(visibleStateOf(blind, { state: 'clean', infectedTurns: 0 })).toBe('clean');
  });

  it('the visible view can differ from the true view (the horror gap)', () => {
    const state: GameState = {
      seed: 's',
      rngState: 0,
      turn: 5,
      nodes: {
        COVERED: { state: 'clean', infectedTurns: 0 },
        BLIND: { state: 'infected', infectedTurns: 2 },
      },
    };
    expect(toVisibleView(state, topology).BLIND).toBe('clean'); // player sees green
    expect(toTrueView(state).BLIND).toBe('infected'); // but it is rotting
  });
});
