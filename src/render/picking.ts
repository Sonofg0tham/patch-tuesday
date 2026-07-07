// Raycaster picking against the instanced grid: hover brightens a box,
// click selects it. Instance colours are rewritten only when a state
// actually changes, never per frame.

import * as THREE from 'three';
import {
  COLOUR_BASE,
  COLOUR_HOVER,
  COLOUR_SELECTED,
  type SpikeScene,
} from './scene';

export interface Picker {
  /** Index of the currently selected box, or null. */
  readonly selected: number | null;
  /** Register a callback for when the selection changes. */
  onSelect(callback: (index: number | null) => void): void;
}

export function createPicker(spike: SpikeScene): Picker {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered: number | null = null;
  let selected: number | null = null;
  let selectCallback: (index: number | null) => void = () => {};
  // Distinguish a click from a pan drag: a drag beyond a few pixels
  // must not change the selection.
  let downX = 0;
  let downY = 0;

  function colourFor(index: number): THREE.Color {
    if (index === selected) return COLOUR_SELECTED;
    if (index === hovered) return COLOUR_HOVER;
    return COLOUR_BASE;
  }

  function applyColour(index: number | null): void {
    if (index === null) return;
    spike.grid.setColorAt(index, colourFor(index));
    if (spike.grid.instanceColor) spike.grid.instanceColor.needsUpdate = true;
  }

  function pick(clientX: number, clientY: number): number | null {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, spike.camera);
    const hit = raycaster.intersectObject(spike.grid, false)[0];
    return hit?.instanceId ?? null;
  }

  const canvas = spike.renderer.domElement;

  canvas.addEventListener('pointermove', (event) => {
    const next = pick(event.clientX, event.clientY);
    if (next === hovered) return;
    const previous = hovered;
    hovered = next;
    applyColour(previous);
    applyColour(hovered);
    canvas.style.cursor = hovered === null ? 'default' : 'pointer';
  });

  canvas.addEventListener('pointerdown', (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });

  canvas.addEventListener('pointerup', (event) => {
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (moved > 4) return;
    const next = pick(event.clientX, event.clientY);
    if (next === selected) return;
    const previous = selected;
    selected = next;
    applyColour(previous);
    applyColour(selected);
    selectCallback(selected);
  });

  return {
    get selected() {
      return selected;
    },
    onSelect(callback) {
      selectCallback = callback;
    },
  };
}
