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
import { createAudio } from './audio/audio';
import { createScreenShake } from './render/shake';
import { scenarioById } from './data/scenarios';
import { randomSeed } from './data/seed';
import { recordRun } from './data/storage';
import {
  applyDomSettings,
  effectivePulseScale,
  masterVolume,
  motionReduced,
  musicVolume,
  renderQuality,
  renderQualityIsAuto,
  sfxVolume,
  threatForecastOn,
  toggleThreatForecast,
} from './data/settings';
import { createScene, resizeIfNeeded, clampPan } from './render/scene';
import { createBoard } from './render/board';
import { createPostFx } from './render/postfx';
import { tickMaterials } from './render/materials';
import { createPointerPicker } from './render/picking';
import { createSpreadAnimator } from './render/spread-animation';
import { createOverlay } from './ui/overlay';
import { createRoster } from './ui/roster';
import { createHud } from './ui/hud';
import { createDebug } from './ui/debug';
import { createActionBar } from './ui/actions';
import { createPirScreen } from './ui/pir';
import { createRunbook } from './ui/menu';
import { createSettingsPanel } from './ui/settings-panel';
import { createPauseMenu } from './ui/pause';
import { SIM_CONFIG } from './sim/config';
import { createInitialState, blastRadius, encryptedCount } from './sim/worm';
import { toPresentationView, type PresentationView } from './sim/telemetry';
import { applyPlayerAction, endTurn } from './sim/game';
import { forecastSpread } from './sim/forecast';
import { deriveNodeInspectionModel } from './ui/situation';
import { RunRecorder, buildPir, type RunRecord } from './sim/pir';
import type { ActionKind, GameState, PlayerAction, TurnEvent, VisibleState } from './sim/types';

applyPaletteToCss();
// Player settings: DOM-level ones (text scale, high contrast, reduced-motion
// class) apply immediately; the render-baked ones (visibility floor) are read
// as the scene and board are built just below.
applyDomSettings();

// Entry resolution. A `scenario` query param means a run is in progress (the
// briefing navigated here, or this is a shared/replayed link); its absence
// means a fresh visit, so we show the incident briefing over a live backdrop of
// the hand-authored board. The seed comes from ?seed= for reproducible runs,
// otherwise a fresh one is minted.
const params = new URLSearchParams(window.location.search);
const scenarioParam = params.get('scenario');
const briefMode = scenarioParam === null;
const scenario = scenarioById(scenarioParam);
const seed = params.get('seed') ?? randomSeed();
const topology = scenario.build(seed);

const context = createScene(topology);
const board = createBoard(topology, context.environment);
context.scene.add(board.group);

// The post-processing chain. Bloom plus the film grade, with a working "off"
// path at the LOW tier for weak hardware. Grain and scanlines are pattern and
// motion across the whole screen, so the motion level gates them independently
// of the tier: at "reduced" the image is clean.
const postfx = createPostFx(context.renderer, context.scene, context.camera, renderQuality());
postfx.setFilmAmount(motionReduced() ? 0 : effectivePulseScale());

const overlay = createOverlay();
const hud = createHud();
const rosterContainer = mustFind('roster');
const debug = createDebug(mustFind('debug'));
const pirScreen = createPirScreen(mustFind('pir'));
const animator = createSpreadAnimator(board, topology);
const audio = createAudio();
const shake = createScreenShake();

