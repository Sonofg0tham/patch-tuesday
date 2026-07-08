// Entry point. Loads the estate, builds the board, and runs the incident: the
// player spends AP on the six actions, ends the turn, and the worm resolves.
// Actions and turn resolution are pure sim; this file only wires input to the
// sim and renders the result. A central renderState() keeps the board, the HUD
// and the inspector in step after every action and every turn.

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
import { createActionBar } from './ui/actions';
import { createEndScreen } from './ui/endscreen';
import { SIM_CONFIG } from './sim/config';
import { createInitialState, toVisibleView, blastRadius, encryptedCount } from './sim/worm';
import { applyPlayerAction, endTurn } from './sim/game';
import type { ActionKind, GameState, PlayerAction, TurnEvent, VisibleState } from './sim/types';

applyPaletteToCss();

const topology = loadTopology();
const context = createScene(topology);
const board = createBoard(topology);
context.scene.add(board.group);

const overlay = createOverlay(topology);
const hud = createHud();
const rosterContainer = mustFind('roster');
const debug = createDebug(mustFind('debug'));
const endScreen = createEndScreen(mustFind('endscreen'));
const animator = createSpreadAnimator(board, topology);

// The seed comes from ?seed= for reproducible debugging, otherwise a fresh
// random one is minted so each visit is a new incident.
const seed = new URLSearchParams(window.location.search).get('seed') ?? randomSeed();

let state: GameState = createInitialState(topology, seed);
let currentView: Record<string, VisibleState> = toVisibleView(state, topology);
let lastEvents: TurnEvent[] = [];
let selectedId: string | null = null;
let ended = false;

// Highlight = whatever the user is pointing at or has keyboard-focused.
// Selection = what the user chose to act on. Pointer hover wins over keyboard.
let pointerHover: string | null = null;
let keyboardFocus: string | null = null;

function refreshHighlight(): void {
  board.setHighlight(pointerHover ?? keyboardFocus);
}

function refreshInspector(): void {
  const node = selectedId ? (topology.byId.get(selectedId) ?? null) : null;
  const status = selectedId ? currentView[selectedId] : undefined;
  const ns = selectedId ? state.nodes[selectedId] : undefined;
  // A deployed sensor shows as coverage, but built-in EDR is not a "sensor".
  const sensored = Boolean(ns?.revealed) && !(node?.edr ?? false);
  overlay.inspect(node, status, ns?.isolated, sensored, ns?.isolationAge);
}

function select(nodeId: string | null): void {
  selectedId = nodeId;
  board.setSelected(nodeId);
  roster.setActive(nodeId);
  actionBar.setReason('', true);
  refreshInspector();
}

function updateStatus(): void {
  const total = topology.nodes.length;
  const pct = Math.round(blastRadius(state) * 100);
  const note =
    state.status === 'lost'
      ? state.lossReason === 'domain-controller'
        ? ' · DOMAIN CONTROLLER LOST'
        : ' · ESTATE OVERRUN'
      : state.status === 'won'
        ? ' · CONTAINED'
        : '';
  hud.setStatus(`${encryptedCount(state)} / ${total} encrypted (${pct}%)${note}`, state.status === 'lost');
}

// Refresh just the HUD numbers (used immediately on End Turn, before the board
// animation has finished).
function renderHud(): void {
  hud.setTurn(state.turn);
  updateStatus();
  actionBar.setAp(state.ap, SIM_CONFIG.apPerTurn);
  actionBar.setCredits(state.backupCredits);
  actionBar.setScore(state.score);
  hud.setPressure(state.pressure, SIM_CONFIG.pressureMax);
}

// Full refresh: board, isolation, HUD, inspector, debug, and the end screen.
// Called after actions (instant) and once a turn's spread animation completes.
function renderState(): void {
  currentView = toVisibleView(state, topology);
  board.applyView(currentView);
  for (const node of topology.nodes) {
    board.setIsolated(node.id, Boolean(state.nodes[node.id].isolated));
    // A sensor ring only for coverage the player added, not built-in EDR.
    board.setSensor(node.id, Boolean(state.nodes[node.id].revealed) && !node.edr);
  }
  renderHud();
  roster.setActive(selectedId);
  refreshInspector();
  if (debug.isVisible()) debug.render(state, topology, lastEvents);
  if (state.status !== 'playing') endGame();
}

