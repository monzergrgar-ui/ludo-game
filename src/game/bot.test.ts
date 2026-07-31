import { describe, it, expect } from 'vitest';
import { createInitialState, getLegalMoves, FINISH } from './engine';
import { ruleBasedBot } from './bot';
import type { GameState } from './types';

function setPos(state: GameState, id: string, pos: number) {
  state.tokens.find(t => t.id === id)!.position = pos;
}

/** Puts values on the queue and moves the state into the allocation phase. */
function queued(state: GameState, ...values: number[]): GameState {
  return { ...state, diceQueue: values, phase: 'moving' };
}

describe('ruleBasedBot', () => {
  it('prefers a capture over plain progress', async () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1); // with a 4, lands on green-0 (global 4)
    setPos(state, 'red-1', 20); // with a 4, plain progress
    setPos(state, 'green-0', 44);

    expect(getLegalMoves(queued(state, 4), 4).map(t => t.id).sort()).toEqual(['red-0', 'red-1']);

    expect(await ruleBasedBot(queued(state, 4))).toMatchObject({ tokenId: 'red-0', dice: 4 });
  });

  it('prefers reaching a safe square over plain progress', async () => {
    const state = createInitialState();
    setPos(state, 'red-0', 5); // with a 4, lands rel 9 = global 8 (safe)
    setPos(state, 'red-1', 30); // with a 4, plain progress

    expect(await ruleBasedBot(queued(state, 4))).toMatchObject({ tokenId: 'red-0' });
  });

  it('prefers finishing a token over a safe square', async () => {
    const state = createInitialState();
    setPos(state, 'red-0', FINISH - 4); // with a 4, lands exactly on the centre
    setPos(state, 'red-1', 5); // with a 4, lands on safe global 8

    expect(await ruleBasedBot(queued(state, 4))).toMatchObject({ tokenId: 'red-0' });
  });

  it('always returns one of the legal moves', async () => {
    const state = queued(createInitialState(), 6); // everyone still in base
    const choice = await ruleBasedBot(state);
    expect(getLegalMoves(state, 6).map(t => t.id)).toContain(choice!.tokenId);
    expect(choice!.dice).toBe(6);
  });

  it('returns null when nothing in the queue is playable', async () => {
    // Everyone in base and no 6 available.
    expect(await ruleBasedBot(queued(createInitialState(), 3))).toBeNull();
  });

  it('allocates across a queue, taking the capture over the bigger number', async () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1); // a 4 from here captures green-0
    setPos(state, 'red-1', 20); // a 6 from here is plain progress
    setPos(state, 'green-0', 44);

    const choice = await ruleBasedBot(queued(state, 6, 4));
    expect(choice).toMatchObject({ tokenId: 'red-0', dice: 4 });
  });
});
