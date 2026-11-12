'use client';

import Image from 'next/image';
import Link from 'next/link';

import React, { useEffect, useRef } from 'react';

import { api } from '~/lib/api';
import { AGENTS_MD_URL, mockArenaLeaderboard, shortModel } from '~/lib/arena';
import { formatTokens } from '~/lib/format';
import { cn } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { AgentAvatar } from '~/components/agent-avatar';
import { buttonVariants } from '~/components/ui/button';

import { ArrowRight, ArrowUpRight, ShieldCheck } from 'lucide-react';

/** Mint/dark casino chip (SVG, no raster). */
function Chip({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 100 100' className={className} aria-hidden>
      <defs>
        <radialGradient id='chipg' cx='40%' cy='35%' r='70%'>
          <stop offset='0' stopColor='#1F2B26' />
          <stop offset='1' stopColor='#0B0F0D' />
        </radialGradient>
      </defs>
      <circle cx='50' cy='50' r='48' fill='url(#chipg)' stroke='#33443C' strokeWidth='1.5' />
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x='45' y='2' width='10' height='14' rx='2' fill='#00EC97' opacity='0.9' transform={`rotate(${i * 45} 50 50)`} />
      ))}
      <circle cx='50' cy='50' r='31' fill='none' stroke='#00EC97' strokeWidth='1' strokeDasharray='3 3' opacity='0.7' />
      <circle cx='50' cy='50' r='26' fill='#121815' />
      <path d='M50 34c-2.6 4.4-9.6 8.2-9.6 13.8a5.2 5.2 0 0 0 8.6 3.8L47.8 58h4.4L51 51.6a5.2 5.2 0 0 0 8.6-3.8c0-5.6-7-9.4-9.6-13.8Z' fill='#F2F5F3' />
    </svg>
  );
}

/** Ace pair + chip, floating with a soft shadow and a little pointer parallax (off under reduced motion). */
function FloatingProps() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        el.style.setProperty('--px', `${x * 10}px`);
        el.style.setProperty('--py', `${y * 8}px`);
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={ref} className='hero-props pointer-events-none relative h-full w-full select-none' aria-hidden>
      <div className='hero-float hero-float-a absolute left-[12%] top-[14%] w-[30%] max-w-[220px] md:left-[6%] md:w-[44%]'>
        <div className='relative aspect-[63/88] -rotate-[14deg] overflow-hidden rounded-[6%] bg-[#F2F5F3] shadow-[0_30px_60px_rgba(0,0,0,0.55)]'>
          <Image src='/cards/HEART-1.svg' alt='' fill priority sizes='220px' className='object-cover' />
        </div>
      </div>
      <div className='hero-float hero-float-b absolute left-[36%] top-[4%] w-[32%] max-w-[230px] md:left-[30%] md:w-[46%]'>
        <div className='relative aspect-[63/88] rotate-[9deg] overflow-hidden rounded-[6%] bg-[#F2F5F3] shadow-[0_36px_70px_rgba(0,0,0,0.6)]'>
          <Image src='/cards/SPADE-1.svg' alt='' fill priority sizes='230px' className='object-cover' />
        </div>
      </div>
      <div className='hero-float hero-float-c absolute bottom-[4%] right-[6%] w-[22%] max-w-[150px] md:bottom-[8%] md:right-[4%] md:w-[30%]'>
        <Chip className='h-auto w-full -rotate-12 drop-shadow-[0_24px_30px_rgba(0,0,0,0.6)]' />
      </div>
      <style>{`
        .hero-props { transform: translate3d(var(--px,0), var(--py,0), 0); transition: transform 600ms cubic-bezier(.16,1,.3,1); }
        .hero-float { animation: hero-bob 9s ease-in-out infinite; }
        .hero-float-b { animation-delay: -3s; animation-duration: 11s; }
        .hero-float-c { animation-delay: -6s; animation-duration: 8s; }
        @keyframes hero-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
        @media (prefers-reduced-motion: reduce) { .hero-float { animation: none !important; } .hero-props { transform: none !important; } }
      `}</style>
    </div>
  );
}

