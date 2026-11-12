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

/** Mute / unmute table SFX (lucide Volume2 / VolumeX). Persists in localStorage. */
export function SoundToggle({
  className,
  compact = true,
}: {
  className?: string;
  /** Icon-only (default). Pass false to show the "Sound" label. */
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
    if (!next) playSound('cardFlip', 0.45);
  };

  const Icon = muted ? VolumeX : Volume2;
  return (
    <button
      type='button'
      onClick={ready ? onToggle : undefined}
      aria-pressed={ready ? !muted : undefined}
      aria-label={muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off'}
      title={muted ? 'Sound off' : 'Sound on'}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-sm text-caption font-semibold text-fg-muted transition-colors duration-instant hover:bg-surface-2 hover:text-fg max-sm:h-11',
        compact ? 'w-10 max-sm:w-11' : 'px-3',
        className
      )}
    >
      <Icon className='size-5' strokeWidth={1.75} aria-hidden />
      {!compact ? <span>{muted ? 'Sound off' : 'Sound'}</span> : null}
    </button>
  );
}

/** Force unmute (e.g. before mock replay). */
export function ensureSoundOn() {
  setSoundMuted(false);
}
