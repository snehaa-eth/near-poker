'use client';

import * as React from 'react';

import { cn } from '~/lib/utils';

import { RefreshCw, WifiOff } from 'lucide-react';

import { Button } from './button';

/** Empty state (§8.11): icon, title, one sentence, one primary + one secondary action. */
export function EmptyState({
  icon,
  title,
  children,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-md border border-dashed border-border-strong px-6 py-12 text-center', className)}>
      {icon ? <div className='text-fg-subtle [&_svg]:size-6'>{icon}</div> : null}
      <p className='text-body font-semibold text-fg'>{title}</p>
      {children ? <div className='max-w-[48ch] text-caption text-fg-muted'>{children}</div> : null}
      {actions ? <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>{actions}</div> : null}
    </div>
  );
}

/**
 * Error / offline state (§8.11): negative left bar, human sentence, Retry,
 * "last updated" when known. Never show a raw error string here.
 */
export function ErrorState({
  title = 'The lights are off in the back room',
  children = 'We can’t reach the game server right now. Nothing’s lost: the tables pick up where they left off when it’s back.',
  onRetry,
  retrying,
  lastUpdated,
  className,
}: {
  title?: React.ReactNode;
  children?: React.ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  lastUpdated?: number | null;
  className?: string;
}) {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (!lastUpdated) return;
    const t = setInterval(force, 1000);
    return () => clearInterval(t);
  }, [lastUpdated]);
  const ago = lastUpdated ? Math.max(0, Math.round((Date.now() - lastUpdated) / 1000)) : null;
  return (
    <div
      role='status'
      className={cn(
        'flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-[inset_2px_0_0_var(--negative)] sm:flex-row sm:items-center sm:justify-between sm:p-6',
        className
      )}
    >
      <div className='flex gap-3'>
        <WifiOff className='mt-0.5 size-5 shrink-0 text-fg-subtle' aria-hidden strokeWidth={1.75} />
        <div>
          <p className='font-semibold text-fg'>{title}</p>
          <p className='text-caption text-fg-muted'>
            {children}
            {ago != null ? <span className='ml-1 text-fg-subtle'>Last updated {formatAgo(ago)}.</span> : null}
          </p>
        </div>
      </div>
      {onRetry ? (
        <Button variant='secondary' size='md' onClick={onRetry} disabled={retrying} className='shrink-0'>
          <RefreshCw className={cn(retrying && 'animate-spin')} aria-hidden />
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      ) : null}
    </div>
  );
}

function formatAgo(s: number) {
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** Page header: italic kicker + serif h1 (≤6 words, never numbers) + lead paragraph. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-8 flex flex-col gap-4 sm:mb-12 md:flex-row md:items-end md:justify-between', className)}>
      <div className='min-w-0 max-w-[60ch]'>
        {eyebrow ? <p className='kicker mb-2'>{eyebrow}</p> : null}
        <h1 className='font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-[0.01em] text-fg sm:text-[56px]'>{title}</h1>
        {lead ? <p className='mt-3 text-lead text-fg-muted'>{lead}</p> : null}
      </div>
      {actions ? <div className='flex shrink-0 flex-wrap gap-2'>{actions}</div> : null}
    </header>
  );
}

/** Standard page wrapper: clears the fixed nav, wide container, 48px bottom rhythm. */
export function Page({ children, narrow, className }: { children: React.ReactNode; narrow?: boolean; className?: string }) {
  return (
    <div className={cn('container-page pb-16 pt-[calc(var(--nav-h)+32px)] sm:pb-24 sm:pt-[calc(var(--nav-h)+48px)]', className)}>
      <div className={cn(narrow && 'mx-auto max-w-narrow')}>{children}</div>
    </div>
  );
}
