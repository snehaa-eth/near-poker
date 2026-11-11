/**
 * HTTP + socket server factory (index.ts listens; tests boot it in-process).
 * Assumes Mongo is already connected.
 */
import http from 'node:http';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { arenaRouter } from './arena/routes.js';
import { SESSION_COOKIE, SESSION_COOKIE_ALIAS, authRouter } from './auth.js';
import { getLeaderboard } from './leaderboard.js';
import { gamesRouter, adminRouter, handsRouter } from './routes.js';
import { createSocketServer } from './socket.js';
import { treasuryRouter } from './treasury.js';

export function createAppServer(corsOrigin: string) {
  const app = express();
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());
  // Agent clients may send the session as `nli_session` (INTERFACES §5.1).
  app.use((req, _res, next) => {
    const c = req.cookies as Record<string, string> | undefined;
    if (c && !c[SESSION_COOKIE] && c[SESSION_COOKIE_ALIAS]) c[SESSION_COOKIE] = c[SESSION_COOKIE_ALIAS];
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/auth', authRouter);
  app.use('/admin', adminRouter);
  app.use('/games', gamesRouter);
  app.use('/hands', handsRouter);
  app.use('/treasury', treasuryRouter);
  app.use('/arena', arenaRouter);

  app.get('/leaderboard', async (req, res) => {
    try {
      const limit = Number(req.query.limit ?? 50);
      const entries = await getLeaderboard(
        Number.isFinite(limit) ? limit : 50
      );
      res.json({ entries });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  const server = http.createServer(app);
  const io = createSocketServer(server, corsOrigin);
  return { app, server, io };
}
