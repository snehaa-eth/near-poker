/**
 * Arena turn engine (INTERFACES.md §5.3).
 *
 *  - syncTurn(state) runs after every save of an arena table. When a new decision point
 *    appears (hand id + action count + actor) it issues a fresh 16-byte challenge, arms the
 *    ARENA_TURN_MS timer and emits `arena:turn` to that agent's sockets only.
 *  - handleAct() accepts `arena:act` only from the actor with the current challenge, verifies
 *    the TEE receipt (checks 1–6), then applies the move via the normal engine path.
 *  - Timeout → auto-check when legal, else auto-fold.
 */
import { addTalk, lineFromResponse } from './talk.js';
import { randomBytes } from 'node:crypto';

import type { Socket } from 'socket.io';

import { SessionModel } from '../db.js';
import { actionBet, actionFold, getGame, getPublicState } from '../game-store.js';
import type { StoredGame } from '../poker-bridge.js';
import { getAttestationCache } from './attestation.js';
import { getArenaConfig } from './config.js';
import { isCompletionUsed, recordArenaMove } from './moves.js';
import { ARENA_ACTIONS, verifyReceipt, type ArenaAction } from './receipt.js';
import { broadcast, emitTo, errMsg, serial } from './runtime.js';

export type Turn = {
  gameId: string;
  handId: string;
  playerId: string;
  challenge: string;
  key: string;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const turns = new Map<string, Turn>();
/** completionIds already accepted (also enforced by a unique index in Mongo). */
const usedCompletions = new Set<string>();

export function currentTurn(gameId: string): Turn | undefined {
  return turns.get(gameId);
}

function clearTurn(gameId: string) {
  const t = turns.get(gameId);
  if (t?.timer) clearTimeout(t.timer);
  turns.delete(gameId);
}

/** Stop all timers (tests / shutdown). */
export function resetTurns() {
  for (const id of [...turns.keys()]) clearTurn(id);
  usedCompletions.clear();
}

export function syncTurn(state: StoredGame) {
  const table = state.nlhe;
  const handId = state.fairness?.handId;
  const live =
    table &&
    handId &&
    table.toAct >= 0 &&
    (table.street === 'preflop' || table.street === 'flop' || table.street === 'turn' || table.street === 'river');
  const actor = live ? table!.players.find((p) => p.seat === table!.toAct) : undefined;
  if (!actor) {
    clearTurn(state.gameId);
    return;
  }
  const key = `${handId}:${table!.actionHistory.length}:${actor.id}`;
  if (turns.get(state.gameId)?.key === key) return;
  clearTurn(state.gameId);

  const turnMs = getArenaConfig().turnMs;
  const turn: Turn = {
    gameId: state.gameId,
    handId: handId!,
    playerId: actor.id,
    challenge: randomBytes(16).toString('hex'),
    key,
    deadline: Date.now() + turnMs,
    timer: null,
  };
  turn.timer = setTimeout(() => void onTimeout(turn), turnMs);
  turns.set(state.gameId, turn);
  void emitTurn(turn);
}

/** (Re-)send the pending turn to its agent, e.g. after a reconnect + game:joinRoom. */
export async function emitTurn(turn: Turn) {
  try {
    const view = await getPublicState(turn.gameId, turn.playerId);
    if (turns.get(turn.gameId) !== turn || !view) return;
    emitTo(turn.playerId, 'arena:turn', {
      gameId: turn.gameId,
      handId: turn.handId,
      challenge: turn.challenge,
      deadlineMs: turn.deadline,
      turnMs: Math.max(0, turn.deadline - Date.now()),
      view,
    });
  } catch (e) {
    console.error('[arena] emitTurn failed', e);
  }
}

export function resendTurnTo(gameId: string, sessionId: string | undefined) {
  const t = turns.get(gameId);
  if (t && sessionId && t.playerId === sessionId) void emitTurn(t);
}

async function onTimeout(turn: Turn) {
  await serial(`turn:${turn.gameId}`, async () => {
    if (turns.get(turn.gameId) !== turn) return;
    const state = await getGame(turn.gameId);
    const table = state?.nlhe;
    const me = table?.players.find((p) => p.id === turn.playerId);
    const canCheck = Boolean(table && me && table.currentBet - me.bet <= 0);
    let action: 'check' | 'fold' = canCheck ? 'check' : 'fold';
    try {
      if (canCheck) await actionBet(turn.gameId, turn.playerId, 0, { arena: true });
      else await actionFold(turn.gameId, turn.playerId, { arena: true });
    } catch (e) {
      if (action === 'fold') {
        console.error(`[arena] auto-fold failed on ${turn.gameId}: ${errMsg(e)}`);
        clearTurn(turn.gameId);
        return;
      }
      action = 'fold';
      try {
        await actionFold(turn.gameId, turn.playerId, { arena: true });
      } catch (e2) {
        console.error(`[arena] auto-fold failed on ${turn.gameId}: ${errMsg(e2)}`);
        clearTurn(turn.gameId);
        return;
      }
    }
    if (turns.get(turn.gameId) === turn) clearTurn(turn.gameId);
    emitTo(turn.playerId, 'arena:timeout', {
      gameId: turn.gameId,
      handId: turn.handId,
      challenge: turn.challenge,
      action,
    });
    await broadcast(turn.gameId);
  });
}

export type ActPayload = {
  gameId?: unknown;
  handId?: unknown;
  challenge?: unknown;
  action?: unknown;
  amount?: unknown;
  receipt?: unknown;
};

export type ActResult = { ok: true; completionId: string } | { ok: false; reason: string; detail?: string };

/** Validate + apply one `arena:act`. Emits arena:rejected / arena:accepted to `socket`. */
export async function handleAct(socket: Pick<Socket, 'emit' | 'data'>, payload: ActPayload): Promise<ActResult> {
  const playerId = socket.data.sessionId as string | undefined;
  const p = payload && typeof payload === 'object' ? payload : ({} as ActPayload);
  const gameId = typeof p.gameId === 'string' ? p.gameId : '';
  const handId = typeof p.handId === 'string' ? p.handId : '';
  const challenge = typeof p.challenge === 'string' ? p.challenge.toLowerCase() : '';
  const reject = (reason: string, detail?: string): ActResult => {
    (socket.emit as (ev: string, p: unknown) => boolean)('arena:rejected', {
      gameId,
      handId,
      challenge,
      reason,
      ...(detail ? { detail } : {}),
    });
    return { ok: false, reason, ...(detail ? { detail } : {}) };
  };

  if (!playerId) return reject('NotAuthenticated');
  const turn = turns.get(gameId);
  if (!turn || turn.handId !== handId) return reject('NoPendingTurn');
  if (turn.playerId !== playerId) return reject('NotYourTurn');
  if (turn.challenge !== challenge) return reject('StaleChallenge');

  const action = typeof p.action === 'string' ? (p.action.toLowerCase() as ArenaAction) : null;
  if (!action || !ARENA_ACTIONS.includes(action)) return reject('BadAction');
  let amount: number | undefined;
  if (action === 'raise') {
    amount = Number(p.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) return reject('BadAmount', 'raise needs a positive integer raise-to amount');
  }

  // Checks 1–5 (pure, no network).
  const v = verifyReceipt({ receipt: p.receipt, challenge, action, amount });
  if (!v.ok) return reject(v.reason, v.detail);
  const { receipt } = v;
  if (usedCompletions.has(receipt.completionId) || (await isCompletionUsed(receipt.completionId))) {
    return reject('ReplayedReceipt');
  }

  // Check 6: signer in the model attestation set (cached; refetch once on a miss).
  const signer = await getAttestationCache().checkSigner(receipt.model, receipt.signingAddress);
  if (!signer.ok) return reject(signer.reason, signer.detail);

  // 7. Apply via the engine, serialized with the timeout handler.
  return serial(`turn:${gameId}`, async (): Promise<ActResult> => {
    if (turns.get(gameId) !== turn) return reject('StaleChallenge', 'turn already resolved (timeout?)');
    if (usedCompletions.has(receipt.completionId)) return reject('ReplayedReceipt');
    const state = await getGame(gameId);
    const table = state?.nlhe;
    const me = table?.players.find((x) => x.id === playerId);
    if (!table || !me) return reject('NoPendingTurn');
    const toCall = table.currentBet - me.bet;
    try {
      if (action === 'fold') await actionFold(gameId, playerId, { arena: true });
      else if (action === 'check') await actionBet(gameId, playerId, 0, { arena: true });
      else if (action === 'call') await actionBet(gameId, playerId, toCall > 0 ? table.currentBet : 0, { arena: true });
      else {
        if (amount! <= table.currentBet) throw new Error(`IllegalBet: raise-to ${amount} must exceed ${table.currentBet}`);
        await actionBet(gameId, playerId, amount!, { arena: true });
      }
    } catch (e) {
      return reject('IllegalMove', errMsg(e));
    }
    usedCompletions.add(receipt.completionId);
    if (turn.timer) clearTimeout(turn.timer);
    if (turns.get(gameId) === turn) turns.delete(gameId);
    try {
      await recordArenaMove({
        handId,
        gameId,
        playerId,
        nickname: state?.players.find((x) => x.id === playerId)?.nickname ?? '',
        walletAddress: (await SessionModel.findOne({ sessionId: playerId }).select('walletAddress').lean())?.walletAddress ?? null,
        action,
        amount: amount ?? null,
        challenge,
        completionId: receipt.completionId,
        model: receipt.model,
        signatureKind: receipt.signatureKind,
        signingAlgo: receipt.signingAlgo,
        signingAddress: receipt.signingAddress.toLowerCase().replace(/^0x/, ''),
        signedText: receipt.signedText,
        signature: receipt.signature.toLowerCase().replace(/^0x/, ''),
        responseBody: receipt.responseBody,
        verifiedAt: new Date(),
      });
    } catch (e) {
      console.error('[arena] failed to store move', errMsg(e));
    }
    const line = lineFromResponse(receipt.responseBody);
    if (line) {
      addTalk(gameId, {
        playerId,
        nickname: state?.players.find((x) => x.id === playerId)?.nickname ?? '',
        line,
        at: Date.now(),
        handId,
      });
    }
    (socket.emit as (ev: string, p: unknown) => boolean)('arena:accepted', {
      gameId,
      handId,
      challenge,
      action,
      ...(amount !== undefined ? { amount } : {}),
      completionId: receipt.completionId,
    });
    await broadcast(gameId);
    return { ok: true, completionId: receipt.completionId };
  });
}
