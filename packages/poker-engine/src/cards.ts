import type { Card, Rank, Suit } from './types.js';

const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SUITS: Suit[] = ['c', 'd', 'h', 's'];

const RANK_LABEL: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

/** Card id 0–51 → Card. Rank cycles first, then suit. */
export function cardFromId(id: number): Card {
  if (id < 0 || id > 51) throw new Error(`InvalidCardId:${id}`);
  const rank = RANKS[id % 13]!;
  const suit = SUITS[Math.floor(id / 13)]!;
  return { id, rank, suit };
}

export function cardId(rank: Rank, suit: Suit): number {
  return RANKS.indexOf(rank) + SUITS.indexOf(suit) * 13;
}

export function makeCard(rank: Rank, suit: Suit): Card {
  return { id: cardId(rank, suit), rank, suit };
}

export function formatCard(card: Card): string {
  return `${RANK_LABEL[card.rank]}${card.suit}`;
}

export function createOrderedDeck(): Card[] {
  return Array.from({ length: 52 }, (_, id) => cardFromId(id));
}
