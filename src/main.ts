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
import './ui/incident-command.css';

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
import { ActionEffectPool } from './render/action-effects';
import { createTurnDirector, TURN_DIRECTOR_TIMING } from './render/turn-director';
import { ForecastRouteLayer } from './render/forecast-routes';
import { createOverlay } from './ui/overlay';
import { createRoster } from './ui/roster';
import { createHud, createSituationPanel } from './ui/hud';
import { createDebug } from './ui/debug';
import { createActionBar } from './ui/actions';
import { createIncidentControls } from './ui/incident-controls';
import { createTimeline } from './ui/timeline';
import { createHandover } from './ui/handover';
import { createPirScreen } from './ui/pir';
import { createRunbook } from './ui/menu';
import { createSettingsPanel } from './ui/settings-panel';
import { createPauseMenu } from './ui/pause';
import { createIncidentPauseCoordinator } from './ui/pause-coordinator';
import { createResolutionStage } from './ui/resolution-stage';
import { SIM_CONFIG } from './sim/config';
import { createInitialState, blastRadius, encryptedCount } from './sim/worm';
import {
  projectTurnEvents,
  toPresentationView,
  type NodePresentationState,
  type ObservableTurnEvent,
  type PresentationView,
} from './sim/telemetry';
import { applyPlayerAction, declareContainment, endTurn, fileReview } from './sim/game';
import { forecastSpread } from './sim/forecast';
import {
  deriveActionConsequences,
  deriveNodeInspectionModel,
  deriveObjective,
  type ActionConsequence,
} from './ui/situation';
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
const forecastRoutes = new ForecastRouteLayer(topology);
context.scene.add(forecastRoutes.group);

// The post-processing chain. Bloom plus the film grade, with a working "off"
// path at the LOW tier for weak hardware. Grain and scanlines are pattern and
// motion across the whole screen, so the motion level gates them independently
// of the tier: at "reduced" the image is clean.
const postfx = createPostFx(context.renderer, context.scene, context.camera, renderQuality());
postfx.setFilmAmount(motionReduced() ? 0 : effectivePulseScale());

const overlay = createOverlay();
const hud = createHud();
const situationPanel = createSituationPanel(mustFind('hud'));
const timeline = createTimeline(mustFind('timeline'));
const rosterContainer = mustFind('roster');
const debug = createDebug(mustFind('debug'));
const pirScreen = createPirScreen(mustFind('pir'));
const animator = createSpreadAnimator(board, topology);
const actionEffects = new ActionEffectPool(topology, { reducedMotion: motionReduced() });
context.scene.add(actionEffects.group);
const resolutionStage = createResolutionStage(mustFind('resolution-stage'));
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

// Observable board positions become stereo positions. Hidden telemetry never
// calls this helper and stays centred, so audio cannot reveal a secret route.
function panFor(nodeId: string): number {
  const node = topology.byId.get(nodeId);
  if (!node || topology.halfWidth <= 0) return 0;
  return Math.max(-1, Math.min(1, node.x / topology.halfWidth)) * 0.75;
}

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
let handoverActive = !briefMode;
let latestFps: number | null = null;
let previewKind: ActionKind | null = null;
let resolutionLocked = false;
let pendingResolution: { nextState: GameState; trueEvents: TurnEvent[] } | null = null;

const director = createTurnDirector({
  onAnalysis: presentAnalysis,
  onBeat: presentResolutionBeat,
  onSettle: settleResolution,
  onComplete: completeResolution,
});

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

function refreshPreview(): void {
  if (previewKind === null) {
    overlay.preview(null);
    return;
  }
  if (previewKind === 'emergency') {
    const emergencyPreview: ActionConsequence = {
      action: 'emergency',
      label: 'Emergency budget',
      apCost: 0,
      apGain: SIM_CONFIG.emergencyApBonus,
    };
    overlay.preview(emergencyPreview);
    return;
  }
  if (selectedId === null) {
    overlay.preview(null);
    return;
  }
  const consequence = deriveActionConsequences(
    selectedId,
    currentPresentation,
    topology,
  ).actions.find((action) => action.action === previewKind);
  overlay.preview(consequence ?? null);
}

