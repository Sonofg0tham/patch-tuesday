import { describe, expect, it } from 'vitest';
import { createHandover, planHandover, type HandoverModel } from './handover';

const handover: HandoverModel = {
  estate: 'MERIDIAN MUTUAL // HQ ESTATE',
  alert: 'Ransomware indicators confirmed across the HQ estate.',
  priorities: ['Establish trustworthy visibility.', 'Protect critical services.'],
  monitoredPercent: 58,
  apPerHour: 2,
  backupCredits: 3,
  lossConditions: ['Domain Controller encryption', '60% estate encryption'],
};

const completeCopy = [
  '03:12 // INCIDENT HANDOVER',
  'MERIDIAN MUTUAL // HQ ESTATE',
  'ALERT: Ransomware indicators confirmed across the HQ estate.',
  'MONITORED ESTATE: 58%',
  'CAPACITY: 2 AP PER HOUR',
  'RECOVERY: 3 BACKUP CREDITS',
  'LOSS CONDITION: Domain Controller encryption',
  'LOSS CONDITION: 60% estate encryption',
  'PRIORITY 1: Establish trustworthy visibility.',
  'PRIORITY 2: Protect critical services.',
];

describe('incident handover plan', () => {
  it('presents every line immediately under reduced motion without scheduling steps', () => {
    const plan = planHandover(handover, { reducedMotion: true });

    expect(plan.immediateLines).toEqual(completeCopy);
    expect(plan.stagedSteps).toEqual([]);
    expect(plan.requestsCamera).toBe(false);
  });

  it('stages the complete copy in order during normal motion', () => {
    const plan = planHandover(handover, { reducedMotion: false });

    expect(plan.immediateLines).toEqual([]);
    expect(plan.stagedSteps.map((step) => step.line)).toEqual(completeCopy);
    expect(plan.stagedSteps.map((step) => step.delayMs)).toEqual([
      0, 180, 360, 540, 720, 900, 1080, 1260, 1440, 1620,
    ]);
    expect(plan.requestsCamera).toBe(true);
  });
});

describe('incident handover modal boundary', () => {
  it('contains forward and reverse Tab and blocks Escape while visible', () => {
    const dom = installFakeDom();
    try {
      const background = dom.document.createElement('button');
      const container = dom.document.createElement('div');
      dom.document.body.append(background, container);
      background.focus();

      const view = createHandover(container as unknown as HTMLElement, {
        onAccept() {},
        onComplete() {},
      });
      view.show(handover, { reducedMotion: false });
      const accept = container.querySelectorAll('button')[0];

      expect(dom.document.activeElement).toBe(accept);
      const forward = dom.window.keydown('Tab');
      expect(forward.defaultPrevented).toBe(true);
      expect(dom.document.activeElement).toBe(accept);

      const reverse = dom.window.keydown('Tab', true);
      expect(reverse.defaultPrevented).toBe(true);
      expect(dom.document.activeElement).toBe(accept);

      const escape = dom.window.keydown('Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(container.hidden).toBe(false);
    } finally {
      dom.restore();
    }
  });

  it('makes background controls inert and restores inert state and focus on dismiss', () => {
    const dom = installFakeDom();
    try {
      const previous = dom.document.createElement('button');
      const alreadyInert = dom.document.createElement('section');
      alreadyInert.inert = true;
      const container = dom.document.createElement('div');
      dom.document.body.append(previous, alreadyInert, container);
      previous.focus();

      const view = createHandover(container as unknown as HTMLElement, {
        onAccept() {},
        onComplete() {},
      });
      view.show(handover, { reducedMotion: false });

      expect(previous.inert).toBe(true);
      expect(alreadyInert.inert).toBe(true);

      view.dismiss();

      expect(previous.inert).toBe(false);
      expect(alreadyInert.inert).toBe(true);
      expect(dom.document.activeElement).toBe(previous);
    } finally {
      dom.restore();
    }
  });
});

type FakeListener = (event: FakeKeyboardEvent | { type: string }) => void;

class FakeKeyboardEvent {
  readonly type = 'keydown';
  defaultPrevented = false;
  immediatePropagationStopped = false;

  constructor(
    readonly key: string,
    readonly shiftKey = false,
  ) {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopImmediatePropagation(): void {
    this.immediatePropagationStopped = true;
  }
}

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void {
    this.values.add(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, FakeListener[]>();
  parentElement: FakeElement | null = null;
  hidden = false;
  inert = false;
  disabled = false;
  isConnected = true;
  className = '';
  id = '';
  textContent = '';
  type = '';

  constructor(
    readonly tagName: string,
    private readonly ownerDocument: FakeDocument,
  ) {}

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  appendChild(child: FakeElement): FakeElement {
    this.append(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.append(...children);
  }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  querySelectorAll(_selector: string): FakeElement[] {
    const descendants: FakeElement[] = [];
    const visit = (element: FakeElement): void => {
      for (const child of element.children) {
        if (child.tagName === 'BUTTON' && !child.disabled && !child.hidden) descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    return descendants;
  }
}

class FakeDocument {
  readonly body = new FakeElement('BODY', this);
  activeElement: FakeElement | null = this.body;

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toUpperCase(), this);
  }
}

class FakeWindow {
  private readonly listeners = new Map<string, FakeListener[]>();

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  keydown(key: string, shiftKey = false): FakeKeyboardEvent {
    const event = new FakeKeyboardEvent(key, shiftKey);
    for (const listener of this.listeners.get('keydown') ?? []) {
      listener(event);
      if (event.immediatePropagationStopped) break;
    }
    return event;
  }
}

function installFakeDom(): {
  document: FakeDocument;
  window: FakeWindow;
  restore(): void;
} {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const document = new FakeDocument();
  const window = new FakeWindow();

  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeElement });

  return {
    document,
    window,
    restore() {
      restoreGlobal('document', previousDocument);
      restoreGlobal('window', previousWindow);
      restoreGlobal('HTMLElement', previousHTMLElement);
    },
  };
}

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}
