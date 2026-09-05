import { describe, expect, it } from 'vitest';
import { actionForHotkey } from './actions';

describe('action hotkey gate', () => {
  it('does not resolve action hotkeys while the action bar is locked', () => {
    expect(actionForHotkey('s', false)).toBeNull();
    expect(actionForHotkey('E', false)).toBeNull();
  });

  it('resolves a known action only while the action bar is enabled', () => {
    expect(actionForHotkey('s', true)).toBe('scan');
    expect(actionForHotkey('E', true)).toBe('emergency');
    expect(actionForHotkey('x', true)).toBeNull();
  });
});
