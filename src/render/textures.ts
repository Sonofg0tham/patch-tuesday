// Procedural material maps (Phase 7). Every texture in the game is painted in
// code at boot: no image files, no CDN fetches, CC0 by construction, same rule
// as the geometry and the audio.
//
// Realism here comes from three things a flat MeshStandardMaterial cannot give
// you: a normal map so surfaces catch the light unevenly, a roughness map so
// the specular breaks up instead of reading as plastic, and an environment map
// so metal has something to actually reflect. This module builds all three.
//
// Everything is tileable: the patterns wrap at the canvas edge so a texture can
// repeat across the ground plane without a visible seam.

import * as THREE from 'three';

// Anisotropic filtering level, set once from the renderer's real capability.
// The floor is seen at a very grazing angle across most of the frame, which is
// exactly the case trilinear filtering handles worst: without this the far half
// of the board turns to mush and the tile seams shimmer as the camera pans.
let anisotropy = 1;

export function setTextureAnisotropy(value: number): void {
  anisotropy = Math.max(1, value);
}

// Applies the shared sampling settings every generated texture wants: wrapping,
// mipmaps (so distant tiles filter down instead of aliasing), and anisotropy.
function configure<T extends THREE.Texture>(texture: T): T {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

// A canvas we can draw a height field into, then differentiate into normals.
function scratchCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  return { canvas, ctx };
}

// Value noise, seeded and tileable. Used for surface grain: smudges on the
// roughness maps, grit in the concrete, the mottling that stops a flat panel
// reading as a flat panel.
function tileableNoise(size: number, cells: number, seed: number): Float32Array {
  const grid = new Float32Array(cells * cells);
  let s = seed >>> 0;
  const rand = (): number => {
    // xorshift32: deterministic, so a build always paints the same surfaces.
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();

  const out = new Float32Array(size * size);
  const scale = cells / size;
  const smooth = (t: number): number => t * t * (3 - 2 * t); // smoothstep
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fx = x * scale;
      const fy = y * scale;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      // Wrapping the lattice lookup is what makes the result tile.
      const i00 = (y0 % cells) * cells + (x0 % cells);
      const i10 = (y0 % cells) * cells + ((x0 + 1) % cells);
      const i01 = ((y0 + 1) % cells) * cells + (x0 % cells);
      const i11 = ((y0 + 1) % cells) * cells + ((x0 + 1) % cells);
      const top = grid[i00] + (grid[i10] - grid[i00]) * tx;
      const bottom = grid[i01] + (grid[i11] - grid[i01]) * tx;
      out[y * size + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

// Layered noise: several octaves of the above, each finer and quieter. This is
// what gives a surface detail at more than one scale, which is most of what
// separates a hand-made texture from a flat fill.
function fbm(size: number, seed: number, octaves = 4, baseCells = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    const layer = tileableNoise(size, baseCells * 2 ** o, seed + o * 7919);
    for (let i = 0; i < out.length; i += 1) out[i] += layer[i] * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= total;
  return out;
}

// Differentiates a height field into a tangent-space normal map. The wrapping
// neighbour lookup keeps the normals continuous across the tile seam.
function heightToNormalTexture(height: Float32Array, size: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Sobel gradient, so a single-pixel step does not produce a hard edge.
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / length) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / length) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace; // a normal map is data, not colour
  return configure(texture);
}

// Packs a single-channel field into a greyscale texture, for roughness/metalness
// maps. Also data, never colour-managed.
function fieldToTexture(field: Float32Array, size: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < field.length; i += 1) {
    const v = Math.max(0, Math.min(255, field[i] * 255));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  return configure(texture);
}

// Reads a canvas back as a height field in 0..1, so patterns are drawable with
// the 2d API (rectangles, lines, arcs) and still end up as geometry-lite relief.
function canvasToHeight(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i += 1) out[i] = data[i * 4] / 255;
  return out;
}

export interface SurfaceMaps {
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

// --- The surfaces ---

// Enclosure panel: a sheet-metal chassis. Recessed panel seams, a run of vent
// slots, and rows of small fixing screws, over a fine brushed grain. This is
// what a workstation, a rack and the DC are all skinned in, at different tile
// densities, so the whole estate reads as the same manufactured kit.
function buildPanelSurface(): SurfaceMaps {
  const size = 512;
  const { canvas, ctx } = scratchCanvas(size);

  // Mid grey is "flat"; darker is recessed, lighter is raised.
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // A fine vertical brushed grain across the whole sheet.
  for (let x = 0; x < size; x += 1) {
    const v = 128 + (Math.sin(x * 2.4) + Math.sin(x * 0.37)) * 3;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, size);
  }

