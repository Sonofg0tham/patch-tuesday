// Scene setup: renderer, a fixed tilted camera framed to the loaded board, the
// light rig, the environment map, the ground plane, the airborne dust, and pan
// and zoom bounded so the board can never be lost off screen. The board
// contents themselves are built in board.ts; this module owns the camera, the
// lighting and the atmosphere.
//
// Phase 7 changed how the image is formed. The renderer now runs ACES filmic
// tone mapping, which is what stops bright cyan emissive clipping to flat white
// and gives the highlights a filmic roll-off instead of a hard edge. Everything
// downstream is balanced against that: light intensities are higher than they
// look because the tone mapper pulls them back down, and the exposure knob in
// VISUAL_CONFIG is the single dial for the whole image's brightness.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { palette } from '../config/palette';
import { VISUAL_CONFIG } from '../config/visual';
import { COMPANY } from '../config/company';
import { effectiveVisibilityFloor, motionReduced } from '../data/settings';
import type { Topology } from '../data/topology';
import { MAX_NODE_HEIGHT } from './geometry';
import { createGroundMaterial } from './materials';
import { buildEnvironment, moteTexture, setTextureAnisotropy } from './textures';

const CAMERA_TILT = new THREE.Vector3(0, 0.78, 0.62).normalize();
const TARGET_HEIGHT = 0.6; // look at board mid-height, not the floor

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  /** The prefiltered war-room cube map every metal surface reflects. */
  environment: THREE.Texture;
  /** Advances the dust drift. A no-op at reduced motion. */
  tickAtmosphere(elapsed: number): void;
  fitEstate(): void;
}

export function createScene(topology: Topology): SceneContext {
  // antialias stays on for the LOW quality tier, which bypasses the composer
  // and draws straight to this framebuffer. At MEDIUM and HIGH the composer's
  // own target does the antialiasing and this flag costs nothing but the
  // default framebuffer's sample allocation.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Cap the pixel ratio: full 3x on a high-density display costs fill rate
  // the integrated-graphics target cannot spare.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Filmic response. Without this, the cyan emissive and the bloom clip to
  // white and the whole board reads as a flat diagram lit by a torch.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = VISUAL_CONFIG.exposure;
  // Must happen before any material builds its maps: the textures bake this in
  // as they are created.
  setTextureAnisotropy(renderer.capabilities.getMaxAnisotropy());
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.base);
  // A breath of atmospheric fog so the far edge of the estate recedes into the
  // dark, the war-room-display depth. Thinned as the visibility floor rises so
  // the nystagmus setting never buries a distant node in haze.
  const floor = effectiveVisibilityFloor();
  scene.fog = new THREE.FogExp2(palette.base, 0.014 * (1 - floor));

  // The environment map: a small procedural room, prefiltered into a cube map.
  // This is what every metal chassis on the board reflects, and it is the
  // difference between "grey box lit from above" and "machined metal".
  const environment = buildEnvironment(renderer);
  scene.environment = environment;

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

  const extent = Math.max(topology.halfWidth, topology.halfDepth) + 3;

  // One dramatic key light with shadows. Kept punchy for the war-room contrast;
  // the readability comes from the ambient floor below, not from flattening this.
  const keyLight = new THREE.DirectionalLight(palette.keyLight, 3.4);
  keyLight.position.set(
    topology.halfWidth + 6,
    Math.max(topology.halfWidth, topology.halfDepth) + 12,
    topology.halfDepth + 4,
  );
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -extent;
  keyLight.shadow.camera.right = extent;
  keyLight.shadow.camera.top = extent;
  keyLight.shadow.camera.bottom = -extent;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = keyLight.position.length() + extent * 2;
  // Soft contact shadows rather than hard stencils, and a bias that stops the
  // bevelled chassis shadow-acneing on its own curved edges.
  keyLight.shadow.radius = 3;
  keyLight.shadow.bias = -0.0008;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  // A cool rim from behind and opposite the key. Three-point lighting: this is
  // the light that separates a dark chassis from the dark room behind it, and
  // with the fresnel rim in the chassis material it is what gives every node a
  // readable silhouette without flattening the scene.
  const rimLight = new THREE.DirectionalLight(palette.keyLight, 1.1);
  rimLight.position.set(-topology.halfWidth - 8, 5, -topology.halfDepth - 8);
  scene.add(rimLight);

  // A cool cyan uplight from the floor gives the infrastructure its war-room
  // glow from below, and a hemisphere fill lifts shadowed faces. The ambient
  // floor scales with the nystagmus visibility knob: darker and more cinematic
  // at 0, flatter and maximally legible at 1.
  scene.add(new THREE.AmbientLight(COMPANY.materials.paper, 0.10 + 0.5 * floor));
  scene.add(new THREE.HemisphereLight(palette.keyLight, COMPANY.materials.edge, 0.16 + 0.4 * floor));

  // The domain controller is the crown of the board: a dedicated cyan point
  // light picks it out of the dark so the eye lands on the crown jewels first.
  const dc = topology.nodes.find((n) => n.type === 'domain-controller');
  if (dc) {
    const crown = new THREE.PointLight(palette.accent, 6 + 8 * (1 - floor), 16, 2);
    crown.position.set(dc.x, MAX_NODE_HEIGHT + 1.6, dc.z);
    scene.add(crown);
  }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), createGroundMaterial(environment));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.position.y = -0.4;
  scene.add(ground);

  const dust = createDust(topology);
  if (dust) scene.add(dust.points);

  return {
    renderer,
    scene,
    camera,
    controls,
    environment,
    fitEstate() { fitCameraToBoard(camera, controls, topology); },
    tickAtmosphere(elapsed) {
      dust?.tick(elapsed);
    },
  };
}

