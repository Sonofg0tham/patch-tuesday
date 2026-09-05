// Player settings (Phase 6), persisted in localStorage and applied live where
// feasible. The knobs already exist in the config modules; this is the layer
// that lets the player move them and remembers the choice. Every read is
// defensive: corrupt or absent data yields the shipped defaults, and the
// reduced-motion default (calm, honouring the OS) stays what a fresh visitor
// gets. Values that are baked into the 3D scene at boot (the visibility floor)
// take effect on the next incident; the rest apply immediately.

import { VISUAL_CONFIG } from '../config/visual';

export type MotionLevel = 'full' | 'calm' | 'reduced';

/**
 * Render quality. 'auto' starts at HIGH and steps down on its own if the
 * measured frame cost blows the 60fps budget, which is the honest way to hold
 * the integrated-graphics target without asking the player to know what a
 * bloom pass is. The explicit tiers pin it.
 */
export type RenderQuality = 'auto' | 'low' | 'medium' | 'high';

export interface Settings {
  /** Audio master volume, 0..1. Live. */
  masterVolume: number;
  /** Score volume relative to master, 0..1. Live. */
  musicVolume: number;
  /** Effects volume relative to master, 0..1. Live. */
  sfxVolume: number;
  /** Post-processing tier. Applies on the next incident. */
  renderQuality: RenderQuality;
  /**
   * Threat forecast assist: ring the nodes the worm could reach next turn.
   * On by default. It surfaces nothing the player cannot already see and keeps
   * route tracing from becoming a perception test. Existing choices persist.
   */
  threatForecast: boolean;
  /** HUD/menu text scale multiplier, 0.8..1.5. Live. */
  textScale: number;
  /** Stronger UI borders and text for legibility. Live. */
  highContrast: boolean;
  /** Screen-shake magnitude in world units, 0..0.4. Live (reduced forces 0). */
  shakeIntensity: number;
  /** Board readability floor, 0..1 (nystagmus). Applies on the next incident. */
  visibilityFloor: number;
  /** Motion level. reduced = the accessibility floor; calm = the shipped feel. */
  motionLevel: MotionLevel;
}

const KEY = 'patch-tuesday:settings:v1';

const DEFAULTS: Settings = {
  masterVolume: 0.7,
  musicVolume: 0.6, // the score sits under the effects, never over them
  sfxVolume: 1,
  renderQuality: 'auto',
  threatForecast: true,
  textScale: 1,
  highContrast: false,
  shakeIntensity: VISUAL_CONFIG.shakeIntensity, // 0, the calm default
  visibilityFloor: VISUAL_CONFIG.visibilityFloor, // 0.35
  motionLevel: 'calm',
};

const clamp = (v: number, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;

function osPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let current: Settings | null = null;

function read(): Settings {
  let saved: Partial<Settings> = {};
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) saved = JSON.parse(raw) as Partial<Settings>;
  } catch {
    saved = {};
  }
  const motion: MotionLevel =
    saved.motionLevel === 'full' || saved.motionLevel === 'calm' || saved.motionLevel === 'reduced'
      ? saved.motionLevel
      : // A fresh visitor who asked the OS for reduced motion gets it by default.
        osPrefersReducedMotion()
        ? 'reduced'
        : DEFAULTS.motionLevel;
  const quality: RenderQuality =
    saved.renderQuality === 'auto' ||
    saved.renderQuality === 'low' ||
    saved.renderQuality === 'medium' ||
    saved.renderQuality === 'high'
      ? saved.renderQuality
      : DEFAULTS.renderQuality;
  return {
    masterVolume: clamp(saved.masterVolume as number, 0, 1, DEFAULTS.masterVolume),
    musicVolume: clamp(saved.musicVolume as number, 0, 1, DEFAULTS.musicVolume),
    sfxVolume: clamp(saved.sfxVolume as number, 0, 1, DEFAULTS.sfxVolume),
    renderQuality: quality,
    threatForecast:
      typeof saved.threatForecast === 'boolean' ? saved.threatForecast : DEFAULTS.threatForecast,
    textScale: clamp(saved.textScale as number, 0.8, 1.5, DEFAULTS.textScale),
    highContrast: typeof saved.highContrast === 'boolean' ? saved.highContrast : DEFAULTS.highContrast,
    shakeIntensity: clamp(saved.shakeIntensity as number, 0, 0.4, DEFAULTS.shakeIntensity),
    visibilityFloor: clamp(saved.visibilityFloor as number, 0, 1, DEFAULTS.visibilityFloor),
    motionLevel: motion,
  };
}

export function loadSettings(): Settings {
  if (!current) current = read();
  return current;
}

export function saveSettings(next: Settings): void {
  current = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode): the setting still applies this session.
  }
  applyDomSettings(next);
}

// Writes the DOM-level settings onto the document: the UI scale, the
// high-contrast class, and the reduced-motion class. Live, no reload.
export function applyDomSettings(settings: Settings = loadSettings()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(settings.textScale));
  document.body.classList.toggle('high-contrast', settings.highContrast);
  document.body.classList.toggle('reduced-motion', settings.motionLevel === 'reduced');
}

// --- Effective values the render and audio layers read ---

export function motionReduced(): boolean {
  return loadSettings().motionLevel === 'reduced';
}

/** Shake magnitude after the motion level gates it. */
export function effectiveShake(): number {
  return motionReduced() ? 0 : loadSettings().shakeIntensity;
}

/** Pulse depth scale: reduced is a whisper, calm the shipped feel, full the most. */
export function effectivePulseScale(): number {
  const level = loadSettings().motionLevel;
  return level === 'reduced' ? 0.35 : level === 'calm' ? 0.7 : 1;
}

export function effectiveVisibilityFloor(): number {
  return loadSettings().visibilityFloor;
}

export function masterVolume(): number {
  return loadSettings().masterVolume;
}

export function musicVolume(): number {
  return loadSettings().musicVolume;
}

export function sfxVolume(): number {
  return loadSettings().sfxVolume;
}

/**
 * The tier the renderer should boot at. 'auto' optimistically starts HIGH; the
 * main loop watches the real frame cost and steps down if the budget is blown,
 * so a weak machine settles itself within the first couple of seconds.
 */
export function renderQuality(): 'low' | 'medium' | 'high' {
  const setting = loadSettings().renderQuality;
  return setting === 'auto' ? 'high' : setting;
}

/** True when the tier is allowed to drop itself under load. */
export function renderQualityIsAuto(): boolean {
  return loadSettings().renderQuality === 'auto';
}

export function threatForecastOn(): boolean {
  return loadSettings().threatForecast;
}

/** Flips the forecast assist and persists it. Returns the new value. */
export function toggleThreatForecast(): boolean {
  const next = { ...loadSettings(), threatForecast: !loadSettings().threatForecast };
  saveSettings(next);
  return next.threatForecast;
}
