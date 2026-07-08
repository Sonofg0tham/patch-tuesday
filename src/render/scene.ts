// Scene setup: renderer, a fixed tilted camera framed to the loaded board,
// one shadow-casting key light plus a dim fill, the ground plane, and pan and
// zoom bounded so the board can never be lost off screen. The board contents
// themselves are built in board.ts; this module owns the camera and lighting.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { palette } from '../config/palette';
import { VISUAL_CONFIG } from '../config/visual';
import type { Topology } from '../data/topology';

const MAX_NODE_HEIGHT = 2.4; // the domain controller, the tallest silhouette
const CAMERA_TILT = new THREE.Vector3(0, 0.78, 0.62).normalize();
const TARGET_HEIGHT = 0.6; // look at board mid-height, not the floor

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
}

export function createScene(topology: Topology): SceneContext {
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
  // A breath of atmospheric fog so the far edge of the estate recedes into the
  // dark, the war-room-display depth. Thinned as the visibility floor rises so
  // the nystagmus setting never buries a distant node in haze.
  const fogDensity = 0.014 * (1 - VISUAL_CONFIG.visibilityFloor);
  scene.fog = new THREE.FogExp2(palette.base, fogDensity);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    400,
  );

  const controls = new MapControls(camera, renderer.domElement);
  controls.enableRotate = false; // pan and zoom only, never rotation
  controls.screenSpacePanning = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomSpeed = 0.8;

  fitCameraToBoard(camera, controls, topology);

  // One dramatic key light with shadows. Kept punchy for the war-room contrast;
  // the readability comes from the ambient floor below, not from flattening this.
  const keyLight = new THREE.DirectionalLight(palette.keyLight, 2.4);
  keyLight.position.set(
    topology.halfWidth + 6,
    Math.max(topology.halfWidth, topology.halfDepth) + 12,
    topology.halfDepth + 4,
  );
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const extent = Math.max(topology.halfWidth, topology.halfDepth) + 3;
  keyLight.shadow.camera.left = -extent;
  keyLight.shadow.camera.right = extent;
  keyLight.shadow.camera.top = extent;
  keyLight.shadow.camera.bottom = -extent;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = keyLight.position.length() + extent * 2;
  scene.add(keyLight);

  // A cool cyan uplight from the floor gives the infrastructure its war-room
  // glow from below, and a hemisphere fill lifts shadowed faces. The ambient
  // floor scales with the nystagmus visibility knob: darker and more cinematic
  // at 0, flatter and maximally legible at 1.
  const floor = VISUAL_CONFIG.visibilityFloor;
  scene.add(new THREE.AmbientLight(palette.accent, 0.12 + 0.5 * floor));
  scene.add(new THREE.HemisphereLight(palette.keyLight, palette.accent, 0.18 + 0.4 * floor));

  // The domain controller is the crown of the board: a dedicated cyan point
  // light picks it out of the dark so the eye lands on the crown jewels first.
  const dc = topology.nodes.find((n) => n.type === 'domain-controller');
  if (dc) {
    const crown = new THREE.PointLight(palette.accent, 6 + 6 * (1 - floor), 14, 2);
    crown.position.set(dc.x, MAX_NODE_HEIGHT + 3, dc.z);
    scene.add(crown);
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return { renderer, scene, camera, controls };
}

// Frames the camera so the whole estate is comfortably in view, from a fixed
// tilt. The board is already centred on the origin by the loader.
function fitCameraToBoard(
  camera: THREE.PerspectiveCamera,
  controls: MapControls,
  topology: Topology,
): void {
  const radius = Math.hypot(topology.halfWidth, topology.halfDepth, MAX_NODE_HEIGHT);
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.15;

  controls.target.set(0, TARGET_HEIGHT, 0);
  camera.position.copy(controls.target).addScaledVector(CAMERA_TILT, distance);
  camera.lookAt(controls.target);

  controls.minDistance = distance * 0.45;
  controls.maxDistance = distance * 1.4;
  controls.update();
}

// Keeps the pan target within the board plus a margin, so the estate stays on
// screen. Shifts camera and target together so the framing never distorts.
export function clampPan(context: SceneContext, topology: Topology): void {
  const { controls, camera } = context;
  const padX = topology.halfWidth + 2;
  const padZ = topology.halfDepth + 2;
  const clampedX = THREE.MathUtils.clamp(controls.target.x, -padX, padX);
  const clampedZ = THREE.MathUtils.clamp(controls.target.z, -padZ, padZ);
  const dx = clampedX - controls.target.x;
  const dz = clampedZ - controls.target.z;
  if (dx === 0 && dz === 0) return;
  controls.target.x = clampedX;
  controls.target.z = clampedZ;
  camera.position.x += dx;
  camera.position.z += dz;
}

// Called every frame rather than from a resize event: some embedded contexts
// load the page at zero size or fire no resize event, and a renderer that
// boots at 0x0 must still recover.
export function resizeIfNeeded(context: SceneContext): void {
  const { renderer, camera } = context;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x === width && size.y === height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
