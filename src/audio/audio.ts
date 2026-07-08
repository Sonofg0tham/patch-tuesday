// The war-room soundscape (Phase 5), all synthesised via WebAudio. One module,
// sounds keyed by name, the pattern proven in Tailgate. Nothing is fetched: every
// sound is generated from oscillators and noise, so the whole thing is CC0 by
// construction. registerSample() is the file-swap escape hatch: drop an
// AudioBuffer under a name and it plays instead of the synth.
//
// Autoplay policy: the AudioContext is not created until unlock() is called from
// a real user gesture, so nothing tries to make noise (or logs a warning) before
// the player has interacted. play() before unlock is a silent no-op.

export type SoundName =
  | 'confirm' // a clean action landed
  | 'denied' // an illegal action, alongside the plain-English reason
  | 'spread' // one worm spread attempt during resolution (a tense tick)
  | 'encrypt' // a node encrypts: the signature sting, nasty
  | 'encrypt-heavy' // the DC or Backup Node encrypts: heavier
  | 'defeat' // the run is lost: a flat dead-line tone
  | 'contain' // the worm is contained: quietly triumphant but exhausted
  | 'override'; // business pressure force-reconnected a node: phone slammed down

export const SOUND_NAMES: SoundName[] = [
  'confirm',
  'denied',
  'spread',
  'encrypt',
  'encrypt-heavy',
  'defeat',
  'contain',
  'override',
];

export interface Audio {
  /** Create/resume the context on a real user gesture. Idempotent. */
  unlock(): void;
  play(name: SoundName): void;
  /** Master volume 0..1. The Phase 6 settings slider will drive this. */
  setMasterVolume(v: number): void;
  /** Blast radius 0..1: the keyboard clatter of the war room intensifies. */
  setBlastIntensity(fraction: number): void;
  /** Business pressure 0..1: an escalating low undertone. */
  setPressure(fraction: number): void;
  /** File-swap escape hatch: play this buffer for the name instead of the synth. */
  registerSample(name: SoundName, buffer: AudioBuffer): void;
}

export function createAudio(): Audio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let masterVolume = 0.7;
  let ambience: Ambience | null = null;
  const samples = new Map<SoundName, AudioBuffer>();

  function unlock(): void {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = masterVolume;
    master.connect(ctx.destination);
    ambience = createAmbience(ctx, master);
    ambience.start();
  }

  function play(name: SoundName): void {
    if (!ctx || !master) return;
    const sample = samples.get(name);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.connect(master);
      src.start();
      return;
    }
    SYNTHS[name](ctx, master);
  }

  return {
    unlock,
    play,
    setMasterVolume(v) {
      masterVolume = Math.max(0, Math.min(1, v));
      if (master && ctx) master.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.02);
    },
    setBlastIntensity(fraction) {
      ambience?.setBlast(Math.max(0, Math.min(1, fraction)));
    },
    setPressure(fraction) {
      ambience?.setPressure(Math.max(0, Math.min(1, fraction)));
    },
    registerSample(name, buffer) {
      samples.set(name, buffer);
    },
  };
}

// --- Synthesis helpers ---

function envGain(ctx: AudioContext, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  peak: number,
  attack: number,
  decay: number,
  glideTo?: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t + attack + decay);
  const g = envGain(ctx, peak, attack, decay);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noiseBurst(
  ctx: AudioContext,
  out: AudioNode,
  seconds: number,
  peak: number,
  filterType: BiquadFilterType,
  cutoff: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = cutoff;
  const g = envGain(ctx, peak, 0.005, seconds);
  src.connect(filter).connect(g).connect(out);
  src.start();
  src.stop(ctx.currentTime + seconds + 0.05);
}

// A soft distortion curve to make the encryption sting nasty.
function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

