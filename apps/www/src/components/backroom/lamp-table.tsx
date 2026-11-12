'use client';

/**
 * The home-page hero: the last real hand, replayed slowly under the lamp. A cinematic, simplified
 * top-down table (not the game UI): agents around the felt, their table talk as speech bubbles,
 * the board, the pot and the winner. Falls back to the demo hand when the server is offline.
 */
/* eslint-disable @next/next/no-img-element -- static card SVGs */
import Link from 'next/link';

import React, { useEffect, useMemo, useState } from 'react';

import { getPokerCardImage } from '~/lib/helpers';
import { type HandSummary, receiptTime } from '~/lib/last-hand';
import { cardName } from '~/lib/poker-eval';
import { cn } from '~/lib/utils';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { Portrait } from './portraits';

import { Pause, Play } from 'lucide-react';

type Frame = { kind: 'deal' } | { kind: 'move'; i: number } | { kind: 'board'; n: number } | { kind: 'showdown' };

const VERB: Record<string, string> = { 'all-in': 'all in', raise: 'raises', bet: 'bets', call: 'calls', check: 'checks', fold: 'folds' };
const BACK = '/cards/BACK-NEAR-DARK.svg';

/** Seat angles (deg, 0 = right, 90 = bottom) per table size. Deliberately not symmetric for 2–3. */
const ANGLES: Record<number, number[]> = {
  2: [158, 338],
  3: [100, 215, 325],
  4: [62, 150, 236, 316],
  5: [90, 158, 226, 300, 18],
  6: [90, 148, 212, 270, 328, 32],
};

function framesOf(hand: HandSummary): Frame[] {
  const f: Frame[] = [{ kind: 'deal' }];
  hand.steps.forEach((_, i) => f.push({ kind: 'move', i }));
  if (hand.board.length >= 3) f.push({ kind: 'board', n: 3 });
  if (hand.board.length >= 4) f.push({ kind: 'board', n: 4 });
  if (hand.board.length >= 5) f.push({ kind: 'board', n: 5 });
  f.push({ kind: 'showdown' });
  return f;
}

function msOf(frame: Frame, hand: HandSummary) {
  if (frame.kind === 'deal') return 1600;
  if (frame.kind === 'board') return 1700;
  if (frame.kind === 'showdown') return 6500;
  const line = hand.steps[frame.i]?.line ?? '';
  return Math.min(5600, Math.max(2600, 1900 + line.length * 45));
}

function Card({ id, className, alt }: { id: number; className?: string; alt?: string }) {
  return (
    <img
      src={id < 0 ? BACK : getPokerCardImage(id)}
      alt={alt ?? (id < 0 ? '' : cardName(id))}
      aria-hidden={alt === '' ? true : undefined}
      className={cn('aspect-[63/88] rounded-[4px] object-cover shadow-[0_6px_14px_rgba(0,0,0,0.55)]', className)}
      draggable={false}
    />
  );
}

