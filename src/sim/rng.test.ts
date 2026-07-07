import { describe, it, expect } from 'vitest';
import { createRng, hashSeed } from './rng';

describe('rng', () => {
  it('hashes a seed string to a stable 32-bit integer', () => {
    expect(hashSeed('DEMO')).toBe(hashSeed('DEMO'));
    expect(hashSeed('DEMO')).not.toBe(hashSeed('demo'));
    expect(hashSeed('DEMO')).toBeGreaterThanOrEqual(0);
    expect(hashSeed('DEMO')).toBeLessThan(2 ** 32);
  });

  it('produces the identical sequence for the same state', () => {
    const a = createRng(hashSeed('seed-a'));
    const b = createRng(hashSeed('seed-a'));
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(hashSeed('seed-a'));
    const b = createRng(hashSeed('seed-b'));
    expect(a.next()).not.toBe(b.next());
  });

  it('returns floats in [0, 1)', () => {
    const rng = createRng(hashSeed('range'));
    for (let i = 0; i < 1000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('exposes a resumable state', () => {
    const a = createRng(hashSeed('resume'));
    a.next();
    a.next();
    const resumed = createRng(a.state());
    const forked = createRng(a.state());
    expect(resumed.next()).toBe(forked.next());
  });

  it('picks from an array and rejects an empty one', () => {
    const rng = createRng(hashSeed('pick'));
    expect(['x', 'y', 'z']).toContain(rng.pick(['x', 'y', 'z']));
    expect(() => rng.pick([])).toThrow();
  });

  it('chance is roughly calibrated over many trials', () => {
    const rng = createRng(hashSeed('chance'));
    let hits = 0;
    const trials = 20000;
    for (let i = 0; i < trials; i += 1) if (rng.chance(0.6)) hits += 1;
    expect(hits / trials).toBeGreaterThan(0.58);
    expect(hits / trials).toBeLessThan(0.62);
  });
});
