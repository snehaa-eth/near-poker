'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import React, { useEffect, useState } from 'react';

import { cn } from '~/lib/utils';

import { EnterAgentButton } from '~/components/enter-agent-modal';
import { SoundToggle } from '~/components/sound-toggle';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '~/components/ui/dialog';

import { ArrowUpRight, Menu } from 'lucide-react';

export const REPO_URL = 'https://github.com/snehaa-eth/near-poker';

const LINKS = [
  { href: '/arena', label: 'Arena' },
  { href: '/events', label: 'Events' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/agents', label: 'Agents' },
  { href: '/verify', label: 'Verify' },
];

/**
 * Agents play, people watch: the nav links to what a spectator or an agent
 * builder needs. Desktop: inline links. Mobile: logo + Enter + menu sheet.
 */
export const Navbar = () => {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  // The table header owns the sound control on /game/[id]; don't show a second one.
  const onTable = pathname.startsWith('/game/');
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className='fixed inset-x-0 top-0 z-40 h-nav border-b border-border bg-bg/85 backdrop-blur-md'>
      <nav aria-label='Main' className='container-page flex h-full items-center justify-between gap-3'>
        <Link href='/' className='flex h-11 shrink-0 items-center gap-2 rounded-sm text-fg' aria-label='Dark Table home'>
          <Image src='/logo-dark-table.svg' alt='' width={28} height={28} className='size-7 shrink-0' priority />
          <span className='whitespace-nowrap font-display text-[24px] font-extrabold uppercase leading-none tracking-[0.06em]'>Dark Table</span>
        </Link>

        <ul className='hidden items-center gap-1 md:flex'>
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={isActive(l.href) ? 'page' : undefined}
                className={cn(
                  'inline-flex h-10 items-center rounded-sm px-3 text-caption font-medium text-fg-muted transition-colors duration-instant hover:bg-surface-2 hover:text-fg',
                  isActive(l.href) && 'text-fg shadow-[inset_0_-2px_0_var(--ivory)]'
                )}
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li>
            <a
              href={REPO_URL}
              target='_blank'
              rel='noreferrer'
              className='inline-flex h-10 items-center gap-1 rounded-sm px-3 text-caption font-medium text-fg-muted hover:bg-surface-2 hover:text-fg'
            >
              GitHub <ArrowUpRight className='size-3.5' aria-hidden />
              <span className='sr-only'>(opens in a new tab)</span>
            </a>
          </li>
        </ul>

        <div className='flex items-center gap-1 sm:gap-2'>
          {onTable ? null : <SoundToggle className='hidden md:inline-flex' />}
          <EnterAgentButton label='Enter an agent' variant='secondary' size='md' className='hidden sm:inline-flex' />
          <EnterAgentButton label='Enter' variant='secondary' size='md' className='h-11 sm:hidden' />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <button
                type='button'
                aria-label='Open menu'
                className='inline-flex size-11 items-center justify-center rounded-sm text-fg hover:bg-surface-2 md:hidden'
              >
                <Menu className='size-5' strokeWidth={1.75} aria-hidden />
              </button>
            </DialogTrigger>
            <DialogContent
              className='left-auto right-0 top-0 h-[100dvh] max-h-[100dvh] w-[min(320px,85vw)] translate-x-0 translate-y-0 content-start rounded-none rounded-l-lg border-y-0 border-r-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
            >
              <DialogTitle className='eyebrow'>Menu</DialogTitle>
              <ul className='mt-2 flex flex-col'>
                {LINKS.map((l) => (
                  <li key={l.href}>
                    <DialogClose asChild>
                      <Link
                        href={l.href}
                        aria-current={isActive(l.href) ? 'page' : undefined}
                        className={cn(
                          'flex h-12 items-center rounded-sm px-3 text-lead font-medium text-fg hover:bg-surface-3',
                          isActive(l.href) && 'underline decoration-fg-subtle underline-offset-8'
                        )}
                      >
                        {l.label}
                      </Link>
                    </DialogClose>
                  </li>
                ))}
                <li>
                  <a href={REPO_URL} target='_blank' rel='noreferrer' className='flex h-12 items-center gap-1 rounded-sm px-3 text-lead font-medium text-fg hover:bg-surface-3'>
                    GitHub <ArrowUpRight className='size-4' aria-hidden />
                  </a>
                </li>
              </ul>
              {onTable ? null : (
                <div className='mt-4 flex items-center justify-between border-t border-border pt-4'>
                  <span className='text-caption text-fg-muted'>Table sounds</span>
                  <SoundToggle compact={false} />
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </nav>
    </header>
  );
};
