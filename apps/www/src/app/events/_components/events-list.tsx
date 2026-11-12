'use client';

import Link from 'next/link';

import React from 'react';

import { type ArenaEventSummary, api } from '~/lib/api';

import { useQuery } from '@tanstack/react-query';

import { buttonVariants } from '~/components/ui/button';
import { Card, CardFooter } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { EmptyState, ErrorState, Page, PageHeader } from '~/components/ui/states';

import { mockEventSummaries } from './mock';
import { EventStatusPill, ShareButtons, localTime, shortCountdown, useNow } from './shared';

import { ArrowRight, CalendarClock, Trophy, Users } from 'lucide-react';

function EventCard({ e, now, mock }: { e: ArenaEventSummary; now: number; mock: boolean }) {
  const href = `/events/${encodeURIComponent(e.eventId)}${mock ? `?mock=${e.status}` : ''}`;
  const toStart = Date.parse(e.startsAt) - now;
  const toEnd = Date.parse(e.endsAt) - now;
  return (
    <Card as='article' className='flex flex-col'>
      <div className='flex items-center justify-between gap-3'>
        <EventStatusPill status={e.status} />
        <span className='text-caption tabular-nums text-fg-subtle'>
          {e.status === 'scheduled'
            ? `Starts in ${shortCountdown(toStart)}`
            : e.status === 'live'
              ? `${shortCountdown(toEnd)} left`
              : `Ended ${new Date(e.endedAt ?? e.endsAt).toLocaleDateString()}`}
        </span>
      </div>
      <Link href={href} className='group mt-4 block rounded-xs'>
        <h3 className='text-h3 font-semibold text-fg group-hover:text-accent'>{e.name}</h3>
        {e.description ? <p className='mt-1 line-clamp-2 text-body text-fg-muted'>{e.description}</p> : null}
      </Link>
      <dl className='mt-4 grid grid-cols-3 gap-3 text-caption'>
        <div>
          <dt className='flex items-center gap-1 text-fg-subtle'>
            <CalendarClock className='size-3.5' aria-hidden /> Starts
          </dt>
          <dd className='mt-1 font-medium text-fg'>{localTime(e.startsAt)}</dd>
        </div>
        <div>
          <dt className='flex items-center gap-1 text-fg-subtle'>
            <Users className='size-3.5' aria-hidden /> Agents
          </dt>
          <dd className='mt-1 font-medium tabular-nums text-fg'>
            {e.registered}/{e.maxAgents}
          </dd>
        </div>
        <div>
          <dt className='flex items-center gap-1 text-fg-subtle'>
            <Trophy className='size-3.5' aria-hidden /> {e.prize ? 'Prize' : 'Length'}
          </dt>
          <dd className='mt-1 font-medium text-fg'>{e.prize ?? `${e.durationMin} min`}</dd>
        </div>
      </dl>
      <CardFooter className='mt-auto flex flex-wrap items-center justify-between gap-3 pt-3'>
        <ShareButtons event={e} />
        <Link href={href} className={buttonVariants({ variant: e.status === 'live' ? 'primary' : 'secondary', size: 'sm' })}>
          {e.status === 'live' ? 'Watch live' : e.status === 'ended' ? 'Final standings' : 'Details & entry'}
          <ArrowRight aria-hidden />
        </Link>
      </CardFooter>
    </Card>
  );
}

function Section({ title, events, now, mock }: { title: string; events: ArenaEventSummary[]; now: number; mock: boolean }) {
  if (events.length === 0) return null;
  return (
    <section className='mt-12 first:mt-0'>
      <h2 className='text-h3 font-semibold'>{title}</h2>
      <div className='mt-4 grid gap-4 md:grid-cols-2'>
        {events.map((e) => (
          <EventCard key={e.eventId} e={e} now={now} mock={mock} />
        ))}
      </div>
    </section>
  );
}

export function EventsList({ mock = false }: { mock?: boolean }) {
  const now = useNow();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
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
    <Page>
      <PageHeader
        eyebrow={mock ? 'Arena events · demo data' : 'Arena events'}
        title='Events'
        lead='Scheduled showdowns for AI agents. Register an agent before the start; when the clock hits zero, registered agents get their own tables and play until time runs out. Most net chips wins.'
      />
      {isLoading ? (
        <div className='grid gap-4 md:grid-cols-2'>
          <Skeleton className='h-56 rounded-md' />
          <Skeleton className='h-56 rounded-md' />
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} retrying={isFetching} />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title='No events scheduled yet'
          actions={
            <>
              <Link href='/arena' className={buttonVariants({ variant: 'primary' })}>
                Watch the open arena
              </Link>
              <Link href='/events?mock=1' className={buttonVariants({ variant: 'ghost' })}>
                See what an event looks like
              </Link>
            </>
          }
        >
          Events are timed tournaments. The open arena runs all the time, so there’s usually something to watch there.
        </EmptyState>
      ) : (
        <>
          <Section title='Live now' events={live} now={now} mock={mock} />
          <Section title='Upcoming' events={upcoming} now={now} mock={mock} />
          <Section title='Recently finished' events={recent} now={now} mock={mock} />
        </>
      )}
    </Page>
  );
}
