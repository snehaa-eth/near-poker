'use client';

import Link from 'next/link';

import React, { useCallback, useEffect, useState } from 'react';

import type { ArenaMoveRecord, PublicGameView } from '~/lib/api';
import { formatTokens } from '~/lib/format';
import type { SeatActionFlash } from '~/lib/seat-action-flash';
import { playSound, preloadSounds } from '~/lib/sounds';
import { cn } from '~/lib/utils';

import { HowToWatch } from '~/app/game/[id]/_components/table-guide';
import { SleekTable } from '~/app/game/[id]/_components/sleek-table';

import { ChipAmount } from '~/components/currency-amount';
import { EnterAgentButton } from '~/components/enter-agent-modal';
import { SoundToggle } from '~/components/sound-toggle';

import { ArenaMoveFeed } from './arena-move-feed';
import { ArenaSidebar } from './arena-sidebar';

import { ArrowLeft, ShieldCheck } from 'lucide-react';

function HudChip({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'live' | 'pot' | 'street';
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-md px-2 text-[11px] font-bold uppercase tracking-wide',
        tone === 'live' && 'bg-emerald-600 text-white',
        tone === 'pot' && 'bg-neutral-950 text-white',
        tone === 'street' && 'bg-amber-100 text-amber-900',
        tone === 'default' && 'bg-neutral-100 text-neutral-700'
      )}
    >
      {children}
    </span>
  );
}

/** Arena watch layout: table + move feed + standings / recent hands. */
export function ArenaSpectator({
  gameId,
  view,
  mock = false,
}: {
  gameId: string;
  view: PublicGameView;
  mock?: boolean;
}) {
  const handId = view.fairness?.handId ?? null;
  const street =
    view.gameEnded || view.round === 'End'
      ? view.communityCards.filter((c) => c >= 0).length >= 5
        ? 'Showdown'
        : 'Hand over'
      : view.roundLabel || view.street || view.round || '—';

  const [actionFlashes, setActionFlashes] = useState<
    Record<string, SeatActionFlash>
  >({});

  const onArenaMove = useCallback((move: ArenaMoveRecord) => {
    // Prefer nickname match when playerId from the feed is a wallet / session id.
    const byId = move.playerId;
    const byNick = move.nickname
      ? view.players.find(
          (p) => p.nickname.toLowerCase() === move.nickname!.toLowerCase()
        )?.id
      : null;
    const seatId = byNick || byId;
    if (!seatId) return;
    setActionFlashes((cur) => ({
      ...cur,
      [seatId]: {
        id: `${move.completionId}-${move.action}`,
        action: move.action,
        amount: move.amount,
      },
    }));
  }, [view.players]);

  // Mock tables: unlock / warm the audio graph on first click so Pepper SFX play.
  useEffect(() => {
    if (!mock) return;
    preloadSounds();
    const unlock = () => {
      playSound('cardFlip', 0.01);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [mock]);

  return (
    <div className='min-h-[100dvh] bg-[#F4F5F7] pt-16'>
      <div className='mx-auto grid max-w-[90rem] gap-4 px-3 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]'>
        <div className='flex min-w-0 flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Link
              href={mock ? '/arena?mock=1' : '/arena'}
              className='inline-flex h-7 items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50'
            >
              <ArrowLeft className='h-3.5 w-3.5' />
              Arena
            </Link>
            <HudChip tone='live'>
              {view.status === 'playing' && !view.gameEnded ? 'Live' : 'Watch'}
            </HudChip>
            <HudChip>Table {view.name || gameId.slice(0, 8)}</HudChip>
            <HudChip tone='street'>{street}</HudChip>
            <HudChip tone='pot'>Pot {formatTokens(view.pot)}</HudChip>
            {view.minChips > 0 ? (
              <span className='inline-flex h-7 items-center gap-1.5 rounded-md bg-neutral-100 px-2 text-[11px] font-bold text-neutral-700'>
                Min
                <ChipAmount
                  value={view.minChips}
                  size='sm'
                  className='text-[11px] font-bold text-neutral-800'
                  iconClassName='h-3.5 w-3.5'
                />
              </span>
            ) : null}
            {handId ? (
              <span className='font-mono text-[11px] leading-7 text-neutral-500'>
                hand {handId.slice(0, 10)}
              </span>
            ) : null}
            <div className='ml-auto flex flex-wrap items-center gap-2'>
              <SoundToggle className='h-7' />
              <span className='inline-flex h-7 items-center gap-1 text-[11px] font-medium text-emerald-700'>
                <ShieldCheck className='h-3.5 w-3.5' />
                TEE moves only
              </span>
              <HowToWatch />
              <EnterAgentButton
                label='Enter an agent'
                variant='mint'
                className='h-7 px-3 text-xs'
                pool={{
                  name: view.name || 'Arena table',
                  gameId,
                  minChips: view.minChips || 100,
                }}
              />
            </div>
          </div>

          <div className='overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-950 shadow-[0_12px_40px_rgba(0,0,0,0.12)]'>
            <SleekTable
              gameId={gameId}
              view={view}
              embedded
              showPositions
              actionFlashes={actionFlashes}
            />
          </div>

          <ArenaMoveFeed
            handId={handId}
            mock={mock}
            nextPlayerNickname={view.nextPlayerNickname}
            defaultOpen
            onMove={onArenaMove}
            silent
          />
        </div>

        <ArenaSidebar
          gameId={gameId}
          currentHandId={handId}
          mock={mock}
        />
      </div>
    </div>
  );
}
