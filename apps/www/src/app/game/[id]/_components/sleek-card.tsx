'use client';

import React, { useState } from 'react';

import { getCardBackImage, getPokerCardImage } from '~/lib/helpers';
import { cardName } from '~/lib/poker-eval';
import { cn } from '~/lib/utils';

interface SleekCardProps {
  cardId: number;
  className?: string;
  style?: React.CSSProperties;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'board';
  /** Optional seed for a stable face-down back; random per mount if omitted. */
  backSeed?: number;
  /**
   * Face-down art. `dark` = the quiet NEAR back (spectator tables: an unknown card must never be
   * the loudest thing on screen). `random` keeps the legacy mix for the human table.
   */
  back?: 'dark' | 'random';
}

/** Poker card aspect ≈ 63×88. Heights drive width via aspect-ratio. */
const sizes = {
  xs: 'h-8 w-auto sm:h-10',
  sm: 'h-11 w-auto sm:h-12',
  md: 'h-[4.25rem] w-auto sm:h-[4.75rem] lg:h-[5.25rem]',
  lg: 'h-[5.25rem] w-auto sm:h-[5.75rem] lg:h-[6.25rem]',
  /** Board cards: the biggest thing on the felt. */
  board: 'h-[4.25rem] w-auto sm:h-[5.5rem] lg:h-[6.5rem]',
} as const;

const DARK_BACK = '/cards/BACK-NEAR-DARK.svg';

export const SleekCard = ({
  cardId,
  className,
  style,
  size = 'md',
  backSeed,
  back = 'random',
}: SleekCardProps) => {
  const [randomBack] = useState(() => getCardBackImage(backSeed));
  const faceDown = cardId < 0;
  const src = faceDown
    ? back === 'dark'
      ? DARK_BACK
      : randomBack
    : getPokerCardImage(cardId);

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-[0.55rem] bg-white',
        'shadow-[0_2px_0_rgba(0,0,0,0.12),0_10px_22px_rgba(0,0,0,0.28)]',
        'ring-1 ring-black/15 transition-transform duration-200 ease-out',
        'will-change-transform',
        faceDown && back === 'dark' && 'bg-surface ring-white/10',
        sizes[size],
        className
      )}
      style={{ aspectRatio: '63 / 88', ...style }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={faceDown ? 'Face-down card' : cardName(cardId)}
        className='h-full w-full select-none object-cover'
        draggable={false}
        src={src}
      />
      <span
        aria-hidden
        className='pointer-events-none absolute inset-0 rounded-[0.55rem] ring-1 ring-inset ring-white/35'
      />
    </span>
  );
};

/** An empty board slot: dashed outline, never a card back (UI-AUDIT #4). */
export function EmptyCardSlot({
  size = 'board',
  className,
}: {
  size?: SleekCardProps['size'];
  className?: string;
}) {
  return (
    <span
      role='img'
      aria-label='Card not dealt yet'
      className={cn(
        'inline-flex shrink-0 rounded-sm border-2 border-dashed border-white/20 bg-black/10',
        sizes[size],
        className
      )}
      style={{ aspectRatio: '63 / 88' }}
    />
  );
}
