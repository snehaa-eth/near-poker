'use client';

/**
 * Beginner-friendly table states: a plain-English street hint, the arena
 * "How to watch" explainer, and the "table finished" card.
 */
import Link from 'next/link';

import React, { useEffect, useState } from 'react';

import { type PublicGameView, api } from '~/lib/api';

import { ShieldCheck } from 'lucide-react';

/** One line explaining the current street, e.g. "Flop · 3 shared cards". */
export function streetHint(view: PublicGameView): string | null {
  if (view.gameEnded || view.status !== 'playing') return null;
  const who = view.arena ? 'agent' : 'player';
  const street = (view.street ?? '').toLowerCase();
  const round = street || view.round.toLowerCase();
  switch (round) {
    case 'preflop':
      return `Pre-flop · each ${who} has 2 private cards`;
    case 'flop':
      return 'Flop · 3 shared cards';
    case 'turn':
      return 'Turn · 4th shared card';
    case 'river':
      return 'River · last shared card';
    case 'showdown':
    case 'end':
      return 'Showdown · best 5-card hand wins';
    default:
      return null;
  }
}

const HOW_TO_WATCH = [
  {
    title: 'The players are AI agents.',
    body: 'Each seat is someone’s bot. It reads the table and decides fold, check, call or raise by asking an AI model.',
  },
  {
    title: 'TEE = the model really decided.',
    body: 'Every move comes from a NEAR AI model running in a sealed chip (a TEE) that signs its answer. Unsigned moves are rejected. The ✓ on an action opens its receipt.',
  },
  {
    title: 'Verify hand = nobody rigged the deck.',
    body: 'The shuffle is locked in (hashed) before the deal and revealed after. The verify page re-shuffles it in your browser and checks every card.',
  },
  {
    title: 'How a hand ends.',
    body: 'Either everyone else folds, or the last players show their cards after the 5th shared card. Best 5-card hand wins the pot, then the next hand deals in a few seconds.',
  },
];

/** "New to poker?" explainer, as a disclosure inside the table drawer. */
export function HowToWatch({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className='rounded-md border border-border bg-surface'>
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className='flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-[13px] font-semibold text-fg'
      >
        How to watch
        <span aria-hidden className='text-fg-subtle'>{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <ul className='space-y-2 px-4 pb-4 text-[13px] leading-snug text-fg-muted'>
          {HOW_TO_WATCH.map((item) => (
            <li key={item.title}>
              <span className='font-semibold text-fg'>{item.title}</span>{' '}
              {item.body}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Shown on an arena table once every agent has left. */
export function TableFinished({ gameId }: { gameId: string }) {
  const [hands, setHands] = useState<{
    count: number;
    lastHandId: string | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .gameHands(gameId)
      .then(({ hands: list }) => {
        if (!alive) return;
        const done = list.filter((h) => h.complete !== false);
        setHands({
          count: done.length,
          lastHandId: done[0]?.handId ?? null,
        });
      })
      .catch(() => {
        if (alive) setHands({ count: 0, lastHandId: null });
      });
    return () => {
      alive = false;
    };
  }, [gameId]);

  return (
    <div
      role='status'
      className='flex max-w-sm flex-col items-center gap-3 rounded-md border border-border-strong bg-surface-2 px-6 py-5 text-center shadow-[var(--shadow-e2)]'
    >
      <p className='text-[15px] font-semibold text-fg'>
        Table finished — all agents left.
      </p>
      <p className='text-[13px] text-fg-muted'>
        {hands == null
          ? 'Counting hands…'
          : `${hands.count} hand${hands.count === 1 ? '' : 's'} played.`}
      </p>
      <div className='flex flex-wrap justify-center gap-2'>
        <Link
          href='/arena'
          className='inline-flex h-10 items-center rounded-sm bg-surface-3 px-4 text-[13px] font-semibold text-fg ring-1 ring-border-strong hover:bg-surface'
        >
          Back to arena
        </Link>
        {hands?.lastHandId ? (
          <Link
            href={`/verify/${encodeURIComponent(hands.lastHandId)}`}
            className='inline-flex h-10 items-center gap-1.5 rounded-sm bg-ivory px-4 text-[13px] font-semibold text-[var(--ivory-ink)] hover:bg-ivory-hover'
          >
            <ShieldCheck className='h-4 w-4' strokeWidth={1.75} />
            Verify last hand
          </Link>
        ) : null}
      </div>
    </div>
  );
}
