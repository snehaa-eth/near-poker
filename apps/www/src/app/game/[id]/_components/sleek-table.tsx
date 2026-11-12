'use client';

import Link from 'next/link';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { PublicGameView } from '~/lib/api';
import { ARENA_TURN_SECONDS } from '~/lib/arena';
import { chipText, mergeFlashes, type SeatActionFlash } from '~/lib/seat-action-flash';
import { playSound, preloadSounds } from '~/lib/sounds';
import { type DirectorState, useTableDirector } from '~/lib/table-director';
import { cn } from '~/lib/utils';

import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';

import { toast } from 'sonner';
import { useSessionPassive } from '~/providers/session-provider';
import { useSocket } from '~/providers/socket-provider';

import { OrbitLoader } from '~/components/ui/orbit-loader';

import { ActionBar, type LocalTableAction } from './action-bar';
import {
  EmptySeat,
  PlayerSeat,
  seatPositions,
  type SeatAnchor,
} from './player-seat';
import { EmptyCardSlot, SleekCard } from './sleek-card';
import {
  ActionTicker,
  AllInSplash,
  ChipLayer,
  RollingNumber,
  type Point,
} from './table-fx';
import { TableFinished, streetHint } from './table-guide';

import { ShieldCheck } from 'lucide-react';

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
  /** Fit inside the spectator shell (no full-viewport chrome; the shell renders the ticker). */
  embedded?: boolean;
  /** Show SB / BB chips on seats. */
  showPositions?: boolean;
  /** Offline / dummy table actions. */
  onLocalAction?: (action: LocalTableAction) => void;
  /** Extra seat toasts (older servers without an action log). */
  actionFlashes?: Record<string, SeatActionFlash>;
  /** Shared director (the spectator shell also drives the ticker / log from it). */
  director?: DirectorState;
  /** ✓ on an action tag → open the proof for that move. */
  onProof?: (actionIndex: number) => void;
  /** Show the mint "Verify hand" chip in the pot area (the shell hides it after 5 s). */
  verifyChip?: boolean;
  /** Link for the verify chip (defaults to /verify/:handId). */
  verifyHref?: string;
  /** "agents" on arena tables, "players" elsewhere. */
  seatNoun?: string;
}

const toNum = (v: string) => Number.parseFloat(v);

/** Where a seat's street bet sits: on the seat → pot line, clear of the hole cards. */
function betPoint(seat: Point, anchor: SeatAnchor, portrait: boolean): Point {
  if (portrait) {
    switch (anchor) {
      case 'bottom':
        return { left: seat.left + 22, top: seat.top - 7 };
      case 'top':
        return { left: seat.left - 22, top: seat.top + 8 };
      case 'left':
        return { left: seat.left + 14, top: seat.top + (seat.top < 50 ? 9 : -9) };
      case 'right':
        return { left: seat.left - 14, top: seat.top + (seat.top < 50 ? 9 : -9) };
    }
  }
  switch (anchor) {
    // Beside the hole cards (offset sideways) so bets never sit on the pot or the board.
    case 'bottom':
      return { left: seat.left + (seat.left > 50 ? -9 : 9), top: seat.top - 16 };
    case 'top':
      return { left: seat.left + (seat.left > 50 ? -12 : 12), top: seat.top + 12 };
    case 'left':
      return { left: seat.left + 17, top: seat.top + (50 - seat.top) * 0.35 };
    case 'right':
      return { left: seat.left - 17, top: seat.top + (50 - seat.top) * 0.35 };
  }
}

function formatTurnClock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** Phones get a portrait (vertical) oval. */
function usePortrait(enabled: boolean) {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [enabled]);
  return enabled && portrait;
}

/** Self-directed table (dev page, seated players). */
function SleekTableAuto(props: SleekTableProps) {
  const director = useTableDirector(props.view, { sound: !props.preview });
  return <SleekTableInner {...props} director={director} />;
}

export const SleekTable = (props: SleekTableProps) =>
  props.director ? (
    <SleekTableInner {...props} director={props.director} />
  ) : (
    <SleekTableAuto {...props} />
  );

