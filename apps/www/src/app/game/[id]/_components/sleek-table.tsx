'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';

import type { PublicGameView } from '~/lib/api';
import { ChipAmount } from '~/components/currency-amount';
import { playSound } from '~/lib/sounds';
import { useSession } from '~/providers/session-provider';
import { useSocket } from '~/providers/socket-provider';
import { cn } from '~/lib/utils';

import { ActionBar, type LocalTableAction } from './action-bar';
import { PlayerSeat, seatPositions } from './player-seat';
import { SleekCard } from './sleek-card';

import { toast } from 'sonner';

/** Seconds each player has to act before auto-fold. */
export const TURN_SECONDS = 90;

interface SleekTableProps {
  gameId: string;
  view: PublicGameView;
  /** Fixed stack for seats (preview / offline UI). */
  stackOverride?: number;
  /** Per-seat stacks when stacks differ (dummy play). */
  stacksByPlayerId?: Record<string, number>;
  /** Hide live action bar — for dual-player UI previews. */
  preview?: boolean;
  /** Compact layout for side-by-side testing. */
  compact?: boolean;
  /** Offline / dummy table actions. */
  onLocalAction?: (action: LocalTableAction) => void;
}

function formatTurnClock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export const SleekTable = ({
  gameId,
  view,
  stackOverride,
  stacksByPlayerId,
  preview = false,
  compact = false,
  onLocalAction,
}: SleekTableProps) => {
  const { user } = useSession();
  const { socket } = useSocket();
  const seatStacks = stacksByPlayerId ?? view.stacksByPlayerId;
  const defaultStack = stackOverride ?? user?.chips ?? 10000;
  const myStack =
    (view.myPlayerId ? seatStacks?.[view.myPlayerId] : undefined) ??
    defaultStack;
  const dealerSeat = view.dealerSeat ?? 0;

  const turnActive =
    view.status === 'playing' &&
    !view.gameEnded &&
    view.round !== 'End' &&
    Boolean(view.nextPlayerId);

  const turnKey = turnActive
    ? `${view.nextPlayerId}:${view.street}:${view.round}`
    : null;

  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(TURN_SECONDS);
  const foldedForTurnRef = useRef<string | null>(null);

  useEffect(() => {
    if (!turnKey) {
      setTurnEndsAt(null);
      setSecondsLeft(TURN_SECONDS);
      foldedForTurnRef.current = null;
      return;
    }
    foldedForTurnRef.current = null;
    const endsAt = Date.now() + TURN_SECONDS * 1000;
    setTurnEndsAt(endsAt);
    setSecondsLeft(TURN_SECONDS);
  }, [turnKey]);

  useEffect(() => {
    if (!turnEndsAt || !turnKey) return;

    const tick = () => {
      const left = Math.max(0, (turnEndsAt - Date.now()) / 1000);
      setSecondsLeft(left);

      if (left > 0) return;
      if (foldedForTurnRef.current === turnKey) return;
      foldedForTurnRef.current = turnKey;

      // Dummy: fold whoever is acting. Live: only fold yourself.
      if (!onLocalAction && !view.isMyTurn) return;

      try {
        playSound('paajiLose');
        if (onLocalAction) {
          onLocalAction({ type: 'fold' });
        } else if (socket) {
          socket.emit('game:fold', { gameId });
        }
        if (view.isMyTurn) {
          toast.message('Time’s up — folded');
        }
      } catch {
        /* ignore */
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [turnEndsAt, turnKey, view.isMyTurn, onLocalAction, socket, gameId]);

  const ordered = useMemo(() => {
    const players = [...view.players].sort((a, b) => a.seat - b.seat);
    const myIndex = players.findIndex((p) => p.id === view.myPlayerId);
    if (myIndex <= 0) return players;
    return [...players.slice(myIndex), ...players.slice(0, myIndex)];
  }, [view.players, view.myPlayerId]);

  const positions = seatPositions(Math.max(ordered.length, 2));
  const board = view.communityCards.filter((c) => c >= 0);

  return (
    <div
      className={cn(
        'relative flex w-full flex-col overflow-hidden',
        compact ? 'h-full min-h-[28rem] pt-2' : 'h-[100dvh] pt-16'
      )}
    >
      {/* Felt photo sits behind the whole play surface */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[#0a2e22]'
        style={{
          backgroundImage: "url('/table-felt-bg.png?v=2')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30'
      />

      <div className='relative z-10 mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center px-2 sm:px-4 lg:max-w-7xl xl:max-w-[84rem]'>
        <div
          className={cn(
            'relative aspect-[1.75/1] w-full',
            compact
              ? 'max-h-[min(42vh,360px)]'
              : 'max-h-[min(calc(100dvh-13.5rem),560px)] lg:max-h-[min(calc(100dvh-13.5rem),640px)] xl:max-h-[min(calc(100dvh-13.5rem),700px)]'
          )}
        >
          {/* Table rail + felt window over the photo */}
          <div className='absolute inset-[7%] rounded-[999px] border-[6px] border-white bg-emerald-950/20 shadow-[0_18px_50px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.2)] lg:border-[8px] xl:border-[10px]' />
          <div className='absolute inset-[7%] rounded-[999px] ring-1 ring-white/40' />
          <div className='absolute inset-[12%] rounded-[999px] border-2 border-white/35 shadow-[inset_0_0_40px_rgba(0,0,0,0.25)]' />

          <div className='absolute left-1/2 top-1/2 z-10 flex w-full -translate-x-1/2 -translate-y-[55%] flex-col items-center gap-3 lg:gap-3.5'>
            <div className='flex items-center gap-2 rounded-full bg-white/90 px-4 py-1.5 text-[13px] font-medium text-neutral-500 shadow-md backdrop-blur lg:px-5 lg:py-2 lg:text-sm'>
              Pot
              <ChipAmount
                value={view.pot}
                size='sm'
                className='text-[13px] text-neutral-900 lg:text-sm'
                iconClassName='h-4 w-4'
              />
              <span className='mx-1 text-neutral-300'>·</span>
              <span className='font-semibold text-neutral-800'>
                {view.roundLabel}
              </span>
            </div>

            {view.fairness ? (
              view.fairness.revealed || view.gameEnded || view.round === 'End' ? (
                <Link
                  href={`/verify/${encodeURIComponent(view.fairness.handId)}`}
                  target='_blank'
                  className='rounded-full bg-emerald-50/95 px-3 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200 transition hover:bg-white lg:text-xs'
                >
                  ✅ Verify hand
                </Link>
              ) : (
                <span
                  title={`Deck seed hash committed before the deal: ${view.fairness.seedHash}`}
                  className='rounded-full bg-black/45 px-3 py-1 font-mono text-[11px] text-white/90 shadow-sm backdrop-blur-sm lg:text-xs'
                >
                  🔒 Deck committed · {view.fairness.seedHash.slice(0, 8)}
                </span>
              )
            ) : null}

            <div className='flex min-h-[4.75rem] items-center gap-2 lg:min-h-[5.5rem] lg:gap-2.5 xl:min-h-[6rem]'>
              {board.length === 0 ? (
                <div className='rounded-2xl border border-white/25 bg-black/25 px-5 py-4 text-xs text-white/75 backdrop-blur-sm lg:px-6 lg:text-sm'>
                  Waiting for flop
                </div>
              ) : (
                <>
                  {board.map((cardId, i) => (
                    <SleekCard
                      key={`board-${i}-${cardId}`}
                      cardId={cardId}
                      className='hover:-translate-y-0.5'
                      size='md'
                    />
                  ))}
                  {board.length < 5
                    ? Array.from({ length: 5 - board.length }).map((_, i) => (
                        <SleekCard key={`pad-${i}`} cardId={-1} size='md' />
                      ))
                    : null}
                </>
              )}
            </div>

            {view.gameEnded && view.winnerNickname ? (
              <div className='rounded-full bg-neutral-950 px-4 py-1.5 text-sm font-semibold text-white shadow-lg'>
                Winner · {view.winnerNickname}
              </div>
            ) : null}
          </div>

          {ordered.map((player, index) => {
            const pos = positions[index] ?? { left: '50%', top: '50%' };
            const isMe = player.id === view.myPlayerId;
            const isTurn =
              player.id === view.nextPlayerId && view.status === 'playing';
            return (
              <PlayerSeat
                key={player.id}
                isDealer={player.seat === dealerSeat}
                isMe={isMe}
                isTurn={isTurn}
                turnSecondsLeft={isTurn && turnActive ? secondsLeft : null}
                player={player}
                stack={seatStacks?.[player.id] ?? defaultStack}
                avatarUrl={isMe ? user?.avatar : null}
                style={{ left: pos.left, top: pos.top }}
              />
            );
          })}
        </div>
      </div>

      {!preview &&
      view.status === 'playing' &&
      view.round !== 'End' &&
      !view.gameEnded ? (
        <div className='relative z-10 shrink-0'>
          {view.isMyTurn ? (
            <p
              className={cn(
                'mb-1 text-center text-[12px] font-medium tabular-nums',
                secondsLeft <= 15
                  ? 'animate-pulse text-red-300'
                  : 'text-white/70'
              )}
            >
              {formatTurnClock(secondsLeft)} to act
            </p>
          ) : null}
          <ActionBar
            gameId={gameId}
            highestBet={view.highestBet}
            minRaiseIncrement={view.minRaise ?? 1}
            isMyTurn={view.isMyTurn}
            myChipsInPot={
              view.players.find((p) => p.id === view.myPlayerId)?.chipsInPot ?? 0
            }
            stack={myStack}
            onLocalAction={onLocalAction}
          />
        </div>
      ) : (
        <div className={cn('relative z-10 shrink-0', compact ? 'h-6' : 'h-24')} />
      )}
    </div>
  );
};
