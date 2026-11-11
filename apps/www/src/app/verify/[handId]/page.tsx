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
import { getPokerCardImage } from '~/lib/helpers';
import { explorerTxUrl } from '~/lib/near/rpc';
import { cn, errorHandler } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { Button } from '~/components/ui/button';

import { ExternalLink, RefreshCw } from 'lucide-react';

type CheckStatus = 'pass' | 'fail' | 'pending';

type Check = { label: string; status: CheckStatus; detail?: string };

/** INTERFACES §1 test vector, served locally at /verify/demo. */
function demoRecord(): HandRecord {
  const serverSeed = Array.from({ length: 32 }, (_, i) =>
    i.toString(16).padStart(2, '0')
  ).join('');
  const entropy = ['aa'.repeat(16), 'bb'.repeat(16)];
  const deck = shuffleFromSeed(computeDeckSeed(serverSeed, entropy));
  const dealt = dealFromDeck(deck, 2);
  return {
    handId: 'demo',
    gameId: 'demo',
    seedHash: sha256Hex(serverSeed),
    serverSeed,
    entropy,
    seats: [
      {
        seat: 0,
        playerId: 'alice',
        nickname: 'alice.testnet',
        holeCards: dealt.hole[0]!,
      },
      {
        seat: 1,
        playerId: 'bot',
        nickname: 'Shark (AI)',
        holeCards: dealt.hole[1]!,
      },
    ],
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
    label: 'Verifier self-test (INTERFACES §1 test vector)',
    status: selfOk ? 'pass' : 'fail',
    detail: selfOk
      ? 'seedHash, deckSeed and full deck order reproduced in this browser'
      : 'This browser’s implementation does not reproduce the spec vector',
  });
  const toEngine = (ids: number[]) =>
    isUiSpace(record) ? ids.map(uiIdToEngineId) : ids;
  const seats = [...record.seats].sort((a, b) => a.seat - b.seat);

  if (!record.serverSeed || !record.entropy) {
    checks.push({
      label: 'Server seed revealed',
      status: 'pending',
      detail: 'The seed is revealed after the hand completes.',
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
      label: 'sha256(serverSeed) == committed seedHash',
      status: seedHashOk ? 'pass' : 'fail',
      detail: seedHashOk ? undefined : `recomputed ${recomputed}`,
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
    label: 'One entropy contribution per seat',
    status: entropyOk ? 'pass' : 'fail',
    detail: `${record.entropy.length} entropies · ${seats.length} seats`,
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
      label: 'deckSeed = sha256(serverSeed ‖ entropies) matches record',
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
        label: `Seat ${s.seat} (${s.nickname}) hole cards`,
        status: 'pending',
        detail: `Mucked / hidden · deck says ${expected.map(engineCardLabel).join(' ')}`,
      });
      return;
    }
    const ok = sameCards(expected, actual);
    checks.push({
      label: `Seat ${s.seat} (${s.nickname}) hole cards`,
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
      label: 'Server-side verification',
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

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: '✅',
  fail: '❌',
  pending: '⏳',
};

function CardImg({ id }: { id: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getPokerCardImage(engineIdToUiId(id))}
      alt={engineCardLabel(id)}
      title={engineCardLabel(id)}
      className='h-14 w-10 rounded-[0.3rem] border border-neutral-200 object-cover shadow-sm sm:h-16 sm:w-[2.85rem]'
    />
  );
}

function Mono({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className='min-w-0'>
      <p className='text-[11px] font-medium uppercase tracking-wide text-neutral-400'>
        {label}
      </p>
      <p className='mt-0.5 break-all font-mono text-xs text-neutral-800 sm:text-[13px]'>
        {value ?? '—'}
      </p>
    </div>
  );
}

