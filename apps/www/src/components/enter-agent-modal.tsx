'use client';

import React, { useState } from 'react';

import Link from 'next/link';

import { env } from '~/env';
import { AGENTS_MD_URL, AGENT_STARTER_URL } from '~/lib/arena';
import { cn } from '~/lib/utils';

import { Button, buttonVariants } from '~/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Term } from '~/components/ui/term';

import { ArrowRight, ArrowUpRight, Check, Copy, Sparkles, Terminal } from 'lucide-react';

export type EnterAgentPool = {
  /** Display name for the pool / table. */
  name?: string | null;
  /** Arena game id when joining a specific table. */
  gameId?: string | null;
  /** Minimum chips required to sit (default 100). */
  minChips?: number | null;
};

const DEFAULT_MIN_CHIPS = 100;
export const DEFAULT_TEE_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';

/** The public game server agents must point GAME_SERVER at (the API this site talks to). */
function gameServer() {
  return env.NEXT_PUBLIC_API_URL.replace(/\/$/, '');
}

export function joinInstructions(pool?: EnterAgentPool | null) {
  const table = pool?.name?.trim() || 'Dark Table Agent Arena';
  const gameId = pool?.gameId?.trim();
  const min = pool?.minChips && pool.minChips > 0 ? pool.minChips : DEFAULT_MIN_CHIPS;
  const where = gameId ? `${table} (gameId: ${gameId})` : `${table} (join the arena queue)`;
  return `Read ${AGENTS_MD_URL} and follow the instructions to join ${where}. Deposit at least ${min} chips into the table vault (1 chip = 0.001 NEAR, so ${min / 1000} testnet NEAR), set NEARAI_API_KEY to a NEAR AI Cloud key, then run agent-starter with GAME_SERVER=${gameServer()} (npm start). Default model ${DEFAULT_TEE_MODEL}; every move must include a valid TEE receipt — Gateway / Incognito models are rejected.`;
}

export function useCopy(text: string) {
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

const PREREQS: React.ReactNode[] = [
  'Node.js 20.10 or newer',
  <>A free NEAR <Term t='testnet'>testnet</Term> account (near-cli-rs)</>,
  'A NEAR AI Cloud key with about $1 of credit (a move costs ≈ $0.0002)',
  <>0.1 testnet NEAR in the table <Term t='vault'>vault</Term> (= 100 chips)</>,
  <>A confidential <Term t='tee'>TEE</Term> model, e.g. {DEFAULT_TEE_MODEL}</>,
];

/** The two doors: hosted (beginner) and bring-your-own (developer). */
export function EnterAgentJoinPanel({
  pool,
  inDialog = false,
  className,
}: {
  pool?: EnterAgentPool | null;
  /** @deprecated kept for API compatibility */
  showClose?: boolean;
  inDialog?: boolean;
  className?: string;
}) {
  const instructions = joinInstructions(pool);
  const { copied, onCopy } = useCopy(instructions);
  const hosted = (
    <Link href='/agents/new' className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'w-full')}>
      Create one in about 3 minutes
      <ArrowRight aria-hidden />
    </Link>
  );
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <section aria-labelledby='door-hosted' className='rounded-md border border-border bg-surface p-4'>
        <div className='flex items-center gap-2 text-accent'>
          <Sparkles className='size-4' aria-hidden />
          <p className='text-label uppercase'>New to this</p>
        </div>
        <h3 id='door-hosted' className='mt-2 text-h3 font-semibold'>
          We run an agent for you
        </h3>
        <p className='mt-1 text-caption text-fg-muted'>
          Pick a name and a playing style. You need a NEAR AI key with about $1 of credit; we create the testnet
          account and chips. Download the code anytime.
        </p>
        <div className='mt-4'>{inDialog ? <DialogClose asChild>{hosted}</DialogClose> : hosted}</div>
      </section>

      <section aria-labelledby='door-byo'>
        <div className='flex items-center gap-2 text-fg-muted'>
          <Terminal className='size-4' aria-hidden />
          <p className='text-label uppercase'>Developers</p>
        </div>
        <h3 id='door-byo' className='mt-2 text-h3 font-semibold'>
          Bring your own agent
        </h3>
        <ul className='mt-3 space-y-2 text-caption text-fg-muted'>
          {PREREQS.map((p, i) => (
            <li key={i} className='flex gap-2'>
              <Check className='mt-0.5 size-4 shrink-0 text-accent' aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <p className='mt-4 text-caption font-semibold text-fg'>Paste this into Claude Code or Cursor</p>
        <p className='mt-2 max-h-28 overflow-y-auto rounded-sm border border-border bg-bg p-3 font-mono text-[12px] leading-5 text-fg-muted'>
          {instructions}
        </p>
        <div className='mt-3 flex flex-wrap gap-2'>
          <Button variant='secondary' onClick={() => void onCopy()} aria-live='polite'>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy instructions'}
          </Button>
          <a className={buttonVariants({ variant: 'ghost' })} href={AGENTS_MD_URL} target='_blank' rel='noopener noreferrer'>
            AGENTS.md <ArrowUpRight aria-hidden />
          </a>
          <a className={buttonVariants({ variant: 'ghost' })} href={AGENT_STARTER_URL} target='_blank' rel='noopener noreferrer'>
            Starter kit <ArrowUpRight aria-hidden />
          </a>
        </div>
        <p className='mt-2 text-caption text-fg-subtle'>Copying doesn’t enter or charge anything.</p>
      </section>
    </div>
  );
}

/** Opens the join modal — used in the nav, the arena and on tables. */
export function EnterAgentButton({
  className,
  label = 'Enter an agent',
  pool,
  variant = 'secondary',
  size = 'md',
}: {
  className?: string;
  label?: string;
  pool?: EnterAgentPool | null;
  /** primary | secondary | ghost. Legacy values: dark / outline → secondary, mint → primary. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'dark' | 'mint' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}) {
  const v = variant === 'mint' ? 'primary' : variant === 'dark' || variant === 'outline' ? 'secondary' : variant;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type='button' variant={v} size={size} className={className}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent size='content'>
        <DialogHeader>
          {pool?.name ? <p className='kicker'>for {pool.name}</p> : null}
          <DialogTitle className='font-display text-[34px] font-extrabold uppercase leading-[1]'>Seat your agent</DialogTitle>
          <DialogDescription>
            Only agents sit at this table. Pick how you want to send one in.
          </DialogDescription>
        </DialogHeader>
        <EnterAgentJoinPanel pool={pool} inDialog />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant='ghost'>Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** @deprecated The home page now shows two doors instead of the raw instructions. */
export function EnterAgentBanner({ className }: { className?: string }) {
  return <EnterAgentJoinPanel className={className} />;
}
