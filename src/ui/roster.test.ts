import { describe, expect, it } from 'vitest';
import { deriveRosterCoverage } from './roster';

describe('live roster coverage token', () => {
  it('distinguishes built-in EDR, deployed sensor coverage and no coverage', () => {
    expect(deriveRosterCoverage(true, true)).toEqual({
      kind: 'built-in',
      glyph: '◉',
      label: 'EDR',
      accessibleLabel: 'built-in EDR coverage',
    });
    expect(deriveRosterCoverage(false, true)).toEqual({
      kind: 'sensor',
      glyph: '⊕',
      label: 'SENSOR',
      accessibleLabel: 'deployed sensor EDR coverage',
    });
    expect(deriveRosterCoverage(false, false)).toEqual({
      kind: 'none',
      glyph: '○',
      label: 'NO EDR',
      accessibleLabel: 'no EDR coverage',
    });
  });
});
