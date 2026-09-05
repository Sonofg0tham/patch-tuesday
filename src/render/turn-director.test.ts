import { describe, expect, it } from 'vitest';
import type {
  NodePresentationState,
  ObservableTurnEvent,
  PresentationView,
} from '../sim/telemetry';
import { createTurnDirector, TURN_DIRECTOR_TIMING } from './turn-director';

function node(
  id: string,
  overrides: Partial<NodePresentationState> = {},
): NodePresentationState {
  return {
    id,
    visibleState: 'clean',
    observed: true,
    isolated: false,
    isolationAge: 0,
    edr: true,
    ...overrides,
  };
}

function view(...nodes: NodePresentationState[]): PresentationView {
  return { nodes: Object.fromEntries(nodes.map((item) => [item.id, item])) };
}

const beforeView = view(
  node('EDR-A', { visibleState: 'infected', turnsToEncryption: 6 }),
  node('EDR-B'),
  node('LOCKED'),
  node('OVERRIDE', {
    isolated: true,
    isolationAge: 3,
  }),
);

const afterView = view(
  node('EDR-A', { visibleState: 'infected', turnsToEncryption: 5 }),
  node('EDR-B', { visibleState: 'infected', turnsToEncryption: 7 }),
  node('LOCKED', { visibleState: 'encrypted' }),
  node('OVERRIDE'),
);

const attemptEvent: ObservableTurnEvent = {
  kind: 'attempt',
  source: 'EDR-A',
  target: 'EDR-B',
  success: true,
};
const infectedEvent: ObservableTurnEvent = { kind: 'infected', node: 'EDR-B' };
const encryptedEvent: ObservableTurnEvent = { kind: 'encrypted', node: 'LOCKED' };
const overrideEvent: ObservableTurnEvent = { kind: 'override', node: 'OVERRIDE' };

