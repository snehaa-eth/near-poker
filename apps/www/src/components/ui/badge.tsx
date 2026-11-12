import * as React from 'react';

import { cn } from '~/lib/utils';

import { ShieldCheck } from 'lucide-react';

/**
 * DESIGN-SYSTEM §8.2. Pills are ONLY for status, LIVE and "Verified".
 * Everything else is a Chip (6px radius).
 */
export type Status = 'playing' | 'waiting' | 'shuffling' | 'finished' | 'offline' | 'live';

const DOT: Record<Status, string> = {
  playing: 'bg-accent',
  waiting: 'bg-warning',
  shuffling: 'bg-info',
  finished: 'bg-fg-subtle',
  offline: 'bg-fg-disabled',
  live: 'bg-live',
};

export function StatusDot({ status, pulse, className }: { status: Status; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT[status], pulse && 'live-dot', className)}
    />
  );
}

/** Status pill: 22px, dot + text label (never colour alone). */
export function StatusPill({
  status,
  children,
  className,
}: {
  status: Status;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 text-[12px] font-medium leading-4 text-fg',
        className
      )}
    >
      <StatusDot status={status} pulse={status === 'live'} />
      {children}
    </span>
  );
}

/** LIVE label: the only place --live red is used. */
export function LivePill({ className, label = 'Live' }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full bg-live/15 px-2.5 text-label uppercase text-[#FF8A95]',
        className
      )}
    >
      <StatusDot status='live' pulse />
      {label}
    </span>
  );
}

/** "Verified" pill (TEE receipt). Pass `compact` for the ✓-only version in dense rows. */
export function VerifiedPill({
  className,
  compact,
  label = 'Verified',
  title = 'TEE receipt: this move was signed inside a NEAR AI confidential model',
}: {
  className?: string;
  compact?: boolean;
  label?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[22px] items-center gap-1 rounded-full bg-accent-soft px-2 text-[12px] font-medium leading-4 text-accent',
        compact && 'px-1.5',
        className
      )}
    >
      <ShieldCheck className='size-3' aria-hidden strokeWidth={2} />
      {compact ? <span className='sr-only'>{label}</span> : label}
    </span>
  );
}

/** Neutral chip (6px radius): tags, model names, position chips, action tags. */
export function Chip({
  className,
  tone = 'default',
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'default' | 'accent' | 'outline' | 'subtle' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-xs px-1.5 text-[12px] font-semibold leading-4',
        tone === 'default' && 'bg-surface-3 text-fg',
        tone === 'accent' && 'bg-accent text-accent-ink',
        tone === 'outline' && 'border border-border-strong text-fg-muted',
        tone === 'subtle' && 'bg-surface-2 text-fg-subtle',
        tone === 'warning' && 'bg-warning/15 text-warning',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Rank medallion: gold/silver/bronze for 1–3, plain number otherwise. */
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const medal = rank === 1 ? 'bg-gold' : rank === 2 ? 'bg-silver' : rank === 3 ? 'bg-bronze' : null;
  if (!medal) {
    return <span className={cn('inline-flex w-6 justify-center text-caption font-semibold tabular-nums text-fg-muted', className)}>{rank}</span>;
  }
  return (
    <span
      aria-label={`Rank ${rank}`}
      className={cn('inline-flex size-6 items-center justify-center rounded-full text-[12px] font-bold tabular-nums text-accent-ink', medal, className)}
    >
      {rank}
    </span>
  );
}