function select(nodeId: string | null): void {
  selectedId = nodeId;
  board.setSelected(nodeId);
  roster.setActive(nodeId);
  actionBar.setReason('', true);
  refreshInspector();
  refreshPreview();
}

function canOfferDeclaration(): boolean {
  return (
    state.status === 'playing' &&
    state.phase === 'active' &&
    Object.values(currentPresentation.nodes).every((node) => node.visibleState !== 'infected')
  );
}

function renderIncidentControls(): void {
  const resolving = resolutionLocked;
  incidentControls.render({ phase: state.phase }, canOfferDeclaration(), resolving);
  incidentControls.setEnabled(
    !paused && !handoverActive && !ended && state.status === 'playing' && !resolving,
  );
}

function renderSituation(): void {
  situationPanel.render({
    phase: state.phase,
    objective: deriveObjective(currentPresentation, topology, {
      phase: state.phase,
      pressure: state.pressure,
      backupCredits: state.backupCredits,
    }),
    threatSummary: observedThreatSummary(currentPresentation),
    ap: state.ap,
    apPerHour: SIM_CONFIG.apPerTurn,
    backupCredits: state.backupCredits,
    impact: state.score,
    pressure: state.pressure,
    pressureMax: SIM_CONFIG.pressureMax,
    seed,
    fps: latestFps,
  });
}

// Refresh just the HUD numbers (used immediately on End Turn, before the board
// animation has finished).
function renderHud(): void {
  hud.setTurn(state.turn);
  renderSituation();
  actionBar.setAp(state.ap, SIM_CONFIG.apPerTurn);
  actionBar.setCredits(state.backupCredits);
  actionBar.setScore(state.score);
  hud.setPressure(state.pressure, SIM_CONFIG.pressureMax);
  // Escalation is on the board and in the room, not just the meter: isolation
  // rings warm with pressure, the undertone climbs, and the keyboard clatter of
  // the war room thickens as the estate falls.
  const pressureFraction = state.pressure / SIM_CONFIG.pressureMax;
  const blast = observableCompromiseFraction(currentPresentation);
  board.setPressure(pressureFraction);
  audio.setPressure(pressureFraction);
  audio.setBlastIntensity(blast);
  // The image itself sickens as the estate falls: the grade bleeds magenta into
  // the shadows, so a board in trouble is legible from the colour of the room
  // before you have read a single node.
  postfx.setInfectionLevel(blast);
  renderIncidentControls();
}

// Render one fog-safe snapshot. During theatre this may be a staged view; only
// settle is allowed to open a terminal PIR, so a loss never arrives before its
// public encryption beat.
function renderPresentation(
  presentation: PresentationView,
  options: { animateEncryptionNode?: string; allowTerminal?: boolean } = {},
): void {
  currentPresentation = presentation;
  currentView = visibleStates(currentPresentation);
  if (options.animateEncryptionNode) {
    board.setVisibleState(options.animateEncryptionNode, 'encrypted', !motionReduced());
  }
  board.applyPresentation(currentPresentation);
  renderHud();
  refreshForecast();
  roster.setActive(selectedId);
  roster.render(currentPresentation);
  refreshInspector();
  refreshPreview();
  if (debug.isVisible()) debug.render(state, topology, lastEvents);
  if (options.allowTerminal !== false && state.status !== 'playing') endGame();
}

// Full refresh from the current simulation state. Player actions and immediate
// phase transitions use this path; hourly resolution uses staged projections.
function renderState(): void {
  renderPresentation(toPresentationView(state, topology));
}

// The threat forecast assist: ring every node the worm could reach next turn,
// derived from the VISIBLE view so it stays blind wherever the EDR coverage is.
// Off unless the player asked for it.
function refreshForecast(): void {
  if (!threatForecastOn() || state.status !== 'playing') {
    forecastRoutes.setForecast({ atRisk: [], edges: [] });
    return;
  }
  const forecast = forecastSpread(currentPresentation, topology);
  forecastRoutes.setForecast(forecast);
}

function setInputsEnabled(enabled: boolean): void {
  actionBar.setEnabled(enabled);
  incidentControls.setEnabled(enabled);
}

