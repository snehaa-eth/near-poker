/**
 * Compact display: K (thousand), L (lakh / 1e5), M (million), B (billion).
 */
export function formatTokens(value: number | string | bigint): string {
  const n =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'string'
        ? Number(value)
        : value;
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `${sign}${trim(abs / 1_000_000_000_000)}T`;
  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`;
  if (abs >= 100_000) return `${sign}${trim(abs / 100_000)}L`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}K`;
  return `${sign}${Math.round(abs)}`;
}

function trim(n: number) {
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
  return n.toFixed(2).replace(/\.?0+$/, '');
}
