'use client';

import React, { useEffect, useRef, useState } from 'react';

import type { AgentInfo, BotInfo } from '~/lib/api';
import { shortModel } from '~/lib/arena';
import {
  actionFlashLabel,
  actionFlashTone,
  chipText,
  type SeatActionFlash,
} from '~/lib/seat-action-flash';
import { cn } from '~/lib/utils';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';

import { SleekCard } from './sleek-card';
import { EquityBadge, RollingNumber } from './table-fx';

import { ArrowUpRight, Check, ShieldCheck } from 'lucide-react';

/** How long an agent's table talk stays on screen. */
const SPEECH_MS = 5000;
/** Action tag: 150 ms in, 1.2 s hold, 300 ms out (DESIGN-SYSTEM §6). */
const TAG_IN_S = 0.15;
const TAG_HOLD_MS = 1200;
const TAG_OUT_S = 0.3;

export type SeatPlayer = {
  id: string;
  nickname: string;
  seat: number;
  chipsInPot: number;
  folded: boolean;
  holeCards: number[];
  bot?: BotInfo;
  agent?: AgentInfo;
};

function truncateMiddle(value: string, head = 6, tail = 4) {
  return value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Shows the bot's latest line for a few seconds whenever it changes. */
function useSpeech(line?: string) {
  const [visible, setVisible] = useState<string | null>(null);
  useEffect(() => {
    if (!line) return;
    setVisible(line);
    const t = setTimeout(() => setVisible(null), SPEECH_MS);
    return () => clearTimeout(t);
  }, [line]);
  return visible;
}

/** Where the seat sits on the oval — drives card/bet direction toward center. */
export type SeatAnchor = 'bottom' | 'top' | 'left' | 'right';

interface PlayerSeatProps {
  player: SeatPlayer;
  isMe: boolean;
  isTurn: boolean;
  isDealer: boolean;
  /** Won the hand that just ended. */
  isWinner?: boolean;
  /** Best hand name when the win came at showdown. */
  winningHand?: string;
  /** SB / BB (small chip next to the name). */
  positionLabel?: string | null;
  /** Narrower seat for the spectator shell (vertical on phones). */
  compact?: boolean;
  /** Table-side anchor so hole cards face the felt, not the rail. */
  anchor?: SeatAnchor;
  stack: number;
  avatarUrl?: string | null;
  style?: React.CSSProperties;
  /** Remaining seconds on this seat’s turn clock. */
  turnSecondsLeft?: number | null;
  /** Last action tag over the seat. */
  actionFlash?: SeatActionFlash | null;
  /** Full turn length (seconds) — drives the countdown ring. */
  turnTotalSeconds?: number;
  /** No chips behind, still in the hand. */
  allIn?: boolean;
  /** Win share during a staged all-in run-out (revealed cards only). */
  equity?: { share: number; leading: boolean } | null;
  /** Best-hand name at showdown (non-winners; the winner tag carries its own). */
  handName?: string | null;
  /** Blind posted this hand. */
  blind?: 'SB' | 'BB' | null;
  /** Spectator view: quiet dark card backs. */
  spectator?: boolean;
  /** ✓ on the action tag → open the drawer's Proofs tab at that move. */
  onProof?: (actionIndex: number) => void;
}

/** Countdown ring drawn around the avatar while a seat is on the clock. */
function TurnRing({ fraction, urgent }: { fraction: number; urgent: boolean }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <svg
      viewBox='0 0 48 48'
      className='pointer-events-none absolute -inset-[4px] h-[calc(100%+8px)] w-[calc(100%+8px)] -rotate-90'
      aria-hidden
    >
      <circle cx='24' cy='24' r={r} fill='none' strokeWidth='2' className='stroke-white/10' />
      <circle
        cx='24'
        cy='24'
        r={r}
        fill='none'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeDasharray={c}
        strokeDashoffset={c * (1 - f)}
        style={{ stroke: urgent ? 'var(--warning)' : 'var(--accent)' }}
        className='transition-[stroke-dashoffset] duration-300 ease-linear'
      />
    </svg>
  );
}

function formatClock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** Calm, desaturated avatar hues so no seat competes with the accent. */
function avatarColor(name: string) {
  const hues = [200, 160, 25, 270, 330, 45];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % hues.length;
  }
  return `hsl(${hues[hash]} 32% 36%)`;
}

