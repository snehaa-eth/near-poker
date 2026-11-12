/**
 * Scheduled Agent Arena events (INTERFACES.md §5.6).
 *
 *   POST /admin/events               (admin)   create {name, startsAt, durationMin?, maxAgents?, description?, prize?, eventId?}
 *   GET  /events                               {events:[…]} live + upcoming + recently ended
 *   GET  /events/:id                           detail + registrations + live tables + event leaderboard
 *   POST /events/:id/register        (agent)   body {model?}; NEAR session + min chips; until startsAt
 *   POST /events/:id/unregister      (agent)
 *
 * A 5 s scheduler (startEventScheduler) reads events from Mongo, so it survives restarts:
 * scheduled → live at startsAt (registered agents that are queued / connected / playing go to
 * dedicated event tables), live → ended at startsAt + durationMin (no new hands; tables finish
 * the current hand and close), then the final leaderboard is frozen once its tables are closed.
 */
import { Router, type Response } from 'express';

import { requireAdmin } from '../admin.js';
import { SESSION_COOKIE, getSession } from '../auth.js';
import { ArenaEventModel, SessionModel, type ArenaEventDoc } from '../db.js';
import { getAttestationCache } from './attestation.js';
import { getArenaConfig } from './config.js';
import {
  ArenaError,
  currentChips,
  endEventTables,
  eventTableIds,
  isEventLiveInLobby,
  listArenaTables,
  setLiveEvent,
  startEventTables,
} from './lobby.js';
import { arenaLeaderboard } from './routes.js';
import { errMsg } from './runtime.js';

export const DEFAULT_EVENT_DURATION_MIN = 30;
export const DEFAULT_EVENT_MAX_AGENTS = 24;
const RECENT_MS = 7 * 24 * 3600_000;

// ─── create / read ──────────────────────────────────────────────────────────

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function intIn(v: unknown, fallback: number, min: number, max: number, field: string) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ArenaError(400, `Bad${field}: integer ${min}..${max}`);
  return n;
}

export async function createEvent(body: Record<string, unknown>, now = Date.now()) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 3 || name.length > 80) throw new ArenaError(400, 'BadName: 3..80 characters');
  const startsAt = new Date(typeof body.startsAt === 'string' || typeof body.startsAt === 'number' ? body.startsAt : NaN);
  if (Number.isNaN(startsAt.getTime())) throw new ArenaError(400, 'BadStartsAt: ISO date');
  if (startsAt.getTime() < now - 60_000) throw new ArenaError(400, 'BadStartsAt: in the past');
  const durationMin = intIn(body.durationMin, DEFAULT_EVENT_DURATION_MIN, 1, 24 * 60, 'DurationMin');
  const maxAgents = intIn(body.maxAgents, DEFAULT_EVENT_MAX_AGENTS, 2, 600, 'MaxAgents');
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '';
  const prize = typeof body.prize === 'string' && body.prize.trim() ? body.prize.trim().slice(0, 200) : null;
  let eventId = slugify(typeof body.eventId === 'string' && body.eventId.trim() ? body.eventId : name);
  if (eventId.length < 2) throw new ArenaError(400, 'BadEventId');
  if (await ArenaEventModel.exists({ eventId })) {
    if (typeof body.eventId === 'string' && body.eventId.trim()) throw new ArenaError(409, 'EventIdTaken');
    const base = eventId;
    for (let i = 2; await ArenaEventModel.exists({ eventId }); i += 1) eventId = `${base}-${i}`;
  }
  const doc = await ArenaEventModel.create({
    eventId,
    name,
    description,
    prize,
    startsAt,
    durationMin,
    maxAgents,
    status: 'scheduled',
    registrations: [],
    gameIds: [],
  });
  return publicEvent(doc.toObject() as ArenaEventDoc);
}

const endsAtOf = (e: Pick<ArenaEventDoc, 'startsAt' | 'durationMin'>) =>
  new Date(new Date(e.startsAt).getTime() + e.durationMin * 60_000);

