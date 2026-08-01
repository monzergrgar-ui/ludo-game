import type { GameState, Token, PlayerColor, HouseRules, LastAction } from './types';

/** Standard Ludo: every optional rule off, roll-all-first on. */
export const DEFAULT_RULES: HouseRules = {
  rollAllFirst: true,
  mandatoryCapture: false,
  quickMode: false,
  threeSixesSendsLeaderToBase: false,
};

/** Isolated on purpose — swap this out for a provably-fair implementation later. */
export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

const colors: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

export function createInitialState(
  players: PlayerColor[] = colors,
  rules: HouseRules = DEFAULT_RULES,
): GameState {
  const tokens: Token[] = [];
  for (const color of players) {
    for (let i = 0; i < 4; i++) {
      tokens.push({ id: `${color}-${i}`, color, position: -1 });
    }
  }
  return {
    tokens,
    players,
    currentPlayer: players[0],
    diceQueue: [],
    phase: 'rolling',
    extraRoll: false,
    winner: null,
    consecutiveSixes: 0,
    lastAction: null,
    rules,
  };
}

// Where each color enters the shared 52-square loop.
export const START_OFFSET: Record<PlayerColor, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const SAFE_SQUARES = [0, 8, 13, 21, 26, 34, 39, 47];

/** Last shared-track position; a token walks 51 ring squares from its start. */
export const TRACK_END = 51;
/** Coloured home column: 5 cells, positions 52-56. */
export const HOME_COLUMN_LENGTH = 5;
/**
 * The centre goal. A token steps from the final home-column cell (56)
 * straight into it — there is no square in between.
 */
export const FINISH = TRACK_END + HOME_COLUMN_LENGTH + 1; // 57

function getGlobalPosition(color: PlayerColor, position: number): number | null {
  if (position < 1 || position > 51) return null;
  return (START_OFFSET[color] + position - 1) % 52;
}

/** Relative positions a token passes through for a dice roll (excludes its current cell). */
export function getMovePath(token: Token, dice: number): number[] {
  // Leaving base is always a single entry step onto square 1, regardless of the dice value.
  if (token.position === -1) return [1];
  const path: number[] = [];
  for (let p = token.position + 1; p <= token.position + dice; p++) path.push(p);
  return path;
}

function getGlobalOccupancy(tokens: Token[]): Map<number, Partial<Record<PlayerColor, number>>> {
  const map = new Map<number, Partial<Record<PlayerColor, number>>>();
  for (const t of tokens) {
    if (t.position < 1 || t.position > 51) continue;
    const g = getGlobalPosition(t.color, t.position)!;
    const entry = map.get(g) ?? {};
    entry[t.color] = (entry[t.color] ?? 0) + 1;
    map.set(g, entry);
  }
  return map;
}

/**
 * A square with 2+ same-color tokens is a block: opponents can't land on it or
 * pass through it. Two deliberate carve-outs:
 *  - Your own blockade never restricts your own tokens.
 *  - A blockade sitting on its owner's coloured START square is not a barrier.
 *    Tokens pile up there naturally after a couple of sixes, and letting that
 *    wall off a quarter of the board makes for a miserable game. This is a
 *    house deviation from the strict rule, applied always.
 */
function isPathBlocked(tokens: Token[], token: Token, dice: number): boolean {
  const occupancy = getGlobalOccupancy(tokens);
  for (const relPos of getMovePath(token, dice)) {
    if (relPos < 1 || relPos > TRACK_END) continue; // home column is private
    const global = getGlobalPosition(token.color, relPos);
    if (global === null) continue;
    const counts = occupancy.get(global);
    if (!counts) continue;
    for (const color of colors) {
      if (color === token.color) continue; // own tokens are never an obstacle
      if ((counts[color] ?? 0) < 2) continue;
      if (START_OFFSET[color] === global) continue; // blockade on its own start
      return true;
    }
  }
  return false;
}

function canMove(state: GameState, token: Token, dice: number): boolean {
  if (token.position === -1) {
    if (dice !== 6) return false;
  } else {
    if (token.position >= FINISH) return false;
    if (token.position + dice > FINISH) return false; // must land exactly on FINISH
  }
  return !isPathBlocked(state.tokens, token, dice);
}

