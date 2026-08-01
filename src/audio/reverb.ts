// A procedurally generated convolution reverb (Phase 7).
//
// Everything in this game was previously a dry oscillator firing into the void,
// which is why the war room sounded like a synth patch rather than a room. A
// convolver fixes that in one move, and the impulse response it needs can be
// synthesised rather than sampled, so the zero-asset rule holds: an impulse
// response is just noise shaped by an envelope, plus a handful of early
// reflections for the geometry of the space.
//
// The space we are modelling is a large, hard-surfaced operations floor: long
// enough to feel institutional, damped enough at the top end that it never
// turns the sting into a wash.

/**
 * Builds a stereo impulse response.
 *
 * @param seconds Tail length. Longer reads as a bigger, emptier room.
 * @param decay Exponent on the fade. Higher is a faster, tighter tail.
 */
export function buildImpulseResponse(ctx: AudioContext, seconds = 2.4, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);

  // Early reflections: the first few discrete bounces off the near walls, in
  // milliseconds. These are what tell the ear how big the room is, far more
  // than the tail does. Slightly different per channel so the space has width.
  const earlyLeft = [11, 19, 31, 43, 61, 79];
  const earlyRight = [13, 23, 29, 47, 59, 83];

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const early = channel === 0 ? earlyLeft : earlyRight;

    // The diffuse tail: noise under an exponential fade.
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      // A short fade-in on the very front stops the convolver adding a click
      // to every transient it processes.
      const onset = Math.min(1, i / (rate * 0.004));
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * onset * 0.55;
    }

    // Stamp the early reflections on top, each quieter than the last.
    early.forEach((ms, index) => {
      const at = Math.floor((ms / 1000) * rate);
      if (at >= length) return;
      const amplitude = 0.55 * Math.pow(0.72, index);
      // A few samples wide rather than a single spike, so it reads as a
      // reflection off a surface and not as a digital tick.
      for (let k = 0; k < 24 && at + k < length; k += 1) {
        data[at + k] += (Math.random() * 2 - 1) * amplitude * (1 - k / 24);
      }
    });
  }

  return buffer;
}

export interface ReverbBus {
  /** Connect a source here to send it to the room. */
  input: GainNode;
  /** Wet level, 0..1. */
  setWet(level: number): void;
}

/**
 * A send-style reverb: sources connect to `input` at whatever level they want
 * to be in the room, and the wet signal is mixed into `out` alongside their own
 * dry path. Damped with a low-pass, because a bright tail on a magenta
 * encryption sting turns into hiss.
 */
export function createReverbBus(ctx: AudioContext, out: AudioNode): ReverbBus {
  const input = ctx.createGain();
  input.gain.value = 1;

  const damping = ctx.createBiquadFilter();
  damping.type = 'lowpass';
  damping.frequency.value = 4200;

  const convolver = ctx.createConvolver();
  convolver.buffer = buildImpulseResponse(ctx);

  const wet = ctx.createGain();
  wet.gain.value = 0.32;

  input.connect(damping).connect(convolver).connect(wet).connect(out);

  return {
    input,
    setWet(level) {
      wet.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), ctx.currentTime, 0.05);
    },
  };
}
