// The asset register: a DOM list of every node, grouped by type. It is the
// keyboard path onto the board. Because each entry is a real <button>, Tab
// moves through the estate natively and Enter activates a node, no custom key
// handling and full screen-reader support. Focusing an entry highlights the
// matching node on the 3D board; activating it inspects the node.

import type { NodeType, Topology } from '../data/topology';

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
}

export function createRoster(
  container: HTMLElement,
  topology: Topology,
  handlers: RosterHandlers,
): Roster {
  const buttons = new Map<string, HTMLButtonElement>();

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
      // EDR status spoken as text, so coverage is never colour alone.
      button.setAttribute(
        'aria-label',
        `${node.label}, ${node.role}, EDR ${node.edr ? 'covered' : 'not covered'}`,
      );

      const name = document.createElement('span');
      name.className = 'roster-name';
      name.textContent = node.label;

      const edr = document.createElement('span');
      edr.className = node.edr ? 'roster-edr on' : 'roster-edr off';
      edr.textContent = node.edr ? 'EDR' : 'no EDR';
      edr.setAttribute('aria-hidden', 'true');

      button.append(name, edr);
      button.addEventListener('focus', () => handlers.onFocus(node.id));
      button.addEventListener('blur', () => handlers.onFocus(null));
      button.addEventListener('click', () => handlers.onActivate(node.id));

      buttons.set(node.id, button);
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
  };
}
