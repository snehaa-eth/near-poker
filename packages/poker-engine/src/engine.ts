import { draw, createShuffledDeck } from './deck.js';
import { shuffleFromSeed } from './fairness.js';
import { compareScores, evaluateBestHand } from './hand-rank.js';
import { buildPots, potTotal } from './pots.js';
import type {
  ActionType,
  EnginePlayer,
  HandResult,
  HandWinner,
  PlayerAction,
  Street,
  TableConfig,
  TableState,
} from './types.js';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

function assertPlayers(n: number) {
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`InvalidPlayerCount:${n}`);
  }
}

function clonePlayers(players: EnginePlayer[]): EnginePlayer[] {
  return players.map((p) => ({
    ...p,
    holeCards: [...p.holeCards],
  }));
}

function activePlayers(players: EnginePlayer[]): EnginePlayer[] {
  return players.filter((p) => !p.folded);
}

function canAct(p: EnginePlayer): boolean {
  return !p.folded && !p.allIn && p.stack > 0;
}

function seatsNeedingAction(
  players: EnginePlayer[],
  currentBet: number
): number[] {
  return players
    .filter((p) => canAct(p) && p.bet < currentBet)
    .map((p) => p.seat);
}

function nextSeatFrom(
  players: EnginePlayer[],
  fromSeat: number,
  pred: (p: EnginePlayer) => boolean
): number {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (fromSeat + i) % n;
    const p = players.find((x) => x.seat === seat);
    if (p && pred(p)) return seat;
  }
  return -1;
}

function recomputePotTotal(players: EnginePlayer[]): number {
  return players.reduce((s, p) => s + p.committed, 0);
}

function withHistory(
  state: TableState,
  playerId: string,
  type: ActionType,
  amount?: number
): TableState['actionHistory'] {
  return [
    ...state.actionHistory,
    { playerId, street: state.street, type, amount },
  ];
}

export function createTable(
  playerSpecs: Array<{ id: string; stack: number }>,
  config: TableConfig,
  handId = `hand_${Date.now()}`
): TableState {
  assertPlayers(playerSpecs.length);
  for (const p of playerSpecs) {
    if (p.stack <= 0) throw new Error(`InvalidStack:${p.id}`);
  }
  if (config.smallBlind <= 0 || config.bigBlind < config.smallBlind) {
    throw new Error('InvalidBlinds');
  }

  const seed = config.seed ?? 1;
  const players: EnginePlayer[] = playerSpecs.map((p, seat) => ({
    id: p.id,
    seat,
    stack: p.stack,
    bet: 0,
    committed: 0,
    holeCards: [],
    folded: false,
    allIn: false,
  }));

  return {
    handId,
    config: { ...config, seed },
    street: 'waiting',
    button: 0,
    toAct: -1,
    community: [],
    deck: [],
    players,
    currentBet: 0,
    minRaise: config.bigBlind,
    pendingSeats: [],
    pots: [],
    potTotal: 0,
    lastAggressorSeat: null,
    result: null,
    rngState: seed >>> 0,
    actionHistory: [],
  };
}

function postBlind(
  players: EnginePlayer[],
  seat: number,
  amount: number
): EnginePlayer[] {
  return players.map((p) => {
    if (p.seat !== seat) return p;
    const pay = Math.min(amount, p.stack);
    const stack = p.stack - pay;
    return {
      ...p,
      stack,
      bet: p.bet + pay,
      committed: p.committed + pay,
      allIn: stack === 0,
    };
  });
}

function dealHoleCards(state: TableState): TableState {
  let deck = state.deck;
  const players = clonePlayers(state.players);
  for (const p of players) {
    const drawn = draw(deck, 2);
    deck = drawn.rest;
    p.holeCards = drawn.cards;
  }
  return { ...state, deck, players };
}

function dealCommunity(state: TableState, n: number): TableState {
  // Burn one
  let deck = draw(state.deck, 1).rest;
  const drawn = draw(deck, n);
  return {
    ...state,
    deck: drawn.rest,
    community: [...state.community, ...drawn.cards],
  };
}

