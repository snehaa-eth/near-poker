'use client';

/**
 * Drawer panels for the spectator table: the hand Log (every public action, street by street)
 * and the Proofs list (each agent move with its TEE receipt + the deck commitment).
 *
 * ONE SOURCE OF TRUTH: rows come from the (staged) public view's action log, the same data the
 * seat tags and the ticker use, so counts always match. TEE receipts are joined onto those rows
 * per player, in order (each accepted agent decision = one receipt).
 */
import Link from 'next/link';

import React, { useEffect, useMemo, useRef } from 'react';

import type { ArenaMoveRecord, PublicGameView } from '~/lib/api';
import { api } from '~/lib/api';
import { receiptUrl, shortModel } from '~/lib/arena';
import { modelTag } from '~/lib/last-hand';
import { mockReceipts } from '~/lib/mock-hand';
import { cardLabel, isRedCard } from '~/lib/poker-eval';
import { chipText } from '~/lib/seat-action-flash';
import { actionPhrase } from '~/lib/table-director';
import { cn } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

import { shortHash } from '~/components/backroom/hand-receipt';
import { Receipt, ReceiptRow, ReceiptRule } from '~/components/ui/receipt';

import { ArrowUpRight, Check, ShieldCheck } from 'lucide-react';

export type MoveRow = {
  index: number;
  playerId: string;
  nickname: string;
  street: string;
  type: string;
  amount?: number;
  phrase: string;
  /** Model of the seat (arena agents). */
  model?: string;
  receipt?: ArenaMoveRecord;
};

const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
const STREET_LABEL: Record<string, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};
const BOARD_RANGE: Record<string, [number, number]> = {
  flop: [0, 3],
  turn: [3, 4],
  river: [4, 5],
};

/** The hand's public actions joined with their TEE receipts. */
export function useHandMoves(
  view: PublicGameView,
  opts: { mock: boolean; enabled: boolean }
) {
  const handId = view.fairness?.handId ?? null;
  const { data } = useQuery({
    queryKey: ['arena-moves', handId],
    queryFn: () => (handId ? api.arenaMoves(handId) : Promise.resolve([])),
    enabled: Boolean(handId) && !opts.mock && opts.enabled && Boolean(view.arena),
    refetchInterval: 2_000,
    retry: false,
  });
  const receipts = useMemo(
    () => (opts.mock ? mockReceipts(view) : data ?? []),
    [opts.mock, view, data]
  );

  return useMemo<MoveRow[]>(() => {
    const queues = new Map<string, ArenaMoveRecord[]>();
    for (const r of receipts) {
      if (handId && r.handId && r.handId !== handId) continue;
      const q = queues.get(r.playerId) ?? [];
      q.push(r);
      queues.set(r.playerId, q);
    }
    return (view.actions ?? []).map((a, index) => {
      const p = view.players.find((x) => x.id === a.playerId);
      const receipt = queues.get(a.playerId)?.shift();
      return {
        index,
        playerId: a.playerId,
        nickname: p?.nickname ?? receipt?.nickname ?? 'Player',
        street: a.street,
        type: a.type,
        amount: a.amount,
        phrase: actionPhrase(a),
        model: p?.agent?.model ?? receipt?.model,
        receipt,
      };
    });
  }, [view.actions, view.players, receipts, handId]);
}

function CardChip({ id }: { id: number }) {
  return (
    <span
      className={cn(
        'inline-block rounded-[4px] bg-[#f2f5f3] px-1 text-[13px] font-bold leading-5',
        isRedCard(id) ? 'text-[#c62f3a]' : 'text-[#0b0f0d]'
      )}
    >
      {cardLabel(id)}
    </span>
  );
}

/** ✓ that opens the proof for a move. */
function ProofCheck({
  row,
  onOpen,
}: {
  row: MoveRow;
  onOpen?: (index: number) => void;
}) {
  if (!row.model) return null;
  return (
    <button
      type='button'
      onClick={() => onOpen?.(row.index)}
      title={`TEE attested · ${shortModel(row.model, 28)}`}
      aria-label={`TEE attested · ${shortModel(row.model, 28)}. Open proof`}
      className='inline-flex h-8 w-8 items-center justify-center rounded-xs text-accent hover:bg-surface-3'
    >
      <Check className='h-4 w-4' strokeWidth={2.5} />
    </button>
  );
}

