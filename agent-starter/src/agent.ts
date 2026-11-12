/**
 * The arena loop (INTERFACES.md §5.2–5.3):
 *
 *   POST /arena/join → { queued, position } | { gameId }
 *   socket  arena:seated {gameId}            → game:joinRoom
 *   socket  game:entropyRequest {gameId,handId} → game:entropy {gameId,handId,entropy: 16 random bytes hex}
 *   socket  arena:turn {gameId,handId,challenge,deadlineMs,view}
 *             → TEE completion (challenge in the prompt) → receipt → arena:act {…, receipt}
 *   socket  arena:rejected {reason}          → retry once (fresh completion with the reason as feedback)
 *   socket  game:state (gameEnded)           → log the hand, GET /hands/:id and verify the deck (§1)
 *
 * Cost guard: at most `maxLlmCalls` completions per run. When only `leaveReserve` calls are left
 * the agent POSTs /arena/leave (the server seats it out after the current hand) and uses the reserve
 * to finish the hand. It never plays a move without a TEE receipt: if the budget runs out mid-hand
 * it stays silent and the server auto-folds/checks at the deadline.
 */
import { randomBytes } from 'node:crypto';

import type { Api } from './near.js';
import { formatUiCards, uiToEngine, verifyHand, type HandRecord } from './fairness.js';
import * as defaultStrategy from './strategy.js';
import type { Snapshot } from './strategy.js';
import { verificationUrl, type ChatMessage, type Decision, type Receipt } from './tee.js';

export type SocketLike = {
  on(event: string, fn: (payload: any) => void): unknown;
  emit(event: string, payload?: unknown): unknown;
  close?(): unknown;
};

export type View = {
  gameId: string;
  status: string;
  round: string;
  roundLabel?: string;
  players: Array<{ id: string; nickname: string; seat: number; chipsInPot: number; folded: boolean; holeCards: number[] }>;
  communityCards: number[];
  pot: number;
  highestBet: number;
  minRaise: number;
  dealerSeat?: number;
  stacksByPlayerId: Record<string, number>;
  winnerNickname?: string | null;
  gameEnded: boolean;
  myPlayerId: string | null;
  isMyTurn?: boolean;
  fairness?: { handId: string; seedHash: string };
};

export type Turn = { gameId: string; handId: string; challenge: string; deadlineMs: number; view: View };

export type ArenaAct = {
  gameId: string;
  handId: string;
  challenge: string;
  action: 'fold' | 'check' | 'call' | 'raise';
  amount?: number;
  receipt: Receipt;
};

export type TeeLike = { model: string; signers?: string[]; decide(messages: ChatMessage[], challenge: string): Promise<Decision> };

export type AgentOptions = {
  api: Api;
  socket: SocketLike;
  tee: TeeLike;
  maxLlmCalls: number;
  /** request /arena/leave when this many calls are left (default min(3, floor(max/4))) */
  leaveReserve?: number;
  strategy?: Pick<typeof defaultStrategy, 'buildSystemPrompt' | 'buildUserPrompt' | 'preRule' | 'postRule' | 'legalSummary'>;
  log?: (s: string) => void;
  /** extra body for POST /arena/join (e.g. { eventId }) */
  joinBody?: Record<string, unknown>;
  /** delay before re-fetching an unrevealed hand record (default 1500) */
  revealRetryMs?: number;
  /** EVENT_ID: register for this scheduled arena event first, and wait for it to start (AGENTS.md "Events") */
  eventId?: string;
  /** poll interval while waiting for the event to start (default 5000) */
  eventPollMs?: number;
};

type EventInfo = { eventId: string; name: string; status: 'scheduled' | 'live' | 'ended'; startsAt: string; me?: { registered: boolean } };

export type Summary = { hands: number; handsVerified: number; handsFailed: number; llmCalls: number; movesSent: number; rejections: number; reason: string };

export function snapshotFromView(v: View): Snapshot {
  const me = v.players.find((p) => p.id === v.myPlayerId);
  if (!me) throw new Error('view has no myPlayerId seat');
  return {
    hole: formatUiCards(me.holeCards),
    board: formatUiCards(v.communityCards),
    street: v.roundLabel || v.round,
    pot: v.pot,
    highestBet: v.highestBet,
    chipsInPot: me.chipsInPot,
    minRaise: v.minRaise,
    stack: v.stacksByPlayerId[me.id] ?? 0,
    seat: me.seat,
    dealerSeat: v.dealerSeat,
    numPlayers: v.players.length,
    activePlayers: v.players.filter((p) => !p.folded).length,
    opponents: v.players
      .filter((p) => p.id !== me.id)
      .map((p) => ({ nickname: p.nickname, stack: v.stacksByPlayerId[p.id] ?? 0, chipsInPot: p.chipsInPot, folded: p.folded })),
  };
}

