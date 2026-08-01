// Builds the visible board from a loaded topology. Nodes render as one
// instanced mesh per type (draw calls stay flat), EDR markers as a second
// instanced mesh, and each cable as its own tube so isolation and compromise
// can be shown per cable. The board also owns the war-room presentation added
// in Phase 5: an additive halo glow behind each node, the infected pulse, the
// encryption transition (the node dying and its edges igniting rather than a
// colour swap), isolation rings that shift amber as business pressure climbs,
// and the override flash. All of it is driven from the VISIBLE view, so the fog
// of war survives the lighting: a hidden infection glows exactly like a clean
// node.
//
// Phase 7 moved the glow off the sprites and into the material. Each node now
// carries a per-instance emissive value, so a node's own surface is what
// brightens, which means the bloom pass has something real to work with and an
// infected chassis lights the floor and the cables around it. The halo sprite
// survives as the soft atmospheric bloom around that light, not as the light.

import * as THREE from 'three';
import { palette } from '../config/palette';
import { VISUAL_CONFIG } from '../config/visual';
import { effectivePulseScale, motionReduced } from '../data/settings';
import type { NodeType, Topology, TopologyNode } from '../data/topology';
import { NODE_TYPES } from '../data/topology';
import type { VisibleState } from '../sim/types';
import {
  buildEdrMarkerGeometry,
  buildForecastRingGeometry,
  buildNodeGeometries,
  buildOutlineGeometries,
  nodeTopHeight,
} from './geometry';
import {
  EMISSIVE_ATTRIBUTE,
  createCableMaterial,
  createChassisMaterial,
  type CableMaterial,
} from './materials';
import { haloTexture } from './textures';

const COLOUR_BASE = new THREE.Color(palette.nodeBase);
const COLOUR_HIGHLIGHT = new THREE.Color(palette.nodeHover);
const COLOUR_SELECTED = new THREE.Color(palette.nodeSelected);
const COLOUR_INFECTION = new THREE.Color(palette.infection); // magenta, the threat
const COLOUR_ENCRYPTED = new THREE.Color('#180a14'); // gone dark, magenta-tinted
const COLOUR_PATCHED = new THREE.Color('#8ff0d4'); // immune, a brighter defended cyan
const COLOUR_GLOW = new THREE.Color(palette.accent); // cyan infrastructure glow
const COLOUR_AMBER = new THREE.Color('#f5a524'); // business-pressure warning

export const CABLE_HEIGHT = 0.12; // cables run just above the floor, clear of silhouettes
const CABLE_RADIUS = 0.05;
const MARKER_GAP = 0.4; // how far an EDR ring floats above a node's top
const ENCRYPT_TRANSITION = 0.5; // seconds for a node to die and its edges to ignite

// How hard each visible state makes a node's own surface glow. This is the
// per-instance emissive attribute, so these are the values that decide what
// blooms and what stays quiet infrastructure.
//
// The spread between them matters more than any single value. Clean sits low
// enough that a healthy node reads as lit metal rather than a lamp, which is
// what leaves the magenta room to be alarming: if everything glows, nothing
// does, and the threat colour stops meaning anything.
const GLOW_CLEAN = 0.04;
const GLOW_HOVER = 0.16;
const GLOW_SELECTED = 0.28;
const GLOW_INFECTED = 0.85;
const GLOW_ENCRYPTED = 0.02;
const GLOW_PATCHED = 0.3;

// Texture tiling per type, so a tall rack does not wear the same stretched
// panel as a flat puck. Roughly one panel repeat per world unit of surface.
const CHASSIS_REPEAT: Record<NodeType, [number, number]> = {
  workstation: [1, 1],
  server: [1, 3],
  router: [3, 1],
  backup: [3, 2],
  'domain-controller': [2, 2],
};

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
  /**
   * Nodes the worm could reach next turn, from what the player can see. Pass an
   * empty array to clear. Purely a readability aid; the sim never reads this.
   */
  setForecast(nodeIds: readonly string[]): void;
  /** Per-frame presentation: pulse, encryption transitions, flashes. */
  tick(elapsed: number): void;
}

interface CableRecord {
  mesh: THREE.Mesh;
  material: CableMaterial;
  a: string;
  b: string;
}

interface EncTransition {
  start: number;
  edge: THREE.LineSegments;
}

