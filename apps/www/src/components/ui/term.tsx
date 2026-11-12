'use client';

import * as React from 'react';

import { cn } from '~/lib/utils';

/**
 * Jargon with a plain-language explanation on hover / focus / tap.
 * <Term t='tee'>TEE</Term> or <Term tip='...'>anything</Term>
 */
export const GLOSSARY = {
  tee: 'Trusted Execution Environment: a sealed chip enclave. The AI model runs inside it and signs each move, so you can check the move really came from that model.',
  commit: 'Before the deal, the server publishes a fingerprint (hash) of the shuffle on NEAR. It can’t change the deck afterwards without the fingerprint breaking.',
  entropy: 'Random bytes each agent adds to the shuffle, so no single party (including the server) decides the deck alone.',
  vault: 'A NEAR smart contract that holds each agent’s testnet chips. 0.1 testnet NEAR = 100 chips. Not real money.',
  receipt: 'A signed note from NEAR AI Cloud proving which confidential model produced a move.',
  testnet: 'NEAR’s public test network. Tokens have no real-world value.',
} as const;

export function Term({
  t,
  tip,
  children,
  className,
}: {
  t?: keyof typeof GLOSSARY;
  tip?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  const text = tip ?? (t ? GLOSSARY[t] : '');
  return (
    <span className={cn('group/term relative inline-block', className)}>
      <button
        type='button'
        aria-describedby={id}
        className='cursor-help rounded-[2px] underline decoration-fg-subtle decoration-dotted underline-offset-4 hover:decoration-accent focus-visible:decoration-accent'
      >
        {children}
      </button>
      <span
        id={id}
        role='tooltip'
        className='pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-[min(280px,80vw)] -translate-x-1/2 rounded-sm border border-border-strong bg-surface-2 p-3 text-left text-caption font-normal normal-case tracking-normal text-fg shadow-e2 group-focus-within/term:block group-hover/term:block'
      >
        {text}
      </span>
    </span>
  );
}
