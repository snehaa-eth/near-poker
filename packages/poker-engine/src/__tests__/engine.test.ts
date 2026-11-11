import { describe, expect, it } from 'vitest';

import {
  applyAction,
  createTable,
  getLegalActions,
  startHand,
  toPublicState,
} from '../engine.js';

describe('NLHE engine', () => {
  it('rejects invalid player counts', () => {
    expect(() =>
      createTable([{ id: 'a', stack: 100 }], { smallBlind: 1, bigBlind: 2 })
    ).toThrow(/InvalidPlayerCount/);
  });

  it('posts blinds and deals hole cards (heads-up)', () => {
    let t = createTable(
      [
        { id: 'a', stack: 1000 },
        { id: 'b', stack: 1000 },
      ],
      { smallBlind: 5, bigBlind: 10, seed: 42 }
    );
    t = startHand(t, { rotateButton: false });
    expect(t.street).toBe('preflop');
    expect(t.players.every((p) => p.holeCards.length === 2)).toBe(true);
    // button is SB in HU
    const sb = t.players.find((p) => p.seat === t.button)!;
    const bb = t.players.find((p) => p.seat !== t.button)!;
    expect(sb.committed).toBe(5);
    expect(bb.committed).toBe(10);
    expect(t.currentBet).toBe(10);
    expect(t.toAct).toBe(t.button);
  });

  it('supports fold win without showdown', () => {
    let t = createTable(
      [
        { id: 'a', stack: 500 },
        { id: 'b', stack: 500 },
      ],
      { smallBlind: 5, bigBlind: 10, seed: 7 }
    );
    t = startHand(t, { rotateButton: false });
    const actor = t.players.find((p) => p.seat === t.toAct)!;
    t = applyAction(t, actor.id, { type: 'fold' });
    expect(t.street).toBe('complete');
    expect(t.result?.showdown).toBe(false);
    expect(t.result?.winners).toHaveLength(1);
    const winnerId = t.result!.winners[0]!.playerId;
    const winner = t.players.find((p) => p.id === winnerId)!;
    // SB folds: pot = 15. BB stack = 490 + 15 = 505
    expect(winner.stack).toBe(505);
    expect(t.players.reduce((s, p) => s + p.stack, 0)).toBe(1000);
  });

  it('runs check-down to showdown', () => {
    let t = createTable(
      [
        { id: 'a', stack: 200 },
        { id: 'b', stack: 200 },
      ],
      { smallBlind: 1, bigBlind: 2, seed: 99 }
    );
    t = startHand(t, { rotateButton: false });

    // HU preflop: SB acts first — call, then BB check
    const sb = t.players.find((p) => p.seat === t.button)!;
    t = applyAction(t, sb.id, { type: 'call' });
    const bb = t.players.find((p) => p.seat === t.toAct)!;
    expect(getLegalActions(t)).toContain('check');
    t = applyAction(t, bb.id, { type: 'check' });
    expect(t.street).toBe('flop');
    expect(t.community).toHaveLength(3);

    for (const street of ['flop', 'turn', 'river'] as const) {
      expect(t.street).toBe(street);
      // first to act checks, second checks
      let actor = t.players.find((p) => p.seat === t.toAct)!;
      t = applyAction(t, actor.id, { type: 'check' });
      if (t.street === 'complete') break;
      actor = t.players.find((p) => p.seat === t.toAct)!;
      t = applyAction(t, actor.id, { type: 'check' });
    }

    expect(t.street).toBe('complete');
    expect(t.result?.showdown).toBe(true);
    expect(t.community).toHaveLength(5);
    const stacks = t.players.reduce((s, p) => s + p.stack, 0);
    expect(stacks).toBe(400);
  });

  it('enforces minimum raise', () => {
    let t = createTable(
      [
        { id: 'a', stack: 1000 },
        { id: 'b', stack: 1000 },
      ],
      { smallBlind: 5, bigBlind: 10, seed: 1 }
    );
    t = startHand(t, { rotateButton: false });
    const sb = t.players.find((p) => p.seat === t.button)!;
    expect(() =>
      applyAction(t, sb.id, { type: 'raise', amount: 15 })
    ).toThrow(/BelowMinRaise/);
    t = applyAction(t, sb.id, { type: 'raise', amount: 30 });
    expect(t.currentBet).toBe(30);
    expect(t.minRaise).toBe(20);
  });

  it('hides opponent hole cards in public view', () => {
    let t = createTable(
      [
        { id: 'a', stack: 100 },
        { id: 'b', stack: 100 },
      ],
      { smallBlind: 1, bigBlind: 2, seed: 3 }
    );
    t = startHand(t, { rotateButton: false });
    const pub = toPublicState(t, 'a');
    const me = pub.players.find((p) => p.id === 'a')!;
    const opp = pub.players.find((p) => p.id === 'b')!;
    expect(me.holeCards).toHaveLength(2);
    expect(opp.holeCards).toHaveLength(0);
  });

  it('supports 6-max and dealer rotation', () => {
    let t = createTable(
      [
        { id: 'p0', stack: 300 },
        { id: 'p1', stack: 300 },
        { id: 'p2', stack: 300 },
        { id: 'p3', stack: 300 },
        { id: 'p4', stack: 300 },
        { id: 'p5', stack: 300 },
      ],
      { smallBlind: 1, bigBlind: 2, seed: 55 }
    );
    t = startHand(t, { rotateButton: false });
    expect(t.players).toHaveLength(6);
    expect(t.street).toBe('preflop');
    const firstButton = t.button;

    // Fold around to end hand quickly
    while (t.street !== 'complete') {
      const actor = t.players.find((p) => p.seat === t.toAct)!;
      const legal = getLegalActions(t);
      if (legal.includes('fold')) {
        t = applyAction(t, actor.id, { type: 'fold' });
      } else if (legal.includes('check')) {
        t = applyAction(t, actor.id, { type: 'check' });
      } else if (legal.includes('call')) {
        t = applyAction(t, actor.id, { type: 'call' });
      } else {
        t = applyAction(t, actor.id, { type: 'all-in' });
      }
    }

    t = startHand(t);
    expect(t.button).toBe((firstButton + 1) % 6);
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      let t = createTable(
        [
          { id: 'a', stack: 100 },
          { id: 'b', stack: 100 },
        ],
        { smallBlind: 1, bigBlind: 2, seed: 12345 }
      );
      t = startHand(t, { rotateButton: false });
      return t.players.map((p) => p.holeCards.map((c) => c.id).join(','));
    };
    expect(run()).toEqual(run());
  });
});