// Airborne dust hanging in the light. A hall this size always has some, and it
// is the cheapest available substitute for volumetric lighting: the motes catch
// the cyan and give the empty air above the board something to occupy it.
//
// The drift is slow by design and stops dead at reduced motion, where a field
// of moving specks is exactly the wrong thing to put on screen.
function createDust(topology: Topology): { points: THREE.Points; tick(elapsed: number): void } | null {
  const count = VISUAL_CONFIG.dustCount;
  if (count <= 0) return null;

  const spreadX = topology.halfWidth + 6;
  const spreadZ = topology.halfDepth + 6;
  const ceiling = MAX_NODE_HEIGHT + 5;

  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() * 2 - 1) * spreadX;
    positions[i * 3 + 1] = Math.random() * ceiling;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * spreadZ;
    phases[i] = Math.random() * Math.PI * 2;
    speeds[i] = 0.04 + Math.random() * 0.09;
  }
  const baseY = positions.slice();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: moteTexture(),
      color: palette.accent,
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    }),
  );
  points.frustumCulled = false;

  const still = motionReduced();
  return {
    points,
    tick(elapsed) {
      if (still) return;
      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < count; i += 1) {
        // A slow rise with a lateral sway, wrapping at the ceiling. Cheap
        // enough to run on the CPU for a few hundred motes.
        const y = (baseY[i * 3 + 1] + elapsed * speeds[i]) % ceiling;
        attribute.setY(i, y);
        attribute.setX(i, baseY[i * 3] + Math.sin(elapsed * 0.22 + phases[i]) * 0.35);
      }
      attribute.needsUpdate = true;
    },
  };
}

// Frames the camera so the whole estate is comfortably in view, from a fixed
// tilt. The board is already centred on the origin by the loader.
export function fitCameraToBoard(
  camera: THREE.PerspectiveCamera,
  controls: MapControls,
  topology: Topology,
): void {
  // Project the actual model bounds, then reserve the measured DOM safe area.
  // Using a bounding sphere left most of the screen empty on wide estates.
  const area = boardSafeArea();
  camera.clearViewOffset();
  controls.target.set(0, TARGET_HEIGHT, 0);
  camera.position.copy(controls.target).addScaledVector(CAMERA_TILT, 40);
  camera.lookAt(controls.target);
  camera.updateMatrixWorld();
  const inverse = camera.matrixWorldInverse;
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let distance = 1;
  for (const x of [-topology.halfWidth - 1.3, topology.halfWidth + 1.3]) {
    for (const z of [-topology.halfDepth - 1.3, topology.halfDepth + 1.3]) {
      for (const y of [-0.4, MAX_NODE_HEIGHT + 0.5]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(inverse);
        const depthOffset = point.z + 40;
        distance = Math.max(distance,
          Math.abs(point.x) / (tangent * camera.aspect * area.width / window.innerWidth) + depthOffset,
          Math.abs(point.y) / (tangent * area.height / window.innerHeight) + depthOffset);
      }
    }
  }
  distance *= COMPANY.fitPadding;
  camera.position.copy(controls.target).addScaledVector(CAMERA_TILT, distance);
  // Offset the projection without changing the fixed viewing angle.
  camera.setViewOffset(window.innerWidth, window.innerHeight,
    window.innerWidth / 2 - (area.left + area.width / 2),
    window.innerHeight / 2 - (area.top + area.height / 2), window.innerWidth, window.innerHeight);

  controls.minDistance = distance * 0.45;
  controls.maxDistance = distance * 1.4;
  controls.update();
}

export function boardSafeArea(): { left: number; top: number; width: number; height: number } {
  const header = document.getElementById('command-header')?.getBoundingClientRect();
  const tray = document.getElementById('command-tray')?.getBoundingClientRect();
  const inspector = document.getElementById('company-sidebar')?.getBoundingClientRect();
  const top = (header?.bottom ?? 0) + 12;
  const right = inspector && window.innerWidth >= 760 ? inspector.left - 12 : window.innerWidth - 12;
  const bottom = (tray?.top ?? window.innerHeight) - 12;
  return { left: 12, top, width: Math.max(120, right - 12), height: Math.max(120, bottom - top) };
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
// boots at 0x0 must still recover. Returns true on the frames where the size
// actually changed, so the post-processing chain can resize its targets too.
export function resizeIfNeeded(context: SceneContext): boolean {
  const { renderer, camera } = context;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x === width && size.y === height) return false;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  return true;
}
