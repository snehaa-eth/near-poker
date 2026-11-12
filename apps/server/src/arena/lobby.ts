/**
 * Agent Arena lobby + automatic hand loop (INTERFACES.md §5.2).
 *
 *  - join: NEAR session, ≥ ARENA_MIN_CHIPS, server has NEARAI_API_KEY (for attestation fetches).
 *  - A table opens when ≥ ARENA_MIN_AGENTS are queued (waiting ARENA_FILL_MS for more, max 6).
 *  - Hands start automatically ARENA_HAND_GAP_MS after the previous one completes; leavers and
 *    busted agents are unseated between hands; < 2 seated → table closes, the rest re-queue.
 */
import { syncChipsFromChain } from '../chips.js';
import {
  actionStart,
  closeArenaTable,
  createArenaTable,
  getGame,
  isGameStarting,
  prepareArenaHand,
} from '../game-store.js';
import { isNearChain } from '../near.js';
import { blindsForLobby, type StoredGame } from '../poker-bridge.js';
import { getAttestationCache } from './attestation.js';
import { ARENA_MAX_SEATS, getArenaConfig } from './config.js';
import { setDeclaredModel } from './moves.js';
import { broadcast, emitTo, errMsg, serial } from './runtime.js';
import { syncTurn } from './turns.js';

export class ArenaError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type Agent = { sessionId: string; nickname: string; walletAddress: string; model: string | null };

type ArenaTable = {
  gameId: string;
  name: string;
  createdAt: number;
  handsPlayed: number;
  agents: Map<string, Agent>;
  leaving: Set<string>;
  nextTimer: ReturnType<typeof setTimeout> | null;
  lastCompletedHand: string | null;
};

const queue: Agent[] = [];
let fillTimer: ReturnType<typeof setTimeout> | null = null;
const tables = new Map<string, ArenaTable>();
const seatOf = new Map<string, string>();
let tableCounter = 0;

/** Tests / shutdown: forget all lobby state and stop timers (tables in Mongo stay). */
export function resetArenaLobby() {
  if (fillTimer) clearTimeout(fillTimer);
  fillTimer = null;
  for (const t of tables.values()) if (t.nextTimer) clearTimeout(t.nextTimer);
  tables.clear();
  seatOf.clear();
  queue.length = 0;
}

export function isHandLive(state: StoredGame | null) {
  const s = state?.nlhe?.street;
  return Boolean(s && s !== 'complete' && s !== 'waiting');
}

// ─── join / leave ───────────────────────────────────────────────────────────

export type JoinResult = { queued: true; position: number } | { gameId: string };

export async function joinArena(
  session: { sessionId: string; nickname: string; walletAddress?: string | null; chips?: number | null },
  body: { model?: unknown } = {}
): Promise<JoinResult> {
  const cfg = getArenaConfig();
  if (!cfg.nearaiApiKey) {
    throw new ArenaError(
      503,
      'ArenaDisabled: this server has no NEARAI_API_KEY, so it cannot fetch model attestations to verify TEE receipts'
    );
  }
  if (!session.walletAddress) throw new ArenaError(403, 'NearAccountRequired: log in with NEP-413 (POST /auth/profile)');

  const seated = seatOf.get(session.sessionId);
  if (seated) {
    tables.get(seated)?.leaving.delete(session.sessionId); // re-join cancels a pending leave
    return { gameId: seated };
  }
  const idx = queue.findIndex((a) => a.sessionId === session.sessionId);
  if (idx >= 0) return { queued: true, position: idx + 1 };

  let model: string | null = null;
  if (body.model !== undefined && body.model !== null && body.model !== '') {
    if (typeof body.model !== 'string' || body.model.length > 128) throw new ArenaError(400, 'BadModel');
    model = body.model;
    const { signers, error } = await getAttestationCache().getSigners(model);
    if (signers.length === 0) {
      throw new ArenaError(
        400,
        error
          ? `AttestationUnavailable: ${error}`
          : `ModelNotAttested: ${model} has no model attestation (gateway-only / Incognito models can't play)`
      );
    }
  }

  let chips = Math.floor(session.chips ?? 0);
  if (isNearChain()) {
    try {
      chips = (await syncChipsFromChain(session.sessionId)).chips;
    } catch (e) {
      console.warn('[arena] vault sync at join failed:', errMsg(e));
    }
  }
  if (chips < cfg.minChips) {
    throw new ArenaError(400, `InsufficientChips: need ${cfg.minChips} chips in the vault, have ${chips}`);
  }

  // Re-check after the awaits above (two concurrent joins by the same session).
  if (seatOf.has(session.sessionId)) return { gameId: seatOf.get(session.sessionId)! };
  const again = queue.findIndex((a) => a.sessionId === session.sessionId);
  if (again >= 0) return { queued: true, position: again + 1 };

  queue.push({ sessionId: session.sessionId, nickname: session.nickname, walletAddress: session.walletAddress, model });
  setDeclaredModel(session.sessionId, model);
  await maybeOpenTable();
  const gameId = seatOf.get(session.sessionId);
  if (gameId) return { gameId };
  return { queued: true, position: queue.findIndex((a) => a.sessionId === session.sessionId) + 1 };
}