// Browser autoplay policy: the audio context is created only on the first real
// user gesture, so nothing tries to make noise (or warns) before then.
function unlockAudio(): void {
  audio.unlock();
  audio.setMasterVolume(masterVolume());
  audio.setMusicVolume(musicVolume());
  audio.setSfxVolume(sfxVolume());
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// The threat is audible as it moves: a tense tick as each creep lands, the
// signature sting as a node encrypts (heavier for the crown jewels), and a
// small camera knock on the lock.
// A node's x position across the estate becomes its place in the stereo field,
// so during resolution you can hear which side of the board the worm is working
// on before you have found it on screen.
function panFor(nodeId: string): number {
  const node = topology.byId.get(nodeId);
  if (!node || topology.halfWidth <= 0) return 0;
  return Math.max(-1, Math.min(1, node.x / topology.halfWidth)) * 0.75;
}

animator.onReveal((nodeId) => audio.play('spread', { pan: panFor(nodeId) }));
animator.onLock((nodeId) => {
  const type = topology.byId.get(nodeId)?.type;
  audio.play(type === 'domain-controller' || type === 'backup' ? 'encrypt-heavy' : 'encrypt', {
    pan: panFor(nodeId),
  });
  shake.add(0.25);
});

// The war-room header names the estate under attack.
mustFind('hud-subtitle').textContent = topology.name;

const initialState: GameState = createInitialState(topology, seed);
// Records the run's events and downtime for the Post-Incident Review, with the
// same protocol the headless bots use, so a played review is built identically.
const recorder = new RunRecorder();
let state: GameState = initialState;
let currentPresentation = toPresentationView(state, topology);
let currentView: Record<string, VisibleState> = visibleStates(currentPresentation);
let lastEvents: TurnEvent[] = [];
let selectedId: string | null = null;
let ended = false;
let paused = false;

// Highlight = whatever the user is pointing at or has keyboard-focused.
// Selection = what the user chose to act on. Pointer hover wins over keyboard.
let pointerHover: string | null = null;
let keyboardFocus: string | null = null;

function refreshHighlight(): void {
  board.setHighlight(pointerHover ?? keyboardFocus);
}

function refreshInspector(): void {
  overlay.inspect(deriveNodeInspectionModel(selectedId, currentPresentation, topology));
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
  // Escalation is on the board and in the room, not just the meter: isolation
  // rings warm with pressure, the undertone climbs, and the keyboard clatter of
  // the war room thickens as the estate falls.
  const pressureFraction = state.pressure / SIM_CONFIG.pressureMax;
  const blast = blastRadius(state);
  board.setPressure(pressureFraction);
  audio.setPressure(pressureFraction);
  audio.setBlastIntensity(blast);
  // The image itself sickens as the estate falls: the grade bleeds magenta into
  // the shadows, so a board in trouble is legible from the colour of the room
  // before you have read a single node.
  postfx.setInfectionLevel(blast);
}

// Full refresh: board, isolation, HUD, inspector, debug, and the end screen.
// Called after actions (instant) and once a turn's spread animation completes.
function renderState(): void {
  currentPresentation = toPresentationView(state, topology);
  currentView = visibleStates(currentPresentation);
  board.applyView(currentView);
  for (const node of topology.nodes) {
    const presentation = currentPresentation.nodes[node.id];
    board.setIsolated(node.id, presentation?.isolated ?? false);
    // A sensor ring only for coverage the player added, not built-in EDR.
    board.setSensor(node.id, Boolean(presentation?.edr) && !node.edr);
  }
  renderHud();
  refreshForecast();
  roster.setActive(selectedId);
  refreshInspector();
  if (debug.isVisible()) debug.render(state, topology, lastEvents);
  if (state.status !== 'playing') endGame();
}

// The threat forecast assist: ring every node the worm could reach next turn,
// derived from the VISIBLE view so it stays blind wherever the EDR coverage is.
// Off unless the player asked for it.
function refreshForecast(): void {
  if (!threatForecastOn() || state.status !== 'playing') {
    board.setForecast([]);
    return;
  }
  board.setForecast(forecastSpread(currentView, state, topology).atRisk);
}

function setInputsEnabled(enabled: boolean): void {
  hud.setEndTurnEnabled(enabled);
  actionBar.setEnabled(enabled);
}

function endGame(abandoned = false): void {
  if (ended) return;
  ended = true;
  setInputsEnabled(false);

  const record: RunRecord = {
    scenarioName: topology.name,
    seed,
    initial: initialState,
    final: state,
    log: recorder.log,
    downtimeHours: recorder.downtimeHours,
    abandoned,
  };
  const pir = buildPir(record, topology);
  recordRun({
    scenarioId: scenario.id,
    scenarioName: topology.name,
    seed,
    rating: pir.rating,
    blastPct: Math.round(blastRadius(state) * 100),
    turns: state.turn,
    won: state.status === 'won',
    abandoned,
  });
  // The room's verdict: a flat dead-line on defeat (with a jolt), a quietly
  // triumphant but exhausted note on containment. An abandoned run just files.
  if (abandoned) {
    // no fanfare
  } else if (state.status === 'lost') {
    audio.play('defeat');
    shake.add(1);
  } else {
    audio.play('contain');
  }
  // The score stops adapting and plays its verdict: the tritone holds and never
  // resolves on a loss, the suspended dominant finally lands on containment.
  audio.resolve(abandoned ? 'abandoned' : state.status === 'lost' ? 'lost' : 'won');
  audio.setBlastIntensity(0); // the incident is over; quiet the clatter
  pirScreen.show(pir, scenario.id, seed);
}

// Applies one player action to the selected node (or none, for emergency),
// shows the outcome, and re-renders. Blocked actions surface their reason.
function act(kind: ActionKind): void {
  if (paused || animator.isPlaying() || state.status !== 'playing') return;
  const needsNode = kind !== 'emergency';
  if (needsNode && !selectedId) {
    actionBar.setReason('select a node first', false);
    return;
  }
  const action: PlayerAction = { kind, node: needsNode ? (selectedId ?? undefined) : undefined };
  const result = applyPlayerAction(state, action, topology);
  if (result.ok) recorder.record(state.turn, result.events);
  state = result.state;
  actionBar.setReason(result.ok ? '' : (result.reason ?? ''), result.ok);
  // A clean confirm when an action lands, a distinct denied when it is blocked
  // (alongside the on-screen reason).
  audio.play(result.ok ? 'confirm' : 'denied');
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
  if (paused || animator.isPlaying() || state.status !== 'playing') return;
  const before = currentView;
  const turnNow = state.turn;
  const result = endTurn(state, topology);
  state = result.nextState;
  lastEvents = result.events;
  recorder.record(turnNow, result.events);
  recorder.tickDowntime(state);
  currentPresentation = toPresentationView(state, topology);
  currentView = visibleStates(currentPresentation);
  // Announce any business override the turn it happens; blank turns clear it.
  const overrides = lastEvents.filter(
    (e): e is Extract<TurnEvent, { kind: 'override' }> => e.kind === 'override',
  );
  hud.setNotice(
    overrides.length > 0
      ? `Business pressure forced ${overrides.map((e) => topology.byId.get(e.node)?.label ?? e.node).join(', ')} back online`
      : '',
  );
  // A business override gets its own event on the board and in the room: the
  // reconnected node flashes, a phone-slam sound, and a jolt.
  for (const e of overrides) {
    board.flashOverride(e.node);
    audio.play('override', { pan: panFor(e.node) });
    shake.add(0.6);
  }
  renderHud();
  setInputsEnabled(false);
  animator.play(before, currentView);
});

