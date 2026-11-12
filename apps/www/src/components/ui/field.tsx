import * as React from 'react';

import { cn } from '~/lib/utils';

import { AlertCircle } from 'lucide-react';

/**
 * Form field wrapper (§8.10): label 13/600, helper 13 subtle, error 13 negative
 * with AlertCircle. Pass the input as children; wire `id` yourself and use
 * `describedBy(id)` for aria-describedby.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className='text-caption font-semibold text-fg'>
        {label}
        {optional ? <span className='ml-1 font-normal text-fg-subtle'>(optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role='alert' className='flex items-center gap-1.5 text-caption text-negative'>
          <AlertCircle className='size-4 shrink-0' aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className='text-caption text-fg-subtle'>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const describedBy = (id: string, hasError?: boolean) => (hasError ? `${id}-error` : `${id}-hint`);

/** Radio card (personality etc.): selected = accent 1.5px border + soft bg + check. */
export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  className,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col gap-1 rounded-md border bg-surface p-4 transition-colors duration-instant has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
        checked ? 'border-[1.5px] border-accent bg-accent-soft' : 'border-border hover:border-border-strong hover:bg-surface-2',
        className
      )}
    >
      <input type='radio' className='sr-only' name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span className='flex items-center justify-between gap-2 font-semibold text-fg'>
        {title}
        {checked ? (
          <svg viewBox='0 0 16 16' className='size-4 text-accent' aria-hidden>
            <path d='M3 8.5l3 3 7-7' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        ) : null}
      </span>
      {description ? <span className='text-caption text-fg-muted'>{description}</span> : null}
    </label>
  );
}
