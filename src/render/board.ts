// Builds the visible board from a loaded topology. Nodes render as one
// instanced mesh per type (draw calls stay flat), EDR markers as a second
// instanced mesh, and each cable as its own tube so isolation and compromise
// can be shown per cable. The board also owns the war-room presentation added
// in Phase 5: an additive halo glow behind each node (procedural, no
// postprocessing), the infected pulse, the encryption transition (the node
// dying and its edges igniting rather than a colour swap), isolation rings that
// shift amber as business pressure climbs, and the override flash. All of it is
// driven from the VISIBLE view, so the fog of war survives the lighting: a
// hidden infection glows exactly like a clean node.

import * as THREE from 'three';
import { palette } from '../config/palette';
import { VISUAL_CONFIG, prefersReducedMotion } from '../config/visual';
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
const COLOUR_GLOW = new THREE.Color(palette.accent); // cyan infrastructure glow
const COLOUR_AMBER = new THREE.Color('#f5a524'); // business-pressure warning

export const CABLE_HEIGHT = 0.12; // cables run just above the floor, clear of silhouettes
const CABLE_RADIUS = 0.045;
const MARKER_GAP = 0.4; // how far an EDR ring floats above a node's top
const ENCRYPT_TRANSITION = 0.5; // seconds for a node to die and its edges to ignite

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
  /** Set one node's visible state. animate=true runs the encryption transition. */
  setVisibleState(nodeId: string, state: VisibleState, animate?: boolean): void;
  /** Apply a whole visible view at once (normal play) or true view (debug). */
  applyView(view: Record<string, VisibleState>): void;
  /** Cut or restore a node's cables to show isolation. */
  setIsolated(nodeId: string, isolated: boolean): void;
  /** Show or hide the EDR ring a deployed sensor adds to a node. */
  setSensor(nodeId: string, on: boolean): void;
  /** Global business pressure (0..1): isolation rings warm towards amber. */
  setPressure(fraction: number): void;
  /** A business override just force-reconnected this node: flash it. */
  flashOverride(nodeId: string): void;
  /** Per-frame presentation: pulse, encryption transitions, flashes. */
  tick(elapsed: number): void;
}

interface CableRecord {
  mesh: THREE.Mesh;
  a: string;
  b: string;
}

interface EncTransition {
  start: number;
  edge: THREE.LineSegments;
}

