import { describe, expect, it } from 'vitest';
import { commandForIncidentHotkey, deriveIncidentControls } from './incident-controls';

describe('incident control model', () => {
  it('shows only End Hour while active compromise is visible', () => {
    expect(deriveIncidentControls({ phase: 'active' }, false, false)).toEqual([
      { command: 'end-hour', label: 'End Hour', disabled: false, primary: true },
    ]);
  });

  it('enables containment declaration when the visible estate is clear', () => {
    expect(deriveIncidentControls({ phase: 'active' }, true, false)).toEqual([
      { command: 'end-hour', label: 'End Hour', disabled: false, primary: true },
      {
        command: 'declare-containment',
        label: 'Declare Containment',
        disabled: false,
        primary: false,
      },
    ]);
  });

  it('offers the recovery hour and File Review during recovery', () => {
    expect(deriveIncidentControls({ phase: 'recovery' }, false, false)).toEqual([
      {
        command: 'advance-recovery',
        label: 'Advance Recovery Hour',
        disabled: false,
        primary: true,
      },
      { command: 'file-review', label: 'File Review', disabled: false, primary: false },
    ]);
  });

  it('disables phase commands and exposes Skip while resolving', () => {
    expect(deriveIncidentControls({ phase: 'active' }, true, true)).toEqual([
      { command: 'end-hour', label: 'RESOLVING', disabled: true, primary: true },
      {
        command: 'declare-containment',
        label: 'Declare Containment',
        disabled: true,
        primary: false,
      },
      { command: 'skip', label: 'Skip Resolution', disabled: false, primary: false },
    ]);
  });

  it('reserves lifecycle hotkeys only when their command is available', () => {
    expect(commandForIncidentHotkey('Enter', { phase: 'active' }, false, false)).toBe(
      'end-hour',
    );
    expect(commandForIncidentHotkey('c', { phase: 'active' }, true, false)).toBe(
      'declare-containment',
    );
    expect(commandForIncidentHotkey('c', { phase: 'active' }, false, false)).toBeNull();
    expect(commandForIncidentHotkey('f', { phase: 'active' }, true, false)).toBeNull();
    expect(commandForIncidentHotkey('f', { phase: 'recovery' }, false, false)).toBe(
      'file-review',
    );
    expect(commandForIncidentHotkey('Enter', { phase: 'recovery' }, false, false)).toBe(
      'advance-recovery',
    );
    expect(commandForIncidentHotkey('Enter', { phase: 'active' }, true, true)).toBeNull();
  });
});