function endGame(abandoned = false): void {
  if (ended) return;
  ended = true;
  resolutionStage.clear();
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
  if (
    briefMode ||
    paused ||
    handoverActive ||
    resolutionLocked ||
    state.status !== 'playing'
  ) {
    return;
  }
  const needsNode = kind !== 'emergency';
  if (needsNode && !selectedId) {
    actionBar.setReason('select a node first', false);
    return;
  }
  const action: PlayerAction = { kind, node: needsNode ? (selectedId ?? undefined) : undefined };
  const before = state;
  const result = applyPlayerAction(before, action, topology);
  if (result.ok) {
    recorder.record(before.turn, result.events);
    const observable = projectTurnEvents(result.events, before, result.state, topology);
    timeline.appendResolution(result.state.turn, observable, { labelOf: nodeLabel });
    const applied = result.events.find(
      (event) => event.kind === 'action' && event.outcome === 'applied',
    );
    if (applied?.kind === 'action') actionEffects.play(applied.action, applied.node);
  }
  state = result.state;
  actionBar.setReason(result.ok ? (result.reason ?? '') : (result.reason ?? ''), result.ok);
  // A clean confirm when an action lands, a distinct denied when it is blocked
  // (alongside the on-screen reason).
  audio.play(result.ok ? 'confirm' : 'denied');
  renderState();
}

const actionBar = createActionBar(mustFind('action-bar'), {
  onAction: act,
  onPreview(kind) {
    previewKind = kind;
    refreshPreview();
  },
});

const incidentControls = createIncidentControls(mustFind('incident-controls'), {
  onEndHour: resolveCurrentHour,
  onDeclareContainment: declareCurrentContainment,
  onFileReview: fileCurrentReview,
  onSkip() {
    director.skip();
  },
});

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

function resolveCurrentHour(): void {
  if (!canIssueLifecycleCommand()) return;
  const before = state;
  const beforePresentation = toPresentationView(before, topology);
  resolveHourly(before, beforePresentation, endTurn(before, topology));
}

function declareCurrentContainment(): void {
  if (!canIssueLifecycleCommand() || !canOfferDeclaration()) return;
  const before = state;
  const beforePresentation = toPresentationView(before, topology);
  const result = declareContainment(before, topology);
  if (result.events.length === 0) return;
  const confirmed = result.events.some(
    (event) => event.kind === 'containment-declaration' && event.confirmed,
  );
  if (!confirmed) {
    resolveHourly(before, beforePresentation, result);
    return;
  }

  recordImmediateResolution(before, result.nextState, result.events);
  renderState();
  incidentControls.focusPrimary();
}

function fileCurrentReview(): void {
  if (!canIssueLifecycleCommand() || state.phase !== 'recovery') return;
  const before = state;
  const result = fileReview(before);
  if (result.events.length === 0) return;
  recordImmediateResolution(before, result.nextState, result.events);
  renderState();
}

function resolveHourly(
  beforeState: GameState,
  beforePresentation: PresentationView,
  result: { nextState: GameState; events: TurnEvent[] },
  instant = false,
): void {
  const turnNow = beforeState.turn;
  recorder.record(turnNow, result.events);
  recorder.tickDowntime(result.nextState);

  const observable = projectTurnEvents(
    result.events,
    beforeState,
    result.nextState,
    topology,
  );
  const afterPresentation = toPresentationView(result.nextState, topology);
  pendingResolution = { nextState: result.nextState, trueEvents: result.events };
  resolutionLocked = true;
  animator.clear();
  resolutionStage.clear();
  setInputsEnabled(false);
  renderIncidentControls();

  if (instant) {
    settleResolution(afterPresentation, observable);
    completeResolution();
    return;
  }

  director.play(
    { before: beforePresentation, after: afterPresentation, events: observable },
    { reducedMotion: motionReduced() },
    performance.now() / 1000,
  );
}

function recordImmediateResolution(
  beforeState: GameState,
  nextState: GameState,
  events: TurnEvent[],
): void {
  recorder.record(beforeState.turn, events);
  const observable = projectTurnEvents(events, beforeState, nextState, topology);
  timeline.appendResolution(nextState.turn, observable, { labelOf: nodeLabel });
  state = nextState;
  lastEvents = events;
}