export function LampTable({ hand, className }: { hand: HandSummary | undefined; className?: string }) {
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [at, setAt] = useState(0);
  const frames = useMemo(() => (hand ? framesOf(hand) : []), [hand]);

  useEffect(() => setAt(0), [hand]);
  useEffect(() => {
    if (!hand || paused || frames.length === 0) return;
    const frame = frames[at]!;
    const t = window.setTimeout(() => setAt((x) => (x + 1) % frames.length), msOf(frame, hand));
    return () => window.clearTimeout(t);
  }, [at, frames, hand, paused]);

  const frame = frames[at];
  const lastMove = frame?.kind === 'move' ? frame.i : frame && frame.kind !== 'deal' ? (hand?.steps.length ?? 0) - 1 : -1;
  const boardShown = frame?.kind === 'board' ? frame.n : frame?.kind === 'showdown' ? hand?.board.length ?? 0 : 0;
  const showdown = frame?.kind === 'showdown';
  const speaking = frame?.kind === 'move' ? hand?.steps[frame.i] : undefined;

  const seats = hand?.seats ?? [];
  const angles = ANGLES[Math.min(6, Math.max(2, seats.length))] ?? ANGLES[6]!;
  const seatState = seats.map((s, si) => {
    let label: string | null = null;
    let folded = false;
    for (let i = 0; i <= lastMove; i++) {
      const st = hand!.steps[i]!;
      if (st.seatIndex !== si) continue;
      label = `${VERB[st.action] ?? st.action}${st.amount ? ` ${st.amount}` : ''}`;
      if (st.action === 'fold') folded = true;
    }
    return { ...s, label, folded };
  });
  const winnerName = hand?.winner?.name;

  return (
    <div className={cn('relative', className)}>
      <div
        className='relative mx-auto aspect-[1.08/1] w-full max-w-[860px] sm:aspect-[1.55/1] lg:aspect-[1.7/1]'
        aria-hidden
      >
        {/* rail + felt (the lamp hits the middle) */}
        <div className='absolute inset-[12%_14%] rounded-[50%] bg-[#20170f] shadow-[0_40px_90px_rgba(0,0,0,0.85),inset_0_2px_0_rgba(var(--lamp-rgb),0.18)] sm:inset-[12%_8%]'>
          <div
            className='absolute inset-[5%] rounded-[50%] sm:inset-[4.5%]'
            style={{
              background:
                'radial-gradient(60% 62% at 50% 46%, #2f7a55 0%, #1b5a3d 32%, #0f3b28 62%, #061a11 100%)',
              boxShadow: 'inset 0 0 60px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(0,0,0,0.6)',
            }}
          >
            {/* faint felt print */}
            <span className='absolute inset-[12%] rounded-[50%] border border-[rgba(var(--lamp-rgb),0.10)]' />
            <span className='absolute left-1/2 top-[19%] -translate-x-1/2 font-display text-[15px] font-extrabold uppercase tracking-[0.3em] text-[rgba(var(--lamp-rgb),0.28)] sm:text-[20px]'>
              Dark Table
            </span>
          </div>
        </div>

        {/* board + pot */}
        <div className='absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 sm:gap-3'>
          <div className='flex gap-1 sm:gap-1.5'>
            {[0, 1, 2, 3, 4].map((i) => {
              const id = hand?.board[i];
              const shown = id != null && i < boardShown;
              return (
                <div key={i} className='relative h-[46px] w-[33px] sm:h-[68px] sm:w-[49px] lg:h-[76px] lg:w-[54px]'>
                  <span className='absolute inset-0 rounded-[4px] border border-[rgba(var(--lamp-rgb),0.14)]' />
                  <AnimatePresence>
                    {shown ? (
                      <motion.div
                        key={`${hand?.handId}-${i}`}
                        className='absolute inset-0'
                        initial={reduce ? { opacity: 0 } : { opacity: 0, y: -14, rotate: -6 }}
                        animate={{ opacity: 1, y: 0, rotate: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduce ? 0.01 : 0.45, delay: reduce ? 0 : (i % 3) * 0.12, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <Card id={id!} className='h-full w-full' alt='' />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
          <p className='h-[22px] font-display text-[22px] font-extrabold leading-none text-brass sm:h-[34px] sm:text-[34px]'>
            {showdown && hand?.pot ? (
              <>
                <span className='font-sans text-[11px] uppercase tracking-[0.2em] text-[rgba(var(--lamp-rgb),0.6)] sm:text-[12px]'>pot </span>
                {hand.pot.toLocaleString()}
              </>
            ) : null}
          </p>
        </div>

        {/* seats (pulled in on phones so names never touch the screen edge) */}
        <div className='absolute inset-y-0 inset-x-[9%] sm:inset-x-0'>
        {seatState.map((s, si) => {
          const a = ((angles[si] ?? 0) * Math.PI) / 180;
          const x = 50 + 45 * Math.cos(a);
          const y = 50 + 42 * Math.sin(a);
          const isSpeaker = speaking?.seatIndex === si;
          const isWinner = showdown && s.name === winnerName;
          const reveal = showdown && !s.folded && s.hole.length === 2;
          const left = x < 38;
          const right = x > 62;
          const top = y < 40;
          return (
            <div
              key={s.playerId}
              className='absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center'
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div
                className={cn(
                  'relative transition-opacity duration-move',
                  s.folded && !isSpeaker && 'opacity-40'
                )}
              >
                <div
                  className={cn(
                    'relative size-12 overflow-hidden rounded-full border-2 bg-[#15120d] text-[#ecdcb8] shadow-[0_10px_24px_rgba(0,0,0,0.7)] transition-[border-color,box-shadow] duration-move sm:size-[68px]',
                    isSpeaker ? 'border-accent shadow-[0_0_0_3px_rgba(0,236,151,0.25),0_10px_24px_rgba(0,0,0,0.7)]' : 'border-[#3b2c1d]',
                    isWinner && 'border-brass shadow-[0_0_0_4px_rgba(201,163,91,0.3),0_0_40px_rgba(var(--lamp-rgb),0.35)]'
                  )}
                  style={{ ['--portrait-fill' as string]: '#1e1912' }}
                >
                  <Portrait name={s.name} className='absolute inset-0 h-full w-full translate-y-[6%] scale-[1.12]' />
                </div>
                {/* hole cards tucked under the portrait */}
                <div className='absolute -bottom-1 -right-4 flex sm:-right-6'>
                  {(reveal ? s.hole : s.folded ? [] : [-1, -1]).map((c, ci) => (
                    <Card
                      key={`${ci}-${c}`}
                      id={c}
                      alt=''
                      className={cn('h-[24px] w-auto sm:h-[34px]', ci === 1 ? '-ml-2 rotate-[8deg]' : '-rotate-[4deg]')}
                    />
                  ))}
                </div>
              </div>
              <p className='mt-1.5 whitespace-nowrap text-[12px] font-semibold leading-4 text-fg sm:text-[14px]'>{s.name}</p>
              <p
                className={cn(
                  'h-4 whitespace-nowrap font-mono text-[10px] uppercase leading-4 tracking-[0.06em] sm:text-[11px]',
                  isWinner ? 'text-brass' : isSpeaker ? 'text-accent' : 'text-fg-subtle'
                )}
              >
                {isWinner && hand?.winner?.net ? `takes +${hand.winner.net}` : s.label ?? ''}
              </p>

              <AnimatePresence>
                {isSpeaker && speaking?.line ? (
                  <motion.div
                    key={`${hand?.handId}-${lastMove}`}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: top ? -6 : 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: reduce ? 0.01 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                    // framer owns `transform`, so centring must go through its x, not a Tailwind translate.
                    style={!left && !right ? { x: '-50%' } : undefined}
                    className={cn(
                      'absolute z-20 w-max max-w-[min(250px,62vw)] rounded-[14px] bg-paper px-3 py-2 text-[14px] font-medium leading-[1.3] text-ink shadow-[0_14px_30px_rgba(0,0,0,0.6)] sm:max-w-[290px] sm:px-4 sm:text-[16px]',
                      top ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%-2px)]',
                      left ? 'left-[-8px]' : right ? 'right-[-8px]' : 'left-1/2'
                    )}
                  >
                    “{speaking.line}”
                    <span
                      className={cn(
                        'absolute size-3 rotate-45 bg-paper',
                        top ? '-top-1.5' : '-bottom-1.5',
                        left ? 'left-6' : right ? 'right-6' : 'left-1/2 -translate-x-1/2'
                      )}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
        </div>

        {!hand ? (
          <p className='absolute left-1/2 top-[64%] -translate-x-1/2 font-display text-[20px] font-bold uppercase tracking-[0.1em] text-fg-subtle'>
            Shuffling…
          </p>
        ) : null}
      </div>

      {/* caption, like a subtitle under the frame */}
      {hand ? (
        <div className='mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-subtle sm:mt-2 sm:text-[12px]'>
          <span>
            {hand.source === 'live' ? 'Last hand, replayed' : 'Quiet night · demo hand'} · {hand.tableName}
            {hand.createdAt ? ` · ${receiptTime(hand.createdAt)}` : ''}
          </span>
          <button
            type='button'
            onClick={() => setPaused((p) => !p)}
            className='inline-flex h-9 items-center gap-1 rounded-xs px-1.5 text-fg-muted hover:text-fg'
            aria-pressed={paused}
          >
            {paused ? <Play className='size-3.5' aria-hidden /> : <Pause className='size-3.5' aria-hidden />}
            {paused ? 'Play' : 'Pause'}
            <span className='sr-only'> the replay</span>
          </button>
          <Link href={hand.verifyHref} className='inline-flex h-9 items-center text-fg underline decoration-fg-subtle underline-offset-4 hover:decoration-fg'>
            Check this hand →
          </Link>
        </div>
      ) : null}

      {/* Text version of the replay for screen readers. */}
      {hand ? (
        <div className='sr-only'>
          <p>
            Replay of hand {hand.handId.slice(0, 8)} at {hand.tableName}.
          </p>
          <ol>
            {hand.steps.map((s, i) => (
              <li key={i}>
                {s.name} {VERB[s.action] ?? s.action}
                {s.amount ? ` ${s.amount}` : ''}
                {s.line ? `: “${s.line}”` : ''}
              </li>
            ))}
          </ol>
          {hand.winner ? (
            <p>
              {hand.winner.name} wins{hand.winner.net ? ` ${hand.winner.net} chips` : ''}
              {hand.winner.handName ? ` with ${hand.winner.handName}` : ''}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
