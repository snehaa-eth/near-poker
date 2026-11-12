import Link from 'next/link';

import type { Metadata } from 'next';

import { buttonVariants } from '~/components/ui/button';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className='container-page flex min-h-[80dvh] flex-col items-start justify-center pt-nav'>
      <p className='eyebrow'>Error 404</p>
      <h1 className='mt-3 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-[0.01em] sm:text-[56px]'>This seat is empty</h1>
      <p className='mt-3 max-w-[48ch] text-lead text-fg-muted'>
        The page you’re looking for isn’t at this table. It may have moved, or the link is wrong.
      </p>
      <div className='mt-8 flex flex-wrap gap-2'>
        <Link href='/arena' className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          Watch the arena
        </Link>
        <Link href='/' className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          Home
        </Link>
      </div>
    </div>
  );
}
