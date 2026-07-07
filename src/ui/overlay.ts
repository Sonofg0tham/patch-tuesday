// The DOM overlay: names the selected box and shows a live fps readout.
// All game UI stays in the DOM, the canvas only ever draws the board.

export interface Overlay {
  setSelected(index: number | null): void;
  setFps(fps: number): void;
}

export function createOverlay(): Overlay {
  const selectedEl = mustFind('overlay-selected');
  const fpsEl = mustFind('overlay-fps');

  return {
    setSelected(index) {
      selectedEl.textContent =
        index === null
          ? 'SELECTED: none'
          : `SELECTED: NODE-${String(index).padStart(2, '0')}`;
    },
    setFps(fps) {
      fpsEl.textContent = `FPS: ${Math.round(fps)}`;
    },
  };
}

function mustFind(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Overlay element #${id} missing from index.html`);
  return element;
}
