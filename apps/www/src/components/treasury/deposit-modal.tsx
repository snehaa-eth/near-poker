'use client';

import React, { useMemo, useState } from 'react';

import { ArrowDownToLine } from 'lucide-react';
import { toast } from 'sonner';

import { ChipAmount, NearAmount } from '~/components/currency-amount';
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
import { explorerTxUrl } from '~/lib/near/rpc';
import { CHIPS_PER_NEAR } from '~/lib/treasury';
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
    onChain,
  } = useDeposit();
  const [nearAmount, setNearAmount] = useState('1');

  const near = Number(nearAmount);
  const previewData = useMemo(() => preview(near), [preview, near]);

  const onDeposit = async () => {
    try {
      const result = await deposit(near);
      playSound('gems');
      toast.success(`Deposited ${near} NEAR → +${result.chipsAdded} chips`, {
        description: result.txHash ? 'View on NearBlocks' : undefined,
        action: result.txHash
          ? {
              label: 'Tx',
              onClick: () => window.open(explorerTxUrl(result.txHash!), '_blank'),
            }
          : undefined,
      });
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
            Deposit NEAR
          </DialogTitle>
          <DialogDescription className='text-neutral-600'>
            Convert NEAR into poker chips at{' '}
            <span className='font-medium text-neutral-900'>
              1 NEAR → {CHIPS_PER_NEAR} chips
            </span>
            .{' '}
            {onChain
              ? 'Your NEAR is held by the table-vault contract until you withdraw.'
              : 'Play with chips; NEAR stays in the treasury.'}
          </DialogDescription>
        </DialogHeader>

        <div className='mt-2 space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='deposit-near'>Amount (NEAR)</Label>
            <Input
              id='deposit-near'
              type='number'
              min={0}
              step='any'
              inputMode='decimal'
              className='rounded-full'
              value={nearAmount}
              onChange={(e) => setNearAmount(e.target.value)}
              placeholder='1'
            />
          </div>

          <div className='rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600'>
            <div className='flex items-center justify-between'>
              <span>You deposit</span>
              <NearAmount
                value={
                  previewData.chipsAdded > 0
                    ? String(previewData.nearAmount)
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
