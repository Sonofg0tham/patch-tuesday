// Phase -1 spike entry point. Proves the pipeline: Vite + Three.js + strict
// TypeScript, instanced rendering, shadows, picking, a DOM overlay, and a
// steady 60fps once deployed. Throwaway quality, kept in the repo.

import { createScene, resizeIfNeeded } from './scene';
import { createPicker } from './picking';
import { createOverlay } from './overlay';

const spike = createScene();
const picker = createPicker(spike);
const overlay = createOverlay();

picker.onSelect((index) => overlay.setSelected(index));

// Rolling fps: count frames and refresh the readout twice a second.
let frames = 0;
let windowStart = performance.now();

function tick(): void {
  requestAnimationFrame(tick);
  resizeIfNeeded(spike);
  spike.controls.update();
  spike.renderer.render(spike.scene, spike.camera);

  frames += 1;
  const now = performance.now();
  const elapsed = now - windowStart;
  if (elapsed >= 500) {
    overlay.setFps((frames * 1000) / elapsed);
    frames = 0;
    windowStart = now;
  }
}

tick();
