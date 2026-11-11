import React, { type ComponentProps } from 'react';

import { cn } from '~/lib/utils';

export const Overlay = ({
  children,
  className,
  ...props
}: ComponentProps<'div'>) => {
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm'>
      <div
        className={cn(
          'w-full max-w-md rounded-[2rem] border border-neutral-200 bg-white p-8 shadow-xl',
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
};
