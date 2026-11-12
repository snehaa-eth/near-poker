'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import React, { useState } from 'react';

import { useLatestHands } from '~/lib/hooks/use-latest-hand';

import { Button, buttonVariants } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { inputClass } from '~/components/ui/input';
import { SkeletonRows } from '~/components/ui/skeleton';
import { EmptyState, ErrorState, Page, PageHeader } from '~/components/ui/states';
import { Receipt } from '~/components/ui/receipt';
import { Term } from '~/components/ui/term';

import { ArrowRight } from 'lucide-react';

const HOW = [
  { title: 'Sealed', body: <>Before the deal, a fingerprint of the shuffle is <Term t='commit'>written to NEAR</Term>.</> },
  { title: 'Mixed', body: <>Each agent adds its own <Term t='entropy'>randomness</Term>, so nobody picks the deck alone.</> },
  { title: 'Checked', body: <>After the hand, your browser re-deals the deck and compares every card.</> },
];

export function VerifyIndex() {
  const router = useRouter();
  const [id, setId] = useState('');
  const { data, isLoading, isError, refetch, isFetching } = useLatestHands(8);
  return (
    <Page narrow>
      <PageHeader
        eyebrow='Trust, but check'
        title='Check a hand'
        lead='Pick any finished hand. Your browser re-deals it from the revealed data, and if one card differs from what was sealed before the deal, the slip comes back stamped REJECTED.'
      />
      <Receipt compact tilt={-0.6} className='max-w-[520px]' paperClassName='px-5 py-5 text-[13px] leading-[20px]' label='How the check works'>
        <ol className='flex flex-col gap-2'>
          {HOW.map((h) => (
            <li key={h.title} className='grid grid-cols-[84px_1fr] gap-2'>
              <span className='font-bold uppercase'>{h.title}</span>
              <span className='font-sans text-[14px] text-ink'>{h.body}</span>
            </li>
          ))}
        </ol>
      </Receipt>

      <form
        className='mt-12 flex flex-col gap-3 sm:flex-row sm:items-end'
        onSubmit={(e) => {
          e.preventDefault();
          if (id.trim()) router.push(`/verify/${encodeURIComponent(id.trim())}`);
        }}
      >
        <Field id='hand-id' label='Hand id' className='flex-1' hint='Shown in the table’s Hands tab, or at the end of every hand.'>
          <input id='hand-id' className={`${inputClass} font-mono`} value={id} onChange={(e) => setId(e.target.value)} placeholder='e.g. 83e434ad-87e8-…' aria-describedby='hand-id-hint' />
        </Field>
        <Button type='submit' size='lg' variant='secondary' className='sm:mb-[26px]'>
          Check it <ArrowRight aria-hidden />
        </Button>
      </form>

      <section className='mt-12' aria-labelledby='recent-h'>
        <h2 id='recent-h' className='text-h3 font-semibold'>
          Recent hands
        </h2>
        <div className='mt-4'>
          {isLoading ? (
            <Card className='p-0 sm:p-0'>
              <SkeletonRows rows={4} />
            </Card>
          ) : isError ? (
            <ErrorState onRetry={() => void refetch()} retrying={isFetching} />
          ) : !data || data.length === 0 ? (
            <EmptyState
              title='No finished hands yet'
              actions={
                <Link href='/verify/demo' className={buttonVariants({ variant: 'primary' })}>
                  Try the demo hand
                </Link>
              }
            >
              Hands show up here as soon as a table finishes one.
            </EmptyState>
          ) : (
            <Card className='overflow-hidden p-0 sm:p-0'>
              <ul className='divide-y divide-border'>
                {data.map((h) => (
                  <li key={h.handId}>
                    <Link href={`/verify/${encodeURIComponent(h.handId)}`} className='flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2 sm:px-6'>
                      <span aria-hidden className='font-mono text-[12px] text-fg-subtle'>#</span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate font-semibold'>{h.gameName}</span>
                        <span className='block truncate text-caption text-fg-subtle'>
                          {h.createdAt ? new Date(h.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''} ·{' '}
                          <span className='font-mono'>{h.handId.slice(0, 8)}</span>
                        </span>
                      </span>
                      <span className='text-caption font-semibold text-accent'>Verify</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <p className='mt-4 text-caption text-fg-subtle'>
          Just curious?{' '}
          <Link href='/verify/demo' className='link font-semibold'>
            Open the demo hand
          </Link>{' '}
          (six demo agents, generated in your browser).
        </p>
      </section>
    </Page>
  );
}
