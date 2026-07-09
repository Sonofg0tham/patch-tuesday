// The settings panel (Phase 6): a war-room-styled overlay that moves the config
// knobs the game already has and remembers the choice. Reused by the runbook
// menu and the mid-run pause menu. Every change persists immediately and applies
// live where it can; the visibility floor is baked into the 3D scene at boot, so
// it is labelled as taking effect on the next incident.

import { loadSettings, saveSettings, type MotionLevel, type Settings } from '../data/settings';

export interface SettingsPanel {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

interface Options {
  /** Called after every change with the new settings, for live side effects. */
  onChange: (settings: Settings) => void;
  /** Called when the panel is dismissed. */
  onClose: () => void;
}

const MOTION_LABELS: Record<MotionLevel, string> = {
  full: 'Full',
  calm: 'Calm',
  reduced: 'Reduced',
};

export function createSettingsPanel(container: HTMLElement, options: Options): SettingsPanel {
  let open = false;

  function build(): void {
    const s = loadSettings();

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Settings');

    const title = document.createElement('div');
    title.className = 'settings-title';
    title.textContent = 'SETTINGS';
    panel.append(title);

    // Commits the current control values, persists, and fires the live hook.
    const controls: { read: () => Partial<Settings> }[] = [];
    const commit = (): void => {
      const next: Settings = { ...loadSettings() };
      for (const c of controls) Object.assign(next, c.read());
      saveSettings(next);
      options.onChange(next);
    };

    // A labelled 0..100 slider that maps to a real range.
    const slider = (
      label: string,
      value: number,
      lo: number,
      hi: number,
      note: string,
      read: (raw: number) => Partial<Settings>,
    ): void => {
      const row = document.createElement('div');
      row.className = 'settings-row';
      const head = document.createElement('div');
      head.className = 'settings-row-head';
      const name = document.createElement('label');
      name.className = 'settings-label';
      name.textContent = label;
      const readout = document.createElement('span');
      readout.className = 'settings-readout';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      const pct = Math.round(((value - lo) / (hi - lo)) * 100);
      input.value = String(pct);
      name.htmlFor = `set-${label.replace(/\s+/g, '-')}`;
      input.id = name.htmlFor;
      const toReal = (raw: number): number => lo + (raw / 100) * (hi - lo);
      readout.textContent = `${Math.round(toReal(Number(input.value)))}${note ? '' : ''}`;
      const updateReadout = (): void => {
        readout.textContent = String(Math.round(toReal(Number(input.value))));
      };
      updateReadout();
      input.addEventListener('input', () => {
        updateReadout();
        commit();
      });
      controls.push({ read: () => read(toReal(Number(input.value))) });
      head.append(name, readout);
      row.append(head, input);
      if (note) {
        const n = document.createElement('div');
        n.className = 'settings-note';
        n.textContent = note;
        row.append(n);
      }
      panel.append(row);
    };

    slider('Master volume', Math.round(s.masterVolume * 100), 0, 100, '', (raw) => ({
      masterVolume: raw / 100,
    }));
    slider('HUD text scale', Math.round(s.textScale * 100), 80, 150, '', (raw) => ({
      textScale: raw / 100,
    }));
    slider('Screen shake', Math.round((s.shakeIntensity / 0.4) * 100), 0, 100, '', (raw) => ({
      shakeIntensity: (raw / 100) * 0.4,
    }));
    slider(
      'Visibility floor',
      Math.round(s.visibilityFloor * 100),
      0,
      100,
      'Applies on the next incident.',
      (raw) => ({ visibilityFloor: raw / 100 }),
    );

    // Motion level: a segmented set of radio buttons.
    const motionRow = document.createElement('div');
    motionRow.className = 'settings-row';
    const motionLabel = document.createElement('div');
    motionLabel.className = 'settings-label';
    motionLabel.textContent = 'Motion level';
    const seg = document.createElement('div');
    seg.className = 'settings-segment';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Motion level');
    let motionValue: MotionLevel = s.motionLevel;
    const segButtons = new Map<MotionLevel, HTMLButtonElement>();
    for (const level of ['full', 'calm', 'reduced'] as MotionLevel[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'settings-seg-button';
      b.textContent = MOTION_LABELS[level];
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(level === motionValue));
      b.addEventListener('click', () => {
        motionValue = level;
        for (const [lv, btn] of segButtons) btn.setAttribute('aria-checked', String(lv === level));
        commit();
      });
      segButtons.set(level, b);
      seg.append(b);
    }
    controls.push({ read: () => ({ motionLevel: motionValue }) });
    motionRow.append(motionLabel, seg);
    const motionNote = document.createElement('div');
    motionNote.className = 'settings-note';
    motionNote.textContent = 'Reduced turns off shake and eases the pulse. State cues stay.';
    motionRow.append(motionNote);
    panel.append(motionRow);

    // High contrast: a labelled toggle.
    const hcRow = document.createElement('div');
    hcRow.className = 'settings-row settings-toggle-row';
    const hcLabel = document.createElement('label');
    hcLabel.className = 'settings-label';
    hcLabel.textContent = 'High contrast';
    hcLabel.htmlFor = 'set-high-contrast';
    const hc = document.createElement('input');
    hc.type = 'checkbox';
    hc.id = 'set-high-contrast';
    hc.className = 'settings-checkbox';
    hc.checked = s.highContrast;
    hc.addEventListener('change', commit);
    controls.push({ read: () => ({ highContrast: hc.checked }) });
    hcRow.append(hcLabel, hc);
    panel.append(hcRow);

    // Done.
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'settings-done';
    done.textContent = '[ DONE ]';
    done.addEventListener('click', () => api.close());
    panel.append(done);

    container.replaceChildren(panel);
    done.focus();
  }

  const api: SettingsPanel = {
    open() {
      open = true;
      build();
      container.hidden = false;
    },
    close() {
      open = false;
      container.hidden = true;
      container.replaceChildren();
      options.onClose();
    },
    isOpen() {
      return open;
    },
  };
  return api;
}
