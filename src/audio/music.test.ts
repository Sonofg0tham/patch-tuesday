import { describe, expect, it } from 'vitest';
import { GATES, layerLevel, planStep, SCORE } from './music';

// WebAudio is browser-only, so the synthesis itself cannot be exercised here.
// The arrangement can: planStep() is the pure decision layer that says which
// instrument plays on which sixteenth at a given incident intensity, and it is
// the part that carries the design intent ("the score is a readout of the
// board"), so it is the part worth guarding.
describe('the adaptive score arrangement', () => {
  it('has melody and bass from the start, with rests instead of a constant drone', () => {
    const bar = Array.from({ length: 16 }, (_, step) => planStep(step, 0));
    expect(bar.some((plan) => plan.bass)).toBe(true);
    expect(bar.some((plan) => plan.pluck)).toBe(true);
    expect(bar.some((plan) => !plan.bass && !plan.pluck && !plan.harmony && !plan.kick)).toBe(true);
    expect(bar.every((plan) => !plan.metal && !plan.clock)).toBe(true);
  });

  it('brings each layer in at its own gate, in escalating order', () => {
    const barOfSteps = (intensity: number) =>
      Array.from({ length: 16 }, (_, step) => planStep(step, intensity));

    const calm = barOfSteps(GATES.clock + 0.05);
    expect(calm.some((p) => p.clock)).toBe(true);
    expect(calm.some((p) => p.pluck)).toBe(true);
    expect(calm.some((p) => p.metal)).toBe(false);

    const worrying = barOfSteps(GATES.arp + 0.05);
    expect(worrying.some((p) => p.pluck)).toBe(true);
    expect(worrying[14].pluck).toBeDefined();
    expect(worrying.some((p) => p.metal)).toBe(false);

    const bad = barOfSteps(GATES.percussion + 0.05);
    expect(bad.some((p) => p.kick)).toBe(true);
    expect(bad.some((p) => p.metal)).toBe(true);
  });

  it('accents the downbeat and puts the clock on quarter notes', () => {
    const bar = Array.from({ length: 16 }, (_, step) => planStep(step, 0.5));
    const ticks = bar.map((p, i) => (p.clock ? i : -1)).filter((i) => i >= 0);
    expect(ticks).toEqual([0, 4, 8, 12]);
    expect(bar[0].clock?.accent).toBe(true);
    expect(bar[4].clock?.accent).toBe(false);
  });

  it('cycles the four-chord progression, one chord per bar', () => {
    expect(planStep(0, 0.5).chord).toBe(0);
    expect(planStep(16, 0.5).chord).toBe(1);
    expect(planStep(32, 0.5).chord).toBe(2);
    expect(planStep(48, 0.5).chord).toBe(3);
    expect(planStep(64, 0.5).chord).toBe(0); // back to the tonic
    // The harmony only moves on the first step of a bar.
    expect(planStep(16, 0.5).barStart).toBe(true);
    expect(planStep(17, 0.5).barStart).toBe(false);
  });

  it('ramps a layer in rather than switching it on', () => {
    expect(layerLevel(0.5, 0.5)).toBe(0); // at the gate, still silent
    expect(layerLevel(0.5, 0.55)).toBeCloseTo(0.2, 5);
    expect(layerLevel(0.5, 0.75)).toBe(1); // fully in
    expect(layerLevel(0.5, 1)).toBe(1); // and never louder than that
  });

  it('changes harmony and melody across all three passages and leaves a breathing bar', () => {
    const sectionLength = SCORE.barsPerSection * SCORE.stepsPerBar;
    const sections = [0, 1, 2].map((section) => Array.from({ length: sectionLength }, (_, step) => planStep(section * sectionLength + step, 0.5)));
    expect(sections[0]).not.toEqual(sections[1]);
    expect(sections[1]).not.toEqual(sections[2]);
    expect(planStep(sectionLength * 3, 0.5)).toEqual(planStep(0, 0.5));
    expect(sections[0].slice(-16).every((plan) => !plan.pluck && !plan.kick && !plan.metal)).toBe(true);
  });

  it('releases percussion during recovery even while encrypted assets remain visible', () => {
    const recovery = Array.from({ length: 128 }, (_, step) => planStep(step, 1, true));
    expect(recovery.every((plan) => !plan.kick && !plan.clock && !plan.metal)).toBe(true);
    expect(recovery.some((plan) => plan.harmony)).toBe(true);
    expect(recovery.some((plan) => plan.pluck)).toBe(true);
  });

  it('never lets a layer play at zero level once it has been triggered', () => {
    // A trigger with level 0 would be an inaudible note that still costs an
    // oscillator, which is the kind of thing that quietly piles up.
    for (let intensity = 0; intensity <= 1; intensity += 0.05) {
      for (let step = 0; step < 64; step += 1) {
        const plan = planStep(step, intensity);
        if (plan.pluck) expect(plan.pluck.level).toBeGreaterThan(0);
        if (plan.kick) expect(plan.kick.level).toBeGreaterThan(0);
        if (plan.metal) expect(plan.metal.level).toBeGreaterThan(0);
      }
    }
  });
});
