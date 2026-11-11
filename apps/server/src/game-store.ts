import { randomUUID } from 'node:crypto';

import { bytesToHex } from '@nli/poker-engine';

import {
  collectEntropy,
  deckSeedFor,
  ENTROPY_TIMEOUT_MS,
  newServerSeed,
} from './fairness.js';
import { getLedger } from './ledger.js';
import {
  createEmptyNlheLobby,
  joinNlheLobby,
  nextHandPlayerOrder,
  listLobbySummary,
  makeJoinCode,
  stacksFromNlhe,
  startNlheHand,
  toNlhePublicView,
  applyNlheBet,
  applyNlheFold,
  type HandFairnessState,
  type StoredGame,
} from './poker-bridge.js';

import {
  GameEventModel,
  GameModel,
  HandModel,
  SessionModel,
  recordPlayerActivity,
} from './db.js';

/** Short-lived cache; MongoDB is the source of truth. */
const memory = new Map<string, StoredGame>();

async function sessionMeta(sessionId: string | null | undefined) {
  if (!sessionId)
    return { walletAddress: null as string | null, chips: null as number | null };
  const doc = await SessionModel.findOne({ sessionId })
    .select('walletAddress chips')
    .lean();
  return {
    walletAddress: doc?.walletAddress ?? null,
    chips: doc?.chips ?? null,
  };
}

async function loadStacksForPlayers(
  playerIds: string[]
): Promise<Record<string, number>> {
  const docs = await SessionModel.find({ sessionId: { $in: playerIds } })
    .select('sessionId chips')
    .lean();
  const map: Record<string, number> = {};
  for (const id of playerIds) map[id] = 0;
  for (const d of docs) {
    map[d.sessionId] = Math.max(0, Math.floor(d.chips ?? 0));
  }
  return map;
}

async function settleStacksToSessions(state: StoredGame) {
  if (!state.nlhe || state.nlhe.street !== 'complete' || state.nlheSettled) {
    return state;
  }
  const stacks = stacksFromNlhe(state);
  if (!stacks) return state;
  await Promise.all(
    Object.entries(stacks).map(async ([sessionId, chips]) => {
      await SessionModel.updateOne({ sessionId }, { $set: { chips } });
    })
  );
  return { ...state, nlheSettled: true };
}

async function recordGameActivity(input: {
  sessionId: string;
  type: string;
  summary: string;
  gameId: string;
  amountChips?: number | null;
  payload?: Record<string, unknown>;
}) {
  const meta = await sessionMeta(input.sessionId);
  await recordPlayerActivity({
    sessionId: input.sessionId,
    walletAddress: meta.walletAddress,
    category: 'game',
    type: input.type,
    summary: input.summary,
    gameId: input.gameId,
    amountChips: input.amountChips ?? null,
    balanceAfter: meta.chips,
    payload: input.payload,
  });
}

function normalizeState(state: StoredGame): StoredGame {
  return {
    ...state,
    name: state.name?.trim() || 'Table',
    joinCode: (state.joinCode || makeJoinCode()).toUpperCase(),
    minChips: Math.max(0, Math.floor(state.minChips ?? 0)),
    maxPlayers: Math.min(6, Math.max(2, Math.floor(state.maxPlayers ?? 6))),
    nlhe: state.nlhe ?? null,
    nlheSettled: state.nlheSettled ?? false,
    fairness: state.fairness ?? null,
  };
}

function lobbyFields(state: StoredGame) {
  const normalized = normalizeState(state);
  return {
    gameId: normalized.gameId,
    name: normalized.name,
    joinCode: normalized.joinCode,
    minChips: normalized.minChips,
    maxPlayers: normalized.maxPlayers,
    status: normalized.status,
    round: normalized.round,
    totalPlayers: normalized.players.length,
    pot: normalized.pot,
    winnerId: normalized.winnerId,
    playerIds: normalized.players.map((p) => p.id),
    playerNicknames: normalized.players.map((p) => p.nickname),
    state: normalized,
  };
}

