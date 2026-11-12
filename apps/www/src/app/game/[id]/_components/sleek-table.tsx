'use client';

import Link from 'next/link';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { PublicGameView } from '~/lib/api';
import { ARENA_TURN_SECONDS } from '~/lib/arena';
import { positionLabel } from '~/lib/poker-positions';
import { mergeFlashes, type SeatActionFlash } from '~/lib/seat-action-flash';
import { playSound, preloadSounds } from '~/lib/sounds';
import { useTableDirector } from '~/lib/table-director';
import { cn } from '~/lib/utils';

import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';

import { toast } from 'sonner';
import { useSession } from '~/providers/session-provider';
import { useSocket } from '~/providers/socket-provider';

import { ChipAmount } from '~/components/currency-amount';

import { ActionBar, type LocalTableAction } from './action-bar';
import { PlayerSeat, seatPositions, type SeatAnchor } from './player-seat';
import { SleekCard } from './sleek-card';
import {
  ActionTicker,
  AllInSplash,
  ChipDiscs,
  ChipLayer,
  RollingNumber,
  SoundPrompt,
  type Point,
} from './table-fx';
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

const toNum = (v: string) => Number.parseFloat(v);

/** Where a seat's street bet sits: between the seat and the middle of the felt. */
function betPoint(seat: Point, anchor: SeatAnchor): Point {
  switch (anchor) {
    // Beside the hole cards (offset sideways) so bets never sit on the pot or the board.
    case 'bottom':
      return { left: seat.left + (seat.left > 50 ? -9 : 9), top: seat.top - 16 };
    case 'top':
      return { left: seat.left + (seat.left > 50 ? -9 : 9), top: seat.top + 16 };
    case 'left':
      return { left: seat.left + 17, top: seat.top + (50 - seat.top) * 0.35 };
    case 'right':
      return { left: seat.left - 17, top: seat.top + (50 - seat.top) * 0.35 };
  }
}

