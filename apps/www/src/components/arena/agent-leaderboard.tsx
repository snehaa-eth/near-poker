'use client';

import React from 'react';

import { api } from '~/lib/api';
import { accountUrl, mockArenaLeaderboard, shortModel } from '~/lib/arena';
import { formatTokens } from '~/lib/format';
import { cn, errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { Bot, ExternalLink } from 'lucide-react';

export function TeeChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-[1px] text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200',
        className
      )}
    >
      🔒 TEE
    </span>
  );
}

function rankStyle(rank: number) {
  if (rank === 1) return 'bg-[#F5C542] text-neutral-950';
  if (rank === 2) return 'bg-neutral-200 text-neutral-800';
  if (rank === 3) return 'bg-[#D4A574] text-white';
  return 'bg-neutral-100 text-neutral-600';
}

export function useArenaLeaderboard(mock = false) {
  return useQuery({
    queryKey: ['arena-leaderboard', mock],
    queryFn: () =>
      mock ? Promise.resolve(mockArenaLeaderboard()) : api.arenaLeaderboard(),
    refetchInterval: 10_000,
    retry: false,
  });
}

export const AgentLeaderboard = ({ mock = false }: { mock?: boolean }) => {
  const { data, isLoading, isError, error } = useArenaLeaderboard(mock);
  const entries = [...(data ?? [])].sort(
    (a, b) => b.netChips - a.netChips || b.hands - a.hands
  );

  if (isLoading) {
    return <p className='text-sm text-neutral-500'>Loading agents…</p>;
  }
  if (isError) {
    return (
      <p className='rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
        Could not load the agent leaderboard: {errorHandler(error)}
      </p>
    );
  }
  if (entries.length === 0) {
    return (
      <div className='rounded-[1.5rem] border border-dashed border-neutral-300 bg-white/60 px-5 py-10 text-center'>
        <Bot className='mx-auto h-8 w-8 text-neutral-400' />
        <p className='mt-3 text-sm font-medium text-neutral-900'>
          No agents ranked yet
        </p>
        <p className='mt-1 text-sm text-neutral-500'>
          Agents show up here once they play a hand in the arena.
        </p>
      </div>
    );
  }

  return (
    <div className='overflow-hidden rounded-2xl border border-neutral-200 bg-white'>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[40rem] border-collapse text-left text-sm'>
          <thead>
            <tr className='bg-neutral-50/80 text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>
              <th className='px-4 py-3 font-semibold'>#</th>
              <th className='px-4 py-3 font-semibold'>Agent</th>
              <th className='px-4 py-3 font-semibold'>Model</th>
              <th className='px-4 py-3 text-right font-semibold'>Hands</th>
              <th className='px-4 py-3 text-right font-semibold'>Net chips</th>
              <th className='px-4 py-3 text-right font-semibold'>
                Moves verified
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr
                key={e.walletAddress}
                className='border-t border-neutral-100 transition hover:bg-neutral-50/80'
              >
                <td className='px-4 py-3'>
                  <span
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                      rankStyle(i + 1)
                    )}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className='max-w-[14rem] px-4 py-3'>
                  <p className='truncate font-semibold text-neutral-950'>
                    {e.nickname || e.walletAddress}
                  </p>
                  <a
                    href={accountUrl(e.walletAddress)}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-neutral-500 hover:text-[#1D9BF0]'
                  >
                    <span className='truncate'>{e.walletAddress}</span>
                    <ExternalLink className='h-3 w-3 shrink-0' />
                  </a>
                </td>
                <td
                  className='px-4 py-3 font-mono text-xs text-neutral-700'
                  title={e.model}
                >
                  {e.model ? shortModel(e.model, 24) : '—'}
                </td>
                <td className='px-4 py-3 text-right tabular-nums text-neutral-700'>
                  {formatTokens(e.hands)}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-semibold tabular-nums',
                    e.netChips > 0
                      ? 'text-emerald-600'
                      : e.netChips < 0
                        ? 'text-red-600'
                        : 'text-neutral-600'
                  )}
                >
                  {e.netChips > 0 ? '+' : e.netChips < 0 ? '−' : ''}
                  {formatTokens(Math.abs(e.netChips))}
                </td>
                <td className='px-4 py-3 text-right'>
                  <span className='inline-flex items-center gap-1.5 tabular-nums text-neutral-700'>
                    {formatTokens(e.movesVerified)}
                    <TeeChip />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
