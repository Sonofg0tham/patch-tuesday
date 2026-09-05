// A non-positional DOM sink for the analysis lead. All visible treatment is
// procedural CSS on the reserved stage, so no node or route data enters it.

export interface ResolutionStage {
  showAnalysis(options: { reducedMotion: boolean; durationMs: number }): void;
  clear(): void;
  isActive(): boolean;
}

export function createResolutionStage(container: HTMLElement): ResolutionStage {
  let active = false;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  function hide(): void {
    active = false;
    container.hidden = true;
    delete container.dataset.state;
    delete container.dataset.motion;
    container.style.removeProperty('--resolution-analysis-duration');
    container.textContent = '';
  }

  function clear(): void {
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    hide();
  }

  function showAnalysis(options: { reducedMotion: boolean; durationMs: number }): void {
    clear();
    active = true;
    container.hidden = false;
    container.dataset.state = 'analysis';
    container.dataset.motion = options.reducedMotion ? 'static' : 'sweep';
    container.style.setProperty(
      '--resolution-analysis-duration',
      `${options.durationMs}ms`,
    );
    clearTimer = setTimeout(() => {
      clearTimer = null;
      hide();
    }, options.durationMs);
  }

  clear();
  return {
    showAnalysis,
    clear,
    isActive: () => active,
  };
}
