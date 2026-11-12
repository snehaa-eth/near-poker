'use client';

import Link from 'next/link';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { PublicGameView } from '~/lib/api';
import { preloadSounds } from '~/lib/sounds';
import { useTableDirector } from '~/lib/table-director';
import { cn } from '~/lib/utils';

import { SleekTable } from '~/app/game/[id]/_components/sleek-table';
import {
  DRAWER_ID,
  type DrawerTab,
  HandsPanel,
  type SessionHand,
  StandingsPanel,
  TableDrawer,
} from '~/app/game/[id]/_components/table-drawer';
import { ActionTicker, SoundButton } from '~/app/game/[id]/_components/table-fx';
import { HowToWatch } from '~/app/game/[id]/_components/table-guide';

import { MoveLog, ProofList, useHandMoves } from './arena-move-feed';

import { ArrowLeft, ChevronRight, PanelRight, ShieldCheck } from 'lucide-react';

/** How long the mint "Verify hand" chip stays in the pot area before moving to the ticker. */
const VERIFY_CHIP_MS = 5000;

/** Same formula as the server's `blindsForLobby` (fallback for older views). */
function blindsOf(view: PublicGameView) {
  if (view.smallBlind && view.bigBlind) return { sb: view.smallBlind, bb: view.bigBlind };
  const bb = Math.max(2, Math.floor(Math.max(view.minChips || 0, 20) / 10));
  return { sb: Math.max(1, Math.floor(bb / 2)), bb };
}

/**
 * Spectator page for a table (arena tables, and any table the visitor isn't seated at):
 * one slim header, the table centre-stage, a one-line ticker, and one drawer for the rest.
 */
