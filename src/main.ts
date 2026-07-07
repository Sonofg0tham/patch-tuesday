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
import { createSpreadAnimator } from './render/spread-animation';
import { createOverlay } from './ui/overlay';
import { createRoster } from './ui/roster';
import { createHud } from './ui/hud';
import { createDebug } from './ui/debug';
import { SIM_CONFIG } from './sim/config';
import { createInitialState, stepTurn, toVisibleView, blastRadius, encryptedCount } from './sim/worm';
import type { GameState, TurnEvent, VisibleState } from './sim/types';

applyPaletteToCss();

const topology = loadTopology();
const context = createScene(topology);
const board = createBoard(topology);
context.scene.add(board.group);

const overlay = createOverlay(topology);
const hud = createHud();
const rosterContainer = mustFind('roster');
const debug = createDebug(mustFind('debug'));
const animator = createSpreadAnimator(board, topology);

// The seed comes from ?seed= for reproducible debugging, otherwise a fresh
// random one is minted so each visit is a new incident. Either way it is shown
// in the HUD so any run can be reproduced.
const seed = new URLSearchParams(window.location.search).get('seed') ?? randomSeed();

let state: GameState = createInitialState(topology, seed);
let currentView: Record<string, VisibleState> = toVisibleView(state, topology);
let lastEvents: TurnEvent[] = [];
let selectedId: string | null = null;

board.applyView(currentView);
hud.setSeed(seed);
hud.setTurn(state.turn);

// Highlight = whatever the user is pointing at or has keyboard-focused.
// Selection = what the user actually chose to inspect. Pointer hover wins
// over keyboard focus when both are live, so the board tracks the cursor.
let pointerHover: string | null = null;
let keyboardFocus: string | null = null;

function refreshHighlight(): void {
  board.setHighlight(pointerHover ?? keyboardFocus);
}

function refreshInspector(): void {
  const node = selectedId ? (topology.byId.get(selectedId) ?? null) : null;
  overlay.inspect(node, selectedId ? currentView[selectedId] : undefined);
}

function select(nodeId: string | null): void {
  selectedId = nodeId;
  board.setSelected(nodeId);
  roster.setActive(nodeId);
  refreshInspector();
}

function updateStatus(): void {
  const total = topology.nodes.length;
  const encrypted = encryptedCount(state);
  const dcLost = Object.entries(state.nodes).some(
    ([id, ns]) => ns.state === 'encrypted' && topology.byId.get(id)?.type === 'domain-controller',
  );
  const lost = dcLost || blastRadius(state) >= SIM_CONFIG.lossBlastRadius;
  const note = dcLost ? ' · DOMAIN CONTROLLER LOST' : lost ? ' · BOARD LOST' : '';
  hud.setStatus(`${encrypted} / ${total} encrypted (${Math.round(blastRadius(state) * 100)}%)${note}`, lost);
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

// End Turn: resolve one turn in the sim, then let the animator replay the
// spread. End Turn is locked out until the replay finishes.
hud.onEndTurn(() => {
  if (animator.isPlaying()) return;
  const before = currentView;
  const result = stepTurn(state, topology);
  state = result.nextState;
  lastEvents = result.events;
  currentView = toVisibleView(state, topology);
  hud.setTurn(state.turn);
  hud.setEndTurnEnabled(false);
  animator.play(before, currentView);
});

animator.onComplete(() => {
  hud.setEndTurnEnabled(true);
  updateStatus();
  refreshInspector();
  if (debug.isVisible()) debug.render(state, topology, lastEvents);
});

// Debug overlay: 'd' toggles the true-vs-visible table. Ignored while typing.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'd' || event.metaKey || event.ctrlKey) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
  debug.toggle();
  debug.render(state, topology, lastEvents);
});

overlay.inspect(null);
updateStatus();

// Rolling fps: count frames and refresh the readout twice a second.
let frames = 0;
let windowStart = performance.now();

function tick(): void {
  requestAnimationFrame(tick);
  resizeIfNeeded(context);
  context.controls.update();
  clampPan(context, topology);
  animator.update(performance.now() / 1000);
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

// A short random seed: readable, URL-safe, enough entropy for run variety.
function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(36).toUpperCase();
}

function mustFind(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} missing from index.html`);
  return element;
}

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
    __sim: {
      seed: string;
      turn: () => number;
      encrypted: () => number;
      trueView: () => Record<string, string>;
      visibleView: () => Record<string, VisibleState>;
      advanceInstant: (n: number) => void;
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

// Verification hook: advances the sim without the animation so a given turn can
// be reached instantly and inspected. Used to prove determinism and the fog of
// war; not part of normal play.
window.__sim = {
  seed,
  turn: () => state.turn,
  encrypted: () => encryptedCount(state),
  trueView: () => Object.fromEntries(Object.entries(state.nodes).map(([id, ns]) => [id, ns.state])),
  visibleView: () => ({ ...currentView }),
  advanceInstant(n: number) {
    for (let i = 0; i < n; i += 1) state = stepTurn(state, topology).nextState;
    currentView = toVisibleView(state, topology);
    board.applyView(currentView);
    hud.setTurn(state.turn);
    updateStatus();
    refreshInspector();
  },
};
