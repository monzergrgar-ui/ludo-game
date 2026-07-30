import type { GameState, Token, PlayerColor } from './types';

/** Isolated on purpose — swap this out for a provably-fair implementation later. */
export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

const colors: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

export function createInitialState(players: PlayerColor[] = colors): GameState {
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
    return {
      ...state,
      diceValue: null,
      consecutiveSixes: 0,
      currentPlayer: getNextPlayer(state),
      lastAction: { type: 'forfeitSixes', player: state.currentPlayer },
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
  const tokens = state.tokens.map(t => ({ ...t }));
  const token = tokens.find(t => t.id === tokenId)!;
  const from = token.position;

  token.position = token.position === -1 ? 1 : token.position + dice;

  const captured: string[] = [];
  if (token.position >= 1 && token.position <= 51) {
    const globalPos = getGlobalPosition(token.color, token.position);
    if (!SAFE_SQUARES.includes(globalPos!)) {
      for (const other of tokens) {
        if (
          other.color !== token.color &&
          other.position >= 1 && other.position <= 51 &&
          getGlobalPosition(other.color, other.position) === globalPos
        ) {
          other.position = -1; // captured, back to base
          captured.push(other.id);
        }
      }
    }
  }

  const winner = tokens.filter(t => t.color === token.color).every(t => t.position === 58)
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
    lastAction: { type: 'move', tokenId, from, to: token.position, captured },
  };
}
