import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BOARD_SIGNAL_COLOURS, BOARD_SIGNAL_LEVELS } from './board';
import { cableAnimationTime } from './materials';
import { MotionPhaseClock } from './motion-clock';

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

  it('freezes and resumes cable travel at the current spatial phase', () => {
    const clock = new MotionPhaseClock(false);
    expect(cableAnimationTime(clock, 0.5, false)).toBeCloseTo(0.5);
    const beforePause = cableAnimationTime(clock, 0.75, false);

    expect(cableAnimationTime(clock, 0.75, true)).toBeCloseTo(beforePause);
    expect(cableAnimationTime(clock, 5.75, true)).toBeCloseTo(beforePause);
    expect(cableAnimationTime(clock, 5.75, false)).toBeCloseTo(beforePause);
    expect(cableAnimationTime(clock, 5.85, false)).toBeCloseTo(beforePause + 0.1);
  });
});
