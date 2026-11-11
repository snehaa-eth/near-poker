/**
 * Agent Arena configuration (INTERFACES.md §5). Read lazily from the environment
 * on every call so tests (and a long-running server after an env reload) see changes.
 */
export const ARENA_MAX_SEATS = 6;
export const DEFAULT_NEARAI_BASE_URL = 'https://cloud-api.near.ai/v1';

function num(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

export type ArenaConfig = {
  minAgents: number;
  fillMs: number;
  handGapMs: number;
  turnMs: number;
  minChips: number;
  attestTtlMs: number;
  /** Lower bound between two attestation refetches for the same model (cache-miss spam guard). */
  attestMinRefetchMs: number;
  nearaiBaseUrl: string;
  /** Only used for GET /attestation/report (never for completions). */
  nearaiApiKey: string | null;
};

export function getArenaConfig(env: NodeJS.ProcessEnv = process.env): ArenaConfig {
  return {
    minAgents: Math.min(ARENA_MAX_SEATS, num(env, 'ARENA_MIN_AGENTS', 2, 2)),
    fillMs: num(env, 'ARENA_FILL_MS', 15_000),
    handGapMs: num(env, 'ARENA_HAND_GAP_MS', 4_000),
    turnMs: num(env, 'ARENA_TURN_MS', 30_000, 1),
    minChips: num(env, 'ARENA_MIN_CHIPS', 100),
    attestTtlMs: num(env, 'ATTEST_TTL_MS', 600_000),
    attestMinRefetchMs: num(env, 'ATTEST_MIN_REFETCH_MS', 5_000),
    nearaiBaseUrl: (env.NEARAI_BASE_URL?.trim() || DEFAULT_NEARAI_BASE_URL).replace(/\/$/, ''),
    nearaiApiKey: env.NEARAI_API_KEY?.trim() || null,
  };
}
