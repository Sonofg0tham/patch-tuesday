import { describe, it, expect } from 'vitest';
import { loadTopology } from '../data/topology';
import { greedyBot, randomBot, runBot } from './bots';

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
});
