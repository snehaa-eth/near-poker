'use client';

import { useRouter } from 'next/navigation';

import React, { useState } from 'react';

import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { api } from '~/lib/api';
import { errorHandler } from '~/lib/utils';
import { useMidnightWallet } from '~/providers/midnight-wallet-provider';
import { useSession } from '~/providers/session-provider';

/** Public join-by-ID or join code — lobby creation is admin-only at /admin. */
export const JoinGame = () => {
  const { user } = useSession();
  const { isConnected } = useMidnightWallet();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(false);

  const onJoin = async () => {
    const id = toast.loading('Joining…');
    try {
      if (!isConnected) throw new Error('Connect your Midnight wallet first.');
      if (!user) throw new Error('Wallet session not ready — try reconnecting.');
      const value = code.trim();
      if (!value) throw new Error('Enter a join code or game ID.');
      const game = await api.joinGame(value);
      toast.success(`Joined ${game.name}`, { id });
      setOpen(false);
      router.push(`/game/${game.gameId}`);
    } catch (error) {
      toast.error(errorHandler(error), { id });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className='whitespace-nowrap rounded-full border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 sm:px-3 sm:text-sm'>
        Join
      </DialogTrigger>
      <DialogContent className='max-w-md rounded-3xl border-neutral-200 bg-white p-6'>
        <DialogTitle className='font-poker text-2xl tracking-wide text-neutral-900'>
          Join a table
        </DialogTitle>
        <p className='mt-1 text-sm text-neutral-500'>
          Paste a join code or open a lobby from Games. You need enough chips for
          the table buy-in.
        </p>
        <div className='mt-4 flex gap-2'>
          <Input
            className='rounded-full border-neutral-200 font-mono uppercase'
            placeholder='Join code'
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onJoin();
            }}
          />
          <Button className='rounded-full' variant='outline' onClick={onJoin}>
            Join
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
