// Builds the visible board from a loaded topology. Nodes render as one
// instanced mesh per type (draw calls stay flat no matter how many
// workstations a later phase adds), EDR markers as a second instanced mesh,
// and every cable merged into a single mesh. The board also owns the
// highlight and selection colouring and the lookups picking and the roster
// need to turn a click or a key press into a node id.

import * as THREE from 'three';
import { palette } from '../config/palette';
import type { NodeType, Topology, TopologyNode } from '../data/topology';
import { NODE_TYPES } from '../data/topology';
import type { VisibleState } from '../sim/types';
import {
  buildEdrMarkerGeometry,
  buildNodeGeometries,
  nodeTopHeight,
} from './geometry';

const COLOUR_BASE = new THREE.Color(palette.nodeBase);
const COLOUR_HIGHLIGHT = new THREE.Color(palette.nodeHover);
const COLOUR_SELECTED = new THREE.Color(palette.nodeSelected);
const COLOUR_INFECTION = new THREE.Color(palette.infection); // magenta, the threat
const COLOUR_ENCRYPTED = new THREE.Color('#180a14'); // gone dark, magenta-tinted
const COLOUR_PATCHED = new THREE.Color('#8ff0d4'); // immune, a brighter defended cyan

export const CABLE_HEIGHT = 0.12; // cables run just above the floor, clear of silhouettes
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
  /** Set one node's visible infection state (drives colour and state edges). */
  setVisibleState(nodeId: string, state: VisibleState): void;
  /** Apply a whole visible view at once (normal play) or true view (debug). */
  applyView(view: Record<string, VisibleState>): void;
  /** Cut or restore a node's cables to show isolation. */
  setIsolated(nodeId: string, isolated: boolean): void;
}

interface CableRecord {
  mesh: THREE.Mesh;
  a: string;
  b: string;
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
  const { group: cableGroup, cablesByNode } = buildCables(topology);
  group.add(cableGroup);

  // Wireframe outlines for state changes, one edge geometry per type built once
  // and reused: magenta for encrypted (compromised), cyan for patched
  // (defended). Overlays are created lazily as nodes change state.
  const edgesByType = buildEdgeGeometries(geometries);
  const encryptedMaterial = new THREE.LineBasicMaterial({ color: palette.infection });
  const patchedMaterial = new THREE.LineBasicMaterial({ color: COLOUR_PATCHED });
  const stateEdges = new Map<string, THREE.LineSegments>();
  const isolatedSet = new Set<string>();

  // Node state: infection (visible) plus the transient hover/selection.
  const visibleById = new Map<string, VisibleState>();
  let highlightedId: string | null = null;
  let selectedId: string | null = null;

  // Infection outranks selection and hover for the fill colour: the threat
  // colour must never be lost to a cursor passing over it. Patched sits with
  // the state colours too.
  function colourFor(nodeId: string): THREE.Color {
    const visible = visibleById.get(nodeId) ?? 'clean';
    if (visible === 'encrypted') return COLOUR_ENCRYPTED;
    if (visible === 'infected') return COLOUR_INFECTION;
    if (visible === 'patched') return COLOUR_PATCHED;
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

  // Adds, swaps or removes a node's wireframe outline as it encrypts or is
  // patched. Encrypted uses magenta, patched cyan, anything else no outline.
  function updateStateEdge(nodeId: string, visible: VisibleState): void {
    const wanted =
      visible === 'encrypted' ? encryptedMaterial : visible === 'patched' ? patchedMaterial : null;
    const existing = stateEdges.get(nodeId);
    if (existing && existing.material === wanted) return;
    if (existing) {
      group.remove(existing);
      stateEdges.delete(nodeId);
    }
    if (!wanted) return;
    const node = topology.byId.get(nodeId);
    if (!node) return;
    const outline = new THREE.LineSegments(edgesByType[node.type], wanted);
    outline.position.set(node.x, 0, node.z);
    stateEdges.set(nodeId, outline);
    group.add(outline);
  }

  function setVisibleState(nodeId: string, state: VisibleState): void {
    if (visibleById.get(nodeId) === state) return;
    visibleById.set(nodeId, state);
    updateStateEdge(nodeId, state);
    repaint(nodeId);
  }

  // A cable is visible only while both of its endpoints are connected.
  function refreshCable(record: CableRecord): void {
    record.mesh.visible = !isolatedSet.has(record.a) && !isolatedSet.has(record.b);
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
    setVisibleState,
    applyView(view) {
      for (const [nodeId, state] of Object.entries(view)) setVisibleState(nodeId, state);
    },
    setIsolated(nodeId, isolated) {
      if (isolated) isolatedSet.add(nodeId);
      else isolatedSet.delete(nodeId);
      for (const record of cablesByNode.get(nodeId) ?? []) refreshCable(record);
    },
  };
}

// One edge geometry per node type, for the encrypted-node outlines.
function buildEdgeGeometries(
  geometries: Record<NodeType, THREE.BufferGeometry>,
): Record<NodeType, THREE.EdgesGeometry> {
  const edges = {} as Record<NodeType, THREE.EdgesGeometry>;
  for (const type of NODE_TYPES) edges[type] = new THREE.EdgesGeometry(geometries[type]);
  return edges;
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

// Cables as one thin tube each, near the floor, indexed by the nodes they
// touch so isolation can hide a node's cables. One shared material; 23 cables
// is a negligible number of draw calls and buys per-cable visibility control.
function buildCables(topology: Topology): {
  group: THREE.Group;
  cablesByNode: Map<string, CableRecord[]>;
} {
  const group = new THREE.Group();
  const cablesByNode = new Map<string, CableRecord[]>();
  const up = new THREE.Vector3(0, 1, 0);
  const material = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.12,
    roughness: 0.6,
    transparent: true,
    opacity: 0.55,
  });

  const index = (id: string, record: CableRecord): void => {
    const list = cablesByNode.get(id);
    if (list) list.push(record);
    else cablesByNode.set(id, [record]);
  };

  for (const cable of topology.cables) {
    const a = topology.byId.get(cable.a);
    const b = topology.byId.get(cable.b);
    if (!a || !b) continue;
    const mesh = new THREE.Mesh(tubeBetween(a, b, up), material);
    mesh.receiveShadow = true;
    const record: CableRecord = { mesh, a: cable.a, b: cable.b };
    index(cable.a, record);
    index(cable.b, record);
    group.add(mesh);
  }

  return { group, cablesByNode };
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
