'use client';

import Link from 'next/link';

import React, { useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { api, type LobbyGame } from '~/lib/api';
import { cn } from '~/lib/utils';

import { ChipAmount } from './currency-amount';
import { Button } from './ui/button';

type Filter = 'active' | 'waiting' | 'playing' | 'ended' | 'all';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'waiting', label: 'Lobby' },
  { id: 'playing', label: 'In play' },
  { id: 'ended', label: 'Ended' },
  { id: 'all', label: 'All' },
];

const STATUS_STYLE: Record<string, string> = {
  waiting: 'bg-amber-50 text-amber-700 border-amber-200',
  shuffling: 'bg-sky-50 text-sky-700 border-sky-200',
  playing: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ended: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        STATUS_STYLE[status] ??
          'border-neutral-200 bg-neutral-100 text-neutral-600'
      )}
    >
      {status}
    </span>
  );
}

function LobbyRow({ game }: { game: LobbyGame }) {
  return (
    <tr className='border-t border-neutral-100 transition hover:bg-neutral-50/80'>
      <td className='px-4 py-3.5'>
        <p className='font-semibold text-neutral-950'>{game.name || 'Table'}</p>
        <p className='mt-0.5 font-mono text-[11px] text-neutral-400 sm:hidden'>
          {game.joinCode || '—'}
        </p>
      </td>
      <td className='hidden px-4 py-3.5 font-mono text-sm text-neutral-700 sm:table-cell'>
        {game.joinCode || '—'}
      </td>
      <td className='px-4 py-3.5'>
        <StatusBadge status={game.status} />
      </td>
      <td className='hidden px-4 py-3.5 text-sm tabular-nums text-neutral-700 md:table-cell'>
        {game.totalPlayers}/{game.maxPlayers ?? '—'}
      </td>
      <td className='px-4 py-3.5'>
        <ChipAmount
          value={game.minChips ?? 0}
          size='sm'
          className='text-sm'
          iconClassName='h-4 w-4'
        />
      </td>
      <td className='hidden max-w-[12rem] px-4 py-3.5 lg:table-cell'>
        <div className='flex flex-wrap gap-1'>
          {(game.players ?? []).length > 0 ? (
            (game.players ?? []).slice(0, 4).map((p) => (
              <span
                key={p.id}
                className='rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600'
              >
                {p.nickname}
              </span>
            ))
          ) : (
            <span className='text-xs text-neutral-400'>Empty</span>
          )}
          {(game.players?.length ?? 0) > 4 ? (
            <span className='text-[11px] text-neutral-400'>
              +{(game.players?.length ?? 0) - 4}
            </span>
          ) : null}
        </div>
      </td>
      <td className='px-4 py-3.5 text-right'>
        <Button
          asChild
          size='sm'
          className='h-9 rounded-full bg-neutral-950 px-4 text-white'
        >
          <Link href={`/game/${game.gameId}`}>
            {game.status === 'waiting' ? 'Join' : 'Open'}
          </Link>
        </Button>
      </td>
    </tr>
  );
}

export const GamesList = () => {
  const [filter, setFilter] = useState<Filter>('active');

  const { data, isLoading } = useQuery({
    queryKey: ['games', filter],
    queryFn: async () => {
      if (filter === 'all' || filter === 'ended') {
        const res = await api.listGames({
          includeEnded: true,
          status: filter === 'ended' ? 'ended' : undefined,
        });
        return res.games;
      }
      if (filter === 'active') {
        const res = await api.listGames();
        return res.games;
      }
      if (filter === 'playing') {
        const res = await api.listGames({
          status: 'playing,shuffling',
        });
        return res.games;
      }
      const res = await api.listGames({ status: 'waiting' });
      return res.games;
    },
    refetchInterval: 3000,
  });

  const games = data ?? [];

  return (
    <div className='min-h-screen w-full bg-[#F7F7F8]'>
      <div className='mx-auto w-full max-w-6xl px-4 pb-16 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <h1 className='font-poker text-3xl tracking-wide text-neutral-900 sm:text-4xl'>
              Tables
            </h1>
            <p className='mt-1 text-sm text-neutral-500'>
              Lobbies and live status from MongoDB
            </p>
            <a
              href='/dev/table'
              className='mt-2 inline-block text-xs font-medium text-[#1D9BF0] hover:underline'
            >
              Play dummy table →
            </a>
          </div>
        </div>

        <div className='mt-6 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-8 sm:flex-wrap sm:overflow-visible sm:px-0'>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type='button'
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition',
                filter === f.id
                  ? 'border-neutral-900 bg-neutral-950 text-white'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              )}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className='mt-6 sm:mt-8'>
          {isLoading ? (
            <div className='text-sm text-neutral-400'>Loading lobbies…</div>
          ) : games.length > 0 ? (
            <div className='overflow-hidden rounded-2xl border border-neutral-200 bg-white'>
              <div className='overflow-x-auto'>
                <table className='w-full min-w-[36rem] border-collapse text-left text-sm'>
                  <thead>
                    <tr className='bg-neutral-50/80 text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>
                      <th className='px-4 py-3 font-semibold'>Lobby</th>
                      <th className='hidden px-4 py-3 font-semibold sm:table-cell'>
                        Code
                      </th>
                      <th className='px-4 py-3 font-semibold'>Status</th>
                      <th className='hidden px-4 py-3 font-semibold md:table-cell'>
                        Seats
                      </th>
                      <th className='px-4 py-3 font-semibold'>Min chips</th>
                      <th className='hidden px-4 py-3 font-semibold lg:table-cell'>
                        Players
                      </th>
                      <th className='px-4 py-3 text-right font-semibold'>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((game) => (
                      <LobbyRow key={game.gameId} game={game} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className='rounded-3xl border border-dashed border-neutral-200 bg-white px-6 py-10 text-center text-sm text-neutral-500 sm:p-10 sm:text-base'>
              No tables in this filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
