import * as React from 'react';

import { cn } from '~/lib/utils';

/**
 * The thermal receipt: Dark Table's signature element. Off-white paper, mono ink, torn zigzag
 * edges, dashed rules, and a rubber stamp. Used for hand proofs (home, /verify, table drawer).
 *
 * Paper and stamp colours are atmosphere tokens (--paper, --ink, --stamp); they never carry UI
 * state on their own: every stamp also has text ("VERIFIED" / "REJECTED").
 */

export type StampKind = 'verified' | 'rejected' | 'pending';

export function Receipt({
  children,
  stamp,
  tilt = 0,
  compact = false,
  className,
  paperClassName,
  label,
  stampClassName,
}: {
  children: React.ReactNode;
  /** Ink stamp across the paper. `pending` prints a quiet "PENDING" in pencil grey. */
  stamp?: StampKind | null;
  /** Degrees. Keep small (±3). */
  tilt?: number;
  compact?: boolean;
  className?: string;
  paperClassName?: string;
  stampClassName?: string;
  /** Accessible name for the receipt region. */
  label?: string;
}) {
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      className={cn('receipt-wrap relative min-w-0 max-w-full', className)}
      style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
    >
      <div
        className={cn(
          'receipt-paper',
          compact ? 'px-3 pb-4 pt-4 text-[12px] leading-[18px]' : 'px-5 pb-7 pt-7 text-[13px] leading-[20px] sm:px-6',
          paperClassName
        )}
      >
        {children}
        {stamp ? <Stamp kind={stamp} compact={compact} className={stampClassName} /> : null}
      </div>
    </div>
  );
}

export function Stamp({ kind, compact, className }: { kind: StampKind; compact?: boolean; className?: string }) {
  const text = kind === 'verified' ? 'Verified' : kind === 'rejected' ? 'Rejected' : 'Pending';
  return (
    <span
      className={cn(
        'ink-stamp pointer-events-none absolute select-none whitespace-nowrap rounded-[6px] border-[3px] font-sans font-extrabold uppercase',
        compact ? 'px-1.5 py-0 text-[13px] tracking-[0.14em]' : 'px-3 py-1 text-[26px] tracking-[0.16em] sm:text-[30px]',
        kind === 'verified' && 'border-stamp text-stamp',
        kind === 'rejected' && 'border-stamp-red text-stamp-red',
        kind === 'pending' && 'border-ink-muted text-ink-muted',
        className ??
          (compact ? 'right-2 top-1/2 -translate-y-1/2 -rotate-[8deg]' : 'bottom-[9%] right-[10%] -rotate-[9deg]')
      )}
      style={{ boxShadow: 'inset 0 0 0 2px var(--paper), inset 0 0 0 3.5px currentColor' }}
    >
      {text}
    </span>
  );
}

export function ReceiptHeader({ title, sub, className }: { title: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('text-center', className)}>
      <p className='text-[15px] font-bold uppercase tracking-[0.28em]'>{title}</p>
      {sub ? <p className='mt-0.5 text-[11px] uppercase tracking-[0.18em] text-ink-muted'>{sub}</p> : null}
    </div>
  );
}

export function ReceiptRule({ className }: { className?: string }) {
  return <hr className={cn('receipt-rule my-3', className)} />;
}

export function ReceiptRow({
  left,
  right,
  strong,
  muted,
  className,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', strong && 'font-bold', muted && 'text-ink-muted', className)}>
      <span className='min-w-0 truncate uppercase'>{left}</span>
      {right != null ? <span className='shrink-0 text-right tabular-nums'>{right}</span> : null}
    </div>
  );
}

/** A pseudo barcode drawn from a hex string (decorative). */
export function ReceiptBarcode({ value, className }: { value: string; className?: string }) {
  const hex = (value || '0').replace(/[^0-9a-f]/gi, '').slice(0, 40).padEnd(24, '7');
  let x = 0;
  const bars: Array<{ x: number; w: number }> = [];
  for (const ch of hex) {
    const n = parseInt(ch, 16);
    const w = 1 + (n % 3);
    bars.push({ x, w });
    x += w + 1 + ((n >> 2) % 2);
  }
  return (
    <svg viewBox={`0 0 ${x} 30`} preserveAspectRatio='none' className={cn('h-8 w-full', className)} aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={30} fill='currentColor' />
      ))}
    </svg>
  );
}
