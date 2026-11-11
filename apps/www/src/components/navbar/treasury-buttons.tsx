'use client';

import React, { useState } from 'react';

import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

import { DepositModal } from '~/components/treasury/deposit-modal';
import { WithdrawModal } from '~/components/treasury/withdraw-modal';
import { playSound } from '~/lib/sounds';
import { cn } from '~/lib/utils';

export function TreasuryButtons() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  return (
    <>
      <div className='flex items-center gap-1'>
        <button
          type='button'
          aria-label='Deposit NEAR'
          title='Deposit'
          onClick={() => {
            playSound('gems');
            setDepositOpen(true);
          }}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-950'
          )}
        >
          <ArrowDownToLine className='h-4 w-4' />
        </button>
        <button
          type='button'
          aria-label='Withdraw NEAR'
          title='Withdraw'
          onClick={() => {
            playSound('cashout');
            setWithdrawOpen(true);
          }}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-950'
          )}
        >
          <ArrowUpFromLine className='h-4 w-4' />
        </button>
      </div>

      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} />
      <WithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} />
    </>
  );
}
