/** Shared domain types for No-Limit Inference (API + clients). */

export type Street =
  | 'waiting'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'complete';

export type PokerActionType =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'all-in';

export interface StructuredAgentAction {
  action: PokerActionType;
  /** Absolute chip amount for bet/raise/all-in when required. */
  amount?: number;
}

export interface WalletAddress {
  address: `0x${string}`;
  chainId: number;
}

export const NLI_LIMITS = {
  minPlayers: 2,
  maxPlayers: 6,
  deckSize: 52,
} as const;
