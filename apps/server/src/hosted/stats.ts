/**
 * Live arena stats for hosted agents, read through the arena's PUBLIC HTTP API
 * (GET /arena/leaderboard, GET /arena/tables) on this same server, like any agent would.
 * Cached for a few seconds.
 */
import { SessionModel } from '../db.js';
import { isNearChain, viewVaultBalance, yoctoToChips } from '../near.js';

export type ArenaStats = { hands: number; netChips: number; movesVerified: number };
type Seat = { walletAddress?: string; nickname?: string };
type Table = { gameId: string; name?: string; seats?: Seat[] | number };

let port: number | null = null;
export function setStatsPort(p: number) {
  port = p;
}

type Cache = { at: number; lb: Map<string, ArenaStats>; tables: Table[] };
let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;

async function load(): Promise<Cache> {
  if (cache && Date.now() - cache.at < 3000) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const lb = new Map<string, ArenaStats>();
    let tables: Table[] = [];
    if (port) {
      const base = `http://localhost:${port}`;
      const [l, t] = await Promise.all([
        fetch(`${base}/arena/leaderboard?limit=200`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${base}/arena/tables`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      for (const e of ((l as { entries?: Array<ArenaStats & { walletAddress: string }> } | null)?.entries ?? [])) {
        if (e.walletAddress) lb.set(e.walletAddress, { hands: e.hands ?? 0, netChips: e.netChips ?? 0, movesVerified: e.movesVerified ?? 0 });
      }
      tables = ((t as { tables?: Table[] } | null)?.tables ?? []) as Table[];
    }
    const c: Cache = { at: Date.now(), lb, tables };
    cache = c;
    return c;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function statsFor(wallet: string): Promise<ArenaStats> {
  return (await load()).lb.get(wallet) ?? { hands: 0, netChips: 0, movesVerified: 0 };
}

export async function tableOf(wallet: string): Promise<{ gameId: string; name?: string } | null> {
  for (const t of (await load()).tables) {
    if (Array.isArray(t.seats) && t.seats.some((s) => s.walletAddress === wallet)) return { gameId: t.gameId, name: t.name };
  }
  return null;
}

/** Chips: vault balance (CHAIN=near) or the off-chain session balance. */
export async function chipsOf(wallet: string): Promise<number | null> {
  if (isNearChain()) {
    try {
      return yoctoToChips(await viewVaultBalance(wallet));
    } catch {
      /* fall back to the session */
    }
  }
  const s = await SessionModel.findOne({ walletAddress: wallet }).select('chips').lean();
  return s ? (s.chips ?? 0) : null;
}

export function clearStatsCache() {
  cache = null;
}
