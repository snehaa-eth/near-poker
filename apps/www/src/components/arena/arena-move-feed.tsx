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
import { mockReceipts } from '~/lib/mock-hand';
import { cardLabel, isRedCard } from '~/lib/poker-eval';
import { chipText } from '~/lib/seat-action-flash';
import { actionPhrase } from '~/lib/table-director';
import { cn } from '~/lib/utils';

import { useQuery } from '@tanstack/react-query';

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

  return (
    <div className='flex flex-col gap-4'>
      <section className='rounded-md border border-border bg-surface p-4'>
        <h3 className='text-label uppercase text-fg-muted'>Deck</h3>
        {fairness ? (
          <>
            <p className='mt-1 flex items-center gap-1.5 text-[15px] text-fg'>
              <ShieldCheck className='h-4 w-4 text-accent' strokeWidth={1.75} />
              {fairness.revealed ? 'Seed revealed' : 'Committed before the deal'}
            </p>
            <p className='mt-1 break-all font-mono text-[12px] leading-5 text-fg-muted' title={fairness.seedHash}>
              {fairness.seedHash}
            </p>
            <p className='mt-1 text-[13px] text-fg-subtle'>
              Hand <span className='font-mono'>#{fairness.handId}</span>
            </p>
            {ended ? (
              <Link
                href={verifyHref ?? `/verify/${encodeURIComponent(fairness.handId)}`}
                className='mt-3 inline-flex h-10 items-center gap-1.5 rounded-sm bg-accent px-3 text-[13px] font-semibold text-accent-ink hover:bg-accent-hover'
              >
                Verify hand
                <ArrowUpRight className='h-4 w-4' />
              </Link>
            ) : (
              <p className='mt-2 text-[13px] text-fg-subtle'>
                The seed is revealed when the hand ends; then anyone can re-shuffle and check every card.
              </p>
            )}
          </>
        ) : (
          <p className='mt-1 text-[13px] text-fg-subtle'>No deck committed yet — the next hand commits one before the deal.</p>
        )}
      </section>

      <section>
        <h3 className='flex items-baseline justify-between text-label uppercase text-fg-muted'>
          Agent moves
          <span className='normal-case tracking-normal text-[13px] font-medium'>
            <span className='tabular-nums text-fg'>
              {signed}/{agentRows.length}
            </span>{' '}
            signed in a TEE
          </span>
        </h3>
        <p className='mt-1 text-[13px] text-fg-subtle'>
          Only replies from a NEAR AI Cloud confidential (TEE) model are accepted.
        </p>
        {agentRows.length === 0 ? (
          <p className='mt-3 text-[13px] text-fg-subtle'>No agent moves yet this hand.</p>
        ) : (
          <ol className='mt-2 divide-y divide-border'>
            {agentRows.map((r) => {
              const focused = focusIndex === r.index;
              return (
                <li
                  key={r.index}
                  ref={focused ? focusRef : undefined}
                  tabIndex={focused ? -1 : undefined}
                  className={cn(
                    'flex items-center gap-2 py-2 outline-none',
                    focused && '-mx-2 rounded-sm bg-accent-soft px-2 shadow-[inset_2px_0_0_var(--accent)]'
                  )}
                >
                  <span className='w-6 shrink-0 text-right text-[13px] tabular-nums text-fg-subtle'>
                    {r.index + 1}
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-[15px]'>
                      <span className='font-semibold text-fg'>{r.nickname}</span>{' '}
                      <span className='text-fg-muted'>{r.phrase}</span>
                    </p>
                    <p className='flex items-center gap-1 truncate text-[13px] text-fg-subtle'>
                      {r.receipt ? (
                        <Check className='h-3.5 w-3.5 shrink-0 text-accent' strokeWidth={2.5} aria-label='TEE attested' />
                      ) : null}
                      <span className='truncate font-mono text-[12px]'>{shortModel(r.model ?? '', 30)}</span>
                    </p>
                  </div>
                  {r.receipt ? (
                    <a
                      href={receiptUrl(r.receipt)}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex h-9 shrink-0 items-center gap-1 rounded-xs px-2 text-[13px] font-semibold text-accent hover:bg-surface-3'
                      aria-label={`Receipt for move ${r.index + 1} (opens NEAR AI verification)`}
                    >
                      Receipt
                      <ArrowUpRight className='h-3.5 w-3.5' />
                    </a>
                  ) : (
                    <span className='shrink-0 text-[13px] text-fg-subtle'>syncing…</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