// The signature: a detuned saw sweeping up into a harsh, distorted bite with a
// dissonant partial and a spit of noise. `heavy` drops it an octave with more
// sub and length for the DC or Backup Node.
function encryptSting(ctx: AudioContext, out: AudioNode, heavy: boolean): void {
  const t = ctx.currentTime;
  const base = heavy ? 90 : 180;
  const dur = heavy ? 0.7 : 0.45;

  const shaper = ctx.createWaveShaper();
  shaper.curve = distortionCurve(heavy ? 18 : 12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(heavy ? 0.5 : 0.38, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  shaper.connect(g).connect(out);

  // Two detuned saws sweeping up, plus a dissonant tritone-ish partial.
  for (const [mult, detune] of [[1, -8], [1, 9], [1.42, 0]] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(base * mult, t);
    osc.frequency.exponentialRampToValueAtTime(base * mult * 2.4, t + dur * 0.7);
    osc.connect(shaper);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  // A spit of bright noise on the attack.
  noiseBurst(ctx, out, heavy ? 0.18 : 0.12, heavy ? 0.22 : 0.16, 'highpass', 1800);
}

type Synth = (ctx: AudioContext, out: AudioNode) => void;

const SYNTHS: Record<SoundName, Synth> = {
  confirm(ctx, out) {
    // A clean two-note cyan blip.
    tone(ctx, out, 'triangle', 660, 0.18, 0.005, 0.09);
    tone(ctx, out, 'sine', 990, 0.12, 0.02, 0.12);
  },
  denied(ctx, out) {
    // A low buzzy "nope" gliding down.
    tone(ctx, out, 'square', 150, 0.16, 0.005, 0.16, 96);
  },
  spread(ctx, out) {
    // A tense, quiet tick per spread attempt (many fire, so keep it small).
    noiseBurst(ctx, out, 0.05, 0.06, 'bandpass', 2600);
  },
  encrypt(ctx, out) {
    encryptSting(ctx, out, false);
  },
  'encrypt-heavy'(ctx, out) {
    encryptSting(ctx, out, true);
  },
  defeat(ctx, out) {
    // A flat dead-line tone: steady, cold, holding then fading.
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
    g.gain.setValueAtTime(0.3, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    g.connect(out);
    for (const f of [440, 441.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 1.85);
    }
  },
  contain(ctx, out) {
    // Quietly triumphant but exhausted: a soft rise that settles, low energy.
    tone(ctx, out, 'sine', 392, 0.2, 0.04, 0.4); // G
    tone(ctx, out, 'sine', 523, 0.16, 0.14, 0.5); // C, arriving late and soft
    tone(ctx, out, 'triangle', 784, 0.08, 0.24, 0.5); // a faint high glimmer
  },
  override(ctx, out) {
    // Phone slammed down: a percussive clack, a low thud, a cut-off ring.
    noiseBurst(ctx, out, 0.06, 0.4, 'highpass', 2400); // the clack
    tone(ctx, out, 'sine', 70, 0.4, 0.005, 0.18); // the thud
    tone(ctx, out, 'square', 620, 0.08, 0.005, 0.05); // a clipped ring
  },
};

// --- Ambience: continuous room tone, an escalating pressure undertone, and
// keyboard clatter whose density tracks the blast radius. ---

interface Ambience {
  start(): void;
  setBlast(fraction: number): void;
  setPressure(fraction: number): void;
}

function createAmbience(ctx: AudioContext, out: AudioNode): Ambience {
  const bed = ctx.createGain();
  bed.gain.value = 0.5;
  bed.connect(out);

  // Low room tone: two detuned sub sines plus a filtered noise floor.
  function roomTone(): void {
    for (const f of [52, 55.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.06;
      osc.connect(g).connect(bed);
      osc.start();
    }
    const noise = ctx.createBufferSource();
    noise.buffer = loopingNoise(ctx);
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const g = ctx.createGain();
    g.gain.value = 0.02;
    noise.connect(lp).connect(g).connect(bed);
    noise.start();
  }

  // The escalating undertone: a low oscillator whose gain and brightness climb
  // with business pressure, so the room feels the strain before the meter maxes.
  const pressureOsc = ctx.createOscillator();
  pressureOsc.type = 'sawtooth';
  pressureOsc.frequency.value = 44;
  const pressureFilter = ctx.createBiquadFilter();
  pressureFilter.type = 'lowpass';
  pressureFilter.frequency.value = 120;
  const pressureGain = ctx.createGain();
  pressureGain.gain.value = 0;
  pressureOsc.connect(pressureFilter).connect(pressureGain).connect(bed);

  // Keyboard clatter: short bright noise ticks, scheduled at a rate set by the
  // blast radius, so the room gets busier as the estate falls.
  let blast = 0;
  function scheduleClatter(): void {
    // Runs for the page lifetime; the ambience is never torn down.
    setInterval(() => {
      if (blast <= 0.02) return;
      // More keys pressed, more often, as the incident worsens.
      if (Math.random() > blast * 0.9) return;
      const src = ctx.createBufferSource();
      src.buffer = clickNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800 + Math.random() * 1600;
      const g = ctx.createGain();
      g.gain.value = 0.03 + blast * 0.05;
      src.connect(filter).connect(g).connect(bed);
      src.start();
      src.stop(ctx.currentTime + 0.04);
    }, 140);
  }

  return {
    start() {
      roomTone();
      pressureOsc.start();
      scheduleClatter();
    },
    setBlast(fraction) {
      blast = fraction;
    },
    setPressure(fraction) {
      const t = ctx.currentTime;
      pressureGain.gain.setTargetAtTime(fraction * 0.12, t, 0.3);
      pressureFilter.frequency.setTargetAtTime(120 + fraction * 500, t, 0.3);
    },
  };
}

function loopingNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function clickNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.04);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  return buffer;
}
