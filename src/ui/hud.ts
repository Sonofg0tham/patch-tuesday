// The war-room status surface. Lifecycle commands now live in
// incident-controls.ts so the HUD stays a passive, fog-safe readout.

import type { IncidentPhase } from '../sim/types';

export interface Hud {
  setTurn(turn: number): void;
  /** Business pressure meter: 0..max, with a warning state near and at max. */
  setPressure(value: number, max: number): void;
  /** A transient one-line notice (e.g. a forced reconnect), '' clears it. */
  setNotice(text: string): void;
}

export interface SituationPanelModel {
  phase: IncidentPhase;
  objective: string;
  threatSummary: string;
  ap: number;
  apPerHour: number;
  backupCredits: number;
  impact: number;
  pressure: number;
  pressureMax: number;
  seed: string;
  fps: number | null;
}

export interface SituationPanel {
  render(model: SituationPanelModel): void;
}

export function createHud(): Hud {
  const clockEl = mustFind('hud-clock');
  const pressureWrap = mustFind('hud-pressure');
  const pressureFill = mustFind('pressure-fill');
  const pressureLabel = mustFind('pressure-label-text');
  const noticeEl = mustFind('hud-notice');
  return {
    setTurn(turn) {
      clockEl.textContent = `T+${String(turn).padStart(2, '0')}h`;
    },
    setPressure(value, max) {
      const fraction = max > 0 ? Math.min(1, value / max) : 0;
      pressureFill.style.width = `${Math.round(fraction * 100)}%`;
      // Amber as it builds and at the ceiling. Business pressure is
      // uncertainty, never observable compromise.
      const imminent = value >= max;
      const rising = value >= max * 0.8;
      pressureWrap.classList.toggle('imminent', imminent);
      pressureWrap.classList.toggle('rising', rising && !imminent);
      pressureLabel.textContent = imminent
        ? 'BUSINESS PRESSURE - OVERRIDE IMMINENT'
        : 'BUSINESS PRESSURE';
    },
    setNotice(text) {
      noticeEl.textContent = text;
      noticeEl.classList.toggle('active', text !== '');
    },
  };
}

export function createSituationPanel(container: HTMLElement): SituationPanel {
  const phase = within(container, 'situation-phase');
  const objective = within(container, 'situation-objective');
  const threat = within(container, 'situation-threat');
  const ap = within(container, 'hud-ap');
  const credits = within(container, 'hud-credits');
  const impact = within(container, 'hud-score');
  const pressure = within(container, 'situation-pressure');
  const seed = within(container, 'hud-seed');
  const fps = within(container, 'overlay-fps');

  return {
    render(model) {
      phase.textContent = model.phase === 'active' ? 'ACTIVE RESPONSE' : 'RECOVERY';
      phase.dataset.phase = model.phase;
      objective.textContent = model.objective;
      threat.textContent = model.threatSummary;
      ap.textContent = `AP ${model.ap}/${model.apPerHour}`;
      credits.textContent = `BACKUPS ${model.backupCredits}`;
      impact.textContent = `IMPACT ${model.impact}`;
      pressure.textContent = `${model.pressure}/${model.pressureMax}`;
      seed.textContent = `SEED ${model.seed}`;
      fps.textContent = model.fps === null ? 'FPS --' : `FPS ${Math.round(model.fps)}`;
    },
  };
}

function within(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`#${id}`);
  if (!element) throw new Error(`Situation element #${id} missing from index.html`);
  return element;
}

function mustFind(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`HUD element #${id} missing from index.html`);
  return element;
}
