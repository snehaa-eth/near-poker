'use client';

import React, { useEffect, useState } from 'react';

import type { ArenaEventSummary } from '~/lib/api';
import { cn } from '~/lib/utils';

import { LivePill, type Status, StatusPill } from '~/components/ui/badge';
import { Button, buttonVariants } from '~/components/ui/button';

import { Check, Link2 } from 'lucide-react';

/** Re-render every `ms` (countdowns). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function splitDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export function shortCountdown(ms: number) {
  const { d, h, m, s } = splitDuration(ms);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** "Fri, Nov 14 · 14:30 GMT+1" in the viewer's time zone. */
export function localTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/** "Nov 14, 14:30 UTC" for share text (same for everyone). */
export function utcTime(iso: string) {
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${month} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
}

const STATUS: Record<ArenaEventSummary['status'], { label: string; status: Status }> = {
  scheduled: { label: 'Upcoming', status: 'waiting' },
  live: { label: 'Live now', status: 'live' },
  ended: { label: 'Ended', status: 'finished' },
};

export function EventStatusPill({ status, className }: { status: ArenaEventSummary['status']; className?: string }) {
  const s = STATUS[status];
  if (status === 'live') return <LivePill label={s.label} className={className} />;
  return (
    <StatusPill status={s.status} className={className}>
      {s.label}
    </StatusPill>
  );
}

export function shareText(e: Pick<ArenaEventSummary, 'name' | 'startsAt'>) {
  return `Bring your AI agent to Dark Table — ${e.name} starts ${utcTime(e.startsAt)} #NEARHackathon @NEARProtocol`;
}

/** Copy-link + post-on-X buttons. */
export function ShareButtons({ event, dark = false }: { event: Pick<ArenaEventSummary, 'name' | 'startsAt' | 'eventId'>; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = () => (typeof window !== 'undefined' ? `${window.location.origin}/events/${event.eventId}` : `/events/${event.eventId}`);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link', url());
    }
  };
  const xHref = () =>
    `https://x.com/intent/post?text=${encodeURIComponent(shareText(event))}&url=${encodeURIComponent(url())}`;
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button type='button' variant='secondary' size='sm' onClick={copy} className={cn(dark && 'bg-surface-3')}>
        {copied ? <Check className='text-accent' aria-hidden /> : <Link2 aria-hidden />}
        <span aria-live='polite'>{copied ? 'Link copied' : 'Copy link'}</span>
      </Button>
      <a
        href={xHref()}
        onClick={(ev) => {
          ev.currentTarget.href = xHref();
        }}
        target='_blank'
        rel='noopener noreferrer'
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        Share on X
        <span className='sr-only'>(opens in a new tab)</span>
      </a>
    </div>
  );
}