/** Log tab: the hand street by street, ending with who won. */
export function MoveLog({
  view,
  rows,
  onProof,
}: {
  view: PublicGameView;
  rows: MoveRow[];
  onProof?: (index: number) => void;
}) {
  const board = view.communityCards.filter((c) => c >= 0);
  const streets = STREETS.filter(
    (s) =>
      s === 'preflop' ||
      rows.some((r) => r.street === s) ||
      board.length >= (BOARD_RANGE[s]?.[1] ?? 99)
  );
  const nick = (id: string) =>
    view.players.find((p) => p.id === id)?.nickname ?? 'Player';
  const winners = view.gameEnded ? view.winners ?? [] : [];

  return (
    <div className='flex flex-col gap-4'>
      <p className='text-[13px] text-fg-muted'>
        <span className='font-semibold tabular-nums text-fg'>{rows.length}</span>{' '}
        {rows.length === 1 ? 'move' : 'moves'} this hand
        {view.fairness?.handId ? (
          <>
            {' · '}
            <span className='font-mono text-[12px]'>#{view.fairness.handId.slice(0, 10)}</span>
          </>
        ) : null}
      </p>
      {streets.map((s) => {
        const range = BOARD_RANGE[s];
        const cards = range ? board.slice(range[0], range[1]) : [];
        const list = rows.filter((r) => r.street === s);
        return (
          <section key={s} aria-label={STREET_LABEL[s]}>
            <h3 className='mb-1 flex items-center gap-2 text-label uppercase text-fg-muted'>
              {STREET_LABEL[s]}
              {cards.length ? (
                <span className='flex gap-1 normal-case tracking-normal'>
                  {cards.map((c) => (
                    <CardChip key={c} id={c} />
                  ))}
                </span>
              ) : null}
              {s === 'preflop' && view.smallBlind && view.bigBlind ? (
                <span className='normal-case tracking-normal text-fg-subtle'>
                  · blinds {view.smallBlind}/{view.bigBlind}
                </span>
              ) : null}
            </h3>
            {list.length === 0 ? (
              <p className='py-1 text-[13px] text-fg-subtle'>
                {s === 'preflop' && view.nextPlayerNickname
                  ? `Waiting on ${view.nextPlayerNickname}…`
                  : 'No action'}
              </p>
            ) : (
              <ol className='divide-y divide-border'>
                {list.map((r) => (
                  <li key={r.index} className='flex min-h-10 items-center gap-2 text-[15px]'>
                    <span className='w-6 shrink-0 text-right text-[13px] tabular-nums text-fg-subtle'>
                      {r.index + 1}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>
                      <span className='font-semibold text-fg'>{r.nickname}</span>{' '}
                      <span className={r.type === 'all-in' ? 'text-accent' : r.type === 'fold' ? 'text-fg-subtle' : 'text-fg-muted'}>
                        {r.phrase}
                      </span>
                    </span>
                    <ProofCheck row={r} onOpen={onProof} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
      {winners.length ? (
        <section aria-label='Result'>
          <h3 className='mb-1 text-label uppercase text-fg-muted'>Result</h3>
          {winners.map((w) => {
            const hand = view.showdownHands?.find((h) => h.playerId === w.playerId)?.handName;
            return (
              <p key={`${w.playerId}-${w.potIndex}`} className='text-[15px]'>
                <span className='font-semibold text-fg'>{nick(w.playerId)}</span>{' '}
                <span className='text-fg-muted'>wins</span>{' '}
                <span className='font-semibold tabular-nums text-positive'>{chipText(w.amount)}</span>
                {hand ? <span className='text-fg-muted'> with {hand}</span> : null}
              </p>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

/** Proofs tab: deck commitment + every move's TEE receipt. Only a failed proof would be red. */
export function ProofList({
  view,
  rows,
  focusIndex,
  verifyHref,
}: {
  view: PublicGameView;
  rows: MoveRow[];
  focusIndex?: number | null;
  verifyHref?: string;
}) {
  const fairness = view.fairness;
  const ended = Boolean(view.gameEnded || fairness?.revealed || view.round === 'End');
  const focusRef = useRef<HTMLLIElement | null>(null);
  const agentRows = rows.filter((r) => r.model);
  const signed = agentRows.filter((r) => r.receipt).length;

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    focusRef.current?.focus({ preventScroll: true });
  }, [focusIndex]);

  const allSigned = agentRows.length > 0 && signed === agentRows.length;
  return (
    <div className='flex flex-col gap-5'>
      <Receipt compact stamp={fairness && allSigned && ended ? 'verified' : null} stampClassName='right-3 top-3 rotate-[9deg]' label='Deck seal'>
        <p className='text-[13px] font-bold uppercase tracking-[0.2em]'>Dark Table</p>
        {fairness ? (
          <>
            <ReceiptRow left={<>Hand #{fairness.handId.slice(0, 8)}</>} muted />
            <ReceiptRule className='my-2' />
            <ReceiptRow left={fairness.revealed ? 'Seed revealed' : 'Deck sealed'} right={<>{shortHash(fairness.seedHash)} ✓</>} />
            <p className='mt-1 break-all text-[11px] leading-4 text-ink-muted' title={fairness.seedHash}>
              {fairness.seedHash}
            </p>
            <ReceiptRule className='my-2' />
            <ReceiptRow left='Moves signed in a TEE' right={`${signed}/${agentRows.length}`} strong />
            {ended ? (
              <Link
                href={verifyHref ?? `/verify/${encodeURIComponent(fairness.handId)}`}
                className='mt-3 inline-flex h-10 items-center gap-1.5 rounded-sm bg-ink px-3 font-sans text-[13px] font-semibold text-paper hover:bg-[#3a332a]'
              >
                Verify hand
                <ArrowUpRight className='h-4 w-4' />
              </Link>
            ) : (
              <p className='mt-2 font-sans text-[12px] leading-[17px] text-ink-muted'>
                The secret is revealed when the hand ends. Then anyone can re-shuffle and check every card.
              </p>
            )}
          </>
        ) : (
          <p className='mt-1 font-sans text-[13px] text-ink-muted'>No deck sealed yet. The next hand seals one before the deal.</p>
        )}
      </Receipt>

      <section aria-labelledby='proof-moves-h'>
        <h3 id='proof-moves-h' className='text-label uppercase text-fg-muted'>
          One slip per move
        </h3>
        <p className='mt-1 text-[13px] text-fg-subtle'>
          A move only counts if a NEAR AI Cloud confidential (TEE) model signed it.
        </p>
        {agentRows.length === 0 ? (
          <p className='mt-3 text-[13px] text-fg-subtle'>No agent moves yet this hand.</p>
        ) : (
          <ol className='mt-3 flex flex-col gap-2.5'>
            {agentRows.map((r) => {
              const focused = focusIndex === r.index;
              return (
                <li
                  key={r.index}
                  ref={focused ? focusRef : undefined}
                  tabIndex={focused ? -1 : undefined}
                  className={cn('outline-none', focused && 'rounded-sm ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface-2)]')}
                >
                  <Receipt compact paperClassName='py-3' tilt={r.index % 2 ? 0.4 : -0.4}>
                    <ReceiptRow
                      left={
                        <>
                          <span className='text-ink-muted'>{String(r.index + 1).padStart(2, '0')}</span>{' '}
                          <span className='font-bold'>{r.nickname}</span> {r.phrase}
                        </>
                      }
                    />
                    <div className='mt-0.5 flex items-baseline justify-between gap-2 text-[11px]'>
                      <span className='truncate text-ink-muted'>{modelTag(r.model ?? '')} TEE {r.receipt ? '✓' : ''}</span>
                      {r.receipt ? (
                        <a
                          href={receiptUrl(r.receipt)}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='inline-flex h-7 shrink-0 items-center gap-0.5 font-semibold text-stamp underline decoration-dotted underline-offset-2'
                          aria-label={`Receipt for move ${r.index + 1} (opens NEAR AI verification)`}
                        >
                          Signed receipt
                          <ArrowUpRight className='h-3.5 w-3.5' />
                        </a>
                      ) : (
                        <span className='shrink-0 text-ink-muted'>printing…</span>
                      )}
                    </div>
                  </Receipt>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
