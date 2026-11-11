'use client';

import React from 'react';

import { useSocket } from '~/providers/socket-provider';
import { playSound } from '~/lib/sounds';
import { errorHandler } from '~/lib/utils';

import { toast } from 'sonner';

interface DeclareResultProps {
  gameId: string;
}

export const DeclareResult = ({ gameId }: DeclareResultProps) => {
  const { socket } = useSocket();

  const onDeclare = () => {
    const id = toast.loading('Declaring…');
    try {
      if (!socket) throw new Error('Not connected.');
      socket.emit('game:declareWinner', { gameId });
      playSound('paajiWin');
      toast.success('Result declared', { id });
    } catch (error) {
      toast.error(errorHandler(error), { id });
    }
  };

  return (
    <div className='fixed bottom-6 left-6 z-40'>
      <button
        type='button'
        className='h-11 rounded-full border border-neutral-200 bg-white px-5 text-sm font-semibold text-neutral-900 shadow-sm'
        onClick={onDeclare}
      >
        Declare winner
      </button>
    </div>
  );
};
