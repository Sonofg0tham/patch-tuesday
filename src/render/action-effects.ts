// Six bounded procedural player-action effects. Every slot is constructed once
// and reused, so repeated actions cannot allocate an ever-growing trail of
// geometry. The pool receives public action names and public topology only.

import * as THREE from 'three';
import { palette } from '../config/palette';
import type { Topology } from '../data/topology';
import type { ActionKind } from '../sim/types';
import { nodeTopHeight } from './geometry';

export type ActionEffectAction = ActionKind;

interface EffectSlot {
  action: ActionEffectAction;
  root: THREE.Group;
  startedAt: number | null;
  duration: number;
  bases: readonly ObjectTransform[];
}

interface ObjectTransform {
  object: THREE.Object3D;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

export interface ActionEffectPoolOptions {
  now?: () => number;
  reducedMotion?: boolean;
}

const NODE_ACTIONS = new Set<ActionEffectAction>([
  'scan',
  'isolate',
  'reconnect',
  'patch',
  'restore',
]);

const MAX_STARTS_PER_SECOND = 2;

export class ActionEffectPool {
  readonly group = new THREE.Group();

  private readonly topology: Topology;
  private readonly now: () => number;
  private readonly slots = new Map<ActionEffectAction, EffectSlot>();
  private starts: number[] = [];
  private reducedMotion: boolean;
  private disposed = false;

  constructor(topology: Topology, options: ActionEffectPoolOptions = {}) {
    this.topology = topology;
    this.now = options.now ?? (() => performance.now() / 1000);
    this.reducedMotion = options.reducedMotion ?? false;
    this.group.name = 'pooled-player-action-effects';

    const roots: Record<ActionEffectAction, THREE.Group> = {
      scan: buildSensorEffect(),
      isolate: buildIsolationEffect(),
      reconnect: buildReconnectEffect(),
      patch: buildPatchEffect(),
      restore: buildRestoreEffect(),
      emergency: buildEmergencyEffect(),
    };
    for (const action of Object.keys(roots) as ActionEffectAction[]) {
      const root = roots[action];
      root.name = `action-effect-${action}`;
      root.visible = false;
      const slot: EffectSlot = {
        action,
        root,
        startedAt: null,
        duration: action === 'emergency' ? 0.9 : 0.72,
        bases: root.children.map((object) => ({
          object,
          position: object.position.clone(),
          rotation: object.rotation.clone(),
          scale: object.scale.clone(),
        })),
      };
      this.slots.set(action, slot);
      this.group.add(root);
    }
  }

  play(action: ActionEffectAction, nodeId?: string): boolean {
    if (this.disposed) throw new Error('action effect pool is disposed');
    if (NODE_ACTIONS.has(action) && nodeId === undefined) {
      throw new Error(`${action} requires a node id`);
    }
    if (action === 'emergency' && nodeId !== undefined) {
      throw new Error('emergency does not accept a node id');
    }

    const node = nodeId === undefined ? null : this.topology.byId.get(nodeId);
    if (nodeId !== undefined && !node) throw new Error(`unknown node id ${nodeId}`);

    const startedAt = this.now();
    this.starts = this.starts.filter((time) => time > startedAt - 1);
    if (this.starts.length >= MAX_STARTS_PER_SECOND) return false;
    this.starts.push(startedAt);

    const slot = this.slots.get(action);
    if (!slot) return false;
    this.reset(slot);
    const aboveChassis = action === 'scan' || action === 'patch' || action === 'restore';
    const y = node && aboveChassis ? nodeTopHeight(node.type) + 0.24 : 0;
    slot.root.position.set(node?.x ?? 0, y, node?.z ?? 0);
    slot.startedAt = startedAt;
    slot.root.visible = true;
    return true;
  }

  tick(nowSeconds: number): void {
    if (this.disposed) return;
    for (const slot of this.slots.values()) {
      if (slot.startedAt === null) continue;
      const elapsed = Math.max(0, nowSeconds - slot.startedAt);
      if (elapsed >= slot.duration) {
        slot.root.visible = false;
        slot.startedAt = null;
        continue;
      }
      if (this.reducedMotion) continue;
      const progress = elapsed / slot.duration;
      animate(slot, progress);
    }
  }

  setReducedMotion(enabled: boolean): void {
    if (this.reducedMotion === enabled) return;
    this.reducedMotion = enabled;
    // Reset active slots at the transition boundary. Reduced motion receives a
    // stable complete cue, and returning to normal never resumes stale travel.
    const transitionAt = this.now();
    for (const slot of this.slots.values()) {
      if (slot.startedAt === null) continue;
      this.reset(slot);
      slot.startedAt = transitionAt;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.group.clear();
    this.slots.clear();
    this.starts = [];
  }

  private reset(slot: EffectSlot): void {
    for (const base of slot.bases) {
      base.object.position.copy(base.position);
      base.object.rotation.copy(base.rotation);
      base.object.scale.copy(base.scale);
      if (base.object instanceof THREE.Mesh || base.object instanceof THREE.LineSegments) {
        const list = Array.isArray(base.object.material)
          ? base.object.material
          : [base.object.material];
        for (const material of list) {
          if ('opacity' in material) material.opacity = 0.9;
        }
      }
    }
  }
}

function actionMaterial(colour: string = palette.accent): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function buildSensorEffect(): THREE.Group {
  const root = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.045, 8, 32), actionMaterial());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.16;
  ring.name = 'sensor-concentric-ring';
  root.add(ring);