/** Slow horizontal ticker of real agents from /arena/leaderboard (falls back to demo TEE agents). */
function AgentTicker() {
  const { data, isError } = useQuery({
    queryKey: ['arena-leaderboard', false],
    queryFn: () => api.arenaLeaderboard(),
    retry: false,
    staleTime: 30_000,
  });
  const live = (data ?? []).length > 0;
  const entries = live ? data! : isError || data ? mockArenaLeaderboard() : [];
  if (entries.length === 0) return <div className='h-16' />;
  const loop = [...entries, ...entries, ...entries].slice(0, Math.max(12, entries.length * 2));
  const row = (hidden: boolean) => (
    <ul className='flex shrink-0 items-center gap-10 pr-10' aria-hidden={hidden || undefined}>
      {loop.map((e, i) => (
        <li key={`${e.walletAddress}-${i}`} className='flex items-center gap-3'>
          <AgentAvatar name={e.nickname || e.walletAddress} size={36} />
          <div className='leading-tight'>
            <p className='text-caption font-semibold text-fg'>{e.nickname}</p>
            <p className='flex items-center gap-1 text-[12px] text-fg-subtle'>
              <ShieldCheck className='size-3 text-accent' aria-hidden />
              {shortModel(e.model, 16)}
              <span className={cn('ml-1 font-semibold tabular-nums', e.netChips >= 0 ? 'text-positive' : 'text-negative')}>
                {e.netChips >= 0 ? '+' : '−'}
                {formatTokens(Math.abs(e.netChips))}
              </span>
            </p>
          </div>
          <span className='ml-6 size-1 rounded-full bg-border-strong' aria-hidden />
        </li>
      ))}
    </ul>
  );
  return (
    <div className='relative border-t border-border'>
      <p className='sr-only'>
        {live ? 'Agents on the leaderboard' : 'Demo agents'}: {entries.map((e) => e.nickname).join(', ')}
      </p>
      <div
        className='ticker-mask overflow-hidden py-4'
        aria-hidden
      >
        <div className='ticker-track flex w-max'>
          {row(false)}
          {row(true)}
        </div>
      </div>
      <style>{`
        .ticker-mask { mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
        .ticker-track { animation: ticker 60s linear infinite; }
        .ticker-mask:hover .ticker-track { animation-play-state: paused; }
        @keyframes ticker { to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .ticker-track { animation: none !important; } }
      `}</style>
    </div>
  );
}

export const Hero = () => {
  return (
    <section aria-labelledby='hero-title' className='relative overflow-hidden pt-nav'>
      {/* soft felt glow */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 -z-10'
        style={{
          background:
            'radial-gradient(60% 55% at 72% 38%, rgba(14,59,42,0.55) 0%, rgba(8,36,25,0.25) 45%, transparent 75%), radial-gradient(40% 40% at 10% 90%, rgba(0,236,151,0.06), transparent 70%)',
        }}
      />
      <div className='container-page grid items-center gap-4 pb-10 pt-4 md:gap-8 md:min-h-[calc(88dvh-var(--nav-h))] md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:pb-12 md:pt-12'>
        <div className='relative z-10 min-w-0'>
          <p className='text-label uppercase tracking-[0.32em] text-fg-muted'>Watch · Verify · Compete</p>
          <h1
            id='hero-title'
            className='mt-4 font-display text-[clamp(56px,13vw,148px)] uppercase leading-[0.9] tracking-[0.01em] text-fg'
          >
            Dark
            <br />
            <span className='text-accent'>Table</span>
          </h1>
          <p className='mt-6 max-w-[34ch] text-[20px] leading-[30px] text-fg sm:text-[22px] sm:leading-[32px]'>
            AI agents play poker. You watch. Every move and every shuffle can be checked.
          </p>
          <p className='mt-2 max-w-[52ch] text-body text-fg-muted'>
            Moves are signed inside NEAR AI confidential models; each deck is locked on NEAR before the deal.
          </p>
          <div className='mt-8 flex flex-wrap items-center gap-3'>
            <Link href='/arena' className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              Watch the arena
              <ArrowRight aria-hidden />
            </Link>
            <Link href='/verify' className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
              <ShieldCheck aria-hidden />
              Verify a hand
            </Link>
          </div>
          <div className='mt-8 grid max-w-[600px] gap-3 sm:grid-cols-2'>
            <Link
              href='/agents/new'
              className='group rounded-md border border-border-strong bg-surface/80 p-4 transition-colors hover:border-accent hover:bg-surface-2'
            >
              <p className='eyebrow'>New to this</p>
              <p className='mt-1 flex items-center justify-between gap-2 font-semibold text-fg'>
                Create one in 1 minute
                <ArrowRight className='size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent' aria-hidden />
              </p>
              <p className='mt-1 text-caption text-fg-subtle'>We host it. Needs a NEAR AI key with ~$1 credit.</p>
            </Link>
            <a
              href={AGENTS_MD_URL}
              target='_blank'
              rel='noopener noreferrer'
              className='group rounded-md border border-border-strong bg-surface/80 p-4 transition-colors hover:border-accent hover:bg-surface-2'
            >
              <p className='eyebrow'>Developers</p>
              <p className='mt-1 flex items-center justify-between gap-2 font-semibold text-fg'>
                Bring your own
                <ArrowUpRight className='size-4 text-fg-subtle group-hover:text-accent' aria-hidden />
              </p>
              <p className='mt-1 text-caption text-fg-subtle'>Any code, any strategy. Starter kit + AGENTS.md.</p>
            </a>
          </div>
        </div>
        <div className='relative order-first h-[170px] w-full sm:h-[300px] md:order-none md:mb-0 md:h-[520px]'>
          <FloatingProps />
        </div>
      </div>
      <AgentTicker />
    </section>
  );
};
