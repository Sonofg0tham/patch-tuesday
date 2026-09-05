import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CompanyLayer, equipmentStatus, previewLinks } from './company';
import { loadTopology } from '../data/topology';
import { generateTopology } from '../data/topology-gen';
import { createInitialState } from '../sim/worm';
import { toPresentationView, type NodePresentationState } from '../sim/telemetry';
import { noticeForEvent } from '../ui/asset-notices';

function snapshot(layer: CompanyLayer): unknown[] {
  const result: unknown[] = [];
  layer.group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      result.push({ name: object.name, count: object.count, matrix: Array.from(object.instanceMatrix.array) });
    } else if (object instanceof THREE.Mesh) result.push({ name: object.name, visible: object.visible, colour: (object.material as THREE.MeshBasicMaterial).color.getHex() });
  });
  return result;
}

describe('miniature company presentation', () => {
  it('renders hidden infection identically to an uncovered clean asset, including previews', () => {
    const topology = loadTopology();
    const clean = createInitialState(topology, 'company-fog');
    const id = topology.nodes.find((node) => !node.edr)!.id;
    clean.nodes[id] = { ...clean.nodes[id], state: 'clean', infectedTurns: 0, revealed: false };
    const infected = structuredClone(clean);
    infected.nodes[id] = { ...infected.nodes[id], state: 'infected', infectedTurns: 5 };
    const a = toPresentationView(clean, topology);
    const b = toPresentationView(infected, topology);
    expect(a).toEqual(b);
    const layer = new CompanyLayer(topology);
    layer.apply(a);
    layer.preview(id, 'isolate');
    const before = snapshot(layer);
    layer.apply(b);
    layer.preview(id, 'isolate');
    expect(snapshot(layer)).toEqual(before);
    layer.dispose();
  });

  it('keeps offline barriers after actions and restores them only from public state', () => {
    const topology = loadTopology();
    const view = toPresentationView(createInitialState(topology, 'offline'), topology);
    const id = 'SRV-MAIL';
    const layer = new CompanyLayer(topology);
    view.nodes[id].isolated = true;
    layer.apply(view);
    layer.tick(1000, true);
    expect((layer.group.getObjectByName('offline-port-barriers') as THREE.InstancedMesh).count).toBe(1);
    expect(layer.group.getObjectByName('disconnected-plugs-CORE-RTR-SRV-MAIL')!.visible).toBe(true);
    layer.preview(id, 'reconnect');
    expect(layer.group.getObjectByName('company-route-CORE-RTR-SRV-MAIL')!.visible).toBe(true);
    layer.preview(id, null);
    expect(layer.group.getObjectByName('company-route-CORE-RTR-SRV-MAIL')!.visible).toBe(false);
    view.nodes[id].isolated = false;
    layer.apply(view);
    expect((layer.group.getObjectByName('offline-port-barriers') as THREE.InstancedMesh).count).toBe(0);
    expect(layer.group.getObjectByName('disconnected-plugs-CORE-RTR-SRV-MAIL')!.visible).toBe(false);
    layer.dispose();
  });

  it('previews only links that the selected action would change', () => {
    const topology = loadTopology();
    const view = toPresentationView(createInitialState(topology, 'links'), topology);
    expect(previewLinks(topology, view, 'CORE-RTR', 'isolate')).toHaveLength(9);
    view.nodes['SRV-MAIL'].isolated = true;
    expect(previewLinks(topology, view, 'CORE-RTR', 'isolate')).toHaveLength(8);
    expect(previewLinks(topology, view, 'CORE-RTR', 'restore')).toEqual([]);
    expect(previewLinks(topology, view, 'CORE-RTR', 'reconnect')).toEqual([]);
    view.nodes['CORE-RTR'].isolated = true;
    expect(previewLinks(topology, view, 'CORE-RTR', 'isolate')).toEqual([]);
    expect(previewLinks(topology, view, 'CORE-RTR', 'reconnect')).toHaveLength(8);
  });

  it('has distinct still displays and never hides observed compromise behind offline state', () => {
    const node: NodePresentationState = { id: 'node', observed: true, edr: true, isolated: false, isolationAge: 0, visibleState: 'clean' };
    expect(equipmentStatus(node)).toBe('online');
    expect(equipmentStatus({ ...node, observed: false })).toBe('unknown');
    expect(equipmentStatus({ ...node, isolated: true })).toBe('offline');
    expect(equipmentStatus({ ...node, visibleState: 'infected', isolated: true })).toBe('infected');
    expect(equipmentStatus({ ...node, visibleState: 'encrypted', isolated: true })).toBe('encrypted');
    expect(equipmentStatus({ ...node, visibleState: 'patched' })).toBe('patched');
  });

  it('persists sensor fittings and patch protection, and never clears compromise during a restart', () => {
    const topology = loadTopology();
    const view = toPresentationView(createInitialState(topology, 'equipment'), topology);
    const id = topology.nodes.find((node) => !node.edr)!.id;
    const layer = new CompanyLayer(topology);
    view.nodes[id] = { ...view.nodes[id], observed: true, visibleState: 'infected', edr: true };
    layer.apply(view);
    const sensors = layer.group.getObjectByName('deployed-sensor-fittings') as THREE.InstancedMesh;
    const infected = layer.group.getObjectByName('equipment-display-infected') as THREE.InstancedMesh;
    const count = infected.count;
    layer.restart(id, 10, false);
    expect(sensors.count).toBe(1);
    expect(infected.count).toBe(count);
    layer.tick(20, false);
    expect(infected.count).toBe(count);
    view.nodes[id].visibleState = 'patched';
    layer.apply(view);
    layer.tick(1000, true);
    expect((layer.group.getObjectByName('equipment-display-patched') as THREE.InstancedMesh).count).toBeGreaterThan(0);
    expect(infected.count).toBe(count - 1);
    expect(sensors.count).toBe(1);
    layer.dispose();
  });

  it('keeps batched furniture inside cell bounds and selectable on generated estates', () => {
    for (const seed of ['desks', 'rooms', 'company', 'office', 'backup']) {
      const topology = generateTopology(seed);
      const layer = new CompanyLayer(topology);
      const selectable = new Set<string>();
      for (const mesh of layer.pickMeshes) {
        mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox!;
        expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThan(topology.spacing / 2);
        (mesh.userData.assetIds as string[]).forEach((id) => selectable.add(id));
      }
      expect(selectable.size).toBe(topology.nodes.length);
      const view = toPresentationView(createInitialState(topology, seed), topology);
      layer.apply(view);
      const count = layer.group.children.length;
      for (let i = 0; i < 50; i++) { layer.apply(view); layer.preview(topology.nodes[0].id, 'scan'); }
      expect(layer.group.children.length).toBe(count);
      const dispose = vi.spyOn(layer.pickMeshes[0].geometry, 'dispose');
      layer.dispose();
      layer.dispose();
      expect(dispose).toHaveBeenCalledOnce();
    }
  });

  it('never localises anonymous telemetry or an unsuccessful action', () => {
    expect(noticeForEvent({ kind: 'telemetry-gap', attempts: 3 })).toBeNull();
    expect(noticeForEvent({ kind: 'containment-declaration', confirmed: false })).toBeNull();
    expect(noticeForEvent({ kind: 'action', action: 'patch', outcome: 'probe', node: 'FIN-01', apSpent: 1 })?.tone).toBe('threat');
    expect(noticeForEvent({ kind: 'action', action: 'isolate', outcome: 'applied', node: 'MAIL', apSpent: 1 })?.text).toContain('offline');
  });
});
