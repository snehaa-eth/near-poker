'use client';

import React from 'react';

import { formatTokens } from '~/lib/format';
import { cn } from '~/lib/utils';

export const CHIP_ICON = '/icons/poker-chip.png';
export const NIGHT_ICON = '/cards/BACK-WHITE.png';

type Size = 'sm' | 'md' | 'lg';

const ICON_SIZE: Record<Size, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-7 w-7 sm:h-8 sm:w-8',
};

const TEXT_SIZE: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl sm:text-2xl',
};

type AmountProps = {
  value: number | string;
  size?: Size;
  className?: string;
  iconClassName?: string;
  /** When value is already formatted, skip formatTokens. */
  raw?: boolean;
};

function CurrencyIcon({
  src,
  size,
  className,
}: {
  src: string;
  size: Size;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=''
      draggable={false}
      className={cn(
        'inline-block shrink-0 object-contain',
        ICON_SIZE[size],
        className
      )}
    />
  );
}

function displayValue(value: number | string, raw?: boolean) {
  if (raw || typeof value === 'string') return String(value);
  return formatTokens(value);
}

export function ChipAmount({
  value,
  size = 'md',
  className,
  iconClassName,
  raw,
}: AmountProps) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 font-semibold tabular-nums leading-none text-neutral-950',
        TEXT_SIZE[size],
        className
      )}
    >
      <CurrencyIcon src={CHIP_ICON} size={size} className={iconClassName} />
      <span className='truncate leading-none'>{displayValue(value, raw)}</span>
    </span>
  );
}

export function NightAmount({
  value,
  size = 'md',
  className,
  iconClassName,
  raw,
}: AmountProps) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 font-semibold tabular-nums leading-none text-neutral-950',
        TEXT_SIZE[size],
        className
      )}
    >
      <CurrencyIcon src={NIGHT_ICON} size={size} className={iconClassName} />
      <span className='truncate leading-none'>{displayValue(value, raw)}</span>
    </span>
  );
}
