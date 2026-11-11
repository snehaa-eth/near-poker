'use client';

/* eslint-disable @next/next/no-img-element -- safe */
import React, { useState, type ComponentProps } from 'react';

import { getCardBackImage, getPokerCardImage } from '~/lib/helpers';
import { cn } from '~/lib/utils';

interface PokerCardProps extends ComponentProps<'img'> {
  cardId: number;
  /** Optional seed for a stable face-down back; random per mount if omitted. */
  backSeed?: number;
}

export const PokerCard = ({
  cardId,
  backSeed,
  className,
  style,
  ...props
}: PokerCardProps) => {
  const [randomBack] = useState(() => getCardBackImage(backSeed));
  const faceDown = cardId < 0;
  const src = faceDown ? randomBack : getPokerCardImage(cardId);

  return (
    <img
      alt={faceDown ? 'card back' : 'Poker Card'}
      className={cn('rounded-[0.3rem] object-cover shadow-md', className)}
      src={src}
      style={{
        aspectRatio: 63 / 88,
        ...style,
      }}
      {...props}
    />
  );
};
