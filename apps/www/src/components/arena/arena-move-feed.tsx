'use client';

import React, { useMemo, useState } from 'react';

import type { ArenaMoveRecord } from '~/lib/api';
import { api } from '~/lib/api';
import { mockArenaMoves, receiptUrl, shortModel } from '~/lib/arena';
import { formatTokens } from '~/lib/format';
import { cn } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { ArrowUpRight, ChevronDown } from 'lucide-react';

const ROW =
  'grid grid-cols-[1.75rem_minmax(0,1fr)_4.25rem_3rem_3.25rem] items-center gap-x-2 px-3';

function actionTone(action: string) {
  const a = action.toLowerCase();
  if (a === 'fold') return 'bg-neutral-200 text-neutral-700';
  if (a === 'check') return 'bg-sky-100 text-sky-800';
  if (a === 'call') return 'bg-emerald-100 text-emerald-800';
  if (a === 'raise') return 'bg-amber-100 text-amber-900';
  return 'bg-neutral-100 text-neutral-700';
}

function MoveRow({
  move,
  index,
  highlight,
}: {
  move: ArenaMoveRecord;
  index: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        ROW,
        'py-2 text-sm',
        highlight ? 'bg-emerald-50/80' : 'bg-white'
      )}
    >
      <span className='tabular-nums text-xs text-neutral-400'>{index + 1}</span>
      <span
        className='truncate font-medium text-neutral-900'
        title={move.nickname || move.playerId}
      >
        {move.nickname || move.playerId}
      </span>
      <span className='flex justify-center'>
        <span
          className={cn(
            'inline-flex min-w-[3.5rem] justify-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            actionTone(move.action)
          )}
        >
          {move.action}
        </span>
      </span>
      <span className='text-right tabular-nums text-neutral-600'>
        {move.amount != null ? formatTokens(move.amount) : '—'}
      </span>
      <span className='flex justify-end'>
        <a
          href={receiptUrl(move)}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100'
          title={shortModel(move.model, 28)}
        >
          TEE
          <ArrowUpRight className='h-3 w-3' />
        </a>
      </span>
    </div>
  );
}

/** Live ticker + expandable TEE move log for the current hand. */
export function ArenaMoveFeed({
  handId,
  mock = false,
  nextPlayerNickname,
  defaultOpen = false,
}: {
  handId?: string | null;
  mock?: boolean;
  nextPlayerNickname?: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { data } = useQuery({
    queryKey: ['arena-moves', handId, mock],
    queryFn: () =>
      mock
        ? Promise.resolve(mockArenaMoves())
        : handId
          ? api.arenaMoves(handId)
          : Promise.resolve([]),
    enabled: Boolean(handId) || mock,
    refetchInterval: handId && !mock ? 2_000 : false,
    retry: false,
  });

  const moves = data ?? [];
  const latest = moves.length > 0 ? moves[moves.length - 1]! : null;

  const waitingLabel = useMemo(() => {
    if (latest) return null;
    if (nextPlayerNickname) return `Waiting on ${nextPlayerNickname}…`;
    return 'Waiting for the first TEE move…';
  }, [latest, nextPlayerNickname]);

  return (
    <div className='overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm'>
      <div className='flex items-center gap-3 border-b border-neutral-100 px-3 py-2.5'>
        <span className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-700'>
          AI
        </span>
        {latest ? (
          <p className='min-w-0 flex-1 truncate text-sm text-neutral-800'>
            <span className='font-semibold text-neutral-950'>
              {latest.nickname || latest.playerId}
            </span>{' '}
            <span
              className={cn(
                'mx-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                actionTone(latest.action)
              )}
            >
              {latest.action}
            </span>
            {latest.amount != null ? (
              <span className='tabular-nums text-neutral-600'>
                {formatTokens(latest.amount)}
              </span>
            ) : null}
            <span className='ml-2 font-mono text-[11px] text-neutral-400'>
              {shortModel(latest.model, 18)}
            </span>
          </p>
        ) : (
          <p className='flex-1 text-sm text-neutral-500'>{waitingLabel}</p>
        )}
        <span className='shrink-0 tabular-nums text-xs text-neutral-400'>
          {moves.length} move{moves.length === 1 ? '' : 's'}
        </span>
      </div>

      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:bg-neutral-50'
      >
        Table chat &amp; actions
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className='max-h-56 overflow-y-auto border-t border-neutral-100'>
          {moves.length === 0 ? (
            <p className='px-3 py-4 text-sm text-neutral-500'>
              No accepted TEE moves for this hand yet.
            </p>
          ) : (
            <>
              <div
                className={cn(
                  ROW,
                  'border-b border-neutral-100 bg-neutral-50/80 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400'
                )}
              >
                <span>#</span>
                <span>Player</span>
                <span className='text-center'>Action</span>
                <span className='text-right'>Amt</span>
                <span className='text-right'>Tee</span>
              </div>
              <div className='divide-y divide-neutral-100'>
                {moves.map((m, i) => (
                  <MoveRow
                    key={`${m.completionId}-${i}`}
                    move={m}
                    index={i}
                    highlight={i === moves.length - 1}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
