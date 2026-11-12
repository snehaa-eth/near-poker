/**
 * Hosted agents HTTP API (mounted at /hosted-agents).
 *
 *   GET    /hosted-agents/config        → { enabled, reason?, chain, defaultModel, personas, fundNear, depositNear, maxCallsDefault, customMax }
 *   GET    /hosted-agents               → { agents: [public profile] }
 *   POST   /hosted-agents               { name, persona, customPrompt?, model?, nearAiKey, maxCalls?, eventId? }
 *                                       → 201 { agentId, ownerToken, manageUrl, walletAddress, chain, txs, warning? }
 *   GET    /hosted-agents/:id           → public profile; + owner fields with header x-owner-token
 *   POST   /hosted-agents/:id/play      owner → start (resets the per-run LLM budget)
 *   POST   /hosted-agents/:id/stop      owner, { force? } → leave after this hand (or kill now)
 *   PATCH  /hosted-agents/:id           owner, { persona?, customPrompt?, model?, maxCalls?, nearAiKey?, eventId? }
 *   POST   /hosted-agents/:id/download  owner, { includeApiKey? } → application/gzip (.tar.gz)
 *   DELETE /hosted-agents/:id           owner → stops; status 'deleted'; wallet stays downloadable
 *
 * Owner auth: `x-owner-token` header (or body.token), compared in constant time with the stored sha256.
 * Secrets are never returned except inside the owner's download.
 */
import { randomBytes } from 'node:crypto';

import { Router, type Request, type Response } from 'express';

import { getAttestationCache } from '../arena/attestation.js';
import { HostedAgentModel, type HostedAgentDoc } from '../db.js';
import { DEFAULT_MODEL, disabledReason, getHostedConfig } from './config.js';
import { checkOwnerToken, decryptSecret, encryptSecret, newOwnerToken } from './crypto.js';
import { buildAgentBundle } from './download.js';
import { CUSTOM_MAX, PERSONAS, cleanCustom, isPersonaId, personaLabel } from './personas.js';
import { RateLimiter } from './rate-limit.js';
import { isRunning, liveGameId, liveLogs, startAgent, stopAgent } from './runner.js';
import { chipsOf, statsFor, tableOf } from './stats.js';
import { WalletError, createWallet, withdrawWallet } from './wallet.js';
import { proveWallet } from '../auth.js';

export const hostedRouter = Router();

export const createLimiter = new RateLimiter(() => getHostedConfig().ratePerHour, 60 * 60 * 1000);

const NAME_RE = /^[a-z0-9-]{3,20}$/;
const MODEL_RE = /^[A-Za-z0-9._/:-]{3,100}$/;
const RESERVED = new Set(['vault', 'operator', 'admin', 'root', 'arena', 'new', 'dark-table', 'rock', 'maniac', 'shark', 'calley', 'fox', 'owl']);

export function validateName(raw: unknown): string | null {
  const n = String(raw ?? '').trim().toLowerCase();
  if (!NAME_RE.test(n) || n.startsWith('-') || n.endsWith('-') || n.includes('--')) return null;
  return n;
}

function parseMaxCalls(raw: unknown, fallback = 40): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 4 && n <= 500 ? n : null;
}

function parseApiKey(raw: unknown): string | null {
  const k = typeof raw === 'string' ? raw.trim() : '';
  return k.length >= 8 && k.length <= 300 && !/\s/.test(k) ? k : null;
}

function parseEventId(raw: unknown): string | null {
  const e = typeof raw === 'string' ? raw.trim() : '';
  return e && /^[A-Za-z0-9_-]{1,64}$/.test(e) ? e : null;
}

async function checkModel(model: string): Promise<string | null> {
  if (!MODEL_RE.test(model)) return 'BadModel';
  const { signers, error } = await getAttestationCache().getSigners(model);
  if (signers.length > 0) return null;
  return error
    ? `AttestationUnavailable: could not check ${model} (${error}). Try again.`
    : `ModelNotAttested: ${model} is not a Confidential-TEE model on NEAR AI Cloud (gateway / Incognito models can't play).`;
}

/**
 * Client IP for rate limiting. Behind a reverse proxy (Northflank, ngrok…) req.ip is the proxy, so use the
 * LAST X-Forwarded-For hop: the one appended by the proxy in front of us (a client can't forge it).
 */
