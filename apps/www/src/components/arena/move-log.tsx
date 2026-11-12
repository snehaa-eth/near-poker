'use client';

import React from 'react';

import { api } from '~/lib/api';
import { mockArenaMoves, receiptUrl, shortModel } from '~/lib/arena';
import { formatTokens } from '~/lib/format';

import { useQuery } from '@tanstack/react-query';

import { Card } from '~/components/ui/card';
import { DataTable, TD, TH, THead, TR } from '~/components/ui/data-table';
import { Term } from '~/components/ui/term';

import { ArrowUpRight, ShieldCheck } from 'lucide-react';

/** INTERFACES §5.4 — TEE-signed moves for one arena hand. Renders nothing when empty. */
export const HandMoveLog = ({ handId, mock = false }: { handId: string; mock?: boolean }) => {
  const { data, isError } = useQuery({
    queryKey: ['arena-moves', handId, mock],
    queryFn: () => (mock ? Promise.resolve(mockArenaMoves()) : api.arenaMoves(handId)),
    retry: false,
  });

  if (isError || !data || data.length === 0) return null;

  const Receipt = ({ m }: { m: (typeof data)[number] }) => (
    <a
      href={receiptUrl(m)}
      target='_blank'
      rel='noopener noreferrer'
      title={`completion ${m.completionId} · signer ${m.signingAddress}`}
      className='inline-flex h-8 items-center gap-1 rounded-xs px-2 text-caption font-semibold text-accent hover:bg-accent-soft max-sm:h-11'
    >
      <ShieldCheck className='size-3.5' aria-hidden />
      Receipt
      <ArrowUpRight className='size-3.5' aria-hidden />
      <span className='sr-only'>(opens NEAR AI Verification Center)</span>
    </a>
  );

  return (
    <section aria-labelledby='moves-h'>
      <h2 id='moves-h' className='text-h3 font-semibold'>
        Agent moves {mock ? <span className='text-caption font-normal text-fg-subtle'>(demo)</span> : null}
      </h2>
      <p className='mt-1 max-w-[64ch] text-caption text-fg-muted'>
        Each move came from a NEAR AI Cloud model running in a <Term t='tee'>TEE</Term>; its signed{' '}
        <Term t='receipt'>receipt</Term> was checked before the move was applied. Open one to re-check it in the NEAR AI
        Verification Center.
      </p>
      <Card className='mt-4 overflow-hidden p-0 sm:p-0'>
        <div className='hidden sm:block'>
          <DataTable>
            <THead>
              <tr>
                <TH className='w-10'>#</TH>
                <TH>Agent</TH>
                <TH>Action</TH>
                <TH numeric>Amount</TH>
                <TH className='hidden md:table-cell'>Model</TH>
                <TH className='text-right'>Receipt</TH>
              </tr>
            </THead>
            <tbody>
              {data.map((m, i) => (
                <TR key={`${m.completionId}-${i}`}>
                  <TD className='tabular-nums text-fg-subtle'>{i + 1}</TD>
                  <TD className='max-w-[12rem] truncate font-semibold' title={m.playerId}>
                    {m.nickname || m.playerId}
                  </TD>
                  <TD className='capitalize text-fg-muted'>{m.action}</TD>
                  <TD numeric className='text-fg-muted'>
                    {m.amount ? formatTokens(m.amount) : '—'}
                  </TD>
                  <TD className='hidden font-mono text-[12px] text-fg-subtle md:table-cell' title={m.model}>
                    {shortModel(m.model, 22)}
                  </TD>
                  <TD className='text-right'>
                    <Receipt m={m} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </DataTable>
        </div>
        <ol className='divide-y divide-border sm:hidden'>
          {data.map((m, i) => (
            <li key={`${m.completionId}-${i}`} className='flex min-h-14 items-center gap-3 px-4 py-2'>
              <span className='w-5 text-caption tabular-nums text-fg-subtle'>{i + 1}</span>
              <span className='min-w-0 flex-1 truncate'>
                <span className='font-semibold'>{m.nickname || m.playerId}</span>{' '}
                <span className='text-fg-muted'>
                  {m.action}
                  {m.amount ? ` ${formatTokens(m.amount)}` : ''}
                </span>
              </span>
              <Receipt m={m} />
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
};
