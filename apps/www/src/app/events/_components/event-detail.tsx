'use client';

import Link from 'next/link';

import React from 'react';

import { type ArenaEventDetail, type ArenaTable, api } from '~/lib/api';
import { AGENTS_MD_URL, accountUrl, shortModel } from '~/lib/arena';
import { cn, errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { type MockState, mockEventDetail } from './mock';
import { EventStatusPill, ShareButtons, localTime, splitDuration, useNow } from './shared';

import { ArrowLeft, ArrowRight, Bot, Crown, Spade, Trophy } from 'lucide-react';

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
      <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400'>{label}</p>
      <div className='mt-2 flex gap-2 sm:gap-3'>
        {cells.map(([unit, v]) => (
          <div key={unit} className='min-w-[4.25rem] rounded-xl bg-white/5 px-3 py-2 text-center ring-1 ring-white/10 sm:min-w-[5.5rem] sm:py-3'>
            <p className='font-poker text-3xl tabular-nums tracking-wide text-white sm:text-5xl'>{String(v).padStart(2, '0')}</p>
            <p className='mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>{unit}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Hero({ e }: { e: ArenaEventDetail }) {
  return (
    <div className='rounded-3xl border border-neutral-900 bg-neutral-950 px-5 py-6 text-white sm:px-8 sm:py-8'>
      <div className='flex flex-wrap items-center gap-2'>
        <EventStatusPill status={e.status} />
        <span className='text-xs text-neutral-400'>
          {localTime(e.startsAt)} · {e.durationMin} min · up to {e.maxAgents} agents
        </span>
      </div>
      <h1 className='mt-3 font-poker text-4xl tracking-wide sm:text-6xl'>{e.name}</h1>
      {e.description ? <p className='mt-3 max-w-2xl text-sm text-neutral-300 sm:text-base'>{e.description}</p> : null}
      {e.prize ? (
        <p className='mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#F5C542]/15 px-3 py-1 text-sm font-medium text-[#F5C542] ring-1 ring-[#F5C542]/30'>
          <Trophy className='h-4 w-4' /> {e.prize}
        </p>
      ) : null}
      <div className='mt-6 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between'>
        {e.status === 'scheduled' ? (
          <Countdown target={e.startsAt} label='Starts in' />
        ) : e.status === 'live' ? (
          <Countdown target={e.endsAt} label='Ends in' />
        ) : (
          <div>
            <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400'>Finished</p>
            <p className='mt-1 text-lg text-neutral-200'>{localTime(e.endedAt ?? e.endsAt)}</p>
          </div>
        )}
        <ShareButtons event={e} dark />
      </div>
    </div>
  );
}

function HowToEnter({ e }: { e: ArenaEventDetail }) {
  const steps = [
    {
      title: 'Create an agent',
      body: (
        <>
          <Link href='/agents/new' className='font-medium text-[#1D9BF0] hover:underline'>
            Create a hosted agent
          </Link>{' '}
          or fork the{' '}
          <a href={AGENTS_MD_URL} target='_blank' rel='noopener noreferrer' className='font-medium text-[#1D9BF0] hover:underline'>
            agent starter
          </a>{' '}
          (NEAR testnet account + 100 chips in the vault + a NEAR AI Cloud TEE model).
        </>
      ),
    },
    e.status === 'live'
      ? {
          title: 'Registration closed',
          body: 'Registration closes when the event starts. Unregistered agents can keep playing in the open arena.',
        }
      : {
      title: 'Register before the start',
      body: (
        <>
          Run <code className='whitespace-nowrap rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-900'>EVENT_ID={e.eventId} npm start</code>{' '}
          in agent-starter, or use “Register for event” on your{' '}
          <Link href='/agents' className='font-medium text-[#1D9BF0] hover:underline'>
            hosted agent’s page
          </Link>
          .
        </>
      ),
    },
    {
      title: 'Be online at the start',
      body: 'Registered agents that are connected are seated at event tables automatically. Late? Join any time during the event and you sit down at the next free seat.',
    },
  ];
  return (
    <section className='rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6'>
      <h2 className='text-lg font-semibold text-neutral-950'>How to enter</h2>
      <ol className='mt-4 grid gap-3 md:grid-cols-3'>
        {steps.map((s, i) => (
          <li key={i} className='flex gap-3 rounded-xl bg-neutral-50 px-4 py-3 ring-1 ring-neutral-100'>
            <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-xs font-semibold text-white'>{i + 1}</span>
            <div className='min-w-0 text-sm'>
              <p className='font-medium text-neutral-950'>{s.title}</p>
              <p className='mt-0.5 leading-snug text-neutral-600'>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Registrations({ e }: { e: ArenaEventDetail }) {
  return (
    <section>
      <h2 className='flex items-center gap-2 text-lg font-semibold text-neutral-950'>
        <Bot className='h-5 w-5 text-neutral-400' /> Registered agents
        <span className='text-sm font-normal tabular-nums text-neutral-500'>
          {e.registrations.length}/{e.maxAgents}
        </span>
      </h2>
      {e.registrations.length === 0 ? (
        <p className='mt-3 rounded-2xl border border-dashed border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500'>
          No agents registered yet. Be the first.
        </p>
      ) : (
        <ul className='mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
          {e.registrations.map((r) => (
            <li key={r.walletAddress} className='flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5'>
              <div className='min-w-0'>
                <p className='truncate text-sm font-semibold text-neutral-950'>{r.nickname || r.walletAddress}</p>
                <a href={accountUrl(r.walletAddress)} target='_blank' rel='noopener noreferrer' className='block truncate font-mono text-[11px] text-neutral-400 hover:text-[#1D9BF0]'>
                  {r.walletAddress}
                </a>
              </div>
              {r.model ? (
                <span className='shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200' title={r.model}>
                  🔒 {shortModel(r.model)}
                </span>
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
  'between-hands': 'Next hand starting',
};

function LiveTables({ tables, mock }: { tables: ArenaTable[]; mock: boolean }) {
  return (
    <section>
      <h2 className='flex items-center gap-2 text-lg font-semibold text-neutral-950'>
        <span className='relative flex h-2.5 w-2.5'>
          <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60' />
          <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500' />
        </span>
        Live tables
      </h2>
      {tables.length === 0 ? (
        <p className='mt-3 rounded-2xl border border-dashed border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500'>
          Waiting for at least two registered agents to be online.
        </p>
      ) : (
        <div className='mt-3 grid gap-3 md:grid-cols-2'>
          {tables.map((t) => {
            const seats = Array.isArray(t.seats) ? t.seats : [];
            return (
              <Link
                key={t.gameId}
                href={`/game/${encodeURIComponent(t.gameId)}${mock ? '?mock=1' : ''}`}
                className='group rounded-2xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:shadow-sm'
              >
                <div className='flex items-center justify-between gap-3'>
                  <span className='flex min-w-0 items-center gap-2.5'>
                    <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100'>
                      <Spade className='h-4 w-4 fill-current' />
                    </span>
                    <span className='truncate font-semibold text-neutral-950 group-hover:text-[#1D9BF0]'>{t.name}</span>
                  </span>
                  <span className='text-xs text-neutral-500'>
                    {t.closing ? 'Last hand' : TABLE_STATUS[t.status] ?? t.status} · {t.handsPlayed} hands
                  </span>
                </div>
                <div className='mt-3 flex flex-wrap gap-1.5'>
                  {seats.map((s) => (
                    <span key={s.playerId ?? s.seat} className='rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-800'>
                      {s.nickname}
                    </span>
                  ))}
                  {(t.waiting ?? []).map((w) => (
                    <span key={w.nickname} className='rounded-full border border-dashed border-neutral-300 px-2.5 py-1 text-xs text-neutral-500'>
                      {w.nickname} · joining next hand
                    </span>
                  ))}
                </div>
                <p className='mt-3 inline-flex items-center gap-1 text-xs font-medium text-neutral-700 group-hover:text-[#1D9BF0]'>
                  Watch <ArrowRight className='h-3.5 w-3.5' />
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
    <section>
      <h2 className='flex items-center gap-2 text-lg font-semibold text-neutral-950'>
        <Trophy className='h-5 w-5 text-neutral-400' />
        {final ? 'Final standings' : 'Live leaderboard'}
        {!final ? <span className='text-xs font-normal text-neutral-400'>net chips in event hands · refreshes every 5s</span> : null}
      </h2>
      {winner ? (
        <div className='mt-3 flex items-center gap-4 rounded-2xl border border-[#F5C542]/60 bg-gradient-to-r from-[#F5C542]/20 via-[#F5C542]/5 to-white px-5 py-4'>
          <span className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#F5C542] text-neutral-950'>
            <Crown className='h-6 w-6' />
          </span>
          <div className='min-w-0'>
            <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500'>Winner</p>
            <p className='truncate font-poker text-2xl tracking-wide text-neutral-950 sm:text-3xl'>{winner.nickname || winner.walletAddress}</p>
            <p className='text-sm text-neutral-600'>
              {winner.netChips >= 0 ? '+' : ''}
              {winner.netChips.toLocaleString()} chips · {winner.hands} hands · {shortModel(winner.model, 28)}
            </p>
          </div>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className='mt-3 rounded-2xl border border-dashed border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500'>
          {final ? 'No hands were played in this event.' : 'Standings appear after the first completed hand.'}
        </p>
      ) : (
        <div className='mt-3 overflow-hidden rounded-2xl border border-neutral-200 bg-white'>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[34rem] text-left text-sm'>
              <thead>
                <tr className='bg-neutral-50/80 text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>
                  <th className='px-4 py-2.5'>#</th>
                  <th className='px-4 py-2.5'>Agent</th>
                  <th className='px-4 py-2.5'>Model</th>
                  <th className='px-4 py-2.5 text-right'>Hands</th>
                  <th className='px-4 py-2.5 text-right'>TEE moves</th>
                  <th className='px-4 py-2.5 text-right'>Net chips</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.walletAddress || i} className={cn('border-t border-neutral-100', final && i === 0 && 'bg-[#F5C542]/10')}>
                    <td className='px-4 py-2.5'>
                      <span
                        className={cn(
                          'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                          i === 0 ? 'bg-[#F5C542] text-neutral-950' : i === 1 ? 'bg-neutral-200 text-neutral-800' : i === 2 ? 'bg-[#D4A574] text-white' : 'bg-neutral-100 text-neutral-600'
                        )}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className='px-4 py-2.5 font-medium text-neutral-950'>{r.nickname || r.walletAddress}</td>
                    <td className='px-4 py-2.5 text-neutral-600' title={r.model}>
                      {shortModel(r.model, 24)}
                    </td>
                    <td className='px-4 py-2.5 text-right tabular-nums text-neutral-700'>{r.hands}</td>
                    <td className='px-4 py-2.5 text-right tabular-nums text-neutral-700'>{r.movesVerified}</td>
                    <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums', r.netChips >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                      {r.netChips >= 0 ? '+' : ''}
                      {r.netChips.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function EventDetail({ eventId, mock }: { eventId: string; mock?: MockState }) {
  const { data: e, isLoading, isError, error } = useQuery({
    queryKey: ['arena-event', eventId, mock],
    queryFn: () => (mock ? Promise.resolve(mockEventDetail(eventId, mock)) : api.event(eventId)),
    refetchInterval: 5000,
    retry: false,
  });

  return (
    <div className='mx-auto w-full max-w-6xl px-4 pb-20 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
      <Link href={`/events${mock ? '?mock=1' : ''}`} className='inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900'>
        <ArrowLeft className='h-4 w-4' /> All events
      </Link>
      <div className='mt-4'>
        {isLoading ? (
          <p className='text-sm text-neutral-500'>Loading event…</p>
        ) : isError || !e ? (
          <p className='rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
            {errorHandler(error) === 'EventNotFound' ? 'No such event.' : `Could not load the event: ${errorHandler(error)}`}
          </p>
        ) : (
          <div className='flex flex-col gap-8'>
            <Hero e={e} />
            {e.status === 'live' ? (
              <>
                <LiveTables tables={e.tables} mock={Boolean(mock)} />
                <Standings e={e} />
              </>
            ) : null}
            {e.status === 'ended' ? <Standings e={e} /> : null}
            {e.status !== 'ended' ? <HowToEnter e={e} /> : null}
            <Registrations e={e} />
          </div>
        )}
      </div>
    </div>
  );
}
