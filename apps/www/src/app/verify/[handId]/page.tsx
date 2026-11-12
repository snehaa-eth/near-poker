'use client';

import Link from 'next/link';

import React, { useMemo } from 'react';

import { type HandRecord, api } from '~/lib/api';
import {
  bytesToHex,
  computeDeckSeed,
  dealFromDeck,
  engineCardLabel,
  engineIdToUiId,
  selfTest,
  sha256Hex,
  shuffleFromSeed,
  uiIdToEngineId,
} from '~/lib/fairness';
import { MOCK_AGENTS } from '~/lib/arena';
import { getPokerCardImage } from '~/lib/helpers';
import { explorerTxUrl } from '~/lib/near/rpc';
import { cn, errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { HandMoveLog } from '~/components/arena/move-log';
import { Button, buttonVariants } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { EmptyState, ErrorState, Page, PageHeader } from '~/components/ui/states';
import { Term } from '~/components/ui/term';

import { ArrowUpRight, CheckCircle2, Clock, Link2, RefreshCw, SearchX, ShieldCheck, XCircle } from 'lucide-react';

type CheckStatus = 'pass' | 'fail' | 'pending';

type Check = { label: string; status: CheckStatus; detail?: string };

/**
 * Demo hand served locally at /verify/demo: six seats (the same demo agents as
 * the arena preview), one entropy per seat, all derived in the browser.
 */
function demoRecord(): HandRecord {
  const serverSeed = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
  const entropy = MOCK_AGENTS.map((_, i) => ((i * 37 + 0xaa) % 256).toString(16).padStart(2, '0').repeat(16));
  const deck = shuffleFromSeed(computeDeckSeed(serverSeed, entropy));
  const dealt = dealFromDeck(deck, MOCK_AGENTS.length);
  return {
    handId: 'demo',
    gameId: 'demo',
    seedHash: sha256Hex(serverSeed),
    serverSeed,
    entropy,
    seats: MOCK_AGENTS.map((a, i) => ({
      seat: i,
      playerId: a.walletAddress,
      nickname: a.nickname,
      holeCards: dealt.hole[i]!,
    })),
    community: dealt.community,
    txs: {},
    cardIds: 'engine',
  };
}

function sameCards(expected: number[], actual: number[]) {
  return (
    expected.length === actual.length &&
    expected.every((c, i) => c === actual[i])
  );
}

function isUiSpace(record: HandRecord) {
  return (record.cardIds ?? record.cardIdSpace) === 'ui';
}

function verify(record: HandRecord) {
  const checks: Check[] = [];
  const selfOk = selfTest();
  checks.push({
    label: 'Verifier self-check',
    status: selfOk ? 'pass' : 'fail',
    detail: selfOk
      ? 'This browser reproduces the published test vector (seed hash, deck seed, deck order)'
      : 'This browser’s implementation does not reproduce the spec vector',
  });
  const toEngine = (ids: number[]) =>
    isUiSpace(record) ? ids.map(uiIdToEngineId) : ids;
  const seats = [...record.seats].sort((a, b) => a.seat - b.seat);

  if (!record.serverSeed || !record.entropy) {
    checks.push({
      label: 'Shuffle secret revealed',
      status: 'pending',
      detail: 'The server reveals its secret seed after the hand ends. Check back in a moment.',
    });
    return {
      checks,
      deckSeedHex: null as string | null,
      deck: null as number[] | null,
    };
  }

  let seedHashOk = false;
  try {
    const recomputed = sha256Hex(record.serverSeed);
    seedHashOk = recomputed === record.seedHash.toLowerCase();
    checks.push({
      label: 'Shuffle matches what was locked before the deal',
      status: seedHashOk ? 'pass' : 'fail',
      detail: seedHashOk ? 'sha256(serverSeed) equals the committed seedHash' : `recomputed ${recomputed}`,
    });
  } catch (error) {
    checks.push({
      label: 'serverSeed is valid hex',
      status: 'fail',
      detail: errorHandler(error),
    });
    return { checks, deckSeedHex: null, deck: null };
  }

  const entropyOk = record.entropy.length === seats.length;
  checks.push({
    label: 'Every agent added randomness',
    status: entropyOk ? 'pass' : 'fail',
    detail: `${record.entropy.length} entropy contributions · ${seats.length} seats`,
  });

  let deckSeed: Uint8Array;
  try {
    deckSeed = computeDeckSeed(record.serverSeed, record.entropy);
  } catch (error) {
    checks.push({
      label: 'Entropy is valid hex',
      status: 'fail',
      detail: errorHandler(error),
    });
    return { checks, deckSeedHex: null, deck: null };
  }
  const deckSeedHex = bytesToHex(deckSeed);
  if (record.deckSeed) {
    const ok = record.deckSeed.toLowerCase() === deckSeedHex;
    checks.push({
      label: 'Deck seed matches the record (sha256 of seed + entropies)',
      status: ok ? 'pass' : 'fail',
    });
  }

  const deck = shuffleFromSeed(deckSeed);
  const dealt = dealFromDeck(deck, seats.length);

  seats.forEach((s, i) => {
    const actual = toEngine(s.holeCards ?? []);
    const expected = dealt.hole[i] ?? [];
    if (actual.length === 0 || actual.some((c) => c < 0)) {
      checks.push({
        label: `${s.nickname}’s cards (seat ${s.seat})`,
        status: 'pending',
        detail: `Mucked / hidden · deck says ${expected.map(engineCardLabel).join(' ')}`,
      });
      return;
    }
    const ok = sameCards(expected, actual);
    checks.push({
      label: `${s.nickname}’s cards (seat ${s.seat})`,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? actual.map(engineCardLabel).join(' ')
        : `dealt ${actual.map(engineCardLabel).join(' ')} · deck says ${expected
            .map(engineCardLabel)
            .join(' ')}`,
    });
  });

  const community = toEngine(record.community ?? []);
  const expectedBoard = dealt.community.slice(0, community.length);
  const boardOk = sameCards(expectedBoard, community);
  checks.push({
    label: `Community cards (${community.length}/5 dealt)`,
    status: community.length === 0 ? 'pending' : boardOk ? 'pass' : 'fail',
    detail:
      community.length === 0
        ? 'No board dealt (hand ended preflop)'
        : boardOk
          ? community.map(engineCardLabel).join(' ')
          : `dealt ${community.map(engineCardLabel).join(' ')} · deck says ${expectedBoard
              .map(engineCardLabel)
              .join(' ')}`,
  });

  if (record.errors && record.errors.length > 0) {
    checks.push({
      label: 'Server’s own check reported a problem',
      status: 'fail',
      detail: record.errors.join(' · '),
    });
  }

  return { checks, deckSeedHex, deck };
}

function txList(
  txs: HandRecord['txs']
): Array<{ label: string; hash: string }> {
  if (!txs) return [];
  if (Array.isArray(txs)) {
    return txs
      .filter(Boolean)
      .map((hash, i) => ({ label: `tx ${i + 1}`, hash }));
  }
  return Object.entries(txs)
    .filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0
    )
    .map(([label, hash]) => ({ label, hash }));
}

