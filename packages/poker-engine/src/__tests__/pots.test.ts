import { describe, expect, it } from 'vitest';

import { buildPots } from '../pots.js';
import type { EnginePlayer } from '../types.js';

function p(
  partial: Partial<EnginePlayer> & Pick<EnginePlayer, 'id' | 'committed' | 'folded'>
): EnginePlayer {
  return {
    seat: 0,
    stack: 0,
    bet: 0,
    holeCards: [],
    allIn: false,
    ...partial,
  };
}

describe('side pots', () => {
  it('builds main and side pot for short all-in', () => {
    const players = [
      p({ id: 'a', seat: 0, committed: 50, folded: false }),
      p({ id: 'b', seat: 1, committed: 100, folded: false }),
      p({ id: 'c', seat: 2, committed: 100, folded: false }),
    ];
    const pots = buildPots(players);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({
      amount: 150,
      eligible: ['a', 'b', 'c'],
    });
    expect(pots[1]).toEqual({
      amount: 100,
      eligible: ['b', 'c'],
    });
  });

  it('keeps folded chips but excludes from eligibility', () => {
    const players = [
      p({ id: 'a', seat: 0, committed: 40, folded: true }),
      p({ id: 'b', seat: 1, committed: 40, folded: false }),
      p({ id: 'c', seat: 2, committed: 40, folded: false }),
    ];
    const pots = buildPots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(120);
    expect(pots[0]!.eligible).toEqual(['b', 'c']);
  });
});
