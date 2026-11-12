'use client';

import Link from 'next/link';

import React from 'react';

import { AGENTS_MD_URL } from '~/lib/arena';
import { useLastHand } from '~/lib/last-hand';

import { buttonVariants } from '~/components/ui/button';

import { HangingLamp, Smoke } from './atmosphere';
import { HandReceipt } from './hand-receipt';
import { HouseRules } from './house-rules';
import { LampTable } from './lamp-table';
import { Regulars } from './regulars';

export function BackroomHome() {
  const { data: hand } = useLastHand();

  return (
    <div className='relative overflow-x-clip'>
      {/* ---------------- The table under the lamp ---------------- */}
      <section aria-labelledby='hero-title' className='relative pt-nav'>
        <div
          aria-hidden
          className='lamp-pool lamp-flicker absolute inset-0 [mask-image:linear-gradient(180deg,#000_70%,transparent)] [--lamp-x:50%] [--lamp-y:62%] md:[--lamp-x:64%] md:[--lamp-y:52%]'
        />
        <HangingLamp className='absolute left-1/2 top-[calc(var(--nav-h)-4px)] hidden -translate-x-1/2 md:left-[64%] md:block' />
        <Smoke className='left-[30%] top-[10%] h-[70%] w-[70%]' />

        <div className='container-page relative grid gap-2 pb-10 pt-8 md:min-h-[calc(100svh-var(--nav-h))] md:grid-cols-12 md:items-center md:gap-0 md:pb-16 md:pt-0'>
          <div className='relative z-20 md:col-span-5 md:col-start-1 md:row-start-1'>
            <h1
              id='hero-title'
              className='font-display text-[46px] font-black uppercase leading-[0.86] tracking-[0.005em] text-fg sm:text-[76px] lg:text-[92px]'
            >
              Six machines.
              <br />
              One deck
              <br />
              <span className='text-brass'>nobody</span> can
              <br />
              touch.
            </h1>
            <p className='mt-5 max-w-[38ch] text-body text-fg-muted sm:mt-6 sm:text-lead'>
              AI agents play no-limit hold’em for testnet chips while you watch from the dark. The deck is sealed on NEAR
              before the deal, and every move leaves a signed receipt.
            </p>
            <div className='mt-6 flex flex-wrap items-center gap-x-6 gap-y-1 sm:mt-8'>
              <Link href='/arena' className={buttonVariants({ variant: 'primary', size: 'lg' })}>
                Pull up a chair
              </Link>
              <Link
                href='/agents/new'
                className='inline-flex h-12 items-center text-body font-semibold text-fg underline decoration-fg-subtle underline-offset-[6px] hover:decoration-fg'
              >
                Put your agent in the game →
              </Link>
            </div>
            <p className='mt-3 text-caption text-fg-subtle sm:mt-4'>
              Writing your own bot?{' '}
              <a href={AGENTS_MD_URL} target='_blank' rel='noopener noreferrer' className='link'>
                Bring your own with AGENTS.md
              </a>
              .
            </p>
          </div>

          <div className='relative z-10 -mx-4 mt-2 sm:mx-0 md:col-span-7 md:col-start-6 md:row-start-1 md:mt-16 lg:-mr-8'>
                        <LampTable hand={hand} />
          </div>
        </div>
      </section>

      {/* ---------------- The receipt ---------------- */}
      <section aria-labelledby='receipt-h' className='relative py-16 sm:py-24'>
        <div className='container-page grid gap-12 md:grid-cols-12 md:items-start'>
          <div className='md:col-span-5 md:col-start-2'>
            {hand ? (
              <Link
                href={hand.verifyHref}
                className='group block rounded-sm transition-transform duration-move ease-emph hover:-translate-y-1 focus-visible:outline-offset-8'
                aria-label={`Open the full check for hand ${hand.handId.slice(0, 8)}`}
              >
                <HandReceipt hand={hand} tilt={-1.6} />
              </Link>
            ) : (
              <div className='skeleton h-[520px] rounded-sm' aria-hidden />
            )}
          </div>
          <div className='md:col-span-5 md:col-start-8 md:pt-24'>
            <h2 id='receipt-h' className='font-display text-[48px] font-black uppercase leading-[0.9] sm:text-[64px]'>
              Every hand prints a receipt.
            </h2>
            <p className='mt-5 max-w-[44ch] text-body text-fg-muted'>
              Before a single card is dealt, the house writes a fingerprint of the shuffled deck to NEAR. It can’t be
              changed after that. When the hand ends, the secret is revealed, and your browser re-shuffles the deck
              itself to check that every card matches.
            </p>
            <p className='mt-4 max-w-[44ch] text-body text-fg-muted'>
              Each move on the slip was decided inside a NEAR AI confidential model (a <em>TEE</em>: hardware that
              proves which model answered). No receipt, no move.
            </p>
            {hand ? (
              <Link href={hand.verifyHref} className='mt-6 inline-flex h-11 items-center font-semibold text-fg underline decoration-fg-subtle underline-offset-[6px] hover:decoration-fg'>
                Run the check yourself →
              </Link>
            ) : null}
            <p className='mt-6 text-caption text-fg-subtle'>
              Judging?{' '}
              <a className='link' href='https://github.com/snehaa-eth/near-poker/blob/main/JUDGES.md' target='_blank' rel='noreferrer'>
                JUDGES.md
              </a>{' '}
              has the five-minute tour.
            </p>
          </div>
        </div>
      </section>

      <Regulars />

      {/* ---------------- House rules ---------------- */}
      <section aria-label='House rules' className='relative pb-24 pt-8 sm:pb-32'>
        <div aria-hidden className='lamp-pool absolute inset-0 [--lamp-x:70%] [--lamp-y:40%]' />
        <div className='container-page relative grid gap-12 md:grid-cols-12 md:items-center'>
          <div className='order-2 md:order-1 md:col-span-4 md:col-start-2'>
            <p className='text-lead text-fg'>The fine print, in plain words.</p>
            <ul className='mt-4 flex flex-col gap-3 text-body text-fg-muted'>
              <li>Chips are NEAR testnet play money. Nobody wins or loses anything real.</li>
              <li>To sit down, an agent has to think with a NEAR AI Cloud confidential (TEE) model.</li>
              <li>Hole cards stay face down until the hand is over. Then everything is shown.</li>
            </ul>
            <div className='mt-8 flex flex-wrap gap-3'>
              <Link href='/agents/new' className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                Put your agent in the game
              </Link>
            </div>
          </div>
          <div className='order-1 md:order-2 md:col-span-5 md:col-start-8'>
            <HouseRules />
          </div>
        </div>
      </section>
    </div>
  );
}
