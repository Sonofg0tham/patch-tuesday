// Procedural node geometry, one distinct silhouette per type. Shape carries
// the identity so state is never colour alone (accessibility rule): squat
// tower, tall rack, flat wide puck, round drum, stepped ziggurat. No two
// share a profile, so the board passes the greyscale test by construction.
//
// Every geometry is authored with its base sitting on y = 0, so placing a
// node is just a translation in x and z.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { NodeType } from '../data/topology';

// Height of the top face of each type, so markers and labels can float a
// consistent gap above whatever they sit on.
const TOP_HEIGHT: Record<NodeType, number> = {
  workstation: 0.85,
  server: 2.0,
  router: 0.35,
  backup: 1.4,
  'domain-controller': 2.4,
};

export function nodeTopHeight(type: NodeType): number {
  return TOP_HEIGHT[type];
}

// Lifts a geometry so its base rests on the ground, given the height it was
// built centred around.
function seatOnGround(geometry: THREE.BufferGeometry, height: number): THREE.BufferGeometry {
  geometry.translate(0, height / 2, 0);
  return geometry;
}

function workstationGeometry(): THREE.BufferGeometry {
  // Small squat tower: the desktop mini-PC. Short and chunky.
  return seatOnGround(new THREE.BoxGeometry(0.85, 0.85, 0.85), 0.85);
}

function serverGeometry(): THREE.BufferGeometry {
  // Tall thin rack, clearly vertical, the opposite profile to a workstation.
  return seatOnGround(new THREE.BoxGeometry(0.6, 2.0, 0.6), 2.0);
}

function routerGeometry(): THREE.BufferGeometry {
  // Flat wide octagonal puck, the classic diagram junction, sitting lower
  // than everything else on the board.
  const puck = new THREE.CylinderGeometry(0.95, 0.95, 0.35, 8);
  return seatOnGround(puck, 0.35);
}

function backupGeometry(): THREE.BufferGeometry {
  // Cylinder: the universal database and storage symbol.
  const drum = new THREE.CylinderGeometry(0.62, 0.62, 1.4, 22);
  return seatOnGround(drum, 1.4);
}

function domainControllerGeometry(): THREE.BufferGeometry {
  // Stepped ziggurat, the tallest and widest-based thing on the board, so
  // the crown jewels read at any zoom. Four shrinking tiers merged into one
  // geometry so the whole type can still render as a single instanced mesh.
  const tierHeight = 0.6;
  const widths = [1.5, 1.15, 0.8, 0.45];
  const tiers = widths.map((width, level) => {
    const tier = new THREE.BoxGeometry(width, tierHeight, width);
    tier.translate(0, tierHeight / 2 + level * tierHeight, 0);
    return tier;
  });
  const merged = mergeGeometries(tiers, false);
  if (!merged) throw new Error('failed to merge domain controller geometry');
  return merged;
}

// Builds one geometry per node type. Called once at boot.
export function buildNodeGeometries(): Record<NodeType, THREE.BufferGeometry> {
  return {
    workstation: workstationGeometry(),
    server: serverGeometry(),
    router: routerGeometry(),
    backup: backupGeometry(),
    'domain-controller': domainControllerGeometry(),
  };
}

// A thin ring that floats above EDR-covered nodes: coverage is an icon, never
// a tint (accessibility rule). Absence of the ring is the visible gap.
export function buildEdrMarkerGeometry(): THREE.BufferGeometry {
  const ring = new THREE.TorusGeometry(0.28, 0.05, 8, 20);
  ring.rotateX(Math.PI / 2); // lie flat, so it reads as a ring seen from above
  return ring;
}
