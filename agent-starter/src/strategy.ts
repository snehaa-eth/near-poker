/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE FILE YOU EDIT.                                              ║
 * ║  Your persona / system prompt and optional pre- and post-rules.          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Ground rules of the arena (enforced by the server, see AGENTS.md):
 *  - Every move must come from a NEAR AI Cloud Confidential-TEE model reply that contains
 *    {"challenge": "<this turn's challenge>", "action": …, "amount": …}. The receipt binds the
 *    exact action/amount the MODEL wrote, so code cannot change the move after the fact.
 *  - That is why rules here can only (a) add context to the prompt (`preRule`) and
 *    (b) veto a reply and ask the model once more with feedback (`postRule`). They can never
 *    substitute their own move.
 *  - Your prompt stays private: only the model's response body is disclosed to the server.
 */

export type Kind = 'fold' | 'check' | 'call' | 'raise';

/** Everything your agent knows when it acts (own hole cards + public state). Chips are integers. */
export type Snapshot = {
  hole: string[]; // e.g. ["Ah","Kd"]
  board: string[]; // e.g. ["7c","8d","Ts"]
  street: string; // PreFlop | Flop | Turn | River
  pot: number;
  highestBet: number; // current street bet to match ("raise-to" scale)
  chipsInPot: number; // what you already put in this street
  minRaise: number; // min raise increment; min raise-to = highestBet + minRaise
  stack: number; // chips behind
  seat: number;
  dealerSeat?: number;
  numPlayers: number;
  activePlayers: number;
  /** opponents still in the hand: nickname, stack, chips in this street */
  opponents: Array<{ nickname: string; stack: number; chipsInPot: number; folded: boolean }>;
};

export type Legal = { toCall: number; minRaiseTo: number; maxRaiseTo: number; canRaise: boolean; actions: Kind[] };

export function legalSummary(s: Snapshot): Legal {
  const toCall = Math.max(0, s.highestBet - s.chipsInPot);
  const maxRaiseTo = s.chipsInPot + s.stack;
  const minRaiseTo = Math.min(maxRaiseTo, s.highestBet + Math.max(1, s.minRaise));
  const canRaise = s.stack > toCall;
  const actions: Kind[] = ['fold', toCall === 0 ? 'check' : 'call', ...(canRaise ? (['raise'] as Kind[]) : [])];
  return { toCall, minRaiseTo, maxRaiseTo, canRaise, actions };
}

// ─── 1. persona ─────────────────────────────────────────────────────────────

export const NICKNAME = process.env.AGENT_NICKNAME || undefined;

/** Default: a solid tight-aggressive (TAG) regular. Rewrite freely. */
export const PERSONA = [
  'You are "Tag", a disciplined tight-aggressive No-Limit Hold\'em regular.',
  'Preflop: play a tight range (pairs, strong broadways, suited aces/connectors in late position); raise rather than limp; fold weak offsuit hands to raises.',
  'Postflop: bet strong hands and good draws for value/protection (≈ half to two-thirds pot); check-fold air facing big bets; respect pot odds when calling.',
  'Bluff rarely and only with equity. Never call off your stack with a marginal hand.',
  'Table talk ("line"): calm, dry, confident, at most 80 characters, PG-13, never reveal your cards.',
].join('\n');

// ─── 2. prompt (the challenge MUST be echoed back) ──────────────────────────

export function buildSystemPrompt(): string {
  return [
    PERSONA,
    "You are playing 6-max No-Limit Texas Hold'em against other AI agents in the Dark Table Agent Arena.",
    'Each turn you receive your two hole cards, the public table state and a one-time turn challenge.',
    'Reply with ONLY a JSON object, no prose, no markdown, exactly these keys:',
    '{"challenge":"<the turn challenge, copied exactly>","action":"fold|check|call|raise","amount":<integer raise-to total, only for raise>,"line":"<table talk, ≤80 chars>"}',
    '"amount" for a raise is the TOTAL street bet you raise to (not the increment), between the min and max raise-to.',
    'Only choose one of the listed legal actions.',
  ].join('\n');
}

export function buildUserPrompt(s: Snapshot, challenge: string, extra: string[] = []): string {
  const l = legalSummary(s);
  const pos =
    s.dealerSeat === undefined || s.dealerSeat < 0
      ? `seat ${s.seat}`
      : s.seat === s.dealerSeat
        ? `seat ${s.seat} (on the button)`
        : `seat ${s.seat} (button is seat ${s.dealerSeat})`;
  const opps = s.opponents
    .filter((o) => !o.folded)
    .map((o) => `${o.nickname} stack ${o.stack} in ${o.chipsInPot}`)
    .join('; ');
  return [
    `Turn challenge: ${challenge}`,
    `Street: ${s.street}`,
    `Your hole cards: ${s.hole.join(' ') || '(none)'}`,
    `Board: ${s.board.join(' ') || '(none yet)'}`,
    `Pot: ${s.pot}`,
    `Your stack: ${s.stack} (already in this street: ${s.chipsInPot})`,
    `To call: ${l.toCall}${l.toCall >= s.stack && l.toCall > 0 ? ' (calling puts you all-in)' : ''}`,
    `Current bet to match: ${s.highestBet}`,
    l.canRaise ? `Raise-to range: min ${l.minRaiseTo}, max ${l.maxRaiseTo} (max = all-in)` : 'Raising is not possible.',
    `Position: ${pos}, ${s.numPlayers} seated, ${s.activePlayers} still in the hand`,
    `Opponents in the hand: ${opps || '(none)'}`,
    ...extra,
    `Legal actions: ${l.actions.join(', ')}`,
    `Respond with the JSON object only and set "challenge" to "${challenge}". /no_think`,
  ].join('\n');
}

// ─── 3. optional rules ──────────────────────────────────────────────────────

/**
 * Pre-rule: extra lines added to the prompt (computed hints, notes about opponents, …).
 * It cannot decide the move — the model does.
 */
export function preRule(s: Snapshot): string[] {
  const l = legalSummary(s);
  if (l.toCall === 0) return [];
  const odds = l.toCall / (s.pot + l.toCall);
  return [`Pot odds: you need ${(odds * 100).toFixed(0)}% equity to call profitably.`];
}

export type ModelMove = { action: string; amount?: number; line: string };

/**
 * Post-rule: return null to accept the model's move, or a short reason to veto it; the agent then
 * asks the model ONE more time with that reason (costs one more LLM call). Illegal moves
 * (e.g. "check" facing a bet, raise outside the range) are vetoed automatically before this runs.
 */
export function postRule(move: ModelMove, s: Snapshot): string | null {
  const l = legalSummary(s);
  // Example guard: don't fold when checking is free.
  if (move.action === 'fold' && l.toCall === 0) return 'Folding is pointless when you can check for free.';
  return null;
}
