import type { PlayerColor } from './types';
import { COMMENTARY_EVENT, type CommentaryDetail } from './commentary';
import { soundSettings, setSfxDuck } from './sound';

/**
 * Recorded Egyptian-Arabic commentary, layered on top of the commentary event
 * system. Nothing here is required for the game to work: if a clip is missing
 * the event simply passes in silence.
 *
 * Files live in `public/sounds/commentary/` and are named `<key>-<n>.<ext>`,
 * numbered from 1. To add variants just drop in `capture-red-2.m4a`,
 * `arrival-2.m4a` and so on — they are discovered at runtime, no code change.
 */

/** Voice clip families. */
export type VoiceKey = 'arrival' | `capture-${PlayerColor}`;

const BASE = '/sounds/commentary';
const EXTENSION = 'm4a';
/** Upper bound on the probe for numbered variants. */
const MAX_VARIANTS = 12;
/** How far the effects are pulled down while a clip is speaking. */
const DUCK_LEVEL = 0.3;

/** Resolved variant lists per key; an empty array means "none, stay silent". */
const variants = new Map<VoiceKey, string[]>();
const pending = new Map<VoiceKey, Promise<string[]>>();
/** Last URL played per key, so a repeat is avoided when alternatives exist. */
const lastPlayed = new Map<VoiceKey, string>();

let speaking: HTMLAudioElement | null = null;

/**
 * Probes `<key>-1`, `<key>-2`, … until one is missing. Runs once per key and
 * is cached; any network failure just ends the list early.
 */
function discover(key: VoiceKey): Promise<string[]> {
  const done = variants.get(key);
  if (done) return Promise.resolve(done);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const probe = (async () => {
    const found: string[] = [];
    for (let n = 1; n <= MAX_VARIANTS; n++) {
      const url = `${BASE}/${key}-${n}.${EXTENSION}`;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) break;
        found.push(url);
      } catch {
        break; // offline or blocked — whatever we have is the list
      }
    }
    variants.set(key, found);
    pending.delete(key);
    return found;
  })();

  pending.set(key, probe);
  return probe;
}

function release() {
  speaking = null;
  setSfxDuck(1);
}

/** Plays one clip for `key`, or nothing at all if none exist. */
export async function playVoice(key: VoiceKey): Promise<void> {
  if (soundSettings.muted || soundSettings.voiceMuted) return;

  const urls = await discover(key);
  if (urls.length === 0) return; // no clip for this event: stay silent

  // Random pick, never the same one twice running while alternatives exist.
  const previous = lastPlayed.get(key);
  const choices = urls.length > 1 ? urls.filter(u => u !== previous) : urls;
  const url = choices[Math.floor(Math.random() * choices.length)];
  lastPlayed.set(key, url);

  try {
    // One voice at a time — a fresh line cuts off the previous one.
    if (speaking) {
      speaking.pause();
      speaking = null;
    }
    const audio = new Audio(url);
    speaking = audio;
    audio.addEventListener('ended', release, { once: true });
    audio.addEventListener('error', release, { once: true });
    setSfxDuck(DUCK_LEVEL);
    await audio.play();
  } catch {
    release(); // autoplay blocked or decode failed — silently give up
  }
}

/** Silences any clip in progress and restores the effect volume. */
export function stopVoice() {
  if (speaking) speaking.pause();
  release();
}

/**
 * Subscribes the voice layer to commentary events. Capture clips are keyed on
 * the colour of the token that was taken, not the player who took it.
 */
export function initVoice() {
  if (typeof window === 'undefined') return;
  window.addEventListener(COMMENTARY_EVENT, e => {
    const { event } = (e as CustomEvent<CommentaryDetail>).detail;
    // A capture carries its victim whether it was reported as a capture or as
    // a comeback, so the victim is the reliable signal.
    if (event.victim) {
      void playVoice(`capture-${event.victim}`);
      return;
    }
    if (event.type === 'home' || event.type === 'comeback') {
      void playVoice('arrival');
    }
  });
}
