import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COMPANY, EQUIPMENT } from '../config/company';
import { NODE_TYPES, type Topology, type NodeType } from '../data/topology';
import type { NodePresentationState, PresentationView } from '../sim/telemetry';
import type { ActionKind } from '../sim/types';

export type EquipmentStatus = 'unknown' | 'online' | 'infected' | 'encrypted' | 'patched' | 'offline';

export function equipmentStatus(node: NodePresentationState): EquipmentStatus {
  // Offline is a connection state. Observable compromise keeps its own glyph.
  if (node.visibleState === 'encrypted') return 'encrypted';
  if (node.observed && node.visibleState === 'infected') return 'infected';
  if (node.isolated) return 'offline';
  if (!node.observed) return 'unknown';
  return node.visibleState === 'patched' ? 'patched' : 'online';
}

export function previewLinks(topology: Topology, view: PresentationView, id: string | null, action: ActionKind | null): string[] {
  if (!id || (action !== null && action !== 'isolate' && action !== 'reconnect')) return [];
  const node = view.nodes[id];
  if (!node) return [];
  return topology.cables.filter(({ a, b }) => {
    if (a !== id && b !== id) return false;
    if (action === null) return true;
    const other = view.nodes[a === id ? b : a];
    return Boolean(other && !other.isolated && (action === 'reconnect' ? node.isolated : !node.isolated));
  }).map(({ a, b }) => `${a}|${b}`);
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error('Company geometry could not be merged');
  return merged;
}

type MaterialName = keyof typeof COMPANY.materials;
type Parts = Partial<Record<MaterialName, THREE.BufferGeometry[]>>;

function furniture(type: NodeType): Parts {
  const spec = EQUIPMENT[type];
  const parts: Parts = {};
  const add = (material: MaterialName, ...shapes: THREE.BufferGeometry[]): void => {
    (parts[material] ??= []).push(...shapes);
  };
  const [x, y, z] = spec.screen;
  add('screen', box(spec.screenWidth + 0.12, 0.39, 0.08, x, y, z - 0.04));
  if (spec.furniture === 'desk') {
    add('desk', box(1.8, 0.09, 0.82, 0, 0.94, -0.49));
    add('metal', box(0.08, 0.88, 0.66, -0.77, 0.45, -0.49), box(0.08, 0.88, 0.66, 0.77, 0.45, -0.49),
      box(0.09, 0.16, 0.08, 0, 1.06, -0.61), box(0.4, 0.025, 0.18, 0, 0.995, -0.62),
      box(0.43, 0.025, 0.17, 0, 0.995, -0.24), box(0.08, 0.31, 0.08, 0, 0.19, 0.79),
      box(0.47, 0.035, 0.07, 0, 0.055, 0.79), box(0.07, 0.035, 0.37, 0, 0.055, 0.79));
    add('chair', box(0.48, 0.09, 0.38, 0, 0.4, 0.76), box(0.48, 0.43, 0.065, 0, 0.63, 0.92));
    add('paper', box(0.25, 0.013, 0.3, 0.55, 0.993, -0.46));
    add('partition', box(1.8, 0.42, 0.055, 0, 1.08, -0.96));
  } else if (spec.furniture === 'rack') {
    add('metal', box(0.09, 2.12, 0.8, -0.43, 1.07, 0), box(0.09, 2.12, 0.8, 0.43, 1.07, 0),
      box(0.95, 0.09, 0.86, 0, 2.12, 0), box(1.6, 0.09, 0.18, 0, 0.09, -0.8));
  } else if (spec.furniture === 'vault') {
    add('metal', box(0.09, 1.58, 1.5, -0.8, 0.8, 0), box(0.09, 1.58, 1.5, 0.8, 0.8, 0),
      box(1.7, 0.08, 1.5, 0, 1.6, 0));
  } else if (spec.furniture === 'crown') {
    add('metal', box(1.85, 0.08, 1.85, 0, 0.04, 0));
    add('paper', box(0.65, 0.035, 0.2, 0, 0.11, 0.82));
  }
  return parts;
}

function statusGeometry(status: EquipmentStatus): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (status === 'infected') {
    parts.push(box(0.08, 0.85, 0.02).rotateZ(Math.PI / 4), box(0.08, 0.85, 0.02).rotateZ(-Math.PI / 4));
  } else if (status === 'encrypted') {
    parts.push(box(0.65, 0.4, 0.02, 0, -0.15), box(0.07, 0.38, 0.02, -0.21, 0.17),
      box(0.07, 0.38, 0.02, 0.21, 0.17), box(0.48, 0.07, 0.02, 0, 0.36));
  } else if (status === 'offline') {
    parts.push(box(0.8, 0.13, 0.02));
  } else if (status === 'unknown') {
    parts.push(box(0.48, 0.09, 0.02, 0, 0.32), box(0.09, 0.29, 0.02, 0.2, 0.19),
      box(0.29, 0.09, 0.02, 0.09, 0.04), box(0.09, 0.18, 0.02, 0, -0.04), box(0.09, 0.09, 0.02, 0, -0.31));
  } else if (status === 'patched') {
    parts.push(box(0.09, 0.35, 0.02, -0.16, -0.12).rotateZ(0.6), box(0.09, 0.66, 0.02, 0.15, 0.06).rotateZ(-0.5));
  } else {
    for (let i = 0; i < 3; i++) parts.push(box(0.75 - i * 0.17, 0.1, 0.02, 0, 0.25 - i * 0.25));
  }
  return merge(parts);
}

