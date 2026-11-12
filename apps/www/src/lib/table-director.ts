'use client';

/**
 * "TV director" for a spectated table. Turns the stream of public views into broadcast
 * moments: per-seat action labels, chips sliding in and getting swept into the pot, the pot
 * flying to the winner, an all-in shake, a staged board run-out with live win percentages,
 * an action ticker and sound effects.
 *
 * FAIRNESS: everything here is derived from the public view. Win % is only computed for a
 * staged run-out of a hand the server has already completed (all contenders' cards revealed,
 * nobody can act) — see `equityAllowed()`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { PublicAction, PublicGameView } from './api';
import { cardLabel, computeEquity, equityAllowed } from './poker-eval';
import { chipText, type SeatActionFlash } from './seat-action-flash';
import { hydrateSoundMute, playSound, playSoundLater } from './sounds';

export type ChipFlight = { playerId: string; amount: number };

export type TickerItem = {
  id: string;
  kind: 'hand' | 'action' | 'street' | 'win';
  who?: string;
  text: string;
  cards?: number[];
  /** Action type, for colouring. */
  action?: string;
};

export type DirectorState = {
  /** View to render (a staged copy during an all-in run-out). */
  view: PublicGameView;
  /** Chips in front of each seat for the current street. */
  bets: Record<string, number>;
  /** Bets being swept into the pot (key changes per sweep). */
  sweep: { key: string; items: ChipFlight[] } | null;
  /** Pot flying to the winner(s). */
  award: { key: string; items: ChipFlight[] } | null;
  flashes: Record<string, SeatActionFlash>;
  ticker: TickerItem[];
  /** Increments on every all-in → screen shake. */
  shakeKey: number;
  allInSplash: { key: string; nickname: string; amount?: number } | null;
  /** Win share 0..1 per contender — only during a staged run-out (fairness gate). */
  equity: Record<string, number> | null;
  /** Stack overrides while the pot is still flying to the winner (count-up afterwards). */
  stackHold: Record<string, number> | null;
  /** True while an all-in run-out is being staged. */
  runout: boolean;
};

const STREET_NAMES = ['Flop', 'Turn', 'River'];
const RUNOUT_FIRST_MS = 1600;
const RUNOUT_STEP_MS = 1700;
const AWARD_DELAY_MS = 650;
const AWARD_FLIGHT_MS = 900;
/** Keep a finished run-out on screen at least this long before the next hand replaces it. */
const RESULT_HOLD_MS = 2600;
const TICKER_MAX = 14;

const boardOf = (v: PublicGameView) => v.communityCards.filter((c) => c != null && c >= 0);
const isOver = (v: PublicGameView) => Boolean(v.gameEnded) || v.round === 'End' || v.status === 'ended';
const handKey = (v: PublicGameView) => v.fairness?.handId ?? null;
const nick = (v: PublicGameView, id: string) => v.players.find((p) => p.id === id)?.nickname ?? 'Player';

function betsOf(v: PublicGameView): Record<string, number> {
  const out: Record<string, number> = {};
  if (isOver(v) || v.status !== 'playing') return out;
  for (const p of v.players) if (p.chipsInPot > 0) out[p.id] = p.chipsInPot;
  return out;
}

export function actionPhrase(a: Pick<PublicAction, 'type' | 'amount'>): string {
  const amt = a.amount != null ? chipText(a.amount) : '';
  switch (a.type) {
    case 'fold':
      return 'folds';
    case 'check':
      return 'checks';
    case 'call':
      return amt ? `calls ${amt}` : 'calls';
    case 'bet':
      return amt ? `bets ${amt}` : 'bets';
    case 'raise':
      return amt ? `raises to ${amt}` : 'raises';
    case 'all-in':
      return amt ? `is ALL IN for ${amt}` : 'is ALL IN';
    default:
      return String(a.type);
  }
}

/** Older servers / local play: infer actions from successive views. */
function inferActions(prev: PublicGameView, next: PublicGameView): PublicAction[] {
  const out: PublicAction[] = [];
  const street = next.street ?? next.round;
  for (const p of next.players) {
    const before = prev.players.find((x) => x.id === p.id);
    if (!before) continue;
    if (p.folded && !before.folded) {
      out.push({ playerId: p.id, street, type: 'fold' });
      continue;
    }
    if (p.chipsInPot > before.chipsInPot) {
      const stack = next.stacksByPlayerId?.[p.id];
      const type =
        stack != null && stack <= 0
          ? 'all-in'
          : next.highestBet > prev.highestBet
            ? prev.highestBet === 0
              ? 'bet'
              : 'raise'
            : 'call';
      out.push({ playerId: p.id, street, type, amount: p.chipsInPot });
    }
  }
  if (
    out.length === 0 &&
    prev.nextPlayerId &&
    next.nextPlayerId !== prev.nextPlayerId &&
    next.pot === prev.pot &&
    boardOf(next).length === boardOf(prev).length
  ) {
    out.push({ playerId: prev.nextPlayerId, street, type: 'check' });
  }
  return out;
}

