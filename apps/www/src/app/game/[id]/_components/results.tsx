'use client';

import React from 'react';

import type { PublicGameView } from '~/lib/api';

import { Dialog, DialogContent, DialogTrigger } from '~/components/ui/dialog';

import { SleekCard } from './sleek-card';

import { MedalIcon } from 'lucide-react';

interface ResultsProps {
  players: PublicGameView['players'];
  winnerId?: string | null;
  /** Winning hand name when the hand went to showdown. */
  winningHand?: string;
}

export const Results = ({ players, winnerId, winningHand }: ResultsProps) => {
  return (
    <div className='fixed bottom-6 left-6 z-40'>
      <Dialog>
        <DialogTrigger className='flex h-11 items-center gap-2 rounded-full border border-neutral-200 bg-white px-5 text-sm font-semibold text-neutral-900 shadow-sm'>
          <MedalIcon className='h-4 w-4' />
          Results
        </DialogTrigger>
        <DialogContent className='max-w-lg rounded-3xl border-neutral-200 bg-white p-6'>
          <div className='mb-4 font-poker text-2xl tracking-wide text-neutral-900'>
            Hand results
          </div>
          <div className='flex flex-col gap-5'>
            {players.map((player) => {
              const hand =
                player.chosenCommunity.length === 3
                  ? [...player.holeCards, ...player.chosenCommunity]
                  : player.holeCards;
              return (
                <div key={player.id} className='flex flex-col gap-2'>
                  <div className='flex justify-between text-sm'>
                    <span className='font-semibold text-neutral-900'>
                      {player.nickname}
                      {player.id === winnerId ? (
                        <span className='ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900'>
                          🏆 Winner{winningHand ? ` · ${winningHand}` : ''}
                        </span>
                      ) : null}
                    </span>
                    <span className='text-neutral-500'>
                      {player.folded
                        ? 'Folded'
                        : player.weight > 0
                          ? `Weight ${player.weight.toLocaleString()}`
                          : null}
                    </span>
                  </div>
                  <div className='flex gap-2'>
                    {hand.map((cardId, idx) => (
                      <SleekCard
                        key={`${player.id}-${idx}`}
                        cardId={cardId}
                        size='sm'
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
