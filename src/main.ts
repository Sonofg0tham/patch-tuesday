// Entry point. Loads the estate, builds the board, and coordinates the two
// ways in: the mouse (pointer picking) and the keyboard (the asset register).
// A single controller merges mouse hover and keyboard focus into one board
// highlight so the inputs never fight, and keeps selection in sync across the
// board, the inspector and the register.

// Bundled web fonts (OFL, recorded in CREDITS.md). Vite emits the woff2 files
// into the build, nothing is fetched from a CDN at runtime.
import '@fontsource/chakra-petch/600.css';
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import './ui/style.css';

import { applyPaletteToCss } from './config/palette';
import { loadTopology } from './data/topology';
import { createScene, resizeIfNeeded, clampPan } from './render/scene';
import { createBoard } from './render/board';
import { createPointerPicker } from './render/picking';
import { createOverlay } from './ui/overlay';
import { createRoster } from './ui/roster';

applyPaletteToCss();

const topology = loadTopology();
const context = createScene(topology);
const board = createBoard(topology);
context.scene.add(board.group);

const overlay = createOverlay(topology);
const rosterContainer = document.getElementById('roster');
if (!rosterContainer) throw new Error('#roster missing from index.html');

// Highlight = whatever the user is pointing at or has keyboard-focused.
// Selection = what the user actually chose to inspect. Pointer hover wins
// over keyboard focus when both are live, so the board tracks the cursor.
let pointerHover: string | null = null;
let keyboardFocus: string | null = null;

function refreshHighlight(): void {
  board.setHighlight(pointerHover ?? keyboardFocus);
}

function select(nodeId: string | null): void {
  board.setSelected(nodeId);
  roster.setActive(nodeId);
  overlay.inspect(nodeId ? (topology.byId.get(nodeId) ?? null) : null);
}

const roster = createRoster(rosterContainer, topology, {
  onFocus(nodeId) {
    keyboardFocus = nodeId;
    refreshHighlight();
  },
  onActivate(nodeId) {
    select(nodeId);
  },
});

createPointerPicker(context, board, {
  onHover(nodeId) {
    pointerHover = nodeId;
    refreshHighlight();
  },
  onClick(nodeId) {
    select(nodeId);
  },
});

overlay.inspect(null);

// Rolling fps: count frames and refresh the readout twice a second.
let frames = 0;
let windowStart = performance.now();

function tick(): void {
  requestAnimationFrame(tick);
  resizeIfNeeded(context);
  context.controls.update();
  clampPan(context, topology);
  context.renderer.render(context.scene, context.camera);

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
    context.renderer.render(context.scene, context.camera);
    times.push(performance.now() - start);
  }
  const total = times.reduce((sum, t) => sum + t, 0);
  return {
    frames: benchFrames,
    msPerFrameAvg: Math.round((total / benchFrames) * 100) / 100,
    msPerFrameWorst: Math.round(Math.max(...times) * 100) / 100,
  };
};
