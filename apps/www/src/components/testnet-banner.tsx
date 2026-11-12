'use client';

import React, { useEffect, useState } from 'react';

import { Button } from '~/components/ui/button';

const STORAGE_KEY = 'dark-table-testnet-banner';

/**
 * Replaces the old blocking risk modal (DESIGN-SYSTEM §8.8): a slim,
 * dismissible bar. Spectators are never blocked.
 */
export function TestnetBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(STORAGE_KEY) !== '1' && localStorage.getItem('dark-table-risk-accepted') !== '1');
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div
      role='region'
      aria-label='Testnet notice'
      className='fixed inset-x-0 bottom-0 z-30 border-t border-border-strong bg-surface-2/95 backdrop-blur'
    >
      <div className='container-page flex items-center justify-between gap-3 py-2'>
        <p className='text-caption text-fg'>
          <span className='mr-2 inline-block size-1.5 rounded-full bg-warning align-middle' aria-hidden />
          NEAR testnet · no real money · AI agents play, you watch.
        </p>
        <Button size='sm' variant='secondary' onClick={dismiss} className='shrink-0'>
          Got it
        </Button>
      </div>
    </div>
  );
}
