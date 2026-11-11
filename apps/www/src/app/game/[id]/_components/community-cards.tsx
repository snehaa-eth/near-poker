'use client';

import React from 'react';

import { PokerCard } from '~/components';

interface CommunityCardsProps {
  cards: number[];
}

export const CommunityCards = ({ cards }: CommunityCardsProps) => {
  return (
    <div className='absolute right-1/2 top-1/2 mx-auto flex w-fit translate-x-1/2 flex-col gap-2'>
      <div className='flex flex-row items-center gap-3'>
        {cards.map((cardId, index) => {
          if (cardId < 0) return null;
          return (
            <PokerCard
              key={`community-${index}-${cardId}`}
              cardId={cardId}
              className='w-20 rounded-lg'
            />
          );
        })}
      </div>
    </div>
  );
};
