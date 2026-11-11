'use client';

import React from 'react';

import { ChipAmount } from '~/components/currency-amount';
import { cn } from '~/lib/utils';

import { SleekCard } from './sleek-card';

import { BadgeCheck } from 'lucide-react';

export type SeatPlayer = {
  id: string;
  nickname: string;
  seat: number;
  chipsInPot: number;
  folded: boolean;
  holeCards: number[];
};

interface PlayerSeatProps {
  player: SeatPlayer;
  isMe: boolean;
  isTurn: boolean;
  isDealer: boolean;
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
  stack,
  avatarUrl,
  style,
  turnSecondsLeft = null,
}: PlayerSeatProps) => {
  const cards = player.holeCards.length > 0 ? player.holeCards : [];
  const urgent =
    turnSecondsLeft != null && turnSecondsLeft <= 15;

  return (
    <div
      className={cn(
        'absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 transition-opacity lg:gap-2',
        player.folded && 'opacity-35'
      )}
      style={style}
    >
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
            isTurn
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
              <BadgeCheck className='h-3.5 w-3.5 shrink-0 fill-[#1D9BF0] text-white' />
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

      {isTurn ? (
        <div
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-medium tabular-nums lg:text-xs',
            urgent ? 'animate-pulse text-red-500' : 'text-[#1D9BF0]'
          )}
        >
          <span>
            {turnSecondsLeft != null
              ? formatClock(turnSecondsLeft)
              : '•••'}
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
