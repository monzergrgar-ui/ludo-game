import type { PlayerColor, Token } from './types';
import { START_OFFSET, SAFE_SQUARES } from './engine';

/** 15x15 unit grid, matches a classic Ludo board's cross layout. */
export const BOARD_SIZE = 15;

export const COLORS: Record<PlayerColor, string> = {
  red: '#e63946',
  green: '#2a9d3e',
  yellow: '#f4c531',
  blue: '#3178c6',
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

/** Each color's 6-cell private home stretch, leading from the ring into the center. */
export const HOME_STRETCH: Record<PlayerColor, [number, number][]> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
};

/** 4 base-yard slots per color (row, col), as cell-center coordinates. */
export const BASE_SLOTS: Record<PlayerColor, [number, number][]> = {
  red: [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]],
  green: [[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]],
  yellow: [[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]],
  blue: [[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]],
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
    const [row, col] = BASE_SLOTS[color][tokenSlotIndex(token)];
    return { row, col };
  }
  if (position === 58) {
    const [row, col] = FINISH_SLOTS[color][tokenSlotIndex(token)];
    return { row, col };
  }
  if (position >= 52) {
    const [row, col] = HOME_STRETCH[color][position - 52];
    return { row: row + 0.5, col: col + 0.5 };
  }
  const globalIdx = (START_OFFSET[color] + position - 1) % 52;
  const [row, col] = RING[globalIdx];
  return { row: row + 0.5, col: col + 0.5 };
}
