'use client';

/**
 * One finished hand, flattened for the home-page replay and the printed receipt:
 * seats, board, every accepted agent move (with its table talk), the winner and the pot.
 *
 * Live: the newest complete arena hand with real TEE-signed moves.
 * Offline / empty arena: the built-in demo hand (same seed + moves as /verify/demo).
 */
import { type ArenaMoveRecord, type HandRecord, api } from './api';
import { MOCK_AGENTS, mockArenaMoves } from './arena';
import { engineIdToUiId } from './fairness';
import { fetchLatestHands } from './hooks/use-latest-hand';
import { handName, scoreHand } from './poker-eval';
import { type HandVerdict, demoRecord, isUiSpace, verdictOf, verifyHand } from './verify-hand';

import { useQuery } from '@tanstack/react-query';

export type HandSeat = {
  seat: number;
  playerId: string;
  name: string;
  /** UI card ids; empty when not shown. */
  hole: number[];
  folded: boolean;
  /** Net chips this hand (from the ledger), when known. */
  delta?: number;
};

export type HandStep = {
  seatIndex: number;
  name: string;
  action: string;
  amount?: number | null;
  line?: string;
  model: string;
};

export type HandSummary = {
  source: 'live' | 'demo';
  handId: string;
  gameId: string;
  tableName: string;
  createdAt?: string;
  seedHash: string;
  seats: HandSeat[];
  /** UI card ids. */
  board: number[];
  steps: HandStep[];
  moves: ArenaMoveRecord[];
  winner?: { name: string; net: number; handName?: string };
  pot?: number;
  verdict: HandVerdict;
  verifyHref: string;
};

/** The agent's table talk, pulled out of the signed completion. */
export function lineOf(move: ArenaMoveRecord): string | undefined {
  const own = (move as { line?: unknown }).line;
  if (typeof own === 'string' && own.trim()) return own.trim();
  if (!move.responseBody) return undefined;
  try {
    const body = JSON.parse(move.responseBody) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? '';
    const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
    const line = (JSON.parse(json) as { line?: unknown }).line;
    if (typeof line !== 'string') return undefined;
    // Small models sometimes prefix a garbled token ("JsTh. Raising…"): drop a leading word with odd inner caps.
    const clean = line.trim().replace(/^[A-Za-z]*[a-z][A-Z][A-Za-z]*[.:,]?\s+/, '');
    return clean ? clean.slice(0, 90) : undefined;
  } catch {
    return undefined;
  }
}

function deltasOf(record: HandRecord): Record<string, number> {
  const d = record.deltas;
  if (!d) return {};
  if (Array.isArray(d)) return Object.fromEntries(d.map(([k, v]) => [k, Number(v)]));
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Number(v)]));
}

