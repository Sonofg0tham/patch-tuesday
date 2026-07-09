// The mid-run pause menu (Phase 6), war-room styled. Opened with Escape during
// an incident. Resume returns to the board; Settings opens the shared settings
// panel; Abandon Incident files a Post-Incident Review for the run so far,
// marked ABANDONED (recorded in history, never a best).

export interface PauseMenu {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

interface Options {
  onResume: () => void;
  onSettings: () => void;
  onAbandon: () => void;
}

export function createPauseMenu(container: HTMLElement, options: Options): PauseMenu {
  let open = false;

  function build(): void {
    const panel = document.createElement('div');
    panel.className = 'pause-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Incident paused');

    const title = document.createElement('div');
    title.className = 'pause-title';
    title.textContent = 'INCIDENT PAUSED';
    const sub = document.createElement('div');
    sub.className = 'pause-sub';
    sub.textContent = 'The clock is stopped. The worm waits.';
    panel.append(title, sub);

    const resume = button('▶ RESUME', 'pause-button primary', () => api.close());
    const settings = button('SETTINGS', 'pause-button', () => options.onSettings());
    const abandon = button('ABANDON INCIDENT', 'pause-button danger', () => options.onAbandon());
    panel.append(resume, settings, abandon);

    container.replaceChildren(panel);
    resume.focus();
  }

  const api: PauseMenu = {
    open() {
      open = true;
      build();
      container.hidden = false;
    },
    close() {
      open = false;
      container.hidden = true;
      container.replaceChildren();
      options.onResume();
    },
    isOpen() {
      return open;
    },
  };
  return api;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
