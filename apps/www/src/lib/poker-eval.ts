/**
 * Small, dependency-free Hold'em evaluator + equity calculator for the browser.
 *
 * Card ids are the UI ids used everywhere in apps/www: rank = id % 13 (0 = deuce … 12 = ace),
 * suit = floor(id / 13) (0 ♠, 1 ♥, 2 ♦, 3 ♣). This mirrors (but does not import) the hand
 * ranking in packages/poker-engine so the engine package never ships to the browser.
 *
 * FAIRNESS: equity must only ever be computed from cards the server has already revealed,
 * and only when no further betting is possible. Use `equityAllowed()` as the gate.
 */
import type { PublicGameView } from './api';

const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUIT_CHARS = ['♠', '♥', '♦', '♣'];

export function cardLabel(id: number): string {
  if (id < 0) return '??';
  const r = RANK_CHARS[id % 13] ?? '?';
  return `${r === 'T' ? '10' : r}${SUIT_CHARS[Math.floor(id / 13)] ?? ''}`;
}

const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

/** Screen-reader name, e.g. "King of spades". */
export function cardName(id: number): string {
  if (id < 0) return 'Face-down card';
  return `${RANK_NAMES[id % 13] ?? '?'} of ${SUIT_NAMES[Math.floor(id / 13)] ?? '?'}`;
}

/** True for red suits (♥ ♦) — for coloured text labels. */
export function isRedCard(id: number) {
  const s = Math.floor(id / 13);
  return s === 1 || s === 2;
}

const CATEGORY_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
];

/** Highest straight in a 13-bit rank mask (bit 12 = ace), returning rank index or -1. */
function straightTop(mask: number): number {
  // Add the wheel: ace also plays low (as bit "-1").
  const m = (mask << 1) | ((mask >> 12) & 1);
  for (let top = 13; top >= 4; top--) {
    const window = 0b11111 << (top - 4);
    if ((m & window) === window) return top - 1; // back to rank index (wheel → 3 = five)
  }
  return -1;
}

function pack(category: number, kickers: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + ((kickers[i] ?? -1) + 1);
  return score;
}

/** Score the best 5-card hand out of 5–7 cards. Higher is better. */
export function scoreHand(cards: number[]): number {
  const counts = new Array<number>(13).fill(0);
  const suitMasks = [0, 0, 0, 0];
  const suitCounts = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const r = c % 13;
    const s = Math.floor(c / 13);
    counts[r]! += 1;
    suitMasks[s]! |= 1 << r;
    suitCounts[s]! += 1;
    mask |= 1 << r;
  }

  for (let s = 0; s < 4; s++) {
    if (suitCounts[s]! >= 5) {
      const sf = straightTop(suitMasks[s]!);
      if (sf >= 0) return pack(8, [sf]);
    }
  }

  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const n = counts[r]!;
    if (n === 4) quads.push(r);
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }

  if (quads.length) {
    const kicker = [...trips, ...pairs, ...singles, ...quads.slice(1)].sort((a, b) => b - a)[0]!;
    return pack(7, [quads[0]!, kicker]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const pairRank = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return pack(6, [trips[0]!, pairRank]);
  }
  for (let s = 0; s < 4; s++) {
    if (suitCounts[s]! >= 5) {
      const ranks: number[] = [];
      for (let r = 12; r >= 0 && ranks.length < 5; r--) if (suitMasks[s]! & (1 << r)) ranks.push(r);
      return pack(5, ranks);
    }
  }
  const st = straightTop(mask);
  if (st >= 0) return pack(4, [st]);
  if (trips.length) return pack(3, [trips[0]!, ...[...pairs, ...singles].sort((a, b) => b - a).slice(0, 2)]);
  if (pairs.length >= 2) {
    const kicker = [...pairs.slice(2), ...singles].sort((a, b) => b - a)[0] ?? -1;
    return pack(2, [pairs[0]!, pairs[1]!, kicker]);
  }
  if (pairs.length === 1) return pack(1, [pairs[0]!, ...singles.slice(0, 3)]);
  return pack(0, singles.slice(0, 5));
}

export function handName(cards: number[]): string {
  const score = scoreHand(cards);
  return CATEGORY_NAMES[Math.floor(score / 16 ** 5)] ?? 'High Card';
}

/** Deterministic PRNG so equity numbers don't jitter between re-renders. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type EquityInput = {
  /** Each contender's two revealed hole cards. */
  hands: Record<string, number[]>;
  /** Board cards dealt so far (0, 3 or 4). */
  board: number[];
  /** Other revealed cards that can't come on the board (e.g. mucked hands). */
  dead?: number[];
  /** Monte Carlo runs when more than two board cards are still to come. */
  iterations?: number;
};

/**
 * Share of the pot each contender wins on average (ties split), as 0..1.
 * Exact enumeration when ≤ 2 board cards remain, otherwise seeded Monte Carlo.
 */
export function computeEquity({ hands, board, dead = [], iterations = 2000 }: EquityInput): Record<string, number> {
  const ids = Object.keys(hands);
  const out: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  if (ids.length === 0) return out;
  if (ids.length === 1) return { [ids[0]!]: 1 };

  const used = new Set<number>([...board, ...dead, ...ids.flatMap((id) => hands[id]!)]);
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const need = Math.max(0, 5 - board.length);

  let total = 0;
  const run = (extra: number[]) => {
    const full = [...board, ...extra];
    let best = -1;
    let winners: string[] = [];
    for (const id of ids) {
      const s = scoreHand([...hands[id]!, ...full]);
      if (s > best) {
        best = s;
        winners = [id];
      } else if (s === best) winners.push(id);
    }
    for (const w of winners) out[w]! += 1 / winners.length;
    total += 1;
  };

  if (need === 0) run([]);
  else if (need === 1) for (const a of deck) run([a]);
  else if (need === 2) {
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) run([deck[i]!, deck[j]!]);
  } else {
    const seed = [...used].reduce((h, c) => (h * 31 + c + 1) >>> 0, 7);
    const rand = mulberry32(seed);
    const pool = [...deck];
    for (let it = 0; it < iterations; it++) {
      // Partial Fisher–Yates: draw `need` distinct cards.
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(rand() * (pool.length - k));
        const tmp = pool[k]!;
        pool[k] = pool[j]!;
        pool[j] = tmp;
      }
      run(pool.slice(0, need));
    }
  }
  for (const id of ids) out[id] = out[id]! / total;
  return out;
}

/**
 * FAIRNESS GATE. Equity may be shown only when:
 *  - nobody can act any more (no `nextPlayerId`), the hand is over / at showdown, and
 *  - every remaining contender's hole cards were revealed by the server (no -1 ids).
 * Anything derived from hidden cards while a player could still act would leak information.
 */
export function equityAllowed(view: PublicGameView): boolean {
  const over = Boolean(view.gameEnded) || view.round === 'End' || view.status === 'ended';
  if (!over || view.nextPlayerId) return false;
  const live = view.players.filter((p) => !p.folded && p.holeCards.length > 0);
  if (live.length < 2) return false;
  return live.every((p) => p.holeCards.length === 2 && p.holeCards.every((c) => c >= 0));
}
