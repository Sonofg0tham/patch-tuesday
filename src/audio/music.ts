// Procedural chamber-electronic score. Short bass, keys and percussion
// phrases leave room for thinking. No sustained saw pad or beating drone.
// Public intensity and musical time are independent of the simulation RNG.

export const SCORE = {
  bpm: 84, stepsPerBar: 16, barsPerSection: 8, reverb: 0.12,
  sections: ['Triage', 'Response', 'Night shift'] as const,
};
export const SCORE_STEP_SECONDS = 60 / SCORE.bpm / 4;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const CHORDS = [
  [146.83, 174.61, 220], // D3 F3 A3, D minor
  [116.54, 146.83, 174.61], // Bb2 D3 F3
  [98, 116.54, 146.83], // G2 Bb2 D3
  [110, 146.83, 164.81], // A2 D3 E3, suspended dominant
  [130.81, 174.61, 220], // C3 F3 A3
  [130.81, 164.81, 196], // C3 E3 G3
];
const ROOTS = [73.42, 58.27, 49, 55, 87.31, 65.41];
const PROGRESSIONS = [[0, 1, 2, 3, 0, 4, 1, 3], [0, 2, 1, 3, 4, 5, 2, 3], [4, 5, 0, 1, 2, 4, 3, 0]];
const MELODY_STEPS = [[0, 6, 10], [2, 6, 8, 14], [0, 4, 10, 12]];
const MELODY_TONES = [[2, 1, 0], [0, 2, 1, 2], [1, 2, 0, 1]];
export const GATES = { clock: 0.12, arp: 0.34, percussion: 0.58 };

export function layerLevel(gate: number, intensity: number): number {
  return Math.min(1, Math.max(0, (intensity - gate) / 0.25));
}
export interface StepPlan {
  chord: number; barStart: boolean; section: number; recovery: boolean;
  bass?: { freq: number; level: number };
  harmony?: { tones: readonly number[]; level: number };
  clock?: { accent: boolean; level: number };
  pluck?: { freq: number; level: number };
  kick?: { level: number };
  metal?: { level: number };
}

/** Three eight-bar passages, with answering phrases and breathing space. */
export function planStep(index: number, intensity: number, recovery = false): StepPlan {
  const bar = Math.floor(index / SCORE.stepsPerBar);
  const section = Math.floor(bar / SCORE.barsPerSection) % SCORE.sections.length;
  const inBar = index % SCORE.stepsPerBar;
  const chord = (recovery ? [4, 5, 0, 1, 4, 2, 3, 0] : PROGRESSIONS[section])[bar % 8];
  const plan: StepPlan = { chord, section, recovery, barStart: inBar === 0 };
  const threat = recovery ? 0 : Math.max(0, Math.min(1, intensity));
  const breathing = bar % 8 === 7;
  if (inBar === 0 || (!breathing && !recovery && inBar === (section === 1 ? 10 : 8))) {
    plan.bass = { freq: ROOTS[chord] * (inBar ? 1.5 : 1), level: recovery ? 0.6 : 0.75 + threat * 0.2 };
  }
  // Chord strikes decay completely; alternating bars leave space for melody.
  if (inBar === 0 && (bar % 2 === 0 || recovery)) plan.harmony = { tones: CHORDS[chord], level: recovery ? 0.7 : 0.48 };
  const position = MELODY_STEPS[section].indexOf(inBar);
  if (!breathing && position >= 0 && (!recovery || position % 2 === 0)) {
    const tone = MELODY_TONES[section][position];
    const answer = bar % 4 >= 2 ? (tone + 1) % 3 : tone;
    plan.pluck = { freq: CHORDS[chord][answer] * 2, level: recovery ? 0.55 : 0.55 + threat * 0.25 };
  }
  if (!recovery && !breathing) {
    if (inBar === 0 || (section !== 0 && inBar === 8)) plan.kick = { level: 0.3 + threat * 0.45 };
    const clock = layerLevel(GATES.clock, threat);
    if (clock > 0 && inBar % 4 === 0) plan.clock = { accent: inBar === 0, level: clock };
    if (layerLevel(GATES.arp, threat) > 0 && inBar === 14 && !plan.pluck) plan.pluck = { freq: CHORDS[chord][1] * 2, level: 0.3 };
    const percussion = layerLevel(GATES.percussion, threat);
    if (percussion > 0 && (inBar === 4 || inBar === 12)) plan.metal = { level: percussion * 0.6 };
  }
  return plan;
}

