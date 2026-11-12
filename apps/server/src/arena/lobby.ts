/**
 * Agent Arena lobby + automatic hand loop (INTERFACES.md §5.2, §5.6).
 *
 *  - join: NEAR session, ≥ ARENA_MIN_CHIPS, server has NEARAI_API_KEY (for attestation fetches).
 *  - A queued agent first takes a free seat at a running table (fullest table with space,
 *    not closing). It is told `arena:seated` at once and dealt in from the NEXT hand
 *    (never mid-hand); spectators see it under `arenaWaiting` ("joining next hand").
 *  - With no free seat, a new table opens when ≥ ARENA_MIN_AGENTS are queued (waiting
 *    ARENA_FILL_MS for more, max 6).
 *  - Hands start automatically ARENA_HAND_GAP_MS after the previous one completes; leavers and
 *    busted agents are unseated between hands (freeing their seat); < 2 seated → table closes,
 *    the rest re-queue.
 *  - Scheduled events (arena/events.ts): registered agents play on dedicated event tables while
 *    the event is live; at the end those tables finish their hand and close.
 */
import { syncChipsFromChain } from '../chips.js';
import { ArenaEventModel, GameModel } from '../db.js';
import {
  actionStart,
  admitArenaPlayers,
  closeArenaTable,
  createArenaTable,
  getGame,
  isGameStarting,
  prepareArenaHand,
  setArenaWaitingProvider,
} from '../game-store.js';
import { isNearChain } from '../near.js';
import { blindsForLobby, type StoredGame } from '../poker-bridge.js';
import { getAttestationCache } from './attestation.js';
import { ARENA_MAX_SEATS, getArenaConfig } from './config.js';
import { setDeclaredModel } from './moves.js';
import { broadcast, emitTo, errMsg, isConnected, serial } from './runtime.js';
import { syncTurn } from './turns.js';

export class ArenaError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type Agent = {
  sessionId: string;
  nickname: string;
  walletAddress: string;
  model: string | null;
  /** Live event this agent plays in (event tables only), or null for the open arena. */
  eventId: string | null;
};

type ArenaTable = {
  gameId: string;
  name: string;
  createdAt: number;
  handsPlayed: number;
  /** Seated in the game state (dealt in). */
  agents: Map<string, Agent>;
  /** Seated between hands: dealt in from the next hand. */
  pending: Map<string, Agent>;
  leaving: Set<string>;
  nextTimer: ReturnType<typeof setTimeout> | null;
  lastCompletedHand: string | null;
  eventId: string | null;
  /** Event over: finish the current hand, then close (no new seats, no new hands). */
  closing: boolean;
};

const queue: Agent[] = [];
/** Fill timers per queue group ('' = open arena, else eventId). */
const fillTimers = new Map<string, ReturnType<typeof setTimeout>>();
const tables = new Map<string, ArenaTable>();
const seatOf = new Map<string, string>();
/** Live events: eventId → name + registered wallets. */
const liveEvents = new Map<string, { name: string; wallets: Set<string> }>();
/** Agents seated at an open-arena table who move to a live event's tables after this hand. */
const transfers = new Map<string, string>();
let tableCounter = 0;
const eventTableCounter = new Map<string, number>();

const groupOf = (a: { eventId: string | null }) => a.eventId ?? '';

setArenaWaitingProvider((gameId) => {
  const t = tables.get(gameId);
  if (!t) return [];
  return [...t.pending.values()].map((a) => ({
    nickname: a.nickname,
    walletAddress: a.walletAddress,
    ...(a.model ? { model: a.model } : {}),
  }));
});

/** Tests / shutdown: forget all lobby state and stop timers (tables in Mongo stay). */
export function resetArenaLobby() {
  for (const t of fillTimers.values()) clearTimeout(t);
  fillTimers.clear();
  for (const t of tables.values()) if (t.nextTimer) clearTimeout(t.nextTimer);
  tables.clear();
  seatOf.clear();
  queue.length = 0;
  liveEvents.clear();
  transfers.clear();
  eventTableCounter.clear();
}

