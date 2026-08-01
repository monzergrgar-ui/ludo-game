import type { PlayerColor, Token } from './types';
import { START_OFFSET, SAFE_SQUARES, FINISH, TRACK_END } from './engine';

/** 15x15 unit grid, matches a classic Ludo board's cross layout. */
export const BOARD_SIZE = 15;

/**
 * Standard die-face pip coordinates on a 100x100 face, shared by the big
 * corner dice, the queued mini dice and the per-token value picker so they all
 * read as the same object.
 */
const PL = 28;
const PM = 50;
const PR = 72;
export const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[PM, PM]],
  2: [[PL, PL], [PR, PR]],
  3: [[PL, PL], [PM, PM], [PR, PR]],
  4: [[PL, PL], [PR, PL], [PL, PR], [PR, PR]],
  5: [[PL, PL], [PR, PL], [PM, PM], [PL, PR], [PR, PR]],
  6: [[PL, PL], [PR, PL], [PL, PM], [PR, PM], [PL, PR], [PR, PR]],
};

export const COLORS: Record<PlayerColor, string> = {
  red: '#e30613',
  green: '#00a651',
  yellow: '#ffce00',
  blue: '#0072ce',
};

/** Darker shade of each color, for gradient edges and bevels. */
export const COLOR_DARK: Record<PlayerColor, string> = {
  red: '#96040d',
  green: '#006633',
  yellow: '#c79e00',
  blue: '#004a8f',
};

/** Lighter shade of each color, for glossy highlights. */
export const COLOR_LIGHT: Record<PlayerColor, string> = {
  red: '#ff5a63',
  green: '#4cd98a',
  yellow: '#ffe766',
  blue: '#5aaef0',
};

export const COLOR_TINT: Record<PlayerColor, string> = {
  red: '#fbdadd',
  green: '#d8f0dd',
  yellow: '#fdf1c8',
  blue: '#d6e6f8',
};

/** The 52 shared-track cells, in ring order, index 0 = red's entry square. */
export const RING: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];

/**
 * Each color's private home column: 5 cells running from the ring up to the
 * edge of the centre goal, which occupies the 3x3 block from (6,6) to (9,9).
 * The last cell stops flush against that block — a 6th cell would sit on top
 * of the centre triangles, and the token would need an extra step to finish.
 */
export const HOME_STRETCH: Record<PlayerColor, [number, number][]> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

/**
 * 4 base-yard slots per color (row, col), as socket-center coordinates.
 * Each yard is 6x6 with its white panel centered on (origin+3, origin+3), so
 * the 2x2 socket group sits at ±1 around that point to be perfectly centered.
 */
export const BASE_SLOTS: Record<PlayerColor, [number, number][]> = {
  red: [[2, 2], [2, 4], [4, 2], [4, 4]],
  green: [[2, 11], [2, 13], [4, 11], [4, 13]],
  yellow: [[11, 11], [11, 13], [13, 11], [13, 13]],
  blue: [[11, 2], [11, 4], [13, 2], [13, 4]],
};

/** 4 finished-token slots per color, clustered near the center, as cell-center coordinates. */
export const FINISH_SLOTS: Record<PlayerColor, [number, number][]> = {
  red: [[6.85, 6.35], [6.85, 6.65], [7.15, 6.35], [7.15, 6.65]],
  green: [[6.35, 6.85], [6.65, 6.85], [6.35, 7.15], [6.65, 7.15]],
  yellow: [[6.85, 7.35], [6.85, 7.65], [7.15, 7.35], [7.15, 7.65]],
  blue: [[7.35, 6.85], [7.35, 7.15], [7.65, 6.85], [7.65, 7.15]],
};

export const YARD_ORIGIN: Record<PlayerColor, [number, number]> = {
  red: [0, 0],
  green: [0, 9],
  yellow: [9, 9],
  blue: [9, 0],
};

/** Ring index of each safe (star) square that isn't a color's own start square. */
export const NEUTRAL_SAFE_INDICES = SAFE_SQUARES.filter(
  i => !Object.values(START_OFFSET).includes(i)
);

function tokenSlotIndex(token: Token): number {
  return Number(token.id.split('-').pop());
}

/** Resolves a token's (row, col) center coordinates in the 15x15 board grid. */
export function getTokenCell(token: Token): { row: number; col: number } {
  const { color, position } = token;

  if (position === -1) {
    // Lift the pawn so its base (ground contact at +0.42) lands on the
    // socket's center rather than its bottom rim.
    const [row, col] = BASE_SLOTS[color][tokenSlotIndex(token)];
    return { row: row - 0.42, col };
  }
  if (position === FINISH) {
    const [row, col] = FINISH_SLOTS[color][tokenSlotIndex(token)];
    return { row, col };
  }
  if (position > TRACK_END) {
    const [row, col] = HOME_STRETCH[color][position - TRACK_END - 1];
    return { row: row + 0.5, col: col + 0.5 };
  }
  const globalIdx = (START_OFFSET[color] + position - 1) % 52;
  const [row, col] = RING[globalIdx];
  return { row: row + 0.5, col: col + 0.5 };
}
