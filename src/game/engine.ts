import type { GameState, Token, PlayerColor, HouseRules } from './types';

/** Standard Ludo: every optional rule off. */
export const DEFAULT_RULES: HouseRules = {
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
    diceValue: null,
    winner: null,
    consecutiveSixes: 0,
    lastAction: null,
    rules,
  };
}

// Where each color enters the shared 52-square loop.
export const START_OFFSET: Record<PlayerColor, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const SAFE_SQUARES = [0, 8, 13, 21, 26, 34, 39, 47];

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

/** A square with 2+ same-color tokens is a block: opponents can't land on it or pass through it. */
function isPathBlocked(tokens: Token[], token: Token, dice: number): boolean {
  const occupancy = getGlobalOccupancy(tokens);
  for (const relPos of getMovePath(token, dice)) {
    if (relPos < 1 || relPos > 51) continue; // home stretch is private, never blocked
    const global = getGlobalPosition(token.color, relPos);
    if (global === null) continue;
    const counts = occupancy.get(global);
    if (!counts) continue;
    for (const color of colors) {
      if (color !== token.color && (counts[color] ?? 0) >= 2) return true;
    }
  }
  return false;
}

function canMove(state: GameState, token: Token, dice: number): boolean {
  if (token.position === -1) {
    if (dice !== 6) return false;
  } else {
    if (token.position >= 58) return false;
    if (token.position + dice > 58) return false; // must land exactly on 58
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
    // Destination covers home entry (58) and the home stretch implicitly.
    const key = `${destination}|${captured}`;
    if (!byOutcome.has(key)) byOutcome.set(key, token);
  }
  return [...byOutcome.values()];
}

/**
 * A player's most advanced token that is still in play — used by the house
 * rules that send the "leading token" back to base. Finished tokens (58) and
 * tokens already in base are never eligible.
 */
export function getLeadingToken(tokens: Token[], color: PlayerColor): Token | null {
  let leader: Token | null = null;
  for (const t of tokens) {
    if (t.color !== color || t.position < 1 || t.position >= 58) continue;
    if (!leader || t.position > leader.position) leader = t;
  }
  return leader;
}

function getNextPlayer(state: GameState): PlayerColor {
  const { players, currentPlayer } = state;
  return players[(players.indexOf(currentPlayer) + 1) % players.length];
}

/**
 * Records a dice roll. Tracks consecutive 6s and forfeits the turn (no move allowed)
 * on the 3rd 6 in a row, per classic Ludo rules.
 */
export function registerDiceRoll(state: GameState, dice: number): GameState {
  if (dice !== 6) {
    return { ...state, diceValue: dice, consecutiveSixes: 0 };
  }
  const consecutiveSixes = state.consecutiveSixes + 1;
  if (consecutiveSixes >= 3) {
    // The third 6 is forfeited and the turn ends. House rule optionally adds
    // a penalty: the player's leading token also goes back to base.
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
      tokens,
      diceValue: null,
      consecutiveSixes: 0,
      currentPlayer: getNextPlayer(state),
      lastAction: { type: 'forfeitSixes', player: state.currentPlayer, penalizedTokenId },
    };
  }
  return { ...state, diceValue: dice, consecutiveSixes };
}

/** Advances the turn when the current player has no legal moves for the rolled dice. */
export function passTurn(state: GameState): GameState {
  return {
    ...state,
    currentPlayer: getNextPlayer(state),
    diceValue: null,
    consecutiveSixes: 0,
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
      ? own.some(t => t.position === 58)
      : own.every(t => t.position === 58)
  )
    ? token.color
    : null;

  const reachedHome = token.position === 58;
  const extraTurn = dice === 6 || captured.length > 0 || reachedHome;

  return {
    ...state,
    tokens,
    currentPlayer: extraTurn ? state.currentPlayer : getNextPlayer(state),
    diceValue: null,
    winner,
    lastAction: { type: 'move', tokenId, from, to: token.position, captured, penalizedTokenId },
  };
}
