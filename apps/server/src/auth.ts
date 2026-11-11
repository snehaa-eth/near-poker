import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { PlayerActivityModel, SessionModel } from './db.js';

export const SESSION_COOKIE = 'poker_session';

const AVATAR_RE = /^\/png\/[a-z0-9_]+\.png$/i;

export async function getSession(sessionId: string | undefined) {
  if (!sessionId) return null;
  return SessionModel.findOne({ sessionId }).lean();
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  };
}

function toSessionJson(session: {
  sessionId: string;
  nickname: string;
  chips?: number | null;
  walletAddress?: string | null;
  avatar?: string | null;
}) {
  return {
    sessionId: session.sessionId,
    nickname: session.nickname,
    chips: session.chips ?? 0,
    walletAddress: session.walletAddress ?? null,
    avatar: session.avatar ?? null,
  };
}

function normalizeNickname(raw: unknown) {
  return String(raw ?? '').trim();
}

function parseAvatar(
  raw: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const avatar = String(raw).trim();
  if (!AVATAR_RE.test(avatar)) return { ok: false };
  return { ok: true, value: avatar };
}

function normalizeWallet(raw: unknown) {
  const wallet = String(raw ?? '').trim();
  return wallet.length >= 8 ? wallet : null;
}

export const authRouter = Router();

authRouter.post('/nickname', async (req, res) => {
  const nickname = normalizeNickname(req.body?.nickname);
  if (nickname.length < 2 || nickname.length > 24) {
    res.status(400).json({ error: 'Nickname must be 2-24 characters.' });
    return;
  }

  const existingId = req.cookies?.[SESSION_COOKIE] as string | undefined;
  let session = existingId
    ? await SessionModel.findOne({ sessionId: existingId })
    : null;

  if (session) {
    session.nickname = nickname;
    await session.save();
  } else {
    const sessionId = uuidv4();
    session = await SessionModel.create({
      sessionId,
      nickname,
      chips: 0,
    });
    res.cookie(SESSION_COOKIE, sessionId, sessionCookieOptions());
  }

  res.json(toSessionJson(session));
});

/**
 * Upsert profile keyed by Midnight wallet address.
 * Body: { walletAddress, nickname?, avatar? }
 */
authRouter.post('/profile', async (req, res) => {
  const walletAddress = normalizeWallet(req.body?.walletAddress);
  if (!walletAddress) {
    res.status(400).json({ error: 'walletAddress is required.' });
    return;
  }

  const nicknameRaw = req.body?.nickname;
  const nickname =
    nicknameRaw === undefined || nicknameRaw === null
      ? null
      : normalizeNickname(nicknameRaw);
  if (nickname !== null && (nickname.length < 2 || nickname.length > 24)) {
    res.status(400).json({ error: 'Username must be 2-24 characters.' });
    return;
  }

  let avatarUpdate: string | null | undefined;
  if (req.body?.avatar !== undefined) {
    const parsed = parseAvatar(req.body.avatar);
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid avatar path.' });
      return;
    }
    avatarUpdate = parsed.value;
  }

  const cookieId = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const byWallet = await SessionModel.findOne({ walletAddress });
  const byCookie = cookieId
    ? await SessionModel.findOne({ sessionId: cookieId })
    : null;

  let session = byWallet;

  if (!session && byCookie) {
    // Link cookie session to this wallet if it isn't already claimed.
    if (!byCookie.walletAddress || byCookie.walletAddress === walletAddress) {
      byCookie.walletAddress = walletAddress;
      session = byCookie;
    }
  }

  if (!session) {
    const sessionId = uuidv4();
    session = await SessionModel.create({
      sessionId,
      walletAddress,
      nickname:
        nickname ??
        `mn_${walletAddress.replace(/[^a-zA-Z0-9]/g, '').slice(-6)}`.slice(
          0,
          24
        ),
      avatar: avatarUpdate ?? null,
      chips: 0,
    });
  } else {
    if (nickname !== null) session.nickname = nickname;
    if (avatarUpdate !== undefined) session.avatar = avatarUpdate;
    if (!session.walletAddress) session.walletAddress = walletAddress;
    await session.save();
  }

  res.cookie(SESSION_COOKIE, session.sessionId, sessionCookieOptions());
  res.json(toSessionJson(session));
});

authRouter.get('/me', async (req, res) => {
  const session = await getSession(
    req.cookies?.[SESSION_COOKIE] as string | undefined
  );
  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json(toSessionJson(session));
});

/**
 * Paginated player activity from MongoDB (deposits, withdrawals, games).
 * Query: page (1-based), limit (default 10, max 50), category (optional)
 */
authRouter.get('/activity', async (req, res) => {
  const session = await getSession(
    req.cookies?.[SESSION_COOKIE] as string | undefined
  );
  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const limit = Math.min(
    50,
    Math.max(1, Math.floor(Number(req.query.limit) || 10))
  );
  const categoryRaw = String(req.query.category ?? '').trim();
  const category =
    categoryRaw === 'deposit' ||
    categoryRaw === 'withdraw' ||
    categoryRaw === 'game'
      ? categoryRaw
      : null;

  const identity: Record<string, unknown>[] = [
    { sessionId: session.sessionId },
  ];
  if (session.walletAddress) {
    identity.push({ walletAddress: session.walletAddress });
  }

  const filter: Record<string, unknown> = {
    $or: identity,
  };
  if (category) filter.category = category;

  const skip = (page - 1) * limit;
  const [total, docs] = await Promise.all([
    PlayerActivityModel.countDocuments(filter),
    PlayerActivityModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  res.json({
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
    events: docs.map((doc) => ({
      id: String(doc._id),
      sessionId: doc.sessionId,
      walletAddress: doc.walletAddress ?? null,
      category: doc.category,
      type: doc.type,
      gameId: doc.gameId ?? null,
      amountChips: doc.amountChips ?? null,
      amountNight: doc.amountNight ?? null,
      balanceAfter: doc.balanceAfter ?? null,
      summary: doc.summary,
      payload: doc.payload ?? {},
      createdAt: doc.createdAt
        ? new Date(doc.createdAt).toISOString()
        : null,
    })),
  });
});
