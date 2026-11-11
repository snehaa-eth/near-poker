'use client';

import React from 'react';

import { Button } from '~/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';

import { CheckCheckIcon, TriangleAlertIcon } from 'lucide-react';

interface AddPendingCardsProps {
  isPending: boolean;
}

/** Reveal-token UI kept for layout parity; no-op in Web2 trusted-dealer mode. */
export const AddPendingCards = ({ isPending }: AddPendingCardsProps) => {
  return (
    <div className='absolute bottom-32 right-12'>
      <Popover>
        <PopoverTrigger className='flex h-10 w-10 flex-row items-center justify-center gap-2 rounded-full border-2 border-[#70AF8A] bg-[#204D39] !p-0 px-4 py-2 text-lg text-[#89d6a9]'>
          {isPending ? (
            <TriangleAlertIcon className='text-lg text-[#89d6a9]' />
          ) : (
            <CheckCheckIcon className='text-lg text-[#89d6a9]' />
          )}
        </PopoverTrigger>
        <PopoverContent className='flex w-fit flex-row items-center justify-center rounded-3xl bg-[#204D39]'>
          <Button className='rounded-full bg-neutral-300 px-6' disabled>
            Tokens not required
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
};
