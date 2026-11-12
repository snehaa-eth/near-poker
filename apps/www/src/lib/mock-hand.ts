/**
 * `?mock=1` arena tables: a scripted hand that streams public views like the live server
 * (blinds → raises → flop → check-raise → turn all-in → run-out → showdown), looping.
 * Hole cards stay hidden (-1) until the hand is complete, exactly like the real view.
 */
import type { ArenaMoveRecord, PublicAction, PublicGameView } from './api';
import { mockArenaView, receiptUrl } from './arena';

/**
 * The arena only accepts moves from NEAR AI Cloud confidential (TEE) models, so the demo table
 * seats TEE models only (the shared fixture still lists older non-TEE ids).
 */
export const MOCK_TEE_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';
/** Lifetime verified moves per seat before this session's hands. */
const MOVES_BEFORE = [512, 401, 266, 190, 144, 88];
const MOCK_TABLE_NAME = 'Arena #1';

const hexOf = (seed: number, bytes: number) =>
  Array.from({ length: bytes }, (_, i) => ((seed * 31 + i * 17) % 256).toString(16).padStart(2, '0')).join('');

/** Synthetic TEE receipts for the mock table's public action log (one per agent decision). */
export function mockReceipts(view: PublicGameView): ArenaMoveRecord[] {
  const handId = view.fairness?.handId ?? 'demo';
  const seed = handId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return (view.actions ?? []).map((a, i) => {
    const p = view.players.find((x) => x.id === a.playerId);
    const model = p?.agent?.model ?? MOCK_TEE_MODEL;
    const n = seed * 13 + i;
    return {
      handId,
      gameId: view.gameId,
      playerId: a.playerId,
      nickname: p?.nickname,
      action: a.type,
      amount: a.amount ?? null,
      challenge: hexOf(n + 1, 16),
      completionId: `chatcmpl-${hexOf(n + 7, 8)}`,
      model,
      signingAddress: hexOf(n + 3, 32),
      signedText: `${model}:${hexOf(n + 11, 32)}:${hexOf(n + 13, 32)}`,
      signature: hexOf(n + 5, 64),
      verifiedAt: new Date(Date.UTC(2026, 10, 11, 12, 0, i * 7)).toISOString(),
    };
  });
}

/** Seat agents with TEE models and move counts that grow with the moves made this hand. */
function withTeeAgents(view: PublicGameView, handNo: number): PublicGameView {
  const receipts = mockReceipts(view);
  return {
    ...view,
    name: MOCK_TABLE_NAME,
    players: view.players.map((p, i) => {
      const mine = receipts.filter((r) => r.playerId === p.id);
      const last = mine[mine.length - 1];
      return {
        ...p,
        agent: {
          model: MOCK_TEE_MODEL,
          // ~3 decisions per seat per earlier hand in this session + this hand's moves.
          movesVerified: (MOVES_BEFORE[i] ?? 50) + (handNo - 1) * 3 + mine.length,
          ...(last ? { lastReceiptUrl: receiptUrl(last) } : {}),
        },
      };
    }),
  };
}

