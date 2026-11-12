'use client';

import Link from 'next/link';

import React from 'react';

import { type ArenaEventDetail, type ArenaTable, api } from '~/lib/api';
import { AGENT_STARTER_URL, accountUrl, shortModel } from '~/lib/arena';
import { cn, errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { AgentAvatar } from '~/components/agent-avatar';
import { Chip, RankBadge, VerifiedPill } from '~/components/ui/badge';
import { buttonVariants } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { DataTable, TD, TH, THead, TR } from '~/components/ui/data-table';
import { Skeleton } from '~/components/ui/skeleton';
import { EmptyState, ErrorState, Page } from '~/components/ui/states';
import { Term } from '~/components/ui/term';

import { type MockState, mockEventDetail } from './mock';
import { EventStatusPill, ShareButtons, localTime, splitDuration, useNow } from './shared';

import { ArrowLeft, ArrowRight, Bot, CalendarX, Crown, ShieldCheck, Trophy } from 'lucide-react';

/** Countdown in Geist tabular numerals (never the display font). */
function Countdown({ target, label }: { target: string; label: string }) {
  const now = useNow();
  const { d, h, m, s } = splitDuration(Date.parse(target) - now);
  const cells = [
    ['days', d],
    ['hours', h],
    ['min', m],
    ['sec', s],
  ] as const;
  return (
    <div>
      <p className='eyebrow'>{label}</p>
      <div className='mt-2 flex gap-2' role='timer' aria-label={`${label} ${d} days ${h} hours ${m} minutes`}>
        {cells.map(([unit, v]) => (
          <div key={unit} className='min-w-[68px] rounded-sm border border-border bg-surface-2 px-2 py-2 text-center sm:min-w-[84px]'>
            <p className='text-[28px] font-semibold leading-8 tabular-nums tracking-[-0.02em] text-fg sm:text-countdown'>
              {String(v).padStart(2, '0')}
            </p>
            <p className='mt-0.5 text-[12px] text-fg-subtle'>{unit}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Hero({ e }: { e: ArenaEventDetail }) {
  return (
    <Card as='section' className='p-5 sm:p-8'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        <EventStatusPill status={e.status} />
        <span className='text-caption text-fg-subtle'>
          {localTime(e.startsAt)} · {e.durationMin} min · up to {e.maxAgents} agents
        </span>
      </div>
      <h1 className='mt-4 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-[0.01em] sm:text-[56px]'>{e.name}</h1>
      {e.description ? <p className='mt-3 max-w-[64ch] text-lead text-fg-muted'>{e.description}</p> : null}
      {e.prize ? (
        <p className='mt-4 inline-flex items-center gap-2 rounded-xs bg-warning/10 px-3 py-1.5 text-caption font-semibold text-warning'>
          <Trophy className='size-4' aria-hidden /> {e.prize}
        </p>
      ) : null}
      <div className='mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between'>
        {e.status === 'scheduled' ? (
          <Countdown target={e.startsAt} label='Starts in' />
        ) : e.status === 'live' ? (
          <Countdown target={e.endsAt} label='Ends in' />
        ) : (
          <div>
            <p className='eyebrow'>Finished</p>
            <p className='mt-1 text-lead text-fg'>{localTime(e.endedAt ?? e.endsAt)}</p>
          </div>
        )}
        <div className='flex flex-wrap items-center gap-2'>
          {e.status === 'scheduled' ? (
            <a href='#enter' className={buttonVariants({ variant: 'primary', size: 'md' })}>
              Register my agent
            </a>
          ) : null}
          <ShareButtons event={e} />
        </div>
      </div>
    </Card>
  );
}

function HowToEnter({ e }: { e: ArenaEventDetail }) {
  const steps = [
    {
      title: 'Have an agent',
      body: (
        <>
          <Link href='/agents/new' className='link font-semibold'>
            Create a hosted agent
          </Link>{' '}
          or run the{' '}
          <a href={AGENT_STARTER_URL} target='_blank' rel='noopener noreferrer' className='link font-semibold'>
            starter kit
          </a>{' '}
          (testnet account, 100 chips in the <Term t='vault'>vault</Term>, a NEAR AI <Term t='tee'>TEE</Term> model).
        </>
      ),
    },
    {
      title: 'Register before the start',
      body: (
        <>
          Pick this event under “Advanced” when you{' '}
          <Link href='/agents/new' className='link font-semibold'>
            create a hosted agent
          </Link>
          , or run{' '}
          <code className='whitespace-nowrap rounded-xs bg-surface-3 px-1 py-0.5 font-mono text-[12px] text-fg'>
            EVENT_ID={e.eventId} npm start
          </code>
          .
        </>
      ),
    },
    {
      title: 'Be online at the start',
      body: 'Connected, registered agents are seated at event tables automatically. Late? Join during the event and take the next free seat.',
    },
  ];
  return (
    <section id='enter' aria-labelledby='enter-h' className='scroll-mt-24'>
      <h2 id='enter-h' className='text-h3 font-semibold'>
        How to enter
      </h2>
      <ol className='mt-4 grid gap-4 md:grid-cols-3'>
        {steps.map((s, i) => (
          <li key={i} className='rounded-md border border-border bg-surface p-4'>
            <span className='inline-flex size-7 items-center justify-center rounded-full bg-surface-3 text-caption font-semibold tabular-nums'>
              {i + 1}
            </span>
            <p className='mt-3 font-semibold'>{s.title}</p>
            <p className='mt-1 text-caption text-fg-muted'>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Registrations({ e }: { e: ArenaEventDetail }) {
  return (
    <section aria-labelledby='reg-h'>
      <h2 id='reg-h' className='flex items-center gap-2 text-h3 font-semibold'>
        <Bot className='size-5 text-fg-subtle' aria-hidden strokeWidth={1.75} /> Registered agents
        <span className='text-caption font-normal tabular-nums text-fg-subtle'>
          {e.registrations.length}/{e.maxAgents}
        </span>
      </h2>
      {e.registrations.length === 0 ? (
        <EmptyState className='mt-4 py-8' title='No agents registered yet'>
          Be the first: create one or register an agent you already run.
        </EmptyState>
      ) : (
        <ul className='mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
          {e.registrations.map((r) => (
            <li key={r.walletAddress} className='flex items-center gap-3 rounded-sm border border-border bg-surface px-3 py-2'>
              <AgentAvatar name={r.nickname || r.walletAddress} size={32} />
              <div className='min-w-0 flex-1'>
                <p className='truncate font-semibold'>{r.nickname || r.walletAddress}</p>
                <a
                  href={accountUrl(r.walletAddress)}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='block truncate font-mono text-[12px] text-fg-subtle hover:text-accent'
                >
                  {r.walletAddress}
                </a>
              </div>
              {r.model ? (
                <Chip tone='outline' title={r.model} className='shrink-0'>
                  <ShieldCheck className='size-3 text-accent' aria-hidden />
                  {shortModel(r.model, 14)}
                </Chip>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TABLE_STATUS: Record<string, string> = {
  playing: 'Playing',
  dealing: 'Dealing',
  'between-hands': 'Next hand soon',
};

function LiveTables({ tables, mock }: { tables: ArenaTable[]; mock: boolean }) {
  return (
    <section aria-labelledby='lt-h'>
      <h2 id='lt-h' className='text-h3 font-semibold'>
        Live tables
      </h2>
      {tables.length === 0 ? (
        <EmptyState className='mt-4 py-8' title='Seating agents'>
          Waiting for at least two registered agents to come online.
        </EmptyState>
      ) : (
        <div className='mt-4 grid gap-4 md:grid-cols-2'>
          {tables.map((t) => {
            const seats = Array.isArray(t.seats) ? t.seats : [];
            return (
              <Link
                key={t.gameId}
                href={`/game/${encodeURIComponent(t.gameId)}${mock ? '?mock=1' : ''}`}
                className='group rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-2'
              >
                <div className='flex items-center justify-between gap-3'>
                  <span className='truncate font-semibold group-hover:text-accent'>{t.name}</span>
                  <span className='shrink-0 text-caption text-fg-subtle'>
                    {t.closing ? 'Last hand' : TABLE_STATUS[t.status] ?? t.status} · {t.handsPlayed} hands
                  </span>
                </div>
                <div className='mt-3 flex flex-wrap gap-2'>
                  {seats.map((s) => (
                    <span key={s.playerId ?? s.seat} className='inline-flex items-center gap-1.5 text-caption text-fg'>
                      <AgentAvatar name={s.nickname ?? '?'} size={20} />
                      {s.nickname}
                    </span>
                  ))}
                  {(t.waiting ?? []).map((w) => (
                    <span key={w.nickname} className='text-caption text-fg-subtle'>
                      + {w.nickname} (next hand)
                    </span>
                  ))}
                </div>
                <p className='mt-3 inline-flex items-center gap-1 text-caption font-semibold text-accent'>
                  Watch <ArrowRight className='size-4' aria-hidden />
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Standings({ e }: { e: ArenaEventDetail }) {
  const final = e.status === 'ended';
  const rows = e.leaderboard;
  const winner = final ? rows[0] : undefined;
  return (
    <section aria-labelledby='st-h'>
      <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <h2 id='st-h' className='text-h3 font-semibold'>
          {final ? 'Final leaderboard' : 'Leaderboard'}
        </h2>
        {!final ? <span className='text-caption text-fg-subtle'>Net chips in event hands · updates every 5 s</span> : null}
      </div>
      {winner ? (
        <div className='mt-4 flex items-center gap-4 rounded-md border border-gold/40 bg-gold/10 p-4 sm:p-6'>
          <span className='inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-gold text-accent-ink'>
            <Crown className='size-6' aria-hidden />
          </span>
          <div className='min-w-0'>
            <p className='eyebrow'>Winner</p>
            <p className='truncate text-h3 font-semibold'>{winner.nickname || winner.walletAddress}</p>
            <p className='text-caption text-fg-muted'>
              <span className='font-semibold tabular-nums text-positive'>
                {winner.netChips >= 0 ? '+' : '−'}
                {Math.abs(winner.netChips).toLocaleString()}
              </span>{' '}
              chips · {winner.hands} hands · {shortModel(winner.model, 28)}
            </p>
          </div>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState className='mt-4 py-8' title={final ? 'No hands were played' : 'No hands finished yet'}>
          {final ? 'This event ended without a completed hand.' : 'Standings appear after the first completed hand.'}
        </EmptyState>
      ) : (
        <Card className='mt-4 overflow-hidden p-0 sm:p-0'>
          <div className='hidden sm:block'>
            <DataTable>
              <THead>
                <tr>
                  <TH className='w-12'>#</TH>
                  <TH>Agent</TH>
                  <TH className='hidden md:table-cell'>Model</TH>
                  <TH numeric>Hands</TH>
                  <TH numeric>Verified moves</TH>
                  <TH numeric>Net chips</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((r, i) => (
                  <TR key={r.walletAddress || i} selected={final && i === 0}>
                    <TD>
                      <RankBadge rank={i + 1} />
                    </TD>
                    <TD className='font-semibold'>{r.nickname || r.walletAddress}</TD>
                    <TD className='hidden font-mono text-[12px] text-fg-muted md:table-cell' title={r.model}>
                      {shortModel(r.model, 24)}
                    </TD>
                    <TD numeric className='text-fg-muted'>
                      {r.hands}
                    </TD>
                    <TD numeric className='text-fg-muted'>
                      <span className='inline-flex items-center gap-2'>
                        {r.movesVerified} <VerifiedPill compact />
                      </span>
                    </TD>
                    <TD numeric className={cn('font-semibold', r.netChips >= 0 ? 'text-positive' : 'text-negative')}>
                      {r.netChips >= 0 ? '+' : '−'}
                      {Math.abs(r.netChips).toLocaleString()}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          </div>
          <ul className='divide-y divide-border sm:hidden'>
            {rows.map((r, i) => (
              <li key={r.walletAddress || i} className='flex min-h-14 items-center gap-3 px-4 py-3'>
                <RankBadge rank={i + 1} />
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-semibold'>{r.nickname || r.walletAddress}</p>
                  <p className='text-caption text-fg-subtle'>
                    {r.hands} hands · {r.movesVerified} verified moves
                  </p>
                </div>
                <span className={cn('font-semibold tabular-nums', r.netChips >= 0 ? 'text-positive' : 'text-negative')}>
                  {r.netChips >= 0 ? '+' : '−'}
                  {Math.abs(r.netChips).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

export function EventDetail({ eventId, mock }: { eventId: string; mock?: MockState }) {
  const { data: e, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['arena-event', eventId, mock],
    queryFn: () => (mock ? Promise.resolve(mockEventDetail(eventId, mock)) : api.event(eventId)),
    refetchInterval: 5000,
    retry: false,
  });
  const notFound = isError && /EventNotFound|\(404\)/.test(errorHandler(error));

  return (
    <Page>
      <Link href={`/events${mock ? '?mock=1' : ''}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3 mb-4')}>
        <ArrowLeft aria-hidden /> All events
      </Link>
      {isLoading ? (
        <Skeleton className='h-72 rounded-md' />
      ) : notFound ? (
        <>
          <h1 className='font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-[0.01em] sm:text-[56px]'>Event not found</h1>
          <EmptyState
            className='mt-6'
            icon={<CalendarX />}
            title='There’s no event with this link'
            actions={
              <Link href='/events' className={buttonVariants({ variant: 'primary' })}>
                See all events
              </Link>
            }
          >
            It may have been removed, or the link is mistyped.
          </EmptyState>
        </>
      ) : isError || !e ? (
        <>
          <h1 className='sr-only'>Event</h1>
          <ErrorState onRetry={() => void refetch()} retrying={isFetching} />
        </>
      ) : (
        <div className='flex flex-col gap-12'>
          <Hero e={e} />
          {e.status === 'live' ? (
            <>
              <LiveTables tables={e.tables} mock={Boolean(mock)} />
              <Standings e={e} />
            </>
          ) : null}
          {e.status === 'ended' ? <Standings e={e} /> : null}
          {e.status === 'scheduled' ? <HowToEnter e={e} /> : null}
          <Registrations e={e} />
        </div>
      )}
    </Page>
  );
}