export function isHandLive(state: StoredGame | null) {
  const s = state?.nlhe?.street;
  return Boolean(s && s !== 'complete' && s !== 'waiting');
}

/** The live event (if any) `walletAddress` is registered for. */
function liveEventFor(walletAddress: string | null | undefined): string | null {
  if (!walletAddress) return null;
  for (const [eventId, ev] of liveEvents) if (ev.wallets.has(walletAddress)) return eventId;
  return null;
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

  const chips = await currentChips(session);
  if (chips < cfg.minChips) {
    throw new ArenaError(400, `InsufficientChips: need ${cfg.minChips} chips in the vault, have ${chips}`);
  }

  // Re-check after the awaits above (two concurrent joins by the same session).
  if (seatOf.has(session.sessionId)) return { gameId: seatOf.get(session.sessionId)! };
  const again = queue.findIndex((a) => a.sessionId === session.sessionId);
  if (again >= 0) return { queued: true, position: again + 1 };

  queue.push({
    sessionId: session.sessionId,
    nickname: session.nickname,
    walletAddress: session.walletAddress,
    model,
    eventId: liveEventFor(session.walletAddress),
  });
  setDeclaredModel(session.sessionId, model);
  placeQueued();
  await maybeOpenTables();
  const gameId = seatOf.get(session.sessionId);
  if (gameId) return { gameId };
  return { queued: true, position: queue.findIndex((a) => a.sessionId === session.sessionId) + 1 };
}

/** Session chips, re-synced from the vault first when CHAIN=near. */
export async function currentChips(session: { sessionId: string; chips?: number | null }) {
  let chips = Math.floor(session.chips ?? 0);
  if (isNearChain()) {
    try {
      chips = (await syncChipsFromChain(session.sessionId)).chips;
    } catch (e) {
      console.warn('[arena] vault sync failed:', errMsg(e));
    }
  }
  return chips;
}

export type LeaveResult =
  | { left: true; from: 'queue' }
  | { left: true; from: 'table'; gameId: string }
  | { left: false; leaving: true; gameId: string; afterHand: true }
  | { left: false; reason: 'NotInArena' };

export async function leaveArena(sessionId: string): Promise<LeaveResult> {
  transfers.delete(sessionId);
  const idx = queue.findIndex((a) => a.sessionId === sessionId);
  if (idx >= 0) {
    const [a] = queue.splice(idx, 1);
    const key = groupOf(a!);
    const timer = fillTimers.get(key);
    if (timer && queue.filter((q) => groupOf(q) === key).length < getArenaConfig().minAgents) {
      clearTimeout(timer);
      fillTimers.delete(key);
    }
    return { left: true, from: 'queue' };
  }
  const gameId = seatOf.get(sessionId);
  const t = gameId ? tables.get(gameId) : undefined;
  if (!gameId || !t) return { left: false, reason: 'NotInArena' };
  if (t.pending.has(sessionId)) {
    // Seated for the next hand but not dealt in yet: the seat frees immediately.
    t.pending.delete(sessionId);
    seatOf.delete(sessionId);
    emitTo(sessionId, 'arena:left', { gameId });
    await broadcast(gameId);
    return { left: true, from: 'table', gameId };
  }
  t.leaving.add(sessionId);
  const state = await getGame(gameId);
  if (!isHandLive(state) && !isGameStarting(gameId)) {
    await serial(`arena:${gameId}`, () => settleSeats(t, false));
    if (!seatOf.has(sessionId)) return { left: true, from: 'table', gameId };
  }
  return { left: false, leaving: true, gameId, afterHand: true };
}

// ─── seating ────────────────────────────────────────────────────────────────

const occupancy = (t: ArenaTable) => t.agents.size + t.pending.size;

/** Fullest running table (same event group, not closing) with a free seat. */
function bestTableFor(a: Agent): ArenaTable | null {
  let best: ArenaTable | null = null;
  for (const t of tables.values()) {
    if (t.closing || t.eventId !== a.eventId) continue;
    if (occupancy(t) >= ARENA_MAX_SEATS) continue;
    if (!best || occupancy(t) > occupancy(best)) best = t;
  }
  return best;
}

