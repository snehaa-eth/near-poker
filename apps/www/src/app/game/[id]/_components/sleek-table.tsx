'use client';

import Link from 'next/link';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { PublicGameView } from '~/lib/api';
import { ARENA_TURN_SECONDS } from '~/lib/arena';
import { positionLabel } from '~/lib/poker-positions';
import {
  mergeFlashes,
  useViewActionFlashes,
  type SeatActionFlash,
} from '~/lib/seat-action-flash';
import { playSound, preloadSounds } from '~/lib/sounds';
import { createTableSfx } from '~/lib/table-sfx';
import { cn } from '~/lib/utils';

import { toast } from 'sonner';
import { useSession } from '~/providers/session-provider';
import { useSocket } from '~/providers/socket-provider';

import { ChipAmount } from '~/components/currency-amount';

import { ActionBar, type LocalTableAction } from './action-bar';
import { PlayerSeat, seatPositions } from './player-seat';
import { SleekCard } from './sleek-card';
import { HowToWatch, TableFinished, streetHint } from './table-guide';

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
  /** Fit inside the arena spectator shell (no full-viewport chrome). */
  embedded?: boolean;
  /** Show BTN / SB / BB / … labels on seats. */
  showPositions?: boolean;
  /** Offline / dummy table actions. */
  onLocalAction?: (action: LocalTableAction) => void;
  /** Extra seat toasts (e.g. exact TEE moves from the arena feed). */
  actionFlashes?: Record<string, SeatActionFlash>;
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
  embedded = false,
  showPositions = false,
  onLocalAction,
  actionFlashes: externalFlashes,
}: SleekTableProps) => {
  const { user } = useSession();
  const { socket } = useSocket();
  const seatStacks = stacksByPlayerId ?? view.stacksByPlayerId;
  const viewFlashes = useViewActionFlashes(view);
  const actionFlashes = mergeFlashes(viewFlashes, externalFlashes ?? {});
  const defaultStack = stackOverride ?? user?.chips ?? 10000;
  const myStack =
    (view.myPlayerId ? seatStacks?.[view.myPlayerId] : undefined) ??
    defaultStack;
  const dealerSeat = view.dealerSeat ?? 0;
  const turnSeconds = view.arena ? ARENA_TURN_SECONDS : TURN_SECONDS;
  const seated =
    view.myPlayerId != null &&
    view.players.some((p) => p.id === view.myPlayerId);
  /** Arena tables are agent-only; humans (and anyone not seated) just watch. */
  const spectator = !onLocalAction && (Boolean(view.arena) || !seated);

  const turnActive =
    view.status === 'playing' &&
    !view.gameEnded &&
    view.round !== 'End' &&
    Boolean(view.nextPlayerId);

  const turnKey = turnActive
    ? `${view.nextPlayerId}:${view.street}:${view.round}`
    : null;

  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(turnSeconds);
  const foldedForTurnRef = useRef<string | null>(null);
  const tableSfxRef = useRef(createTableSfx());

  useEffect(() => {
    preloadSounds([
      'cardDeal',
      'cardFlip',
      'chipsBet',
      'chipsShuffle',
      'shuffle',
      'pepperChat',
      'win',
    ]);
  }, []);

  useEffect(() => {
    tableSfxRef.current = createTableSfx();
  }, [gameId]);

  useEffect(() => {
    tableSfxRef.current(view);
  }, [view]);

  useEffect(() => {
    if (!turnKey) {
      setTurnEndsAt(null);
      setSecondsLeft(turnSeconds);
      foldedForTurnRef.current = null;
      return;
    }
    foldedForTurnRef.current = null;
    const endsAt = Date.now() + turnSeconds * 1000;
    setTurnEndsAt(endsAt);
    setSecondsLeft(turnSeconds);
  }, [turnKey, turnSeconds]);

  useEffect(() => {
    if (!turnEndsAt || !turnKey) return;

    const tick = () => {
      const left = Math.max(0, (turnEndsAt - Date.now()) / 1000);
      setSecondsLeft(left);

      if (left > 0) return;
      if (foldedForTurnRef.current === turnKey) return;
      foldedForTurnRef.current = turnKey;

      // Dummy: fold whoever is acting. Live: only fold yourself.
      // Spectators never act (the arena server times agents out itself).
      if (spectator) return;
      if (!onLocalAction && !view.isMyTurn) return;

      try {
        playSound('cardFlip');
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
  }, [
    turnEndsAt,
    turnKey,
    view.isMyTurn,
    onLocalAction,
    socket,
    gameId,
    spectator,
  ]);

  const ordered = useMemo(() => {
    const players = [...view.players].sort((a, b) => a.seat - b.seat);
    const myIndex = players.findIndex((p) => p.id === view.myPlayerId);
    if (myIndex <= 0) return players;
    return [...players.slice(myIndex), ...players.slice(0, myIndex)];
  }, [view.players, view.myPlayerId]);

  const positions = seatPositions(Math.max(ordered.length, 2), {
    inset: embedded,
  });
  const board = view.communityCards.filter((c) => c >= 0);
  /** Always five board slots: face-up when dealt, face-down before flop/turn/river. */
  const boardSlots = Array.from({ length: 5 }, (_, i) => {
    const c = view.communityCards[i];
    return c != null && c >= 0 ? c : -1;
  });
  /** Arena table closed: every agent left (or was re-queued). */
  const tableFinished = Boolean(view.arena) && view.players.length === 0;
  /** Arena hands auto-start a few seconds after the previous one ends. */
  const arenaBetweenHands =
    Boolean(view.arena) &&
    !tableFinished &&
    (view.gameEnded || view.status !== 'playing');
  const hint = streetHint(view);

  return (
    <div
      className={cn(
        'relative flex w-full flex-col overflow-hidden',
        embedded
          ? 'min-h-[30rem] py-4 sm:min-h-[34rem]'
          : compact
            ? 'h-full min-h-[28rem] pt-2'
            : 'h-[100dvh] pt-16'
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

      <div
        className={cn(
          'relative z-10 mx-auto flex min-h-0 w-full flex-1 items-center justify-center',
          embedded
            ? 'max-w-none px-3 sm:px-5'
            : 'max-w-6xl px-2 sm:px-4 lg:max-w-7xl xl:max-w-[84rem]'
        )}
      >
        <div
          className={cn(
            'relative aspect-[1.75/1] w-full',
            embedded
              ? 'max-h-[min(58vh,460px)] sm:max-h-[min(60vh,520px)]'
              : compact
                ? 'max-h-[min(42vh,360px)]'
                : 'max-h-[min(calc(100dvh-13.5rem),560px)] lg:max-h-[min(calc(100dvh-13.5rem),640px)] xl:max-h-[min(calc(100dvh-13.5rem),700px)]'
          )}
        >
          {/* Table rail + felt window over the photo */}
          <div className='absolute inset-[7%] rounded-[999px] border-[6px] border-white bg-emerald-950/20 shadow-[0_18px_50px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.2)] lg:border-[8px] xl:border-[10px]' />
          <div className='absolute inset-[7%] rounded-[999px] ring-1 ring-white/40' />
          <div className='absolute inset-[12%] rounded-[999px] border-2 border-white/35 shadow-[inset_0_0_40px_rgba(0,0,0,0.25)]' />

          {tableFinished ? (
            <div className='absolute left-1/2 top-1/2 z-10 flex w-full -translate-x-1/2 -translate-y-1/2 justify-center px-4'>
              <TableFinished gameId={gameId} />
            </div>
          ) : (
            <div className='absolute left-1/2 top-1/2 z-10 flex w-full max-w-[28rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 px-2'>
              <div className='flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full bg-white/90 px-3.5 py-1.5 text-[12px] font-medium text-neutral-500 shadow-md backdrop-blur lg:text-[13px]'>
                {view.gameEnded ? (
                  // The pot has already been paid out; say how the hand ended instead of "Pot 0".
                  <span className='font-semibold text-neutral-800'>
                    {board.length === 0
                      ? 'Hand over · won before the flop'
                      : board.length < 5
                        ? 'Hand over · everyone else folded'
                        : 'Hand over · showdown'}
                  </span>
                ) : arenaBetweenHands ? (
                  <span className='font-semibold text-neutral-800'>
                    Next hand starting…
                  </span>
                ) : (
                  <>
                    <span>Pot</span>
                    <ChipAmount
                      value={view.pot}
                      size='sm'
                      className='text-[12px] text-neutral-900 lg:text-[13px]'
                      iconClassName='h-3.5 w-3.5'
                    />
                    <span className='text-neutral-300'>·</span>
                    <span className='font-semibold text-neutral-800'>
                      {view.roundLabel}
                    </span>
                    {hint ? (
                      <>
                        <span className='hidden text-neutral-300 sm:inline'>
                          ·
                        </span>
                        <span className='hidden text-[11px] text-neutral-500 sm:inline'>
                          {hint}
                        </span>
                      </>
                    ) : null}
                  </>
                )}
              </div>

              <div className='flex items-end gap-1.5 sm:gap-2 lg:gap-2.5'>
                {boardSlots.map((cardId, i) => (
                  <SleekCard
                    key={`board-${i}-${cardId}`}
                    cardId={cardId}
                    backSeed={i + 31}
                    className='hover:-translate-y-1'
                    size='md'
                  />
                ))}
              </div>

              {board.length === 0 ? (
                <p className='text-[11px] font-medium text-white/75 drop-shadow'>
                  {view.gameEnded
                    ? 'Hand ended before the flop'
                    : arenaBetweenHands
                      ? 'Dealing the next hand…'
                      : 'Pre-flop · board stays face-down'}
                </p>
              ) : null}

              {view.fairness ? (
                view.fairness.revealed ||
                view.gameEnded ||
                view.round === 'End' ? (
                  <Link
                    href={`/verify/${encodeURIComponent(view.fairness.handId)}`}
                    target='_blank'
                    className='rounded-full bg-emerald-50/95 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200 transition hover:bg-white lg:text-[11px]'
                  >
                    ✅ Verify hand
                  </Link>
                ) : (
                  <span
                    title={`Deck seed hash committed before the deal: ${view.fairness.seedHash}`}
                    className='rounded-full bg-black/40 px-2.5 py-0.5 font-mono text-[10px] text-white/90 shadow-sm backdrop-blur-sm lg:text-[11px]'
                  >
                    🔒 Deck committed · {view.fairness.seedHash.slice(0, 8)}
                  </span>
                )
              ) : null}

              {view.gameEnded && view.winnerNickname ? (
                <div className='rounded-full bg-neutral-950 px-4 py-1.5 text-sm font-semibold text-white shadow-lg'>
                  Winner · {view.winnerNickname}
                  {view.winningHand ? ` · ${view.winningHand}` : ''}
                </div>
              ) : null}
            </div>
          )}

          {ordered.map((player, index) => {
            const pos = positions[index] ?? {
              left: '50%',
              top: '50%',
              anchor: 'bottom' as const,
            };
            const isMe = player.id === view.myPlayerId;
            const isTurn =
              player.id === view.nextPlayerId && view.status === 'playing';
            const isWinner =
              view.gameEnded &&
              view.winnerId != null &&
              player.id === view.winnerId;
            return (
              <PlayerSeat
                key={player.id}
                isDealer={player.seat === dealerSeat}
                isMe={isMe}
                isTurn={isTurn}
                isWinner={isWinner}
                winningHand={isWinner ? view.winningHand : undefined}
                positionLabel={
                  showPositions
                    ? positionLabel(player.seat, dealerSeat, ordered.length)
                    : null
                }
                compact={embedded}
                anchor={pos.anchor}
                turnSecondsLeft={isTurn && turnActive ? secondsLeft : null}
                actionFlash={actionFlashes[player.id] ?? null}
                player={player}
                stack={seatStacks?.[player.id] ?? defaultStack}
                avatarUrl={isMe ? user?.avatar : null}
                style={{ left: pos.left, top: pos.top }}
              />
            );
          })}
        </div>
      </div>

      {!preview && spectator ? (
        embedded ? null : (
        <div
          className={cn(
            'relative z-10 flex shrink-0 flex-wrap items-start justify-center gap-2',
            compact ? 'h-6' : 'h-24'
          )}
        >
          <span className='rounded-full bg-black/45 px-4 py-1.5 text-xs font-medium text-white/90 shadow-sm backdrop-blur-sm'>
            {tableFinished
              ? '👀 Spectating · this table has closed'
              : view.arena
                ? '👀 Spectating · agents act inside a TEE — tap 🔒 TEE on a seat to verify'
                : '👀 Spectating'}
          </span>
          {view.arena ? <HowToWatch /> : null}
        </div>
        )
      ) : !preview &&
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
              view.players.find((p) => p.id === view.myPlayerId)?.chipsInPot ??
              0
            }
            stack={myStack}
            onLocalAction={onLocalAction}
          />
        </div>
      ) : (
        <div
          className={cn(
            'relative z-10 shrink-0',
            embedded || compact ? 'h-2' : 'h-24'
          )}
        />
      )}
    </div>
  );
};
