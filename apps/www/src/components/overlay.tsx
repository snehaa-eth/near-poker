import React, { type ComponentProps } from 'react';

import { cn } from '~/lib/utils';

export const Overlay = ({
  children,
  className,
  ...props
}: ComponentProps<'div'>) => {
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] backdrop-blur-sm'>
      <div
        className={cn(
          'w-full max-w-md rounded-lg border border-border-strong bg-surface-2 p-8 text-fg shadow-e3',
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
};
