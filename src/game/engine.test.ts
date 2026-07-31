import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  getLegalMoves,
  getMovePath,
  applyMove,
  registerDiceRoll,
  passTurn,
  getCapturingMoves,
  getDistinctMoveOutcomes,
  getLeadingToken,
  SAFE_SQUARES,
  START_OFFSET,
  FINISH,
  TRACK_END,
  HOME_COLUMN_LENGTH,
} from './engine';
import { getTokenCell } from './board';
import type { GameState, HouseRules } from './types';

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
  it('a token must land exactly on the centre', () => {
    const state = createInitialState();
    setPos(state, 'red-0', FINISH - 2);

    expect(getLegalMoves(state, 2).map(t => t.id)).toContain('red-0');
    expect(getLegalMoves(state, 3).map(t => t.id)).not.toContain('red-0');
  });

  it('reaching home grants an extra turn and completes a win', () => {
    const state = createInitialState();
    setPos(state, 'red-0', FINISH - 2);
    setPos(state, 'red-1', FINISH);
    setPos(state, 'red-2', FINISH);
    setPos(state, 'red-3', FINISH);

    const result = applyMove(state, 'red-0', 2);

    expect(result.tokens.find(t => t.id === 'red-0')!.position).toBe(FINISH);
    expect(result.currentPlayer).toBe('red'); // extra turn for reaching home
    expect(result.winner).toBe('red');
  });

  // The home column is 5 cells (52-56) and the last one steps straight into
  // the centre — there is no extra square in between.
  it('the home column is 5 cells and step 6 lands in the centre', () => {
    expect(FINISH - TRACK_END).toBe(HOME_COLUMN_LENGTH + 1);
    expect(HOME_COLUMN_LENGTH).toBe(5);

    // From the last track square a single 6 covers all 5 home cells + centre.
    const state = createInitialState();
    setPos(state, 'red-0', TRACK_END);
    expect(getLegalMoves(state, 6).map(t => t.id)).toContain('red-0');
    expect(applyMove(state, 'red-0', 6).tokens.find(t => t.id === 'red-0')!.position).toBe(FINISH);

    // And the final home cell needs exactly 1.
    const last = createInitialState();
    setPos(last, 'red-0', FINISH - 1);
    expect(getLegalMoves(last, 1).map(t => t.id)).toContain('red-0');
    expect(getLegalMoves(last, 2).map(t => t.id)).not.toContain('red-0');
  });

  it('every home-column position maps to its own board cell', () => {
    // 52..56 are the coloured cells; FINISH renders in the centre slots.
    const cells = new Set<string>();
    for (let p = TRACK_END + 1; p < FINISH; p++) {
      const { row, col } = getTokenCell({ id: 'red-0', color: 'red', position: p });
      cells.add(`${row},${col}`);
    }
    expect(cells.size).toBe(HOME_COLUMN_LENGTH);
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

describe('rule conformance', () => {
  it('a blockade cannot be captured, only avoided', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1);
    setPos(state, 'green-0', 44); // global 4 — an unsafe square
    setPos(state, 'green-1', 44);

    // The square is reachable in principle, but the block makes it illegal,
    // so there is no way to capture the pair.
    expect(getLegalMoves(state, 4).map(t => t.id)).not.toContain('red-0');
    expect(getCapturingMoves(state, 4)).toHaveLength(0);
  });

  it("a player's own blockade does not block their own tokens", () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1);
    setPos(state, 'red-1', 5);
    setPos(state, 'red-2', 5); // red's own pair sits on red's path

    expect(getLegalMoves(state, 6).map(t => t.id)).toContain('red-0');
  });

  // Reported from real play: a third token of the same colour could not get
  // past its own pair. Checked for every colour, since only red has a zero
  // start offset and a bug in the relative->global conversion would hide there.
  it('a third token passes its own blockade, for every colour', () => {
    for (const color of ['red', 'green', 'yellow', 'blue'] as const) {
      const state = createInitialState();
      state.currentPlayer = color;
      setPos(state, `${color}-0`, 4);
      setPos(state, `${color}-1`, 8); // pair sits mid-path
      setPos(state, `${color}-2`, 8);

      const legal = getLegalMoves(state, 6).map(t => t.id);
      expect(legal, `${color} should pass its own blockade`).toContain(`${color}-0`);
    }
  });

  it('a third token may also land on its own pair', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 4);
    setPos(state, 'red-1', 8);
    setPos(state, 'red-2', 8);

    expect(getLegalMoves(state, 4).map(t => t.id)).toContain('red-0');
  });

  it('an opponent blockade still blocks passage for every colour', () => {
    for (const color of ['red', 'green', 'yellow', 'blue'] as const) {
      const enemy = color === 'green' ? 'red' : 'green';
      const state = createInitialState();
      state.currentPlayer = color;
      setPos(state, `${color}-0`, 4);
      // Put the enemy pair on the global square that `color` reaches at rel 8.
      const global = (START_OFFSET[color] + 8 - 1) % 52;
      const enemyRel = ((global - START_OFFSET[enemy] + 52) % 52) + 1;
      setPos(state, `${enemy}-0`, enemyRel);
      setPos(state, `${enemy}-1`, enemyRel);

      const legal = getLegalMoves(state, 6).map(t => t.id);
      expect(legal, `${color} must be blocked by ${enemy}`).not.toContain(`${color}-0`);
    }
  });

  // House deviation: two tokens pile up on their own start square after a
  // couple of sixes, and letting that wall off the board makes for a bad game.
  it('a blockade on its own start square does not block opponents', () => {
    const state = createInitialState();
    state.currentPlayer = 'red';
    setPos(state, 'red-0', 10);
    // green's pair sits on green's own start square (global 13).
    setPos(state, 'green-0', 1);
    setPos(state, 'green-1', 1);
    expect(START_OFFSET.green).toBe(13);

    // red rel 14 == global 13, so a 4 passes straight over the pair.
    expect(getLegalMoves(state, 4).map(t => t.id)).toContain('red-0');
    expect(getLegalMoves(state, 6).map(t => t.id)).toContain('red-0');
  });

  it('the same blockade one square later does block', () => {
    const state = createInitialState();
    state.currentPlayer = 'red';
    setPos(state, 'red-0', 10);
    // one square past green's start: global 14, not a start square
    setPos(state, 'green-0', 2);
    setPos(state, 'green-1', 2);

    expect(getLegalMoves(state, 5).map(t => t.id)).not.toContain('red-0');
  });

  it('every coloured start square is a safe square', () => {
    for (const offset of Object.values(START_OFFSET)) {
      expect(SAFE_SQUARES).toContain(offset);
    }
  });

  it('a token standing on a start square cannot be captured', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 9);
    setPos(state, 'green-0', 40); // global 13 = green's own start square

    expect(SAFE_SQUARES).toContain(13);
    const result = applyMove(state, 'red-0', 5); // red lands rel 14 = global 13
    expect(result.tokens.find(t => t.id === 'green-0')!.position).toBe(40);
  });

  it('overshooting home makes that token illegal but leaves others playable', () => {
    const state = createInitialState();
    setPos(state, 'red-0', FINISH - 1); // needs exactly 1
    setPos(state, 'red-1', 20);

    const legal = getLegalMoves(state, 3).map(t => t.id);
    expect(legal).not.toContain('red-0');
    expect(legal).toContain('red-1');
  });

  it('getLeadingToken picks the furthest token still in play', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 12);
    setPos(state, 'red-1', 40);
    setPos(state, 'red-2', FINISH); // finished — never the "leader"
    expect(getLeadingToken(state.tokens, 'red')!.id).toBe('red-1');

    setPos(state, 'red-0', -1);
    setPos(state, 'red-1', -1);
    setPos(state, 'red-3', -1);
    expect(getLeadingToken(state.tokens, 'red')).toBeNull();
  });
});

