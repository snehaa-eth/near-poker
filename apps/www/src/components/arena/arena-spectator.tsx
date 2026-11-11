'use client';

import Link from 'next/link';

import React from 'react';

import type { PublicGameView } from '~/lib/api';
import { formatTokens } from '~/lib/format';
import { cn } from '~/lib/utils';

import { HowToWatch } from '~/app/game/[id]/_components/table-guide';
import { SleekTable } from '~/app/game/[id]/_components/sleek-table';

import { ArenaMoveFeed } from './arena-move-feed';
import { ArenaSidebar } from './arena-sidebar';

import { ArrowLeft, ShieldCheck } from 'lucide-react';

function HudChip({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'live' | 'pot' | 'street';
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-md px-2 text-[11px] font-bold uppercase tracking-wide',
        tone === 'live' && 'bg-emerald-600 text-white',
        tone === 'pot' && 'bg-neutral-950 text-white',
        tone === 'street' && 'bg-amber-100 text-amber-900',
        tone === 'default' && 'bg-neutral-100 text-neutral-700'
      )}
    >
      {children}
    </span>
  );
}

/** Arena watch layout: table + move feed + standings / recent hands. */
export function ArenaSpectator({
  gameId,
  view,
  mock = false,
}: {
  gameId: string;
  view: PublicGameView;
  mock?: boolean;
}) {
  const handId = view.fairness?.handId ?? null;
  const street =
    view.gameEnded || view.round === 'End'
      ? view.communityCards.filter((c) => c >= 0).length >= 5
        ? 'Showdown'
        : 'Hand over'
      : view.roundLabel || view.street || view.round || '—';

  return (
    <div className='min-h-[100dvh] bg-[#F4F5F7] pt-16'>
      <div className='mx-auto grid max-w-[90rem] gap-4 px-3 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]'>
        <div className='flex min-w-0 flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Link
              href={mock ? '/arena?mock=1' : '/arena'}
              className='inline-flex h-7 items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50'
            >
              <ArrowLeft className='h-3.5 w-3.5' />
              Arena
            </Link>
            <HudChip tone='live'>
              {view.status === 'playing' && !view.gameEnded ? 'Live' : 'Watch'}
            </HudChip>
            <HudChip>Table {view.name || gameId.slice(0, 8)}</HudChip>
            <HudChip tone='street'>{street}</HudChip>
            <HudChip tone='pot'>Pot {formatTokens(view.pot)}</HudChip>
            {handId ? (
              <span className='font-mono text-[11px] leading-7 text-neutral-500'>
                hand {handId.slice(0, 10)}
              </span>
            ) : null}
            <div className='ml-auto flex items-center gap-2'>
              <span className='inline-flex h-7 items-center gap-1 text-[11px] font-medium text-emerald-700'>
                <ShieldCheck className='h-3.5 w-3.5' />
                TEE moves only
              </span>
              <HowToWatch />
            </div>
          </div>

          <div className='overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-950 shadow-[0_12px_40px_rgba(0,0,0,0.12)]'>
            <SleekTable
              gameId={gameId}
              view={view}
              embedded
              showPositions
            />
          </div>

          <ArenaMoveFeed
            handId={handId}
            mock={mock}
            nextPlayerNickname={view.nextPlayerNickname}
            defaultOpen
          />
        </div>

        <ArenaSidebar
          gameId={gameId}
          currentHandId={handId}
          mock={mock}
        />
      </div>
    </div>
  );
}
