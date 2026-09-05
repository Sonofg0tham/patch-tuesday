import { describe, expect, it } from 'vitest';
import { createTurnDirector } from '../render/turn-director';
import type { PresentationView } from '../sim/telemetry';
import {
  createIncidentPauseCoordinator,
  type IncidentPauseCoordinator,
} from './pause-coordinator';

const emptyView: PresentationView = { nodes: {} };

interface Harness {
  coordinator: IncidentPauseCoordinator;
  director: ReturnType<typeof createTurnDirector>;
  state: {
    turn: number;
    timeline: number;
    settles: number;
    completions: number;
    paused: boolean;
    pauseOpen: boolean;
    ended: boolean;
    pirTurn: number | null;
    inputTransitions: boolean[];
    focusRequests: number;
  };
}

function createHarness(options: { terminalOnSettle?: boolean } = {}): Harness {
  const state = {
    turn: 1,
    timeline: 0,
    settles: 0,
    completions: 0,
    paused: false,
    pauseOpen: false,
    ended: false,
    pirTurn: null as number | null,
    inputTransitions: [] as boolean[],
    focusRequests: 0,
  };

  const director = createTurnDirector({
    onAnalysis: () => undefined,
    onBeat: () => undefined,
    onSettle: () => {
      state.turn = 2;
      state.timeline += 1;
      state.settles += 1;
      if (options.terminalOnSettle) {
        state.ended = true;
        state.pirTurn = state.turn;
      }
    },
    onComplete: () => {
      state.completions += 1;
      if (!state.paused && !state.ended) state.inputTransitions.push(true);
    },
  });

  const coordinator: IncidentPauseCoordinator = createIncidentPauseCoordinator({
    isResolutionLocked: () => director.isPlaying(),
    isEnded: () => state.ended,
    canResumeInputs: () => !state.ended && !director.isPlaying(),
    setPaused: (paused) => {
      state.paused = paused;
    },
    setInputsEnabled: (enabled) => state.inputTransitions.push(enabled),
    interruptResolution: () => director.interrupt(),
    openPause: () => {
      state.pauseOpen = true;
    },
    closePause: () => {
      state.pauseOpen = false;
      coordinator.resume();
    },
    endAbandonedRun: () => {
      state.ended = true;
      state.pirTurn = state.turn;
    },
    focusPrimary: () => {
      state.focusRequests += 1;
    },
  });

  return { coordinator, director, state };
}

function startHour(harness: Harness): void {
  harness.director.play(
    { before: emptyView, after: emptyView, events: [] },
    { reducedMotion: false },
    0,
  );
}

describe('incident pause coordinator', () => {
  it('settles a locked hour once before opening Pause without releasing input', () => {
    const harness = createHarness();
    startHour(harness);

    harness.coordinator.requestPause();

    expect(harness.state).toMatchObject({
      turn: 2,
      timeline: 1,
      settles: 1,
      completions: 1,
      paused: true,
      pauseOpen: true,
      inputTransitions: [false],
      focusRequests: 0,
    });

    harness.director.tick(99);
    expect(harness.state.turn).toBe(2);
    expect(harness.state.timeline).toBe(1);
    expect(harness.state.settles).toBe(1);

    harness.coordinator.resume();
    expect(harness.state.paused).toBe(false);
    expect(harness.state.inputTransitions).toEqual([false, true]);
    expect(harness.state.focusRequests).toBe(1);
  });

  it('does not open Pause when interrupting the hour ends the run', () => {
    const harness = createHarness({ terminalOnSettle: true });
    startHour(harness);

    harness.coordinator.requestPause();

    expect(harness.state).toMatchObject({
      turn: 2,
      timeline: 1,
      settles: 1,
      completions: 1,
      paused: false,
      pauseOpen: false,
      ended: true,
      pirTurn: 2,
      inputTransitions: [false],
      focusRequests: 0,
    });
  });

  it('files Abandon from the settled turn before closing Pause', () => {
    const harness = createHarness();
    startHour(harness);
    harness.coordinator.requestPause();

    harness.coordinator.abandon();
    harness.director.tick(99);

    expect(harness.state).toMatchObject({
      turn: 2,
      timeline: 1,
      settles: 1,
      completions: 1,
      paused: false,
      pauseOpen: false,
      ended: true,
      pirTurn: 2,
      inputTransitions: [false],
      focusRequests: 0,
    });
  });
});
