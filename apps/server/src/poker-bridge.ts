import {
  applyAction,
  buildPots,
  createTable,
  getLegalActions,
  startHand,
  type PlayerAction,
  type TableState,
} from '@nli/poker-engine';
import type { GameState, PublicGameView } from 'game-engine';
import {
  createLobby,
  joinGame,
  listLobbySummary,
  makeJoinCode,
  toPublicView as legacyToPublicView,
} from 'game-engine';

/**
 * Lobby/meta state from game-engine + live NLHE table from @nli/poker-engine.
 * `nlhe` is null while waiting between hands / before first deal.
 */
export type StoredGame = GameState & {
  /** Active (or just-finished) NLHE hand. */
  nlhe?: TableState | null;
  /** true once stacks were written back after a completed hand. */
  nlheSettled?: boolean;
  /** Provably-fair commit/reveal state for the current hand (server-only secrets!). */
  fairness?: HandFairnessState | null;
  /** Agent Arena table (INTERFACES.md §5): auto hand starts, TEE-receipt moves only. */
  arena?: boolean;
};

/**
 * Server-side fairness state for one hand. `serverSeed`, `entropy` and `deckSeed`
 * are SECRET until `revealed` is true — never put them in a public view before.
 */
export type HandFairnessState = {
  handId: string;
  seedHash: string;
  serverSeed: string;
  /** Entropy hex per table player (table / seat order). */
  entropy: string[];
  deckSeed: string;
  /** Session ids in table (seat) order. */
  playerIds: string[];
  /** Ids sent to the ledger (session ids, or NEAR accounts when CHAIN=near). */
  ledgerPlayers: string[];
  /** Stacks at hand start (before blinds), for per-hand deltas. */
  startStacks: Record<string, number>;
  committedTx?: string;
  revealed: boolean;
  revealTx?: string;
  settleTx?: string;
  errors?: string[];
};

export type PublicFairness = {
  handId: string;
  seedHash: string;
  committedTx?: string;
  revealed?: {
    serverSeed: string;
    entropy: string[];
    deckSeed: string;
    revealTx?: string;
  };
};

/** Only reveal secrets once the hand is complete AND marked revealed. */
export function publicFairness(state: StoredGame): PublicFairness | undefined {
  const f = state.fairness;
  if (!f) return undefined;
  const out: PublicFairness = { handId: f.handId, seedHash: f.seedHash };
  if (f.committedTx) out.committedTx = f.committedTx;
  if (f.revealed && state.nlhe?.street === 'complete') {
    out.revealed = {
      serverSeed: f.serverSeed,
      entropy: [...f.entropy],
      deckSeed: f.deckSeed,
      ...(f.revealTx ? { revealTx: f.revealTx } : {}),
    };
  }
  return out;
}

const STREET_TO_ROUND: Record<TableState['street'], GameState['round']> = {
  waiting: 'Ante',
  preflop: 'PreFlop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'End',
  complete: 'End',
};

const ROUND_LABEL: Record<GameState['round'], string> = {
  Ante: 'Ante',
  PreFlop: 'Pre-Flop',
  Flop: 'Flop',
  Turn: 'Turn',
  River: 'River',
  End: 'Showdown',
};

/**
 * Frontend card assets: suit 0=SPADE,1=HEART,2=DIAMOND,3=CLUB.
 * poker-engine: suit 0=c,1=d,2=h,3=s.
 */
export function pokerIdToUiId(id: number): number {
  const rank = id % 13;
  const pokerSuit = Math.floor(id / 13);
  const uiSuit = [3, 2, 1, 0][pokerSuit] ?? 0;
  return rank + uiSuit * 13;
}

export function blindsForLobby(minChips: number): {
  smallBlind: number;
  bigBlind: number;
} {
  const bigBlind = Math.max(2, Math.floor(Math.max(minChips, 20) / 10));
  const smallBlind = Math.max(1, Math.floor(bigBlind / 2));
  return { smallBlind, bigBlind };
}

export function createEmptyNlheLobby(opts: {
  name?: string;
  minChips?: number;
  maxPlayers?: number;
  joinCode?: string;
  gameId?: string;
}): StoredGame {
  const maxPlayers = Math.min(6, Math.max(2, opts.maxPlayers ?? 6));
  const base = createLobby({ ...opts, maxPlayers });
  return { ...base, nlhe: null, nlheSettled: false };
}

