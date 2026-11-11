/**
 * Bot sessions + public bot metadata (INTERFACES.md §4 `players[i].bot`).
 *
 * Bots are operator-controlled NEAR sub-accounts; POST /admin/bot-session binds a
 * session to one WITHOUT a NEP-413 proof (admin only). Bot runners publish their
 * model / attestation / table talk via socket `bot:meta`.
 */
import { v4 as uuidv4 } from 'uuid';

import { SessionModel } from './db.js';

export type BotPublic = {
  persona: string;
  model?: string;
  attested?: boolean;
  signingAddress?: string;
  lastLine?: string;
};

const LIMITS = { persona: 32, model: 64, signingAddress: 128, lastLine: 280 } as const;

function cleanStr(raw: unknown, max: number): string | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  // strip control chars; keep it single-line
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (s.length > max) return null;
  return s;
}

/** Validate a partial meta update. Throws on oversized / wrong-typed fields. */
export function parseBotMeta(raw: unknown): Partial<BotPublic> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('InvalidBotMeta');
  const r = raw as Record<string, unknown>;
  const out: Partial<BotPublic> = {};
  for (const key of ['persona', 'model', 'signingAddress', 'lastLine'] as const) {
    const v = cleanStr(r[key], LIMITS[key]);
    if (v === null) throw new Error(`InvalidBotMeta: ${key} (string ≤ ${LIMITS[key]} chars)`);
    if (v !== undefined) out[key] = v;
  }
  if (r.attested !== undefined) {
    if (typeof r.attested !== 'boolean') throw new Error('InvalidBotMeta: attested must be boolean');
    out.attested = r.attested;
  }
  return out;
}

export function personaFromNickname(nickname: string) {
  return nickname.replace(/Bot$/i, '').slice(0, LIMITS.persona) || nickname.slice(0, LIMITS.persona);
}

/** In-process cache sessionId → meta; Mongo is the source of truth. */
const cache = new Map<string, BotPublic>();

export async function setBotMeta(sessionId: string, meta: unknown): Promise<BotPublic> {
  const update = parseBotMeta(meta);
  const doc = await SessionModel.findOne({ sessionId });
  if (!doc || !doc.isBot) throw new Error('NotABot');
  const prev = (doc.botMeta as BotPublic | null) ?? { persona: personaFromNickname(doc.nickname) };
  const next: BotPublic = { ...prev, ...update };
  if (!next.persona) next.persona = personaFromNickname(doc.nickname);
  doc.botMeta = next;
  doc.markModified('botMeta');
  await doc.save();
  cache.set(sessionId, next);
  return next;
}

/** Bot meta for the given player ids (non-bots are absent from the map). */
export async function getBotMetaFor(playerIds: string[]): Promise<Map<string, BotPublic>> {
  const out = new Map<string, BotPublic>();
  const missing = playerIds.filter((id) => {
    const hit = cache.get(id);
    if (hit) out.set(id, hit);
    return !hit;
  });
  if (missing.length === 0) return out;
  const docs = await SessionModel.find({ sessionId: { $in: missing }, isBot: true })
    .select('sessionId nickname botMeta')
    .lean();
  for (const d of docs) {
    const meta: BotPublic = {
      persona: personaFromNickname(d.nickname),
      ...((d.botMeta as BotPublic | null) ?? {}),
    };
    cache.set(d.sessionId, meta);
    out.set(d.sessionId, meta);
  }
  return out;
}

const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/**
 * Create or return the bot session bound to `walletAddress` (a NEAR account the
 * operator controls). walletAddress is optional only when CHAIN!=near.
 */
export async function upsertBotSession(input: {
  nickname: string;
  walletAddress: string | null;
  near: boolean;
  suffix?: string;
}) {
  const nickname = input.nickname.trim();
  if (nickname.length < 2 || nickname.length > 24) throw new Error('Nickname must be 2-24 characters.');
  const wallet = input.walletAddress?.trim() || null;
  if (input.near && !wallet) throw new Error('walletAddress is required when CHAIN=near');
  if (wallet) {
    if (!ACCOUNT_RE.test(wallet)) throw new Error('walletAddress is not a valid NEAR account id');
    const suffix = input.suffix?.trim().replace(/^\./, '');
    if (suffix && !wallet.endsWith(`.${suffix}`)) {
      throw new Error(`walletAddress must end with .${suffix}`);
    }
  }

  let doc = wallet ? await SessionModel.findOne({ walletAddress: wallet }) : null;
  if (doc && !doc.isBot) throw new Error('walletAddress belongs to a human session');
  if (!doc) {
    doc = await SessionModel.create({
      sessionId: uuidv4(),
      nickname,
      walletAddress: wallet ?? undefined,
      chips: 0,
      isBot: true,
      botMeta: { persona: personaFromNickname(nickname) },
    });
  } else if (doc.nickname !== nickname) {
    doc.nickname = nickname;
    await doc.save();
  }
  cache.delete(doc.sessionId);
  return doc;
}
