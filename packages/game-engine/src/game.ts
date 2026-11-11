import { createShuffledDeck } from './deck.js';
import { getWeightFromIds } from './texas-poker.js';
import type {
  GameRound,
  GameState,
  PlayerState,
  PublicGameView,
} from './types.js';

const ROUND_LABELS: Record<GameRound, string> = {
  Ante: 'Ante',
  PreFlop: 'Pre-Flop',
  Flop: 'Flop',
  Turn: 'Turn',
  River: 'River',
  End: 'End',
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeJoinCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += JOIN_CODE_ALPHABET[
      Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)
    ]!;
  }
  return code;
}

export type LobbyOptions = {
  name?: string;
  minChips?: number;
  maxPlayers?: number;
  joinCode?: string;
  gameId?: string;
};

function lobbyMeta(opts: LobbyOptions = {}) {
  const name = (opts.name ?? 'Table').trim().slice(0, 48) || 'Table';
  const minChips = Math.max(0, Math.floor(opts.minChips ?? 0));
  const maxPlayers = Math.min(
    10,
    Math.max(2, Math.floor(opts.maxPlayers ?? 6))
  );
  return {
    name,
    minChips,
    maxPlayers,
    joinCode: (opts.joinCode ?? makeJoinCode()).toUpperCase(),
    gameId: opts.gameId ?? makeId('game'),
  };
}

