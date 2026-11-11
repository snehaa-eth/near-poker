/** Off-chain chip credit rate: 1 NIGHT → 1.5 poker chips. */
export const CHIPS_PER_NIGHT = 1.5;

export function chipsFromNight(night: number): number {
  if (!Number.isFinite(night) || night <= 0) return 0;
  return Math.floor(night * CHIPS_PER_NIGHT);
}

export function nightFromChips(chips: number): number {
  if (!Number.isFinite(chips) || chips <= 0) return 0;
  return chips / CHIPS_PER_NIGHT;
}

/** 5% fee retained in treasury; user receives net. */
export function quoteWithdrawNight(nightAmount: number) {
  const feeNight = Math.floor(nightAmount * 0.05 * 1_000_000) / 1_000_000;
  const netNight = Math.round((nightAmount - feeNight) * 1_000_000) / 1_000_000;
  return {
    grossNight: nightAmount,
    feeNight,
    netNight,
  };
}
