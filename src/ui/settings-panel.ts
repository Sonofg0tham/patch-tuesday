// The settings panel (Phase 6): a war-room-styled overlay that moves the config
// knobs the game already has and remembers the choice. Reused by the runbook
// menu and the mid-run pause menu. Every change persists immediately and applies
// live where it can; the visibility floor is baked into the 3D scene at boot, so
// it is labelled as taking effect on the next incident.

import {
  loadSettings,
  saveSettings,
  type MotionLevel,
  type RenderQuality,
  type Settings,
} from '../data/settings';

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

const QUALITY_LABELS: Record<RenderQuality, string> = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
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

    // A segmented radio group. Shared by motion level and render quality.
    const segment = <T extends string>(
      label: string,
      values: readonly T[],
      labels: Record<T, string>,
      current: T,
      note: string,
      read: (value: T) => Partial<Settings>,
    ): void => {
      const row = document.createElement('div');
      row.className = 'settings-row';
      const name = document.createElement('div');
      name.className = 'settings-label';
      name.textContent = label;
      const seg = document.createElement('div');
      seg.className = 'settings-segment';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', label);
      let selected: T = current;
      const buttons = new Map<T, HTMLButtonElement>();
      for (const value of values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-seg-button';
        button.textContent = labels[value];
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', String(value === selected));
        button.addEventListener('click', () => {
          selected = value;
          for (const [v, b] of buttons) b.setAttribute('aria-checked', String(v === value));
          commit();
        });
        buttons.set(value, button);
        seg.append(button);
      }
      controls.push({ read: () => read(selected) });
      row.append(name, seg);
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
    slider('Score volume', Math.round(s.musicVolume * 100), 0, 100, '', (raw) => ({
      musicVolume: raw / 100,
    }));
    slider('Effects volume', Math.round(s.sfxVolume * 100), 0, 100, '', (raw) => ({
      sfxVolume: raw / 100,
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

    segment(
      'Motion level',
      ['full', 'calm', 'reduced'] as const,
      MOTION_LABELS,
      s.motionLevel,
      'Reduced turns off shake, grain, drift and travelling pulses. State cues stay.',
      (motionLevel) => ({ motionLevel }),
    );

    segment(
      'Render quality',
      ['auto', 'low', 'medium', 'high'] as const,
      QUALITY_LABELS,
      s.renderQuality,
      'Bloom and the film grade. Auto starts high and steps down if frames drop. Applies on the next incident.',
      (renderQuality) => ({ renderQuality }),
    );

    // A labelled on/off toggle.
    const toggle = (
      label: string,
      id: string,
      value: boolean,
      note: string,
      read: (checked: boolean) => Partial<Settings>,
    ): void => {
      const row = document.createElement('div');
      row.className = 'settings-row settings-toggle-row';
      const name = document.createElement('label');
      name.className = 'settings-label';
      name.textContent = label;
      name.htmlFor = id;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = id;
      box.className = 'settings-checkbox';
      box.checked = value;
      box.addEventListener('change', commit);
      controls.push({ read: () => read(box.checked) });
      row.append(name, box);
      panel.append(row);
      if (note) {
        const n = document.createElement('div');
        n.className = 'settings-note';
        n.textContent = note;
        panel.append(n);
      }
    };

    toggle(
      'Threat forecast',
      'set-threat-forecast',
      s.threatForecast,
      'Rings the nodes the worm could reach next turn, from what you can see. Blind wherever your EDR is. Toggle in a run with F.',
      (threatForecast) => ({ threatForecast }),
    );

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
