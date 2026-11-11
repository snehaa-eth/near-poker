/**
 * Turn a (possibly hostile / nonsensical) LLM move into a legal table action with the same
 * emit semantics as scripts/bots-6.ts:
 *   fold  → socket game:fold
 *   check → game:bet amount 0
 *   call  → game:bet amount = highestBet
 *   raise → game:bet amount = raise-to, clamped to [highestBet + minRaise, chipsInPot + stack]
 * (see apps/server/src/poker-bridge.ts mapUiBetToAction). Anything unusable → rule fallback.
 */
import type { Brain } from './nearai.js';
import { legalSummary, type RawMove, type Snapshot } from './prompt.js';

export type Kind = 'fold' | 'check' | 'call' | 'raise';
export type Move = { kind: Kind; amount: number; line: string };
export type DecidedMove = Move & {
  source: 'llm' | 'rules';
  chatId?: string;
  verified?: boolean;
  signingAddress?: string;
  /** why the LLM move was not used */
  fallbackReason?: string;
  latencyMs?: number;
};

/**
 * Legalize a move for this snapshot. Returns null if it cannot be made legal
 * (e.g. "check" facing a bet, raise with no amount, raise when the stack can't cover a call).
 */
export function legalize(m: { action: string; amount?: number; line?: string }, s: Snapshot): Move | null {
  const l = legalSummary(s);
  const line = m.line ?? '';
  let action = m.action;
  if (action === 'bet') action = 'raise';
  if (action === 'all-in' || action === 'allin') {
    return l.canRaise ? { kind: 'raise', amount: l.maxRaiseTo, line } : l.toCall > 0 ? { kind: 'call', amount: s.highestBet, line } : null;
  }
  switch (action) {
    case 'fold':
      return { kind: 'fold', amount: 0, line };
    case 'check':
      return l.toCall === 0 ? { kind: 'check', amount: 0, line } : null;
    case 'call':
      // calling nothing is a check; a short call (toCall ≥ stack) is mapped to all-in by the server
      return l.toCall === 0 ? { kind: 'check', amount: 0, line } : { kind: 'call', amount: s.highestBet, line };
    case 'raise': {
      if (!l.canRaise || m.amount === undefined || !Number.isFinite(m.amount)) return null;
      let to = Math.round(m.amount);
      // tolerate an "increment" answer (e.g. "raise 20" meaning +20) only if it is below the current bet
      if (to <= s.highestBet && s.highestBet > 0) to = s.highestBet + Math.max(to, s.minRaise);
      to = Math.max(l.minRaiseTo, Math.min(l.maxRaiseTo, to));
      // Server quirk: with a live bet but nothing to call (big blind's preflop option) the engine's
      // legal actions don't include 'raise', so mapUiBetToAction throws IllegalBet unless it is an
      // all-in. Check instead of risking a rejected action.
      if (l.toCall === 0 && s.highestBet > 0 && to < l.maxRaiseTo) return { kind: 'check', amount: 0, line };
      return { kind: 'raise', amount: to, line };
    }
    default:
      return null;
  }
}

/** Legalize a rule-bot decision (fixes min-raise / BB-option raises); falls back to check/fold. */
export function legalizeRules(m: Move, s: Snapshot): Move {
  const ok = legalize({ action: m.kind, amount: m.amount, line: m.line }, s);
  if (ok) return ok;
  const toCall = Math.max(0, s.highestBet - s.chipsInPot);
  return toCall === 0 ? { kind: 'check', amount: 0, line: m.line } : { kind: 'fold', amount: 0, line: m.line };
}

/**
 * Ask the brain (if any), validate, otherwise use the rule bot. Never throws.
 */
export async function decideMove(brain: Brain | null, s: Snapshot, rules: () => Move): Promise<DecidedMove> {
  const fallback = (reason?: string, extra: Partial<DecidedMove> = {}): DecidedMove => ({
    ...legalizeRules(rules(), s),
    ...extra,
    source: 'rules',
    fallbackReason: reason,
  });
  if (!brain) return fallback();
  let raw: (RawMove & { chatId: string; verified: boolean; signingAddress?: string; latencyMs: number }) | undefined;
  try {
    raw = await brain.decide(s);
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError' ? 'timeout' : (e as Error)?.message ?? String(e);
    return fallback(msg);
  }
  const m = legalize(raw, s);
  if (!m) return fallback(`illegal move ${JSON.stringify({ action: raw.action, amount: raw.amount })}`, { chatId: raw.chatId });
  return {
    ...m,
    source: 'llm',
    chatId: raw.chatId,
    verified: raw.verified,
    signingAddress: raw.signingAddress,
    latencyMs: raw.latencyMs,
  };
}