async function persistEvent(
  state: StoredGame,
  type: string,
  actorId: string | null = null,
  payload: Record<string, unknown> = {}
) {
  await GameEventModel.create({
    gameId: state.gameId,
    type,
    actorId,
    status: state.status,
    round: state.round,
    payload,
  });
}

async function save(
  state: StoredGame,
  event?: {
    type: string;
    actorId?: string | null;
    payload?: Record<string, unknown>;
  }
) {
  let normalized = normalizeState(state);
  if (
    normalized.nlhe?.street === 'complete' &&
    !normalized.nlheSettled
  ) {
    normalized = await settleStacksToSessions(normalized);
  }
  if (
    normalized.nlhe?.street === 'complete' &&
    normalized.fairness &&
    !normalized.fairness.revealed
  ) {
    normalized = await finalizeHand(normalized);
  }
  memory.set(normalized.gameId, normalized);
  await GameModel.findOneAndUpdate(
    { gameId: normalized.gameId },
    lobbyFields(normalized),
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (event) {
    await persistEvent(
      normalized,
      event.type,
      event.actorId ?? null,
      event.payload ?? {}
    );
  }
  return normalized;
}

async function load(gameIdOrCode: string): Promise<StoredGame | null> {
  const key = gameIdOrCode.trim();
  if (!key) return null;

  let doc = await GameModel.findOne({ gameId: key }).lean();
  if (!doc && key.length <= 8) {
    doc = await GameModel.findOne({
      joinCode: key.toUpperCase(),
    }).lean();
  }
  if (!doc) {
    memory.delete(key);
    return null;
  }
  const state = normalizeState(doc.state as StoredGame);
  if (!doc.joinCode || !doc.name) {
    await GameModel.updateOne(
      { gameId: state.gameId },
      {
        name: state.name,
        joinCode: state.joinCode,
        minChips: state.minChips,
        state,
      }
    );
  }
  memory.set(state.gameId, state);
  return state;
}

export async function hydrateGamesFromDb() {
  const docs = await GameModel.find({}).lean();
  memory.clear();
  for (const doc of docs) {
    memory.set(doc.gameId, normalizeState(doc.state as StoredGame));
  }
  console.log(`Hydrated ${docs.length} games from MongoDB`);
}

/** Wipe all lobbies (games + events) from Mongo and the in-memory cache. */
export async function clearAllLobbies() {
  const [games, events] = await Promise.all([
    GameModel.deleteMany({}),
    GameEventModel.deleteMany({}),
  ]);
  memory.clear();
  console.log(
    `Cleared lobbies: ${games.deletedCount ?? 0} games, ${events.deletedCount ?? 0} events`
  );
  return {
    gamesDeleted: games.deletedCount ?? 0,
    eventsDeleted: events.deletedCount ?? 0,
  };
}

export async function createNewGame(player: {
  id: string;
  nickname: string;
}) {
  const empty = createEmptyNlheLobby({});
  const state = joinNlheLobby(empty, player);
  await save(state, {
    type: 'lobby:create',
    actorId: player.id,
    payload: { nickname: player.nickname, engine: 'nlhe' },
  });
  await recordGameActivity({
    sessionId: player.id,
    type: 'game:create',
    summary: `Created lobby ${state.gameId.slice(0, 8)}`,
    gameId: state.gameId,
    payload: { nickname: player.nickname },
  });
  return state;
}

/** Admin-created empty waiting lobby (no house seat). */
export async function createEmptyLobby(opts: {
  name: string;
  minChips: number;
  maxPlayers?: number;
}) {
  const name = opts.name.trim().slice(0, 48);
  if (name.length < 2) {
    throw new Error('Lobby name must be at least 2 characters.');
  }
  const minChips = Math.max(0, Math.floor(opts.minChips));
  if (!Number.isFinite(minChips)) {
    throw new Error('Invalid min chips.');
  }
  const maxPlayers = Math.min(
    6,
    Math.max(2, Math.floor(opts.maxPlayers ?? 6))
  );

  let joinCode = makeJoinCode();
  for (let i = 0; i < 8; i++) {
    const exists = await GameModel.exists({ joinCode });
    if (!exists) break;
    joinCode = makeJoinCode();
  }

  const state = createEmptyNlheLobby({ name, minChips, maxPlayers, joinCode });
  await save(state, {
    type: 'lobby:create',
    actorId: null,
    payload: { source: 'admin', name, minChips, maxPlayers, joinCode, engine: 'nlhe' },
  });
  return state;
}

export async function joinExistingGame(
  gameIdOrCode: string,
  player: { id: string; nickname: string; chips: number }
) {
  const state = await load(gameIdOrCode);
  if (!state) throw new Error('GameNotFound');

  const alreadyIn = state.players.some((p) => p.id === player.id);
  if (!alreadyIn) {
    const minChips = state.minChips ?? 0;
    if (player.chips < minChips) {
      throw new Error(
        `Need at least ${minChips} chips to join. You have ${player.chips}.`
      );
    }
  }

  const next = joinNlheLobby(state, player);
  await save(next, {
    type: 'lobby:join',
    actorId: player.id,
    payload: { nickname: player.nickname },
  });
  await recordGameActivity({
    sessionId: player.id,
    type: 'game:join',
    summary: `Joined ${state.name} (${state.joinCode})`,
    gameId: state.gameId,
    payload: { nickname: player.nickname, minChips: state.minChips },
  });
  return next;
}

export async function getGame(gameId: string) {
  return load(gameId);
}

export type ListGamesFilter = {
  status?: string | string[];
  includeEnded?: boolean;
};

/** Always reads lobbies + status from MongoDB. */
export async function listGames(filter: ListGamesFilter = {}) {
  const query: Record<string, unknown> = {};

  if (filter.status) {
    query.status = Array.isArray(filter.status)
      ? { $in: filter.status }
      : filter.status;
  } else if (!filter.includeEnded) {
    // Default lobby: active tables (open + in progress)
    query.status = { $in: ['waiting', 'shuffling', 'playing'] };
  }

  const docs = await GameModel.find(query)
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  return docs.map((d) => {
    const summary = listLobbySummary(normalizeState(d.state as StoredGame));
    return {
      ...summary,
      name: d.name ?? summary.name,
      joinCode: d.joinCode ?? summary.joinCode,
      minChips: d.minChips ?? summary.minChips,
      maxPlayers: (d as { maxPlayers?: number }).maxPlayers ?? summary.maxPlayers,
      // Prefer denormalized Mongo fields when present
      status: d.status ?? summary.status,
      round: d.round ?? summary.round,
      totalPlayers: d.totalPlayers ?? summary.totalPlayers,
      pot: d.pot ?? summary.pot,
      winnerId: d.winnerId ?? summary.winnerId,
      mongoUpdatedAt: d.updatedAt,
      mongoCreatedAt: d.createdAt,
    };
  });
}

export async function getGameEvents(gameId: string, limit = 50) {
  return GameEventModel.find({ gameId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export async function getPublicState(
  gameId: string,
  viewerId: string | null
) {
  const state = await load(gameId);
  if (!state) return null;
  const view = toNlhePublicView(state, viewerId);
  if (view.fairness) {
    const txs = txCache.get(view.fairness.handId);
    if (txs?.commit && !view.fairness.committedTx) view.fairness.committedTx = txs.commit;
    if (txs?.reveal && view.fairness.revealed) view.fairness.revealed.revealTx = txs.reveal;
  }
  return view;
}

type Mutator = (state: StoredGame) => StoredGame;

async function mutate(
  gameId: string,
  fn: Mutator,
  event: {
    type: string;
    actorId?: string | null;
    payload?: Record<string, unknown>;
  }
) {
  const state = await load(gameId);
  if (!state) throw new Error('GameNotFound');
  const next = fn(state);
  await save(next, event);
  return next;
}

// ─── Provably-fair hand lifecycle (INTERFACES.md §1, §3) ───────────────────

/** Games currently in the commit → entropy → deal window. */
const starting = new Set<string>();
/** Per-game serial queue of ledger ops (commit N+1 waits for settle N). */
const ledgerQueues = new Map<string, Promise<unknown>>();
/** Ledger tx hashes that arrived after the hand record was written. */
const txCache = new Map<string, { commit?: string; reveal?: string; settle?: string }>();

function enqueueLedger<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
  const prev = ledgerQueues.get(gameId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  ledgerQueues.set(
    gameId,
    run.catch(() => undefined)
  );
  return run;
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** NEAR ledger needs NEAR account ids (session walletAddress); memory uses session ids. */
async function resolveLedgerPlayers(playerIds: string[]): Promise<string[]> {
  if (getLedger().kind !== 'near') return [...playerIds];
  const docs = await SessionModel.find({ sessionId: { $in: playerIds } })
    .select('sessionId walletAddress')
    .lean();
  const byId = new Map(docs.map((d) => [d.sessionId, d.walletAddress ?? null]));
  return playerIds.map((id) => {
    const wallet = byId.get(id);
    if (!wallet) {
      throw new Error(`NearLedger: player ${id} has no linked NEAR wallet`);
    }
    return wallet;
  });
}

async function recordLedgerResult(
  handId: string,
  kind: 'commit' | 'reveal' | 'settle',
  result: { tx?: string } | null,
  error?: unknown
) {
  const cached = txCache.get(handId) ?? {};
  if (result?.tx) {
    cached[kind] = result.tx;
    txCache.set(handId, cached);
  }
  const update: Record<string, unknown> = {};
  if (result?.tx) update[`txs.${kind}`] = result.tx;
  if (error) {
    const msg = `${kind}: ${errMsg(error)}`;
    console.error(`[ledger] hand ${handId} ${msg}`);
    update[`txs.${kind}Error`] = msg;
  }
  if (Object.keys(update).length === 0) return;
  const op: Record<string, unknown> = { $set: update };
  if (error) op.$push = { ledgerErrors: `${kind}: ${errMsg(error)}` };
  await HandModel.updateOne({ handId }, op).catch((e) =>
    console.error('[ledger] failed to record result', e)
  );
}

/**
 * Hand complete: mark revealed (so the public view + /hands route expose the seed),
 * write the full hand record, then reveal + settle on the ledger in the background.
 */
async function finalizeHand(state: StoredGame): Promise<StoredGame> {
  const f = state.fairness!;
  const table = state.nlhe!;
  const deltas: Record<string, number> = {};
  table.players.forEach((p, i) => {
    const key = f.ledgerPlayers[i] ?? p.id;
    deltas[key] = (deltas[key] ?? 0) + p.stack - (f.startStacks[p.id] ?? p.stack);
  });
  const nick = new Map(state.players.map((p) => [p.id, p.nickname]));
  const seats = table.players.map((p) => ({
    seat: p.seat,
    playerId: p.id,
    nickname: nick.get(p.id) ?? '',
    holeCards: p.holeCards.map((c) => c.id),
  }));
  const fairness: HandFairnessState = { ...f, revealed: true };
  await HandModel.updateOne(
    { handId: f.handId },
    {
      $set: {
        revealed: true,
        complete: true,
        seats,
        community: table.community.map((c) => c.id),
        deltas,
      },
    }
  ).catch((e) => console.error('[fairness] hand record update failed', e));

  const ledger = getLedger();
  const { handId, gameId } = { handId: f.handId, gameId: state.gameId };
  void enqueueLedger(gameId, async () => {
    let revealed = false;
    try {
      const r = await ledger.reveal(handId, f.serverSeed, f.entropy);
      revealed = true;
      await recordLedgerResult(handId, 'reveal', r);
    } catch (e) {
      await recordLedgerResult(handId, 'reveal', null, e);
    }
    if (!revealed) return;
    try {
      const r = await ledger.settle(handId, deltas);
      await recordLedgerResult(handId, 'settle', r);
    } catch (e) {
      await recordLedgerResult(handId, 'settle', null, e);
    }
  });

  return { ...state, fairness };
}

/** Deal a real NLHE hand: commit seedHash → collect entropy → deal from deckSeed. */
export async function actionStart(gameId: string, actorId?: string) {
  if (starting.has(gameId)) throw new Error('HandStarting');
  starting.add(gameId);
  try {
    return await startFairHand(gameId, actorId);
  } finally {
    starting.delete(gameId);
  }
}

async function startFairHand(gameId: string, actorId?: string) {
  const before = await load(gameId);
  if (!before) throw new Error('GameNotFound');
  if (
    before.nlhe &&
    before.nlhe.street !== 'complete' &&
    before.nlhe.street !== 'waiting'
  ) {
    throw new Error('HandInProgress');
  }
  if (before.players.length < 2) throw new Error('NotEnoughPlayers');

  const order = nextHandPlayerOrder(before);
  const handId = randomUUID();
  const { serverSeed, seedHash } = newServerSeed();
  const ledger = getLedger();
  const errors: string[] = [];

  // 1. Commit BEFORE asking anyone for entropy.
  let ledgerPlayers = [...order];
  let committedTx: string | undefined;
  try {
    ledgerPlayers = await resolveLedgerPlayers(order);
    const r = await enqueueLedger(gameId, () =>
      ledger.commit(handId, seedHash, ledgerPlayers)
    );
    committedTx = r.tx;
  } catch (e) {
    errors.push(`commit: ${errMsg(e)}`);
    console.error(`[ledger] hand ${handId} commit failed: ${errMsg(e)}`);
  }
  if (committedTx) txCache.set(handId, { commit: committedTx });
  await persistEvent(before, 'hand:commit', actorId ?? null, {
    handId,
    seedHash,
    committedTx: committedTx ?? null,
  });

  // 2. Entropy from every seated player (missing → zeros, recorded as such).
  const entropy = await collectEntropy(gameId, handId, order, ENTROPY_TIMEOUT_MS);
  const deckSeed = deckSeedFor(serverSeed, entropy);

  // 3. Deal. Re-load: the table may have changed during the entropy window.
  const state = await load(gameId);
  if (!state) throw new Error('GameNotFound');
  const nowOrder = nextHandPlayerOrder(state);
  if (nowOrder.join(',') !== order.join(',')) {
    throw new Error('TableChangedDuringEntropy');
  }

  const stacks = await loadStacksForPlayers(state.players.map((p) => p.id));
  // Prefer stacks already on the table after a prior hand
  if (state.nlhe?.street === 'complete') {
    for (const p of state.nlhe.players) {
      stacks[p.id] = p.stack;
    }
  }

  const dealt = startNlheHand(state, stacks, deckSeed);
  const startStacks: Record<string, number> = {};
  for (const p of dealt.nlhe!.players) {
    startStacks[p.id] = p.stack + p.committed;
  }
  // If the hand ran out instantly, stack+committed is post-hand; use the inputs.
  if (dealt.nlhe!.street === 'complete') {
    for (const p of dealt.nlhe!.players) {
      startStacks[p.id] = Math.max(0, Math.floor(stacks[p.id] ?? 0));
    }
  }

  const fairness: HandFairnessState = {
    handId,
    seedHash,
    serverSeed,
    entropy,
    deckSeed: bytesToHex(deckSeed),
    playerIds: order,
    ledgerPlayers,
    startStacks,
    committedTx,
    revealed: false,
    errors,
  };

  await HandModel.create({
    handId,
    gameId,
    seedHash,
    serverSeed,
    entropy,
    deckSeed: fairness.deckSeed,
    revealed: false,
    complete: false,
    seats: [],
    community: [],
    deltas: {},
    ledgerPlayers,
    ledger: ledger.kind,
    txs: committedTx ? { commit: committedTx } : {},
    ledgerErrors: errors,
  });

  const next = await save(
    { ...dealt, fairness },
    {
      type: 'game:start',
      actorId,
      payload: { engine: 'nlhe', blinds: dealt.nlhe?.config, handId, seedHash },
    }
  );
  if (actorId) {
    await recordGameActivity({
      sessionId: actorId,
      type: 'game:start',
      summary: `Started NLHE hand in ${gameId.slice(0, 8)}`,
      gameId,
    });
  }
  return next;
}

/** Public hand record (INTERFACES.md §4). Secrets only once revealed. */
export async function getHandRecord(handId: string) {
  const doc = await HandModel.findOne({ handId }).lean();
  if (!doc) return null;
  const txs = { ...(txCache.get(handId) ?? {}), ...(doc.txs ?? {}) };
  const base = {
    handId: doc.handId,
    gameId: doc.gameId,
    seedHash: doc.seedHash,
    revealed: doc.revealed,
    complete: doc.complete,
    ledger: doc.ledger,
    cardIds: 'engine' as const,
    txs,
    errors: doc.ledgerErrors ?? [],
    createdAt: doc.createdAt,
  };
  if (!doc.revealed) {
    return { ...base, seats: [], community: [] };
  }
  return {
    ...base,
    serverSeed: doc.serverSeed,
    entropy: doc.entropy,
    deckSeed: doc.deckSeed,
    seats: doc.seats,
    community: doc.community,
    deltas: doc.deltas,
    ledgerPlayers: doc.ledgerPlayers,
  };
}

export async function listGameHands(gameId: string, limit = 50) {
  const docs = await HandModel.find({ gameId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('handId seedHash revealed complete createdAt')
    .lean();
  return docs.map((d) => ({
    handId: d.handId,
    seedHash: d.seedHash,
    revealed: d.revealed,
    complete: d.complete,
    createdAt: d.createdAt,
  }));
}

/** Legacy shuffle — no-op; hand already starts via game:start. */
export async function actionShuffle(gameId: string, playerId: string) {
  const state = await load(gameId);
  if (!state) throw new Error('GameNotFound');
  if (state.status === 'waiting' && state.players.length >= 2) {
    return actionStart(gameId, playerId);
  }
  return state;
}

export async function actionBet(
  gameId: string,
  playerId: string,
  amount: number
) {
  const next = await mutate(
    gameId,
    (s) => applyNlheBet(s, playerId, amount),
    {
      type: 'game:bet',
      actorId: playerId,
      payload: { amount },
    }
  );
  await recordGameActivity({
    sessionId: playerId,
    type: 'game:bet',
    summary: `Bet action (${amount}) in ${gameId.slice(0, 8)}`,
    gameId,
    amountChips: null,
    payload: { amount },
  });
  return next;
}

export async function actionFold(gameId: string, playerId: string) {
  const next = await mutate(gameId, (s) => applyNlheFold(s, playerId), {
    type: 'game:fold',
    actorId: playerId,
  });
  await recordGameActivity({
    sessionId: playerId,
    type: 'game:fold',
    summary: `Folded in ${gameId.slice(0, 8)}`,
    gameId,
  });
  return next;
}

/** Legacy choose-cards — NLHE auto-ranks; no-op. */
export async function actionChooseCards(
  gameId: string,
  playerId: string,
  _cards: [number, number, number]
) {
  const state = await load(gameId);
  if (!state) throw new Error('GameNotFound');
  return state;
}

/** Legacy declare — if hand already complete via engine, just return it. */
export async function actionDeclareWinner(gameId: string, actorId?: string) {
  const state = await load(gameId);
  if (!state) throw new Error('GameNotFound');
  if (state.nlhe?.street === 'complete') {
    const settled = await save(state, {
      type: 'game:declareWinner',
      actorId,
      payload: { engine: 'nlhe' },
    });
    const winnerId = settled.winnerId;
    const pot = settled.pot ?? 0;
    await Promise.all(
      settled.players.map(async (p) => {
        const won = winnerId != null && p.id === winnerId;
        await recordGameActivity({
          sessionId: p.id,
          type: won ? 'game:win' : 'game:end',
          summary: won
            ? `Won pot ${pot} in ${gameId.slice(0, 8)}`
            : `Hand ended in ${gameId.slice(0, 8)}`,
          gameId,
          amountChips: won ? pot : null,
          payload: { winnerId, pot, nickname: p.nickname, engine: 'nlhe' },
        });
      })
    );
    return settled;
  }
  throw new Error('HandNotComplete');
}