export function clientIp(req: Pick<Request, 'ip' | 'get'>): string {
  const xff = req.get('x-forwarded-for');
  const last = xff?.split(',').map((x) => x.trim()).filter(Boolean).pop();
  return last || req.ip || 'unknown';
}

const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });

function tokenOf(req: Request): unknown {
  return req.get('x-owner-token') ?? (req.body as { token?: unknown } | undefined)?.token;
}

async function load(req: Request): Promise<HostedAgentDoc | null> {
  const id = String(req.params.id ?? '');
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  return HostedAgentModel.findOne({ agentId: id }).lean<HostedAgentDoc>();
}

/** The original manage-link token, or one issued to the linked wallet on another device. */
function isOwnerToken(doc: HostedAgentDoc, tok: unknown): boolean {
  if (checkOwnerToken(tok, doc.ownerTokenHash)) return true;
  return (doc.deviceTokenHashes ?? []).some((h) => checkOwnerToken(tok, h));
}

async function loadOwned(req: Request, res: Response): Promise<HostedAgentDoc | null> {
  const doc = await load(req);
  if (!doc || !isOwnerToken(doc, tokenOf(req))) {
    // Same answer for "no such agent" and "wrong token".
    fail(res, doc ? 403 : 404, doc ? 'BadOwnerToken' : 'NotFound');
    return null;
  }
  return doc;
}

async function publicView(doc: HostedAgentDoc) {
  const running = isRunning(doc.agentId);
  const [stats, table] = await Promise.all([statsFor(doc.walletAddress), running ? tableOf(doc.walletAddress) : null]);
  const gameId = table?.gameId ?? (running ? liveGameId(doc.agentId) : null);
  const state = doc.status === 'deleted' ? 'deleted' : running ? (gameId ? 'playing' : 'queued') : doc.status === 'error' ? 'error' : 'idle';
  return {
    agentId: doc.agentId,
    name: doc.name,
    persona: doc.persona,
    personaLabel: personaLabel(doc.persona),
    model: doc.model,
    walletAddress: doc.walletAddress,
    chain: doc.chain,
    walletUrl: doc.chain === 'near' ? `https://testnet.nearblocks.io/address/${doc.walletAddress}` : null,
    state,
    gameId,
    stats,
    createdAt: doc.createdAt,
  };
}

async function ownerView(doc: HostedAgentDoc) {
  return {
    ...(await publicView(doc)),
    owner: true,
    customPrompt: doc.customPrompt,
    maxCalls: doc.maxCalls,
    eventId: doc.eventId,
    ownerWallet: doc.ownerWallet ?? null,
    // while running, the live state (queued / playing) says it all; keep only a pending stop
    statusDetail: isRunning(doc.agentId) ? (doc.statusDetail === 'stopping after this hand' ? doc.statusDetail : '') : doc.statusDetail,
    chips: await chipsOf(doc.walletAddress),
    lastRun: doc.stats?.lastRun ?? null,
    runs: doc.stats?.runs ?? 0,
    txs: doc.txs ?? {},
    logs: (liveLogs(doc.agentId) ?? doc.lastLog ?? []).slice(-20),
  };
}

hostedRouter.get('/config', (_req, res) => {
  const cfg = getHostedConfig();
  const reason = disabledReason(cfg);
  res.json({
    enabled: !reason,
    ...(reason ? { reason } : {}),
    chain: cfg.near ? 'near' : 'local',
    defaultModel: DEFAULT_MODEL,
    personas: [...PERSONAS.map((p) => ({ id: p.id, label: p.label, blurb: p.blurb })), { id: 'custom', label: 'Custom', blurb: 'Describe the style yourself.' }],
    fundNear: cfg.fundNear,
    depositNear: cfg.depositNear,
    maxCallsDefault: 40,
    customMax: CUSTOM_MAX,
  });
});

hostedRouter.get('/', async (_req, res) => {
  try {
    const docs = await HostedAgentModel.find({ status: { $ne: 'deleted' } }).sort({ createdAt: -1 }).limit(100).lean<HostedAgentDoc[]>();
    res.json({ agents: await Promise.all(docs.map(publicView)) });
  } catch (e) {
    fail(res, 500, (e as Error).message);
  }
});

