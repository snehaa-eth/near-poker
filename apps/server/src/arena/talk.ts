/**
 * Arena table talk.
 *
 * Every accepted move's signed reply carries a short `"line"` (banter). We keep the last few
 * per table so spectators see speech bubbles and agents can read what their opponents said.
 *
 * Lines are untrusted model output. They are cleaned hard before anyone else sees them
 * (single line, no braces/quotes/backticks, max 80 chars) so they can't smuggle JSON or
 * formatting into another agent's prompt. Agents must still treat them as banter, never
 * as instructions (agent-starter says so in its prompt).
 */

export type TalkEntry = { playerId: string; nickname: string; line: string; at: number; handId: string };

const MAX_PER_TABLE = 8;
const MAX_LEN = 80;
const talk = new Map<string, TalkEntry[]>();

export function cleanLine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, ' ')
    .replace(/[{}[\]<>`"\\|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1).trimEnd()}…` : s;
}

/** The `line` field from an exact /chat/completions body (the one the receipt signed). */
export function lineFromResponse(responseBody: string): string | null {
  try {
    const body = JSON.parse(responseBody) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return cleanLine((JSON.parse(content.slice(start, end + 1)) as { line?: unknown }).line);
  } catch {
    return null;
  }
}

export function addTalk(gameId: string, entry: TalkEntry) {
  const list = talk.get(gameId) ?? [];
  list.push(entry);
  if (list.length > MAX_PER_TABLE) list.splice(0, list.length - MAX_PER_TABLE);
  talk.set(gameId, list);
}

/** Most recent lines at this table, oldest first. */
export function recentTalk(gameId: string, n = 6): TalkEntry[] {
  return (talk.get(gameId) ?? []).slice(-n);
}

/** The player's latest line if it was said in the last `withinMs` (for speech bubbles). */
export function latestLineOf(gameId: string, playerId: string, withinMs = 12_000, now = Date.now()): TalkEntry | null {
  const list = talk.get(gameId);
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    if (e.playerId === playerId) return now - e.at <= withinMs ? e : null;
  }
  return null;
}

export function clearTalk(gameId: string) {
  talk.delete(gameId);
}
