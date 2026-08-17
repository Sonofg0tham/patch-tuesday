import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeTopology } from '../sim/fixtures';
import { ActionEffectPool, type ActionEffectAction } from './action-effects';

const ACTIONS: readonly ActionEffectAction[] = [
  'scan',
  'isolate',
  'reconnect',
  'patch',
  'restore',
  'emergency',
];

function topology() {
  return makeTopology([{ id: 'NODE-A', edr: false }], []);
}

describe('pooled player action effects', () => {
  it('requires targets for node actions and centres Emergency Budget', () => {
    let now = 0;
    const pool = new ActionEffectPool(topology(), { now: () => now });

    expect(() => pool.play('scan')).toThrow('scan requires a node id');
    expect(() => pool.play('emergency', 'NODE-A')).toThrow('emergency does not accept a node id');
    expect(pool.play('emergency')).toBe(true);
    const emergency = pool.group.getObjectByName('action-effect-emergency') as THREE.Group;
    expect(emergency.position.toArray()).toEqual([0, 0, 0]);

    now += 2;
    expect(() => pool.play('patch', 'MISSING')).toThrow('unknown node id MISSING');
  });

  it('preallocates six genuinely distinct geometry signatures', () => {
    let now = 0;
    const pool = new ActionEffectPool(topology(), { now: () => now });
    const signatures: string[] = [];

    for (const action of ACTIONS) {
      now += 1.1;
      expect(pool.play(action, action === 'emergency' ? undefined : 'NODE-A')).toBe(true);
      const effect = pool.group.getObjectByName(`action-effect-${action}`) as THREE.Group;
      const geometryKinds: string[] = [];
      effect.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          geometryKinds.push(`${object.type}:${object.geometry.type}`);
        }
      });
      signatures.push(geometryKinds.join('|'));
    }

    expect(pool.group.children).toHaveLength(6);
    expect(new Set(signatures).size).toBe(ACTIONS.length);
  });

  it('places scan, patch and restore above tall chassis while link work stays at the base', () => {
    let now = 0;
    const tall = makeTopology([{ id: 'RACK', type: 'server', edr: true }], []);
    const pool = new ActionEffectPool(tall, { now: () => now });

    for (const action of ['scan', 'patch', 'restore'] as const) {
      now += 1.1;
      expect(pool.play(action, 'RACK')).toBe(true);
      expect(pool.group.getObjectByName(`action-effect-${action}`)?.position.y).toBeGreaterThan(2);
    }
    for (const action of ['isolate', 'reconnect'] as const) {
      now += 1.1;
      expect(pool.play(action, 'RACK')).toBe(true);
      expect(pool.group.getObjectByName(`action-effect-${action}`)?.position.y).toBe(0);
    }
  });

  it('caps starts below three per rolling second without growing the pool', () => {
    let now = 0;
    const pool = new ActionEffectPool(topology(), { now: () => now });
    const size = pool.group.children.length;

    expect(pool.play('scan', 'NODE-A')).toBe(true);
    now = 0.2;
    expect(pool.play('isolate', 'NODE-A')).toBe(true);
    now = 0.4;
    expect(pool.play('reconnect', 'NODE-A')).toBe(false);
    now = 1.01;
    expect(pool.play('reconnect', 'NODE-A')).toBe(true);
    expect(pool.group.children).toHaveLength(size);
  });

  it('settles live effects when reduced motion changes and honours later changes', () => {
    let now = 0;
    const pool = new ActionEffectPool(topology(), { now: () => now });
    expect(pool.play('restore', 'NODE-A')).toBe(true);
    const effect = pool.group.getObjectByName('action-effect-restore') as THREE.Group;
    const before = effect.children.map((child) => ({
      position: child.position.toArray(),
      rotation: child.rotation.toArray(),
      scale: child.scale.toArray(),
    }));

    now = 0.2;
    pool.tick(now);
    const travelling = effect.children.map((child) => ({
      position: child.position.toArray(),
      rotation: child.rotation.toArray(),
      scale: child.scale.toArray(),
    }));
    expect(travelling).not.toEqual(before);

    pool.setReducedMotion(true);
    const settled = effect.children.map((child) => ({
      position: child.position.toArray(),
      rotation: child.rotation.toArray(),
      scale: child.scale.toArray(),
    }));
    now = 0.35;
    pool.tick(now);
    expect(
      effect.children.map((child) => ({
        position: child.position.toArray(),
        rotation: child.rotation.toArray(),
        scale: child.scale.toArray(),
      })),
    ).toEqual(settled);

    now = 1.2;
    expect(pool.play('scan', 'NODE-A')).toBe(true);
    const scan = pool.group.getObjectByName('action-effect-scan') as THREE.Group;
    const reducedScan = scan.children.map((child) => child.rotation.toArray());
    now = 1.4;
    pool.tick(now);
    expect(scan.children.map((child) => child.rotation.toArray())).toEqual(reducedScan);

    pool.setReducedMotion(false);
    now = 1.45;
    pool.tick(now);
    expect(Math.abs(scan.children[1].rotation.z)).toBeLessThan(1);
    now = 2.3;
    expect(pool.play('reconnect', 'NODE-A')).toBe(true);
    const reconnect = pool.group.getObjectByName('action-effect-reconnect') as THREE.Group;
    const resumed = reconnect.children.map((child) => child.position.toArray());
    now = 2.5;
    pool.tick(now);
    expect(reconnect.children.map((child) => child.position.toArray())).not.toEqual(resumed);
  });

  it('disposes every pooled geometry and material', () => {
    const pool = new ActionEffectPool(topology());
    const geometrySpies: ReturnType<typeof vi.spyOn>[] = [];
    const materialSpies: ReturnType<typeof vi.spyOn>[] = [];
    const seenGeometry = new Set<THREE.BufferGeometry>();
    const seenMaterial = new Set<THREE.Material>();
    pool.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      if (!seenGeometry.has(object.geometry)) {
        seenGeometry.add(object.geometry);
        geometrySpies.push(vi.spyOn(object.geometry, 'dispose'));
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (seenMaterial.has(material)) continue;
        seenMaterial.add(material);
        materialSpies.push(vi.spyOn(material, 'dispose'));
      }
    });

    pool.dispose();

    expect(geometrySpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(materialSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  });
});
