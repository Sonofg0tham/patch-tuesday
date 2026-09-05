import { describe, expect, test } from 'vitest';
import { makeGameState, makeTopology } from './fixtures';
import { scheduleSpreadAttempts } from './pacing';
import { createRng } from './rng';

function makeFourSourceTopology() {
  return makeTopology(
    [
      { id: 'SRC-1' },
      { id: 'TARGET-1' },
      { id: 'SRC-2' },
      { id: 'TARGET-2' },
      { id: 'SRC-3' },
      { id: 'TARGET-3' },
      { id: 'SRC-4' },
      { id: 'TARGET-4' },
    ],
    [
      ['SRC-1', 'TARGET-1'],
      ['SRC-2', 'TARGET-2'],
      ['SRC-3', 'TARGET-3'],
      ['SRC-4', 'TARGET-4'],
    ],
  );
}

function makeFourSourceState() {
  return makeGameState({
    'SRC-1': { state: 'infected', infectedTurns: 0 },
    'TARGET-1': { state: 'clean', infectedTurns: 0 },
    'SRC-2': { state: 'infected', infectedTurns: 0 },
    'TARGET-2': { state: 'clean', infectedTurns: 0 },
    'SRC-3': { state: 'infected', infectedTurns: 0 },
    'TARGET-3': { state: 'clean', infectedTurns: 0 },
    'SRC-4': { state: 'infected', infectedTurns: 0 },
    'TARGET-4': { state: 'clean', infectedTurns: 0 },
  });
}

describe('spread attempt pacing', () => {
  test('schedules at most one uniformly selected target per source', () => {
    const topology = makeTopology(
      [
        { id: 'SRC-A' },
        { id: 'A-1' },
        { id: 'A-2' },
        { id: 'SRC-B' },
        { id: 'B-1' },
        { id: 'B-2' },
      ],
      [
        ['SRC-A', 'A-1'],
        ['SRC-A', 'A-2'],
        ['SRC-B', 'B-1'],
        ['SRC-B', 'B-2'],
      ],
    );
    const state = makeGameState({
      'SRC-A': { state: 'infected', infectedTurns: 0 },
      'A-1': { state: 'clean', infectedTurns: 0 },
      'A-2': { state: 'clean', infectedTurns: 0 },
      'SRC-B': { state: 'infected', infectedTurns: 0 },
      'B-1': { state: 'clean', infectedTurns: 0 },
      'B-2': { state: 'clean', infectedTurns: 0 },
    });

    const result = scheduleSpreadAttempts(state, topology, createRng(1234), 4);

    expect(result).toEqual({
      eligibleSources: 2,
      eligibleEdges: 4,
      attempts: [
        { source: 'SRC-A', target: 'A-1' },
        { source: 'SRC-B', target: 'B-2' },
      ],
    });
  });

  test('applies the estate cap after seeded candidate shuffling', () => {
    const topology = makeFourSourceTopology();
    const state = makeFourSourceState();

    const result = scheduleSpreadAttempts(state, topology, createRng(99), 3);

    expect(result).toEqual({
      eligibleSources: 4,
      eligibleEdges: 4,
      attempts: [
        { source: 'SRC-2', target: 'TARGET-2' },
        { source: 'SRC-4', target: 'TARGET-4' },
        { source: 'SRC-3', target: 'TARGET-3' },
      ],
    });
  });

  test('excludes isolated sources, isolated targets and non-clean targets', () => {
    const topology = makeTopology(
      [
        { id: 'ISOLATED-SOURCE' },
        { id: 'ISOLATED-SOURCE-TARGET' },
        { id: 'SOURCE' },
        { id: 'ISOLATED-TARGET' },
        { id: 'INFECTED-TARGET' },
        { id: 'PATCHED-TARGET' },
        { id: 'CLEAN-TARGET' },
      ],
      [
        ['ISOLATED-SOURCE', 'ISOLATED-SOURCE-TARGET'],
        ['SOURCE', 'ISOLATED-TARGET'],
        ['SOURCE', 'INFECTED-TARGET'],
        ['SOURCE', 'PATCHED-TARGET'],
        ['SOURCE', 'CLEAN-TARGET'],
      ],
    );
    const state = makeGameState({
      'ISOLATED-SOURCE': { state: 'infected', infectedTurns: 0, isolated: true },
      'ISOLATED-SOURCE-TARGET': { state: 'clean', infectedTurns: 0 },
      SOURCE: { state: 'infected', infectedTurns: 0 },
      'ISOLATED-TARGET': { state: 'clean', infectedTurns: 0, isolated: true },
      'INFECTED-TARGET': { state: 'infected', infectedTurns: 0 },
      'PATCHED-TARGET': { state: 'patched', infectedTurns: 0 },
      'CLEAN-TARGET': { state: 'clean', infectedTurns: 0 },
    });

    expect(scheduleSpreadAttempts(state, topology, createRng(8), 4)).toEqual({
      eligibleSources: 1,
      eligibleEdges: 1,
      attempts: [{ source: 'SOURCE', target: 'CLEAN-TARGET' }],
    });
  });

  test('is deterministic for identical RNG state and changes for another state', () => {
    const topology = makeTopology(
      [
        { id: 'SRC-1' },
        { id: 'A-1' },
        { id: 'A-2' },
        { id: 'SRC-2' },
        { id: 'B-1' },
        { id: 'B-2' },
        { id: 'SRC-3' },
        { id: 'C-1' },
        { id: 'C-2' },
      ],
      [
        ['SRC-1', 'A-1'],
        ['SRC-1', 'A-2'],
        ['SRC-2', 'B-1'],
        ['SRC-2', 'B-2'],
        ['SRC-3', 'C-1'],
        ['SRC-3', 'C-2'],
      ],
    );
    const state = makeGameState({
      'SRC-1': { state: 'infected', infectedTurns: 0 },
      'A-1': { state: 'clean', infectedTurns: 0 },
      'A-2': { state: 'clean', infectedTurns: 0 },
      'SRC-2': { state: 'infected', infectedTurns: 0 },
      'B-1': { state: 'clean', infectedTurns: 0 },
      'B-2': { state: 'clean', infectedTurns: 0 },
      'SRC-3': { state: 'infected', infectedTurns: 0 },
      'C-1': { state: 'clean', infectedTurns: 0 },
      'C-2': { state: 'clean', infectedTurns: 0 },
    });

    const first = scheduleSpreadAttempts(state, topology, createRng(1), 3);
    const replay = scheduleSpreadAttempts(state, topology, createRng(1), 3);
    const different = scheduleSpreadAttempts(state, topology, createRng(2), 3);

    expect(first).toEqual(replay);
    expect(first.attempts).toEqual([
      { source: 'SRC-1', target: 'A-2' },
      { source: 'SRC-2', target: 'B-1' },
      { source: 'SRC-3', target: 'C-2' },
    ]);
    expect(different.attempts).toEqual([
      { source: 'SRC-1', target: 'A-2' },
      { source: 'SRC-3', target: 'C-1' },
      { source: 'SRC-2', target: 'B-1' },
    ]);
  });

  test('does not mutate the caller state', () => {
    const topology = makeFourSourceTopology();
    const state = makeFourSourceState();
    const before = structuredClone(state);

    scheduleSpreadAttempts(state, topology, createRng(99), 3);

    expect(state).toEqual(before);
  });
});
