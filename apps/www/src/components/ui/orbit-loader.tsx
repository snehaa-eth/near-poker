import * as React from 'react';

import { cn } from '~/lib/utils';

/**
 * Orbit loader: concentric thin rings, partial mint arcs rotating at different
 * speeds, a card pair + one chip riding the outer orbit, and a faint spade in a
 * tick-mark ring. Calm (6–10 s per turn). Static under prefers-reduced-motion.
 *
 * <OrbitLoader caption='Loading the arena' />
 * <OrbitLoader size={220} caption='Seating agents 2/6' />
 */
export function OrbitLoader({
  caption,
  size = 280,
  className,
  children,
}: {
  caption?: React.ReactNode;
  /** Diameter in px (scales down on narrow screens via max-width). */
  size?: number;
  className?: string;
  /** Optional extra line under the caption (e.g. a link). */
  children?: React.ReactNode;
}) {
  const ticks = Array.from({ length: 72 });
  return (
    <div
      role='status'
      aria-live='polite'
      className={cn('flex flex-col items-center gap-4 text-center', className)}
    >
      <div
        className='orbit relative aspect-square w-full'
        style={{ maxWidth: size }}
        aria-hidden
      >
        <svg viewBox='0 0 200 200' className='absolute inset-0 h-full w-full'>
          {/* rings */}
          <circle cx='100' cy='100' r='96' fill='none' stroke='var(--border)' strokeWidth='0.6' />
          <circle cx='100' cy='100' r='80' fill='none' stroke='var(--border)' strokeWidth='0.6' />
          <circle cx='100' cy='100' r='62' fill='none' stroke='var(--border)' strokeWidth='0.4' opacity='0.7' />
          {/* tick ring */}
          <g opacity='0.55'>
            {ticks.map((_, i) => (
              <line
                key={i}
                x1='100'
                y1='52'
                x2='100'
                y2={i % 6 === 0 ? '57' : '55'}
                stroke='var(--text-disabled)'
                strokeWidth='0.6'
                transform={`rotate(${i * 5} 100 100)`}
              />
            ))}
          </g>
          {/* spade */}
          <path
            d='M100 76c-4 7-15 13-15 22a8.5 8.5 0 0 0 13.5 6.6L96.6 116h6.8l-1.9-11.4A8.5 8.5 0 0 0 115 98c0-9-11-15-15-22Z'
            fill='var(--surface-3)'
          />
          {/* rotating arcs */}
          <g className='orbit-spin orbit-spin-a'>
            <circle cx='100' cy='100' r='96' fill='none' stroke='var(--accent)' strokeWidth='1' strokeLinecap='round' strokeDasharray='70 533' opacity='0.9' />
          </g>
          <g className='orbit-spin orbit-spin-b'>
            <circle cx='100' cy='100' r='80' fill='none' stroke='var(--accent)' strokeWidth='0.9' strokeLinecap='round' strokeDasharray='48 455' strokeDashoffset='-200' opacity='0.7' />
          </g>
          <g className='orbit-spin orbit-spin-c'>
            <circle cx='100' cy='100' r='96' fill='none' stroke='var(--accent)' strokeWidth='0.8' strokeLinecap='round' strokeDasharray='36 567' strokeDashoffset='-330' opacity='0.5' />
          </g>
          {/* riders on the outer orbit: card pair + chip */}
          <g className='orbit-spin orbit-spin-riders'>
            <g transform='translate(100 4)'>
              <g transform='rotate(-14) translate(-13 -9)'>
                <rect width='15' height='21' rx='2' fill='#E9EEEB' stroke='#0B0F0D' strokeWidth='0.4' />
                <text x='2.5' y='7' fontSize='5.5' fontWeight='700' fill='#C2414B' fontFamily='var(--font-sans)'>A</text>
              </g>
              <g transform='rotate(8) translate(-4 -10)'>
                <rect width='15' height='21' rx='2' fill='#F2F5F3' stroke='#0B0F0D' strokeWidth='0.4' />
                <text x='2.5' y='7' fontSize='5.5' fontWeight='700' fill='#0B0F0D' fontFamily='var(--font-sans)'>A</text>
                <path d='M7.5 9.5c-1 1.8-3.6 3.2-3.6 5.3a2 2 0 0 0 3.2 1.6l-.5 2.6h1.8l-.5-2.6a2 2 0 0 0 3.2-1.6c0-2.1-2.6-3.5-3.6-5.3Z' fill='#0B0F0D' />
              </g>
            </g>
            <g transform='rotate(118 100 100) translate(100 4)'>
              <circle r='6' fill='#101613' stroke='var(--accent)' strokeWidth='1' />
              <circle r='3.6' fill='none' stroke='var(--accent)' strokeWidth='0.6' strokeDasharray='1.6 1.2' />
            </g>
          </g>
          {/* fixed markers */}
          <circle cx='4' cy='100' r='1.6' fill='none' stroke='var(--text-disabled)' strokeWidth='0.6' />
          <circle cx='196' cy='100' r='1.6' fill='none' stroke='var(--text-disabled)' strokeWidth='0.6' />
        </svg>
      </div>
      {caption ? <p className='text-label uppercase tracking-[0.24em] text-fg-muted'>{caption}</p> : null}
      {children}
      <style>{`
        .orbit-spin { transform-origin: 100px 100px; transform-box: view-box; animation: orbit-rot linear infinite; }
        .orbit-spin-a { animation-duration: 8s; }
        .orbit-spin-b { animation-duration: 10s; animation-direction: reverse; }
        .orbit-spin-c { animation-duration: 6s; }
        .orbit-spin-riders { animation-duration: 10s; }
        @keyframes orbit-rot { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .orbit-spin { animation: none !important; } }
      `}</style>
    </div>
  );
}
