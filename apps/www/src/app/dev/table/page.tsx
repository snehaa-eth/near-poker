'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  SleekTable,
} from '~/app/game/[id]/_components/sleek-table';
import type { LocalTableAction } from '~/app/game/[id]/_components/action-bar';
import { Button } from '~/components/ui/button';
import type { PublicGameView } from '~/lib/api';
import { truncate } from '~/lib/utils';

const ME = 'player_you';
const BOTS = [
  { id: 'player_bot_1', nickname: 'Nova' },
  { id: 'player_bot_2', nickname: 'Rex' },
  { id: 'player_bot_3', nickname: 'Mia' },
  { id: 'player_bot_4', nickname: 'Kai' },
] as const;
const PLAYER_COUNT = 1 + BOTS.length;
const START_STACK = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

type Street = 'Preflop' | 'Flop' | 'Turn' | 'River' | 'Showdown';

type SeatState = {
  id: string;
  nickname: string;
  seat: number;
  stack: number;
  chipsInPot: number;
  folded: boolean;
  holeCards: number[];
  actedThisStreet: boolean;
};

type HandState = {
  street: Street;
  community: number[];
  pot: number;
  highestBet: number;
  nextId: string;
  deck: number[];
  winnerId: string | null;
  handOver: boolean;
  seats: SeatState[];
};

function shuffleDeck(): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

function draw(deck: number[], n: number): { cards: number[]; deck: number[] } {
  return { cards: deck.slice(0, n), deck: deck.slice(n) };
}

function seatOf(state: HandState, id: string): SeatState {
  return state.seats.find((s) => s.id === id)!;
}

function activeSeats(state: HandState): SeatState[] {
  return state.seats.filter((s) => !s.folded);
}

function nextActiveId(state: HandState, fromId: string): string {
  const start = state.seats.findIndex((s) => s.id === fromId);
  for (let i = 1; i <= state.seats.length; i++) {
    const seat = state.seats[(start + i) % state.seats.length]!;
    if (!seat.folded && (seat.stack > 0 || seat.chipsInPot < state.highestBet)) {
      return seat.id;
    }
    if (!seat.folded && seat.stack > 0) return seat.id;
  }
  // Fallback: next non-folded
  for (let i = 1; i <= state.seats.length; i++) {
    const seat = state.seats[(start + i) % state.seats.length]!;
    if (!seat.folded) return seat.id;
  }
  return fromId;
}

