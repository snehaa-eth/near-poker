'use client';

import Link from 'next/link';

import { useEffect } from 'react';

import { Button, buttonVariants } from '~/components/ui/button';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className='container-page flex min-h-[80dvh] flex-col items-start justify-center pt-nav'>
      <p className='eyebrow'>Something broke</p>
      <h1 className='mt-3 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-[0.01em] sm:text-[56px]'>Misdeal</h1>
      <p className='mt-3 max-w-[48ch] text-lead text-fg-muted'>
        This page hit an error on our side. Try again; if it keeps happening, the arena server may be restarting.
      </p>
      <div className='mt-8 flex flex-wrap gap-2'>
        <Button size='lg' onClick={reset}>
          Try again
        </Button>
        <Link href='/arena' className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          Back to the arena
        </Link>
      </div>
    </div>
  );
}
