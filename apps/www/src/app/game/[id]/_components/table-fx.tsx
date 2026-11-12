'use client';

/**
 * Broadcast-style table effects: rolling numbers, chip stacks that slide in front of seats,
 * get swept into the pot and fly to the winner, the ALL IN splash, the action ticker and the
 * header sound button. Transform/opacity-only animations so they stay at 60fps.
 */
import React, { useEffect, useState } from 'react';

import { isRedCard, cardLabel } from '~/lib/poker-eval';
import { chipText } from '~/lib/seat-action-flash';
import {
  hydrateSoundMute,
  isAudioUnlocked,
  playSound,
  subscribeAudioUnlock,
  subscribeSoundMute,
  toggleSoundMuted,
} from '~/lib/sounds';
import type { ChipFlight, DirectorState, TickerItem } from '~/lib/table-director';
import { cn } from '~/lib/utils';

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';

export type Point = { left: number; top: number };

const pct = (n: number) => `${n}%`;

/* ------------------------------------------------------------------ */
/* Rolling number                                                      */
/* ------------------------------------------------------------------ */

export function RollingNumber({
  value,
  className,
  format = chipText,
  duration = 0.75,
}: {
  value: number;
  className?: string;
  format?: (n: number) => string;
  duration?: number;
}) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value, duration]);
  return <motion.span className={cn('tabular-nums', className)}>{text}</motion.span>;
}

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

/** One neutral chip glyph (no rainbow stacks): a small stack whose height grows with the amount. */
export function ChipDiscs({ amount, size = 'md' }: { amount: number; size?: 'sm' | 'md' }) {
  const count = Math.max(1, Math.min(4, Math.floor(Math.log10(Math.max(1, amount))) + (amount >= 500 ? 1 : 0)));
  const d = size === 'sm' ? 12 : 16;
  return (
    <span className='relative inline-block shrink-0' style={{ width: d, height: d + (count - 1) * 3 }} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className='absolute left-0 rounded-full bg-[#d9dfdb] shadow-[inset_0_0_0_2px_rgba(11,15,13,0.55),0_1px_0_rgba(0,0,0,0.5)]'
          style={{ width: d, height: d, bottom: i * 3 }}
        />
      ))}
    </span>
  );
}

function BetChip({ amount }: { amount: number }) {
  return (
    <span className='flex items-center gap-1 whitespace-nowrap rounded-xs bg-black/60 py-0.5 pl-1 pr-1.5 text-[13px] font-semibold text-fg shadow-md ring-1 ring-white/10'>
      <ChipDiscs amount={amount} size='sm' />
      <RollingNumber value={amount} duration={0.35} />
    </span>
  );
}

/**
 * Bets in front of the seats + sweep-to-pot + pot-to-winner flights.
 * Points are percentages of the table box.
 */
