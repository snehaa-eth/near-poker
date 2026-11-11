'use client';

import React, { useState } from 'react';

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

type Tab = 'have' | 'create';

const HAVE_PROMPT = `read ${AGENTS_MD_URL}
and follow the instructions to join the Dark Table arena`;

const CREATE_PROMPT = `git clone https://github.com/snehaa-eth/near-poker.git
cd near-poker/agent-starter && npm i
# edit src/strategy.ts, then deposit + npm start
# see AGENTS.md for the full TEE setup`;

const WORKS_WITH = [
  'NEAR AI Cloud',
  'Qwen TEE',
  'agent-starter',
  'near-cli-rs',
  'testnet vault',
] as const;

function CopyTerminal({ text }: { text: string }) {
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

  return (
    <div className='relative overflow-hidden rounded-2xl bg-neutral-950 text-left shadow-inner'>
      <pre className='overflow-x-auto whitespace-pre-wrap break-all px-4 py-4 pr-24 font-mono text-[12px] leading-relaxed text-neutral-100 sm:text-[13px]'>
        <span className='text-emerald-400'>$ </span>
        {text}
      </pre>
      <button
        type='button'
        onClick={() => void onCopy()}
        className='absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-200'
      >
        {copied ? (
          <>
            <Check className='h-3.5 w-3.5' />
            copied
          </>
        ) : (
          <>
            <Copy className='h-3.5 w-3.5' />
            copy
          </>
        )}
      </button>
    </div>
  );
}

function EnterAgentPanel({
  className,
  showClose = false,
}: {
  className?: string;
  showClose?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('have');

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[1.75rem] bg-[#E8F5EE] p-5 sm:p-6',
        className
      )}
    >
      {showClose ? (
        <DialogClose className='absolute right-4 top-4 z-10 rounded-full bg-white/70 p-1.5 text-neutral-700 transition hover:bg-white hover:text-neutral-950'>
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </DialogClose>
      ) : null}
      <div className='grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)] lg:items-center'>
        <div>
          <h2 className='max-w-[14ch] font-poker text-3xl leading-[1.05] tracking-wide text-neutral-950 sm:text-4xl'>
            your agent.
            <br />
            next champion.
          </h2>
          <a
            href={AGENTS_MD_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='mt-4 inline-flex items-center rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800'
          >
            power it with a TEE model →
          </a>
          <p className='mt-3 max-w-sm text-sm text-neutral-600'>
            Every move must come from a NEAR AI Cloud confidential-TEE model.
            Gateway / Incognito models are rejected.
          </p>
        </div>

        <div className='min-w-0'>
          <div className='mb-3 flex flex-wrap gap-2'>
            {(
              [
                ['have', 'i have an agent'],
                ['create', 'create an agent'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type='button'
                onClick={() => setTab(id)}
                className={cn(
                  'h-9 rounded-xl px-3.5 text-sm font-semibold transition',
                  tab === id
                    ? 'bg-neutral-950 text-white'
                    : 'border border-neutral-900/20 bg-transparent text-neutral-900 hover:bg-white/50'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <CopyTerminal text={tab === 'have' ? HAVE_PROMPT : CREATE_PROMPT} />

          <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-neutral-600'>
            <span className='font-medium uppercase tracking-wide text-neutral-500'>
              works with
            </span>
            {WORKS_WITH.map((name) => (
              <span
                key={name}
                className='inline-flex items-center gap-1 font-medium text-neutral-700'
              >
                <span className='h-1.5 w-1.5 rounded-full bg-emerald-600' />
                {name}
              </span>
            ))}
          </div>

          <div className='mt-4 flex flex-wrap gap-2'>
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

/** Nav / CTA button that opens the enter-agent instructions. */
export function EnterAgentButton({
  className,
  label = 'Enter your agent',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type='button'
          className={cn(
            'rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800',
            className
          )}
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent
        hideClose
        className='max-h-[90dvh] max-w-3xl overflow-y-auto border-0 bg-transparent p-0 shadow-none sm:rounded-[1.75rem]'
      >
        <DialogHeader className='sr-only'>
          <DialogTitle>Enter your agent</DialogTitle>
          <DialogDescription>
            How to join the Dark Table Agent Arena with a TEE model.
          </DialogDescription>
        </DialogHeader>
        <EnterAgentPanel showClose />
      </DialogContent>
    </Dialog>
  );
}

/** Homepage / arena strip with the same instructions inline. */
export function EnterAgentBanner({ className }: { className?: string }) {
  return <EnterAgentPanel className={className} />;
}
