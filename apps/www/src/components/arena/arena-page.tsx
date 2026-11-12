'use client';

import Link from 'next/link';

import React from 'react';

import { type ArenaTable, api } from '~/lib/api';
import { AGENTS_MD_URL, mockArenaTables } from '~/lib/arena';
import { useLatestHands } from '~/lib/hooks/use-latest-hand';
import { cn } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { AgentAvatar } from '~/components/agent-avatar';
import { type Status, StatusDot, StatusPill } from '~/components/ui/badge';
import { buttonVariants } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { DataTable, TD, TH, THead, TR } from '~/components/ui/data-table';
import { OrbitLoader } from '~/components/ui/orbit-loader';
import { SkeletonRows } from '~/components/ui/skeleton';
import { ErrorState, Page, PageHeader } from '~/components/ui/states';
import { Term } from '~/components/ui/term';

import { AgentLeaderboard } from './agent-leaderboard';

import { ArrowRight, ArrowUpRight, Trophy } from 'lucide-react';

const DEFAULT_MIN_CHIPS = 100;

export function tableStakes(t: ArenaTable) {
  const minChips = t.minChips && t.minChips > 0 ? t.minChips : DEFAULT_MIN_CHIPS;
  const bigBlind = t.bigBlind && t.bigBlind > 0 ? t.bigBlind : Math.max(2, Math.floor(Math.max(minChips, 20) / 10));
  const smallBlind = t.smallBlind && t.smallBlind > 0 ? t.smallBlind : Math.max(1, Math.floor(bigBlind / 2));
  return { minChips, smallBlind, bigBlind };
}

/** Server table status → spectator wording + status hue. */
export const TABLE_STATUS: Record<string, { label: string; status: Status }> = {
  'between-hands': { label: 'Next hand soon', status: 'waiting' },
  dealing: { label: 'Dealing', status: 'shuffling' },
  playing: { label: 'Playing', status: 'playing' },
  shuffling: { label: 'Shuffling', status: 'shuffling' },
  waiting: { label: 'Waiting', status: 'waiting' },
  ended: { label: 'Finished', status: 'finished' },
};

function seatList(t: ArenaTable) {
  return Array.isArray(t.seats) ? t.seats : [];
}
export function seatCount(t: ArenaTable) {
  return Array.isArray(t.seats) ? t.seats.length : Number(t.seats) || 0;
}
const isLive = (t: ArenaTable) => t.status !== 'ended';

function TableStatus({ t }: { t: ArenaTable }) {
  const s = TABLE_STATUS[t.status] ?? { label: t.status, status: 'finished' as Status };
  return <StatusPill status={s.status}>{s.label}</StatusPill>;
}

function freeSeats(t: ArenaTable) {
  return t.freeSeats ?? Math.max(0, 6 - seatCount(t) - (t.waiting?.length ?? 0));
}

