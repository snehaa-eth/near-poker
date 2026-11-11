import type { Server as HttpServer } from 'node:http';

import { parse as parseCookie } from 'cookie';
import { Server } from 'socket.io';

import { SESSION_COOKIE, getSession } from './auth.js';
import {
  actionBet,
  actionChooseCards,
  actionDeclareWinner,
  actionFold,
  actionShuffle,
  actionStart,
  getGame,
  getPublicState,
} from './game-store.js';
import type { NlhePublicView } from './poker-bridge.js';

type ServerToClient = {
  'game:state': (view: NlhePublicView) => void;
  'game:error': (payload: { error: string }) => void;
  'game:ended': (view: NlhePublicView) => void;
};

type ClientToServer = {
  'game:joinRoom': (payload: { gameId: string }) => void;
  'game:start': (payload: { gameId: string }) => void;
  'game:shuffle': (payload: { gameId: string }) => void;
  'game:bet': (payload: { gameId: string; amount: number }) => void;
  'game:fold': (payload: { gameId: string }) => void;
  'game:chooseCards': (payload: {
    gameId: string;
    cards: [number, number, number];
  }) => void;
  'game:declareWinner': (payload: { gameId: string }) => void;
};

async function broadcastGame(io: Server, gameId: string) {
  const state = await getGame(gameId);
  if (!state) return;
  const room = io.sockets.adapter.rooms.get(`game:${gameId}`);
  if (!room) return;
  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const viewerId = (socket.data.sessionId as string | undefined) ?? null;
    const view = await getPublicState(gameId, viewerId);
    if (!view) continue;
    socket.emit('game:state', view);
    if (view.gameEnded) {
      socket.emit('game:ended', view);
    }
  }
}

export function createSocketServer(httpServer: HttpServer, origin: string) {
  const io = new Server<ClientToServer, ServerToClient>(httpServer, {
    cors: {
      origin,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const raw = socket.request.headers.cookie ?? '';
      const cookies = parseCookie(raw);
      const sessionId = cookies[SESSION_COOKIE];
      const session = await getSession(sessionId);
      if (!session) {
        next(new Error('NotAuthenticated'));
        return;
      }
      socket.data.sessionId = session.sessionId;
      socket.data.nickname = session.nickname;
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  io.on('connection', (socket) => {
    const playerId = socket.data.sessionId as string;

    const run = async (
      gameId: string,
      fn: () => Promise<unknown>
    ) => {
      try {
        await fn();
        await broadcastGame(io, gameId);
      } catch (error) {
        socket.emit('game:error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    socket.on('game:joinRoom', async ({ gameId }) => {
      socket.join(`game:${gameId}`);
      await broadcastGame(io, gameId);
    });

    socket.on('game:start', ({ gameId }) =>
      run(gameId, () => actionStart(gameId, playerId))
    );

    socket.on('game:shuffle', ({ gameId }) =>
      run(gameId, () => actionShuffle(gameId, playerId))
    );

    socket.on('game:bet', ({ gameId, amount }) =>
      run(gameId, () => actionBet(gameId, playerId, Number(amount)))
    );

    socket.on('game:fold', ({ gameId }) =>
      run(gameId, () => actionFold(gameId, playerId))
    );

    socket.on('game:chooseCards', ({ gameId, cards }) =>
      run(gameId, () => actionChooseCards(gameId, playerId, cards))
    );

    socket.on('game:declareWinner', ({ gameId }) =>
      run(gameId, () => actionDeclareWinner(gameId, playerId))
    );
  });

  return io;
}
