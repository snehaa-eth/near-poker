import type { Card, EvaluatedHand, HandCategory } from './types.js';

const CATEGORY_RANK: Record<HandCategory, number> = {
  'high-card': 0,
  pair: 1,
  'two-pair': 2,
  'three-of-a-kind': 3,
  straight: 4,
  flush: 5,
  'full-house': 6,
  'four-of-a-kind': 7,
  'straight-flush': 8,
  'royal-flush': 9,
};

const CATEGORY_NAME: Record<HandCategory, string> = {
  'high-card': 'High Card',
  pair: 'Pair',
  'two-pair': 'Two Pair',
  'three-of-a-kind': 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  'full-house': 'Full House',
  'four-of-a-kind': 'Four of a Kind',
  'straight-flush': 'Straight Flush',
  'royal-flush': 'Royal Flush',
};

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  const withHead = combinations(tail, k - 1).map((c) => [head!, ...c]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

function isFlush(cards: Card[]): boolean {
  return cards.every((c) => c.suit === cards[0]!.suit);
}

/** Highest straight high-card, or 0. Ace can play low for A-2-3-4-5. */
function straightHigh(ranks: number[]): number {
  const set = new Set(ranks);
  const candidates = [...set];
  if (set.has(14)) candidates.push(1); // wheel
  const sorted = [...new Set(candidates)].sort((a, b) => b - a);

  for (let i = 0; i <= sorted.length - 5; i++) {
    const window = sorted.slice(i, i + 5);
    let ok = true;
    for (let j = 0; j < 4; j++) {
      if (window[j]! - window[j + 1]! !== 1) {
        ok = false;
        break;
      }
    }
    if (ok) return window[0]!;
  }
  return 0;
}

function evaluateFive(cards: Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new Error('HandMustBeFiveCards');
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  const byCount = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const flush = isFlush(cards);
  const sHigh = straightHigh(ranks);

  let category: HandCategory;
  let scoreTail: number[];

  if (flush && sHigh === 14) {
    category = 'royal-flush';
    scoreTail = [14];
  } else if (flush && sHigh > 0) {
    category = 'straight-flush';
    scoreTail = [sHigh];
  } else if (byCount[0]![1] === 4) {
    category = 'four-of-a-kind';
    scoreTail = [byCount[0]![0], byCount[1]![0]];
  } else if (byCount[0]![1] === 3 && byCount[1]![1] === 2) {
    category = 'full-house';
    scoreTail = [byCount[0]![0], byCount[1]![0]];
  } else if (flush) {
    category = 'flush';
    scoreTail = ranks;
  } else if (sHigh > 0) {
    category = 'straight';
    scoreTail = [sHigh];
  } else if (byCount[0]![1] === 3) {
    category = 'three-of-a-kind';
    scoreTail = [byCount[0]![0], ...byCount.slice(1).map(([r]) => r)];
  } else if (byCount[0]![1] === 2 && byCount[1]![1] === 2) {
    category = 'two-pair';
    const pairs = [byCount[0]![0], byCount[1]![0]].sort((a, b) => b - a);
    scoreTail = [...pairs, byCount[2]![0]];
  } else if (byCount[0]![1] === 2) {
    category = 'pair';
    scoreTail = [byCount[0]![0], ...byCount.slice(1).map(([r]) => r)];
  } else {
    category = 'high-card';
    scoreTail = ranks;
  }

  return {
    category,
    score: [CATEGORY_RANK[category], ...scoreTail],
    name: CATEGORY_NAME[category],
    cards,
  };
}

export function compareScores(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/** Best 5-card hand from 5–7 cards. */
export function evaluateBestHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`InvalidHandSize:${cards.length}`);
  }
  if (cards.length === 5) return evaluateFive(cards);

  let best: EvaluatedHand | null = null;
  for (const five of combinations(cards, 5)) {
    const ev = evaluateFive(five);
    if (!best || compareScores(ev.score, best.score) > 0) best = ev;
  }
  return best!;
}