function presentAnalysis(view: PresentationView): void {
  resolutionStage.showAnalysis({
    reducedMotion: motionReduced(),
    durationMs: TURN_DIRECTOR_TIMING.analysisLeadSeconds * 1000,
  });
  renderPresentation(view, { allowTerminal: false });
  hud.setNotice('Forensic telemetry sweep in progress', 'defence');
  audio.play('analysis');
}

function presentResolutionBeat(
  event: ObservableTurnEvent,
  _index: number,
  view: PresentationView,
): void {
  resolutionStage.clear();
  renderPresentation(view, {
    animateEncryptionNode: event.kind === 'encrypted' ? event.node : undefined,
    allowTerminal: false,
  });

  switch (event.kind) {
    case 'attempt':
      animator.trace(event.source, event.target);
      audio.play('spread', { pan: panFor(event.target) });
      break;
    case 'telemetry-gap':
      animator.pulseTelemetryGap(event.attempts);
      audio.play('spread');
      break;
    case 'encrypted': {
      const type = topology.byId.get(event.node)?.type;
      audio.play(
        type === 'domain-controller' || type === 'backup' ? 'encrypt-heavy' : 'encrypt',
        { pan: panFor(event.node) },
      );
      shake.add(0.25);
      break;
    }
    case 'override':
      board.flashOverride(event.node);
      audio.play('override', { pan: panFor(event.node) });
      shake.add(0.6);
      break;
    case 'containment-declaration':
      if (!event.confirmed) audio.play('denied');
      break;
    case 'infected':
    case 'action':
    case 'recovery-hour':
    case 'review-filed':
      break;
  }
}

function settleResolution(
  view: PresentationView,
  events: readonly ObservableTurnEvent[],
): void {
  resolutionStage.clear();
  const pending = pendingResolution;
  if (pending === null) return;
  pendingResolution = null;
  state = pending.nextState;
  lastEvents = pending.trueEvents;
  animator.clear();
  timeline.appendResolution(state.turn, events, { labelOf: nodeLabel });
  const notice = settledResolutionNotice(events);
  hud.setNotice(notice.text, notice.tone);
  renderPresentation(view);
}

function completeResolution(): void {
  resolutionStage.clear();
  resolutionLocked = false;
  renderIncidentControls();
  if (state.status === 'playing' && !paused && !handoverActive && !ended) {
    setInputsEnabled(true);
    incidentControls.focusPrimary();
  }
}

function settledResolutionNotice(
  events: readonly ObservableTurnEvent[],
): { text: string; tone: 'defence' | 'uncertainty' } {
  const overrides = events.filter(
    (event): event is Extract<ObservableTurnEvent, { kind: 'override' }> =>
      event.kind === 'override',
  );
  if (overrides.length > 0) {
    return {
      text: `Business pressure returned ${overrides.map((event) => nodeLabel(event.node)).join(', ')} to service`,
      tone: 'uncertainty',
    };
  }
  if (events.some((event) => event.kind === 'telemetry-gap')) {
    return {
      text: 'Telemetry uncertainty recorded. Reassess visible coverage.',
      tone: 'uncertainty',
    };
  }
  return { text: '', tone: 'defence' };
}

function canIssueLifecycleCommand(): boolean {
  return (
    !paused &&
    !handoverActive &&
    !resolutionLocked &&
    !ended &&
    state.status === 'playing'
  );
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) director.interrupt();
});

// Board hotkeys: 'd' toggles the true-vs-visible debug table, 'f' toggles the
// threat forecast assist. Both ignored while typing.
window.addEventListener('keydown', (event) => {
  if (
    briefMode ||
    paused ||
    handoverActive ||
    resolutionLocked ||
    ended ||
    settingsPanel.isOpen()
  ) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)
  ) {
    return;
  }
  if (event.key === 'd') {
    debug.toggle();
    debug.render(state, topology, lastEvents);
    return;
  }
  if (event.key === 'f' || event.key === 'F') {
    const on = toggleThreatForecast();
    refreshForecast();
    hud.setNotice(on ? 'Threat forecast on' : 'Threat forecast off', 'defence');
  }
});

