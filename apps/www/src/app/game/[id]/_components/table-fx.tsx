'use client';

/**
 * Broadcast-style table effects: rolling numbers, chip stacks that slide in front of seats,
 * get swept into the pot and fly to the winner, the ALL IN splash, the action ticker and the
 * "tap for sound" prompt. Transform/opacity-only animations so they stay at 60fps.
 */
import React, { useEffect, useState } from 'react';

import { formatTokens } from '~/lib/format';
import { isRedCard, cardLabel } from '~/lib/poker-eval';
import {
  isAudioUnlocked,
  isSoundMuted,
  playSound,
  subscribeAudioUnlock,
  subscribeSoundMute,
  hydrateSoundMute,
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

export type Point = { left: number; top: number };

const pct = (n: number) => `${n}%`;

/* ------------------------------------------------------------------ */
/* Rolling number                                                      */
/* ------------------------------------------------------------------ */

export function RollingNumber({
  value,
  className,
  format = formatTokens,
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

const CHIP_COLORS = [
  'bg-rose-600',
  'bg-sky-600',
  'bg-neutral-900',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-500',
];

/** A little casino chip stack; height grows with the amount. */
export function ChipDiscs({ amount, size = 'md' }: { amount: number; size?: 'sm' | 'md' }) {
  const count = Math.max(1, Math.min(5, Math.floor(Math.log10(Math.max(1, amount))) + 1 + (amount >= 500 ? 1 : 0)));
  const d = size === 'sm' ? 14 : 18;
  return (
    <span className='relative inline-block shrink-0' style={{ width: d, height: d + (count - 1) * 3 }} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'absolute left-0 rounded-full border-[2.5px] border-dashed border-white/85 shadow-[0_1px_0_rgba(0,0,0,0.35)]',
            CHIP_COLORS[(i + Math.floor(amount)) % CHIP_COLORS.length]
          )}
          style={{ width: d, height: d, bottom: i * 3 }}
        />
      ))}
    </span>
  );
}

