// The adaptive score (Phase 7). Synthesised, like everything else here: no
// audio files, no streams, CC0 by construction.
//
// This is not a loop that plays underneath the game. It is six layers stacked
// on one chord progression, each gated by how bad the incident is, so the music
// is a readout of the board. A quiet estate gets a drone and a pad. As the
// blast radius and business pressure climb, a clock enters, then an arpeggio,
// then percussion, then a tritone that sits under everything and refuses to
// resolve. The player learns to hear trouble arriving before they have finished
// reading the HUD.
//
// Scheduling uses the standard WebAudio two-clock pattern: a coarse setInterval
// wakes up regularly and schedules note events slightly ahead on the audio
// clock, which is sample-accurate. Scheduling straight off setInterval would
// jitter audibly.
//
// Musically: D natural minor at 72bpm. Slow, cold, institutional. Turn-based
// thinking music, not action music.

const BPM = 72;
const STEP = 60 / BPM / 4; // one sixteenth note
const STEPS_PER_BAR = 16;
const LOOKAHEAD_MS = 25; // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.12; // how far ahead of the audio clock it writes

// D natural minor. The progression is four bars of held chords: tonic, down to
// the relative major's flat sixth, up to the minor fourth, and out on a
// suspended dominant that never resolves. It never lands, which is the point.
const CHORDS: number[][] = [
  [146.83, 174.61, 220.0], // Dm  : D4 F4 A4
  [116.54, 146.83, 174.61], // Bb : Bb3 D4 F4
  [130.81, 155.56, 196.0], // Gm  : C4 Eb4 G4 (voiced close, the fourth)
  [110.0, 146.83, 164.81], // Asus: A3 D4 E4, unresolved
];
const ROOTS = [73.42, 58.27, 98.0, 55.0]; // D2, Bb1, G2, A1

/** How intense the incident has to be before each layer joins. */
export const GATES = {
  pad: 0,
  clock: 0.12,
  arp: 0.34,
  percussion: 0.58,
  dissonance: 0.78,
};

/** How wide the fade is between a layer's gate and its full level. */
const GATE_RAMP = 0.25;

/**
 * How present a gated layer should be at a given intensity: nothing below its
 * gate, then ramping in rather than switching on hard.
 */
export function layerLevel(gate: number, intensity: number): number {
  if (intensity <= gate) return 0;
  return Math.min(1, (intensity - gate) / GATE_RAMP);
}

/** One scheduled note. What to play, not how to synthesise it. */
export interface StepPlan {
  /** Index into CHORDS for this bar. */
  chord: number;
  /** True on the first step of a bar, when the harmony moves. */
  barStart: boolean;
  clock?: { accent: boolean };
  pluck?: { freq: number; level: number };
  kick?: { level: number };
  metal?: { level: number };
}

/**
 * The score's arrangement, as pure logic: given a step index and how bad the
 * incident is, what plays. Separated from the synthesis so the arrangement is
 * testable and so Craig can tune the pattern without touching WebAudio.
 */
export function planStep(index: number, intensity: number): StepPlan {
  const chord = Math.floor(index / STEPS_PER_BAR) % CHORDS.length;
  const inBar = index % STEPS_PER_BAR;
  const tones = CHORDS[chord];
  const plan: StepPlan = { chord, barStart: inBar === 0 };

  // The clock, on quarter notes, accented on the downbeat.
  if (layerLevel(GATES.clock, intensity) > 0 && inBar % 4 === 0) {
    plan.clock = { accent: inBar === 0 };
  }

  // The arpeggio, on eighths, walking up the chord and back down, jumping an
  // octave for the second half of the figure.
  const arp = layerLevel(GATES.arp, intensity);
  if (arp > 0 && inBar % 2 === 0) {
    const position = (inBar / 2) % 6;
    const order = [0, 1, 2, 1, 2, 0];
    const octave = position >= 3 ? 2 : 1;
    plan.pluck = { freq: tones[order[position]] * octave, level: arp };
  }

  // Percussion: a kick on one and the and-of-three, metal on the backbeat, with
  // extra ticks once things are properly out of hand.
  const perc = layerLevel(GATES.percussion, intensity);
  if (perc > 0) {
    if (inBar === 0 || inBar === 10) plan.kick = { level: perc };
    if (inBar === 4 || inBar === 12) plan.metal = { level: perc };
    else if (perc > 0.7 && (inBar === 7 || inBar === 15)) plan.metal = { level: perc * 0.6 };
  }

  return plan;
}

export type Outcome = 'won' | 'lost' | 'abandoned';

export interface Music {
  start(): void;
  stop(): void;
  /** Overall threat level 0..1. Layers fade in and out around it. */
  setIntensity(value: number): void;
  /** The run ended: the score stops adapting and plays its verdict. */
  resolve(outcome: Outcome): void;
  /** Score volume relative to the master, 0..1. */
  setVolume(value: number): void;
  /** Pull the score down briefly so a big effect can land on top of it. */
  duck(depth: number, seconds: number): void;
}

