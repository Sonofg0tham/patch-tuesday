// Replays a turn's spread as a magenta creep travelling node by node, then the
// encryption transitions. It animates the change in the VISIBLE view, never the
// true state, so a hidden (non-EDR) infection never leaks through the animation.
// A creep is only drawn from an already-visible source; a node that goes
// straight to dark without ever showing infected is the fog-of-war horror: it
// just locks, with no creep to explain where it came from.

import * as THREE from 'three';
import { palette } from '../config/palette';
import type { Topology } from '../data/topology';
import type { VisibleState } from '../sim/types';
import { CABLE_HEIGHT, type Board } from './board';

// Feel knobs. These are timings, so they are Craig's to tune, not objective.
const CREEP_DURATION = 0.34; // seconds for a creep to travel a cable
const LOCK_DURATION = 0.26; // seconds for an encryption to land
const STAGGER = 0.12; // gap between successive animations in the wave
const CREEP_RADIUS = 0.14;

type View = Record<string, VisibleState>;

interface Step {
  start: number;
  duration: number;
  /** The visible state to apply when this step finishes. */
  finalState: VisibleState;
  node: string;
  /** A travelling creep mesh, or null for an in-place flare / lock. */
  mesh: THREE.Mesh | null;
  from: THREE.Vector3;
  to: THREE.Vector3;
  done: boolean;
}

export interface SpreadAnimator {
  /** Queue the animation from the current visible view to the next one. */
  play(before: View, after: View): void;
  /** Advance the animation. Called every frame with performance.now() / 1000. */
  update(nowSeconds: number): void;
  isPlaying(): boolean;
  onComplete(callback: () => void): void;
  /** A node's infection just became visible (a creep landed). For audio sync. */
  onReveal(callback: (nodeId: string) => void): void;
  /** A node just encrypted. For the encryption sting, synced to the visual. */
  onLock(callback: (nodeId: string) => void): void;
}

export function createSpreadAnimator(board: Board, topology: Topology): SpreadAnimator {
  const creepGeometry = new THREE.SphereGeometry(CREEP_RADIUS, 12, 12);
  // A glowing magenta bead travelling the cable, additive so it reads as light
  // running along the wiring into the target.
  const creepMaterial = new THREE.MeshBasicMaterial({
    color: palette.infection,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  let steps: Step[] = [];
  let active = false;
  let completeCallback: () => void = () => {};
  let revealCallback: (nodeId: string) => void = () => {};
  let lockCallback: (nodeId: string) => void = () => {};

  function cablePoint(nodeId: string): THREE.Vector3 {
    const node = topology.byId.get(nodeId);
    return new THREE.Vector3(node?.x ?? 0, CABLE_HEIGHT, node?.z ?? 0);
  }

  // A neighbour that already reads infected or encrypted, to creep from. Returns
  // null when the true source is hidden, so we never reveal it.
  function visibleSource(targetId: string, before: View): string | null {
    const node = topology.byId.get(targetId);
    if (!node) return null;
    for (const neighbour of node.neighbours) {
      const state = before[neighbour];
      if (state === 'infected' || state === 'encrypted') return neighbour;
    }
    return null;
  }

  function play(before: View, after: View): void {
    const reveals: string[] = [];
    const locks: string[] = [];
    for (const id of Object.keys(after)) {
      const was = before[id] ?? 'clean';
      const now = after[id];
      if (now === was) continue;
      if (now === 'infected') reveals.push(id);
      else if (now === 'encrypted') locks.push(id);
    }
    reveals.sort();
    locks.sort();

    const queued: Step[] = [];
    const base = performance.now() / 1000;
    let slot = 0;

    // Reveals first: a creep from a visible source, or an in-place flare when
    // the source is hidden (fog keeps the origin secret).
    for (const target of reveals) {
      const start = base + slot * STAGGER;
      slot += 1;
      const source = visibleSource(target, before);
      const mesh = source === null ? null : new THREE.Mesh(creepGeometry, creepMaterial);
      if (mesh) {
        mesh.visible = false;
        board.group.add(mesh);
      }
      queued.push({
        start,
        duration: source === null ? LOCK_DURATION : CREEP_DURATION,
        finalState: 'infected',
        node: target,
        mesh,
        from: source === null ? cablePoint(target) : cablePoint(source),
        to: cablePoint(target),
        done: false,
      });
    }

    // Encryptions after the creeps have travelled, so the wave reads in order.
    for (const node of locks) {
      queued.push({
        start: base + slot * STAGGER,
        duration: LOCK_DURATION,
        finalState: 'encrypted',
        node,
        mesh: null,
        from: cablePoint(node),
        to: cablePoint(node),
        done: false,
      });
      slot += 1;
    }

    steps = queued;
    active = true;
  }

  function update(nowSeconds: number): void {
    if (!active) return;
    let allDone = true;

    for (const step of steps) {
      if (step.done) continue;
      if (nowSeconds < step.start) {
        allDone = false;
        continue;
      }
      const t = Math.min(1, (nowSeconds - step.start) / step.duration);
      if (step.mesh) {
        step.mesh.visible = true;
        step.mesh.position.lerpVectors(step.from, step.to, t);
      }
      if (t >= 1) {
        if (step.mesh) board.group.remove(step.mesh);
        // animate=true runs the board's encryption transition (ignite + die)
        // rather than snapping the state; harmless for the infected reveal.
        board.setVisibleState(step.node, step.finalState, true);
        if (step.finalState === 'encrypted') lockCallback(step.node);
        else if (step.finalState === 'infected') revealCallback(step.node);
        step.done = true;
      } else {
        allDone = false;
      }
    }

    if (allDone) {
      steps = [];
      active = false;
      completeCallback();
    }
  }

  return {
    play,
    update,
    isPlaying() {
      return active;
    },
    onComplete(callback) {
      completeCallback = callback;
    },
    onReveal(callback) {
      revealCallback = callback;
    },
    onLock(callback) {
      lockCallback = callback;
    },
  };
}
