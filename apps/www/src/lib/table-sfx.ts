import type { PublicGameView } from '~/lib/api';
import { playSound, type SoundName } from '~/lib/sounds';

/** Map a poker action name to a Pepper `/audio-effects` clip. */
export function soundForAction(
  action: string,
  opts?: { allIn?: boolean }
): { name: SoundName; volume: number } {
  const a = action.toLowerCase();
  if (opts?.allIn || a === 'all-in' || a === 'allin') {
    return { name: 'shuffle', volume: 0.75 };
  }
  if (a === 'fold') return { name: 'cardFlip', volume: 0.55 };
  if (a === 'check') return { name: 'cardFlip', volume: 0.45 };
  if (a === 'call') return { name: 'chipsBet', volume: 0.7 };
  if (a === 'bet' || a === 'raise') return { name: 'chipsBet', volume: 0.85 };
  return { name: 'cardFlip', volume: 0.4 };
}

export function playActionSound(
  action: string,
  opts?: { allIn?: boolean; volumeScale?: number }
) {
  const { name, volume } = soundForAction(action, opts);
  playSound(name, volume * (opts?.volumeScale ?? 1));
}

type SeatSnap = {
  folded: boolean;
  chipsInPot: number;
};

type TableSnap = {
  handId: string | null;
  arena: boolean;
  pot: number;
  highestBet: number;
  boardLen: number;
  gameEnded: boolean;
  winnerId: string | null;
  nextPlayerId: string | null;
  seats: Record<string, SeatSnap>;
};

function snapshot(view: PublicGameView): TableSnap {
  const seats: Record<string, SeatSnap> = {};
  for (const p of view.players) {
    seats[p.id] = { folded: p.folded, chipsInPot: p.chipsInPot };
  }
  return {
    handId: view.fairness?.handId ?? null,
    arena: Boolean(view.arena),
    pot: view.pot,
    highestBet: view.highestBet,
    boardLen: view.communityCards.filter((c) => c != null && c >= 0).length,
    gameEnded: Boolean(view.gameEnded) || view.round === 'End',
    winnerId: view.winnerId ?? null,
    nextPlayerId: view.nextPlayerId ?? null,
    seats,
  };
}

/**
 * Diff successive public views and play SFX for deals, folds, bets, and wins.
 * Skips the seated human's own seat changes (ActionBar already SFX'd those).
 */
export function createTableSfx() {
  let prev: TableSnap | null = null;
  let primed = false;

  return (view: PublicGameView) => {
    const next = snapshot(view);
    if (!primed) {
      primed = true;
      prev = next;
      return;
    }
    if (!prev) {
      prev = next;
      return;
    }

    const me = view.myPlayerId;
    const skipOwn = Boolean(me);

    // New hand → shuffle + deal
    if (next.handId && next.handId !== prev.handId) {
      playSound('shuffle', 0.55);
      playSound('cardDeal', 0.7);
      prev = next;
      return;
    }

    // Board deal (flop / turn / river)
    if (next.boardLen > prev.boardLen) {
      playSound('cardDeal', next.boardLen >= 5 ? 0.8 : 0.7);
    }

    // Hand finished
    if (next.gameEnded && !prev.gameEnded) {
      const iWon = Boolean(me && next.winnerId === me);
      playSound(iWon ? 'win' : 'chipsShuffle', iWon ? 0.9 : 0.6);
      prev = next;
      return;
    }

    // Arena: fold/check/call/raise SFX come from ArenaMoveFeed (exact TEE action).
    if (next.arena) {
      prev = next;
      return;
    }

    // Per-seat: fold / chips into pot
    for (const [id, seat] of Object.entries(next.seats)) {
      const before = prev.seats[id];
      if (!before) continue;
      if (skipOwn && id === me) continue;

      if (seat.folded && !before.folded) {
        playActionSound('fold');
        continue;
      }

      if (seat.chipsInPot > before.chipsInPot) {
        const raised = next.highestBet > prev.highestBet;
        const stacks = view.stacksByPlayerId?.[id] ?? 0;
        const allIn = stacks <= 0;
        if (allIn) playActionSound('all-in');
        else if (raised) playActionSound('raise');
        else if (seat.chipsInPot >= next.highestBet) playActionSound('call');
        else playActionSound('bet');
      }
    }

    // Check: turn advanced, no chip/fold change for the previous actor
    if (
      next.nextPlayerId &&
      prev.nextPlayerId &&
      next.nextPlayerId !== prev.nextPlayerId &&
      next.highestBet === prev.highestBet &&
      next.pot === prev.pot &&
      next.boardLen === prev.boardLen &&
      !next.gameEnded
    ) {
      const actor = prev.nextPlayerId;
      if (!(skipOwn && actor === me)) {
        const before = prev.seats[actor];
        const after = next.seats[actor];
        if (
          before &&
          after &&
          !after.folded &&
          after.chipsInPot === before.chipsInPot
        ) {
          playActionSound('check');
        }
      }
    }

    prev = next;
  };
}