export default function VerifyHandPage({
  params,
}: {
  params: { handId: string };
}) {
  const handId = decodeURIComponent(params.handId);
  const isDemo = handId === 'demo';

  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['hand', handId],
    queryFn: () =>
      isDemo ? Promise.resolve(demoRecord()) : api.getHand(handId),
    retry: false,
  });

  const result = useMemo(() => (data ? verify(data) : null), [data]);
  const failed = result?.checks.some((c) => c.status === 'fail');
  const allPass =
    result && !failed && result.checks.every((c) => c.status === 'pass');
  const seats = data ? [...data.seats].sort((a, b) => a.seat - b.seat) : [];
  const toEngine = (ids: number[]) =>
    data && isUiSpace(data) ? ids.map(uiIdToEngineId) : ids;
  const txs = txList(data?.txs);

  return (
    <div className='mx-auto w-full max-w-4xl px-4 pb-20 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
      <p className='text-xs font-medium uppercase tracking-[0.18em] text-neutral-400 sm:text-sm'>
        Provably fair
      </p>
      <h1 className='mt-2 font-poker text-3xl tracking-wide text-neutral-950 sm:text-5xl'>
        Verify hand
      </h1>
      <p className='mt-2 max-w-2xl text-sm text-neutral-600 sm:text-base'>
        Your browser recomputes the deck from the revealed server seed and every
        player&apos;s entropy, then checks it against the cards that were dealt.
        Nothing here trusts the server.
      </p>
      <p className='mt-2 break-all font-mono text-xs text-neutral-500'>
        {handId}
      </p>

      {isLoading ? (
        <p className='mt-8 text-sm text-neutral-500'>Loading hand record…</p>
      ) : error ? (
        <div className='mt-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700'>
          <p className='font-medium'>Could not load this hand.</p>
          <p className='mt-1'>{errorHandler(error)}</p>
          <div className='mt-3 flex flex-wrap gap-2'>
            <Button
              size='sm'
              variant='outline'
              className='rounded-full bg-white'
              onClick={() => void refetch()}
            >
              Retry
            </Button>
            <Button
              asChild
              size='sm'
              variant='outline'
              className='rounded-full bg-white'
            >
              <Link href='/verify/demo'>Try the demo vector</Link>
            </Button>
          </div>
        </div>
      ) : data && result ? (
        <>
          <section
            className={cn(
              'mt-6 rounded-2xl border px-4 py-3 text-sm font-medium',
              failed
                ? 'border-red-200 bg-red-50 text-red-700'
                : allPass
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
            )}
          >
            {failed
              ? '❌ This hand does NOT match its commitment.'
              : allPass
                ? '✅ Every check passed — this deal was fixed before anyone acted.'
                : '⏳ Partially verified — some data is not revealed yet.'}
          </section>

          <section className='mt-6'>
            <div className='flex items-center justify-between gap-3'>
              <h2 className='text-lg font-semibold text-neutral-950'>Checks</h2>
              <Button
                variant='outline'
                size='sm'
                className='rounded-full'
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                <RefreshCw
                  className={cn(
                    'mr-1.5 h-3.5 w-3.5',
                    isFetching && 'animate-spin'
                  )}
                />
                Refresh
              </Button>
            </div>
            <ul className='mt-3 divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white'>
              {result.checks.map((c, i) => (
                <li key={i} className='flex items-start gap-3 px-4 py-3'>
                  <span className='text-base leading-5'>
                    {STATUS_ICON[c.status]}
                  </span>
                  <div className='min-w-0'>
                    <p className='text-sm font-medium text-neutral-900'>
                      {c.label}
                    </p>
                    {c.detail ? (
                      <p className='mt-0.5 break-words text-xs text-neutral-500'>
                        {c.detail}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className='mt-8'>
            <h2 className='text-lg font-semibold text-neutral-950'>
              Cards dealt
            </h2>
            <div className='mt-3 grid gap-3 sm:grid-cols-2'>
              {seats.map((s) => (
                <div
                  key={s.seat}
                  className='flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-semibold text-neutral-900'>
                      {s.nickname}
                    </p>
                    <p className='text-xs text-neutral-500'>Seat {s.seat}</p>
                  </div>
                  <div className='flex gap-1.5'>
                    {toEngine(s.holeCards ?? []).filter((c) => c >= 0).length >
                    0 ? (
                      toEngine(s.holeCards).map((c, i) => (
                        <CardImg key={i} id={c} />
                      ))
                    ) : (
                      <span className='text-xs text-neutral-400'>hidden</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className='mt-3 flex flex-wrap items-center gap-1.5 rounded-2xl border border-neutral-200 bg-white px-4 py-3'>
              <span className='mr-2 text-sm font-semibold text-neutral-900'>
                Board
              </span>
              {toEngine(data.community ?? []).length > 0 ? (
                toEngine(data.community).map((c, i) => (
                  <CardImg key={i} id={c} />
                ))
              ) : (
                <span className='text-xs text-neutral-400'>no board</span>
              )}
            </div>
          </section>

          <section className='mt-8 space-y-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4'>
            <h2 className='text-lg font-semibold text-neutral-950'>Seeds</h2>
            <Mono label='Committed seedHash' value={data.seedHash} />
            <Mono label='Revealed serverSeed' value={data.serverSeed} />
            {(data.entropy ?? []).map((e, i) => (
              <Mono
                key={i}
                label={`Entropy · seat ${seats[i]?.seat ?? i} ${seats[i] ? `(${seats[i]!.nickname})` : ''}`}
                value={e}
              />
            ))}
            <Mono label='Recomputed deckSeed' value={result.deckSeedHex} />
          </section>

          {txs.length > 0 ? (
            <section className='mt-8'>
              <h2 className='text-lg font-semibold text-neutral-950'>
                On-chain
              </h2>
              <ul className='mt-3 space-y-2'>
                {txs.map((t) => (
                  <li key={t.hash}>
                    <a
                      href={explorerTxUrl(t.hash)}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex max-w-full items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-900 hover:bg-neutral-50'
                    >
                      <span className='font-medium capitalize'>{t.label}</span>
                      <span className='truncate font-mono text-xs text-neutral-500'>
                        {t.hash}
                      </span>
                      <ExternalLink className='h-3.5 w-3.5 shrink-0 text-neutral-400' />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.gameId && !isDemo ? (
            <div className='mt-8'>
              <Button asChild variant='outline' className='rounded-full'>
                <Link href={`/game/${data.gameId}`}>Back to table</Link>
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
