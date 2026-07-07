// The DOM overlay: the node inspector and the live fps readout. All game UI
// stays in the DOM; the canvas only ever draws the board.

import type { NodeType, Topology, TopologyNode } from '../data/topology';

const TYPE_LABEL: Record<NodeType, string> = {
  workstation: 'Workstation',
  server: 'Server',
  router: 'Router',
  backup: 'Backup node',
  'domain-controller': 'Domain controller',
};

export interface Overlay {
  inspect(node: TopologyNode | null): void;
  setFps(fps: number): void;
}

export function createOverlay(topology: Topology): Overlay {
  const nameEl = mustFind('inspect-name');
  const typeEl = mustFind('inspect-type');
  const roleEl = mustFind('inspect-role');
  const edrEl = mustFind('inspect-edr');
  const connEl = mustFind('inspect-connections');
  const fpsEl = mustFind('overlay-fps');
  const panel = mustFind('inspector');

  return {
    inspect(node) {
      if (node === null) {
        panel.classList.add('empty');
        nameEl.textContent = 'No node selected';
        typeEl.textContent = '';
        roleEl.textContent = 'Click a node, or Tab through the asset register.';
        edrEl.textContent = '';
        edrEl.className = 'inspect-edr';
        connEl.textContent = '';
        return;
      }
      panel.classList.remove('empty');
      nameEl.textContent = node.label;
      typeEl.textContent = TYPE_LABEL[node.type];
      roleEl.textContent = node.role;
      // EDR status as words plus a state class, never colour alone.
      edrEl.textContent = node.edr ? 'EDR: covered' : 'EDR: NOT COVERED';
      edrEl.className = node.edr ? 'inspect-edr on' : 'inspect-edr off';

      const names = node.neighbours.map((id) => topology.byId.get(id)?.label ?? id);
      connEl.textContent = `Connections (${names.length}): ${names.join(', ')}`;
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