function startStreet(
  state: TableState,
  street: Street,
  firstToActFromButton: boolean
): TableState {
  const players = state.players.map((p) => ({ ...p, bet: 0 }));
  const currentBet = 0;
  const minRaise = state.config.bigBlind;

  let toAct: number;
  if (street === 'preflop') {
    // UTG = left of BB. BB is left of SB; SB is left of button (heads-up special-cased below).
    const n = players.length;
    if (n === 2) {
      // Heads-up: button is SB and acts first preflop
      toAct = state.button;
    } else {
      const sb = nextSeatFrom(players, state.button, () => true);
      const bb = nextSeatFrom(players, sb, () => true);
      toAct = nextSeatFrom(players, bb, canAct);
    }
  } else if (firstToActFromButton) {
    toAct = nextSeatFrom(players, state.button, canAct);
  } else {
    toAct = nextSeatFrom(players, state.button, canAct);
  }

  const actors = players.filter(canAct);
  // If fewer than 2 can act (rest all-in), skip betting
  if (actors.length <= 1 && activePlayers(players).length >= 2) {
    return finishStreetOrRunout({
      ...state,
      street,
      players,
      currentBet,
      minRaise,
      toAct: -1,
      pendingSeats: [],
      lastAggressorSeat: null,
      raiseClosedSeats: [],
      potTotal: recomputePotTotal(players),
    });
  }

  const pendingSeats = players.filter(canAct).map((p) => p.seat);

  return {
    ...state,
    street,
    players,
    currentBet,
    minRaise,
    toAct,
    pendingSeats,
    lastAggressorSeat: null,
    raiseClosedSeats: [],
    potTotal: recomputePotTotal(players),
  };
}

function finishStreetOrRunout(state: TableState): TableState {
  const alive = activePlayers(state.players);
  if (alive.length === 1) {
    return awardFoldWin(state, alive[0]!.id);
  }

  if (state.street === 'preflop') {
    return startStreet(dealCommunity(state, 3), 'flop', true);
  }
  if (state.street === 'flop') {
    return startStreet(dealCommunity(state, 1), 'turn', true);
  }
  if (state.street === 'turn') {
    return startStreet(dealCommunity(state, 1), 'river', true);
  }
  if (state.street === 'river') {
    return goShowdown(state);
  }
  return state;
}

function awardFoldWin(state: TableState, winnerId: string): TableState {
  const pots = buildPots(state.players);
  const total = potTotal(pots) || recomputePotTotal(state.players);
  const players = state.players.map((p) =>
    p.id === winnerId ? { ...p, stack: p.stack + total } : p
  );
  const winners: HandWinner[] = [{ playerId: winnerId, amount: total, potIndex: 0 }];
  const result: HandResult = {
    winners,
    showdown: false,
    rankings: [],
  };
  return {
    ...state,
    street: 'complete',
    players,
    pots,
    potTotal: 0,
    toAct: -1,
    pendingSeats: [],
    result,
  };
}

function goShowdown(state: TableState): TableState {
  const pots = buildPots(state.players);
  const rankings = activePlayers(state.players).map((p) => {
    const ev = evaluateBestHand([...p.holeCards, ...state.community]);
    return { playerId: p.id, handName: ev.name, score: ev.score };
  });

  const winners: HandWinner[] = [];
  const stacks = new Map(state.players.map((p) => [p.id, p.stack]));

  pots.forEach((pot, potIndex) => {
    const contenders = rankings.filter((r) => pot.eligible.includes(r.playerId));
    if (contenders.length === 0 || pot.amount === 0) return;

    let best = contenders[0]!;
    for (const c of contenders.slice(1)) {
      if (compareScores(c.score, best.score) > 0) best = c;
    }
    const top = contenders.filter(
      (c) => compareScores(c.score, best.score) === 0
    );
    const share = Math.floor(pot.amount / top.length);
    let remainder = pot.amount - share * top.length;
    // Deterministic remainder: lowest seat first
    const ordered = [...top].sort((a, b) => {
      const sa = state.players.find((p) => p.id === a.playerId)!.seat;
      const sb = state.players.find((p) => p.id === b.playerId)!.seat;
      return sa - sb;
    });
    for (const w of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      const amt = share + extra;
      winners.push({ playerId: w.playerId, amount: amt, potIndex });
      stacks.set(w.playerId, (stacks.get(w.playerId) ?? 0) + amt);
    }
  });

  const players = state.players.map((p) => ({
    ...p,
    stack: stacks.get(p.id) ?? p.stack,
  }));

  return {
    ...state,
    street: 'complete',
    players,
    pots,
    potTotal: 0,
    toAct: -1,
    pendingSeats: [],
    result: { winners, showdown: true, rankings },
  };
}

