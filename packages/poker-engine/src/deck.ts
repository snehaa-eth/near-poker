import { createOrderedDeck } from './cards.js';
import type { Card } from './types.js';

/** Mulberry32 — fast seeded PRNG for deterministic shuffles in tests. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function nextSeed(state: number): { value: number; next: number } {
  const rng = mulberry32(state);
  const value = rng();
  // Advance state deterministically
  const next = (Math.imul(state ^ 0x9e3779b9, 0x85ebca6b) + 1) >>> 0;
  return { value, next };
}

/** Fisher–Yates using a provided [0,1) random source. Pure / deterministic. */
export function shuffleWith<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function createShuffledDeck(seed: number): {
  deck: Card[];
  rngState: number;
} {
  let state = seed >>> 0;
  const random = () => {
    const step = nextSeed(state);
    state = step.next;
    return step.value;
  };
  return { deck: shuffleWith(createOrderedDeck(), random), rngState: state };
}

export function draw(deck: Card[], n: number): { cards: Card[]; rest: Card[] } {
  if (deck.length < n) throw new Error('DeckExhausted');
  return { cards: deck.slice(0, n), rest: deck.slice(n) };
}
