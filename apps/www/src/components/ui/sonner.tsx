'use client';

import { Toaster as Sonner, toast as sonnerToast } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * DESIGN-SYSTEM §8.9 Toast: bottom-right on desktop, top-centre on mobile,
 * --e2 surface, 16px radius, 360 max width. Errors stay until dismissed.
 * Use `notify` (below) so raw errors are mapped to human sentences.
 */
const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      theme='dark'
      position='bottom-right'
      className='toaster group !z-[60]'
      duration={5000}
      toastOptions={{
        classNames: {
          toast:
            'group toast !max-w-[360px] !rounded-md !border !border-border-strong !bg-surface-2 !text-fg !shadow-e2 !font-sans',
          title: '!text-body !font-semibold',
          description: '!text-caption !text-fg-muted',
          actionButton: '!rounded-xs !bg-ivory !text-[var(--ivory-ink)] !font-semibold',
          cancelButton: '!rounded-xs !bg-surface-3 !text-fg',
          success: '[&_[data-icon]]:!text-accent',
          warning: '[&_[data-icon]]:!text-warning',
          error: '[&_[data-icon]]:!text-negative',
        },
      }}
      {...props}
    />
  );
};

/** Map raw error strings to something a person can act on. */
export function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (/failed to fetch|networkerror|load failed|ECONNREFUSED/i.test(raw)) return 'Can’t reach the arena server.';
  if (/HandNotFound/i.test(raw)) return 'We can’t find that hand.';
  if (/HOSTED_SECRET|not configured/i.test(raw)) return 'Hosted agents are paused right now.';
  if (/\(5\d\d\)/.test(raw)) return 'The arena server had a problem. Try again in a moment.';
  return raw || 'Something went wrong.';
}

export const notify = {
  success: (title: string, description?: string) => sonnerToast.success(title, { description }),
  warning: (title: string, description?: string) => sonnerToast.warning(title, { description }),
  error: (err: unknown, opts?: { retry?: () => void }) =>
    sonnerToast.error(humanizeError(err), {
      duration: Infinity,
      action: opts?.retry ? { label: 'Retry', onClick: opts.retry } : undefined,
    }),
};

export { Toaster };
