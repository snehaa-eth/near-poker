'use client';

import React, { useMemo, useState } from 'react';

import { Check } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { ScrollArea } from '~/components/ui/scroll-area';
import { AVATARS, type AvatarPath } from '~/lib/avatars';
import { cn } from '~/lib/utils';

const PACK_LABELS: Record<string, string> = {
  '3d': '3D',
  bluey: 'Bluey',
  memo: 'Memo',
  notion: 'Notion',
  teams: 'Teams',
  toon: 'Toon',
  upstream: 'Upstream',
  vibrent: 'Vibrent',
};

function packOf(path: string) {
  const name = path.split('/').pop() ?? '';
  return name.split('_')[0] ?? 'other';
}

type AvatarPickerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string | null;
  onSelect: (avatar: AvatarPath) => void;
};

export function AvatarPickerModal({
  open,
  onOpenChange,
  value,
  onSelect,
}: AvatarPickerModalProps) {
  const [draft, setDraft] = useState<string | null>(value);
  const [pack, setPack] = useState<string>('all');

  const packs = useMemo(() => {
    const set = new Set(AVATARS.map(packOf));
    return ['all', ...Array.from(set).sort()];
  }, []);

  const filtered = useMemo(() => {
    if (pack === 'all') return AVATARS;
    return AVATARS.filter((a) => packOf(a) === pack);
  }, [pack]);

  const handleOpen = (next: boolean) => {
    if (next) {
      setDraft(value);
      setPack('all');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className='max-h-[92dvh] w-[calc(100vw-1.25rem)] max-w-xl gap-0 overflow-hidden p-0 sm:rounded-2xl'>
        <DialogHeader className='border-b border-neutral-200 px-4 py-3 text-left sm:px-5 sm:py-4'>
          <DialogTitle>Choose avatar</DialogTitle>
          <DialogDescription>
            Pick a look for your table profile. Saved to your wallet address.
          </DialogDescription>
        </DialogHeader>

        <div className='flex gap-2 overflow-x-auto border-b border-neutral-100 px-3 py-3 sm:px-4'>
          {packs.map((id) => (
            <button
              key={id}
              type='button'
              onClick={() => setPack(id)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition',
                pack === id
                  ? 'bg-neutral-950 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              )}
            >
              {id === 'all' ? 'All' : (PACK_LABELS[id] ?? id)}
            </button>
          ))}
        </div>

        <ScrollArea className='h-[min(56dvh,420px)] px-3 py-3 sm:px-4 sm:py-4'>
          <div className='grid grid-cols-3 gap-2.5 xs:grid-cols-4 sm:grid-cols-5 sm:gap-3'>
            {filtered.map((avatar) => {
              const selected = draft === avatar;
              return (
                <button
                  key={avatar}
                  type='button'
                  onClick={() => setDraft(avatar)}
                  className={cn(
                    'relative aspect-square overflow-hidden rounded-full border-2 bg-neutral-100 transition',
                    selected
                      ? 'border-neutral-950 ring-2 ring-neutral-950/10'
                      : 'border-transparent hover:border-neutral-300'
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatar}
                    alt=''
                    className='h-full w-full object-cover'
                    draggable={false}
                  />
                  {selected ? (
                    <span className='absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-950 text-white sm:right-1.5 sm:top-1.5'>
                      <Check className='h-3 w-3' />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className='border-t border-neutral-200 px-4 py-3 sm:justify-between sm:px-5 sm:py-4'>
          <p className='hidden text-xs text-neutral-400 sm:block'>
            {filtered.length} avatars
          </p>
          <div className='flex w-full gap-2 sm:w-auto'>
            <Button
              type='button'
              variant='outline'
              className='h-11 flex-1 rounded-full sm:h-10 sm:flex-none'
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type='button'
              className='h-11 flex-1 rounded-full bg-neutral-950 text-white sm:h-10 sm:flex-none'
              disabled={!draft}
              onClick={() => {
                if (!draft) return;
                onSelect(draft as AvatarPath);
                onOpenChange(false);
              }}
            >
              Use avatar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
