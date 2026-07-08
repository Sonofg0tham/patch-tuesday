// The incident-briefing screen: the run's entry point. Choose the hand-authored
// MERIDIAN scenario or a fresh random estate, see the best rating earned on each
// and the recent run history, then begin. This is the lean Phase 4 selector,
// not the full runbook menu (that is Phase 6): functional and on-brand, no
// lighting or settings. Beginning a run reloads with the chosen scenario and
// seed as query params, the same reload-based navigation the end screen uses.
//
// textContent throughout: seeds and scenario names are user-controllable.

import { SCENARIOS, type Scenario } from '../data/scenarios';
import { randomSeed } from '../data/seed';
import { bestFor, recentRuns } from '../data/storage';

export interface Briefing {
  show(): void;
}

export function createBriefing(container: HTMLElement): Briefing {
  return {
    show() {
      let selected: Scenario = SCENARIOS[0];
      let seed = randomSeed();

      const panel = document.createElement('div');
      panel.className = 'brief-panel';

      const title = document.createElement('div');
      title.className = 'brief-title';
      title.textContent = 'PATCH TUESDAY';
      const sub = document.createElement('div');
      sub.className = 'brief-sub';
      sub.textContent = 'INCIDENT BRIEFING';

      const scenarioList = document.createElement('div');
      scenarioList.className = 'brief-scenarios';
      scenarioList.setAttribute('role', 'radiogroup');
      scenarioList.setAttribute('aria-label', 'Scenario');

      const cards = new Map<string, HTMLButtonElement>();
      const selectScenario = (s: Scenario): void => {
        selected = s;
        for (const [id, card] of cards) card.setAttribute('aria-checked', String(id === s.id));
        seedLine.textContent = seedText();
      };

      for (const s of SCENARIOS) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'brief-scenario';
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', String(s.id === selected.id));

        const name = document.createElement('div');
        name.className = 'brief-scenario-name';
        name.textContent = s.name;

        const blurb = document.createElement('div');
        blurb.className = 'brief-scenario-blurb';
        blurb.textContent = s.blurb;

        const best = document.createElement('div');
        best.className = 'brief-scenario-best';
        const b = bestFor(s.id);
        best.textContent = b ? `BEST: ${b}` : 'BEST: not yet run';

        card.append(name, blurb, best);
        card.addEventListener('click', () => selectScenario(s));
        cards.set(s.id, card);
        scenarioList.append(card);
      }

      // Seed line, with a reroll for random boards.
      const seedRow = document.createElement('div');
      seedRow.className = 'brief-seed-row';
      const seedLine = document.createElement('span');
      seedLine.className = 'brief-seed';
      const seedText = (): string =>
        selected.kind === 'random' ? `SEED ${seed}` : 'SEED minted at start';
      seedLine.textContent = seedText();
      const reroll = document.createElement('button');
      reroll.type = 'button';
      reroll.className = 'brief-reroll';
      reroll.textContent = '[ new seed ]';
      reroll.addEventListener('click', () => {
        seed = randomSeed();
        seedLine.textContent = seedText();
      });
      seedRow.append(seedLine, reroll);

      // Recent runs.
      const history = recentRuns(6);
      const recent = document.createElement('div');
      recent.className = 'brief-recent';
      if (history.length > 0) {
        const head = document.createElement('div');
        head.className = 'brief-recent-head';
        head.textContent = 'RECENT INCIDENTS';
        recent.append(head);
        for (const run of history) {
          const row = document.createElement('div');
          row.className = 'brief-recent-row';
          const left = document.createElement('span');
          left.textContent = `${run.scenarioName.split(' //')[0]} · ${run.seed}`;
          const right = document.createElement('span');
          right.className = `brief-recent-rating ${run.won ? 'won' : 'lost'}`;
          right.textContent = run.rating;
          row.append(left, right);
          recent.append(row);
        }
      }

      const begin = document.createElement('button');
      begin.type = 'button';
      begin.className = 'brief-begin';
      begin.textContent = '[ BEGIN INCIDENT ]';
      begin.addEventListener('click', () => {
        const usedSeed = selected.kind === 'random' ? seed : randomSeed();
        const params = new URLSearchParams({ scenario: selected.id, seed: usedSeed });
        window.location.href = `${window.location.pathname}?${params.toString()}`;
      });

      panel.append(title, sub, scenarioList, seedRow, recent, begin);
      container.replaceChildren(panel);
      container.hidden = false;
      begin.focus();
    },
  };
}