const creating = new Set<string>();

hostedRouter.post('/', async (req, res) => {
  const cfg = getHostedConfig();
  const reason = disabledReason(cfg);
  if (reason) return fail(res, 503, `HostedDisabled: ${reason}`);
  const b = (req.body ?? {}) as Record<string, unknown>;

  const name = validateName(b.name);
  if (!name) return fail(res, 400, 'BadName: 3–20 characters, lowercase letters, digits and single dashes');
  if (RESERVED.has(name)) return fail(res, 409, 'NameTaken');
  const persona = b.persona ?? 'shark';
  if (!isPersonaId(persona)) return fail(res, 400, 'BadPersona');
  const customPrompt = persona === 'custom' ? cleanCustom(b.customPrompt) : '';
  if (persona === 'custom' && customPrompt.length < 10) return fail(res, 400, 'BadCustomPrompt: describe the style in 10–600 characters');
  if (typeof b.customPrompt === 'string' && b.customPrompt.length > CUSTOM_MAX) return fail(res, 400, `BadCustomPrompt: at most ${CUSTOM_MAX} characters`);
  const model = typeof b.model === 'string' && b.model.trim() ? b.model.trim() : DEFAULT_MODEL;
  const nearAiKey = parseApiKey(b.nearAiKey);
  if (!nearAiKey) return fail(res, 400, 'BadNearAiKey: paste your NEAR AI Cloud API key');
  const maxCalls = parseMaxCalls(b.maxCalls);
  if (maxCalls === null) return fail(res, 400, 'BadMaxCalls: 4–500');
  const eventId = parseEventId(b.eventId);

  if ((await HostedAgentModel.countDocuments({ status: { $ne: 'deleted' } })) >= cfg.max) {
    return fail(res, 503, 'HostedFull: this server hosts the maximum number of agents right now.');
  }
  if (await HostedAgentModel.exists({ name })) return fail(res, 409, 'NameTaken');
  const modelErr = await checkModel(model);
  if (modelErr) return fail(res, 400, modelErr);
  const ip = clientIp(req);
  if (!createLimiter.take(ip)) return fail(res, 429, `RateLimited: at most ${cfg.ratePerHour} new agents per hour`);
  if (creating.has(name)) return fail(res, 409, 'NameTaken');
  creating.add(name);
  try {
    const wallet = await createWallet(cfg, name);
    const { token, hash } = newOwnerToken();
    const agentId = randomBytes(9).toString('base64url');
    await HostedAgentModel.create({
      agentId,
      name,
      persona,
      customPrompt,
      model,
      maxCalls,
      eventId,
      walletAddress: wallet.accountId,
      chain: cfg.near ? 'near' : 'local',
      encryptedNearAiKey: encryptSecret(nearAiKey),
      encryptedAgentPrivateKey: encryptSecret(wallet.privateKey),
      ownerTokenHash: hash,
      status: wallet.depositError ? 'error' : 'idle',
      statusDetail: wallet.depositError ? 'vault deposit failed; the wallet holds the NEAR. Download it and run `npm run deposit -- 0.1`.' : 'created',
      createdIp: ip,
      txs: wallet.txs,
    });
    console.log(`[hosted] created agent ${name} (${wallet.accountId})`);
    res.status(201).json({
      agentId,
      ownerToken: token,
      manageUrl: `/agents/${agentId}?token=${token}`,
      walletAddress: wallet.accountId,
      chain: cfg.near ? 'near' : 'local',
      txs: wallet.txs,
      ...(wallet.depositError ? { warning: 'The vault deposit failed. Your wallet is funded; download the agent to deposit manually.' } : {}),
    });
  } catch (e) {
    if (e instanceof WalletError) return fail(res, e.status, e.message);
    console.error('[hosted] create failed:', (e as Error).message);
    fail(res, 500, 'CreateFailed: could not create the agent wallet. Try again in a minute.');
  } finally {
    creating.delete(name);
  }
});

/**
 * Optional wallet link. Owner (manage link) + a NEP-413 proof → this agent shows up under
 * "my agents" for that NEAR account on any device. Agents without a link keep working as before.
 */
