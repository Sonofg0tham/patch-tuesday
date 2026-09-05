// Fog-safe incident history. The timeline accepts only observable events and
// keeps the short operational view separate from the recorder's complete log.

import type { ObservableTurnEvent } from '../sim/telemetry';

export interface TimelineEntry {
  turn: number;
  text: string;
}

export interface TimelineModel {
  readonly entries: readonly TimelineEntry[];
  append(entry: TimelineEntry): void;
}

export interface TimelineSummaryOptions {
  turn?: number;
  labelOf?: (nodeId: string) => string;
}

export interface Timeline {
  append(entry: TimelineEntry): void;
  appendResolution(
    turn: number,
    events: readonly ObservableTurnEvent[],
    options?: Omit<TimelineSummaryOptions, 'turn'>,
  ): void;
  readonly entries: readonly TimelineEntry[];
}

const MAX_VISIBLE_ENTRIES = 8;

export function createTimelineModel(): TimelineModel {
  const entries: TimelineEntry[] = [];
  return {
    get entries() {
      return entries;
    },
    append(entry) {
      entries.push({ ...entry });
      if (entries.length > MAX_VISIBLE_ENTRIES) {
        entries.splice(0, entries.length - MAX_VISIBLE_ENTRIES);
      }
    },
  };
}

export function summariseResolution(
  events: readonly ObservableTurnEvent[],
  options: TimelineSummaryOptions = {},
): string {
  const labelOf = options.labelOf ?? ((nodeId: string) => nodeId);
  const recovery = events.some((event) => event.kind === 'recovery-hour');
  const parts: string[] = [];

  if (recovery) {
    parts.push(
      `Recovery advanced to T+${String(options.turn ?? 0).padStart(2, '0')}h; operational costs updated.`,
    );
  }

  const declarations = events.filter(
    (event): event is Extract<ObservableTurnEvent, { kind: 'containment-declaration' }> =>
      event.kind === 'containment-declaration',
  );
  for (const declaration of declarations) {
    parts.push(
      declaration.confirmed
        ? 'Containment confirmed; recovery opened.'
        : 'Containment declaration failed; active response continues.',
    );
  }

  const actions = events.filter(
    (event): event is Extract<ObservableTurnEvent, { kind: 'action' }> => event.kind === 'action',
  );
  for (const event of actions) {
    const target = event.node ? ` on ${labelOf(event.node)}` : '';
    const label = actionLabel(event.action);
    if (event.outcome === 'probe') {
      parts.push(`${label} probe${target} exposed active compromise.`);
    } else if (event.outcome === 'applied') {
      parts.push(`${label}${target} completed.`);
    }
  }

  const attempts = events.filter(
    (event): event is Extract<ObservableTurnEvent, { kind: 'attempt' }> => event.kind === 'attempt',
  );
  if (attempts.length > 0) {
    const successes = attempts.filter((event) => event.success).length;
    parts.push(
      `Observed ${attempts.length} threat ${plural(attempts.length, 'route', 'routes')}; ${successes} ${plural(successes, 'succeeded', 'succeeded')}.`,
    );
  }

  for (const event of events) {
    if (event.kind === 'infected') {
      parts.push(`Observed compromise reached ${labelOf(event.node)}.`);
    } else if (event.kind === 'encrypted') {
      parts.push(`${labelOf(event.node)} encrypted.`);
    } else if (event.kind === 'override') {
      parts.push(`Business pressure returned ${labelOf(event.node)} to service.`);
    } else if (event.kind === 'review-filed') {
      parts.push('Post-Incident Review filed.');
    }
  }

  const hiddenAttempts = events.reduce(
    (sum, event) => sum + (event.kind === 'telemetry-gap' ? event.attempts : 0),
    0,
  );
  if (hiddenAttempts > 0) {
    parts.push(
      `Telemetry gaps obscured ${hiddenAttempts} threat ${plural(hiddenAttempts, 'attempt', 'attempts')}.`,
    );
  }

  return parts.join(' ') || 'No observable change this hour.';
}

export function createTimeline(container: HTMLElement): Timeline {
  const model = createTimelineModel();
  container.setAttribute('role', 'log');
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-relevant', 'additions');
  container.setAttribute('aria-atomic', 'false');

  const list = document.createElement('ol');
  list.className = 'timeline-list';
  container.replaceChildren(list);

  function append(entry: TimelineEntry): void {
    model.append(entry);
    while (list.children.length >= MAX_VISIBLE_ENTRIES) list.firstElementChild?.remove();

    const row = document.createElement('li');
    row.className = 'timeline-entry';
    row.dataset.turn = String(entry.turn);
    row.setAttribute('aria-atomic', 'true');

    const time = document.createElement('time');
    time.className = 'timeline-time';
    time.textContent = `T+${String(entry.turn).padStart(2, '0')}h`;

    const text = document.createElement('span');
    text.className = 'timeline-text';
    text.textContent = entry.text;
    row.append(time, text);
    list.appendChild(row);
  }

  return {
    append,
    appendResolution(turn, events, options = {}) {
      append({
        turn,
        text: summariseResolution(events, { ...options, turn }),
      });
    },
    get entries() {
      return model.entries;
    },
  };
}

function actionLabel(action: Extract<ObservableTurnEvent, { kind: 'action' }>['action']): string {
  switch (action) {
    case 'scan':
      return 'Sensor deployment';
    case 'isolate':
      return 'Isolation';
    case 'reconnect':
      return 'Reconnection';
    case 'patch':
      return 'Patch';
    case 'restore':
      return 'Restore';
    case 'emergency':
      return 'Emergency budget';
  }
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
