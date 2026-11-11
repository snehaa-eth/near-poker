'use client';

import React, { useMemo } from 'react';

import type { PublicGameView } from '~/lib/api';
import { useSession } from '~/providers/session-provider';
import { useSocket } from '~/providers/socket-provider';
import { errorHandler } from '~/lib/utils';

import { toast } from 'sonner';

import { Overlay } from '../overlay';

interface ShuffleOverlayProps {
  gameId: string;
  view: PublicGameView;
}

export const ShuffleOverlay = ({ gameId, view }: ShuffleOverlayProps) => {
  const { socket } = useSocket();
  const { user } = useSession();

  const { didPlayerShuffle, playersShuffled, totalPlayers } = useMemo(() => {
    const me = view.players.find((p) => p.id === user?.sessionId);
    return {
      didPlayerShuffle: me?.shuffled ?? false,
      playersShuffled: view.totalShuffles,
      totalPlayers: view.totalPlayers,
    };
  }, [view, user?.sessionId]);

  const onShuffle = () => {
    const id = toast.loading('Shuffling…');
    try {
      if (!socket) throw new Error('Not connected.');
      socket.emit('game:shuffle', { gameId });
      toast.success('Ready', { id });
    } catch (error) {
      toast.error(errorHandler(error), { id });
    }
  };

  return (
    <Overlay>
      <div className='flex flex-col items-center gap-4 text-center'>
        <div className='font-poker text-3xl tracking-wide text-neutral-900'>
          Shuffle
        </div>
        <div className='text-4xl font-semibold tabular-nums text-neutral-900'>
          {playersShuffled}
          <span className='text-neutral-400'> / {totalPlayers}</span>
        </div>
        <p className='text-sm text-neutral-500'>
          Everyone confirms the deck before cards are dealt.
        </p>
        {!didPlayerShuffle ? (
          <button
            type='button'
            className='mt-2 h-12 w-full rounded-full bg-neutral-950 text-sm font-semibold text-white'
            onClick={onShuffle}
          >
            Shuffle Cards
          </button>
        ) : (
          <div className='text-sm font-medium text-[#1D9BF0]'>
            ••• Waiting for others
          </div>
        )}
      </div>
    </Overlay>
  );
};
