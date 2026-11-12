/**
 * NLHE rules audit: targeted checks against standard No-Limit Hold'em rules
 * (blinds, action order, min-raise / incomplete raise, side pots, showdown, conservation).
 */
import { describe, expect, it } from 'vitest';

import { createOrderedDeck, makeCard } from '../cards.js';
import { applyAction, createTable, getLegalActions, startHand } from '../engine.js';
import { compareScores, evaluateBestHand } from '../hand-rank.js';
import { buildPots } from '../pots.js';
import type { Card, Rank, Suit, TableState } from '../types.js';

const c = (s: string): Card => {
  const r = s.slice(0, -1);
  const map: Record<string, Rank> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const rank = (map[r] ?? Number(r)) as Rank;
  return makeCard(rank, s.slice(-1) as Suit);
};
const cs = (s: string) => s.split(' ').map(c);

function table(stacks: number[], sb = 5, bb = 10): TableState {
  return createTable(
    stacks.map((stack, i) => ({ id: `p${i}`, stack })),
    { smallBlind: sb, bigBlind: bb, seed: 7 }
  );
}

/** Override hole cards + the remaining deck so the board is `board` (burns included). */
function rig(t: TableState, holes: string[], board: string): TableState {
  const used = new Set<number>();
  const players = t.players.map((p, i) => {
    const h = cs(holes[i]!);
    h.forEach((x) => used.add(x.id));
    return { ...p, holeCards: h };
  });
  const b = cs(board);
  b.forEach((x) => used.add(x.id));
  const filler = createOrderedDeck().filter((x) => !used.has(x.id));
  const deck = [filler[0]!, b[0]!, b[1]!, b[2]!, filler[1]!, b[3]!, filler[2]!, b[4]!, ...filler.slice(3)];
  return { ...t, players, deck };
}

const actorId = (t: TableState) => t.players.find((p) => p.seat === t.toAct)!.id;
const act = (t: TableState, a: Parameters<typeof applyAction>[2]) => applyAction(t, actorId(t), a);
const total = (t: TableState) =>
  t.players.reduce((s, p) => s + p.stack + (t.street === 'complete' ? 0 : p.committed), 0);
const stacksAfter = (t: TableState) => t.players.map((p) => p.stack);

describe('blinds & positions', () => {
  it('3-handed: SB left of button, BB next, UTG(button) first preflop, SB first postflop', () => {
    let t = startHand(table([100, 100, 100]), { rotateButton: false });
    expect(t.button).toBe(0);
    expect(t.players[1]!.committed).toBe(5);
    expect(t.players[2]!.committed).toBe(10);
    expect(t.toAct).toBe(0);
    t = act(t, { type: 'call' });
    t = act(t, { type: 'call' });
    expect(t.toAct).toBe(2); // BB option
    expect(getLegalActions(t)).toEqual(expect.arrayContaining(['check', 'raise']));
    t = act(t, { type: 'check' });
    expect(t.street).toBe('flop');
    expect(t.toAct).toBe(1);
  });

  it('heads-up: button posts SB, acts first preflop and last postflop', () => {
    let t = startHand(table([100, 100]), { rotateButton: false });
    expect(t.players[0]!.committed).toBe(5);
    expect(t.toAct).toBe(0);
    t = act(t, { type: 'call' });
    t = act(t, { type: 'check' });
    expect(t.street).toBe('flop');
    expect(t.toAct).toBe(1);
  });

  it('button rotates each hand', () => {
    let t = startHand(table([100, 100, 100]), { rotateButton: false });
    t = act(t, { type: 'fold' });
    t = act(t, { type: 'fold' });
    t = startHand(t);
    expect(t.button).toBe(1);
    expect(t.players[2]!.committed).toBe(5);
    expect(t.players[0]!.committed).toBe(10);
  });

  it('short SB posts all-in for less', () => {
    const t = startHand(table([100, 3, 100]), { rotateButton: false });
    expect(t.players[1]!.allIn).toBe(true);
    expect(t.players[1]!.committed).toBe(3);
    expect(t.currentBet).toBe(10);
  });

  it('short BB all-in: others must still call the full big blind, hand does not freeze', () => {
    let t = startHand(table([100, 100, 3]), { rotateButton: false });
    expect(t.currentBet).toBe(10);
    t = act(t, { type: 'call' }); // UTG
    expect(t.players[0]!.committed).toBe(10);
    t = act(t, { type: 'call' }); // SB completes
    expect(t.street).toBe('flop');
    expect(t.toAct).toBeGreaterThanOrEqual(0);
    expect(total(t)).toBe(203);
  });

  it('heads-up short BB: SB still gets to call or fold before the run-out', () => {
    let t = startHand(table([100, 7]), { rotateButton: false });
    expect(t.street).toBe('preflop');
    expect(t.toAct).toBe(0);
    expect(getLegalActions(t)).toContain('fold');
    t = act(t, { type: 'fold' });
    expect(t.street).toBe('complete');
    expect(stacksAfter(t)).toEqual([95, 12]);
  });
});