export function joinNlheLobby(
  state: StoredGame,
  player: { id: string; nickname: string }
): StoredGame {
  if (
    state.nlhe &&
    state.nlhe.street !== 'complete' &&
    state.nlhe.street !== 'waiting'
  ) {
    if (state.players.some((p) => p.id === player.id)) return state;
    throw new Error('HandInProgress');
  }
  const next = joinGame(state, player) as StoredGame;
  return {
    ...next,
    nlhe: state.nlhe ?? null,
    nlheSettled: state.nlheSettled ?? false,
  };
}

/**
 * Player ids in the order the engine will deal the next hand (= table order,
 * ascending seat). Entropy must be supplied in exactly this order.
 */
export function nextHandPlayerOrder(state: StoredGame): string[] {
  if (
    state.nlhe &&
    (state.nlhe.street === 'complete' || state.nlhe.street === 'waiting')
  ) {
    return state.nlhe.players.map((p) => p.id);
  }
  return [...state.players].sort((a, b) => a.seat - b.seat).map((p) => p.id);
}

/**
 * Start (or restart) a real NLHE hand using @nli/poker-engine.
 * `deckSeed` (32 bytes) selects the provably-fair shuffle (INTERFACES.md §1).
 */
export function startNlheHand(
  state: StoredGame,
  stacksByPlayerId: Record<string, number>,
  deckSeed?: Uint8Array
): StoredGame {
  if (state.players.length < 2) throw new Error('NotEnoughPlayers');

  const players = [...state.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      id: p.id,
      stack: Math.max(0, Math.floor(stacksByPlayerId[p.id] ?? 0)),
    }));

  const funded = players.filter((p) => p.stack > 0);
  if (funded.length < 2) throw new Error('NotEnoughFundedPlayers');

  const { smallBlind, bigBlind } = blindsForLobby(state.minChips ?? 0);

  let table: TableState;
  if (
    state.nlhe &&
    (state.nlhe.street === 'complete' || state.nlhe.street === 'waiting')
  ) {
    table = {
      ...state.nlhe,
      players: state.nlhe.players.map((p) => ({
        ...p,
        stack: Math.max(
          0,
          Math.floor(stacksByPlayerId[p.id] ?? p.stack)
        ),
        bet: 0,
        committed: 0,
        holeCards: [],
        folded: false,
        allIn: false,
      })),
    };
    table = startHand(table, { rotateButton: true, deckSeed });
  } else if (
    state.nlhe &&
    state.nlhe.street !== 'waiting' &&
    state.nlhe.street !== 'complete'
  ) {
    throw new Error('HandInProgress');
  } else {
    table = createTable(players, { smallBlind, bigBlind });
    table = startHand(table, { rotateButton: false, deckSeed });
  }

  const now = new Date().toISOString();
  return {
    ...state,
    status: 'playing',
    round: STREET_TO_ROUND[table.street],
    pot: table.potTotal,
    highestBet: table.currentBet,
    nextSeat: table.toAct >= 0 ? table.toAct : 0,
    winnerId: null,
    nlhe: table,
    nlheSettled: false,
    players: state.players.map((p) => {
      const ep = table.players.find((x) => x.id === p.id);
      return {
        ...p,
        chipsInPot: ep?.bet ?? 0,
        folded: ep?.folded ?? false,
        shuffled: true,
        holeCards: ep?.holeCards.map((c) => c.id) ?? [],
        chosenCommunity: [],
        weight: 0,
      };
    }),
    communityCards: padCommunity(table),
    updatedAt: now,
  };
}

function padCommunity(table: TableState): (number | null)[] {
  const ids = table.community.map((c) => c.id);
  return [0, 1, 2, 3, 4].map((i) => (ids[i] !== undefined ? ids[i]! : null));
}

