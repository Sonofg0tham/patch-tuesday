import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BOARD_SIGNAL_COLOURS, BOARD_SIGNAL_LEVELS } from './board';
import { cableAnimationTime } from './materials';

describe('board signal hierarchy', () => {
  it('keeps healthy cable and EDR energy below selection and observed compromise', () => {
    expect(BOARD_SIGNAL_LEVELS.healthyCable).toBeLessThan(BOARD_SIGNAL_LEVELS.selection);
    expect(BOARD_SIGNAL_LEVELS.edr).toBeLessThan(BOARD_SIGNAL_LEVELS.selection);
    expect(BOARD_SIGNAL_LEVELS.selection).toBeLessThan(BOARD_SIGNAL_LEVELS.compromise);
  });

  it('desaturates unknown chassis below verified clean infrastructure', () => {
    const clean = new THREE.Color(BOARD_SIGNAL_COLOURS.clean).getHSL({ h: 0, s: 0, l: 0 });
    const unknown = new THREE.Color(BOARD_SIGNAL_COLOURS.unknown).getHSL({ h: 0, s: 0, l: 0 });
    expect(unknown.s).toBeLessThan(clean.s);
  });

  it('freezes cable pulse travel under reduced motion', () => {
    expect(cableAnimationTime(42, true)).toBe(0);
    expect(cableAnimationTime(42, false)).toBe(42);
  });
});
