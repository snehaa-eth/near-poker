import { Router } from 'express';

import { SESSION_COOKIE, getSession } from './auth.js';
import { SessionModel, recordPlayerActivity } from './db.js';

export const treasuryRouter = Router();

const CHIPS_PER_NIGHT = 1.5;

async function requireSession(req: { cookies?: Record<string, string> }) {
  const session = await getSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) throw new Error('NotAuthenticated');
  return session;
}

function quoteWithdrawNight(nightAmount: number) {
  const feeNight = Math.floor(nightAmount * 0.05 * 1e6) / 1e6;
  const netNight = Math.round((nightAmount - feeNight) * 1e6) / 1e6;
  return { feeNight, netNight, grossNight: nightAmount };
}

treasuryRouter.get('/quote', (req, res) => {
  const nightAmount = Number(req.query.nightAmount ?? 0);
  if (!Number.isFinite(nightAmount) || nightAmount <= 0) {
    res.status(400).json({ error: 'nightAmount must be positive' });
    return;
  }
  res.json({
    ...quoteWithdrawNight(nightAmount),
    chipsRequired: Math.floor(nightAmount * CHIPS_PER_NIGHT),
    chipsPerNight: CHIPS_PER_NIGHT,
  });
});

/**
 * Credit off-chain chips after a deposit.
 * On-chain Compact deposit comes next; this updates MongoDB stack.
 */
treasuryRouter.post('/deposit', async (req, res) => {
  try {
    const session = await requireSession(req);
    const nightAmount = Number(req.body?.nightAmount);
    if (!Number.isFinite(nightAmount) || nightAmount <= 0) {
      res.status(400).json({ error: 'nightAmount must be positive' });
      return;
    }
    if (nightAmount > 1_000_000) {
      res.status(400).json({ error: 'Amount too large' });
      return;
    }

    const chipsAdded = Math.floor(nightAmount * CHIPS_PER_NIGHT);
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
      summary: `Deposited ${nightAmount} NIGHT → +${chipsAdded} chips`,
      amountChips: chipsAdded,
      amountNight: nightAmount,
      balanceAfter: doc.chips,
      payload: { chipsPerNight: CHIPS_PER_NIGHT, onChain: 'pending' },
    });

    res.json({
      sessionId: doc.sessionId,
      nickname: doc.nickname,
      chips: doc.chips,
      nightAmount,
      chipsAdded,
      chipsPerNight: CHIPS_PER_NIGHT,
      // Placeholder until Compact deposit tx is wired
      onChain: 'pending',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res
      .status(message === 'NotAuthenticated' ? 401 : 400)
      .json({ error: message });
  }
});

/**
 * Debit off-chain chips for a withdrawal request.
 * Body: { chipsAmount } preferred — chips leave, NIGHT credited (net after 5% fee).
 * Legacy: { nightAmount } still accepted.
 */
treasuryRouter.post('/withdraw', async (req, res) => {
  try {
    const session = await requireSession(req);

    const chipsRaw = Number(req.body?.chipsAmount);
    const nightRaw = Number(req.body?.nightAmount);

    let chipsRequired: number;
    let nightAmount: number;

    if (Number.isFinite(chipsRaw) && chipsRaw > 0) {
      chipsRequired = Math.floor(chipsRaw);
      nightAmount =
        Math.round((chipsRequired / CHIPS_PER_NIGHT) * 1_000_000) / 1_000_000;
    } else if (Number.isFinite(nightRaw) && nightRaw > 0) {
      nightAmount = nightRaw;
      chipsRequired = Math.floor(nightAmount * CHIPS_PER_NIGHT);
    } else {
      res.status(400).json({ error: 'Enter a positive chips or NIGHT amount' });
      return;
    }

    if (chipsRequired <= 0) {
      res.status(400).json({ error: 'Amount too small' });
      return;
    }

    const quote = quoteWithdrawNight(nightAmount);

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

    await recordPlayerActivity({
      sessionId: doc.sessionId,
      walletAddress: doc.walletAddress ?? null,
      category: 'withdraw',
      type: 'treasury:withdraw',
      summary: `Cashed out ${chipsRequired} chips → ${quote.netNight} NIGHT`,
      amountChips: -chipsRequired,
      amountNight: quote.netNight,
      balanceAfter: doc.chips,
      payload: {
        grossNight: quote.grossNight,
        feeNight: quote.feeNight,
        netNight: quote.netNight,
        onChain: 'pending',
      },
    });

    res.json({
      sessionId: doc.sessionId,
      nickname: doc.nickname,
      chips: doc.chips,
      chipsDebited: chipsRequired,
      ...quote,
      onChain: 'pending',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res
      .status(message === 'NotAuthenticated' ? 401 : 400)
      .json({ error: message });
  }
});
