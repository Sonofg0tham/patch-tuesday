// Same-document incident handover. The first focused control accepts command,
// which lets the app unlock audio and play the pager inside the same gesture.

export interface HandoverModel {
  estate: string;
  alert: string;
  priorities: readonly [string, string];
  monitoredPercent: number;
  apPerHour: number;
  backupCredits: number;
  lossConditions: readonly [string, string];
}

export interface HandoverStep {
  line: string;
  delayMs: number;
}

export interface HandoverPlan {
  immediateLines: readonly string[];
  stagedSteps: readonly HandoverStep[];
  requestsCamera: boolean;
}

export interface HandoverCallbacks {
  onAccept(): void;
  onComplete(): void;
  onCameraRequest?(step: number): void;
}

export interface Handover {
  show(model: HandoverModel, options: { reducedMotion: boolean }): void;
  dismiss(): void;
}

const STEP_MS = 180;

export function planHandover(
  model: HandoverModel,
  options: { reducedMotion: boolean },
): HandoverPlan {
  const lines = handoverLines(model);
  if (options.reducedMotion) {
    return { immediateLines: lines, stagedSteps: [], requestsCamera: false };
  }
  return {
    immediateLines: [],
    stagedSteps: lines.map((line, index) => ({ line, delayMs: index * STEP_MS })),
    requestsCamera: true,
  };
}

export function createHandover(
  container: HTMLElement,
  callbacks: HandoverCallbacks,
): Handover {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let visible = false;
  let restoreFocus: HTMLElement | null = null;
  const backgroundInert = new Map<HTMLElement, boolean>();

  const containModalFocus = (event: KeyboardEvent): void => {
    if (!visible) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key !== 'Tab') return;

    const controls = focusableControls(container);
    if (controls.length === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
    const target = event.shiftKey
      ? activeIndex <= 0
        ? controls.at(-1)
        : null
      : activeIndex === -1 || activeIndex === controls.length - 1
        ? controls[0]
        : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    target.focus();
  };

  function clearTimers(): void {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  function dismiss(): void {
    const wasVisible = visible;
    clearTimers();
    visible = false;
    container.hidden = true;
    container.classList.remove('handover-active');
    container.replaceChildren();
    window.removeEventListener('keydown', containModalFocus, true);
    if (wasVisible) restoreBackground();
  }

  function show(model: HandoverModel, options: { reducedMotion: boolean }): void {
    dismiss();
    isolateBackground();
    visible = true;
    container.hidden = false;
    container.classList.add('handover-active');
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-labelledby', 'handover-title');
    window.addEventListener('keydown', containModalFocus, true);

    const panel = document.createElement('section');
    panel.className = 'handover-panel';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'handover-eyebrow';
    eyebrow.textContent = 'INCOMING INCIDENT // PRIORITY ONE';
    const title = document.createElement('h1');
    title.id = 'handover-title';
    title.className = 'handover-title';
    title.textContent = 'Command transfer required';
    const summary = document.createElement('p');
    summary.className = 'handover-summary';
    summary.textContent = `${model.estate}. Accept the SOC handover before issuing commands.`;
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'handover-accept';
    accept.textContent = 'Accept handover';
    panel.append(eyebrow, title, summary, accept);
    container.replaceChildren(panel);

    accept.addEventListener('click', () => {
      try {
        callbacks.onAccept();
      } catch {
        // Audio or device failure cannot block the operational briefing.
      }
      beginPresentation(panel, model, options);
    });
    accept.focus();
  }

  function isolateBackground(): void {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backgroundInert.clear();
    const parent = container.parentElement;
    if (!parent) return;
    for (const sibling of parent.children) {
      if (sibling === container || !(sibling instanceof HTMLElement)) continue;
      backgroundInert.set(sibling, sibling.inert);
      sibling.inert = true;
    }
  }

  function restoreBackground(): void {
    for (const [element, wasInert] of backgroundInert) element.inert = wasInert;
    backgroundInert.clear();
    const previous = restoreFocus;
    restoreFocus = null;
    if (previous?.isConnected && !previous.inert) previous.focus();
  }

  function beginPresentation(
    panel: HTMLElement,
    model: HandoverModel,
    options: { reducedMotion: boolean },
  ): void {
    const plan = planHandover(model, options);
    const list = document.createElement('ol');
    list.className = 'handover-lines';
    list.setAttribute('aria-live', 'polite');
    list.setAttribute('aria-relevant', 'additions');
    const proceed = document.createElement('button');
    proceed.type = 'button';
    proceed.className = 'handover-skip';
    proceed.textContent = plan.stagedSteps.length > 0 ? 'Skip briefing' : 'Begin response';
    panel.replaceChildren(list, proceed);

    const allLines = handoverLines(model);
    let shown = 0;
    let complete = plan.stagedSteps.length === 0;
    const append = (line: string): void => {
      const item = document.createElement('li');
      item.textContent = line;
      item.setAttribute('aria-atomic', 'true');
      list.appendChild(item);
      shown += 1;
    };
    const completeStaging = (): void => {
      clearTimers();
      while (shown < allLines.length) append(allLines[shown]);
      complete = true;
      proceed.textContent = 'Begin response';
      proceed.focus();
    };

    for (const line of plan.immediateLines) append(line);
    for (const [index, step] of plan.stagedSteps.entries()) {
      timers.push(
        setTimeout(() => {
          append(step.line);
          if (plan.requestsCamera) callbacks.onCameraRequest?.(index);
          if (shown === allLines.length) completeStaging();
        }, step.delayMs),
      );
    }

    proceed.addEventListener('click', () => {
      if (!complete) {
        completeStaging();
        return;
      }
      dismiss();
      callbacks.onComplete();
    });
    proceed.focus();
  }

  return { show, dismiss };
}

function focusableControls(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hidden);
}

function handoverLines(model: HandoverModel): string[] {
  return [
    '03:12 // INCIDENT HANDOVER',
    model.estate,
    `ALERT: ${model.alert}`,
    `MONITORED ESTATE: ${Math.round(model.monitoredPercent)}%`,
    `CAPACITY: ${model.apPerHour} AP PER HOUR`,
    `RECOVERY: ${model.backupCredits} BACKUP CREDITS`,
    `LOSS CONDITION: ${model.lossConditions[0]}`,
    `LOSS CONDITION: ${model.lossConditions[1]}`,
    `PRIORITY 1: ${model.priorities[0]}`,
    `PRIORITY 2: ${model.priorities[1]}`,
  ];
}