/** Public shape (no session ids). */
export function publicEvent(e: ArenaEventDoc) {
  return {
    eventId: e.eventId,
    name: e.name,
    description: e.description ?? '',
    prize: e.prize ?? null,
    startsAt: new Date(e.startsAt).toISOString(),
    endsAt: endsAtOf(e).toISOString(),
    durationMin: e.durationMin,
    maxAgents: e.maxAgents,
    status: e.status,
    registered: e.registrations?.length ?? 0,
    startedAt: e.startedAt ? new Date(e.startedAt).toISOString() : null,
    endedAt: e.endedAt ? new Date(e.endedAt).toISOString() : null,
  };
}

export async function listEvents(now = Date.now()) {
  const docs = await ArenaEventModel.find({
    $or: [{ status: { $in: ['scheduled', 'live'] } }, { endedAt: { $gte: new Date(now - RECENT_MS) } }],
  })
    .select('-registrations.sessionId')
    .lean();
  const order = { live: 0, scheduled: 1, ended: 2 } as const;
  return docs
    .map((d) => publicEvent(d as ArenaEventDoc))
    .sort((a, b) =>
      order[a.status] - order[b.status] ||
      (a.status === 'ended'
        ? Date.parse(b.startsAt) - Date.parse(a.startsAt)
        : Date.parse(a.startsAt) - Date.parse(b.startsAt))
    )
    .slice(0, 50);
}

export async function eventLeaderboard(e: ArenaEventDoc) {
  if (e.finalLeaderboard) return e.finalLeaderboard;
  if (e.status === 'scheduled' || (e.gameIds ?? []).length === 0) return [];
  const entries = await arenaLeaderboard(200, {
    gameIds: e.gameIds,
    from: new Date(e.startedAt ?? e.startsAt),
    to: e.endedAt ? new Date(e.endedAt) : null,
  });
  const models = new Map(e.registrations.map((r) => [r.walletAddress, r.model]));
  return entries.map((x) => ({ ...x, model: x.model === 'unknown' ? models.get(x.walletAddress) ?? 'unknown' : x.model }));
}

export async function getEventDetail(eventId: string) {
  const e = await ArenaEventModel.findOne({ eventId }).lean<ArenaEventDoc>();
  if (!e) return null;
  const live = new Set(eventTableIds(e.eventId));
  const tables = live.size > 0 ? (await listArenaTables()).filter((t) => live.has(t.gameId)) : [];
  return {
    ...publicEvent(e),
    registrations: [...(e.registrations ?? [])]
      .sort((a, b) => new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime())
      .map((r) => ({
        walletAddress: r.walletAddress,
        nickname: r.nickname,
        model: r.model,
        registeredAt: new Date(r.registeredAt).toISOString(),
      })),
    gameIds: e.gameIds ?? [],
    tables,
    leaderboard: await eventLeaderboard(e),
    final: Boolean(e.finalLeaderboard),
  };
}

// ─── registration ───────────────────────────────────────────────────────────

type SessionLike = { sessionId: string; nickname: string; walletAddress?: string | null; chips?: number | null };

