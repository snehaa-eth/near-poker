/**
 * /arena routes (INTERFACES.md §5.2, §5.4).
 *   POST /arena/join   (session) body {model?} → {queued:true, position} | {gameId}
 *   POST /arena/leave  (session)              → leaves queue, or the table after the current hand
 *   GET  /arena/tables                        → {tables:[{gameId, seats, handsPlayed, status, …}]}
 *   GET  /arena/leaderboard                   → {entries:[{walletAddress, nickname, model, hands, netChips, movesVerified, lastSeen}]}
 *   GET  /arena/moves/:handId                 → {moves:[…accepted TEE moves…]}
 */
import { Router, type Response } from 'express';

import { SESSION_COOKIE, getSession } from '../auth.js';
import { GameModel, HandModel, SessionModel } from '../db.js';
import { getArenaConfig } from './config.js';
import { ArenaError, arenaSeatOf, joinArena, leaveArena, listArenaTables, queueSnapshot } from './lobby.js';
import { ArenaMoveModel, listMovesForHand } from './moves.js';

export const arenaRouter = Router();

function sendError(res: Response, e: unknown) {
  if (e instanceof ArenaError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  res.status(msg === 'NotAuthenticated' ? 401 : 500).json({ error: msg });
}

async function requireSession(req: { cookies?: Record<string, string> }) {
  const s = await getSession(req.cookies?.[SESSION_COOKIE]);
  if (!s) throw new ArenaError(401, 'NotAuthenticated');
  return s;
}

arenaRouter.post('/join', async (req, res) => {
  try {
    const session = await requireSession(req);
    res.json(await joinArena(session, { model: req.body?.model }));
  } catch (e) {
    sendError(res, e);
  }
});

arenaRouter.post('/leave', async (req, res) => {
  try {
    const session = await requireSession(req);
    res.json(await leaveArena(session.sessionId));
  } catch (e) {
    sendError(res, e);
  }
});

arenaRouter.get('/status', async (req, res) => {
  try {
    const cfg = getArenaConfig();
    const session = await getSession(req.cookies?.[SESSION_COOKIE]);
    res.json({
      enabled: Boolean(cfg.nearaiApiKey),
      minAgents: cfg.minAgents,
      minChips: cfg.minChips,
      turnMs: cfg.turnMs,
      handGapMs: cfg.handGapMs,
      queue: queueSnapshot(),
      ...(session ? { me: { gameId: arenaSeatOf(session.sessionId) } } : {}),
    });
  } catch (e) {
    sendError(res, e);
  }
});

arenaRouter.get('/tables', async (_req, res) => {
  try {
    res.json({ tables: await listArenaTables() });
  } catch (e) {
    sendError(res, e);
  }
});

arenaRouter.get('/moves/:handId', async (req, res) => {
  try {
    res.json({ handId: req.params.handId, moves: await listMovesForHand(req.params.handId) });
  } catch (e) {
    sendError(res, e);
  }
});

/** Hands / moves window for an event leaderboard (INTERFACES §5.6). */
export type LeaderboardScope = { gameIds: string[]; from?: Date; to?: Date | null };

export async function arenaLeaderboard(limit = 100, scope?: LeaderboardScope) {
  const gameIds = scope
    ? scope.gameIds
    : (await GameModel.find({ arena: true }).select('gameId').lean()).map((g) => g.gameId);
  const created: Record<string, Date> = {};
  if (scope?.from) created.$gte = scope.from;
  if (scope?.to) created.$lt = scope.to;
  const timeFilter = Object.keys(created).length > 0 ? created : null;
  type Row = {
    sessionId: string;
    walletAddress: string;
    nickname: string;
    model: string;
    hands: number;
    netChips: number;
    movesVerified: number;
    lastSeen: number;
  };
  const rows = new Map<string, Row>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { sessionId: id, walletAddress: '', nickname: '', model: '', hands: 0, netChips: 0, movesVerified: 0, lastSeen: 0 };
      rows.set(id, r);
    }
    return r;
  };

  if (gameIds.length > 0) {
    const hands = await HandModel.find({
      gameId: { $in: gameIds },
      complete: true,
      ...(timeFilter ? { createdAt: timeFilter } : {}),
    })
      .select('seats deltas ledgerPlayers updatedAt')
      .lean();
    for (const h of hands) {
      const seats = (h.seats ?? []) as Array<{ playerId: string }>;
      seats.forEach((s, i) => {
        const r = row(s.playerId);
        const key = h.ledgerPlayers?.[i] ?? s.playerId;
        r.hands += 1;
        r.netChips += Number((h.deltas as Record<string, number>)?.[key] ?? 0);
        r.lastSeen = Math.max(r.lastSeen, h.updatedAt ? new Date(h.updatedAt).getTime() : 0);
      });
    }
  }

  const moveAgg = await ArenaMoveModel.aggregate<{ _id: string; n: number; last: Date; model: string }>([
    ...(scope ? [{ $match: { gameId: { $in: gameIds } } }] : []),
    { $sort: { verifiedAt: 1 } },
    { $group: { _id: '$playerId', n: { $sum: 1 }, last: { $max: '$verifiedAt' }, model: { $last: '$model' } } },
  ]);
  for (const m of moveAgg) {
    const r = row(m._id);
    r.movesVerified = m.n;
    r.model = m.model;
    r.lastSeen = Math.max(r.lastSeen, new Date(m.last).getTime());
  }

  const sessions = await SessionModel.find({ sessionId: { $in: [...rows.keys()] } })
    .select('sessionId walletAddress nickname')
    .lean();
  for (const s of sessions) {
    const r = rows.get(s.sessionId)!;
    r.walletAddress = s.walletAddress ?? '';
    r.nickname = s.nickname;
  }

  return [...rows.values()]
    .sort((a, b) => b.netChips - a.netChips || b.movesVerified - a.movesVerified)
    .slice(0, limit)
    .map((r, i) => ({
      rank: i + 1,
      walletAddress: r.walletAddress,
      nickname: r.nickname,
      model: r.model || 'unknown',
      hands: r.hands,
      netChips: r.netChips,
      movesVerified: r.movesVerified,
      lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
    }));
}

arenaRouter.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100) || 100));
    res.json({ entries: await arenaLeaderboard(limit) });
  } catch (e) {
    sendError(res, e);
  }
});