describe('distinct move outcomes', () => {
  // Guards the "pointless choice" bug: identical tokens on one square are two
  // legal moves but only one outcome, so the player should never be asked.
  it('collapses two stacked tokens into a single outcome (the 6/6/3 case)', () => {
    let state = createInitialState();

    // Roll 6: bring red-0 out. Roll 6 again: bring red-1 out. Both now sit on
    // red's start square, position 1.
    state = registerDiceRoll(state, 6);
    state = applyMove(state, 'red-0', 6);
    expect(state.currentPlayer).toBe('red'); // extra turn from the 6
    state = registerDiceRoll(state, 6);
    state = applyMove(state, 'red-1', 6);

    const stacked = state.tokens.filter(t => t.id === 'red-0' || t.id === 'red-1');
    expect(stacked.map(t => t.position)).toEqual([1, 1]);

    // Roll 3: two legal moves, but they are indistinguishable.
    state = registerDiceRoll(state, 3);
    expect(getLegalMoves(state, 3).map(t => t.id).sort()).toEqual(['red-0', 'red-1']);
    expect(getDistinctMoveOutcomes(state, 3)).toHaveLength(1);
  });

  it('keeps genuinely different destinations separate', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1);
    setPos(state, 'red-1', 7); // different square -> different destination

    expect(getLegalMoves(state, 3)).toHaveLength(2);
    expect(getDistinctMoveOutcomes(state, 3)).toHaveLength(2);
  });

  it('separates stacked tokens once one of them can finish and the other cannot', () => {
    const state = createInitialState();
    const stacked = FINISH - 3;
    setPos(state, 'red-0', stacked);
    setPos(state, 'red-1', stacked);
    setPos(state, 'red-2', 20);

    // Both stacked tokens reach the centre; red-2 goes to 23. Two outcomes.
    const outcomes = getDistinctMoveOutcomes(state, 3);
    expect(outcomes).toHaveLength(2);
    expect(new Set(outcomes.map(t => (t.position === stacked ? FINISH : 23)))).toEqual(
      new Set([FINISH, 23]),
    );
  });

  it('treats stacked tokens as one outcome even when the move captures', () => {
    const state = createInitialState();
    setPos(state, 'red-0', 1);
    setPos(state, 'red-1', 1);
    setPos(state, 'green-0', 44); // global 4 — captured by either token with a 4

    expect(getLegalMoves(state, 4)).toHaveLength(2);
    expect(getDistinctMoveOutcomes(state, 4)).toHaveLength(1);
    expect(getCapturingMoves(state, 4)).toHaveLength(2);
  });

  it('all four tokens in base with a 6 is a single outcome', () => {
    const state = createInitialState();
    expect(getLegalMoves(state, 6)).toHaveLength(4);
    expect(getDistinctMoveOutcomes(state, 6)).toHaveLength(1);
  });
});

