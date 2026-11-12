'use client';

import React, { useEffect, useState } from 'react';

import type { ArenaEventSummary } from '~/lib/api';
import { cn } from '~/lib/utils';

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

const STATUS: Record<ArenaEventSummary['status'], { label: string; cls: string; dot: string }> = {
  scheduled: { label: 'Upcoming', cls: 'border-sky-200 bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  live: { label: 'Live now', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500 animate-pulse' },
  ended: { label: 'Ended', cls: 'border-neutral-200 bg-neutral-100 text-neutral-600', dot: 'bg-neutral-400' },
};

export function EventStatusPill({ status, className }: { status: ArenaEventSummary['status']; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', s.cls, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
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
  const base = 'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition';
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <button
        type='button'
        onClick={copy}
        className={cn(
          base,
          dark ? 'bg-white text-neutral-950 hover:bg-neutral-200' : 'border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50'
        )}
      >
        {copied ? <Check className='h-4 w-4 text-emerald-600' /> : <Link2 className='h-4 w-4' />}
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <a
        href={xHref()}
        onClick={(ev) => {
          ev.currentTarget.href = xHref();
        }}
        target='_blank'
        rel='noopener noreferrer'
        className={cn(base, dark ? 'bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15' : 'bg-neutral-950 text-white hover:bg-neutral-800')}
      >
        <span className='font-semibold'>𝕏</span> Share
      </a>
    </div>
  );
}
