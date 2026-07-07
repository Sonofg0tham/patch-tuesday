// Entry point. Boots the board, the picker and the DOM overlay, and keeps
// the render loop honest with a live fps readout plus a synchronous
// benchmark hook for automated verification.

// Bundled web fonts (OFL, recorded in CREDITS.md). Vite emits the woff2
// files into the build, nothing is fetched from a CDN at runtime.
import '@fontsource/chakra-petch/600.css';
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import './ui/style.css';

import { applyPaletteToCss } from './config/palette';
import { createScene, resizeIfNeeded } from './render/scene';
import { createPicker } from './render/picking';
import { createOverlay } from './ui/overlay';

applyPaletteToCss();

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

window.__spikeBench = (benchFrames = 120) => {
  const times: number[] = [];
  for (let i = 0; i < benchFrames; i += 1) {
    const start = performance.now();
    spike.renderer.render(spike.scene, spike.camera);
    times.push(performance.now() - start);
  }
  const total = times.reduce((sum, t) => sum + t, 0);
  return {
    frames: benchFrames,
    msPerFrameAvg: Math.round((total / benchFrames) * 100) / 100,
    msPerFrameWorst: Math.round(Math.max(...times) * 100) / 100,
  };
};
