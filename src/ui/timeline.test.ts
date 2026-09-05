import { describe, expect, it } from 'vitest';
import type { ObservableTurnEvent } from '../sim/telemetry';
import {
  createTimelineModel,
  summariseResolution,
  type TimelineEntry,
} from './timeline';

const entryAt = (turn: number): TimelineEntry => ({
  turn,
  text: `Observed event at T+${String(turn).padStart(2, '0')}h.`,
});

describe('incident timeline', () => {
  it('keeps the latest eight observed entries in chronological order', () => {
    const model = createTimelineModel();
    for (let hour = 1; hour <= 10; hour += 1) model.append(entryAt(hour));

    expect(model.entries.map((entry) => entry.turn)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('summarises hidden activity once without a location', () => {
    const events: ObservableTurnEvent[] = [
      { kind: 'telemetry-gap', attempts: 2 },
      { kind: 'telemetry-gap', attempts: 1 },
    ];

    expect(summariseResolution(events)).toBe('Telemetry gaps obscured 3 threat attempts.');
  });

  it('summarises a recovery hour without hidden-threat wording', () => {
    expect(summariseResolution([{ kind: 'recovery-hour' }], { turn: 7 })).toBe(
      'Recovery advanced to T+07h; operational costs updated.',
    );
  });
});
