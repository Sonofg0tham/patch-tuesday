// The war-room HUD controls: the incident clock, the seed readout, the board
// status line, and the End Turn button. End Turn is the only player input this
// phase. It works by click, by focus plus Enter or Space (it is a real button),
// and by a global Enter when nothing else is focused, so the keyboard path from
// GAME_DESIGN.md works without clashing with the roster's Enter-to-inspect.

export interface Hud {
  setTurn(turn: number): void;
  setSeed(seed: string): void;
  setStatus(text: string, lost: boolean): void;
  /** Business pressure meter: 0..max, with a warning state near and at max. */
  setPressure(value: number, max: number): void;
  /** A transient one-line notice (e.g. a forced reconnect), '' clears it. */
  setNotice(text: string): void;
  setEndTurnEnabled(enabled: boolean): void;
  onEndTurn(callback: () => void): void;
}

export function createHud(): Hud {
  const clockEl = mustFind('hud-clock');
  const seedEl = mustFind('hud-seed');
  const statusEl = mustFind('hud-status');
  const pressureWrap = mustFind('hud-pressure');
  const pressureFill = mustFind('pressure-fill');
  const pressureLabel = mustFind('pressure-label');
  const noticeEl = mustFind('hud-notice');
  const button = mustFind('end-turn') as HTMLButtonElement;

  let endTurnCallback: () => void = () => {};
  const fire = (): void => {
    if (!button.disabled) endTurnCallback();
  };

  button.addEventListener('click', fire);

  // A global Enter ends the turn, but only when focus is not on an interactive
  // element (the roster buttons and End Turn itself handle their own Enter).
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const active = document.activeElement;
    const onControl =
      active instanceof HTMLElement &&
      (active.tagName === 'BUTTON' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (onControl) return;
    event.preventDefault();
    fire();
  });

  return {
    setTurn(turn) {
      clockEl.textContent = `T+${String(turn).padStart(2, '0')}h`;
    },
    setSeed(seed) {
      seedEl.textContent = `SEED ${seed}`;
    },
    setStatus(text, lost) {
      statusEl.textContent = text;
      statusEl.classList.toggle('lost', lost);
    },
    setPressure(value, max) {
      const fraction = max > 0 ? Math.min(1, value / max) : 0;
      pressureFill.style.width = `${Math.round(fraction * 100)}%`;
      // Amber as it builds, magenta and "OVERRIDE IMMINENT" once maxed: the
      // clear warning the turn before the business forces a reconnect.
      const imminent = value >= max;
      const rising = value >= max * 0.8;
      pressureWrap.classList.toggle('imminent', imminent);
      pressureWrap.classList.toggle('rising', rising && !imminent);
      pressureLabel.textContent = imminent
        ? 'BUSINESS PRESSURE — OVERRIDE IMMINENT'
        : 'BUSINESS PRESSURE';
    },
    setNotice(text) {
      noticeEl.textContent = text;
      noticeEl.classList.toggle('active', text !== '');
    },
    setEndTurnEnabled(enabled) {
      button.disabled = !enabled;
      button.textContent = enabled ? 'End turn  ⏎' : 'Resolving…';
    },
    onEndTurn(callback) {
      endTurnCallback = callback;
    },
  };
}

function mustFind(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`HUD element #${id} missing from index.html`);
  return element;
}
