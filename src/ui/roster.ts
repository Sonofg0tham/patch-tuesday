// The asset register: a DOM list of every node, grouped by type. It is the
// keyboard path onto the board. Because each entry is a real <button>, Tab
// moves through the estate natively and Enter activates a node, no custom key
// handling and full screen-reader support. Focusing an entry highlights the
// matching node on the 3D board; activating it inspects the node.

import type { NodeType, Topology } from '../data/topology';
import type { PresentationView } from '../sim/telemetry';

const TYPE_ORDER: NodeType[] = [
  'domain-controller',
  'server',
  'router',
  'backup',
  'workstation',
];

const TYPE_HEADING: Record<NodeType, string> = {
  'domain-controller': 'Domain controller',
  server: 'Servers',
  router: 'Routers',
  backup: 'Backup',
  workstation: 'Workstations',
};

export interface RosterHandlers {
  onFocus(nodeId: string | null): void;
  onActivate(nodeId: string): void;
}

export interface Roster {
  setActive(nodeId: string | null): void;
  render(view: PresentationView): void;
}

export function createRoster(
  container: HTMLElement,
  topology: Topology,
  handlers: RosterHandlers,
): Roster {
  const buttons = new Map<string, HTMLButtonElement>();
  const states = new Map<string, HTMLElement>();

  for (const type of TYPE_ORDER) {
    const nodes = topology.nodes.filter((n) => n.type === type);
    if (nodes.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'roster-section';

    const heading = document.createElement('h2');
    heading.className = 'roster-heading';
    heading.textContent = `${TYPE_HEADING[type]} (${nodes.length})`;
    section.appendChild(heading);

    for (const node of nodes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'roster-item';
      button.dataset.nodeId = node.id;
      button.setAttribute('aria-pressed', 'false');

      const name = document.createElement('span');
      name.className = 'roster-name';
      name.textContent = node.label;

      const state = document.createElement('span');
      state.className = 'roster-state state-unknown';
      state.textContent = '[?] UNKNOWN';
      state.setAttribute('aria-hidden', 'true');

      button.append(name, state);
      button.addEventListener('focus', () => handlers.onFocus(node.id));
      button.addEventListener('blur', () => handlers.onFocus(null));
      button.addEventListener('click', () => handlers.onActivate(node.id));

      buttons.set(node.id, button);
      states.set(node.id, state);
      section.appendChild(button);
    }
    container.appendChild(section);
  }

  let activeId: string | null = null;

  return {
    setActive(nodeId) {
      if (nodeId === activeId) return;
      if (activeId) buttons.get(activeId)?.setAttribute('aria-pressed', 'false');
      activeId = nodeId;
      if (activeId) buttons.get(activeId)?.setAttribute('aria-pressed', 'true');
    },
    render(view) {
      for (const node of topology.nodes) {
        const presentation = view.nodes[node.id];
        const button = buttons.get(node.id);
        const state = states.get(node.id);
        if (!presentation || !button || !state) continue;

        const visible = rosterState(presentation.visibleState, presentation.observed);
        const isolation = presentation.isolated ? 'isolated' : 'connected';
        const coverage = presentation.edr ? 'EDR covered' : 'not EDR covered';
        button.setAttribute(
          'aria-label',
          `${node.label}, ${node.role}, visible state ${visible.label.toLowerCase()}, ${isolation}, ${coverage}`,
        );
        button.dataset.visibleState = visible.className;
        button.dataset.isolated = String(presentation.isolated);
        state.className = `roster-state state-${visible.className}`;
        state.textContent = `${visible.glyph} ${visible.label}${presentation.isolated ? ' / CUT' : ''}`;
      }
    },
  };
}

function rosterState(
  state: PresentationView['nodes'][string]['visibleState'],
  observed: boolean,
): { className: string; glyph: string; label: string } {
  if (!observed && state === 'clean') return { className: 'unknown', glyph: '[?]', label: 'UNKNOWN' };
  switch (state) {
    case 'clean':
      return { className: 'clean', glyph: '[+]', label: 'CLEAN' };
    case 'infected':
      return { className: 'infected', glyph: '[!]', label: 'INFECTED' };
    case 'encrypted':
      return { className: 'encrypted', glyph: '[X]', label: 'ENCRYPTED' };
    case 'patched':
      return { className: 'patched', glyph: '[#]', label: 'PATCHED' };
  }
}