animator.onComplete(() => {
  renderState();
  if (state.status === 'playing') setInputsEnabled(true);
});

// Board hotkeys: 'd' toggles the true-vs-visible debug table, 'f' toggles the
// threat forecast assist. Both ignored while typing.
window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
  if (event.key === 'd') {
    debug.toggle();
    debug.render(state, topology, lastEvents);
    return;
  }
  if (event.key === 'f' || event.key === 'F') {
    const on = toggleThreatForecast();
    refreshForecast();
    hud.setNotice(on ? 'Threat forecast on' : 'Threat forecast off');
  }
});

hud.setSeed(seed);
select(null);
renderState();

// Settings panel, shared by the runbook menu and the pause menu. Master volume
// applies live; the DOM-level settings are applied by saveSettings itself.
const settingsPanel = createSettingsPanel(mustFind('settings'), {
  onChange: (s) => {
    audio.setMasterVolume(s.masterVolume);
    audio.setMusicVolume(s.musicVolume);
    audio.setSfxVolume(s.sfxVolume);
    postfx.setFilmAmount(motionReduced() ? 0 : effectivePulseScale());
    refreshForecast();
  },
  onClose: () => {},
});

if (briefMode) {
  // Fresh visit: the runbook menu sits over a live backdrop of the board. Play
  // inputs stay locked until the player begins a run (which reloads with params).
  setInputsEnabled(false);
  createRunbook(mustFind('menu'), { onSettings: () => settingsPanel.open() }).show();
} else {
  // In a run: Escape opens the pause menu. Abandoning files the PIR for the run
  // so far, marked ABANDONED.
  const pauseMenu = createPauseMenu(mustFind('pause'), {
    onResume: () => {
      paused = false;
      if (state.status === 'playing' && !animator.isPlaying()) setInputsEnabled(true);
    },
    onSettings: () => settingsPanel.open(),
    onAbandon: () => {
      pauseMenu.close();
      endGame(true);
    },
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (settingsPanel.isOpen()) {
      settingsPanel.close();
      return;
    }
    if (ended) return;
    if (pauseMenu.isOpen()) {
      pauseMenu.close();
    } else {
      paused = true;
      setInputsEnabled(false);
      pauseMenu.open();
    }
  });
}

// Rolling fps: count frames and refresh the readout twice a second.
let frames = 0;
let windowStart = performance.now();
let lastFrame = performance.now();

// Adaptive quality. At the 'auto' setting the tier starts HIGH and steps down
// once if the measured frame rate cannot hold the budget. Two consecutive slow
// half-second windows are needed, so a one-off hitch (a tab regaining focus, a
// shader compiling) never costs the player their bloom. The first few windows
// are ignored outright while shaders compile and textures upload.
const FPS_FLOOR = 50;
let slowWindows = 0;
let warmupWindows = 0;