  // Panel seams: recessed grooves splitting the sheet into plates.
  ctx.strokeStyle = '#404040';
  ctx.lineWidth = 3;
  for (const y of [0, size / 2]) {
    ctx.beginPath();
    ctx.moveTo(0, y + 1.5);
    ctx.lineTo(size, y + 1.5);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(size / 2 + 1.5, 0);
  ctx.lineTo(size / 2 + 1.5, size);
  ctx.stroke();

  // Vent slots: a stack of deep horizontal louvres in the lower-left plate.
  ctx.fillStyle = '#2a2a2a';
  for (let i = 0; i < 9; i += 1) {
    ctx.fillRect(size * 0.08, size * 0.58 + i * 14, size * 0.34, 7);
  }
  // Each louvre gets a lit lower lip, the highlight that sells the depth.
  ctx.fillStyle = '#b8b8b8';
  for (let i = 0; i < 9; i += 1) {
    ctx.fillRect(size * 0.08, size * 0.58 + i * 14 + 7, size * 0.34, 2);
  }

  // Fixing screws around the plate corners: raised domes with a recessed slot.
  const screw = (cx: number, cy: number): void => {
    ctx.beginPath();
    ctx.fillStyle = '#c8c8c8';
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(cx - 3.5, cy - 1, 7, 2);
  };
  for (const cx of [size * 0.06, size * 0.44, size * 0.56, size * 0.94]) {
    for (const cy of [size * 0.06, size * 0.44, size * 0.56, size * 0.94]) screw(cx, cy);
  }

  const height = canvasToHeight(canvas);
  // Blend a whisper of fine noise into the height so even the flat plate has
  // microstructure to catch the key light.
  const grain = fbm(size, 1337, 3, 6);
  for (let i = 0; i < height.length; i += 1) height[i] = height[i] * 0.975 + grain[i] * 0.025;

  // Roughness: mostly satin, with smudges and dust from the fbm and a polished
  // sheen along the brushed grain. Varying this is what kills the plastic look.
  const rough = new Float32Array(size * size);
  const smudge = fbm(size, 4242, 4, 6);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const grainSheen = (Math.sin(x * 2.4) * 0.5 + 0.5) * 0.08;
      rough[i] = Math.min(1, 0.34 + smudge[i] * 0.34 + grainSheen);
    }
  }

  return {
    normalMap: heightToNormalTexture(height, size, 1.3),
    roughnessMap: fieldToTexture(rough, size),
  };
}

// The floor of the war room: poured concrete with a shallow trowel swirl, an
// aggregate grit, and the faint recessed grid of raised-floor tiles you get in
// a real data hall.
function buildFloorSurface(): SurfaceMaps {
  const size = 512;
  const { canvas, ctx } = scratchCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Raised-floor tile seams, recessed, one tile per texture repeat.
  ctx.strokeStyle = '#5a5a5a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  // A lit edge just inside each seam, so the tile has a bevel not a line.
  ctx.strokeStyle = '#9a9a9a';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, size - 12, size - 12);

  // The tile's own lifting sockets, one per corner.
  ctx.fillStyle = '#5e5e5e';
  for (const [cx, cy] of [[26, 26], [size - 26, 26], [26, size - 26], [size - 26, size - 26]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const height = canvasToHeight(canvas);
  const swirl = fbm(size, 909, 5, 3); // broad trowel undulation
  const grit = fbm(size, 5150, 3, 20); // fine aggregate
  for (let i = 0; i < height.length; i += 1) {
    height[i] = height[i] * 0.78 + swirl[i] * 0.18 + grit[i] * 0.04;
  }

  // Concrete is rough and unevenly sealed: patches of it catch the light.
  const rough = new Float32Array(size * size);
  const sealer = fbm(size, 3131, 4, 4);
  for (let i = 0; i < rough.length; i += 1) rough[i] = 0.62 + sealer[i] * 0.34;

  return {
    normalMap: heightToNormalTexture(height, size, 1.4),
    roughnessMap: fieldToTexture(rough, size),
  };
}

// Cable sheathing: a tight helical braid, the shielded-conduit look. Wrapped
// around the tube so the cables read as physical objects, not glowing sticks.
function buildCableSurface(): SurfaceMaps {
  const size = 256;
  const { canvas, ctx } = scratchCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Two opposed helices, the standard braided-shield weave.
  ctx.lineWidth = 5;
  for (const direction of [1, -1]) {
    ctx.strokeStyle = direction === 1 ? '#b0b0b0' : '#585858';
    for (let offset = -size; offset < size * 2; offset += 16) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + direction * size, size);
      ctx.stroke();
    }
  }

  const height = canvasToHeight(canvas);
  const rough = new Float32Array(size * size).fill(0.45);
  const wear = fbm(size, 771, 3, 8);
  for (let i = 0; i < rough.length; i += 1) rough[i] = 0.34 + wear[i] * 0.3;

  return {
    normalMap: heightToNormalTexture(height, size, 1.6),
    roughnessMap: fieldToTexture(rough, size),
  };
}

