/**
 * Accepted arena moves (INTERFACES.md §5.4) + per-agent public info for the table view.
 * Must not import game-store (game-store imports this for view decoration).
 */
import mongoose, { Schema } from 'mongoose';

import { receiptUrl } from './receipt.js';

const arenaMoveSchema = new Schema(
  {
    handId: { type: String, required: true, index: true },
    gameId: { type: String, required: true, index: true },
    playerId: { type: String, required: true, index: true },
    nickname: { type: String, default: '' },
    walletAddress: { type: String, default: null },
    action: { type: String, required: true },
    amount: { type: Number, default: null },
    challenge: { type: String, required: true },
    completionId: { type: String, required: true, unique: true },
    model: { type: String, required: true },
    signatureKind: { type: String, default: 'provider_tee' },
    signingAlgo: { type: String, default: 'ed25519' },
    signingAddress: { type: String, required: true },
    signedText: { type: String, required: true },
    signature: { type: String, required: true },
    /** The disclosed decision (raw completion response body). The request prompt is never sent to us. */
    responseBody: { type: String, default: null },
    verifiedAt: { type: Date, required: true },
  },
  { timestamps: false }
);
arenaMoveSchema.index({ playerId: 1, verifiedAt: -1 });

export type ArenaMoveDoc = {
  handId: string;
  gameId: string;
  playerId: string;
  nickname: string;
  walletAddress: string | null;
  action: string;
  amount: number | null;
  challenge: string;
  completionId: string;
  model: string;
  signatureKind: string;
  signingAlgo: string;
  signingAddress: string;
  signedText: string;
  signature: string;
  responseBody: string | null;
  verifiedAt: Date;
};

export const ArenaMoveModel = mongoose.model<ArenaMoveDoc>('ArenaMove', arenaMoveSchema);

import type { PublicAgentInfo } from '../poker-bridge.js';

export type { PublicAgentInfo };

const infoCache = new Map<string, PublicAgentInfo>();
/** Model an agent declared at /arena/join, shown until its first verified move. */
const declaredModels = new Map<string, string>();

export function setDeclaredModel(playerId: string, model: string | null) {
  if (model) declaredModels.set(playerId, model);
  else declaredModels.delete(playerId);
  const hit = infoCache.get(playerId);
  if (hit && hit.movesVerified === 0) infoCache.delete(playerId);
}

function urlFor(d: Pick<ArenaMoveDoc, 'completionId' | 'model' | 'signatureKind' | 'signingAlgo' | 'signingAddress' | 'signedText' | 'signature' | 'verifiedAt'>) {
  return receiptUrl({
    completionId: d.completionId,
    model: d.model,
    signatureKind: d.signatureKind,
    signingAlgo: d.signingAlgo,
    signingAddress: d.signingAddress,
    signedText: d.signedText,
    signature: d.signature,
    verifiedAt: new Date(d.verifiedAt).toISOString(),
  });
}

export async function recordArenaMove(move: ArenaMoveDoc): Promise<void> {
  await ArenaMoveModel.create(move);
  const prev = infoCache.get(move.playerId);
  const count = prev ? prev.movesVerified + 1 : await ArenaMoveModel.countDocuments({ playerId: move.playerId });
  infoCache.set(move.playerId, { model: move.model, movesVerified: count, lastReceiptUrl: urlFor(move) });
}

export async function isCompletionUsed(completionId: string): Promise<boolean> {
  return Boolean(await ArenaMoveModel.exists({ completionId }));
}

export async function getAgentInfoFor(playerIds: string[]): Promise<Map<string, PublicAgentInfo>> {
  const out = new Map<string, PublicAgentInfo>();
  for (const id of playerIds) {
    let info = infoCache.get(id);
    if (!info) {
      const [count, last] = await Promise.all([
        ArenaMoveModel.countDocuments({ playerId: id }),
        ArenaMoveModel.findOne({ playerId: id }).sort({ verifiedAt: -1 }).lean(),
      ]);
      info = last
        ? { model: last.model, movesVerified: count, lastReceiptUrl: urlFor(last) }
        : { model: declaredModels.get(id) ?? 'unknown', movesVerified: 0 };
      infoCache.set(id, info);
    }
    out.set(id, { ...info });
  }
  return out;
}

/** Public record shape for GET /arena/moves/:handId. */
export function toPublicMove(d: ArenaMoveDoc) {
  return {
    handId: d.handId,
    gameId: d.gameId,
    playerId: d.playerId,
    nickname: d.nickname ?? '',
    walletAddress: d.walletAddress ?? null,
    action: d.action,
    amount: d.amount,
    challenge: d.challenge,
    completionId: d.completionId,
    model: d.model,
    signatureKind: d.signatureKind,
    signingAlgo: d.signingAlgo,
    signingAddress: d.signingAddress,
    signedText: d.signedText,
    signature: d.signature,
    responseBody: d.responseBody,
    verifiedAt: new Date(d.verifiedAt).toISOString(),
    receiptUrl: urlFor(d),
  };
}

export async function listMovesForHand(handId: string) {
  const docs = await ArenaMoveModel.find({ handId }).sort({ verifiedAt: 1 }).lean();
  return docs.map((d) => toPublicMove(d as ArenaMoveDoc));
}
