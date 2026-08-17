import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHud } from './hud';

interface FakeElement {
  textContent: string;
  dataset: Record<string, string>;
  style: { width: string };
  classList: { toggle(name: string, force?: boolean): void; contains(name: string): boolean };
}

function fakeElement(): FakeElement {
  const classes = new Set<string>();
  return {
    textContent: '',
    dataset: {},
    style: { width: '' },
    classList: {
      toggle(name, force) {
        if (force === false) classes.delete(name);
        else classes.add(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };
}

describe('HUD notices', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes a semantic tone so neutral analysis cannot inherit threat magenta', () => {
    const elements = new Map(
      ['hud-clock', 'hud-pressure', 'pressure-fill', 'pressure-label-text', 'hud-notice'].map(
        (id) => [id, fakeElement()] as const,
      ),
    );
    vi.stubGlobal('document', {
      getElementById: (id: string) => elements.get(id) ?? null,
    });
    const hud = createHud();

    hud.setNotice('Forensic telemetry sweep in progress', 'defence');

    const notice = elements.get('hud-notice');
    expect(notice?.textContent).toBe('Forensic telemetry sweep in progress');
    expect(notice?.dataset.tone).toBe('defence');
    expect(notice?.classList.contains('active')).toBe(true);
  });
});