function syncMetaFromTable(state: StoredGame, table: TableState): StoredGame {
  const ended = table.street === 'complete';
  const winners = table.result?.winners ?? [];
  const topWinner =
    winners.length > 0
      ? winners.reduce((a, b) => (a.amount >= b.amount ? a : b)).playerId
      : null;

  return {
    ...state,
    status: ended ? 'ended' : 'playing',
    round: STREET_TO_ROUND[table.street],
    pot: table.potTotal,
    highestBet: table.currentBet,
    nextSeat: table.toAct >= 0 ? table.toAct : 0,
    winnerId: ended ? topWinner : null,
    nlhe: table,
    players: state.players.map((p) => {
      const ep = table.players.find((x) => x.id === p.id);
      if (!ep) return p;
      return {
        ...p,
        chipsInPot: ep.bet,
        folded: ep.folded,
        shuffled: true,
        holeCards: ep.holeCards.map((c) => c.id),
        weight: 0,
      };
    }),
    communityCards: padCommunity(table),
    updatedAt: new Date().toISOString(),
  };
}

/** Map UI bet amount (0 = check, else absolute street target) → engine action. */
export function mapUiBetToAction(
  table: TableState,
  playerId: string,
  amount: number
): PlayerAction {
  const player = table.players.find((p) => p.id === playerId);
  if (!player) throw new Error('NotAPlayer');
  const legal = getLegalActions(table);
  const toCall = Math.max(0, table.currentBet - player.bet);
  const maxStreet = player.bet + player.stack;

  if (amount <= 0) {
    if (legal.includes('check')) return { type: 'check' };
    throw new Error('CannotCheck');
  }

  if (amount >= maxStreet) {
    return { type: 'all-in' };
  }

  if (toCall > 0 && (amount === table.currentBet || amount === toCall)) {
    if (legal.includes('call')) return { type: 'call' };
    if (legal.includes('all-in')) return { type: 'all-in' };
  }

  // Only an unopened street is a 'bet'. With a live bet (e.g. the big blind's
  // preflop option) a bigger amount is a 'raise' — the engine rejects 'bet'
  // there with MustRaise.
  if (table.currentBet === 0) {
    if (legal.includes('bet') && amount > player.bet) {
      return { type: 'bet', amount };
    }
  }

  if (amount > table.currentBet && legal.includes('raise')) {
    return { type: 'raise', amount };
  }

  if (toCall > 0 && legal.includes('call') && amount <= table.currentBet) {
    return { type: 'call' };
  }

  throw new Error(`IllegalBet:${amount}`);
}

export function applyNlheBet(
  state: StoredGame,
  playerId: string,
  amount: number
): StoredGame {
  if (!state.nlhe) throw new Error('NoHandActive');
  const action = mapUiBetToAction(state.nlhe, playerId, amount);
  const table = applyAction(state.nlhe, playerId, action);
  return syncMetaFromTable(state, table);
}

export function applyNlheFold(
  state: StoredGame,
  playerId: string
): StoredGame {
  if (!state.nlhe) throw new Error('NoHandActive');
  const table = applyAction(state.nlhe, playerId, { type: 'fold' });
  return syncMetaFromTable(state, table);
}

export function stacksFromNlhe(
  state: StoredGame
): Record<string, number> | null {
  if (!state.nlhe) return null;
  const out: Record<string, number> = {};
  for (const p of state.nlhe.players) out[p.id] = p.stack;
  return out;
}

/** INTERFACES.md §4 `players[i].bot`. */
export type PublicBotInfo = {
  persona: string;
  model?: string;
  attested?: boolean;
  signingAddress?: string;
  lastLine?: string;
};

/** INTERFACES.md §5.4 `players[i].agent` (arena tables only). */
export type PublicAgentInfo = {
  model: string;
  movesVerified: number;
  lastReceiptUrl?: string;
  /** Table talk from its latest accepted move (only while fresh; drives the speech bubble). */
  lastLine?: string;
  lastLineAt?: number;
};

export type NlhePublicView = Omit<PublicGameView, 'players'> & {
  players: Array<
    PublicGameView['players'][number] & {
      bot?: PublicBotInfo;
      agent?: PublicAgentInfo;
      /** No chips behind and still in the hand. */
      allIn?: boolean;
      /** Chips this player has put in across the whole hand. */
      committed?: number;
    }
  >;
  /** true on Agent Arena tables (INTERFACES.md §5.4). */
  arena?: boolean;
  minRaise: number;
  dealerSeat: number;
  stacksByPlayerId: Record<string, number>;
  fairness?: PublicFairness;
  /** Name of the top winner's best 5-card hand ("Two Pair", …); only when the hand ended at showdown. */
  winningHand?: string;
  /* ---- Spectator broadcast fields (additive; all derived from public information) ---- */
  smallBlind?: number;
  bigBlind?: number;
  /** Player ids posting the blinds this hand. */
  sbPlayerId?: string | null;
  bbPlayerId?: string | null;
  /** This hand's betting actions in order; `amount` = player's street total after the action. */
  actions?: PublicAction[];
  /**
   * Main + side pots. In-hand: only chips from completed streets (current street bets are
   * still in front of the players). At hand end: the pots that were awarded.
   */
  pots?: PublicPot[];
  /** Hand end only: who won what (one entry per pot share). */
  winners?: Array<{ playerId: string; amount: number; potIndex: number }>;
  /** Hand end at showdown only: every contender's best-hand name. */
  showdownHands?: Array<{ playerId: string; handName: string }>;
};

