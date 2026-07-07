// Pointer picking against the board's node meshes. This module only reports
// which node is under the cursor or was clicked; it does not colour anything.
// main.ts coordinates mouse hover and keyboard focus into a single highlight
// so the two input methods never fight over the board.

import * as THREE from 'three';
import type { Board } from './board';
import type { SceneContext } from './scene';

export interface PickerHandlers {
  onHover(nodeId: string | null): void;
  onClick(nodeId: string | null): void;
}

export function createPointerPicker(
  context: SceneContext,
  board: Board,
  handlers: PickerHandlers,
): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const canvas = context.renderer.domElement;
  let hovered: string | null = null;
  // Distinguish a click from a pan drag: a drag beyond a few pixels must not
  // change the selection.
  let downX = 0;
  let downY = 0;

  function pick(clientX: number, clientY: number): string | null {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, context.camera);
    const hit = raycaster.intersectObjects(board.nodeMeshes, false)[0];
    if (!hit) return null;
    return board.resolveHit(hit.object, hit.instanceId);
  }

  canvas.addEventListener('pointermove', (event) => {
    const next = pick(event.clientX, event.clientY);
    if (next === hovered) return;
    hovered = next;
    canvas.style.cursor = hovered === null ? 'default' : 'pointer';
    handlers.onHover(hovered);
  });

  canvas.addEventListener('pointerdown', (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });

  canvas.addEventListener('pointerup', (event) => {
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (moved > 4) return; // this was a pan, not a click
    handlers.onClick(pick(event.clientX, event.clientY));
  });
}
