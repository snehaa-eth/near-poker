'use client';

import React, { useEffect, useState } from 'react';

import { type PublicGameView, api } from '~/lib/api';
import { startMockHandLoop } from '~/lib/mock-hand';
import { truncate } from '~/lib/utils';

import { toast } from 'sonner';
import { useSession } from '~/providers/session-provider';
import { useSocket } from '~/providers/socket-provider';

import { ArenaSpectator } from '~/components/arena/arena-spectator';
import { GameOverlay } from '~/components/overlays';
import { OrbitLoader } from '~/components/ui/orbit-loader';

import { ChooseCards } from './_components/choose-cards';
import { DeclareResult } from './_components/declare-result';
import { Results } from './_components/results';
import { SleekTable } from './_components/sleek-table';

const GamePage = ({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const gameId = params.id;
  const mock = searchParams?.mock === '1';
  const { socket } = useSocket();
  const { user, loading: sessionLoading } = useSession();
  const loggedIn = Boolean(user);
  const [view, setView] = useState<PublicGameView | null>(null);

  useEffect(() => {
    if (mock) {
      // Scripted hand streamed like the live server, so the table animates offline.
      return startMockHandLoop(gameId, setView);
    }
    // Wait for the session so we know whether this visitor can sit down.
    if (sessionLoading) return;
    void (async () => {
      try {
        let next = await api.getGame(gameId);
        const seated =
          next.myPlayerId != null &&
          next.players.some((p) => p.id === next.myPlayerId);
        // Arena tables are agent-only and anonymous visitors can't sit:
        // both just watch instead of auto-joining.
        if (next.status === 'waiting' && !seated && !next.arena && loggedIn) {
          next = await api.joinGame(gameId);
          if (next.gameId !== gameId) {
            window.history.replaceState(null, '', `/game/${next.gameId}`);
          }
        }
        setView(next);
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [gameId, mock, sessionLoading, loggedIn]);

  useEffect(() => {
    if (!socket || mock) return;
    socket.emit('game:joinRoom', { gameId });
    const onState = (next: PublicGameView) => setView(next);
    const onError = (payload: { error: string }) => {
      toast.error(payload.error);
    };
    socket.on('game:state', onState);
    socket.on('game:error', onError);
    return () => {
      socket.off('game:state', onState);
      socket.off('game:error', onError);
    };
  }, [socket, gameId, mock]);

  const seated =
    view != null &&
    view.myPlayerId != null &&
    view.players.some((p) => p.id === view.myPlayerId);

  if (!view) {
    return (
      <div className='flex min-h-[100dvh] items-center justify-center bg-bg px-4 pt-[var(--nav-h)]'>
        <h1 className='sr-only'>Loading table</h1>
        <OrbitLoader size={220} caption='Finding your table' />
      </div>
    );
  }

  // Arena tables, and any table the visitor isn't seated at, are watched — never the
  // human lobby's "Waiting / Start Game" modal.
  if (view.arena || !seated) {
    return <ArenaSpectator gameId={gameId} view={view} mock={mock} />;
  }

  return (
    <div className='relative'>
      <GameOverlay gameId={gameId} view={view} />
      <SleekTable gameId={gameId} view={view} />

      {view.roundLabel === 'End' && !view.gameEnded && seated ? (
        <>
          <ChooseCards cards={view.communityCards} gameId={gameId} />
          <DeclareResult gameId={gameId} />
        </>
      ) : null}
      {view.gameEnded && view.players.length > 0 ? (
        <Results
          players={view.players}
          winnerId={view.winnerId}
          winningHand={view.winningHand}
        />
      ) : null}

      <h1 className='sr-only'>Table {view.name || gameId}</h1>
      <div className='pointer-events-none absolute left-4 top-20 z-30 max-w-[70vw] text-[13px] text-fg-subtle'>
        <p className='truncate font-medium text-fg-muted'>
          {view.name || 'Table'}
        </p>
        <p className='mt-0.5 font-mono'>
          {view.joinCode ? `${view.joinCode} · ` : ''}
          {truncate(gameId, 14)}
          {view.minChips > 0 ? ` · min ${view.minChips}` : ''}
        </p>
      </div>
    </div>
  );
};

export default GamePage;
