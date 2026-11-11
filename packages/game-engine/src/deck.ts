import { randomBytes } from 'node:crypto';

/** Create a fresh 52-card deck (face values 0-51). */
export function createDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Fisher–Yates shuffle using crypto randomness. */
export function shuffleDeck(deck: number[]): number[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function createShuffledDeck(): number[] {
  return shuffleDeck(createDeck());
}
