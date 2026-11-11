'use client';

import React, { useEffect, useState } from 'react';

import { ExternalLink } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Label } from '~/components/ui/label';

const STORAGE_KEY = 'midnight-poker-risk-accepted';
const MIDSKILLS_URL = 'https://x.com/Midnight_Skills';

export function RiskDisclaimerModal() {
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== '1') {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, []);

  const onContinue = () => {
    if (!accepted) return;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore storage failures — still let the user through
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Must acknowledge via checkbox + continue — block dismiss
        if (!next && accepted) setOpen(false);
      }}
    >
      <DialogContent
        hideClose
        className='max-w-md rounded-3xl border-neutral-200 bg-white p-6'
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className='font-poker text-2xl tracking-wide text-neutral-950'>
            Play at your own risk
          </DialogTitle>
          <DialogDescription className='text-left text-base leading-relaxed text-neutral-600'>
            All risk is yours. Play joyfully and keep your brain open.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <p className='text-sm leading-relaxed text-neutral-600'>
            Follow for more updates and build with the Midnight Skills knowledge
            layer.
          </p>

          <a
            href={MIDSKILLS_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-100'
          >
            @Midnight_Skills
            <ExternalLink className='h-3.5 w-3.5 text-neutral-500' />
          </a>

          <div className='flex items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3'>
            <input
              id='risk-accept'
              type='checkbox'
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className='mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-neutral-300 accent-neutral-950'
            />
            <Label
              htmlFor='risk-accept'
              className='cursor-pointer text-sm font-normal leading-snug text-neutral-700'
            >
              I understand — all risk is mine. I&apos;ll play joyfully and keep
              my brain open.
            </Label>
          </div>

          <Button
            className='h-11 w-full rounded-full bg-neutral-950 text-white hover:bg-neutral-800'
            disabled={!accepted}
            onClick={onContinue}
          >
            Continue to the table
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
