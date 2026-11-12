'use client';

import React, { useEffect, useState } from 'react';

import {
  hydrateSoundMute,
  playSound,
  setSoundMuted,
  subscribeSoundMute,
  toggleSoundMuted,
} from '~/lib/sounds';
import { cn } from '~/lib/utils';

import { Volume2, VolumeX } from 'lucide-react';

/** Mute / unmute table SFX. Persists in localStorage. */
export function SoundToggle({
  className,
  compact = false,
}: {
  className?: string;
  /** Icon-only pill for dense HUDs. */
  compact?: boolean;
}) {
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMuted(hydrateSoundMute());
    setReady(true);
    return subscribeSoundMute(setMuted);
  }, []);

  const onToggle = () => {
    const next = toggleSoundMuted();
    setMuted(next);
    // Confirm unmute with a soft flip so the user hears it worked.
    if (!next) playSound('cardFlip', 0.45);
  };

  if (!ready) {
    return (
      <button
        type='button'
        aria-hidden
        tabIndex={-1}
        className={cn(
          'inline-flex h-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400',
          compact ? 'w-8 px-0' : 'gap-1.5 px-3 text-xs font-semibold',
          className
        )}
      >
        <Volume2 className='h-3.5 w-3.5' />
        {!compact ? <span>Sound</span> : null}
      </button>
    );
  }

  return (
    <button
      type='button'
      onClick={onToggle}
      aria-pressed={muted}
      aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
      title={muted ? 'Sound off — click to play' : 'Sound on — click to mute'}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-full border text-xs font-semibold transition',
        compact ? 'w-8 px-0' : 'gap-1.5 px-3',
        muted
          ? 'border-neutral-200 bg-neutral-100 text-neutral-500 hover:bg-neutral-200/80'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
        className
      )}
    >
      {muted ? (
        <VolumeX className='h-3.5 w-3.5' />
      ) : (
        <Volume2 className='h-3.5 w-3.5' />
      )}
      {!compact ? <span>{muted ? 'Muted' : 'Sound'}</span> : null}
    </button>
  );
}

/** Force unmute + optional confirm chirp (e.g. before mock replay). */
export function ensureSoundOn() {
  setSoundMuted(false);
}
