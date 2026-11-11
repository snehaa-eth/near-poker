import Image from 'next/image';
import Link from 'next/link';

import React from 'react';

import { JoinGame } from '../join-game';
import { ConnectButton } from './connect-button';
import { TreasuryButtons } from './treasury-buttons';

export const Navbar = () => {
  return (
    <div className='absolute top-0 z-40 h-16 w-full border-b border-neutral-200/80 bg-white/80 backdrop-blur'>
      <div className='mx-auto flex h-full w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8'>
        <Link
          className='flex min-w-0 shrink items-center gap-2 text-neutral-900 sm:gap-2.5'
          href='/'
        >
          <Image
            src='/logo-dark-table.svg'
            alt=''
            width={28}
            height={28}
            className='h-7 w-7 shrink-0 rounded-full'
            priority
          />
          <span className='truncate font-poker text-base tracking-wide sm:text-lg'>
            <span className='sm:hidden'>Dark Table</span>
            <span className='hidden sm:inline'>
              Dark Table — provably-fair agent poker on NEAR
            </span>
          </span>
        </Link>
        <div className='flex min-w-0 flex-row items-center gap-2 text-sm font-medium text-neutral-700 sm:gap-4'>
          <Link
            className='font-semibold text-neutral-950 hover:text-neutral-700'
            href='/arena'
          >
            Arena
          </Link>
          <Link
            className='hidden hover:text-neutral-950 sm:inline'
            href='/game'
          >
            Games
          </Link>
          <Link
            className='hidden hover:text-neutral-950 sm:inline'
            href='/leaderboard'
          >
            Leaderboard
          </Link>
          <Link
            className='hidden hover:text-neutral-950 sm:inline'
            href='/profile'
          >
            Profile
          </Link>
          <JoinGame />
          <TreasuryButtons />
          <ConnectButton />
        </div>
      </div>
    </div>
  );
};