/** Chips fly to / from the pot pill above the board. */
const POT_POINT: Point = { left: 50, top: 33 };

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
  /** Raw live view drives the action bar + clocks; `dv` is the broadcast (staged) view. */
  const director = useTableDirector(view, { sound: !preview });
  const dv = director.view;
  const seatStacks = director.stackHold ?? stacksByPlayerId ?? dv.stacksByPlayerId;
  // Exact server action log → ignore the slower arena move-feed toasts (they'd double up).
  const actionFlashes = view.actions
    ? director.flashes
    : mergeFlashes(director.flashes, externalFlashes ?? {});
  const shake = useAnimationControls();
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (director.shakeKey === 0 || reduceMotion) return;
    void shake.start({
      x: [0, -7, 6, -5, 4, -2, 0],
      scale: [1, 1.018, 1.01, 1],
      transition: { duration: 0.55, ease: 'easeOut' },
    });
  }, [director.shakeKey, reduceMotion, shake]);
  const defaultStack = stackOverride ?? user?.chips ?? 10000;
  const myStack =
    (view.myPlayerId ? seatStacks?.[view.myPlayerId] : undefined) ??
    defaultStack;
  const dealerSeat = dv.dealerSeat ?? 0;
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

  useEffect(() => {
    preloadSounds();
  }, []);

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
    const players = [...dv.players].sort((a, b) => a.seat - b.seat);
    const myIndex = players.findIndex((p) => p.id === dv.myPlayerId);
    if (myIndex <= 0) return players;
    return [...players.slice(myIndex), ...players.slice(0, myIndex)];
  }, [dv.players, dv.myPlayerId]);

  const positions = seatPositions(Math.max(ordered.length, 2), {
    inset: embedded,
  });
  const { seatPoints, betPoints } = useMemo(() => {
    const sp: Record<string, Point> = {};
    const bp: Record<string, Point> = {};
    ordered.forEach((p, i) => {
      const pos = positions[i];
      if (!pos) return;
      const pt = { left: toNum(pos.left), top: toNum(pos.top) };
      sp[p.id] = pt;
      bp[p.id] = betPoint(pt, pos.anchor);
    });
    return { seatPoints: sp, betPoints: bp };
  }, [ordered, positions]);
  const board = dv.communityCards.filter((c) => c >= 0);
  /** Always five board slots: face-up when dealt, face-down before flop/turn/river. */
  const boardSlots = Array.from({ length: 5 }, (_, i) => {
    const c = dv.communityCards[i];
    return c != null && c >= 0 ? c : -1;
  });
  /** Arena table closed: every agent left (or was re-queued). */
  const tableFinished = Boolean(dv.arena) && dv.players.length === 0;
  /** Arena hands auto-start a few seconds after the previous one ends. */
  const arenaBetweenHands =
    Boolean(dv.arena) &&
    !tableFinished &&
    (dv.gameEnded || dv.status !== 'playing');
  const hint = director.runout ? 'Cards up · no more betting' : streetHint(dv);
  const sidePots = (dv.pots ?? []).filter((p) => p.amount > 0);
  const equityLeader = director.equity
    ? Object.entries(director.equity).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;
  const handNames = Object.fromEntries(
    (dv.showdownHands ?? []).map((h) => [h.playerId, h.handName])
  );

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

      {!preview ? (
        <div className='absolute left-3 top-3 z-30 sm:left-4'>
          <SoundPrompt />
        </div>
      ) : null}

      <div
        className={cn(
          'relative z-10 mx-auto flex min-h-0 w-full flex-1 items-center justify-center',
          embedded
            ? 'max-w-none px-3 sm:px-5'
            : 'max-w-6xl px-2 sm:px-4 lg:max-w-7xl xl:max-w-[84rem]'
        )}
      >
        <motion.div
          animate={shake}
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
          {/* Spotlight on the middle of the felt */}
          <div className='pointer-events-none absolute inset-[18%] rounded-[999px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.10),transparent_65%)]' />

          {tableFinished ? (
            <div className='absolute left-1/2 top-1/2 z-10 flex w-full -translate-x-1/2 -translate-y-1/2 justify-center px-4'>
              <TableFinished gameId={gameId} />
            </div>
          ) : (
            <div className='absolute left-1/2 top-1/2 z-10 flex w-full max-w-[30rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 px-2'>
              {dv.gameEnded ? (
                <div className='flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full bg-white/90 px-3.5 py-1.5 text-[12px] font-medium text-neutral-500 shadow-md backdrop-blur lg:text-[13px]'>
                  {/* The pot has already been paid out; say how the hand ended instead of "Pot 0". */}
                  <span className='font-semibold text-neutral-800'>
                    {board.length === 0
                      ? 'Hand over · won before the flop'
                      : board.length < 5
                        ? 'Hand over · everyone else folded'
                        : 'Hand over · showdown'}
                  </span>
                </div>
              ) : null}
              {dv.gameEnded && arenaBetweenHands ? (
                <p className='-mt-0.5 text-[11px] font-medium text-white/85 drop-shadow lg:text-xs'>
                  Next hand starting…
                </p>
              ) : null}
              {dv.gameEnded ? null : arenaBetweenHands ? (
                <div className='rounded-full bg-white/90 px-3.5 py-1.5 text-[12px] font-medium shadow-md backdrop-blur lg:text-[13px]'>
                  <span className='font-semibold text-neutral-800'>
                    Next hand starting…
                  </span>
                </div>
              ) : (
                <>
                  <div
                    className='flex items-center gap-2 rounded-full bg-neutral-950/85 py-1 pl-1.5 pr-4 text-white shadow-[0_8px_30px_rgba(0,0,0,0.45)] ring-1 ring-amber-300/40 backdrop-blur'
                    data-testid='pot'
                  >
                    <ChipDiscs amount={Math.max(1, dv.pot)} />
                    <span className='text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200/90'>
                      Pot
                    </span>
                    <RollingNumber
                      value={dv.pot}
                      className='text-base font-black lg:text-lg'
                    />
                  </div>
                  <div className='flex flex-wrap items-center justify-center gap-x-1.5 text-[11px] font-medium text-white/80 drop-shadow lg:text-xs'>
                    <span className='font-semibold text-white'>{dv.roundLabel}</span>
                    {hint ? (
                      <>
                        <span className='hidden text-white/40 sm:inline'>·</span>
                        <span className='hidden sm:inline'>{hint}</span>
                      </>
                    ) : null}
                  </div>
                </>
              )}

              {sidePots.length > 1 ? (
                <div className='flex flex-wrap justify-center gap-1' data-testid='side-pots'>
                  {sidePots.map((p, i) => (
                    <span
                      key={i}
                      title={`Eligible: ${p.eligible.map((id) => dv.players.find((x) => x.id === id)?.nickname ?? id).join(', ')}`}
                      className='rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white ring-1 ring-white/15'
                    >
                      {i === 0 ? 'Main pot' : sidePots.length > 2 ? `Side pot ${i}` : 'Side pot'}{' '}
                      <span className='tabular-nums text-amber-200'>
                        <RollingNumber value={p.amount} />
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className='flex items-end gap-1.5 sm:gap-2 lg:gap-2.5'>
                {boardSlots.map((cardId, i) => (
                  <motion.div
                    key={`board-${i}-${cardId}`}
                    initial={
                      cardId >= 0 && !reduceMotion
                        ? { rotateY: 90, y: -14, opacity: 0.4 }
                        : false
                    }
                    animate={{ rotateY: 0, y: 0, opacity: 1 }}
                    transition={{
                      duration: 0.35,
                      delay: cardId >= 0 ? Math.max(0, i - (board.length >= 3 && i < 3 ? 0 : i)) * 0.12 : 0,
                      ease: 'easeOut',
                    }}
                  >
                    <SleekCard
                      cardId={cardId}
                      backSeed={i + 31}
                      className='hover:-translate-y-1'
                      size='md'
                    />
                  </motion.div>
                ))}
              </div>

              {board.length === 0 ? (
                <p className='text-[11px] font-medium text-white/75 drop-shadow'>
                  {dv.gameEnded
                    ? 'Hand ended before the flop'
                    : arenaBetweenHands
                      ? 'Dealing the next hand…'
                      : director.runout
                        ? 'All in pre-flop · running the board'
                        : 'Pre-flop · board stays face-down'}
                </p>
              ) : null}

              {dv.fairness ? (
                dv.fairness.revealed ||
                dv.gameEnded ||
                dv.round === 'End' ? (
                  <Link
                    href={`/verify/${encodeURIComponent(dv.fairness.handId)}`}
                    target='_blank'
                    className='rounded-full bg-emerald-50/95 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200 transition hover:bg-white lg:text-[11px]'
                  >
                    ✅ Verify hand
                  </Link>
                ) : (
                  <span
                    title={`Deck seed hash committed before the deal: ${dv.fairness.seedHash}`}
                    className='rounded-full bg-black/40 px-2.5 py-0.5 font-mono text-[10px] text-white/90 shadow-sm backdrop-blur-sm lg:text-[11px]'
                  >
                    🔒 Deck committed · {dv.fairness.seedHash.slice(0, 8)}
                  </span>
                )
              ) : null}

              {dv.gameEnded && dv.winnerNickname ? (
                <motion.div
                  initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.5 }}
                  className='rounded-full bg-neutral-950 px-4 py-1.5 text-sm font-semibold text-white shadow-lg ring-1 ring-amber-300/50'
                >
                  Winner · {dv.winnerNickname}
                  {dv.winningHand ? ` · ${dv.winningHand}` : ''}
                </motion.div>
              ) : null}
            </div>
          )}

          <ChipLayer
            seatPoints={seatPoints}
            betPoints={betPoints}
            potPoint={POT_POINT}
            bets={director.bets}
            sweep={director.sweep}
            award={director.award}
          />

          <AllInSplash splash={director.allInSplash} />

          {ordered.map((player, index) => {
            const pos = positions[index] ?? {
              left: '50%',
              top: '50%',
              anchor: 'bottom' as const,
            };
            const isMe = player.id === dv.myPlayerId;
            const isTurn =
              player.id === dv.nextPlayerId && dv.status === 'playing';
            const isWinner =
              dv.gameEnded &&
              (dv.winners?.length
                ? dv.winners.some((w) => w.playerId === player.id)
                : dv.winnerId != null && player.id === dv.winnerId);
            const stack = seatStacks?.[player.id] ?? defaultStack;
            const share = director.equity?.[player.id];
            const blind =
              dv.bbPlayerId === player.id
                ? ('BB' as const)
                : dv.sbPlayerId === player.id
                  ? ('SB' as const)
                  : null;
            let label = showPositions
              ? positionLabel(player.seat, dealerSeat, ordered.length)
              : null;
            if (label && blind && !(blind === 'SB' && label === 'BTN')) label = blind;
            return (
              <PlayerSeat
                key={player.id}
                isDealer={player.seat === dealerSeat}
                isMe={isMe}
                isTurn={isTurn}
                isWinner={isWinner}
                winningHand={
                  isWinner
                    ? handNames[player.id] ?? dv.winningHand
                    : undefined
                }
                positionLabel={label}
                blind={blind}
                compact={embedded}
                anchor={pos.anchor}
                turnSecondsLeft={isTurn && turnActive ? secondsLeft : null}
                turnTotalSeconds={turnSeconds}
                actionFlash={actionFlashes[player.id] ?? null}
                player={player}
                stack={stack}
                allIn={
                  !dv.gameEnded &&
                  !player.folded &&
                  player.holeCards.length > 0 &&
                  (player.allIn ?? (dv.status === 'playing' && !dv.gameEnded && stack <= 0))
                }
                equity={
                  share != null
                    ? { share, leading: player.id === equityLeader }
                    : null
                }
                handName={dv.gameEnded ? handNames[player.id] ?? null : null}
                avatarUrl={isMe ? user?.avatar : null}
                style={{ left: pos.left, top: pos.top }}
              />
            );
          })}
        </motion.div>
      </div>

      {!preview && !tableFinished ? (
        <div
          className={cn(
            'relative z-10 mx-auto mt-1 w-full',
            embedded ? 'px-3 sm:px-5' : 'max-w-4xl px-3'
          )}
        >
          <ActionTicker items={director.ticker} />
        </div>
      ) : null}

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