/** Seat queued agents at running tables with free seats (dealt in from the next hand). */
function placeQueued() {
  for (let i = 0; i < queue.length; ) {
    const a = queue[i]!;
    const t = bestTableFor(a);
    if (!t) {
      i += 1;
      continue;
    }
    queue.splice(i, 1);
    t.pending.set(a.sessionId, a);
    seatOf.set(a.sessionId, t.gameId);
    emitTo(a.sessionId, 'arena:seated', { gameId: t.gameId });
    console.log(`[arena] ${a.nickname} sits down at ${t.name} (from the next hand)`);
    void broadcast(t.gameId);
  }
}

async function maybeOpenTables() {
  const keys = new Set(queue.map(groupOf));
  for (const key of keys) await maybeOpenTable(key);
}

async function maybeOpenTable(key: string) {
  const cfg = getArenaConfig();
  const n = queue.filter((a) => groupOf(a) === key).length;
  if (n >= ARENA_MAX_SEATS || (n >= cfg.minAgents && cfg.fillMs === 0)) {
    await openTable(key);
    return;
  }
  if (n >= cfg.minAgents && !fillTimers.has(key)) {
    fillTimers.set(
      key,
      setTimeout(() => {
        fillTimers.delete(key);
        void openTable(key).catch((e) => console.error('[arena] open table failed', e));
      }, cfg.fillMs)
    );
  }
}

/** Open one table for queue group `key` (up to 6 agents, or exactly `take` of them). */
async function openTable(key: string, take?: number) {
  const timer = fillTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    fillTimers.delete(key);
  }
  const cfg = getArenaConfig();
  const eventId = key || null;
  if (eventId && !liveEvents.has(eventId)) return;
  const group = queue.filter((a) => groupOf(a) === key);
  if (group.length < cfg.minAgents) return;
  const agents = group.slice(0, Math.min(ARENA_MAX_SEATS, take ?? ARENA_MAX_SEATS));
  for (const a of agents) queue.splice(queue.indexOf(a), 1);
  let name: string;
  if (eventId) {
    const n = (eventTableCounter.get(eventId) ?? 0) + 1;
    eventTableCounter.set(eventId, n);
    name = `${liveEvents.get(eventId)!.name.slice(0, 40)} #${n}`;
  } else {
    tableCounter += 1;
    name = `Agent Arena #${tableCounter}`;
  }
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
    pending: new Map(),
    leaving: new Set(),
    nextTimer: null,
    lastCompletedHand: null,
    eventId,
    closing: false,
  };
  tables.set(t.gameId, t);
  if (eventId) {
    await Promise.all([
      GameModel.updateOne({ gameId: t.gameId }, { $set: { eventId } }),
      ArenaEventModel.updateOne({ eventId }, { $addToSet: { gameIds: t.gameId } }),
    ]).catch((e) => console.error('[arena] event table flag failed', errMsg(e)));
  }
  for (const a of agents) {
    seatOf.set(a.sessionId, t.gameId);
    emitTo(a.sessionId, 'arena:seated', { gameId: t.gameId });
  }
  console.log(`[arena] opened ${name} (${t.gameId.slice(0, 8)}) with ${agents.length} agents`);
  scheduleNextHand(t, cfg.handGapMs);
  if (take === undefined && queue.filter((a) => groupOf(a) === key).length >= cfg.minAgents) await maybeOpenTable(key);
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

function requeue(agents: Agent[]) {
  const fresh = agents.filter((a) => !queue.some((q) => q.sessionId === a.sessionId) && !seatOf.has(a.sessionId));
  queue.push(...fresh);
  for (const a of fresh) emitTo(a.sessionId, 'arena:queued', { position: queue.indexOf(a) + 1 });
  return fresh.length;
}

/**
 * Between hands: unseat leavers + busted agents (freeing their seats), fill free seats from
 * the queue, and — when `admit` (right before a hand starts) — deal in the agents waiting for
 * the next hand. Closes the table when < 2 remain. Returns the number of seated agents.
 */
