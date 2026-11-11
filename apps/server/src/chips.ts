/**
 * Chip balance sync with the `table-vault` contract (CHAIN=near).
 * 1 chip = 10^21 yocto; session.chips = floor(vault balance / 10^21) whenever
 * the player is not seated in an active hand.
 */
import { SessionModel } from './db.js';
import { isInActiveHand } from './game-store.js';
import { viewVaultBalance, yoctoToChips } from './near.js';

export type ChainSync = {
  chips: number;
  vaultYocto: string;
  synced: boolean;
  reason?: string;
};

export async function syncChipsFromChain(sessionId: string): Promise<ChainSync> {
  const doc = await SessionModel.findOne({ sessionId });
  if (!doc) throw new Error('NotAuthenticated');
  if (!doc.walletAddress) throw new Error('NoNearWallet');
  const yocto = await viewVaultBalance(doc.walletAddress);
  if (await isInActiveHand(sessionId)) {
    return { chips: doc.chips ?? 0, vaultYocto: yocto.toString(), synced: false, reason: 'InActiveHand' };
  }
  doc.chips = yoctoToChips(yocto);
  await doc.save();
  return { chips: doc.chips, vaultYocto: yocto.toString(), synced: true };
}
