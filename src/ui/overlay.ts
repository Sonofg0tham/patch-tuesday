// The DOM overlay: the node inspector and the live fps readout. All game UI
// stays in the DOM; the canvas only ever draws the board.

import type { NodeType, Topology, TopologyNode } from '../data/topology';
import type { VisibleState } from '../sim/types';

const TYPE_LABEL: Record<NodeType, string> = {
  workstation: 'Workstation',
  server: 'Server',
  router: 'Router',
  backup: 'Backup node',
  'domain-controller': 'Domain controller',
};

// What the player is shown, matching the fog: an uncovered infection reads clean.
const STATUS_LABEL: Record<VisibleState, string> = {
  clean: 'Status: clean',
  infected: 'Status: INFECTED',
  encrypted: 'Status: ENCRYPTED',
  patched: 'Status: PATCHED (immune)',
};

export interface Overlay {
  inspect(
    node: TopologyNode | null,
    status?: VisibleState,
    isolated?: boolean,
    sensored?: boolean,
    isolationAge?: number,
  ): void;
  setFps(fps: number): void;
}

export function createOverlay(topology: Topology): Overlay {
  const nameEl = mustFind('inspect-name');
  const typeEl = mustFind('inspect-type');
  const roleEl = mustFind('inspect-role');
  const edrEl = mustFind('inspect-edr');
  const statusEl = mustFind('inspect-status');
  const connEl = mustFind('inspect-connections');
  const fpsEl = mustFind('overlay-fps');
  const panel = mustFind('inspector');

  return {
    inspect(node, status = 'clean', isolated = false, sensored = false, isolationAge = 0) {
      if (node === null) {
        panel.classList.add('empty');
        nameEl.textContent = 'No node selected';
        typeEl.textContent = '';
        roleEl.textContent = 'Click a node, or Tab through the asset register.';
        edrEl.textContent = '';
        edrEl.className = 'inspect-edr';
        statusEl.textContent = '';
        statusEl.className = 'inspect-status';
        connEl.textContent = '';
        return;
      }
      panel.classList.remove('empty');
      nameEl.textContent = node.label;
      typeEl.textContent = TYPE_LABEL[node.type];
      roleEl.textContent = node.role;
      // EDR status as words plus a state class, never colour alone. Coverage
      // can be built in or added by a deployed sensor.
      const covered = node.edr || sensored;
      edrEl.textContent = node.edr
        ? 'EDR: covered'
        : sensored
          ? 'EDR: covered (sensor)'
          : 'EDR: NOT COVERED';
      edrEl.className = covered ? 'inspect-edr on' : 'inspect-edr off';
      // Visible infection status, again words plus a class. Isolation is noted
      // in words (its board cue is the missing cables), with its age in hours so
      // the player can see how much business pressure it is building.
      const isolationNote = isolated ? ` · ISOLATED (${isolationAge}h)` : '';
      statusEl.textContent = `${STATUS_LABEL[status]}${isolationNote}`;
      statusEl.className = `inspect-status s-${status}`;

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