/** Hover (mouse) or tap opens the seat popover. */
function useHoverOpen() {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clear();
    timer.current = window.setTimeout(() => setOpen(true), 180);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clear();
    timer.current = window.setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => clear, []);
  return { open, setOpen, enter, leave };
}

function SeatDetails({
  player,
  stack,
}: {
  player: SeatPlayer;
  stack: number;
}) {
  const agent = player.agent;
  const bot = player.bot;
  return (
    <div className='text-[13px] text-fg-muted'>
      <p className='text-[15px] font-semibold text-fg'>{player.nickname}</p>
      <dl className='mt-2 space-y-1.5'>
        <div className='flex justify-between gap-3'>
          <dt>Stack</dt>
          <dd className='tabular-nums text-fg'>{stack.toLocaleString()}</dd>
        </div>
        {agent ? (
          <>
            <div className='flex justify-between gap-3'>
              <dt>Model</dt>
              <dd className='truncate font-mono text-[12px] text-fg' title={agent.model}>
                {shortModel(agent.model, 26)}
              </dd>
            </div>
            <div className='flex justify-between gap-3'>
              <dt>Moves verified</dt>
              <dd className='inline-flex items-center gap-1 tabular-nums text-fg'>
                {agent.movesVerified.toLocaleString()}
                <Check className='h-3.5 w-3.5 text-accent' aria-label='verified' />
              </dd>
            </div>
          </>
        ) : bot ? (
          <>
            <div className='flex justify-between gap-3'>
              <dt>Persona</dt>
              <dd className='truncate text-fg'>{bot.persona}</dd>
            </div>
            {bot.model ? (
              <div className='flex justify-between gap-3'>
                <dt>Model</dt>
                <dd className='truncate font-mono text-[12px] text-fg'>{bot.model}</dd>
              </div>
            ) : null}
            {bot.signingAddress ? (
              <div className='flex justify-between gap-3'>
                <dt>Signer</dt>
                <dd className='font-mono text-[12px] text-fg' title={bot.signingAddress}>
                  {truncateMiddle(bot.signingAddress)}
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
      {agent ? (
        <>
          <p className='mt-2 flex items-start gap-1.5 text-[13px] leading-snug'>
            <ShieldCheck className='mt-0.5 h-4 w-4 shrink-0 text-accent' strokeWidth={1.75} />
            Every move is a NEAR AI Cloud reply signed inside a TEE and checked before it hits the table.
          </p>
          {agent.lastReceiptUrl ? (
            <a
              href={agent.lastReceiptUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='mt-3 inline-flex h-10 w-full items-center justify-center gap-1 rounded-sm bg-surface-3 px-3 text-[13px] font-semibold text-fg ring-1 ring-border-strong hover:bg-surface-2'
            >
              Last move receipt
              <ArrowUpRight className='h-4 w-4' />
            </a>
          ) : (
            <p className='mt-3 text-center text-[13px] text-fg-subtle'>No move receipt yet</p>
          )}
        </>
      ) : null}
    </div>
  );
}

export const PlayerSeat = ({
  player,
  isMe,
  isTurn,
  isDealer,
  isWinner = false,
  winningHand,
  positionLabel = null,
  compact = false,
  anchor = 'bottom',
  stack,
  avatarUrl,
  style,
  turnSecondsLeft = null,
  actionFlash = null,
  turnTotalSeconds = 30,
  allIn = false,
  equity = null,
  handName = null,
  blind = null,
  spectator = false,
  onProof,
}: PlayerSeatProps) => {
  const reduce = useReducedMotion();
  const cards = player.folded ? [] : player.holeCards;
  const urgent = turnSecondsLeft != null && turnSecondsLeft <= 5;
  const speech = useSpeech(player.bot?.lastLine);
  const [tag, setTag] = useState<SeatActionFlash | null>(null);
  const hover = useHoverOpen();
  const tagLabel = positionLabel ?? blind;

  useEffect(() => {
    if (!actionFlash) return;
    setTag(actionFlash);
    const t = window.setTimeout(
      () => setTag(null),
      TAG_IN_S * 1000 + TAG_HOLD_MS
    );
    return () => window.clearTimeout(t);
  }, [actionFlash]);

  const revealed = cards.some((c) => c >= 0);
  const holeCards =
    cards.length > 0 ? (
      <div className='relative flex items-end justify-center' aria-label={revealed ? undefined : 'Two private cards'}>
        {cards.slice(0, 2).map((c, i) => (
          <SleekCard
            key={`${player.id}-c-${i}`}
            cardId={isMe ? c : c < 0 ? -1 : c}
            backSeed={player.seat * 2 + i}
            back={spectator ? 'dark' : 'random'}
            className={cn(
              i === 0 ? '-mr-2 -rotate-[6deg]' : '-ml-2 rotate-[6deg]',
              isMe && 'hover:-translate-y-1'
            )}
            size={revealed ? 'sm' : compact ? 'xs' : isMe ? 'md' : 'sm'}
          />
        ))}
      </div>
    ) : null;

  const status = isTurn
    ? 'to act'
    : player.folded
      ? 'folded'
      : allIn
        ? 'all in'
        : isWinner
          ? 'winner'
          : null;
  const ariaLabel = [
    `${player.nickname}${isMe ? ' (you)' : ''}`,
    `stack ${stack.toLocaleString()}`,
    status,
    player.agent
      ? `TEE agent, ${player.agent.movesVerified} moves verified`
      : player.bot
        ? 'AI bot'
        : null,
  ]
    .filter(Boolean)
    .join(', ');

  // One status tag max, by priority.
  let statusTag: React.ReactNode = null;
  if (isWinner) {
    statusTag = (
      <span className='rounded-xs bg-accent-soft px-2 py-0.5 text-[13px] font-semibold text-accent ring-1 ring-accent/40'>
        Winner{winningHand ? ` · ${winningHand}` : ''}
      </span>
    );
  } else if (equity) {
    statusTag = <EquityBadge share={equity.share} leading={equity.leading} />;
  } else if (isTurn) {
    statusTag = (
      <span
        className={cn(
          'rounded-xs bg-black/50 px-1.5 py-0.5 text-[13px] font-semibold tabular-nums',
          urgent ? 'text-warning' : 'text-fg'
        )}
      >
        {turnSecondsLeft != null ? formatClock(turnSecondsLeft) : '…'}
      </span>
    );
  } else if (player.folded) {
    statusTag = (
      <span className='rounded-xs bg-black/40 px-1.5 py-0.5 text-[13px] font-medium text-fg-muted'>
        Folded
      </span>
    );
  } else if (handName) {
    statusTag = (
      <span className='rounded-xs bg-black/50 px-1.5 py-0.5 text-[13px] font-medium text-fg-muted'>
        {handName}
      </span>
    );
  }

  const tagModel = player.agent ? shortModel(player.agent.model, 24) : null;

  // Bottom seats show their hole cards above the pill, so the tag sits beside the pill instead.
  const tagBeside = anchor === 'bottom' && cards.length > 0;
  const actionTag = (
    <div
      className={cn(
        'pointer-events-none absolute z-40',
        tagBeside
          ? 'left-full top-1/2 ml-2 -translate-y-1/2'
          : cn('left-1/2 -translate-x-1/2', compact ? '-top-8' : '-top-9')
      )}
    >
    <AnimatePresence>
      {tag && !equity ? (
        <motion.div
          key={tag.id}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.92 }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
            // The centre ALL IN splash plays first (~1.5 s); the seat tag settles in after it.
            transition: { duration: TAG_IN_S, delay: tag.action === 'all-in' ? 1.6 : 0 },
          }}
          exit={{ opacity: 0, transition: { duration: TAG_OUT_S } }}
          className={cn(
            'pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded-xs px-2 text-[13px] font-bold uppercase leading-7 tracking-wide shadow-[0_6px_20px_rgba(0,0,0,0.45)] lg:text-[15px]',
            actionFlashTone(String(tag.action))
          )}
          role='status'
        >
          <span className='pointer-events-none'>{actionFlashLabel(tag)}</span>
          {tagModel && tag.actionIndex != null && onProof ? (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation();
                onProof(tag.actionIndex!);
              }}
              title={`TEE attested · ${tagModel}`}
              aria-label={`TEE attested · ${tagModel}. Open proof`}
              className='relative -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-[4px] hover:bg-black/20 after:absolute after:-inset-2.5 after:content-[""]'
            >
              <Check className='h-3.5 w-3.5' strokeWidth={3} style={{ color: tag.action === 'all-in' ? undefined : 'var(--accent)' }} />
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
    </div>
  );

  const avatarSize = compact ? 'h-8 w-8 sm:h-10 sm:w-10' : 'h-10 w-10';

  const seatPill = (
    <div className='relative'>
      {actionTag}
      {isDealer ? (
        <div
          className='absolute -left-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-[#f2f5f3] text-[11px] font-bold text-[#0b0f0d] shadow-[0_2px_6px_rgba(0,0,0,0.5)]'
          title='Dealer button'
          aria-label='Dealer'
        >
          D
        </div>
      ) : null}
      <Popover open={hover.open} onOpenChange={hover.setOpen}>
        <PopoverTrigger
          aria-label={ariaLabel}
          onPointerEnter={hover.enter}
          onPointerLeave={hover.leave}
          className={cn(
            'flex items-center border bg-surface/90 text-left backdrop-blur transition-[box-shadow,border-color] duration-fast',
            compact
              ? 'min-h-11 flex-col gap-1 rounded-sm px-1.5 py-1.5 text-center sm:flex-row sm:gap-2 sm:px-2 sm:text-left'
              : 'min-h-11 gap-2 rounded-sm py-1.5 pl-1.5 pr-3',
            isTurn
              ? 'border-accent shadow-[var(--glow-accent)]'
              : isWinner
                ? 'border-accent shadow-[var(--glow-accent)]'
                : 'border-border'
          )}
        >
          <div className='relative shrink-0'>
            {isTurn && turnSecondsLeft != null ? (
              <TurnRing fraction={turnSecondsLeft / Math.max(1, turnTotalSeconds)} urgent={urgent} />
            ) : null}
            {avatarUrl ? (
              <div className={cn('overflow-hidden rounded-full bg-surface-3', avatarSize, player.folded && 'opacity-50 grayscale')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarUrl} alt='' className='h-full w-full object-cover' />
              </div>
            ) : (
              <div
                aria-hidden
                className={cn(
                  'flex items-center justify-center rounded-full text-[15px] font-semibold text-fg',
                  avatarSize,
                  player.folded && 'opacity-50 grayscale'
                )}
                style={{ background: avatarColor(player.nickname) }}
              >
                {player.nickname.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className={cn('min-w-0 leading-tight', compact ? 'max-w-[5.5rem] sm:max-w-[7.5rem]' : 'max-w-[8rem]')}>
            <div className={cn('flex min-w-0 items-center gap-1', compact && 'justify-center sm:justify-start')}>
              <span
                className={cn(
                  'truncate text-[13px] font-semibold',
                  player.folded ? 'text-fg-muted' : 'text-fg'
                )}
              >
                {isMe ? `${player.nickname} (you)` : player.nickname}
              </span>
              {tagLabel ? (
                <span className='inline-flex h-[18px] shrink-0 items-center rounded-[4px] border border-border-strong px-1 text-[11px] font-semibold leading-none text-fg-muted'>
                  {tagLabel}
                </span>
              ) : null}
            </div>
            <div className={cn('mt-0.5 flex', compact && 'justify-center sm:justify-start')}>
              {allIn && !player.folded ? (
                <span className='text-[13px] font-bold uppercase tracking-wide text-accent'>All-in</span>
              ) : (
                <RollingNumber
                  value={Math.max(stack, 0)}
                  format={chipText}
                  className={cn(
                    'text-[15px] font-semibold leading-5',
                    player.folded ? 'text-fg-subtle' : 'text-fg'
                  )}
                />
              )}
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent
          side='top'
          onPointerEnter={hover.enter}
          onPointerLeave={hover.leave}
          className='w-72 rounded-md border-border-strong bg-surface-2 p-4 shadow-[var(--shadow-e2)]'
        >
          <SeatDetails player={player} stack={stack} />
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div
      className={cn(
        'absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center',
        compact ? 'gap-1' : 'gap-1.5',
        anchor === 'bottom' && 'flex-col',
        anchor === 'top' && 'flex-col-reverse',
        // Hole cards face the felt: right of a left-rail seat, left of a right-rail seat.
        anchor === 'left' && 'flex-row-reverse',
        anchor === 'right' && 'flex-row'
      )}
      style={style}
    >
      {speech ? (
        <div
          role='status'
          className='pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[13rem] -translate-x-1/2 rounded-sm bg-surface-2 px-3 py-1.5 text-center text-[13px] leading-snug text-fg shadow-[var(--shadow-e2)] ring-1 ring-border-strong'
        >
          {speech}
        </div>
      ) : null}
      {holeCards}
      <div className='relative flex flex-col items-center'>
        {seatPill}
        {/* Absolute so a status change never shifts the seat. */}
        {statusTag ? (
          <div
            className={cn(
              'absolute z-30 whitespace-nowrap',
              // Top seats keep their hole cards below the pill: the tag goes beside it.
              anchor === 'top'
                ? 'left-full top-1/2 ml-1.5 -translate-y-1/2'
                : 'left-1/2 top-full mt-1 -translate-x-1/2'
            )}
          >
            {statusTag}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** An open seat: dashed outline (waiting tables). */
export function EmptySeat({
  style,
  label = 'Open seat',
}: {
  style?: React.CSSProperties;
  label?: string;
}) {
  return (
    <div
      className='absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1'
      style={style}
    >
      <span aria-hidden className='h-10 w-10 rounded-full border-2 border-dashed border-border-strong bg-black/10' />
      <span className='whitespace-nowrap text-[13px] text-fg-subtle'>{label}</span>
    </div>
  );
}

type SeatPos = { left: string; top: string; anchor: SeatAnchor };

/** Portrait (phone) oval: seats down both long sides, one at each end. */
function portraitPositions(count: number): SeatPos[] {
  const bottom: SeatPos = { left: '50%', top: '91%', anchor: 'bottom' };
  const top: SeatPos = { left: '50%', top: '8%', anchor: 'top' };
  const l = (t: number): SeatPos => ({ left: '17%', top: `${t}%`, anchor: 'left' });
  const r = (t: number): SeatPos => ({ left: '83%', top: `${t}%`, anchor: 'right' });
  if (count <= 2) return [bottom, top];
  if (count === 3) return [bottom, l(30), r(30)];
  if (count === 4) return [bottom, l(50), top, r(50)];
  if (count === 5) return [bottom, l(68), l(27), r(27), r(68)];
  return [bottom, l(70), l(28), top, r(28), r(70)];
}

/** Seat anchors around the oval. `inset` pulls seats in so wide pills don’t clip. */
export function seatPositions(
  count: number,
  opts?: { inset?: boolean; portrait?: boolean }
): SeatPos[] {
  if (opts?.portrait) return portraitPositions(count);
  const inset = Boolean(opts?.inset);
  if (count <= 2) {
    return [
      { left: '50%', top: inset ? '86%' : '88%', anchor: 'bottom' },
      { left: '50%', top: inset ? '14%' : '12%', anchor: 'top' },
    ];
  }
  if (count === 3) {
    return [
      { left: '50%', top: inset ? '86%' : '88%', anchor: 'bottom' },
      { left: inset ? '12%' : '10%', top: '42%', anchor: 'left' },
      { left: inset ? '88%' : '90%', top: '42%', anchor: 'right' },
    ];
  }
  if (count === 4) {
    return [
      { left: '50%', top: inset ? '86%' : '88%', anchor: 'bottom' },
      { left: inset ? '11%' : '9%', top: '50%', anchor: 'left' },
      { left: '50%', top: inset ? '14%' : '12%', anchor: 'top' },
      { left: inset ? '89%' : '91%', top: '50%', anchor: 'right' },
    ];
  }
  if (count === 5) {
    return [
      { left: '50%', top: inset ? '86%' : '88%', anchor: 'bottom' },
      { left: inset ? '11%' : '9%', top: '58%', anchor: 'left' },
      { left: inset ? '18%' : '14%', top: inset ? '18%' : '16%', anchor: 'top' },
      { left: inset ? '82%' : '86%', top: inset ? '18%' : '16%', anchor: 'top' },
      { left: inset ? '89%' : '91%', top: '58%', anchor: 'right' },
    ];
  }
  return [
    { left: '50%', top: inset ? '86%' : '88%', anchor: 'bottom' },
    { left: inset ? '11%' : '9%', top: inset ? '68%' : '68%', anchor: 'left' },
    { left: inset ? '11%' : '9%', top: inset ? '30%' : '28%', anchor: 'left' },
    { left: '50%', top: inset ? '12%' : '10%', anchor: 'top' },
    { left: inset ? '89%' : '91%', top: inset ? '30%' : '28%', anchor: 'right' },
    { left: inset ? '89%' : '91%', top: inset ? '68%' : '68%', anchor: 'right' },
  ];
}