function BetChip({ amount, highlight = false }: { amount: number; highlight?: boolean }) {
  return (
    <span
      className={cn(
        'flex items-end gap-1 whitespace-nowrap rounded-full py-0.5 pl-1 pr-2 text-[11px] font-bold shadow-md lg:text-xs',
        highlight ? 'bg-amber-300 text-neutral-950' : 'bg-black/55 text-white backdrop-blur-sm'
      )}
    >
      <ChipDiscs amount={amount} size='sm' />
      <RollingNumber value={amount} duration={0.4} />
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
              duration={0.55}
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
              duration={0.85}
              label={`+${formatTokens(item.amount)}`}
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
  if (!from || !to) return null;
  return (
    <motion.div
      className='absolute'
      style={{ x: '-50%', y: '-50%' }}
      initial={{ left: pct(from.left), top: pct(from.top), opacity: 1, scale: 1 }}
      animate={{
        left: pct(to.left),
        top: pct(to.top),
        opacity: label ? [1, 1, 1, 0] : [1, 1, 0],
        scale: label ? [1, 1.25, 1.1, 0.9] : [1, 0.9, 0.6],
      }}
      transition={{ duration: label ? duration + 0.9 : duration, delay, ease: [0.3, 0.7, 0.2, 1], times: label ? [0, 0.45, 0.8, 1] : [0, 0.75, 1] }}
    >
      {label ? (
        <span className='flex items-end gap-1 whitespace-nowrap rounded-full bg-amber-300 py-0.5 pl-1 pr-2 text-xs font-black text-neutral-950 shadow-[0_6px_20px_rgba(251,191,36,0.55)]'>
          <ChipDiscs amount={item.amount} />
          {label}
        </span>
      ) : (
        <ChipDiscs amount={item.amount} size='sm' />
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* ALL IN splash                                                       */
/* ------------------------------------------------------------------ */

export function AllInSplash({ splash }: { splash: DirectorState['allInSplash'] }) {
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
          initial={{ opacity: 0, scale: 2.2 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          role='status'
        >
          <span className='rounded-xl bg-rose-600 px-5 py-1.5 text-2xl font-black italic tracking-wider text-white shadow-[0_10px_40px_rgba(225,29,72,0.6)] ring-2 ring-white/80 lg:text-3xl'>
            ALL IN
          </span>
          <span className='mt-1 rounded-full bg-black/70 px-3 py-0.5 text-xs font-semibold text-white'>
            {shown.nickname}
            {shown.amount != null ? ` · ${formatTokens(shown.amount)}` : ''}
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
        'mx-[1px] inline-block rounded bg-white px-1 font-bold leading-tight',
        isRedCard(id) ? 'text-rose-600' : 'text-neutral-900'
      )}
    >
      {cardLabel(id)}
    </span>
  );
}

function tickerTone(item: TickerItem) {
  if (item.kind === 'win') return 'text-amber-300';
  if (item.kind === 'street' || item.kind === 'hand') return 'text-emerald-200';
  if (item.action === 'all-in') return 'text-rose-300';
  if (item.action === 'raise' || item.action === 'bet') return 'text-amber-200';
  if (item.action === 'fold') return 'text-white/55';
  return 'text-white/85';
}

/** One-line broadcast ticker: "Ada raises to 120 · Grace calls 120 · Flop K♠ 7♦ 2♣". */
export function ActionTicker({ items, className }: { items: TickerItem[]; className?: string }) {
  return (
    <div
      className={cn(
        'relative flex h-8 items-center overflow-hidden rounded-full bg-black/55 px-3 text-[12px] shadow-inner ring-1 ring-white/10 backdrop-blur-sm',
        className
      )}
      aria-live='polite'
      aria-label='Action ticker'
      data-testid='action-ticker'
    >
      <span className='mr-2 shrink-0 rounded bg-rose-600 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-widest text-white'>
        Live
      </span>
      <div className='flex min-w-0 flex-1 justify-end overflow-hidden'>
        <div className='flex shrink-0 items-center gap-2 whitespace-nowrap'>
          {items.length === 0 ? (
            <span className='text-white/50'>Waiting for the next action…</span>
          ) : null}
          <AnimatePresence initial={false}>
            {items.map((item, i) => (
              <motion.span
                key={item.id}
                layout='position'
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: i === items.length - 1 ? 1 : 0.7, y: 0 }}
                transition={{ duration: 0.25 }}
                className={cn('flex items-center gap-1', tickerTone(item))}
              >
                {i > 0 ? <span className='mr-1 text-white/25'>·</span> : null}
                {item.who ? <span className='font-semibold text-white'>{item.who}</span> : null}
                {item.kind === 'street' || item.kind === 'hand' ? (
                  <span className='font-semibold uppercase tracking-wide'>{item.text}</span>
                ) : (
                  <span>{item.text}</span>
                )}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tap-for-sound prompt                                                */
/* ------------------------------------------------------------------ */

/** Browsers block audio until a gesture: invite one (only when sound is on). */
export function SoundPrompt({ className }: { className?: string }) {
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    hydrateSoundMute();
    const update = () => setNeeded(!isSoundMuted() && !isAudioUnlocked());
    update();
    const a = subscribeAudioUnlock(update);
    const b = subscribeSoundMute(update);
    return () => {
      a();
      b();
    };
  }, []);
  if (!needed) return null;
  return (
    <button
      type='button'
      onClick={() => {
        // The click itself unlocks audio; confirm with a soft chip rattle.
        window.setTimeout(() => playSound('chipsBet', 0.6), 30);
        setNeeded(false);
      }}
      className={cn(
        'animate-pulse rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white shadow-md ring-1 ring-white/20 backdrop-blur-sm hover:bg-black/75',
        className
      )}
    >
      🔊 Tap for sound
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
        'relative w-[5.5rem] overflow-hidden rounded-md text-center text-[11px] font-black tabular-nums shadow-md ring-1',
        leading ? 'bg-emerald-950 text-emerald-200 ring-emerald-400/60' : 'bg-neutral-950 text-white/80 ring-white/20'
      )}
      title='Chance to win from here (revealed cards only)'
    >
      <motion.span
        className={cn('absolute inset-y-0 left-0', leading ? 'bg-emerald-500/40' : 'bg-white/15')}
        initial={false}
        animate={{ width: pctText }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      <span className='relative'>WIN {pctText}</span>
    </motion.div>
  );
}
