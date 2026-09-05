// Procedural node geometry, one distinct silhouette per type. Shape carries
// the identity so state is never colour alone (accessibility rule): squat
// tower, tall rack, flat wide puck, round drum, stepped ziggurat. No two
// share a profile, so the board passes the greyscale test by construction.
//
// Phase 7 kept every silhouette exactly as it was and put real hardware detail
// inside it: bevelled edges that catch a highlight instead of dying at a hard
// corner, vent banks, rack rails, drive bays, chassis feet. All of it merges
// into one geometry per type, so each type still renders as a single instanced
// mesh and the draw-call budget is unchanged.
//
// Every geometry is authored with its base sitting on y = 0, so placing a
// node is just a translation in x and z.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { NodeType } from '../data/topology';

// Height of the top face of each type, so markers and labels can float a
// consistent gap above whatever they sit on.
const TOP_HEIGHT: Record<NodeType, number> = {
  workstation: 1.7, // clears the miniature desk and monitor assembly
  server: 2.0,
  router: 0.62, // the puck is still lowest; this clears the aerial stubs
  backup: 1.4,
  'domain-controller': 2.78, // includes the beacon on the crown
};

export function nodeTopHeight(type: NodeType): number {
  return TOP_HEIGHT[type];
}

/** The tallest silhouette on the board, for camera framing and light placement. */
export const MAX_NODE_HEIGHT = TOP_HEIGHT['domain-controller'];

// A bevelled box. The bevel is the single highest-value detail on the board:
// a hard 90-degree corner returns one flat shade, a bevelled one catches a
// bright line of specular that tells the eye it is looking at a solid object.
function chassis(width: number, height: number, depth: number, radius = 0.035): THREE.BufferGeometry {
  return new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, Math.min(width, height, depth) / 2.2));
}

// Merges a set of parts into one geometry, failing loudly rather than silently
// dropping a node type from the board.
//
// Everything is de-indexed first: RoundedBoxGeometry ships non-indexed while
// BoxGeometry and CylinderGeometry are indexed, and mergeGeometries refuses a
// mixed set. De-indexing costs a few hundred extra vertices per node type,
// which is nothing next to the instancing that draws them.
function merge(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const flattened = parts.map((part) => {
    if (part.index === null) return part;
    const nonIndexed = part.toNonIndexed();
    part.dispose();
    return nonIndexed;
  });
  const merged = mergeGeometries(flattened, false);
  if (!merged) throw new Error(`failed to merge ${what} geometry`);
  for (const part of flattened) part.dispose();
  return merged;
}

function at(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

// Four small chassis feet, so a box reads as standing on the floor rather than
// sunk into it. The shadow gap underneath is most of the effect.
function feet(halfX: number, halfZ: number, height = 0.05, size = 0.09): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(at(new THREE.BoxGeometry(size, height, size), sx * halfX, height / 2, sz * halfZ));
    }
  }
  return parts;
}

function workstationGeometry(): THREE.BufferGeometry {
  // Small squat tower: the desktop mini-PC. Short and chunky.
  const body = 0.85;
  const parts: THREE.BufferGeometry[] = [
    at(chassis(body, body - 0.05, body, 0.05), 0, (body - 0.05) / 2 + 0.05, 0),
    ...feet(0.3, 0.3),
  ];

  // Front bezel: a slightly proud faceplate with a drive slot and a power boss,
  // so the tower has a front and the light picks out which way it faces.
  parts.push(at(new THREE.BoxGeometry(0.66, 0.5, 0.03), 0, 0.5, body / 2));
  parts.push(at(new THREE.BoxGeometry(0.44, 0.045, 0.02), 0, 0.66, body / 2 + 0.02));
  parts.push(at(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12).rotateX(Math.PI / 2), 0, 0.31, body / 2 + 0.02));

  // A bank of intake slots down one flank.
  for (let i = 0; i < 5; i += 1) {
    parts.push(at(new THREE.BoxGeometry(0.02, 0.035, 0.42), body / 2, 0.28 + i * 0.1, 0));
  }
  return merge(parts, 'workstation');
}

function serverGeometry(): THREE.BufferGeometry {
  // Tall thin rack, clearly vertical, the opposite profile to a workstation.
  const height = 2.0;
  const parts: THREE.BufferGeometry[] = [
    at(chassis(0.6, height - 0.06, 0.6, 0.03), 0, (height - 0.06) / 2 + 0.06, 0),
    ...feet(0.22, 0.22, 0.06, 0.1),
  ];

  // Rack units: seven horizontal server sleds stacked up the front face, each
  // with a recessed handle. This is the detail that makes it read as a rack
  // rather than a tall box, and it is the same shape repeated, so it is cheap.
  for (let u = 0; u < 7; u += 1) {
    const y = 0.24 + u * 0.24;
    parts.push(at(new THREE.BoxGeometry(0.5, 0.16, 0.035), 0, y, 0.3));
    parts.push(at(new THREE.BoxGeometry(0.09, 0.09, 0.03), -0.19, y, 0.325)); // handle
    parts.push(at(new THREE.BoxGeometry(0.035, 0.02, 0.02), 0.16, y, 0.33)); // drive LED
  }

  // Vertical mounting rails down both front corners, the frame the sleds hang in.
  for (const sx of [-1, 1]) {
    parts.push(at(new THREE.BoxGeometry(0.05, height - 0.14, 0.05), sx * 0.275, height / 2, 0.275));
  }
  // A vented cap on top where the exhaust leaves.
  parts.push(at(new THREE.BoxGeometry(0.64, 0.05, 0.64), 0, height + 0.02, 0));
  return merge(parts, 'server');
}

