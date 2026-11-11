import http from 'node:http';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { authRouter } from './auth.js';
import { connectMongo } from './db.js';
import { hydrateGamesFromDb } from './game-store.js';
import { getLeaderboard } from './leaderboard.js';
import { gamesRouter, adminRouter, handsRouter } from './routes.js';
import { getLedger } from './ledger.js';
import { createSocketServer } from './socket.js';
import { treasuryRouter } from './treasury.js';

const PORT = Number(process.env.PORT ?? 4000);
const MONGODB_URI = process.env.MONGODB_URI ?? 'memory';
const MONGODB_DB = process.env.MONGODB_DB;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

async function main() {
  await connectMongo(MONGODB_URI, MONGODB_DB);
  await hydrateGamesFromDb();
  // Fail fast on a misconfigured CHAIN=near (bad env) instead of mid-hand.
  console.log(`[ledger] using ${getLedger().kind} ledger`);

  const app = express();
  app.use(
    cors({
      origin: CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/auth', authRouter);
  app.use('/admin', adminRouter);
  app.use('/games', gamesRouter);
  app.use('/hands', handsRouter);
  app.use('/treasury', treasuryRouter);

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
  createSocketServer(server, CORS_ORIGIN);

  server.listen(PORT, () => {
    console.log(`Poker server listening on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