export function getLegalMoves(state: GameState, dice: number): Token[] {
  return state.tokens.filter(t => t.color === state.currentPlayer && canMove(state, t, dice));
}

/** Where a token ends up for a dice value (base exit is always square 1). */
function destinationOf(token: Token, dice: number): number {
  return token.position === -1 ? 1 : token.position + dice;
}

/** Opponent tokens that a move landing on `destination` would send home. */
function getCapturedIds(tokens: Token[], color: PlayerColor, destination: number): string[] {
  if (destination < 1 || destination > 51) return [];
  const global = getGlobalPosition(color, destination);
  if (global === null || SAFE_SQUARES.includes(global)) return [];
  return tokens
    .filter(
      other =>
        other.color !== color &&
        other.position >= 1 &&
        other.position <= 51 &&
        getGlobalPosition(other.color, other.position) === global,
    )
    .map(other => other.id);
}

/** Legal moves that would capture at least one opponent token. */
export function getCapturingMoves(state: GameState, dice: number): Token[] {
  return getLegalMoves(state, dice).filter(
    token => getCapturedIds(state.tokens, token.color, destinationOf(token, dice)).length > 0,
  );
}

/**
 * Legal moves reduced to one representative per *distinct outcome*.
 *
 * Two tokens of the same colour sitting on the same square produce identical
 * results — same destination, same captures, same home entry — so offering
 * both as a choice is meaningless. Callers should ask the player to choose
 * only when this returns more than one move.
 */
export function getDistinctMoveOutcomes(state: GameState, dice: number): Token[] {
  const byOutcome = new Map<string, Token>();
  for (const token of getLegalMoves(state, dice)) {
    const destination = destinationOf(token, dice);
    const captured = getCapturedIds(state.tokens, token.color, destination).sort().join(',');
    // Destination covers home entry and the home column implicitly.
    const key = `${destination}|${captured}`;
    if (!byOutcome.has(key)) byOutcome.set(key, token);
  }
  return [...byOutcome.values()];
}

/**
 * A player's most advanced token that is still in play — used by the house
 * rules that send the "leading token" back to base. Finished tokens and
 * tokens already in base are never eligible.
 */
export function getLeadingToken(tokens: Token[], color: PlayerColor): Token | null {
  let leader: Token | null = null;
  for (const t of tokens) {
    if (t.color !== color || t.position < 1 || t.position >= FINISH) continue;
    if (!leader || t.position > leader.position) leader = t;
  }
  return leader;
}

function getNextPlayer(state: GameState): PlayerColor {
  const { players, currentPlayer } = state;
  return players[(players.indexOf(currentPlayer) + 1) % players.length];
}

/**
 * Whether a completed move landed a token in the centre. Derived here rather
 * than compared against a literal at the call site — a stale `=== 58` in the
 * UI silently disabled the home sound, sparkle and voice clip once FINISH
 * moved to 57.
 */
export function moveReachedHome(action: LastAction): boolean {
  return action?.type === 'move' && action.to === FINISH;
}

/**
 * Whether `color` may roll right now. Every player's die is on screen at once,
 * so this must be checked per die: without it a tap on an idle player's die
 * rolls for whoever's turn it actually is.
 */
export function isRollAllowed(state: GameState, color: PlayerColor): boolean {
  return !state.winner && state.phase === 'rolling' && state.currentPlayer === color;
}

/** The distinct queued values that currently have at least one legal move. */
export function getPlayableDice(state: GameState): number[] {
  const seen = new Set<number>();
  const playable: number[] = [];
  for (const value of state.diceQueue) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (getLegalMoves(state, value).length > 0) playable.push(value);
  }
  return playable;
}

/** Everything that resets when a turn ends, whoever it passes to. */
function endOfTurn() {
  return { diceQueue: [], phase: 'rolling' as const, consecutiveSixes: 0, extraRoll: false };
}

/**
 * Records a dice roll onto this turn's queue.
 *
 * With `rollAllFirst` (the default) a 6 keeps the player in the rolling phase,
 * so values accumulate — 6, 6, 3 — and are spent afterwards in any order. A
 * third consecutive 6 voids the whole turn before any move is made. Without
 * the rule, every roll moves straight to the moving phase and a 6 earns its
 * extra turn after the move instead.
 */