function setInputsEnabled(enabled: boolean): void {
  hud.setEndTurnEnabled(enabled);
  actionBar.setEnabled(enabled);
}

function endGame(): void {
  if (ended) return;
  ended = true;
  setInputsEnabled(false);
  endScreen.show(state, topology.nodes.length);
}

// Applies one player action to the selected node (or none, for emergency),
// shows the outcome, and re-renders. Blocked actions surface their reason.
function act(kind: ActionKind): void {
  if (animator.isPlaying() || state.status !== 'playing') return;
  const needsNode = kind !== 'emergency';
  if (needsNode && !selectedId) {
    actionBar.setReason('select a node first', false);
    return;
  }
  const action: PlayerAction = { kind, node: needsNode ? (selectedId ?? undefined) : undefined };
  const result = applyPlayerAction(state, action, topology);
  state = result.state;
  actionBar.setReason(result.ok ? '' : (result.reason ?? ''), result.ok);
  renderState();
}

const actionBar = createActionBar(mustFind('action-bar'), { onAction: act });

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

// End Turn: resolve the turn in the sim, refresh the HUD immediately, then let
// the animator replay the spread. Inputs are locked until the replay finishes.
hud.onEndTurn(() => {
  if (animator.isPlaying() || state.status !== 'playing') return;
  const before = currentView;
  const result = endTurn(state, topology);
  state = result.nextState;
  lastEvents = result.events;
  currentView = toVisibleView(state, topology);
  // Announce any business override the turn it happens; blank turns clear it.
  const overrides = lastEvents.filter(
    (e): e is Extract<TurnEvent, { kind: 'override' }> => e.kind === 'override',
  );
  hud.setNotice(
    overrides.length > 0
      ? `Business pressure forced ${overrides.map((e) => topology.byId.get(e.node)?.label ?? e.node).join(', ')} back online`
      : '',
  );
  renderHud();
  setInputsEnabled(false);
  animator.play(before, currentView);
});

animator.onComplete(() => {
  renderState();
  if (state.status === 'playing') setInputsEnabled(true);
});

// Debug overlay: 'd' toggles the true-vs-visible table. Ignored while typing.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'd' || event.metaKey || event.ctrlKey) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
  debug.toggle();
  debug.render(state, topology, lastEvents);
});

hud.setSeed(seed);
select(null);
renderState();

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
      status: () => string;
      ap: () => number;
      score: () => number;
      pressure: () => number;
      encrypted: () => number;
      trueView: () => Record<string, string>;
      visibleView: () => Record<string, VisibleState>;
      act: (kind: ActionKind, node?: string) => { ok: boolean; reason?: string };
      endTurnInstant: (n: number) => void;
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

// Verification hook: drives the sim without waiting on animation, so a run can
// be scripted and inspected. Used to reach win/lose states and prove the fog;
// not part of normal play.
window.__sim = {
  seed,
  turn: () => state.turn,
  status: () => state.status,
  ap: () => state.ap,
  pressure: () => state.pressure,
  score: () => state.score,
  encrypted: () => encryptedCount(state),
  trueView: () => Object.fromEntries(Object.entries(state.nodes).map(([id, ns]) => [id, ns.state])),
  visibleView: () => ({ ...currentView }),
  act(kind, node) {
    const result = applyPlayerAction(state, { kind, node }, topology);
    state = result.state;
    renderState();
    return { ok: result.ok, reason: result.reason };
  },
  endTurnInstant(n: number) {
    for (let i = 0; i < n && state.status === 'playing'; i += 1) {
      state = endTurn(state, topology).nextState;
    }
    renderState();
  },
};
