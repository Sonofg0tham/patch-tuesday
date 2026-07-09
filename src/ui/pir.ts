// The Post-Incident Review screen: the run's reckoning, rendered as a one-page
// security document in Fira Code. The sibling of Tailgate's Engagement Report.
// It reads a Pir object (built by sim/pir.ts from the real run) and lays it out
// as a rating stamp, a metrics block and a timestamped findings list. Built
// with textContent throughout, because the seed and scenario name are
// user-controllable and must never be interpreted as markup.

import type { Pir, PirFinding, Rating, Severity } from '../sim/pir';

export interface PirScreen {
  show(pir: Pir, scenarioId: string, seed: string): void;
}

// A short human verdict beneath the stamp. Dry, in keeping with the report.
const VERDICT: Record<Rating, string> = {
  'NEAR MISS': 'No encryption after detection. The response held; the dwell was not your doing.',
  CONTAINED: 'The worm was contained below a quarter of the estate. Crown jewels intact.',
  'REPORTABLE INCIDENT': 'Contained, but the blast radius crossed the reporting line. The regulator hears about this.',
  'TOTAL LOSS': 'The incident ran away from the response. Recovery is now a rebuild.',
};

// Rating stamp and finding severity both map to the two-colour story: cyan for
// good outcomes, amber for the middle, magenta for the threat.
function ratingClass(rating: Rating): string {
  if (rating === 'TOTAL LOSS') return 'lost';
  if (rating === 'REPORTABLE INCIDENT') return 'mid';
  return 'won';
}

function severityClass(severity: Severity): string {
  return `sev-${severity.toLowerCase()}`;
}

const TPLUS = (turn: number): string => `T+${String(turn).padStart(2, '0')}h`;

export function createPirScreen(container: HTMLElement): PirScreen {
  return {
    show(pir, scenarioId, seed) {
      const doc = document.createElement('div');
      doc.className = 'pir-doc';

      // Header.
      const head = document.createElement('div');
      head.className = 'pir-head';
      const title = document.createElement('div');
      title.className = 'pir-title';
      title.textContent = 'POST-INCIDENT REVIEW';
      const sub = document.createElement('div');
      sub.className = 'pir-sub';
      sub.textContent = `${pir.scenarioName}  ·  seed ${pir.seed}`;
      head.append(title, sub);

      // Rating stamp + verdict. An abandoned run is not rated: it carries the
      // ABANDONED stamp instead, and does not update any best.
      const stamp = document.createElement('div');
      stamp.className = `pir-rating ${pir.abandoned ? 'mid' : ratingClass(pir.rating)}`;
      stamp.textContent = pir.abandoned ? 'ABANDONED' : pir.rating;
      const verdict = document.createElement('div');
      verdict.className = 'pir-verdict';
      verdict.textContent = pir.abandoned
        ? 'The response was abandoned before the incident was resolved. Recorded, but not rated.'
        : VERDICT[pir.rating];

      // Metrics.
      const metrics = document.createElement('dl');
      metrics.className = 'pir-metrics';
      for (const m of pir.metrics) {
        const dt = document.createElement('dt');
        dt.textContent = m.label;
        const dd = document.createElement('dd');
        dd.textContent = m.value;
        metrics.append(dt, dd);
      }

      // Findings.
      const findingsHead = document.createElement('div');
      findingsHead.className = 'pir-section-head';
      findingsHead.textContent = `FINDINGS (${pir.findings.length})`;

      const list = document.createElement('ul');
      list.className = 'pir-findings';
      if (pir.findings.length === 0) {
        const li = document.createElement('li');
        li.className = 'pir-finding';
        li.textContent = 'No findings. A clean response.';
        list.append(li);
      }
      for (const f of pir.findings) list.append(findingRow(f));

      // Actions.
      const actions = document.createElement('div');
      actions.className = 'pir-actions';

      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'pir-button primary';
      again.textContent = '[ NEW INCIDENT ]';
      again.addEventListener('click', () => {
        // Back to the briefing: drop all run params.
        window.location.href = window.location.pathname;
      });

      const replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'pir-button';
      replay.textContent = '[ REPLAY THIS SEED ]';
      replay.addEventListener('click', () => {
        const params = new URLSearchParams({ scenario: scenarioId, seed });
        window.location.href = `${window.location.pathname}?${params.toString()}`;
      });

      actions.append(again, replay);

      doc.append(head, stamp, verdict, metrics, findingsHead, list, actions);
      container.replaceChildren(doc);
      container.hidden = false;
      again.focus();
    },
  };
}

function findingRow(f: PirFinding): HTMLElement {
  const li = document.createElement('li');
  li.className = 'pir-finding';

  const chip = document.createElement('span');
  chip.className = `pir-sev ${severityClass(f.severity)}`;
  chip.textContent = f.severity.toUpperCase();

  const time = document.createElement('span');
  time.className = 'pir-time';
  time.textContent = TPLUS(f.turn);

  const text = document.createElement('span');
  text.className = 'pir-text';
  text.textContent = f.text;

  li.append(chip, time, text);
  return li;
}
