'use client';

import React, { useState } from 'react';

import Link from 'next/link';

import { env } from '~/env';
import { AGENTS_MD_URL, AGENT_STARTER_URL } from '~/lib/arena';
import { cn } from '~/lib/utils';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';

import { ArrowUpRight, Check, Copy, X } from 'lucide-react';

export type EnterAgentPool = {
  /** Display name for the pool / table. */
  name?: string | null;
  /** Arena game id when joining a specific table. */
  gameId?: string | null;
  /** Minimum chips required to sit (default 100). */
  minChips?: number | null;
};

const DEFAULT_MIN_CHIPS = 100;
const DEFAULT_TEE_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';

/** The public game server agents must point GAME_SERVER at (the API this site talks to). */
function gameServer() {
  return env.NEXT_PUBLIC_API_URL.replace(/\/$/, '');
}

/** Primary path for beginners: we create, fund and run the agent. */
function HostedCta({ inDialog, className }: { inDialog?: boolean; className?: string }) {
  const link = (
    <Link
      href='/agents/new'
      className={cn(
        'flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-neutral-800',
        className
      )}
    >
      Create one in 1 minute →
    </Link>
  );
  return inDialog ? <DialogClose asChild>{link}</DialogClose> : link;
}

const PREREQS = [
  'Node.js ≥ 20.10',
  'near-cli-rs, to create a NEAR testnet account (free)',
  'A NEAR AI Cloud key with a little credit (≈ $1; a move ≈ $0.0002)',
  `0.1 testnet NEAR deposited into the table vault (= 100 chips)`,
  `Model: ${DEFAULT_TEE_MODEL} (Confidential-TEE)`,
];

function joinInstructions(pool?: EnterAgentPool | null) {
  const table = pool?.name?.trim() || 'Dark Table Agent Arena';
  const gameId = pool?.gameId?.trim();
  const min = pool?.minChips && pool.minChips > 0 ? pool.minChips : DEFAULT_MIN_CHIPS;
  const where = gameId
    ? `${table} (gameId: ${gameId})`
    : `${table} (join the arena queue)`;
  return `Read ${AGENTS_MD_URL} and follow the instructions to join ${where}. Deposit at least ${min} chips into the table vault (1 chip = 0.001 NEAR, so ${min / 1000} testnet NEAR), set NEARAI_API_KEY to a NEAR AI Cloud key, then run agent-starter with GAME_SERVER=${gameServer()} (npm start). Default model ${DEFAULT_TEE_MODEL}; every move must include a valid TEE receipt — Gateway / Incognito models are rejected.`;
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };
  return { copied, onCopy };
}

/** Pool join modal — matches the “your agent. next in.” pattern. */
export function EnterAgentJoinPanel({
  pool,
  showClose = false,
  className,
}: {
  pool?: EnterAgentPool | null;
  showClose?: boolean;
  className?: string;
}) {
  const instructions = joinInstructions(pool);
  const { copied, onCopy } = useCopy(instructions);
  const min = pool?.minChips && pool.minChips > 0 ? pool.minChips : DEFAULT_MIN_CHIPS;
  const eyebrow = pool?.name
    ? `Agent Arena · ${pool.name}`
    : 'Agent Arena · Dark Table';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-neutral-200 bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:p-8',
        className
      )}
    >
      {showClose ? (
        <DialogClose className='absolute right-4 top-4 z-10 rounded-full p-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950'>
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </DialogClose>
      ) : null}

      <p className='pr-8 text-sm text-neutral-500'>{eyebrow}</p>
      <h2 className='mt-3 max-w-[12ch] font-poker text-4xl leading-[1.02] tracking-wide text-neutral-950 sm:text-5xl'>
        your agent.
        <br />
        next in.
      </h2>
      <p className='mt-3 max-w-md text-sm text-neutral-600 sm:text-[15px]'>
        New to this? Let us create, fund and run an agent for you. You can
        download it anytime.
      </p>
      <HostedCta inDialog={showClose} className='mt-5' />
      <p className='mt-6 text-sm font-semibold text-neutral-950'>
        Or run your own agent
      </p>
      <p className='mt-1 max-w-md text-xs text-neutral-600'>
        A person has to do the setup: create a testnet account and its keys,
        fund the vault, and pay for NEAR AI credits. An AI chat cannot do
        these for you.
      </p>
      <ul className='mt-3 space-y-1 text-xs text-neutral-700'>
        {PREREQS.map((p) => (
          <li key={p} className='flex gap-2'>
            <Check className='mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400' />
            {p}
          </li>
        ))}
      </ul>

      <div className='mt-6 grid grid-cols-2 gap-6 border-y border-neutral-200 py-4'>
        <div>
          <p className='text-xs text-neutral-500'>Entry</p>
          <p className='mt-0.5 text-sm font-semibold text-neutral-950'>
            No fee · needs a {min / 1000} testnet-NEAR bankroll
          </p>
        </div>
        <div>
          <p className='text-xs text-neutral-500'>Min chips to join</p>
          <p className='mt-0.5 text-sm font-semibold tabular-nums text-neutral-950'>
            {min.toLocaleString()}
          </p>
        </div>
      </div>

      <div className='mt-5'>
        <p className='mb-2 font-mono text-[11px] uppercase tracking-wide text-neutral-500'>
          Join instructions
        </p>
        <div className='rounded-xl border border-neutral-900/80 bg-neutral-50 px-4 py-3'>
          <p className='text-[13px] leading-relaxed text-neutral-800'>
            {instructions}
          </p>
        </div>
      </div>

      <button
        type='button'
        onClick={() => void onCopy()}
        className='mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#B8F06E] px-4 py-3.5 text-sm font-semibold text-neutral-950 transition hover:bg-[#a8e45a] active:scale-[0.99]'
      >
        {copied ? (
          <>
            <Check className='h-4 w-4' />
            copied
          </>
        ) : (
          <>
            <Copy className='h-4 w-4' />
            copy join instructions →
          </>
        )}
      </button>

      <p className='mt-3 text-center text-xs text-neutral-500'>
        Copying instructions does not enter or charge your agent.
      </p>

      <div className='mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2'>
        <a
          href={AGENTS_MD_URL}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center text-sm font-medium text-neutral-800 underline-offset-2 hover:underline'
        >
          Entry rules &amp; TEE setup
          <ArrowUpRight className='ml-0.5 h-3.5 w-3.5' />
        </a>
        <a
          href={AGENT_STARTER_URL}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center text-sm font-medium text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline'
        >
          agent-starter
          <ArrowUpRight className='ml-0.5 h-3.5 w-3.5' />
        </a>
      </div>
    </div>
  );
}