function sumWinners(v: PublicGameView, fallbackPot: number): ChipFlight[] {
  if (v.winners && v.winners.length > 0) {
    const by = new Map<string, number>();
    for (const w of v.winners) by.set(w.playerId, (by.get(w.playerId) ?? 0) + w.amount);
    return [...by].map(([playerId, amount]) => ({ playerId, amount }));
  }
  return v.winnerId ? [{ playerId: v.winnerId, amount: fallbackPot }] : [];
}

/** A copy of the finished view with the board cut back to `shown` cards for a staged run-out. */
function stagedView(final: PublicGameView, shown: number, pot: number, stacks: Record<string, number> | undefined): PublicGameView {
  const board = boardOf(final);
  const street = shown >= 5 ? 'river' : shown === 4 ? 'turn' : shown === 3 ? 'flop' : 'preflop';
  const label = shown >= 5 ? 'River' : shown === 4 ? 'Turn' : shown === 3 ? 'Flop' : 'Pre-Flop';
  return {
    ...final,
    status: 'playing',
    gameEnded: false,
    round: label.replace('-', ''),
    roundLabel: `${label} · all in`,
    street,
    communityCards: [0, 1, 2, 3, 4].map((i) => (i < shown ? board[i]! : -1)),
    winnerId: null,
    winnerNickname: null,
    winningHand: undefined,
    winners: undefined,
    showdownHands: undefined,
    nextPlayerId: null,
    nextPlayerNickname: null,
    pot,
    stacksByPlayerId: stacks ?? final.stacksByPlayerId,
    players: final.players.map((p) => ({ ...p, chipsInPot: 0 })),
  };
}

function equityFor(v: PublicGameView, shown: number): Record<string, number> | null {
  // Gate on the *finished* view: the server has revealed the cards and nobody can act.
  if (!equityAllowed(v)) return null;
  const hands: Record<string, number[]> = {};
  const dead: number[] = [];
  for (const p of v.players) {
    if (p.holeCards.length !== 2 || p.holeCards.some((c) => c < 0)) continue;
    if (p.folded) dead.push(...p.holeCards);
    else hands[p.id] = p.holeCards;
  }
  return computeEquity({ hands, board: boardOf(v).slice(0, shown), dead, iterations: 2000 });
}