// Also exercised with OfflineAudioContext. Every source has a finite envelope
// and disconnects its graph when it ends.
export function synthesiseScoreStep(ctx: BaseAudioContext, out: AudioNode, plan: StepPlan, time: number): void {
  function note(freq: number, peak: number, duration: number, type: OscillatorType, cutoff: number, delay = 0, slide?: number): void {
    const at = time + delay;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, at + 0.08);
    filter.type = 'lowpass';
    filter.Q.value = 0.45;
    filter.frequency.setValueAtTime(cutoff, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff * 0.4), at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.gain.linearRampToValueAtTime(0, at + duration + 0.03);
    osc.connect(filter).connect(gain).connect(out);
    osc.onended = () => { osc.disconnect(); filter.disconnect(); gain.disconnect(); };
    osc.start(at);
    osc.stop(at + duration + 0.04);
  }
  if (plan.bass) note(plan.bass.freq, plan.bass.level * 0.13, 0.48, 'triangle', 420);
  if (plan.harmony) plan.harmony.tones.forEach((freq, voice) => note(freq, plan.harmony!.level * 0.036, plan.recovery ? 1.1 : 0.85, 'sine', 1400, voice * 0.022));
  if (plan.pluck) {
    note(plan.pluck.freq, plan.pluck.level * 0.085, 0.48, 'triangle', 1800);
    note(plan.pluck.freq * 2, plan.pluck.level * 0.012, 0.12, 'sine', 2400);
  }
  if (plan.clock) note(plan.clock.accent ? 430 : 330, plan.clock.level * 0.022, 0.055, 'triangle', 900);
  if (plan.kick) note(95, plan.kick.level * 0.19, 0.22, 'sine', 240, 0, 43);
  if (plan.metal) {
    // A low wooden rim sound, replacing the sharp 5kHz noise burst.
    note(185, plan.metal.level * 0.055, 0.055, 'triangle', 1800);
    note(287, plan.metal.level * 0.025, 0.035, 'sine', 1800, 0.006);
  }
}
export type Outcome = 'won' | 'lost' | 'abandoned';
export interface Music {
  start(): void; stop(): void;
  setIntensity(value: number): void;
  setRecovery(value: boolean): void;
  resolve(outcome: Outcome): void;
  setVolume(value: number): void;
  duck(depth: number, seconds: number): void;
}

export function createMusic(ctx: AudioContext, out: AudioNode, reverbSend: AudioNode): Music {
  const bus = ctx.createGain();
  bus.gain.value = 0;
  const duckGain = ctx.createGain();
  duckGain.gain.value = 1;
  bus.connect(duckGain).connect(out);
  const send = ctx.createGain();
  send.gain.value = SCORE.reverb;
  duckGain.connect(send).connect(reverbSend);
  let volume = 0.6;
  let intensity = 0;
  let recovery = false;
  let running = false;
  let ended = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextStepTime = 0;
  let step = 0;
  function scheduler(): void {
    // Skip missed notes after a throttled tab instead of bursting through them.
    if (nextStepTime < ctx.currentTime - SCHEDULE_AHEAD) {
      const missed = Math.ceil((ctx.currentTime - nextStepTime) / SCORE_STEP_SECONDS);
      step += missed;
      nextStepTime += missed * SCORE_STEP_SECONDS;
    }
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      if (!ended && volume > 0) synthesiseScoreStep(ctx, bus, planStep(step, intensity, recovery), nextStepTime);
      nextStepTime += SCORE_STEP_SECONDS;
      step++;
    }
  }
  function clearTimer(): void { if (timer !== null) clearInterval(timer); timer = null; }
  return {
    start() {
      if (running || ended) return;
      running = true;
      nextStepTime = ctx.currentTime + 0.05;
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setTargetAtTime(volume, ctx.currentTime, 0.35);
      timer = setInterval(scheduler, LOOKAHEAD_MS);
    },
    stop() {
      running = false;
      clearTimer();
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    },
    setIntensity(value) { intensity = Math.max(0, Math.min(1, value)); },
    setRecovery(value) { recovery = value; },
    setVolume(value) {
      volume = Math.max(0, Math.min(1, value));
      // This bus controls every instrument and its send, even scheduled notes.
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setTargetAtTime(running && !ended ? volume : 0, ctx.currentTime, 0.025);
    },
    duck(depth, seconds) {
      const t = ctx.currentTime;
      duckGain.gain.cancelScheduledValues(t);
      duckGain.gain.setTargetAtTime(Math.max(0.05, 1 - depth), t, 0.03);
      duckGain.gain.setTargetAtTime(1, t + seconds, 0.4);
    },
    resolve(outcome) {
      if (ended) return;
      ended = true;
      clearTimer();
      const t = ctx.currentTime + SCHEDULE_AHEAD;
      if (outcome !== 'abandoned' && volume > 0) {
        const cadence = outcome === 'won' ? [146.83, 174.61, 220, 293.66] : [146.83, 130.81, 110, 73.42];
        cadence.forEach((freq, i) => synthesiseScoreStep(ctx, bus, {
          chord: 0, section: 0, recovery: true, barStart: false,
          pluck: { freq, level: 0.65 },
          ...(i === 3 ? { harmony: { tones: outcome === 'won' ? CHORDS[0] : [73.42, 110], level: 0.7 } } : {}),
        }, t + i * 0.22));
      }
      bus.gain.setTargetAtTime(0, t + (outcome === 'abandoned' ? 0 : 2.5), 0.35);
    },
  };
}