function patchSeat(
  state: HandState,
  id: string,
  patch: Partial<SeatState>
): HandState {
  return {
    ...state,
    seats: state.seats.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
}

function putChips(state: HandState, id: string, toAmount: number): HandState {
  const seat = seatOf(state, id);
  const target = Math.min(toAmount, seat.stack + seat.chipsInPot);
  const delta = Math.max(0, target - seat.chipsInPot);
  if (delta === 0 && toAmount === 0) {
    return patchSeat(state, id, { actedThisStreet: true });
  }
  return {
    ...patchSeat(state, id, {
      stack: seat.stack - delta,
      chipsInPot: seat.chipsInPot + delta,
      actedThisStreet: true,
    }),
    pot: state.pot + delta,
    highestBet: Math.max(state.highestBet, seat.chipsInPot + delta),
  };
}

function roundComplete(state: HandState): boolean {
  const live = activeSeats(state);
  if (live.length <= 1) return true;
  return live.every((s) => {
    const matched = s.chipsInPot === state.highestBet || s.stack === 0;
    return matched && (s.actedThisStreet || s.stack === 0);
  });
}

function resetStreetFlags(state: HandState): HandState {
  return {
    ...state,
    highestBet: 0,
    seats: state.seats.map((s) => ({
      ...s,
      chipsInPot: 0,
      actedThisStreet: false,
    })),
  };
}

function dealBoard(state: HandState, n: number): HandState {
  const { cards, deck } = draw(state.deck, n);
  return {
    ...state,
    deck,
    community: [...state.community, ...cards],
  };
}

function firstToAct(state: HandState): string {
  const live = activeSeats(state);
  return live.find((s) => s.stack > 0)?.id ?? live[0]!.id;
}

function runOutBoard(state: HandState): HandState {
  let next = resetStreetFlags(state);
  while (next.community.length < 5) {
    const need = next.community.length === 0 ? 3 : 1;
    next = dealBoard(next, need);
  }
  return showdown({ ...next, street: 'River' });
}

function advanceStreet(state: HandState): HandState {
  if (state.handOver) return state;
  const live = activeSeats(state);
  if (live.length === 1) {
    return awardPot(state, live[0]!.id);
  }
  if (!roundComplete(state)) return state;

  if (live.some((s) => s.stack === 0)) {
    const allAllInOrMatched = live.every(
      (s) => s.stack === 0 || s.chipsInPot === state.highestBet
    );
    if (allAllInOrMatched && live.filter((s) => s.stack > 0).length <= 1) {
      return runOutBoard(state);
    }
  }

  let next = resetStreetFlags(state);
  if (next.street === 'Preflop') {
    return {
      ...dealBoard(next, 3),
      street: 'Flop',
      nextId: firstToAct(next),
    };
  }
  if (next.street === 'Flop') {
    return {
      ...dealBoard(next, 1),
      street: 'Turn',
      nextId: firstToAct(next),
    };
  }
  if (next.street === 'Turn') {
    return {
      ...dealBoard(next, 1),
      street: 'River',
      nextId: firstToAct(next),
    };
  }
  return showdown(next);
}

/** Dummy strength: high-card sum of hole + board (good enough for UI play). */
function handScore(seat: SeatState, community: number[]): number {
  const cards = [...seat.holeCards, ...community].filter((c) => c >= 0);
  return cards.reduce((sum, c) => sum + (c % 13), 0);
}

function showdown(state: HandState): HandState {
  const live = activeSeats(state);
  if (live.length === 0) return { ...state, street: 'Showdown', handOver: true };
  if (live.length === 1) return awardPot(state, live[0]!.id);

  const scored = live.map((s) => ({ id: s.id, score: handScore(s, state.community) }));
  const best = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === best).map((s) => s.id);

  if (winners.length === 1) {
    return awardPot({ ...state, street: 'Showdown' }, winners[0]!);
  }

  const share = Math.floor(state.pot / winners.length);
  const remainder = state.pot - share * winners.length;
  return {
    ...state,
    street: 'Showdown',
    handOver: true,
    winnerId: null,
    pot: 0,
    seats: state.seats.map((s) => {
      if (!winners.includes(s.id)) return s;
      const extra = winners[0] === s.id ? remainder : 0;
      return { ...s, stack: s.stack + share + extra };
    }),
  };
}

function awardPot(state: HandState, winnerId: string): HandState {
  return {
    ...state,
    handOver: true,
    winnerId,
    pot: 0,
    seats: state.seats.map((s) =>
      s.id === winnerId ? { ...s, stack: s.stack + state.pot } : s
    ),
  };
}

function applyAction(
  state: HandState,
  actorId: string,
  action: LocalTableAction
): HandState {
  if (state.handOver || state.nextId !== actorId) return state;
  let next = state;

  if (action.type === 'fold') {
    next = patchSeat(next, actorId, { folded: true, actedThisStreet: true });
    const live = activeSeats(next);
    if (live.length === 1) {
      return awardPot(next, live[0]!.id);
    }
    next = { ...next, nextId: nextActiveId(next, actorId) };
    if (roundComplete(next)) {
      next = advanceStreet(next);
    }
    return next;
  }

  if (action.amount === 0) {
    const seat = seatOf(next, actorId);
    if (seat.chipsInPot < next.highestBet) return state;
    next = patchSeat(next, actorId, { actedThisStreet: true });
  } else {
    const beforeHighest = next.highestBet;
    next = putChips(next, actorId, action.amount);
    // Raise resets acted flags for others
    if (next.highestBet > beforeHighest) {
      next = {
        ...next,
        seats: next.seats.map((s) =>
          s.id === actorId || s.folded
            ? s
            : { ...s, actedThisStreet: false }
        ),
      };
    }
  }

  next = { ...next, nextId: nextActiveId(next, actorId) };

  if (roundComplete(next)) {
    next = advanceStreet(next);
  }
  return next;
}