/** Batched furniture and equipment readouts. Owns and disposes its resources. */
export class CompanyLayer {
  readonly group = new THREE.Group();
  readonly pickMeshes: THREE.InstancedMesh[] = [];
  private readonly topology: Topology;
  private readonly screens = new Map<EquipmentStatus, THREE.InstancedMesh>();
  private readonly sensors: THREE.InstancedMesh;
  private readonly offline: THREE.InstancedMesh;
  private readonly routes = new Map<string, THREE.Mesh>();
  private readonly plugs = new Map<string, THREE.Mesh>();
  private readonly previewRing: THREE.Mesh;
  private readonly restarts = new Map<string, number>();
  private latest: PresentationView = { nodes: {} };
  private selected: string | null = null;
  private action: ActionKind | null = null;
  private disposed = false;

  constructor(topology: Topology) {
    this.topology = topology;
    this.group.name = 'miniature-company';
    const materials = new Map<MaterialName, THREE.MeshStandardMaterial>();
    const material = (name: MaterialName): THREE.MeshStandardMaterial => {
      let result = materials.get(name);
      if (!result) {
        result = new THREE.MeshStandardMaterial({ color: COMPANY.materials[name], roughness: 0.72, metalness: name === 'metal' ? 0.5 : 0.08, envMapIntensity: name === 'metal' ? 0.5 : 0.1 });
        materials.set(name, result);
      }
      return result;
    };
    const transform = new THREE.Matrix4();
    for (const type of NODE_TYPES) {
      const nodes = topology.nodes.filter((node) => node.type === type);
      if (!nodes.length) continue;
      for (const [name, shapes] of Object.entries(furniture(type))) {
        const mesh = new THREE.InstancedMesh(merge(shapes), material(name as MaterialName), nodes.length);
        mesh.name = `company-${type}-${name}`;
        mesh.userData.assetIds = nodes.map((node) => node.id);
        nodes.forEach((node, i) => mesh.setMatrixAt(i, transform.makeTranslation(node.x, 0, node.z)));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        this.pickMeshes.push(mesh);
        this.group.add(mesh);
      }
    }
    // Each occupied tile belongs to its public network segment. Per-cell
    // floors cannot overlap on irregular generated estates.
    for (const core of [true, false]) {
      const nodes = topology.nodes.filter((node) => (node.segment === 'CORE') === core);
      if (!nodes.length) continue;
      const floor = new THREE.InstancedMesh(box(topology.spacing - 0.045, core ? 0.22 : 0.12, topology.spacing - 0.045), material(core ? 'equipment' : 'office'), nodes.length);
      nodes.forEach((node, i) => floor.setMatrixAt(i, transform.makeTranslation(node.x, core ? -0.13 : -0.08, node.z)));
      floor.receiveShadow = true;
      this.group.add(floor);
    }
    // A solid plinth makes this a cutaway model rather than isolated pads.
    const plinth = new THREE.Mesh(box(topology.halfWidth * 2 + topology.spacing + 0.3, 0.22, topology.halfDepth * 2 + topology.spacing + 0.3), material('edge'));
    plinth.position.y = -0.27;
    plinth.receiveShadow = true;
    this.group.add(plinth);

    for (const status of ['unknown', 'online', 'infected', 'encrypted', 'patched', 'offline'] as const) {
      const colour = status === 'infected' || status === 'encrypted' ? COMPANY.materials.threat
        : status === 'offline' ? COMPANY.materials.warning
          : status === 'unknown' ? COMPANY.materials.unknown : COMPANY.materials.defence;
      const mesh = new THREE.InstancedMesh(statusGeometry(status), new THREE.MeshBasicMaterial({ color: colour }), topology.nodes.length);
      mesh.name = `equipment-display-${status}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.screens.set(status, mesh);
      this.group.add(mesh);
    }
    this.sensors = new THREE.InstancedMesh(merge([box(0.1, 0.48, 0.1, 0, 0.24), box(0.25, 0.12, 0.16, 0, 0.53)]), material('defence'), topology.nodes.length);
    this.offline = new THREE.InstancedMesh(merge([box(0.55, 0.12, 0.13, 0, 0.18, 0.98), box(0.1, 0.31, 0.1, -0.24, 0.15, 0.98), box(0.1, 0.31, 0.1, 0.24, 0.15, 0.98)]), material('warning'), topology.nodes.length);
    this.sensors.name = 'deployed-sensor-fittings';
    this.offline.name = 'offline-port-barriers';
    this.sensors.frustumCulled = this.offline.frustumCulled = false;
    this.group.add(this.sensors, this.offline);

    for (const { a, b } of topology.cables) {
      const source = topology.byId.get(a)!;
      const target = topology.byId.get(b)!;
      const start = new THREE.Vector3(source.x, 0.15, source.z);
      const end = new THREE.Vector3(target.x, 0.15, target.z);
      const delta = end.clone().sub(start);
      const direction = delta.clone().normalize();
      const plugParts = [start.clone().addScaledVector(direction, 0.55), end.clone().addScaledVector(direction, -0.55)].map((point) => {
        const part = box(0.12, 0.08, 0.36);
        part.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction));
        part.translate(point.x, point.y, point.z);
        return part;
      });
      const plugs = new THREE.Mesh(merge(plugParts), material('warning'));
      plugs.visible = false;
      plugs.name = `disconnected-plugs-${a}-${b}`;
      this.plugs.set(`${a}|${b}`, plugs);
      this.group.add(plugs);
      const geometry = new THREE.CylinderGeometry(0.065, 0.065, delta.length(), 6);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
      geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
      const route = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: COMPANY.materials.defence, transparent: true, opacity: 0.8 }));
      route.name = `company-route-${a}-${b}`;
      route.visible = false;
      this.routes.set(`${a}|${b}`, route);
      this.group.add(route);
    }
    this.previewRing = new THREE.Mesh(new THREE.RingGeometry(COMPANY.footprint / 2 - 0.035, COMPANY.footprint / 2 + 0.035, 4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), new THREE.MeshBasicMaterial({ color: COMPANY.materials.warning, side: THREE.DoubleSide }));
    this.previewRing.visible = false;
    this.previewRing.name = 'action-preview-footprint';
    this.group.add(this.previewRing);
  }

  apply(view: PresentationView): void {
    this.latest = view;
    this.refreshScreens();
    this.preview(this.selected, this.action);
  }

  private refreshScreens(): void {
    for (const mesh of this.screens.values()) mesh.count = 0;
    this.sensors.count = this.offline.count = 0;
    const matrix = new THREE.Matrix4();
    for (const node of this.topology.nodes) {
      const state = this.latest.nodes[node.id];
      if (!state) continue;
      const spec = EQUIPMENT[node.type];
      const status = equipmentStatus(state);
      const mesh = this.screens.get(status)!;
      const [x, y, z] = spec.screen;
      const restart = this.restarts.has(node.id) ? 0.3 : 1;
      matrix.makeScale(spec.screenWidth * restart, 0.28, 1).setPosition(node.x + x, y, node.z + z + 0.007);
      mesh.setMatrixAt(mesh.count++, matrix);
      if (state.edr && !node.edr) this.sensors.setMatrixAt(this.sensors.count++, matrix.makeTranslation(node.x + 0.83, 0, node.z - 0.3));
      if (state.isolated) this.offline.setMatrixAt(this.offline.count++, matrix.makeTranslation(node.x, 0, node.z));
    }
    for (const mesh of [...this.screens.values(), this.sensors, this.offline]) mesh.instanceMatrix.needsUpdate = true;
  }

  preview(id: string | null, action: ActionKind | null): void {
    this.selected = id;
    this.action = action;
    const keys = new Set(previewLinks(this.topology, this.latest, id, action));
    for (const [key, mesh] of this.routes) {
      // A selected isolated cable stays disconnected. Preview reconnect can
      // show its proposed route, explicitly amber until the action is applied.
      const [a, b] = key.split('|');
      const connected = !this.latest.nodes[a]?.isolated && !this.latest.nodes[b]?.isolated;
      this.plugs.get(key)!.visible = !connected;
      mesh.visible = keys.has(key) && (connected || action === 'reconnect');
      const compromised = [a, b].every((nodeId) => {
        const state = this.latest.nodes[nodeId];
        return state && (state.visibleState === 'encrypted' || (state.observed && state.visibleState === 'infected'));
      });
      (mesh.material as THREE.MeshBasicMaterial).color.set(action ? COMPANY.materials.warning : compromised ? COMPANY.materials.threat : COMPANY.materials.defence);
    }
    const node = id ? this.topology.byId.get(id) : undefined;
    this.previewRing.visible = Boolean(node && action && action !== 'emergency');
    if (node) this.previewRing.position.set(node.x, 0.07, node.z);
  }

  restart(id: string, now: number, reduced: boolean): void {
    if (reduced) return;
    this.restarts.set(id, now);
    this.refreshScreens();
  }

  tick(now: number, reduced: boolean): void {
    let changed = false;
    for (const [id, start] of this.restarts) {
      if (reduced || now - start >= COMPANY.restartSeconds) { this.restarts.delete(id); changed = true; }
    }
    if (changed) this.refreshScreens();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.group.clear();
    this.restarts.clear();
  }
}
