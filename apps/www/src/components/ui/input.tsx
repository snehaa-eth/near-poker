import * as React from 'react';

import { cn } from '~/lib/utils';

/** DESIGN-SYSTEM §8.10: 44px, --surface-3 bg, --border-strong, accent focus + soft ring. */
export const inputClass =
  'flex h-11 w-full rounded-sm border border-border-strong bg-surface-3 px-3 text-body text-fg placeholder:text-fg-subtle transition-colors duration-instant ' +
  'focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ' +
  'aria-[invalid=true]:border-negative disabled:cursor-not-allowed disabled:text-fg-disabled ' +
  'file:border-0 file:bg-transparent file:text-caption file:font-medium file:text-fg';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return <input ref={ref} type={type} className={cn(inputClass, className)} {...props} />;
});
Input.displayName = 'Input';

export { Input };
