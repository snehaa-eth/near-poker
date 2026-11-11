import {
  createEmptyNlheLobby,
  joinNlheLobby,
  listLobbySummary,
  makeJoinCode,
  stacksFromNlhe,
  startNlheHand,
  toNlhePublicView,
  applyNlheBet,
  applyNlheFold,
  type StoredGame,
} from './poker-bridge.js';

import {
  GameEventModel,
  GameModel,
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
  return toNlhePublicView(state, viewerId);
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

/** Deal a real NLHE hand (skips legacy shuffle ritual). */
export async function actionStart(gameId: string, actorId?: string) {
  const state = await load(gameId);
  if (!state) throw new Error('GameNotFound');

  const stacks = await loadStacksForPlayers(state.players.map((p) => p.id));
  // Prefer stacks already on the table after a prior hand
  if (state.nlhe?.street === 'complete') {
    for (const p of state.nlhe.players) {
      stacks[p.id] = p.stack;
    }
  }

  const next = startNlheHand(state, stacks);
  await save(next, {
    type: 'game:start',
    actorId,
    payload: { engine: 'nlhe', blinds: next.nlhe?.config },
  });
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