const handover = createHandover(mustFind('handover'), {
  onAccept() {
    // Both calls stay in the button's click stack, satisfying browser autoplay
    // policy without navigating away from the run document.
    unlockAudio();
    audio.play('handover');
  },
  onComplete() {
    handoverActive = false;
    paused = false;
    renderState();
    if (state.status === 'playing') setInputsEnabled(true);
    incidentControls.focusPrimary();
  },
});

select(null);
renderState();

// Settings panel, shared by the runbook menu and the pause menu. Master volume
// applies live; the DOM-level settings are applied by saveSettings itself.
const settingsPanel = createSettingsPanel(mustFind('settings'), {
  onChange: (s) => {
    audio.setMasterVolume(s.masterVolume);
    audio.setMusicVolume(s.musicVolume);
    audio.setSfxVolume(s.sfxVolume);
    actionEffects.setReducedMotion(motionReduced());
    postfx.setFilmAmount(motionReduced() ? 0 : effectivePulseScale());
    refreshForecast();
    renderSituation();
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
  // The menu only invokes these closures after construction, once both sides
  // of the small coordinator boundary exist.
  const pauseMenu = createPauseMenu(mustFind('pause'), {
    onResume: () => pauseCoordinator.resume(),
    onSettings: () => settingsPanel.open(),
    onAbandon: () => pauseCoordinator.abandon(),
  });
  const pauseCoordinator = createIncidentPauseCoordinator({
    isResolutionLocked: () => resolutionLocked,
    isEnded: () => ended,
    canResumeInputs: () =>
      state.status === 'playing' && !resolutionLocked && !ended && !handoverActive,
    setPaused(value) {
      paused = value;
    },
    setInputsEnabled,
    interruptResolution: () => director.interrupt(),
    openPause: () => pauseMenu.open(),
    closePause: () => pauseMenu.close(),
    endAbandonedRun: () => endGame(true),
    focusPrimary: () => incidentControls.focusPrimary(),
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
      pauseCoordinator.requestPause();
    }
  });

  setInputsEnabled(false);
  handover.show(
    {
      estate: topology.name,
      alert: scenario.handover.alert,
      priorities: scenario.handover.priorities,
      monitoredPercent:
        (topology.nodes.filter((node) => node.edr).length / topology.nodes.length) * 100,
      apPerHour: SIM_CONFIG.apPerTurn,
      backupCredits: state.backupCredits,
      lossConditions: [
        'Domain Controller encryption',
        `${Math.round(SIM_CONFIG.lossBlastRadius * 100)}% estate encryption`,
      ],
    },
    { reducedMotion: motionReduced() },
  );
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
  director.tick(seconds);
  animator.update(seconds);
  actionEffects.tick(seconds);
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
    latestFps = fps;
    renderSituation();
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

function nodeLabel(nodeId: string): string {
  return topology.byId.get(nodeId)?.label ?? nodeId;
}

function observableCompromiseFraction(view: PresentationView): number {
  const nodes = Object.values(view.nodes);
  if (nodes.length === 0) return 0;
  const compromised = nodes.filter(
    (node) => node.visibleState === 'infected' || node.visibleState === 'encrypted',
  ).length;
  return compromised / nodes.length;
}

function observedThreatSummary(view: PresentationView): string {
  const nodes = Object.values(view.nodes);
  const infected = nodes.filter((node) => node.visibleState === 'infected');
  const encrypted = nodes.filter((node) => node.visibleState === 'encrypted');
  const uncertain = nodes.filter((node) => !node.observed).length;
  const urgent = infected.filter((node) => (node.turnsToEncryption ?? Number.POSITIVE_INFINITY) <= 1)
    .length;

  if (state.status === 'lost') {
    return state.lossReason === 'domain-controller'
      ? 'Domain Controller encrypted. Incident command lost.'
      : 'Estate loss threshold reached.';
  }
  if (state.phase === 'recovery') {
    return encrypted.length > 0
      ? `Propagation stopped. ${encrypted.length} encrypted ${encrypted.length === 1 ? 'asset' : 'assets'} remain visible.`
      : 'Propagation stopped. No encrypted assets remain visible.';
  }
  if (infected.length > 0) {
    const urgency = urgent > 0
      ? ` ${urgent} ${urgent === 1 ? 'asset is' : 'assets are'} one hour from encryption.`
      : '';
    return `${infected.length} observed ${infected.length === 1 ? 'infection' : 'infections'}.${urgency}`;
  }
  if (uncertain > 0) {
    return `No infection visible. ${uncertain} ${uncertain === 1 ? 'asset remains' : 'assets remain'} outside verified coverage.`;
  }
  return 'Observed estate clear. Containment can be declared.';
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
      visualProof?: () => Record<string, string>;
      playEffectProof?: (kind: ActionKind, node?: string) => boolean;
      effectProofState?: () => Record<ActionKind, boolean>;
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
    actionEffects.tick(now / 1000);
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
    if (result.ok) {
      recorder.record(state.turn, result.events);
      const applied = result.events.find(
        (event) => event.kind === 'action' && event.outcome === 'applied',
      );
      if (applied?.kind === 'action') actionEffects.play(applied.action, applied.node);
    }
    state = result.state;
    renderState();
    return { ok: result.ok, reason: result.reason };
  },
  endTurnInstant(n: number) {
    director.interrupt();
    for (let i = 0; i < n && state.status === 'playing'; i += 1) {
      const before = state;
      const beforePresentation = toPresentationView(before, topology);
      resolveHourly(before, beforePresentation, endTurn(before, topology), true);
    }
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

// Explicit visual-verification surface. Development builds expose public
// presentation fixtures and pooled action effects without mutating true game
// state. The production build omits both methods unless ?debug=1 is explicit.
if (
  params.get('debug') === '1' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === 'localhost'
) {
  window.__sim.visualProof = () => {
    const required = [
      'DC-01',
      'FIN-SW',
      'SRV-MAIL',
      'SRV-SQL',
      'SRV-APP',
      'SRV-WEB',
      'SRV-FILE',
    ];
    for (const nodeId of required) {
      if (!currentPresentation.nodes[nodeId]) {
        throw new Error(`visual proof fixture requires ${nodeId}`);
      }
    }
    const nodes: Record<string, NodePresentationState> = Object.fromEntries(
      Object.entries(currentPresentation.nodes).map(
        ([id, node]): [string, NodePresentationState] => [
          id,
          {
            ...node,
            visibleState: 'clean',
            observed: true,
            isolated: false,
            turnsToEncryption: undefined,
          },
        ],
      ),
    );
    nodes['DC-01'] = { ...nodes['DC-01'], visibleState: 'clean', observed: true };
    nodes['FIN-SW'] = {
      ...nodes['FIN-SW'],
      visibleState: 'clean',
      observed: false,
      edr: false,
    };
    nodes['SRV-MAIL'] = {
      ...nodes['SRV-MAIL'],
      visibleState: 'infected',
      observed: true,
      turnsToEncryption: 2,
    };
    nodes['SRV-SQL'] = {
      ...nodes['SRV-SQL'],
      visibleState: 'encrypted',
      observed: true,
      turnsToEncryption: undefined,
    };
    nodes['SRV-APP'] = {
      ...nodes['SRV-APP'],
      visibleState: 'patched',
      observed: true,
      turnsToEncryption: undefined,
    };
    nodes['SRV-WEB'] = {
      ...nodes['SRV-WEB'],
      visibleState: 'clean',
      observed: true,
      isolated: true,
    };
    nodes['SRV-FILE'] = {
      ...nodes['SRV-FILE'],
      visibleState: 'clean',
      observed: true,
    };
    renderPresentation({ nodes }, { allowTerminal: false });
    select('SRV-FILE');
    return {
      clean: 'DC-01',
      unknown: 'FIN-SW',
      infected: 'SRV-MAIL',
      encrypted: 'SRV-SQL',
      patched: 'SRV-APP',
      isolated: 'SRV-WEB',
      selected: 'SRV-FILE',
    };
  };
  window.__sim.playEffectProof = (kind, node) => actionEffects.play(kind, node);
  window.__sim.effectProofState = () => Object.fromEntries(
    (['scan', 'isolate', 'reconnect', 'patch', 'restore', 'emergency'] as ActionKind[])
      .map((kind) => [
        kind,
        actionEffects.group.getObjectByName(`action-effect-${kind}`)?.visible === true,
      ]),
  ) as Record<ActionKind, boolean>;
}
