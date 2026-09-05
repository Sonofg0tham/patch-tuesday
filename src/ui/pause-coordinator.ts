// Coordinates Pause with synchronous resolution settlement. Runtime details
// stay behind ports so the ordering can be tested without importing main.ts.

export interface IncidentPauseCoordinator {
  requestPause(): void;
  resume(): void;
  abandon(): void;
}

interface IncidentPausePorts {
  isResolutionLocked(): boolean;
  isEnded(): boolean;
  canResumeInputs(): boolean;
  setPaused(paused: boolean): void;
  setInputsEnabled(enabled: boolean): void;
  interruptResolution(): void;
  openPause(): void;
  closePause(): void;
  endAbandonedRun(): void;
  focusPrimary(): void;
}

export function createIncidentPauseCoordinator(
  ports: IncidentPausePorts,
): IncidentPauseCoordinator {
  return {
    requestPause() {
      // Pause first so a synchronous director completion cannot release input
      // or move focus before the dialog opens.
      ports.setPaused(true);
      ports.setInputsEnabled(false);
      if (ports.isResolutionLocked()) ports.interruptResolution();

      // Settlement may have opened the terminal PIR. In that case Pause must
      // not cover it and there is no longer an incident to mark as paused.
      if (ports.isEnded()) {
        ports.setPaused(false);
        return;
      }
      ports.openPause();
    },
    resume() {
      ports.setPaused(false);
      if (!ports.canResumeInputs()) return;
      ports.setInputsEnabled(true);
      ports.focusPrimary();
    },
    abandon() {
      // File the settled run before closing Pause. closePause invokes resume,
      // whose ended guard prevents a transient input or focus release.
      ports.endAbandonedRun();
      ports.closePause();
    },
  };
}