function considerQualityDrop(fps: number): void {
  if (!renderQualityIsAuto()) return;
  if (warmupWindows < 6) {
    warmupWindows += 1;
    return;
  }
  if (fps >= FPS_FLOOR) {
    slowWindows = 0;
    return;
  }
  slowWindows += 1;
  if (slowWindows < 2) return;
  slowWindows = 0;
  const current = postfx.quality();
  if (current === 'high') postfx.setQuality('medium');
  else if (current === 'medium') postfx.setQuality('low');
}

function tick(): void {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000); // clamp long tab-away gaps
  lastFrame = now;
  const seconds = now / 1000;

  if (resizeIfNeeded(context)) {
    postfx.setSize(window.innerWidth, window.innerHeight);
  }
  context.controls.update();
  clampPan(context, topology);
  animator.update(seconds);
  board.tick(seconds); // pulse, encryption transitions, override flashes
  tickMaterials(seconds); // the pulses travelling along the cables
  context.tickAtmosphere(seconds); // the dust in the light

  // Screen shake: apply a transient camera offset for the render, then remove
  // it so the controls never accumulate drift. A no-op at the calm default.
  const offset = shake.step(dt);
  context.camera.position.add(offset);
  postfx.render(seconds);
  context.camera.position.sub(offset);

  frames += 1;
  const elapsed = now - windowStart;
  if (elapsed >= 500) {
    const fps = (frames * 1000) / elapsed;
    overlay.setFps(fps);
    considerQualityDrop(fps);
    frames = 0;
    windowStart = now;
  }
}

tick();

function mustFind(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} missing from index.html`);
  return element;
}

function visibleStates(view: PresentationView): Record<string, VisibleState> {
  return Object.fromEntries(
    Object.entries(view.nodes).map(([id, node]) => [id, node.visibleState]),
  );
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
      scenario: string;
      topology: string;
      nodeCount: () => number;
      turn: () => number;
      status: () => string;
      ap: () => number;
      score: () => number;
      pressure: () => number;
      encrypted: () => number;
      initialEncrypted: () => number;
      trueView: () => Record<string, string>;
      visibleView: () => Record<string, VisibleState>;
      act: (kind: ActionKind, node?: string) => { ok: boolean; reason?: string };
      endTurnInstant: (n: number) => void;
      /** The log length and the built review, for verifying findings match events. */
      logLength: () => number;
      pir: () => ReturnType<typeof buildPir>;
    };
  }
}

window.__spikeBench = (benchFrames = 120) => {
  const times: number[] = [];
  for (let i = 0; i < benchFrames; i += 1) {
    const now = performance.now();
    // The full per-frame pipeline with everything on: the presentation tick
    // (pulse, transitions, flashes), the shake sample, and the render. This is
    // the honest frame cost, not just the draw call.
    board.tick(now / 1000);
    tickMaterials(now / 1000);
    context.tickAtmosphere(now / 1000);
    const offset = shake.step(0.016);
    context.camera.position.add(offset);
    postfx.render(now / 1000);
    context.camera.position.sub(offset);
    times.push(performance.now() - now);
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
  scenario: scenario.id,
  topology: topology.name,
  nodeCount: () => topology.nodes.length,
  turn: () => state.turn,
  status: () => state.status,
  ap: () => state.ap,
  pressure: () => state.pressure,
  score: () => state.score,
  encrypted: () => encryptedCount(state),
  initialEncrypted: () => encryptedCount(initialState),
  trueView: () => Object.fromEntries(Object.entries(state.nodes).map(([id, ns]) => [id, ns.state])),
  visibleView: () => ({ ...currentView }),
  act(kind, node) {
    const result = applyPlayerAction(state, { kind, node }, topology);
    if (result.ok) recorder.record(state.turn, result.events);
    state = result.state;
    renderState();
    return { ok: result.ok, reason: result.reason };
  },
  endTurnInstant(n: number) {
    for (let i = 0; i < n && state.status === 'playing'; i += 1) {
      const turnNow = state.turn;
      const resolved = endTurn(state, topology);
      recorder.record(turnNow, resolved.events);
      state = resolved.nextState;
      recorder.tickDowntime(state);
    }
    renderState();
  },
  logLength: () => recorder.log.length,
  pir: () =>
    buildPir(
      {
        scenarioName: topology.name,
        seed,
        initial: initialState,
        final: state,
        log: recorder.log,
        downtimeHours: recorder.downtimeHours,
      },
      topology,
    ),
};
