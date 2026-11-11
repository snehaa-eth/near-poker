export type GameRound =
  | 'Ante'
  | 'PreFlop'
  | 'Flop'
  | 'Turn'
  | 'River'
  | 'End';

export type GameStatus = 'waiting' | 'shuffling' | 'playing' | 'ended';

export interface PlayerState {
  id: string;
  nickname: string;
  seat: number;
  chipsInPot: number;
  folded: boolean;
  shuffled: boolean;
  /** Hole cards (0-51). Empty until dealt. */
  holeCards: number[];
  /** Three community card face values chosen at End. */
  chosenCommunity: number[];
  weight: number;
}

export interface GameState {
  gameId: string;
  /** Display name for the lobby table. */
  name: string;
  /** Short shareable join code (e.g. A7K2MX). */
  joinCode: string;
  /** Minimum chip stack required to sit down. */
  minChips: number;
  /** Maximum seats at this table. */
  maxPlayers: number;
  status: GameStatus;
  round: GameRound;
  players: PlayerState[];
  /** Full 52-card deck (face values). Server-only. */
  deck: number[];
  /** Dealt community face values; null = not yet dealt. */
  communityCards: (number | null)[];
  nextCardIndex: number;
  pot: number;
  highestBet: number;
  nextSeat: number;
  winnerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-player projected view — never includes deck or others' hole cards until End. */
export interface PublicPlayerView {
  id: string;
  nickname: string;
  seat: number;
  chipsInPot: number;
  folded: boolean;
  shuffled: boolean;
  /** Own hole cards, or -1 face-down for others until revealed. */
  holeCards: number[];
  chosenCommunity: number[];
  weight: number;
}

export interface PublicGameView {
  gameId: string;
  name: string;
  joinCode: string;
  minChips: number;
  maxPlayers: number;
  status: GameStatus;
  round: GameRound;
  roundLabel: string;
  players: PublicPlayerView[];
  communityCards: number[];
  pot: number;
  highestBet: number;
  nextSeat: number;
  nextPlayerId: string | null;
  nextPlayerNickname: string | null;
  winnerId: string | null;
  winnerNickname: string | null;
  totalPlayers: number;
  totalShuffles: number;
  gameStarted: boolean;
  gameEnded: boolean;
  myPlayerId: string | null;
  isMyTurn: boolean;
}