  const sweep = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1, 9, 1, true, 0, Math.PI * 0.55),
    actionMaterial('#c8f0fc'),
  );
  sweep.rotation.x = Math.PI / 2;
  sweep.position.y = 0.2;
  sweep.name = 'sensor-radar-sweep';
  root.add(sweep);
  return root;
}

function buildIsolationEffect(): THREE.Group {
  const root = new THREE.Group();
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.11, 0.18),
      actionMaterial('#c8f0fc'),
    );
    blade.position.set(side * 1.15, 0.18, 0);
    blade.rotation.y = side * 0.38;
    blade.name = side < 0 ? 'isolation-left-blade' : 'isolation-right-blade';
    root.add(blade);
  }
  return root;
}

function buildReconnectEffect(): THREE.Group {
  const root = new THREE.Group();
  const surge = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.055, 8, 32), actionMaterial());
  surge.rotation.x = Math.PI / 2;
  surge.position.y = 0.12;
  surge.name = 'reconnect-surge-ring';
  root.add(surge);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.08, 0.13),
      actionMaterial('#c8f0fc'),
    );
    rail.position.set(side * 1.38, 0.2, 0);
    rail.name = side < 0 ? 'reconnect-left-rail' : 'reconnect-right-rail';
    root.add(rail);
  }
  return root;
}

function buildPatchEffect(): THREE.Group {
  const root = new THREE.Group();
  const cells = [
    [-0.36, -0.36],
    [0.36, -0.36],
    [-0.36, 0.36],
    [0.36, 0.36],
  ] as const;
  for (let index = 0; index < cells.length; index += 1) {
    const [x, z] = cells[index];
    const cell = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.07, 0.4),
      actionMaterial(index === 3 ? '#c8f0fc' : palette.accent),
    );
    cell.position.set(x, 0.19, z);
    cell.name = `patch-checksum-cell-${index + 1}`;
    root.add(cell);
  }
  return root;
}

function buildRestoreEffect(): THREE.Group {
  const root = new THREE.Group();
  const drive = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.5, 0.16, 20),
    actionMaterial('#c8f0fc'),
  );
  drive.position.y = 0.18;
  drive.name = 'restore-drive-platter';
  root.add(drive);
  const boot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.2, 0.84, 12, 1, true),
    actionMaterial(),
  );
  boot.position.y = 0.58;
  boot.name = 'restore-boot-column';
  root.add(boot);
  const service = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.07, 0.14),
    actionMaterial('#c8f0fc'),
  );
  service.position.y = 1.02;
  service.name = 'restore-service-line';
  root.add(service);
  return root;
}

function buildEmergencyEffect(): THREE.Group {
  const root = new THREE.Group();
  const stamp = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 1.0, 0.08, 8),
    actionMaterial(palette.pressure),
  );
  stamp.position.y = 0.13;
  stamp.name = 'emergency-authorisation-octagon';
  root.add(stamp);

  const lines = new THREE.BufferGeometry();
  lines.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      -0.52, 0.2, -0.18, 0.52, 0.2, -0.18,
      -0.52, 0.2, 0.18, 0.52, 0.2, 0.18,
      -0.18, 0.2, -0.52, -0.18, 0.2, 0.52,
      0.18, 0.2, -0.52, 0.18, 0.2, 0.52,
    ], 3),
  );
  const grid = new THREE.LineSegments(
    lines,
    new THREE.LineBasicMaterial({
      color: '#f4f8fb',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  grid.name = 'emergency-authorisation-grid';
  root.add(grid);
  return root;
}

function animate(slot: EffectSlot, progress: number): void {
  const ease = 1 - Math.pow(1 - progress, 3);
  const pulse = 1 + Math.sin(progress * Math.PI) * 0.42;
  switch (slot.action) {
    case 'scan':
      slot.root.children[0].scale.setScalar(0.58 + ease * 0.95);
      slot.root.children[1].rotation.z = progress * Math.PI * 2;
      break;
    case 'isolate':
      slot.root.children[0].position.x = -1.15 - ease * 0.45;
      slot.root.children[1].position.x = 1.15 + ease * 0.45;
      break;
    case 'reconnect':
      slot.root.children[0].scale.setScalar(1 + ease * 0.45);
      slot.root.children[1].position.x = -1.38 + ease * 0.36;
      slot.root.children[2].position.x = 1.38 - ease * 0.36;
      break;
    case 'patch':
      slot.root.children.forEach((cell, index) => {
        const local = THREE.MathUtils.clamp(progress * 4 - index, 0, 1);
        cell.scale.setScalar(0.62 + local * 0.48);
      });
      break;
    case 'restore':
      slot.root.children[0].rotation.y = progress * Math.PI * 5;
      slot.root.children[1].position.y = 0.3 + ease * 0.52;
      slot.root.children[2].scale.x = 0.25 + ease * 0.75;
      break;
    case 'emergency':
      slot.root.children[0].scale.setScalar(pulse);
      slot.root.children[1].rotation.y = progress * Math.PI * 0.5;
      break;
  }
}
