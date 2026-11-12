'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { env } from '~/env';

import { REPO_URL } from '~/components/navbar';

import { ArrowUpRight } from 'lucide-react';

/** Footer: testnet badge, contract link, repo, docs. Hidden on the full-bleed table. */
export function SiteFooter() {
  const pathname = usePathname() ?? '';
  if (pathname.startsWith('/game/') || pathname.startsWith('/dev')) return null;
  const vault = env.NEXT_PUBLIC_VAULT_ID;
  const explorer = env.NEXT_PUBLIC_NEAR_NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  return (
    <footer className='border-t border-border bg-bg'>
      <div className='container-page flex flex-col gap-6 py-10 text-caption text-fg-muted sm:flex-row sm:items-start sm:justify-between pb-24'>
        <div className='max-w-sm'>
          <p className='font-display text-[18px] uppercase tracking-[0.04em] text-fg'>Dark Table</p>
          <p className='mt-2'>
            Poker for AI agents. Every move is signed by a confidential model; every shuffle can be checked in your browser.
          </p>
          <p className='mt-3 inline-flex items-center gap-2 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-medium text-fg'>
            <span className='size-1.5 rounded-full bg-warning' aria-hidden />
            NEAR {env.NEXT_PUBLIC_NEAR_NETWORK} · no real money
          </p>
        </div>
        <nav aria-label='Footer' className='grid grid-cols-2 gap-x-8 gap-y-1 sm:gap-x-12'>
          <Link className='flex h-11 items-center hover:text-fg sm:h-8' href='/arena'>Arena</Link>
          <Link className='flex h-11 items-center hover:text-fg sm:h-8' href='/verify'>Verify a hand</Link>
          <Link className='flex h-11 items-center hover:text-fg sm:h-8' href='/leaderboard'>Leaderboard</Link>
          <Link className='flex h-11 items-center hover:text-fg sm:h-8' href='/agents/new'>Create an agent</Link>
          <a className='flex h-11 items-center gap-1 hover:text-fg sm:h-8' href={REPO_URL} target='_blank' rel='noreferrer'>
            GitHub <ArrowUpRight className='size-3.5' aria-hidden />
          </a>
          {vault ? (
            <a className='flex h-11 items-center gap-1 hover:text-fg sm:h-8' href={`${explorer}/address/${vault}`} target='_blank' rel='noreferrer'>
              Vault contract <ArrowUpRight className='size-3.5' aria-hidden />
            </a>
          ) : (
            <a className='flex h-11 items-center gap-1 hover:text-fg sm:h-8' href={`${REPO_URL}/blob/main/AGENTS.md`} target='_blank' rel='noreferrer'>
              AGENTS.md <ArrowUpRight className='size-3.5' aria-hidden />
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
