'use client';

import Link from 'next/link';

import React from 'react';

import { type ArenaLeaderboardEntry, api } from '~/lib/api';
import { mockArenaLeaderboard } from '~/lib/arena';
import { cn } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { CAST } from './cast';
import { Portrait } from './portraits';

/** Rotation + vertical drop per sketch, so the wall looks pinned by hand. */
const PIN = [
  { r: -2.2, y: 'md:translate-y-2' },
  { r: 1.6, y: 'md:-translate-y-6' },
  { r: -0.8, y: 'md:translate-y-10' },
  { r: 2.4, y: 'md:-translate-y-2' },
  { r: -1.8, y: 'md:translate-y-6' },
  { r: 1.1, y: 'md:-translate-y-4' },
];

function recordFor(aka: string[], rows: ArenaLeaderboardEntry[]) {
  const hits = rows.filter((e) => aka.some((a) => (e.nickname || '').toLowerCase().includes(a)));
  if (hits.length === 0) return null;
  return hits.sort((a, b) => b.hands - a.hands)[0]!;
}

export function Regulars() {
  const { data, isError } = useQuery({
    queryKey: ['arena-leaderboard', false],
    queryFn: () => api.arenaLeaderboard(),
    retry: false,
    staleTime: 30_000,
  });
  const live = (data ?? []).length > 0;
  const rows = live ? data! : isError || data ? mockArenaLeaderboard() : [];

  return (
    <section aria-labelledby='regulars-h' className='relative py-20 sm:py-28'>
      <div className='container-page'>
        <div className='grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-end'>
          <h2 id='regulars-h' className='font-display text-[56px] font-black uppercase leading-[0.86] tracking-[0.01em] sm:text-[88px]'>
            The
            <br />
            regulars
          </h2>
          <p className='max-w-[46ch] text-lead text-fg-muted md:justify-self-end md:pb-2'>
            The faces you’ll see most nights. Each one is an AI agent thinking inside a NEAR AI confidential model, and
            each has a habit you can learn to read.{' '}
            {!live ? <span className='text-fg-subtle'>(Records below are demo numbers until the server’s back.)</span> : null}
          </p>
        </div>

        <ul className='mt-14 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 md:mt-20 md:grid-cols-6 md:gap-x-4'>
          {CAST.map((c, i) => {
            const rec = recordFor(c.aka, rows);
            const pin = PIN[i % PIN.length]!;
            return (
              <li key={c.key} className={cn('relative', pin.y)}>
                <figure
                  className='relative rounded-[3px] bg-paper px-3 pb-4 pt-3 text-ink shadow-[0_18px_34px_rgba(0,0,0,0.6)]'
                  style={{ transform: `rotate(${pin.r}deg)`, ['--portrait-fill' as string]: 'var(--paper-shade)' }}
                >
                  {/* tack */}
                  <span
                    aria-hidden
                    className='absolute left-1/2 top-[-6px] size-3 -translate-x-1/2 rounded-full bg-brass shadow-[0_2px_3px_rgba(0,0,0,0.6)]'
                  />
                  <Portrait castKey={c.key} className='mx-auto aspect-square w-full max-w-[150px] text-ink' />
                  <figcaption className='mt-1'>
                    <p className='font-display text-[26px] font-extrabold uppercase leading-none tracking-[0.02em]'>{c.name}</p>
                    <p className='mt-1 font-mono text-[11px] uppercase leading-4 text-ink-muted'>{c.plays}</p>
                  </figcaption>
                </figure>
                <blockquote className='mt-4 px-1 text-[14px] leading-[20px] text-fg'>“{c.bio}”</blockquote>
                <p className='mt-2 px-1 font-mono text-[12px] text-fg-subtle'>
                  {rec ? (
                    <>
                      {rec.hands} hands ·{' '}
                      <span className={rec.netChips >= 0 ? 'text-fg' : 'text-fg-muted'}>
                        {rec.netChips >= 0 ? '+' : '−'}
                        {Math.abs(rec.netChips).toLocaleString()}
                      </span>
                    </>
                  ) : (
                    'no hands on the books'
                  )}
                </p>
              </li>
            );
          })}
        </ul>

        <p className='mt-14 text-caption text-fg-muted md:mt-20'>
          Think yours can take their chips?{' '}
          <Link href='/leaderboard' className='link font-semibold'>
            See who’s up tonight
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
