// The board's material set (Phase 7). Every material here is a
// MeshStandardMaterial with a small shader injection rather than a bespoke
// ShaderMaterial, so the board keeps three's real PBR lighting, shadows, fog
// and tone mapping and only gains the two things the stock material cannot do:
//
//  1. Emissive that follows an InstancedMesh's per-instance colour. The board
//     drives node state through setColorAt(); without this, an infected node
//     changes its diffuse but never actually glows, so it cannot bloom.
//  2. A fresnel rim light, so a near-black chassis against a near-black
//     background still has an edge. This is a readability device as much as a
//     realism one and it is wired to the nystagmus visibility floor.
//
// Cables get a third: an emissive pulse that travels along the tube, so a live
// link visibly carries traffic and a compromised one visibly carries the worm.

import * as THREE from 'three';
import { palette } from '../config/palette';
import { VISUAL_CONFIG } from '../config/visual';
import { effectiveVisibilityFloor, motionReduced } from '../data/settings';
import { cableSurface, floorSurface, panelSurface, tiled } from './textures';

// Uniform sets that need a clock ticked every frame.
//
// three runs onBeforeCompile once per material, lazily, at that material's
// first render, and stores the resulting uniforms per material (materials with
// a matching customProgramCacheKey share the compiled GL program but keep their
// own uniform values). So the only way to reach an injected uniform later is to
// stash it when three hands it over.
const animated: Record<string, THREE.IUniform>[] = [];
const uniformsByMaterial = new WeakMap<THREE.Material, Record<string, THREE.IUniform>>();

/** Advances every flow animation. Called once per frame from the main loop. */
export function tickMaterials(elapsed: number): void {
  const animationTime = cableAnimationTime(elapsed, motionReduced());
  for (const uniforms of animated) uniforms.uTime.value = animationTime;
}

export function cableAnimationTime(elapsed: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : elapsed;
}

function capture(material: THREE.Material, uniforms: Record<string, THREE.IUniform>): void {
  uniformsByMaterial.set(material, uniforms);
}

function uniformsOf(material: THREE.Material): Record<string, THREE.IUniform> | undefined {
  return uniformsByMaterial.get(material);
}

// --- The chassis material ---

export interface ChassisOptions {
  /** Texture tiling density. A tall rack wants more repeats than a puck. */
  repeat: [number, number];
  /** Global multiplier on the per-instance glow. */
  emissive: number;
}

/**
 * The per-instance glow attribute name. The board writes one float per node
 * into this, so a single shared material can have a clean node sitting almost
 * dark while its infected neighbour glows hard enough to bloom. A uniform
 * could not do that, and splitting the material per state would cost the
 * instancing that keeps the draw calls flat.
 */
export const EMISSIVE_ATTRIBUTE = 'aEmissive';

