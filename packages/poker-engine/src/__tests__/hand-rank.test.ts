import { describe, expect, it } from 'vitest';

import { makeCard } from '../cards.js';
import { compareScores, evaluateBestHand } from '../hand-rank.js';

describe('hand ranking', () => {
  it('ranks royal flush above straight flush', () => {
    const royal = evaluateBestHand([
      makeCard(14, 's'),
      makeCard(13, 's'),
      makeCard(12, 's'),
      makeCard(11, 's'),
      makeCard(10, 's'),
    ]);
    const sf = evaluateBestHand([
      makeCard(13, 'h'),
      makeCard(12, 'h'),
      makeCard(11, 'h'),
      makeCard(10, 'h'),
      makeCard(9, 'h'),
    ]);
    expect(royal.category).toBe('royal-flush');
    expect(compareScores(royal.score, sf.score)).toBe(1);
  });

  it('detects wheel straight (A-2-3-4-5)', () => {
    const wheel = evaluateBestHand([
      makeCard(14, 'c'),
      makeCard(2, 'd'),
      makeCard(3, 'h'),
      makeCard(4, 's'),
      makeCard(5, 'c'),
    ]);
    expect(wheel.category).toBe('straight');
    expect(wheel.score[1]).toBe(5);
  });

  it('picks best five from seven cards', () => {
    // Pair of aces on board + better flush available
    const hand = evaluateBestHand([
      makeCard(14, 's'),
      makeCard(2, 's'),
      makeCard(14, 'h'),
      makeCard(9, 's'),
      makeCard(7, 's'),
      makeCard(3, 's'),
      makeCard(10, 'd'),
    ]);
    expect(hand.category).toBe('flush');
  });

  it('ranks full house above flush', () => {
    const boat = evaluateBestHand([
      makeCard(8, 'c'),
      makeCard(8, 'd'),
      makeCard(8, 'h'),
      makeCard(3, 's'),
      makeCard(3, 'c'),
    ]);
    const flush = evaluateBestHand([
      makeCard(14, 's'),
      makeCard(12, 's'),
      makeCard(9, 's'),
      makeCard(4, 's'),
      makeCard(2, 's'),
    ]);
    expect(compareScores(boat.score, flush.score)).toBe(1);
  });

  it('uses kickers for pairs', () => {
    const a = evaluateBestHand([
      makeCard(14, 'c'),
      makeCard(14, 'd'),
      makeCard(13, 'h'),
      makeCard(12, 's'),
      makeCard(2, 'c'),
    ]);
    const b = evaluateBestHand([
      makeCard(14, 'h'),
      makeCard(14, 's'),
      makeCard(13, 'c'),
      makeCard(11, 'd'),
      makeCard(2, 'h'),
    ]);
    expect(compareScores(a.score, b.score)).toBe(1);
  });

  it('detects four of a kind', () => {
    const quads = evaluateBestHand([
      makeCard(9, 'c'),
      makeCard(9, 'd'),
      makeCard(9, 'h'),
      makeCard(9, 's'),
      makeCard(2, 'c'),
      makeCard(14, 'd'),
      makeCard(7, 'h'),
    ]);
    expect(quads.category).toBe('four-of-a-kind');
  });
});
