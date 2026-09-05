// The war-room soundscape (Phase 5, rebuilt in Phase 7), all synthesised via
// WebAudio. One module, sounds keyed by name, the pattern proven in Tailgate.
// Nothing is fetched: every sound is generated from oscillators and noise, so
// the whole thing is CC0 by construction. registerSample() is the file-swap
// escape hatch: drop an AudioBuffer under a name and it plays instead of the
// synth.
//
// Phase 7 gave it a mixer instead of a single gain node. There are now three
// buses under the master: effects, ambience and the score, each with its own
// level, all feeding a shared convolution reverb so they sound like they are
// happening in the same room. Effects are positioned in the stereo field from
// where they happened on the board, and the score ducks under the big ones.
//
// Autoplay policy: the AudioContext is not created until unlock() is called from
// a real user gesture, so nothing tries to make noise (or logs a warning) before
// the player has interacted. play() before unlock is a silent no-op.

import { createMusic, type Music, type Outcome } from './music';
import { createReverbBus, type ReverbBus } from './reverb';

export type SoundName =
  | 'disconnect'
  | 'reconnect'
  | 'sensor'
  | 'restart'
  | 'confirm' // a clean action landed
  | 'denied' // an illegal action, alongside the plain-English reason
  | 'spread' // one worm spread attempt during resolution (a tense tick)
  | 'encrypt' // a node encrypts: the signature sting, nasty
  | 'encrypt-heavy' // the DC or Backup Node encrypts: heavier
  | 'defeat' // the run is lost: a flat dead-line tone
  | 'contain' // the worm is contained: quietly triumphant but exhausted
  | 'override' // business pressure force-reconnected a node: phone slammed down
  | 'handover' // short pager cue when the player accepts incident command
  | 'analysis'; // forensic sweep begins, centred and deliberately restrained

export const SOUND_NAMES: SoundName[] = [
  'disconnect', 'reconnect', 'sensor', 'restart',
  'confirm',
  'denied',
  'spread',
  'encrypt',
  'encrypt-heavy',
  'defeat',
  'contain',
  'override',
  'handover',
  'analysis',
];

/** Optional placement for a sound: -1 hard left, 0 centre, 1 hard right. */
export interface PlayOptions {
  pan?: number;
}

export interface Audio {
  /** Create/resume the context on a real user gesture. Idempotent. */
  unlock(): void;
  play(name: SoundName, options?: PlayOptions): void;
  /** Master volume 0..1, over everything. */
  setMasterVolume(v: number): void;
  /** Score volume relative to the master, 0..1. */
  setMusicVolume(v: number): void;
  /** Effects and ambience volume relative to the master, 0..1. */
  setSfxVolume(v: number): void;
  /** Blast radius 0..1: the keyboard clatter of the war room intensifies. */
  setBlastIntensity(fraction: number): void;
  /** Business pressure 0..1: an escalating low undertone. */
  setPressure(fraction: number): void;
  /** Public recovery phase, so the score can release tension without ending. */
  setRecovery(value: boolean): void;
  /** The run ended: the score plays its verdict and stops adapting. */
  resolve(outcome: Outcome): void;
  /** File-swap escape hatch: play this buffer for the name instead of the synth. */
  registerSample(name: SoundName, buffer: AudioBuffer): void;
}

// How hard each sound ducks the score, and for how long. The signature stings
// get the room to themselves; a confirm blip does not.
const DUCK: Partial<Record<SoundName, [depth: number, seconds: number]>> = {
  encrypt: [0.4, 0.25],
  'encrypt-heavy': [0.62, 0.5],
  override: [0.5, 0.3],
  defeat: [0.85, 1.6],
  contain: [0.5, 1.0],
  handover: [0.25, 0.35],
  analysis: [0.18, 0.2],
};

