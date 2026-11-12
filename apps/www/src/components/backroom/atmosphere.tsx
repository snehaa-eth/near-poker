import * as React from 'react';

import { cn } from '~/lib/utils';

/**
 * A green-enamel billiard lamp on a cord, with its cone of warm light. Pure SVG + CSS gradients.
 * Position it with `className` (absolute, centred on the x of the table it lights).
 */
export function HangingLamp({ className, cone = true }: { className?: string; cone?: boolean }) {
  return (
    <div className={cn('pointer-events-none select-none', className)} aria-hidden>
      <svg viewBox='0 0 200 150' className='relative z-[1] mx-auto block w-[150px] sm:w-[190px]'>
        <defs>
          <linearGradient id='lamp-shade' x1='0' x2='1'>
            <stop offset='0' stopColor='#0d2a1c' />
            <stop offset='0.45' stopColor='#1f5139' />
            <stop offset='1' stopColor='#0a2016' />
          </linearGradient>
          <radialGradient id='lamp-bulb' cx='50%' cy='0%' r='80%'>
            <stop offset='0' stopColor='#fff6dc' />
            <stop offset='0.5' stopColor='#f4d9a0' />
            <stop offset='1' stopColor='#f4d9a0' stopOpacity='0' />
          </radialGradient>
        </defs>
        <line x1='100' y1='0' x2='100' y2='78' stroke='#2a2219' strokeWidth='2.5' />
        <rect x='93' y='74' width='14' height='12' rx='2' fill='#3a2e21' />
        <path d='M58 128 C62 104 78 88 100 86 C122 88 138 104 142 128 Z' fill='url(#lamp-shade)' stroke='#06140d' strokeWidth='1.5' />
        <path d='M70 112 C80 98 92 93 100 92' stroke='rgba(244,217,160,0.35)' strokeWidth='2' fill='none' strokeLinecap='round' />
        <ellipse cx='100' cy='128' rx='42' ry='5' fill='#c9a86a' />
        <ellipse cx='100' cy='130' rx='36' ry='10' fill='url(#lamp-bulb)' />
      </svg>
      {cone ? (
        <div
          className='lamp-flicker absolute left-1/2 top-[86%] h-[min(78vh,720px)] w-[min(120vw,1100px)] -translate-x-1/2'
          style={{
            background:
              'conic-gradient(from 180deg at 50% 0%, transparent 0deg, transparent 152deg, rgba(var(--lamp-rgb),0.07) 164deg, rgba(var(--lamp-rgb),0.11) 180deg, rgba(var(--lamp-rgb),0.07) 196deg, transparent 208deg, transparent 360deg)',
            WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 55%, transparent 100%)',
            maskImage: 'linear-gradient(180deg, #000 0%, #000 55%, transparent 100%)',
            filter: 'blur(6px)',
          }}
        />
      ) : null}
    </div>
  );
}

/** A faint drift of smoke (SVG turbulence, rendered once; only its transform animates). */
export function Smoke({ className }: { className?: string }) {
  return (
    <div className={cn('smoke pointer-events-none absolute', className)} aria-hidden>
      <svg className='h-full w-full' preserveAspectRatio='none'>
        <filter id='smoke-f'>
          <feTurbulence type='fractalNoise' baseFrequency='0.006 0.012' numOctaves='3' seed='7' />
          <feColorMatrix values='0 0 0 0 0.95  0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 0.9 -0.42' />
        </filter>
        <rect width='100%' height='100%' filter='url(#smoke-f)' />
      </svg>
      <style>{`
        .smoke { opacity: 0.09; mask-image: radial-gradient(50% 50% at 50% 50%, #000, transparent 75%); -webkit-mask-image: radial-gradient(50% 50% at 50% 50%, #000, transparent 75%); }
        @media (prefers-reduced-motion: no-preference) {
          .smoke svg { animation: dt-smoke 38s ease-in-out infinite alternate; }
        }
        @keyframes dt-smoke { from { transform: translate3d(-3%, 2%, 0) scale(1.05); } to { transform: translate3d(3%, -3%, 0) scale(1.12); } }
      `}</style>
    </div>
  );
}
