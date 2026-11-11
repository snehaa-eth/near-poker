/** 1 NIGHT = 1_000_000 Stars (ledger base units). */
export const STARS_PER_NIGHT = 1_000_000n;

/** Withdrawal fee (500 bps = 5%), retained in treasury. */
export const WITHDRAW_FEE_BPS = 500n;
export const BPS_DENOMINATOR = 10_000n;

/**
 * Off-chain chips credited per 1 NIGHT deposited (1.5×).
 * Stored as rational 3/2 for exact bigint math.
 * Example: deposit 100 NIGHT → 150 chips.
 */
export const CHIP_RATE_NUM = 3n;
export const CHIP_RATE_DEN = 2n;

/** @deprecated Prefer CHIP_RATE_NUM / CHIP_RATE_DEN. Kept as 3/2 display helper. */
export const CHIPS_PER_NIGHT = CHIP_RATE_NUM; // not 1.5 — use chipsFromDeposit()

export type PoolMarketPreset = {
  id: string;
  label: string;
  /** Suggested deposit in whole NIGHT (UX presets — on-chain amount is free). */
  entryNight: bigint;
};

/** Suggested buy-in sizes for the UI (treasury accepts any amount). */
export const POOL_MARKET_PRESETS: PoolMarketPreset[] = [
  {
    id: 'micro',
    label: 'Micro (10 NIGHT → 15 chips)',
    entryNight: 10n,
  },
  {
    id: 'low',
    label: 'Low (100 NIGHT → 150 chips)',
    entryNight: 100n,
  },
  {
    id: 'mid',
    label: 'Mid (500 NIGHT → 750 chips)',
    entryNight: 500n,
  },
  {
    id: 'high',
    label: 'High (1,000 NIGHT → 1,500 chips)',
    entryNight: 1000n,
  },
];

export function nightToStars(night: bigint): bigint {
  return night * STARS_PER_NIGHT;
}

export function starsToNight(stars: bigint): bigint {
  return stars / STARS_PER_NIGHT;
}

/** Off-chain chip credit after a confirmed on-chain deposit (1 NIGHT → 1.5 chips). */
export function chipsFromDeposit(entryNight: bigint): bigint {
  return (entryNight * CHIP_RATE_NUM) / CHIP_RATE_DEN;
}

export function chipsFromStars(entryStars: bigint): bigint {
  return chipsFromDeposit(starsToNight(entryStars));
}

/** Convert chip stack back to NIGHT Stars for withdrawal gross amount. */
export function starsFromChips(chips: bigint): bigint {
  if (CHIP_RATE_NUM <= 0n) throw new Error('chip rate must be positive');
  const night = (chips * CHIP_RATE_DEN) / CHIP_RATE_NUM;
  return night * STARS_PER_NIGHT;
}

/**
 * quoteWithdraw — fee retained in treasury, user receives net.
 * Same math as Solidity NLITreasury.quoteWithdraw.
 */
export function quoteWithdraw(
  amountStars: bigint,
  feeBps: bigint = WITHDRAW_FEE_BPS
): { feeAmount: bigint; netAmount: bigint; grossAmount: bigint } {
  if (amountStars < 0n) throw new Error('amount must be non-negative');
  const feeAmount = (amountStars * feeBps) / BPS_DENOMINATOR;
  return {
    grossAmount: amountStars,
    feeAmount,
    netAmount: amountStars - feeAmount,
  };
}

/** @deprecated use quoteWithdraw */
export function splitClaim(
  amountStars: bigint,
  feeBps: bigint = WITHDRAW_FEE_BPS
): { toPlayer: bigint; toTreasury: bigint } {
  const q = quoteWithdraw(amountStars, feeBps);
  return { toPlayer: q.netAmount, toTreasury: q.feeAmount };
}

/** Alias matching docs. */
export const TREASURY_FEE_BPS = WITHDRAW_FEE_BPS;
