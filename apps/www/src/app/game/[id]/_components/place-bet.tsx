'use client';

import React, { useState } from 'react';

import { useSocket } from '~/providers/socket-provider';
import { playSound } from '~/lib/sounds';
import { errorHandler } from '~/lib/utils';

import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';

import { BadgeDollarSign } from 'lucide-react';

interface PlaceBetProps {
  gameId: string;
  highestBet: number;
  isMyTurn: boolean;
}

export const PlaceBet = ({ gameId, highestBet, isMyTurn }: PlaceBetProps) => {
  const { socket } = useSocket();
  const [betAmount, setBetAmount] = useState<string>('');
  const [isPending, setIsPending] = useState(false);

  const onBet = () => {
    setIsPending(true);
    try {
      if (!socket) throw new Error('Not connected.');
      if (!isMyTurn) throw new Error('It is not your turn to bet.');
      if (betAmount === '') throw new Error('Please enter a valid bet amount.');
      if (Number(betAmount) < highestBet) {
        throw new Error('Your bet must be higher than the highest bet.');
      }
      socket.emit('game:bet', { gameId, amount: Number(betAmount) });
      playSound('bet');
      setBetAmount('');
    } catch (error) {
      toast.error(errorHandler(error));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className='absolute bottom-12 right-12'>
      <Popover>
        <PopoverTrigger className='flex flex-row items-center gap-2 rounded-full border-2 border-[#70AF8A] bg-[#204D39] px-4 py-2 text-lg text-[#89d6a9]'>
          <BadgeDollarSign className='text-lg text-[#89d6a9]' />
          Place Bet
        </PopoverTrigger>
        <PopoverContent className='mb-4 mr-12 flex translate-x-5 flex-row items-center rounded-3xl bg-[#204D39]'>
          <Input
            className='w-[12rem] rounded-l-2xl bg-[#558569] text-white'
            placeholder='Bet Amount'
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
          />
          <Button
            className='-translate-x-5 rounded-full bg-neutral-300 px-6'
            onClick={onBet}
          >
            {isPending ? 'Betting...' : 'Bet'}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
};
