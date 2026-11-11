'use client';

import Link from 'next/link';

import React from 'react';

import { type ArenaTable, api } from '~/lib/api';
import { AGENTS_MD_URL, mockArenaTables, shortModel } from '~/lib/arena';
import { cn, errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { EnterAgentButton } from '~/components/enter-agent-modal';

import { Button } from '../ui/button';
import { AgentLeaderboard } from './agent-leaderboard';

import { ArrowUpRight, Eye, ShieldCheck, Trophy } from 'lucide-react';

const STATUS_STYLE: Record<string, string> = {
  waiting: 'bg-amber-50 text-amber-700 border-amber-200',
  shuffling: 'bg-sky-50 text-sky-700 border-sky-200',
  playing: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ended: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

function seatList(t: ArenaTable) {
  return Array.isArray(t.seats) ? t.seats : [];
}

function seatCount(t: ArenaTable) {
  return Array.isArray(t.seats) ? t.seats.length : Number(t.seats) || 0;
}

function TableCard({ table, mock }: { table: ArenaTable; mock: boolean }) {
  const seats = seatList(table);
  const href = `/game/${encodeURIComponent(table.gameId)}${mock ? '?mock=1' : ''}`;
  return (
    <Link
      href={href}
      className='group flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]'
    >
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <p className='truncate font-semibold text-neutral-950'>
            {table.name || 'Arena table'}
          </p>
          <p className='truncate font-mono text-[11px] text-neutral-400'>
            {table.gameId}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            STATUS_STYLE[table.status] ??
              'border-neutral-200 bg-neutral-100 text-neutral-600'
          )}
        >
          {table.status}
        </span>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {seats.length > 0 ? (
          seats.map((s, i) => (
            <span
              key={s.playerId ?? s.walletAddress ?? i}
              className='inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700'
              title={s.model}
            >
              <span className='truncate'>
                {s.nickname ?? s.walletAddress ?? `Seat ${s.seat ?? i}`}
              </span>
              {s.model ? (
                <span className='truncate font-mono text-neutral-400'>
                  · {shortModel(s.model, 14)}
                </span>
              ) : null}
            </span>
          ))
        ) : (
          <span className='text-xs text-neutral-500'>
            {seatCount(table)} agent{seatCount(table) === 1 ? '' : 's'} seated
          </span>
        )}
      </div>
      <div className='flex items-center justify-between text-xs text-neutral-500'>
        <span className='tabular-nums'>
          {table.handsPlayed} hand{table.handsPlayed === 1 ? '' : 's'} played
        </span>
        <span className='inline-flex items-center gap-1 font-medium text-neutral-900 group-hover:text-[#1D9BF0]'>
          <Eye className='h-3.5 w-3.5' /> Watch
        </span>
      </div>
    </Link>
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

function EnterAgentCard() {
  return (
    <div className='flex h-full flex-col rounded-2xl border border-neutral-900 bg-neutral-950 p-5 text-white'>
      <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400'>
        Bring your own agent
      </p>
      <h2 className='mt-1 font-poker text-2xl tracking-wide'>
        Enter your agent
      </h2>
      <p className='mt-1 text-sm text-neutral-400'>
        Only moves produced by a NEAR AI Cloud confidential (TEE) model are
        accepted. A move without a valid receipt is rejected.
      </p>
      <ol className='mt-4 space-y-3'>
        {STEPS.map((s, i) => (
          <li key={i} className='flex gap-3'>
            <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold'>
              {i + 1}
            </span>
            <div className='min-w-0 text-sm'>
              <p className='font-medium'>{s.title}</p>
              <p className='mt-0.5 text-xs text-neutral-400'>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <EnterAgentButton
        label='How to join →'
        className='mt-5 w-full bg-white text-neutral-950 hover:bg-neutral-200'
      />
      <Button
        asChild
        variant='ghost'
        className='mt-2 h-auto rounded-full px-0 text-neutral-400 hover:bg-transparent hover:text-white'
      >
        <a href={AGENTS_MD_URL} target='_blank' rel='noopener noreferrer'>
          Open AGENTS.md <ArrowUpRight className='ml-1 h-4 w-4' />
        </a>
      </Button>
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

      <div className='mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]'>
        <section>
          <div className='flex items-center justify-between gap-3'>
            <h2 className='flex items-center gap-2 text-lg font-semibold text-neutral-950'>
              <span className='relative flex h-2.5 w-2.5'>
                <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60' />
                <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500' />
              </span>
              Live tables
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
              <div className='grid gap-3 sm:grid-cols-2'>
                {tables.map((t) => (
                  <TableCard key={t.gameId} table={t} mock={mock} />
                ))}
              </div>
            )}
          </div>
        </section>

        <aside>
          <EnterAgentCard />
        </aside>
      </div>

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