describe('betting', () => {
  it('min bet is the big blind; min raise is the last full raise', () => {
    let t = startHand(table([1000, 1000, 1000]), { rotateButton: false });
    expect(() => act(t, { type: 'raise', amount: 15 })).toThrow(/BelowMinRaise/);
    t = act(t, { type: 'raise', amount: 40 }); // raise by 30
    expect(() => act(t, { type: 'raise', amount: 60 })).toThrow(/BelowMinRaise/);
    t = act(t, { type: 'raise', amount: 70 }); // +30 ok
    t = act(t, { type: 'fold' });
    t = act(t, { type: 'call' });
    expect(t.street).toBe('flop');
    expect(() => act(t, { type: 'bet', amount: 5 })).toThrow(/BelowMin/);
    t = act(t, { type: 'bet', amount: 10 });
    expect(t.currentBet).toBe(10);
  });

  it('no raise cap in NL: several re-raises allowed', () => {
    let t = startHand(table([10000, 10000]), { rotateButton: false });
    let to = 10;
    for (let i = 0; i < 8; i++) {
      to = to * 2 + 10;
      t = act(t, { type: 'raise', amount: to });
    }
    expect(t.currentBet).toBe(to);
  });

  it('cannot check facing a bet; calling all-in for less is allowed', () => {
    let t = startHand(table([1000, 1000, 50]), { rotateButton: false });
    t = act(t, { type: 'raise', amount: 200 });
    expect(() => act(t, { type: 'check' })).toThrow();
    t = act(t, { type: 'fold' }); // SB
    expect(getLegalActions(t)).toEqual(['fold', 'all-in']);
    t = act(t, { type: 'all-in' }); // BB calls 50 for less
    expect(t.players[2]!.allIn).toBe(true);
    expect(t.street).toBe('complete'); // ran out
    expect(total(t)).toBe(2050);
  });

  it('incomplete all-in raise does NOT reopen raising for a player who already acted', () => {
    // UTG raises to 30 (+20). SB shoves to 40 (+10 < 20: incomplete). BB folds.
    let t = startHand(table([1000, 40, 1000]), { rotateButton: false });
    t = act(t, { type: 'raise', amount: 30 });
    t = act(t, { type: 'all-in' });
    expect(t.currentBet).toBe(40);
    // BB has not acted yet since UTG's full raise: may re-raise
    expect(getLegalActions(t)).toContain('raise');
    t = act(t, { type: 'fold' });
    expect(t.toAct).toBe(0);
    const legal = getLegalActions(t);
    expect(legal).toContain('call');
    expect(legal).not.toContain('raise');
    expect(() => act(t, { type: 'raise', amount: 100 })).toThrow();
    expect(() => act(t, { type: 'all-in' })).toThrow();
  });

});

describe('incomplete raise edge cases', () => {
  it('limper facing an incomplete all-in raise preflop may only call/fold; BB may raise', () => {
    // btn limps 10, SB shoves to 15 (raise +5 < 10), BB unacted -> may raise; btn may not
    let t = startHand(table([1000, 15, 1000]), { rotateButton: false });
    t = act(t, { type: 'call' });
    t = act(t, { type: 'all-in' });
    expect(t.toAct).toBe(2);
    expect(getLegalActions(t)).toContain('raise');
    t = act(t, { type: 'call' });
    expect(t.toAct).toBe(0);
    expect(getLegalActions(t)).toEqual(['fold', 'call']);
    t = act(t, { type: 'call' });
    expect(t.street).toBe('flop');
  });

  it('a full raise after an incomplete one re-opens raising', () => {
    let t = startHand(table([1000, 40, 1000, 1000]), { rotateButton: false });
    // seats: 0 btn, 1 SB(40), 2 BB, 3 UTG
    t = act(t, { type: 'raise', amount: 30 }); // UTG +20
    t = act(t, { type: 'call' }); // btn
    t = act(t, { type: 'all-in' }); // SB to 40 (incomplete)
    t = act(t, { type: 'raise', amount: 100 }); // BB full re-raise
    expect(t.toAct).toBe(3);
    expect(getLegalActions(t)).toContain('raise');
  });

  it('under-minimum all-in opening bet: earlier checker may still raise', () => {
    let t = startHand(table([1000, 1000, 15]), { rotateButton: false });
    t = act(t, { type: 'call' });
    t = act(t, { type: 'call' });
    t = act(t, { type: 'check' }); // BB(15) has 5 behind
    expect(t.street).toBe('flop');
    t = act(t, { type: 'check' }); // SB
    t = act(t, { type: 'all-in' }); // BB bets 5 (< BB)
    t = act(t, { type: 'call' }); // btn
    expect(t.toAct).toBe(1);
    expect(getLegalActions(t)).toContain('raise');
  });
});

