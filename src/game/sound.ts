/**
 * Synthesized sound effects via the Web Audio API — no external assets.
 * Mute state lives in the in-memory `soundSettings` object (deliberately not
 * persisted). All playback goes through `playSound(name)`.
 */

export interface SoundSettings {
  muted: boolean;
}

export const soundSettings: SoundSettings = { muted: false };

export type SoundName = 'dice' | 'step' | 'capture' | 'home' | 'win' | 'turn';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Autoplay policies keep the context suspended until a user gesture; unlock on
// the first pointer interaction anywhere.
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => void getCtx(), { once: true });
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
  /** Tiny tick per movement step. */
  step(ac) {
    tone(ac, 1250, { dur: 0.04, type: 'square', gain: 0.05 });
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