const SleekTableInner = ({
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
  director,
  onProof,
  verifyChip,
  verifyHref,
  seatNoun = 'players',
}: SleekTableProps & { director: DirectorState }) => {
  const { user } = useSessionPassive();
  const { socket } = useSocket();
  /** Raw live view drives the action bar + clocks; `dv` is the broadcast (staged) view. */
  const dv = director.view;
  const seatStacks = director.stackHold ?? stacksByPlayerId ?? dv.stacksByPlayerId;
  // Exact server action log → ignore slower external toasts (they'd double up).
  const actionFlashes = view.actions
    ? director.flashes
    : mergeFlashes(director.flashes, externalFlashes ?? {});
  const shake = useAnimationControls();
  const reduceMotion = useReducedMotion();
  const portrait = usePortrait(embedded);
  useEffect(() => {
    if (director.shakeKey === 0 || reduceMotion) return;
    void shake.start({
      x: [0, -3, 3, -2, 0],
      transition: { duration: 0.35, ease: 'easeOut' },
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

  /** Arena table closed: every agent left (or was re-queued). */
  const tableFinished = Boolean(dv.arena) && dv.players.length === 0;
  /** Seating: no hand running yet (dashed board + open-seat outlines). */
  const seating =
    !tableFinished && !dv.gameEnded && dv.status !== 'playing';
  /** Arena hands auto-start a few seconds after the previous one ends. */
  const arenaBetweenHands =
    Boolean(dv.arena) && !tableFinished && dv.gameEnded;
  const maxSeats = Math.max(dv.maxPlayers || 6, ordered.length, 2);
  // While seating, lay out every seat so the open ones show as outlines.
  const slotCount = seating ? Math.min(maxSeats, 6) : Math.max(ordered.length, 2);
  const positions = seatPositions(slotCount, { inset: embedded, portrait });

  const { seatPoints, betPoints } = useMemo(() => {
    const sp: Record<string, Point> = {};
    const bp: Record<string, Point> = {};
    ordered.forEach((p, i) => {
      const pos = positions[i];
      if (!pos) return;
      const pt = { left: toNum(pos.left), top: toNum(pos.top) };
      sp[p.id] = pt;
      bp[p.id] = betPoint(pt, pos.anchor, portrait);
    });
    return { seatPoints: sp, betPoints: bp };
  }, [ordered, positions, portrait]);

  const board = dv.communityCards.filter((c) => c >= 0);
  const boardSlots = Array.from({ length: 5 }, (_, i) => {
    const c = dv.communityCards[i];
    return c != null && c >= 0 ? c : -1;
  });
  const hint = director.runout ? 'Cards up · no more betting' : streetHint(dv);
  const sidePots = (dv.pots ?? []).filter((p) => p.amount > 0);
  const equityLeader = director.equity
    ? Object.entries(director.equity).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;
  const handNames = Object.fromEntries(
    (dv.showdownHands ?? []).map((h) => [h.playerId, h.handName])
  );
  const winnings = (dv.winners ?? []).reduce((s, w) => s + w.amount, 0);
  const endLine =
    board.length === 0
      ? 'Hand over · won before the flop'
      : board.length < 5 || !dv.showdownHands?.length
        ? 'Hand over · everyone else folded'
        : 'Hand over · showdown';
  const handId = dv.fairness?.handId;
  const showVerify =
    Boolean(handId) &&
    (verifyChip ?? Boolean(dv.fairness?.revealed || dv.gameEnded || dv.round === 'End'));

  // Chips fly to / from the pot capsule.
  const potPoint: Point = portrait
    ? { left: 50, top: seating ? 31 : 38 }
    : { left: 50, top: seating ? 38 : 33 };
  const boardTop = seating ? (portrait ? 54 : 68) : portrait ? 52 : 55;

  return (
    <div
      className={cn(
        'relative flex w-full flex-col',
        embedded
          ? 'py-3 sm:py-5'
          : compact
            ? 'h-full min-h-[28rem] pt-2'
            : 'h-[100dvh] bg-bg pt-16'
      )}
    >
      <div
        className={cn(
          'relative z-10 mx-auto flex min-h-0 w-full flex-1 items-center justify-center',
          embedded ? 'px-2 sm:px-6' : 'max-w-6xl px-2 sm:px-4 lg:max-w-7xl'
        )}
      >
        <motion.div
          animate={shake}
          role='group'
          aria-label={`${dv.name || 'Table'} felt`}
          className='relative w-full'
          style={
            portrait
              ? {
                  aspectRatio: '0.64 / 1',
                  maxWidth: 'min(100%, calc((100dvh - 12rem) * 0.64))',
                }
              : {
                  aspectRatio: '1.75 / 1',
                  maxWidth: embedded
                    ? 'min(100%, calc((100dvh - 12rem) * 1.75))'
                    : compact
                      ? 'min(100%, calc(42vh * 1.75))'
                      : 'min(100%, calc((100dvh - 13.5rem) * 1.75))',
                }
          }
        >
          {/* Rail + felt: a lighter green island on the same dark material as the page. */}
          <div
            aria-hidden
            className='absolute inset-[5%] rounded-[999px] shadow-[0_24px_64px_rgba(0,0,0,0.55)]'
            style={{
              background:
                'radial-gradient(ellipse at 50% 45%, var(--felt-1) 0%, var(--felt-2) 78%)',
              border: '10px solid var(--rail)',
            }}
          />
          {/* The lamp hits the middle of the felt; the edges fall away into the dark. */}
          <div
            aria-hidden
            className='lamp-flicker pointer-events-none absolute inset-[calc(5%+10px)] rounded-[999px]'
            style={{
              background:
                'radial-gradient(48% 58% at 50% 42%, rgba(var(--lamp-rgb),0.13) 0%, rgba(var(--lamp-rgb),0.05) 45%, transparent 70%), radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.38) 100%)',
            }}
          />
          <div aria-hidden className='absolute inset-[calc(5%+10px)] rounded-[999px] ring-1 ring-inset ring-[rgba(var(--lamp-rgb),0.14)]' />
          <div aria-hidden className='absolute inset-[11%] rounded-[999px] border border-white/[0.06]' />

          {tableFinished ? (
            <div className='absolute left-1/2 top-1/2 z-10 flex w-full -translate-x-1/2 -translate-y-1/2 justify-center px-4'>
              <TableFinished gameId={gameId} />
            </div>
          ) : (
            <>
              {/* Pot / hand result */}
              <div
                className='absolute left-1/2 z-10 flex w-[min(30rem,80%)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center'
                style={{ top: `${potPoint.top}%` }}
              >
                {seating ? (
                  <div className='flex flex-col items-center gap-1'>
                    <div className='w-[96px] sm:w-[128px]'>
                      <OrbitLoader size={128} />
                    </div>
                    <p className='text-[15px] font-semibold text-fg sm:text-[17px]'>
                      Seating {seatNoun}{' '}
                      <span className='tabular-nums'>
                        {ordered.length}/{maxSeats}
                      </span>
                    </p>
                    <p className='text-[13px] text-fg-muted'>
                      {ordered.length < 2
                        ? `The first hand deals when 2 ${seatNoun} are seated`
                        : 'Next hand deals in a moment'}
                    </p>
                  </div>
                ) : dv.gameEnded ? (
                  <>
                    <p className='text-[13px] text-fg-muted'>{endLine}</p>
                    {dv.winnerNickname ? (
                      <motion.p
                        initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.4 }}
                        className='text-[20px] font-semibold leading-7 text-fg sm:text-[28px] sm:leading-8'
                      >
                        {dv.winnerNickname}{' '}
                        <span className='text-fg-muted'>wins</span>{' '}
                        <span className='font-display font-extrabold tabular-nums text-brass'>
                          {chipText(winnings || dv.pot)}
                        </span>
                      </motion.p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div
                      className='flex items-baseline gap-2 rounded-sm bg-black/35 px-4 py-1'
                      data-testid='pot'
                      aria-label={`Pot ${dv.pot.toLocaleString()}`}
                    >
                      <span className='text-label uppercase text-fg-muted'>Pot</span>
                      <RollingNumber
                        value={dv.pot}
                        format={chipText}
                        className='font-display text-[28px] font-extrabold leading-8 tracking-[0.01em] text-fg lg:text-[36px] lg:leading-10'
                      />
                    </div>
                    {hint ? (
                      <p className='text-[13px] text-fg-muted'>{hint}</p>
                    ) : null}
                    {sidePots.length > 1 ? (
                      <div className='flex flex-wrap justify-center gap-1' data-testid='side-pots'>
                        {sidePots.map((p, i) => (
                          <span
                            key={i}
                            title={`Eligible: ${p.eligible.map((id) => dv.players.find((x) => x.id === id)?.nickname ?? id).join(', ')}`}
                            className='rounded-xs bg-black/40 px-2 py-0.5 text-[13px] text-fg-muted'
                          >
                            {i === 0 ? 'Main' : sidePots.length > 2 ? `Side ${i}` : 'Side'}{' '}
                            <span className='font-semibold tabular-nums text-fg'>
                              {chipText(p.amount)}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {/* Board: dashed slots until a card is dealt */}
              <div
                className='absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2'
                style={{ top: `${boardTop}%` }}
              >
                <div className='flex items-end gap-1.5 sm:gap-2 lg:gap-2.5' aria-label='Board'>
                  {boardSlots.map((cardId, i) =>
                    cardId >= 0 ? (
                      <motion.div
                        key={`board-${i}-${cardId}`}
                        initial={reduceMotion ? { opacity: 0 } : { rotateY: 90, y: -10, opacity: 0.4 }}
                        animate={{ rotateY: 0, y: 0, opacity: 1 }}
                        transition={{
                          duration: reduceMotion ? 0.15 : 0.2,
                          delay: i < 3 ? i * 0.08 : 0,
                          ease: [0.2, 0, 0, 1],
                        }}
                      >
                        <SleekCard cardId={cardId} size='board' />
                      </motion.div>
                    ) : (
                      <EmptyCardSlot key={`slot-${i}`} />
                    )
                  )}
                </div>
                {/* Below the board without moving it */}
                <div className='absolute left-1/2 top-full mt-2 flex -translate-x-1/2 flex-col items-center gap-2 whitespace-nowrap'>
                {dv.gameEnded && arenaBetweenHands ? (
                  <p className='text-[13px] text-fg-muted'>Next hand starting…</p>
                ) : null}
                {showVerify && handId && dv.gameEnded ? (
                  <motion.div
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Link
                      href={verifyHref ?? `/verify/${encodeURIComponent(handId)}`}
                      className='inline-flex h-9 items-center gap-1.5 rounded-sm bg-accent-soft px-3 text-[13px] font-semibold text-accent ring-1 ring-accent/50 transition-colors duration-instant hover:bg-accent hover:text-accent-ink'
                    >
                      <ShieldCheck className='h-4 w-4' strokeWidth={1.75} />
                      Verify hand
                    </Link>
                  </motion.div>
                ) : null}
                </div>
              </div>
            </>
          )}

          <ChipLayer
            seatPoints={seatPoints}
            betPoints={betPoints}
            potPoint={potPoint}
            bets={director.bets}
            sweep={director.sweep}
            award={director.award}
          />

          <AllInSplash splash={director.allInSplash} />

          {seating
            ? positions.slice(ordered.length).map((pos, i) => (
                <EmptySeat
                  key={`open-${i}`}
                  style={{ left: pos.left, top: pos.top }}
                  label={i === 0 ? 'Next seat' : 'Open seat'}
                />
              ))
            : null}

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
              dv.status !== 'playing' && !dv.gameEnded
                ? null
                : dv.bbPlayerId === player.id
                  ? ('BB' as const)
                  : dv.sbPlayerId === player.id
                    ? ('SB' as const)
                    : null;
            return (
              <PlayerSeat
                key={player.id}
                isDealer={player.seat === dealerSeat && !seating}
                isMe={isMe}
                isTurn={isTurn}
                isWinner={isWinner}
                winningHand={
                  isWinner
                    ? handNames[player.id] ?? dv.winningHand
                    : undefined
                }
                positionLabel={showPositions ? blind : null}
                blind={showPositions ? null : blind}
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
                spectator={spectator}
                onProof={onProof}
                style={{ left: pos.left, top: pos.top }}
              />
            );
          })}
        </motion.div>
      </div>

      {!preview && !tableFinished && !embedded ? (
        <div className='relative z-10 mx-auto mt-1 w-full max-w-4xl px-3'>
          <ActionTicker items={director.ticker} className='rounded-sm border' />
        </div>
      ) : null}

      {!preview && !spectator &&
      view.status === 'playing' &&
      view.round !== 'End' &&
      !view.gameEnded ? (
        <div className='relative z-10 shrink-0'>
          {view.isMyTurn ? (
            <p
              className={cn(
                'mb-1 text-center text-[13px] font-medium tabular-nums',
                secondsLeft <= 15 ? 'text-warning' : 'text-fg-muted'
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
      ) : !embedded ? (
        <div className={cn('relative z-10 shrink-0', compact ? 'h-2' : 'h-24')} />
      ) : null}
    </div>
  );
};