describe('pots', () => {
  it('three all-ins of different sizes build correct side pots', () => {
    const pots = buildPots([
      { id: 'a', seat: 0, stack: 0, bet: 0, committed: 50, holeCards: [], folded: false, allIn: true },
      { id: 'b', seat: 1, stack: 0, bet: 0, committed: 100, holeCards: [], folded: false, allIn: true },
      { id: 'c', seat: 2, stack: 0, bet: 0, committed: 200, holeCards: [], folded: false, allIn: true },
      { id: 'd', seat: 3, stack: 0, bet: 0, committed: 30, holeCards: [], folded: true, allIn: false },
    ]);
    expect(pots).toEqual([
      { amount: 120, eligible: ['a', 'b', 'c'] },
      { amount: 60, eligible: ['a', 'b', 'c'] },
      { amount: 100, eligible: ['b', 'c'] },
      { amount: 100, eligible: ['c'] }, // uncalled → returned to c
    ]);
  });

  it('short stack with best hand wins only the main pot; side pot to next best', () => {
    let t = startHand(table([300, 100, 300]), { rotateButton: false });
    t = rig(t, ['Kc Kd', 'Ac Ad', 'Qc Qd'], '2h 7s 9d 3c 8h');
    t = act(t, { type: 'all-in' }); // p0 300
    t = act(t, { type: 'all-in' }); // p1 100
    t = act(t, { type: 'all-in' }); // p2 calls 300 all-in
    expect(t.street).toBe('complete');
    expect(stacksAfter(t)).toEqual([400, 300, 0]);
  });

  it('split pot with odd chip: chip goes to lowest seat (std: first winner left of button)', () => {
    let t = startHand(table([100, 100, 100], 1, 2), { rotateButton: false });
    t = rig(t, ['Kh 4c', '2c 3d', 'Ks 4d'], 'Ac Qd Jh Tc 7s');
    t = act(t, { type: 'call' }); // btn
    t = act(t, { type: 'fold' }); // SB leaves 1 dead chip
    t = act(t, { type: 'check' }); // BB -> pot 5
    while (t.street !== 'complete') t = act(t, { type: 'check' });
    const byId: Record<string, number> = {};
    for (const w of t.result!.winners) byId[w.playerId] = (byId[w.playerId] ?? 0) + w.amount;
    // Engine: lowest seat (p0 = button) gets the odd chip. TDA/standard: first seat left of button (p2).
    expect(byId).toEqual({ p0: 3, p2: 2 });
    expect(total(t)).toBe(300);
  });
});

