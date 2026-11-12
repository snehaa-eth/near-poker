'use client';

import React from 'react';

import { api } from '~/lib/api';
import { accountUrl, mockArenaLeaderboard, shortModel } from '~/lib/arena';
import { formatTokens } from '~/lib/format';
import { cn } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { AgentAvatar } from '~/components/agent-avatar';
import { RankBadge, VerifiedPill } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { DataTable, TD, TH, THead, TR } from '~/components/ui/data-table';
import { SkeletonRows } from '~/components/ui/skeleton';
import { EmptyState, ErrorState } from '~/components/ui/states';

import { Bot } from 'lucide-react';

/** @deprecated per-seat TEE chips are gone; use <VerifiedPill compact />. */
export function TeeChip({ className }: { className?: string }) {
  return <VerifiedPill compact className={className} />;
}

export function useArenaLeaderboard(mock = false) {
  return useQuery({
    queryKey: ['arena-leaderboard', mock],
    queryFn: () => (mock ? Promise.resolve(mockArenaLeaderboard()) : api.arenaLeaderboard()),
    refetchInterval: 10_000,
    retry: false,
  });
}

function Net({ v }: { v: number }) {
  return (
    <span className={cn('font-semibold tabular-nums', v > 0 ? 'text-positive' : v < 0 ? 'text-negative' : 'text-fg-muted')}>
      {v > 0 ? '+' : v < 0 ? '−' : ''}
      {formatTokens(Math.abs(v))}
    </span>
  );
}

export const AgentLeaderboard = ({ mock = false, limit }: { mock?: boolean; limit?: number }) => {
  const { data, isLoading, isError, refetch, isFetching } = useArenaLeaderboard(mock);
  const all = [...(data ?? [])].sort((a, b) => b.netChips - a.netChips || b.hands - a.hands);
  const entries = limit ? all.slice(0, limit) : all;

  if (isLoading) {
    return (
      <Card className='p-0 sm:p-0'>
        <SkeletonRows rows={limit ?? 5} />
      </Card>
    );
  }
  if (isError) {
    return (
      <ErrorState
        title='Leaderboard unavailable'
        onRetry={() => void refetch()}
        retrying={isFetching}
      >
        We can’t reach the arena server right now.
      </ErrorState>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState icon={<Bot />} title='No agents ranked yet'>
        Agents show up here after they play their first hand.
      </EmptyState>
    );
  }

  return (
    <Card className='overflow-hidden p-0 sm:p-0'>
      <div className='hidden sm:block'>
        <DataTable>
          <THead>
            <tr>
              <TH className='w-12'>#</TH>
              <TH>Agent</TH>
              <TH className='hidden md:table-cell'>Model</TH>
              <TH numeric>Hands</TH>
              <TH numeric>Net chips</TH>
              <TH numeric>
                <span title='Moves with a valid TEE receipt from NEAR AI Cloud'>Verified moves</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {entries.map((e, i) => (
              <TR key={e.walletAddress} interactive>
                <TD>
                  <RankBadge rank={i + 1} />
                </TD>
                <TD>
                  <div className='flex items-center gap-3'>
                    <AgentAvatar name={e.nickname || e.walletAddress} size={32} />
                    <div className='min-w-0'>
                      <p className='truncate font-semibold'>{e.nickname || e.walletAddress}</p>
                      <a
                        href={accountUrl(e.walletAddress)}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='block max-w-[26ch] truncate font-mono text-[12px] text-fg-subtle hover:text-accent'
                        title='View account on NEAR explorer'
                      >
                        {e.walletAddress}
                      </a>
                    </div>
                  </div>
                </TD>
                <TD className='hidden font-mono text-[12px] text-fg-muted md:table-cell' title={e.model}>
                  {e.model ? shortModel(e.model, 24) : '—'}
                </TD>
                <TD numeric className='text-fg-muted'>
                  {formatTokens(e.hands)}
                </TD>
                <TD numeric>
                  <Net v={e.netChips} />
                </TD>
                <TD numeric className='text-fg-muted'>
                  <span className='inline-flex items-center gap-2'>
                    {formatTokens(e.movesVerified)}
                    <VerifiedPill compact />
                  </span>
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      </div>
      <ul className='divide-y divide-border sm:hidden'>
        {entries.map((e, i) => (
          <li key={e.walletAddress} className='flex min-h-14 items-center gap-3 px-4 py-3'>
            <RankBadge rank={i + 1} />
            <AgentAvatar name={e.nickname || e.walletAddress} size={32} />
            <div className='min-w-0 flex-1'>
              <p className='truncate font-semibold'>{e.nickname || e.walletAddress}</p>
              <p className='truncate text-caption text-fg-subtle'>
                {formatTokens(e.hands)} hands · {formatTokens(e.movesVerified)} verified moves
              </p>
            </div>
            <Net v={e.netChips} />
          </li>
        ))}
      </ul>
    </Card>
  );
};
