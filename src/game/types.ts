export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export interface Token {
  id: string;
  color: PlayerColor;
  /** -1 base | 1-51 shared track | 52-57 home stretch | 58 finished */
  position: number;
}

export type LastAction =
  | { type: 'move'; tokenId: string; from: number; to: number; captured: string[] }
  | { type: 'forfeitSixes'; player: PlayerColor }
  | { type: 'pass'; player: PlayerColor }
  | null;

export interface GameState {
  tokens: Token[];
  /** Active seats in turn order (2-4 players). */
  players: PlayerColor[];
  currentPlayer: PlayerColor;
  diceValue: number | null;
  winner: PlayerColor | null;
  /** number of 6s rolled in a row by the current player (resets on non-6 or turn change) */
  consecutiveSixes: number;
  /** last thing that happened, for UI messages/animations */
  lastAction: LastAction;
}
