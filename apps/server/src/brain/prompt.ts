/**
 * Prompt construction + output parsing for the LLM poker brain.
 *
 * Privacy: the user message is built ONLY from a `Snapshot`, which carries the acting
 * bot's own hole cards and public table state. There is no field for anyone else's
 * hole cards (the server hides them from this bot's view anyway).
 */

export type Street = 'PreFlop' | 'Flop' | 'Turn' | 'River' | string;

/** What one bot is allowed to know when it acts. All chip amounts are integers. */
export type Snapshot = {
  persona: string;
  /** own hole cards, formatted like ["Ah", "Kd"] */
  hole: string[];
  /** public board, formatted like ["7c", "8d", "Ts"] */
  board: string[];
  street: Street;
  pot: number;
  /** current highest street bet ("raise-to" scale) */
  highestBet: number;
  /** what this bot already put in on this street */
  chipsInPot: number;
  /** min raise increment (engine `minRaise`); min raise-to = highestBet + minRaise */
  minRaise: number;
  /** chips behind */
  stack: number;
  seat: number;
  dealerSeat?: number;
  numPlayers: number;
  /** players not folded in this hand (incl. this bot) */
  activePlayers: number;
  /** public actions so far this hand, oldest first, e.g. "Maniac raises to 40" */
  recent: string[];
};

export type RawMove = { action: string; amount?: number; line: string };

const PERSONAS: Record<string, string> = {
  Rock: 'You are Rock: an ultra-tight, patient nit. You fold most hands, only put money in with strong holdings, and almost never bluff. Table talk: dry, terse, stoic, a little smug about discipline.',
  Maniac: 'You are Maniac: hyper-aggressive and loose. You love to raise, re-raise and apply pressure, and you bluff often. Table talk: loud, cocky, chaotic hype.',
  Shark: 'You are Shark: a solid, aggressive winning regular. Tight-aggressive ranges, good sizing, selective well-timed bluffs. Table talk: cool, cutting, quietly menacing.',
  Calley: 'You are Calley: a loose-passive calling station. You hate folding, rarely raise, and call down light because "you might be bluffing". Table talk: cheerful, chatty, curious.',
  Fox: 'You are Fox: tricky and deceptive. You mix in check-raises, floats and bluffs, and like to represent hands you do not have. Table talk: sly, teasing, riddling.',
  Owl: 'You are Owl: a thoughtful, math-driven player. You reason about pot odds and position, and play balanced, mostly tight. Table talk: wise, dry, professorial quips.',
};

export function personaPrompt(persona: string): string {
  return PERSONAS[persona] ?? `You are ${persona}: a competent No-Limit Hold'em player with your own style.`;
}

export function buildSystemPrompt(persona: string): string {
  return [
    personaPrompt(persona),
    "You are playing 6-max No-Limit Texas Hold'em against other AI bots for play chips.",
    'Each turn you get your own two hole cards and the public table state, and you choose ONE legal action.',
    'Also write one short line of table talk ("line"): in character, at most 80 characters, PG-13, playful trash talk.',
    'No slurs, no hate, no sexual content, no threats, never reveal or describe your hole cards in the line.',
    'Reply with ONLY a JSON object, no prose, no markdown:',
    '{"action":"fold|check|call|raise","amount":<integer raise-to total, only when action is raise>,"line":"<≤80 chars>"}',
    '"amount" for a raise is the TOTAL street bet you raise to (not the increment), between min raise-to and max raise-to.',
  ].join('\n');
}

function positionLabel(s: Snapshot): string {
  if (s.dealerSeat === undefined || s.dealerSeat < 0) return `seat ${s.seat}`;
  return s.seat === s.dealerSeat ? `seat ${s.seat} (on the button)` : `seat ${s.seat} (button is seat ${s.dealerSeat})`;
}

export function legalSummary(s: Snapshot) {
  const toCall = Math.max(0, s.highestBet - s.chipsInPot);
  const maxRaiseTo = s.chipsInPot + s.stack;
  const minRaiseTo = Math.min(maxRaiseTo, s.highestBet + Math.max(1, s.minRaise));
  const canRaise = s.stack > toCall;
  const actions = ['fold', toCall === 0 ? 'check' : 'call', ...(canRaise ? ['raise'] : [])];
  return { toCall, minRaiseTo, maxRaiseTo, canRaise, actions };
}

export function buildUserPrompt(s: Snapshot): string {
  const l = legalSummary(s);
  const lines = [
    `Street: ${s.street}`,
    `Your hole cards: ${s.hole.join(' ') || '(none)'}`,
    `Board: ${s.board.join(' ') || '(none yet)'}`,
    `Pot: ${s.pot}`,
    `Your stack: ${s.stack} (already in this street: ${s.chipsInPot})`,
    `To call: ${l.toCall}${l.toCall >= s.stack && l.toCall > 0 ? ' (calling puts you all-in)' : ''}`,
    `Current bet to match: ${s.highestBet}`,
    l.canRaise ? `Raise-to range: min ${l.minRaiseTo}, max ${l.maxRaiseTo} (max = all-in)` : 'Raising is not possible (stack too short).',
    `Position: ${positionLabel(s)}, ${s.numPlayers} players seated, ${s.activePlayers} still in the hand`,
    `Action this hand: ${s.recent.length ? s.recent.slice(-12).join('; ') : '(none yet)'}`,
    `Legal actions: ${l.actions.join(', ')}`,
    'Respond with the JSON object only. /no_think',
  ];
  return lines.join('\n');
}

export function buildMessages(s: Snapshot): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: buildSystemPrompt(s.persona) },
    { role: 'user', content: buildUserPrompt(s) },
  ];
}

/** Find the first balanced {...} object in free text (string-aware). */
function firstJsonObject(text: string): string | null {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        const cand = text.slice(start, i + 1);
        try {
          JSON.parse(cand);
          return cand;
        } catch {
          break; // try the next '{'
        }
      }
    }
  }
  return null;
}

const BANNED = /\b(n[i1]gg|f[a@]gg?ot|retard|kike|spic|chink|tranny)\w*/i;

/** Single line, ≤80 chars, no control chars; drops lines that trip a tiny slur filter. */
export function cleanLine(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (BANNED.test(s)) return '';
  return s.length > 80 ? s.slice(0, 79).trimEnd() + '…' : s;
}

/**
 * Parse model output → RawMove, or null if unusable. Accepts a bare JSON object,
 * JSON inside prose / ```json fences, and strips Qwen-style <think> blocks.
 */
export function parseMove(text: string | undefined | null): RawMove | null {
  if (!text) return null;
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const json = firstJsonObject(stripped);
  if (!json) return null;
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const action = typeof r.action === 'string' ? r.action.trim().toLowerCase() : '';
  if (!['fold', 'check', 'call', 'raise', 'bet', 'all-in', 'allin'].includes(action)) return null;
  const amt = typeof r.amount === 'number' ? r.amount : typeof r.amount === 'string' ? Number(r.amount) : undefined;
  return {
    action,
    amount: amt !== undefined && Number.isFinite(amt) ? Math.round(amt) : undefined,
    line: cleanLine(r.line),
  };
}
