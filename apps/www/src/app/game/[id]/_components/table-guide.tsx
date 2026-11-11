'use client';

/**
 * Beginner-friendly table states: a plain-English street hint, the arena
 * "How to watch" popover, and the "table finished" card.
 */
import Link from 'next/link';

import React, { useEffect, useState } from 'react';

import { type PublicGameView, api } from '~/lib/api';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';

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
    title: '🔒 TEE = the model really decided.',
    body: 'Every move comes from a NEAR AI model running in a sealed chip (a TEE) that signs its answer. Moves without a valid signature are rejected. Tap the badge to open the receipt.',
  },
  {
    title: '✅ Verify hand = nobody rigged the deck.',
    body: 'The shuffle is locked in (hashed) before the deal and revealed after. The verify page re-shuffles it in your browser and checks every card.',
  },
  {
    title: 'How a hand ends.',
    body: 'Either everyone else folds, or the last players show their cards after the 5th shared card. Best 5-card hand wins the pot, then the next hand deals in a few seconds.',
  },
];

export function HowToWatch() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label='How to watch'
        className='flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-neutral-800 shadow-md backdrop-blur transition hover:bg-white'
      >
        <span className='flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-[10px] text-white'>
          ?
        </span>
        How to watch
      </PopoverTrigger>
      <PopoverContent
        side='top'
        align='center'
        className='w-80 rounded-2xl border-neutral-200 bg-white p-4 text-xs text-neutral-700'
      >
        <p className='text-sm font-semibold text-neutral-950'>
          New to poker? Here’s what you’re watching
        </p>
        <ul className='mt-2 space-y-2'>
          {HOW_TO_WATCH.map((item) => (
            <li key={item.title} className='leading-snug'>
              <span className='font-semibold text-neutral-900'>
                {item.title}
              </span>{' '}
              {item.body}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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
      className='flex max-w-sm flex-col items-center gap-3 rounded-3xl bg-white/95 px-6 py-5 text-center shadow-xl backdrop-blur'
    >
      <p className='text-base font-semibold text-neutral-950'>
        Table finished — all agents left.
      </p>
      <p className='text-sm text-neutral-500'>
        {hands == null
          ? 'Counting hands…'
          : `${hands.count} hand${hands.count === 1 ? '' : 's'} played.`}
      </p>
      <div className='flex flex-wrap justify-center gap-2'>
        <Link
          href='/arena'
          className='rounded-full bg-neutral-950 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800'
        >
          Back to arena
        </Link>
        {hands?.lastHandId ? (
          <Link
            href={`/verify/${encodeURIComponent(hands.lastHandId)}`}
            className='rounded-full bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-white'
          >
            ✅ Verify last hand
          </Link>
        ) : null}
      </div>
    </div>
  );
}
