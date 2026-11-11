export type CardType =
  | 'Two'
  | 'Three'
  | 'Four'
  | 'Five'
  | 'Six'
  | 'Seven'
  | 'Eight'
  | 'Nine'
  | 'Ten'
  | 'Jack'
  | 'Queen'
  | 'King'
  | 'Ace';

export type CardSuit = 'Spade' | 'Heart' | 'Diamond' | 'Club';

export interface PokerCard {
  cardType: CardType;
  cardSuit: CardSuit;
}

const CARD_TYPES: CardType[] = [
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
  'Ace',
];

const CARD_SUITS: CardSuit[] = ['Spade', 'Heart', 'Diamond', 'Club'];

const HAND_SIZE = 5;
export const ROYAL_FLUSH_WEIGHT = Number.MAX_SAFE_INTEGER;

export function toPokerCard(number: number): PokerCard {
  const cardType = CARD_TYPES[number % 13]!;
  const cardSuit = CARD_SUITS[Math.floor(number / 13)]!;
  return { cardType, cardSuit };
}

export function toPokerCards(numbers: number[]): PokerCard[] {
  if (numbers.length !== HAND_SIZE) {
    throw new Error('InvalidHandSize');
  }
  return numbers.map(toPokerCard);
}

function getNumbers(hand: PokerCard[]): number[] {
  const numbers = hand.map((c) => CARD_TYPES.indexOf(c.cardType) + 2);
  return numbers.sort((a, b) => a - b);
}

function isStraight(numbers: number[]): { result: boolean; highest: number } {
  let result = true;
  for (let i = 0; i < HAND_SIZE - 1; i++) {
    if (numbers[i + 1]! - numbers[i]! !== 1) {
      result = false;
      break;
    }
  }
  return { result, highest: numbers[HAND_SIZE - 1]! };
}

function isFlush(
  hand: PokerCard[],
  numbers: number[]
): { result: boolean; highest: number } {
  let result = true;
  for (let i = 0; i < HAND_SIZE - 1; i++) {
    if (hand[i]!.cardSuit !== hand[i + 1]!.cardSuit) {
      result = false;
      break;
    }
  }
  return { result, highest: numbers[HAND_SIZE - 1]! };
}

function isStraightFlush(
  hand: PokerCard[],
  numbers: number[]
): { result: boolean; highest: number } {
  const s = isStraight(numbers);
  const f = isFlush(hand, numbers);
  return { result: s.result && f.result, highest: s.highest };
}

function isRoyalFlush(
  hand: PokerCard[],
  numbers: number[]
): { result: boolean; highest: number } {
  const sf = isStraightFlush(hand, numbers);
  return { result: sf.result && sf.highest === 14, highest: 14 };
}

function times(
  t: number,
  numbers: number[]
): { result: boolean; max: number } {
  const occurencies = new Array<number>(15).fill(0);
  for (const n of numbers) {
    occurencies[n]! += 1;
  }
  let result = false;
  let max = 0;
  for (const n of numbers) {
    if (occurencies[n] === t) {
      result = true;
      max = n;
    }
  }
  return { result, max };
}

function isFourOfKind(numbers: number[]) {
  return times(4, numbers);
}

function isThreeOfKind(numbers: number[]) {
  return times(3, numbers);
}

function isFullHouse(numbers: number[]): { result: boolean; max: number } {
  const occurencies = new Array<number>(15).fill(0);
  for (const n of numbers) {
    occurencies[n]! += 1;
  }
  let twoIndex = 0;
  let threeIndex = 0;
  for (let i = 0; i < 15; i++) {
    if (occurencies[i] === 2) twoIndex = i;
    else if (occurencies[i] === 3) threeIndex = i;
  }
  if (twoIndex !== 0 && threeIndex !== 0) {
    return { result: true, max: threeIndex };
  }
  return { result: false, max: 0 };
}

function isTwoPair(numbers: number[]): { result: boolean; max: number } {
  const occurencies = new Array<number>(15).fill(0);
  for (const n of numbers) {
    occurencies[n]! += 1;
  }
  const twopairs: number[] = [];
  for (let i = 0; i < 15; i++) {
    if (occurencies[i] === 2) twopairs.push(i);
  }
  return { result: twopairs.length === 2, max: twopairs[1] ?? 0 };
}

function isSinglePair(numbers: number[]): { result: boolean; max: number } {
  const occurencies = new Array<number>(15).fill(0);
  for (const n of numbers) {
    occurencies[n]! += 1;
  }
  let pair = 0;
  let max = 0;
  for (let i = 0; i < 15; i++) {
    if (occurencies[i] === 2) pair = i;
    else if (occurencies[i] === 1) max = i;
  }
  return { result: pair !== 0, max };
}

/** Port of TexasPoker.getWeight from Solidity. */
export function getWeight(hand: PokerCard[]): number {
  const numbers = getNumbers(hand);

  if (isRoyalFlush(hand, numbers).result) return ROYAL_FLUSH_WEIGHT;

  const sf = isStraightFlush(hand, numbers);
  if (sf.result) return 1000 + sf.highest;

  const four = isFourOfKind(numbers);
  if (four.result) return 900 + four.max;

  const fh = isFullHouse(numbers);
  if (fh.result) return 800 + fh.max;

  const flush = isFlush(hand, numbers);
  if (flush.result) return 700 + flush.highest;

  const straight = isStraight(numbers);
  if (straight.result) return 600 + straight.highest;

  const three = isThreeOfKind(numbers);
  if (three.result) return 500 + three.max;

  const twoPair = isTwoPair(numbers);
  if (twoPair.result) return 400 + twoPair.max;

  if (isSinglePair(numbers).result) return 300;

  return numbers[HAND_SIZE - 1]!;
}

export function getWeightFromIds(cardIds: number[]): number {
  return getWeight(toPokerCards(cardIds));
}