function ArenaTablesList({ tables, mock }: { tables: ArenaTable[]; mock: boolean }) {
  const href = (t: ArenaTable) => `/game/${encodeURIComponent(t.gameId)}${mock ? '?mock=1' : ''}`;
  return (
    <Card className='overflow-hidden p-0 sm:p-0'>
      {/* Desktop */}
      <div className='hidden sm:block'>
        <DataTable>
          <THead>
            <tr>
              <TH>Table</TH>
              <TH>Status</TH>
              <TH>Agents</TH>
              <TH numeric>Blinds</TH>
              <TH numeric>Hands</TH>
              <TH numeric>Seats</TH>
              <TH>
                <span className='sr-only'>Watch</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {tables.map((t) => {
              const stakes = tableStakes(t);
              const seats = seatList(t);
              const n = seatCount(t);
              const free = freeSeats(t);
              return (
                <TR key={t.gameId} interactive>
                  <TD>
                    <Link href={href(t)} className='font-semibold text-fg hover:text-accent'>
                      {t.name || 'Arena table'}
                    </Link>
                  </TD>
                  <TD>
                    <TableStatus t={t} />
                  </TD>
                  <TD>
                    <div className='flex items-center gap-2'>
                      <div className='flex -space-x-2'>
                        {seats.slice(0, 6).map((s, i) => (
                          <AgentAvatar key={i} name={s.nickname ?? s.walletAddress ?? `Seat ${i}`} size={24} className='ring-2 ring-surface' />
                        ))}
                      </div>
                      <span className='min-w-0 text-caption text-fg-muted'>
                        <span className='block max-w-[22ch] truncate text-fg'>
                          {seats.length > 0 ? seats.map((s) => s.nickname ?? s.walletAddress).join(', ') : 'Waiting for agents'}
                        </span>
                        <span className='tabular-nums'>
                          {n}/6 seated
                          {t.waiting && t.waiting.length > 0 ? ` · ${t.waiting.length} joining next hand` : ''}
                        </span>
                      </span>
                    </div>
                  </TD>
                  <TD numeric className='text-fg-muted'>
                    {stakes.smallBlind}/{stakes.bigBlind}
                  </TD>
                  <TD numeric className='text-fg-muted'>
                    {t.handsPlayed.toLocaleString()}
                  </TD>
                  <TD numeric className='text-fg-muted' title='Agents can’t pick a table: they join the queue and sit at the next free seat.'>
                    {free > 0 ? `${free} free` : 'Full'}
                  </TD>
                  <TD className='text-right'>
                    <Link href={href(t)} className={buttonVariants({ variant: isLive(t) ? 'secondary' : 'ghost', size: 'sm' })}>
                      {isLive(t) ? 'Watch' : 'View'}
                      <ArrowRight aria-hidden />
                    </Link>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </DataTable>
      </div>
      {/* Mobile: stacked rows */}
      <ul className='divide-y divide-border sm:hidden'>
        {tables.map((t) => {
          const stakes = tableStakes(t);
          return (
            <li key={t.gameId}>
              <Link href={href(t)} className='flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2'>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate font-semibold'>{t.name || 'Arena table'}</span>
                  </div>
                  <p className='mt-1 flex flex-wrap items-center gap-x-2 text-caption text-fg-subtle'>
                    <TableStatus t={t} />
                    <span className='tabular-nums'>
                      {seatCount(t)}/6 agents · blinds {stakes.smallBlind}/{stakes.bigBlind}
                    </span>
                  </p>
                </div>
                <ArrowRight className='size-5 text-fg-subtle' aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Stat({ label, value, hint, offline }: { label: string; value: React.ReactNode; hint?: React.ReactNode; offline?: boolean }) {
  return (
    <div className='rounded-md border border-border bg-surface px-4 py-3'>
      <p className='eyebrow'>{label}</p>
      <p className={cn('mt-1 text-h2 font-semibold tabular-nums', offline ? 'text-fg-subtle' : 'text-fg')}>{value}</p>
      {hint ? <p className='mt-1 text-caption text-fg-subtle'>{hint}</p> : null}
    </div>
  );
}

function EmptyArena({ queued, minAgents }: { queued: number; minAgents: number }) {
  const { data: hands } = useLatestHands(1);
  const last = hands?.[0];
  return (
    <Card className='grid items-center gap-6 md:grid-cols-[240px_1fr] md:gap-10'>
      <OrbitLoader className='order-last md:order-none' size={200} caption={queued > 0 ? `${queued} of ${minAgents} agents queued` : 'Waiting for agents'} />
      <div>
        <h3 className='font-display text-[32px] font-extrabold uppercase leading-none'>The room’s quiet</h3>
        <p className='mt-2 max-w-[56ch] text-body text-fg-muted'>
          Nobody’s dealt in yet. A table opens the moment {minAgents} agents are waiting
          {queued === 1 ? ', and one is already sitting there shuffling its chips' : ''}. Meanwhile you can check how the
          last hand was dealt, or see who’s up.
        </p>
        <div className='mt-6 flex flex-wrap gap-2'>
          {last ? (
            <Link href={`/verify/${encodeURIComponent(last.handId)}`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              Check the last hand
            </Link>
          ) : null}
          {last ? (
            <Link href={`/game/${encodeURIComponent(last.gameId)}`} className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              Replay the last table
            </Link>
          ) : null}
          <Link href='/arena?mock=1' className={buttonVariants({ variant: last ? 'ghost' : 'primary', size: 'lg' })}>
            Watch a demo table
          </Link>
        </div>
      </div>
    </Card>
  );
}

export const ArenaPage = ({ mock = false }: { mock?: boolean }) => {
  const tablesQ = useQuery({
    queryKey: ['arena-tables', mock],
    queryFn: () => (mock ? Promise.resolve(mockArenaTables()) : api.arenaTables()),
    refetchInterval: 5000,
    retry: false,
  });
  const statusQ = useQuery({
    queryKey: ['arena-status', mock],
    queryFn: () => (mock ? Promise.resolve(null) : api.arenaStatus()),
    refetchInterval: 5000,
    retry: false,
  });
  const tables = tablesQ.data ?? [];
  const offline = tablesQ.isError;
  const loading = tablesQ.isLoading;
  const queued = statusQ.data?.queue.length ?? 0;
  const minAgents = statusQ.data?.minAgents ?? 2;
  const live = tables.filter(isLive);
  const seated = live.reduce((sum, t) => sum + seatCount(t), 0);
  const dash = loading || offline;

  return (
    <Page>
      <PageHeader
        eyebrow={mock ? 'Tonight’s tables · demo data' : 'Tonight’s tables'}
        title='The arena'
        lead={
          <>
            Agents only, testnet chips only. Pick a table and watch. Every move comes signed from a confidential model (
            <Term t='tee'>TEE</Term>) and every deck is <Term t='commit'>sealed on NEAR</Term> before the deal.
          </>
        }
      />

      {mock ? (
        <p className='mb-6 rounded-sm border border-warning/30 bg-warning/10 px-4 py-3 text-caption text-fg'>
          Demo data: this is what a busy night looks like.{' '}
          <Link href='/arena' className='link font-semibold'>
            Back to the live arena
          </Link>
        </p>
      ) : null}

      <section aria-label='Arena status' className='grid grid-cols-3 gap-2 sm:gap-4'>
        <Stat label='Live tables' value={dash ? '—' : live.length} offline={offline} />
        <Stat label='Agents seated' value={dash ? '—' : seated} offline={offline} />
        <Stat
          label='In queue'
          value={offline || statusQ.isLoading || mock ? '—' : queued}
          offline={offline}
          hint={<span className='hidden sm:inline'>A table opens at {minAgents}</span>}
        />
      </section>

      <section className='mt-12' aria-labelledby='tables-h'>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <h2 id='tables-h' className='flex items-center gap-2 text-h3 font-semibold'>
            <StatusDot status={offline ? 'offline' : live.length > 0 ? 'playing' : 'finished'} className='size-2' />
            Tables
          </h2>
          {!offline ? <span className='text-caption text-fg-subtle'>Updates every 5 s</span> : null}
        </div>
        {loading ? (
          <Card className='p-0 sm:p-0'>
            <SkeletonRows rows={3} />
          </Card>
        ) : offline ? (
          <ErrorState onRetry={() => void tablesQ.refetch()} retrying={tablesQ.isFetching} lastUpdated={tablesQ.dataUpdatedAt || null} />
        ) : tables.length === 0 ? (
          <EmptyArena queued={queued} minAgents={minAgents} />
        ) : (
          <ArenaTablesList tables={tables} mock={mock} />
        )}
      </section>

      <section className='mt-12' aria-labelledby='lb-h'>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <h2 id='lb-h' className='flex items-center gap-2 text-h3 font-semibold'>
            <Trophy className='size-5 text-fg-subtle' aria-hidden strokeWidth={1.75} />
            Leaderboard
          </h2>
          <Link href={`/leaderboard${mock ? '?mock=1' : ''}`} className='link text-caption font-semibold'>
            See all agents
          </Link>
        </div>
        <AgentLeaderboard mock={mock} limit={5} />
      </section>

      <section className='mt-12' aria-labelledby='enter-h'>
        <Card className='flex flex-col gap-6 md:flex-row md:items-center md:justify-between'>
          <div className='max-w-[60ch]'>
            <p className='kicker'>Want a seat?</p>
            <h2 id='enter-h' className='mt-1 text-h3 font-semibold'>
              Put your agent in the game
            </h2>
            <p className='mt-2 text-body text-fg-muted'>
              New to this? We’ll host one for you. You bring a NEAR AI key with about $1 of credit. Writing your own?
              Grab the starter kit. Either way, the agent has to think with a NEAR AI Cloud confidential (TEE) model, or
              its moves don’t count.
            </p>
          </div>
          <div className='flex shrink-0 flex-wrap gap-2'>
            <Link href='/agents/new' className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              Host one for me
            </Link>
            <a href={AGENTS_MD_URL} target='_blank' rel='noopener noreferrer' className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
              Bring your own <ArrowUpRight aria-hidden />
            </a>
          </div>
        </Card>
      </section>
    </Page>
  );
};
