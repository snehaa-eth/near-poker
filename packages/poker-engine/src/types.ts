/** Pure types for the No-Limit Texas Hold'em engine. */

export type Rank =
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14;

export type Suit = 'c' | 'd' | 'h' | 's';

export interface Card {
  /** 0–51 deterministic id: rankIndex + suitIndex * 13 */
  id: number;
  rank: Rank;
  suit: Suit;
}

export type Street =
  | 'waiting'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'complete';

export type ActionType =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'all-in';

export interface PlayerAction {
  type: ActionType;
  /** Absolute chips put into the pot this street after the action (for bet/raise/all-in). */
  amount?: number;
}

export interface EnginePlayer {
  id: string;
  seat: number;
  stack: number;
  /** Chips committed on the current street. */
  bet: number;
  /** Chips committed across the whole hand (for side pots). */
  committed: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
}

export interface Pot {
  amount: number;
  /** Player ids eligible to win this pot. */
  eligible: string[];
}

export interface HandWinner {
  playerId: string;
  amount: number;
  potIndex: number;
}

export interface HandResult {
  winners: HandWinner[];
  showdown: boolean;
  rankings: Array<{
    playerId: string;
    handName: string;
    score: number[];
  }>;
}

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
  /** Optional seeded RNG for deterministic tests. */
  seed?: number;
}

export interface TableState {
  handId: string;
  config: TableConfig;
  street: Street;
  button: number;
  /** Seat index whose turn it is; -1 if no action expected. */
  toAct: number;
  community: Card[];
  deck: Card[];
  players: EnginePlayer[];
  /** Highest bet on the current street. */
  currentBet: number;
  /** Minimum raise size (last raise increment, or BB if no raise yet). */
  minRaise: number;
  /** Players who still need to act this street (by seat). */
  pendingSeats: number[];
  pots: Pot[];
  /** Running total of all chips in pots + unmatched street bets. */
  potTotal: number;
  lastAggressorSeat: number | null;
  /**
   * Seats that already acted on the current street and since then only faced an
   * incomplete (short all-in) raise: they may call or fold but not re-raise.
   * Reset by any full bet/raise and at the start of every street.
   */
  raiseClosedSeats?: number[];
  result: HandResult | null;
  /** Internal PRNG state (mulberry32). */
  rngState: number;
  actionHistory: Array<{
    playerId: string;
    street: Street;
    type: ActionType;
    amount?: number;
  }>;
}

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush'
  | 'royal-flush';

export interface EvaluatedHand {
  category: HandCategory;
  /** Lexicographic score: [categoryRank, ...kickers desc]. Higher wins. */
  score: number[];
  name: string;
  cards: Card[];
}