export function createBoard(topology: Topology, environment: THREE.Texture | null = null): Board {
  const group = new THREE.Group();
  const geometries = buildNodeGeometries();
  const glow = VISUAL_CONFIG.glowIntensity;

  const meshByType = new Map<NodeType, THREE.InstancedMesh>();
  const glowByType = new Map<NodeType, THREE.InstancedBufferAttribute>();
  const instanceOrder = new Map<NodeType, string[]>();
  const locationById = new Map<string, InstanceLocation>();
  const baseMatrix = new Map<string, THREE.Matrix4>();

  // One instanced mesh per node type.
  for (const type of NODE_TYPES) {
    const nodesOfType = topology.nodes.filter((n) => n.type === type);
    if (nodesOfType.length === 0) continue;

    const material = createChassisMaterial(environment, {
      repeat: CHASSIS_REPEAT[type],
      emissive: glow,
    });
    const geometry = geometries[type];
    // The per-instance glow attribute lives on the geometry, alongside the
    // instance matrix and colour three manages itself.
    const glowAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(nodesOfType.length).fill(GLOW_CLEAN),
      1,
    );
    glowAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(EMISSIVE_ATTRIBUTE, glowAttribute);

    const mesh = new THREE.InstancedMesh(geometry, material, nodesOfType.length);
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
    glowByType.set(type, glowAttribute);
    instanceOrder.set(type, order);
    group.add(mesh);
  }

  group.add(buildEdrMarkers(topology));
  const { group: cableGroup, cablesByNode } = buildCables(topology, environment);
  group.add(cableGroup);

  // Additive glow halos: one billboarded sprite per node, tinted by visible
  // state. Since Phase 7 the node's own surface carries the light, so these are
  // the soft atmospheric spill around it rather than the glow itself, and they
  // sit lower than they used to. Driven by the visible view like the fill
  // colour, so a hidden infection glows cyan like any clean node.
  const halo = haloTexture();
  const halos = new Map<string, THREE.Sprite>();
  for (const node of topology.nodes) {
    const mat = new THREE.SpriteMaterial({
      map: halo,
      color: COLOUR_GLOW,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    const size = (1.9 + nodeTopHeight(node.type) * 0.6) * glow;
    sprite.scale.set(size, size, 1);
    sprite.position.set(node.x, nodeTopHeight(node.type) * 0.5 + 0.3, node.z);
    halos.set(node.id, sprite);
    group.add(sprite);
  }

  // Wireframe outlines for state changes: magenta for encrypted (compromised),
  // cyan for patched (defended). Built from the plain silhouettes rather than
  // the detailed chassis, so the outline is the shape you read from across the
  // room instead of every vent slot and bevel seam.
  const edgesByType = buildEdgeGeometries();
  const patchedMaterial = new THREE.LineBasicMaterial({ color: COLOUR_PATCHED });
  const stateEdges = new Map<string, THREE.LineSegments>();
  const isolatedSet = new Set<string>();

  // Isolation rings: a flat ring at a node's base while it is cut off, warming
  // from cyan to amber as global business pressure climbs (the escalation the
  // board shows, not just the meter).
  const isolationRingGeometry = new THREE.TorusGeometry(1.15, 0.06, 10, 28);
  isolationRingGeometry.rotateX(Math.PI / 2);
  const isolationRings = new Map<string, THREE.Mesh>();
  let pressureFraction = 0;

  // Rings for nodes a deployed sensor now covers, drawn like the built-in EDR
  // markers so player-added coverage reads the same as native.
  const sensorGeometry = buildEdrMarkerGeometry();
  const sensorMaterial = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.35,
    roughness: 0.35,
    metalness: 0.6,
    envMap: environment,
  });
  const sensorRings = new Map<string, THREE.Mesh>();

  // Threat forecast rings: a broken ring at the base of every node the worm
  // could reach next turn. Magenta, because this is the threat's reach and
  // magenta belongs to the threat, but broken rather than solid so it can never
  // be mistaken for a node that is actually compromised. Off unless the player
  // turns the assist on.
  const forecastGeometry = buildForecastRingGeometry();
  const forecastMaterial = new THREE.MeshStandardMaterial({
    color: palette.infection,
    emissive: palette.infection,
    emissiveIntensity: 0.5 * glow,
    roughness: 0.4,
    metalness: 0.3,
    transparent: true,
    opacity: 0.85,
  });
  const forecastRings = new Map<string, THREE.Mesh>();

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

  // How hard this node's own surface should glow, in the same precedence order.
  function glowFor(nodeId: string): number {
    const visible = visibleById.get(nodeId) ?? 'clean';
    if (visible === 'encrypted') return GLOW_ENCRYPTED;
    if (visible === 'infected') return GLOW_INFECTED;
    if (visible === 'patched') return GLOW_PATCHED;
    if (nodeId === selectedId) return GLOW_SELECTED;
    if (nodeId === highlightedId) return GLOW_HOVER;
    return GLOW_CLEAN;
  }

  function setInstanceGlow(nodeId: string, value: number): void {
    const location = locationById.get(nodeId);
    if (!location) return;
    const attribute = glowByType.get(location.type);
    if (!attribute) return;
    attribute.setX(location.index, value);
    attribute.needsUpdate = true;
  }

  // Halo colour and resting opacity by visible state. Clean/covered nodes glow
  // a soft cyan (the infrastructure), compromised nodes glow magenta, patched a
  // brighter cyan. Selection and hover lift a clean node's glow.
  function haloTarget(nodeId: string): { colour: THREE.Color; opacity: number } {
    const visible = visibleById.get(nodeId) ?? 'clean';
    if (visible === 'encrypted') return { colour: COLOUR_INFECTION, opacity: 0.1 * glow };
    if (visible === 'infected') return { colour: COLOUR_INFECTION, opacity: 0.34 * glow };
    if (visible === 'patched') return { colour: COLOUR_PATCHED, opacity: 0.18 * glow };
    if (nodeId === selectedId) return { colour: COLOUR_SELECTED, opacity: 0.26 * glow };
    if (nodeId === highlightedId) return { colour: COLOUR_GLOW, opacity: 0.22 * glow };
    return { colour: COLOUR_GLOW, opacity: 0.06 * glow };
  }

  function applyHalo(nodeId: string): void {
    const sprite = halos.get(nodeId);
    if (!sprite) return;
    if (encTransitions.has(nodeId) || overrideFlashes.has(nodeId)) return; // animated in tick
    const target = haloTarget(nodeId);
    (sprite.material as THREE.SpriteMaterial).color.copy(target.colour);
    (sprite.material as THREE.SpriteMaterial).opacity = target.opacity;
  }

  function repaint(nodeId: string | null): void {
    if (nodeId === null) return;
    const location = locationById.get(nodeId);
    if (!location) return;
    const mesh = meshByType.get(location.type);
    if (!mesh) return;
    mesh.setColorAt(location.index, colourFor(nodeId));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    setInstanceGlow(nodeId, glowFor(nodeId));
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
  // The travelling pulse turns with it and speeds up: routine traffic becomes
  // the worm moving.
  function refreshCableLook(record: CableRecord): void {
    const bothCompromised =
      isCompromised(visibleById.get(record.a)) && isCompromised(visibleById.get(record.b));
    record.material.setCompromised(bothCompromised);
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
    setInstanceGlow(nodeId, GLOW_ENCRYPTED);
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

  // Motion is a required state cue, so the pulse survives every level, just
  // gentler as it drops. The encryption punch is optional juice, off when the
  // player asked for reduced motion.
  const pulseAmp = VISUAL_CONFIG.pulseAmplitude * effectivePulseScale();
  const impact = motionReduced() ? 0 : VISUAL_CONFIG.encryptImpactScale;

  function tick(elapsed: number): void {
    // Infected pulse: the surface of a visibly infected node breathes, and its
    // halo breathes with it. Motion is a required state cue, so it survives
    // reduced motion, just gentler.
    const pulse = 1 + pulseAmp * 0.5 * (1 + Math.sin(elapsed * VISUAL_CONFIG.pulseSpeed * Math.PI));
    for (const [nodeId, state] of visibleById) {
      if (state !== 'infected' || encTransitions.has(nodeId)) continue;
      setInstanceGlow(nodeId, GLOW_INFECTED * pulse);
      const sprite = halos.get(nodeId);
      if (!sprite) continue;
      (sprite.material as THREE.SpriteMaterial).opacity = 0.45 * glow * pulse;
    }

    // Encryption transitions: the node darkens, its outline ignites, its glow
    // flares magenta then dies down, and it takes a small scale punch.
    for (const [nodeId, trans] of [...encTransitions]) {
      if (trans.start === Number.NEGATIVE_INFINITY) trans.start = elapsed;
      const p = Math.min(1, (elapsed - trans.start) / ENCRYPT_TRANSITION);
      const sprite = halos.get(nodeId);
      // Fill colour lerps from the last magenta towards the dead dark.
      const colour = COLOUR_INFECTION.clone().lerp(COLOUR_ENCRYPTED, p * p);
      setInstanceColour(nodeId, colour);
      // The surface flares white-hot then goes out, the shape of a thing dying.
      const flare = Math.sin(Math.min(1, p * 1.4) * Math.PI); // 0->1->0
      setInstanceGlow(nodeId, GLOW_ENCRYPTED + (GLOW_INFECTED * 2.4) * flare);
      // Outline ignites in fast.
      (trans.edge.material as THREE.LineBasicMaterial).opacity = Math.min(1, p * 1.6);
      if (sprite) {
        const settle = 0.14 * glow;
        (sprite.material as THREE.SpriteMaterial).color.copy(COLOUR_INFECTION);
        (sprite.material as THREE.SpriteMaterial).opacity = settle + 0.7 * glow * flare;
      }
      // Scale punch: a quick dip and recover.
      setInstanceScale(nodeId, 1 - impact * Math.sin(p * Math.PI));
      if (p >= 1) {
        setInstanceColour(nodeId, COLOUR_ENCRYPTED);
        setInstanceGlow(nodeId, GLOW_ENCRYPTED);
        setInstanceScale(nodeId, 1);
        (trans.edge.material as THREE.LineBasicMaterial).opacity = 1;
        encTransitions.delete(nodeId);
        applyHalo(nodeId);
      }
    }

    // Forecast rings turn slowly, the way a targeting reticle does, so they
    // read as live rather than as scenery. At reduced motion they hold still
    // and the broken-ring shape carries the cue on its own.
    if (forecastRings.size > 0 && !motionReduced()) {
      const spin = elapsed * 0.3;
      for (const ring of forecastRings.values()) ring.rotation.y = spin;
    }

    // Override flashes: a bright cyan burst on a force-reconnected node.
    for (const [nodeId, start] of [...overrideFlashes]) {
      const p = Math.min(1, (elapsed - start) / 0.6);
      const sprite = halos.get(nodeId);
      setInstanceGlow(nodeId, glowFor(nodeId) + (1 - p) * 1.4);
      if (sprite) {
        (sprite.material as THREE.SpriteMaterial).color.copy(COLOUR_SELECTED);
        (sprite.material as THREE.SpriteMaterial).opacity = (1 - p) * 0.8 * glow;
      }
      if (p >= 1) {
        overrideFlashes.delete(nodeId);
        setInstanceGlow(nodeId, glowFor(nodeId));
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
    setForecast(nodeIds) {
      const wanted = new Set(nodeIds);
      for (const [nodeId, ring] of [...forecastRings]) {
        if (wanted.has(nodeId)) continue;
        group.remove(ring);
        forecastRings.delete(nodeId);
      }
      for (const nodeId of wanted) {
        if (forecastRings.has(nodeId)) continue;
        const node = topology.byId.get(nodeId);
        if (!node) continue;
        const ring = new THREE.Mesh(forecastGeometry, forecastMaterial);
        ring.position.set(node.x, 0.05, node.z);
        forecastRings.set(nodeId, ring);
        group.add(ring);
      }
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
    mat.emissiveIntensity = (0.35 + 0.9 * pressureFraction) * glow;
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
        emissiveIntensity: 0.35 * glow,
        roughness: 0.4,
        metalness: 0.5,
        envMap: environment,
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

// One edge geometry per node type, for the state outlines. Built from the plain
// silhouettes rather than the detailed chassis so the outline stays readable.
function buildEdgeGeometries(): Record<NodeType, THREE.EdgesGeometry> {
  const outlines = buildOutlineGeometries();
  const edges = {} as Record<NodeType, THREE.EdgesGeometry>;
  for (const type of NODE_TYPES) {
    edges[type] = new THREE.EdgesGeometry(outlines[type]);
    outlines[type].dispose(); // only ever needed to derive the edges
  }
  return edges;
}

// One instanced ring per EDR-covered node, floating a fixed gap above its top.
function buildEdrMarkers(topology: Topology): THREE.InstancedMesh {
  const covered = topology.nodes.filter((n) => n.edr);
  const material = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.35,
    roughness: 0.35,
    metalness: 0.6,
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

// Cables as one sheathed tube each, near the floor, indexed by the nodes they
// touch so isolation can hide a node's cables and compromise can recolour them.
// Each gets its own material so a single cable can turn magenta independently,
// and so its travelling pulse can run at its own length and speed.
function buildCables(
  topology: Topology,
  environment: THREE.Texture | null,
): {
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
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const material = createCableMaterial(environment, length);
    const mesh = new THREE.Mesh(tubeBetween(a, b, up), material.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const record: CableRecord = { mesh, material, a: cable.a, b: cable.b };
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

  // Eight sides rather than six: the extra facets are what let the sheathing
  // normal map read as a round braided cable instead of a faceted stick.
  const geometry = new THREE.CylinderGeometry(CABLE_RADIUS, CABLE_RADIUS, length, 8, 1);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction.normalize());
  geometry.applyQuaternion(quaternion);
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  geometry.translate(midpoint.x, midpoint.y, midpoint.z);
  return geometry;
}
