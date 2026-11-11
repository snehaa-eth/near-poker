/** 1 NIGHT = 1_000_000 Stars (ledger base units). */
export const STARS_PER_NIGHT = 1_000_000n;

export function formatNightFromStars(stars: bigint, maxFractionDigits = 6): string {
  const negative = stars < 0n;
  const abs = negative ? -stars : stars;
  const whole = abs / STARS_PER_NIGHT;
  const frac = abs % STARS_PER_NIGHT;
  if (frac === 0n || maxFractionDigits === 0) {
    return `${negative ? '-' : ''}${whole.toString()}`;
  }
  const fracStr = frac
    .toString()
    .padStart(6, '0')
    .slice(0, maxFractionDigits)
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fracStr ? `.${fracStr}` : ''}`;
}

export function sumBalances(balances: Record<string, bigint>): bigint {
  return Object.values(balances).reduce((acc, v) => acc + v, 0n);
}
