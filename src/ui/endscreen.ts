// The placeholder end screen: a one-line verdict and the run's headline
// numbers, shown when the incident is over. This is a deliberate stand-in for
// the real Post-Incident Review, which is Phase 4. Built with textContent, not
// innerHTML, because the seed is user-controllable.

import type { GameState } from '../sim/types';
import { blastRadius, encryptedCount } from '../sim/worm';
import { SIM_CONFIG } from '../sim/config';

export interface EndScreen {
  show(state: GameState, totalNodes: number): void;
}

export function createEndScreen(container: HTMLElement): EndScreen {
  return {
    show(state, totalNodes) {
      const won = state.status === 'won';
      const verdict = won
        ? 'CONTAINED'
        : state.lossReason === 'domain-controller'
          ? 'DOMAIN CONTROLLER LOST'
          : 'ESTATE OVERRUN';

      const heading = document.createElement('div');
      heading.className = won ? 'end-verdict won' : 'end-verdict lost';
      heading.textContent = verdict;

      const subtitle = document.createElement('div');
      subtitle.className = 'end-subtitle';
      subtitle.textContent = won
        ? 'No infected nodes remain. Placeholder verdict, the Post-Incident Review lands in Phase 4.'
        : 'The incident ran away from you. Placeholder verdict, the Post-Incident Review lands in Phase 4.';

      const metrics = document.createElement('dl');
      metrics.className = 'end-metrics';
      const rows: [string, string][] = [
        ['Time to resolve', `T+${String(state.turn).padStart(2, '0')}h`],
        ['Blast radius', `${Math.round(blastRadius(state) * 100)}% (${encryptedCount(state)}/${totalNodes} encrypted)`],
        ['Impact score', String(state.score)],
        ['Backup credits burned', `${SIM_CONFIG.backupCredits - state.backupCredits} of ${SIM_CONFIG.backupCredits}`],
        ['Emergency change control', state.emergencyUsed ? 'BYPASSED' : 'not used'],
      ];
      for (const [label, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        metrics.append(dt, dd);
      }

      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'end-again';
      again.textContent = '[ New incident ]';
      again.addEventListener('click', () => {
        // Fresh incident: drop any ?seed= so a new random one is minted.
        window.location.href = window.location.pathname;
      });

      container.replaceChildren(heading, subtitle, metrics, again);
      container.hidden = false;
      again.focus();
    },
  };
}
