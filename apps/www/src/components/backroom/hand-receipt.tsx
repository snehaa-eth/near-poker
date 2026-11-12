import * as React from 'react';

import { receiptUrl } from '~/lib/arena';
import { type HandSummary, modelTag, receiptTime } from '~/lib/last-hand';
import { cardLabel } from '~/lib/poker-eval';
import { cn } from '~/lib/utils';
import type { Check } from '~/lib/verify-hand';

import { Receipt, ReceiptBarcode, ReceiptHeader, ReceiptRow, ReceiptRule } from '~/components/ui/receipt';

const VERB: Record<string, string> = { 'all-in': 'ALL IN', raise: 'RAISE', bet: 'BET', call: 'CALL', check: 'CHECK', fold: 'FOLD' };

export function shortHash(h: string, head = 4, tail = 4) {
  const x = h.replace(/^0x/, '');
  return x.length > head + tail + 1 ? `0x${x.slice(0, head)}…${x.slice(-tail)}` : `0x${x}`;
}

/**
 * The printed proof for one hand. Every line is real data: the sealed deck hash, the browser
 * checks, each accepted (TEE-signed) move, the board and the payout.
 */
export function HandReceipt({
  hand,
  checks,
  tilt,
  className,
  showMoveLinks = false,
  footer,
}: {
  hand: HandSummary;
  /** When given (verify page), print each browser check as a line. */
  checks?: Check[];
  tilt?: number;
  className?: string;
  /** Each move links to its NEAR AI Verification Center receipt. */
  showMoveLinks?: boolean;
  footer?: React.ReactNode;
}) {
  const when = receiptTime(hand.createdAt);
  const sealedOk = hand.verdict !== 'rejected';
  return (
    <Receipt
      stamp={hand.verdict}
      tilt={tilt}
      className={className}
      label={`Receipt for hand ${hand.handId.slice(0, 8)}: ${hand.verdict}`}
    >
      <ReceiptHeader title='Dark Table' sub={hand.source === 'demo' ? 'the back room · demo hand' : 'the back room · NEAR testnet'} />
      <ReceiptRule />
      <ReceiptRow left={<>Hand #{hand.handId.slice(0, 8)}</>} right={when || null} strong />
      <ReceiptRow left={hand.tableName} muted />
      <ReceiptRule />
      <ReceiptRow left='Deck sealed' right={<>{shortHash(hand.seedHash)} {sealedOk ? '✓' : '✗'}</>} />
      {checks ? (
        checks.map((c, i) => (
          <ReceiptRow
            key={i}
            left={<span title={c.detail}>{c.label}</span>}
            right={c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗ FAIL' : '…'}
            muted={c.status === 'pending'}
            className={cn(c.status === 'fail' && 'font-bold text-stamp-red')}
          />
        ))
      ) : (
        <ReceiptRow left='Re-dealt in your browser' right={hand.verdict === 'verified' ? '✓' : hand.verdict === 'pending' ? '…' : '✗'} />
      )}
      {hand.steps.length > 0 ? (
        <>
          <ReceiptRule />
          <ol className='flex flex-col'>
            {hand.steps.map((s, i) => {
              const move = hand.moves[i];
              const text = (
                <>
                  <span className='font-bold'>{s.name}</span> {VERB[s.action] ?? s.action.toUpperCase()}
                  {s.amount ? ` ${s.amount}` : ''}
                </>
              );
              const tag = `${modelTag(s.model)} TEE ✓`;
              return (
                <li key={i} className='flex items-baseline justify-between gap-3'>
                  <span className='min-w-0 truncate uppercase'>{text}</span>
                  {showMoveLinks && move ? (
                    <a
                      href={receiptUrl(move)}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='shrink-0 text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink'
                    >
                      {tag}
                      <span className='sr-only'> (open signed receipt at NEAR AI)</span>
                    </a>
                  ) : (
                    <span className='shrink-0 text-ink-muted'>{tag}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      {hand.board.length > 0 ? (
        <>
          <ReceiptRule />
          <ReceiptRow left='Board' right={hand.board.map(cardLabel).join(' ')} />
        </>
      ) : null}
      {hand.winner ? (
        <>
          <ReceiptRule />
          <ReceiptRow
            left={<>Winner {hand.winner.name}</>}
            right={hand.winner.net > 0 ? `+${hand.winner.net}` : null}
            strong
            className='text-[15px]'
          />
          {hand.winner.handName ? <ReceiptRow left={hand.winner.handName} muted /> : null}
          {hand.pot ? <ReceiptRow left='Pot' right={hand.pot} /> : null}
        </>
      ) : null}
      <ReceiptRule />
      <ReceiptBarcode value={hand.seedHash} className='mt-1 text-ink' />
      <p className='mt-2 text-center text-[11px] uppercase tracking-[0.16em] text-ink-muted'>
        testnet chips · no real money
      </p>
      {footer}
    </Receipt>
  );
}
