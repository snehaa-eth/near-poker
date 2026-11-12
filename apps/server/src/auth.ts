import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { randomBytes } from 'node:crypto';

import { syncChipsFromChain } from './chips.js';
import { PlayerActivityModel, SessionModel } from './db.js';
import {
  LOGIN_MESSAGE,
  LOGIN_RECIPIENT,
  isNearChain,
  parseNearProof,
  verifyNearProof,
  type AccessKeyChecker,
} from './near.js';

export const SESSION_COOKIE = 'poker_session';
/** Alias accepted from agent clients (INTERFACES §5.1 names the cookie `nli_session`). */
export const SESSION_COOKIE_ALIAS = 'nli_session';
export const NONCE_COOKIE = 'poker_login_nonce';
const NONCE_TTL_MS = 5 * 60 * 1000;

/** Server-issued NEP-413 login nonces (base64) → expiry. Single use. */
const issuedNonces = new Map<string, number>();
/** Client-generated nonces already used (legacy, CHAIN!=near only) → expiry. */
const usedClientNonces = new Map<string, number>();

function pruneNonces(now = Date.now()) {
  for (const m of [issuedNonces, usedClientNonces]) {
    for (const [k, exp] of m) if (exp <= now) m.delete(k);
  }
}

export function issueLoginNonce(now = Date.now()) {
  pruneNonces(now);
  const nonce = randomBytes(32).toString('base64');
  issuedNonces.set(nonce, now + NONCE_TTL_MS);
  return { nonce, expiresAt: now + NONCE_TTL_MS };
}

/**
 * Consume a login nonce. Server-issued nonces are accepted once within 5 min
 * (and must match the nonce cookie when the browser sent one). Client-made
 * nonces are accepted once, only when CHAIN!=near (legacy web build).
 */
export function consumeLoginNonce(
  nonce: string,
  opts: { cookieNonce?: string; near: boolean; now?: number }
): { ok: true } | { ok: false; reason: string } {
  const now = opts.now ?? Date.now();
  pruneNonces(now);
  if (Buffer.from(nonce, 'base64').length !== 32) return { ok: false, reason: 'BadNonce' };
  const exp = issuedNonces.get(nonce);
  if (exp !== undefined) {
    if (opts.cookieNonce && opts.cookieNonce !== nonce) {
      return { ok: false, reason: 'NonceCookieMismatch' };
    }
    issuedNonces.delete(nonce);
    return { ok: true };
  }
  if (opts.near) return { ok: false, reason: 'UnknownOrExpiredNonce' };
  if (usedClientNonces.has(nonce)) return { ok: false, reason: 'NonceReused' };
  usedClientNonces.set(nonce, now + NONCE_TTL_MS * 2);
  return { ok: true };
}

/** Test hook for the RPC access-key check. */
let accessKeyChecker: AccessKeyChecker | undefined;
export function setAccessKeyChecker(fn: AccessKeyChecker | undefined) {
  accessKeyChecker = fn;
}

/**
 * Local end-to-end test mode (e2e/): throwaway agent keys have no testnet account, so the
 * RPC full-access-key lookup is skipped. Only when CHAIN is NOT `near` AND ARENA_TEST_MODE=1;
 * the NEP-413 signature and nonce are still verified. Never active in near mode.
 */
export function isArenaTestMode(env: NodeJS.ProcessEnv = process.env) {
  return !isNearChain(env) && env.ARENA_TEST_MODE === '1';
}
const skipAccessKeyCheck: AccessKeyChecker = async () => true;

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

export function toSessionJson(session: {
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
  return wallet.length >= 2 && wallet.length <= 128 ? wallet : null;
}

export const authRouter = Router();

/** Fresh NEP-413 nonce for the wallet to sign (required when CHAIN=near). */
authRouter.get('/nonce', (_req, res) => {
  const { nonce, expiresAt } = issueLoginNonce();
  res.cookie(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: NONCE_TTL_MS,
  });
  res.json({ nonce, expiresAt, message: LOGIN_MESSAGE, recipient: LOGIN_RECIPIENT });
});

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
 * Upsert profile keyed by NEAR account id.
 * Body: { walletAddress, nickname?, avatar?, nearProof? }
 * `nearProof` is a NEP-413 signature of LOGIN_MESSAGE for LOGIN_RECIPIENT with a
 * nonce from GET /auth/nonce. Required when CHAIN=near; verified when present otherwise.
 */
authRouter.post('/profile', async (req, res) => {
  const walletAddress = normalizeWallet(req.body?.walletAddress);
  if (!walletAddress) {
    res.status(400).json({ error: 'walletAddress is required.' });
    return;
  }

  const near = isNearChain();
  const rawProof = req.body?.nearProof;
  if (near || rawProof != null) {
    const proof = parseNearProof(rawProof);
    if (!proof) {
      res.status(401).json({ error: near ? 'NearProofRequired' : 'InvalidNearProof' });
      return;
    }
    if (proof.accountId !== walletAddress) {
      res.status(401).json({ error: 'ProofAccountMismatch' });
      return;
    }
    const verified = await verifyNearProof(proof, {
      checkAccessKey: accessKeyChecker ?? (isArenaTestMode() ? skipAccessKeyCheck : undefined),
    });
    if (!verified.ok) {
      res.status(401).json({ error: `InvalidNearProof: ${verified.reason}` });
      return;
    }
    const nonceOk = consumeLoginNonce(proof.nonce, {
      cookieNonce: req.cookies?.[NONCE_COOKIE] as string | undefined,
      near,
    });
    if (!nonceOk.ok) {
      res.status(401).json({ error: `InvalidNearProof: ${nonceOk.reason}` });
      return;
    }
    res.clearCookie(NONCE_COOKIE);
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
        (walletAddress.split('.')[0]!.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24).padEnd(2, '_')),
      avatar: avatarUpdate ?? null,
      chips: 0,
    });
  } else {
    if (nickname !== null) session.nickname = nickname;
    if (avatarUpdate !== undefined) session.avatar = avatarUpdate;
    if (!session.walletAddress) session.walletAddress = walletAddress;
    await session.save();
  }

  if (near) {
    // Chips are backed by the vault: pick up the on-chain balance at login.
    try {
      const sync = await syncChipsFromChain(session.sessionId);
      session.chips = sync.chips;
    } catch (e) {
      console.warn('[auth] vault sync at login failed:', e instanceof Error ? e.message : e);
    }
  }

  res.cookie(SESSION_COOKIE, session.sessionId, sessionCookieOptions());
  res.cookie(SESSION_COOKIE_ALIAS, session.sessionId, sessionCookieOptions());
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
      amountNear: doc.amountNear ?? null,
      balanceAfter: doc.balanceAfter ?? null,
      summary: doc.summary,
      payload: doc.payload ?? {},
      createdAt: doc.createdAt
        ? new Date(doc.createdAt).toISOString()
        : null,
    })),
  });
});