function routerGeometry(): THREE.BufferGeometry {
  // Flat wide octagonal puck, the classic diagram junction, sitting lower
  // than everything else on the board.
  const parts: THREE.BufferGeometry[] = [
    at(new THREE.CylinderGeometry(0.95, 0.99, 0.3, 8), 0, 0.15, 0),
    // A chamfered lid, so the top edge takes a highlight all the way round.
    at(new THREE.CylinderGeometry(0.82, 0.95, 0.06, 8), 0, 0.33, 0),
    // The raised centre boss, where the status lamp would sit.
    at(new THREE.CylinderGeometry(0.3, 0.34, 0.05, 8), 0, 0.38, 0),
  ];

  // A bank of ports along one edge: this is a junction, and it should look
  // like something a lot of cables plug into.
  for (let i = 0; i < 6; i += 1) {
    parts.push(at(new THREE.BoxGeometry(0.08, 0.07, 0.03), -0.35 + i * 0.14, 0.16, 0.97));
  }

  // Two short aerial stubs. Thin enough that the flat-and-wide silhouette the
  // accessibility contract depends on is untouched.
  for (const [x, z] of [[-0.62, -0.62], [0.62, -0.62]] as const) {
    parts.push(at(new THREE.CylinderGeometry(0.028, 0.035, 0.26, 8), x, 0.43, z));
    parts.push(at(new THREE.SphereGeometry(0.04, 8, 6), x, 0.57, z));
  }
  return merge(parts, 'router');
}

function backupGeometry(): THREE.BufferGeometry {
  // Cylinder: the universal database and storage symbol.
  const height = 1.4;
  const parts: THREE.BufferGeometry[] = [
    at(new THREE.CylinderGeometry(0.62, 0.62, height, 24), 0, height / 2, 0),
    // Reinforcing rims top and bottom, the shape of a real drive shelf stack.
    at(new THREE.CylinderGeometry(0.67, 0.67, 0.07, 24), 0, 0.05, 0),
    at(new THREE.CylinderGeometry(0.67, 0.67, 0.07, 24), 0, height - 0.05, 0),
    at(new THREE.CylinderGeometry(0.65, 0.65, 0.05, 24), 0, height / 2, 0),
  ];

  // Three tiers of drive bays around the front arc, so the drum reads as a
  // populated array. Angled to follow the curve.
  for (let tier = 0; tier < 3; tier += 1) {
    for (let i = -2; i <= 2; i += 1) {
      const angle = i * 0.28;
      const bay = new THREE.BoxGeometry(0.14, 0.22, 0.04);
      bay.rotateY(angle);
      bay.translate(Math.sin(angle) * 0.63, 0.36 + tier * 0.34, Math.cos(angle) * 0.63);
      parts.push(bay);
    }
  }
  return merge(parts, 'backup');
}

function domainControllerGeometry(): THREE.BufferGeometry {
  // Stepped ziggurat, the tallest and widest-based thing on the board, so
  // the crown jewels read at any zoom. Four shrinking tiers merged into one
  // geometry so the whole type can still render as a single instanced mesh.
  const tierHeight = 0.6;
  const widths = [1.5, 1.15, 0.8, 0.45];
  const parts: THREE.BufferGeometry[] = widths.map((width, level) =>
    at(chassis(width, tierHeight, width, 0.04), 0, tierHeight / 2 + level * tierHeight, 0),
  );

  // A lip around each step, so the terracing catches light on every tier
  // instead of only at the silhouette.
  widths.forEach((width, level) => {
    parts.push(
      at(new THREE.BoxGeometry(width + 0.06, 0.04, width + 0.06), 0, (level + 1) * tierHeight - 0.02, 0),
    );
  });

  // The beacon: a short mast and a lamp on the crown. The DC already has its
  // own point light in the scene rig; this gives that light something to sit on
  // so the eye lands on the crown jewels first.
  parts.push(at(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 8), 0, 2.5, 0));
  parts.push(at(new THREE.SphereGeometry(0.1, 12, 8), 0, 2.66, 0));

  return merge(parts, 'domain controller');
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

// Plain silhouettes matching each type's overall mass, used only for the state
// outlines (the magenta ignition on encryption, the cyan outline on patched).
// Running EdgesGeometry over the detailed meshes would draw every vent slot and
// bevel seam, which reads as noise; the outline needs to be the shape you see
// from across the room, so it is built from these instead.
export function buildOutlineGeometries(): Record<NodeType, THREE.BufferGeometry> {
  const ziggurat = merge(
    [1.5, 1.15, 0.8, 0.45].map((width, level) =>
      at(new THREE.BoxGeometry(width, 0.6, width), 0, 0.3 + level * 0.6, 0),
    ),
    'domain controller outline',
  );

  return {
    workstation: at(new THREE.BoxGeometry(0.85, 0.85, 0.85), 0, 0.425, 0),
    server: at(new THREE.BoxGeometry(0.6, 2.0, 0.6), 0, 1.0, 0),
    router: at(new THREE.CylinderGeometry(0.95, 0.95, 0.36, 8), 0, 0.18, 0),
    backup: at(new THREE.CylinderGeometry(0.64, 0.64, 1.4, 22), 0, 0.7, 0),
    'domain-controller': ziggurat,
  };
}

// A thin ring that floats above EDR-covered nodes: coverage is an icon, never
// a tint (accessibility rule). Absence of the ring is the visible gap.
export function buildEdrMarkerGeometry(): THREE.BufferGeometry {
  const ring = new THREE.TorusGeometry(0.21, 0.032, 8, 22);
  ring.rotateX(Math.PI / 2); // lie flat, so it reads as a ring seen from above
  return ring;
}
