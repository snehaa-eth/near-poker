/** 1 NEAR = 10^24 yoctoNEAR. */
export const YOCTO_PER_NEAR = 10n ** 24n;
/** 1 chip = 0.001 NEAR = 10^21 yocto (INTERFACES §3). */
export const YOCTO_PER_CHIP = 10n ** 21n;
export const CHIPS_PER_NEAR = 1000;

/** "1.5" NEAR → yocto string. Throws on malformed input. */
export function nearToYocto(near: string | number): string {
  const raw = typeof near === 'number' ? near.toFixed(24) : near.trim();
  if (!/^\d*(\.\d*)?$/.test(raw) || raw === '' || raw === '.') {
    throw new Error(`Invalid NEAR amount: ${near}`);
  }
  const [whole = '0', frac = ''] = raw.split('.');
  const fracPadded = (frac + '0'.repeat(24)).slice(0, 24);
  return (
    BigInt(whole || '0') * YOCTO_PER_NEAR +
    BigInt(fracPadded)
  ).toString();
}

/** yocto → decimal NEAR string, trimmed to `maxFractionDigits`. */
export function formatNearFromYocto(
  yocto: string | bigint,
  maxFractionDigits = 4
): string {
  const value = typeof yocto === 'bigint' ? yocto : BigInt(yocto || '0');
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / YOCTO_PER_NEAR;
  const frac = abs % YOCTO_PER_NEAR;
  const fracStr = frac
    .toString()
    .padStart(24, '0')
    .slice(0, maxFractionDigits)
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fracStr ? `.${fracStr}` : ''}`;
}

export function chipsToYocto(chips: number): string {
  return (BigInt(Math.floor(chips)) * YOCTO_PER_CHIP).toString();
}

export function chipsFromNear(near: number): number {
  if (!Number.isFinite(near) || near <= 0) return 0;
  return Math.floor(Math.round(near * 1e9) / 1e6);
}

export function nearFromChips(chips: number): number {
  if (!Number.isFinite(chips) || chips <= 0) return 0;
  return chips / CHIPS_PER_NEAR;
}
