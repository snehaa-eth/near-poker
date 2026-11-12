import * as React from 'react';

import { cn } from '~/lib/utils';

const RULES = ['No human plays.', 'Every move leaves a receipt.', 'The deck is sealed before the deal.'];

/** A painted sign hung on the back wall: three rules, no more. */
export function HouseRules({ className }: { className?: string }) {
  return (
    <div className={cn('relative mx-auto w-full max-w-[460px] pt-12', className)}>
      {/* nail + string */}
      <svg viewBox='0 0 460 60' className='absolute inset-x-0 top-0 h-[60px] w-full' aria-hidden>
        <path d='M90 58 L230 8 L370 58' fill='none' stroke='#6b5638' strokeWidth='1.6' />
        <circle cx='230' cy='8' r='5' fill='#2a2219' stroke='#c9a35b' strokeWidth='1.5' />
      </svg>
      <section
        aria-labelledby='rules-h'
        className='relative -rotate-[1.4deg] rounded-[6px] border-[6px] border-[#3a2a1a] bg-[#16261d] px-7 pb-8 pt-7 shadow-[0_30px_60px_rgba(0,0,0,0.7),inset_0_0_60px_rgba(0,0,0,0.5)] sm:px-10'
        style={{
          backgroundImage:
            'radial-gradient(80% 60% at 30% 10%, rgba(244,217,160,0.10), transparent 70%), repeating-linear-gradient(90deg, rgba(255,255,255,0.015) 0 2px, transparent 2px 7px)',
        }}
      >
        {[
          'left-2.5 top-2.5',
          'right-2.5 top-2.5',
          'bottom-2.5 left-2.5',
          'bottom-2.5 right-2.5',
        ].map((pos) => (
          <span key={pos} aria-hidden className={cn('absolute size-2 rounded-full bg-brass/70 shadow-[inset_0_-1px_1px_rgba(0,0,0,0.6)]', pos)} />
        ))}
        <h2 id='rules-h' className='text-center font-display text-[44px] font-black uppercase leading-none tracking-[0.08em] text-[#efe4c8]'>
          House rules
        </h2>
        <div aria-hidden className='mx-auto mt-3 h-px w-24 bg-brass/60' />
        <ul className='mt-6 flex flex-col gap-4'>
          {RULES.map((r) => (
            <li key={r} className='flex gap-3 font-display text-[26px] font-bold uppercase leading-[1.05] tracking-[0.02em] text-[#efe4c8] sm:text-[30px]'>
              <span aria-hidden className='mt-[0.32em] size-2 shrink-0 rotate-45 bg-brass' />
              {r}
            </li>
          ))}
        </ul>
        <p className='mt-7 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#b9ab8c]'>
          — the management
        </p>
      </section>
    </div>
  );
}
