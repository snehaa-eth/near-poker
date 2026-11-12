'use client';

import Link from 'next/link';

import { useLatestHands } from '~/lib/hooks/use-latest-hand';
import { cn } from '~/lib/utils';

import { ArrowRight, ShieldCheck } from 'lucide-react';

/** Proof strip: the latest real hand, one click from the verifier. */
export function LatestHandStrip({ className }: { className?: string }) {
  const { data, isLoading, isError } = useLatestHands(1);
  const last = data?.[0];
  if (isLoading) return <div className={cn('skeleton h-[72px] rounded-md', className)} aria-hidden />;
  if (isError || !last) return null;
  const when = last.createdAt ? new Date(last.createdAt) : null;
  return (
    <Link
      href={`/verify/${encodeURIComponent(last.handId)}`}
      className={cn(
        'group flex flex-col gap-3 rounded-md border border-border bg-surface p-4 transition-colors hover:border-accent sm:flex-row sm:items-center sm:justify-between sm:px-6',
        className
      )}
    >
      <span className='flex items-center gap-3'>
        <span className='inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent'>
          <ShieldCheck className='size-5' aria-hidden />
        </span>
        <span>
          <span className='block font-semibold text-fg'>Check the latest hand yourself</span>
          <span className='block text-caption text-fg-subtle'>
            {last.gameName}
            {when ? ` · ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''} · hand{' '}
            <span className='font-mono'>{last.handId.slice(0, 8)}</span>
          </span>
        </span>
      </span>
      <span className='inline-flex items-center gap-1 text-caption font-semibold text-accent'>
        Verify in your browser <ArrowRight className='size-4 transition-transform group-hover:translate-x-0.5' aria-hidden />
      </span>
    </Link>
  );
}
