import * as React from 'react';

import { playSound, type SoundName } from '~/lib/sounds';
import { cn } from '~/lib/utils';

import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';

/**
 * DESIGN-SYSTEM §8.1. One `primary` per view.
 * Variants: primary · secondary · ghost · link · danger
 * Sizes: sm (32) · md (40, default) · lg (48) · icon (40 square) · icon-sm (32 square)
 * Small sizes keep a ≥44px hit area on touch screens via ::after.
 */
const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-sm font-semibold',
    'transition-colors duration-instant ease-standard active:translate-y-px',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:border-transparent disabled:bg-surface-3 disabled:text-fg-disabled',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
        secondary:
          'border border-border-strong bg-surface-2 text-fg hover:bg-surface-3',
        ghost: 'bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
        link: 'h-auto bg-transparent px-0 text-accent underline-offset-4 hover:underline active:translate-y-0',
        danger:
          'border border-negative/40 bg-transparent text-negative hover:bg-negative/10',
        // Legacy names (map onto the system so older call sites keep working)
        default: 'bg-accent text-accent-ink hover:bg-accent-hover',
        outline:
          'border border-border-strong bg-surface-2 text-fg hover:bg-surface-3',
        destructive:
          'border border-negative/40 bg-transparent text-negative hover:bg-negative/10',
      },
      size: {
        sm: 'h-8 px-3 text-caption after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[""] max-sm:after:-inset-y-1.5',
        md: 'h-10 px-4 text-body',
        lg: 'h-12 px-5 text-body',
        icon: 'h-10 w-10 p-0 max-sm:h-11 max-sm:w-11',
        'icon-sm':
          'h-8 w-8 p-0 after:absolute after:-inset-1.5 after:content-[""]',
        // Legacy
        default: 'h-10 px-4 text-body',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Play a `/public/sounds` clip on click (by logical name). */
  sound?: SoundName;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, sound, onClick, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          if (sound && !props.disabled) playSound(sound);
          onClick?.(e);
        }}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
