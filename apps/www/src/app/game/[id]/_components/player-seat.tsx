'use client';

import React, { useEffect, useState } from 'react';

import type { AgentInfo, BotInfo } from '~/lib/api';
import { shortModel } from '~/lib/arena';
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
function AgentBadge({ agent }: { agent: AgentInfo }) {
  return (
    <Popover>
      <PopoverTrigger
        className='max-w-[8.5rem] shrink-0 truncate rounded-full bg-emerald-50 px-1.5 py-[1px] text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100 lg:text-[11px]'
        aria-label='TEE agent details'
        title={agent.model}
      >
        🔒 TEE · {shortModel(agent.model, 14)}
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

interface PlayerSeatProps {
  player: SeatPlayer;
  isMe: boolean;
  isTurn: boolean;
  isDealer: boolean;
  /** Won the hand that just ended. */
  isWinner?: boolean;
  /** Best hand name when the win came at showdown. */
  winningHand?: string;
  stack: number;
  avatarUrl?: string | null;
  style?: React.CSSProperties;
  /** Remaining seconds on this seat’s turn clock. */
  turnSecondsLeft?: number | null;
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
  stack,
  avatarUrl,
  style,
  turnSecondsLeft = null,
}: PlayerSeatProps) => {
  const cards = player.holeCards.length > 0 ? player.holeCards : [];
  const urgent = turnSecondsLeft != null && turnSecondsLeft <= 15;
  const speech = useSpeech(player.bot?.lastLine);

  return (
    <div
      className={cn(
        'absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 transition-opacity lg:gap-2',
        player.folded && 'opacity-35'
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
      {cards.length > 0 ? (
        <div className='mb-0.5 flex items-end gap-1 lg:gap-1.5'>
          {cards.slice(0, 2).map((c, i) => (
            <SleekCard
              key={`${player.id}-c-${i}`}
              cardId={isMe ? c : c < 0 ? -1 : c}
              className={cn(
                'shadow-[0_6px_16px_rgba(0,0,0,0.08)]',
                isMe && 'hover:-translate-y-1',
                i === 0 ? '-rotate-6' : 'rotate-6'
              )}
              size={isMe ? 'lg' : 'sm'}
            />
          ))}
        </div>
      ) : null}

      {player.chipsInPot > 0 ? (
        <div className='rounded-full bg-white px-2.5 py-0.5 shadow-sm'>
          <ChipAmount
            value={player.chipsInPot}
            size='sm'
            className='text-[11px] font-semibold text-neutral-700 lg:text-xs'
            iconClassName='h-3.5 w-3.5'
          />
        </div>
      ) : null}

      <div className='relative'>
        {isDealer ? (
          <div className='absolute -left-3.5 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-neutral-950 text-[10px] font-bold text-white shadow lg:h-6 lg:w-6 lg:text-xs'>
            D
          </div>
        ) : null}
        <div
          className={cn(
            'flex items-center gap-2 rounded-full border bg-white/95 py-1.5 pl-1.5 pr-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.06)] backdrop-blur lg:py-2 lg:pl-2 lg:pr-4',
            isWinner
              ? 'border-amber-400 ring-[3px] ring-amber-300/60'
              : isTurn
                ? 'border-[#1D9BF0] ring-[3px] ring-[#1D9BF0]/15'
                : isMe
                  ? 'border-neutral-300'
                  : 'border-neutral-200/90'
          )}
        >
          {avatarUrl ? (
            <div className='h-9 w-9 shrink-0 overflow-hidden rounded-full bg-neutral-100 lg:h-10 lg:w-10'>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl}
                alt=''
                className='h-full w-full object-cover'
              />
            </div>
          ) : (
            <div
              className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white lg:h-10 lg:w-10'
              style={{ background: avatarColor(player.nickname) }}
            >
              {player.nickname.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className='min-w-0 leading-tight'>
            <div className='flex items-center gap-1'>
              <span className='max-w-[7.5rem] truncate text-[13px] font-semibold text-neutral-900 lg:max-w-[9rem] lg:text-sm'>
                {isMe ? `${player.nickname} (you)` : player.nickname}
              </span>
              {player.agent ? (
                <AgentBadge agent={player.agent} />
              ) : player.bot ? (
                <BotBadge bot={player.bot} />
              ) : null}
            </div>
            <div className='text-[11px] text-neutral-500 lg:text-xs'>
              <ChipAmount
                value={Math.max(stack - player.chipsInPot, 0)}
                size='sm'
                className='text-[11px] font-normal text-neutral-500 lg:text-xs'
                iconClassName='h-3.5 w-3.5'
              />
            </div>
          </div>
        </div>
      </div>

      {isWinner ? (
        <div className='rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-950 shadow lg:text-xs'>
          🏆 Winner{winningHand ? ` · ${winningHand}` : ''}
        </div>
      ) : null}

      {isTurn ? (
        <div
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-medium tabular-nums lg:text-xs',
            urgent ? 'animate-pulse text-red-500' : 'text-[#1D9BF0]'
          )}
        >
          <span>
            {turnSecondsLeft != null ? formatClock(turnSecondsLeft) : '•••'}
          </span>
          <span className='font-normal opacity-80'>to act</span>
        </div>
      ) : null}
    </div>
  );
};

export function seatPositions(
  count: number
): Array<{ left: string; top: string }> {
  if (count <= 2) {
    return [
      { left: '50%', top: '90%' },
      { left: '50%', top: '10%' },
    ];
  }
  if (count === 3) {
    return [
      { left: '50%', top: '90%' },
      { left: '10%', top: '38%' },
      { left: '90%', top: '38%' },
    ];
  }
  if (count === 4) {
    return [
      { left: '50%', top: '90%' },
      { left: '8%', top: '48%' },
      { left: '50%', top: '10%' },
      { left: '92%', top: '48%' },
    ];
  }
  if (count === 5) {
    return [
      { left: '50%', top: '90%' },
      { left: '8%', top: '58%' },
      { left: '16%', top: '16%' },
      { left: '84%', top: '16%' },
      { left: '92%', top: '58%' },
    ];
  }
  return [
    { left: '50%', top: '90%' },
    { left: '10%', top: '68%' },
    { left: '10%', top: '26%' },
    { left: '50%', top: '8%' },
    { left: '90%', top: '26%' },
    { left: '90%', top: '68%' },
  ];
}
