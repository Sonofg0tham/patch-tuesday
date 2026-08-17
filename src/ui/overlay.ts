// The DOM overlay: the node inspector and the live fps readout. All game UI
// stays in the DOM; the canvas only ever draws the board.

import type { NodeType } from '../data/topology';
import type { NodeInspectionModel } from './situation';

const TYPE_LABEL: Record<NodeType, string> = {
  workstation: 'Workstation',
  server: 'Server',
  router: 'Router',
  backup: 'Backup node',
  'domain-controller': 'Domain controller',
};

export interface Overlay {
  inspect(model: NodeInspectionModel | null): void;
  setFps(fps: number): void;
}

export function createOverlay(): Overlay {
  const nameEl = mustFind('inspect-name');
  const typeEl = mustFind('inspect-type');
  const roleEl = mustFind('inspect-role');
  const edrEl = mustFind('inspect-edr');
  const statusEl = mustFind('inspect-status');
  const connEl = mustFind('inspect-connections');
  const fpsEl = mustFind('overlay-fps');
  const panel = mustFind('inspector');

  return {
    inspect(model) {
      if (model === null) {
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
      nameEl.textContent = model.label;
      typeEl.textContent = TYPE_LABEL[model.type];
      roleEl.textContent = model.role;
      // EDR status as words plus a state class, never colour alone. Coverage
      // can be built in or added by a deployed sensor.
      const covered = model.coverage !== 'none';
      edrEl.textContent = model.coverage === 'built-in'
        ? 'EDR: covered'
        : model.coverage === 'sensor'
          ? 'EDR: covered (sensor)'
          : 'EDR: NOT COVERED';
      edrEl.className = covered ? 'inspect-edr on' : 'inspect-edr off';
      // Visible infection status, again words plus a class. Isolation is noted
      // in words (its board cue is the missing cables), with its age in hours so
      // the player can see how much business pressure it is building.
      const isolationNote = model.isolated ? ` · ISOLATED (${model.isolationAge}h)` : '';
      statusEl.textContent = `${model.consequences.statusText}${isolationNote}`;
      statusEl.className = `inspect-status s-${model.visibleState}`;

      connEl.textContent = `Connections (${model.connectionLabels.length}): ${model.connectionLabels.join(', ')}`;
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
