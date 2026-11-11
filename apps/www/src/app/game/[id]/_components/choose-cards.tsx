'use client';

import React, { useState } from 'react';

import { cn, errorHandler } from '~/lib/utils';
import { useSocket } from '~/providers/socket-provider';

import { toast } from 'sonner';

import { SleekCard } from './sleek-card';

interface ChooseCardsProps {
  cards: number[];
  gameId: string;
}

export const ChooseCards = ({ cards, gameId }: ChooseCardsProps) => {
  const { socket } = useSocket();
  const [selected, setSelected] = useState<Record<number, boolean>>({
    0: false,
    1: false,
    2: false,
    3: false,
    4: false,
  });

  const onChooseCards = () => {
    const id = toast.loading('Choosing cards…');
    try {
      if (!socket) throw new Error('Not connected.');
      const indexes = Object.keys(selected)
        .filter((k) => selected[Number(k)])
        .map((k) => Number(k));
      if (indexes.length !== 3) {
        throw new Error('Select 3 community cards.');
      }
      const cardsToChoose = indexes.map((i) => cards[i]!) as [
        number,
        number,
        number,
      ];
      if (cardsToChoose.some((c) => c < 0)) {
        throw new Error('Community cards are not ready yet.');
      }
      socket.emit('game:chooseCards', { gameId, cards: cardsToChoose });
      toast.success('Cards chosen', { id });
    } catch (error) {
      toast.error(errorHandler(error), { id });
    }
  };

  return (
    <div className='fixed bottom-28 left-1/2 z-40 w-full max-w-lg -translate-x-1/2 px-4'>
      <div className='rounded-3xl border border-neutral-200 bg-white p-4 shadow-lg'>
        <div className='mb-3 text-center font-poker text-lg tracking-wide text-neutral-800'>
          Pick 3 community cards for your hand
        </div>
        <div className='mb-4 flex justify-center gap-2'>
          {cards.map((cardId, i) => {
            if (cardId < 0) return null;
            return (
              <button
                key={`pick-${i}`}
                type='button'
                className={cn(
                  'rounded-[0.3rem] ring-offset-2 transition',
                  selected[i] ? 'ring-2 ring-[#1D9BF0]' : 'opacity-80'
                )}
                onClick={() =>
                  setSelected({ ...selected, [i]: !selected[i] })
                }
              >
                <SleekCard cardId={cardId} size='md' />
              </button>
            );
          })}
        </div>
        <button
          type='button'
          className='h-11 w-full rounded-full bg-neutral-950 text-sm font-semibold text-white'
          onClick={onChooseCards}
        >
          Confirm hand
        </button>
      </div>
    </div>
  );
};
