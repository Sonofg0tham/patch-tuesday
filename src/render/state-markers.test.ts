import { describe, expect, it } from 'vitest';
import { loadTopology } from '../data/topology';
import { makeGameState, makeTopology } from '../sim/fixtures';
import { toPresentationView, type NodePresentationState } from '../sim/telemetry';
import {
  deriveMarkerState,
  deriveZoneStencilSpecs,
  infectionPulseScale,
} from './state-markers';

function presentation(
  overrides: Partial<NodePresentationState> = {},
): NodePresentationState {
  return {
    id: 'FINANCE-02',
    visibleState: 'clean',
    observed: true,
    isolated: false,
    isolationAge: 0,
    edr: true,
    ...overrides,
  };
}

describe('fog-safe procedural state markers', () => {
  it('derives byte-identical markers for unobserved clean and hidden-infected assets', () => {
    const topology = makeTopology([{ id: 'DARK', edr: false }], []);
    const unobservedClean = toPresentationView(
      makeGameState({ DARK: { state: 'clean', infectedTurns: 0 } }),
      topology,
    ).nodes.DARK;
    const unobservedHiddenInfection = toPresentationView(
      makeGameState({ DARK: { state: 'infected', infectedTurns: 5 } }),
      topology,
    ).nodes.DARK;

    expect(unobservedHiddenInfection).toEqual(unobservedClean);
    expect(JSON.stringify(deriveMarkerState(unobservedHiddenInfection))).toBe(
      JSON.stringify(deriveMarkerState(unobservedClean)),
    );
    expect(deriveMarkerState(unobservedClean)).toMatchObject({
      unknown: true,
      infected: false,
      shapeKey: 'chassis|unknown-diamond',
    });
  });

  it('gives each public state a distinct greyscale shape signature', () => {
    const states = [
      deriveMarkerState(presentation()).shapeKey,
      deriveMarkerState(presentation({ observed: false, edr: false })).shapeKey,
      deriveMarkerState(presentation({ visibleState: 'infected' })).shapeKey,
      deriveMarkerState(presentation({ visibleState: 'encrypted' })).shapeKey,
      deriveMarkerState(presentation({ visibleState: 'patched' })).shapeKey,
      deriveMarkerState(presentation({ isolated: true })).shapeKey,
      deriveMarkerState(presentation(), true).shapeKey,
    ];

    expect(new Set(states).size).toBe(states.length);
  });

  it('requests the physical overlays for encryption, isolation, patching and selection', () => {
    expect(deriveMarkerState(presentation({ visibleState: 'encrypted' }))).toMatchObject({
      encrypted: true,
      panelDisplacement: expect.any(Number),
    });
    expect(
      deriveMarkerState(presentation({ visibleState: 'encrypted' })).panelDisplacement,
    ).toBeGreaterThan(0);
    expect(deriveMarkerState(presentation({ visibleState: 'patched' })).patched).toBe(true);
    expect(deriveMarkerState(presentation({ isolated: true })).isolated).toBe(true);
    expect(deriveMarkerState(presentation(), true)).toMatchObject({
      selected: true,
      showBrackets: true,
      showLabel: true,
      showSelectionLight: true,
      label: 'FINANCE-02',
    });
  });

  it('holds infected cues still under reduced motion while normal motion can breathe', () => {
    expect(infectionPulseScale(0, true)).toBe(1);
    expect(infectionPulseScale(0.47, true)).toBe(1);
    expect(infectionPulseScale(0, false)).not.toBe(infectionPulseScale(0.47, false));
  });

  it('derives restrained floor zones from stable topology segments', () => {
    const topology = loadTopology();
    const zones = deriveZoneStencilSpecs(topology);

    expect(zones.map((zone) => zone.segment)).toEqual(['CORE', 'FIN', 'OPS']);
    expect(zones.every((zone) => zone.width > 0 && zone.depth > 0)).toBe(true);
    expect(zones.every((zone) => zone.label.length > 0)).toBe(true);
  });
});
