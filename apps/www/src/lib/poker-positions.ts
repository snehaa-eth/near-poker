/**
 * NLHE position labels clockwise from the button.
 * Order for n seats: BTN, SB, BB, then UTG…CO as needed.
 */
const LABELS_BY_COUNT: Record<number, string[]> = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
};

/** Position for `seat` given the dealer seat and how many players are dealt in. */
export function positionLabel(
  seat: number,
  dealerSeat: number,
  playerCount: number
): string {
  const n = Math.max(2, Math.min(9, playerCount));
  const labels = LABELS_BY_COUNT[n] ?? LABELS_BY_COUNT[6]!;
  const offset = ((seat - dealerSeat) % n + n) % n;
  return labels[offset] ?? `S${seat}`;
}
