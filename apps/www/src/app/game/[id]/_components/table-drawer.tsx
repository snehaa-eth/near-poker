'use client';

/**
 * The one table drawer (UI-AUDIT #8): Log · Proofs · Hands · Standings.
 * Closed by default. 360 px panel on the right (desktop), bottom sheet with 40% / 90% snaps
 * on phones. Esc closes; the parent returns focus to the button that opened it.
 */
import Link from 'next/link';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { api, type GameHandSummary } from '~/lib/api';
import { formatTokens } from '~/lib/format';
import { chipText } from '~/lib/seat-action-flash';
import { cn } from '~/lib/utils';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { useQuery } from '@tanstack/react-query';
import { useArenaLeaderboard } from '~/components/arena/agent-leaderboard';

import { ArrowUpRight, Eye, X } from 'lucide-react';

export type DrawerTab = 'log' | 'proofs' | 'hands' | 'standings';

export const DRAWER_TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'log', label: 'Log' },
  { id: 'proofs', label: 'Proofs' },
  { id: 'hands', label: 'Hands' },
  { id: 'standings', label: 'Standings' },
];

export const DRAWER_ID = 'table-drawer';

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return phone;
}

export function TableDrawer({
  open,
  tab,
  onTab,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  onClose: () => void;
  /** Panel body for the active tab. */
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const phone = useIsPhone();
  const reduce = useReducedMotion();
  const [snap, setSnap] = useState<'half' | 'full'>('half');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setSnap('half');
      // Focus the active tab so keyboard users land inside the drawer.
      window.setTimeout(() => tabRefs.current[tab]?.focus({ preventScroll: true }), 30);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, [open]);

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = DRAWER_TABS.findIndex((t) => t.id === tab);
    const next = DRAWER_TABS[(i + (e.key === 'ArrowRight' ? 1 : DRAWER_TABS.length - 1)) % DRAWER_TABS.length]!;
    onTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : phone
      ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }
      : { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } };

  return (
    <AnimatePresence>
      {open ? (
        <>
          {phone ? (
            <motion.div
              key='scrim'
              aria-hidden
              className='fixed inset-0 z-40 bg-[var(--scrim)]'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
            />
          ) : null}
          <motion.aside
            key='drawer'
            id={DRAWER_ID}
            role='dialog'
            aria-modal={phone ? true : undefined}
            aria-label='Table details'
            {...motionProps}
            transition={{ duration: reduce ? 0.15 : 0.28, ease: [0.3, 0, 0, 1] }}
            className={cn(
              'fixed z-50 flex flex-col border-border-strong bg-surface-2 shadow-[var(--shadow-e2)]',
              phone
                ? 'inset-x-0 bottom-0 rounded-t-lg border-t'
                : 'bottom-0 right-0 top-[var(--nav-h)] w-[360px] border-l'
            )}
            style={phone ? { height: snap === 'full' ? '90dvh' : '45dvh', transition: 'height 280ms cubic-bezier(.3,0,0,1)' } : undefined}
          >
            {phone ? (
              <button
                type='button'
                onClick={() => setSnap((s) => (s === 'half' ? 'full' : 'half'))}
                aria-label={snap === 'half' ? 'Expand drawer' : 'Shrink drawer'}
                className='flex h-6 w-full shrink-0 items-center justify-center'
              >
                <span aria-hidden className='h-1 w-10 rounded-full bg-border-strong' />
              </button>
            ) : null}
            <div className='flex shrink-0 items-center gap-1 border-b border-border px-2'>
              <div role='tablist' aria-label='Table details' className='flex flex-1' onKeyDown={onTabKey}>
                {DRAWER_TABS.map((t) => {
                  const active = t.id === tab;
                  return (
                    <button
                      key={t.id}
                      ref={(el) => {
                        tabRefs.current[t.id] = el;
                      }}
                      type='button'
                      role='tab'
                      id={`drawer-tab-${t.id}`}
                      aria-selected={active}
                      aria-controls={`drawer-panel-${t.id}`}
                      tabIndex={active ? 0 : -1}
                      onClick={() => onTab(t.id)}
                      className={cn(
                        'relative h-11 flex-1 px-1 text-label uppercase transition-colors duration-instant',
                        active ? 'text-fg' : 'text-fg-muted hover:text-fg'
                      )}
                    >
                      {t.label}
                      {active ? (
                        <span aria-hidden className='absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent' />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <button
                type='button'
                onClick={onClose}
                aria-label='Close drawer'
                className='inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg'
              >
                <X className='h-5 w-5' strokeWidth={1.75} />
              </button>
            </div>
            <div
              role='tabpanel'
              id={`drawer-panel-${tab}`}
              aria-labelledby={`drawer-tab-${tab}`}
              className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4'
            >
              {children}
            </div>
            {footer ? <div className='shrink-0 border-t border-border px-4 py-3'>{footer}</div> : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Hands                                                               */
/* ------------------------------------------------------------------ */

export type SessionHand = { handId: string; complete: boolean; winner?: string; amount?: number };

export function HandsPanel({
  gameId,
  mock,
  currentHandId,
  sessionHands,
  verifyHref,
}: {
  gameId: string;
  mock: boolean;
  currentHandId: string | null;
  /** Hands seen while watching (the only source on the mock table). */
  sessionHands: SessionHand[];
  verifyHref: (handId: string) => string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['game-hands', gameId],
    queryFn: () => api.gameHands(gameId, 12),
    enabled: !mock,
    refetchInterval: 5_000,
    retry: false,
  });

  const hands = useMemo(() => {
    // Unique hand ids, newest first; the session list adds winners for hands we watched.
    const byId = new Map<string, SessionHand & { createdAt?: string }>();
    for (const h of [...sessionHands].reverse()) byId.set(h.handId, h);
    for (const h of (data?.hands ?? []) as GameHandSummary[]) {
      const seen = byId.get(h.handId);
      byId.set(h.handId, {
        handId: h.handId,
        complete: h.complete !== false && (h.revealed ?? true),
        winner: seen?.winner,
        amount: seen?.amount,
        createdAt: h.createdAt,
      });
    }
    return [...byId.values()];
  }, [data, sessionHands]);

  if (!mock && isLoading && hands.length === 0) {
    return (
      <div className='flex flex-col gap-2' aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className='skeleton h-14 rounded-sm' />
        ))}
      </div>
    );
  }
  if (hands.length === 0) {
    return <p className='text-[13px] text-fg-subtle'>No hands yet — the first one deals when two agents are seated.</p>;
  }
  return (
    <ul className='divide-y divide-border'>
      {hands.map((h) => {
        const watching = h.handId === currentHandId && !h.complete;
        return (
          <li key={h.handId} className='flex min-h-14 items-center gap-3 py-2'>
            <div className='min-w-0 flex-1'>
              <p className='truncate font-mono text-[13px] text-fg'>#{h.handId.slice(0, 14)}</p>
              <p className='truncate text-[13px] text-fg-subtle'>
                {watching
                  ? 'In progress'
                  : h.winner
                    ? `${h.winner} won ${chipText(h.amount ?? 0)}`
                    : h.complete
                      ? 'Settled'
                      : 'In progress'}
              </p>
            </div>
            {watching ? (
              <span className='inline-flex h-9 items-center gap-1 px-2 text-[13px] font-medium text-fg-muted'>
                <Eye className='h-4 w-4' strokeWidth={1.75} />
                Watching
              </span>
            ) : h.complete ? (
              <Link
                href={verifyHref(h.handId)}
                className='inline-flex h-9 items-center gap-1 rounded-sm px-2 text-[13px] font-semibold text-accent hover:bg-surface-3'
              >
                Verify hand
                <ArrowUpRight className='h-4 w-4' />
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Standings                                                           */
/* ------------------------------------------------------------------ */

const MEDAL = ['bg-gold text-accent-ink', 'bg-silver text-accent-ink', 'bg-bronze text-accent-ink'];

export function StandingsPanel({
  mock,
  seated,
}: {
  mock: boolean;
  /** Nicknames at this table (highlighted). */
  seated: string[];
}) {
  const { data, isLoading, isError } = useArenaLeaderboard(mock);
  const rows = [...(data ?? [])]
    .sort((a, b) => b.netChips - a.netChips || b.hands - a.hands)
    .slice(0, 10);
  const here = new Set(seated.map((s) => s.toLowerCase()));
  // Only worth marking when the list isn't just this table.
  const mark = rows.some((e) => !here.has((e.nickname || '').toLowerCase()));

  if (isLoading) {
    return (
      <div className='flex flex-col gap-2' aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className='skeleton h-11 rounded-sm' />
        ))}
      </div>
    );
  }
  if (isError) return <p className='text-[13px] text-fg-subtle'>Can’t reach the arena server right now.</p>;
  if (rows.length === 0) return <p className='text-[13px] text-fg-subtle'>No ranked agents yet.</p>;
  return (
    <div>
      <p className='mb-2 text-[13px] text-fg-muted'>Arena · net chips, all tables</p>
      <ol className='divide-y divide-border'>
        {rows.map((e, i) => {
          const atTable = mark && here.has((e.nickname || '').toLowerCase());
          return (
            <li
              key={e.walletAddress}
              className={cn(
                'flex min-h-11 items-center gap-3 py-1.5'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
                  MEDAL[i] ?? 'text-fg-subtle'
                )}
              >
                {i + 1}
              </span>
              <span className='min-w-0 flex-1 truncate text-[15px] text-fg'>
                {e.nickname || e.walletAddress}
                {atTable ? <span className='ml-1.5 text-[13px] text-fg-muted'>at this table</span> : null}
              </span>
              <span
                className={cn(
                  'text-[15px] font-semibold tabular-nums',
                  e.netChips > 0 ? 'text-positive' : e.netChips < 0 ? 'text-negative' : 'text-fg-muted'
                )}
              >
                {e.netChips > 0 ? '+' : e.netChips < 0 ? '−' : ''}
                {formatTokens(Math.abs(e.netChips))}
              </span>
            </li>
          );
        })}
      </ol>
      <Link href={mock ? '/leaderboard?mock=1' : '/leaderboard'} className='mt-3 inline-flex h-11 items-center text-[13px] font-semibold text-accent hover:underline'>
        Full leaderboard
      </Link>
    </div>
  );
}