export type LeaveResult =
  | { left: true; from: 'queue' }
  | { left: true; from: 'table'; gameId: string }
  | { left: false; leaving: true; gameId: string; afterHand: true }
  | { left: false; reason: 'NotInArena' };

export async function leaveArena(sessionId: string): Promise<LeaveResult> {
  const idx = queue.findIndex((a) => a.sessionId === sessionId);
  if (idx >= 0) {
    queue.splice(idx, 1);
    if (queue.length < getArenaConfig().minAgents && fillTimer) {
      clearTimeout(fillTimer);
      fillTimer = null;
    }
    return { left: true, from: 'queue' };
  }
  const gameId = seatOf.get(sessionId);
  const t = gameId ? tables.get(gameId) : undefined;
  if (!gameId || !t) return { left: false, reason: 'NotInArena' };
  t.leaving.add(sessionId);
  const state = await getGame(gameId);
  if (!isHandLive(state) && !isGameStarting(gameId)) {
    await serial(`arena:${gameId}`, () => settleSeats(t));
    if (!seatOf.has(sessionId)) return { left: true, from: 'table', gameId };
  }
  return { left: false, leaving: true, gameId, afterHand: true };
}

// ─── tables ─────────────────────────────────────────────────────────────────

async function maybeOpenTable() {
  const cfg = getArenaConfig();
  if (queue.length >= ARENA_MAX_SEATS || (queue.length >= cfg.minAgents && cfg.fillMs === 0)) {
    await openTable();
    return;
  }
  if (queue.length >= cfg.minAgents && !fillTimer) {
    fillTimer = setTimeout(() => {
      fillTimer = null;
      void openTable().catch((e) => console.error('[arena] open table failed', e));
    }, cfg.fillMs);
  }
}

async function openTable() {
  if (fillTimer) {
    clearTimeout(fillTimer);
    fillTimer = null;
  }
  const cfg = getArenaConfig();
  if (queue.length < cfg.minAgents) return;
  const agents = queue.splice(0, ARENA_MAX_SEATS);
  tableCounter += 1;
  const name = `Agent Arena #${tableCounter}`;
  let state: StoredGame;
  try {
    state = await createArenaTable({
      name,
      minChips: cfg.minChips,
      players: agents.map((a) => ({ id: a.sessionId, nickname: a.nickname })),
    });
  } catch (e) {
    queue.unshift(...agents);
    throw e;
  }
  const t: ArenaTable = {
    gameId: state.gameId,
    name,
    createdAt: Date.now(),
    handsPlayed: 0,
    agents: new Map(agents.map((a) => [a.sessionId, a])),
    leaving: new Set(),
    nextTimer: null,
    lastCompletedHand: null,
  };
  tables.set(t.gameId, t);
  for (const a of agents) {
    seatOf.set(a.sessionId, t.gameId);
    emitTo(a.sessionId, 'arena:seated', { gameId: t.gameId });
  }
  console.log(`[arena] opened ${name} (${t.gameId.slice(0, 8)}) with ${agents.length} agents`);
  scheduleNextHand(t, cfg.handGapMs);
  if (queue.length >= cfg.minAgents) await maybeOpenTable();
}

function scheduleNextHand(t: ArenaTable, delayMs: number) {
  if (t.nextTimer || !tables.has(t.gameId)) return;
  t.nextTimer = setTimeout(() => {
    t.nextTimer = null;
    void serial(`arena:${t.gameId}`, () => runNextHand(t)).catch((e) =>
      console.error('[arena] hand loop error', e)
    );
  }, delayMs);
}

/** Unseat leavers + busted agents; close the table when < 2 remain. Returns seats left. */
async function settleSeats(t: ArenaTable): Promise<number> {
  if (!tables.has(t.gameId)) return 0;
  const { state, removed } = await prepareArenaHand(t.gameId, t.leaving);
  for (const id of removed) {
    t.agents.delete(id);
    t.leaving.delete(id);
    seatOf.delete(id);
    emitTo(id, 'arena:left', { gameId: t.gameId });
  }
  if (removed.length > 0) await broadcast(t.gameId);
  if (state.players.length < 2) {
    await closeTable(t);
    return 0;
  }
  return state.players.length;
}

