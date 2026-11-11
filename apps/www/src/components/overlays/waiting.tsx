'use client';

import React from 'react';

import type { PublicGameView } from '~/lib/api';
import { useSocket } from '~/providers/socket-provider';
import { errorHandler } from '~/lib/utils';

import { toast } from 'sonner';

import { Overlay } from '../overlay';

interface WaitingOverlayProps {
  gameId: string;
  view: PublicGameView;
  /** After a finished NLHE hand — deal again. */
  nextHand?: boolean;
}

export const WaitingOverlay = ({
  gameId,
  view,
  nextHand = false,
}: WaitingOverlayProps) => {
  const { socket } = useSocket();

  const onStartGame = () => {
    const id = toast.loading(nextHand ? 'Dealing next hand…' : 'Starting game…');
    try {
      if (!socket) throw new Error('Not connected.');
      socket.emit('game:start', { gameId });
      toast.success(nextHand ? 'Next hand requested!' : 'Start requested!', {
        id,
      });
    } catch (error) {
      toast.error(errorHandler(error), { id });
    }
  };

  return (
    <Overlay>
      <div className='flex flex-col items-center gap-4 text-center'>
        <div className='font-poker text-3xl tracking-wide text-neutral-900'>
          {nextHand ? 'Hand over' : 'Waiting'}
        </div>
        {nextHand && view.winnerNickname ? (
          <p className='text-sm font-medium text-neutral-700'>
            Winner · {view.winnerNickname}
          </p>
        ) : null}
        <div className='text-sm text-neutral-500'>
          {view.totalPlayers} player{view.totalPlayers === 1 ? '' : 's'} at the
          table
        </div>
        <div className='flex w-full flex-col gap-2'>
          {view.players.map((p) => (
            <div
              key={p.id}
              className='rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-800'
            >
              {p.nickname}
            </div>
          ))}
        </div>
        {!nextHand ? (
          <p className='text-sm text-neutral-500'>
            Need at least 2 players to start.
          </p>
        ) : null}
        <button
          type='button'
          className='mt-2 h-12 w-full rounded-full bg-neutral-950 text-sm font-semibold text-white disabled:opacity-40'
          disabled={view.totalPlayers < 2}
          onClick={onStartGame}
        >
          {nextHand ? 'Next hand' : 'Start Game'}
        </button>
      </div>
    </Overlay>
  );
};