export type PublicAction = {
  playerId: string;
  street: string;
  type: string;
  /** Street total for this player after the action (bet / raise / call / all-in). */
  amount?: number;
};

export type PublicPot = { amount: number; eligible: string[] };

/** SB / BB player ids, mirroring the engine's `startHand` blind posting. */
export function blindPlayerIds(table: TableState): {
  sb: string | null;
  bb: string | null;
} {
  const dealt = [...table.players]
    .filter((p) => p.holeCards.length > 0)
    .sort((a, b) => a.seat - b.seat);
  if (dealt.length < 2) return { sb: null, bb: null };
  const after = (seat: number) =>
    dealt.find((p) => p.seat > seat) ?? dealt[0]!;
  const btn = dealt.find((p) => p.seat === table.button);
  const sb = dealt.length === 2 && btn ? btn : after(table.button);
  const bb = after(sb.seat);
  return { sb: sb.id, bb: bb.id };
}

/**
 * Public action log with a normalised `amount` (the actor's street total after acting).
 * The engine records `amount` inconsistently (target for raises, delta for short all-ins),
 * so replay the street bets here. Uses only public information.
 */
export function publicActions(table: TableState): PublicAction[] {
  const { sb, bb } = blindPlayerIds(table);
  let street = 'preflop';
  let bets = new Map<string, number>();
  let currentBet = 0;
  const resetPreflop = () => {
    bets = new Map();
    if (sb) bets.set(sb, table.config.smallBlind);
    if (bb) bets.set(bb, table.config.bigBlind);
    currentBet = table.config.bigBlind;
  };
  resetPreflop();
  const out: PublicAction[] = [];
  for (const h of table.actionHistory) {
    if (h.street !== street) {
      street = h.street;
      bets = new Map();
      currentBet = 0;
    }
    const before = bets.get(h.playerId) ?? 0;
    let amount: number | undefined;
    if (h.type === 'call') {
      amount = currentBet;
    } else if (h.type === 'bet' || h.type === 'raise') {
      amount = h.amount ?? currentBet;
    } else if (h.type === 'all-in') {
      const a = h.amount ?? 0;
      amount = a > currentBet ? a : before + a;
    }
    if (amount != null) {
      bets.set(h.playerId, amount);
      currentBet = Math.max(currentBet, amount);
    }
    out.push({
      playerId: h.playerId,
      street: h.street,
      type: h.type,
      ...(amount != null ? { amount } : {}),
    });
  }
  return out;
}

/** Merge adjacent pots with the same eligible set (folded-player layers). */
function mergePots(pots: Array<{ amount: number; eligible: string[] }>): PublicPot[] {
  const out: PublicPot[] = [];
  for (const p of pots) {
    if (p.amount <= 0) continue;
    const key = [...p.eligible].sort().join(',');
    const last = out[out.length - 1];
    if (last && [...last.eligible].sort().join(',') === key) {
      last.amount += p.amount;
    } else {
      out.push({ amount: p.amount, eligible: [...p.eligible] });
    }
  }
  return out;
}

export function publicPots(table: TableState): PublicPot[] {
  if (table.street === 'complete') return mergePots(table.pots);
  // In-hand: chips already pulled into the middle (completed streets only).
  const settled = table.players.map((p) => ({
    ...p,
    committed: Math.max(0, p.committed - p.bet),
  }));
  return mergePots(buildPots(settled));
}