type Step =
  | { kind: 'act'; seat: number; type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in'; to?: number }
  | { kind: 'street'; street: 'flop' | 'turn' | 'river'; cards: number[] }
  | { kind: 'end' };

// UI card ids: rank = id % 13 (0 = 2 … 12 = A), suit = floor(id / 13) (♠ ♥ ♦ ♣).
const SCRIPT: Step[] = [
  { kind: 'act', seat: 3, type: 'raise', to: 30 },
  { kind: 'act', seat: 4, type: 'call' },
  { kind: 'act', seat: 5, type: 'fold' },
  { kind: 'act', seat: 0, type: 'call' },
  { kind: 'act', seat: 1, type: 'fold' },
  { kind: 'act', seat: 2, type: 'call' },
  { kind: 'street', street: 'flop', cards: [11, 31, 26] }, // K♠ 7♦ 2♦
  { kind: 'act', seat: 2, type: 'check' },
  { kind: 'act', seat: 3, type: 'bet', to: 60 },
  { kind: 'act', seat: 4, type: 'fold' },
  { kind: 'act', seat: 0, type: 'raise', to: 180 },
  { kind: 'act', seat: 2, type: 'fold' },
  { kind: 'act', seat: 3, type: 'call' },
  { kind: 'street', street: 'turn', cards: [16] }, // 5♥
  { kind: 'act', seat: 3, type: 'check' },
  { kind: 'act', seat: 0, type: 'bet', to: 150 },
  { kind: 'act', seat: 3, type: 'all-in' },
  { kind: 'act', seat: 0, type: 'call' },
  // Everyone all in → the board runs out with no more betting.
  { kind: 'street', street: 'river', cards: [33] }, // 9♦ — the flush gets there
  { kind: 'end' },
];

const START_STACKS = [2000, 1500, 900, 600, 1200, 800];
// Shark A♦ K♦ (top pair + nut flush draw) · Nit 7♠ 7♣ (set) → Nit ~80% on the turn, Shark rivers the flush.
const HOLE: Record<number, number[]> = { 0: [38, 37], 3: [5, 44] };
const SB = 1;
const BB = 2;
const BLINDS = { sb: 5, bb: 10 };

const LABEL: Record<string, string> = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River' };
const ROUND: Record<string, string> = { preflop: 'PreFlop', flop: 'Flop', turn: 'Turn', river: 'River' };

/** All views of one scripted hand, with the delay before the next view. */
export function mockHandFrames(gameId: string, handNo: number): Array<{ view: PublicGameView; ms: number }> {
  const base = mockArenaView(gameId);
  const ids = base.players.map((p) => p.id);
  const stack = [...START_STACKS];
  const bet = ids.map(() => 0);
  const committed = ids.map(() => 0);
  const folded = ids.map(() => false);
  const board: number[] = [];
  const actions: PublicAction[] = [];
  let street = 'preflop';
  let currentBet = BLINDS.bb;
  const post = (seat: number, amt: number) => {
    stack[seat]! -= amt;
    bet[seat] = amt;
    committed[seat]! += amt;
  };
  post(SB, BLINDS.sb);
  post(BB, BLINDS.bb);

  const handId = `demo-${handNo}`;
  const fairness = { handId, seedHash: (handNo * 7919).toString(16).padStart(8, '0') + 'fd0e1f30'.repeat(7) };

  const snapshot = (nextSeat: number | null): PublicGameView => {
    const pot = committed.reduce((a, b) => a + b, 0);
    const settled = committed.reduce((a, c, i) => a + c - bet[i]!, 0);
    return {
      ...base,
      fairness,
      status: 'playing',
      gameEnded: false,
      round: ROUND[street]!,
      roundLabel: LABEL[street]!,
      street,
      players: base.players.map((p, i) => ({
        ...p,
        chipsInPot: bet[i]!,
        folded: folded[i]!,
        holeCards: [-1, -1],
        allIn: stack[i] === 0 && !folded[i],
        committed: committed[i]!,
      })),
      communityCards: [0, 1, 2, 3, 4].map((i) => board[i] ?? -1),
      pot,
      highestBet: currentBet,
      minRaise: BLINDS.bb,
      dealerSeat: 0,
      stacksByPlayerId: Object.fromEntries(ids.map((id, i) => [id, stack[i]!])),
      nextSeat: nextSeat ?? -1,
      nextPlayerId: nextSeat != null ? ids[nextSeat]! : null,
      nextPlayerNickname: nextSeat != null ? base.players[nextSeat]!.nickname : null,
      winnerId: null,
      winnerNickname: null,
      winningHand: undefined,
      smallBlind: BLINDS.sb,
      bigBlind: BLINDS.bb,
      sbPlayerId: ids[SB]!,
      bbPlayerId: ids[BB]!,
      actions: actions.map((a) => ({ ...a })),
      pots: settled > 0 ? [{ amount: settled, eligible: ids.filter((_, i) => !folded[i]) }] : [],
    };
  };

  const nextActor = (from: number) => {
    for (let j = from; j < SCRIPT.length; j++) {
      const s = SCRIPT[j]!;
      if (s.kind === 'act') return s.seat;
      return null;
    }
    return null;
  };

  const frames: Array<{ view: PublicGameView; ms: number }> = [{ view: snapshot(nextActor(0)), ms: 1400 }];
  const tee = (v: PublicGameView) => withTeeAgents(v, handNo);
  for (let j = 0; j < SCRIPT.length; j++) {
    const s = SCRIPT[j]!;
    if (s.kind === 'act') {
      const i = s.seat;
      let to: number | undefined;
      if (s.type === 'fold') folded[i] = true;
      else if (s.type === 'call') to = Math.min(currentBet, bet[i]! + stack[i]!);
      else if (s.type === 'all-in') to = bet[i]! + stack[i]!;
      else if (s.type === 'bet' || s.type === 'raise') to = s.to!;
      if (to != null) {
        const add = to - bet[i]!;
        stack[i]! -= add;
        committed[i]! += add;
        bet[i] = to;
        currentBet = Math.max(currentBet, to);
      }
      actions.push({ playerId: ids[i]!, street, type: s.type, ...(to != null ? { amount: to } : {}) });
      // The action that closes the action into an all-in run-out goes straight to the result.
      if (SCRIPT[j + 1]?.kind === 'street' && SCRIPT[j + 1 + 1]?.kind === 'end') continue;
      const closes = SCRIPT[j + 1]?.kind !== 'act';
      frames.push({ view: snapshot(nextActor(j + 1)), ms: closes ? 1000 : s.type === 'all-in' ? 1900 : 1300 });
    } else if (s.kind === 'street') {
      street = s.street;
      board.push(...s.cards);
      for (let i = 0; i < bet.length; i++) bet[i] = 0;
      currentBet = 0;
      if (SCRIPT[j + 1]?.kind === 'end') continue;
      frames.push({ view: snapshot(nextActor(j + 1)), ms: 1500 });
    } else {
      // Showdown: Shark's nut flush beats Nit's set of sevens.
      const pot = committed.reduce((a, b) => a + b, 0);
      const winner = 0;
      stack[winner]! += pot;
      const end = snapshot(null);
      frames.push({
        view: {
          ...end,
          status: 'ended',
          gameEnded: true,
          round: 'End',
          roundLabel: 'Showdown',
          street: 'complete',
          pot: 0,
          highestBet: 0,
          players: end.players.map((p, i) => ({
            ...p,
            holeCards: HOLE[i] ?? [-1, -1],
          })),
          stacksByPlayerId: Object.fromEntries(ids.map((id, i) => [id, stack[i]!])),
          winnerId: ids[winner]!,
          winnerNickname: base.players[winner]!.nickname,
          winningHand: 'Flush',
          winners: [{ playerId: ids[winner]!, amount: pot, potIndex: 0 }],
          showdownHands: [
            { playerId: ids[0]!, handName: 'Flush' },
            { playerId: ids[3]!, handName: 'Three of a Kind' },
          ],
          pots: [{ amount: pot, eligible: [ids[0]!, ids[3]!] }],
        },
        ms: 9000,
      });
    }
  }
  return frames.map((f) => ({ ...f, view: tee(f.view) }));
}

/** `mock-arena-2?mock=1`: a table still seating agents (2 of 6, between hands). */
export function mockWaitingView(gameId: string): PublicGameView {
  const base = mockArenaView(gameId);
  const players = base.players.slice(0, 2).map((p) => ({
    ...p,
    chipsInPot: 0,
    folded: false,
    holeCards: [],
    agent: { model: MOCK_TEE_MODEL, movesVerified: 0 },
  }));
  return {
    ...base,
    name: 'Arena #2',
    status: 'waiting',
    round: 'Ante',
    roundLabel: 'Ante',
    street: 'waiting',
    players,
    communityCards: [-1, -1, -1, -1, -1],
    pot: 0,
    highestBet: 0,
    stacksByPlayerId: Object.fromEntries(players.map((p) => [p.id, 1500])),
    nextSeat: -1,
    nextPlayerId: null,
    nextPlayerNickname: null,
    gameStarted: false,
    totalPlayers: players.length,
    fairness: undefined,
    smallBlind: 5,
    bigBlind: 10,
  };
}

/** Stream scripted hands forever. Returns a stop function. */
export function startMockHandLoop(gameId: string, onView: (v: PublicGameView) => void) {
  if (gameId === 'mock-arena-2') {
    onView(mockWaitingView(gameId));
    return () => {};
  }
  let handNo = 1;
  let frames = mockHandFrames(gameId, handNo);
  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    const f = frames[i]!;
    onView(f.view);
    i += 1;
    if (i >= frames.length) {
      handNo += 1;
      frames = mockHandFrames(gameId, handNo);
      i = 0;
    }
    timer = setTimeout(tick, f.ms);
  };
  tick();
  return () => {
    if (timer) clearTimeout(timer);
  };
}