export function ArenaSpectator({
  gameId,
  view,
  mock = false,
}: {
  gameId: string;
  view: PublicGameView;
  mock?: boolean;
}) {
  const director = useTableDirector(view, { sound: true });
  const dv = director.view;
  const name = dv.name || view.name || 'Table';
  const { sb, bb } = blindsOf(view);
  const handId = dv.fairness?.handId ?? null;
  const verifyHref = useCallback(
    (id: string) => `/verify/${encodeURIComponent(id)}${mock ? '?mock=1' : ''}`,
    [mock]
  );

  /* ---------------- drawer ---------------- */
  const [drawer, setDrawer] = useState<{ open: boolean; tab: DrawerTab; focus: number | null }>({
    open: false,
    tab: 'log',
    focus: null,
  });
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openDrawer = useCallback((tab: DrawerTab, focus: number | null = null) => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    setDrawer({ open: true, tab, focus });
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawer((d) => ({ ...d, open: false, focus: null }));
    window.setTimeout(() => returnFocusRef.current?.focus?.({ preventScroll: true }), 0);
  }, []);
  const onProof = useCallback((index: number) => openDrawer('proofs', index), [openDrawer]);

  const rows = useHandMoves(dv, { mock, enabled: drawer.open });

  /* ---------------- hand end: verify chip for 5 s, then the ticker ---------------- */
  const [settledHand, setSettledHand] = useState<string | null>(null);
  const [chipVisible, setChipVisible] = useState(false);
  const [sessionHands, setSessionHands] = useState<SessionHand[]>([]);
  const ended = Boolean(dv.gameEnded);
  const winnerName = ended ? dv.winnerNickname ?? undefined : undefined;
  const wonAmount = ended ? (dv.winners ?? []).reduce((s, w) => s + w.amount, 0) : undefined;
  useEffect(() => {
    if (!handId) return;
    setSessionHands((list) => {
      const rest = list.filter((h) => h.handId !== handId);
      return [{ handId, complete: ended, winner: winnerName, amount: wonAmount }, ...rest].slice(0, 20);
    });
  }, [handId, ended, winnerName, wonAmount]);
  useEffect(() => {
    if (!handId || !ended) return;
    setSettledHand(handId);
    setChipVisible(true);
    const t = window.setTimeout(() => setChipVisible(false), VERIFY_CHIP_MS);
    return () => window.clearTimeout(t);
  }, [handId, ended]);

  useEffect(() => {
    preloadSounds();
  }, []);

  const playing = dv.status === 'playing' || Boolean(dv.gameEnded);
  const tickerVerify =
    settledHand && !(chipVisible && dv.gameEnded && handId === settledHand) ? (
      <Link
        href={verifyHref(settledHand)}
        className='relative inline-flex h-9 items-center gap-1 rounded-xs px-1 text-[13px] font-semibold text-accent after:absolute after:-inset-y-1 after:inset-x-0 after:content-[""] hover:underline'
      >
        <ShieldCheck className='h-4 w-4' strokeWidth={1.75} />
        <span className='hidden sm:inline'>Verify hand</span>
        <span className='sm:hidden'>Verify</span>
        <ChevronRight className='h-4 w-4' />
      </Link>
    ) : null;

  const drawerBody =
    drawer.tab === 'log' ? (
      <div className='flex flex-col gap-4'>
        <MoveLog view={dv} rows={rows} onProof={onProof} />
        <HowToWatch />
      </div>
    ) : drawer.tab === 'proofs' ? (
      <ProofList
        view={dv}
        rows={rows}
        focusIndex={drawer.focus}
        verifyHref={handId ? verifyHref(handId) : undefined}
      />
    ) : drawer.tab === 'hands' ? (
      <HandsPanel
        gameId={gameId}
        mock={mock}
        currentHandId={handId}
        sessionHands={sessionHands}
        verifyHref={verifyHref}
      />
    ) : (
      <StandingsPanel mock={mock} seated={dv.players.map((p) => p.nickname)} />
    );

  const iconBtn =
    'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm px-2 text-fg-muted transition-colors duration-instant hover:bg-surface-2 hover:text-fg';

  return (
    <div className='relative flex min-h-[100dvh] flex-col bg-bg pt-[var(--nav-h)] text-fg'>
      <h1 className='sr-only'>Table {name}</h1>
      {/* One lamp over the felt; the rest of the room in darkness. */}
      <div aria-hidden className='lamp-pool pointer-events-none absolute inset-0 [--lamp-x:50%] [--lamp-y:48%]' />

      {/* One slim header */}
      <div className='sticky top-[var(--nav-h)] z-30 border-b border-border bg-bg/90 backdrop-blur'>
        <div className='flex h-11 items-center gap-1 px-2 sm:px-6'>
          <nav aria-label='Table' className='flex min-w-0 items-center gap-1.5 text-[13px]'>
            <Link
              href={mock ? '/arena?mock=1' : '/arena'}
              className={cn(iconBtn, 'shrink-0')}
              aria-label='Back to the arena'
            >
              <ArrowLeft className='h-4 w-4' strokeWidth={1.75} />
              <span className='hidden sm:inline'>Arena</span>
            </Link>
            <span aria-hidden className='hidden text-fg-disabled sm:inline'>·</span>
            <span className='truncate font-semibold text-fg'>{name}</span>
            <span aria-hidden className='text-fg-disabled'>·</span>
            <span className='shrink-0 whitespace-nowrap tabular-nums text-fg-muted'>
              NLH {sb}/{bb}
            </span>
          </nav>
          <div className='ml-auto flex shrink-0 items-center'>
            <button
              type='button'
              onClick={() => openDrawer('proofs')}
              className={cn(iconBtn, 'text-[13px]')}
              aria-label={`Provably fair${handId ? ` · hand ${handId}` : ''}. Open proofs`}
            >
              <ShieldCheck className='h-4 w-4 text-accent' strokeWidth={1.75} />
              <span className='hidden md:inline'>Provably fair</span>
              {handId ? (
                <span className='hidden font-mono text-[12px] text-fg-subtle sm:inline'>
                  #{handId.slice(0, 10)}
                </span>
              ) : null}
            </button>
            <SoundButton />
            <button
              type='button'
              onClick={() => (drawer.open ? closeDrawer() : openDrawer(drawer.tab))}
              className={cn(iconBtn, drawer.open && 'bg-surface-2 text-fg')}
              aria-label={drawer.open ? 'Close table drawer' : 'Open table drawer'}
              aria-expanded={drawer.open}
              aria-controls={DRAWER_ID}
            >
              <PanelRight className='h-5 w-5' strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      <section
        aria-label={`Table ${name}`}
        className={cn(
          'relative flex flex-1 flex-col transition-[padding] duration-move ease-move',
          drawer.open && 'sm:pr-[360px]'
        )}
      >
        <div className='flex flex-1 items-center'>
          <SleekTable
            gameId={gameId}
            view={view}
            director={director}
            embedded
            showPositions
            onProof={onProof}
            verifyChip={chipVisible && handId === settledHand}
            verifyHref={handId ? verifyHref(handId) : undefined}
            seatNoun={view.arena ? 'agents' : 'players'}
          />
        </div>
        <ActionTicker items={director.ticker} trailing={tickerVerify} live={playing} />
      </section>

      <TableDrawer
        open={drawer.open}
        tab={drawer.tab}
        onTab={(tab) => setDrawer((d) => ({ ...d, tab, focus: tab === 'proofs' ? d.focus : null }))}
        onClose={closeDrawer}
      >
        {drawerBody}
      </TableDrawer>
    </div>
  );
}