export function useTableDirector(
  raw: PublicGameView,
  opts?: { sound?: boolean }
): DirectorState {
  const sound = opts?.sound ?? true;
  const [state, setState] = useState<DirectorState>(() => ({
    view: raw,
    bets: betsOf(raw),
    sweep: null,
    award: null,
    flashes: {},
    ticker: [],
    shakeKey: 0,
    allInSplash: null,
    equity: null,
    stackHold: null,
    runout: false,
  }));

  const prevRef = useRef<PublicGameView | null>(null);
  /** While staging a run-out, newer views wait here. */
  const busyUntilRef = useRef(0);
  const pendingRef = useRef<PublicGameView | null>(null);
  const timersRef = useRef<number[]>([]);
  const seqRef = useRef(0);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
  };
  const sfx = (name: Parameters<typeof playSound>[0], vol: number, delay = 0) => {
    if (!soundRef.current) return;
    if (delay > 0) playSoundLater(name, delay, vol);
    else playSound(name, vol);
  };

  useEffect(() => {
    hydrateSoundMute();
    const timers = timersRef.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const ingest = (next: PublicGameView) => {
      const now = Date.now();
      if (now < busyUntilRef.current) {
        pendingRef.current = next;
        return;
      }
      const prev = prevRef.current;
      prevRef.current = next;
      const key = () => `k${++seqRef.current}`;

      if (!prev) {
        setState((s) => ({ ...s, view: next, bets: betsOf(next) }));
        return;
      }

      const newHand =
        (handKey(next) != null && handKey(next) !== handKey(prev)) ||
        (isOver(prev) && !isOver(next) && next.status === 'playing');
      const me = next.myPlayerId;
      const ticker: TickerItem[] = [];
      const flashes: Record<string, SeatActionFlash> = {};
      let shake = false;
      let splash: DirectorState['allInSplash'] = null;

      if (newHand) {
        const parts: string[] = [];
        if (next.sbPlayerId && next.smallBlind) parts.push(`${nick(next, next.sbPlayerId)} posts SB ${chipText(next.smallBlind)}`);
        if (next.bbPlayerId && next.bigBlind) parts.push(`${nick(next, next.bbPlayerId)} posts BB ${chipText(next.bigBlind)}`);
        ticker.push({ id: key(), kind: 'hand', text: parts.length ? `New hand · ${parts.join(' · ')}` : 'New hand' });
        sfx('shuffle', 0.35);
        sfx('cardDeal', 0.7, 250);
        sfx('cardDeal', 0.6, 420);
      }

      // ---- actions since the last view ----
      const sameHand = !newHand;
      const prevActs = sameHand ? prev.actions?.length ?? 0 : 0;
      const acts: PublicAction[] = next.actions
        ? next.actions.slice(prevActs)
        : sameHand && !isOver(prev)
          ? inferActions(prev, next)
          : [];
      acts.forEach((a, i) => {
        const delay = i * 220;
        flashes[a.playerId] = { id: key(), action: a.type, amount: a.amount ?? null, actionIndex: next.actions ? prevActs + i : undefined };
        ticker.push({ id: key(), kind: 'action', who: nick(next, a.playerId), text: actionPhrase(a), action: a.type });
        const own = me != null && a.playerId === me;
        if (a.type === 'all-in') {
          shake = true;
          splash = { key: key(), nickname: nick(next, a.playerId), amount: a.amount };
          sfx('chipsShuffle', 0.9, delay);
          sfx('allIn', 0.8, delay + 120);
        } else if (!own) {
          if (a.type === 'fold') sfx('foldSwish', 0.45, delay);
          else if (a.type === 'check') sfx('checkTap', 0.6, delay);
          else if (a.type === 'call') sfx('chipsBet', 0.65, delay);
          else if (a.type === 'bet' || a.type === 'raise') sfx('chipsBet', 0.85, delay);
        }
      });

      // ---- street change: sweep bets into the pot, then deal ----
      const prevBoard = boardOf(prev);
      const nextBoard = boardOf(next);
      const prevBets = betsOf(prev);
      const lastBets: Record<string, number> = { ...prevBets };
      // Bets made by the action that closed the street never show up in an in-hand view.
      for (const a of acts) if (a.amount != null && a.amount > 0) lastBets[a.playerId] = a.amount;
      const sweepItems = Object.entries(lastBets)
        .filter(([, amount]) => amount > 0)
        .map(([playerId, amount]) => ({ playerId, amount }));

      const ended = isOver(next) && !isOver(prev) && sameHand;
      const runout =
        ended &&
        prevBoard.length < 5 &&
        nextBoard.length === 5 &&
        nextBoard.length - prevBoard.length >= 1 &&
        Boolean(next.showdownHands?.length || next.winningHand) &&
        // Only stage when nobody acted on the final street (it was dealt with everyone all in).
        !acts.some((a) => a.street === 'river') &&
        equityAllowed(next);

      if (sameHand && nextBoard.length > prevBoard.length && !runout) {
        const added = nextBoard.slice(prevBoard.length);
        const name =
          nextBoard.length === 3 ? 'Flop' : nextBoard.length === 4 ? 'Turn' : nextBoard.length === 5 ? 'River' : 'Board';
        if (prevBoard.length === 0 && nextBoard.length > 3) {
          ticker.push({ id: key(), kind: 'street', text: 'Board', cards: nextBoard });
        } else {
          ticker.push({ id: key(), kind: 'street', text: name, cards: added });
        }
        if (sweepItems.length) sfx('chipsToPot', 0.6, 150);
        sfx('cardDeal', 0.7, 450);
      }

      // At hand end the payouts are the true pot (the closing call never shows up in an in-hand
      // view), so the staged run-out shows the same number the winner is paid.
      const paid = (next.winners ?? []).reduce((s, w) => s + w.amount, 0);
      const potBefore = Math.max(prev.pot, next.pot, paid, sweepItems.reduce((s, x) => s + x.amount, 0));

      if (ended) {
        const winners = sumWinners(next, potBefore);
        const holdStacks: Record<string, number> = { ...(next.stacksByPlayerId ?? {}) };
        for (const w of winners) holdStacks[w.playerId] = Math.max(0, (holdStacks[w.playerId] ?? 0) - w.amount);
        const winTicker = (): TickerItem[] =>
          winners.map((w) => {
            const hand = next.showdownHands?.find((h) => h.playerId === w.playerId)?.handName;
            return {
              id: key(),
              kind: 'win',
              who: nick(next, w.playerId),
              text: `wins ${chipText(w.amount)}${hand ? ` with ${hand}` : ''}`,
            };
          });

        const pay = (startMs: number) => {
          later(() => {
            setState((s) => ({ ...s, award: { key: key(), items: winners }, stackHold: holdStacks }));
            sfx('chipsShuffle', 0.75);
            sfx('win', 0.85, 380);
          }, startMs);
          later(() => setState((s) => ({ ...s, stackHold: null })), startMs + AWARD_FLIGHT_MS);
        };

        if (runout) {
          // ---- TV run-out: reveal hands, deal remaining streets one by one with live win % ----
          const steps: number[] = [];
          for (let n = prevBoard.length; n <= 5; n++) if (n === 0 || n >= 3) steps.push(n);
          const uniq = [...new Set(steps.map((n) => (n > 0 && n < 3 ? 3 : n)))];
          let t = 0;
          busyUntilRef.current = Date.now() + RUNOUT_FIRST_MS + RUNOUT_STEP_MS * (uniq.length - 1) + RESULT_HOLD_MS;
          uniq.forEach((shown, i) => {
            const at = i === 0 ? 0 : RUNOUT_FIRST_MS + RUNOUT_STEP_MS * (i - 1);
            t = at;
            later(() => {
              const eq = equityFor(next, shown);
              const added = boardOf(next).slice(i === 0 ? shown : uniq[i - 1]!, shown);
              setState((s) => ({
                ...s,
                view: stagedView(next, shown, potBefore, holdStacks),
                bets: {},
                equity: eq,
                runout: true,
                ...(i === 0
                  ? {
                      sweep: sweepItems.length ? { key: key(), items: sweepItems } : s.sweep,
                      flashes: { ...s.flashes, ...flashes },
                      ticker: [...s.ticker, ...ticker, { id: key(), kind: 'street' as const, text: 'All in · cards up' }].slice(-TICKER_MAX),
                      shakeKey: shake ? s.shakeKey + 1 : s.shakeKey,
                      allInSplash: splash ?? s.allInSplash,
                    }
                  : {
                      ticker: [
                        ...s.ticker,
                        { id: key(), kind: 'street' as const, text: STREET_NAMES[shown === 3 ? 0 : shown === 4 ? 1 : 2]!, cards: added },
                      ].slice(-TICKER_MAX),
                    }),
              }));
              if (i === 0) {
                if (sweepItems.length) sfx('chipsToPot', 0.6, 200);
              } else sfx('cardDeal', 0.8);
            }, at);
          });
          const end = t + RUNOUT_STEP_MS;
          later(() => {
            setState((s) => ({
              ...s,
              view: next,
              bets: {},
              equity: null,
              runout: false,
              stackHold: holdStacks,
              ticker: [...s.ticker, ...winTicker()].slice(-TICKER_MAX),
            }));
          }, end);
          pay(end + AWARD_DELAY_MS);
          later(() => {
            busyUntilRef.current = 0;
            const pending = pendingRef.current;
            pendingRef.current = null;
            if (pending) ingest(pending);
          }, end + RESULT_HOLD_MS);
          return;
        }

        // ---- normal hand end: sweep, then push the pot to the winner ----
        setState((s) => ({
          ...s,
          view: next,
          bets: {},
          sweep: sweepItems.length ? { key: key(), items: sweepItems } : null,
          flashes: { ...s.flashes, ...flashes },
          ticker: [...s.ticker, ...ticker, ...winTicker()].slice(-TICKER_MAX),
          shakeKey: shake ? s.shakeKey + 1 : s.shakeKey,
          allInSplash: splash ?? s.allInSplash,
          equity: null,
          runout: false,
          stackHold: holdStacks,
        }));
        if (sweepItems.length) sfx('chipsToPot', 0.6, 120);
        pay(sweepItems.length ? AWARD_DELAY_MS : 200);
        return;
      }

      const streetChanged = sameHand && nextBoard.length > prevBoard.length;
      setState((s) => ({
        ...s,
        view: next,
        bets: betsOf(next),
        sweep: streetChanged && sweepItems.length ? { key: key(), items: sweepItems } : newHand ? null : s.sweep,
        award: newHand ? null : s.award,
        flashes: newHand ? { ...flashes } : { ...s.flashes, ...flashes },
        ticker: (newHand ? ticker : [...s.ticker, ...ticker]).slice(-TICKER_MAX),
        shakeKey: shake ? s.shakeKey + 1 : s.shakeKey,
        allInSplash: splash ?? (newHand ? null : s.allInSplash),
        equity: null,
        runout: false,
        stackHold: newHand ? null : s.stackHold,
      }));
    };

    ingest(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ingest is stable per render
  }, [raw]);

  return state;
}

/** Ticker card text like "K♠ 7♦ 2♣". */
export function cardsText(cards: number[]) {
  return cards.map(cardLabel).join(' ');
}

/** Memoised map of player id → nickname for overlays. */
export function useNicknames(view: PublicGameView) {
  return useMemo(() => Object.fromEntries(view.players.map((p) => [p.id, p.nickname])), [view.players]);
}
