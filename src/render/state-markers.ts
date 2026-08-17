// Fog-safe physical board language. This module consumes the public
// NodePresentationState projection only. It has no access to GameState,
// NodeState or true infection and therefore cannot localise a hidden threat.

import * as THREE from 'three';
import { palette } from '../config/palette';
import type { Topology, TopologyNode } from '../data/topology';
import type { NodePresentationState, PresentationView } from '../sim/telemetry';
import { nodeTopHeight } from './geometry';
import {
  assetLabelTexture,
  markerGlyphTexture,
  zoneStencilTexture,
} from './textures';

const PANEL_DISPLACEMENT = 0.5;
const THREAT_PLATE_SIZE = 0.72;
const UNKNOWN_PLATE_SIZE = 0.52;
const PATCH_PLATE_SIZE = 0.56;

export interface MarkerState {
  unknown: boolean;
  infected: boolean;
  encrypted: boolean;
  patched: boolean;
  isolated: boolean;
  selected: boolean;
  panelDisplacement: number;
  showBrackets: boolean;
  showLabel: boolean;
  showSelectionLight: boolean;
  label: string;
  /** Literal geometry inventory used to prove greyscale distinction. */
  shapeKey: string;
}

export interface ZoneStencilSpec {
  segment: string;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export function safeAssetLabel(value: string): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14);
  return cleaned.length > 0 ? cleaned : 'ASSET';
}

export function deriveMarkerState(
  presentation: NodePresentationState,
  selected = false,
): MarkerState {
  const unknown = !presentation.observed;
  const infected = presentation.visibleState === 'infected';
  const encrypted = presentation.visibleState === 'encrypted';
  const patched = presentation.visibleState === 'patched';
  const shapes = ['chassis'];
  if (unknown) shapes.push('unknown-diamond');
  if (infected) shapes.push('threat-octagon');
  if (encrypted) shapes.push('displaced-panel');
  if (patched) shapes.push('patch-shield');
  if (presentation.isolated) shapes.push('isolation-bars');
  if (selected) shapes.push('selection-brackets', 'asset-label');

  return {
    unknown,
    infected,
    encrypted,
    patched,
    isolated: presentation.isolated,
    selected,
    panelDisplacement: encrypted ? PANEL_DISPLACEMENT : 0,
    showBrackets: selected,
    showLabel: selected,
    showSelectionLight: selected,
    label: safeAssetLabel(presentation.id),
    shapeKey: shapes.join('|'),
  };
}

/** A fixed scale under reduced motion, a restrained breath otherwise. */
export function infectionPulseScale(elapsed: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return 1.05 + Math.sin(elapsed * 5.2) * 0.05;
}

export function deriveZoneStencilSpecs(topology: Topology): ZoneStencilSpec[] {
  const bySegment = new Map<string, TopologyNode[]>();
  for (const node of topology.nodes) {
    const segment = safeAssetLabel(node.segment);
    const list = bySegment.get(segment);
    if (list) list.push(node);
    else bySegment.set(segment, [node]);
  }

  const padding = topology.spacing * 0.62;
  return [...bySegment.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segment, nodes]) => {
      const xs = nodes.map((node) => node.x);
      const zs = nodes.map((node) => node.z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      return {
        segment,
        label: segment,
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        width: Math.max(topology.spacing * 1.3, maxX - minX + padding * 2),
        depth: Math.max(topology.spacing * 1.3, maxZ - minZ + padding * 2),
      };
    });
}

interface MarkerRecord {
  node: TopologyNode;
  infection: THREE.Sprite;
  unknown: THREE.Sprite;
  patched: THREE.Sprite;
  panel: THREE.Group;
  isolation: THREE.Group;
  brackets: THREE.LineSegments;
  label: THREE.Sprite;
}

export class StateMarkerLayer {
  readonly group = new THREE.Group();

  private readonly records = new Map<string, MarkerRecord>();
  private readonly selectionLight = new THREE.PointLight(palette.accent, 0, 1.7, 2);
  private reducedMotion: boolean;

