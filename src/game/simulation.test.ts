import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  rollDice,
  registerDiceRoll,
  getLegalMoves,
  applyMove,
  passTurn,
} from './engine';
import { ruleBasedBot } from './bot';
import type { GameState } from './types';

function assertValid(state: GameState, turn: number) {
  if (state.tokens.length !== 16) {
    throw new Error(`turn ${turn}: expected 16 tokens, got ${state.tokens.length}`);
  }
  for (const t of state.tokens) {
    const ok = t.position === -1 || (t.position >= 1 && t.position <= 58);
    if (!ok) throw new Error(`turn ${turn}: token ${t.id} at invalid position ${t.position}`);
  }
  if (!state.players.includes(state.currentPlayer)) {
    throw new Error(`turn ${turn}: current player ${state.currentPlayer} is not seated`);
  }
}

/**
 * Headless full games: four rule-based bots play to completion through the
 * same engine calls the UI makes. Guards against stalls, invalid positions,
 * and broken turn rotation.
 */
describe('full-game bot simulation', () => {
  it('plays 20 complete 4-bot games without stalling or corrupting state', async () => {
    for (let game = 0; game < 20; game++) {
      let state = createInitialState();
      let turns = 0;
      const MAX_TURNS = 20000;

      while (!state.winner && turns < MAX_TURNS) {
        turns++;
        const dice = rollDice();
        state = registerDiceRoll(state, dice);
        assertValid(state, turns);
        if (state.diceValue === null) continue; // three-sixes forfeit

        const legal = getLegalMoves(state, dice);
        if (legal.length === 0) {
          state = passTurn(state);
          continue;
        }
        const tokenId = await ruleBasedBot(state, legal, dice);
        expect(legal.map(t => t.id)).toContain(tokenId);
        state = applyMove(state, tokenId, dice);
        assertValid(state, turns);
      }

      expect(state.winner).not.toBeNull();
      expect(
        state.tokens.filter(t => t.color === state.winner).every(t => t.position === 58),
      ).toBe(true);
    }
  }, 30000);
});
