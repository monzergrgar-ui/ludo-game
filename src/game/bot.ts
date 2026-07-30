import type { GameState, Token } from './types';
import { applyMove, START_OFFSET, SAFE_SQUARES } from './engine';

/**
 * A bot picks one of the legal tokens to move. The interface is deliberately
 * minimal so an LLM-backed personality bot can be swapped in later without
 * touching the engine: anything that maps (state, legalMoves, dice) -> tokenId.
 */
export type GetBotMove = (
  state: GameState,
  legalMoves: Token[],
  dice: number,
) => string | Promise<string>;

function isSafePosition(token: Token, position: number): boolean {
  if (position > 51) return true; // home stretch / finished — unreachable by opponents
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
  if (moved.position === 58) score += 60;
  // Ending on a square opponents can't capture.
  if (moved.position !== 58 && isSafePosition(moved, moved.position)) score += 40;
  // Bringing a fresh token into play.
  if (token.position === -1) score += 25;
  // Raw progress: prefer advancing the token that's furthest along.
  if (token.position >= 1) score += token.position / 10;
  return score;
}

/** Default rule-based bot: capture > reach-safety > progress. */
export const ruleBasedBot: GetBotMove = (state, legalMoves, dice) => {
  let best = legalMoves[0];
  let bestScore = -Infinity;
  for (const token of legalMoves) {
    const score = scoreMove(state, token, dice);
    if (score > bestScore) {
      bestScore = score;
      best = token;
    }
  }
  return best.id;
};
