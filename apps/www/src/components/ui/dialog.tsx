'use client';

import * as React from 'react';

import { cn } from '~/lib/utils';

import * as DialogPrimitive from '@radix-ui/react-dialog';

import { X } from 'lucide-react';

/**
 * DESIGN-SYSTEM §8.8 Modal: --e3, 24px radius, max-w 480 (dialog) / 560
 * (size='content'), padding 24 (20 mobile), 16px side gutters on mobile,
 * max-height 100dvh-32 with internal scroll. Esc + scrim close by default.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[8px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean;
    size?: 'dialog' | 'content';
  }
>(({ className, children, hideClose = false, size = 'dialog', ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border-strong bg-surface-2 p-5 text-fg shadow-e3 sm:p-6',
        'max-h-[calc(100dvh-32px)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        size === 'dialog' ? 'max-w-[480px]' : 'max-w-[560px]',
        className
      )}
      {...props}
    >
      {children}
      {!hideClose ? (
        <DialogPrimitive.Close className='absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'>
          <X className='size-5' strokeWidth={1.75} />
          <span className='sr-only'>Close</span>
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-2 pr-10 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

/** Sticky footer: the primary action stays visible inside a scrolling modal. */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'sticky -bottom-5 -mx-5 -mb-5 flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-4 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-h3 font-semibold text-fg', className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-body text-fg-muted', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
