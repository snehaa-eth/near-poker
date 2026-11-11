'use client';

import Link from 'next/link';

import React from 'react';

import { api } from '~/lib/api';
import { formatTokens } from '~/lib/format';
import { cn } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { useArenaLeaderboard } from './agent-leaderboard';

import { Eye, Play, Trophy } from 'lucide-react';

function StandingsPanel({ mock }: { mock: boolean }) {
  const { data, isLoading } = useArenaLeaderboard(mock);
  const top = [...(data ?? [])]
    .sort((a, b) => b.netChips - a.netChips || b.hands - a.hands)
    .slice(0, 5);

  return (
    <section className='overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm'>
      <div className='flex items-center justify-between border-b border-neutral-100 px-4 py-3'>
        <div>
          <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400'>
            The Standings
          </p>
          <p className='text-sm font-semibold text-neutral-950'>
            Arena · net chips
          </p>
        </div>
        <Trophy className='h-4 w-4 text-amber-500' />
      </div>
      <ol className='divide-y divide-neutral-100'>
        {isLoading ? (
          <li className='px-4 py-6 text-sm text-neutral-500'>Loading…</li>
        ) : top.length === 0 ? (
          <li className='px-4 py-6 text-sm text-neutral-500'>
            No ranked agents yet.
          </li>
        ) : (
          top.map((e, i) => (
            <li
              key={e.walletAddress}
              className='flex items-center gap-3 px-4 py-2.5'
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                  i === 0
                    ? 'bg-[#F5C542] text-neutral-950'
                    : i === 1
                      ? 'bg-neutral-200 text-neutral-800'
                      : i === 2
                        ? 'bg-[#D4A574] text-white'
                        : 'bg-neutral-100 text-neutral-600'
                )}
              >
                {i + 1}
              </span>
              <span className='min-w-0 flex-1 truncate text-sm font-medium text-neutral-900'>
                {e.nickname || e.walletAddress}
              </span>
              <span
                className={cn(
                  'tabular-nums text-sm font-semibold',
                  e.netChips > 0
                    ? 'text-emerald-600'
                    : e.netChips < 0
                      ? 'text-red-600'
                      : 'text-neutral-500'
                )}
              >
                {e.netChips > 0 ? '+' : e.netChips < 0 ? '−' : ''}
                {formatTokens(Math.abs(e.netChips))}
              </span>
            </li>
          ))
        )}
      </ol>
      <Link
        href={mock ? '/arena?mock=1' : '/arena'}
        className='block border-t border-neutral-100 px-4 py-2.5 text-center text-xs font-semibold text-neutral-700 hover:bg-neutral-50 hover:text-[#1D9BF0]'
      >
        Full leaderboard
      </Link>
    </section>
  );
}

function RecentHandsPanel({
  gameId,
  currentHandId,
  mock,
}: {
  gameId: string;
  currentHandId?: string | null;
  mock: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['game-hands', gameId, mock],
    queryFn: async () => {
      if (mock) {
        return {
          hands: [
            {
              handId: currentHandId || 'demo',
              seedHash: 'a'.repeat(64),
              revealed: false,
              complete: false,
            },
            {
              handId: 'demo-prev-1',
              seedHash: 'b'.repeat(64),
              revealed: true,
              complete: true,
            },
            {
              handId: 'demo-prev-2',
              seedHash: 'c'.repeat(64),
              revealed: true,
              complete: true,
            },
          ],
        };
      }
      return api.gameHands(gameId, 12);
    },
    refetchInterval: mock ? false : 5_000,
    retry: false,
  });

  const hands = data?.hands ?? [];

  return (
    <section className='overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm'>
      <div className='border-b border-neutral-100 px-4 py-3'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400'>
          Recent Hands
        </p>
        <p className='text-sm font-semibold text-neutral-950'>This table</p>
      </div>
      <ul className='divide-y divide-neutral-100'>
        {isLoading ? (
          <li className='px-4 py-6 text-sm text-neutral-500'>Loading…</li>
        ) : hands.length === 0 ? (
          <li className='px-4 py-6 text-sm text-neutral-500'>
            No hands recorded yet — sit tight while agents play.
          </li>
        ) : (
          hands.map((h) => {
            const watching = Boolean(
              currentHandId && h.handId === currentHandId
            );
            return (
              <li
                key={h.handId}
                className={cn(
                  'flex items-center gap-3 px-4 py-3',
                  watching && 'bg-emerald-50/70'
                )}
              >
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-mono text-sm font-semibold text-neutral-950'>
                    Hand {h.handId.slice(0, 8)}
                  </p>
                  <p className='text-[11px] text-neutral-500'>
                    {h.complete
                      ? 'Settled · verifiable'
                      : h.revealed
                        ? 'Revealed'
                        : 'In progress'}
                  </p>
                </div>
                {watching ? (
                  <span className='inline-flex h-7 min-w-[5.5rem] items-center justify-center gap-1 rounded-full bg-emerald-600 px-2.5 text-[11px] font-semibold text-white'>
                    <Eye className='h-3 w-3' />
                    Watching
                  </span>
                ) : (
                  <Link
                    href={`/verify/${encodeURIComponent(h.handId)}`}
                    className='inline-flex h-7 min-w-[5.5rem] items-center justify-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 text-[11px] font-semibold text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50'
                  >
                    <Play className='h-3 w-3' />
                    Verify
                  </Link>
                )}
              </li>
            );
          })
        )}
      </ul>
      <Link
        href={mock ? '/arena?mock=1' : '/arena'}
        className='block border-t border-neutral-100 px-4 py-2.5 text-center text-xs font-semibold text-neutral-700 hover:bg-neutral-50 hover:text-[#1D9BF0]'
      >
        Browse arena tables
      </Link>
    </section>
  );
}

export function ArenaSidebar({
  gameId,
  currentHandId,
  mock = false,
}: {
  gameId: string;
  currentHandId?: string | null;
  mock?: boolean;
}) {
  return (
    <aside className='flex w-full flex-col gap-4'>
      <StandingsPanel mock={mock} />
      <RecentHandsPanel
        gameId={gameId}
        currentHandId={currentHandId}
        mock={mock}
      />
    </aside>
  );
}
