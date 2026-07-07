// Builds the visible board from a loaded topology. Nodes render as one
// instanced mesh per type (draw calls stay flat no matter how many
// workstations a later phase adds), EDR markers as a second instanced mesh,
// and every cable merged into a single mesh. The board also owns the
// highlight and selection colouring and the lookups picking and the roster
// need to turn a click or a key press into a node id.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette } from '../config/palette';
import type { NodeType, Topology, TopologyNode } from '../data/topology';
import { NODE_TYPES } from '../data/topology';
import {
  buildEdrMarkerGeometry,
  buildNodeGeometries,
  nodeTopHeight,
} from './geometry';

const COLOUR_BASE = new THREE.Color(palette.nodeBase);
const COLOUR_HIGHLIGHT = new THREE.Color(palette.nodeHover);
const COLOUR_SELECTED = new THREE.Color(palette.nodeSelected);

const CABLE_HEIGHT = 0.12; // cables run just above the floor, clear of silhouettes
const CABLE_RADIUS = 0.045;
const MARKER_GAP = 0.4; // how far an EDR ring floats above a node's top

interface InstanceLocation {
  type: NodeType;
  index: number;
}

export interface Board {
  group: THREE.Group;
  nodeMeshes: THREE.InstancedMesh[]; // raycast targets
  resolveHit(object: THREE.Object3D, instanceId: number | undefined): string | null;
  setHighlight(nodeId: string | null): void;
  setSelected(nodeId: string | null): void;
}

export function createBoard(topology: Topology): Board {
  const group = new THREE.Group();
  const geometries = buildNodeGeometries();

  const meshByType = new Map<NodeType, THREE.InstancedMesh>();
  const instanceOrder = new Map<NodeType, string[]>();
  const locationById = new Map<string, InstanceLocation>();

  // One instanced mesh per node type.
  for (const type of NODE_TYPES) {
    const nodesOfType = topology.nodes.filter((n) => n.type === type);
    if (nodesOfType.length === 0) continue;

    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff', // white base so the per-instance colour shows unmodified
      roughness: 0.55,
      metalness: 0.1,
    });
    const mesh = new THREE.InstancedMesh(geometries[type], material, nodesOfType.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.nodeType = type;

    const order: string[] = [];
    const transform = new THREE.Matrix4();
    nodesOfType.forEach((node, index) => {
      transform.makeTranslation(node.x, 0, node.z);
      mesh.setMatrixAt(index, transform);
      mesh.setColorAt(index, COLOUR_BASE);
      order.push(node.id);
      locationById.set(node.id, { type, index });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    meshByType.set(type, mesh);
    instanceOrder.set(type, order);
    group.add(mesh);
  }

  group.add(buildEdrMarkers(topology));
  group.add(buildCables(topology));

  // Recolours a single node instance to match its current state.
  let highlightedId: string | null = null;
  let selectedId: string | null = null;

  function colourFor(nodeId: string): THREE.Color {
    if (nodeId === selectedId) return COLOUR_SELECTED;
    if (nodeId === highlightedId) return COLOUR_HIGHLIGHT;
    return COLOUR_BASE;
  }

  function repaint(nodeId: string | null): void {
    if (nodeId === null) return;
    const location = locationById.get(nodeId);
    if (!location) return;
    const mesh = meshByType.get(location.type);
    if (!mesh) return;
    mesh.setColorAt(location.index, colourFor(nodeId));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    group,
    nodeMeshes: [...meshByType.values()],
    resolveHit(object, instanceId) {
      if (instanceId === undefined) return null;
      const type = object.userData.nodeType as NodeType | undefined;
      if (!type) return null;
      return instanceOrder.get(type)?.[instanceId] ?? null;
    },
    setHighlight(nodeId) {
      if (nodeId === highlightedId) return;
      const previous = highlightedId;
      highlightedId = nodeId;
      repaint(previous);
      repaint(highlightedId);
    },
    setSelected(nodeId) {
      if (nodeId === selectedId) return;
      const previous = selectedId;
      selectedId = nodeId;
      repaint(previous);
      repaint(selectedId);
    },
  };
}

// One instanced ring per EDR-covered node, floating a fixed gap above its top.
function buildEdrMarkers(topology: Topology): THREE.InstancedMesh {
  const covered = topology.nodes.filter((n) => n.edr);
  const material = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.4,
    roughness: 0.4,
  });
  const mesh = new THREE.InstancedMesh(buildEdrMarkerGeometry(), material, covered.length);
  const transform = new THREE.Matrix4();
  covered.forEach((node, index) => {
    const y = nodeTopHeight(node.type) + MARKER_GAP;
    transform.makeTranslation(node.x, y, node.z);
    mesh.setMatrixAt(index, transform);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// Every cable merged into a single mesh: a thin tube running near the floor
// between the two node positions.
function buildCables(topology: Topology): THREE.Mesh {
  const segments: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (const cable of topology.cables) {
    const a = topology.byId.get(cable.a);
    const b = topology.byId.get(cable.b);
    if (!a || !b) continue;
    segments.push(tubeBetween(a, b, up));
  }

  const merged = segments.length > 0 ? mergeGeometries(segments, false) : null;
  const material = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.12,
    roughness: 0.6,
    transparent: true,
    opacity: 0.55,
  });
  const mesh = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), material);
  mesh.receiveShadow = true;
  return mesh;
}

function tubeBetween(a: TopologyNode, b: TopologyNode, up: THREE.Vector3): THREE.BufferGeometry {
  const start = new THREE.Vector3(a.x, CABLE_HEIGHT, a.z);
  const end = new THREE.Vector3(b.x, CABLE_HEIGHT, b.z);
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();

  const geometry = new THREE.CylinderGeometry(CABLE_RADIUS, CABLE_RADIUS, length, 6);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction.normalize());
  geometry.applyQuaternion(quaternion);
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  geometry.translate(midpoint.x, midpoint.y, midpoint.z);
  return geometry;
}
