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

const sizes = {
  sm: 'h-12 w-[2.15rem] lg:h-[3.25rem] lg:w-[2.3rem] xl:h-14 xl:w-[2.5rem]',
  md: 'h-[4.6rem] w-[3.25rem] lg:h-[5.25rem] lg:w-[3.7rem] xl:h-[5.75rem] xl:w-[4.05rem]',
  lg: 'h-[5.5rem] w-[3.9rem] lg:h-[6.25rem] lg:w-[4.4rem] xl:h-[6.75rem] xl:w-[4.75rem]',
};

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
    <img
      alt={faceDown ? 'card back' : 'card'}
      className={cn(
        sizes[size],
        'rounded-[0.3rem] border border-neutral-200/90 object-cover shadow-[0_4px_14px_rgba(0,0,0,0.06)] transition-transform duration-200 lg:rounded-[0.35rem] lg:shadow-[0_6px_18px_rgba(0,0,0,0.08)]',
        className
      )}
      src={src}
      style={style}
    />
  );
};
