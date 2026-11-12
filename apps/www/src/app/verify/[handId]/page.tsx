'use client';

import Link from 'next/link';

import React, { useMemo } from 'react';

import { api } from '~/lib/api';
import { mockArenaMoves } from '~/lib/arena';
import { engineCardLabel, engineIdToUiId, uiIdToEngineId } from '~/lib/fairness';
import { getPokerCardImage } from '~/lib/helpers';
import { demoHand, summarizeHand } from '~/lib/last-hand';
import { demoRecord, isUiSpace, txList, verifyHand as verify } from '~/lib/verify-hand';
import { explorerTxUrl } from '~/lib/near/rpc';
import { cn, errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { HandMoveLog } from '~/components/arena/move-log';
import { HandReceipt } from '~/components/backroom/hand-receipt';
import { Button, buttonVariants } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { EmptyState, ErrorState, Page, PageHeader } from '~/components/ui/states';
import { Term } from '~/components/ui/term';

import { ArrowUpRight, Link2, RefreshCw, SearchX } from 'lucide-react';

const TX_LABEL: Record<string, { label: string; hint: string }> = {
  commit: { label: 'Deck commitment', hint: 'The shuffle fingerprint, written on NEAR before the deal' },
  reveal: { label: 'Seed reveal', hint: 'The secret seed, published after the hand' },
  settle: { label: 'Settlement', hint: 'Chip results written to the table vault' },
};

function CardImg({ id }: { id: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getPokerCardImage(engineIdToUiId(id))}
      alt={engineCardLabel(id)}
      title={engineCardLabel(id)}
      className='h-14 w-10 rounded-[5px] object-cover shadow-[0_2px_6px_rgba(0,0,0,0.4)] sm:h-16 sm:w-[46px]'
    />
  );
}

function Mono({ label, value, action }: { label: React.ReactNode; value?: string | null; action?: React.ReactNode }) {
  return (
    <div className='min-w-0 border-b border-border py-3 last:border-0'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='eyebrow'>{label}</p>
        {action}
      </div>
      <p className='mt-1 break-all font-mono text-[12px] leading-5 text-fg sm:text-caption'>{value ?? '—'}</p>
    </div>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a href={explorerTxUrl(hash)} target='_blank' rel='noopener noreferrer' className='link inline-flex items-center gap-1 text-caption font-semibold'>
      <Link2 className='size-3.5' aria-hidden />
      {label}
      <ArrowUpRight className='size-3.5' aria-hidden />
      <span className='sr-only'>(opens NEAR explorer)</span>
    </a>
  );
}