describe('hand evaluation', () => {
  const best = (s: string) => evaluateBestHand(cs(s));
  const cmp = (a: string, b: string) => compareScores(best(a).score, best(b).score);

  it('categories ladder', () => {
    const ladder = [
      'Ah Kd 9c 7s 3h',
      'Ah Ad 9c 7s 3h',
      'Ah Ad 9c 9s 3h',
      'Ah Ad Ac 7s 3h',
      'Ah 2d 3c 4s 5h',
      '2h 7h 9h Jh Kh',
      'Ah Ad Ac 7s 7h',
      'Ah Ad Ac As 3h',
      'Ah 2h 3h 4h 5h',
      'Ah Kh Qh Jh Th',
    ];
    for (let i = 1; i < ladder.length; i++) expect(cmp(ladder[i]!, ladder[i - 1]!)).toBe(1);
  });
  it('wheel is the lowest straight; steel wheel lowest SF', () => {
    expect(cmp('Ah 2d 3c 4s 5h', '2h 3d 4c 5s 6h')).toBe(-1);
    expect(best('Ah 2h 3h 4h 5h').category).toBe('straight-flush');
    expect(cmp('Ah 2h 3h 4h 5h', '2c 3c 4c 5c 6c')).toBe(-1);
    expect(best('Qh Kd Ac 2s 3h').category).toBe('high-card'); // no wrap-around
  });
  it('kickers', () => {
    expect(cmp('Ah Ad Kc 7s 3h', 'As Ac Qc Js Th')).toBe(1);
    expect(cmp('9h 9d 5c 5s Kh', '9s 9c 5h 5d Qh')).toBe(1); // two-pair kicker
    expect(cmp('9h 9d 5c 5s Kh', '9s 9c 6h 6d 2h')).toBe(-1);
    expect(cmp('Kh Kd Kc 2s 2h', 'Qh Qd Qc As Ah')).toBe(1); // FH by trips
    expect(cmp('Kh Kd Kc 3s 3h', 'Ks Kd Kc 2s 2h')).toBe(1);
    expect(cmp('Ah Jh 9h 7h 2h', 'As Js 9s 6s 5s')).toBe(1); // flush vs flush
    expect(cmp('Ah Ad Ac 9s 2h', 'As Ad Ac 8s 7h')).toBe(1); // trips kicker
  });
  it('best 5 of 7 & board plays', () => {
    expect(best('2c 3d Ah Kh Qh Jh Th').category).toBe('royal-flush');
    expect(cmp('2c 3d Ah Kh Qh Jh 9c', '4c 5d Ah Kh Qh Jh 9c')).toBe(0);
    expect(best('Ah Ad Ac Kh Kd Ks 2c').score).toEqual([6, 14, 13]); // two trips → FH
    expect(best('9h 9d 5c 5s 3h 3d Kh').score).toEqual([2, 9, 5, 13]); // three pairs
    expect(best('2h 3h 4h 5h 6h 7h Ah').score).toEqual([8, 7]);
  });
});

describe('showdown & conservation', () => {
  it('fold-win: no showdown, winner gets pot incl. uncalled bet', () => {
    let t = startHand(table([100, 100, 100]), { rotateButton: false });
    t = act(t, { type: 'raise', amount: 50 });
    t = act(t, { type: 'fold' });
    t = act(t, { type: 'fold' });
    expect(t.result!.showdown).toBe(false);
    expect(stacksAfter(t)).toEqual([115, 95, 90]);
  });

  it('all-in preflop runs out all five community cards', () => {
    let t = startHand(table([100, 100]), { rotateButton: false });
    t = act(t, { type: 'all-in' });
    t = act(t, { type: 'all-in' });
    expect(t.street).toBe('complete');
    expect(t.community).toHaveLength(5);
    expect(t.result!.showdown).toBe(true);
  });

  it('fuzz: chips conserved, no negative stacks, never stuck', () => {
    let rng = 12345;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let g = 0; g < 400; g++) {
      const n = 2 + Math.floor(rand() * 5);
      const stacks = Array.from({ length: n }, () => 1 + Math.floor(rand() * 300));
      const sum = stacks.reduce((a, b) => a + b, 0);
      let t = createTable(stacks.map((s, i) => ({ id: `p${i}`, stack: s })), { smallBlind: 5, bigBlind: 10, seed: g + 1 });
      for (let h = 0; h < 20; h++) {
        if (t.players.filter((p) => p.stack > 0).length < 2) break;
        // mimic the server: drop busted players between hands
        if (t.street === 'complete' && t.players.some((p) => p.stack === 0)) {
          const alive = t.players.filter((p) => p.stack > 0);
          t = createTable(alive.map((p) => ({ id: p.id, stack: p.stack })), t.config);
        }
        t = startHand(t, { rotateButton: h > 0 && t.street === 'complete' });
        let guard = 0;
        while (t.street !== 'complete') {
          expect(t.toAct, `stuck g${g} h${h} ${JSON.stringify(t.actionHistory)}`).toBeGreaterThanOrEqual(0);
          const legal = getLegalActions(t);
          const a = legal[Math.floor(rand() * legal.length)]!;
          const me = t.players.find((p) => p.seat === t.toAct)!;
          let amount: number | undefined;
          if (a === 'bet' || a === 'raise') {
            const min = t.currentBet + t.minRaise;
            const max = me.bet + me.stack;
            if (min >= max) {
              t = act(t, { type: 'all-in' });
              continue;
            }
            amount = min + Math.floor(rand() * (max - min));
          }
          t = act(t, { type: a, amount });
          for (const p of t.players) expect(p.stack).toBeGreaterThanOrEqual(0);
          expect(total(t)).toBe(sum);
          if (++guard > 500) throw new Error('loop');
        }
        expect(t.players.reduce((s, p) => s + p.stack, 0)).toBe(sum);
      }
    }
  });
});