async function closeTable(t: ArenaTable) {
  if (t.nextTimer) clearTimeout(t.nextTimer);
  t.nextTimer = null;
  tables.delete(t.gameId);
  try {
    await closeArenaTable(t.gameId);
  } catch (e) {
    console.error('[arena] close failed', errMsg(e));
  }
  const requeue: Agent[] = [];
  for (const [id, a] of t.agents) {
    seatOf.delete(id);
    emitTo(id, 'arena:closed', { gameId: t.gameId });
    if (!t.leaving.has(id)) requeue.push(a);
  }
  console.log(`[arena] closed ${t.name} after ${t.handsPlayed} hands`);
  await broadcast(t.gameId);
  if (requeue.length > 0) {
    queue.push(...requeue.filter((a) => !queue.some((q) => q.sessionId === a.sessionId)));
    for (const a of requeue) emitTo(a.sessionId, 'arena:queued', { position: queue.indexOf(a) + 1 });
    await maybeOpenTable();
  }
}

async function runNextHand(t: ArenaTable) {
  if (!tables.has(t.gameId)) return;
  const cfg = getArenaConfig();
  try {
    const seats = await settleSeats(t);
    if (seats < 2) return;
  } catch (e) {
    const msg = errMsg(e);
    if (msg === 'HandInProgress' || msg === 'HandStarting') return; // completion re-schedules
    console.error(`[arena] ${t.gameId.slice(0, 8)} seat check failed: ${msg}`);
    scheduleNextHand(t, cfg.handGapMs);
    return;
  }
  try {
    await actionStart(t.gameId, undefined, { arena: true });
    t.handsPlayed += 1;
    await broadcast(t.gameId);
  } catch (e) {
    const msg = errMsg(e);
    if (msg === 'HandInProgress' || msg === 'HandStarting') return;
    if (msg === 'NotEnoughFundedPlayers' || msg === 'NotEnoughPlayers') {
      await closeTable(t);
      return;
    }
    console.error(`[arena] ${t.gameId.slice(0, 8)} hand start failed: ${msg}`);
    scheduleNextHand(t, cfg.handGapMs);
  }
}

/** Called after every save of an arena table (game-store listener). */
export function onArenaState(state: StoredGame) {
  syncTurn(state);
  const t = tables.get(state.gameId);
  if (!t) return;
  const handId = state.fairness?.handId;
  if (state.nlhe?.street === 'complete' && handId && t.lastCompletedHand !== handId) {
    t.lastCompletedHand = handId;
    scheduleNextHand(t, getArenaConfig().handGapMs);
  }
}

// ─── read models ────────────────────────────────────────────────────────────

export function queueSnapshot() {
  return queue.map((a, i) => ({ position: i + 1, nickname: a.nickname, walletAddress: a.walletAddress }));
}

export function arenaSeatOf(sessionId: string) {
  return seatOf.get(sessionId) ?? null;
}

export async function listArenaTables() {
  const out = [];
  for (const t of tables.values()) {
    const state = await getGame(t.gameId);
    if (!state) continue;
    const minChips = Math.max(0, Math.floor(state.minChips ?? getArenaConfig().minChips));
    const liveBlinds = state.nlhe?.config;
    const blinds = liveBlinds
      ? { smallBlind: liveBlinds.smallBlind, bigBlind: liveBlinds.bigBlind }
      : blindsForLobby(minChips);
    const stacks = state.nlhe ? Object.fromEntries(state.nlhe.players.map((p) => [p.id, p.stack])) : {};
    out.push({
      gameId: t.gameId,
      name: t.name,
      minChips,
      smallBlind: blinds.smallBlind,
      bigBlind: blinds.bigBlind,
      seats: [...state.players]
        .sort((a, b) => a.seat - b.seat)
        .map((p) => {
          const a = t.agents.get(p.id);
          return {
            seat: p.seat,
            playerId: p.id,
            nickname: p.nickname,
            walletAddress: a?.walletAddress,
            ...(a?.model ? { model: a.model } : {}),
            ...(stacks[p.id] !== undefined ? { chips: stacks[p.id] } : {}),
            leaving: t.leaving.has(p.id),
          };
        }),
      handsPlayed: t.handsPlayed,
      status: isGameStarting(t.gameId) ? 'dealing' : isHandLive(state) ? 'playing' : 'between-hands',
      handId: state.fairness?.handId ?? null,
      createdAt: new Date(t.createdAt).toISOString(),
    });
  }
  return out;
}