export default function VerifyHandPage({
  params,
  searchParams,
}: {
  params: { handId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const handId = decodeURIComponent(params.handId);
  const isDemo = handId === 'demo';
  const mockMoves = searchParams?.mock === '1' || isDemo;

  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['hand', handId],
    queryFn: () => (isDemo ? Promise.resolve(demoRecord()) : api.getHand(handId)),
    retry: false,
  });

  const result = useMemo(() => (data ? verify(data) : null), [data]);
  const movesQ = useQuery({
    queryKey: ['arena-moves', handId, mockMoves],
    queryFn: () => (mockMoves ? Promise.resolve(mockArenaMoves()) : api.arenaMoves(handId)),
    retry: false,
  });
  const summary = useMemo(() => {
    if (!data) return null;
    if (isDemo) return demoHand();
    return summarizeHand(data, movesQ.data ?? [], { source: 'live', tableName: 'NEAR testnet table' });
  }, [data, isDemo, movesQ.data]);
  const failed = result?.checks.some((c) => c.status === 'fail');
  const allPass = result && !failed && result.checks.every((c) => c.status === 'pass');
  const seats = data ? [...data.seats].sort((a, b) => a.seat - b.seat) : [];
  const toEngine = (ids: number[]) => (data && isUiSpace(data) ? ids.map(uiIdToEngineId) : ids);
  const txs = txList(data?.txs);
  const commitTx = txs.find((t) => t.label === 'commit');
  const revealTx = txs.find((t) => t.label === 'reveal');
  const notFound = Boolean(error && /HandNotFound|\(404\)/.test(errorHandler(error)));
  const shortId = handId.length > 12 ? `${handId.slice(0, 8)}…` : handId;

  return (
    <Page narrow className='[&>div]:max-w-[1040px]'>
      <PageHeader
        eyebrow={isDemo ? 'Demo hand · no server needed' : 'Hand check'}
        title='Read the slip'
        lead={
          <>
            Your browser takes the secret the house revealed after the hand, mixes in each agent’s{' '}
            <Term t='entropy'>randomness</Term>, re-shuffles the deck and checks it against the fingerprint{' '}
            <Term t='commit'>sealed before the deal</Term>. The server hands over the data. The maths happens here.
          </>
        }
      />
      <p className='-mt-4 mb-8 break-all font-mono text-[12px] text-fg-subtle'>Hand {handId}</p>

      {isLoading ? (
        <div className='flex flex-col gap-4'>
          <Skeleton className='h-14 rounded-md' />
          <Skeleton className='h-72 rounded-md' />
        </div>
      ) : notFound ? (
        <EmptyState
          icon={<SearchX />}
          title={`We can’t find hand ${shortId}`}
          actions={
            <>
              <Link href='/verify' className={buttonVariants({ variant: 'primary' })}>
                See recent hands
              </Link>
              <Link href='/verify/demo' className={buttonVariants({ variant: 'ghost' })}>
                Try the demo hand
              </Link>
            </>
          }
        >
          It may still be in play (hands can be checked once they finish), or the link is wrong.
        </EmptyState>
      ) : error ? (
        <ErrorState onRetry={() => void refetch()} retrying={isFetching} />
      ) : data && result ? (
        <div className='flex flex-col gap-12'>
          <section aria-labelledby='verdict-h' className='grid grid-cols-1 items-start gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] md:gap-12'>
            {summary ? (
              <HandReceipt hand={summary} checks={result.checks} tilt={-1} showMoveLinks className='w-full md:mt-2' />
            ) : null}
            <div aria-live='polite' className='md:pt-6'>
              <h2
                id='verdict-h'
                className={cn(
                  'font-display text-[44px] font-black uppercase leading-[0.9] sm:text-[56px]',
                  failed ? 'text-card-red' : 'text-fg'
                )}
              >
                {failed
                  ? 'This hand does not match its commitment'
                  : allPass
                    ? 'Every check passed'
                    : 'Partly verified'}
              </h2>
              <p className='mt-4 text-body text-fg-muted'>
                {failed
                  ? 'At least one line on the slip failed. The cards shown are not the ones that were sealed before the deal.'
                  : allPass
                    ? 'The deal was fixed before anyone acted, and nobody could change it afterwards. Your browser just re-shuffled the deck and got the same cards.'
                    : 'Some of it isn’t revealed yet. A hand can be fully checked once it’s over.'}
              </p>
              <ul className='mt-6 flex flex-col gap-2 text-caption text-fg-subtle'>
                <li>✓ on the slip = this browser re-did that step and it matched.</li>
                <li>“TEE ✓” = the move came signed from a NEAR AI confidential model. Tap one to re-check it at NEAR AI.</li>
              </ul>
              <div className='mt-6 flex flex-wrap items-center gap-3'>
                <Button variant='secondary' size='md' disabled={isFetching} onClick={() => void refetch()}>
                  <RefreshCw className={cn(isFetching && 'animate-spin')} aria-hidden />
                  Run it again
                </Button>
                {commitTx ? <TxLink hash={commitTx.hash} label='The seal on NEAR' /> : null}
              </div>
            </div>
          </section>

          <HandMoveLog handId={handId} mock={mockMoves} />

          <section aria-labelledby='cards-h'>
            <h2 id='cards-h' className='text-h3 font-semibold'>
              Cards dealt
            </h2>
            <div className='mt-4 grid gap-2 sm:grid-cols-2'>
              {seats.map((s) => (
                <div key={s.seat} className='flex items-center justify-between gap-3 rounded-sm border border-border bg-surface px-4 py-3'>
                  <div className='min-w-0'>
                    <p className='truncate font-semibold'>{s.nickname}</p>
                    <p className='text-caption text-fg-subtle'>Seat {s.seat}</p>
                  </div>
                  <div className='flex gap-1.5'>
                    {toEngine(s.holeCards ?? []).filter((c) => c >= 0).length > 0 ? (
                      toEngine(s.holeCards).map((c, i) => <CardImg key={i} id={c} />)
                    ) : (
                      <span className='text-caption text-fg-subtle'>Not shown</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className='mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-border bg-surface px-4 py-3'>
              <span className='mr-2 font-semibold'>Board</span>
              {toEngine(data.community ?? []).length > 0 ? (
                toEngine(data.community).map((c, i) => <CardImg key={i} id={c} />)
              ) : (
                <span className='text-caption text-fg-subtle'>No board (hand ended before the flop)</span>
              )}
            </div>
          </section>

          <section aria-labelledby='seeds-h'>
            <h2 id='seeds-h' className='text-h3 font-semibold'>
              The raw data
            </h2>
            <p className='mt-1 text-caption text-fg-muted'>For developers: everything the checks above used.</p>
            <Card className='mt-4 py-1 sm:py-1'>
              <Mono
                label='Committed seedHash'
                value={data.seedHash}
                action={commitTx ? <TxLink hash={commitTx.hash} label='Commit tx' /> : null}
              />
              <Mono label='Revealed serverSeed' value={data.serverSeed} action={revealTx ? <TxLink hash={revealTx.hash} label='Reveal tx' /> : null} />
              {(data.entropy ?? []).map((e, i) => (
                <Mono key={i} label={`Entropy · ${seats[i] ? seats[i]!.nickname : `seat ${i}`}`} value={e} />
              ))}
              <Mono label='Recomputed deckSeed' value={result.deckSeedHex} />
            </Card>
          </section>

          {txs.length > 0 ? (
            <section aria-labelledby='chain-h'>
              <h2 id='chain-h' className='text-h3 font-semibold'>
                On NEAR
              </h2>
              <ul className='mt-4 flex flex-col gap-2'>
                {txs.map((t) => {
                  const meta = TX_LABEL[t.label];
                  return (
                    <li key={t.hash}>
                      <a
                        href={explorerTxUrl(t.hash)}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='flex items-center gap-3 rounded-sm border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-2'
                      >
                        <Link2 className='size-4 shrink-0 text-accent' aria-hidden />
                        <span className='min-w-0 flex-1'>
                          <span className='block font-semibold'>{meta?.label ?? t.label}</span>
                          <span className='block truncate font-mono text-[12px] text-fg-subtle'>{meta ? `${meta.hint} · ` : ''}{t.hash}</span>
                        </span>
                        <ArrowUpRight className='size-4 shrink-0 text-fg-subtle' aria-hidden />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : !isDemo ? (
            <p className='text-caption text-fg-subtle'>
              No NEAR transactions are attached to this hand record (the server may be running without an on-chain
              commitment). The browser checks above still hold for the data shown.
            </p>
          ) : null}

          {data.gameId && !isDemo ? (
            <div>
              <Link href={`/game/${data.gameId}`} className={buttonVariants({ variant: 'secondary' })}>
                Back to the table
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </Page>
  );
}
