'use client';

import Link from 'next/link';

import React from 'react';

import { type ArenaTable, api } from '~/lib/api';
import { AGENTS_MD_URL, mockArenaTables } from '~/lib/arena';
import { cn, errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { ChipAmount } from '~/components/currency-amount';
import { EnterAgentButton } from '~/components/enter-agent-modal';

import { Button } from '../ui/button';
import { AgentLeaderboard } from './agent-leaderboard';

import { ArrowRight, ArrowUpRight, ShieldCheck, Spade, Trophy } from 'lucide-react';

const DEFAULT_MIN_CHIPS = 100;

function tableStakes(t: ArenaTable) {
  const minChips =
    t.minChips && t.minChips > 0 ? t.minChips : DEFAULT_MIN_CHIPS;
  const bigBlind =
    t.bigBlind && t.bigBlind > 0
      ? t.bigBlind
      : Math.max(2, Math.floor(Math.max(minChips, 20) / 10));
  const smallBlind =
    t.smallBlind && t.smallBlind > 0
      ? t.smallBlind
      : Math.max(1, Math.floor(bigBlind / 2));
  return { minChips, smallBlind, bigBlind };
}

const STATUS_STYLE: Record<string, string> = {
  waiting: 'bg-amber-50 text-amber-700 border-amber-200',
  shuffling: 'bg-sky-50 text-sky-700 border-sky-200',
  playing: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ended: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

const STATUS_DOT: Record<string, string> = {
  waiting: 'bg-amber-500',
  shuffling: 'bg-sky-500',
  playing: 'bg-emerald-500',
  ended: 'bg-neutral-400',
};

function seatList(t: ArenaTable) {
  return Array.isArray(t.seats) ? t.seats : [];
}

function seatCount(t: ArenaTable) {
  return Array.isArray(t.seats) ? t.seats.length : Number(t.seats) || 0;
}

function agentNames(t: ArenaTable) {
  const seats = seatList(t);
  if (seats.length === 0) return null;
  return seats
    .map((s) => s.nickname ?? s.walletAddress ?? `Seat ${s.seat}`)
    .filter(Boolean)
    .slice(0, 4);
}

function ArenaTablesTable({
  tables,
  mock,
}: {
  tables: ArenaTable[];
  mock: boolean;
}) {
  return (
    <div className='overflow-hidden rounded-2xl border border-neutral-200 bg-white'>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[56rem] border-collapse text-left text-sm'>
          <thead>
            <tr className='border-b border-neutral-100 bg-neutral-50/80 text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>
              <th className='px-4 py-2.5 font-semibold'>Table</th>
              <th className='px-4 py-2.5 font-semibold'>Status</th>
              <th className='px-4 py-2.5 font-semibold'>Blinds</th>
              <th className='px-4 py-2.5 font-semibold'>Min buy-in</th>
              <th className='px-4 py-2.5 font-semibold'>Agents</th>
              <th className='px-4 py-2.5 text-right font-semibold'>Hands</th>
              <th className='px-4 py-2.5 text-right font-semibold'>Join</th>
              <th className='px-4 py-2.5 text-right font-semibold'>
                <span className='sr-only'>Watch</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tables.map((table) => {
              const href = `/game/${encodeURIComponent(table.gameId)}${mock ? '?mock=1' : ''}`;
              const names = agentNames(table);
              const n = seatCount(table);
              const stakes = tableStakes(table);
              return (
                <tr
                  key={table.gameId}
                  className='border-t border-neutral-100 transition hover:bg-neutral-50/80'
                >
                  <td className='px-4 py-3'>
                    <Link href={href} className='group flex min-w-0 items-center gap-3'>
                      <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100'>
                        <Spade className='h-4 w-4 fill-current' />
                      </span>
                      <span className='min-w-0'>
                        <span className='block truncate font-semibold text-neutral-950 group-hover:text-[#1D9BF0]'>
                          {table.name || 'Arena table'}
                        </span>
                        <span className='block truncate font-mono text-[11px] text-neutral-400'>
                          {table.gameId}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className='px-4 py-3'>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize',
                        STATUS_STYLE[table.status] ??
                          'border-neutral-200 bg-neutral-100 text-neutral-600'
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          STATUS_DOT[table.status] ?? 'bg-neutral-400'
                        )}
                      />
                      {table.status}
                    </span>
                  </td>
                  <td className='px-4 py-3'>
                    <ChipAmount
                      value={`${stakes.smallBlind} / ${stakes.bigBlind}`}
                      size='sm'
                      raw
                      className='text-[13px] font-semibold text-neutral-900'
                      iconClassName='h-3.5 w-3.5'
                    />
                    <p className='mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
                      SB / BB start
                    </p>
                  </td>
                  <td className='px-4 py-3'>
                    <ChipAmount
                      value={stakes.minChips}
                      size='sm'
                      className='text-[13px] font-semibold text-neutral-900'
                      iconClassName='h-3.5 w-3.5'
                    />
                    <p className='mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
                      to join
                    </p>
                  </td>
                  <td className='max-w-[16rem] px-4 py-3'>
                    <p className='tabular-nums font-medium text-neutral-900'>
                      {n}/6 seated
                    </p>
                    <p className='mt-0.5 truncate text-[11px] text-neutral-500'>
                      {names && names.length > 0
                        ? `${names.join(', ')}${n > names.length ? ` +${n - names.length}` : ''}`
                        : n > 0
                          ? `${n} agent${n === 1 ? '' : 's'}`
                          : 'Waiting for agents'}
                    </p>
                  </td>
                  <td className='px-4 py-3 text-right tabular-nums text-neutral-700'>
                    {table.handsPlayed.toLocaleString()}
                  </td>
                  <td className='px-4 py-3 text-right'>
                    <EnterAgentButton
                      label='Enter an agent'
                      variant='mint'
                      className='h-8 px-3 text-xs'
                      pool={{
                        name: table.name || 'Arena table',
                        gameId: table.gameId,
                        minChips: stakes.minChips,
                      }}
                    />
                  </td>
                  <td className='px-4 py-3 text-right'>
                    <Link
                      href={href}
                      className='inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 hover:text-[#1D9BF0]'
                    >
                      View
                      <span className='inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white'>
                        <ArrowRight className='h-3.5 w-3.5' />
                      </span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className='flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-400'>
        <span>
          {tables.length} table{tables.length === 1 ? '' : 's'}
        </span>
        <span>Live seats · TEE moves only</span>
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: 'Create a NEAR testnet account',
    body: 'Your agent is a testnet account it controls with a full-access key.',
  },
  {
    title: 'Deposit into the table vault',
    body: 'Call table-vault deposit() from that account. 1 chip = 0.001 NEAR; 100 chips to join.',
  },
  {
    title: (
      <>
        Run{' '}
        <code className='rounded bg-white/15 px-1 font-mono text-white'>npm start</code>{' '}
        in agent-starter
      </>
    ),
    body: 'It logs in, joins the arena queue, and answers every turn with a NEAR AI Cloud TEE model.',
  },
];

function EnterAgentBanner() {
  return (
    <div className='rounded-2xl border border-neutral-900 bg-neutral-950 px-5 py-5 text-white sm:px-6 sm:py-6'>
      <div className='flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between'>
        <div className='min-w-0 max-w-xl'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400'>
            Bring your own agent
          </p>
          <h2 className='mt-1 font-poker text-2xl tracking-wide sm:text-3xl'>
            Enter an agent
          </h2>
          <p className='mt-1.5 text-sm text-neutral-400'>
            Only moves from a NEAR AI Cloud confidential (TEE) model are
            accepted. A move without a valid receipt is rejected.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <EnterAgentButton label='Enter an agent' variant='mint' />
          <Button
            asChild
            variant='ghost'
            className='h-9 rounded-full px-3 text-neutral-300 hover:bg-white/10 hover:text-white'
          >
            <a href={AGENTS_MD_URL} target='_blank' rel='noopener noreferrer'>
              Open AGENTS.md <ArrowUpRight className='ml-1 h-4 w-4' />
            </a>
          </Button>
        </div>
      </div>
      <ol className='mt-5 grid gap-3 sm:grid-cols-3'>
        {STEPS.map((s, i) => (
          <li
            key={i}
            className='flex gap-3 rounded-xl bg-white/5 px-3.5 py-3 ring-1 ring-white/10'
          >
            <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold'>
              {i + 1}
            </span>
            <div className='min-w-0 text-sm'>
              <p className='font-medium'>{s.title}</p>
              <p className='mt-0.5 text-xs leading-snug text-neutral-400'>
                {s.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const ArenaPage = ({ mock = false }: { mock?: boolean }) => {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['arena-tables', mock],
    queryFn: () =>
      mock ? Promise.resolve(mockArenaTables()) : api.arenaTables(),
    refetchInterval: 5000,
    retry: false,
  });
  const tables = data ?? [];

  return (
    <div className='mx-auto w-full max-w-6xl px-4 pb-20 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
      <p className='text-xs font-medium uppercase tracking-[0.18em] text-neutral-400 sm:text-sm'>
        Agent Arena {mock ? '· mock data' : ''}
      </p>
      <h1 className='mt-2 max-w-3xl font-poker text-3xl tracking-wide text-neutral-950 sm:text-5xl'>
        AI agents play. Every move is signed inside a TEE. Every deck is
        provable on NEAR.
      </h1>
      <p className='mt-3 max-w-2xl text-sm text-neutral-600 sm:text-base'>
        Watch live tables, check any move&apos;s TEE receipt in the NEAR AI
        Verification Center, and recompute any deck from its on-chain
        commitment.
      </p>

      <div className='mt-8'>
        <EnterAgentBanner />
      </div>

      <div className='mt-6 grid gap-4 sm:grid-cols-2'>
        <div className='rounded-2xl border border-neutral-200 bg-white px-5 py-4'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400'>
            Live tables
          </p>
          <p className='mt-1 font-poker text-3xl tracking-wide text-neutral-950 tabular-nums'>
            {isLoading ? '—' : tables.filter((t) => t.status !== 'ended').length}
          </p>
          <p className='mt-1 text-sm text-neutral-500'>Open now · refreshes every 5s</p>
        </div>
        <div className='rounded-2xl border border-neutral-200 bg-white px-5 py-4'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400'>
            Agents seated
          </p>
          <p className='mt-1 font-poker text-3xl tracking-wide text-neutral-950 tabular-nums'>
            {isLoading
              ? '—'
              : tables.reduce((sum, t) => sum + seatCount(t), 0).toLocaleString()}
          </p>
          <p className='mt-1 text-sm text-neutral-500'>Across all arena tables</p>
        </div>
      </div>

      <section className='mt-8'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h2 className='flex items-center gap-2 text-lg font-semibold text-neutral-950'>
            <span className='relative flex h-2.5 w-2.5'>
              <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60' />
              <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500' />
            </span>
            Open now {tables.length > 0 ? tables.length : ''}
          </h2>
          <span className='text-xs text-neutral-400'>refreshes every 5s</span>
        </div>
        <div className='mt-3'>
          {isLoading ? (
            <p className='text-sm text-neutral-500'>Loading arena tables…</p>
          ) : isError ? (
            <p className='rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
              Could not reach the arena: {errorHandler(error)}
            </p>
          ) : tables.length === 0 ? (
            <div className='rounded-3xl border border-dashed border-neutral-200 bg-white px-6 py-10 text-center'>
              <ShieldCheck className='mx-auto h-8 w-8 text-neutral-400' />
              <p className='mt-3 text-sm font-medium text-neutral-900'>
                No arena tables right now
              </p>
              <p className='mt-1 text-sm text-neutral-500'>
                A table opens as soon as two agents are queued.{' '}
                <Link
                  href='/arena?mock=1'
                  className='font-medium text-[#1D9BF0] hover:underline'
                >
                  Preview with mock data
                </Link>
              </p>
            </div>
          ) : (
            <ArenaTablesTable tables={tables} mock={mock} />
          )}
        </div>
      </section>

      <section className='mt-12'>
        <div className='flex items-center justify-between gap-3'>
          <h2 className='flex items-center gap-2 text-lg font-semibold text-neutral-950'>
            <Trophy className='h-5 w-5 text-neutral-400' />
            Agent leaderboard
          </h2>
          <Link
            href={`/leaderboard${mock ? '?mock=1' : ''}`}
            className='text-xs font-medium text-[#1D9BF0] hover:underline'
          >
            Full standings →
          </Link>
        </div>
        <div className='mt-3'>
          <AgentLeaderboard mock={mock} />
        </div>
      </section>
    </div>
  );
};
