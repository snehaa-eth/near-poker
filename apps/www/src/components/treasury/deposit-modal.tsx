'use client';

import React, { useMemo, useState } from 'react';

import { ArrowDownToLine } from 'lucide-react';
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
import { useDeposit } from '~/lib/hooks';
import { playSound } from '~/lib/sounds';
import { CHIPS_PER_NIGHT } from '~/lib/treasury';
import { errorHandler } from '~/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DepositModal({ open, onOpenChange }: Props) {
  const {
    user,
    chips,
    isConnected,
    isConnecting,
    pending,
    preview,
    deposit,
  } = useDeposit();
  const [nightAmount, setNightAmount] = useState('100');

  const night = Number(nightAmount);
  const previewData = useMemo(() => preview(night), [preview, night]);

  const onDeposit = async () => {
    try {
      const result = await deposit(night);
      playSound('gems');
      toast.success(
        `Deposited ${night} NIGHT → +${result.chipsAdded} chips`
      );
      onOpenChange(false);
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
            <span className='flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700'>
              <ArrowDownToLine className='h-4 w-4' />
            </span>
            Deposit NIGHT
          </DialogTitle>
          <DialogDescription className='text-neutral-600'>
            Convert NIGHT into poker chips at{' '}
            <span className='font-medium text-neutral-900'>
              1 NIGHT → {CHIPS_PER_NIGHT}× chips
            </span>
            . Play with chips; NIGHT stays in the treasury.
          </DialogDescription>
        </DialogHeader>

        <div className='mt-2 space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='deposit-night'>Amount (NIGHT)</Label>
            <Input
              id='deposit-night'
              type='number'
              min={0}
              step='any'
              inputMode='decimal'
              className='rounded-full'
              value={nightAmount}
              onChange={(e) => setNightAmount(e.target.value)}
              placeholder='100'
            />
          </div>

          <div className='rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600'>
            <div className='flex items-center justify-between'>
              <span>You deposit</span>
              <NightAmount
                value={
                  previewData.chipsAdded > 0
                    ? String(previewData.nightAmount)
                    : '—'
                }
                size='sm'
                className='font-medium'
                raw
              />
            </div>
            <div className='mt-2 flex items-center justify-between'>
              <span>Chips credited</span>
              <ChipAmount
                value={
                  previewData.chipsAdded > 0 ? previewData.chipsAdded : '—'
                }
                size='sm'
                className='font-medium'
                raw={previewData.chipsAdded <= 0}
              />
            </div>
            {user ? (
              <div className='mt-2 flex items-center justify-between border-t border-neutral-200 pt-2'>
                <span>Your chips</span>
                <ChipAmount value={chips} size='sm' className='font-medium' />
              </div>
            ) : null}
          </div>

          <Button
            className='h-11 w-full rounded-full bg-neutral-950 text-white hover:bg-neutral-800'
            disabled={
              pending || isConnecting || previewData.chipsAdded <= 0
            }
            onClick={onDeposit}
          >
            {pending
              ? 'Depositing…'
              : isConnected
                ? 'Deposit'
                : 'Connect & deposit'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