describe('house rules', () => {
  const withRules = (overrides: Partial<HouseRules>): GameState =>
    createInitialState(undefined, {
      mandatoryCapture: false,
      quickMode: false,
      threeSixesSendsLeaderToBase: false,
      ...overrides,
    });

  it('are all off by default', () => {
    expect(createInitialState().rules).toEqual({
      mandatoryCapture: false,
      quickMode: false,
      threeSixesSendsLeaderToBase: false,
    });
  });

  it('quick mode: the first token home wins', () => {
    const state = withRules({ quickMode: true });
    setPos(state, 'red-0', FINISH - 2);
    const result = applyMove(state, 'red-0', 2);
    expect(result.winner).toBe('red');
  });

  it('without quick mode the same move does not win', () => {
    const state = withRules({});
    setPos(state, 'red-0', FINISH - 2);
    expect(applyMove(state, 'red-0', 2).winner).toBeNull();
  });

  it('mandatory capture: ignoring a capture sends the leading token to base', () => {
    const state = withRules({ mandatoryCapture: true });
    setPos(state, 'red-0', 1); // with a 4 this captures green-0
    setPos(state, 'red-1', 30); // the leading token
    setPos(state, 'green-0', 44);

    expect(getCapturingMoves(state, 4).map(t => t.id)).toEqual(['red-0']);

    const result = applyMove(state, 'red-1', 4); // declines the capture
    expect(result.tokens.find(t => t.id === 'red-1')!.position).toBe(-1);
    expect(result.lastAction).toMatchObject({ penalizedTokenId: 'red-1' });
  });

  it('mandatory capture: taking the capture carries no penalty', () => {
    const state = withRules({ mandatoryCapture: true });
    setPos(state, 'red-0', 1);
    setPos(state, 'red-1', 30);
    setPos(state, 'green-0', 44);

    const result = applyMove(state, 'red-0', 4);
    expect(result.tokens.find(t => t.id === 'red-1')!.position).toBe(30);
    expect(result.tokens.find(t => t.id === 'green-0')!.position).toBe(-1);
  });

  it('mandatory capture is inert when no capture was on offer', () => {
    const state = withRules({ mandatoryCapture: true });
    setPos(state, 'red-0', 30);
    const result = applyMove(state, 'red-0', 3);
    expect(result.tokens.find(t => t.id === 'red-0')!.position).toBe(33);
    expect((result.lastAction as { penalizedTokenId?: string }).penalizedTokenId).toBeUndefined();
  });

  it('three-sixes penalty sends the leading token to base as well', () => {
    let state = withRules({ threeSixesSendsLeaderToBase: true });
    setPos(state, 'red-0', 30);

    state = registerDiceRoll(state, 6);
    state = registerDiceRoll({ ...state, diceValue: null }, 6);
    state = registerDiceRoll({ ...state, diceValue: null }, 6);

    expect(state.tokens.find(t => t.id === 'red-0')!.position).toBe(-1);
    expect(state.lastAction).toMatchObject({ type: 'forfeitSixes', penalizedTokenId: 'red-0' });
    expect(state.currentPlayer).toBe('green');
  });

  it('without the penalty rule three sixes only forfeits the turn', () => {
    let state = withRules({});
    setPos(state, 'red-0', 30);

    state = registerDiceRoll(state, 6);
    state = registerDiceRoll({ ...state, diceValue: null }, 6);
    state = registerDiceRoll({ ...state, diceValue: null }, 6);

    expect(state.tokens.find(t => t.id === 'red-0')!.position).toBe(30);
    expect(state.currentPlayer).toBe('green');
  });
});

