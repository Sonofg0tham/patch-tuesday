// Amber route overlays for the fog-safe forecast. This layer accepts the full
// public Forecast and validates its edges against the visible estate cables.

import * as THREE from 'three';
import type { Topology } from '../data/topology';
import type { Forecast } from '../sim/forecast';

const FORECAST_AMBER = 0xf5a524;
const ROUTE_HEIGHT = 0.2;

export class ForecastRouteLayer {
  readonly group = new THREE.Group();

  private readonly topology: Topology;
  private readonly cableKeys: ReadonlySet<string>;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private readonly lines: THREE.LineSegments;
  private readonly targetGroup = new THREE.Group();
  private readonly targetGeometry: THREE.RingGeometry;
  private readonly targetMaterial: THREE.MeshBasicMaterial;

  constructor(topology: Topology) {
    this.topology = topology;
    this.cableKeys = new Set(topology.cables.map((cable) => cableKey(cable.a, cable.b)));
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.LineBasicMaterial({
      color: FORECAST_AMBER,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      depthTest: true,
    });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.name = 'forecast-route-lines';
    this.lines.renderOrder = 4;
    this.lines.frustumCulled = false;
    this.targetGeometry = new THREE.RingGeometry(0.48, 0.6, 32);
    this.targetGeometry.rotateX(-Math.PI / 2);
    this.targetMaterial = new THREE.MeshBasicMaterial({
      color: FORECAST_AMBER,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetGroup.name = 'forecast-target-rings';
    this.group.name = 'fog-safe-forecast-routes';
    this.group.add(this.lines, this.targetGroup);
    this.setForecast({ atRisk: [], edges: [] });
  }

  setForecast(forecast: Forecast): void {
    const positions: number[] = [];
    const seen = new Set<string>();
    for (const edge of forecast.edges) {
      const key = cableKey(edge.source, edge.target);
      if (seen.has(key) || !this.cableKeys.has(key)) continue;
      const source = this.topology.byId.get(edge.source);
      const target = this.topology.byId.get(edge.target);
      if (!source || !target) continue;
      seen.add(key);
      positions.push(
        source.x,
        ROUTE_HEIGHT,
        source.z,
        target.x,
        ROUTE_HEIGHT,
        target.z,
      );
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (positions.length > 0) this.geometry.computeBoundingSphere();
    else this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    this.lines.visible = positions.length > 0;

    this.targetGroup.clear();
    for (const nodeId of [...new Set(forecast.atRisk)]) {
      const node = this.topology.byId.get(nodeId);
      if (!node) continue;
      const ring = new THREE.Mesh(this.targetGeometry, this.targetMaterial);
      ring.position.set(node.x, ROUTE_HEIGHT + 0.01, node.z);
      ring.renderOrder = 4;
      this.targetGroup.add(ring);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.targetGeometry.dispose();
    this.targetMaterial.dispose();
  }
}

function cableKey(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
