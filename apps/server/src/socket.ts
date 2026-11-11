import type { Server as HttpServer } from 'node:http';

import { parse as parseCookie } from 'cookie';
import { Server } from 'socket.io';

import { SESSION_COOKIE, SESSION_COOKIE_ALIAS, getSession } from './auth.js';
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
import { setBotMeta } from './bots.js';
import { onArenaState } from './arena/lobby.js';
import { setArenaRuntime } from './arena/runtime.js';
import { handleAct, resendTurnTo, type ActPayload } from './arena/turns.js';
import { setArenaStateListener } from './game-store.js';
import { isValidEntropy, setEntropyCollector } from './fairness.js';
import type { NlhePublicView } from './poker-bridge.js';

type ServerToClient = {
  'game:state': (view: NlhePublicView) => void;
  'game:error': (payload: { error: string }) => void;
  'game:ended': (view: NlhePublicView) => void;
  'game:entropyRequest': (payload: { gameId: string; handId: string }) => void;
  // Agent Arena (INTERFACES.md §5)
  'arena:seated': (payload: { gameId: string }) => void;
  'arena:turn': (payload: Record<string, unknown>) => void;
  'arena:rejected': (payload: Record<string, unknown>) => void;
  'arena:accepted': (payload: Record<string, unknown>) => void;
  'arena:timeout': (payload: Record<string, unknown>) => void;
  'arena:left': (payload: { gameId: string }) => void;
  'arena:closed': (payload: { gameId: string }) => void;
  'arena:queued': (payload: { position: number }) => void;
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
  'game:entropy': (payload: {
    gameId: string;
    handId: string;
    entropy: string;
  }) => void;
  /** Agent Arena move with a NEAR AI Cloud TEE receipt (INTERFACES §5.3). */
  'arena:act': (payload: ActPayload) => void;
  /** Bot sessions only: publish persona/model/attestation/lastLine (INTERFACES §4). */
  'bot:meta': (payload: { gameId: string; meta: Record<string, unknown> }) => void;
};

/** Open entropy windows, keyed `${gameId}:${handId}` (one per starting hand). */
type PendingEntropy = {
  waitingFor: Set<string>;
  got: Record<string, string>;
  finish: () => void;
};
const pendingEntropy = new Map<string, PendingEntropy>();

export async function broadcastGame(io: Server, gameId: string) {
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
      // `nli_session` is accepted as an alias (INTERFACES §5.1 agent clients).
      const sessionId = cookies[SESSION_COOKIE] ?? cookies[SESSION_COOKIE_ALIAS];
      const session = await getSession(sessionId);
      if (!session) {
        // Spectator: may watch rooms (sees no hole cards until showdown), cannot act.
        socket.data.sessionId = undefined;
        socket.data.nickname = 'spectator';
        next();
        return;
      }
      socket.data.sessionId = session.sessionId;
      socket.data.nickname = session.nickname;
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  // Agent Arena: emit helpers + run the turn engine / hand loop after every arena save.
  setArenaRuntime(io as unknown as Server, (gameId) => broadcastGame(io as unknown as Server, gameId));
  setArenaStateListener(onArenaState);

  // Provably-fair entropy (INTERFACES.md §1 step 3): ask the room, accept one
  // 16-byte hex value per seated player, resolve when all connected seated
  // players answered or after the timeout (missing → zeros, done by caller).
  setEntropyCollector(({ gameId, handId, playerIds, timeoutMs }) => {
    const roomName = `game:${gameId}`;
    const room = io.sockets.adapter.rooms.get(roomName);
    const connected = new Set<string>();
    for (const socketId of room ?? []) {
      const sid = io.sockets.sockets.get(socketId)?.data.sessionId as
        | string
        | undefined;
      if (sid && playerIds.includes(sid)) connected.add(sid);
    }
    if (connected.size === 0) return Promise.resolve({});
    const key = `${gameId}:${handId}`;
    return new Promise<Record<string, string>>((resolve) => {
      const entry: PendingEntropy = {
        waitingFor: connected,
        got: {},
        finish: () => {
          clearTimeout(timer);
          pendingEntropy.delete(key);
          resolve(entry.got);
        },
      };
      const timer = setTimeout(entry.finish, timeoutMs);
      pendingEntropy.set(key, entry);
      io.to(roomName).emit('game:entropyRequest', { gameId, handId });
    });
  });

  io.on('connection', (socket) => {
    const playerId = socket.data.sessionId as string;

    const run = async (
      gameId: string,
      fn: () => Promise<unknown>
    ) => {
      try {
        if (!playerId) throw new Error('NotAuthenticated');
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
      // An agent that (re)joins mid-turn gets its pending arena:turn again.
      resendTurnTo(gameId, playerId);
    });

    socket.on('arena:act', (payload) => {
      void handleAct(socket, payload).catch((error) =>
        socket.emit('arena:rejected', {
          reason: 'InternalError',
          detail: error instanceof Error ? error.message : String(error),
        })
      );
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

    socket.on('game:entropy', (payload) => {
      if (!playerId || !payload || typeof payload !== 'object') return;
      const { gameId, handId, entropy } = payload;
      const entry = pendingEntropy.get(`${gameId}:${handId}`);
      if (!entry) return; // window closed or unknown hand
      if (!entry.waitingFor.has(playerId) || entry.got[playerId]) return;
      if (!isValidEntropy(entropy)) {
        socket.emit('game:error', { error: 'InvalidEntropy' });
        return;
      }
      entry.got[playerId] = entropy.toLowerCase();
      if (Object.keys(entry.got).length >= entry.waitingFor.size) entry.finish();
    });

    socket.on('bot:meta', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const gameId = typeof payload.gameId === 'string' ? payload.gameId : '';
      if (!gameId) return;
      // Cap payload size before parsing fields (lastLine ≤ 280 chars etc. in bots.ts).
      if (JSON.stringify(payload.meta ?? null).length > 2048) {
        socket.emit('game:error', { error: 'InvalidBotMeta: too large' });
        return;
      }
      void run(gameId, () => setBotMeta(playerId, payload.meta));
    });

    socket.on('game:declareWinner', ({ gameId }) =>
      run(gameId, () => actionDeclareWinner(gameId, playerId))
    );
  });

  return io;
}