describe('extra-turn chains keep re-evaluating legal moves', () => {
  // Regression guard for the auto-move bug: the single-legal-move check must
  // stay correct on the third (and later) roll of one extra-turn chain, not
  // just the first.
  it('reports exactly one legal move on every roll of a 3-deep chain', () => {
    let state = createInitialState();
    setPos(state, 'red-0', FINISH - 6);
    setPos(state, 'red-1', FINISH - 5);
    setPos(state, 'red-2', FINISH - 4);
    setPos(state, 'red-3', FINISH);

    // Roll 1 of the chain: only red-0 can land exactly on the centre.
    state = registerDiceRoll(state, 6);
    expect(state.diceValue).toBe(6);
    let legal = getLegalMoves(state, 6);
    expect(legal.map(t => t.id)).toEqual(['red-0']);
    state = applyMove(state, 'red-0', 6);
    expect(state.currentPlayer).toBe('red'); // extra turn for reaching home

    // Roll 2 of the same chain.
    state = registerDiceRoll(state, 5);
    legal = getLegalMoves(state, 5);
    expect(legal.map(t => t.id)).toEqual(['red-1']);
    state = applyMove(state, 'red-1', 5);
    expect(state.currentPlayer).toBe('red');

    // Roll 3 of the same chain — the case that used to leave the player stuck.
    state = registerDiceRoll(state, 4);
    legal = getLegalMoves(state, 4);
    expect(legal.map(t => t.id)).toEqual(['red-2']);
    state = applyMove(state, 'red-2', 4);

    expect(state.winner).toBe('red');
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