/** Is the model's move legal as written? (We never rewrite it: the receipt binds the exact action/amount.) */
export function legalProblem(move: { action: string; amount?: number }, s: Snapshot, legalSummary = defaultStrategy.legalSummary): string | null {
  const l = legalSummary(s);
  if (!(l.actions as string[]).includes(move.action)) return `"${move.action}" is not legal here; legal actions: ${l.actions.join(', ')}`;
  if (move.action === 'raise') {
    if (move.amount === undefined || !Number.isInteger(move.amount)) return 'a raise needs an integer "amount" (raise-to total)';
    if (move.amount < l.minRaiseTo || move.amount > l.maxRaiseTo) return `raise-to ${move.amount} is outside ${l.minRaiseTo}..${l.maxRaiseTo}`;
  }
  return null;
}

/** deadlineMs: absolute epoch ms if it looks like one, otherwise a duration from receipt of the turn. */
export function deadlineAt(deadlineMs: number, receivedAt: number): number {
  return deadlineMs > 1e12 ? deadlineMs : receivedAt + deadlineMs;
}

export class ArenaAgent {
  readonly opts: Required<Pick<AgentOptions, 'leaveReserve' | 'revealRetryMs'>> & AgentOptions;
  llmCalls = 0;
  movesSent = 0;
  rejections = 0;
  leaving = false;
  gameId: string | null = null;
  private strategy: NonNullable<AgentOptions['strategy']>;
  private log: (s: string) => void;
  private turn: (Turn & { at: number; retried: boolean; busy: boolean }) | null = null;
  private entropy = new Map<string, string>();
  private hole = new Map<string, number[]>(); // handId → my engine card ids
  private seedHash = new Map<string, string>();
  private ended = new Set<string>();
  private verifications: Promise<void>[] = [];
  private hands = 0;
  private handsVerified = 0;
  private handsFailed = 0;
  private finish!: (s: Summary) => void;
  readonly done: Promise<Summary>;
  private finished = false;

  constructor(opts: AgentOptions) {
    const reserve = opts.leaveReserve ?? Math.min(3, Math.floor(opts.maxLlmCalls / 4));
    this.opts = { ...opts, leaveReserve: reserve, revealRetryMs: opts.revealRetryMs ?? 1500 };
    this.strategy = opts.strategy ?? defaultStrategy;
    this.log = opts.log ?? ((s) => console.log(s));
    this.done = new Promise((ok) => (this.finish = ok));
  }

  get budgetLeft() {
    return this.opts.maxLlmCalls - this.llmCalls;
  }

  /** Wire socket handlers and join the arena queue. */
  async start() {
    const s = this.opts.socket;
    s.on('arena:seated', ({ gameId }: { gameId: string }) => this.seat(gameId));
    s.on('game:entropyRequest', ({ gameId, handId }: { gameId: string; handId: string }) => {
      const e = randomBytes(16).toString('hex');
      this.entropy.set(handId, e);
      s.emit('game:entropy', { gameId, handId, entropy: e });
    });
    s.on('arena:turn', (t: Turn) => void this.onTurn(t));
    s.on('arena:rejected', (r: { reason?: string; handId?: string; challenge?: string }) => void this.onRejected(r));
    s.on('game:state', (v: View) => this.onState(v));
    s.on('game:error', (e: { error?: string }) => this.log(`  ⚠️  game:error ${e?.error ?? JSON.stringify(e)}`));
    s.on('disconnect', (why: string) => this.stop(`socket disconnected (${why})`));
    if (this.opts.maxLlmCalls <= this.opts.leaveReserve) {
      this.stop(`MAX_LLM_CALLS=${this.opts.maxLlmCalls} is too small to play`);
      return;
    }
    if (this.opts.eventId) {
      const go = await this.enterEvent(this.opts.eventId);
      if (!go) return;
      if (this.gameId) return; // seated by the event start already
    }
    const r = await this.opts.api<{ queued?: boolean; position?: number; gameId?: string }>('/arena/join', this.opts.joinBody ?? {});
    if (r.gameId) this.seat(r.gameId);
    else this.log(`⏳ queued for the arena (position ${r.position ?? '?'}) — waiting for opponents…`);
  }

