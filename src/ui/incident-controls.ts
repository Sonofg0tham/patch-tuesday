// Lifecycle controls for active response and recovery. The pure model owns the
// phase contract; the DOM wrapper supplies buttons, focus and keyboard access.

import type { IncidentPhase } from '../sim/types';

export type IncidentCommand =
  | 'end-hour'
  | 'declare-containment'
  | 'advance-recovery'
  | 'file-review'
  | 'skip';

export interface IncidentControlState {
  phase: IncidentPhase;
}

export interface IncidentControlModel {
  command: IncidentCommand;
  label: string;
  disabled: boolean;
  primary: boolean;
}

export interface IncidentControlCallbacks {
  onEndHour(): void;
  onDeclareContainment(): void;
  onFileReview(): void;
  onSkip(): void;
}

export interface IncidentControls {
  render(state: IncidentControlState, canDeclare: boolean, resolving: boolean): void;
  setEnabled(enabled: boolean): void;
  focusPrimary(): void;
  destroy(): void;
}

export function deriveIncidentControls(
  state: IncidentControlState,
  canDeclare: boolean,
  resolving: boolean,
): IncidentControlModel[] {
  const controls: IncidentControlModel[] =
    state.phase === 'active'
      ? [
          { command: 'end-hour', label: 'End Hour', disabled: resolving, primary: true },
          ...(canDeclare
            ? [
                {
                  command: 'declare-containment' as const,
                  label: 'Declare Containment',
                  disabled: resolving,
                  primary: false,
                },
              ]
            : []),
        ]
      : [
          {
            command: 'advance-recovery',
            label: 'Advance Recovery Hour',
            disabled: resolving,
            primary: true,
          },
          { command: 'file-review', label: 'File Review', disabled: resolving, primary: false },
        ];

  if (resolving) {
    controls.push({ command: 'skip', label: 'Skip Resolution', disabled: false, primary: false });
  }
  return controls;
}

export function commandForIncidentHotkey(
  key: string,
  state: IncidentControlState,
  canDeclare: boolean,
  resolving: boolean,
): IncidentCommand | null {
  if (resolving) return null;
  if (key === 'Enter') return state.phase === 'active' ? 'end-hour' : 'advance-recovery';
  if (key.toLowerCase() === 'c' && state.phase === 'active' && canDeclare) {
    return 'declare-containment';
  }
  if (key.toLowerCase() === 'f' && state.phase === 'recovery') return 'file-review';
  return null;
}

export function createIncidentControls(
  container: HTMLElement,
  callbacks: IncidentControlCallbacks,
): IncidentControls {
  let state: IncidentControlState = { phase: 'active' };
  let canDeclare = false;
  let resolving = false;
  let enabled = true;
  let buttons = new Map<IncidentCommand, HTMLButtonElement>();

  const dispatch = (command: IncidentCommand): void => {
    if (!enabled && command !== 'skip') return;
    switch (command) {
      case 'end-hour':
      case 'advance-recovery':
        callbacks.onEndHour();
        break;
      case 'declare-containment':
        callbacks.onDeclareContainment();
        break;
      case 'file-review':
        callbacks.onFileReview();
        break;
      case 'skip':
        callbacks.onSkip();
        break;
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!enabled || event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) ||
        active.isContentEditable ||
        (event.key === 'Enter' && active.tagName === 'BUTTON'))
    ) {
      return;
    }
    const command = commandForIncidentHotkey(event.key, state, canDeclare, resolving);
    if (command === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dispatch(command);
  };
  window.addEventListener('keydown', onKeyDown, true);

  function render(
    nextState: IncidentControlState,
    nextCanDeclare: boolean,
    nextResolving: boolean,
  ): void {
    state = nextState;
    canDeclare = nextCanDeclare;
    resolving = nextResolving;
    buttons = new Map();
    container.replaceChildren();

    for (const control of deriveIncidentControls(state, canDeclare, resolving)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = control.primary
        ? 'incident-command incident-command-primary'
        : 'incident-command';
      button.dataset.command = control.command;
      button.textContent = control.label;
      button.disabled = control.disabled || (!enabled && control.command !== 'skip');
      const shortcut = shortcutFor(control.command);
      if (shortcut) button.setAttribute('aria-keyshortcuts', shortcut);
      button.addEventListener('click', () => dispatch(control.command));
      buttons.set(control.command, button);
      container.appendChild(button);
    }
  }

  return {
    render,
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
      render(state, canDeclare, resolving);
    },
    focusPrimary() {
      const primary = [...buttons.values()].find(
        (button) => button.classList.contains('incident-command-primary') && !button.disabled,
      );
      primary?.focus();
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown, true);
    },
  };
}

function shortcutFor(command: IncidentCommand): string | null {
  if (command === 'end-hour' || command === 'advance-recovery') return 'Enter';
  if (command === 'declare-containment') return 'C';
  if (command === 'file-review') return 'F';
  return null;
}