async function settleSeats(t: ArenaTable, admit: boolean): Promise<number> {
  if (!tables.has(t.gameId)) return 0;
  const { state, removed } = await prepareArenaHand(t.gameId, t.leaving);
  const moving: Agent[] = [];
  for (const id of removed) {
    const a = t.agents.get(id);
    t.agents.delete(id);
    t.leaving.delete(id);
    seatOf.delete(id);
    emitTo(id, 'arena:left', { gameId: t.gameId });
    const ev = transfers.get(id);
    transfers.delete(id);
    if (a && ev && liveEvents.has(ev)) moving.push({ ...a, eventId: ev });
  }
  let seated = state.players.length;
  let changed = removed.length > 0;
  if (moving.length > 0) requeue(moving);
  if (removed.length > 0) placeQueued();

  if (admit && !t.closing && t.pending.size > 0) {
    const newcomers = [...t.pending.values()];
    try {
      const r = await admitArenaPlayers(
        t.gameId,
        newcomers.map((a) => ({ id: a.sessionId, nickname: a.nickname }))
      );
      for (const a of newcomers) {
        if (!r.state.players.some((p) => p.id === a.sessionId)) continue;
        t.pending.delete(a.sessionId);
        t.agents.set(a.sessionId, a);
      }
      seated = r.state.players.length;
      changed = changed || r.added.length > 0;
      if (r.added.length > 0) console.log(`[arena] ${t.name}: ${r.added.length} agent(s) dealt in from this hand`);
    } catch (e) {
      console.error(`[arena] ${t.gameId.slice(0, 8)} admit failed: ${errMsg(e)}`);
    }
  }
  if (changed) await broadcast(t.gameId);
  if (moving.length > 0) await maybeOpenTables();
  if (seated < 2 && !(t.pending.size > 0 && !admit)) {
    await closeTable(t);
    return 0;
  }
  return seated;
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
  const back: Agent[] = [];
  // Event over → back to the open arena; event still live → back to the event queue.
  const keepEvent = t.eventId && !t.closing && liveEvents.has(t.eventId) ? t.eventId : null;
  for (const [id, a] of [...t.agents, ...t.pending]) {
    seatOf.delete(id);
    emitTo(id, 'arena:closed', { gameId: t.gameId });
    if (t.leaving.has(id)) continue;
    const ev = transfers.get(id);
    transfers.delete(id);
    back.push({ ...a, eventId: ev && liveEvents.has(ev) ? ev : keepEvent });
  }
  console.log(`[arena] closed ${t.name} after ${t.handsPlayed} hands`);
  await broadcast(t.gameId);
  if (requeue(back) > 0) {
    placeQueued();
    await maybeOpenTables();
  }
}