  /**
   * Register for a scheduled event (allowed until it starts), then wait for it to go live
   * before joining, so no LLM calls are spent in the open arena meanwhile. At the start the
   * server seats registered, connected agents at event tables (arena:seated). Returns false
   * when the agent should not play (event over).
   */
  private async enterEvent(eventId: string): Promise<boolean> {
    const id = encodeURIComponent(eventId);
    try {
      await this.opts.api(`/events/${id}/register`, { model: this.opts.tee.model });
      this.log(`🎟️  registered for event ${eventId}`);
    } catch (e) {
      this.log(`  ⚠️  event registration: ${(e as Error).message}`);
    }
    const pollMs = this.opts.eventPollMs ?? 5000;
    for (;;) {
      if (this.finished) return false;
      let ev: EventInfo;
      try {
        ev = await this.opts.api<EventInfo>(`/events/${id}`);
      } catch (e) {
        this.log(`  ⚠️  event ${eventId}: ${(e as Error).message} → joining the open arena`);
        return true;
      }
      if (ev.status === 'ended') {
        this.stop(`event ${eventId} has ended`);
        return false;
      }
      if (ev.status === 'live') {
        if (ev.me && !ev.me.registered) this.log(`  ⚠️  not registered for ${ev.name}: playing in the open arena`);
        return true;
      }
      if (this.gameId) return true;
      const secs = Math.max(0, Math.round((Date.parse(ev.startsAt) - Date.now()) / 1000));
      this.log(`⏳ ${ev.name} starts in ${secs}s — waiting (no LLM calls until then)`);
      await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(250, secs * 1000))));
    }
  }

  private seat(gameId: string) {
    if (this.gameId === gameId) return;
    this.gameId = gameId;
    this.log(`🪑 seated at arena table ${gameId}`);
    this.opts.socket.emit('game:joinRoom', { gameId });
  }

  private async requestLeave(why: string) {
    if (this.leaving) return;
    this.leaving = true;
    this.log(`🚪 ${why} → POST /arena/leave (leaving after this hand)`);
    try {
      await this.opts.api('/arena/leave', {});
    } catch (e) {
      this.log(`  ⚠️  /arena/leave failed: ${(e as Error).message}`);
    }
    if (!this.gameId) this.stop(why);
  }

  /** One LLM call, budget-checked. Returns null when the budget is gone. */
  private async ask(turn: Turn, snap: Snapshot, feedback: string[]): Promise<Decision | null> {
    if (this.budgetLeft <= 0) return null;
    this.llmCalls += 1;
    if (this.budgetLeft <= this.opts.leaveReserve) void this.requestLeave(`LLM budget almost used (${this.llmCalls}/${this.opts.maxLlmCalls})`);
    const messages: ChatMessage[] = [
      { role: 'system', content: this.strategy.buildSystemPrompt() },
      { role: 'user', content: this.strategy.buildUserPrompt(snap, turn.challenge, [...this.strategy.preRule(snap), ...feedback]) },
    ];
    return this.opts.tee.decide(messages, turn.challenge);
  }

  /** Decide with up to one re-ask (bad JSON, wrong challenge, illegal move, post-rule veto). */
  private async decideAndAct(turn: Turn, feedback: string[] = []) {
    const snap = snapshotFromView(turn.view);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.turn?.challenge !== turn.challenge) return; // superseded
      let d: Decision | null;
      try {
        d = await this.ask(turn, snap, feedback);
      } catch (e) {
        this.log(`  ⚠️  TEE call failed: ${(e as Error).message}`);
        continue;
      }
      if (!d) {
        this.log('  🪫 no LLM budget left — not acting (server will auto-fold/check this turn)');
        return;
      }
      const m = d.move;
      const problem = !m
        ? 'Your reply had no JSON object.'
        : m.challenge !== turn.challenge
          ? `The "challenge" must be exactly ${turn.challenge}.`
          : (legalProblem(m, snap, this.strategy.legalSummary) ?? this.strategy.postRule(m, snap));
      if (problem) {
        this.log(`  ↩︎  re-asking (${problem})`);
        feedback = [...feedback, `Your previous answer ${JSON.stringify(d.content.slice(0, 160))} was not accepted: ${problem}`];
        continue;
      }
      if (!d.check.ok) {
        this.log(`  ⚠️  receipt failed local checks: ${d.check.errors.join('; ')}`);
        continue;
      }
      if (this.turn?.challenge !== turn.challenge || Date.now() > deadlineAt(turn.deadlineMs, this.turn.at)) {
        this.log('  ⌛ deadline passed before the TEE answered');
        return;
      }
      const act: ArenaAct = {
        gameId: turn.gameId,
        handId: turn.handId,
        challenge: turn.challenge,
        action: m!.action as ArenaAct['action'],
        ...(m!.action === 'raise' ? { amount: m!.amount } : {}),
        receipt: d.receipt,
      };
      this.opts.socket.emit('arena:act', act);
      this.movesSent += 1;
      const label = act.action === 'raise' ? `raise to ${act.amount}` : act.action;
      this.log(
        `  🧠 [${snap.hole.join(' ')}] ${snap.street.padEnd(7)} ${label.padEnd(14)} "${m!.line}"  ${d.latencyMs}ms  ` +
          `(${this.llmCalls}/${this.opts.maxLlmCalls} calls) receipt ${d.receipt.completionId}`,
      );
      if (process.env.SHOW_VERIFY_URL === '1') this.log(`     verify: ${verificationUrl(d.receipt)}`);
      return;
    }
    this.log('  ❌ no acceptable TEE move this turn — server will auto-fold/check');
  }

  private async onTurn(t: Turn) {
    if (this.finished) return;
    if (this.turn?.challenge === t.challenge) return;
    this.turn = { ...t, at: Date.now(), retried: false, busy: true };
    if (!this.gameId) this.seat(t.gameId);
    try {
      await this.decideAndAct(t);
    } finally {
      if (this.turn?.challenge === t.challenge) this.turn.busy = false;
    }
  }

  private async onRejected(r: { reason?: string; challenge?: string }) {
    this.rejections += 1;
    const t = this.turn;
    this.log(`  ⛔ arena:rejected ${r?.reason ?? '?'}`);
    if (!t || t.retried || t.busy || (r?.challenge && r.challenge !== t.challenge)) return;
    if (Date.now() > deadlineAt(t.deadlineMs, t.at) - 3000) return;
    t.retried = true;
    t.busy = true;
    try {
      await this.decideAndAct(t, [`The game server rejected your previous move: ${r?.reason ?? 'unknown reason'}. Choose a legal move.`]);
    } finally {
      t.busy = false;
    }
  }

  private onState(v: View) {
    const me = v.players?.find((p) => p.id === v.myPlayerId);
    const hid = v.fairness?.handId;
    if (hid && me && me.holeCards.length === 2 && me.holeCards.every((c) => c >= 0) && !this.hole.has(hid)) {
      this.hole.set(hid, me.holeCards.map(uiToEngine));
    }
    if (hid && v.fairness?.seedHash && !this.seedHash.has(hid)) this.seedHash.set(hid, v.fairness.seedHash);
    if (!v.gameEnded || !hid || this.ended.has(hid)) return;
    this.ended.add(hid);
    this.hands += 1;
    const myStack = me ? (v.stacksByPlayerId[me.id] ?? 0) : 0;
    this.log(`🏁 hand ${hid.slice(0, 8)} over — winner ${v.winnerNickname ?? '?'}, board ${formatUiCards(v.communityCards).join(' ') || '-'}, my stack ${myStack}`);
    this.verifications.push(this.verify(hid, me?.id));
    if (this.leaving || (me && myStack <= 0)) {
      void Promise.all(this.verifications).then(() => this.stop(this.leaving ? 'left the arena (LLM budget)' : 'busted'));
    }
  }

  private async verify(handId: string, myId?: string) {
    for (let i = 0; i < 3; i++) {
      try {
        const rec = await this.opts.api<HandRecord>(`/hands/${encodeURIComponent(handId)}`);
        if (!rec.serverSeed && i < 2) {
          await new Promise((ok) => setTimeout(ok, this.opts.revealRetryMs));
          continue;
        }
        const errs = verifyHand(rec, { playerId: myId, hole: this.hole.get(handId), entropy: this.entropy.get(handId), seedHashSeen: this.seedHash.get(handId) });
        if (errs.length) {
          this.handsFailed += 1;
          this.log(`  fair ❌ ${handId.slice(0, 8)}: ${errs.join('; ')}`);
        } else {
          this.handsVerified += 1;
          this.log(`  fair ✅ ${handId.slice(0, 8)} seedHash ${rec.seedHash.slice(0, 12)}… deck re-derived from serverSeed + ${rec.entropy!.length} entropies`);
        }
        return;
      } catch (e) {
        if (i === 2) {
          this.handsFailed += 1;
          this.log(`  fair ❌ ${handId.slice(0, 8)}: ${(e as Error).message}`);
        }
      }
    }
  }

  /** Stop the agent (idempotent). */
  stop(reason: string) {
    if (this.finished) return;
    this.finished = true;
    this.turn = null;
    this.opts.socket.close?.();
    this.finish({
      hands: this.hands,
      handsVerified: this.handsVerified,
      handsFailed: this.handsFailed,
      llmCalls: this.llmCalls,
      movesSent: this.movesSent,
      rejections: this.rejections,
      reason,
    });
  }
}