hostedRouter.post('/:id/link-wallet', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  if (doc.status === 'deleted') return fail(res, 410, 'Deleted');
  const p = await proveWallet((req.body as { nearProof?: unknown } | undefined)?.nearProof);
  if (!p.ok) return fail(res, 401, p.error);
  await HostedAgentModel.updateOne({ agentId: doc.agentId }, { ownerWallet: p.wallet });
  res.json({ ownerWallet: p.wallet });
});

hostedRouter.post('/:id/unlink-wallet', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  await HostedAgentModel.updateOne({ agentId: doc.agentId }, { ownerWallet: null, deviceTokenHashes: [] });
  res.json({ ownerWallet: null });
});

/**
 * "My agents": a NEP-413 proof → every agent linked to that wallet, each with a fresh manage token
 * for this device (the original link keeps working; at most 10 device tokens are kept per agent).
 */
hostedRouter.post('/mine', async (req, res) => {
  const p = await proveWallet((req.body as { nearProof?: unknown } | undefined)?.nearProof);
  if (!p.ok) return fail(res, 401, p.error);
  const docs = await HostedAgentModel.find({ ownerWallet: p.wallet, status: { $ne: 'deleted' } })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean<HostedAgentDoc[]>();
  const agents = [];
  for (const d of docs) {
    const { token, hash } = newOwnerToken();
    await HostedAgentModel.updateOne({ agentId: d.agentId }, { $push: { deviceTokenHashes: { $each: [hash], $slice: -10 } } });
    agents.push({ agentId: d.agentId, name: d.name, token, manageUrl: `/agents/${d.agentId}?token=${token}` });
  }
  res.json({ wallet: p.wallet, agents });
});

hostedRouter.get('/:id', async (req, res) => {
  try {
    const doc = await load(req);
    if (!doc) return fail(res, 404, 'NotFound');
    const tok = tokenOf(req);
    if (tok !== undefined) {
      if (!isOwnerToken(doc, tok)) return fail(res, 403, 'BadOwnerToken');
      return res.json(await ownerView(doc));
    }
    if (doc.status === 'deleted') return fail(res, 404, 'NotFound');
    res.json(await publicView(doc));
  } catch (e) {
    fail(res, 500, (e as Error).message);
  }
});

hostedRouter.post('/:id/play', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  if (doc.status === 'deleted') return fail(res, 410, 'Deleted');
  const reason = disabledReason(getHostedConfig());
  if (reason) return fail(res, 503, `HostedDisabled: ${reason}`);
  const r = await startAgent(doc);
  if (!r.ok) return fail(res, r.status, r.error);
  res.json(await ownerView((await HostedAgentModel.findOne({ agentId: doc.agentId }).lean<HostedAgentDoc>())!));
});

hostedRouter.post('/:id/stop', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  const stopped = stopAgent(doc.agentId, (req.body as { force?: unknown } | undefined)?.force === true);
  await HostedAgentModel.updateOne({ agentId: doc.agentId }, { wantRunning: false, ...(stopped ? { statusDetail: 'stopping after this hand' } : {}) });
  res.json({ stopping: stopped });
});

hostedRouter.patch('/:id', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  if (doc.status === 'deleted') return fail(res, 410, 'Deleted');
  const b = (req.body ?? {}) as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  if (b.persona !== undefined) {
    if (!isPersonaId(b.persona)) return fail(res, 400, 'BadPersona');
    set.persona = b.persona;
  }
  const persona = (set.persona as string | undefined) ?? doc.persona;
  if (b.customPrompt !== undefined || persona === 'custom' || set.persona !== undefined) {
    if (typeof b.customPrompt === 'string' && b.customPrompt.length > CUSTOM_MAX) return fail(res, 400, `BadCustomPrompt: at most ${CUSTOM_MAX} characters`);
    const c = b.customPrompt !== undefined ? cleanCustom(b.customPrompt) : doc.customPrompt;
    if (persona === 'custom' && c.length < 10) return fail(res, 400, 'BadCustomPrompt: describe the style in 10–600 characters');
    set.customPrompt = persona === 'custom' ? c : '';
  }
  if (b.maxCalls !== undefined) {
    const m = parseMaxCalls(b.maxCalls);
    if (m === null) return fail(res, 400, 'BadMaxCalls: 4–500');
    set.maxCalls = m;
  }
  if (b.model !== undefined && b.model !== doc.model) {
    const model = String(b.model).trim() || DEFAULT_MODEL;
    const err = await checkModel(model);
    if (err) return fail(res, 400, err);
    set.model = model;
  }
  if (b.nearAiKey !== undefined && b.nearAiKey !== '') {
    const k = parseApiKey(b.nearAiKey);
    if (!k) return fail(res, 400, 'BadNearAiKey');
    set.encryptedNearAiKey = encryptSecret(k);
  }
  if (b.eventId !== undefined) set.eventId = parseEventId(b.eventId);
  await HostedAgentModel.updateOne({ agentId: doc.agentId }, set);
  const next = (await HostedAgentModel.findOne({ agentId: doc.agentId }).lean<HostedAgentDoc>())!;
  res.json({ ...(await ownerView(next)), appliesNextRun: isRunning(doc.agentId) });
});