export function registerDiceRoll(state: GameState, dice: number): GameState {
  if (dice !== 6) {
    return {
      ...state,
      diceQueue: [...state.diceQueue, dice],
      phase: 'moving',
      consecutiveSixes: 0,
    };
  }
  const consecutiveSixes = state.consecutiveSixes + 1;
  if (consecutiveSixes >= 3) {
    // The third 6 is forfeited and the turn ends, discarding anything still
    // queued. House rule optionally sends the leading token back to base too.
    let tokens = state.tokens;
    let penalizedTokenId: string | undefined;
    if (state.rules.threeSixesSendsLeaderToBase) {
      const leader = getLeadingToken(tokens, state.currentPlayer);
      if (leader) {
        penalizedTokenId = leader.id;
        tokens = tokens.map(t => (t.id === leader.id ? { ...t, position: -1 } : t));
      }
    }
    return {
      ...state,
      ...endOfTurn(),
      tokens,
      currentPlayer: getNextPlayer(state),
      lastAction: { type: 'forfeitSixes', player: state.currentPlayer, penalizedTokenId },
    };
  }
  return {
    ...state,
    diceQueue: [...state.diceQueue, dice],
    phase: state.rules.rollAllFirst ? 'rolling' : 'moving',
    consecutiveSixes,
  };
}

/** Advances the turn when nothing in the queue can be played. */
export function passTurn(state: GameState): GameState {
  return {
    ...state,
    ...endOfTurn(),
    currentPlayer: getNextPlayer(state),
    lastAction: { type: 'pass', player: state.currentPlayer },
  };
}

export function applyMove(state: GameState, tokenId: string, dice: number): GameState {
  // Checked before the move: the mandatory-capture house rule punishes passing
  // up an available capture.
  const captureWasAvailable =
    state.rules.mandatoryCapture && getCapturingMoves(state, dice).length > 0;

  const tokens = state.tokens.map(t => ({ ...t }));
  const token = tokens.find(t => t.id === tokenId)!;
  const from = token.position;

  token.position = token.position === -1 ? 1 : token.position + dice;

  const captured = getCapturedIds(tokens, token.color, token.position);
  for (const id of captured) {
    tokens.find(t => t.id === id)!.position = -1; // back to base
  }

  // Mandatory capture: a capture was on offer but this move didn't take it.
  let penalizedTokenId: string | undefined;
  if (captureWasAvailable && captured.length === 0) {
    const leader = getLeadingToken(tokens, token.color);
    if (leader) {
      penalizedTokenId = leader.id;
      leader.position = -1;
    }
  }

  const own = tokens.filter(t => t.color === token.color);
  const winner = (
    state.rules.quickMode
      ? own.some(t => t.position === FINISH)
      : own.every(t => t.position === FINISH)
  )
    ? token.color
    : null;

  const reachedHome = token.position === FINISH;
  // A 6 only buys an extra turn in classic order; with rollAllFirst it has
  // already bought an extra roll during the rolling phase.
  const earnedRoll =
    captured.length > 0 || reachedHome || (!state.rules.rollAllFirst && dice === 6);
  const extraRoll = state.extraRoll || earnedRoll;

  // Spend exactly one instance of the value used.
  const spentAt = state.diceQueue.indexOf(dice);
  const diceQueue =
    spentAt === -1
      ? [...state.diceQueue]
      : [...state.diceQueue.slice(0, spentAt), ...state.diceQueue.slice(spentAt + 1)];

  const lastAction: LastAction = {
    type: 'move',
    tokenId,
    from,
    to: token.position,
    captured,
    penalizedTokenId,
  };
  const moved: GameState = { ...state, tokens, diceQueue, winner, lastAction };
  if (winner) return { ...moved, ...endOfTurn() };

  // Values left over that nothing can use are discarded rather than stranding
  // the turn — the player keeps going only while something is playable.
  if (getPlayableDice(moved).length > 0) return { ...moved, phase: 'moving' };

  // Queue exhausted: an earned extra turn sends the player back to rolling,
  // otherwise play passes on.
  return {
    ...moved,
    ...endOfTurn(),
    currentPlayer: extraRoll ? state.currentPlayer : getNextPlayer(state),
  };
}
