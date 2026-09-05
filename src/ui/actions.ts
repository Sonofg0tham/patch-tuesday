// The action bar: six buttons plus the emergency budget, the AP / backups /
// score readouts, and the blocked-reason line. Buttons are never silently
// disabled; an action the player cannot take is attempted and answered with a
// plain-English reason, so the player always learns why. Hotkeys act on the
// selected node.

import type { ActionKind } from '../sim/types';

export interface ActionDef {
  kind: ActionKind;
  label: string;
  hotkey: string; // single lower-case key
  cost: string; // shown on the button
  needsNode: boolean;
}

export const ACTION_CATALOGUE: readonly ActionDef[] = [
  { kind: 'scan', label: 'Deploy sensor', hotkey: 's', cost: '1', needsNode: true },
  { kind: 'isolate', label: 'Isolate', hotkey: 'i', cost: '1', needsNode: true },
  { kind: 'reconnect', label: 'Reconnect', hotkey: 'c', cost: '1', needsNode: true },
  { kind: 'patch', label: 'Patch', hotkey: 'p', cost: '2', needsNode: true },
  { kind: 'restore', label: 'Restore', hotkey: 'r', cost: '2', needsNode: true },
  { kind: 'emergency', label: 'Emergency budget', hotkey: 'e', cost: '+2 AP', needsNode: false },
];

export function actionForHotkey(key: string, enabled: boolean): ActionKind | null {
  if (!enabled) return null;
  return ACTION_CATALOGUE.find((action) => action.hotkey === key.toLowerCase())?.kind ?? null;
}

export interface ActionBar {
  setAp(ap: number, perTurn: number): void;
  setCredits(credits: number): void;
  setScore(score: number): void;
  setReason(text: string, ok: boolean): void;
  setEnabled(enabled: boolean): void;
}

export interface ActionHandlers {
  /** Fired when an action is invoked; returns nothing, the app applies it. */
  onAction(kind: ActionKind): void;
  /** Focus and hover preview public consequences without invoking the action. */
  onPreview(kind: ActionKind | null): void;
}

export function createActionBar(container: HTMLElement, handlers: ActionHandlers): ActionBar {
  const apEl = mustFind('hud-ap');
  const creditsEl = mustFind('hud-credits');
  const scoreEl = mustFind('hud-score');
  const reasonEl = mustFind('action-reason');
  const buttons: HTMLButtonElement[] = [];
  let hotkeysEnabled = true;

  for (const def of ACTION_CATALOGUE) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-button';
    button.dataset.kind = def.kind;

    const name = document.createElement('span');
    name.className = 'action-name';
    name.textContent = def.label;

    const meta = document.createElement('span');
    meta.className = 'action-meta';
    meta.textContent = `${def.cost}${def.kind === 'emergency' ? '' : ' AP'} · ${def.hotkey.toUpperCase()}`;

    button.append(name, meta);
    button.setAttribute('aria-keyshortcuts', def.hotkey);
    button.addEventListener('click', () => handlers.onAction(def.kind));
    button.addEventListener('pointerenter', () => handlers.onPreview(def.kind));
    button.addEventListener('pointerleave', () => handlers.onPreview(null));
    button.addEventListener('focus', () => handlers.onPreview(def.kind));
    button.addEventListener('blur', () => handlers.onPreview(null));
    buttons.push(button);
    container.appendChild(button);
  }

  // Hotkeys act on the current selection. Ignored while typing in a field, and
  // Enter is left to End Turn (handled in the HUD).
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)
    ) {
      return;
    }
    const kind = actionForHotkey(event.key, hotkeysEnabled);
    if (kind === null) return;
    event.preventDefault();
    handlers.onAction(kind);
  });

  return {
    setAp(ap, perTurn) {
      apEl.textContent = `AP ${ap}/${perTurn}`;
    },
    setCredits(credits) {
      creditsEl.textContent = `BACKUPS ${credits}`;
    },
    setScore(score) {
      scoreEl.textContent = `IMPACT ${score}`;
    },
    setReason(text, ok) {
      reasonEl.textContent = text;
      reasonEl.className = text ? (ok ? 'ok' : 'blocked') : '';
    },
    setEnabled(nextEnabled) {
      for (const button of buttons) button.disabled = !nextEnabled;
      // The global keyboard path must be locked with the visible controls.
      // A disabled button alone does not stop a window key listener.
      hotkeysEnabled = nextEnabled;
    },
  };
}

function mustFind(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Action bar element #${id} missing from index.html`);
  return element;
}