export function createMusic(ctx: AudioContext, out: AudioNode, reverbSend: AudioNode): Music {
  // The score's own bus, so its volume and ducking are independent of effects.
  const bus = ctx.createGain();
  bus.gain.value = 0;
  const duckGain = ctx.createGain();
  duckGain.gain.value = 1;
  bus.connect(duckGain).connect(out);

  // A modest send: the score should sit in the same room as the effects, but a
  // pad through a 2.4-second tail turns to soup, so it goes in quieter.
  const send = ctx.createGain();
  send.gain.value = 0.22;
  duckGain.connect(send).connect(reverbSend);

  let volume = 0.6;
  let intensity = 0;
  let running = false;
  let ended = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextStepTime = 0;
  let step = 0;

  // --- Continuous layers ---
  // These never retrigger; they are always sounding and their gain and tuning
  // are automated. A pad that restarts every bar sounds like a loop, and a loop
  // is exactly what this must not sound like.

  const droneGain = ctx.createGain();
  droneGain.gain.value = 0;
  droneGain.connect(bus);
  const droneOscs: OscillatorNode[] = [];
  for (const detune of [-4, 5]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = ROOTS[0];
    osc.detune.value = detune;
    osc.connect(droneGain);
    droneOscs.push(osc);
  }
  // A quiet sub an octave down, felt more than heard.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = ROOTS[0] / 2;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.35;
  sub.connect(subGain).connect(droneGain);

  const padGain = ctx.createGain();
  padGain.gain.value = 0;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 700;
  padFilter.Q.value = 1.4;
  padFilter.connect(padGain).connect(bus);
  // Three voices per chord, each doubled and detuned so the pad has movement
  // without a chorus effect.
  const padOscs: OscillatorNode[] = [];
  for (let voice = 0; voice < 3; voice += 1) {
    for (const detune of [-7, 6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = CHORDS[0][voice];
      osc.detune.value = detune;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.16;
      osc.connect(voiceGain).connect(padFilter);
      padOscs.push(osc);
    }
  }
  // A slow sweep on the pad's filter, so the chord breathes across the loop.
  const padLfo = ctx.createOscillator();
  padLfo.type = 'sine';
  padLfo.frequency.value = 0.045;
  const padLfoDepth = ctx.createGain();
  padLfoDepth.gain.value = 320;
  padLfo.connect(padLfoDepth).connect(padFilter.frequency);

  // The tritone. It arrives late, sits a diminished fifth above the root, and
  // is the single most unpleasant thing in the mix by design.
  const tritoneGain = ctx.createGain();
  tritoneGain.gain.value = 0;
  tritoneGain.connect(bus);
  const tritone = ctx.createOscillator();
  tritone.type = 'sawtooth';
  tritone.frequency.value = ROOTS[0] * Math.SQRT2;
  const tritoneFilter = ctx.createBiquadFilter();
  tritoneFilter.type = 'lowpass';
  tritoneFilter.frequency.value = 400;
  tritone.connect(tritoneFilter).connect(tritoneGain);

  const continuous = [...droneOscs, sub, ...padOscs, padLfo, tritone];

  // --- Triggered layers ---

  // The clock: a soft filtered blip on every beat. The turn timer that is not
  // there, made audible. This is the layer that makes the room tense.
  function clockTick(time: number, accent: boolean): void {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(accent ? 880 : 660, time);
    const gain = ctx.createGain();
    const peak = (accent ? 0.06 : 0.035) * layerLevel(GATES.clock, intensity);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
    osc.connect(gain).connect(bus);
    gain.connect(send);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  // The arpeggio: a plucked chord tone. Short, hard attack, quick decay, the
  // sound of a machine working through something.
  function pluck(time: number, freq: number, level: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, time);
    filter.frequency.exponentialRampToValueAtTime(700, time + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.07 * level), time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
    osc.connect(filter).connect(gain).connect(bus);
    gain.connect(send);
    osc.start(time);
    osc.stop(time + 0.36);
  }

  // A low kick: a sine dropping fast. Institutional, not danceable.
  function kick(time: number, level: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.09);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.32 * level), time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
    osc.connect(gain).connect(bus);
    osc.start(time);
    osc.stop(time + 0.28);
  }

  // A metallic tick: filtered noise, the rack-room percussion.
  function metal(time: number, level: number): void {
    const length = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 5200;
    filter.Q.value = 2.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.14 * level;
    src.connect(filter).connect(gain).connect(bus);
    gain.connect(send);
    src.start(time);
    src.stop(time + 0.08);
  }

  // Retunes the continuous layers to the bar's chord. Portamento, not a
  // retrigger, so the harmony shifts underneath rather than restarting.
  function moveToChord(index: number, time: number): void {
    const chord = CHORDS[index];
    const root = ROOTS[index];
    for (const osc of droneOscs) osc.frequency.setTargetAtTime(root, time, 0.35);
    sub.frequency.setTargetAtTime(root / 2, time, 0.35);
    padOscs.forEach((osc, i) => {
      osc.frequency.setTargetAtTime(chord[Math.floor(i / 2)], time, 0.4);
    });
    tritone.frequency.setTargetAtTime(root * Math.SQRT2, time, 0.5);
  }

  // Turns one planned step into actual sound. All of the arrangement decisions
  // live in planStep(); this only synthesises what it is handed.
  function scheduleStep(index: number, time: number): void {
    const plan = planStep(index, intensity);
    if (plan.barStart) moveToChord(plan.chord, time);
    if (plan.clock) clockTick(time, plan.clock.accent);
    if (plan.pluck) pluck(time, plan.pluck.freq, plan.pluck.level);
    if (plan.kick) kick(time, plan.kick.level);
    if (plan.metal) metal(time, plan.metal.level);
  }

  // The scheduler. Writes every step that falls inside the lookahead window.
  function scheduler(): void {
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      if (!ended) scheduleStep(step, nextStepTime);
      nextStepTime += STEP;
      step += 1;
    }
  }

  // Applies the current intensity to the continuous layers' levels and colour.
  function applyIntensity(): void {
    if (ended) return;
    const t = ctx.currentTime;
    const glide = 1.2; // slow, so the score never lurches on a single spread
    // The drone is always there and gets a little heavier under load.
    droneGain.gain.setTargetAtTime((0.1 + 0.06 * intensity) * volume, t, glide);
    padGain.gain.setTargetAtTime((0.055 + 0.05 * layerLevel(GATES.pad, intensity)) * volume, t, glide);
    // The pad opens up and gets harsher as things worsen.
    padFilter.frequency.setTargetAtTime(620 + 900 * intensity, t, glide);
    tritoneGain.gain.setTargetAtTime(0.05 * layerLevel(GATES.dissonance, intensity) * volume, t, glide);
  }

  return {
    start() {
      if (running) return;
      running = true;
      const t = ctx.currentTime + 0.05;
      for (const osc of continuous) osc.start(t);
      bus.gain.setValueAtTime(0.0001, t);
      bus.gain.exponentialRampToValueAtTime(1, t + 2.5); // fade the room up
      nextStepTime = t;
      step = 0;
      applyIntensity();
      timer = setInterval(scheduler, LOOKAHEAD_MS);
    },
    stop() {
      running = false;
      if (timer !== null) clearInterval(timer);
      timer = null;
      bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    },
    setIntensity(value) {
      intensity = Math.max(0, Math.min(1, value));
      applyIntensity();
    },
    setVolume(value) {
      volume = Math.max(0, Math.min(1, value));
      applyIntensity();
    },
    duck(depth, seconds) {
      const t = ctx.currentTime;
      const floor = Math.max(0.05, 1 - depth);
      // Fast down, slow back: the shape of a room going quiet when something
      // bad happens, then gradually picking back up.
      duckGain.gain.cancelScheduledValues(t);
      duckGain.gain.setTargetAtTime(floor, t, 0.03);
      duckGain.gain.setTargetAtTime(1, t + seconds, 0.5);
    },
    resolve(outcome) {
      if (ended) return;
      ended = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      const t = ctx.currentTime;

      if (outcome === 'abandoned') {
        // No verdict. The room just empties.
        bus.gain.setTargetAtTime(0.0001, t, 0.8);
        return;
      }

      if (outcome === 'lost') {
        // Everything collapses onto the tritone and holds. No resolution, no
        // cadence, just the dissonance and a long decay.
        droneGain.gain.setTargetAtTime(0.16 * volume, t, 0.6);
        padGain.gain.setTargetAtTime(0.02 * volume, t, 1.5);
        tritoneGain.gain.setTargetAtTime(0.11 * volume, t, 0.4);
        padFilter.frequency.setTargetAtTime(300, t, 1.5);
        for (const osc of droneOscs) osc.frequency.setTargetAtTime(ROOTS[0] * 0.985, t, 2.5);
        bus.gain.setTargetAtTime(0.0001, t + 6, 2.5);
        return;
      }

      // Contained. The suspended dominant finally lands on the tonic, the
      // dissonance drops out, and the pad opens. Quietly triumphant, exhausted,
      // and over quickly: this is relief, not a fanfare.
      tritoneGain.gain.setTargetAtTime(0, t, 0.4);
      moveToChord(0, t);
      padGain.gain.setTargetAtTime(0.075 * volume, t, 0.8);
      padFilter.frequency.setTargetAtTime(1500, t, 1.2);
      droneGain.gain.setTargetAtTime(0.12 * volume, t, 0.8);
      bus.gain.setTargetAtTime(0.0001, t + 7, 2.5);
    },
  };
}
