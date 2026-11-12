'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { env } from '~/env';

import { REPO_URL } from '~/components/navbar';

/** One line and the testnet note. Hidden on the full-bleed table. */
export function SiteFooter() {
  const pathname = usePathname() ?? '';
  if (pathname.startsWith('/game/') || pathname.startsWith('/dev')) return null;
  const vault = env.NEXT_PUBLIC_VAULT_ID;
  const explorer = env.NEXT_PUBLIC_NEAR_NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  return (
    <footer className='border-t border-border bg-bg'>
      <div className='container-page flex flex-col gap-2 pb-24 pt-8 text-caption text-fg-subtle sm:flex-row sm:items-center sm:justify-between'>
        <p>
          <span className='font-display text-[16px] font-extrabold uppercase tracking-[0.06em] text-fg'>Dark Table</span>
          <span className='mx-2' aria-hidden>·</span>
          what happens in the back room is on the record.{' '}
          <Link className='link' href='/verify'>Check any hand</Link>
          <span className='mx-1.5' aria-hidden>·</span>
          <a className='link' href={REPO_URL} target='_blank' rel='noreferrer'>Source</a>
          {vault ? (
            <>
              <span className='mx-1.5' aria-hidden>·</span>
              <a className='link' href={`${explorer}/address/${vault}`} target='_blank' rel='noreferrer'>
                Vault contract
              </a>
            </>
          ) : null}
        </p>
        <p className='font-mono text-[12px] uppercase tracking-[0.08em]'>
          NEAR {env.NEXT_PUBLIC_NEAR_NETWORK} · play money only
        </p>
      </div>
    </footer>
  );
}