  constructor(topology: Topology, options: { reducedMotion?: boolean } = {}) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.group.name = 'fog-safe-state-markers';

    for (const zone of deriveZoneStencilSpecs(topology)) {
      const material = new THREE.MeshBasicMaterial({
        map: zoneStencilTexture(zone.label),
        transparent: true,
        opacity: 0.17,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: 0xffffff,
      });
      const stencil = new THREE.Mesh(
        new THREE.PlaneGeometry(zone.width, zone.depth),
        material,
      );
      stencil.name = `zone-stencil-${zone.segment}`;
      stencil.rotation.x = -Math.PI / 2;
      stencil.position.set(zone.x, 0.014, zone.z);
      stencil.renderOrder = 1;
      this.group.add(stencil);
    }

    const infectionTexture = markerGlyphTexture('infection');
    const unknownTexture = markerGlyphTexture('unknown');
    const patchedTexture = markerGlyphTexture('patched');
    const panelGeometry = new THREE.BoxGeometry(0.94, 0.09, 0.7);
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: '#160b13',
      emissive: palette.infection,
      emissiveIntensity: 0.08,
      roughness: 0.48,
      metalness: 0.72,
    });
    const panelEdgeGeometry = new THREE.EdgesGeometry(panelGeometry);
    const panelEdgeMaterial = new THREE.LineBasicMaterial({
      color: palette.infection,
      transparent: true,
      opacity: 0.72,
    });
    const hingeGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.88, 8);
    const hingeMaterial = new THREE.MeshStandardMaterial({
      color: '#7f344f',
      roughness: 0.42,
      metalness: 0.78,
    });
    const isolationGeometry = new THREE.BoxGeometry(0.48, 0.08, 0.12);
    const isolationMaterial = new THREE.MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.12,
      roughness: 0.42,
      metalness: 0.65,
    });
    const bracketGeometry = buildBracketGeometry();
    const bracketMaterial = new THREE.LineBasicMaterial({ color: '#c8f0fc' });

    for (const node of topology.nodes) {
      const top = nodeTopHeight(node.type);
      const infection = makeSprite(infectionTexture, THREAT_PLATE_SIZE);
      infection.name = `marker-infection-${node.id}`;
      infection.position.set(node.x, top + 0.58, node.z);

      const unknown = makeSprite(unknownTexture, UNKNOWN_PLATE_SIZE);
      unknown.name = `marker-unknown-${node.id}`;
      unknown.position.set(node.x, top + 0.47, node.z);

      const patched = makeSprite(patchedTexture, PATCH_PLATE_SIZE, PATCH_PLATE_SIZE, {
        color: '#91a6ad',
        opacity: 0.68,
      });
      patched.name = `marker-patched-${node.id}`;
      patched.position.set(node.x + 0.62, top + 0.78, node.z);

      const panel = new THREE.Group();
      panel.name = `marker-encrypted-panel-${node.id}`;
      panel.position.set(node.x, top + 0.3, node.z + 0.22);
      panel.rotation.x = -Math.PI * 0.18;
      const panelPlate = new THREE.Mesh(panelGeometry, panelMaterial);
      const panelEdge = new THREE.LineSegments(panelEdgeGeometry, panelEdgeMaterial);
      const panelHinge = new THREE.Mesh(hingeGeometry, hingeMaterial);
      panelHinge.position.z = -0.37;
      panelHinge.rotation.z = Math.PI / 2;
      panel.add(panelPlate, panelEdge, panelHinge);

      const isolation = new THREE.Group();
      isolation.name = `marker-isolation-${node.id}`;
      for (let index = 0; index < 4; index += 1) {
        const angle = index * (Math.PI / 2);
        const bar = new THREE.Mesh(isolationGeometry, isolationMaterial);
        bar.position.set(Math.cos(angle) * 0.94, 0.09, Math.sin(angle) * 0.94);
        bar.rotation.y = -angle;
        isolation.add(bar);
      }
      isolation.position.set(node.x, 0, node.z);

      const brackets = new THREE.LineSegments(bracketGeometry, bracketMaterial);
      brackets.name = `marker-selection-${node.id}`;
      brackets.position.set(node.x, 0.14, node.z);

      const labelTexture = assetLabelTexture(safeAssetLabel(node.label));
      const label = makeSprite(labelTexture, 1.52, 0.38);
      label.name = `marker-label-${node.id}`;
      label.position.set(node.x, top + 1.12, node.z);

      for (const object of [infection, unknown, patched, panel, isolation, brackets, label]) {
        object.visible = false;
        this.group.add(object);
      }
      this.records.set(node.id, {
        node,
        infection,
        unknown,
        patched,
        panel,
        isolation,
        brackets,
        label,
      });
    }

    this.selectionLight.name = 'local-selection-light';
    this.selectionLight.visible = false;
    this.group.add(this.selectionLight);
  }

  apply(view: PresentationView, selectedId: string | null): void {
    let selectedRecord: MarkerRecord | null = null;
    for (const record of this.records.values()) {
      const presentation = view.nodes[record.node.id];
      if (!presentation) {
        this.hide(record);
        continue;
      }
      const state = deriveMarkerState(presentation, record.node.id === selectedId);
      record.infection.visible = state.infected;
      record.unknown.visible = state.unknown;
      record.patched.visible = state.patched;
      record.panel.visible = state.encrypted;
      record.panel.position.z = record.node.z + 0.22 + state.panelDisplacement;
      record.isolation.visible = state.isolated;
      record.brackets.visible = state.showBrackets;
      record.label.visible = state.showLabel;
      if (state.selected) selectedRecord = record;
    }

    if (selectedRecord) {
      this.selectionLight.visible = true;
      this.selectionLight.intensity = 1.35;
      this.selectionLight.position.set(
        selectedRecord.node.x,
        nodeTopHeight(selectedRecord.node.type) + 0.42,
        selectedRecord.node.z,
      );
    } else {
      this.selectionLight.visible = false;
      this.selectionLight.intensity = 0;
    }
  }

  tick(elapsed: number): void {
    const scale = infectionPulseScale(elapsed, this.reducedMotion);
    for (const record of this.records.values()) {
      if (!record.infection.visible) continue;
      record.infection.scale.set(
        THREAT_PLATE_SIZE * scale,
        THREAT_PLATE_SIZE * scale,
        1,
      );
    }
  }

  setReducedMotion(enabled: boolean): void {
    if (this.reducedMotion === enabled) return;
    this.reducedMotion = enabled;
    if (!enabled) return;
    for (const record of this.records.values()) {
      record.infection.scale.set(THREAT_PLATE_SIZE, THREAT_PLATE_SIZE, 1);
    }
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.LineSegments)) return;
      if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) {
        geometries.add(object.geometry);
      }
      const materialList = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materialList) {
        materials.add(material);
        if ('map' in material && material.map instanceof THREE.Texture) textures.add(material.map);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this.group.clear();
    this.records.clear();
  }

  private hide(record: MarkerRecord): void {
    record.infection.visible = false;
    record.unknown.visible = false;
    record.patched.visible = false;
    record.panel.visible = false;
    record.isolation.visible = false;
    record.brackets.visible = false;
    record.label.visible = false;
  }
}

function makeSprite(
  map: THREE.Texture,
  width: number,
  height = width,
  options: { color?: THREE.ColorRepresentation; opacity?: number } = {},
): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      color: options.color ?? 0xffffff,
      transparent: true,
      opacity: options.opacity ?? 1,
      depthWrite: false,
      alphaTest: 0.06,
    }),
  );
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 5;
  return sprite;
}

function buildBracketGeometry(): THREE.BufferGeometry {
  const inner = 0.7;
  const outer = 1.02;
  const positions: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      positions.push(
        sx * inner,
        0,
        sz * outer,
        sx * outer,
        0,
        sz * outer,
        sx * outer,
        0,
        sz * inner,
        sx * outer,
        0,
        sz * outer,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
