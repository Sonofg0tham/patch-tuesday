// Low-level, fog-safe threat traces. The turn director supplies the real
// projected route for observable attempts, so this module never guesses a
// source from neighbouring nodes. Hidden attempts receive one amber pulse at
// the board centre and carry no node or cable position.

import * as THREE from 'three';
import { palette } from '../config/palette';
import type { Topology } from '../data/topology';
import { CABLE_HEIGHT, type Board } from './board';

const TRACE_DURATION = 0.34;
const TELEMETRY_PULSE_DURATION = 0.28;
const TRACE_RADIUS = 0.14;

interface ActiveEffect {
  kind: 'route' | 'telemetry-gap';
  start: number;
  duration: number;
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  pulseScale: number;
  ownsMaterial: boolean;
}

export interface SpreadAnimator {
  /** Trace one observable attempt along its exact projected route. */
  trace(source: string, target: string): void;
  /** Show grouped hidden activity without a node, route or stereo position. */
  pulseTelemetryGap(attempts: number): void;
  /** Advance active low-level effects. */
  update(nowSeconds: number): void;
  /** Remove unfinished effects after skip, interrupt or a new incident. */
  clear(): void;
}

export function createSpreadAnimator(
  board: Board,
  topology: Topology,
  nowSeconds: () => number = () => performance.now() / 1000,
): SpreadAnimator {
  const traceGeometry = new THREE.SphereGeometry(TRACE_RADIUS, 12, 12);
  const traceMaterial = new THREE.MeshBasicMaterial({
    color: palette.infection,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pulseGeometry = new THREE.RingGeometry(0.32, 0.42, 24);
  const pulseMaterial = new THREE.MeshBasicMaterial({
    color: palette.pressure,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const active: ActiveEffect[] = [];

  function cablePoint(nodeId: string): THREE.Vector3 | null {
    const node = topology.byId.get(nodeId);
    return node ? new THREE.Vector3(node.x, CABLE_HEIGHT, node.z) : null;
  }

  function trace(source: string, target: string): void {
    const from = cablePoint(source);
    const to = cablePoint(target);
    if (from === null || to === null) return;

    const mesh = new THREE.Mesh(traceGeometry, traceMaterial);
    mesh.visible = false;
    mesh.userData.kind = 'route';
    mesh.userData.source = source;
    mesh.userData.target = target;
    board.group.add(mesh);
    active.push({
      kind: 'route',
      start: nowSeconds(),
      duration: TRACE_DURATION,
      mesh,
      from,
      to,
      pulseScale: 1,
      ownsMaterial: false,
    });
  }

  function pulseTelemetryGap(attempts: number): void {
    const material = pulseMaterial.clone();
    const mesh = new THREE.Mesh(pulseGeometry, material);
    mesh.visible = false;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, CABLE_HEIGHT, 0);
    mesh.userData.kind = 'telemetry-gap';
    mesh.userData.attempts = Math.max(1, Math.floor(attempts));
    board.group.add(mesh);
    active.push({
      kind: 'telemetry-gap',
      start: nowSeconds(),
      duration: TELEMETRY_PULSE_DURATION,
      mesh,
      from: mesh.position.clone(),
      to: mesh.position.clone(),
      pulseScale: 1 + Math.min(3, Math.max(0, attempts - 1)) * 0.12,
      ownsMaterial: true,
    });
  }

  function remove(effect: ActiveEffect): void {
    board.group.remove(effect.mesh);
    if (effect.ownsMaterial) (effect.mesh.material as THREE.Material).dispose();
  }

  function update(now: number): void {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const effect = active[index];
      if (!effect || now < effect.start) continue;

      const progress = Math.min(1, Math.max(0, (now - effect.start) / effect.duration));
      effect.mesh.visible = true;
      if (effect.kind === 'route') {
        effect.mesh.position.lerpVectors(effect.from, effect.to, progress);
      } else {
        effect.mesh.position.copy(effect.from);
        const scale = effect.pulseScale * (0.75 + progress * 0.55);
        effect.mesh.scale.setScalar(scale);
        (effect.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.72;
      }

      if (progress >= 1) {
        remove(effect);
        active.splice(index, 1);
      }
    }
  }

  function clear(): void {
    for (const effect of active) remove(effect);
    active.length = 0;
  }

  return { trace, pulseTelemetryGap, update, clear };
}
