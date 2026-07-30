import { describe, it, expect } from 'vitest';
import { createInitialState, getLegalMoves } from './engine';
import { ruleBasedBot } from './bot';
import type { GameState } from './types';

function setPos(state: GameState, id: string, pos: number) {
  state.tokens.find(t => t.id === id)!.position = pos;
}

describe('ruleBasedBot', () => {
  it('prefers a capture over plain progress', async () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1); // with a 4, lands on green-0 (global 4)
    setPos(state, 'red-1', 20); // with a 4, plain progress
    setPos(state, 'green-0', 44);

    const legal = getLegalMoves(state, 4);
    expect(legal.map(t => t.id).sort()).toEqual(['red-0', 'red-1']);

    expect(await ruleBasedBot(state, legal, 4)).toBe('red-0');
  });

  it('prefers reaching a safe square over plain progress', async () => {
    const state = createInitialState();
    setPos(state, 'red-0', 5); // with a 4, lands rel 9 = global 8 (safe)
    setPos(state, 'red-1', 30); // with a 4, plain progress

    const legal = getLegalMoves(state, 4);
    expect(await ruleBasedBot(state, legal, 4)).toBe('red-0');
  });

  it('prefers finishing a token over a safe square', async () => {
    const state = createInitialState();
    setPos(state, 'red-0', 54); // with a 4, lands exactly on 58 (home)
    setPos(state, 'red-1', 5); // with a 4, lands on safe global 8

    const legal = getLegalMoves(state, 4);
    expect(await ruleBasedBot(state, legal, 4)).toBe('red-0');
  });

  it('always returns one of the legal moves', async () => {
    const state = createInitialState();
    const legal = getLegalMoves(state, 6); // everyone still in base
    const choice = await ruleBasedBot(state, legal, 6);
    expect(legal.map(t => t.id)).toContain(choice);
  });
});
