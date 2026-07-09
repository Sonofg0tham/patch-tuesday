// The runbook main menu (Phase 6): the game opens here, framed as an incident
// response runbook. Choose the hand-authored MERIDIAN scenario or a random
// estate, seed it (reroll or type your own for a reproducible board), read the
// best rating and recent incidents per localStorage, and begin. This folds in
// the Phase 4 briefing panel, which no longer exists alongside it. Beginning a
// run reloads with the scenario and seed as query params, the reload-based
// navigation the rest of the game uses.
//
// textContent throughout: seeds and scenario names are user-controllable.

import { SCENARIOS, type Scenario } from '../data/scenarios';
import { randomSeed } from '../data/seed';
import { bestFor, recentRuns } from '../data/storage';

export interface Runbook {
  show(): void;
}

interface Options {
  onSettings: () => void;
}

// Normalises a typed seed: trimmed, spaces stripped, upper-cased, so the same
// intent always produces the same board. Empty means "mint a fresh one".
function normaliseSeed(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

export function createRunbook(container: HTMLElement, options: Options): Runbook {
  return {
    show() {
      let selected: Scenario = SCENARIOS[0];

      const panel = document.createElement('div');
      panel.className = 'menu-panel';

      const title = document.createElement('div');
      title.className = 'menu-title';
      title.textContent = 'PATCH TUESDAY';
      const sub = document.createElement('div');
      sub.className = 'menu-sub';
      sub.textContent = 'INCIDENT RESPONSE RUNBOOK // v1.0';
      const preamble = document.createElement('div');
      preamble.className = 'menu-preamble';
      preamble.textContent = 'Follow the runbook. Contain the incident. File the review.';
      panel.append(title, sub, preamble);

      // 01 Select scenario.
      panel.append(step('01', 'SELECT SCENARIO'));
      const scenarioList = document.createElement('div');
      scenarioList.className = 'menu-scenarios';
      scenarioList.setAttribute('role', 'radiogroup');
      scenarioList.setAttribute('aria-label', 'Scenario');
      const cards = new Map<string, HTMLButtonElement>();
      const selectScenario = (s: Scenario): void => {
        selected = s;
        for (const [id, card] of cards) card.setAttribute('aria-checked', String(id === s.id));
      };
      for (const s of SCENARIOS) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'menu-scenario';
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', String(s.id === selected.id));
        const name = document.createElement('div');
        name.className = 'menu-scenario-name';
        name.textContent = s.name;
        const blurb = document.createElement('div');
        blurb.className = 'menu-scenario-blurb';
        blurb.textContent = s.blurb;
        const best = document.createElement('div');
        best.className = 'menu-scenario-best';
        const b = bestFor(s.id);
        best.textContent = b ? `BEST: ${b}` : 'BEST: not yet run';
        card.append(name, blurb, best);
        card.addEventListener('click', () => selectScenario(s));
        cards.set(s.id, card);
        scenarioList.append(card);
      }
      panel.append(scenarioList);

      // 02 Seed.
      panel.append(step('02', 'SEED'));
      const seedRow = document.createElement('div');
      seedRow.className = 'menu-seed-row';
      const seedInput = document.createElement('input');
      seedInput.type = 'text';
      seedInput.className = 'menu-seed-input';
      seedInput.value = randomSeed();
      seedInput.setAttribute('aria-label', 'Seed (type your own for a reproducible board)');
      seedInput.spellcheck = false;
      seedInput.autocomplete = 'off';
      const reroll = document.createElement('button');
      reroll.type = 'button';
      reroll.className = 'menu-reroll';
      reroll.textContent = '[ new seed ]';
      reroll.addEventListener('click', () => {
        seedInput.value = randomSeed();
        seedInput.focus();
      });
      seedRow.append(seedInput, reroll);
      const seedNote = document.createElement('div');
      seedNote.className = 'menu-note';
      seedNote.textContent = 'The same seed always builds the same board and the same incident.';
      panel.append(seedRow, seedNote);

      // 03 Recent incidents.
      const history = recentRuns(6);
      if (history.length > 0) {
        panel.append(step('03', 'RECENT INCIDENTS'));
        const recent = document.createElement('div');
        recent.className = 'menu-recent';
        for (const run of history) {
          const row = document.createElement('div');
          row.className = 'menu-recent-row';
          const left = document.createElement('span');
          left.textContent = `${run.scenarioName.split(' //')[0]} · ${run.seed}`;
          const right = document.createElement('span');
          const kind = run.abandoned ? 'abandoned' : run.won ? 'won' : 'lost';
          right.className = `menu-recent-rating ${kind}`;
          right.textContent = run.abandoned ? 'ABANDONED' : run.rating;
          row.append(left, right);
          recent.append(row);
        }
        panel.append(recent);
      }

      // Actions.
      const actions = document.createElement('div');
      actions.className = 'menu-actions';
      const begin = document.createElement('button');
      begin.type = 'button';
      begin.className = 'menu-begin';
      begin.textContent = '▶ BEGIN INCIDENT';
      begin.addEventListener('click', () => {
        const seed = normaliseSeed(seedInput.value) || randomSeed();
        const params = new URLSearchParams({ scenario: selected.id, seed });
        window.location.href = `${window.location.pathname}?${params.toString()}`;
      });
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'menu-settings';
      settings.textContent = 'SETTINGS';
      settings.addEventListener('click', () => options.onSettings());
      actions.append(begin, settings);
      panel.append(actions);

      container.replaceChildren(panel);
      container.hidden = false;
      begin.focus();
    },
  };
}

function step(number: string, label: string): HTMLElement {
  const head = document.createElement('div');
  head.className = 'menu-step';
  const num = document.createElement('span');
  num.className = 'menu-step-num';
  num.textContent = number;
  const text = document.createElement('span');
  text.className = 'menu-step-label';
  text.textContent = label;
  head.append(num, text);
  return head;
}