const TX_LABEL: Record<string, { label: string; hint: string }> = {
  commit: { label: 'Deck commitment', hint: 'The shuffle fingerprint, written on NEAR before the deal' },
  reveal: { label: 'Seed reveal', hint: 'The secret seed, published after the hand' },
  settle: { label: 'Settlement', hint: 'Chip results written to the table vault' },
};

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'pass') return <CheckCircle2 className='size-5 shrink-0 text-accent' aria-label='Passed' />;
  if (status === 'fail') return <XCircle className='size-5 shrink-0 text-negative' aria-label='Failed' />;
  return <Clock className='size-5 shrink-0 text-warning' aria-label='Pending' />;
}

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
    <Page narrow className='[&>div]:max-w-[832px]'>
      <PageHeader
        eyebrow={isDemo ? 'Provably fair · demo hand' : 'Provably fair'}
        title='Verify hand'
        lead={
          <>
            Your browser re-deals this hand from the revealed seed and each agent’s{' '}
            <Term t='entropy'>randomness</Term>, then checks it against the cards that were dealt and the fingerprint{' '}
            <Term t='commit'>locked before the deal</Term>. The server only supplies the revealed data; the math runs
            here.
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
          <section
            aria-live='polite'
            className={cn(
              'flex items-start gap-3 rounded-md border p-4 sm:p-6',
              failed ? 'border-negative/50 bg-negative/10' : allPass ? 'border-accent/40 bg-accent-soft' : 'border-warning/40 bg-warning/10'
            )}
          >
            {failed ? (
              <XCircle className='size-6 shrink-0 text-negative' aria-hidden />
            ) : allPass ? (
              <ShieldCheck className='size-6 shrink-0 text-accent' aria-hidden />
            ) : (
              <Clock className='size-6 shrink-0 text-warning' aria-hidden />
            )}
            <div>
              <p className='text-h3 font-semibold'>
                {failed
                  ? 'This hand does not match its commitment'
                  : allPass
                    ? 'Every check passed'
                    : 'Partly verified'}
              </p>
              <p className='mt-1 text-body text-fg-muted'>
                {failed
                  ? 'At least one check below failed. The deal shown is not the one that was locked in.'
                  : allPass
                    ? 'This deal was fixed before anyone acted, and nobody could change it afterwards.'
                    : 'Some data isn’t revealed yet. Hands can be fully checked once they finish.'}
              </p>
              {commitTx ? (
                <div className='mt-3'>
                  <TxLink hash={commitTx.hash} label='View the commitment on NEAR' />
                </div>
              ) : null}
            </div>
          </section>

          <section aria-labelledby='checks-h'>
            <div className='flex items-center justify-between gap-3'>
              <h2 id='checks-h' className='text-h3 font-semibold'>
                Checks
              </h2>
              <Button variant='ghost' size='sm' disabled={isFetching} onClick={() => void refetch()}>
                <RefreshCw className={cn(isFetching && 'animate-spin')} aria-hidden />
                Re-run
              </Button>
            </div>
            <Card as='div' className='mt-4 p-0 sm:p-0'>
              <ul className='divide-y divide-border'>
                {result.checks.map((c, i) => (
                  <li key={i} className='flex items-start gap-3 px-4 py-3 sm:px-6'>
                    <StatusIcon status={c.status} />
                    <div className='min-w-0'>
                      <p className='font-medium'>{c.label}</p>
                      {c.detail ? <p className='mt-0.5 break-words text-caption text-fg-subtle'>{c.detail}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
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
