'use client';

import React from 'react';

import { api } from '~/lib/api';
import { mockArenaMoves, receiptUrl, shortModel } from '~/lib/arena';
import { formatTokens } from '~/lib/format';

import { useQuery } from '@tanstack/react-query';

import { ArrowUpRight } from 'lucide-react';

/** INTERFACES §5.4 — TEE-signed moves for one arena hand. Renders nothing when empty. */
export const HandMoveLog = ({
  handId,
  mock = false,
}: {
  handId: string;
  mock?: boolean;
}) => {
  const { data, isError } = useQuery({
    queryKey: ['arena-moves', handId, mock],
    queryFn: () =>
      mock ? Promise.resolve(mockArenaMoves()) : api.arenaMoves(handId),
    retry: false,
  });

  if (isError || !data || data.length === 0) return null;

  return (
    <section className='mt-8'>
      <h2 className='text-lg font-semibold text-neutral-950'>
        Agent moves {mock ? '(mock)' : ''}
      </h2>
      <p className='mt-1 text-sm text-neutral-600'>
        Every move below was produced by a NEAR AI Cloud model inside a TEE and
        its signed receipt was checked before it was applied. Open a receipt to
        re-check it in the NEAR AI Verification Center.
      </p>
      <div className='mt-3 overflow-hidden rounded-2xl border border-neutral-200 bg-white'>
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[34rem] border-collapse text-left text-sm'>
            <thead>
              <tr className='bg-neutral-50/80 text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>
                <th className='px-4 py-2.5 font-semibold'>#</th>
                <th className='px-4 py-2.5 font-semibold'>Player</th>
                <th className='px-4 py-2.5 font-semibold'>Action</th>
                <th className='px-4 py-2.5 text-right font-semibold'>Amount</th>
                <th className='px-4 py-2.5 font-semibold'>Model</th>
                <th className='px-4 py-2.5 text-right font-semibold'>
                  Receipt
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((m, i) => (
                <tr
                  key={`${m.completionId}-${i}`}
                  className='border-t border-neutral-100'
                >
                  <td className='px-4 py-2.5 tabular-nums text-neutral-400'>
                    {i + 1}
                  </td>
                  <td
                    className='max-w-[12rem] truncate px-4 py-2.5 font-medium text-neutral-900'
                    title={m.playerId}
                  >
                    {m.nickname || m.playerId}
                  </td>
                  <td className='px-4 py-2.5 capitalize text-neutral-700'>
                    {m.action}
                  </td>
                  <td className='px-4 py-2.5 text-right tabular-nums text-neutral-700'>
                    {m.amount ? formatTokens(m.amount) : '—'}
                  </td>
                  <td
                    className='px-4 py-2.5 font-mono text-xs text-neutral-600'
                    title={m.model}
                  >
                    {shortModel(m.model, 22)}
                  </td>
                  <td className='px-4 py-2.5 text-right'>
                    <a
                      href={receiptUrl(m)}
                      target='_blank'
                      rel='noopener noreferrer'
                      title={`completion ${m.completionId} · signer ${m.signingAddress}`}
                      className='inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100'
                    >
                      receipt ✓
                      <ArrowUpRight className='h-3 w-3' />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
