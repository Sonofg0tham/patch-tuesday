import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadTopology } from '../data/topology';
import { ForecastRouteLayer } from './forecast-routes';

describe('fog-safe forecast route layer', () => {
  it('draws canonical routes and target risk in amber', () => {
    const topology = loadTopology();
    const cable = topology.cables[0];
    const layer = new ForecastRouteLayer(topology);

    layer.setForecast({
      atRisk: [cable.b],
      edges: [
        { source: cable.a, target: cable.b },
        { source: cable.b, target: cable.a },
      ],
    });

    const routes = layer.group.getObjectByName('forecast-route-lines') as THREE.LineSegments;
    const targets = layer.group.getObjectByName('forecast-target-rings') as THREE.Group;
    expect(routes.geometry.getAttribute('position').count).toBe(2);
    expect((routes.material as THREE.LineBasicMaterial).color.getHexString()).toBe('f5a524');
    expect(targets.children).toHaveLength(1);
    expect(
      ((targets.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString(),
    ).toBe('f5a524');
  });
});