// A soft radial-gradient sprite texture for the additive node glow. Built once
// in a canvas (procedural, CC0 by construction, no asset file).
function makeHaloTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createBoard(topology: Topology): Board {
  const group = new THREE.Group();
  const geometries = buildNodeGeometries();
  const glow = VISUAL_CONFIG.glowIntensity;

  const meshByType = new Map<NodeType, THREE.InstancedMesh>();
  const instanceOrder = new Map<NodeType, string[]>();
  const locationById = new Map<string, InstanceLocation>();
  const baseMatrix = new Map<string, THREE.Matrix4>();

  // One instanced mesh per node type.
  for (const type of NODE_TYPES) {
    const nodesOfType = topology.nodes.filter((n) => n.type === type);
    if (nodesOfType.length === 0) continue;

    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff', // white base so the per-instance colour shows unmodified
      roughness: 0.5,
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
      baseMatrix.set(node.id, transform.clone());
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

  // Additive glow halos: one billboarded sprite per node, tinted by visible
  // state. Additive blending means they read as light against the near-black
  // and shine through the fog. Driven by the visible view like the fill colour,
  // so a hidden infection glows cyan like any clean node.
  const haloTexture = makeHaloTexture();
  const halos = new Map<string, THREE.Sprite>();
  for (const node of topology.nodes) {
    const mat = new THREE.SpriteMaterial({
      map: haloTexture,
      color: COLOUR_GLOW,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    const size = (1.7 + nodeTopHeight(node.type) * 0.6) * glow;
    sprite.scale.set(size, size, 1);
    sprite.position.set(node.x, nodeTopHeight(node.type) * 0.5 + 0.3, node.z);
    halos.set(node.id, sprite);
    group.add(sprite);
  }

  // Wireframe outlines for state changes: magenta for encrypted (compromised),
  // cyan for patched (defended), built once per type and reused.
  const edgesByType = buildEdgeGeometries(geometries);
  const patchedMaterial = new THREE.LineBasicMaterial({ color: COLOUR_PATCHED });
  const stateEdges = new Map<string, THREE.LineSegments>();
  const isolatedSet = new Set<string>();

  // Isolation rings: a flat ring at a node's base while it is cut off, warming
  // from cyan to amber as global business pressure climbs (the escalation the
  // board shows, not just the meter).
  const isolationRingGeometry = new THREE.TorusGeometry(1.15, 0.06, 8, 24);
  isolationRingGeometry.rotateX(Math.PI / 2);
  const isolationRings = new Map<string, THREE.Mesh>();
  let pressureFraction = 0;

  // Rings for nodes a deployed sensor now covers, drawn like the built-in EDR
  // markers so player-added coverage reads the same as native.
  const sensorGeometry = buildEdrMarkerGeometry();
  const sensorMaterial = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.4,
    roughness: 0.4,
  });
  const sensorRings = new Map<string, THREE.Mesh>();

  // Node state: infection (visible) plus transient hover/selection and the
  // in-flight encryption transitions and override flashes.
  const visibleById = new Map<string, VisibleState>();
  const encTransitions = new Map<string, EncTransition>();
  const overrideFlashes = new Map<string, number>(); // nodeId -> start elapsed
  let highlightedId: string | null = null;
  let selectedId: string | null = null;

  // Fill colour: infection outranks selection and hover so the threat colour is
  // never lost to a cursor. Patched sits with the state colours.
  function colourFor(nodeId: string): THREE.Color {
    const visible = visibleById.get(nodeId) ?? 'clean';
    if (visible === 'encrypted') return COLOUR_ENCRYPTED;
    if (visible === 'infected') return COLOUR_INFECTION;
    if (visible === 'patched') return COLOUR_PATCHED;
    if (nodeId === selectedId) return COLOUR_SELECTED;
    if (nodeId === highlightedId) return COLOUR_HIGHLIGHT;
    return COLOUR_BASE;
  }

  // Halo colour and resting opacity by visible state. Clean/covered nodes glow
  // a soft cyan (the infrastructure), compromised nodes glow magenta, patched a
  // brighter cyan. Selection and hover lift a clean node's glow.
  function haloTarget(nodeId: string): { colour: THREE.Color; opacity: number } {
    const visible = visibleById.get(nodeId) ?? 'clean';
    if (visible === 'encrypted') return { colour: COLOUR_INFECTION, opacity: 0.18 * glow };
    if (visible === 'infected') return { colour: COLOUR_INFECTION, opacity: 0.55 * glow };
    if (visible === 'patched') return { colour: COLOUR_PATCHED, opacity: 0.45 * glow };
    if (nodeId === selectedId) return { colour: COLOUR_SELECTED, opacity: 0.55 * glow };
    if (nodeId === highlightedId) return { colour: COLOUR_GLOW, opacity: 0.5 * glow };
    return { colour: COLOUR_GLOW, opacity: 0.26 * glow };
  }

  function applyHalo(nodeId: string): void {
    const halo = halos.get(nodeId);
    if (!halo) return;
    if (encTransitions.has(nodeId) || overrideFlashes.has(nodeId)) return; // animated in tick
    const target = haloTarget(nodeId);
    (halo.material as THREE.SpriteMaterial).color.copy(target.colour);
    (halo.material as THREE.SpriteMaterial).opacity = target.opacity;
  }

  function repaint(nodeId: string | null): void {
    if (nodeId === null) return;
    const location = locationById.get(nodeId);
    if (!location) return;
    const mesh = meshByType.get(location.type);
    if (!mesh) return;
    mesh.setColorAt(location.index, colourFor(nodeId));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    applyHalo(nodeId);
  }

  function setInstanceColour(nodeId: string, colour: THREE.Color): void {
    const location = locationById.get(nodeId);
    if (!location) return;
    const mesh = meshByType.get(location.type);
    if (!mesh) return;
    mesh.setColorAt(location.index, colour);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Rewrites one node's instance matrix with a uniform scale, for the encryption
  // scale-punch. Base matrix is translation only, so this stays exact.
  const scratch = new THREE.Matrix4();
  const scaleVec = new THREE.Vector3();
  function setInstanceScale(nodeId: string, scale: number): void {
    const location = locationById.get(nodeId);
    const base = baseMatrix.get(nodeId);
    if (!location || !base) return;
    const mesh = meshByType.get(location.type);
    if (!mesh) return;
    scratch.copy(base).scale(scaleVec.set(scale, scale, scale));
    mesh.setMatrixAt(location.index, scratch);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Cyan cable turns magenta once both its endpoints read compromised, so the
  // threat is visible spreading along the wiring, not just sitting on nodes.
  function refreshCableLook(record: CableRecord): void {
    const bothCompromised =
      isCompromised(visibleById.get(record.a)) && isCompromised(visibleById.get(record.b));
    const mat = record.mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(bothCompromised ? palette.infection : palette.accent);
    mat.emissive.set(bothCompromised ? palette.infection : palette.accent);
    mat.emissiveIntensity = bothCompromised ? 0.5 * glow : 0.12 * glow;
  }

  function refreshCableVisibility(record: CableRecord): void {
    record.mesh.visible = !isolatedSet.has(record.a) && !isolatedSet.has(record.b);
  }

  // The patched outline (instant). Encryption's outline is created by its
  // transition so it can ignite, so this only manages patched and clearing.
  function updatePatchedEdge(nodeId: string, visible: VisibleState): void {
    const existing = stateEdges.get(nodeId);
    if (visible === 'patched') {
      if (existing) return;
      const node = topology.byId.get(nodeId);
      if (!node) return;
      const outline = new THREE.LineSegments(edgesByType[node.type], patchedMaterial);
      outline.position.set(node.x, 0, node.z);
      stateEdges.set(nodeId, outline);
      group.add(outline);
    } else if (visible !== 'encrypted' && existing) {
      group.remove(existing);
      stateEdges.delete(nodeId);
    }
  }

  function beginEncryption(nodeId: string): void {
    if (encTransitions.has(nodeId)) return;
    const node = topology.byId.get(nodeId);
    if (!node) return;
    // A fresh magenta outline that ignites from nothing over the transition.
    const material = new THREE.LineBasicMaterial({
      color: palette.infection,
      transparent: true,
      opacity: 0,
    });
    const outline = new THREE.LineSegments(edgesByType[node.type], material);
    outline.position.set(node.x, 0, node.z);
    group.add(outline);
    // Replace any prior state edge (e.g. it was patched then somehow lost).
    const prior = stateEdges.get(nodeId);
    if (prior) group.remove(prior);
    stateEdges.set(nodeId, outline);
    encTransitions.set(nodeId, { start: Number.NEGATIVE_INFINITY, edge: outline });
  }

  function setEncryptedInstant(nodeId: string): void {
    const node = topology.byId.get(nodeId);
    if (!node) return;
    const material = new THREE.LineBasicMaterial({ color: palette.infection });
    const outline = new THREE.LineSegments(edgesByType[node.type], material);
    outline.position.set(node.x, 0, node.z);
    const prior = stateEdges.get(nodeId);
    if (prior) group.remove(prior);
    stateEdges.set(nodeId, outline);
    group.add(outline);
    setInstanceColour(nodeId, COLOUR_ENCRYPTED);
    applyHalo(nodeId);
  }

  function setVisibleState(nodeId: string, state: VisibleState, animate = false): void {
    const previous = visibleById.get(nodeId) ?? 'clean';
    if (previous === state) return;
    visibleById.set(nodeId, state);

    if (state === 'encrypted') {
      if (animate) beginEncryption(nodeId);
      else setEncryptedInstant(nodeId);
    } else {
      // Leaving/entering a non-encrypted state clears any encryption transition.
      encTransitions.delete(nodeId);
      updatePatchedEdge(nodeId, state);
      repaint(nodeId);
    }

    // A cable's look depends on both endpoints, so refresh this node's cables.
    for (const record of cablesByNode.get(nodeId) ?? []) refreshCableLook(record);
  }

  const reducedMotion = prefersReducedMotion();
  const pulseAmp = VISUAL_CONFIG.pulseAmplitude * (reducedMotion ? 0.4 : 1);
  const impact = reducedMotion ? 0 : VISUAL_CONFIG.encryptImpactScale;

  function tick(elapsed: number): void {
    // Infected pulse: the halos of visibly infected nodes breathe. Motion is a
    // required state cue, so it survives reduced motion, just gentler.
    const pulse = 1 + pulseAmp * 0.5 * (1 + Math.sin(elapsed * VISUAL_CONFIG.pulseSpeed * Math.PI));
    for (const [nodeId, state] of visibleById) {
      if (state !== 'infected' || encTransitions.has(nodeId)) continue;
      const halo = halos.get(nodeId);
      if (!halo) continue;
      (halo.material as THREE.SpriteMaterial).opacity = 0.55 * glow * pulse;
    }

    // Encryption transitions: the node darkens, its outline ignites, its glow
    // flares magenta then dies down, and it takes a small scale punch.
    for (const [nodeId, trans] of [...encTransitions]) {
      if (trans.start === Number.NEGATIVE_INFINITY) trans.start = elapsed;
      const p = Math.min(1, (elapsed - trans.start) / ENCRYPT_TRANSITION);
      const halo = halos.get(nodeId);
      // Fill colour lerps from the last magenta towards the dead dark.
      const colour = COLOUR_INFECTION.clone().lerp(COLOUR_ENCRYPTED, p * p);
      setInstanceColour(nodeId, colour);
      // Outline ignites in fast.
      (trans.edge.material as THREE.LineBasicMaterial).opacity = Math.min(1, p * 1.6);
      // Glow flares (a spike near the start) then settles to a dim dying ember.
      if (halo) {
        const flare = Math.sin(Math.min(1, p * 1.4) * Math.PI); // 0->1->0
        const settle = 0.18 * glow;
        (halo.material as THREE.SpriteMaterial).color.copy(COLOUR_INFECTION);
        (halo.material as THREE.SpriteMaterial).opacity = settle + 0.7 * glow * flare;
      }
      // Scale punch: a quick dip and recover.
      setInstanceScale(nodeId, 1 - impact * Math.sin(p * Math.PI));
      if (p >= 1) {
        setInstanceColour(nodeId, COLOUR_ENCRYPTED);
        setInstanceScale(nodeId, 1);
        (trans.edge.material as THREE.LineBasicMaterial).opacity = 1;
        encTransitions.delete(nodeId);
        applyHalo(nodeId);
      }
    }

    // Override flashes: a bright cyan burst on a force-reconnected node.
    for (const [nodeId, start] of [...overrideFlashes]) {
      const p = Math.min(1, (elapsed - start) / 0.6);
      const halo = halos.get(nodeId);
      if (halo) {
        (halo.material as THREE.SpriteMaterial).color.copy(COLOUR_SELECTED);
        (halo.material as THREE.SpriteMaterial).opacity = (1 - p) * 0.9 * glow;
      }
      if (p >= 1) {
        overrideFlashes.delete(nodeId);
        applyHalo(nodeId);
      }
    }
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
      for (const [nodeId, state] of Object.entries(view)) setVisibleState(nodeId, state, false);
    },
    setIsolated(nodeId, isolated) {
      if (isolated) isolatedSet.add(nodeId);
      else isolatedSet.delete(nodeId);
      for (const record of cablesByNode.get(nodeId) ?? []) refreshCableVisibility(record);
      updateIsolationRing(nodeId);
    },
    setSensor(nodeId, on) {
      const has = sensorRings.has(nodeId);
      if (on && !has) {
        const node = topology.byId.get(nodeId);
        if (!node) return;
        const ring = new THREE.Mesh(sensorGeometry, sensorMaterial);
        ring.position.set(node.x, nodeTopHeight(node.type) + MARKER_GAP, node.z);
        sensorRings.set(nodeId, ring);
        group.add(ring);
      } else if (!on && has) {
        const ring = sensorRings.get(nodeId);
        if (ring) group.remove(ring);
        sensorRings.delete(nodeId);
      }
    },
    setPressure(fraction) {
      pressureFraction = THREE.MathUtils.clamp(fraction, 0, 1);
      for (const nodeId of isolationRings.keys()) tintIsolationRing(nodeId);
    },
    flashOverride(nodeId) {
      // The flash clock matches tick's elapsed (performance.now() / 1000).
      overrideFlashes.set(nodeId, performance.now() / 1000);
    },
    tick,
  };

  function tintIsolationRing(nodeId: string): void {
    const ring = isolationRings.get(nodeId);
    if (!ring) return;
    const mat = ring.material as THREE.MeshStandardMaterial;
    const colour = COLOUR_GLOW.clone().lerp(COLOUR_AMBER, pressureFraction);
    mat.color.copy(colour);
    mat.emissive.copy(colour);
    mat.emissiveIntensity = (0.3 + 0.5 * pressureFraction) * glow;
  }

  function updateIsolationRing(nodeId: string): void {
    const isolated = isolatedSet.has(nodeId);
    const has = isolationRings.has(nodeId);
    if (isolated && !has) {
      const node = topology.byId.get(nodeId);
      if (!node) return;
      const material = new THREE.MeshStandardMaterial({
        color: palette.accent,
        emissive: palette.accent,
        emissiveIntensity: 0.3 * glow,
        roughness: 0.5,
      });
      const ring = new THREE.Mesh(isolationRingGeometry, material);
      ring.position.set(node.x, 0.06, node.z);
      isolationRings.set(nodeId, ring);
      group.add(ring);
      tintIsolationRing(nodeId);
    } else if (!isolated && has) {
      const ring = isolationRings.get(nodeId);
      if (ring) {
        group.remove(ring);
        (ring.material as THREE.Material).dispose();
      }
      isolationRings.delete(nodeId);
    }
  }
}

function isCompromised(state: VisibleState | undefined): boolean {
  return state === 'infected' || state === 'encrypted';
}

// One edge geometry per node type, for the state outlines.
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
// touch so isolation can hide a node's cables and compromise can recolour them.
// Each gets its own material so a single cable can turn magenta independently.
function buildCables(topology: Topology): {
  group: THREE.Group;
  cablesByNode: Map<string, CableRecord[]>;
} {
  const group = new THREE.Group();
  const cablesByNode = new Map<string, CableRecord[]>();
  const up = new THREE.Vector3(0, 1, 0);

  const index = (id: string, record: CableRecord): void => {
    const list = cablesByNode.get(id);
    if (list) list.push(record);
    else cablesByNode.set(id, [record]);
  };

  for (const cable of topology.cables) {
    const a = topology.byId.get(cable.a);
    const b = topology.byId.get(cable.b);
    if (!a || !b) continue;
    const material = new THREE.MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.12 * VISUAL_CONFIG.glowIntensity,
      roughness: 0.6,
      transparent: true,
      opacity: 0.6,
    });
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
