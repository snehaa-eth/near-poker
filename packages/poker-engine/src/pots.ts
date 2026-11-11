import type { EnginePlayer, Pot } from './types.js';

/**
 * Build main + side pots from per-hand commitments of non-folded / all-in players.
 * Folded players' chips stay in pots but they are not eligible.
 */
export function buildPots(players: EnginePlayer[]): Pot[] {
  const contributors = players.filter((p) => p.committed > 0);
  if (contributors.length === 0) return [];

  const levels = [...new Set(contributors.map((p) => p.committed))].sort(
    (a, b) => a - b
  );

  const pots: Pot[] = [];
  let prev = 0;

  for (const level of levels) {
    const layerPlayers = contributors.filter((p) => p.committed >= level);
    const amount = (level - prev) * layerPlayers.length;
    if (amount <= 0) {
      prev = level;
      continue;
    }
    const eligible = layerPlayers
      .filter((p) => !p.folded)
      .map((p) => p.id);
    // If everyone who put chips at this layer folded, chips still go to remaining
    // eligible players from higher layers — fall back to any non-folded with chips.
    const elig =
      eligible.length > 0
        ? eligible
        : players.filter((p) => !p.folded).map((p) => p.id);
    pots.push({ amount, eligible: elig });
    prev = level;
  }

  return pots;
}

export function potTotal(pots: Pot[]): number {
  return pots.reduce((s, p) => s + p.amount, 0);
}
