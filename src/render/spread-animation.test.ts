import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeTopology } from '../sim/fixtures';
import type { Board } from './board';
import { createSpreadAnimator } from './spread-animation';

function boardGroup(): { board: Board; group: THREE.Group } {
  const group = new THREE.Group();
  return { board: { group } as Board, group };
}

describe('observable threat traces', () => {
  it('travels along the supplied source and target instead of guessing a neighbour', () => {
    const topology = makeTopology(
      [{ id: 'ALPHA' }, { id: 'ZULU' }],
      [['ALPHA', 'ZULU']],
    );
    const { board, group } = boardGroup();
    const animator = createSpreadAnimator(board, topology, () => 100);

    animator.trace('ZULU', 'ALPHA');
    animator.update(100);
    const trace = group.children[0];

    expect(trace?.position.x).toBe(1);
    expect(trace?.position.z).toBe(0);
    animator.update(101);
    expect(group.children).toHaveLength(0);
  });

  it('renders hidden activity only as a centred non-positional pulse', () => {
    const topology = makeTopology(
      [{ id: 'FAR-LEFT' }, { id: 'FAR-RIGHT' }],
      [['FAR-LEFT', 'FAR-RIGHT']],
    );
    topology.byId.get('FAR-LEFT')!.x = -8;
    topology.byId.get('FAR-RIGHT')!.x = 11;
    const { board, group } = boardGroup();
    const animator = createSpreadAnimator(board, topology, () => 50);

    animator.pulseTelemetryGap(3);
    animator.update(50);
    const pulse = group.children[0];

    expect(pulse?.position.x).toBe(0);
    expect(pulse?.position.z).toBe(0);
    expect(pulse?.userData.kind).toBe('telemetry-gap');
  });

  it('clear removes unfinished routes and telemetry pulses after skip or interrupt', () => {
    const topology = makeTopology(
      [{ id: 'A' }, { id: 'B' }],
      [['A', 'B']],
    );
    const { board, group } = boardGroup();
    const animator = createSpreadAnimator(board, topology, () => 10);

    animator.trace('A', 'B');
    animator.pulseTelemetryGap(1);
    expect(group.children).toHaveLength(2);

    animator.clear();
    expect(group.children).toHaveLength(0);
  });
});
