import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadTopology } from '../data/topology';
import { makeGameState, makeTopology } from '../sim/fixtures';
import { toPresentationView, type NodePresentationState } from '../sim/telemetry';
import {
  deriveMarkerState,
  deriveZoneStencilSpecs,
  infectionPulseScale,
  StateMarkerLayer,
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

  it('derives a restrained pulse from the accumulated motion phase', () => {
    expect(infectionPulseScale(0)).not.toBe(infectionPulseScale(0.47));
  });

  it('freezes and resumes an infected plate at the current pulse phase', () => {
    const topology = makeTopology([{ id: 'NODE-A', edr: true }], []);
    const layer = new StateMarkerLayer(topology);
    layer.apply({
      nodes: {
        'NODE-A': presentation({ id: 'NODE-A', visibleState: 'infected' }),
      },
    }, null);
    const plate = layer.group.getObjectByName('marker-infection-NODE-A') as THREE.Sprite;

    layer.tick(0.37);
    const beforePause = plate.scale.toArray();
    layer.setReducedMotion(true);
    expect(plate.scale.toArray()).toEqual(beforePause);
    layer.tick(0.37);
    expect(plate.scale.toArray()).toEqual(beforePause);
    layer.tick(4.37);
    expect(plate.scale.toArray()).toEqual(beforePause);

    layer.setReducedMotion(false);
    const beforeResume = plate.scale.toArray();
    layer.tick(4.37);
    expect(plate.scale.toArray()).toEqual(beforeResume);
    layer.tick(4.42);
    expect(plate.scale.toArray()).not.toEqual(beforeResume);
  });

  it('derives restrained floor zones from stable topology segments', () => {
    const topology = loadTopology();
    const zones = deriveZoneStencilSpecs(topology);

    expect(zones.map((zone) => zone.segment)).toEqual(['CORE', 'FIN', 'OPS']);
    expect(zones.every((zone) => zone.width > 0 && zone.depth > 0)).toBe(true);
    expect(zones.every((zone) => zone.label.length > 0)).toBe(true);
  });

  it('disposes only layer-owned resources and leaves shared Sprite geometry alone', () => {
    const externalSprite = new THREE.Sprite();
    const sharedSpriteGeometryDispose = vi.spyOn(externalSprite.geometry, 'dispose');
    const layer = new StateMarkerLayer(
      makeTopology([{ id: 'NODE-A', edr: true }], []),
    );
    const ownedGeometry = new Set<THREE.BufferGeometry>();
    const ownedMaterial = new Set<THREE.Material>();
    const ownedTexture = new Set<THREE.Texture>();
    layer.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        ownedGeometry.add(object.geometry);
      }
      if (
        !(
          object instanceof THREE.Mesh
          || object instanceof THREE.LineSegments
          || object instanceof THREE.Sprite
        )
      ) {
        return;
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        ownedMaterial.add(material);
        if ('map' in material && material.map instanceof THREE.Texture) {
          ownedTexture.add(material.map);
        }
      }
    });
    const geometryDispose = [...ownedGeometry].map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialDispose = [...ownedMaterial].map((material) => vi.spyOn(material, 'dispose'));
    const textureDispose = [...ownedTexture].map((texture) => vi.spyOn(texture, 'dispose'));

    layer.dispose();

    expect(sharedSpriteGeometryDispose).not.toHaveBeenCalled();
    expect(geometryDispose.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(materialDispose.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(textureDispose.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  });
});
