'use client';

import React, { useEffect, useState } from 'react';

import type { AgentInfo, BotInfo } from '~/lib/api';
import { shortModel } from '~/lib/arena';
import {
  actionFlashLabel,
  actionFlashTone,
  type SeatActionFlash,
} from '~/lib/seat-action-flash';
import { cn } from '~/lib/utils';

import { ChipAmount } from '~/components/currency-amount';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';

import { SleekCard } from './sleek-card';

import { ArrowUpRight } from 'lucide-react';

/** How long an agent's table talk stays on screen. */
const SPEECH_MS = 5000;
/** How long the fold/call/raise toast stays over the seat name. */
const ACTION_FLASH_MS = 1400;

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

function BotBadge({ bot }: { bot: BotInfo }) {
  return (
    <Popover>
      <PopoverTrigger
        className='shrink-0 rounded-full bg-violet-100 px-1.5 py-[1px] text-[10px] font-semibold text-violet-800 ring-1 ring-violet-200 transition hover:bg-violet-200 lg:text-[11px]'
        aria-label='AI agent details'
      >
        🤖 AI
      </PopoverTrigger>
      <PopoverContent
        side='top'
        className='w-64 rounded-2xl border-neutral-200 bg-white p-3 text-xs text-neutral-700'
      >
        <p className='text-sm font-semibold text-neutral-950'>{bot.persona}</p>
        <dl className='mt-2 space-y-1'>
          {bot.model ? (
            <div className='flex justify-between gap-3'>
              <dt className='text-neutral-400'>Model</dt>
              <dd className='truncate font-mono'>{bot.model}</dd>
            </div>
          ) : null}
          <div className='flex justify-between gap-3'>
            <dt className='text-neutral-400'>Runtime</dt>
            <dd
              className={bot.attested ? 'text-emerald-700' : 'text-neutral-500'}
            >
              {bot.attested ? 'attested in TEE ✓' : 'not attested'}
            </dd>
          </div>
          {bot.signingAddress ? (
            <div className='flex justify-between gap-3'>
              <dt className='text-neutral-400'>Signer</dt>
              <dd className='font-mono' title={bot.signingAddress}>
                {truncateMiddle(bot.signingAddress)}
              </dd>
            </div>
          ) : null}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** Arena agent (INTERFACES §5.4): every accepted move carries a TEE receipt. */
function AgentBadge({
  agent,
  compact = false,
}: {
  agent: AgentInfo;
  compact?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'shrink-0 rounded-full bg-emerald-50 font-semibold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100',
          compact
            ? 'px-1.5 py-[1px] text-[9px]'
            : 'max-w-[8.5rem] truncate px-1.5 py-[1px] text-[10px] lg:text-[11px]'
        )}
        aria-label='TEE agent details'
        title={agent.model}
      >
        {compact ? '🔒 TEE' : `🔒 TEE · ${shortModel(agent.model, 14)}`}
      </PopoverTrigger>
      <PopoverContent
        side='top'
        className='w-72 rounded-2xl border-neutral-200 bg-white p-3 text-xs text-neutral-700'
      >
        <p className='text-sm font-semibold text-neutral-950'>TEE agent</p>
        <dl className='mt-2 space-y-1'>
          <div className='flex justify-between gap-3'>
            <dt className='text-neutral-400'>Model</dt>
            <dd className='truncate font-mono' title={agent.model}>
              {agent.model}
            </dd>
          </div>
          <div className='flex justify-between gap-3'>
            <dt className='text-neutral-400'>Moves verified</dt>
            <dd className='font-medium tabular-nums text-emerald-700'>
              {agent.movesVerified} ✓
            </dd>
          </div>
        </dl>
        <p className='mt-2 text-[11px] leading-snug text-neutral-500'>
          Each move is a NEAR AI Cloud reply signed inside a confidential TEE
          and checked by the server before it hits the table.
        </p>
        {agent.lastReceiptUrl ? (
          <a
            href={agent.lastReceiptUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='mt-3 flex w-full items-center justify-center gap-1 rounded-full bg-neutral-950 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800'
          >
            Verify last move on NEAR AI
            <ArrowUpRight className='h-3.5 w-3.5' />
          </a>
        ) : (
          <p className='mt-3 text-center text-[11px] text-neutral-400'>
            No move receipt yet
          </p>
        )}
        <p className='mt-1.5 text-center text-[10px] text-neutral-400'>
          Checks Intel TDX + NVIDIA GPU evidence in your browser
        </p>
      </PopoverContent>
    </Popover>
  );
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
  /** NLHE seat label (BTN, SB, BB, …). */
  positionLabel?: string | null;
  /** Narrower seat pill for the arena spectator shell. */
  compact?: boolean;
  /** Table-side anchor so hole cards / bets face the felt, not the rail. */
  anchor?: SeatAnchor;
  stack: number;
  avatarUrl?: string | null;
  style?: React.CSSProperties;
  /** Remaining seconds on this seat’s turn clock. */
  turnSecondsLeft?: number | null;
  /** Ephemeral fold / call / raise toast over the agent name. */
  actionFlash?: SeatActionFlash | null;
}

function formatClock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function avatarColor(name: string) {
  const hues = [210, 160, 20, 280, 340, 40];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % hues.length;
  }
  return `hsl(${hues[hash]} 72% 48%)`;
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
}: PlayerSeatProps) => {
  const cards = player.folded
    ? []
    : player.holeCards.length > 0
      ? player.holeCards
      : [];
  const urgent = turnSecondsLeft != null && turnSecondsLeft <= 15;
  const speech = useSpeech(player.bot?.lastLine);
  const showStreetBet = !player.folded && player.chipsInPot > 0;
  const [flashVisible, setFlashVisible] = useState<SeatActionFlash | null>(
    null
  );

  useEffect(() => {
    if (!actionFlash) return;
    setFlashVisible(actionFlash);
    const t = window.setTimeout(() => setFlashVisible(null), ACTION_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [actionFlash]);

  const holeCards =
    cards.length > 0 ? (
      <div className='relative flex h-auto items-end justify-center'>
        {cards.slice(0, 2).map((c, i) => (
          <SleekCard
            key={`${player.id}-c-${i}`}
            cardId={isMe ? c : c < 0 ? -1 : c}
            backSeed={player.seat * 2 + i}
            className={cn(
              i === 0 ? '-mr-2 -rotate-[8deg]' : '-ml-2 rotate-[8deg]',
              isMe && 'hover:-translate-y-1'
            )}
            size={compact ? 'sm' : isMe ? 'md' : 'sm'}
          />
        ))}
      </div>
    ) : null;

  const streetBet = showStreetBet ? (
    <div className='rounded-full bg-white/95 px-2 py-0.5 shadow-sm ring-1 ring-black/5'>
      <ChipAmount
        value={player.chipsInPot}
        size='sm'
        className='text-[11px] font-semibold text-neutral-700'
        iconClassName='h-3.5 w-3.5'
      />
    </div>
  ) : null;

  const seatPill = (
    <div className='relative'>
      {flashVisible ? (
        <div
          key={flashVisible.id}
          role='status'
          className={cn(
            'pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1',
            'duration-200',
            compact ? '-top-7 text-[9px]' : '-top-8 lg:-top-9 lg:text-[11px]',
            actionFlashTone(flashVisible.action)
          )}
        >
          {actionFlashLabel(flashVisible)}
        </div>
      ) : null}
      {isDealer ? (
        <div
          className={cn(
            'absolute z-10 flex -translate-y-1/2 items-center justify-center rounded-full bg-neutral-950 font-bold text-white shadow',
            compact
              ? '-left-3 top-1/2 h-4 w-4 text-[9px]'
              : '-left-3.5 top-1/2 h-5 w-5 text-[10px] lg:h-6 lg:w-6 lg:text-xs'
          )}
        >
          D
        </div>
      ) : null}
      <div
        className={cn(
          'flex items-center border bg-white/95 shadow-[0_4px_20px_rgba(0,0,0,0.06)] backdrop-blur',
          compact
            ? 'max-w-[9.75rem] gap-1.5 rounded-2xl py-1 pl-1 pr-2'
            : 'gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 lg:py-2 lg:pl-2 lg:pr-4',
          isWinner
            ? 'border-amber-400 ring-[3px] ring-amber-300/60'
            : isTurn
              ? 'border-[#1D9BF0] ring-[3px] ring-[#1D9BF0]/15'
              : isMe
                ? 'border-neutral-300'
                : 'border-neutral-200/90',
          flashVisible && 'ring-[3px] ring-white/40'
        )}
      >
        {avatarUrl ? (
          <div
            className={cn(
              'shrink-0 overflow-hidden rounded-full bg-neutral-100',
              compact ? 'h-7 w-7' : 'h-8 w-8 lg:h-9 lg:w-9'
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt=''
              className='h-full w-full object-cover'
            />
          </div>
        ) : (
          <div
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
              compact ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm lg:h-9 lg:w-9'
            )}
            style={{ background: avatarColor(player.nickname) }}
          >
            {player.nickname.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className='min-w-0 flex-1 leading-tight'>
          <div className='flex min-w-0 items-center gap-1'>
            <span
              className={cn(
                'truncate font-semibold text-neutral-900',
                compact
                  ? 'text-[11px]'
                  : 'max-w-[6.5rem] text-[12px] lg:max-w-[8rem] lg:text-[13px]'
              )}
            >
              {isMe ? `${player.nickname} (you)` : player.nickname}
            </span>
            {positionLabel ? (
              <span className='shrink-0 rounded bg-neutral-900 px-1 py-[1px] text-[9px] font-bold uppercase tracking-wide text-white'>
                {positionLabel}
              </span>
            ) : null}
            {!compact && player.agent ? (
              <AgentBadge agent={player.agent} compact />
            ) : !compact && player.bot ? (
              <BotBadge bot={player.bot} />
            ) : null}
          </div>
          <div className='mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-neutral-500'>
            <ChipAmount
              // `stack` is already the remaining stack (street bet deducted).
              value={Math.max(stack, 0)}
              size='sm'
              className='text-[10px] font-normal text-neutral-500'
              iconClassName='h-3 w-3'
            />
            {player.folded ? (
              <span className='font-semibold uppercase tracking-wide text-neutral-400'>
                folded
              </span>
            ) : null}
            {compact && player.agent ? (
              <AgentBadge agent={player.agent} compact />
            ) : compact && player.bot ? (
              <BotBadge bot={player.bot} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  const statusBits = (
    <>
      {isWinner ? (
        <div className='rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-950 shadow'>
          🏆 Winner{winningHand ? ` · ${winningHand}` : ''}
        </div>
      ) : null}
      {isTurn ? (
        <div
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums shadow-sm',
            urgent
              ? 'animate-pulse bg-red-500/90 text-white'
              : 'bg-[#1D9BF0]/95 text-white'
          )}
        >
          {turnSecondsLeft != null ? formatClock(turnSecondsLeft) : '•••'} to
          act
        </div>
      ) : null}
    </>
  );

  // Cards + street bet always face the felt; pill sits on the rail.
  const towardCenter = (
    <>
      {holeCards}
      {streetBet}
    </>
  );

  return (
    <div
      className={cn(
        'absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center transition-opacity',
        compact ? 'gap-1' : 'gap-1.5',
        player.folded && 'opacity-40',
        anchor === 'bottom' && 'flex-col',
        anchor === 'top' && 'flex-col-reverse',
        anchor === 'left' && 'flex-row',
        anchor === 'right' && 'flex-row-reverse'
      )}
      style={style}
    >
      {speech ? (
        <div
          role='status'
          className='pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[13rem] -translate-x-1/2 rounded-2xl bg-white px-3 py-1.5 text-center text-[11px] font-medium leading-snug text-neutral-800 shadow-lg ring-1 ring-neutral-200 animate-in fade-in-0 zoom-in-95 lg:text-xs'
        >
          {speech}
          <span className='absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-white ring-0' />
        </div>
      ) : null}
      {towardCenter}
      <div className='flex flex-col items-center gap-1'>
        {seatPill}
        {statusBits}
      </div>
    </div>
  );
};

/** Seat anchors around the oval. `inset` pulls seats in so wide pills don’t clip. */
export function seatPositions(
  count: number,
  opts?: { inset?: boolean }
): Array<{ left: string; top: string; anchor: SeatAnchor }> {
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
    { left: inset ? '11%' : '9%', top: inset ? '66%' : '68%', anchor: 'left' },
    { left: inset ? '11%' : '9%', top: inset ? '30%' : '28%', anchor: 'left' },
    { left: '50%', top: inset ? '12%' : '10%', anchor: 'top' },
    { left: inset ? '89%' : '91%', top: inset ? '30%' : '28%', anchor: 'right' },
    { left: inset ? '89%' : '91%', top: inset ? '66%' : '68%', anchor: 'right' },
  ];
}