async function runNextHand(t: ArenaTable) {
  if (!tables.has(t.gameId)) return;
  const cfg = getArenaConfig();
  if (t.closing) {
    const state = await getGame(t.gameId);
    if (isHandLive(state) || isGameStarting(t.gameId)) return; // completion re-schedules
    await closeTable(t);
    return;
  }
  try {
    const seats = await settleSeats(t, true);
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

// ─── scheduled events (driven by arena/events.ts) ───────────────────────────

export type EventEntrant = { sessionId: string; nickname: string; walletAddress: string; model: string | null; chips: number };

/** Remember a live event (also after a restart) so /arena/join routes its agents to it. */
export function setLiveEvent(eventId: string, name: string, wallets: string[]) {
  liveEvents.set(eventId, { name, wallets: new Set(wallets) });
}

export function isEventLiveInLobby(eventId: string) {
  return liveEvents.has(eventId);
}

/**
 * Event start: registered agents that are queued, connected, or playing at an open-arena
 * table (they move after the current hand) go to dedicated event tables, split evenly.
 */
export async function startEventTables(eventId: string, name: string, entrants: EventEntrant[]) {
  setLiveEvent(eventId, name, entrants.map((e) => e.walletAddress));
  const cfg = getArenaConfig();
  for (const e of entrants) {
    const q = queue.find((a) => a.sessionId === e.sessionId);
    if (q) {
      q.eventId = eventId;
      continue;
    }
    const gameId = seatOf.get(e.sessionId);
    const t = gameId ? tables.get(gameId) : undefined;
    if (t) {
      if (t.eventId === eventId) continue;
      if (t.pending.has(e.sessionId)) {
        const a = t.pending.get(e.sessionId)!;
        t.pending.delete(e.sessionId);
        seatOf.delete(e.sessionId);
        emitTo(e.sessionId, 'arena:left', { gameId: t.gameId });
        requeue([{ ...a, eventId }]);
        continue;
      }
      transfers.set(e.sessionId, eventId);
      t.leaving.add(e.sessionId);
      const state = await getGame(t.gameId);
      if (!isHandLive(state) && !isGameStarting(t.gameId)) {
        await serial(`arena:${t.gameId}`, () => settleSeats(t, false)).catch((err) =>
          console.error('[arena] transfer failed', errMsg(err))
        );
      }
      continue;
    }
    if (!isConnected(e.sessionId) || e.chips < cfg.minChips) continue;
    queue.push({ sessionId: e.sessionId, nickname: e.nickname, walletAddress: e.walletAddress, model: e.model, eventId });
    setDeclaredModel(e.sessionId, e.model);
    emitTo(e.sessionId, 'arena:queued', { position: queue.length });
  }
  // Open the event's tables right away, balanced (e.g. 8 agents → 4 + 4).
  let n = queue.filter((a) => a.eventId === eventId).length;
  while (n >= cfg.minAgents) {
    const tablesLeft = Math.ceil(n / ARENA_MAX_SEATS);
    const take = Math.ceil(n / tablesLeft);
    await openTable(eventId, take);
    n = queue.filter((a) => a.eventId === eventId).length;
  }
}

/** Event end: no new hands on its tables (they close after the current hand); agents return to the open arena. */
export async function endEventTables(eventId: string) {
  liveEvents.delete(eventId);
  for (const [sid, ev] of [...transfers]) {
    if (ev !== eventId) continue;
    transfers.delete(sid);
    const gameId = seatOf.get(sid);
    if (gameId) tables.get(gameId)?.leaving.delete(sid);
  }
  for (const t of tables.values()) {
    if (t.eventId !== eventId || t.closing) continue;
    t.closing = true;
    if (t.nextTimer) {
      clearTimeout(t.nextTimer);
      t.nextTimer = null;
    }
    scheduleNextHand(t, 0); // closes now if between hands; else the hand's completion does
  }
  for (const a of queue) if (a.eventId === eventId) a.eventId = null;
  const timer = fillTimers.get(eventId);
  if (timer) clearTimeout(timer);
  fillTimers.delete(eventId);
  placeQueued();
  await maybeOpenTables();
}

/** gameIds of this event's tables that are still open (including closing ones). */
export function eventTableIds(eventId: string) {
  return [...tables.values()].filter((t) => t.eventId === eventId).map((t) => t.gameId);
}

// ─── read models ────────────────────────────────────────────────────────────

export function queueSnapshot() {
  return queue.map((a, i) => ({
    position: i + 1,
    nickname: a.nickname,
    walletAddress: a.walletAddress,
    ...(a.eventId ? { eventId: a.eventId } : {}),
  }));
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
      /** Seated between hands: dealt in from the next hand ("joining next hand"). */
      waiting: [...t.pending.values()].map((a) => ({
        playerId: a.sessionId,
        nickname: a.nickname,
        walletAddress: a.walletAddress,
        ...(a.model ? { model: a.model } : {}),
      })),
      freeSeats: Math.max(0, ARENA_MAX_SEATS - occupancy(t)),
      eventId: t.eventId,
      closing: t.closing,
      handsPlayed: t.handsPlayed,
      status: isGameStarting(t.gameId) ? 'dealing' : isHandLive(state) ? 'playing' : 'between-hands',
      handId: state.fairness?.handId ?? null,
      createdAt: new Date(t.createdAt).toISOString(),
    });
  }
  return out;
}