/** Flatten a hand record + its accepted moves. Moves may be empty (non-arena hands). */
export function summarizeHand(
  record: HandRecord,
  moves: ArenaMoveRecord[],
  opts: { source: 'live' | 'demo'; tableName?: string; lines?: Record<number, string>; pot?: number; deltas?: Record<string, number> }
): HandSummary {
  const toUi = (ids: number[]) => (isUiSpace(record) ? ids : ids.map(engineIdToUiId));
  const sorted = [...record.seats].sort((a, b) => a.seat - b.seat);
  const folded = new Set(moves.filter((m) => m.action === 'fold').map((m) => m.playerId));
  const deltas = opts.deltas ?? deltasOf(record);
  const board = toUi((record.community ?? []).filter((c) => c >= 0));
  const seats: HandSeat[] = sorted.map((s) => ({
    seat: s.seat,
    playerId: s.playerId,
    name: s.nickname,
    hole: toUi((s.holeCards ?? []).filter((c) => c >= 0)),
    folded: folded.has(s.playerId),
    ...(s.playerId in deltas ? { delta: deltas[s.playerId] } : {}),
  }));
  const steps: HandStep[] = moves.map((m, i) => {
    const idx = seats.findIndex((s) => s.playerId === m.playerId || s.name === m.nickname);
    return {
      seatIndex: Math.max(0, idx),
      name: m.nickname ?? seats[idx]?.name ?? 'Agent',
      action: m.action,
      amount: m.amount,
      line: opts.lines?.[i] ?? lineOf(m),
      model: m.model,
    };
  });

  // Winner: biggest positive delta; else best showdown hand among those still in.
  let winner: HandSummary['winner'];
  const withDelta = seats.filter((s) => typeof s.delta === 'number');
  if (withDelta.length > 0) {
    const top = [...withDelta].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0]!;
    if ((top.delta ?? 0) > 0) {
      winner = {
        name: top.name,
        net: top.delta!,
        ...(top.hole.length === 2 && board.length === 5 && !top.folded ? { handName: handName([...top.hole, ...board]) } : {}),
      };
    }
  }
  if (!winner && board.length === 5) {
    const live = seats.filter((s) => !s.folded && s.hole.length === 2);
    const best = [...live].sort((a, b) => scoreHand([...b.hole, ...board]) - scoreHand([...a.hole, ...board]))[0];
    if (best) winner = { name: best.name, net: 0, handName: handName([...best.hole, ...board]) };
  }
  // Pot ≈ everything the losers put in + what the winner matched (the biggest single loss).
  const losses = withDelta.filter((s) => (s.delta ?? 0) < 0).map((s) => -(s.delta ?? 0));
  const pot = opts.pot ?? (losses.length > 0 ? losses.reduce((a, b) => a + b, 0) + Math.max(...losses) : undefined);

  const { checks } = verifyHand(record);
  return {
    source: opts.source,
    handId: record.handId,
    gameId: record.gameId,
    tableName: opts.tableName ?? 'The back room',
    createdAt: (record as { createdAt?: string }).createdAt,
    seedHash: record.seedHash,
    seats,
    board,
    steps,
    moves,
    winner,
    pot,
    verdict: verdictOf(checks),
    verifyHref: opts.source === 'demo' ? '/verify/demo' : `/verify/${encodeURIComponent(record.handId)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Demo hand: /verify/demo's seed, the demo moves, lines in character  */
/* ------------------------------------------------------------------ */

const DEMO_LINES: Record<number, string> = {
  0: 'Forty. I’ve folded since Tuesday. Draw your own conclusions.',
  1: 'Call. Let’s see what you’re hiding.',
  2: 'Pot odds say no. So do I.',
  3: 'I’ll keep you company.',
  4: 'Volume, baby. Every hand is a good hand.',
  5: 'Folding. Don’t get used to it.',
  6: 'Your move.',
  7: 'Raise. Somebody has to.',
  8: 'I don’t call light. Remember that.',
  9: 'This one’s yours. The next one isn’t.',
  10: 'Sure.',
};

export function demoHand(): HandSummary {
  const record = demoRecord();
  const moves = mockArenaMoves();
  // Preflop: four players put in 40; the flop raise to 120 is called twice → pot 520.
  const put: Record<string, number> = {};
  const preflop = moves.slice(0, 6);
  const flop = moves.slice(6);
  for (const m of preflop) if (m.action !== 'fold') put[m.playerId] = (put[m.playerId] ?? 0) + 40;
  for (const m of flop) if (m.action !== 'fold' && m.action !== 'check') put[m.playerId] = (put[m.playerId] ?? 0) + 120;
  const pot = Object.values(put).reduce((a, b) => a + b, 0);
  // Showdown between whoever is left, with the cards the demo seed deals.
  const pre = summarizeHand(record, moves, { source: 'demo', tableName: 'Arena #1 (demo)', lines: DEMO_LINES, pot });
  const winnerSeat = pre.seats.find((s) => s.name === pre.winner?.name);
  const deltas: Record<string, number> = {};
  for (const a of MOCK_AGENTS) deltas[a.walletAddress] = -(put[a.walletAddress] ?? 0);
  if (winnerSeat) deltas[winnerSeat.playerId] = pot - (put[winnerSeat.playerId] ?? 0);
  return summarizeHand(record, moves, { source: 'demo', tableName: 'Arena #1 (demo)', lines: DEMO_LINES, pot, deltas });
}

async function fetchLastHand(): Promise<HandSummary> {
  const latest = await fetchLatestHands(4);
  for (const h of latest) {
    try {
      const [record, moves] = await Promise.all([api.getHand(h.handId), api.arenaMoves(h.handId)]);
      // A two-seat test hand looks empty under the lamp: only replay real hands with a proper table.
      if (moves.length >= 3 && record.seats.length >= 3) {
        return summarizeHand(record, moves, { source: 'live', tableName: h.gameName });
      }
    } catch {
      /* try the next one */
    }
  }
  return demoHand();
}

/** Latest real hand worth replaying, or the demo hand when the server is offline / empty. */
export function useLastHand() {
  return useQuery({
    queryKey: ['last-hand'],
    queryFn: () => fetchLastHand().catch(() => demoHand()),
    staleTime: 60_000,
    retry: false,
  });
}

/** "12 NOV 14:48" — receipt time, in the viewer's zone. */
export function receiptTime(iso?: string | number): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

/** "Qwen/Qwen3.6-35B-A3B-FP8" → "qwen3.6" */
export function modelTag(model: string): string {
  const tail = (model.split('/').pop() || model).split('-')[0] ?? model;
  return tail.toLowerCase().slice(0, 14);
}
