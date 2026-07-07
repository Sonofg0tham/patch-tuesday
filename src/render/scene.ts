// Scene setup for the spike board: renderer, tilted fixed camera with pan
// and zoom, one shadow-casting directional light, a ground plane, and a 6x6
// grid of boxes drawn as a single instanced mesh.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { palette } from '../config/palette';

export const GRID_SIZE = 6;
export const NODE_COUNT = GRID_SIZE * GRID_SIZE;
const SPACING = 1.4;
const BOX_SIZE = 0.85;

export const COLOUR_BASE = new THREE.Color(palette.nodeBase);
export const COLOUR_HOVER = new THREE.Color(palette.nodeHover);
export const COLOUR_SELECTED = new THREE.Color(palette.nodeSelected);

export interface SpikeScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  grid: THREE.InstancedMesh;
}

export function createScene(): SpikeScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Cap the pixel ratio: full 3x on a high-density display costs fill rate
  // the integrated-graphics target cannot spare.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.base);

  // Fixed tilted view down at the board. Pan and zoom only, never rotation.
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.set(0, 9.5, 7.5);
  camera.lookAt(0, 0, 0);

  const controls = new MapControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.screenSpacePanning = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 22;
  controls.zoomSpeed = 0.8;

  // One dramatic key light with shadows plus a dim fill so shadowed faces
  // stay readable against the near-black background.
  const keyLight = new THREE.DirectionalLight(palette.keyLight, 2.2);
  keyLight.position.set(6, 12, 4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const shadowExtent = (GRID_SIZE * SPACING) / 2 + 2;
  keyLight.shadow.camera.left = -shadowExtent;
  keyLight.shadow.camera.right = shadowExtent;
  keyLight.shadow.camera.top = shadowExtent;
  keyLight.shadow.camera.bottom = -shadowExtent;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 30;
  scene.add(keyLight);
  scene.add(new THREE.AmbientLight(palette.accent, 0.25));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = createGrid();
  scene.add(grid);

  return { renderer, scene, camera, controls, grid };
}

// Called every frame rather than from a resize event: some embedded
// contexts load the page at zero size or fire no resize event, and a
// renderer that boots at 0x0 must still recover.
export function resizeIfNeeded(spike: SpikeScene): void {
  const { renderer, camera } = spike;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x === width && size.y === height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// All 36 boxes are one draw call: a single InstancedMesh with a per-instance
// transform and colour. This is the rendering pattern the real board uses.
function createGrid(): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
  // Material colour stays white so the per-instance colour shows unmodified.
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.55,
    metalness: 0.1,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, NODE_COUNT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const offset = ((GRID_SIZE - 1) * SPACING) / 2;
  const transform = new THREE.Matrix4();
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const index = row * GRID_SIZE + col;
      transform.setPosition(
        col * SPACING - offset,
        BOX_SIZE / 2,
        row * SPACING - offset,
      );
      mesh.setMatrixAt(index, transform);
      mesh.setColorAt(index, COLOUR_BASE);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
