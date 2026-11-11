'use client';

import React from 'react';

import { Trophy } from 'lucide-react';

import { type LeaderboardEntry } from '~/lib/api';
import { formatTokens } from '~/lib/format';
import { useLeaderboard } from '~/lib/hooks';
import { cn } from '~/lib/utils';
import { useSession } from '~/providers/session-provider';

function rankStyle(rank: number) {
  if (rank === 1) return 'bg-[#F5C542] text-neutral-950';
  if (rank === 2) return 'bg-neutral-200 text-neutral-800';
  if (rank === 3) return 'bg-[#D4A574] text-white';
  return 'bg-neutral-100 text-neutral-600';
}

function Row({
  entry,
  highlight,
}: {
  entry: LeaderboardEntry;
  highlight: boolean;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-2xl border px-4 py-3 sm:grid-cols-[3rem_minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] sm:gap-4',
        highlight
          ? 'border-neutral-900 bg-neutral-950 text-white'
          : 'border-neutral-200 bg-white text-neutral-950'
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
          highlight ? 'bg-white/15 text-white' : rankStyle(entry.rank)
        )}
      >
        {entry.rank}
      </div>
      <div className='min-w-0'>
        <p className='truncate text-sm font-semibold sm:text-base'>
          {entry.nickname}
        </p>
        <p
          className={cn(
            'truncate text-xs sm:hidden',
            highlight ? 'text-neutral-400' : 'text-neutral-500'
          )}
        >
          {entry.wins} wins · {formatTokens(entry.chips)} chips
        </p>
      </div>
      <div
        className={cn(
          'hidden text-sm sm:block',
          highlight ? 'text-neutral-300' : 'text-neutral-600'
        )}
      >
        <span className='font-medium text-inherit'>{entry.wins}</span>
        <span className='ml-1 text-xs opacity-70'>wins</span>
      </div>
      <div
        className={cn(
          'hidden text-sm sm:block',
          highlight ? 'text-neutral-300' : 'text-neutral-600'
        )}
      >
        <span className='font-medium text-inherit'>
          {formatTokens(entry.potsWon)}
        </span>
        <span className='ml-1 text-xs opacity-70'>pots</span>
      </div>
      <div className='text-right text-sm font-medium sm:text-left'>
        {formatTokens(entry.chips)}
        <span
          className={cn(
            'ml-1 hidden text-xs font-normal sm:inline',
            highlight ? 'text-neutral-400' : 'text-neutral-500'
          )}
        >
          chips
        </span>
      </div>
    </div>
  );
}

export const LeaderboardPage = () => {
  const { user } = useSession();
  const { data, isLoading, isError, error, refetch, isFetching } =
    useLeaderboard(50);

  const entries = data ?? [];

  return (
    <div className='mx-auto max-w-6xl px-4 pb-20 pt-24 sm:px-6 lg:px-8'>
      <p className='text-sm font-medium uppercase tracking-[0.18em] text-neutral-400'>
        Standings
      </p>
      <div className='mt-2 flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='font-poker text-4xl tracking-wide text-neutral-950 sm:text-5xl'>
            Leaderboard
          </h1>
          <p className='mt-2 max-w-xl text-neutral-600'>
            Ranked by table wins, then pots collected, then chip stack.
          </p>
        </div>
        <button
          type='button'
          onClick={() => void refetch()}
          className='rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50'
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <section className='mt-8 space-y-3'>
        {isLoading && (
          <p className='text-sm text-neutral-500'>Loading standings…</p>
        )}
        {isError && (
          <p className='text-sm text-red-600'>
            {error instanceof Error ? error.message : 'Failed to load'}
          </p>
        )}
        {!isLoading && !isError && entries.length === 0 && (
          <div className='rounded-[1.5rem] border border-dashed border-neutral-300 bg-white/60 px-5 py-10 text-center'>
            <Trophy className='mx-auto h-8 w-8 text-neutral-400' />
            <p className='mt-3 text-sm font-medium text-neutral-900'>
              No results yet
            </p>
            <p className='mt-1 text-sm text-neutral-500'>
              Finish a few hands and winners will show up here.
            </p>
          </div>
        )}
        {entries.map((entry) => (
          <Row
            key={entry.sessionId}
            entry={entry}
            highlight={Boolean(user && user.sessionId === entry.sessionId)}
          />
        ))}
      </section>
    </div>
  );
};
