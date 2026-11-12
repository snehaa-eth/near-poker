import { useEffect, useRef, useState } from 'react';

import type { PublicGameView } from '~/lib/api';
import { formatTokens } from '~/lib/format';

export type SeatActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';

export type SeatActionFlash = {
  /** Unique id so the same action twice still remounts the toast. */
  id: string;
  action: SeatActionKind | string;
  amount?: number | null;
};

export function actionFlashLabel(flash: SeatActionFlash): string {
  const a = String(flash.action).toLowerCase();
  if (a === 'fold') return 'FOLD';
  if (a === 'check') return 'CHECK';
  if (a === 'call') {
    return flash.amount != null ? `CALL ${formatTokens(flash.amount)}` : 'CALL';
  }
  if (a === 'bet') {
    return flash.amount != null ? `BET ${formatTokens(flash.amount)}` : 'BET';
  }
  if (a === 'raise') {
    return flash.amount != null ? `RAISE ${formatTokens(flash.amount)}` : 'RAISE';
  }
  if (a === 'all-in' || a === 'allin') {
    return flash.amount != null ? `ALL IN ${formatTokens(flash.amount)}` : 'ALL IN';
  }
  return String(flash.action).toUpperCase();
}

export function actionFlashTone(action: string): string {
  const a = action.toLowerCase();
  if (a === 'fold') return 'bg-neutral-800 text-white';
  if (a === 'check') return 'bg-sky-500 text-white';
  if (a === 'call') return 'bg-emerald-500 text-white';
  if (a === 'bet' || a === 'raise') return 'bg-amber-500 text-neutral-950';
  if (a === 'all-in' || a === 'allin') return 'bg-rose-600 text-white';
  return 'bg-neutral-900 text-white';
}

type SeatSnap = { folded: boolean; chipsInPot: number };

/**
 * Infer seat action toasts from public view diffs (works for live tables).
 * Skips the first snapshot so joining mid-hand doesn't spam.
 */
export function useViewActionFlashes(view: PublicGameView) {
  const [flashes, setFlashes] = useState<Record<string, SeatActionFlash>>({});
  const prevRef = useRef<{
    nextPlayerId: string | null;
    highestBet: number;
    pot: number;
    boardLen: number;
    seats: Record<string, SeatSnap>;
  } | null>(null);

  useEffect(() => {
    const seats: Record<string, SeatSnap> = {};
    for (const p of view.players) {
      seats[p.id] = { folded: p.folded, chipsInPot: p.chipsInPot };
    }
    const next = {
      nextPlayerId: view.nextPlayerId ?? null,
      highestBet: view.highestBet,
      pot: view.pot,
      boardLen: view.communityCards.filter((c) => c != null && c >= 0).length,
      seats,
    };
    const prev = prevRef.current;
    prevRef.current = next;
    if (!prev) return;

    const push = (
      playerId: string,
      action: SeatActionKind,
      amount?: number | null
    ) => {
      setFlashes((cur) => ({
        ...cur,
        [playerId]: {
          id: `${playerId}-${action}-${Date.now()}`,
          action,
          amount: amount ?? null,
        },
      }));
    };

    for (const [id, seat] of Object.entries(next.seats)) {
      const before = prev.seats[id];
      if (!before) continue;
      if (seat.folded && !before.folded) {
        push(id, 'fold');
        continue;
      }
      if (seat.chipsInPot > before.chipsInPot) {
        const delta = seat.chipsInPot - before.chipsInPot;
        const raised = next.highestBet > prev.highestBet;
        const stacks = view.stacksByPlayerId?.[id] ?? 0;
        if (stacks <= 0) push(id, 'all-in', seat.chipsInPot);
        else if (raised) push(id, 'raise', seat.chipsInPot);
        else if (seat.chipsInPot >= next.highestBet && prev.highestBet > before.chipsInPot)
          push(id, 'call', delta);
        else if (prev.highestBet === 0) push(id, 'bet', seat.chipsInPot);
        else push(id, 'call', delta);
      }
    }

    if (
      next.nextPlayerId &&
      prev.nextPlayerId &&
      next.nextPlayerId !== prev.nextPlayerId &&
      next.highestBet === prev.highestBet &&
      next.pot === prev.pot &&
      next.boardLen === prev.boardLen
    ) {
      const actor = prev.nextPlayerId;
      const before = prev.seats[actor];
      const after = next.seats[actor];
      if (
        before &&
        after &&
        !after.folded &&
        after.chipsInPot === before.chipsInPot
      ) {
        push(actor, 'check');
      }
    }
  }, [view]);

  return flashes;
}

/** Merge external flashes (e.g. arena move feed) over view-inferred ones. */
export function mergeFlashes(
  base: Record<string, SeatActionFlash>,
  extra: Record<string, SeatActionFlash>
) {
  return { ...base, ...extra };
}