export function toNlhePublicView(
  state: StoredGame,
  viewerId: string | null
): NlhePublicView {
  if (!state.nlhe) {
    const base = legacyToPublicView(state, viewerId);
    return {
      ...base,
      minRaise: 1,
      dealerSeat: 0,
      stacksByPlayerId: Object.fromEntries(state.players.map((p) => [p.id, 0])),
      totalShuffles: state.players.length,
      status: state.status === 'shuffling' ? 'waiting' : state.status,
    };
  }

  const table = state.nlhe;
  const reveal =
    table.street === 'showdown' ||
    table.street === 'complete' ||
    Boolean(table.result?.showdown);
  const ended = table.street === 'complete';
  const actor = table.players.find((p) => p.seat === table.toAct) ?? null;

  const winners = table.result?.winners ?? [];
  const topWinnerId =
    winners.length > 0
      ? winners.reduce((a, b) => (a.amount >= b.amount ? a : b)).playerId
      : null;
  const winningHand =
    ended && table.result?.showdown && topWinnerId != null
      ? table.result.rankings.find((r) => r.playerId === topWinnerId)?.handName
      : undefined;
  const winnerNick =
    topWinnerId != null
      ? state.players.find((p) => p.id === topWinnerId)?.nickname ?? null
      : null;

  const stacksByPlayerId: Record<string, number> = {};
  const players = state.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((meta) => {
      const ep = table.players.find((p) => p.id === meta.id);
      stacksByPlayerId[meta.id] = ep?.stack ?? 0;
      const holeRaw = ep?.holeCards ?? [];
      let holeCards: number[];
      if (holeRaw.length === 0) {
        holeCards = [];
      } else if (meta.id === viewerId || reveal) {
        holeCards = holeRaw.map((c) => pokerIdToUiId(c.id));
      } else {
        holeCards = holeRaw.map(() => -1);
      }
      return {
        id: meta.id,
        nickname: meta.nickname,
        seat: meta.seat,
        chipsInPot: ep?.bet ?? 0,
        folded: ep?.folded ?? false,
        shuffled: true,
        holeCards,
        chosenCommunity: [] as number[],
        weight: 0,
        allIn: Boolean(ep?.allIn && !ep.folded && holeRaw.length > 0),
        committed: ep?.committed ?? 0,
      };
    });

  const communityIds = table.community.map((c) => pokerIdToUiId(c.id));
  const communityCards = [
    ...communityIds,
    ...Array.from({ length: Math.max(0, 5 - communityIds.length) }, () => -1),
  ];

  const round = STREET_TO_ROUND[table.street];
  const blinds = blindPlayerIds(table);
  const showdownHands =
    ended && table.result?.showdown
      ? table.result.rankings.map((r) => ({
          playerId: r.playerId,
          handName: r.handName,
        }))
      : undefined;

  return {
    gameId: state.gameId,
    name: state.name ?? 'Table',
    joinCode: state.joinCode ?? '',
    minChips: state.minChips ?? 0,
    maxPlayers: state.maxPlayers ?? 6,
    status: ended ? 'ended' : 'playing',
    round,
    roundLabel: ROUND_LABEL[round],
    players,
    communityCards,
    pot: table.potTotal,
    highestBet: table.currentBet,
    minRaise: table.minRaise,
    dealerSeat: table.button,
    nextSeat: table.toAct,
    nextPlayerId: actor?.id ?? null,
    nextPlayerNickname:
      actor != null
        ? state.players.find((p) => p.id === actor.id)?.nickname ?? null
        : null,
    winnerId: ended ? topWinnerId : null,
    winnerNickname: ended ? winnerNick : null,
    totalPlayers: state.players.length,
    totalShuffles: state.players.length,
    gameStarted: true,
    gameEnded: ended,
    myPlayerId: viewerId,
    isMyTurn: Boolean(viewerId && actor && actor.id === viewerId),
    stacksByPlayerId,
    fairness: publicFairness(state),
    ...(winningHand ? { winningHand } : {}),
    smallBlind: table.config.smallBlind,
    bigBlind: table.config.bigBlind,
    sbPlayerId: blinds.sb,
    bbPlayerId: blinds.bb,
    actions: publicActions(table),
    pots: publicPots(table),
    ...(ended
      ? { winners: (table.result?.winners ?? []).map((w) => ({ ...w })) }
      : {}),
    ...(showdownHands ? { showdownHands } : {}),
  };
}

export { listLobbySummary, makeJoinCode };
