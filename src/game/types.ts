export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export interface Token {
  id: string;
  color: PlayerColor;
  /** -1 base | 1-51 shared track | 52-56 home column | 57 finished (centre) */
  position: number;
}

/** Optional non-standard rules. All off by default. */
export interface HouseRules {
  /** Ignoring an available capture sends your leading token back to base. */
  mandatoryCapture: boolean;
  /** First token home wins, instead of all four. */
  quickMode: boolean;
  /** A third consecutive 6 also sends your leading token back to base. */
  threeSixesSendsLeaderToBase: boolean;
}

export type LastAction =
  | {
      type: 'move';
      tokenId: string;
      from: number;
      to: number;
      captured: string[];
      /** Token sent to base by the mandatory-capture house rule, if any. */
      penalizedTokenId?: string;
    }
  | { type: 'forfeitSixes'; player: PlayerColor; penalizedTokenId?: string }
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
  /** active optional rules */
  rules: HouseRules;
}
