'use client';

import React, { useMemo, useState } from 'react';

import { ArrowUpFromLine } from 'lucide-react';
import { toast } from 'sonner';

import { ChipAmount, NightAmount } from '~/components/currency-amount';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { useWithdraw } from '~/lib/hooks';
import { playSound } from '~/lib/sounds';
import { CHIPS_PER_NIGHT } from '~/lib/treasury';
import { errorHandler } from '~/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function WithdrawModal({ open, onOpenChange }: Props) {
  const {
    chips,
    isConnected,
    isConnecting,
    pending,
    preview,
    withdraw,
  } = useWithdraw();
  const [chipAmount, setChipAmount] = useState('');

  const chipsOut = Math.floor(Number(chipAmount) || 0);
  const quote = useMemo(() => preview(chipsOut), [preview, chipsOut]);

  const onWithdraw = async () => {
    try {
      const result = await withdraw(chipsOut);
      playSound('paajiCashOut');
      toast.success(
        `Cashed out ${result.chipsDebited} chips → ${result.netNight} NIGHT`
      );
      onOpenChange(false);
      setChipAmount('');
    } catch (error) {
      playSound('paajiLose');
      toast.error(errorHandler(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md rounded-3xl border-neutral-200 bg-white p-6'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 font-poker text-2xl tracking-wide text-neutral-950'>
            <span className='flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-700'>
              <ArrowUpFromLine className='h-4 w-4' />
            </span>
            Withdraw
          </DialogTitle>
          <DialogDescription className='text-neutral-600'>
            Cash out poker chips. You get NIGHT at{' '}
            <span className='font-medium text-neutral-900'>
              {CHIPS_PER_NIGHT} chips = 1 NIGHT
            </span>
            , minus a{' '}
            <span className='font-medium text-neutral-900'>5% fee</span>.
          </DialogDescription>
        </DialogHeader>

        <div className='mt-2 space-y-4'>
          <div className='flex items-center justify-between gap-3 text-sm text-neutral-500'>
            <span>Your chips</span>
            <button
              type='button'
              className='font-medium text-neutral-900 underline-offset-2 hover:underline'
              onClick={() => setChipAmount(String(chips || ''))}
            >
              <ChipAmount value={chips} size='sm' />
            </button>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='withdraw-chips'>Chips to cash out</Label>
            <Input
              id='withdraw-chips'
              type='number'
              min={0}
              step={1}
              inputMode='numeric'
              className='rounded-full'
              value={chipAmount}
              onChange={(e) => setChipAmount(e.target.value)}
              placeholder='150'
            />
          </div>

          <div className='rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600'>
            <div className='flex items-center justify-between'>
              <span>Chips leave</span>
              <ChipAmount
                value={quote ? quote.chipsOut : '—'}
                size='sm'
                className='font-medium text-amber-800'
                raw={!quote}
              />
            </div>
            <div className='mt-2 flex items-center justify-between'>
              <span>Gross NIGHT</span>
              <NightAmount
                value={quote ? String(quote.grossNight) : '—'}
                size='sm'
                raw
              />
            </div>
            <div className='mt-2 flex items-center justify-between'>
              <span>Fee (5%)</span>
              <NightAmount
                value={quote ? String(quote.feeNight) : '—'}
                size='sm'
                raw
              />
            </div>
            <div className='mt-3 flex items-center justify-between border-t border-neutral-200 pt-3'>
              <span className='font-medium text-neutral-900'>You receive</span>
              <NightAmount
                value={quote ? String(quote.netNight) : '—'}
                size='md'
                className='text-emerald-700'
                raw
              />
            </div>
          </div>

          <Button
            className='h-11 w-full rounded-full bg-neutral-950 text-white hover:bg-neutral-800'
            disabled={
              pending ||
              isConnecting ||
              !quote ||
              !quote.canAfford ||
              quote.chipsOut <= 0
            }
            onClick={onWithdraw}
          >
            {pending
              ? 'Withdrawing…'
              : isConnected
                ? 'Cash out chips'
                : 'Connect & withdraw'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
