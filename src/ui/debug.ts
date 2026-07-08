// The debug overlay (toggle with the 'd' key). Lays the true state beside the
// visible state so the fog of war is inspectable: any node whose truth differs
// from what the player sees is flagged. Also lists the last turn's spread
// attempt outcomes and the seed. Off by default; it reads the sim, never
// mutates it.
//
// The DOM is built with textContent, never innerHTML: the seed is
// user-controllable via the ?seed= URL parameter, so it must never be treated
// as markup.

import type { Topology } from '../data/topology';
import { SIM_CONFIG } from '../sim/config';
import type { GameState, TurnEvent } from '../sim/types';
import { blastRadius, encryptedCount, infectedCount, visibleStateOf } from '../sim/worm';

export interface DebugPanel {
  toggle(): boolean;
  isVisible(): boolean;
  render(state: GameState, topology: Topology, events: TurnEvent[]): void;
}

export function createDebug(container: HTMLElement): DebugPanel {
  let visible = false;
  container.hidden = true;

  function render(state: GameState, topology: Topology, events: TurnEvent[]): void {
    if (!visible) return;
    container.replaceChildren(
      heading('DEBUG // TRUE vs VISIBLE'),
      meta(state, topology),
      stateTable(state, topology),
      heading('LAST TURN SPREAD ATTEMPTS'),
      attemptsList(events),
    );
  }

  return {
    toggle() {
      visible = !visible;
      container.hidden = !visible;
      return visible;
    },
    isVisible() {
      return visible;
    },
    render,
  };
}

function heading(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'debug-head';
  el.textContent = text;
  return el;
}

function meta(state: GameState, topology: Topology): HTMLElement {
  const total = topology.nodes.length;
  const el = document.createElement('div');
  el.className = 'debug-meta';
  el.textContent =
    `seed ${state.seed} · T+${String(state.turn).padStart(2, '0')}h · ` +
    `${infectedCount(state)} infected · ${encryptedCount(state)}/${total} encrypted ` +
    `(${Math.round(blastRadius(state) * 100)}%) · pressure ${Math.round(state.pressure)}/${SIM_CONFIG.pressureMax}`;
  return el;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function stateTable(state: GameState, topology: Topology): HTMLElement {
  const table = document.createElement('table');
  table.className = 'debug-table';

  const head = document.createElement('tr');
  for (const label of ['node', 'true', 'visible', '']) head.appendChild(cell(label));
  const thead = document.createElement('thead');
  thead.appendChild(head);
  table.appendChild(thead);

  const body = document.createElement('tbody');
  for (const node of topology.nodes) {
    const ns = state.nodes[node.id];
    const truth = ns.state;
    const seen = visibleStateOf(node, ns);
    const hidden = truth !== seen;
    const row = document.createElement('tr');
    if (hidden) row.className = 'divergent';
    row.append(
      cell(node.id),
      cell(truth, `s-${truth}`),
      cell(seen, `s-${seen}`),
      cell(hidden ? '! hidden' : ''),
    );
    body.appendChild(row);
  }
  table.appendChild(body);
  return table;
}

function attemptsList(events: TurnEvent[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'debug-attempts';
  const attempts = events.filter(
    (e): e is Extract<TurnEvent, { kind: 'spread-attempt' }> => e.kind === 'spread-attempt',
  );
  if (attempts.length === 0) {
    el.textContent = 'none';
    return el;
  }
  for (const e of attempts) {
    const line = document.createElement('div');
    line.textContent = `${e.source} → ${e.target}  roll ${e.roll.toFixed(2)}  ${e.success ? 'HIT' : 'miss'}`;
    el.appendChild(line);
  }
  return el;
}