describe('turn resolution director', () => {
  it('emits observable beats in simulation order and completes once', () => {
    const seen: string[] = [];
    const director = createTurnDirector({
      onAnalysis: () => seen.push('analysis'),
      onBeat: (event) => seen.push(event.kind),
      onSettle: () => seen.push('settle'),
      onComplete: () => seen.push('complete'),
    });

    director.play(
      {
        before: beforeView,
        after: afterView,
        events: [attemptEvent, infectedEvent, encryptedEvent, overrideEvent],
      },
      { reducedMotion: false },
      0,
    );
    director.tick(10);

    expect(seen).toEqual([
      'analysis',
      'attempt',
      'infected',
      'encrypted',
      'override',
      'settle',
      'complete',
    ]);
  });

  it('starts on the exact before view and releases normal beats progressively', () => {
    const seen: string[] = [];
    let analysisView: PresentationView | null = null;
    const director = createTurnDirector({
      onAnalysis: (presentation) => {
        analysisView = presentation;
        seen.push('analysis');
      },
      onBeat: (event) => seen.push(event.kind),
      onSettle: () => seen.push('settle'),
      onComplete: () => seen.push('complete'),
    });
    const start = 10;

    director.play(
      {
        before: beforeView,
        after: afterView,
        events: [attemptEvent, infectedEvent, encryptedEvent],
      },
      { reducedMotion: false },
      start,
    );

    expect(analysisView).toBe(beforeView);
    expect(seen).toEqual(['analysis']);

    director.tick(start + TURN_DIRECTOR_TIMING.analysisLeadSeconds - 0.001);
    expect(seen).toEqual(['analysis']);

    director.tick(start + TURN_DIRECTOR_TIMING.analysisLeadSeconds);
    expect(seen).toEqual(['analysis', 'attempt']);

    director.tick(
      start +
        TURN_DIRECTOR_TIMING.analysisLeadSeconds +
        TURN_DIRECTOR_TIMING.eventGapSeconds,
    );
    expect(seen).toEqual(['analysis', 'attempt', 'infected']);

    director.tick(
      start +
        TURN_DIRECTOR_TIMING.analysisLeadSeconds +
        TURN_DIRECTOR_TIMING.eventGapSeconds * 2,
    );
    expect(seen).toEqual(['analysis', 'attempt', 'infected', 'encrypted']);

    director.tick(start + TURN_DIRECTOR_TIMING.minDurationSeconds);
    expect(seen).toEqual([
      'analysis',
      'attempt',
      'infected',
      'encrypted',
      'settle',
      'complete',
    ]);
  });

  it('stages public node changes from the after view at their ordered beats', () => {
    const snapshots: Array<{
      kind: ObservableTurnEvent['kind'];
      target: string | null;
      sourceState: string;
      targetState: string;
      lockedState: string;
      overrideIsolated: boolean;
    }> = [];
    const director = createTurnDirector({
      onAnalysis: () => undefined,
      onBeat: (event, _index, stagedView) => {
        snapshots.push({
          kind: event.kind,
          target: event.kind === 'attempt' ? event.target : null,
          sourceState: stagedView.nodes['EDR-A']?.visibleState ?? 'missing',
          targetState: stagedView.nodes['EDR-B']?.visibleState ?? 'missing',
          lockedState: stagedView.nodes.LOCKED?.visibleState ?? 'missing',
          overrideIsolated: stagedView.nodes.OVERRIDE?.isolated ?? true,
        });
      },
      onSettle: () => undefined,
      onComplete: () => undefined,
    });

    director.play(
      {
        before: beforeView,
        after: afterView,
        events: [attemptEvent, infectedEvent, encryptedEvent, overrideEvent],
      },
      { reducedMotion: false },
      5,
    );
    director.tick(20);

    expect(snapshots).toEqual([
      {
        kind: 'attempt',
        target: 'EDR-B',
        sourceState: 'infected',
        targetState: 'clean',
        lockedState: 'clean',
        overrideIsolated: true,
      },
      {
        kind: 'infected',
        target: null,
        sourceState: 'infected',
        targetState: 'infected',
        lockedState: 'clean',
        overrideIsolated: true,
      },
      {
        kind: 'encrypted',
        target: null,
        sourceState: 'infected',
        targetState: 'infected',
        lockedState: 'encrypted',
        overrideIsolated: true,
      },
      {
        kind: 'override',
        target: null,
        sourceState: 'infected',
        targetState: 'infected',
        lockedState: 'encrypted',
        overrideIsolated: false,
      },
    ]);
  });

  it('keeps an empty normal resolution open for the 1.4 second minimum', () => {
    const seen: string[] = [];
    const director = createTurnDirector({
      onAnalysis: () => seen.push('analysis'),
      onBeat: () => seen.push('beat'),
      onSettle: () => seen.push('settle'),
      onComplete: () => seen.push('complete'),
    });

    director.play({ before: beforeView, after: beforeView, events: [] }, { reducedMotion: false }, 2);
    director.tick(3.399);
    expect(seen).toEqual(['analysis']);
    director.tick(3.4);

    expect(seen).toEqual(['analysis', 'settle', 'complete']);
    expect(director.isPlaying()).toBe(false);
  });

  it('caps a crowded normal resolution at 4.5 seconds', () => {
    const events: ObservableTurnEvent[] = Array.from({ length: 30 }, (_, index) => ({
      kind: 'telemetry-gap',
      attempts: index + 1,
    }));
    let completed = 0;
    const director = createTurnDirector({
      onAnalysis: () => undefined,
      onBeat: () => undefined,
      onSettle: () => undefined,
      onComplete: () => completed += 1,
    });

    director.play({ before: beforeView, after: afterView, events }, { reducedMotion: false }, 10);
    director.tick(14.499);
    expect(completed).toBe(0);
    director.tick(14.5);

    expect(completed).toBe(1);
  });

  it('preserves event and state order while reduced motion removes travel delay', () => {
    const seen: string[] = [];
    const states: string[] = [];
    const director = createTurnDirector({
      onAnalysis: () => seen.push('analysis'),
      onBeat: (event, _index, stagedView) => {
        seen.push(event.kind);
        states.push(stagedView.nodes['EDR-B']?.visibleState ?? 'missing');
      },
      onSettle: () => seen.push('settle'),
      onComplete: () => seen.push('complete'),
    });

    director.play(
      { before: beforeView, after: afterView, events: [attemptEvent, infectedEvent] },
      { reducedMotion: true },
      0,
    );

    expect(seen).toEqual(['analysis', 'attempt', 'infected', 'settle', 'complete']);
    expect(states).toEqual(['clean', 'infected']);
    expect(director.isPlaying()).toBe(false);
  });

  it('skip settles the original batch and completes once even after later ticks', () => {
    let completions = 0;
    let settles = 0;
    let settledEvents: readonly ObservableTurnEvent[] = [];
    const originalEvents = [attemptEvent];
    const director = createTurnDirector({
      onAnalysis: () => undefined,
      onBeat: () => undefined,
      onSettle: (_view, events) => {
        settles += 1;
        settledEvents = events;
      },
      onComplete: () => completions += 1,
    });

    director.play(
      { before: beforeView, after: afterView, events: originalEvents },
      { reducedMotion: false },
      0,
    );
    director.skip();
    director.tick(99);
    director.skip();

    expect(completions).toBe(1);
    expect(settles).toBe(1);
    expect(settledEvents).toBe(originalEvents);
  });

  it('interrupt settles once and cannot be duplicated by a visibility tick', () => {
    let completions = 0;
    let settles = 0;
    const director = createTurnDirector({
      onAnalysis: () => undefined,
      onBeat: () => undefined,
      onSettle: () => settles += 1,
      onComplete: () => completions += 1,
    });

    director.play(
      { before: beforeView, after: afterView, events: [attemptEvent] },
      { reducedMotion: false },
      0,
    );
    director.interrupt();
    director.interrupt();
    director.tick(20);

    expect(settles).toBe(1);
    expect(completions).toBe(1);
    expect(director.isPlaying()).toBe(false);
  });

  it('rejects a restart while active and accepts a later resolution after settle', () => {
    const director = createTurnDirector({
      onAnalysis: () => undefined,
      onBeat: () => undefined,
      onSettle: () => undefined,
      onComplete: () => undefined,
    });
    const resolution = { before: beforeView, after: afterView, events: [attemptEvent] };

    director.play(resolution, { reducedMotion: false }, 0);
    expect(() => director.play(resolution, { reducedMotion: false }, 0.1)).toThrow(
      'Turn resolution is already playing',
    );
    director.skip();

    expect(() => director.play(resolution, { reducedMotion: false }, 1)).not.toThrow();
  });

  it('marks itself final before callbacks can try to complete it again', () => {
    let settles = 0;
    let completions = 0;
    const director = createTurnDirector({
      onAnalysis: () => undefined,
      onBeat: () => undefined,
      onSettle: () => {
        settles += 1;
        director.skip();
      },
      onComplete: () => {
        completions += 1;
        director.interrupt();
      },
    });

    director.play(
      { before: beforeView, after: afterView, events: [attemptEvent] },
      { reducedMotion: false },
      0,
    );
    director.skip();

    expect(settles).toBe(1);
    expect(completions).toBe(1);
  });
});
