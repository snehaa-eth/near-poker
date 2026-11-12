'use client';

import React, { useState } from 'react';

import { getCardBackImage, getPokerCardImage } from '~/lib/helpers';
import { cn } from '~/lib/utils';

interface SleekCardProps {
  cardId: number;
  className?: string;
  style?: React.CSSProperties;
  size?: 'sm' | 'md' | 'lg';
  /** Optional seed for a stable face-down back; random per mount if omitted. */
  backSeed?: number;
}

/** Poker card aspect ≈ 63×88. Heights drive width via aspect-ratio. */
const sizes = {
  sm: 'h-11 w-auto sm:h-12',
  md: 'h-[4.25rem] w-auto sm:h-[4.75rem] lg:h-[5.25rem]',
  lg: 'h-[5.25rem] w-auto sm:h-[5.75rem] lg:h-[6.25rem]',
} as const;

export const SleekCard = ({
  cardId,
  className,
  style,
  size = 'md',
  backSeed,
}: SleekCardProps) => {
  const [randomBack] = useState(() => getCardBackImage(backSeed));
  const faceDown = cardId < 0;
  const src = faceDown ? randomBack : getPokerCardImage(cardId);

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-[0.55rem] bg-white',
        'shadow-[0_2px_0_rgba(0,0,0,0.12),0_10px_22px_rgba(0,0,0,0.28)]',
        'ring-1 ring-black/15 transition-transform duration-200 ease-out',
        'will-change-transform',
        sizes[size],
        className
      )}
      style={{ aspectRatio: '63 / 88', ...style }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={faceDown ? 'card back' : 'card'}
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
