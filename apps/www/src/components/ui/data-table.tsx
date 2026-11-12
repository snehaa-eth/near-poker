import * as React from 'react';

import { cn } from '~/lib/utils';

/**
 * DESIGN-SYSTEM §8.4. Desktop: a real <table> (56px rows, 36px label header,
 * numbers right-aligned + tabular). Below 640px render <DataList> instead
 * (stacked rows) — pages usually render both and hide one with `hidden sm:block`.
 */
export function DataTable({ className, children, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className='w-full overflow-x-auto'>
      <table className={cn('w-full border-collapse text-left text-body', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-border', className)} {...props} />;
}

export function TH({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope='col'
      className={cn(
        'h-9 whitespace-nowrap px-3 text-label uppercase text-fg-muted first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6',
        numeric && 'text-right',
        className
      )}
      {...props}
    />
  );
}

export function TR({
  className,
  selected,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; interactive?: boolean }) {
  return (
    <tr
      className={cn(
        'h-14 border-b border-border last:border-0',
        interactive && 'transition-colors duration-instant hover:bg-surface-2',
        selected && 'bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]',
        className
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-middle text-fg first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6',
        numeric && 'text-right tabular-nums',
        className
      )}
      {...props}
    />
  );
}

/** Mobile stacked list row: line 1 = lead + primary number; line 2 = meta. */
export function DataListRow({
  lead,
  title,
  value,
  meta,
  href,
  selected,
  className,
}: {
  lead?: React.ReactNode;
  title: React.ReactNode;
  value?: React.ReactNode;
  meta?: React.ReactNode;
  href?: string;
  selected?: boolean;
  className?: string;
}) {
  const inner = (
    <div className='flex min-h-14 items-center gap-3 px-4 py-3'>
      {lead ? <div className='shrink-0'>{lead}</div> : null}
      <div className='min-w-0 flex-1'>
        <div className='truncate font-semibold text-fg'>{title}</div>
        {meta ? <div className='truncate text-caption text-fg-subtle'>{meta}</div> : null}
      </div>
      {value != null ? <div className='shrink-0 text-right font-semibold tabular-nums text-fg'>{value}</div> : null}
    </div>
  );
  const cls = cn(
    'block border-b border-border last:border-0',
    selected && 'bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]',
    href && 'transition-colors hover:bg-surface-2',
    className
  );
  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
