/**
 * Synthesized sound effects via the Web Audio API — no external assets.
 * Mute state lives in the in-memory `soundSettings` object (deliberately not
 * persisted). All playback goes through `playSound(name)`.
 */

export interface SoundSettings {
  muted: boolean;
  /** Ambient music has its own toggle, independent of SFX. */
  musicMuted: boolean;
}

export const soundSettings: SoundSettings = { muted: false, musicMuted: false };

export type SoundName = 'dice' | 'step' | 'capture' | 'home' | 'win' | 'turn' | 'unlucky';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Autoplay policies keep the context suspended until a user gesture; unlock on
// the first pointer interaction anywhere (and kick the music loop off then).
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    () => {
      void getCtx();
      ensureMusic();
    },
    { once: true },
  );
}

/** Best-effort haptics on devices that support it. */
export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Haptics are best-effort.
  }
}

interface ToneOpts {
  at?: number; // seconds from now
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  glideTo?: number; // frequency to slide to over dur
}

function tone(ac: AudioContext, freq: number, opts: ToneOpts = {}) {
  const { at = 0, dur = 0.12, type = 'sine', gain = 0.15, glideTo } = opts;
  const start = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noiseBurst(
  ac: AudioContext,
  { at = 0, dur = 0.06, gain = 0.12, filterFreq = 2500 }: { at?: number; dur?: number; gain?: number; filterFreq?: number } = {},
) {
  const start = ac.currentTime + at;
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + dur);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(start);
}

const effects: Record<SoundName, (ac: AudioContext) => void> = {
  /** Rattling die: a scatter of filtered clicks. */
  dice(ac) {
    for (let i = 0; i < 7; i++) {
      noiseBurst(ac, {
        at: i * 0.07 + Math.random() * 0.02,
        dur: 0.035,
        gain: 0.1,
        filterFreq: 1800 + Math.random() * 2200,
      });
    }
  },
  /** Tiny tick per movement step — pitch/length vary so it never sounds robotic. */
  step(ac) {
    tone(ac, 1130 + Math.random() * 260, {
      dur: 0.032 + Math.random() * 0.018,
      type: 'square',
      gain: 0.04 + Math.random() * 0.02,
    });
  },
  /** Capture: a thwack plus a descending "falling off the board" whine. */
  capture(ac) {
    noiseBurst(ac, { dur: 0.12, gain: 0.2, filterFreq: 700 });
    tone(ac, 340, { at: 0.02, dur: 0.3, type: 'sawtooth', gain: 0.12, glideTo: 70 });
  },
  /** Token reaches home: rising major arpeggio. */
  home(ac) {
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((f, i) => tone(ac, f, { at: i * 0.09, dur: 0.18, type: 'triangle', gain: 0.14 }));
  },
  /** Win fanfare. */
  win(ac) {
    const seq: [number, number][] = [
      [392, 0], [523.25, 0.14], [659.25, 0.28], [783.99, 0.42], [1046.5, 0.6],
    ];
    for (const [f, at] of seq) tone(ac, f, { at, dur: 0.3, type: 'triangle', gain: 0.16 });
    tone(ac, 1046.5, { at: 0.85, dur: 0.7, type: 'triangle', gain: 0.14 });
    tone(ac, 523.25, { at: 0.85, dur: 0.7, type: 'sine', gain: 0.1 });
  },
  /** Soft two-note cue on turn change. */
  turn(ac) {
    tone(ac, 440, { dur: 0.08, type: 'sine', gain: 0.06 });
    tone(ac, 587, { at: 0.09, dur: 0.1, type: 'sine', gain: 0.06 });
  },
  /** Gentle descending "no moves, unlucky" cue. */
  unlucky(ac) {
    tone(ac, 392, { dur: 0.14, type: 'sine', gain: 0.07 });
    tone(ac, 294, { at: 0.15, dur: 0.22, type: 'sine', gain: 0.07, glideTo: 262 });
  },
};

export function playSound(name: SoundName) {
  if (soundSettings.muted) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    effects[name](ac);
  } catch {
    // Audio is best-effort; never let it break the game.
  }
}

/* --- ambient background loop: a soft, slow synth pad --- */

// Gentle I-vi-IV-V progression as low triads (C, Am, F, G).
const MUSIC_CHORDS: number[][] = [
  [130.81, 164.81, 196.0],
  [110.0, 130.81, 164.81],
  [87.31, 130.81, 174.61],
  [98.0, 146.83, 196.0],
];
const CHORD_SECONDS = 2.6;
let chordIdx = 0;
let musicTimer: ReturnType<typeof setTimeout> | null = null;

function musicTick() {
  musicTimer = null;
  if (soundSettings.muted || soundSettings.musicMuted) return; // ensureMusic restarts it
  const ac = getCtx();
  if (!ac || ac.state !== 'running') {
    musicTimer = setTimeout(musicTick, 500);
    return;
  }
  const chord = MUSIC_CHORDS[chordIdx % MUSIC_CHORDS.length];
  chordIdx++;
  const start = ac.currentTime;
  for (const f of chord) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f * 2; // an octave up keeps the pad airy
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(0.014, start + 1.0);
    g.gain.linearRampToValueAtTime(0.0001, start + CHORD_SECONDS + 0.3);
    osc.connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(start + CHORD_SECONDS + 0.4);
  }
  // soft bass root under the pad
  tone(ac, chord[0] / 2, { dur: CHORD_SECONDS, type: 'sine', gain: 0.02 });
  musicTimer = setTimeout(musicTick, CHORD_SECONDS * 1000);
}

/** Starts the ambient loop if it should be playing and isn't already. */
export function ensureMusic() {
  if (musicTimer === null && !soundSettings.muted && !soundSettings.musicMuted) {
    musicTick();
  }
}

export function setMusicMuted(muted: boolean) {
  soundSettings.musicMuted = muted;
  if (!muted) ensureMusic();
}