function newHand(prevStacks?: Record<string, number>): HandState {
  let deck = shuffleDeck();

  const seats: SeatState[] = [];
  const youDraw = draw(deck, 2);
  deck = youDraw.deck;
  seats.push({
    id: ME,
    nickname: 'You',
    seat: 0,
    stack: prevStacks?.[ME] ?? START_STACK,
    chipsInPot: 0,
    folded: false,
    holeCards: youDraw.cards,
    actedThisStreet: false,
  });

  BOTS.forEach((bot, i) => {
    const dealt = draw(deck, 2);
    deck = dealt.deck;
    seats.push({
      id: bot.id,
      nickname: bot.nickname,
      seat: i + 1,
      stack: prevStacks?.[bot.id] ?? START_STACK,
      chipsInPot: 0,
      folded: false,
      holeCards: dealt.cards,
      actedThisStreet: false,
    });
  });

  let state: HandState = {
    street: 'Preflop',
    community: [],
    pot: 0,
    highestBet: 0,
    nextId: ME,
    deck,
    winnerId: null,
    handOver: false,
    seats,
  };

  // Posts: you = SB, first bot = BB; action starts with next bot (UTG)
  state = putChips(state, ME, SMALL_BLIND);
  state = putChips(state, BOTS[0]!.id, BIG_BLIND);
  state = {
    ...state,
    seats: state.seats.map((s) => ({
      ...s,
      actedThisStreet: false,
    })),
    nextId: BOTS[1]?.id ?? ME,
  };
  return state;
}

function toView(state: HandState): PublicGameView {
  const me = seatOf(state, ME);
  const showCards = state.handOver && !me.folded;
  return {
    gameId: 'game_dummy_play',
    name: 'Dummy Practice Table',
    joinCode: 'DUMMY',
    minChips: 0,
    maxPlayers: PLAYER_COUNT,
    status: state.handOver ? 'finished' : 'playing',
    round: state.street,
    roundLabel: state.handOver
      ? 'Showdown'
      : state.street === 'Preflop'
        ? 'Pre-Flop'
        : state.street,
    players: state.seats.map((s) => ({
      id: s.id,
      nickname: s.nickname,
      seat: s.seat,
      chipsInPot: s.chipsInPot,
      folded: s.folded,
      shuffled: true,
      holeCards:
        s.id === ME
          ? s.holeCards
          : showCards
            ? s.holeCards
            : s.holeCards.map(() => -1),
      chosenCommunity: [],
      weight: 0,
    })),
    communityCards: [
      ...state.community,
      ...Array.from({ length: Math.max(0, 5 - state.community.length) }, () => -1),
    ],
    pot: state.pot,
    highestBet: state.highestBet,
    nextSeat: seatOf(state, state.nextId).seat,
    nextPlayerId: state.handOver ? null : state.nextId,
    nextPlayerNickname: state.handOver
      ? null
      : seatOf(state, state.nextId).nickname,
    winnerId: state.winnerId,
    winnerNickname: state.winnerId
      ? seatOf(state, state.winnerId).nickname
      : state.handOver && !state.winnerId
        ? 'Split'
        : null,
    totalPlayers: PLAYER_COUNT,
    totalShuffles: PLAYER_COUNT,
    gameStarted: true,
    gameEnded: state.handOver,
    myPlayerId: ME,
    isMyTurn: !state.handOver && state.nextId === ME,
  };
}

