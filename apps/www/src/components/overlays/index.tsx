'use client';

import React from 'react';

import type { PublicGameView } from '~/lib/api';

import { ShuffleOverlay } from './shuffle';
import { WaitingOverlay } from './waiting';

interface GameOverlayProps {
  gameId: string;
  view: PublicGameView;
}

export const GameOverlay = ({ gameId, view }: GameOverlayProps) => {
  if (view.status === 'waiting' || !view.gameStarted) {
    return <WaitingOverlay gameId={gameId} view={view} />;
  }
  if (view.gameEnded || view.status === 'ended') {
    return <WaitingOverlay gameId={gameId} view={view} nextHand />;
  }
  if (
    view.status === 'shuffling' &&
    view.totalShuffles !== view.totalPlayers
  ) {
    return <ShuffleOverlay gameId={gameId} view={view} />;
  }
  return null;
};