export function createGame(
  creator: { id: string; nickname: string },
  gameIdOrOpts?: string | LobbyOptions
): GameState {
  const opts =
    typeof gameIdOrOpts === 'string'
      ? { gameId: gameIdOrOpts }
      : (gameIdOrOpts ?? {});
  const meta = lobbyMeta(opts);

  const player: PlayerState = {
    id: creator.id,
    nickname: creator.nickname,
    seat: 0,
    chipsInPot: 0,
    folded: false,
    shuffled: false,
    holeCards: [],
    chosenCommunity: [],
    weight: 0,
  };

  const ts = nowIso();
  return {
    gameId: meta.gameId,
    name: meta.name,
    joinCode: meta.joinCode,
    minChips: meta.minChips,
    maxPlayers: meta.maxPlayers,
    status: 'waiting',
    round: 'Ante',
    players: [player],
    deck: [],
    communityCards: [null, null, null, null, null],
    nextCardIndex: 0,
    pot: 0,
    highestBet: 0,
    nextSeat: 0,
    winnerId: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Empty waiting lobby — players join later (admin-created tables). */
export function createLobby(opts: LobbyOptions = {}): GameState {
  const meta = lobbyMeta(opts);
  const ts = nowIso();
  return {
    gameId: meta.gameId,
    name: meta.name,
    joinCode: meta.joinCode,
    minChips: meta.minChips,
    maxPlayers: meta.maxPlayers,
    status: 'waiting',
    round: 'Ante',
    players: [],
    deck: [],
    communityCards: [null, null, null, null, null],
    nextCardIndex: 0,
    pot: 0,
    highestBet: 0,
    nextSeat: 0,
    winnerId: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function joinGame(
  state: GameState,
  player: { id: string; nickname: string }
): GameState {
  if (state.status !== 'waiting') {
    throw new Error('GameAlreadyStarted');
  }
  if (state.players.some((p) => p.id === player.id)) {
    return state;
  }
  const maxPlayers = state.maxPlayers ?? 6;
  if (state.players.length >= maxPlayers) {
    throw new Error('LobbyFull');
  }
  const next: PlayerState = {
    id: player.id,
    nickname: player.nickname,
    seat: state.players.length,
    chipsInPot: 0,
    folded: false,
    shuffled: false,
    holeCards: [],
    chosenCommunity: [],
    weight: 0,
  };
  return {
    ...state,
    players: [...state.players, next],
    updatedAt: nowIso(),
  };
}

export function startGame(state: GameState): GameState {
  if (state.status !== 'waiting') {
    throw new Error('GameAlreadyStarted');
  }
  if (state.players.length < 2) {
    throw new Error('NotEnoughPlayers');
  }
  return {
    ...state,
    status: 'shuffling',
    players: state.players.map((p) => ({ ...p, shuffled: false })),
    updatedAt: nowIso(),
  };
}

/** Marks a player as shuffled. When all have shuffled, deal and enter Ante. */
export function playerShuffle(state: GameState, playerId: string): GameState {
  if (state.status !== 'shuffling') {
    throw new Error('NotInShuffleStage');
  }
  const players = state.players.map((p) =>
    p.id === playerId ? { ...p, shuffled: true } : p
  );
  if (!players.some((p) => p.id === playerId)) {
    throw new Error('NotAPlayer');
  }
  const allShuffled = players.every((p) => p.shuffled);
  if (!allShuffled) {
    return { ...state, players, updatedAt: nowIso() };
  }
  return dealAfterShuffle({ ...state, players });
}

function dealAfterShuffle(state: GameState): GameState {
  const deck = createShuffledDeck();
  // Deck ready; hole cards dealt when Ante completes (matches Game.sol).
  return {
    ...state,
    status: 'playing',
    round: 'Ante',
    deck,
    players: state.players.map((p) => ({
      ...p,
      holeCards: [],
      chosenCommunity: [],
      weight: 0,
    })),
    communityCards: [null, null, null, null, null],
    nextCardIndex: 1, // burn index 0
    pot: 0,
    highestBet: 0,
    nextSeat: 0,
    winnerId: null,
    updatedAt: nowIso(),
  };
}

function recomputePot(players: PlayerState[]): number {
  return players.reduce((sum, p) => sum + p.chipsInPot, 0);
}

function advanceRound(state: GameState): GameState {
  let { round, communityCards, nextCardIndex, deck, players } = state;

  if (round === 'Ante') {
    // Burn already accounted for in nextCardIndex; deal 2 holes each
    let next = nextCardIndex;
    players = players.map((p) => {
      const holeCards = [deck[next]!, deck[next + 1]!];
      next += 2;
      return { ...p, holeCards };
    });
    nextCardIndex = next;
    round = 'PreFlop';
  } else if (round === 'PreFlop') {
    communityCards = [...communityCards];
    for (let i = 0; i < 3; i++) {
      communityCards[i] = deck[nextCardIndex]!;
      nextCardIndex++;
    }
    round = 'Flop';
  } else if (round === 'Flop') {
    communityCards = [...communityCards];
    communityCards[3] = deck[nextCardIndex]!;
    nextCardIndex++;
    round = 'Turn';
  } else if (round === 'Turn') {
    communityCards = [...communityCards];
    communityCards[4] = deck[nextCardIndex]!;
    nextCardIndex++;
    round = 'River';
  } else if (round === 'River') {
    round = 'End';
  } else {
    throw new Error('LastRound');
  }

  return {
    ...state,
    round,
    players,
    communityCards,
    nextCardIndex,
    nextSeat: 0,
    updatedAt: nowIso(),
  };
}

export function placeBet(
  state: GameState,
  playerId: string,
  amount: number
): GameState {
  if (state.status !== 'playing') {
    throw new Error('GameNotStarted');
  }
  if (state.round === 'End') {
    throw new Error('GameEnded');
  }
  const actor = state.players[state.nextSeat];
  if (!actor || actor.id !== playerId) {
    throw new Error('InvalidBetSequence');
  }
  if (actor.folded) {
    throw new Error('PlayerFolded');
  }
  if (amount < state.highestBet) {
    throw new Error('InvalidBetAmount');
  }

  const players = state.players.map((p) =>
    p.id === playerId ? { ...p, chipsInPot: p.chipsInPot + amount } : p
  );
  const highestBet = amount > state.highestBet ? amount : state.highestBet;
  const pot = recomputePot(players);
  const isLastSeat = state.nextSeat === state.players.length - 1;

  let next: GameState = {
    ...state,
    players,
    pot,
    highestBet,
    updatedAt: nowIso(),
  };

  if (isLastSeat) {
    next = advanceRound({ ...next, nextSeat: 0 });
  } else {
    next = { ...next, nextSeat: state.nextSeat + 1 };
  }
  return next;
}

export function fold(state: GameState, playerId: string): GameState {
  if (state.status !== 'playing') {
    throw new Error('GameNotStarted');
  }
  const actor = state.players[state.nextSeat];
  if (!actor || actor.id !== playerId) {
    throw new Error('InvalidBetSequence');
  }
  if (actor.folded) {
    throw new Error('AlreadyFolded');
  }
  const players = state.players.map((p) =>
    p.id === playerId ? { ...p, folded: true } : p
  );
  return { ...state, players, updatedAt: nowIso() };
}

export function chooseCards(
  state: GameState,
  playerId: string,
  communityFaceValues: [number, number, number]
): GameState {
  if (state.round !== 'End') {
    throw new Error('GameNotEnded');
  }
  const community = state.communityCards.filter((c): c is number => c !== null);
  for (const card of communityFaceValues) {
    if (!community.includes(card)) {
      throw new Error('NotACommunityCard');
    }
  }
  if (new Set(communityFaceValues).size !== 3) {
    throw new Error('DuplicateCommunityCard');
  }
  if (!state.players.some((p) => p.id === playerId)) {
    throw new Error('NotAPlayer');
  }

  const players = state.players.map((p) =>
    p.id === playerId
      ? { ...p, chosenCommunity: [...communityFaceValues] }
      : p
  );
  return { ...state, players, updatedAt: nowIso() };
}

export function declareWinner(state: GameState): GameState {
  if (state.winnerId) {
    throw new Error('WinnerAlreadyDeclared');
  }
  if (state.round !== 'End') {
    throw new Error('GameNotEnded');
  }

  const active = state.players.filter((p) => !p.folded);
  if (active.some((p) => p.chosenCommunity.length !== 3)) {
    throw new Error('PlayersMustChooseCards');
  }

  const pot = recomputePot(state.players);
  let bestId = active[0]!.id;
  let bestWeight = -1;

  const players = state.players.map((p) => {
    if (p.folded || p.chosenCommunity.length !== 3) {
      return { ...p, weight: 0 };
    }
    const hand = [...p.holeCards, ...p.chosenCommunity];
    const weight = getWeightFromIds(hand);
    if (weight > bestWeight) {
      bestWeight = weight;
      bestId = p.id;
    }
    return { ...p, weight };
  });

  const awarded = players.map((p) => ({
    ...p,
    chipsInPot: p.id === bestId ? pot : 0,
  }));

  return {
    ...state,
    players: awarded,
    pot,
    winnerId: bestId,
    status: 'ended',
    updatedAt: nowIso(),
  };
}

export function toPublicView(
  state: GameState,
  viewerId: string | null
): PublicGameView {
  const totalShuffles = state.players.filter((p) => p.shuffled).length;
  const nextPlayer = state.players[state.nextSeat] ?? null;
  const winner = state.players.find((p) => p.id === state.winnerId) ?? null;
  const revealed = state.round === 'End' || state.status === 'ended';

  const players = state.players.map((p) => {
    const isSelf = p.id === viewerId;
    let holeCards: number[];
    if (p.holeCards.length === 0) {
      holeCards = [];
    } else if (isSelf || revealed) {
      holeCards = [...p.holeCards];
    } else {
      holeCards = p.holeCards.map(() => -1);
    }
    return {
      id: p.id,
      nickname: p.nickname,
      seat: p.seat,
      chipsInPot: p.chipsInPot,
      folded: p.folded,
      shuffled: p.shuffled,
      holeCards,
      chosenCommunity: [...p.chosenCommunity],
      weight: p.weight,
    };
  });

  const communityCards = state.communityCards.map((c) =>
    c === null ? -1 : c
  );

  return {
    gameId: state.gameId,
    name: state.name ?? 'Table',
    joinCode: state.joinCode ?? '',
    minChips: state.minChips ?? 0,
    maxPlayers: state.maxPlayers ?? 6,
    status: state.status,
    round: state.round,
    roundLabel: ROUND_LABELS[state.round],
    players,
    communityCards,
    pot: state.pot,
    highestBet: state.highestBet,
    nextSeat: state.nextSeat,
    nextPlayerId: nextPlayer?.id ?? null,
    nextPlayerNickname: nextPlayer?.nickname ?? null,
    winnerId: state.winnerId,
    winnerNickname: winner?.nickname ?? null,
    totalPlayers: state.players.length,
    totalShuffles,
    gameStarted: state.status !== 'waiting',
    gameEnded: state.status === 'ended' || Boolean(state.winnerId),
    myPlayerId: viewerId,
    isMyTurn: Boolean(viewerId && nextPlayer?.id === viewerId),
  };
}

export function listLobbySummary(state: GameState) {
  return {
    gameId: state.gameId,
    name: state.name ?? 'Table',
    joinCode: state.joinCode ?? '',
    minChips: state.minChips ?? 0,
    maxPlayers: state.maxPlayers ?? 6,
    totalPlayers: state.players.length,
    players: state.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      seat: p.seat,
    })),
    currentRound: ROUND_LABELS[state.round],
    round: state.round,
    status: state.status,
    pot: state.pot,
    winnerId: state.winnerId,
    winnerNickname:
      state.players.find((p) => p.id === state.winnerId)?.nickname ?? null,
    gameStarted: state.status !== 'waiting',
    gameEnded: state.status === 'ended' || Boolean(state.winnerId),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

