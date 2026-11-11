'use client';

import Image from 'next/image';
import Link from 'next/link';

import React, { useEffect, useRef, useState } from 'react';

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';

import { Button } from '~/components/ui/button';
import { CARD_BACKS } from '~/lib/helpers';

const spring = { stiffness: 80, damping: 22, mass: 0.6 };
const flipSpring = {
  type: 'spring' as const,
  stiffness: 160,
  damping: 18,
  mass: 0.7,
};

const HERO_CARDS = [
  {
    front: '/cards/HEART-1.svg',
    label: 'Ace of hearts',
    rotate: -12,
    delay: 0.05,
  },
  {
    front: '/cards/SPADE-13.svg',
    label: 'King of spades',
    rotate: 0,
    delay: 0.15,
  },
  {
    front: '/cards/DIAMOND-12.svg',
    label: 'Queen of diamonds',
    rotate: 12,
    delay: 0.25,
  },
] as const;

function CardBack({ variant = 0 }: { variant?: number }) {
  const src = CARD_BACKS[variant % CARD_BACKS.length]!;
  return (
    <div className='absolute inset-0 overflow-hidden rounded-xl bg-black shadow-[0_24px_40px_rgba(15,15,15,0.18)]'>
      <Image
        src={src}
        alt=''
        fill
        priority
        className='pointer-events-none select-none object-cover'
        sizes='(max-width: 768px) 30vw, 200px'
      />
    </div>
  );
}