function streetComplete(state: TableState): boolean {
  const actors = state.players.filter(canAct);
  if (actors.length === 0) return true;
  if (activePlayers(state.players).length <= 1) return true;
  // Everyone who can act has matched currentBet and pending cleared
  if (state.pendingSeats.length > 0) return false;
  return actors.every((p) => p.bet === state.currentBet);
}

function afterAction(state: TableState): TableState {
  if (activePlayers(state.players).length === 1) {
    return awardFoldWin(state, activePlayers(state.players)[0]!.id);
  }

  if (streetComplete(state)) {
    return finishStreetOrRunout(state);
  }

  const toAct = nextSeatFrom(state.players, state.toAct, (p) =>
    state.pendingSeats.includes(p.seat)
  );
  return { ...state, toAct };
}

function removePending(pending: number[], seat: number): number[] {
  return pending.filter((s) => s !== seat);
}

function reopenAction(
  players: EnginePlayer[],
  aggressorSeat: number
): number[] {
  return players.filter((p) => canAct(p) && p.seat !== aggressorSeat).map((p) => p.seat);
}

/**
 * Start a new hand. Rotates button when `rotateButton` is true (default after first hand).
 */
export function startHand(
  state: TableState,
  options?: {
    rotateButton?: boolean;
    /** Provably-fair 32-byte deck seed (INTERFACES.md §1). When set, the deck is
     *  `shuffleFromSeed(deckSeed)` instead of the legacy mulberry32 shuffle. */
    deckSeed?: Uint8Array;
  }
): TableState {
  if (state.street !== 'waiting' && state.street !== 'complete') {
    throw new Error('HandInProgress');
  }
  assertPlayers(state.players.length);

  const rotate = options?.rotateButton ?? state.street === 'complete';
  const button = rotate
    ? (state.button + 1) % state.players.length
    : state.button;

  const { deck, rngState } = options?.deckSeed
    ? { deck: shuffleFromSeed(options.deckSeed), rngState: state.rngState }
    : createShuffledDeck(state.rngState);

  let players: EnginePlayer[] = state.players.map((p) => ({
    ...p,
    bet: 0,
    committed: 0,
    holeCards: [],
    folded: false,
    allIn: p.stack === 0,
  }));

  // Eliminate broke players for this hand
  const funded = players.filter((p) => p.stack > 0);
  if (funded.length < MIN_PLAYERS) throw new Error('NotEnoughFundedPlayers');

  const n = players.length;
  const sbSeat =
    n === 2 ? button : nextSeatFrom(players, button, (p) => p.stack > 0);
  const bbSeat = nextSeatFrom(players, sbSeat, (p) => p.stack > 0);

  players = postBlind(players, sbSeat, state.config.smallBlind);
  players = postBlind(players, bbSeat, state.config.bigBlind);

  // A big blind that is all-in for less still sets the full big blind as the
  // amount to call (standard rule); any excess is returned via the pot layers.
  const bbPosted = state.config.bigBlind;

  let next: TableState = {
    ...state,
    handId: `${state.handId}_n`,
    street: 'preflop',
    button,
    deck,
    rngState,
    community: [],
    players,
    currentBet: bbPosted,
    minRaise: state.config.bigBlind,
    lastAggressorSeat: bbSeat,
    pots: [],
    potTotal: recomputePotTotal(players),
    result: null,
    actionHistory: [],
    pendingSeats: [],
    raiseClosedSeats: [],
    toAct: -1,
  };

  next = dealHoleCards(next);

  // Preflop pending: everyone who can act must act once; BB may check option
  // Preflop pending: everyone who can act must act once; BB may check option
  const preflopToAct =
    n === 2
      ? canAct(next.players.find((p) => p.seat === button)!)
        ? button
        : nextSeatFrom(next.players, button, canAct)
      : nextSeatFrom(next.players, bbSeat, canAct);

  next = {
    ...next,
    pendingSeats: next.players.filter(canAct).map((p) => p.seat),
    toAct: preflopToAct,
  };

  // Everyone already all-in from blinds → run out board. A lone player who still
  // faces a bigger blind must first decide to call or fold.
  const blindActors = next.players.filter(canAct);
  if (
    blindActors.length === 0 ||
    (blindActors.length === 1 && blindActors[0]!.bet >= next.currentBet)
  ) {
    return finishStreetOrRunout({ ...next, toAct: -1, pendingSeats: [] });
  }

  return next;
}