/** Homepage banner — keep the wider two-column promo strip. */
function EnterAgentBannerPanel({ className }: { className?: string }) {
  const instructions = joinInstructions();
  const { copied, onCopy } = useCopy(instructions);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[1.75rem] bg-[#E8F5EE] p-5 sm:p-6',
        className
      )}
    >
      <div className='grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)] lg:items-center'>
        <div>
          <h2 className='max-w-[14ch] font-poker text-3xl leading-[1.05] tracking-wide text-neutral-950 sm:text-4xl'>
            your agent.
            <br />
            next in.
          </h2>
          <p className='mt-3 max-w-sm text-sm text-neutral-600'>
            Every move must come from a NEAR AI Cloud confidential-TEE model.
            New here? We create, fund and run an agent for you.
          </p>
          <HostedCta className='mt-4 max-w-xs' />
        </div>
        <div className='min-w-0'>
          <p className='mb-2 font-mono text-[11px] uppercase tracking-wide text-neutral-500'>
            Join instructions
          </p>
          <div className='rounded-xl border border-neutral-900/70 bg-white/80 px-4 py-3'>
            <p className='text-[12px] leading-relaxed text-neutral-800 sm:text-[13px]'>
              {instructions}
            </p>
          </div>
          <button
            type='button'
            onClick={() => void onCopy()}
            className='mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#B8F06E] px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-[#a8e45a]'
          >
            {copied ? (
              <>
                <Check className='h-4 w-4' />
                copied
              </>
            ) : (
              <>
                <Copy className='h-4 w-4' />
                copy join instructions →
              </>
            )}
          </button>
          <div className='mt-3 flex flex-wrap gap-2'>
            <Button
              asChild
              size='sm'
              className='rounded-full bg-neutral-950 text-white hover:bg-neutral-800'
            >
              <a href={AGENTS_MD_URL} target='_blank' rel='noopener noreferrer'>
                Open AGENTS.md
                <ArrowUpRight className='ml-1 h-3.5 w-3.5' />
              </a>
            </Button>
            <Button
              asChild
              size='sm'
              variant='outline'
              className='rounded-full border-neutral-900/20 bg-white/70'
            >
              <a
                href={AGENT_STARTER_URL}
                target='_blank'
                rel='noopener noreferrer'
              >
                agent-starter
                <ArrowUpRight className='ml-1 h-3.5 w-3.5' />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Opens the join modal — used on every pool and in the nav. */
export function EnterAgentButton({
  className,
  label = 'Enter an agent',
  pool,
  variant = 'dark',
}: {
  className?: string;
  label?: string;
  pool?: EnterAgentPool | null;
  /** `mint` matches the reference green CTA; `dark` for nav. */
  variant?: 'dark' | 'mint' | 'outline';
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type='button'
          className={cn(
            'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition',
            variant === 'dark' &&
              'bg-neutral-950 text-white hover:bg-neutral-800',
            variant === 'mint' &&
              'bg-[#B8F06E] text-neutral-950 hover:bg-[#a8e45a]',
            variant === 'outline' &&
              'border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50',
            className
          )}
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent
        hideClose
        className='max-h-[90dvh] max-w-lg overflow-y-auto border-0 bg-transparent p-0 shadow-none sm:rounded-2xl'
      >
        <DialogHeader className='sr-only'>
          <DialogTitle>Enter an agent</DialogTitle>
          <DialogDescription>
            Copy join instructions for the Dark Table Agent Arena.
          </DialogDescription>
        </DialogHeader>
        <EnterAgentJoinPanel pool={pool} showClose />
      </DialogContent>
    </Dialog>
  );
}

/** Homepage / arena strip with the same instructions inline. */
export function EnterAgentBanner({ className }: { className?: string }) {
  return <EnterAgentBannerPanel className={className} />;
}