function pickBotAction(state: HandState, botId: string): LocalTableAction {
  const bot = seatOf(state, botId);
  const toCall = Math.max(0, state.highestBet - bot.chipsInPot);
  const roll = Math.random();

  if (toCall === 0) {
    if (roll < 0.7) return { type: 'bet', amount: 0 };
    const bet = Math.min(
      bot.stack + bot.chipsInPot,
      Math.max(BIG_BLIND, Math.round((bot.stack + bot.chipsInPot) * 0.3))
    );
    return { type: 'bet', amount: bet };
  }

  if (roll < 0.25) return { type: 'fold' };
  if (roll < 0.85 || bot.stack <= toCall) {
    return { type: 'bet', amount: state.highestBet };
  }
  const raiseTo = Math.min(
    bot.stack + bot.chipsInPot,
    state.highestBet + Math.max(BIG_BLIND, Math.round(state.pot * 0.5))
  );
  return { type: 'bet', amount: Math.max(raiseTo, state.highestBet + 1) };
}

/** Full-screen playable dummy table — you vs 4 auto-opponents, no wallet. */
export default function DummyTablePage() {
  const [hand, setHand] = useState<HandState>(() => newHand());
  const handRef = useRef(hand);
  handRef.current = hand;

  const view = useMemo(() => toView(hand), [hand]);
  const stacksByPlayerId = useMemo(() => {
    const stacks: Record<string, number> = {};
    for (const s of hand.seats) stacks[s.id] = s.stack;
    return stacks;
  }, [hand]);

  const onLocalAction = useCallback((action: LocalTableAction) => {
    setHand((prev) => applyAction(prev, prev.nextId, action));
  }, []);

  // Bot auto-play
  useEffect(() => {
    if (hand.handOver || hand.nextId === ME) return;
    const actorId = hand.nextId;
    const t = window.setTimeout(() => {
      const current = handRef.current;
      if (current.handOver || current.nextId !== actorId) return;
      const action = pickBotAction(current, actorId);
      setHand(applyAction(current, actorId, action));
    }, 550 + Math.random() * 450);
    return () => window.clearTimeout(t);
  }, [hand.handOver, hand.nextId, hand.highestBet, hand.street, hand.pot]);

  const dealNext = () => {
    const stacks: Record<string, number> = {};
    let anyBroke = false;
    for (const s of hand.seats) {
      stacks[s.id] = s.stack;
      if (s.stack <= 0) anyBroke = true;
    }
    if (anyBroke) {
      setHand(newHand());
      return;
    }
    setHand(newHand(stacks));
  };

  return (
    <div className='relative'>
      <SleekTable
        gameId={view.gameId}
        view={view}
        stacksByPlayerId={stacksByPlayerId}
        onLocalAction={onLocalAction}
      />

      <div className='pointer-events-none absolute left-4 top-20 z-30 max-w-[70vw] text-xs text-white/70'>
        <p className='truncate font-medium text-white'>{view.name}</p>
        <p className='mt-0.5 font-mono text-white/60'>
          {view.joinCode} · {truncate(view.gameId, 14)} · blinds {SMALL_BLIND}/
          {BIG_BLIND} · {PLAYER_COUNT}-max
        </p>
      </div>

      <div className='absolute right-4 top-20 z-30 flex items-center gap-2'>
        <span className='rounded-full bg-neutral-950/80 px-3 py-1 text-[11px] font-medium text-white'>
          Dummy play
        </span>
        {hand.handOver ? (
          <Button
            type='button'
            size='sm'
            className='pointer-events-auto rounded-full bg-[#1D9BF0] text-white hover:bg-[#1a8cd8]'
            onClick={dealNext}
          >
            Next hand
          </Button>
        ) : null}
      </div>
    </div>
  );
}
