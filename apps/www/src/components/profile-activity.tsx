'use client';

import React, { useState } from 'react';

import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Spade,
} from 'lucide-react';

import { Button } from '~/components/ui/button';
import { type PlayerActivityEvent } from '~/lib/api';
import { formatNear, formatTokens } from '~/lib/format';
import { usePlayerActivity } from '~/lib/hooks';
import { cn } from '~/lib/utils';

type CategoryFilter = 'all' | 'deposit' | 'withdraw' | 'game';

const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'deposit', label: 'Deposits' },
  { id: 'withdraw', label: 'Withdrawals' },
  { id: 'game', label: 'Games' },
];

function categoryIcon(category: PlayerActivityEvent['category']) {
  if (category === 'deposit') return ArrowDownLeft;
  if (category === 'withdraw') return ArrowUpRight;
  return Spade;
}

function categoryTone(category: PlayerActivityEvent['category']) {
  if (category === 'deposit') return 'bg-emerald-50 text-emerald-700';
  if (category === 'withdraw') return 'bg-amber-50 text-amber-800';
  return 'bg-sky-50 text-sky-800';
}

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function amountLabel(event: PlayerActivityEvent) {
  const nearAmount = event.amountNear ?? event.amountNight;
  if (nearAmount != null) {
    const sign = event.category === 'withdraw' ? '−' : '+';
    return `${sign}${formatNear(Math.abs(nearAmount))} NEAR`;
  }
  if (event.amountChips != null) {
    const n = event.amountChips;
    const sign = n > 0 ? '+' : n < 0 ? '−' : '';
    return `${sign}${formatTokens(Math.abs(n))} chips`;
  }
  return null;
}

export function ProfileActivity({ enabled }: { enabled: boolean }) {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const limit = 10;

  const { data, isLoading, isFetching, isError, error, refetch } =
    usePlayerActivity({
      page,
      limit,
      category,
      enabled,
    });

  const events = data?.events ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  return (
    <section className='mt-12'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h2 className='text-lg font-semibold text-neutral-950'>Activity</h2>
          <p className='mt-1 text-sm text-neutral-500'>
            Deposits, withdrawals, and table play — loaded from the database.
          </p>
        </div>
        {total > 0 ? (
          <p className='text-xs tabular-nums text-neutral-400'>
            {total} event{total === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>

      <div className='mt-4 flex gap-2 overflow-x-auto pb-1'>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type='button'
            onClick={() => {
              setCategory(f.id);
              setPage(1);
            }}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition',
              category === f.id
                ? 'bg-neutral-950 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div
        className={cn(
          'mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white',
          isFetching && !isLoading && 'opacity-80'
        )}
      >
        {isLoading ? (
          <p className='px-4 py-8 text-center text-sm text-neutral-400'>
            Loading activity…
          </p>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 px-4 py-8 text-center'>
            <p className='text-sm text-neutral-500'>
              {error instanceof Error
                ? error.message
                : 'Could not load activity'}
            </p>
            <Button
              size='sm'
              variant='outline'
              className='rounded-full'
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          </div>
        ) : events.length === 0 ? (
          <p className='px-4 py-8 text-center text-sm text-neutral-400'>
            No activity yet. Deposit NEAR or join a table to get started.
          </p>
        ) : (
          <ul className='divide-y divide-neutral-100'>
            {events.map((event) => {
              const Icon = categoryIcon(event.category);
              const amount = amountLabel(event);
              return (
                <li
                  key={event.id}
                  className='flex items-start gap-3 px-4 py-3.5'
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      categoryTone(event.category)
                    )}
                  >
                    <Icon className='h-3.5 w-3.5' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-medium text-neutral-900'>
                      {event.summary}
                    </p>
                    <p className='mt-0.5 text-xs text-neutral-400'>
                      <span className='capitalize'>{event.category}</span>
                      <span className='mx-1.5 text-neutral-300'>·</span>
                      {formatWhen(event.createdAt)}
                      {event.gameId ? (
                        <>
                          <span className='mx-1.5 text-neutral-300'>·</span>
                          <span className='font-mono'>
                            {event.gameId.slice(0, 8)}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {amount ? (
                    <p
                      className={cn(
                        'shrink-0 text-sm font-semibold tabular-nums',
                        event.category === 'deposit' ||
                          (event.amountChips != null && event.amountChips > 0)
                          ? 'text-emerald-700'
                          : event.category === 'withdraw' ||
                              (event.amountChips != null &&
                                event.amountChips < 0)
                            ? 'text-amber-800'
                            : 'text-neutral-700'
                      )}
                    >
                      {amount}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 ? (
        <div className='mt-4 flex items-center justify-between gap-3'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='rounded-full'
            disabled={page <= 1 || isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className='mr-1 h-3.5 w-3.5' />
            Prev
          </Button>
          <p className='text-xs tabular-nums text-neutral-500'>
            Page {page} / {totalPages}
          </p>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='rounded-full'
            disabled={page >= totalPages || isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className='ml-1 h-3.5 w-3.5' />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
