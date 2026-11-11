import { Router } from 'express';

import { SESSION_COOKIE, getSession } from './auth.js';
import {
  clearAdminCookie,
  isAdminRequest,
  requireAdmin,
  setAdminCookie,
  verifyAdminPassword,
} from './admin.js';
import {
  createEmptyLobby,
  getGameEvents,
  getPublicState,
  joinExistingGame,
  listGames,
} from './game-store.js';

export const gamesRouter = Router();

async function requireSession(req: {
  cookies?: Record<string, string>;
}) {
  const session = await getSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) {
    throw new Error('NotAuthenticated');
  }
  return session;
}

gamesRouter.get('/', async (req, res) => {
  try {
    const statusParam = req.query.status;
    const includeEnded =
      req.query.includeEnded === '1' || req.query.includeEnded === 'true';

    let status: string | string[] | undefined;
    if (typeof statusParam === 'string' && statusParam.length > 0) {
      status = statusParam.includes(',')
        ? statusParam.split(',').map((s) => s.trim())
        : statusParam;
    }

    const games = await listGames({ status, includeEnded });
    res.json({ games });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

gamesRouter.get('/:id', async (req, res) => {
  try {
    const session = await getSession(req.cookies?.[SESSION_COOKIE]);
    const view = await getPublicState(
      req.params.id,
      session?.sessionId ?? null
    );
    if (!view) {
      res.status(404).json({ error: 'GameNotFound' });
      return;
    }
    res.json(view);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

gamesRouter.get('/:id/events', async (req, res) => {
  try {
    const events = await getGameEvents(req.params.id);
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** Admin-only: create an empty waiting lobby. */
gamesRouter.post('/', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const minChips = Number(req.body?.minChips ?? 0);
    const maxPlayers = Number(req.body?.maxPlayers ?? 6);
    const state = await createEmptyLobby({ name, minChips, maxPlayers });
    const view = await getPublicState(state.gameId, null);
    res.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

gamesRouter.post('/:id/join', async (req, res) => {
  try {
    const session = await requireSession(req);
    const state = await joinExistingGame(req.params.id, {
      id: session.sessionId,
      nickname: session.nickname,
      chips: session.chips ?? 0,
    });
    const view = await getPublicState(state.gameId, session.sessionId);
    res.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === 'NotAuthenticated'
        ? 401
        : message === 'GameNotFound'
          ? 404
          : 400;
    res.status(status).json({ error: message });
  }
});

export const adminRouter = Router();

adminRouter.post('/login', (req, res) => {
  const password = String(req.body?.password ?? '');
  if (!verifyAdminPassword(password)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  setAdminCookie(res);
  res.json({ ok: true, admin: true });
});

adminRouter.post('/logout', (_req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

adminRouter.get('/me', (req, res) => {
  res.json({ admin: isAdminRequest(req) });
});
