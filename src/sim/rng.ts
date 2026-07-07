// Seeded deterministic PRNG. The same seed always produces the same run,
// which is what makes the simulation reproducible for debugging and testable.
//
// The RNG state is a single 32-bit integer, carried inside the game state so a
// run is fully serialisable. xmur3 hashes a string seed into that integer,
// mulberry32 is the stream. Both are small, well-known, and have no
// dependencies. This module imports nothing.

// Hashes a string into a 32-bit seed integer. One xmur3 output is enough to
// seed mulberry32.
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

// A cursor over the mulberry32 stream. Created from a state integer, stepped as
// values are drawn, and its final state read back so the caller can persist it.
// Keeping the draw logic in one place means the whole sim consumes randomness
// through the same deterministic path.
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** True with probability p (0..1). */
  chance(p: number): boolean;
  /** A uniformly random element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** The current state integer, for persisting back into game state. */
  state(): number;
}

export function createRng(state: number): Rng {
  let s = state >>> 0;

  function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    chance(p) {
      return next() < p;
    },
    pick(items) {
      if (items.length === 0) throw new Error('cannot pick from an empty array');
      return items[Math.floor(next() * items.length)];
    },
    state() {
      return s >>> 0;
    },
  };
}