hostedRouter.post('/:id/download', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  const cfg = getHostedConfig();
  try {
    const includeKey = (req.body as { includeApiKey?: unknown } | undefined)?.includeApiKey === true;
    const gameServer = process.env.HOSTED_PUBLIC_API_URL?.trim() || process.env.PUBLIC_API_URL?.trim() || `${req.protocol}://${req.get('host')}`;
    const tgz = buildAgentBundle({
      doc,
      agentDir: cfg.agentDir,
      privateKey: decryptSecret(doc.encryptedAgentPrivateKey),
      nearAiKey: includeKey ? decryptSecret(doc.encryptedNearAiKey) : null,
      gameServer,
      vaultId: cfg.vaultId,
      rpcUrl: cfg.rpcUrl,
    });
    res.setHeader('content-type', 'application/gzip');
    res.setHeader('content-disposition', `attachment; filename="${doc.name}-agent.tar.gz"`);
    res.setHeader('cache-control', 'no-store');
    res.send(tgz);
  } catch (e) {
    console.error('[hosted] download failed:', (e as Error).message);
    fail(res, 500, 'DownloadFailed');
  }
});

const NEAR_ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Owner cash-out: whole vault balance out, then (optionally) sent to `to`. Agent must be stopped. */
hostedRouter.post('/:id/withdraw', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  if (isRunning(doc.agentId)) return fail(res, 409, 'StopFirst: stop the agent before withdrawing');
  const rawTo = (req.body as { to?: unknown } | undefined)?.to;
  const to = typeof rawTo === 'string' && rawTo.trim() ? rawTo.trim().toLowerCase() : null;
  if (to && !NEAR_ACCOUNT_RE.test(to)) return fail(res, 400, 'BadAccount: not a valid NEAR account id');
  if (to === doc.walletAddress) return fail(res, 400, 'BadAccount: that is the agent wallet itself');
  try {
    const r = await withdrawWallet(getHostedConfig(), doc.walletAddress, decryptSecret(doc.encryptedAgentPrivateKey), to);
    console.log(`[hosted] withdraw ${doc.name}: vault ${r.withdrawnYocto} yocto${to ? `, sent ${r.sentYocto} to ${to}` : ''}`);
    res.json(r);
  } catch (e) {
    if (e instanceof WalletError) return fail(res, e.status, e.message);
    console.error('[hosted] withdraw failed:', (e as Error).message);
    fail(res, 502, `WithdrawFailed: ${(e as Error).message.slice(0, 160)}`);
  }
});

hostedRouter.delete('/:id', async (req, res) => {
  const doc = await loadOwned(req, res);
  if (!doc) return;
  stopAgent(doc.agentId, true);
  await HostedAgentModel.updateOne({ agentId: doc.agentId }, { status: 'deleted', statusDetail: 'deleted', wantRunning: false });
  res.json({ deleted: true });
});

/** After the server listens: restart agents that were running before a reboot. */
export async function resumeHostedAgents() {
  if (disabledReason(getHostedConfig())) return;
  const docs = await HostedAgentModel.find({ wantRunning: true, status: { $ne: 'deleted' } }).lean<HostedAgentDoc[]>();
  for (const d of docs) {
    const r = await startAgent(d);
    if (!r.ok) console.warn(`[hosted] could not resume ${d.name}: ${r.error}`);
  }
}
