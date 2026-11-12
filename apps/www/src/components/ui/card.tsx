import * as React from 'react';

import { cn } from '~/lib/utils';

/** DESIGN-SYSTEM §8.3: --e1 surface, 16px radius, 16/24 padding. Never nest more than one deep. */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; as?: 'div' | 'section' | 'article' }
>(({ className, interactive, as: Tag = 'div', ...props }, ref) => (
  <Tag
    ref={ref}
    className={cn(
      'rounded-md border border-border bg-surface p-4 sm:p-6',
      interactive &&
        'transition-colors duration-instant hover:border-border-strong hover:bg-surface-2',
      className
    )}
    {...props}
  />
));
Card.displayName = 'Card';

export function CardHeader({
  eyebrow,
  title,
  action,
  className,
  titleAs: T = 'h2',
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  titleAs?: 'h2' | 'h3';
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className='min-w-0'>
        {eyebrow ? <p className='eyebrow mb-1'>{eyebrow}</p> : null}
        <T className='text-h3 font-semibold text-fg'>{title}</T>
      </div>
      {action ? <div className='shrink-0'>{action}</div> : null}
    </div>
  );
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('-mx-4 -mb-4 mt-4 border-t border-border px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6', className)} {...props} />;
}
