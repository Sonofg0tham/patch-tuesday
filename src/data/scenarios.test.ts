import { describe, expect, it } from 'vitest';
import { MERIDIAN, RANDOM, scenarioById } from './scenarios';

describe('scenarios', () => {
  it('resolves ids, falling back to the hand-authored board', () => {
    expect(scenarioById('meridian').id).toBe('meridian');
    expect(scenarioById('random').id).toBe('random');
    expect(scenarioById(null).id).toBe('meridian');
    expect(scenarioById('nonsense').id).toBe('meridian');
  });

  it('builds the hand-authored board', () => {
    const t = MERIDIAN.build('ignored');
    expect(t.name).toContain('MERIDIAN');
    expect(t.nodes.length).toBe(24);
  });

  it('builds a deterministic procedural board from the seed', () => {
    const a = RANDOM.build('seed-a');
    const b = RANDOM.build('seed-a');
    expect(a.nodes.length).toBe(24);
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id));
    expect(RANDOM.build('seed-b').name).not.toBe(a.name);
  });
});