function FloatingCard({
  frontSrc,
  label,
  rotate,
  x,
  y,
  delay = 0,
  reduceMotion,
  backVariant = 0,
}: {
  frontSrc: string;
  label: string;
  rotate: number;
  x: MotionValue<number>;
  y: MotionValue<number>;
  delay?: number;
  reduceMotion: boolean;
  backVariant?: number;
}) {
  const [flipped, setFlipped] = useState(false);

  return (
    <motion.div
      className='relative w-[min(28vw,9.75rem)] shrink-0 cursor-pointer sm:w-[10.75rem] md:w-[11.5rem]'
      style={{ x, y, zIndex: 1, perspective: 1200 }}
      initial={{ opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: 'spring',
        stiffness: 120,
        damping: 18,
        delay,
      }}
    >
      <motion.button
        type='button'
        aria-label={flipped ? `Hide ${label}` : `Reveal ${label}`}
        aria-pressed={flipped}
        onClick={() => setFlipped((v) => !v)}
        whileHover={{ scale: 1.04, y: -4 }}
        whileTap={{ scale: 0.98 }}
        className='relative aspect-[63/88] w-full border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F7F8]'
        style={{ transformStyle: 'preserve-3d', rotate }}
      >
        <motion.div
          animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
          transition={{
            duration: 4.2,
            repeat: Infinity,
            ease: 'easeInOut',
            delay,
          }}
          className='relative h-full w-full'
          style={{ transformStyle: 'preserve-3d' }}
        >
          <motion.div
            className='relative h-full w-full'
            style={{ transformStyle: 'preserve-3d' }}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={reduceMotion ? { duration: 0 } : flipSpring}
          >
            <div
              className='absolute inset-0'
              style={{ backfaceVisibility: 'hidden' }}
            >
              <CardBack variant={backVariant} />
            </div>
            <div
              className='absolute inset-0 overflow-hidden rounded-xl'
              style={{
                backfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <Image
                src={frontSrc}
                alt={label}
                fill
                className='pointer-events-none select-none object-contain drop-shadow-[0_24px_40px_rgba(15,15,15,0.12)]'
                sizes='(max-width: 768px) 30vw, 200px'
              />
            </div>
          </motion.div>
        </motion.div>
      </motion.button>
    </motion.div>
  );
}

export const Hero = () => {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const smoothX = useSpring(rawX, spring);
  const smoothY = useSpring(rawY, spring);

  const titleX = useTransform(smoothX, (v) => v * 0.18);
  const titleY = useTransform(smoothY, (v) => v * 0.12);
  const leftX = useTransform(smoothX, (v) => v * -0.45);
  const leftY = useTransform(smoothY, (v) => v * -0.25);
  const midX = useTransform(smoothX, (v) => v * 0.1);
  const midY = useTransform(smoothY, (v) => v * -0.4);
  const rightX = useTransform(smoothX, (v) => v * 0.45);
  const rightY = useTransform(smoothY, (v) => v * -0.25);

  const cardMotion = [
    { x: leftX, y: leftY },
    { x: midX, y: midY },
    { x: rightX, y: rightY },
  ] as const;

  const glowX = useTransform(smoothX, (v) => `${50 + v * 0.04}%`);
  const glowY = useTransform(smoothY, (v) => `${42 + v * 0.03}%`);
  const glowBg = useMotionTemplate`radial-gradient(ellipse 55% 45% at ${glowX} ${glowY}, rgba(200,230,201,0.55) 0%, rgba(247,247,248,0.2) 45%, transparent 72%)`;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    const onMove = (event: PointerEvent) => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      rawX.set(nx * 28);
      rawY.set(ny * 20);
    };

    const onLeave = () => {
      rawX.set(0);
      rawY.set(0);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, [rawX, rawY, reduceMotion]);

  return (
    <section
      ref={sectionRef}
      className='relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#F7F7F8]'
    >
      <motion.div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{ background: glowBg }}
      />

      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 opacity-[0.35]'
        style={{
          backgroundImage:
            'radial-gradient(rgba(10,10,10,0.045) 0.8px, transparent 0.8px)',
          backgroundSize: '18px 18px',
        }}
      />

      <motion.h1
        style={{ x: titleX, y: titleY }}
        className='pointer-events-none absolute inset-x-0 top-[12%] z-0 px-4 text-center font-poker text-[clamp(2.75rem,11vw,7.5rem)] font-bold leading-[0.9] tracking-[-0.04em] text-neutral-300/80'
      >
        TEXAS HOLD&apos;EM
        <br />
        <span className='text-[0.55em] tracking-[0.08em] text-neutral-400/90'>
          ON MIDNIGHT
        </span>
      </motion.h1>

      <div className='relative z-10 flex w-full max-w-3xl flex-col items-center px-4 pt-10'>
        <div className='mx-auto flex w-full max-w-2xl flex-row flex-nowrap items-center justify-center gap-3 sm:gap-5 md:gap-6'>
          {HERO_CARDS.map((card, index) => (
            <FloatingCard
              key={card.front}
              frontSrc={card.front}
              label={card.label}
              rotate={card.rotate}
              x={cardMotion[index]!.x}
              y={cardMotion[index]!.y}
              delay={card.delay}
              reduceMotion={reduceMotion}
              backVariant={index}
            />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className='mt-8 max-w-md text-center text-sm text-neutral-500 sm:text-base'
        >
          Off-chain tables. Midnight wallet identity. Buy in with NIGHT when
          you&apos;re ready.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className='mt-6 flex flex-wrap items-center justify-center gap-3'
        >
          <Button
            asChild
            className='rounded-full bg-neutral-950 px-6 text-white hover:bg-neutral-800'
          >
            <Link href='/game'>Browse games</Link>
          </Button>
          <Button asChild variant='outline' className='rounded-full bg-white'>
            <Link href='/leaderboard'>Leaderboard</Link>
          </Button>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.8 }}
        className='pointer-events-none absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-neutral-400'
      >
        <motion.div
          animate={reduceMotion ? undefined : { y: [0, 6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          className='flex h-9 w-6 items-start justify-center rounded-full border border-neutral-300 bg-white/80 pt-1.5'
        >
          <span className='h-1.5 w-1 rounded-full bg-neutral-400' />
        </motion.div>
        <span className='text-[11px] font-medium uppercase tracking-[0.18em]'>
          Click cards to flip
        </span>
      </motion.div>
    </section>
  );
};
