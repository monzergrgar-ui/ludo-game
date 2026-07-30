import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  getLegalMoves,
  getMovePath,
  applyMove,
  registerDiceRoll,
  passTurn,
  SAFE_SQUARES,
} from './engine';
import type { GameState } from './types';

/** Mutates a token's position in place — test setup convenience. */
function setPos(state: GameState, id: string, pos: number) {
  state.tokens.find(t => t.id === id)!.position = pos;
}

// Relative-position cheat sheet used below (see START_OFFSET):
//   red rel p   -> global (p - 1) % 52
//   green rel p -> global (13 + p - 1) % 52
// So green rel 44 sits on global 4, which red reaches at rel 5.

describe('base exit', () => {
  it('requires a 6 to leave base', () => {
    const state = createInitialState();
    expect(getLegalMoves(state, 3)).toHaveLength(0);
    expect(getLegalMoves(state, 6)).toHaveLength(4);
  });

  it('getMovePath from base is a single entry step, regardless of dice', () => {
    const token = { id: 'red-0', color: 'red', position: -1 } as const;
    expect(getMovePath(token, 6)).toEqual([1]);
  });
});

describe('capturing', () => {
  it('sends an opponent token back to base and grants an extra turn', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1);
    setPos(state, 'green-0', 44); // global 4, where red-0 lands with a 4

    const result = applyMove(state, 'red-0', 4);

    expect(result.tokens.find(t => t.id === 'green-0')!.position).toBe(-1);
    expect(result.lastAction).toMatchObject({ type: 'move', captured: ['green-0'] });
    expect(result.currentPlayer).toBe('red'); // extra turn for the capture
  });

  it('does not capture on a safe square', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 5);
    setPos(state, 'green-0', 48); // global 8 — a safe square

    expect(SAFE_SQUARES).toContain(8);
    const result = applyMove(state, 'red-0', 4); // red-0 lands rel 9 = global 8

    expect(result.tokens.find(t => t.id === 'green-0')!.position).toBe(48);
    expect(result.lastAction).toMatchObject({ type: 'move', captured: [] });
    expect(result.currentPlayer).toBe('green'); // no capture, no 6 — turn passes
  });
});

describe('blocks', () => {
  it('two same-color tokens block opponents from landing on that square', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1);
    setPos(state, 'green-0', 44); // global 4
    setPos(state, 'green-1', 44);

    const legal = getLegalMoves(state, 4); // red-0 would land exactly on the block
    expect(legal.map(t => t.id)).not.toContain('red-0');
  });

  it('blocks also stop opponents from passing through', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1);
    setPos(state, 'green-0', 44);
    setPos(state, 'green-1', 44);

    expect(getLegalMoves(state, 5).map(t => t.id)).not.toContain('red-0'); // passes over global 4
    expect(getLegalMoves(state, 2).map(t => t.id)).toContain('red-0'); // stops short of it
  });

  it('a single opponent token does not block', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1);
    setPos(state, 'green-0', 44);

    expect(getLegalMoves(state, 5).map(t => t.id)).toContain('red-0');
  });
});

describe('exact count to finish', () => {
  it('a token must land exactly on 58', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 56);

    expect(getLegalMoves(state, 2).map(t => t.id)).toContain('red-0');
    expect(getLegalMoves(state, 3).map(t => t.id)).not.toContain('red-0');
  });

  it('reaching home grants an extra turn and completes a win', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 56);
    setPos(state, 'red-1', 58);
    setPos(state, 'red-2', 58);
    setPos(state, 'red-3', 58);

    const result = applyMove(state, 'red-0', 2);

    expect(result.tokens.find(t => t.id === 'red-0')!.position).toBe(58);
    expect(result.currentPlayer).toBe('red'); // extra turn for reaching home
    expect(result.winner).toBe('red');
  });
});

describe('three sixes forfeit', () => {
  it('forfeits the turn on the third consecutive 6', () => {
    let state = createInitialState();

    state = registerDiceRoll(state, 6);
    expect(state.consecutiveSixes).toBe(1);
    expect(state.diceValue).toBe(6);

    state = registerDiceRoll({ ...state, diceValue: null }, 6);
    expect(state.consecutiveSixes).toBe(2);

    state = registerDiceRoll({ ...state, diceValue: null }, 6);
    expect(state.diceValue).toBeNull();
    expect(state.consecutiveSixes).toBe(0);
    expect(state.currentPlayer).toBe('green');
    expect(state.lastAction).toEqual({ type: 'forfeitSixes', player: 'red' });
  });

  it('a non-6 resets the consecutive counter', () => {
    let state = createInitialState();
    state = registerDiceRoll(state, 6);
    state = registerDiceRoll({ ...state, diceValue: null }, 4);
    expect(state.consecutiveSixes).toBe(0);
    expect(state.diceValue).toBe(4);
  });
});

describe('extra turns', () => {
  it('rolling a 6 keeps the turn after moving', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 10);
    const result = applyMove(state, 'red-0', 6);
    expect(result.currentPlayer).toBe('red');
  });

  it('an ordinary move passes the turn', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 10);
    const result = applyMove(state, 'red-0', 3);
    expect(result.currentPlayer).toBe('green');
  });
});

describe('turn passing and 2-3 player games', () => {
  it('passTurn advances to the next active player and resets dice state', () => {
    const state = registerDiceRoll(createInitialState(), 2);
    const result = passTurn(state);
    expect(result.currentPlayer).toBe('green');
    expect(result.diceValue).toBeNull();
    expect(result.consecutiveSixes).toBe(0);
    expect(result.lastAction).toEqual({ type: 'pass', player: 'red' });
  });

  it('a 2-player game only creates tokens for and cycles between those seats', () => {
    const state = createInitialState(['red', 'yellow']);
    expect(state.tokens).toHaveLength(8);
    expect(state.currentPlayer).toBe('red');

    setPos(state, 'red-0', 10);
    const afterMove = applyMove(state, 'red-0', 3);
    expect(afterMove.currentPlayer).toBe('yellow'); // green/blue are not seated

    const afterPass = passTurn(afterMove);
    expect(afterPass.currentPlayer).toBe('red'); // wraps around
  });

  it('a 3-player game cycles through all three seats', () => {
    let state = createInitialState(['red', 'green', 'yellow']);
    state = passTurn(state);
    expect(state.currentPlayer).toBe('green');
    state = passTurn(state);
    expect(state.currentPlayer).toBe('yellow');
    state = passTurn(state);
    expect(state.currentPlayer).toBe('red');
  });
});
