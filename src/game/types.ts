export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export interface Token {
  id: string;
  color: PlayerColor;
  /** -1 base | 1-51 shared track | 52-56 home column | 57 finished (centre) */
  position: number;
}

/** Roll out the whole turn first, then allocate the values ('rolling'/'moving'). */
export type TurnPhase = 'rolling' | 'moving';

/** Optional non-standard rules. */
export interface HouseRules {
  /**
   * ON (default): a 6 is re-rolled immediately, accumulating values into a
   * queue that the player then spends in any order. OFF restores the classic
   * order, where each 6 is moved before the next roll.
   */
  rollAllFirst: boolean;
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
  /** Rolled but unspent values for this turn, in the order they were rolled. */
  diceQueue: number[];
  /** Whether the player is still rolling or now allocating rolled values. */
  phase: TurnPhase;
  /** A move this turn earned another roll (capture, home, or a classic-mode 6). */
  extraRoll: boolean;
  winner: PlayerColor | null;
  /** number of 6s rolled in a row by the current player (resets on non-6 or turn change) */
  consecutiveSixes: number;
  /** last thing that happened, for UI messages/animations */
  lastAction: LastAction;
  /** active optional rules */
  rules: HouseRules;
}