export function createChassisMaterial(
  environment: THREE.Texture | null,
  options: ChassisOptions,
): THREE.MeshStandardMaterial {
  const maps = tiled(panelSurface(), options.repeat[0], options.repeat[1]);
  const floor = effectiveVisibilityFloor();

  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff', // white base so the per-instance colour shows unmodified
    roughness: 0.55,
    metalness: 0.78, // real metal, so the environment map does the heavy lifting
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: maps.roughnessMap,
    envMap: environment,
    envMapIntensity: VISUAL_CONFIG.envIntensity,
  });

  const injected = {
    uStateEmissive: { value: options.emissive },
    // The rim brightens as the visibility floor rises, so the nystagmus setting
    // buys edge definition rather than just flat ambient wash. Kept low: it is
    // there to draw an edge, not to light the object.
    uRimStrength: { value: 0.14 + 0.3 * floor },
    uRimColour: { value: new THREE.Color(palette.accent) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, injected);
    capture(material, shader.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute float ${EMISSIVE_ATTRIBUTE};
        varying float vStateGlow;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n        vStateGlow = ${EMISSIVE_ATTRIBUTE};`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uStateEmissive;
        uniform float uRimStrength;
        uniform vec3 uRimColour;
        varying float vStateGlow;
        `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>

        // Fresnel rim. Grazing angles pick up a cyan edge so a dark chassis
        // never dissolves into the dark room behind it.
        float rimFacing = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        float rim = pow(clamp(rimFacing, 0.0, 1.0), 2.6) * uRimStrength;
        totalEmissiveRadiance += uRimColour * rim;

        // State emissive: the per-instance colour the board writes with
        // setColorAt() becomes light, not just paint, so an infected node
        // genuinely glows and reaches the bloom threshold, while a clean one
        // next to it stays a quiet piece of infrastructure.
        #ifdef USE_INSTANCING_COLOR
          totalEmissiveRadiance += vColor * vStateGlow * uStateEmissive;
        #endif
        `,
      );
  };

  // three caches compiled programs by this key; a distinct one per emissive
  // setting keeps two chassis materials from sharing the wrong program.
  material.customProgramCacheKey = () => `chassis:${options.emissive}:${floor.toFixed(2)}`;
  return material;
}

/** Retunes a chassis material's state emissive at runtime (used by the tier switch). */
export function setChassisEmissive(material: THREE.Material, value: number): void {
  const uniforms = uniformsOf(material);
  if (uniforms?.uStateEmissive) uniforms.uStateEmissive.value = value;
}

// --- The cable material ---

export interface CableMaterial {
  material: THREE.MeshStandardMaterial;
  /** Recolour for compromise, and set how hard the flow pulses read. */
  setCompromised(compromised: boolean): void;
  /** Dim a cable whose endpoint has been isolated but which is still drawn. */
  setFlowStrength(strength: number): void;
}

export const HEALTHY_CABLE_EMISSIVE = 0.035;
const HEALTHY_CABLE_FLOW = 0.3;

export function createCableMaterial(
  environment: THREE.Texture | null,
  length: number,
): CableMaterial {
  // The braid tiles along the cable's length, so a long run does not look
  // stretched next to a short one.
  const maps = tiled(cableSurface(), 1, Math.max(1, Math.round(length * 2)));

  const material = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: HEALTHY_CABLE_EMISSIVE * VISUAL_CONFIG.glowIntensity,
    roughness: 0.45,
    metalness: 0.55,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: maps.roughnessMap,
    envMap: environment,
    envMapIntensity: VISUAL_CONFIG.envIntensity * 0.7,
  });

  const injected: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uFlowSpeed: { value: VISUAL_CONFIG.cableFlowSpeed },
    uFlowLength: { value: Math.max(1, length) },
    uFlowStrength: { value: HEALTHY_CABLE_FLOW * VISUAL_CONFIG.glowIntensity },
    uFlowColour: { value: new THREE.Color(palette.accent) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, injected);
    capture(material, shader.uniforms);
    animated.push(shader.uniforms);

    // Our own UV varying rather than three's per-map ones (vMapUv,
    // vNormalMapUv, ...), whose names depend on which maps are attached.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCableUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCableUv = uv;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec2 vCableUv;
        uniform float uTime;
        uniform float uFlowSpeed;
        uniform float uFlowLength;
        uniform float uFlowStrength;
        uniform vec3 uFlowColour;
        `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>

        // A packet travelling the wire. vCableUv.y runs 0..1 along the tube, so
        // scaling by the cable's world length keeps every run at the same
        // apparent speed regardless of how long it is.
        float along = vCableUv.y * uFlowLength;
        float phase = fract(along * 0.55 - uTime * uFlowSpeed);
        // A sharp head with a short tail, the shape of a data pulse.
        float pulse = pow(1.0 - phase, 14.0) + 0.12 * pow(1.0 - phase, 3.0);
        totalEmissiveRadiance += uFlowColour * pulse * uFlowStrength;
        `,
      );
  };

  material.customProgramCacheKey = () => 'cable-flow';

  return {
    material,
    setCompromised(compromised) {
      const colour = compromised ? palette.infection : palette.accent;
      material.color.set(colour);
      material.emissive.set(colour);
      material.emissiveIntensity =
        (compromised ? 0.42 : HEALTHY_CABLE_EMISSIVE) * VISUAL_CONFIG.glowIntensity;
      const uniforms = uniformsOf(material) ?? injected;
      (uniforms.uFlowColour.value as THREE.Color).set(colour);
      // The worm travels faster and hits harder than routine traffic does.
      uniforms.uFlowSpeed.value = VISUAL_CONFIG.cableFlowSpeed * (compromised ? 2.1 : 1);
      uniforms.uFlowStrength.value =
        (compromised ? 1.5 : HEALTHY_CABLE_FLOW) * VISUAL_CONFIG.glowIntensity;
    },
    setFlowStrength(strength) {
      const uniforms = uniformsOf(material) ?? injected;
      uniforms.uFlowStrength.value = strength * VISUAL_CONFIG.glowIntensity;
    },
  };
}

// --- The floor ---

export function createGroundMaterial(environment: THREE.Texture | null): THREE.MeshStandardMaterial {
  // One texture repeat per raised-floor tile, at roughly two world units a tile.
  const maps = tiled(floorSurface(), 100, 100);
  return new THREE.MeshStandardMaterial({
    color: palette.ground,
    roughness: 0.68,
    metalness: 0.25, // damp sealed concrete takes a slight sheen
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: maps.roughnessMap,
    envMap: environment,
    envMapIntensity: VISUAL_CONFIG.envIntensity * 0.45,
  });
}