export async function registerForEvent(eventId: string, session: SessionLike, body: { model?: unknown } = {}, now = Date.now()) {
  if (!session.walletAddress) throw new ArenaError(403, 'NearAccountRequired: log in with NEP-413 (POST /auth/profile)');
  const e = await ArenaEventModel.findOne({ eventId }).lean<ArenaEventDoc>();
  if (!e) throw new ArenaError(404, 'EventNotFound');
  if (e.status !== 'scheduled' || new Date(e.startsAt).getTime() <= now) {
    throw new ArenaError(409, 'RegistrationClosed: registration is open until the event starts');
  }
  const existing = e.registrations.find((r) => r.walletAddress === session.walletAddress);
  let model: string | null = existing?.model ?? null;
  if (body.model !== undefined && body.model !== null && body.model !== '') {
    if (typeof body.model !== 'string' || body.model.length > 128) throw new ArenaError(400, 'BadModel');
    model = body.model;
    if (getArenaConfig().nearaiApiKey) {
      const { signers, error } = await getAttestationCache().getSigners(model);
      if (signers.length === 0) {
        throw new ArenaError(
          400,
          error ? `AttestationUnavailable: ${error}` : `ModelNotAttested: ${model} has no model attestation`
        );
      }
    }
  }
  const minChips = getArenaConfig().minChips;
  const chips = await currentChips(session);
  if (chips < minChips) throw new ArenaError(400, `InsufficientChips: need ${minChips} chips in the vault, have ${chips}`);

  if (existing) {
    await ArenaEventModel.updateOne(
      { eventId, 'registrations.walletAddress': session.walletAddress },
      { $set: { 'registrations.$.model': model, 'registrations.$.nickname': session.nickname, 'registrations.$.sessionId': session.sessionId } }
    );
    return { registered: true as const, eventId, already: true };
  }
  const r = await ArenaEventModel.updateOne(
    {
      eventId,
      status: 'scheduled',
      'registrations.walletAddress': { $ne: session.walletAddress },
      [`registrations.${e.maxAgents - 1}`]: { $exists: false },
    },
    {
      $push: {
        registrations: {
          sessionId: session.sessionId,
          walletAddress: session.walletAddress,
          nickname: session.nickname,
          model,
          registeredAt: new Date(now),
        },
      },
    }
  );
  if (r.modifiedCount === 0) {
    const again = await ArenaEventModel.findOne({ eventId }).lean<ArenaEventDoc>();
    if (again?.registrations.some((x) => x.walletAddress === session.walletAddress)) return { registered: true as const, eventId, already: true };
    if (again && again.status !== 'scheduled') throw new ArenaError(409, 'RegistrationClosed');
    throw new ArenaError(409, `EventFull: ${e.maxAgents} agents max`);
  }
  return { registered: true as const, eventId, already: false };
}

export async function unregisterFromEvent(eventId: string, session: SessionLike) {
  if (!session.walletAddress) throw new ArenaError(403, 'NearAccountRequired');
  const e = await ArenaEventModel.findOne({ eventId }).select('status').lean();
  if (!e) throw new ArenaError(404, 'EventNotFound');
  if (e.status !== 'scheduled') throw new ArenaError(409, 'RegistrationClosed: the event already started');
  const r = await ArenaEventModel.updateOne(
    { eventId, status: 'scheduled' },
    { $pull: { registrations: { walletAddress: session.walletAddress } } }
  );
  return { registered: false as const, eventId, removed: r.modifiedCount > 0 };
}

// ─── scheduler ──────────────────────────────────────────────────────────────

async function goLive(e: ArenaEventDoc) {
  const r = await ArenaEventModel.updateOne(
    { eventId: e.eventId, status: 'scheduled' },
    { $set: { status: 'live', startedAt: new Date() } }
  );
  if (r.modifiedCount === 0) return;
  const wallets = e.registrations.map((x) => x.walletAddress);
  const sessions = await SessionModel.find({ walletAddress: { $in: wallets } })
    .select('sessionId walletAddress nickname chips')
    .lean();
  const byWallet = new Map(sessions.map((s) => [s.walletAddress!, s]));
  const entrants = e.registrations.flatMap((reg) => {
    const s = byWallet.get(reg.walletAddress);
    if (!s) return [];
    return [{ sessionId: s.sessionId, nickname: s.nickname, walletAddress: reg.walletAddress, model: reg.model ?? null, chips: s.chips ?? 0 }];
  });
  console.log(`[events] ${e.eventId} is live (${entrants.length} registered)`);
  await startEventTables(e.eventId, e.name, entrants);
}

async function finish(e: ArenaEventDoc) {
  const r = await ArenaEventModel.updateOne(
    { eventId: e.eventId, status: 'live' },
    { $set: { status: 'ended', endedAt: new Date() } }
  );
  if (r.modifiedCount > 0) console.log(`[events] ${e.eventId} ended`);
  await endEventTables(e.eventId);
}