export function ChipLayer({
  seatPoints,
  betPoints,
  potPoint,
  bets,
  sweep,
  award,
}: {
  seatPoints: Record<string, Point>;
  betPoints: Record<string, Point>;
  potPoint: Point;
  bets: Record<string, number>;
  sweep: DirectorState['sweep'];
  award: DirectorState['award'];
}) {
  const reduce = useReducedMotion();
  const centered = { x: '-50%', y: '-50%' };

  return (
    <div className='pointer-events-none absolute inset-0 z-[15]' aria-hidden>
      <AnimatePresence>
        {Object.entries(bets).map(([id, amount]) => {
          const from = seatPoints[id];
          const to = betPoints[id];
          if (!from || !to || amount <= 0) return null;
          return (
            <motion.div
              key={`bet-${id}`}
              className='absolute'
              style={centered}
              initial={reduce ? false : { left: pct(from.left), top: pct(from.top), opacity: 0, scale: 0.6 }}
              animate={{ left: pct(to.left), top: pct(to.top), opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            >
              <BetChip amount={amount} />
            </motion.div>
          );
        })}
      </AnimatePresence>

      {sweep
        ? sweep.items.map((item, i) => (
            <Flight
              key={`${sweep.key}-${item.playerId}`}
              item={item}
              from={betPoints[item.playerId]}
              to={potPoint}
              delay={i * 0.05}
              duration={0.35}
            />
          ))
        : null}

      {award
        ? award.items.map((item, i) => (
            <Flight
              key={`${award.key}-${item.playerId}`}
              item={item}
              from={potPoint}
              to={seatPoints[item.playerId]}
              delay={i * 0.12}
              duration={0.6}
              label={`+${chipText(item.amount)}`}
            />
          ))
        : null}
    </div>
  );
}

function Flight({
  item,
  from,
  to,
  delay,
  duration,
  label,
}: {
  item: ChipFlight;
  from?: Point;
  to?: Point;
  delay: number;
  duration: number;
  label?: string;
}) {
  const reduce = useReducedMotion();
  if (!from || !to) return null;
  if (reduce) {
    // Reduced motion: no travel, just a short crossfade at the destination.
    return (
      <motion.div
        className='absolute'
        style={{ x: '-50%', y: '-50%', left: pct(to.left), top: pct(to.top) }}
        initial={{ opacity: 0 }}
        animate={{ opacity: label ? [0, 1, 1, 0] : [0, 1, 0] }}
        transition={{ duration: label ? 1.2 : 0.3, delay }}
      >
        {label ? <AwardLabel amount={item.amount} label={label} /> : null}
      </motion.div>
    );
  }
  return (
    <motion.div
      className='absolute'
      style={{ x: '-50%', y: '-50%' }}
      initial={{ left: pct(from.left), top: pct(from.top), opacity: 1, scale: 1 }}
      animate={{
        left: pct(to.left),
        top: pct(to.top),
        opacity: label ? [1, 1, 1, 0] : [1, 1, 0],
        scale: label ? [1, 1.1, 1.05, 0.95] : [1, 0.9, 0.6],
      }}
      transition={{ duration: label ? duration + 0.9 : duration, delay, ease: [0.3, 0.7, 0.2, 1], times: label ? [0, 0.45, 0.8, 1] : [0, 0.75, 1] }}
    >
      {label ? (
        <AwardLabel amount={item.amount} label={label} />
      ) : (
        <ChipDiscs amount={item.amount} size='sm' />
      )}
    </motion.div>
  );
}

function AwardLabel({ amount, label }: { amount: number; label: string }) {
  return (
    <span className='flex items-center gap-1 whitespace-nowrap rounded-xs bg-surface-2 py-0.5 pl-1 pr-2 text-[15px] font-bold tabular-nums text-positive shadow-[0_0_0_1px_rgba(0,236,151,0.5),0_8px_24px_rgba(0,0,0,0.5)]'>
      <ChipDiscs amount={amount} size='sm' />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ALL IN splash                                                       */
/* ------------------------------------------------------------------ */

export function AllInSplash({ splash }: { splash: DirectorState['allInSplash'] }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<DirectorState['allInSplash']>(null);
  useEffect(() => {
    if (!splash) return;
    setShown(splash);
    const t = window.setTimeout(() => setShown(null), 1500);
    return () => window.clearTimeout(t);
  }, [splash]);

  return (
    <AnimatePresence>
      {shown ? (
        <motion.div
          key={shown.key}
          className='pointer-events-none absolute left-1/2 top-[44%] z-40 flex flex-col items-center'
          style={{ x: '-50%', y: '-50%' }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.25 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          role='status'
        >
          <span className='rounded-sm bg-accent px-3 py-0.5 text-[20px] font-extrabold tracking-wide text-accent-ink shadow-[0_0_32px_rgba(0,236,151,0.35)]'>
            {shown.nickname} ALL IN
            {shown.amount != null ? ` · ${chipText(shown.amount)}` : ''}
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Action ticker                                                       */
/* ------------------------------------------------------------------ */

function CardText({ id }: { id: number }) {
  return (
    <span
      className={cn(
        'mx-[1px] inline-block rounded-[4px] bg-[#f2f5f3] px-1 font-bold leading-tight',
        isRedCard(id) ? 'text-[#c62f3a]' : 'text-[#0b0f0d]'
      )}
    >
      {cardLabel(id)}
    </span>
  );
}

function tickerTone(item: TickerItem) {
  if (item.kind === 'win') return 'text-positive';
  if (item.kind === 'street' || item.kind === 'hand') return 'text-fg-muted';
  if (item.action === 'all-in') return 'text-accent';
  if (item.action === 'fold') return 'text-fg-subtle';
  return 'text-fg-muted';
}

/** Plain-text version of a ticker line (screen readers + tests). */
export function tickerText(item: TickerItem) {
  return [item.who, item.text, item.cards?.map(cardLabel).join(' ')].filter(Boolean).join(' ');
}

/**
 * One-line broadcast ticker under the felt: "Nit raises to 30 · Fox calls 30 · Flop K♠ 7♦ 2♦".
 * `trailing` sits at the right end (e.g. "Verify hand ›" once a hand settles).
 */
export function ActionTicker({
  items,
  className,
  trailing,
  live = true,
}: {
  items: TickerItem[];
  className?: string;
  trailing?: React.ReactNode;
  live?: boolean;
}) {
  const reduce = useReducedMotion();
  const latest = items[items.length - 1];
  return (
    <div
      className={cn(
        'relative flex h-9 items-center gap-3 overflow-hidden border-y border-border bg-surface px-3 text-[13px] sm:px-4',
        className
      )}
      data-testid='action-ticker'
    >
      {/* Screen readers follow the hand through the newest line only. */}
      <span className='sr-only' aria-live='polite'>
        {latest ? tickerText(latest) : ''}
      </span>
      <span className='flex shrink-0 items-center gap-1.5 text-label uppercase text-fg-muted' aria-hidden>
        <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'live-dot bg-live' : 'bg-fg-subtle')} />
        {live ? 'Live' : 'Seating'}
      </span>
      <div className='flex min-w-0 flex-1 justify-end overflow-hidden' aria-hidden>
        <div className='flex shrink-0 items-center gap-2 whitespace-nowrap'>
          {items.length === 0 ? <span className='text-fg-subtle'>Waiting for the next action…</span> : null}
          <AnimatePresence initial={false}>
            {items.map((item, i) => (
              <motion.span
                key={item.id}
                layout={reduce ? false : 'position'}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: i === items.length - 1 ? 1 : 0.65, y: 0 }}
                transition={{ duration: 0.2 }}
                className={cn('flex items-center gap-1', tickerTone(item))}
              >
                {i > 0 ? <span className='mr-1 text-fg-disabled'>·</span> : null}
                {item.who ? <span className='font-semibold text-fg'>{item.who}</span> : null}
                <span className={item.kind === 'win' ? 'font-semibold' : undefined}>{item.text}</span>
                {item.cards?.length ? (
                  <span className='ml-0.5'>
                    {item.cards.map((c) => (
                      <CardText key={c} id={c} />
                    ))}
                  </span>
                ) : null}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>
      {trailing ? <div className='shrink-0'>{trailing}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

/**
 * Header speaker icon. Browsers block audio until a gesture, so the icon pulses (once a second,
 * a soft ring) until the first click anywhere; clicking it toggles mute.
 */
export function SoundButton({ className }: { className?: string }) {
  const [muted, setMuted] = useState(false);
  const [unlocked, setUnlocked] = useState(true);
  useEffect(() => {
    setMuted(hydrateSoundMute());
    setUnlocked(isAudioUnlocked());
    const a = subscribeAudioUnlock(() => setUnlocked(true));
    const b = subscribeSoundMute(setMuted);
    return () => {
      a();
      b();
    };
  }, []);
  const needsGesture = !muted && !unlocked;
  return (
    <button
      type='button'
      onClick={() => {
        if (needsGesture) {
          // This click unlocks audio: confirm with a soft chip rattle instead of muting.
          setUnlocked(true);
          window.setTimeout(() => playSound('chipsBet', 0.6), 30);
          return;
        }
        const next = toggleSoundMuted();
        if (!next) window.setTimeout(() => playSound('cardFlip', 0.45), 30);
      }}
      aria-pressed={!muted && !needsGesture}
      aria-label={needsGesture ? 'Turn on table sound' : muted ? 'Unmute table sound' : 'Mute table sound'}
      title={needsGesture ? 'Tap for sound' : muted ? 'Sound off' : 'Sound on'}
      className={cn(
        'relative inline-flex h-11 w-11 items-center justify-center rounded-sm text-fg-muted transition-colors duration-instant hover:bg-surface-2 hover:text-fg',
        className
      )}
    >
      {needsGesture ? (
        <span aria-hidden className='absolute inset-2 animate-ping rounded-full bg-accent/25 motion-reduce:hidden' />
      ) : null}
      {muted || needsGesture ? <VolumeX className='relative h-5 w-5' strokeWidth={1.75} /> : <Volume2 className='h-5 w-5' strokeWidth={1.75} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Win %                                                               */
/* ------------------------------------------------------------------ */

export function EquityBadge({ share, leading }: { share: number; leading: boolean }) {
  const pctText = `${Math.round(share * 100)}%`;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative h-6 w-[5.5rem] overflow-hidden rounded-xs text-center text-[13px] font-bold leading-6 tabular-nums ring-1',
        leading ? 'bg-surface-2 text-accent ring-accent/60' : 'bg-surface-2 text-fg-muted ring-border-strong'
      )}
      title='Chance to win from here (revealed cards only)'
    >
      <motion.span
        className={cn('absolute inset-y-0 left-0', leading ? 'bg-accent/20' : 'bg-white/10')}
        initial={false}
        animate={{ width: pctText }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      <span className='relative'>Win {pctText}</span>
    </motion.div>
  );
}