export function createAudio(): Audio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let reverb: ReverbBus | null = null;
  let music: Music | null = null;
  let ambience: Ambience | null = null;
  let masterLevel = 0.7;
  let musicLevel = 0.6;
  let sfxLevel = 1;
  const samples = new Map<SoundName, AudioBuffer>();

  // The two board pressures the score listens to. Blast radius dominates
  // (losing the estate is the real emergency); business pressure adds on top,
  // because a board that is contained but screaming at you is still tense.
  let blastLevel = 0;
  let pressureLevel = 0;
  let recovering = false;
  function pushIntensity(): void {
    music?.setIntensity(Math.min(1, blastLevel * 1.35 + pressureLevel * 0.35));
  }

  function unlock(): void {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();

    master = ctx.createGain();
    master.gain.value = masterLevel;
    master.connect(ctx.destination);

    // The room everything shares. Built before the buses so both can send.
    reverb = createReverbBus(ctx, master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxLevel;
    sfxBus.connect(master);
    // A modest permanent send, so every effect has some room on it without
    // each synth having to think about reverb.
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.3;
    sfxBus.connect(sfxSend).connect(reverb.input);

    const musicBus = ctx.createGain();
    musicBus.gain.value = 1;
    musicBus.connect(master);

    music = createMusic(ctx, musicBus, reverb.input);
    music.setVolume(musicLevel);
    music.setRecovery(recovering);
    pushIntensity();
    music.start();

    ambience = createAmbience(ctx, sfxBus, reverb.input);
    ambience.start();
  }

  function play(name: SoundName, options?: PlayOptions): void {
    if (!ctx || !sfxBus) return;

    // Position the sound where it happened on the board. Panning the spread
    // ticks is the point of this: during resolution you can hear which side of
    // the estate the worm is working on before you have found it on screen.
    let destination: AudioNode = sfxBus;
    if (options?.pan !== undefined && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      panner.connect(sfxBus);
      destination = panner;
    }

    const duck = DUCK[name];
    if (duck) music?.duck(duck[0], duck[1]);

    const sample = samples.get(name);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.connect(destination);
      src.start();
      return;
    }
    SYNTHS[name](ctx, destination);
  }

  return {
    unlock,
    play,
    setMasterVolume(v) {
      masterLevel = Math.max(0, Math.min(1, v));
      if (master && ctx) master.gain.setTargetAtTime(masterLevel, ctx.currentTime, 0.02);
    },
    setMusicVolume(v) {
      musicLevel = Math.max(0, Math.min(1, v));
      music?.setVolume(musicLevel);
    },
    setSfxVolume(v) {
      sfxLevel = Math.max(0, Math.min(1, v));
      if (sfxBus && ctx) sfxBus.gain.setTargetAtTime(sfxLevel, ctx.currentTime, 0.02);
    },
    setBlastIntensity(fraction) {
      // The score reads the board: the blast radius is most of what decides
      // which layers are playing.
      blastLevel = Math.max(0, Math.min(1, fraction));
      ambience?.setBlast(blastLevel);
      pushIntensity();
    },
    setPressure(fraction) {
      pressureLevel = Math.max(0, Math.min(1, fraction));
      ambience?.setPressure(pressureLevel);
      pushIntensity();
    },
    setRecovery(value) {
      recovering = value;
      music?.setRecovery(value);
    },
    resolve(outcome) {
      music?.resolve(outcome);
      ambience?.setBlast(0);
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
  if (glideTo !== undefined)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t + attack + decay);
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
  // A sub thump underneath, so the sting has weight as well as bite. This is
  // what makes losing a node feel like something landing rather than a beep.
  tone(ctx, out, 'sine', heavy ? 52 : 78, heavy ? 0.45 : 0.28, 0.004, heavy ? 0.4 : 0.22, heavy ? 30 : 46);
  // A spit of bright noise on the attack.
  noiseBurst(ctx, out, heavy ? 0.18 : 0.12, heavy ? 0.22 : 0.16, 'highpass', 1800);
}

type Synth = (ctx: AudioContext, out: AudioNode) => void;

const SYNTHS: Record<SoundName, Synth> = {
  disconnect(ctx, out) {
    noiseBurst(ctx, out, 0.055, 0.12, 'bandpass', 1700);
    tone(ctx, out, 'triangle', 420, 0.12, 0.005, 0.16, 120);
  },
  reconnect(ctx, out) {
    noiseBurst(ctx, out, 0.035, 0.09, 'bandpass', 2200);
    tone(ctx, out, 'sine', 280, 0.14, 0.02, 0.2, 660);
  },
  sensor(ctx, out) {
    tone(ctx, out, 'sine', 880, 0.1, 0.01, 0.16);
    tone(ctx, out, 'triangle', 1320, 0.07, 0.12, 0.2);
  },
  restart(ctx, out) {
    tone(ctx, out, 'sine', 140, 0.12, 0.03, 0.65, 560);
    tone(ctx, out, 'triangle', 700, 0.06, 0.45, 0.25);
  },
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
  handover(ctx, out) {
    // Conservative two-pulse pager. Task 10 owns the final phone layer and mix.
    tone(ctx, out, 'square', 760, 0.11, 0.004, 0.11);
    tone(ctx, out, 'square', 920, 0.08, 0.08, 0.14);
  },
  analysis(ctx, out) {
    // A centred forensic sweep. Its two close tones cue attention without
    // implying where hidden activity exists on the board.
    tone(ctx, out, 'sine', 310, 0.08, 0.005, 0.18, 520);
    tone(ctx, out, 'triangle', 620, 0.05, 0.08, 0.16, 780);
  },
};

// --- Ambience: continuous room tone, an escalating pressure undertone, and
// keyboard clatter whose density tracks the blast radius. ---

interface Ambience {
  start(): void;
  setBlast(fraction: number): void;
  setPressure(fraction: number): void;
}

function createAmbience(ctx: AudioContext, out: AudioNode, reverbSend: AudioNode): Ambience {
  const bed = ctx.createGain();
  bed.gain.value = 0.22;
  bed.connect(out);

  // Low room tone: two detuned sub sines plus a filtered noise floor.
  function roomTone(): void {
    for (const f of [52, 55.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.015;
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
  pressureOsc.type = 'triangle';
  pressureOsc.frequency.value = 44;
  const pressureFilter = ctx.createBiquadFilter();
  pressureFilter.type = 'lowpass';
  pressureFilter.frequency.value = 120;
  const pressureGain = ctx.createGain();
  pressureGain.gain.value = 0;
  pressureOsc.connect(pressureFilter).connect(pressureGain).connect(bed);

  // Keyboard clatter: short bright noise ticks, scheduled at a rate set by the
  // blast radius, so the room gets busier as the estate falls. Each one lands
  // somewhere random in the stereo field: it is a room full of people, not one
  // person sitting in the middle of your head.
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
      let tail: AudioNode = g;
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.random() * 1.6 - 0.8;
        g.connect(panner);
        tail = panner;
      }
      src.connect(filter).connect(g);
      tail.connect(bed);
      tail.connect(reverbSend);
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
      pressureGain.gain.setTargetAtTime(fraction * 0.06, t, 0.3);
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
