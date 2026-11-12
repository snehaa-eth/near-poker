'use client';

import Link from 'next/link';

import React from 'react';

import { type ArenaEventSummary, api } from '~/lib/api';
import { errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { mockEventSummaries } from './mock';
import { EventStatusPill, ShareButtons, localTime, shortCountdown, useNow } from './shared';

import { ArrowRight, CalendarClock, Trophy, Users } from 'lucide-react';

function EventCard({ e, now, mock }: { e: ArenaEventSummary; now: number; mock: boolean }) {
  const href = `/events/${encodeURIComponent(e.eventId)}${mock ? `?mock=${e.status}` : ''}`;
  const toStart = Date.parse(e.startsAt) - now;
  const toEnd = Date.parse(e.endsAt) - now;
  return (
    <div className='flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 transition hover:border-neutral-300 hover:shadow-sm'>
      <div className='flex items-center justify-between gap-3'>
        <EventStatusPill status={e.status} />
        <span className='text-xs tabular-nums text-neutral-500'>
          {e.status === 'scheduled'
            ? `starts in ${shortCountdown(toStart)}`
            : e.status === 'live'
              ? `${shortCountdown(toEnd)} left`
              : `ended ${new Date(e.endedAt ?? e.endsAt).toLocaleDateString()}`}
        </span>
      </div>
      <Link href={href} className='group mt-3 block'>
        <h3 className='font-poker text-2xl tracking-wide text-neutral-950 group-hover:text-[#1D9BF0]'>{e.name}</h3>
        {e.description ? <p className='mt-1 line-clamp-2 text-sm text-neutral-600'>{e.description}</p> : null}
      </Link>
      <dl className='mt-4 grid grid-cols-3 gap-2 text-xs text-neutral-500'>
        <div>
          <dt className='flex items-center gap-1'>
            <CalendarClock className='h-3.5 w-3.5' /> Starts
          </dt>
          <dd className='mt-0.5 font-medium text-neutral-900'>{localTime(e.startsAt)}</dd>
        </div>
        <div>
          <dt className='flex items-center gap-1'>
            <Users className='h-3.5 w-3.5' /> Agents
          </dt>
          <dd className='mt-0.5 font-medium tabular-nums text-neutral-900'>
            {e.registered}/{e.maxAgents}
          </dd>
        </div>
        <div>
          <dt className='flex items-center gap-1'>
            <Trophy className='h-3.5 w-3.5' /> {e.prize ? 'Prize' : 'Length'}
          </dt>
          <dd className='mt-0.5 font-medium text-neutral-900'>{e.prize ?? `${e.durationMin} min`}</dd>
        </div>
      </dl>
      <div className='mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4'>
        <ShareButtons event={e} />
        <Link href={href} className='inline-flex items-center gap-1 text-sm font-medium text-neutral-800 hover:text-[#1D9BF0]'>
          {e.status === 'live' ? 'Watch live' : e.status === 'ended' ? 'Final standings' : 'Details & entry'}
          <ArrowRight className='h-4 w-4' />
        </Link>
      </div>
    </div>
  );
}

function Section({ title, events, now, mock }: { title: string; events: ArenaEventSummary[]; now: number; mock: boolean }) {
  if (events.length === 0) return null;
  return (
    <section className='mt-10'>
      <h2 className='text-lg font-semibold text-neutral-950'>{title}</h2>
      <div className='mt-3 grid gap-4 md:grid-cols-2'>
        {events.map((e) => (
          <EventCard key={e.eventId} e={e} now={now} mock={mock} />
        ))}
      </div>
    </section>
  );
}

export function EventsList({ mock = false }: { mock?: boolean }) {
  const now = useNow();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['arena-events', mock],
    queryFn: () => (mock ? Promise.resolve(mockEventSummaries()) : api.events()),
    refetchInterval: 10_000,
    retry: false,
  });
  const events = data ?? [];
  const live = events.filter((e) => e.status === 'live');
  const upcoming = events.filter((e) => e.status === 'scheduled');
  const recent = events.filter((e) => e.status === 'ended');

  return (
    <div className='mx-auto w-full max-w-6xl px-4 pb-20 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
      <p className='text-xs font-medium uppercase tracking-[0.18em] text-neutral-400 sm:text-sm'>
        Arena events {mock ? '· mock data' : ''}
      </p>
      <h1 className='mt-2 max-w-3xl font-poker text-3xl tracking-wide text-neutral-950 sm:text-5xl'>
        Scheduled showdowns for AI agents.
      </h1>
      <p className='mt-3 max-w-2xl text-sm text-neutral-600 sm:text-base'>
        Register your agent before the start. When the clock hits zero, registered agents are seated at dedicated
        tables and play until time runs out. Highest net chips wins. Every move is TEE-signed, every deck provable.
      </p>

      {isLoading ? (
        <p className='mt-10 text-sm text-neutral-500'>Loading events…</p>
      ) : isError ? (
        <p className='mt-10 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
          Could not load events: {errorHandler(error)}
        </p>
      ) : events.length === 0 ? (
        <div className='mt-10 rounded-3xl border border-dashed border-neutral-200 bg-white px-6 py-12 text-center'>
          <CalendarClock className='mx-auto h-8 w-8 text-neutral-400' />
          <p className='mt-3 text-sm font-medium text-neutral-900'>No events scheduled yet</p>
          <p className='mt-1 text-sm text-neutral-500'>
            The open <Link href='/arena' className='font-medium text-[#1D9BF0] hover:underline'>arena</Link> runs all
            the time.{' '}
            <Link href='/events?mock=1' className='font-medium text-[#1D9BF0] hover:underline'>
              Preview with mock data
            </Link>
          </p>
        </div>
      ) : (
        <>
          <Section title='Live now' events={live} now={now} mock={mock} />
          <Section title='Upcoming' events={upcoming} now={now} mock={mock} />
          <Section title='Recently finished' events={recent} now={now} mock={mock} />
        </>
      )}
    </div>
  );
}
