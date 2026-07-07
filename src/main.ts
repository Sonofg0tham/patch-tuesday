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

// Headless verification hook: renders a burst of frames synchronously and
// reports the cost per frame. requestAnimationFrame throttles to nothing in
// hidden or automated windows, so proving the 60fps budget (16.7ms a frame)
// needs a measurement that does not depend on the compositor.
declare global {
  interface Window {
    __spikeBench: (frames?: number) => {
      frames: number;
      msPerFrameAvg: number;
      msPerFrameWorst: number;
    };
  }
}

window.__spikeBench = (frames = 120) => {
  const times: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    const start = performance.now();
    spike.renderer.render(spike.scene, spike.camera);
    times.push(performance.now() - start);
  }
  const total = times.reduce((sum, t) => sum + t, 0);
  return {
    frames,
    msPerFrameAvg: Math.round((total / frames) * 100) / 100,
    msPerFrameWorst: Math.round(Math.max(...times) * 100) / 100,
  };
};
