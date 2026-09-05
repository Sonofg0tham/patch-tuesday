// Pure, fake-clock-friendly scheduling for one observable incident hour.
// The director knows presentation state and fog-safe events only. Rendering,
// audio and DOM updates stay behind injected sinks in main.ts.

import type {
  ObservableTurnEvent,
  PresentationView,
} from '../sim/telemetry';

export interface TurnResolutionView {
  before: PresentationView;
  after: PresentationView;
  events: readonly ObservableTurnEvent[];
}

export interface TurnDirectorOptions {
  onAnalysis(view: PresentationView): void;
  onBeat(event: ObservableTurnEvent, index: number, view: PresentationView): void;
  onSettle(view: PresentationView, events: readonly ObservableTurnEvent[]): void;
  onComplete(): void;
}

export interface TurnDirector {
  play(
    resolution: TurnResolutionView,
    options: { reducedMotion: boolean },
    nowSeconds: number,
  ): void;
  tick(nowSeconds: number): void;
  skip(): void;
  interrupt(): void;
  isPlaying(): boolean;
}

interface ActiveResolution {
  resolution: TurnResolutionView;
  staged: PresentationView;
  eventTimes: readonly number[];
  finishTime: number;
  nextEvent: number;
}

export const TURN_DIRECTOR_TIMING = {
  minDurationSeconds: 1.4,
  maxDurationSeconds: 4.5,
  analysisLeadSeconds: 0.25,
  settleTailSeconds: 0.25,
  eventGapSeconds: 0.36,
} as const;

export function createTurnDirector(options: TurnDirectorOptions): TurnDirector {
  let active: ActiveResolution | null = null;

  function finalise(): void {
    const finishing = active;
    if (finishing === null) return;

    // Clear first so skip, interrupt or play calls made by a sink cannot
    // finalise this same resolution twice.
    active = null;
    try {
      options.onSettle(finishing.resolution.after, finishing.resolution.events);
    } finally {
      options.onComplete();
    }
  }

  function deliverBeat(session: ActiveResolution, index: number): void {
    const event = session.resolution.events[index];
    if (!event) return;
    applyPublicLanding(session.staged, session.resolution.after, event);
    options.onBeat(event, index, session.staged);
  }

  function play(
    resolution: TurnResolutionView,
    playOptions: { reducedMotion: boolean },
    nowSeconds: number,
  ): void {
    if (active !== null) throw new Error('Turn resolution is already playing');

    const staged = cloneView(resolution.before);
    const duration = playOptions.reducedMotion
      ? 0
      : clamp(
          TURN_DIRECTOR_TIMING.analysisLeadSeconds +
            Math.max(0, resolution.events.length - 1) *
              TURN_DIRECTOR_TIMING.eventGapSeconds +
            TURN_DIRECTOR_TIMING.settleTailSeconds,
          TURN_DIRECTOR_TIMING.minDurationSeconds,
          TURN_DIRECTOR_TIMING.maxDurationSeconds,
        );
    const eventTimes = scheduleEvents(nowSeconds, duration, resolution.events.length);
    const session: ActiveResolution = {
      resolution,
      staged,
      eventTimes,
      finishTime: nowSeconds + duration,
      nextEvent: 0,
    };
    active = session;
    options.onAnalysis(resolution.before);

    if (playOptions.reducedMotion) {
      while (active === session && session.nextEvent < resolution.events.length) {
        deliverBeat(session, session.nextEvent);
        session.nextEvent += 1;
      }
      if (active === session) finalise();
    }
  }

  function tick(nowSeconds: number): void {
    const session = active;
    if (session === null) return;

    while (
      active === session &&
      session.nextEvent < session.eventTimes.length &&
      nowSeconds >= (session.eventTimes[session.nextEvent] ?? Number.POSITIVE_INFINITY)
    ) {
      deliverBeat(session, session.nextEvent);
      session.nextEvent += 1;
    }

    if (active === session && nowSeconds >= session.finishTime) finalise();
  }

  return {
    play,
    tick,
    skip: finalise,
    interrupt: finalise,
    isPlaying() {
      return active !== null;
    },
  };
}

function scheduleEvents(start: number, duration: number, eventCount: number): number[] {
  if (eventCount === 0) return [];
  if (duration === 0) return Array.from({ length: eventCount }, () => start);

  const first = start + Math.min(TURN_DIRECTOR_TIMING.analysisLeadSeconds, duration / 2);
  const last = Math.max(first, start + duration - TURN_DIRECTOR_TIMING.settleTailSeconds);
  if (eventCount === 1) return [first];
  const interval = Math.min(
    TURN_DIRECTOR_TIMING.eventGapSeconds,
    (last - first) / (eventCount - 1),
  );
  return Array.from({ length: eventCount }, (_, index) => first + interval * index);
}

function applyPublicLanding(
  staged: PresentationView,
  after: PresentationView,
  event: ObservableTurnEvent,
): void {
  if (event.kind !== 'infected' && event.kind !== 'encrypted' && event.kind !== 'override') return;
  const node = after.nodes[event.node];
  if (node !== undefined) staged.nodes[event.node] = { ...node };
}

function cloneView(view: PresentationView): PresentationView {
  return {
    nodes: Object.fromEntries(
      Object.entries(view.nodes).map(([id, node]) => [id, { ...node }]),
    ),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
