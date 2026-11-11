/**
 * Treasury: NEAR ↔ chips. 1 chip = 0.001 NEAR = 10^21 yocto (1000 chips per NEAR).
 *
 *  - CHAIN=near: chips are backed by the `table-vault` contract. The browser signs
 *    `deposit()` / `withdraw()` itself; the server never trusts the body and just
 *    re-reads `balance_of(walletAddress)` (see chips.ts).
 *  - otherwise: off-chain demo chips credited/debited from the request body.
 */
import { Router, type Request, type Response } from 'express';

import { SESSION_COOKIE, getSession } from './auth.js';
import { syncChipsFromChain } from './chips.js';
import { SessionModel, recordPlayerActivity } from './db.js';
import { CHIPS_PER_NEAR, YOCTO_PER_CHIP, isNearChain } from './near.js';

export const treasuryRouter = Router();

/** Off-chain cap per deposit request (NEAR). */
const MAX_DEPOSIT_NEAR = 1_000;

async function requireSession(req: { cookies?: Record<string, string> }) {
  const session = await getSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) throw new Error('NotAuthenticated');
  return session;
}

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    message === 'NotAuthenticated' ? 401 : message.startsWith('VAULT_ID') ? 503 : 400;
  res.status(status).json({ error: message });
}

const chipsToNear = (chips: number) => chips / CHIPS_PER_NEAR;

function optionalString(raw: unknown, max = 128): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length > 0 && s.length <= max ? s : null;
}

