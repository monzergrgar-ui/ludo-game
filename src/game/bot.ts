import type { GameState, Token } from './types';
import {
  applyMove,
  getLegalMoves,
  getPlayableDice,
  START_OFFSET,
  SAFE_SQUARES,
  FINISH,
  TRACK_END,
} from './engine';

/** One allocation: spend `dice` from the queue on `tokenId`. */
export interface BotMove {
  tokenId: string;
  dice: number;
}

/**
 * A bot chooses which queued value to spend and which token to spend it on.
 * The interface is deliberately minimal so an LLM-backed personality bot can
 * be swapped in later without touching the engine: state -> one allocation.
 * Returns null when nothing is playable.
 */
export type GetBotMove = (state: GameState) => BotMove | null | Promise<BotMove | null>;

function isSafePosition(token: Token, position: number): boolean {
  if (position > TRACK_END) return true; // home column / finished — unreachable by opponents
  if (position < 1) return false;
  const global = (START_OFFSET[token.color] + position - 1) % 52;
  return SAFE_SQUARES.includes(global);
}

/** Scores one legal move by simulating it. Higher is better. */
function scoreMove(state: GameState, token: Token, dice: number): number {
  const result = applyMove(state, token.id, dice);
  const action = result.lastAction;
  const moved = result.tokens.find(t => t.id === token.id)!;

  let score = 0;
  // Captures dominate everything else.
  if (action?.type === 'move') score += action.captured.length * 100;
  // Getting a token all the way home.
  if (moved.position === FINISH) score += 60;
  // Ending on a square opponents can't capture.
  if (moved.position !== FINISH && isSafePosition(moved, moved.position)) score += 40;
  // Bringing a fresh token into play.
  if (token.position === -1) score += 25;
  // Raw progress: prefer advancing the token that's furthest along.
  if (token.position >= 1) score += token.position / 10;
  return score;
}

/**
 * Default rule-based bot: capture > reach-safety > progress.
 *
 * With a queue of several values it scores every (value, token) pairing and
 * takes the single best one, so it will happily spend a 6 to break a token out
 * before spending a 3 elsewhere — or the reverse, if that scores higher.
 * Ties break toward spending the larger value first, which keeps the awkward
 * small numbers in hand for the home column.
 */
export const ruleBasedBot: GetBotMove = state => {
  let best: BotMove | null = null;
  let bestScore = -Infinity;

  for (const dice of getPlayableDice(state)) {
    for (const token of getLegalMoves(state, dice)) {
      const score = scoreMove(state, token, dice);
      if (score > bestScore || (score === bestScore && best !== null && dice > best.dice)) {
        bestScore = score;
        best = { tokenId: token.id, dice };
      }
    }
  }
  return best;
};
