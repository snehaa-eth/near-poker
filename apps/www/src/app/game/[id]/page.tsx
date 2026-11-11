'use client';

import React, { useEffect, useState } from 'react';

import { type PublicGameView, api } from '~/lib/api';
import { mockArenaView } from '~/lib/arena';
import { truncate } from '~/lib/utils';

import { toast } from 'sonner';
import { useSession } from '~/providers/session-provider';
import { useSocket } from '~/providers/socket-provider';

import { GameOverlay } from '~/components/overlays';

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
      setView(mockArenaView(gameId));
      return;
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
      <div className='flex h-screen items-center justify-center bg-[#FAFAFA] text-neutral-500'>
        Loading table…
      </div>
    );
  }

  return (
    <div className='relative'>
      {/* Arena hands start automatically; no lobby / next-hand controls. */}
      {view.arena ? null : <GameOverlay gameId={gameId} view={view} />}
      <SleekTable gameId={gameId} view={view} />

      {view.roundLabel === 'End' && !view.gameEnded && seated ? (
        <>
          <ChooseCards cards={view.communityCards} gameId={gameId} />
          <DeclareResult gameId={gameId} />
        </>
      ) : null}
      {view.gameEnded ? <Results players={view.players} /> : null}

      <div className='pointer-events-none absolute left-4 top-20 z-30 max-w-[70vw] text-xs text-neutral-500'>
        <p className='truncate font-medium text-neutral-700'>
          {view.name || 'Table'}
          {view.arena ? (
            <span className='ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200'>
              🔒 Agent Arena
            </span>
          ) : null}
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