// --- The environment map ---
//
// The single biggest realism win available without asset files. A metal surface
// with nothing to reflect renders as flat grey no matter how good the lights
// are. This builds a tiny procedural room (dark shell, a cool horizon band, and
// four cyan strip lights overhead) and prefilters it into a proper roughness-
// aware cube map, so every chassis on the board picks up the war room around it.
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const room = new THREE.Scene();

  // The shell: a large inverted box shaded by height, dark floor to a faint
  // cool ceiling, so reflections have a top-lit gradient to sample.
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(40, 24, 40),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying float vHeight;
        void main() {
          vHeight = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vHeight;
        void main() {
          float t = clamp(vHeight / 12.0 * 0.5 + 0.5, 0.0, 1.0);
          vec3 floorTone = vec3(0.010, 0.014, 0.022);
          vec3 horizon = vec3(0.030, 0.075, 0.100);
          vec3 ceiling = vec3(0.055, 0.115, 0.150);
          // Two-stage ramp: a bright-ish horizon band with dark above and below,
          // the shape a real room's reflection actually has.
          vec3 lower = mix(floorTone, horizon, smoothstep(0.0, 0.5, t));
          vec3 upper = mix(horizon, ceiling, smoothstep(0.5, 1.0, t));
          gl_FragColor = vec4(t < 0.5 ? lower : upper, 1.0);
        }
      `,
    }),
  );
  room.add(shell);

  // Overhead strip lights: the specular highlights that will travel across a
  // chassis as the camera pans. Cyan, because every light source in this war
  // room is part of the cyan story.
  const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4cc9f0).multiplyScalar(9) });
  for (const x of [-9, 9]) {
    for (const z of [-9, 9]) {
      const light = new THREE.Mesh(new THREE.PlaneGeometry(3, 14), strip);
      light.position.set(x, 11.6, z);
      light.rotation.x = Math.PI / 2;
      room.add(light);
    }
  }
  // One warm-white key source, so metal is not exclusively cyan-lit and keeps
  // some neutral highlight to read its form by.
  const key = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8f6fc).multiplyScalar(4) }),
  );
  key.position.set(0, 11.8, 0);
  key.rotation.x = Math.PI / 2;
  room.add(key);

  const target = pmrem.fromScene(room, 0.04);
  pmrem.dispose();
  // The room was only ever a means to a cube map.
  shell.geometry.dispose();
  (shell.material as THREE.Material).dispose();
  return target.texture;
}

// --- Cached accessors ---
//
// Each surface is built once per page load and shared by every material that
// wants it. Building them is a few tens of milliseconds of canvas work, and
// nothing about them changes at runtime.

let panelCache: SurfaceMaps | null = null;
let floorCache: SurfaceMaps | null = null;
let cableCache: SurfaceMaps | null = null;

export function panelSurface(): SurfaceMaps {
  panelCache ??= buildPanelSurface();
  return panelCache;
}

export function floorSurface(): SurfaceMaps {
  floorCache ??= buildFloorSurface();
  return floorCache;
}

export function cableSurface(): SurfaceMaps {
  cableCache ??= buildCableSurface();
  return cableCache;
}

// Clones a surface's maps so one material can tile them at its own density
// without changing everyone else's. Textures are cheap to clone; the underlying
// image data is shared.
export function tiled(maps: SurfaceMaps, repeatX: number, repeatY: number): SurfaceMaps {
  const normalMap = maps.normalMap.clone();
  const roughnessMap = maps.roughnessMap.clone();
  for (const texture of [normalMap, roughnessMap]) {
    configure(texture);
    texture.repeat.set(repeatX, repeatY);
  }
  return { normalMap, roughnessMap };
}

// The soft radial sprite behind every node's glow. Moved here from board.ts so
// all the painted textures live together.
export function haloTexture(): THREE.Texture {
  const size = 128;
  const { canvas, ctx } = scratchCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// A soft round mote for the airborne dust in the light beams.
export function moteTexture(): THREE.Texture {
  const size = 32;
  const { canvas, ctx } = scratchCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
