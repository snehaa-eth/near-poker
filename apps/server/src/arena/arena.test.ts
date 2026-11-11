/**
 * Agent Arena end-to-end (in-process server, in-memory Mongo, MemoryLedger, mocked NEAR AI
 * attestation — no network). Three mock agents log in with NEP-413, deposit off-chain chips,
 * join the arena, answer entropy and arena:turn with locally signed "TEE" receipts.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { KeyPair, KeyPairSigner } from 'near-api-js';
import { io as ioClient, type Socket } from 'socket.io-client';

import { verifyHand } from '@nli/poker-engine';

import { MODEL, makeReceipt, mockAttestationFetch, teeKey, type TeeKey } from './test-helpers.js';
import type { MoveReceipt } from './receipt.js';

Object.assign(process.env, {
  NEARAI_API_KEY: 'test-key',
  NEARAI_BASE_URL: 'https://mock.nearai.local/v1',
  ARENA_MIN_AGENTS: '2',
  ARENA_FILL_MS: '400',
  ARENA_HAND_GAP_MS: '150',
  ARENA_TURN_MS: '3000',
  ARENA_MIN_CHIPS: '100',
  ENTROPY_TIMEOUT_MS: '1500',
});
delete process.env.CHAIN;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => T | undefined | null | false, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(20);
  }
  throw new Error(`timeout waiting for ${what}`);
}

type View = {
  gameId: string;
  arena?: boolean;
  highestBet: number;
  minRaise: number;
  gameEnded: boolean;
  myPlayerId: string | null;
  players: Array<{ id: string; nickname: string; chipsInPot: number; holeCards: number[]; agent?: { model: string; movesVerified: number; lastReceiptUrl?: string } }>;
  stacksByPlayerId: Record<string, number>;
  fairness?: { handId: string; seedHash: string; revealed?: unknown };
};
type Turn = { gameId: string; handId: string; challenge: string; deadlineMs: number; view: View };
type Act = { gameId: string; handId: string; challenge: string; action: string; amount?: number; receipt: unknown };

let API = '';
const signerKey = teeKey(); // the attested "TEE" key for MODEL
const attest = mockAttestationFetch({ [MODEL]: [signerKey.hex] });

class Agent {
  jar = new Map<string, string>();
  sock!: Socket;
  sessionId = '';
  gameId: string | null = null;
  turns: Turn[] = [];
  accepted: Array<{ challenge: string; completionId: string }> = [];
  rejected: Array<{ reason: string; challenge: string }> = [];
  timeouts: Array<{ action: string }> = [];
  errors: string[] = [];
  events: string[] = [];
  lastView: View | null = null;
  acts: Act[] = [];
  /** Custom turn handler; return true when handled. */
  script: ((t: Turn) => Promise<boolean>) | null = null;
  ignoreNextTurns = 0;
  raiser = false;
  raisedHands = new Set<string>();

  constructor(
    readonly account: string,
    readonly key: TeeKey = signerKey
  ) {}

  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async api(path: string, body?: unknown, method?: string) {
    const res = await fetch(`${API}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', cookie: this.cookie() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv!.indexOf('=');
      this.jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  }

  async login() {
    const { json: n } = await this.api('/auth/nonce');
    const kp = KeyPair.fromRandom('ed25519');
    const nonce = Buffer.from(n.nonce, 'base64');
    const signed = await new KeyPairSigner(kp).signNep413Message(this.account, {
      message: n.message,
      recipient: n.recipient,
      nonce: new Uint8Array(nonce),
    });
    const { status, json } = await this.api('/auth/profile', {
      walletAddress: this.account,
      nickname: this.account.split('.')[0],
      nearProof: {
        accountId: this.account,
        publicKey: kp.getPublicKey().toString(),
        signature: Buffer.from(signed.signature).toString('base64'),
        message: n.message,
        recipient: n.recipient,
        nonce: n.nonce,
      },
    });
    assert.equal(status, 200, JSON.stringify(json));
    this.sessionId = json.sessionId;
    assert.ok(this.jar.get('nli_session'), 'nli_session alias cookie set');
  }

  async connect() {
    this.sock = ioClient(API, { transports: ['websocket'], extraHeaders: { cookie: this.cookie() } });
    await new Promise<void>((ok, bad) => {
      this.sock.on('connect', () => ok());
      this.sock.on('connect_error', bad);
    });
    this.sock.on('game:entropyRequest', ({ gameId, handId }) => {
      this.sock.emit('game:entropy', { gameId, handId, entropy: randomBytes(16).toString('hex') });
    });
    this.sock.on('arena:seated', ({ gameId }) => {
      this.events.push('seated');
      this.gameId = gameId;
      this.sock.emit('game:joinRoom', { gameId });
    });
    for (const ev of ['arena:left', 'arena:closed', 'arena:queued']) this.sock.on(ev, () => this.events.push(ev.slice(6)));
    this.sock.on('game:state', (v: View) => (this.lastView = v));
    this.sock.on('game:error', ({ error }) => this.errors.push(error));
    this.sock.on('arena:accepted', (a) => this.accepted.push(a));
    this.sock.on('arena:rejected', (r) => this.rejected.push(r));
    this.sock.on('arena:timeout', (t) => this.timeouts.push(t));
    this.sock.on('arena:turn', (t: Turn) => void this.onTurn(t));
  }

  decide(t: Turn): { action: 'check' | 'call' | 'raise'; amount?: number } {
    const me = t.view.players.find((p) => p.id === t.view.myPlayerId)!;
    const toCall = t.view.highestBet - me.chipsInPot;
    if (this.raiser && !this.raisedHands.has(t.handId)) {
      this.raisedHands.add(t.handId);
      return { action: 'raise', amount: t.view.highestBet + Math.max(t.view.minRaise, 10) };
    }
    return toCall > 0 ? { action: 'call' } : { action: 'check' };
  }

  act(t: Turn, d: { action: string; amount?: number }, receipt: unknown, challenge = t.challenge) {
    const a: Act = { gameId: t.gameId, handId: t.handId, challenge, action: d.action, ...(d.amount !== undefined ? { amount: d.amount } : {}), receipt };
    this.acts.push(a);
    this.sock.emit('arena:act', a);
  }

  receiptFor(t: Turn, d: { action: string; amount?: number }, opts?: Parameters<typeof makeReceipt>[2], key = this.key): MoveReceipt {
    return makeReceipt(key, { challenge: t.challenge, ...d }, opts);
  }

  async onTurn(t: Turn) {
    this.turns.push(t);
    if (this.ignoreNextTurns > 0) {
      this.ignoreNextTurns -= 1;
      return;
    }
    if (this.script) {
      const s = this.script;
      this.script = null;
      if (await s(t)) return;
    }
    const d = this.decide(t);
    this.act(t, d, this.receiptFor(t, d));
  }

  /** Send one act and wait for its verdict. */
  async tryAct(t: Turn, d: { action: string; amount?: number }, receipt: unknown, challenge = t.challenge) {
    const nRej = this.rejected.length;
    const nAcc = this.accepted.length;
    this.act(t, d, receipt, challenge);
    await waitFor('verdict', () => this.rejected.length > nRej || this.accepted.length > nAcc, 5000);
    return this.rejected.length > nRej ? this.rejected[this.rejected.length - 1]!.reason : 'accepted';
  }
}

let mongod: MongoMemoryServer;
let server: import('node:http').Server;
let lobby: typeof import('./lobby.js');
let turnsMod: typeof import('./turns.js');
const agents: Agent[] = [];

before(async () => {
  mongod = await MongoMemoryServer.create();
  const { connectMongo } = await import('../db.js');
  await connectMongo(mongod.getUri('arena-test'));
  const { setAccessKeyChecker } = await import('../auth.js');
  setAccessKeyChecker(async () => true); // no RPC: pretend every key is a full-access key
  const { setAttestationFetch } = await import('./attestation.js');
  setAttestationFetch(attest.f);
  lobby = await import('./lobby.js');
  turnsMod = await import('./turns.js');
  const { createAppServer } = await import('../app.js');
  ({ server } = createAppServer('http://localhost:3000'));
  await new Promise<void>((r) => server.listen(0, r));
  API = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const a of agents) a.sock?.close();
  lobby?.resetArenaLobby();
  turnsMod?.resetTurns();
  await new Promise((r) => server?.close(r));
  await mongoose.disconnect();
  await mongod?.stop();
});

describe('Agent Arena (mock TEE agents)', () => {
  const A = new Agent('alpha-agent.testnet');
  const B = new Agent('bravo-agent.testnet');
  const C = new Agent('charlie-agent.testnet');
  agents.push(A, B, C);

  const verdicts: Record<string, string> = {};
  let adversarialDone = false;
  const adversarial = async (t: Turn): Promise<boolean> => {
    if (A.accepted.length === 0) {
      C.script = adversarial; // need an accepted move of A to replay; play normally for now
      return false;
    }
    const d = C.decide(t);
    // plain game:bet/game:fold are refused on arena tables (TEE-only rule)
    const nErr = C.errors.length;
    C.sock.emit('game:bet', { gameId: t.gameId, amount: t.view.highestBet });
    C.sock.emit('game:fold', { gameId: t.gameId });
    await waitFor('game:error', () => C.errors.length >= nErr + 2, 5000);
    verdicts.plainBet = C.errors[nErr]!;
    verdicts.plainFold = C.errors[nErr + 1]!;

    const good = C.receiptFor(t, d);
    verdicts.gateway = await C.tryAct(t, d, { ...good, signatureKind: 'gateway' });
    const flipped = (good.signature[0] === '0' ? '1' : '0') + good.signature.slice(1);
    verdicts.forged = await C.tryAct(t, d, { ...good, signature: flipped });
    verdicts.otherChallengeInReply = await C.tryAct(t, d, makeReceipt(signerKey, { challenge: 'ee'.repeat(16), ...d }));
    verdicts.wrongChallengeField = await C.tryAct(t, d, good, 'ee'.repeat(16));
    verdicts.unattested = await C.tryAct(t, d, C.receiptFor(t, d, undefined, teeKey()));
    // replay an earlier accepted move verbatim (bound to another turn's challenge)
    const prev = A.acts.find((x) => A.accepted.some((acc) => acc.challenge === x.challenge))!;
    verdicts.replayVerbatim = await C.tryAct(t, { action: prev.action, amount: prev.amount }, prev.receipt);
    // re-use an accepted completion id with a re-signed body for this challenge
    verdicts.replayCompletion = await C.tryAct(t, d, C.receiptFor(t, d, { id: A.accepted[0]!.completionId }));
    verdicts.mismatchAction = await C.tryAct(t, { action: 'fold' }, good);
    verdicts.valid = await C.tryAct(t, d, good);
    verdicts.reuseAfterAccept = await C.tryAct(t, d, good);
    adversarialDone = true;
    return true;
  };

  it('join guards: no API key, non-NEAR session, low chips, unattested model', async () => {
    for (const a of agents) await a.login();

    const key = process.env.NEARAI_API_KEY;
    delete process.env.NEARAI_API_KEY;
    const r0 = await A.api('/arena/join', {});
    assert.equal(r0.status, 503);
    assert.match(r0.json.error, /NEARAI_API_KEY/);
    process.env.NEARAI_API_KEY = key;

    const guest = new Agent('guest');
    await guest.api('/auth/nickname', { nickname: 'Guest' });
    const r1 = await guest.api('/arena/join', {});
    assert.equal(r1.status, 403);
    assert.match(r1.json.error, /NearAccountRequired/);

    const r2 = await A.api('/arena/join', {});
    assert.equal(r2.status, 400);
    assert.match(r2.json.error, /InsufficientChips/);

    for (const a of agents) assert.equal((await a.api('/treasury/deposit', { nearAmount: 1 })).status, 200);

    const r3 = await A.api('/arena/join', { model: 'gateway/only-model' });
    assert.equal(r3.status, 400);
    assert.match(r3.json.error, /ModelNotAttested/);
  });

  it('queues agents and opens a table after the fill window', async () => {
    for (const a of agents) await a.connect();
    A.raiser = true;
    const ra = await A.api('/arena/join', { model: MODEL });
    assert.deepEqual(ra.json, { queued: true, position: 1 });
    assert.deepEqual((await A.api('/arena/join', { model: MODEL })).json, { queued: true, position: 1 });
    assert.deepEqual((await B.api('/arena/join', { model: MODEL })).json, { queued: true, position: 2 });

    // C's first turn after A has an accepted move is adversarial (next test).
    C.script = adversarial;
    assert.deepEqual((await C.api('/arena/join', { model: MODEL })).json, { queued: true, position: 3 });
    await waitFor('seated', () => agents.every((a) => a.gameId));
    assert.equal(new Set(agents.map((a) => a.gameId)).size, 1);
    assert.deepEqual((await A.api('/arena/join', {})).json, { gameId: A.gameId });
  });

  it('rejects plain game:bet, forged / gateway / wrong-challenge / unattested / replayed receipts, then accepts a valid one', async () => {
    await waitFor('adversarial turn', () => adversarialDone, 30_000);
    assert.match(verdicts.plainBet!, /ArenaTeeOnly/);
    assert.match(verdicts.plainFold!, /ArenaTeeOnly/);
    assert.deepEqual(
      {
        gateway: verdicts.gateway,
        forged: verdicts.forged,
        otherChallengeInReply: verdicts.otherChallengeInReply,
        wrongChallengeField: verdicts.wrongChallengeField,
        unattested: verdicts.unattested,
        replayVerbatim: verdicts.replayVerbatim,
        replayCompletion: verdicts.replayCompletion,
        mismatchAction: verdicts.mismatchAction,
        valid: verdicts.valid,
      },
      {
        gateway: 'BadSignatureKind',
        forged: 'BadSignature',
        otherChallengeInReply: 'ChallengeNotInResponse',
        wrongChallengeField: 'StaleChallenge',
        unattested: 'SignerNotAttested',
        replayVerbatim: 'ChallengeNotInResponse',
        replayCompletion: 'ReplayedReceipt',
        mismatchAction: 'ActionMismatch',
        valid: 'accepted',
      }
    );
    // once accepted the turn is gone (next actor has a new challenge)
    assert.match(verdicts.reuseAfterAccept!, /NotYourTurn|NoPendingTurn|StaleChallenge/);
  });

  it('times out an idle agent with auto-check/fold and keeps playing', async () => {
    B.ignoreNextTurns = 1;
    await waitFor('timeout', () => B.timeouts.length > 0, 15_000);
    assert.match(B.timeouts[0]!.action, /^(check|fold)$/);
  });

  const handIds = new Set<string>();
  it('plays complete hands automatically; every hand verifies (provably fair)', async () => {
    const seen = () => {
      const v = A.lastView;
      if (v?.gameEnded && v.fairness?.revealed) handIds.add(v.fairness.handId);
      return handIds.size >= 3;
    };
    await waitFor('3 completed hands', seen, 40_000);
    for (const handId of handIds) {
      const { json: rec } = await A.api(`/hands/${handId}`);
      assert.equal(rec.revealed, true);
      const seats = [...rec.seats].sort((a: { seat: number }, b: { seat: number }) => a.seat - b.seat);
      const res = verifyHand({
        seedHash: rec.seedHash,
        serverSeed: rec.serverSeed,
        entropy: rec.entropy,
        deckSeed: rec.deckSeed,
        holeCards: seats.map((s: { holeCards: number[] }) => s.holeCards),
        community: rec.community,
      });
      assert.deepEqual(res.errors, [], `hand ${handId}`);
      assert.ok(rec.entropy.some((e: string) => e !== '00'.repeat(16)), 'agents contributed entropy');

      const { json: mv } = await A.api(`/arena/moves/${handId}`);
      for (const m of mv.moves) {
        assert.equal(m.handId, handId);
        assert.ok(m.nickname);
        assert.match(m.challenge, /^[0-9a-f]{32}$/);
        assert.equal(m.model, MODEL);
        assert.equal(m.signingAddress, signerKey.hex);
        assert.ok(m.receiptUrl.startsWith('https://cloud.near.ai/verify?model='));
      }
    }
    const { json: all } = await A.api(`/arena/moves/${[...handIds][0]}`);
    assert.ok(all.moves.length > 0, 'moves recorded');
  });

  it('exposes arena views, tables and leaderboard', async () => {
    const { json: view } = await A.api(`/games/${A.gameId}`);
    assert.equal(view.arena, true);
    for (const p of view.players) {
      assert.equal(p.agent.model, MODEL);
      assert.ok(p.agent.movesVerified > 0);
      const receipt = JSON.parse(Buffer.from(p.agent.lastReceiptUrl.split('#receipt=')[1], 'base64url').toString());
      assert.equal(receipt.signatureKind, 'provider_tee');
      assert.equal(receipt.responseBody, undefined);
    }
    const { json: t } = await A.api('/arena/tables');
    assert.equal(t.tables.length, 1);
    assert.equal(t.tables[0].gameId, A.gameId);
    assert.equal(t.tables[0].seats.length, 3);
    assert.ok(t.tables[0].handsPlayed >= 3);

    const { json: lb } = await A.api('/arena/leaderboard');
    assert.equal(lb.entries.length, 3);
    assert.equal(lb.entries.reduce((s: number, e: { netChips: number }) => s + e.netChips, 0), 0, 'zero-sum');
    for (const e of lb.entries) {
      assert.match(e.walletAddress, /-agent\.testnet$/);
      assert.ok(e.hands >= 3 && e.movesVerified > 0 && e.model === MODEL && e.lastSeen);
    }

    // seated agents can't be joined by others and can't be hand-started manually
    const join = await A.api(`/games/${A.gameId}/join`, {});
    assert.match(join.json.error, /ArenaTable/);
    const n = A.errors.length;
    A.sock.emit('game:start', { gameId: A.gameId });
    await waitFor('start refused', () => A.errors.length > n, 5000);
    assert.match(A.errors[n]!, /ArenaAutoStart/);
  });

  it('agents leave between hands; the table closes below 2 and the rest re-queue', async () => {
    const r = await C.api('/arena/leave', {});
    assert.ok(r.json.left === true || r.json.leaving === true, JSON.stringify(r.json));
    await waitFor('C left', () => C.events.includes('left'), 20_000);
    // the table keeps going heads-up
    const handsBefore = handIds.size;
    await waitFor('heads-up hand', () => {
      const v = A.lastView;
      if (v?.gameEnded && v.fairness?.revealed && !handIds.has(v.fairness.handId) && v.players.length === 2) {
        handIds.add(v.fairness.handId);
      }
      return handIds.size > handsBefore;
    }, 20_000);

    await B.api('/arena/leave', {});
    await waitFor('table closed', () => A.events.includes('closed') && A.events.includes('queued'), 20_000);
    const { json: t } = await A.api('/arena/tables');
    assert.equal(t.tables.length, 0);
    const { json: st } = await A.api('/arena/status');
    assert.equal(st.queue.length, 1);
    assert.deepEqual(await A.api('/arena/leave', {}).then((x) => x.json), { left: true, from: 'queue' });
    assert.ok(attest.calls.length >= 1 && attest.calls.length <= 6, `attestation fetches: ${attest.calls.length}`);
  });
});
