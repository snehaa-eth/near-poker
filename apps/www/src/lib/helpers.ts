export const getCurrentRound = (num: number) => {
  if (num === 0) return 'Ante';
  if (num === 1) return 'Pre-Flop';
  if (num === 2) return 'Flop';
  if (num === 3) return 'Turn';
  if (num === 4) return 'River';
  return 'End';
};

const suits: Record<number, string> = {
  0: 'SPADE',
  1: 'HEART',
  2: 'DIAMOND',
  3: 'CLUB',
};

const ranks: Record<number, string> = {
  0: '2',
  1: '3',
  2: '4',
  3: '5',
  4: '6',
  5: '7',
  6: '8',
  7: '9',
  8: '10',
  9: '11',
  10: '12',
  11: '13',
  12: '1',
};

/** Midnight-style card backs — pick any at random on the table. */
export const CARD_BACKS = [
  '/cards/BACK-BLUE.png',
  '/cards/BACK-WHITE.png',
] as const;

/** Stable pick from a seed (seat, index, etc.) so re-renders don't flicker. */
export const getCardBackImage = (seed?: number) => {
  if (seed === undefined) {
    return CARD_BACKS[Math.floor(Math.random() * CARD_BACKS.length)]!;
  }
  const i = Math.abs(Math.floor(seed)) % CARD_BACKS.length;
  return CARD_BACKS[i]!;
};

export const getPokerCardImage = (id: number, backSeed?: number) => {
  if (id < 0) {
    return getCardBackImage(backSeed);
  }
  const suit = Math.floor(id / 13);
  const rank = id % 13;

  return `/cards/${suits[suit] ?? ''}-${ranks[rank] ?? ''}.svg`;
};