async function freezeIfDone(e: ArenaEventDoc) {
  if (eventTableIds(e.eventId).length > 0) return; // tables still finishing their last hand
  const entries = await eventLeaderboard({ ...e, finalLeaderboard: null });
  await ArenaEventModel.updateOne(
    { eventId: e.eventId, finalLeaderboard: null },
    { $set: { finalLeaderboard: entries, finalizedAt: new Date() } }
  );
  console.log(`[events] ${e.eventId} final standings frozen (${entries.length} agents)`);
}

let ticking = false;

/** One scheduler pass (exported for tests). */
export async function tickEvents(now = Date.now()) {
  if (ticking) return;
  ticking = true;
  try {
    const docs = await ArenaEventModel.find({
      $or: [{ status: { $in: ['scheduled', 'live'] } }, { status: 'ended', finalLeaderboard: null }],
    }).lean<ArenaEventDoc[]>();
    for (const e of docs) {
      try {
        const start = new Date(e.startsAt).getTime();
        const end = endsAtOf(e).getTime();
        if (e.status === 'scheduled' && start <= now) {
          await goLive(e);
          if (end <= now) await finish({ ...e, status: 'live' });
        } else if (e.status === 'live') {
          if (end <= now) await finish(e);
          else if (!isEventLiveInLobby(e.eventId)) {
            // After a restart: route registered agents' /arena/join to event tables again.
            setLiveEvent(e.eventId, e.name, e.registrations.map((x) => x.walletAddress));
          }
        } else if (e.status === 'ended') {
          await freezeIfDone(e);
        }
      } catch (err) {
        console.error(`[events] ${e.eventId} tick failed: ${errMsg(err)}`);
      }
    }
  } finally {
    ticking = false;
  }
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startEventScheduler(intervalMs = Number(process.env.ARENA_EVENT_TICK_MS ?? 5000)) {
  stopEventScheduler();
  const ms = Number.isFinite(intervalMs) && intervalMs >= 100 ? intervalMs : 5000;
  void tickEvents().catch((e) => console.error('[events] tick failed', e));
  schedulerTimer = setInterval(() => void tickEvents().catch((e) => console.error('[events] tick failed', e)), ms);
  schedulerTimer.unref?.();
}

export function stopEventScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

// ─── routes ─────────────────────────────────────────────────────────────────

function sendError(res: Response, e: unknown) {
  if (e instanceof ArenaError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  res.status(500).json({ error: errMsg(e) });
}

async function requireSession(req: { cookies?: Record<string, string> }) {
  const s = await getSession(req.cookies?.[SESSION_COOKIE]);
  if (!s) throw new ArenaError(401, 'NotAuthenticated');
  return s;
}

export const eventsRouter = Router();

eventsRouter.get('/', async (_req, res) => {
  try {
    res.json({ events: await listEvents() });
  } catch (e) {
    sendError(res, e);
  }
});

eventsRouter.get('/:id', async (req, res) => {
  try {
    const detail = await getEventDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'EventNotFound' });
      return;
    }
    const session = await getSession(req.cookies?.[SESSION_COOKIE]);
    const me = session?.walletAddress
      ? { registered: detail.registrations.some((r) => r.walletAddress === session.walletAddress) }
      : undefined;
    res.json({ ...detail, ...(me ? { me } : {}) });
  } catch (e) {
    sendError(res, e);
  }
});

eventsRouter.post('/:id/register', async (req, res) => {
  try {
    const session = await requireSession(req);
    res.json(await registerForEvent(req.params.id, session, { model: req.body?.model }));
  } catch (e) {
    sendError(res, e);
  }
});

eventsRouter.post('/:id/unregister', async (req, res) => {
  try {
    const session = await requireSession(req);
    res.json(await unregisterFromEvent(req.params.id, session));
  } catch (e) {
    sendError(res, e);
  }
});

/** Mounted at /admin/events. */
export const adminEventsRouter = Router();

adminEventsRouter.post('/', requireAdmin, async (req, res) => {
  try {
    const event = await createEvent((req.body ?? {}) as Record<string, unknown>);
    res.status(201).json({ event, url: `/events/${event.eventId}` });
  } catch (e) {
    sendError(res, e);
  }
});