/** NEAR amount from body: `yocto` (exact) > `nearAmount` > legacy `nightAmount`. */
function parseNearAmount(body: Record<string, unknown> | undefined): number | null {
  const yocto = optionalString(body?.yocto, 40);
  if (yocto && /^\d+$/.test(yocto)) {
    return Number(BigInt(yocto) / YOCTO_PER_CHIP) / CHIPS_PER_NEAR;
  }
  for (const key of ['nearAmount', 'nightAmount']) {
    const n = Number(body?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

treasuryRouter.get('/quote', (req, res) => {
  const chips = Number(req.query.chipsAmount ?? NaN);
  const near = Number(req.query.nearAmount ?? req.query.nightAmount ?? NaN);
  if (Number.isFinite(chips) && chips > 0) {
    const c = Math.floor(chips);
    res.json({ chips: c, nearAmount: chipsToNear(c), yocto: (BigInt(c) * YOCTO_PER_CHIP).toString(), chipsPerNear: CHIPS_PER_NEAR });
    return;
  }
  if (Number.isFinite(near) && near > 0) {
    const c = Math.floor(near * CHIPS_PER_NEAR);
    res.json({ chips: c, nearAmount: near, yocto: (BigInt(c) * YOCTO_PER_CHIP).toString(), chipsPerNear: CHIPS_PER_NEAR });
    return;
  }
  res.status(400).json({ error: 'chipsAmount or nearAmount must be positive' });
});

/** CHAIN=near: re-read vault balance for the logged-in wallet. */
async function chainSyncResponse(
  req: Request,
  res: Response,
  activity?: { category: 'deposit' | 'withdraw'; txHash: string | null; yocto: string | null }
) {
  const session = await requireSession(req);
  const before = session.chips ?? 0;
  const sync = await syncChipsFromChain(session.sessionId);
  const diff = sync.chips - before;
  if (activity && sync.synced) {
    const nearAmount = chipsToNear(Math.abs(diff));
    await recordPlayerActivity({
      sessionId: session.sessionId,
      walletAddress: session.walletAddress ?? null,
      category: activity.category,
      type: `treasury:${activity.category}`,
      summary:
        activity.category === 'deposit'
          ? `Vault deposit synced: ${diff >= 0 ? '+' : ''}${diff} chips (${nearAmount} NEAR)`
          : `Vault withdraw synced: ${diff} chips (${nearAmount} NEAR)`,
      amountChips: diff,
      amountNear: nearAmount,
      balanceAfter: sync.chips,
      payload: { onChain: 'near', txHash: activity.txHash, yocto: activity.yocto, vaultYocto: sync.vaultYocto },
    });
  }
  res.json({
    sessionId: session.sessionId,
    nickname: session.nickname,
    walletAddress: session.walletAddress ?? null,
    chips: sync.chips,
    chipsAdded: Math.max(0, diff),
    chipsDebited: Math.max(0, -diff),
    vaultYocto: sync.vaultYocto,
    synced: sync.synced,
    ...(sync.reason ? { reason: sync.reason } : {}),
    chipsPerNear: CHIPS_PER_NEAR,
    onChain: 'near',
  });
}

treasuryRouter.get('/sync', async (req, res) => {
  try {
    if (!isNearChain()) {
      const session = await requireSession(req);
      res.json({ sessionId: session.sessionId, chips: session.chips ?? 0, synced: false, reason: 'OffChain', onChain: 'off' });
      return;
    }
    await chainSyncResponse(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

/** Body: { nearAmount, yocto?, txHash?, nightAmount? (legacy alias) }. */
treasuryRouter.post('/deposit', async (req, res) => {
  try {
    if (isNearChain()) {
      await chainSyncResponse(req, res, {
        category: 'deposit',
        txHash: optionalString(req.body?.txHash),
        yocto: optionalString(req.body?.yocto, 40),
      });
      return;
    }

    const session = await requireSession(req);
    const nearAmount = parseNearAmount(req.body);
    if (nearAmount == null) {
      res.status(400).json({ error: 'nearAmount must be positive' });
      return;
    }
    if (nearAmount > MAX_DEPOSIT_NEAR) {
      res.status(400).json({ error: 'Amount too large' });
      return;
    }
    const chipsAdded = Math.floor(nearAmount * CHIPS_PER_NEAR);
    if (chipsAdded <= 0) {
      res.status(400).json({ error: 'Amount too small' });
      return;
    }

    const doc = await SessionModel.findOne({ sessionId: session.sessionId });
    if (!doc) {
      res.status(401).json({ error: 'NotAuthenticated' });
      return;
    }
    doc.chips = (doc.chips ?? 0) + chipsAdded;
    await doc.save();

    await recordPlayerActivity({
      sessionId: doc.sessionId,
      walletAddress: doc.walletAddress ?? null,
      category: 'deposit',
      type: 'treasury:deposit',
      summary: `Deposited ${nearAmount} NEAR → +${chipsAdded} chips`,
      amountChips: chipsAdded,
      amountNear: nearAmount,
      balanceAfter: doc.chips,
      payload: { chipsPerNear: CHIPS_PER_NEAR, onChain: 'off', txHash: optionalString(req.body?.txHash) },
    });

    res.json({
      sessionId: doc.sessionId,
      nickname: doc.nickname,
      chips: doc.chips,
      nearAmount,
      chipsAdded,
      chipsPerNear: CHIPS_PER_NEAR,
      onChain: 'off',
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Body: { chipsAmount, yocto?, txHash? }.
 * CHAIN=near: the user already signed `vault.withdraw` — we only re-sync from chain.
 */
treasuryRouter.post('/withdraw', async (req, res) => {
  try {
    if (isNearChain()) {
      await chainSyncResponse(req, res, {
        category: 'withdraw',
        txHash: optionalString(req.body?.txHash),
        yocto: optionalString(req.body?.yocto, 40),
      });
      return;
    }

    const session = await requireSession(req);
    let chipsRequired = Math.floor(Number(req.body?.chipsAmount));
    if (!Number.isFinite(chipsRequired) || chipsRequired <= 0) {
      const near = parseNearAmount(req.body);
      chipsRequired = near == null ? 0 : Math.floor(near * CHIPS_PER_NEAR);
    }
    if (chipsRequired <= 0) {
      res.status(400).json({ error: 'Enter a positive chips amount' });
      return;
    }

    const doc = await SessionModel.findOne({ sessionId: session.sessionId });
    if (!doc) {
      res.status(401).json({ error: 'NotAuthenticated' });
      return;
    }
    if ((doc.chips ?? 0) < chipsRequired) {
      res.status(400).json({
        error: `Insufficient chips. Need ${chipsRequired}, have ${doc.chips ?? 0}.`,
      });
      return;
    }

    doc.chips = (doc.chips ?? 0) - chipsRequired;
    await doc.save();
    const netNear = chipsToNear(chipsRequired);

    await recordPlayerActivity({
      sessionId: doc.sessionId,
      walletAddress: doc.walletAddress ?? null,
      category: 'withdraw',
      type: 'treasury:withdraw',
      summary: `Cashed out ${chipsRequired} chips → ${netNear} NEAR`,
      amountChips: -chipsRequired,
      amountNear: netNear,
      balanceAfter: doc.chips,
      payload: { chipsPerNear: CHIPS_PER_NEAR, onChain: 'off', txHash: optionalString(req.body?.txHash) },
    });

    res.json({
      sessionId: doc.sessionId,
      nickname: doc.nickname,
      chips: doc.chips,
      chipsDebited: chipsRequired,
      netNear,
      yocto: (BigInt(chipsRequired) * YOCTO_PER_CHIP).toString(),
      onChain: 'off',
    });
  } catch (error) {
    sendError(res, error);
  }
});
