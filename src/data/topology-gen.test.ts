import { describe, expect, it } from 'vitest';
import { generateTopology } from './topology-gen';
import { NODE_TYPES, type Topology } from './topology';
import { GEN_CONFIG } from '../sim/config';

// Breadth-first reachability: a board is fully connected iff every node is
// reached from the first.
function isConnected(t: Topology): boolean {
  const seen = new Set<string>([t.nodes[0].id]);
  const queue = [t.nodes[0].id];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const n of t.byId.get(id)?.neighbours ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === t.nodes.length;
}

const SEEDS = Array.from({ length: 24 }, (_, i) => `seed-${i}`);

describe('procedural topology generator', () => {
  it('produces exactly the configured node count on every seed', () => {
    for (const seed of SEEDS) {
      expect(generateTopology(seed).nodes.length).toBe(GEN_CONFIG.nodeCount);
    }
  });

  it('is fully connected on every seed', () => {
    for (const seed of SEEDS) {
      expect(isConnected(generateTopology(seed))).toBe(true);
    }
  });

  it('holds the type proportions from the design (1 DC, 1 backup, 3-4 routers, 4-6 servers)', () => {
    for (const seed of SEEDS) {
      const t = generateTopology(seed);
      const count = (type: string): number => t.nodes.filter((n) => n.type === type).length;
      expect(count('domain-controller')).toBe(1);
      expect(count('backup')).toBe(1);
      expect(count('router')).toBeGreaterThanOrEqual(GEN_CONFIG.routers[0]);
      expect(count('router')).toBeLessThanOrEqual(GEN_CONFIG.routers[1]);
      expect(count('server')).toBeGreaterThanOrEqual(GEN_CONFIG.servers[0]);
      expect(count('server')).toBeLessThanOrEqual(GEN_CONFIG.servers[1]);
      // Every type used is a known type.
      for (const n of t.nodes) expect(NODE_TYPES).toContain(n.type);
    }
  });

  it('lays every node on a distinct grid cell (legible, no overlap)', () => {
    for (const seed of SEEDS) {
      const t = generateTopology(seed);
      const cells = new Set(t.nodes.map((n) => `${n.col},${n.row}`));
      expect(cells.size).toBe(t.nodes.length);
    }
  });

  it('leaves a meaningful EDR gap (a blind segment) and roughly the target coverage', () => {
    for (const seed of SEEDS) {
      const t = generateTopology(seed);
      const covered = t.nodes.filter((n) => n.edr).length;
      // Coverage lands near the target but never total: a gap always exists.
      expect(covered).toBeLessThan(t.nodes.length);
      expect(covered).toBeGreaterThanOrEqual(Math.round(GEN_CONFIG.edrCoverage * t.nodes.length) - 2);
      // At least one uncovered segment switch: the classic blind spot.
      const blindSwitch = t.nodes.some(
        (n) => n.type === 'router' && !n.edr && n.id !== 'CORE-RTR',
      );
      expect(blindSwitch).toBe(true);
    }
  });

  it('keeps at least one leaf workstation, so patient zero has an edge to land on', () => {
    for (const seed of SEEDS) {
      const t = generateTopology(seed);
      const leafWs = t.nodes.some((n) => n.type === 'workstation' && n.neighbours.length === 1);
      expect(leafWs).toBe(true);
    }
  });

  it('is deterministic: the same seed yields an identical board', () => {
    const a = generateTopology('repeat-me');
    const b = generateTopology('repeat-me');
    const shape = (t: Topology): string =>
      JSON.stringify({
        nodes: t.nodes.map((n) => [n.id, n.type, n.edr, n.col, n.row]),
        cables: t.cables.map((c) => [c.a, c.b]),
      });
    expect(shape(a)).toBe(shape(b));
  });

  it('holds the balance-gated tree density (no cross-segment cycles) by default', () => {
    // extraEdges is pinned to zero by the gate, so every board is a spanning tree.
    for (const seed of SEEDS) {
      const t = generateTopology(seed);
      expect(t.cables.length).toBe(t.nodes.length - 1);
    }
  });
});