export function getLegalActions(state: TableState): ActionType[] {
  if (state.toAct < 0 || state.street === 'complete' || state.street === 'waiting') {
    return [];
  }
  const player = state.players.find((p) => p.seat === state.toAct);
  if (!player || !canAct(player)) return [];

  const toCall = state.currentBet - player.bet;
  const actions: ActionType[] = ['fold'];

  if (state.raiseClosedSeats?.includes(player.seat) && toCall > 0) {
    // Only faced an incomplete raise since acting: call or fold, no re-raise.
    actions.push(player.stack > toCall ? 'call' : 'all-in');
    return actions;
  }

  if (toCall <= 0) {
    actions.push('check');
    if (player.stack > 0) {
      // Facing no bet: open with a bet. Already matched a live bet (e.g. big blind's
      // preflop option): the only way to put more in is a raise.
      actions.push(state.currentBet > 0 ? 'raise' : 'bet');
      actions.push('all-in');
    }
  } else {
    if (player.stack > toCall) {
      actions.push('call');
      actions.push('raise');
      actions.push('all-in');
    } else {
      actions.push('all-in'); // call all-in (short)
    }
  }
  return actions;
}

export function applyAction(
  state: TableState,
  playerId: string,
  action: PlayerAction
): TableState {
  if (state.street === 'complete' || state.street === 'waiting') {
    throw new Error('NoHandActive');
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error('NotAPlayer');
  if (player.seat !== state.toAct) throw new Error('NotYourTurn');
  if (!canAct(player)) throw new Error('CannotAct');

  const legal = getLegalActions(state);
  // Map all-in type onto bet/raise/call semantics
  let type = action.type;
  if (type === 'all-in') {
    // allowed whenever stack > 0 (unless it would re-raise when raising is closed)
    if (player.stack <= 0) throw new Error('IllegalAction');
    if (!legal.includes('all-in')) throw new Error('IllegalAction:all-in');
  } else if (!legal.includes(type)) {
    throw new Error(`IllegalAction:${type}`);
  }

  const toCall = Math.max(0, state.currentBet - player.bet);
  let players = clonePlayers(state.players);
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let pendingSeats = [...state.pendingSeats];
  let lastAggressorSeat = state.lastAggressorSeat;
  let raiseClosedSeats = [...(state.raiseClosedSeats ?? [])];
  let appliedAmount: number | undefined;

  const mutate = (fn: (p: EnginePlayer) => EnginePlayer) => {
    players = players.map((p) => (p.id === playerId ? fn(p) : p));
  };

  if (type === 'fold') {
    mutate((p) => ({ ...p, folded: true }));
    pendingSeats = removePending(pendingSeats, player.seat);
  } else if (type === 'check') {
    if (toCall > 0) throw new Error('CannotCheck');
    pendingSeats = removePending(pendingSeats, player.seat);
  } else if (type === 'call') {
    const pay = Math.min(toCall, player.stack);
    mutate((p) => {
      const stack = p.stack - pay;
      return {
        ...p,
        stack,
        bet: p.bet + pay,
        committed: p.committed + pay,
        allIn: stack === 0,
      };
    });
    appliedAmount = pay;
    pendingSeats = removePending(pendingSeats, player.seat);
  } else if (type === 'bet' || type === 'raise' || type === 'all-in') {
    let targetStreetBet: number;

    if (type === 'all-in') {
      targetStreetBet = player.bet + player.stack;
    } else {
      if (action.amount === undefined) throw new Error('AmountRequired');
      targetStreetBet = action.amount;
    }

    const additional = targetStreetBet - player.bet;
    if (additional <= 0) throw new Error('InvalidAmount');
    if (additional > player.stack) throw new Error('InsufficientStack');

    const isAllIn = additional === player.stack;
    const raising = targetStreetBet > currentBet;
    const opening = currentBet === 0 || (currentBet > 0 && player.bet === 0 && toCall === 0 && type === 'bet');

    // Preflop blinds: currentBet > 0, opening bet is actually a raise
    if (type === 'bet' && currentBet > 0) throw new Error('MustRaise');
    if (type === 'raise' && currentBet === 0) throw new Error('MustBet');

    if (raising) {
      const raiseBy = targetStreetBet - currentBet;
      const fullRaise = raiseBy >= minRaise || isAllIn;
      if (!isAllIn && raiseBy < minRaise) throw new Error('BelowMinRaise');

      mutate((p) => {
        const stack = p.stack - additional;
        return {
          ...p,
          stack,
          bet: targetStreetBet,
          committed: p.committed + additional,
          allIn: stack === 0,
        };
      });

      if (fullRaise && raiseBy >= minRaise) {
        minRaise = raiseBy;
        lastAggressorSeat = player.seat;
        pendingSeats = reopenAction(players, player.seat);
        raiseClosedSeats = [];
      } else {
        // Seats that already acted (not pending) now face this short raise: no re-raise.
        // (Only when there was a live bet: an under-minimum all-in *opening* bet still
        // lets earlier checkers raise.)
        const acted =
          currentBet > 0
            ? players
                .filter((p) => canAct(p) && p.seat !== player.seat && !pendingSeats.includes(p.seat))
                .map((p) => p.seat)
            : [];
        raiseClosedSeats = [...new Set([...raiseClosedSeats, ...acted])];
        // Short all-in raise: does not reopen for players who already matched
        pendingSeats = removePending(pendingSeats, player.seat);
        // Players who still face a higher bet remain pending
        pendingSeats = [
          ...new Set([
            ...pendingSeats,
            ...seatsNeedingAction(players, targetStreetBet),
          ]),
        ].filter((s) => s !== player.seat);
      }
      currentBet = targetStreetBet;
      appliedAmount = targetStreetBet;
    } else if (type === 'bet' || (type === 'all-in' && currentBet === 0)) {
      // Opening bet / shove as bet
      if (!opening && type === 'bet') {
        // ok
      }
      const betSize = additional;
      if (!isAllIn && betSize < state.config.bigBlind) {
        throw new Error('BelowMinBet');
      }
      mutate((p) => {
        const stack = p.stack - additional;
        return {
          ...p,
          stack,
          bet: targetStreetBet,
          committed: p.committed + additional,
          allIn: stack === 0,
        };
      });
      currentBet = targetStreetBet;
      minRaise = Math.max(state.config.bigBlind, betSize);
      lastAggressorSeat = player.seat;
      pendingSeats = reopenAction(players, player.seat);
      raiseClosedSeats = [];
      appliedAmount = targetStreetBet;
    } else if (type === 'all-in' && !raising) {
      // Short call all-in
      mutate((p) => {
        const stack = 0;
        return {
          ...p,
          stack,
          bet: p.bet + additional,
          committed: p.committed + additional,
          allIn: true,
        };
      });
      appliedAmount = additional;
      pendingSeats = removePending(pendingSeats, player.seat);
    } else {
      throw new Error('InvalidAggressiveAction');
    }

    void opening;
  } else {
    throw new Error(`UnknownAction:${type}`);
  }

  const next: TableState = {
    ...state,
    players,
    currentBet,
    minRaise,
    pendingSeats,
    lastAggressorSeat,
    raiseClosedSeats,
    potTotal: recomputePotTotal(players),
    actionHistory: withHistory(state, playerId, type, appliedAmount),
  };

  return afterAction(next);
}

/** Project private hole cards for non-viewers until showdown/complete. */
export function toPublicState(
  state: TableState,
  viewerId: string | null
): Omit<TableState, 'deck' | 'rngState'> & { deckCount: number } {
  const reveal =
    state.street === 'showdown' ||
    state.street === 'complete' ||
    Boolean(state.result?.showdown);

  const { deck: _d, rngState: _r, ...rest } = state;
  return {
    ...rest,
    deckCount: state.deck.length,
    players: state.players.map((p) => ({
      ...p,
      holeCards:
        p.id === viewerId || reveal ? [...p.holeCards] : [],
    })),
  };
}

export function legalActionOrThrow(
  state: TableState,
  playerId: string,
  action: PlayerAction
): PlayerAction {
  const legal = getLegalActions(state);
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.seat !== state.toAct) throw new Error('NotYourTurn');

  if (action.type === 'all-in') return action;
  if (!legal.includes(action.type)) throw new Error('IllegalAction');
  return action;
}
