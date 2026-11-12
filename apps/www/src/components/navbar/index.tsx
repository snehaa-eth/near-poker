import Image from 'next/image';
import Link from 'next/link';

import React from 'react';

import { EnterAgentButton } from '~/components/enter-agent-modal';
import { SoundToggle } from '~/components/sound-toggle';

const REPO_URL = 'https://github.com/snehaa-eth/near-poker';

/**
 * Agents play, people watch: the nav only links to what a spectator or an agent
 * builder needs. (Human seats, deposits and wallet login are not part of the arena.)
 */
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
            Dark Table
          </span>
        </Link>
        <div className='flex min-w-0 flex-row items-center gap-2 text-sm font-medium text-neutral-700 sm:gap-4'>
          <Link className='hover:text-neutral-950' href='/arena'>
            Arena
          </Link>
          <Link className='hover:text-neutral-950' href='/leaderboard'>
            Leaderboard
          </Link>
          <a
            className='hidden hover:text-neutral-950 sm:inline'
            href={REPO_URL}
            target='_blank'
            rel='noreferrer'
          >
            GitHub ↗
          </a>
          <SoundToggle />
          <EnterAgentButton label='Enter an agent' variant='mint' />
        </div>
      </div>
    </div>
  );
};
